// Tool: webstudio_delete_page — delete a non-home page + its subtree.

import { z } from "zod";
import type { ToolModule } from "../types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "../types.js";
import { requireAuth, requirePushAuth } from "../../auth.js";
import { fetchBuild, pushWithRetry } from "../../webstudio-client.js";
import type { WebstudioBuild, BuildPatchTransaction } from "../../webstudio-client.js";
import { buildInstanceRemovalChanges } from "../../cleanup-helpers.js";
import { txId } from "./ids.js";

const DeletePageSchema = z.object({
  projectSlug: z.string(),
  pageId: z.string(),
  dryRun: z.boolean().default(false),
}).strict();

function buildDeletePageTransaction(build: WebstudioBuild, pageId: string): BuildPatchTransaction {
  const page = build.pages.pages.find((p) => p.id === pageId);
  if (!page) throw new Error(`Page "${pageId}" not found`);
  if (pageId === build.pages.homePageId) throw new Error(`Refusing to delete the home page`);

  const folders = build.pages.folders as Array<{ id: string; children: string[] }>;
  const folder = folders.find((f) => f.children.includes(pageId));
  if (!folder) throw new Error(`Page "${pageId}" not found in any folder`);

  // Full cleanup: instances + props + styleSourceSelections (via shared helper).
  const instanceChanges = buildInstanceRemovalChanges(build, [page.rootInstanceId]);

  return {
    id: `mcp-delete-${txId()}`,
    payload: [
      {
        namespace: "pages",
        patches: [
          { op: "remove", path: ["pages", pageId] },
          {
            op: "replace",
            path: ["folders", folder.id, "children"],
            value: folder.children.filter((c) => c !== pageId),
          },
        ],
      },
      ...instanceChanges,
    ],
  };
}

export const deletePageTool: ToolModule = {
  definition: {
    name: "webstudio_delete_page",
    description: `Use when: you need to delete a non-home page from a Webstudio Cloud project.
Auto tree-walker removes instances + props + styleSourceSelections. Refuses to delete the home page.
dryRun=false by default; requires allowPush=true.`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        pageId: { type: "string" },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug", "pageId"],
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
    const parsed = DeletePageSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const { projectSlug, pageId, dryRun } = parsed.data;

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
    try { transaction = buildDeletePageTransaction(build, pageId); }
    catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith("Page ") && msg.includes("not found")) return errorResult("PAGE_NOT_FOUND", msg);
      if (msg.startsWith("Refusing to delete the home page")) return errorResult("VALIDATION_FAILED", msg);
      return errorResult("INTERNAL_ERROR", msg);
    }

    const page = build.pages.pages.find((p) => p.id === pageId)!;
    const projectTitle = build.project?.title ?? "(?)";
    const instCount = transaction.payload.find((c) => c.namespace === "instances")?.patches.length ?? 0;

    if (dryRun) {
      return textResult(`DRY-RUN delete_page

Target:
  projectSlug: ${projectSlug}
  Real name: ${projectTitle}

Page to delete:
  name: ${page.name}
  path: ${page.path}
  pageId: ${pageId}
  rootInstanceId: ${page.rootInstanceId}

Instances to remove: ${instCount} (root + descendants)

If OK, re-run with dryRun=false (and allowPush=true).`);
    }

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) => buildDeletePageTransaction(cur, pageId));
      return textResult(`Page "${page.name}" deleted from "${projectTitle}"
  ${instCount} instance(s) removed — build version → ${finalVersion}
  status: ${result.status}`);
    } catch (err) {
      return runtimeErrorResult(err, "Push failed");
    }
  },
};
