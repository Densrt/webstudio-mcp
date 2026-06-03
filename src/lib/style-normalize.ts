// Normalize StyleValue right before pushing to Webstudio Cloud.
//
// Bug context (2026-05-13): the internal "color" format
//   { type: "color", colorSpace: "rgb"|"hex", components: [r,g,b], alpha }
// is rejected by the server for some properties (borderTopColor, CSS custom property values,
// etc.). Webstudio's own storage format observed in real exports is
//   { type: "rgb", r: 0..255, g: 0..255, b: 0..255, alpha: 0..1 }
//
// This module transforms our internal "color" StyleValues into that wire-format `rgb` shape
// right before serialization. Also walks recursive containers (tuple, function args, layers,
// shadow) so colors nested inside box-shadow / drop-shadow / gradient / etc. get normalized too.
//
// Bug context (2026-05-22, my-site build 4205): components were treated as 0..255 when
// colorSpace === "rgb" — but parseStringToStyleValue produces 0..1 normalized (same as hex,
// covered by test/parse-style-value.test.mjs). Result: "rgb(249,249,249)" became wire
// {r:1,g:1,b:1} (Math.round(0.976) = 1). Fix in v2.7.11: convention is now **0..1 internal,
// regardless of colorSpace**. A heuristic detects legacy 0..255 callers (max component > 1)
// and converts them with a hint+telemetryKey so adoption can be tracked.

import type { StyleValue } from "../types.js";

type ServerRgb = { type: "rgb"; r: number; g: number; b: number; alpha: number };

/**
 * Meta returned alongside the normalized value when callers want pedagogical hints + telemetry.
 * Empty arrays when no silent coercion happened.
 */
export type NormalizeMeta = {
  hints: string[];
  telemetryKeys: string[];
};

/**
 * Convert a StyleValue (internal shape) to the wire-format the server expects.
 * Backward-compatible API: returns the StyleValue only, drops the meta. Use
 * `normalizeStyleValueWithMeta` if you need the hints/telemetry keys.
 *
 * Recursion is shallow and safe: returns the original ref if nothing changed (cheap), otherwise
 * a new object with normalized children.
 */
export function normalizeStyleValue(value: StyleValue): StyleValue {
  return normalizeStyleValueWithMeta(value).value;
}

/**
 * Same as normalizeStyleValue but also reports any silent coercions applied (legacy 0..255
 * components detected, etc.) so the caller can:
 *   - surface a pedagogical `hint` to the agent ("you passed 0..255, internal convention is 0..1")
 *   - emit `logCoerce(telemetryKey, ...)` for the weekly report
 *
 * Hints/telemetryKeys are deduped at the recursion site (a single push emits at most one entry
 * per kind per call).
 */
export function normalizeStyleValueWithMeta(value: StyleValue): { value: StyleValue; meta: NormalizeMeta } {
  const meta: NormalizeMeta = { hints: [], telemetryKeys: [] };
  const out = walk(value, meta);
  // dedupe hints + telemetryKeys (a tree with many same-shape colors should emit once)
  meta.hints = [...new Set(meta.hints)];
  meta.telemetryKeys = [...new Set(meta.telemetryKeys)];
  return { value: out, meta };
}

function walk(value: StyleValue, meta: NormalizeMeta): StyleValue {
  if (value.type === "color") {
    return colorToServerRgb(value, meta) as unknown as StyleValue;
  }
  if (value.type === "var" && value.fallback) {
    const normalizedFb = walk(value.fallback, meta);
    return normalizedFb === value.fallback ? value : { ...value, fallback: normalizedFb };
  }
  if (value.type === "layers" || value.type === "tuple") {
    let changed = false;
    const next = value.value.map((v) => {
      const n = walk(v, meta);
      if (n !== v) changed = true;
      return n;
    });
    return changed ? { ...value, value: next } : value;
  }
  if (value.type === "function") {
    const args = walk(value.args, meta);
    return args === value.args ? value : { ...value, args };
  }
  if (value.type === "shadow") {
    const next = {
      ...value,
      offsetX: walk(value.offsetX, meta),
      offsetY: walk(value.offsetY, meta),
      blur: walk(value.blur, meta),
      spread: walk(value.spread, meta),
      color: walk(value.color, meta),
    };
    return next;
  }
  return value;
}

/**
 * Convert internal color (with colorSpace + components) to Webstudio's wire `rgb` format.
 *
 * Internal convention (v2.7.11+): **components are 0..1 normalised**, regardless of
 * colorSpace name. Both `parseStringToStyleValue` (define-css-var) and `parseHexColor`
 * (expand-shorthand) produce 0..1.
 *
 * Backward-compat heuristic: if any component is > 1, the input is assumed to be the
 * legacy 0..255 form (some callers historically passed `{components:[249,249,249]}` and it
 * worked by accident pre-v2.7.11). We accept it but report via `hint`+`telemetryKey` so
 * adoption of the canonical 0..1 form can be tracked in the weekly telemetry report.
 *
 * Edge cases:
 *   - Missing components → black
 *   - Out-of-range alpha → clamp to [0, 1]
 */
function colorToServerRgb(
  c: {
    type: "color";
    colorSpace: "hex" | "rgb" | "hsl" | "lab" | "lch" | "oklab" | "oklch";
    components: number[];
    alpha: number;
  },
  meta: NormalizeMeta,
): ServerRgb {
  const [c0 = 0, c1 = 0, c2 = 0] = c.components;
  const maxComp = Math.max(c0, c1, c2);
  const legacy0_255 = maxComp > 1;

  let r: number;
  let g: number;
  let b: number;

  if (legacy0_255) {
    // Legacy form: components already in 0..255. Pass through with clamp.
    r = Math.round(clampInt(c0, 0, 255));
    g = Math.round(clampInt(c1, 0, 255));
    b = Math.round(clampInt(c2, 0, 255));
    meta.hints.push(
      `Color components passed as 0..255 (legacy form). Canonical internal convention is 0..1 — both forms accepted, but prefer string form ("rgb(r,g,b)", "#rrggbb") or 0..1 floats to avoid this hint. See pattern style-value-color-format.`,
    );
    meta.telemetryKeys.push("coerce:colorRgb-legacy-0-255");
  } else {
    // Canonical form: components in 0..1, scale to wire 0..255.
    r = Math.round(clamp01(c0) * 255);
    g = Math.round(clamp01(c1) * 255);
    b = Math.round(clamp01(c2) * 255);
  }

  const alpha = Math.max(0, Math.min(1, c.alpha));
  return { type: "rgb", r, g, b, alpha };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
