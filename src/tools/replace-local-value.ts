// Tool: webstudio_styles
//
// Bulk-replace local style declarations matching a (property, fromValue) tuple by `toValue`,
// optionally filtered by instance label, component, or page.
//
// Use case: replace recurring px hardcodés by a design token var(). Example: every Fleche
// instance with `rowGap: 8px` → `var(--mybrand-space-s)` across the whole project.
//
// Targets only LOCAL style sources by default (tokens are protected). Override with includeTokens=true.

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type { WebstudioBuild, BuildPatchOperation } from "../webstudio-client.js";
import { stateMatches } from "../lib/state-whitelist.js";
import { customAlphabet } from "nanoid";

const txId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);

const StyleValueSchema = z.record(z.unknown());

export const replaceLocalValueInputSchema = z.object({
  projectSlug: z.string(),
  /** CSS property to target (e.g. "rowGap", "color"). */
  property: z.string(),
  /** The exact value object to match (e.g. { type:"unit", unit:"px", value:8 }). */
  fromValue: StyleValueSchema,
  /** Replacement value (e.g. { type:"var", value:"mybrand-space-s", fallback:{...} }). */
  toValue: StyleValueSchema,
  /** Restrict by instance label (case-sensitive exact match). */
  instanceLabel: z.string().optional(),
  /** Restrict by component (e.g. "ws:element", "Image"). */
  component: z.string().optional(),
  /** Restrict by HTML tag (e.g. "div", "p"). */
  tag: z.string().optional(),
  /** Restrict to a single page (by id or path). */
  pageId: z.string().optional(),
  pagePath: z.string().optional(),
  /** Restrict to a specific breakpoint label/id. Default: all breakpoints. */
  breakpoint: z.string().optional(),
  /** Restrict to a specific state. Default: all states. Pass "" for default state only. */
  state: z.string().optional(),
  /** Also touch token-level decls (DANGEROUS — affects all instances of the token). Default false. */
  includeTokens: z.boolean().default(false),
  /** Verbose: list each replaced decl. Default false. */
  verbose: z.boolean().default(false),
  dryRun: z.boolean().default(true),
}).strict();

function buildChanges(build: WebstudioBuild, args: z.infer<typeof replaceLocalValueInputSchema>) {
  // Resolve filters
  let allowedBpId: string | undefined;
  if (args.breakpoint) {
    const bp = build.breakpoints.find((b) => b.label === args.breakpoint || b.id === args.breakpoint);
    if (!bp) throw new Error(`Breakpoint not found: ${args.breakpoint}`);
    allowedBpId = bp.id;
  }

  // Restrict instances by page if requested
  let pageInstanceIds: Set<string> | null = null;
  if (args.pageId || args.pagePath) {
    const page = build.pages.pages.find(
      (p) => (args.pageId && p.id === args.pageId) || (args.pagePath && p.path === args.pagePath),
    );
    if (!page) throw new Error(`Page not found: ${args.pageId ?? args.pagePath}`);
    pageInstanceIds = new Set<string>();
    const stack = [page.rootInstanceId];
    while (stack.length) {
      const id = stack.pop()!;
      if (pageInstanceIds.has(id)) continue;
      pageInstanceIds.add(id);
      const inst = build.instances.find((i) => i.id === id);
      for (const c of inst?.children ?? []) if (c.type === "id") stack.push(c.value);
    }
  }

  // Restrict instances by label/component/tag
  const instanceMatches = (instanceId: string): boolean => {
    if (pageInstanceIds && !pageInstanceIds.has(instanceId)) return false;
    if (!args.instanceLabel && !args.component && !args.tag) return true;
    const inst = build.instances.find((i) => i.id === instanceId);
    if (!inst) return false;
    if (args.instanceLabel && inst.label !== args.instanceLabel) return false;
    if (args.component && inst.component !== args.component) return false;
    if (args.tag && inst.tag !== args.tag) return false;
    return true;
  };

  // Map styleSourceId → instanceIds that select it
  const sourceToInstances = new Map<string, string[]>();
  for (const sel of build.styleSourceSelections) {
    for (const ssId of sel.values ?? []) {
      if (!sourceToInstances.has(ssId)) sourceToInstances.set(ssId, []);
      sourceToInstances.get(ssId)!.push(sel.instanceId);
    }
  }

  const fromValueStr = JSON.stringify(args.fromValue);
  const stylePatches: BuildPatchOperation[] = [];
  const matched: Array<{ instanceId: string; instanceLabel: string; styleSourceId: string; sourceType: string; breakpointId: string; property: string; state: string }> = [];

  for (const d of build.styles) {
    if (d.property !== args.property) continue;
    if (allowedBpId && d.breakpointId !== allowedBpId) continue;
    // state semantics: args.state === undefined → match every state (wildcard);
    // otherwise raw-first equality, then normalized fallback (cf. stateMatches).
    if (args.state !== undefined && !stateMatches(d.state, args.state)) continue;
    if (JSON.stringify(d.value) !== fromValueStr) continue;
    const ss = build.styleSources.find((s) => s.id === d.styleSourceId);
    if (!ss) continue;
    if (!args.includeTokens && ss.type !== "local") continue;
    const instanceIds = sourceToInstances.get(d.styleSourceId) ?? [];
    // Token decls have no specific instance, but locals are bound to one selection — both should match the filter
    if (ss.type === "local") {
      if (!instanceIds.some(instanceMatches)) continue;
    } else if (pageInstanceIds || args.instanceLabel || args.component || args.tag) {
      // For tokens, only match if at least one instance using it matches the filters
      if (!instanceIds.some(instanceMatches)) continue;
    }
    const k = `${d.styleSourceId}:${d.breakpointId}:${d.property}:${d.state ?? ""}`;
    stylePatches.push({ op: "replace", path: [k], value: { ...d, value: args.toValue } });
    const firstInst = build.instances.find((i) => instanceIds.includes(i.id) && instanceMatches(i.id));
    matched.push({
      instanceId: firstInst?.id ?? "(token-level)",
      instanceLabel: firstInst?.label ?? "(token)",
      styleSourceId: d.styleSourceId,
      sourceType: ss.type,
      breakpointId: d.breakpointId,
      property: d.property,
      state: d.state ?? "",
    });
  }

  return { stylePatches, matched };
}

export const replaceLocalValueTool: ToolModule = {
  definition: {
    name: "webstudio_replace_local_value",
    description: `Use when: bulk-replace a hardcoded style VALUE (e.g. 8px) with a token var() across many instances.
Do NOT use when: renaming var references (e.g. var(--legacy-x) → var(--new-x) — use webstudio_css_var), renaming TOKEN names (use webstudio_rename_tokens), or migrating selections from one token to another (use webstudio_replace_token).
Returns: dry-run report with match count (and per-decl listing if verbose=true), or push result with finalVersion.
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default. includeTokens=false by default — tokens protected unless explicitly opt-in (DANGEROUS, affects every instance of the token).

Matches every local decl where property=X AND value deep-equals fromValue. Filters (AND): instanceLabel, component, tag, pageId|pagePath, breakpoint, state.

Example: { projectSlug: "acme", property: "rowGap", fromValue: { type: "unit", unit: "px", value: 8 }, toValue: { type: "var", value: "mybrand-space-s" }, instanceLabel: "Fleche", dryRun: true }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        property: { type: "string" },
        fromValue: { type: "object" },
        toValue: { type: "object" },
        instanceLabel: { type: "string" },
        component: { type: "string" },
        tag: { type: "string" },
        pageId: { type: "string" },
        pagePath: { type: "string" },
        breakpoint: { type: "string" },
        state: { type: "string" },
        includeTokens: { type: "boolean" },
        verbose: { type: "boolean" },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug", "property", "fromValue", "toValue"],
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
    const parsed = replaceLocalValueInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const data = parsed.data;

    let auth;
    try { auth = data.dryRun ? requireAuth(data.projectSlug) : requirePushAuth(data.projectSlug); }
    catch (err) { return authErrorResult(err); }

    let build;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    let r;
    try { r = buildChanges(build, data); }
    catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith("Breakpoint not found")) return errorResult("VALIDATION_FAILED", msg);
      if (msg.startsWith("Page not found")) return errorResult("PAGE_NOT_FOUND", msg);
      return errorResult("INTERNAL_ERROR", msg);
    }

    const lines: string[] = [];
    lines.push(`Property "${data.property}" : ${r.matched.length} decl(s) matched`);
    if (data.verbose) {
      for (const m of r.matched.slice(0, 200)) {
        lines.push(`  • [${m.instanceId}] "${m.instanceLabel}" ${m.sourceType} ${m.property}${m.state ? ":" + m.state : ""}`);
      }
      if (r.matched.length > 200) lines.push(`  …+${r.matched.length - 200} more`);
    }
    const summary = lines.join("\n");

    if (data.dryRun) return textResult(`DRY-RUN replace_local_value\n\n${summary}\n\nIf OK, re-run with dryRun=false.`);

    if (r.stylePatches.length === 0) return textResult(`No-op (nothing to replace):\n\n${summary}`);

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) => {
        const re = buildChanges(cur, data);
        const payload = [{ namespace: "styles" as const, patches: re.stylePatches }];
        return { id: `mcp-replace-local-${txId()}`, payload };
      });
      return textResult(`Replaced — version → ${finalVersion}\nstatus: ${result.status}\n\n${summary}`);
    } catch (err) {
      return runtimeErrorResult(err, "Replace failed");
    }
  },
};
