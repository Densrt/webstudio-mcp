// Tool: webstudio_delete_resource — safely delete a Webstudio HTTP SSR resource
// AND its linked dataSource (type="resource"), after scanning the build for any
// reference. Refuses if referenced unless force=true.
//
// Why this tool exists: ~66 orphan resources accumulated in a production site (2026-05-12 nuke)
// could not be removed via existing MCP tools. delete-variable provides the pattern;
// this is the symmetric tool for resources.
//
// Reference-scan logic lives in ./delete-helpers.ts.

import { z } from "zod";
import { customAlphabet } from "nanoid";
import type { ToolModule } from "../types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "../types.js";
import { requireAuth, requirePushAuth } from "../../auth.js";
import { fetchBuild, pushWithRetry } from "../../webstudio-client.js";
import type {
  WebstudioBuild,
  BuildPatchTransaction,
  BuildPatchChange,
  BuildPatchOperation,
} from "../../webstudio-client.js";
import {
  findResourceReferences,
  type DataSource,
  type Resource,
} from "./delete-helpers.js";

const txId = customAlphabet(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
  21,
);

export const deleteResourceInputSchema = z
  .object({
    projectSlug: z.string(),
    resourceId: z.string().optional(),
    resourceName: z.string().optional(),
    /** Batch form: array of resourceIds (and/or names). Used for bulk cleanup. */
    resourceIdsOrNames: z.array(z.string()).optional(),
    /** Bypass the reference check. With force=true, AUTO-DELETES prop refs of
     *  type=resource pointing at the deleted resource (cascade). Bug 2026-05-20:
     *  previously force=true left dangling refs as a silent warning → 10 forms
     *  broken because their `action` prop kept pointing to deleted resource ids. */
    force: z.boolean().default(false),
    dryRun: z.boolean().default(true),
  }).strict()
  .refine((d) => d.resourceId || d.resourceName || (d.resourceIdsOrNames && d.resourceIdsOrNames.length > 0), {
    message: "Provide resourceId, resourceName, or resourceIdsOrNames",
  });

export const deleteResourceTool: ToolModule = {
  definition: {
    name: "webstudio_delete_resource",
    description: `Use when: delete an HTTP SSR resource and its linked dataSource (cleanup unused endpoint, remove orphan from nuke leftovers).
Do NOT use when: you want to remove a variable, not a resource — use webstudio_delete_variables (accepts 1 or N ids). To bulk-clean orphan resources, run webstudio_nuke_project with scope.resources=true (project-wide).
Returns: { references:[...], deleted:{resourceId, dataSourceId?} }. Refuses if any reference found unless force=true; tolerates orphan resources (no linked dataSource).
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default. force=true leaves dangling refs.

Example: { projectSlug: "my-site", resourceName: "oldEndpoint" }
Example: { projectSlug: "acme", resourceId: "abc123", force: true, dryRun: false }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        resourceId: { type: "string" },
        resourceName: { type: "string" },
        resourceIdsOrNames: {
          type: "array",
          items: { type: "string" },
          description: "Batch form: list of resource ids and/or names. Continue-on-error.",
        },
        force: { type: "boolean", description: "With force=true, cascade-delete prop refs of type=resource (auto-clean dangling references)." },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug"],
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
    const parsed = deleteResourceInputSchema.safeParse(args);
    if (!parsed.success) {
      return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    }
    const data = parsed.data;

    let auth;
    try {
      auth = data.dryRun ? requireAuth(data.projectSlug) : requirePushAuth(data.projectSlug);
    } catch (err) {
      return authErrorResult(err);
    }

    let build: WebstudioBuild;
    try {
      build = await fetchBuild(auth);
    } catch (err) {
      return runtimeErrorResult(err, "fetch build failed");
    }

    // Normalise to a single list of input tokens (id or name).
    const inputs: string[] = data.resourceIdsOrNames && data.resourceIdsOrNames.length > 0
      ? data.resourceIdsOrNames
      : [data.resourceId ?? data.resourceName ?? ""];

    const result = planAndExecute(build, inputs, data.force);

    if (result.succeeded.length === 0 && result.failed.length > 0) {
      return errorResult(
        "VALIDATION_FAILED",
        `No deletions performed.\n\n${renderBatchReport(result.succeeded, result.failed)}`,
      );
    }

    if (data.dryRun) {
      return textResult(
        `DRY-RUN delete_resource (${result.succeeded.length} target(s) will be deleted)\n\n${renderBatchReport(result.succeeded, result.failed)}\n\nIf OK, re-run with dryRun=false${result.succeeded.some((s) => s.refs > 0) ? " and force=true" : ""}.`,
      );
    }

    try {
      const { result: pushResult, finalVersion } = await pushWithRetry(auth, (cur) => {
        const fresh = planAndExecute(cur, inputs, data.force);
        return fresh.transaction;
      });
      return textResult(
        `Resource(s) deleted — version → ${finalVersion}\nstatus: ${pushResult.status}\n\n${renderBatchReport(result.succeeded, result.failed)}`,
      );
    } catch (err) {
      return runtimeErrorResult(err, "Delete failed");
    }
  },
};

// ─── Internals ──────────────────────────────────────────────────────────────

type Outcome = {
  input: string;
  id: string;
  name: string;
  dataSourceId?: string;
  refs: number;
  cascadedProps: number;
};
type FailedOutcome = { input: string; reason: string };

function planAndExecute(
  build: WebstudioBuild,
  inputs: string[],
  force: boolean,
): { succeeded: Outcome[]; failed: FailedOutcome[]; transaction: BuildPatchTransaction } {
  const succeeded: Outcome[] = [];
  const failed: FailedOutcome[] = [];

  const resources = (build as unknown as { resources: Resource[] }).resources ?? [];
  const dataSources = (build as unknown as { dataSources: DataSource[] }).dataSources ?? [];

  const resourcePatches: BuildPatchOperation[] = [];
  const dataSourcePatches: BuildPatchOperation[] = [];
  const propPatches: BuildPatchOperation[] = [];

  const seen = new Set<string>();
  for (const input of inputs) {
    if (seen.has(input)) {
      failed.push({ input, reason: "duplicate in batch (skipped)" });
      continue;
    }
    seen.add(input);

    const matches = resources.filter((r) => r.id === input || r.name === input);
    if (matches.length === 0) {
      failed.push({ input, reason: "not found" });
      continue;
    }
    if (matches.length > 1) {
      failed.push({ input, reason: `ambiguous name (matches ${matches.length}); pass resourceId` });
      continue;
    }

    const target = matches[0];
    const linkedDs = dataSources.find(
      (d) => d.type === "resource" && d.resourceId === target.id,
    );
    const refs = findResourceReferences(build, target.id, linkedDs?.id);

    if (refs.length > 0 && !force) {
      failed.push({
        input,
        reason: `${refs.length} ref(s) found (use force=true to cascade-delete them)`,
      });
      continue;
    }

    // Cascade: remove prop refs of type=resource pointing to this resource id.
    // This is the key fix: with force=true, we don't just delete the resource and
    // leave the prop dangling — we also remove the prop so the form/instance
    // re-renders cleanly without a broken submission target.
    let cascaded = 0;
    if (refs.length > 0 && force) {
      for (const p of build.props) {
        if (p.type === "resource" && p.value === target.id) {
          propPatches.push({ op: "remove", path: [p.id] });
          cascaded++;
        }
      }
    }

    resourcePatches.push({ op: "remove", path: [target.id] });
    if (linkedDs) {
      dataSourcePatches.push({ op: "remove", path: [linkedDs.id] });
    }

    succeeded.push({
      input,
      id: target.id,
      name: target.name,
      dataSourceId: linkedDs?.id,
      refs: refs.length,
      cascadedProps: cascaded,
    });
  }

  const payload: BuildPatchChange[] = [];
  if (resourcePatches.length > 0) payload.push({ namespace: "resources", patches: resourcePatches });
  if (dataSourcePatches.length > 0) payload.push({ namespace: "dataSources", patches: dataSourcePatches });
  if (propPatches.length > 0) payload.push({ namespace: "props", patches: propPatches });

  return {
    succeeded,
    failed,
    transaction: { id: `mcp-delete-resource-${txId()}`, payload },
  };
}

function renderBatchReport(succeeded: Outcome[], failed: FailedOutcome[]): string {
  const lines: string[] = [];
  lines.push(`✅ Succeeded (${succeeded.length})`);
  for (const s of succeeded) {
    const cascadeTag = s.cascadedProps > 0 ? ` ⚠ ${s.cascadedProps} prop ref(s) auto-cleaned (cascade)` : "";
    const dsTag = s.dataSourceId ? ` + dataSource ${s.dataSourceId}` : " (orphan, no dataSource)";
    lines.push(`  ✓ "${s.name}" (id=${s.id})${dsTag}${cascadeTag}`);
  }
  lines.push(`\n❌ Failed (${failed.length})`);
  for (const f of failed) {
    lines.push(`  ✗ "${f.input}" — ${f.reason}`);
  }
  return lines.join("\n");
}
