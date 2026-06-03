// Tool: webstudio_css_var — bulk-swap var(--xxx) references across all styles.
//
// Use case: a project was forked from a template that used variables like `legacy-gap-m` or `old-text-xs`.
// Those variables don't exist in your :root anymore (or never did). Rewrite all references in one shot.
//
// The tool walks every style declaration, looks at the `value` field, detects var() references
// (including nested in layers/tuples), and rewrites them according to the provided map.

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type { WebstudioBuild, BuildPatchOperation, BuildPatchTransaction } from "../webstudio-client.js";
import { customAlphabet } from "nanoid";

const txId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);

export const rewriteVarReferencesInputSchema = z.object({
  projectSlug: z.string(),
  /** Map { fromVarName: toVarName }. Var names without leading "--".
   *  Example: { "legacy-gap-m": "mybrand-space-m" } */
  map: z.record(z.string(), z.string()),
  /** Optional regex pattern. If provided, only var names matching the regex are considered.
   *  Example: "^(?:legacy|old|foo)-" to scope rewrites to template residues. */
  scopeRegex: z.string().optional(),
  dryRun: z.boolean().default(true),
}).strict();

/**
 * Recursively walk a value object and apply the var() remap.
 * Returns { newValue, replacedCount }.
 */
function rewriteValueVars(value: unknown, map: Record<string, string>, scopeRe: RegExp | null): { value: unknown; replaced: number } {
  if (value === null || typeof value !== "object") return { value, replaced: 0 };
  // Webstudio var pattern: { type: "var", value: "name", ... }
  const v = value as Record<string, unknown>;
  if (v.type === "var" && typeof v.value === "string") {
    const target = map[v.value];
    if (target && (!scopeRe || scopeRe.test(v.value))) {
      return { value: { ...v, value: target }, replaced: 1 };
    }
    return { value, replaced: 0 };
  }
  // Recurse into arrays
  if (Array.isArray(value)) {
    let replaced = 0;
    const newArr = value.map((item) => {
      const r = rewriteValueVars(item, map, scopeRe);
      replaced += r.replaced;
      return r.value;
    });
    return { value: replaced > 0 ? newArr : value, replaced };
  }
  // Recurse into nested object fields (e.g. layers.value, tuples)
  let replaced = 0;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) {
    const r = rewriteValueVars(val, map, scopeRe);
    out[k] = r.value;
    replaced += r.replaced;
  }
  return { value: replaced > 0 ? out : value, replaced };
}

function buildChanges(build: WebstudioBuild, args: z.infer<typeof rewriteVarReferencesInputSchema>): { patches: BuildPatchOperation[]; replacedTotal: number; details: { from: string; to: string; count: number }[] } {
  const scopeRe = args.scopeRegex ? new RegExp(args.scopeRegex) : null;
  const counts = new Map<string, number>();
  const patches: BuildPatchOperation[] = [];

  for (const s of build.styles) {
    const r = rewriteValueVars(s.value, args.map, scopeRe);
    if (r.replaced === 0) continue;
    const newDecl = { ...s, value: r.value };
    const k = `${s.styleSourceId}:${s.breakpointId}:${s.property}:${s.state ?? ""}`;
    patches.push({ op: "replace", path: [k], value: newDecl });
    // Track which mappings were used
    // (re-run the recursion to detail per mapping — not strictly needed but clearer)
    detailedCount(s.value, args.map, scopeRe, counts);
  }

  let replacedTotal = 0;
  const details: { from: string; to: string; count: number }[] = [];
  for (const [from, count] of counts) {
    replacedTotal += count;
    details.push({ from, to: args.map[from], count });
  }
  details.sort((a, b) => b.count - a.count);

  return { patches, replacedTotal, details };
}

function detailedCount(value: unknown, map: Record<string, string>, scopeRe: RegExp | null, counts: Map<string, number>): void {
  if (value === null || typeof value !== "object") return;
  const v = value as Record<string, unknown>;
  if (v.type === "var" && typeof v.value === "string") {
    if (map[v.value] && (!scopeRe || scopeRe.test(v.value))) {
      counts.set(v.value, (counts.get(v.value) ?? 0) + 1);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) detailedCount(item, map, scopeRe, counts);
    return;
  }
  for (const val of Object.values(v)) detailedCount(val, map, scopeRe, counts);
}

export const rewriteVarReferencesTool: ToolModule = {
  definition: {
    name: "webstudio_rewrite_var_references",
    description: `Use when: a forked template references CSS vars that no longer exist — bulk-rewrite var() REFERENCES across all style decls (rewrites { type:"var", value:"name" } and var(--name) inside unparsed values + layers + tuples recursively).
Do NOT use when: renaming the var DEFINITION itself (use webstudio_css_var + webstudio_css_var sequence), renaming TOKEN names (use webstudio_rename_tokens — tokens are not CSS vars), swapping a hardcoded value like 8px for var() (use webstudio_styles), or migrating one token to another in selections (use webstudio_replace_token).
Returns: dry-run with per-mapping replacement count (e.g. "var(--legacy-gap-m) → var(--mybrand-space-m) ×42") + total occurrences + decl patch count, or push result.
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default.

map: { fromName: toName } without leading "--". scopeRegex optionally restricts which var names are eligible for rewrite (e.g. "^(?:old|legacy|foo)-" to scope only template residues, ignoring matches in custom vars added later).

Example: { projectSlug: "acme", map: { "legacy-gap-m": "mybrand-space-m", "old-text-xs": "mybrand-text-xs" }, scopeRegex: "^(?:legacy|old)-", dryRun: true }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        map: { type: "object", additionalProperties: { type: "string" } },
        scopeRegex: { type: "string" },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug", "map"],
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
    const parsed = rewriteVarReferencesInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const data = parsed.data;

    let auth;
    try { auth = data.dryRun ? requireAuth(data.projectSlug) : requirePushAuth(data.projectSlug); }
    catch (err) { return authErrorResult(err); }

    let build;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    const r = buildChanges(build, data);
    if (r.patches.length === 0) {
      return textResult(`No var() references matched the map (or scopeRegex). Map keys: ${Object.keys(data.map).join(", ")}`);
    }

    const summary = `Rewrites: ${r.replacedTotal} occurrence(s) across ${r.patches.length} style declaration(s).
Per mapping:
${r.details.map((d) => `  - var(--${d.from}) → var(--${d.to})  (×${d.count})`).join("\n")}`;

    if (data.dryRun) return textResult(`DRY-RUN rewrite_var_references\n\n${summary}\n\nIf OK, re-run with dryRun=false.`);

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) => {
        const re = buildChanges(cur, data);
        const tx: BuildPatchTransaction = {
          id: `mcp-rewrite-vars-${txId()}`,
          payload: [{ namespace: "styles", patches: re.patches }],
        };
        return tx;
      });
      return textResult(`Var references rewritten — version → ${finalVersion}\nstatus: ${result.status}\n\n${summary}`);
    } catch (err) {
      return runtimeErrorResult(err, "Rewrite failed");
    }
  },
};
