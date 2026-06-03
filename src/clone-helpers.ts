// Public API: buildCloneSubtreeChanges — orchestrates the full clone subtree
// flow (id remap, expression rewrite, mode replace/append, per-namespace
// patches). Implementation lives in ./clone/.
//
// What gets cloned (with new IDs):
//   - instances (all descendants of the source roots)
//   - props attached to those instances
//   - local styleSourceSelections (local style sources remapped; tokens kept)
//   - local styleSources + their styles
//   - dataSources / resources scoped on a cloned instance
//   - expressions in props (type=expression / action) and instance text children
//     are remapped: $ws$dataSource$<old> → $ws$dataSource$<new>.

import type { WebstudioBuild, BuildPatchChange, BuildPatchOperation } from "./webstudio-client.js";
import { buildInstanceRemovalChanges } from "./cleanup-helpers.js";
import { makeExprRemap } from "./clone/expr-remap.js";
import { buildCloneMaps } from "./clone/id-maps.js";
import {
  addClonedInstances,
  addClonedProps,
  addClonedDataSources,
  addClonedResources,
  addClonedStyles,
  addClonedSelections,
  emptyPatches,
  type Patches,
} from "./clone/build-patches.js";
import { newId } from "./clone/id-maps.js";

export type CloneSubtreeOptions = {
  /** Source instance — see `includeSource` for whether the instance itself is cloned. */
  sourceInstanceId: string;
  /** Target instance that will receive the cloned children. */
  targetInstanceId: string;
  /** "append": add cloned children at the end of target's existing children.
   *  "prepend": add cloned children at the beginning of target's existing children.
   *  "replace": delete target's existing children first. */
  mode: "append" | "prepend" | "replace";
  /**
   * When `false` (default), clone the CHILDREN of `sourceInstanceId` only (the source
   * itself is NOT included — historical semantics, used by clone_page wrapper for
   * "regenerate the contents of a container template" workflows).
   *
   * When `true`, include `sourceInstanceId` itself as the root of the cloned subtree
   * (semantics that matches "clone this section into that page" — the natural reading
   * of the tool name).
   *
   * NOTE: cannot be combined with `skipChildLabels` (sémantique ambiguë — throws).
   */
  includeSource?: boolean;
  /** Skip top-level source children whose label matches one of these. Only valid when
   *  `includeSource: false` (default). */
  skipChildLabels?: string[];
};

export type CloneSubtreeResult = {
  changes: BuildPatchChange[];
  summary: {
    instancesCloned: number;
    propsCloned: number;
    localStyleSourcesCloned: number;
    stylesCloned: number;
    selectionsCloned: number;
    dataSourcesCloned: number;
    resourcesCloned: number;
    childrenDeleted: number;
  };
};

function resolveTopLevelSourceIds(
  build: WebstudioBuild,
  source: WebstudioBuild["instances"][number],
  skipChildLabels: string[],
): string[] {
  const skipSet = new Set(skipChildLabels);
  return source.children
    .filter((c) => c.type === "id")
    .map((c) => (c as { type: "id"; value: string }).value)
    .filter((id) => {
      if (skipSet.size === 0) return true;
      const inst = build.instances.find((i) => i.id === id);
      return !inst?.label || !skipSet.has(inst.label);
    });
}

function applyReplaceMode(
  patches: Patches,
  build: WebstudioBuild,
  target: WebstudioBuild["instances"][number],
): number {
  const oldChildIds = target.children
    .filter((c) => c.type === "id")
    .map((c) => (c as { type: "id"; value: string }).value);
  if (oldChildIds.length === 0) return 0;
  const removalChanges = buildInstanceRemovalChanges(build, oldChildIds);
  let childrenDeleted = 0;
  for (const c of removalChanges) {
    if (c.namespace === "instances") childrenDeleted = c.patches.length;
  }
  for (const change of removalChanges) {
    const arr = change.namespace === "instances" ? patches.instancePatches
      : change.namespace === "props" ? patches.propPatches
      : change.namespace === "styleSourceSelections" ? patches.selectionPatches
      : null;
    if (arr) arr.push(...change.patches);
  }
  return childrenDeleted;
}

function patchTargetChildren(
  patches: Patches,
  target: WebstudioBuild["instances"][number],
  mode: "append" | "prepend" | "replace",
  newClonedChildren: Array<{ type: "id"; value: string }>,
): void {
  let newTargetChildren;
  if (mode === "replace") {
    const nonIdChildren = target.children.filter((c) => c.type !== "id");
    newTargetChildren = [...nonIdChildren, ...newClonedChildren];
  } else if (mode === "prepend") {
    newTargetChildren = [...newClonedChildren, ...target.children];
  } else {
    newTargetChildren = [...target.children, ...newClonedChildren];
  }
  patches.instancePatches.push({ op: "replace", path: [target.id, "children"], value: newTargetChildren });
}

function assembleChanges(patches: Patches): BuildPatchChange[] {
  const changes: BuildPatchChange[] = [];
  const push = (ns: BuildPatchChange["namespace"], arr: BuildPatchOperation[]) => {
    if (arr.length) changes.push({ namespace: ns, patches: arr });
  };
  push("instances", patches.instancePatches);
  push("props", patches.propPatches);
  push("styleSources", patches.styleSourcePatches);
  push("styles", patches.stylePatches);
  push("styleSourceSelections", patches.selectionPatches);
  push("dataSources", patches.dataSourcePatches);
  push("resources", patches.resourcePatches);
  return changes;
}

/**
 * Build the patches that clone a subtree from source to target with full ID remap.
 * Returns the changes ready to wrap in a transaction.
 */
export function buildCloneSubtreeChanges(
  build: WebstudioBuild,
  options: CloneSubtreeOptions,
): CloneSubtreeResult {
  const { sourceInstanceId, targetInstanceId, mode, includeSource = false, skipChildLabels = [] } = options;

  if (includeSource && skipChildLabels.length > 0) {
    throw new Error(
      `Cannot combine includeSource:true with skipChildLabels — ambiguous semantics. Either clone the entire source subtree (includeSource:true, skipChildLabels:[]) or clone selected children only (includeSource:false, skipChildLabels:[...]).`,
    );
  }

  const source = build.instances.find((i) => i.id === sourceInstanceId);
  if (!source) throw new Error(`Source instance "${sourceInstanceId}" not found`);
  const target = build.instances.find((i) => i.id === targetInstanceId);
  if (!target) throw new Error(`Target instance "${targetInstanceId}" not found`);

  const topLevelSourceIds = includeSource
    ? [sourceInstanceId]
    : resolveTopLevelSourceIds(build, source, skipChildLabels);
  if (topLevelSourceIds.length === 0) {
    throw new Error(
      includeSource
        ? `Source "${sourceInstanceId}" cannot be cloned (instance missing in build)`
        : `Source "${sourceInstanceId}" has no children to clone (after applying skipChildLabels)`,
    );
  }

  const maps = buildCloneMaps(build, topLevelSourceIds);
  const remapExpr = makeExprRemap(maps.dsIdMap);
  const patches = emptyPatches();

  let childrenDeleted = 0;
  if (mode === "replace") {
    childrenDeleted = applyReplaceMode(patches, build, target);
  }

  addClonedInstances(patches, build, maps, remapExpr);
  addClonedProps(patches, build, maps, remapExpr, newId);
  addClonedDataSources(patches, build, maps);
  addClonedResources(patches, build, maps, remapExpr);
  addClonedStyles(patches, build, maps);
  addClonedSelections(patches, build, maps);

  const newClonedChildren = topLevelSourceIds.map((id) => ({ type: "id" as const, value: maps.idMap.get(id)! }));
  patchTargetChildren(patches, target, mode, newClonedChildren);

  return {
    changes: assembleChanges(patches),
    summary: {
      instancesCloned: maps.allSourceIds.size,
      propsCloned: patches.propPatches.filter((p) => p.op === "add").length,
      localStyleSourcesCloned: maps.localSourceRemap.size,
      stylesCloned: patches.stylePatches.filter((p) => p.op === "add").length,
      selectionsCloned: patches.selectionPatches.filter((p) => p.op === "add").length,
      dataSourcesCloned: maps.dsIdMap.size,
      resourcesCloned: maps.resIdMap.size,
      childrenDeleted,
    },
  };
}
