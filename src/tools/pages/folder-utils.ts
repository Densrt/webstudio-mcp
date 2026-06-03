// Pure folder/page navigation helpers shared by create / update / duplicate handlers.
//
// Webstudio data model recap:
//   - A page does NOT carry a parentFolderId field. Its parent folder is the
//     one whose `children` array includes the pageId.
//   - The public URL is the cumulative chain of folder.slug from root + page.path,
//     so two pages with the same `path` in two different folders resolve to two
//     different URLs and are perfectly valid.
//   - Path uniqueness is therefore scope-FOLDER, not scope-project.

import type { WebstudioBuild } from "../../webstudio-client.js";

type Folder = { id: string; name: string; slug?: string; children: string[] };
type Page = { id: string; name: string; path: string; rootInstanceId: string };

/**
 * Return the folder id whose `children` array contains `pageId`, or undefined
 * if the page is orphan (shouldn't happen in a healthy build).
 */
export function findFolderOfPage(build: WebstudioBuild, pageId: string): string | undefined {
  for (const f of build.pages.folders as Folder[]) {
    if (f.children.includes(pageId)) return f.id;
  }
  return undefined;
}

/**
 * Return the first page that lives directly in `parentFolderId` and has `path`,
 * or undefined. Used to enforce folder-scoped path uniqueness on create / move
 * / rename / duplicate.
 *
 * Only DIRECT children of `parentFolderId` are checked — pages nested under
 * sub-folders are NOT considered, because Webstudio resolves URLs as the
 * cumulative folder.slug chain + page.path, so a same path under a sub-folder
 * gives a different public URL and is a legitimate sibling-of-sibling case.
 */
export function findPageInFolderByPath(
  build: WebstudioBuild,
  path: string,
  parentFolderId: string,
): Page | undefined {
  const folder = (build.pages.folders as Folder[]).find((f) => f.id === parentFolderId);
  if (!folder) return undefined;
  const pageById = new Map((build.pages.pages as Page[]).map((p) => [p.id, p]));
  for (const childId of folder.children) {
    const page = pageById.get(childId);
    if (page && page.path === path) return page;
  }
  return undefined;
}
