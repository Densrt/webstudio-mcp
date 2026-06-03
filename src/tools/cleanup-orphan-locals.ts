// Tool: webstudio_cleanup_orphan_locals
//
// Remove local styleSources that are no longer selected by any instance, along with all their
// attached style declarations. These accumulate over time when instances are deleted/replaced
// without proper cleanup, or when local styles are detached during edits.
//
// Idempotent: safe to re-run.
// Read-only of tokens (only locals are touched).

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type { WebstudioBuild, BuildPatchOperation } from "../webstudio-client.js";
import { customAlphabet } from "nanoid";

const txId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);

export const cleanupOrphanLocalsInputSchema = z.object({
  projectSlug: z.string(),
  /** Verbose: list each removed source. Default false (counts only). */
  verbose: z.boolean().default(false),
  dryRun: z.boolean().default(true),
}).strict();

function buildChanges(build: WebstudioBuild, args: z.infer<typeof cleanupOrphanLocalsInputSchema>) {
  // Collect all styleSourceIds that ARE selected by at least one instance
  const usedSourceIds = new Set<string>();
  for (const sel of build.styleSourceSelections) {
    for (const v of sel.values ?? []) usedSourceIds.add(v);
  }

  // Find local styleSources that are NOT used
  const orphanLocals = build.styleSources.filter(
    (s) => s.type === "local" && !usedSourceIds.has(s.id),
  );

  if (orphanLocals.length === 0) {
    return { orphanLocals: [], totalDecls: 0, styleSourcePatches: [], stylePatches: [] };
  }

  const orphanIds = new Set(orphanLocals.map((s) => s.id));

  // All decls attached to these orphan sources
  const orphanDecls = build.styles.filter((d) => orphanIds.has(d.styleSourceId));

  const styleSourcePatches: BuildPatchOperation[] = orphanLocals.map((s) => ({
    op: "remove",
    path: [s.id],
  }));
  const stylePatches: BuildPatchOperation[] = orphanDecls.map((d) => ({
    op: "remove",
    path: [`${d.styleSourceId}:${d.breakpointId}:${d.property}:${d.state ?? ""}`],
  }));

  // For verbose: count decls per source
  const declsBySource = new Map<string, number>();
  for (const d of orphanDecls) {
    declsBySource.set(d.styleSourceId, (declsBySource.get(d.styleSourceId) ?? 0) + 1);
  }

  return {
    orphanLocals: orphanLocals.map((s) => ({ id: s.id, declCount: declsBySource.get(s.id) ?? 0 })),
    totalDecls: orphanDecls.length,
    styleSourcePatches,
    stylePatches,
  };
}

export const cleanupOrphanLocalsTool: ToolModule = {
  definition: {
    name: "webstudio_cleanup_orphan_locals",
    description: `Use when: the build has accumulated orphan LOCAL styleSources (no instance selects them anymore — typically after delete_instance / refactors) and you want to clean garbage.
Do NOT use when: removing redundant local DECLS still attached to an instance (use webstudio_styles), cleaning DUPLICATES covered by a token (use webstudio_dedupe_token_locals), or deleting an unused TOKEN (use webstudio_delete_token).
Returns: dry-run with count of orphan styleSources + their ghost declarations (per-source detail in verbose mode), or push result.
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default. Tokens are NEVER touched (only type="local" with empty selection are removed). Idempotent.

Example: { projectSlug: "acme", dryRun: true }
Example: { projectSlug: "acme", verbose: true, dryRun: false }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        verbose: { type: "boolean" },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug"],
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
    const parsed = cleanupOrphanLocalsInputSchema.safeParse(args);
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
    catch (err) { return errorResult("INTERNAL_ERROR", (err as Error).message); }

    const lines: string[] = [];
    lines.push(`Orphan local styleSources: ${r.orphanLocals.length}`);
    lines.push(`Total ghost declarations to remove: ${r.totalDecls}`);
    if (data.verbose && r.orphanLocals.length > 0) {
      lines.push("");
      for (const o of r.orphanLocals.slice(0, 100)) {
        lines.push(`  • [${o.id}] ${o.declCount} decl(s)`);
      }
      if (r.orphanLocals.length > 100) lines.push(`  … (+${r.orphanLocals.length - 100} more)`);
    }
    const summary = lines.join("\n");

    if (data.dryRun) return textResult(`DRY-RUN cleanup_orphan_locals\n\n${summary}\n\nIf OK, re-run with dryRun=false.`);
    if (r.styleSourcePatches.length === 0) return textResult(`No-op (already clean):\n\n${summary}`);

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) => {
        const re = buildChanges(cur, data);
        const payload = [];
        if (re.stylePatches.length) payload.push({ namespace: "styles" as const, patches: re.stylePatches });
        if (re.styleSourcePatches.length) payload.push({ namespace: "styleSources" as const, patches: re.styleSourcePatches });
        return { id: `mcp-cleanup-orphan-locals-${txId()}`, payload };
      });
      return textResult(`Cleaned — version → ${finalVersion}\nstatus: ${result.status}\n\n${summary}`);
    } catch (err) {
      return runtimeErrorResult(err, "Cleanup failed");
    }
  },
};
