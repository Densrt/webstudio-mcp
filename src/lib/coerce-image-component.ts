// Coerce raw <img> instances to the native Image component (v2.18.0).
//
// Cas réel (Denis, 2026-06-10): callers systematically pushed
// `ws:element` + `tag:"img"` instead of the native `Image` component. Root
// cause: the debunked "Image requires an asset id" myth (see pattern
// image-component — `Image.src` accepts asset | URL string | expression),
// which the codebase itself propagated (types.ts comment, cards/swiper
// fallbacks). Raw imgs lose the builder's image panel, the optimization
// pipeline (srcset/lazy on assets) and are invisible to audit.images.
//
// The conversion is unconditionally safe: props pass through unchanged
// (src/alt/width/height/loading are all valid Image props, string src
// included), styles attach by instanceId (untouched), and an <img> has no
// children. Mutates the instances in place — call it on a freshly built
// fragment payload BEFORE any transaction is derived from it.

import type { Instance } from "../types.js";

const RAW_IMG_COMPONENTS = new Set(["ws:element", "Box"]);

export type ImageCoerceResult = {
  count: number;
  converted: Array<{ id: string; label?: string }>;
  /** Pedagogical hint to surface in the tool response (undefined when count=0). */
  hint?: string;
  /** Telemetry key for logCoerce (undefined when count=0). */
  telemetryKey?: string;
};

export function coerceRawImgInstances(instances: Instance[]): ImageCoerceResult {
  const converted: Array<{ id: string; label?: string }> = [];
  for (const inst of instances) {
    if (!RAW_IMG_COMPONENTS.has(inst.component)) continue;
    if ((inst as { tag?: string }).tag !== "img") continue;
    inst.component = "Image";
    delete (inst as { tag?: string }).tag;
    converted.push({ id: inst.id, label: inst.label });
  }
  if (converted.length === 0) return { count: 0, converted };
  return {
    count: converted.length,
    converted,
    hint:
      `${converted.length} raw <img> instance(s) auto-converted to the native Image component ` +
      `(src accepts asset | URL string | expression — pattern image-component). ` +
      `Write component:"Image" directly next time: raw ws:element img loses the builder image panel, ` +
      `asset optimization, and audit coverage.`,
    telemetryKey: "coerce:image-component",
  };
}
