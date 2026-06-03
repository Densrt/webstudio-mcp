// Shared logic for working with project assets — list, usage scan, and replace.
//
// Used by:
//  - webstudio_list_assets       (read-only inventory)
//  - webstudio_inspect_asset     (single-asset details + usages)
//  - webstudio_find_asset_usage  (where is asset X used?)
//  - webstudio_audit_assets      (orphans, duplicates, breakdown)
//  - webstudio_delete_asset      (safety: refuse if usage > 0)
//  - webstudio_replace_asset     (swap one asset for another project-wide)

import type { WebstudioBuild } from "../webstudio-client.js";

/** Shape of an asset record in the build (Webstudio's internal model). */
export type Asset = {
  id: string;                       // sha256 hex digest of the file content
  name: string;                     // canonical filename with random suffix (e.g. "Photo_dY...XR.jpg")
  projectId: string;
  size: number;                     // bytes
  type: "image" | "font" | string;
  format: string;                   // "jpg" | "png" | "webp" | "ttf" | ...
  createdAt: string;
  meta?: {
    width?: number;
    height?: number;
    [k: string]: unknown;
  };
};

/** Where an asset is referenced. */
export type AssetUsage =
  | { kind: "prop"; instanceId: string; propId: string; propName: string }
  | {
      kind: "style";
      styleSourceId: string;
      breakpointId: string;
      property: string;
      state?: string;
      /** Index in the layers value array (for backgroundImage layers; -1 if single value). */
      layerIndex: number;
    }
  | {
      kind: "pageMeta";
      pageId: string;
      pageName: string;
      pagePath: string;
      field: "socialImageAssetId";
    };

export function getAssets(build: WebstudioBuild): Asset[] {
  return (build.assets ?? []) as Asset[];
}

export function findAssetById(build: WebstudioBuild, assetId: string): Asset | undefined {
  return getAssets(build).find((a) => a.id === assetId);
}

/**
 * Walk all props and styles, return every usage of the given assetId.
 * Detects:
 *   - Props of type "asset" with value=assetId
 *   - Styles where value contains an "image" entry of type "asset" with value=assetId
 *     (handles both single-value and layered shapes for backgroundImage/borderImage/maskImage etc.)
 */
export function findUsages(build: WebstudioBuild, assetId: string): AssetUsage[] {
  const out: AssetUsage[] = [];

  // 1) Props of type "asset".
  for (const p of build.props as Array<{
    id: string;
    instanceId: string;
    name: string;
    type: string;
    value: unknown;
  }>) {
    if (p.type === "asset" && p.value === assetId) {
      out.push({ kind: "prop", instanceId: p.instanceId, propId: p.id, propName: p.name });
    }
  }

  // 2) Styles with image values containing the asset.
  for (const s of build.styles as Array<{
    styleSourceId: string;
    breakpointId: string;
    property: string;
    state?: string;
    value: unknown;
  }>) {
    const hits = matchImageAssetInStyleValue(s.value, assetId);
    for (const layerIndex of hits) {
      out.push({
        kind: "style",
        styleSourceId: s.styleSourceId,
        breakpointId: s.breakpointId,
        property: s.property,
        state: s.state,
        layerIndex,
      });
    }
  }

  // 3) Page meta references (socialImageAssetId is the raw sha256, stored as a literal string).
  for (const p of build.pages.pages) {
    const meta = (p.meta ?? {}) as Record<string, unknown>;
    if (meta.socialImageAssetId === assetId) {
      out.push({
        kind: "pageMeta",
        pageId: p.id,
        pageName: p.name,
        pagePath: p.path,
        field: "socialImageAssetId",
      });
    }
  }

  return out;
}

/** Returns the layer indices where the given assetId is referenced as an image value. */
export function matchImageAssetInStyleValue(value: unknown, assetId: string): number[] {
  if (!value || typeof value !== "object") return [];
  const v = value as { type?: string; value?: unknown };

  // Layered value (e.g. backgroundImage with gradients + image)
  if (v.type === "layers" && Array.isArray(v.value)) {
    const hits: number[] = [];
    v.value.forEach((layer, i) => {
      if (isImageAsset(layer, assetId)) hits.push(i);
    });
    return hits;
  }

  // Single-image value (rare but possible)
  if (isImageAsset(v, assetId)) return [-1];

  return [];
}

function isImageAsset(layer: unknown, assetId: string): boolean {
  if (!layer || typeof layer !== "object") return false;
  const l = layer as { type?: string; value?: unknown };
  if (l.type !== "image") return false;
  const inner = l.value as { type?: string; value?: unknown } | undefined;
  return inner?.type === "asset" && inner?.value === assetId;
}

/** Replace assetId X by Y inside a style value (deep-clone-mutate). Returns the new value + count of swaps. */
export function rewriteAssetInStyleValue(value: unknown, fromId: string, toId: string): { value: unknown; swaps: number } {
  if (!value || typeof value !== "object") return { value, swaps: 0 };
  const v = value as { type?: string; value?: unknown };

  if (v.type === "layers" && Array.isArray(v.value)) {
    let swaps = 0;
    const newLayers = v.value.map((layer) => {
      if (isImageAsset(layer, fromId)) {
        swaps++;
        const l = layer as { type: string; value: { type: string; value: string }; [k: string]: unknown };
        return { ...l, value: { ...l.value, value: toId } };
      }
      return layer;
    });
    if (swaps === 0) return { value, swaps: 0 };
    return { value: { ...v, value: newLayers }, swaps };
  }

  if (isImageAsset(v, fromId)) {
    const newVal = {
      ...(v as object),
      value: { ...(v.value as object), value: toId },
    };
    return { value: newVal, swaps: 1 };
  }

  return { value, swaps: 0 };
}

/** Build a usage-count map for ALL assets in one pass (faster than calling findUsages N times). */
export function countAllUsages(build: WebstudioBuild): Map<string, number> {
  const counts = new Map<string, number>();

  for (const p of build.props as Array<{ type: string; value: unknown }>) {
    if (p.type === "asset" && typeof p.value === "string") {
      counts.set(p.value, (counts.get(p.value) ?? 0) + 1);
    }
  }

  for (const s of build.styles as Array<{ value: unknown }>) {
    countImageAssetsInValue(s.value, counts);
  }

  // Page meta socialImageAssetId references (literal sha256 string).
  for (const p of build.pages.pages) {
    const meta = (p.meta ?? {}) as Record<string, unknown>;
    const assetId = meta.socialImageAssetId;
    if (typeof assetId === "string" && assetId.length > 0) {
      counts.set(assetId, (counts.get(assetId) ?? 0) + 1);
    }
  }

  return counts;
}

function countImageAssetsInValue(value: unknown, counts: Map<string, number>): void {
  if (!value || typeof value !== "object") return;
  const v = value as { type?: string; value?: unknown };

  if (v.type === "layers" && Array.isArray(v.value)) {
    for (const layer of v.value) addIfImageAsset(layer, counts);
    return;
  }
  addIfImageAsset(v, counts);
}

function addIfImageAsset(layer: unknown, counts: Map<string, number>): void {
  if (!layer || typeof layer !== "object") return;
  const l = layer as { type?: string; value?: unknown };
  if (l.type !== "image") return;
  const inner = l.value as { type?: string; value?: unknown } | undefined;
  if (inner?.type === "asset" && typeof inner.value === "string") {
    counts.set(inner.value, (counts.get(inner.value) ?? 0) + 1);
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
