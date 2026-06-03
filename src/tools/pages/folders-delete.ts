// Tool: webstudio_delete_folder — delete a page folder (with optional recursive cascade).
//
// Atomic transaction: removes the target folder (and optionally all descendant pages + sub-folders),
// cleans up instances/props/styleSourceSelections of descendant pages, detaches the folder from its
// parent, and optionally relocates the home page to the root folder when forced.
//
// Refusals:
// - hard: target == rootFolderId (always refused, even with force=true)
// - default: folder has children and !recursive
// - default: home page is in the descendant set and !force (only meaningful with recursive=true)

import { z } from "zod";
import type { ToolModule } from "../types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "../types.js";
import { requireAuth, requirePushAuth } from "../../auth.js";
import { fetchBuild, pushWithRetry } from "../../webstudio-client.js";
import type { WebstudioBuild, BuildPatchTransaction, BuildPatchOperation } from "../../webstudio-client.js";
import { buildInstanceRemovalChanges } from "../../cleanup-helpers.js";
import { txId } from "./ids.js";
import { detectRootFolderId } from "./folders-list.js";

type Folder = { id: string; name: string; slug?: string; children: string[] };
type Page = { id: string; name: string; path: string; rootInstanceId: string };

export const deleteFolderInputSchema = z.object({
  projectSlug: z.string(),
  folderId: z.string(),
  recursive: z.boolean().default(false),
  dryRun: z.boolean().default(true),
  force: z.boolean().default(false),
}).strict();

type DeletePlan = {
  rootFolderId: string;
  targetFolder: Folder;
  parentFolder: Folder;
  descendantFolderIds: string[];   // includes target
  descendantPageIds: string[];     // pages in target + sub-folders
  homeRelocated: boolean;          // true if home was inside and force=true
  instanceCount: number;           // count of instance removal patches (root + descendants)
};

/**
 * Walk the folder tree from `startId`, collecting every descendant folder id and every page id
 * that lives in any of those folders. The starting folder is included in descendantFolderIds.
 */
function walkDescendants(
  folders: Folder[],
  pages: Page[],
  startId: string,
): { folderIds: string[]; pageIds: string[] } {
  const folderById = new Map(folders.map((f) => [f.id, f]));
  const pageIdSet = new Set(pages.map((p) => p.id));

  const descendantFolderIds: string[] = [];
  const descendantPageIds: string[] = [];

  const visit = (id: string) => {
    const folder = folderById.get(id);
    if (!folder) return;
    descendantFolderIds.push(id);
    for (const childId of folder.children) {
      if (folderById.has(childId)) visit(childId);
      else if (pageIdSet.has(childId)) descendantPageIds.push(childId);
    }
  };
  visit(startId);

  return { folderIds: descendantFolderIds, pageIds: descendantPageIds };
}

/**
 * Build the deletion plan. Throws Error with a coded message prefix consumed by the handler.
 */
export function planDeleteFolder(
  build: WebstudioBuild,
  folderId: string,
  recursive: boolean,
  force: boolean,
): DeletePlan {
  const folders = build.pages.folders as Folder[];
  const pages = build.pages.pages as Page[];

  const target = folders.find((f) => f.id === folderId);
  if (!target) throw new Error(`Folder "${folderId}" not found`);

  const rootFolderId = detectRootFolderId(build);
  if (!rootFolderId) throw new Error(`Root folder could not be detected`);
  if (folderId === rootFolderId) throw new Error(`Refusing to delete the ROOT folder`);

  const parent = folders.find((f) => f.children.includes(folderId));
  if (!parent) throw new Error(`Folder "${folderId}" has no parent (orphan); refusing to delete`);

  if (!recursive && target.children.length > 0) {
    throw new Error(
      `Folder "${target.name}" has ${target.children.length} child(ren); pass recursive=true to cascade`,
    );
  }

  const { folderIds: descendantFolderIds, pageIds: descendantPageIds } = walkDescendants(
    folders,
    pages,
    folderId,
  );

  const homeId = build.pages.homePageId;
  const homeInDescendants = descendantPageIds.includes(homeId);
  if (homeInDescendants && !force) {
    throw new Error(
      `Home page is inside this folder tree; pass force=true to relocate it to the root folder`,
    );
  }

  // Count instances that will be removed (sum of root subtrees of every non-home descendant page).
  let instanceCount = 0;
  const pageById = new Map(pages.map((p) => [p.id, p]));
  const nonHomeDescendantPageIds = descendantPageIds.filter((id) => id !== homeId);
  if (nonHomeDescendantPageIds.length > 0) {
    const rootInstanceIds = nonHomeDescendantPageIds
      .map((id) => pageById.get(id)?.rootInstanceId)
      .filter((v): v is string => typeof v === "string");
    instanceCount = buildInstanceRemovalChanges(build, rootInstanceIds)
      .find((c) => c.namespace === "instances")?.patches.length ?? 0;
  }

  return {
    rootFolderId,
    targetFolder: target,
    parentFolder: parent,
    descendantFolderIds,
    descendantPageIds,
    homeRelocated: homeInDescendants && force,
    instanceCount,
  };
}

function buildDeleteFolderTransaction(
  build: WebstudioBuild,
  folderId: string,
  recursive: boolean,
  force: boolean,
): BuildPatchTransaction {
  const plan = planDeleteFolder(build, folderId, recursive, force);
  const folders = build.pages.folders as Folder[];
  const pages = build.pages.pages as Page[];
  const homeId = build.pages.homePageId;
  const pageById = new Map(pages.map((p) => [p.id, p]));

  const pagesPatches: BuildPatchOperation[] = [];
  const nonHomeDescendantPageIds = plan.descendantPageIds.filter((id) => id !== homeId);

  // 1. Remove every non-home descendant page.
  for (const pageId of nonHomeDescendantPageIds) {
    pagesPatches.push({ op: "remove", path: ["pages", pageId] });
  }

  // 2. Remove the target folder from its parent's children.
  const newParentChildren = plan.parentFolder.children.filter((c) => c !== folderId);
  pagesPatches.push({
    op: "replace",
    path: ["folders", plan.parentFolder.id, "children"],
    value: newParentChildren,
  });

  // 3. If home is inside and force=true: move it to the root folder children.
  if (plan.homeRelocated) {
    const rootFolder = folders.find((f) => f.id === plan.rootFolderId);
    if (!rootFolder) throw new Error(`Root folder "${plan.rootFolderId}" not found`);
    // Avoid duplicate ids if home is somehow already in root.
    const newRootChildren = rootFolder.children.includes(homeId)
      ? rootFolder.children
      : [...rootFolder.children, homeId];
    pagesPatches.push({
      op: "replace",
      path: ["folders", plan.rootFolderId, "children"],
      value: newRootChildren,
    });
  }

  // 4. Remove every descendant folder (including the target).
  for (const fid of plan.descendantFolderIds) {
    pagesPatches.push({ op: "remove", path: ["folders", fid] });
  }

  // 5. Cascade instances/props/styleSourceSelections for non-home descendant pages.
  const rootInstanceIds = nonHomeDescendantPageIds
    .map((id) => pageById.get(id)?.rootInstanceId)
    .filter((v): v is string => typeof v === "string");
  const instanceChanges = buildInstanceRemovalChanges(build, rootInstanceIds);

  return {
    id: `mcp-delete-folder-${txId()}`,
    payload: [
      { namespace: "pages", patches: pagesPatches },
      ...instanceChanges,
    ],
  };
}

export const deleteFolderTool: ToolModule = {
  definition: {
    name: "webstudio_delete_folder",
    description: `Use when: delete a page-folder (and optionally cascade its sub-folders + pages + their instance trees).
Do NOT use when: the folder is the ROOT folder (always refused, even with force=true). To delete pages without removing their folder, use webstudio_delete_pages (accepts 1 or N ids).
Returns: dry-run cascade summary (folders to remove, pages to remove, instances to remove, home-relocated flag) OR push result with finalVersion.
Refuses if the folder has children unless recursive=true. recursive=true cascades all sub-folders + pages (cleaning instances/props/styleSourceSelections). force=true relocates the home page to the ROOT folder when it would otherwise be deleted (only meaningful with recursive=true).
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default.

Example: { projectSlug: "acme", folderId: "fld_legacy", recursive: true, dryRun: true }
Example: { projectSlug: "my-site", folderId: "fld_old", recursive: true, force: true, dryRun: false }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        folderId: { type: "string" },
        recursive: { type: "boolean" },
        dryRun: { type: "boolean" },
        force: { type: "boolean" },
      },
      required: ["projectSlug", "folderId"],
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
    const parsed = deleteFolderInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const { projectSlug, folderId, recursive, dryRun, force } = parsed.data;

    let auth;
    try {
      auth = dryRun ? requireAuth(projectSlug) : requirePushAuth(projectSlug);
    } catch (err) {
      return authErrorResult(err);
    }

    let build;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    let plan: DeletePlan;
    let transaction: BuildPatchTransaction;
    try {
      plan = planDeleteFolder(build, folderId, recursive, force);
      transaction = buildDeleteFolderTransaction(build, folderId, recursive, force);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith("Folder ") && msg.includes("not found")) return errorResult("PAGE_NOT_FOUND", msg);
      if (msg.startsWith("Refusing to delete the ROOT folder")) return errorResult("ROOT_FOLDER_PROTECTED", msg);
      if (msg.includes("has no parent")) return errorResult("VALIDATION_FAILED", msg);
      if (msg.includes("child(ren); pass recursive=true")) return errorResult("VALIDATION_FAILED", msg);
      if (msg.includes("Home page is inside")) return errorResult("VALIDATION_FAILED", msg);
      if (msg.includes("Root folder could not be detected")) return errorResult("INTERNAL_ERROR", msg);
      return errorResult("INTERNAL_ERROR", msg);
    }

    const projectTitle = build.project?.title ?? "(?)";
    const nonHomePageCount = plan.descendantPageIds.filter((id) => id !== build.pages.homePageId).length;

    if (dryRun) {
      return textResult(`DRY-RUN delete_folder

Target:
  projectSlug: ${projectSlug}
  Real name: ${projectTitle}

Folder to delete:
  name: ${plan.targetFolder.name}
  folderId: ${folderId}
  parent: ${plan.parentFolder.name} (id=${plan.parentFolder.id})
  recursive: ${recursive}
  force: ${force}

Cascade summary:
  folders to remove: ${plan.descendantFolderIds.length} (incl. target)
  pages to remove: ${nonHomePageCount}
  instances to remove: ${plan.instanceCount}
  home page relocated to ROOT: ${plan.homeRelocated ? "yes" : "no"}

Current build version: ${build.version}

If OK, re-run with dryRun=false (and allowPush=true).`);
    }

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) =>
        buildDeleteFolderTransaction(cur, folderId, recursive, force),
      );
      return textResult(`Folder "${plan.targetFolder.name}" deleted from "${projectTitle}"
  folders removed: ${plan.descendantFolderIds.length}
  pages removed: ${nonHomePageCount}
  instances removed: ${plan.instanceCount}
  home relocated to ROOT: ${plan.homeRelocated ? "yes" : "no"}
  build version → ${finalVersion}
  status: ${result.status}`);
    } catch (err) {
      return runtimeErrorResult(err, "Push failed");
    }
  },
};
