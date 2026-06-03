// Tool: webstudio_clone_page_subtree — DEPRECATED.
//
// As of v2.9.0, this tool is a thin wrapper around webstudio_clone_subtree
// (which now accepts targetAnchor / targetAnchors directly). Kept for
// back-compat — new callers should use clone_subtree with targetAnchor(s)
// and mode: "append" | "prepend" | "replace".
//
// What this wrapper does:
//   1. Fetch build, resolve the source page + anchor (legacy semantics).
//   2. Build targetAnchors[] from targetPagePaths/Ids + anchorLabel/anchorTag.
//   3. Delegate to cloneSubtreeTool.handler() with mode: "replace" (hardcoded
//      to preserve the historical behaviour of clone_page — replace target's
//      anchor children).
//   4. Fire detect:clone-page-deprecated-usage telemetry once per call.

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild } from "../webstudio-client.js";
import { logCoerce } from "../lib/telemetry.js";
import { cloneSubtreeTool, resolvePage, findAnchor } from "./clone-subtree.js";

export const clonePageSubtreeInputSchema = z
  .object({
    projectSlug: z.string(),
    sourcePagePath: z.string().optional(),
    sourcePageId: z.string().optional(),
    targetPagePaths: z.array(z.string()).default([]),
    targetPageIds: z.array(z.string()).default([]),
    anchorLabel: z.string().default("main"),
    anchorTag: z.string().optional(),
    skipChildLabels: z.array(z.string()).optional(),
    dryRun: z.boolean().default(true),
  })
  .strict();

export const clonePageSubtreeTool: ToolModule = {
  definition: {
    name: "webstudio_clone_page_subtree",
    description: `DEPRECATED (v2.9.0) — alias of webstudio_clone_subtree with targetAnchors[] and mode:"replace".

Use webstudio_clone_subtree directly with:
  - targetAnchor: { pagePath, label, tag? } for a single target page
  - targetAnchors: [{ pagePath, label, tag? }, ...] for multi-target batch
  - mode: "append" | "prepend" | "replace" (clone_page was hardcoded "replace")

This wrapper preserves the historical semantics — anchor by label on each target page, replace mode, per-target outcome report — and will continue to work, but new code should call clone_subtree directly.

Example (unchanged): { projectSlug: "p", sourcePagePath: "/templates/concession", targetPagePaths: ["/concession-1"], anchorLabel: "main" }
Equivalent in clone_subtree: { projectSlug: "p", sourceInstanceId: "<resolved>", targetAnchors: [{ pagePath: "/concession-1", label: "main" }], mode: "replace" }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        sourcePagePath: { type: "string" },
        sourcePageId: { type: "string" },
        targetPagePaths: { type: "array", items: { type: "string" } },
        targetPageIds: { type: "array", items: { type: "string" } },
        anchorLabel: { type: "string" },
        anchorTag: { type: "string" },
        skipChildLabels: { type: "array", items: { type: "string" } },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug"],
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
    const parsed = clonePageSubtreeInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const data = parsed.data;

    if (!data.sourcePagePath && !data.sourcePageId) {
      return errorResult("VALIDATION_FAILED", "Provide sourcePagePath or sourcePageId.");
    }
    if (data.targetPagePaths.length === 0 && data.targetPageIds.length === 0) {
      return errorResult("VALIDATION_FAILED", "Provide at least one targetPagePaths or targetPageIds entry.");
    }

    void logCoerce("detect:clone-page-deprecated-usage", {
      source: "clone_page_subtree.wrapper",
      projectSlug: data.projectSlug,
      targetCount: data.targetPagePaths.length + data.targetPageIds.length,
    });

    let auth;
    try {
      auth = data.dryRun ? requireAuth(data.projectSlug) : requirePushAuth(data.projectSlug);
    } catch (err) {
      return authErrorResult(err);
    }

    // Resolve source page + anchor → sourceInstanceId (the legacy "anchor children" model).
    let build;
    try {
      build = await fetchBuild(auth);
    } catch (err) {
      return runtimeErrorResult(err, "fetch build failed");
    }
    const sourcePage = resolvePage(build, data.sourcePagePath, data.sourcePageId);
    if (!sourcePage) {
      return errorResult(
        "PAGE_NOT_FOUND",
        `Source page not found: ${data.sourcePagePath ?? data.sourcePageId}`,
      );
    }
    const sourceAnchor = findAnchor(build, sourcePage, data.anchorLabel, data.anchorTag);
    if (!sourceAnchor) {
      return errorResult(
        "INSTANCE_NOT_FOUND",
        `Source anchor not found in "${sourcePage.path}" (label="${data.anchorLabel}"${data.anchorTag ? `, tag="${data.anchorTag}"` : ""}).`,
      );
    }

    // Build targetAnchors[] from the legacy params (paths first, then ids).
    const targetAnchors: Array<{ pagePath?: string; pageId?: string; label: string; tag?: string }> = [];
    for (const p of data.targetPagePaths) {
      targetAnchors.push({ pagePath: p, label: data.anchorLabel, tag: data.anchorTag });
    }
    for (const id of data.targetPageIds) {
      targetAnchors.push({ pageId: id, label: data.anchorLabel, tag: data.anchorTag });
    }

    // Delegate to clone_subtree with mode "replace" + includeSource:false (legacy behaviour:
    // clone the CHILDREN of the source anchor, not the anchor itself — preserves the original
    // clone_page semantics for the multi-page template-regeneration workflow).
    return cloneSubtreeTool.handler({
      projectSlug: data.projectSlug,
      sourceInstanceId: sourceAnchor,
      includeSource: false,
      targetAnchors,
      mode: "replace",
      skipChildLabels: data.skipChildLabels,
      dryRun: data.dryRun,
    });
  },
};
