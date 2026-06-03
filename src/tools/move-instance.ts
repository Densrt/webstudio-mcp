// Tool: webstudio_move_instance — re-parent N existing instances under a new parent.
// Preserves all props, styles, tokens, children — only the parent reference changes.
// Refuses cycles (cannot move an instance into itself or its descendants).
//
// Restored in v2.3.5 — was missing from the v2.0 API refonte. Common need when
// grouping siblings into a new wrapper (created via append or wrap on one of them).

import { z } from "zod";
import { customAlphabet } from "nanoid";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type { WebstudioBuild, BuildPatchOperation, BuildPatchChange, BuildPatchTransaction } from "../webstudio-client.js";

const txId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);

export const moveInstanceInputSchema = z.object({
  projectSlug: z.string(),
  /** One or more moves applied atomically. Order matters for reorder within the same parent. */
  moves: z.array(z.object({
    instanceId: z.string(),
    parentInstanceId: z.string(),
    /** 0 = first; omitted = append at end of new parent's children. */
    insertIndex: z.number().int().nonnegative().optional(),
  })).min(1),
  dryRun: z.boolean().default(true),
}).strict();

type ChildRef = { type: "id"; value: string } | { type: "text"; value: string } | { type: "expression"; value: string };

function findParentOf(build: WebstudioBuild, instanceId: string): { parentId: string; childIndex: number } | null {
  for (const inst of build.instances) {
    const children = (inst.children ?? []) as ChildRef[];
    const idx = children.findIndex((c) => c.type === "id" && c.value === instanceId);
    if (idx >= 0) return { parentId: inst.id, childIndex: idx };
  }
  return null;
}

function isDescendantOf(build: WebstudioBuild, ancestorId: string, candidateId: string): boolean {
  if (ancestorId === candidateId) return true;
  const queue = [ancestorId];
  const seen = new Set<string>([ancestorId]);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const inst = build.instances.find((i) => i.id === cur);
    if (!inst) continue;
    for (const child of (inst.children ?? []) as ChildRef[]) {
      if (child.type !== "id") continue;
      if (child.value === candidateId) return true;
      if (!seen.has(child.value)) {
        seen.add(child.value);
        queue.push(child.value);
      }
    }
  }
  return false;
}

export type MovePlan = {
  instanceId: string;
  oldParentId: string;
  oldChildIndex: number;
  newParentId: string;
  newInsertIndex: number;
  sameParent: boolean;
};

export function buildMoveChanges(
  build: WebstudioBuild,
  args: z.infer<typeof moveInstanceInputSchema>,
): { changes: BuildPatchChange[]; plans: MovePlan[] } {
  // Validate every move BEFORE applying any change (atomic semantics).
  type ValidatedMove = {
    instanceId: string;
    oldParentId: string;
    oldChildIndex: number;
    newParentId: string;
    requestedIndex: number | undefined;
  };
  const validated: ValidatedMove[] = [];

  for (const m of args.moves) {
    const inst = build.instances.find((i) => i.id === m.instanceId);
    if (!inst) throw new Error(`Instance not found: ${m.instanceId}`);

    const cur = findParentOf(build, m.instanceId);
    if (!cur) throw new Error(`Cannot move root instance: ${m.instanceId}`);

    const newParent = build.instances.find((i) => i.id === m.parentInstanceId);
    if (!newParent) throw new Error(`New parent not found: ${m.parentInstanceId}`);

    if (m.parentInstanceId === m.instanceId) {
      throw new Error(`Cannot move instance into itself: ${m.instanceId}`);
    }
    if (isDescendantOf(build, m.instanceId, m.parentInstanceId)) {
      throw new Error(`Cycle detected: target parent ${m.parentInstanceId} is a descendant of ${m.instanceId}`);
    }

    validated.push({
      instanceId: m.instanceId,
      oldParentId: cur.parentId,
      oldChildIndex: cur.childIndex,
      newParentId: m.parentInstanceId,
      requestedIndex: m.insertIndex,
    });
  }

  // Apply moves in order on a virtual children map so the effective insertIndex
  // reflects the state AFTER previous moves in the batch (e.g. batch-appending
  // two instances under an empty parent must yield [first, second], not [second, first]).
  const childrenMap = new Map<string, ChildRef[]>();
  for (const inst of build.instances) {
    childrenMap.set(inst.id, [...((inst.children ?? []) as ChildRef[])]);
  }

  const plans: MovePlan[] = [];
  for (const v of validated) {
    const oldChildren = childrenMap.get(v.oldParentId);
    if (oldChildren) {
      const idx = oldChildren.findIndex((c) => c.type === "id" && c.value === v.instanceId);
      if (idx >= 0) oldChildren.splice(idx, 1);
    }
    const newChildren = childrenMap.get(v.newParentId);
    if (newChildren) {
      const cap = newChildren.length;
      const insertAt = v.requestedIndex !== undefined ? Math.min(v.requestedIndex, cap) : cap;
      newChildren.splice(insertAt, 0, { type: "id", value: v.instanceId });
      plans.push({
        instanceId: v.instanceId,
        oldParentId: v.oldParentId,
        oldChildIndex: v.oldChildIndex,
        newParentId: v.newParentId,
        newInsertIndex: insertAt,
        sameParent: v.oldParentId === v.newParentId,
      });
    }
  }

  // Emit one replace patch per affected parent.
  const affectedParents = new Set<string>();
  for (const p of plans) {
    affectedParents.add(p.oldParentId);
    affectedParents.add(p.newParentId);
  }
  const instancePatches: BuildPatchOperation[] = [];
  for (const parentId of affectedParents) {
    const newChildren = childrenMap.get(parentId);
    if (!newChildren) continue;
    instancePatches.push({ op: "replace", path: [parentId, "children"], value: newChildren });
  }

  return {
    changes: [{ namespace: "instances", patches: instancePatches }],
    plans,
  };
}

export const moveInstanceTool: ToolModule = {
  definition: {
    name: "webstudio_move_instance",
    description: `Use when: re-parent one or more existing instances under a different parent (or reorder within the same parent). Preserves props, styles, tokens, children — only the parent reference changes.
Do NOT use when: deleting + re-creating (use delete + push_fragment) or wrapping multiple instances in a brand-new parent (use wrap on one to create the parent, then move the others into it). To insert a wrapper around a single instance, use wrap.
Returns: dry-run plan per move OR push result with version.
Pass moves as batch: { moves: [{ instanceId, parentInstanceId, insertIndex? }, ...] }. insertIndex omitted = append at end. Refuses cycles (cannot move an instance into itself or any of its descendants) and refuses moving a root instance.
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default.

Example: { projectSlug: "acme", moves: [{ instanceId: "h1_xyz", parentInstanceId: "new_wrapper" }] }
Example: { projectSlug: "my-site", moves: [{ instanceId: "card_a", parentInstanceId: "grid", insertIndex: 0 }, { instanceId: "card_b", parentInstanceId: "grid", insertIndex: 1 }] }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        moves: {
          type: "array",
          items: {
            type: "object",
            properties: {
              instanceId: { type: "string" },
              parentInstanceId: { type: "string" },
              insertIndex: { type: "number" },
            },
            required: ["instanceId", "parentInstanceId"],
            additionalProperties: false,
          },
          minItems: 1,
        },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug", "moves"],
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
    const parsed = moveInstanceInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const data = parsed.data;

    let auth;
    try { auth = data.dryRun ? requireAuth(data.projectSlug) : requirePushAuth(data.projectSlug); }
    catch (err) { return authErrorResult(err); }

    let build;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    let r;
    try { r = buildMoveChanges(build, data); }
    catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith("Instance not found")) return errorResult("INSTANCE_NOT_FOUND", msg);
      if (msg.startsWith("New parent not found")) return errorResult("INSTANCE_NOT_FOUND", msg);
      if (msg.startsWith("Cannot move root instance")) return errorResult("VALIDATION_FAILED", msg);
      if (msg.startsWith("Cannot move instance into itself")) return errorResult("VALIDATION_FAILED", msg);
      if (msg.startsWith("Cycle detected")) return errorResult("VALIDATION_FAILED", msg);
      return errorResult("INTERNAL_ERROR", msg);
    }

    const summary = r.plans
      .map((p) => `  • ${p.instanceId}: ${p.oldParentId}${p.sameParent ? " (reorder)" : ` → ${p.newParentId}`} [index ${p.newInsertIndex}]`)
      .join("\n");
    const head = `${r.plans.length} move(s):\n${summary}\n\nPatches:\n  instances: ${r.changes[0]?.patches.length ?? 0}`;

    if (data.dryRun) {
      return textResult(`DRY-RUN move_instance\n\n${head}\n\nIf OK, re-run with dryRun=false.`);
    }

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) => {
        const re = buildMoveChanges(cur, data);
        const tx: BuildPatchTransaction = { id: `mcp-move-instance-${txId()}`, payload: re.changes };
        return tx;
      });
      return textResult(`${r.plans.length} instance(s) moved — version → ${finalVersion}\nstatus: ${result.status}\n\n${summary}`);
    } catch (err) {
      return runtimeErrorResult(err, "Move failed");
    }
  },
};
