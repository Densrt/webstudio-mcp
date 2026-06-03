// Tool: webstudio_delete_pages — batch deletion of pages with continue-on-error.
//
// Difference vs. webstudio_delete_page: takes an array of pageIds, builds ONE consolidated
// transaction with all valid removals, and pushes it once. Each item is processed
// independently — a failure on one item (home page, not found, etc.) does NOT abort the
// whole batch. The response is a structured report (succeeded / failed) per item.

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type {
  WebstudioBuild,
  BuildPatchTransaction,
  BuildPatchChange,
} from "../webstudio-client.js";
import { buildInstanceRemovalChanges } from "../cleanup-helpers.js";
import { txId } from "./pages/ids.js";

export const deletePagesBatchInputSchema = z.object({
  projectSlug: z.string(),
  pageIds: z.array(z.string()).min(1),
  dryRun: z.boolean().default(true),
}).strict();

type Succeeded = { pageId: string; name: string; path: string; instanceCount: number };
type Failed = { pageId: string; reason: string };

type Plan = {
  changes: BuildPatchChange[];
  succeeded: Succeeded[];
  failed: Failed[];
};

/**
 * Build a consolidated transaction's changes from a list of page targets.
 * Skips items that can't be deleted (home, not found, no folder) and records reasons.
 * Only successful items contribute patches.
 */
function planDeletePages(build: WebstudioBuild, pageIds: string[]): Plan {
  const folders = build.pages.folders as Array<{ id: string; children: string[] }>;
  const homePageId = build.pages.homePageId;

  const succeeded: Succeeded[] = [];
  const failed: Failed[] = [];

  // page namespace patches collected here
  const pageRemovePatches: BuildPatchChange["patches"] = [];
  // Per-folder we accumulate the removed child ids, then emit ONE replace at the end
  const folderChildRemovals = new Map<string, Set<string>>();
  // Roots whose subtree must be removed
  const instanceRootsToRemove: string[] = [];

  const seen = new Set<string>();
  for (const pageId of pageIds) {
    if (seen.has(pageId)) {
      failed.push({ pageId, reason: "duplicate in batch (skipped)" });
      continue;
    }
    seen.add(pageId);

    const page = build.pages.pages.find((p) => p.id === pageId);
    if (!page) {
      failed.push({ pageId, reason: "not found" });
      continue;
    }
    if (pageId === homePageId) {
      failed.push({ pageId, reason: "skipped (home)" });
      continue;
    }
    const folder = folders.find((f) => f.children.includes(pageId));
    if (!folder) {
      failed.push({ pageId, reason: "not found in any folder" });
      continue;
    }

    pageRemovePatches.push({ op: "remove" as const, path: ["pages", pageId] });
    const set = folderChildRemovals.get(folder.id) ?? new Set<string>();
    set.add(pageId);
    folderChildRemovals.set(folder.id, set);
    instanceRootsToRemove.push(page.rootInstanceId);

    // We count instances later for the report (after building the removal changes).
    succeeded.push({
      pageId,
      name: page.name,
      path: page.path,
      instanceCount: 0,
    });
  }

  const changes: BuildPatchChange[] = [];

  if (pageRemovePatches.length > 0) {
    const folderReplacePatches: BuildPatchChange["patches"] = [];
    for (const [folderId, removed] of folderChildRemovals) {
      const folder = folders.find((f) => f.id === folderId)!;
      folderReplacePatches.push({
        op: "replace" as const,
        path: ["folders", folderId, "children"],
        value: folder.children.filter((c) => !removed.has(c)),
      });
    }
    changes.push({
      namespace: "pages",
      patches: [...pageRemovePatches, ...folderReplacePatches],
    });
  }

  if (instanceRootsToRemove.length > 0) {
    const instanceChanges = buildInstanceRemovalChanges(build, instanceRootsToRemove);
    // Attribute the instance count per page (best-effort — sum descendants per root)
    // We re-walk to give each succeeded entry its own count.
    for (const s of succeeded) {
      const page = build.pages.pages.find((p) => p.id === s.pageId)!;
      const oneOff = buildInstanceRemovalChanges(build, [page.rootInstanceId]);
      const cnt = oneOff.find((c) => c.namespace === "instances")?.patches.length ?? 0;
      s.instanceCount = cnt;
    }
    changes.push(...instanceChanges);
  }

  return { changes, succeeded, failed };
}

function buildTransaction(changes: BuildPatchChange[]): BuildPatchTransaction {
  return {
    id: `mcp-delete-pages-${txId()}`,
    payload: changes,
  };
}

function renderReport(succeeded: Succeeded[], failed: Failed[]): string {
  const lines: string[] = [];
  lines.push(`Succeeded: ${succeeded.length}`);
  for (const s of succeeded) {
    lines.push(`  ✓ ${s.name} (${s.pageId})  path=${s.path}  instances=${s.instanceCount}`);
  }
  lines.push(`\nFailed: ${failed.length}`);
  for (const f of failed) {
    lines.push(`  ✗ ${f.pageId} — ${f.reason}`);
  }
  return lines.join("\n");
}

export const deletePagesBatchTool: ToolModule = {
  definition: {
    name: "webstudio_delete_pages",
    description: `Use when: BATCH-delete several non-home pages in one consolidated transaction (one push, continue-on-error).
Do NOT use when: this is the only path to delete pages in v0.3.0 — for a single page, pass [singleId]. To delete a folder + all its pages cascading, use webstudio_delete_folder with recursive=true. To remove the home page, you must reassign homePageId first via another tool — this batch always skips it.
Returns: succeeded list ({pageId, name, path, instanceCount}) + failed list ({pageId, reason}) — invalid targets (home, not found, no folder, duplicate) are skipped and reported without aborting the rest.
Each successful target gets full cleanup (instances + props + styleSourceSelections) via the same tree-walker as the single-page tool.
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default.

Example: { projectSlug: "acme", pageIds: ["pg_legacy_1", "pg_legacy_2", "pg_legacy_3"], dryRun: true }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        pageIds: {
          type: "array",
          items: { type: "string" },
          description: "List of page IDs to delete. Home page id is skipped automatically.",
        },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug", "pageIds"],
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
    const parsed = deletePagesBatchInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const { projectSlug, pageIds, dryRun } = parsed.data;

    let auth;
    try {
      auth = dryRun ? requireAuth(projectSlug) : requirePushAuth(projectSlug);
    } catch (err) {
      return authErrorResult(err);
    }

    let build;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    const plan = planDeletePages(build, pageIds);

    if (plan.succeeded.length === 0) {
      return textResult(
        `DRY-RUN delete_pages — nothing to delete.\n\n${renderReport(plan.succeeded, plan.failed)}`,
      );
    }

    if (dryRun) {
      return textResult(
        `DRY-RUN delete_pages (${plan.succeeded.length} page(s) will be deleted)\n\n${renderReport(plan.succeeded, plan.failed)}\n\nIf OK, re-run with dryRun=false.`,
      );
    }

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) => {
        const fresh = planDeletePages(cur, pageIds);
        return buildTransaction(fresh.changes);
      });
      return textResult(
        `Batch delete_pages — version → ${finalVersion}  status: ${result.status}\n\n${renderReport(plan.succeeded, plan.failed)}`,
      );
    } catch (err) {
      return runtimeErrorResult(err, "Push failed");
    }
  },
};
