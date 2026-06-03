// Shared helpers to remove instances along with their orphans (props, styleSourceSelections).
// Used by delete_page, delete_instance, and the replace mode of push_fragment.
//
// Removing instances MUST also clean up attached props and styleSourceSelections —
// otherwise they become orphans and may re-attach to new instances sharing the same
// deterministic ID (observed bug on the Sheet pattern: class/data-ws-show props duplicated x2).

import type { WebstudioBuild, BuildPatchChange, BuildPatchOperation } from "./webstudio-client.js";

/**
 * Recursive tree walker: collects rootId plus all its descendant instances.
 *
 * `stopAtComponents` lets the caller skip recursion into instances whose component
 * is in the set. The instance itself is still collected, but its children are not
 * walked. This is CRITICAL for Slot components — a Slot's child is a Fragment
 * instance that is SHARED across pages (header, footer, etc.). Walking into it
 * during a removal would destroy site-wide content; during a clone, it would
 * needlessly duplicate shared fragments. Default: empty set (full walk).
 */
export function collectDescendantIds(
  rootId: string,
  instances: WebstudioBuild["instances"],
  stopAtComponents: ReadonlySet<string> = new Set(),
): string[] {
  const collected: string[] = [];
  const visit = (id: string) => {
    collected.push(id);
    const inst = instances.find((i) => i.id === id);
    if (!inst) return;
    if (stopAtComponents.has(inst.component)) return;
    for (const child of inst.children) {
      if (child.type === "id") visit(child.value);
    }
  };
  visit(rootId);
  return collected;
}

/**
 * Components whose children must NOT be walked during removal or full-page
 * duplication. Slot's children point to a Fragment that's shared site-wide.
 */
export const SHARED_CHILDREN_COMPONENTS: ReadonlySet<string> = new Set(["Slot"]);

/**
 * Build patches that remove a set of instances plus all their orphans.
 * Returns changes per namespace (instances, props, styleSourceSelections).
 *
 * Note: styles and styleSources are NOT touched (they may be shared via tokens).
 * Webstudio tolerates their orphans. If a styleSource is no longer referenced by any
 * styleSourceSelection it becomes inactive but stays in the build (manageable manually).
 */
export function buildInstanceRemovalChanges(
  build: WebstudioBuild,
  rootIdsToRemove: string[],
): BuildPatchChange[] {
  // 1. Collect roots + descendants — STOP at Slot boundaries so we never destroy
  //    shared Fragment content referenced by a page's header/footer slots.
  const allInstanceIds = new Set<string>();
  for (const id of rootIdsToRemove) {
    for (const desc of collectDescendantIds(id, build.instances, SHARED_CHILDREN_COMPONENTS)) {
      allInstanceIds.add(desc);
    }
  }

  if (allInstanceIds.size === 0) return [];

  const changes: BuildPatchChange[] = [];

  // 2. instances: remove patch per instance
  changes.push({
    namespace: "instances",
    patches: Array.from(allInstanceIds).map((id) => ({
      op: "remove" as const,
      path: [id],
    })),
  });

  // 3. props: remove all props pointing to these instances
  const propsToRemove = build.props.filter((p) => allInstanceIds.has(p.instanceId));
  if (propsToRemove.length > 0) {
    changes.push({
      namespace: "props",
      patches: propsToRemove.map((p) => ({
        op: "remove" as const,
        path: [p.id],
      })),
    });
  }

  // 4. styleSourceSelections: remove ones pointing to these instances
  const selectionsToRemove = build.styleSourceSelections.filter((s) =>
    allInstanceIds.has(s.instanceId),
  );
  if (selectionsToRemove.length > 0) {
    changes.push({
      namespace: "styleSourceSelections",
      patches: selectionsToRemove.map((s) => ({
        op: "remove" as const,
        path: [s.instanceId],
      })),
    });
  }

  return changes;
}

/**
 * Patch to remove instance IDs from a parent's children.
 * Combine with buildInstanceRemovalChanges when stripping sub-trees from a container.
 */
export function buildParentChildrenPatch(
  build: WebstudioBuild,
  parentInstanceId: string,
  childIdsToRemove: string[],
): BuildPatchOperation {
  const parent = build.instances.find((i) => i.id === parentInstanceId);
  if (!parent) throw new Error(`Parent instance "${parentInstanceId}" not found`);
  const remove = new Set(childIdsToRemove);
  const newChildren = parent.children.filter((c) => c.type !== "id" || !remove.has(c.value));
  return {
    op: "replace" as const,
    path: [parentInstanceId, "children"],
    value: newChildren,
  };
}
