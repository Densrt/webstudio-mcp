// Tool: webstudio_css_var
//
// Add or update CSS custom properties (--xxx: value) on the project's root scope.
// In Webstudio, root-level CSS vars live on a styleSource that is selected by the virtual ":root" instance.
// This tool finds that styleSource (or creates one if missing) and adds/updates the var declarations.
//
// Use case: extend the design system with new tokens like --mybrand-radius-s, --mybrand-font-weight-bold,
// etc. Once defined, those vars can be referenced by any styleSource via { type:"var", value:"<name>" }.
//
// Accepted value forms for each entry in `vars`:
//   - A typed StyleValue object (e.g. {type:"unit", unit:"px", value:2})
//   - A raw CSS string ("#FEFEFE", "1.5rem", "var(--space-4)", "clamp(...)") — auto-converted via
//     parseStringToStyleValue. See ./define-css-var/parse-style-value.ts for the deduction rules.

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type { WebstudioBuild, BuildPatchOperation } from "../webstudio-client.js";
import { customAlphabet } from "nanoid";
import type { StyleValue } from "../types.js";
import { parseStringToStyleValue, extractVarRefs } from "./define-css-var/parse-style-value.js";
import { normalizeStyleValueWithMeta } from "../lib/style-normalize.js";
import { logCoerce } from "../lib/telemetry.js";

const txId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);
const newId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);

/** Webstudio uses ":root" as the conventional id for the virtual root instance hosting :root scoped CSS. */
const ROOT_INSTANCE_ID = ":root";

/** Loose StyleValue object schema — full validation is deferred to Webstudio. We mainly need to
 *  distinguish "raw string" from "typed object" so we know when to invoke the auto-parser. */
const StyleValueObjectSchema = z.record(z.unknown());
const ValueInputSchema = z.union([z.string(), StyleValueObjectSchema]);

export const defineCssVarInputSchema = z.object({
  projectSlug: z.string(),
  /** Map of CSS variable name (without the leading "--") → style value.
   *  Value can be either a typed StyleValue object OR a raw CSS string (auto-parsed).
   *  Examples:
   *    { "mybrand-radius-s": "0.5rem" }
   *    { "mybrand-bg": "#FEFEFE" }
   *    { "mybrand-radius-s": { type:"unit", unit:"px", value:2 } } */
  vars: z.record(z.string(), ValueInputSchema),
  /** Breakpoint label or id. Default "Base". */
  breakpoint: z.string().default("Base"),
  /** Allow overwriting existing CSS vars. Default true (idempotent updates). Set false to refuse if any name already exists. */
  overwrite: z.boolean().default(true),
  /** If true, dangling var() references (vars that don't exist in the project nor in the current batch)
   *  cause a hard VALIDATION_FAILED instead of a soft WARN. Default false. */
  strict: z.boolean().default(false),
  dryRun: z.boolean().default(true),
}).strict();

type ParsedArgs = z.infer<typeof defineCssVarInputSchema>;

/** Normalize raw-string inputs in `vars` to typed StyleValue objects.
 *  Mutates `args.vars` to a new map of name → StyleValue.
 *  Also surfaces pedagogical hints + telemetryKeys when a silent coercion happened
 *  (e.g. caller passed color components in legacy 0..255 form). */
function normalizeVars(args: ParsedArgs): {
  normalized: Record<string, StyleValue>;
  conversions: { name: string; raw: string; type: string }[];
  hintsByVar: { name: string; hints: string[]; telemetryKeys: string[] }[];
} {
  const normalized: Record<string, StyleValue> = {};
  const conversions: { name: string; raw: string; type: string }[] = [];
  const hintsByVar: { name: string; hints: string[]; telemetryKeys: string[] }[] = [];
  for (const [name, value] of Object.entries(args.vars)) {
    let result;
    if (typeof value === "string") {
      // Parse "1rem", "#fff", "rgba(...)", "var(--x)", ... → typed StyleValue.
      // Then normalize colors to wire-format (server rejects {type:"color",colorSpace:"rgb"} here).
      result = normalizeStyleValueWithMeta(parseStringToStyleValue(value));
      normalized[name] = result.value;
      conversions.push({ name, raw: value, type: result.value.type });
    } else {
      result = normalizeStyleValueWithMeta(value as StyleValue);
      normalized[name] = result.value;
    }
    if (result.meta.hints.length || result.meta.telemetryKeys.length) {
      hintsByVar.push({ name, hints: result.meta.hints, telemetryKeys: result.meta.telemetryKeys });
    }
  }
  return { normalized, conversions, hintsByVar };
}

/** Scan all root-scoped CSS vars already defined in the build.
 *  Returns the set of var names (without the leading "--"). */
function collectExistingVarNames(build: WebstudioBuild): Set<string> {
  const out = new Set<string>();
  for (const d of build.styles) {
    if (!d.property.startsWith("--")) continue;
    out.add(d.property.slice(2));
  }
  return out;
}

/** Check that every `{type:"var"}` or `var(--xxx)` inside unparsed values refers to an existing var
 *  (either already in the project, or being added in this same call). Returns the missing refs. */
function findDanglingVarRefs(
  vars: Record<string, StyleValue>,
  existing: Set<string>,
): { dangling: { source: string; ref: string }[] } {
  const allKnown = new Set(existing);
  for (const k of Object.keys(vars)) {
    allKnown.add(k.startsWith("--") ? k.slice(2) : k);
  }
  const dangling: { source: string; ref: string }[] = [];
  for (const [name, sv] of Object.entries(vars)) {
    if (sv && typeof sv === "object" && "type" in sv) {
      if (sv.type === "var" && typeof (sv as { value: unknown }).value === "string") {
        const ref = (sv as { value: string }).value;
        if (!allKnown.has(ref)) dangling.push({ source: name, ref });
      } else if (sv.type === "unparsed" && typeof (sv as { value: unknown }).value === "string") {
        const refs = extractVarRefs((sv as { value: string }).value);
        for (const ref of refs) {
          if (!allKnown.has(ref)) dangling.push({ source: name, ref });
        }
      }
    }
  }
  return { dangling };
}

function buildChanges(build: WebstudioBuild, args: ParsedArgs, normalizedVars: Record<string, StyleValue>) {
  const bp = build.breakpoints.find((b) => b.label === args.breakpoint || b.id === args.breakpoint);
  if (!bp) throw new Error(`Breakpoint not found: ${args.breakpoint}`);

  // 1) Find the styleSource that hosts root-scoped CSS vars (selected by ":root").
  const rootSelection = build.styleSourceSelections.find((s) => s.instanceId === ROOT_INSTANCE_ID);

  const styleSourcePatches: BuildPatchOperation[] = [];
  const selectionPatches: BuildPatchOperation[] = [];
  const stylePatches: BuildPatchOperation[] = [];

  let rootStyleSourceId: string | undefined;
  if (rootSelection) {
    // Pick the first local source if any (where existing vars live)
    const localId = rootSelection.values.find((v) => build.styleSources.find((s) => s.id === v)?.type === "local");
    if (localId) rootStyleSourceId = localId;
  }

  // Bootstrap: create a local styleSource + selection if none exists
  let createdRootSource = false;
  if (!rootStyleSourceId) {
    rootStyleSourceId = newId();
    createdRootSource = true;
    styleSourcePatches.push({
      op: "add",
      path: [rootStyleSourceId],
      value: { type: "local", id: rootStyleSourceId },
    });
    const newSel = rootSelection
      ? { instanceId: ROOT_INSTANCE_ID, values: [...rootSelection.values, rootStyleSourceId] }
      : { instanceId: ROOT_INSTANCE_ID, values: [rootStyleSourceId] };
    selectionPatches.push({
      op: rootSelection ? "replace" : "add",
      path: [ROOT_INSTANCE_ID],
      value: newSel,
    });
  }

  // 2) Detect existing var decls on this source
  const existingVars = new Map<string, WebstudioBuild["styles"][number]>();
  for (const d of build.styles) {
    if (d.styleSourceId !== rootStyleSourceId) continue;
    if (!d.property.startsWith("--")) continue;
    if (d.breakpointId !== bp.id) continue;
    existingVars.set(d.property, d);
  }

  const created: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];

  // 3) Apply each var
  for (const [name, value] of Object.entries(normalizedVars)) {
    const property = name.startsWith("--") ? name : `--${name}`;
    const existing = existingVars.get(property);
    if (existing) {
      // Identical? skip (idempotence)
      if (JSON.stringify(existing.value) === JSON.stringify(value)) {
        skipped.push(`${property} (identical)`);
        continue;
      }
      if (!args.overwrite) {
        throw new Error(`CSS var "${property}" already exists. Use overwrite=true (default) to update it.`);
      }
      const k = `${rootStyleSourceId}:${bp.id}:${property}:`;
      stylePatches.push({ op: "replace", path: [k], value: { ...existing, value } });
      updated.push(property);
    } else {
      const decl = {
        styleSourceId: rootStyleSourceId,
        breakpointId: bp.id,
        property,
        value,
        listed: false,
      };
      const k = `${rootStyleSourceId}:${bp.id}:${property}:`;
      stylePatches.push({ op: "add", path: [k], value: decl });
      created.push(property);
    }
  }

  return {
    rootStyleSourceId,
    createdRootSource,
    styleSourcePatches,
    selectionPatches,
    stylePatches,
    created,
    updated,
    skipped,
  };
}

export const defineCssVarTool: ToolModule = {
  definition: {
    name: "webstudio_define_css_var",
    description: `Use when: add or update CSS custom properties (--xxx: value) at the project's :root scope. Vars live on a local styleSource selected by the virtual ":root" instance (auto-created if missing).
Do NOT use when: creating design TOKENS (use webstudio_create_tokens / webstudio_init_brand_tokens — tokens are styleSource type="token", different model), renaming existing var REFERENCES from var(--a) to var(--b) (use webstudio_css_var), or removing a var (use webstudio_css_var).
Returns: dry-run report with Created/Updated/Skipped lists + string→StyleValue conversions log + WARN section for dangling var() refs, or push result.
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default. Idempotent (identical vars skipped).

Each value in vars is either a typed StyleValue OR a raw CSS string ("#FEFEFE", "1.5rem", "var(--x)", "clamp(...)") — strings are auto-parsed via parseStringToStyleValue. overwrite=true (default) replaces existing; false refuses. strict=true turns dangling var() references into hard errors (default: WARN). Reference vars elsewhere as { type:"var", value:"<name-without-leading-dashes>" }.

Example: { projectSlug: "acme", vars: { "mybrand-radius-s": "0.5rem", "mybrand-bg": "#FEFEFE" }, dryRun: true }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        vars: { type: "object" },
        breakpoint: { type: "string" },
        overwrite: { type: "boolean" },
        strict: { type: "boolean" },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug", "vars"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  handler: async (args) => {
    const parsed = defineCssVarInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const data = parsed.data;

    // Normalize string values → StyleValue objects (before any auth/fetch — cheap & fail-fast).
    const { normalized, conversions, hintsByVar } = normalizeVars(data);

    // Fire telemetry for each silent coercion (no-op if WEBSTUDIO_MCP_TELEMETRY != "1").
    for (const h of hintsByVar) {
      for (const tk of h.telemetryKeys) {
        void logCoerce(tk, { source: "cssvar.define", projectSlug: data.projectSlug, varName: h.name });
      }
    }

    let auth;
    try { auth = data.dryRun ? requireAuth(data.projectSlug) : requirePushAuth(data.projectSlug); }
    catch (err) { return authErrorResult(err); }

    let build;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    // Guard-rail: check for dangling var() references
    const existingVarNames = collectExistingVarNames(build);
    const { dangling } = findDanglingVarRefs(normalized, existingVarNames);
    let warnSection = "";
    if (dangling.length) {
      const list = dangling.map((d) => `  - --${d.source} references undefined var(--${d.ref})`).join("\n");
      if (data.strict) {
        return errorResult(
          "VALIDATION_FAILED",
          `Dangling var() references detected (strict=true):\n${list}\n\nDefine the missing vars first, or set strict=false to downgrade to a warning.`,
        );
      }
      warnSection = `\nWARN: ${dangling.length} dangling var() reference(s):\n${list}\n`;
    }

    let r;
    try { r = buildChanges(build, data, normalized); }
    catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith("Breakpoint not found")) return errorResult("VALIDATION_FAILED", msg);
      if (msg.startsWith("CSS var ") && msg.includes("already exists")) return errorResult("VALIDATION_FAILED", msg);
      return errorResult("INTERNAL_ERROR", msg);
    }

    const conversionsSection = conversions.length
      ? `\nString → StyleValue conversions: ${conversions.length}\n` +
        conversions.map((c) => `  - --${c.name}: "${c.raw}" → ${c.type}`).join("\n") +
        "\n"
      : "";

    const hintsSection = hintsByVar.length
      ? `\n[hints]\n` +
        hintsByVar
          .flatMap((h) => h.hints.map((msg) => `  - --${h.name}: ${msg}`))
          .join("\n") +
        "\n"
      : "";

    const summary = `Root styleSource: ${r.rootStyleSourceId}${r.createdRootSource ? " (newly created)" : ""}
Created : ${r.created.length}${r.created.length ? "  (" + r.created.join(", ") + ")" : ""}
Updated : ${r.updated.length}${r.updated.length ? "  (" + r.updated.join(", ") + ")" : ""}
Skipped : ${r.skipped.length}${r.skipped.length ? "  (" + r.skipped.join(", ") + ")" : ""}${conversionsSection}${warnSection}${hintsSection}`;

    if (data.dryRun) return textResult(`DRY-RUN define_css_var\n\n${summary}\n\nIf OK, re-run with dryRun=false.`);

    if (r.styleSourcePatches.length === 0 && r.selectionPatches.length === 0 && r.stylePatches.length === 0) {
      return textResult(`No-op (all vars identical):\n\n${summary}`);
    }

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) => {
        const re = buildChanges(cur, data, normalized);
        const payload = [];
        if (re.styleSourcePatches.length) payload.push({ namespace: "styleSources" as const, patches: re.styleSourcePatches });
        if (re.selectionPatches.length) payload.push({ namespace: "styleSourceSelections" as const, patches: re.selectionPatches });
        if (re.stylePatches.length) payload.push({ namespace: "styles" as const, patches: re.stylePatches });
        return { id: `mcp-define-css-var-${txId()}`, payload };
      });
      return textResult(`CSS vars updated — version → ${finalVersion}\nstatus: ${result.status}\n\n${summary}`);
    } catch (err) {
      return runtimeErrorResult(err, "Define failed");
    }
  },
};
