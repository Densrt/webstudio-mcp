// Tool: webstudio_create_folder — create a new page folder under a parent.
//
// Atomic transaction: adds a new folder entity to `pages.folders` and appends
// its id to the parent's `children`. Validates parent existence and rejects
// sibling slug collisions (mirrors Webstudio UI behavior: a folder slug must
// be unique among its siblings, not globally).

import { z } from "zod";
import type { ToolModule } from "../types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "../types.js";
import { requireAuth, requirePushAuth } from "../../auth.js";
import { fetchBuild, pushWithRetry } from "../../webstudio-client.js";
import type { WebstudioBuild, BuildPatchTransaction, BuildPatchOperation } from "../../webstudio-client.js";
import { wsId, txId } from "./ids.js";

type Folder = { id: string; name: string; slug?: string; children: string[] };

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const createFolderInputSchema = z.object({
  projectSlug: z.string(),
  name: z.string().min(1).describe("Folder display name (e.g. 'Acme')"),
  slug: z.string().regex(
    SLUG_RE,
    "Slug must be kebab-case (lowercase alphanumerics separated by single dashes)",
  ).describe("Folder URL segment (kebab-case, e.g. 'acme', 'globex-modeles-2026')"),
  parentFolderId: z.string().default("root").describe("Parent folder ID (default: 'root')"),
  dryRun: z.boolean().default(true),
}).strict();

type CreateFolderInput = {
  name: string;
  slug: string;
  parentFolderId: string;
};

/**
 * Build the create-folder transaction. Throws Error with a coded message
 * prefix consumed by the handler (handler maps to errorResult codes).
 *
 * Exported pure for direct unit testing — see test/folders-create.test.mjs.
 */
export function buildCreateFolderTransaction(
  build: WebstudioBuild,
  input: CreateFolderInput,
  folderId: string,
): BuildPatchTransaction {
  const folders = build.pages.folders as Folder[];
  const parent = folders.find((f) => f.id === input.parentFolderId);
  if (!parent) throw new Error(`Folder "${input.parentFolderId}" not found`);

  // Webstudio UI rule: folder slug must be unique among siblings (not globally).
  const folderById = new Map(folders.map((f) => [f.id, f]));
  const siblingSlugs = parent.children
    .map((cid) => folderById.get(cid))
    .filter((f): f is Folder => f !== undefined)
    .map((f) => f.slug);
  if (siblingSlugs.includes(input.slug)) {
    throw new Error(
      `Slug "${input.slug}" is already used by a sibling folder under parent "${parent.name}"`,
    );
  }

  const newFolder: Folder = {
    id: folderId,
    name: input.name,
    slug: input.slug,
    children: [],
  };

  const pagesPatches: BuildPatchOperation[] = [
    { op: "add", path: ["folders", folderId], value: newFolder },
    {
      op: "replace",
      path: ["folders", input.parentFolderId, "children"],
      value: [...parent.children, folderId],
    },
  ];

  return {
    id: `mcp-create-folder-${txId()}`,
    payload: [{ namespace: "pages", patches: pagesPatches }],
  };
}

export const createFolderTool: ToolModule = {
  definition: {
    name: "webstudio_create_folder",
    description: `Use when: create a NEW page-folder in a Webstudio Cloud project to structure the navigator (e.g. one folder per brand on a multi-brand dealer site).
Do NOT use when: creating a page (use webstudio_create_page), or removing a folder (use webstudio_delete_folder). To browse existing folders and pick parentFolderId, call webstudio_list_folders first. Renaming/moving an existing folder is not supported — delete + re-create.
Returns: dry-run summary (folderId generated, parent, slug) OR push result with finalVersion.
slug must be kebab-case ('acme', 'globex-modeles-2026'). Sibling folders cannot share a slug — collision is rejected. parentFolderId defaults to "root".
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default.

Example: { projectSlug: "my-site", name: "Acme", slug: "acme" }
Example: { projectSlug: "my-site", name: "Globex", slug: "globex", parentFolderId: "fld_marques", dryRun: false }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        name: { type: "string" },
        slug: { type: "string" },
        parentFolderId: { type: "string" },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug", "name", "slug"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  handler: async (args) => {
    const parsed = createFolderInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const { projectSlug, dryRun, ...input } = parsed.data;

    let auth;
    try {
      auth = dryRun ? requireAuth(projectSlug) : requirePushAuth(projectSlug);
    } catch (err) {
      return authErrorResult(err);
    }

    const folderId = wsId();

    let build;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    let transaction: BuildPatchTransaction;
    try {
      transaction = buildCreateFolderTransaction(build, input, folderId);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith("Folder ") && msg.includes("not found")) return errorResult("PAGE_NOT_FOUND", msg);
      if (msg.includes("already used by a sibling folder")) return errorResult("VALIDATION_FAILED", msg);
      return errorResult("INTERNAL_ERROR", msg);
    }

    const projectTitle = build.project?.title ?? "(?)";
    const parent = (build.pages.folders as Folder[]).find((f) => f.id === input.parentFolderId)!;

    if (dryRun) {
      return textResult(`DRY-RUN create_folder

Target:
  projectSlug: ${projectSlug}
  Real name: ${projectTitle}

Folder to create:
  name: ${input.name}
  slug: ${input.slug}
  folderId (generated): ${folderId}
  parent: ${parent.name} (id=${input.parentFolderId})

Current build version: ${build.version}
Transaction: ${transaction.payload.length} namespace (pages)

If OK, re-run with dryRun=false (and allowPush=true).`);
    }

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) =>
        buildCreateFolderTransaction(cur, input, folderId),
      );
      return textResult(`Folder "${input.name}" created in "${projectTitle}"
  slug: ${input.slug}
  folderId: ${folderId}
  parent: ${parent.name} (id=${input.parentFolderId})
  build version → ${finalVersion}
  status: ${result.status}`);
    } catch (err) {
      return runtimeErrorResult(err, "Push failed");
    }
  },
};
