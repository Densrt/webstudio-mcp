// Tool: webstudio_create_page — create a new page (generates pageId + rootInstanceId).

import { z } from "zod";
import type { ToolModule } from "../types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "../types.js";
import { requireAuth, requirePushAuth } from "../../auth.js";
import { fetchBuild, pushWithRetry } from "../../webstudio-client.js";
import type { WebstudioBuild, BuildPatchTransaction, BuildPatchOperation } from "../../webstudio-client.js";
import { wsId, txId } from "./ids.js";
import { findPageInFolderByPath } from "./folder-utils.js";

export const createPageInputSchema = z.object({
  projectSlug: z.string(),
  name: z.string().describe("Page name (e.g. 'About')"),
  path: z.string().describe("URL path (e.g. '/about')"),
  title: z.string().default("Untitled").describe("Default HTML title"),
  parentFolderId: z.string().default("root").describe("Parent folder ID (default: 'root')"),
  meta: z.object({
    description: z.string().optional(),
    excludePageFromSearch: z.boolean().optional(),
    language: z.string().optional(),
    documentType: z.enum(["html", "xml"]).optional(),
  }).optional().describe("Optional meta (defaults: html / not excluded)"),
  dryRun: z.boolean().default(false),
}).strict();

type CreatePageInput = {
  name: string;
  path: string;
  title: string;
  parentFolderId: string;
  meta?: { description?: string; excludePageFromSearch?: boolean; language?: string; documentType?: "html" | "xml" };
};

export function buildCreatePageTransaction(
  build: WebstudioBuild,
  input: CreatePageInput,
  pageId: string,
  rootInstanceId: string,
): BuildPatchTransaction {
  const folder = (build.pages.folders as Array<{ id: string; name: string; children: string[] }>).find((f) => f.id === input.parentFolderId);
  if (!folder) throw new Error(`Folder "${input.parentFolderId}" not found`);
  const conflict = findPageInFolderByPath(build, input.path, input.parentFolderId);
  if (conflict) {
    throw new Error(
      `Path "${input.path}" is already used by page "${conflict.name}" (id=${conflict.id}) in folder "${folder.name}". Webstudio path uniqueness is folder-scoped (cumulative folder slugs + page.path resolve to the public URL) — pick a different path or a different parentFolderId.`,
    );
  }

  const expr = (v: unknown) => JSON.stringify(v);
  const meta = {
    description: expr(input.meta?.description ?? ""),
    excludePageFromSearch: expr(input.meta?.excludePageFromSearch ?? false),
    language: expr(input.meta?.language ?? ""),
    redirect: expr(""),
    socialImageUrl: expr(""),
    custom: [] as Array<{ property: string; content: string }>,
    documentType: input.meta?.documentType ?? "html",
  };

  const pagesPatches: BuildPatchOperation[] = [
    {
      op: "add",
      path: ["pages", pageId],
      value: {
        id: pageId,
        name: input.name,
        path: input.path,
        title: JSON.stringify(input.title),
        rootInstanceId,
        meta,
        marketplace: { include: false },
      },
    },
    {
      op: "replace",
      path: ["folders", input.parentFolderId, "children"],
      value: [...folder.children, pageId],
    },
  ];

  const instancesPatches: BuildPatchOperation[] = [
    {
      op: "add",
      path: [rootInstanceId],
      value: { type: "instance", id: rootInstanceId, component: "ws:element", tag: "body", children: [] },
    },
  ];

  return {
    id: `mcp-create-${txId()}`,
    payload: [
      { namespace: "pages", patches: pagesPatches },
      { namespace: "instances", patches: instancesPatches },
    ],
  };
}

export const createPageTool: ToolModule = {
  definition: {
    name: "webstudio_create_page",
    description: `Use when: create a NEW page in a Webstudio Cloud project (about, contact, dealer pages, etc.). Generates pageId + rootInstanceId (body) automatically.
Do NOT use when: you want to modify an existing page's name/path/title/meta — use webstudio_update_page. To duplicate content from another page onto the new page, create it here then call webstudio_clone_page_subtree. To remove a page, use webstudio_delete_pages (accepts 1 or N ids).
Returns: generated {pageId, rootInstanceId} — pass rootInstanceId to webstudio_push_fragment as parentInstanceId to populate the body.
Default meta injected (html, not excluded). parentFolderId defaults to "root" (get folder ids from webstudio_list_folders). path must be unique within its folder — Webstudio paths are folder-scoped (cumulative folder slugs + page.path resolves to the public URL), so /offres at root and /offres inside folder "globex" coexist as /offres and /globex/offres.
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=false by default for this tool — set dryRun=true to preview.

Example: { projectSlug: "acme", name: "Contact", path: "/contact", title: "Contact us", meta: { description: "Contact us" } }
Example: { projectSlug: "my-site", name: "About", path: "/about", parentFolderId: "fld_corporate" }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        name: { type: "string" },
        path: { type: "string" },
        title: { type: "string" },
        parentFolderId: { type: "string" },
        meta: {
          type: "object",
          properties: {
            description: { type: "string" },
            excludePageFromSearch: { type: "boolean" },
            language: { type: "string" },
            documentType: { type: "string", enum: ["html", "xml"] },
          },
        },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug", "name", "path"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  handler: async (args) => {
    const parsed = createPageInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const { projectSlug, dryRun, ...input } = parsed.data;

    let auth;
    try {
      auth = dryRun ? requireAuth(projectSlug) : requirePushAuth(projectSlug);
    } catch (err) {
      return authErrorResult(err);
    }

    const pageId = wsId();
    const rootInstanceId = wsId();

    let build;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    let transaction;
    try { transaction = buildCreatePageTransaction(build, input, pageId, rootInstanceId); }
    catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith("Folder ")) return errorResult("VALIDATION_FAILED", msg);
      if (msg.includes("already used by another page")) return errorResult("VALIDATION_FAILED", msg);
      return errorResult("INTERNAL_ERROR", msg);
    }

    const projectTitle = build.project?.title ?? "(?)";

    if (dryRun) {
      return textResult(`DRY-RUN create_page

Target:
  projectSlug: ${projectSlug}
  Real name: ${projectTitle}
  parentFolder: ${input.parentFolderId}

Page to create:
  name: ${input.name}
  path: ${input.path}
  title: ${input.title}
  pageId (generated): ${pageId}
  rootInstanceId (generated): ${rootInstanceId}

Current build version: ${build.version}
Transaction: ${transaction.payload.length} namespaces (pages + instances)

If OK, re-run with dryRun=false (and allowPush=true).`);
    }

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) =>
        buildCreatePageTransaction(cur, input, pageId, rootInstanceId),
      );
      return textResult(`Page "${input.name}" created in "${projectTitle}"
  path: ${input.path}
  pageId: ${pageId}
  rootInstanceId: ${rootInstanceId}
  build version → ${finalVersion}
  status: ${result.status}

To push content: webstudio_push_fragment with parentInstanceId="${rootInstanceId}"`);
    } catch (err) {
      return runtimeErrorResult(err, "Push failed");
    }
  },
};
