// Tool: webstudio_update_page — modify name/path/title/meta fields of an existing page.

import { z } from "zod";
import { customAlphabet } from "nanoid";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type { WebstudioBuild, BuildPatchTransaction, BuildPatchOperation } from "../webstudio-client.js";
import { findFolderOfPage, findPageInFolderByPath } from "./pages/folder-utils.js";

const txId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);

export const updatePageInputSchema = z.object({
  projectSlug: z.string(),
  pageId: z.string(),
  updates: z.object({
    name: z.string().optional(),
    path: z.string().optional(),
    title: z.string().optional(),
    /**
     * MOVE the page to a different folder. Atomic — combine with `path` for a
     * move+rename in one transaction. Path uniqueness is re-checked in the
     * target folder. Same value as current parent = no-op (no patches emitted).
     * Get folder ids from pages.list_folders.
     */
    parentFolderId: z.string().optional(),
    meta: z.object({
      description: z.string().optional(),
      excludePageFromSearch: z.boolean().optional(),
      language: z.string().optional(),
      redirect: z.string().optional(),
      socialImageUrl: z.string().optional(),
      /** Native social image: asset id (sha256). Webstudio renders an OG image from this asset (with miniature in dashboard + transform via Cloudflare). Recommended over socialImageUrl. */
      socialImageAssetId: z.string().optional(),
      documentType: z.enum(["html", "xml"]).optional(),
    }).optional(),
  }),
  dryRun: z.boolean().default(false),
}).strict();

type UpdateInput = z.infer<typeof updatePageInputSchema>["updates"];

// Webstudio stores these as string-encoded JS expressions:
//   title, meta.description, meta.excludePageFromSearch, meta.language,
//   meta.redirect, meta.socialImageUrl
// Literals (no encoding): name, path, meta.documentType, meta.socialImageAssetId
function metaPatchValue(field: string, value: unknown): unknown {
  if (field === "documentType" || field === "socialImageAssetId") return value;
  return JSON.stringify(value);
}

function buildUpdatePatches(pageId: string, updates: UpdateInput): BuildPatchOperation[] {
  const patches: BuildPatchOperation[] = [];

  if (updates.name !== undefined) {
    patches.push({ op: "replace", path: ["pages", pageId, "name"], value: updates.name });
  }
  if (updates.path !== undefined) {
    patches.push({ op: "replace", path: ["pages", pageId, "path"], value: updates.path });
  }
  if (updates.title !== undefined) {
    // title is a JS expression (can be bound to a variable) → JSON-stringify.
    patches.push({ op: "replace", path: ["pages", pageId, "title"], value: JSON.stringify(updates.title) });
  }

  if (updates.meta) {
    for (const [field, value] of Object.entries(updates.meta)) {
      if (value === undefined) continue;
      patches.push({
        op: "replace",
        path: ["pages", pageId, "meta", field],
        value: metaPatchValue(field, value),
      });
    }
    // Mutual cleanup: setting one social image field removes the other (they are conflicting).
    if (updates.meta.socialImageAssetId !== undefined && updates.meta.socialImageUrl === undefined) {
      patches.push({ op: "remove", path: ["pages", pageId, "meta", "socialImageUrl"] });
    }
    if (updates.meta.socialImageUrl !== undefined && updates.meta.socialImageAssetId === undefined) {
      patches.push({ op: "remove", path: ["pages", pageId, "meta", "socialImageAssetId"] });
    }
  }

  return patches;
}

/**
 * Build the move patches (remove pageId from source folder.children, append to
 * target folder.children). Returns [] if source === target (no-op move).
 *
 * Throws if either folder is missing from the build.
 */
function buildMovePatches(
  build: WebstudioBuild,
  pageId: string,
  sourceFolderId: string,
  targetFolderId: string,
): BuildPatchOperation[] {
  if (sourceFolderId === targetFolderId) return [];

  type Folder = { id: string; name: string; children: string[] };
  const folders = build.pages.folders as Folder[];
  const source = folders.find((f) => f.id === sourceFolderId);
  const target = folders.find((f) => f.id === targetFolderId);
  if (!source) throw new Error(`Folder "${sourceFolderId}" not found`);
  if (!target) throw new Error(`Folder "${targetFolderId}" not found`);

  return [
    {
      op: "replace",
      path: ["folders", sourceFolderId, "children"],
      value: source.children.filter((c) => c !== pageId),
    },
    {
      op: "replace",
      path: ["folders", targetFolderId, "children"],
      value: target.children.includes(pageId) ? target.children : [...target.children, pageId],
    },
  ];
}

export function buildUpdatePageTransaction(build: WebstudioBuild, pageId: string, updates: UpdateInput): BuildPatchTransaction {
  const page = build.pages.pages.find((p) => p.id === pageId);
  if (!page) throw new Error(`Page "${pageId}" not found`);

  // Resolve current parent folder + effective target folder (defaults to current).
  const currentFolderId = findFolderOfPage(build, pageId) ?? "root";
  const targetFolderId = updates.parentFolderId ?? currentFolderId;

  // Determine the path that will be live AFTER the update (used for the
  // uniqueness check below). If the caller doesn't change the path, the live
  // path stays the same.
  const livePath = updates.path ?? page.path;
  const pathChanged = updates.path !== undefined && updates.path !== page.path;
  const folderChanged = targetFolderId !== currentFolderId;

  // Path uniqueness is folder-scoped: check among the TARGET folder's siblings,
  // excluding the page itself (move within the same folder + same path = no-op
  // and must not trip the conflict). Only validate when path or folder change —
  // otherwise the page sits exactly where it was, no possible new conflict.
  if (pathChanged || folderChanged) {
    const conflict = findPageInFolderByPath(build, livePath, targetFolderId);
    if (conflict && conflict.id !== pageId) {
      const targetFolder = (build.pages.folders as Array<{ id: string; name: string }>)
        .find((f) => f.id === targetFolderId);
      const targetName = targetFolder?.name ?? targetFolderId;
      throw new Error(
        `Path "${livePath}" is already used by page "${conflict.name}" (id=${conflict.id}) in folder "${targetName}". Webstudio path uniqueness is folder-scoped — pick a different path or a different parentFolderId.`,
      );
    }
  }

  const pagesPatches = buildUpdatePatches(pageId, updates);
  const movePatches = folderChanged ? buildMovePatches(build, pageId, currentFolderId, targetFolderId) : [];

  if (pagesPatches.length === 0 && movePatches.length === 0) {
    throw new Error(`No fields to update`);
  }

  return {
    id: `mcp-update-${txId()}`,
    payload: [{ namespace: "pages", patches: [...pagesPatches, ...movePatches] }],
  };
}

function summarize(updates: UpdateInput): string {
  const lines: string[] = [];
  if (updates.name !== undefined) lines.push(`  name → "${updates.name}"`);
  if (updates.path !== undefined) lines.push(`  path → "${updates.path}"`);
  if (updates.title !== undefined) lines.push(`  title → "${updates.title}"`);
  if (updates.parentFolderId !== undefined) lines.push(`  parentFolderId → "${updates.parentFolderId}" (MOVE)`);
  if (updates.meta) {
    for (const [k, v] of Object.entries(updates.meta)) {
      if (v !== undefined) lines.push(`  meta.${k} → ${JSON.stringify(v)}`);
    }
  }
  return lines.join("\n");
}

export const updatePageTool: ToolModule = {
  definition: {
    name: "webstudio_update_page",
    description: `Use when: modify an EXISTING page's name, path, title, meta (description, language, OG image, redirect, documentType), or MOVE it to a different folder (via updates.parentFolderId — combine with updates.path for an atomic move+rename).
Do NOT use when: you want to bind the title or a meta field to a dynamic expression — use webstudio_bind_page_field (this tool only sets literal strings, auto-encoded). To create a new page, use webstudio_create_page. To delete a page, use webstudio_delete_pages.
Returns: dry-run with per-field summary (key → JSON value) + patch count OR push result with version. Only the provided fields are replaced; omitted fields untouched. path uniqueness is folder-scoped (validated against the TARGET folder when moving, against the current folder otherwise — Webstudio resolves URLs as cumulative folder slugs + page.path, so /offres at root and /offres in folder "globex" coexist as /offres and /globex/offres).
Title and most meta fields (description, excludePageFromSearch, language, redirect, socialImageUrl) are auto-JSON-encoded since Webstudio stores them as JS expressions. socialImageAssetId (native OG image, RECOMMENDED — generates a miniature in dashboard + Cloudflare transform) is mutually exclusive with socialImageUrl: setting one removes the other.
Move emits 2 atomic patches (remove pageId from source folder.children + append to target folder.children). Same parentFolderId as current = no-op.
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=false by default for this tool — pass dryRun=true to preview.

Example: { projectSlug: "acme", pageId: "pg1", updates: { title: "Home", meta: { description: "Welcome", language: "en" } } }
Example: { projectSlug: "my-site", pageId: "pg2", updates: { path: "/about-us", meta: { socialImageAssetId: "sha256_hex..." } } }
Example move: { projectSlug: "my-site", pageId: "pg3", updates: { parentFolderId: "fld_globex", path: "/offres" } }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        pageId: { type: "string" },
        updates: {
          type: "object",
          properties: {
            name: { type: "string" },
            path: { type: "string" },
            title: { type: "string" },
            parentFolderId: { type: "string", description: "MOVE the page to a different folder (atomic — combine with `path` for a move+rename in one transaction). Same value as current parent = no-op." },
            meta: {
              type: "object",
              properties: {
                description: { type: "string" },
                excludePageFromSearch: { type: "boolean" },
                language: { type: "string" },
                redirect: { type: "string" },
                socialImageUrl: { type: "string" },
                socialImageAssetId: { type: "string", description: "Asset sha256 — native OG image (recommended over socialImageUrl). Mutually exclusive with socialImageUrl." },
                documentType: { type: "string", enum: ["html", "xml"] },
              },
            },
          },
        },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug", "pageId", "updates"],
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
    const parsed = updatePageInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const { projectSlug, pageId, updates, dryRun } = parsed.data;

    let auth;
    try {
      auth = dryRun ? requireAuth(projectSlug) : requirePushAuth(projectSlug);
    } catch (err) {
      return authErrorResult(err);
    }

    let build;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    let transaction;
    try { transaction = buildUpdatePageTransaction(build, pageId, updates); }
    catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith("Page ") && msg.includes("not found")) return errorResult("PAGE_NOT_FOUND", msg);
      if (msg.startsWith("Folder ") && msg.includes("not found")) return errorResult("PAGE_NOT_FOUND", msg);
      if (msg.startsWith("Path ") && msg.includes("already used")) return errorResult("VALIDATION_FAILED", msg);
      if (msg === "No fields to update") return errorResult("VALIDATION_FAILED", msg);
      return errorResult("INTERNAL_ERROR", msg);
    }

    const page = build.pages.pages.find((p) => p.id === pageId)!;
    const projectTitle = build.project?.title ?? "(?)";
    const patchCount = transaction.payload[0].patches.length;

    if (dryRun) {
      return textResult(`DRY-RUN update_page

Target:
  projectSlug: ${projectSlug}
  Real name: ${projectTitle}
  current page: "${page.name}" (${page.path})

Updates:
${summarize(updates)}

${patchCount} patch(es) on namespace "pages" — build version ${build.version}

If OK, re-run with dryRun=false (and allowPush=true).`);
    }

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) => buildUpdatePageTransaction(cur, pageId, updates));
      return textResult(`Page updated in "${projectTitle}"
  pageId: ${pageId}
  ${patchCount} patch(es) applied — build version → ${finalVersion}
  status: ${result.status}

Updates:
${summarize(updates)}`);
    } catch (err) {
      return runtimeErrorResult(err, "Push failed");
    }
  },
};
