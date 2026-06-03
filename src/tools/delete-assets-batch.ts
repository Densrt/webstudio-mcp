// Tool: webstudio_delete_assets — batch deletion of assets with continue-on-error.
//
// Difference vs. webstudio_delete_asset: takes an array of asset ids OR sha256 prefixes, builds ONE
// consolidated transaction with all valid removals, and pushes it once. Each input is resolved
// independently via resolveAssetByIdOrPrefix — failures (not found, ambiguous prefix, prefix too
// short) are reported in the "failed" list without aborting the rest. No reference scan is performed
// at the batch level; use webstudio_delete_asset (single) for the safety-checked path.

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type {
  WebstudioBuild,
  BuildPatchTransaction,
  BuildPatchChange,
  BuildPatchOperation,
} from "../webstudio-client.js";
import { resolveAssetByIdOrPrefix, ASSET_PREFIX_MIN } from "./asset-helpers.js";
import { findUsages } from "../lib/asset-helpers.js";
import { txId } from "./pages/ids.js";

export const deleteAssetsBatchInputSchema = z.object({
  projectSlug: z.string(),
  assetIdsOrPrefixes: z.array(z.string()).min(1),
  /** Bypass the usage-count safety check. With force=false (default) any asset with
   *  references in props/styles/meta is moved to "failed" with reason "still
   *  referenced (N usages)". Bug 2026-05-20: previous code skipped this check
   *  entirely → 14 actively-used font assets deleted because the audit-fonts
   *  detector had a separate naming-normalization bug → broken typo on the site. */
  force: z.boolean().default(false),
  dryRun: z.boolean().default(true),
}).strict();

type Succeeded = { input: string; id: string; name: string; size: number; usages?: number };
type Failed = { input: string; reason: string };

type Plan = {
  changes: BuildPatchChange[];
  succeeded: Succeeded[];
  failed: Failed[];
};

/**
 * Build a consolidated transaction's changes from a list of asset targets.
 * Each input is resolved via prefix/exact match — only clean hits contribute patches.
 */
function planDeleteAssets(build: WebstudioBuild, inputs: string[], force: boolean): Plan {
  const succeeded: Succeeded[] = [];
  const failed: Failed[] = [];
  const removePatches: BuildPatchOperation[] = [];

  const seenIds = new Set<string>();
  const seenInputs = new Set<string>();

  for (const input of inputs) {
    if (seenInputs.has(input)) {
      failed.push({ input, reason: "duplicate in batch (skipped)" });
      continue;
    }
    seenInputs.add(input);

    const resolved = resolveAssetByIdOrPrefix(build, input);
    if (resolved.kind === "prefix_too_short") {
      failed.push({
        input,
        reason: `prefix must be >= ${ASSET_PREFIX_MIN} chars (got ${input.length})`,
      });
      continue;
    }
    if (resolved.kind === "not_found") {
      failed.push({ input, reason: "not found" });
      continue;
    }
    if (resolved.kind === "ambiguous") {
      const ids = resolved.matches.map((a) => a.id).join(", ");
      failed.push({ input, reason: `ambiguous prefix (matches: ${ids})` });
      continue;
    }

    const asset = resolved.asset;
    if (seenIds.has(asset.id)) {
      failed.push({ input, reason: `duplicate target ${asset.id} (already in batch)` });
      continue;
    }

    // Safety: refuse to delete an asset that still has references unless force=true.
    // Without this, a wrong audit (e.g. fonts naming bug) can silently break the site
    // when its result feeds this batch.
    const usages = findUsages(build, asset.id);
    if (usages.length > 0 && !force) {
      failed.push({ input, reason: `still referenced (${usages.length} usage(s)) — pass force=true to override` });
      continue;
    }

    seenIds.add(asset.id);
    removePatches.push({ op: "remove", path: [asset.id] });
    succeeded.push({
      input,
      id: asset.id,
      name: asset.name,
      size: asset.size,
      usages: usages.length,
    });
  }

  const changes: BuildPatchChange[] = [];
  if (removePatches.length > 0) {
    changes.push({ namespace: "assets", patches: removePatches });
  }

  return { changes, succeeded, failed };
}

function buildTransaction(changes: BuildPatchChange[]): BuildPatchTransaction {
  return {
    id: `mcp-delete-assets-${txId()}`,
    payload: changes,
  };
}

function renderReport(succeeded: Succeeded[], failed: Failed[]): string {
  const lines: string[] = [];
  lines.push(`✅ Succeeded (${succeeded.length})`);
  for (const s of succeeded) {
    const refTag = s.usages && s.usages > 0 ? ` ⚠ ${s.usages} ref(s) broken` : "";
    lines.push(`  ✓ ${s.name} (id=${s.id}, ${s.size} bytes)  input="${s.input}"${refTag}`);
  }
  lines.push(`\n❌ Failed (${failed.length})`);
  for (const f of failed) {
    lines.push(`  ✗ "${f.input}" — ${f.reason}`);
  }
  return lines.join("\n");
}

export const deleteAssetsBatchTool: ToolModule = {
  definition: {
    name: "webstudio_delete_assets",
    description: `Use when: BATCH-remove several assets from the project's asset list in one consolidated transaction (one push, continue-on-error).
Do NOT use when: a single asset still has live references — call webstudio_find_asset_usage first (this batch SKIPS the usage-safety check for speed; pass [singleId] if you need single delete). To swap an asset for a new version, use webstudio_replace_asset (no deletion). For a usage inventory, use webstudio_list_assets.
Returns: succeeded list ({input, id, name, size}) + failed list ({input, reason: "not found"|"ambiguous prefix"|"prefix too short"|"duplicate"}). Each input accepts a full sha256 OR a unique prefix (>= 8 chars).
NOTE: only removes the build-level reference; the binary stays in Cloudflare storage until Webstudio's GC runs.
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default.

Example: { projectSlug: "acme", assetIdsOrPrefixes: ["abc12345", "def67890abcde", "fullsha256hex..."], dryRun: true }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        assetIdsOrPrefixes: {
          type: "array",
          items: { type: "string" },
          description: "List of asset ids or sha256 prefixes (>= 8 chars).",
        },
        force: { type: "boolean", description: "Bypass usage-count safety check (will break references)." },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug", "assetIdsOrPrefixes"],
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
    const parsed = deleteAssetsBatchInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const { projectSlug, assetIdsOrPrefixes, force, dryRun } = parsed.data;

    let auth;
    try {
      auth = dryRun ? requireAuth(projectSlug) : requirePushAuth(projectSlug);
    } catch (err) {
      return authErrorResult(err);
    }

    let build;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    const plan = planDeleteAssets(build, assetIdsOrPrefixes, force);

    if (plan.succeeded.length === 0) {
      return textResult(
        `DRY-RUN delete_assets — nothing to delete.\n\n${renderReport(plan.succeeded, plan.failed)}`,
      );
    }

    if (dryRun) {
      return textResult(
        `DRY-RUN delete_assets (${plan.succeeded.length} asset(s) will be deleted)\n\n${renderReport(plan.succeeded, plan.failed)}\n\nIf OK, re-run with dryRun=false.`,
      );
    }

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) => {
        const fresh = planDeleteAssets(cur, assetIdsOrPrefixes, force);
        return buildTransaction(fresh.changes);
      });
      return textResult(
        `Batch delete_assets — version → ${finalVersion}  status: ${result.status}\n\n${renderReport(plan.succeeded, plan.failed)}`,
      );
    } catch (err) {
      return runtimeErrorResult(err, "Push failed");
    }
  },
};
