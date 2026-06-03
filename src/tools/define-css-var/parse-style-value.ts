// Smart string → StyleValue parser for webstudio_css_var.
//
// The Webstudio API requires CSS values as typed objects (StyleValue). Hand-authoring
// dozens of them (e.g. when importing a full brand charter) is painful: people naturally
// think in raw CSS strings like "#FEFEFE", "1.5rem", "var(--space-4)", "clamp(...)".
//
// This module deduces the right StyleValue shape from a raw CSS string by regex matching,
// in priority order. Anything unrecognized falls back to {type:"unparsed", value:<string>}
// which Webstudio renders as-is.
//
// Reference for StyleValue: src/types.ts (canonical) + src/build-from-args.ts (zod).

import type { StyleValue } from "../../types.js";

const CSS_KEYWORDS = new Set([
  "auto",
  "inherit",
  "initial",
  "unset",
  "transparent",
  "currentColor",
  "none",
]);

const UNIT_RX = /^(-?\d*\.?\d+)(px|rem|em|%|vh|vw|fr|ch|s|ms|deg)$/;
const NUMBER_RX = /^-?\d*\.?\d+$/;
const HEX3_RX = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/;
const HEX6_RX = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/;
const RGB_RX = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/;
const VAR_RX = /^var\(\s*--([\w-]+)\s*\)$/;

/** Parse a raw CSS string into a Webstudio StyleValue object.
 *  Priority order: hex color → rgb()/rgba() → var() → keywords → unit → bare number → unparsed.
 *  Never throws; unknown inputs become {type:"unparsed", value:<input>}. */
export function parseStringToStyleValue(raw: string): StyleValue {
  const s = raw.trim();

  // Hex shorthand: #abc → expand to #aabbcc
  // Components MUST be in [0-1] range. Webstudio renders via Math.round(c * 255) and
  // clamps to [0,1] first — passing 0-255 makes every value > 0 collapse to 255 (white).
  const m3 = HEX3_RX.exec(s);
  if (m3) {
    const r = parseInt(m3[1] + m3[1], 16) / 255;
    const g = parseInt(m3[2] + m3[2], 16) / 255;
    const b = parseInt(m3[3] + m3[3], 16) / 255;
    return { type: "color", colorSpace: "hex", components: [r, g, b], alpha: 1 };
  }

  // Hex full: #aabbcc
  const m6 = HEX6_RX.exec(s);
  if (m6) {
    const r = parseInt(m6[1], 16) / 255;
    const g = parseInt(m6[2], 16) / 255;
    const b = parseInt(m6[3], 16) / 255;
    return { type: "color", colorSpace: "hex", components: [r, g, b], alpha: 1 };
  }

  // rgb() / rgba()
  const mRgb = RGB_RX.exec(s);
  if (mRgb) {
    const r = Number(mRgb[1]) / 255;
    const g = Number(mRgb[2]) / 255;
    const b = Number(mRgb[3]) / 255;
    const alpha = mRgb[4] !== undefined ? Number(mRgb[4]) : 1;
    return { type: "color", colorSpace: "rgb", components: [r, g, b], alpha };
  }

  // var(--name)
  const mVar = VAR_RX.exec(s);
  if (mVar) {
    return { type: "var", value: mVar[1] };
  }

  // Canonical CSS keywords
  if (CSS_KEYWORDS.has(s)) {
    return { type: "keyword", value: s };
  }

  // Unit (px, rem, %, vh, etc.)
  const mUnit = UNIT_RX.exec(s);
  if (mUnit) {
    return { type: "unit", unit: mUnit[2], value: Number(mUnit[1]) };
  }

  // Bare number → {type:"unit", unit:"number"} (used for lineHeight, opacity, z-index, etc.)
  if (NUMBER_RX.test(s)) {
    return { type: "unit", unit: "number", value: Number(s) };
  }

  // Fallback: anything else (calc, clamp, linear-gradient, multi-value shorthands, ...)
  return { type: "unparsed", value: s };
}

/** Extract every `var(--name)` reference found inside a raw CSS string.
 *  Used to detect dangling var refs in {type:"unparsed"} values (e.g. inside calc/clamp). */
export function extractVarRefs(s: string): string[] {
  const out: string[] = [];
  const re = /var\(\s*--([\w-]+)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) out.push(m[1]);
  return out;
}
