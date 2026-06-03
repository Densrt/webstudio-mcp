// Build the ID-remap tables used by the clone-subtree machinery.

import { customAlphabet } from "nanoid";
import type { WebstudioBuild } from "../webstudio-client.js";
import { collectDescendantIds, SHARED_CHILDREN_COMPONENTS } from "../cleanup-helpers.js";

export const newId = customAlphabet(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
  21,
);

export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

export type CloneMaps = {
  allSourceIds: Set<string>;
  idMap: Map<string, string>;
  localSourceRemap: Map<string, string>;
  dsIdMap: Map<string, string>;
  resIdMap: Map<string, string>;
};

/**
 * Collect every descendant of the chosen top-level source instances and
 * generate fresh IDs for instances, local style sources, and scoped
 * dataSources/resources.
 */
export function buildCloneMaps(
  build: WebstudioBuild,
  topLevelSourceIds: string[],
): CloneMaps {
  // STOP at Slot boundaries so we don't clone the shared Fragment (header/footer)
  // referenced by Slots — those must remain shared between pages.
  const allSourceIds = new Set<string>();
  for (const id of topLevelSourceIds) {
    for (const d of collectDescendantIds(id, build.instances, SHARED_CHILDREN_COMPONENTS)) allSourceIds.add(d);
  }

  const idMap = new Map<string, string>();
  for (const id of allSourceIds) idMap.set(id, newId());

  const localSourceRemap = new Map<string, string>();
  for (const id of allSourceIds) {
    const sel = build.styleSourceSelections.find((s) => s.instanceId === id);
    if (!sel) continue;
    for (const ssId of sel.values) {
      const ss = build.styleSources.find((s) => s.id === ssId);
      if (ss?.type === "local" && !localSourceRemap.has(ssId)) {
        localSourceRemap.set(ssId, newId());
      }
    }
  }

  type IdScoped = { id: string; scopeInstanceId?: string };
  const dataSourcesAny = build.dataSources as IdScoped[];
  const resourcesAny = build.resources as IdScoped[];
  const dsIdMap = new Map<string, string>();
  for (const ds of dataSourcesAny) {
    if (ds.scopeInstanceId && allSourceIds.has(ds.scopeInstanceId)) {
      dsIdMap.set(ds.id, newId());
    }
  }
  const resIdMap = new Map<string, string>();
  for (const r of resourcesAny) {
    if (r.scopeInstanceId && allSourceIds.has(r.scopeInstanceId)) {
      resIdMap.set(r.id, newId());
    }
  }

  return { allSourceIds, idMap, localSourceRemap, dsIdMap, resIdMap };
}
