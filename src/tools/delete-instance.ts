// Tool: webstudio_delete_instance — delete one or more instances and their sub-tree.
// Full cleanup via buildInstanceRemovalChanges (instances + props + styleSourceSelections).

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type { WebstudioBuild, BuildPatchTransaction } from "../webstudio-client.js";
import { buildInstanceRemovalChanges, buildParentChildrenPatch, collectDescendantIds } from "../cleanup-helpers.js";
import { customAlphabet } from "nanoid";

const txId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);

export const deleteInstanceInputSchema = z.object({
  projectSlug: z.string(),
  /** Explicit IDs to delete. At least one of (instanceIds, labels) is required. */
  instanceIds: z.array(z.string()).optional(),
  /** Match by exact label at the home root's top level. E.g. ["Mobile menu", "CSS animation menu"]. */
  labels: z.array(z.string()).optional(),
  /** Restrict label search to a specific component (Radix suffix accepted). */
  componentMatch: z.string().optional(),
  dryRun: z.boolean().default(true),
}).strict().refine((d) => (d.instanceIds && d.instanceIds.length > 0) || (d.labels && d.labels.length > 0), {
  message: "Provide either instanceIds or labels (at least one)",
});

function findIdsByLabels(build: WebstudioBuild, labels: string[], componentMatch?: string): string[] {
  const home = build.pages.pages.find((p) => p.id === build.pages.homePageId);
  if (!home) return [];
  const root = build.instances.find((i) => i.id === home.rootInstanceId);
  if (!root) return [];
  const labelSet = new Set(labels);
  const found: string[] = [];
  for (const c of root.children) {
    if (c.type !== "id") continue;
    const inst = build.instances.find((i) => i.id === c.value);
    if (!inst || !inst.label || !labelSet.has(inst.label)) continue;
    if (componentMatch) {
      const ok = inst.component === componentMatch ||
        inst.component.endsWith(`:${componentMatch}`) ||
        inst.component.split(":").pop() === componentMatch;
      if (!ok) continue;
    }
    found.push(inst.id);
  }
  return found;
}

function buildDeleteTransaction(
  build: WebstudioBuild,
  instanceIds: string[],
): { transaction: BuildPatchTransaction; totalRemoved: number } {
  const home = build.pages.pages.find((p) => p.id === build.pages.homePageId);
  if (!home) throw new Error("Home page not found");

  // For each instance to delete, also remove its reference from the parent's children.
  // We group by parent so we issue a single replace per parent.
  const parentChildrenUpdates = new Map<string, string[]>(); // parentId → ids to remove
  for (const id of instanceIds) {
    const parent = build.instances.find((p) => p.children.some((c) => c.type === "id" && c.value === id));
    if (parent) {
      const arr = parentChildrenUpdates.get(parent.id) ?? [];
      arr.push(id);
      parentChildrenUpdates.set(parent.id, arr);
    }
  }

  const cleanupChanges = buildInstanceRemovalChanges(build, instanceIds);
  if (cleanupChanges.length === 0) {
    throw new Error("No instance matches the criteria");
  }

  // Inject the parent-children replace patches into the "instances" namespace.
  const instancesChange = cleanupChanges.find((c) => c.namespace === "instances")!;
  for (const [parentId, idsToRemove] of parentChildrenUpdates) {
    instancesChange.patches.unshift(buildParentChildrenPatch(build, parentId, idsToRemove));
  }

  const totalRemoved = instanceIds.flatMap((id) => collectDescendantIds(id, build.instances)).length;

  return {
    transaction: { id: `mcp-delete-inst-${txId()}`, payload: cleanupChanges },
    totalRemoved,
  };
}

export const deleteInstanceTool: ToolModule = {
  definition: {
    name: "webstudio_delete_instance",
    description: `Use when: delete instances + their full sub-tree (with cleanup of props, styleSourceSelections, and parent's children reference).
Do NOT use when: you want to remove a wrapper while keeping its children — use webstudio_flatten_instance. To remove a single prop (not the instance), use webstudio_instance_prop. To re-push a section idempotently, prefer webstudio_push_fragment with replace:{labels} (which calls this internally).
Returns: dry-run report with resolved IDs + per-namespace patch counts, OR push result with finalVersion + total instances removed (incl. descendants).
Two target modes (at least one required): instanceIds (explicit) OR labels + optional componentMatch (matches by EXACT label at the home root's top level only).
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default.

Example: { projectSlug: "acme", labels: ["Old hero", "Mobile menu"], dryRun: true }
Example: { projectSlug: "my-site", instanceIds: ["abc123", "xyz789"], dryRun: false }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        instanceIds: { type: "array", items: { type: "string" } },
        labels: { type: "array", items: { type: "string" } },
        componentMatch: { type: "string" },
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
    const parsed = deleteInstanceInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const { projectSlug, instanceIds, labels, componentMatch, dryRun } = parsed.data;

    let auth;
    try { auth = dryRun ? requireAuth(projectSlug) : requirePushAuth(projectSlug); }
    catch (err) { return authErrorResult(err); }

    let build;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    const ids = [
      ...(instanceIds ?? []),
      ...(labels ? findIdsByLabels(build, labels, componentMatch) : []),
    ];
    if (ids.length === 0) {
      return textResult(`No instance matches these criteria (labels=${JSON.stringify(labels)}, componentMatch=${componentMatch}).`);
    }

    let tx;
    try { tx = buildDeleteTransaction(build, ids); }
    catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith("No instance matches")) return errorResult("INSTANCE_NOT_FOUND", msg);
      if (msg.startsWith("Home page not found")) return errorResult("PAGE_NOT_FOUND", msg);
      return errorResult("INTERNAL_ERROR", msg);
    }

    const summary = tx.transaction.payload.map((c) => `  - ${c.namespace}: ${c.patches.length} patches`).join("\n");
    if (dryRun) {
      return textResult(`DRY-RUN delete_instance

Target: ${projectSlug}
Resolved instance IDs (${ids.length}): ${ids.join(", ")}

${tx.totalRemoved} instance(s) total (with descendants) will be removed.

Transaction:
${summary}

If OK, re-run with dryRun=false.`);
    }

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) => buildDeleteTransaction(cur, ids).transaction);
      return textResult(`${tx.totalRemoved} instance(s) removed — version → ${finalVersion}\nstatus: ${result.status}`);
    } catch (err) {
      return runtimeErrorResult(err, "Delete failed");
    }
  },
};
