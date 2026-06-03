// Build per-namespace patches for webstudio_flatten_instance. Lifts wrapper
// children into the parent, drops decorative children + their subtrees, and
// removes the wrappers themselves.

import type { WebstudioBuild, BuildPatchOperation } from "../../webstudio-client.js";
import { collectDescendantIds, buildInstanceRemovalChanges } from "../../cleanup-helpers.js";

export type FlattenInput = {
  instanceIds: string[];
  dropChildLabels?: string[];
  dropChildTags?: string[];
  dropChildComponents?: string[];
};

export interface PerWrapperPlan {
  wrapperId: string;
  wrapperLabel: string;
  parentId: string;
  childrenLifted: string[];
  childrenDropped: string[];
}

export type FlattenResult = {
  plans: PerWrapperPlan[];
  instancePatches: BuildPatchOperation[];
  propPatches: BuildPatchOperation[];
  selectionPatches: BuildPatchOperation[];
  styleSourcePatches: BuildPatchOperation[];
  stylePatches: BuildPatchOperation[];
  deletedCount: number;
};

export function buildFlattenChanges(build: WebstudioBuild, args: FlattenInput): FlattenResult {
  const parentOf = new Map<string, string>();
  for (const i of build.instances) {
    for (const c of i.children) if (c.type === "id") parentOf.set(c.value, i.id);
  }

  const dropLabels = new Set(args.dropChildLabels ?? []);
  const dropTags = new Set(args.dropChildTags ?? []);
  const dropComponents = new Set(args.dropChildComponents ?? []);
  const shouldDrop = (childId: string): boolean => {
    if (dropLabels.size === 0 && dropTags.size === 0 && dropComponents.size === 0) return false;
    const inst = build.instances.find((i) => i.id === childId);
    if (!inst) return false;
    if (inst.label && dropLabels.has(inst.label)) return true;
    if (inst.tag && dropTags.has(inst.tag)) return true;
    if (inst.component && dropComponents.has(inst.component)) return true;
    return false;
  };

  const plans: PerWrapperPlan[] = [];
  const instancePatches: BuildPatchOperation[] = [];

  const wrapperIdsToDelete: string[] = [];
  const droppedSubtreeRoots: string[] = [];

  for (const wrapperId of args.instanceIds) {
    const wrapper = build.instances.find((i) => i.id === wrapperId);
    if (!wrapper) throw new Error(`Wrapper instance "${wrapperId}" not found`);
    const parentId = parentOf.get(wrapperId);
    if (!parentId) throw new Error(`Wrapper "${wrapperId}" is a root instance (no parent) — cannot flatten`);
    const parent = build.instances.find((i) => i.id === parentId)!;

    const liftedChildren: typeof wrapper.children = [];
    const droppedChildIds: string[] = [];
    for (const c of wrapper.children) {
      if (c.type !== "id") { liftedChildren.push(c); continue; }
      if (shouldDrop(c.value)) droppedChildIds.push(c.value);
      else liftedChildren.push(c);
    }

    const newParentChildren = parent.children.flatMap((c) => {
      if (c.type === "id" && c.value === wrapperId) return liftedChildren;
      return [c];
    });
    instancePatches.push({ op: "replace", path: [parentId, "children"], value: newParentChildren });

    wrapperIdsToDelete.push(wrapperId);
    for (const did of droppedChildIds) droppedSubtreeRoots.push(did);

    plans.push({
      wrapperId,
      wrapperLabel: wrapper.label ?? "",
      parentId,
      childrenLifted: liftedChildren.filter((c) => c.type === "id").map((c) => (c as { type: "id"; value: string }).value),
      childrenDropped: droppedChildIds,
    });
  }

  const propPatches: BuildPatchOperation[] = [];
  const selectionPatches: BuildPatchOperation[] = [];
  const styleSourcePatches: BuildPatchOperation[] = [];
  const stylePatches: BuildPatchOperation[] = [];

  // 1. Wrappers: delete only the wrapper instance + its own props/selection.
  const wrapperIdSet = new Set(wrapperIdsToDelete);
  for (const id of wrapperIdsToDelete) {
    instancePatches.push({ op: "remove", path: [id] });
  }
  for (const p of build.props) {
    if (wrapperIdSet.has(p.instanceId)) propPatches.push({ op: "remove", path: [p.id] });
  }
  for (const sel of build.styleSourceSelections) {
    if (wrapperIdSet.has(sel.instanceId)) selectionPatches.push({ op: "remove", path: [sel.instanceId] });
  }

  // 2. Dropped subtrees: full removal via shared helper.
  if (droppedSubtreeRoots.length > 0) {
    const removalChanges = buildInstanceRemovalChanges(build, droppedSubtreeRoots);
    for (const ch of removalChanges) {
      if (ch.namespace === "instances") instancePatches.push(...ch.patches);
      else if (ch.namespace === "props") propPatches.push(...ch.patches);
      else if (ch.namespace === "styleSourceSelections") selectionPatches.push(...ch.patches);
      else if (ch.namespace === "styleSources") styleSourcePatches.push(...ch.patches);
      else if (ch.namespace === "styles") stylePatches.push(...ch.patches);
    }
  }

  const droppedCount = droppedSubtreeRoots.reduce(
    (sum, id) => sum + collectDescendantIds(id, build.instances).length,
    0,
  );
  const deletedCount = wrapperIdsToDelete.length + droppedCount;

  return { plans, instancePatches, propPatches, selectionPatches, styleSourcePatches, stylePatches, deletedCount };
}
