// Tool: webstudio_list_folders — list page folders (indented tree) for a Webstudio Cloud project.

import { z } from "zod";
import type { ToolModule } from "../types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "../types.js";
import { requireAuth } from "../../auth.js";
import { fetchBuild } from "../../webstudio-client.js";
import type { WebstudioBuild } from "../../webstudio-client.js";

type Folder = { id: string; name: string; slug?: string; children: string[] };
type Page = { id: string; name: string; path: string; rootInstanceId: string };

export const listFoldersInputSchema = z.object({
  projectSlug: z.string(),
  includePages: z.boolean().default(true),
}).strict();

/**
 * Detect the root folder of build.pages.folders.
 * Primary: build.pages.rootFolderId. Fallback: any folder not present as a child of another folder.
 */
export function detectRootFolderId(build: WebstudioBuild): string | undefined {
  const folders = build.pages.folders as Folder[];
  const explicit = build.pages.rootFolderId;
  if (explicit && folders.some((f) => f.id === explicit)) return explicit;
  const childFolderIds = new Set<string>();
  const folderIds = new Set(folders.map((f) => f.id));
  for (const f of folders) {
    for (const c of f.children) {
      if (folderIds.has(c)) childFolderIds.add(c);
    }
  }
  const orphans = folders.filter((f) => !childFolderIds.has(f.id));
  if (orphans.length === 1) return orphans[0].id;
  // Heuristic fallback: id === "root" or name === "Root" or first.
  return orphans.find((f) => f.id === "root" || f.name === "Root")?.id ?? folders[0]?.id;
}

function renderTree(
  build: WebstudioBuild,
  rootId: string,
  includePages: boolean,
): string {
  const folders = build.pages.folders as Folder[];
  const pages = build.pages.pages as Page[];
  const homeId = build.pages.homePageId;
  const folderById = new Map(folders.map((f) => [f.id, f]));
  const pageById = new Map(pages.map((p) => [p.id, p]));

  const lines: string[] = [];

  const renderFolder = (folderId: string, depth: number, isRoot: boolean) => {
    const folder = folderById.get(folderId);
    if (!folder) {
      lines.push(`${"  ".repeat(depth)}📁 (missing folder id=${folderId})`);
      return;
    }
    const indent = "  ".repeat(depth);
    const slugTxt = folder.slug ? `, slug=${folder.slug}` : "";
    const rootMarker = isRoot ? " [ROOT]" : "";
    lines.push(
      `${indent}📁 ${folder.name} (id=${folder.id}${slugTxt}, ${folder.children.length} child${folder.children.length === 1 ? "" : "ren"})${rootMarker}`,
    );

    for (const childId of folder.children) {
      if (folderById.has(childId)) {
        renderFolder(childId, depth + 1, false);
      } else if (includePages && pageById.has(childId)) {
        const page = pageById.get(childId)!;
        const isHome = page.id === homeId;
        lines.push(
          `${"  ".repeat(depth + 1)}📄 ${page.name} [${page.path || "/"}] (id=${page.id})${isHome ? " [HOME]" : ""}`,
        );
      } else if (!folderById.has(childId)) {
        // Unknown child id (could be a page filtered out, or stale reference).
        if (!includePages && pageById.has(childId)) continue;
        lines.push(`${"  ".repeat(depth + 1)}⚠ (orphan child id=${childId})`);
      }
    }
  };

  renderFolder(rootId, 0, true);
  return lines.join("\n");
}

export const listFoldersTool: ToolModule = {
  definition: {
    name: "webstudio_list_folders",
    description: `Use when: browse the FOLDER hierarchy of a project (id, name, slug, children, [ROOT] marker) — typically before create_page (to pick parentFolderId) or delete_folder.
Do NOT use when: you only need the flat page list — use webstudio_fetch_pages (no folder nesting).
Returns: indented tree printed with folder + page icons; includePages=true (default) interleaves pages under their folder, includePages=false shows folders only.
Side effects: none (read-only).

Example: { projectSlug: "acme" }
Example: { projectSlug: "my-site", includePages: false }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        includePages: { type: "boolean" },
      },
      required: ["projectSlug"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  handler: async (args) => {
    const parsed = listFoldersInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const { projectSlug, includePages } = parsed.data;

    let auth;
    try { auth = requireAuth(projectSlug); }
    catch (err) { return authErrorResult(err); }

    let build;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    const folders = build.pages.folders as Folder[];
    const rootId = detectRootFolderId(build);
    if (!rootId) {
      return textResult(`Build "${projectSlug}" — version ${build.version} — no folders found.`);
    }

    const tree = renderTree(build, rootId, includePages);
    const projectTitle = build.project?.title ?? "(?)";

    return textResult(
      `Build "${projectSlug}" (${projectTitle}) — version ${build.version} — ${folders.length} folder(s):\n${tree}`,
    );
  },
};
