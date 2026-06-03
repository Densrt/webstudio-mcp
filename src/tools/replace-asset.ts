// Tool: webstudio_replace_asset — swap one asset reference for another across the whole project.

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type { WebstudioBuild, BuildPatchTransaction, BuildPatchOperation } from "../webstudio-client.js";
import { findAssetById, findUsages, rewriteAssetInStyleValue } from "../lib/asset-helpers.js";
import { customAlphabet } from "nanoid";

const txId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);

export const replaceAssetInputSchema = z.object({
  projectSlug: z.string(),
  fromAssetId: z.string(),
  toAssetId: z.string(),
  dryRun: z.boolean().default(true),
}).strict();

function styleKey(s: { styleSourceId: string; breakpointId: string; property: string; state?: string }): string {
  return `${s.styleSourceId}:${s.breakpointId}:${s.property}:${s.state ?? ""}`;
}

function buildReplaceTransaction(
  build: WebstudioBuild,
  fromId: string,
  toId: string,
): { transaction: BuildPatchTransaction; props: number; styles: number; pages: number; details: string[] } {
  const propPatches: BuildPatchOperation[] = [];
  const stylePatches: BuildPatchOperation[] = [];
  const pagePatches: BuildPatchOperation[] = [];
  const details: string[] = [];

  // Props of type="asset" with value=fromId
  for (const p of build.props as Array<{ id: string; instanceId: string; name: string; type: string; value: unknown }>) {
    if (p.type === "asset" && p.value === fromId) {
      const newProp = { ...p, value: toId };
      propPatches.push({ op: "replace", path: [p.id], value: newProp });
      const inst = build.instances.find((i) => i.id === p.instanceId);
      details.push(`prop ${p.instanceId} (${inst?.label ?? inst?.component}): ${p.name}`);
    }
  }

  // Styles with image asset references
  for (const s of build.styles as Array<{
    styleSourceId: string;
    breakpointId: string;
    property: string;
    state?: string;
    value: unknown;
    [k: string]: unknown;
  }>) {
    const { value: newValue, swaps } = rewriteAssetInStyleValue(s.value, fromId, toId);
    if (swaps > 0) {
      stylePatches.push({ op: "replace", path: [styleKey(s)], value: { ...s, value: newValue } });
      details.push(`style ${s.styleSourceId}.${s.property} (${swaps} layer${swaps > 1 ? "s" : ""})`);
    }
  }

  // Page meta socialImageAssetId references
  for (const p of build.pages.pages) {
    const meta = (p.meta ?? {}) as Record<string, unknown>;
    if (meta.socialImageAssetId === fromId) {
      pagePatches.push({
        op: "replace",
        path: ["pages", p.id, "meta", "socialImageAssetId"],
        value: toId,
      });
      details.push(`page ${p.id} (${p.name || p.path}): meta.socialImageAssetId`);
    }
  }

  const payload = [];
  if (propPatches.length > 0) payload.push({ namespace: "props" as const, patches: propPatches });
  if (stylePatches.length > 0) payload.push({ namespace: "styles" as const, patches: stylePatches });
  if (pagePatches.length > 0) payload.push({ namespace: "pages" as const, patches: pagePatches });

  return {
    transaction: {
      id: `mcp-replace-asset-${txId()}`,
      payload,
    },
    props: propPatches.length,
    styles: stylePatches.length,
    pages: pagePatches.length,
    details,
  };
}

export const replaceAssetTool: ToolModule = {
  definition: {
    name: "webstudio_replace_asset",
    description: `Use when: a visual has a NEW version and you need to swap its asset id everywhere project-wide (instance props + style values + page meta).
Do NOT use when: the new version isn't uploaded yet — call webstudio_upload_asset first to get its toAssetId. To delete the old asset after the swap, use webstudio_delete_assets (do this AFTER replace, not before). To preview what references exist before swapping, use webstudio_find_asset_usage.
Returns: dry-run summary listing every ref (prop / style / page meta with breakpoint, state, layer index) + counts per kind, OR push result with version + total swapped. Refuses if fromAssetId === toAssetId or if either id is missing from the project's asset list.
Rewrites all refs in: instance props (type="asset"), style values (backgroundImage layers, etc.), page meta (socialImageAssetId).
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default.

Example: { projectSlug: "acme", fromAssetId: "oldsha256...", toAssetId: "newsha256...", dryRun: true }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        fromAssetId: { type: "string", description: "sha256 of the asset to replace" },
        toAssetId: { type: "string", description: "sha256 of the new asset" },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug", "fromAssetId", "toAssetId"],
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
    const parsed = replaceAssetInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const input = parsed.data;

    let auth;
    try { auth = input.dryRun ? requireAuth(input.projectSlug) : requirePushAuth(input.projectSlug); }
    catch (err) { return authErrorResult(err); }

    let build;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    const from = findAssetById(build, input.fromAssetId);
    const to = findAssetById(build, input.toAssetId);
    if (!from) return errorResult("ASSET_NOT_FOUND", `fromAssetId "${input.fromAssetId}" not found in project assets.`);
    if (!to) return errorResult("ASSET_NOT_FOUND", `toAssetId "${input.toAssetId}" not found in project assets.`);
    if (from.id === to.id) return errorResult("VALIDATION_FAILED", `fromAssetId === toAssetId — nothing to do.`);

    const usagesBefore = findUsages(build, input.fromAssetId);
    if (usagesBefore.length === 0) {
      return textResult(`Asset "${from.name}" has 0 usages — nothing to replace.`);
    }

    const tx = buildReplaceTransaction(build, input.fromAssetId, input.toAssetId);
    const total = tx.props + tx.styles + tx.pages;

    if (input.dryRun) {
      return textResult(
        `DRY-RUN replace_asset\n\nFrom: ${from.name}\nTo:   ${to.name}\n\n${total} reference(s) to update (${tx.props} prop + ${tx.styles} style + ${tx.pages} page meta):\n${tx.details.join("\n")}\n\nIf OK, re-run with dryRun=false.`,
      );
    }

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) =>
        buildReplaceTransaction(cur, input.fromAssetId, input.toAssetId).transaction,
      );
      return textResult(
        `Asset replaced — version → ${finalVersion}\nstatus: ${result.status}\n\nFrom: ${from.name}\nTo:   ${to.name}\nUpdated: ${tx.props} prop + ${tx.styles} style + ${tx.pages} page meta = ${total} reference(s)`,
      );
    } catch (err) {
      return runtimeErrorResult(err, "Push failed");
    }
  },
};
