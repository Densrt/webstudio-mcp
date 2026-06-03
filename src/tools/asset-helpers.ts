// Shared helpers for the delete_asset / delete_assets tools — sha256 prefix resolution.
//
// Webstudio asset ids are 64-char sha256 hex digests. Copy-pasting full ids from logs is painful,
// so we accept prefixes (>= 8 chars) and resolve them to a single asset.

import type { WebstudioBuild } from "../webstudio-client.js";
import { getAssets, type Asset } from "../lib/asset-helpers.js";

export const ASSET_PREFIX_MIN = 8;

export type AssetResolution =
  | { kind: "found"; asset: Asset }
  | { kind: "not_found" }
  | { kind: "ambiguous"; matches: Asset[] }
  | { kind: "prefix_too_short"; min: number };

/**
 * Resolve an input string (full id OR sha256 prefix) to a single asset.
 *
 * Rules:
 *  - Exact match on asset.id wins immediately (1 match).
 *  - Otherwise: prefix match. < ASSET_PREFIX_MIN chars and no exact hit → "prefix_too_short".
 *  - 1 prefix match → "found".
 *  - 0 prefix match → "not_found".
 *  - N>1 prefix match → "ambiguous" (caller decides UX).
 */
export function resolveAssetByIdOrPrefix(
  build: WebstudioBuild,
  input: string,
): AssetResolution {
  const assets = getAssets(build);
  const exact = assets.find((a) => a.id === input);
  if (exact) return { kind: "found", asset: exact };

  if (input.length < ASSET_PREFIX_MIN) return { kind: "prefix_too_short", min: ASSET_PREFIX_MIN };

  const prefixMatches = assets.filter((a) => a.id.startsWith(input));
  if (prefixMatches.length === 0) return { kind: "not_found" };
  if (prefixMatches.length === 1) return { kind: "found", asset: prefixMatches[0] };
  return { kind: "ambiguous", matches: prefixMatches };
}
