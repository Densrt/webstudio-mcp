// Tool: webstudio_styles — surgical removal of local style declarations.
// Counterpart to update_styles, which can only add/replace but never delete.
//
// Targets ONLY local styleSources (tokens are protected — same model as the rest of the codebase).
// Each deletion is keyed by (instanceId, property, breakpoint?, state?). Omitting breakpoint and/or
// state matches every variant for that property on the instance's local — useful for cleaning up
// noise like `transitionDelay: 0s` / `transitionBehavior: normal` left over by the Webstudio panel.

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry, type WebstudioBuild, type BuildPatchOperation, type BuildPatchTransaction } from "../webstudio-client.js";
import type { StyleDecl } from "../types.js";
import { stateMatches } from "../lib/state-whitelist.js";
import { customAlphabet } from "nanoid";

const txId = customAlphabet(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
  21,
);

const DeletionSchema = z.object({
  instanceId: z.string(),
  property: z.string(),
  breakpoint: z.string().optional(),
  state: z.string().optional(),
}).strict();

export const deleteLocalStyleDeclInputSchema = z.object({
  projectSlug: z.string(),
  deletions: z.array(DeletionSchema).min(1),
  dryRun: z.boolean().default(true),
}).strict();

type Deletion = z.infer<typeof DeletionSchema>;

function styleKey(d: { styleSourceId: string; breakpointId: string; property: string; state?: string }): string {
  return `${d.styleSourceId}:${d.breakpointId}:${d.property}:${d.state ?? ""}`;
}

export function buildDeleteLocalStyleDeclTransaction(
  build: WebstudioBuild,
  deletions: Deletion[],
): { transaction: BuildPatchTransaction; details: string[]; matchedCount: number } {
  const stylePatches: BuildPatchOperation[] = [];
  const details: string[] = [];
  const seenKeys = new Set<string>();

  for (const d of deletions) {
    const inst = build.instances.find((i) => i.id === d.instanceId);
    if (!inst) {
      details.push(`! ${d.instanceId}: instance not found`);
      continue;
    }

    const selection = build.styleSourceSelections.find((s) => s.instanceId === d.instanceId);
    if (!selection) {
      details.push(`· ${d.instanceId} (${inst.label ?? inst.component}): no style source selection — nothing to delete`);
      continue;
    }

    // Collect the instance's LOCAL styleSources (a selection can mix tokens + 1 local).
    const localSourceIds = selection.values.filter((sourceId) => {
      const src = build.styleSources.find((s) => s.id === sourceId);
      return src?.type === "local";
    });

    if (localSourceIds.length === 0) {
      details.push(`· ${d.instanceId} (${inst.label ?? inst.component}): no local style source (only tokens) — nothing to delete`);
      continue;
    }

    // Resolve breakpoint filter if provided (case-insensitive label or id).
    let bpFilterId: string | undefined;
    if (d.breakpoint) {
      const q = d.breakpoint.toLowerCase();
      const bp = build.breakpoints.find((b) => b.label.toLowerCase() === q || b.id === d.breakpoint);
      if (!bp) {
        const available = build.breakpoints.map((b) => `"${b.label}"`).join(", ");
        details.push(`! ${d.instanceId}: breakpoint "${d.breakpoint}" not found (available: ${available})`);
        continue;
      }
      bpFilterId = bp.id;
    }

    // Match local decls for this instance + property (+ optional bp + state).
    // state semantics: d.state === undefined → match every state (wildcard);
    // otherwise raw-first equality, then normalized fallback (cf. stateMatches).
    const matches = build.styles.filter((s: StyleDecl) =>
      localSourceIds.includes(s.styleSourceId) &&
      s.property === d.property &&
      (bpFilterId === undefined || s.breakpointId === bpFilterId) &&
      (d.state === undefined || stateMatches(s.state, d.state)),
    );

    if (matches.length === 0) {
      const filter = [
        d.property,
        d.breakpoint ? `bp=${d.breakpoint}` : "bp=*",
        d.state ? `state=${d.state}` : "state=*",
      ].join(" ");
      details.push(`· ${d.instanceId} (${inst.label ?? inst.component}): no local decl matches ${filter}`);
      continue;
    }

    for (const m of matches) {
      const key = styleKey(m);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      stylePatches.push({ op: "remove", path: [key] });
      const bpLabel = build.breakpoints.find((b) => b.id === m.breakpointId)?.label ?? m.breakpointId;
      details.push(`- ${d.instanceId} (${inst.label ?? inst.component}): ${m.property}${m.state ? `[${m.state}]` : ""} @${bpLabel}`);
    }
  }

  const payload = stylePatches.length > 0
    ? [{ namespace: "styles" as const, patches: stylePatches }]
    : [];

  return {
    transaction: { id: `mcp-delete-local-style-${txId()}`, payload },
    details,
    matchedCount: stylePatches.length,
  };
}

export const deleteLocalStyleDeclTool: ToolModule = {
  definition: {
    name: "webstudio_delete_local_style_decl",
    description: `Use when: REMOVE a local style declaration (not just override it). Counterpart to webstudio_styles which can only add/replace.
Do NOT use when: removing an instance attribute like alt/src/href (use webstudio_instance_prop — props are not styles), cleaning a token decl (use webstudio_update_token_styles with a corrective value, or webstudio_delete_token), or removing orphaned styleSources (use webstudio_cleanup_orphan_locals).
Returns: dry-run report listing each matched decl with its breakpoint label, or push result with count removed.
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default. Tokens are protected — only local styleSources are touched. Idempotent (no-op if nothing matches).

Each deletion is keyed by (instanceId, property, breakpoint?, state?). Omitting breakpoint matches all bp; omitting state matches every variant (useful to bulk-clean transitionDelay:0s noise). Pass state:"" to target base only.

Example: { projectSlug: "acme", deletions: [{ instanceId: "abc", property: "transitionDelay" }], dryRun: true }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        deletions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              instanceId: { type: "string" },
              property: { type: "string" },
              breakpoint: { type: "string", description: "Optional. Omit to match all breakpoints." },
              state: { type: "string", description: "Optional. Omit to match all states (base + hover/focus/etc.). Pass empty string \"\" to target base only." },
            },
            required: ["instanceId", "property"],
          },
        },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug", "deletions"],
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
    const parsed = deleteLocalStyleDeclInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const { projectSlug, deletions, dryRun } = parsed.data;

    let auth;
    try { auth = dryRun ? requireAuth(projectSlug) : requirePushAuth(projectSlug); }
    catch (err) { return authErrorResult(err); }

    let build;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    const tx = buildDeleteLocalStyleDeclTransaction(build, deletions);

    if (tx.matchedCount === 0) {
      return textResult(`No-op (nothing matched):\n${tx.details.join("\n")}`);
    }

    if (dryRun) {
      return textResult(`DRY-RUN delete_local_style_decl\n\n${tx.matchedCount} decl(s) to remove:\n${tx.details.join("\n")}\n\nIf OK, re-run with dryRun=false.`);
    }

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) => buildDeleteLocalStyleDeclTransaction(cur, deletions).transaction);
      return textResult(`${tx.matchedCount} decl(s) removed — version → ${finalVersion}\nstatus: ${result.status}\n\n${tx.details.join("\n")}`);
    } catch (err) {
      return runtimeErrorResult(err, "Delete failed");
    }
  },
};
