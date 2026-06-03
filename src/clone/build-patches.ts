// Per-namespace patch builders for the clone-subtree machinery.
//
// Each function generates the "add" patches needed to inject the cloned
// fragment into the build, with all references (children IDs, expression
// strings, scoped resources, etc.) remapped to the new IDs.

import type { WebstudioBuild, BuildPatchOperation } from "../webstudio-client.js";
import { deepClone } from "./id-maps.js";
import type { CloneMaps } from "./id-maps.js";

export type Patches = {
  instancePatches: BuildPatchOperation[];
  propPatches: BuildPatchOperation[];
  styleSourcePatches: BuildPatchOperation[];
  stylePatches: BuildPatchOperation[];
  selectionPatches: BuildPatchOperation[];
  dataSourcePatches: BuildPatchOperation[];
  resourcePatches: BuildPatchOperation[];
};

export function emptyPatches(): Patches {
  return {
    instancePatches: [],
    propPatches: [],
    styleSourcePatches: [],
    stylePatches: [],
    selectionPatches: [],
    dataSourcePatches: [],
    resourcePatches: [],
  };
}

export function addClonedInstances(
  patches: Patches,
  build: WebstudioBuild,
  maps: CloneMaps,
  remapExpr: (s: string) => string,
) {
  for (const oldId of maps.allSourceIds) {
    const oldInst = build.instances.find((i) => i.id === oldId);
    if (!oldInst) continue;
    const newInst = deepClone(oldInst);
    newInst.id = maps.idMap.get(oldId)!;
    newInst.children = newInst.children.map((c) => {
      if (c.type === "id" && maps.idMap.has(c.value)) return { ...c, value: maps.idMap.get(c.value)! };
      if (c.type === "expression" && typeof c.value === "string") return { ...c, value: remapExpr(c.value) };
      return c;
    });
    patches.instancePatches.push({ op: "add", path: [newInst.id], value: newInst });
  }
}

export function addClonedProps(
  patches: Patches,
  build: WebstudioBuild,
  maps: CloneMaps,
  remapExpr: (s: string) => string,
  newId: () => string,
) {
  for (const oldId of maps.allSourceIds) {
    for (const oldProp of build.props.filter((p) => p.instanceId === oldId)) {
      const newProp = deepClone(oldProp) as typeof oldProp & { type: string; value: unknown };
      newProp.id = newId();
      newProp.instanceId = maps.idMap.get(oldId)!;
      if (newProp.type === "expression" && typeof newProp.value === "string") {
        newProp.value = remapExpr(newProp.value);
      } else if (newProp.type === "parameter" && typeof newProp.value === "string") {
        // Collection components have item/itemKey props of type "parameter" pointing
        // directly to a parameter dataSourceId. If that dataSource was cloned, remap.
        const remapped = maps.dsIdMap.get(newProp.value);
        if (remapped) newProp.value = remapped;
      } else if (newProp.type === "resource" && typeof newProp.value === "string") {
        const remapped = maps.resIdMap.get(newProp.value);
        if (remapped) newProp.value = remapped;
      } else if ((newProp.type === "action" || newProp.type === "animationAction") && Array.isArray(newProp.value)) {
        newProp.value = (newProp.value as Array<Record<string, unknown>>).map((entry) => {
          const cloned = { ...entry };
          if (typeof cloned.code === "string") cloned.code = remapExpr(cloned.code);
          return cloned;
        });
      }
      patches.propPatches.push({ op: "add", path: [newProp.id], value: newProp });
    }
  }
}

export function addClonedDataSources(patches: Patches, build: WebstudioBuild, maps: CloneMaps) {
  type IdScoped = { id: string; scopeInstanceId?: string };
  const dataSourcesAny = build.dataSources as IdScoped[];
  for (const [oldDsId, newDsId] of maps.dsIdMap.entries()) {
    const oldDs = dataSourcesAny.find((d) => d.id === oldDsId);
    if (!oldDs) continue;
    const newDs = deepClone(oldDs) as typeof oldDs & { id: string; scopeInstanceId?: string };
    newDs.id = newDsId;
    if (newDs.scopeInstanceId && maps.idMap.has(newDs.scopeInstanceId)) {
      newDs.scopeInstanceId = maps.idMap.get(newDs.scopeInstanceId)!;
    }
    patches.dataSourcePatches.push({ op: "add", path: [newDs.id], value: newDs });
  }
}

export function addClonedResources(
  patches: Patches,
  build: WebstudioBuild,
  maps: CloneMaps,
  remapExpr: (s: string) => string,
) {
  type IdScoped = { id: string; scopeInstanceId?: string };
  const resourcesAny = build.resources as IdScoped[];
  for (const [oldResId, newResId] of maps.resIdMap.entries()) {
    const oldRes = resourcesAny.find((r) => r.id === oldResId);
    if (!oldRes) continue;
    const newRes = deepClone(oldRes) as typeof oldRes & {
      id: string;
      scopeInstanceId?: string;
      url?: string | unknown;
      headers?: Array<{ name: string; value: string }>;
      searchParams?: Array<{ name: string; value: string }>;
    };
    newRes.id = newResId;
    if (newRes.scopeInstanceId && maps.idMap.has(newRes.scopeInstanceId)) {
      newRes.scopeInstanceId = maps.idMap.get(newRes.scopeInstanceId)!;
    }
    if (typeof newRes.url === "string") newRes.url = remapExpr(newRes.url);
    if (Array.isArray(newRes.headers)) {
      newRes.headers = newRes.headers.map((h) => ({ ...h, value: typeof h.value === "string" ? remapExpr(h.value) : h.value }));
    }
    if (Array.isArray(newRes.searchParams)) {
      newRes.searchParams = newRes.searchParams.map((p) => ({ ...p, value: typeof p.value === "string" ? remapExpr(p.value) : p.value }));
    }
    patches.resourcePatches.push({ op: "add", path: [newRes.id], value: newRes });
  }
}

export function addClonedStyles(patches: Patches, build: WebstudioBuild, maps: CloneMaps) {
  for (const [oldSsId, newSsId] of maps.localSourceRemap.entries()) {
    const oldSs = build.styleSources.find((s) => s.id === oldSsId);
    if (!oldSs) continue;
    const newSs = deepClone(oldSs);
    newSs.id = newSsId;
    patches.styleSourcePatches.push({ op: "add", path: [newSs.id], value: newSs });
    for (const oldStyle of build.styles.filter((s) => s.styleSourceId === oldSsId)) {
      const newStyle = deepClone(oldStyle);
      newStyle.styleSourceId = newSsId;
      const k = `${newStyle.styleSourceId}:${newStyle.breakpointId}:${newStyle.property}:${newStyle.state ?? ""}`;
      patches.stylePatches.push({ op: "add", path: [k], value: newStyle });
    }
  }
}

export function addClonedSelections(patches: Patches, build: WebstudioBuild, maps: CloneMaps) {
  for (const oldId of maps.allSourceIds) {
    const oldSel = build.styleSourceSelections.find((s) => s.instanceId === oldId);
    if (!oldSel) continue;
    const newSel = {
      instanceId: maps.idMap.get(oldId)!,
      values: oldSel.values.map((v) => maps.localSourceRemap.get(v) ?? v),
    };
    patches.selectionPatches.push({ op: "add", path: [newSel.instanceId], value: newSel });
  }
}
