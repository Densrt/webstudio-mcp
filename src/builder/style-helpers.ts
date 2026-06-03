// StyleValue constructors — concise factories for the most common Webstudio style shapes.

import type { StyleValue } from "../types.js";

export const px = (value: number): StyleValue => ({ type: "unit", value, unit: "px" });
export const rem = (value: number): StyleValue => ({ type: "unit", value, unit: "rem" });
export const pct = (value: number): StyleValue => ({ type: "unit", value, unit: "%" });
export const num = (value: number): StyleValue => ({ type: "unit", value, unit: "number" });
export const keyword = (value: string): StyleValue => ({ type: "keyword", value });
export const cssVar = (name: string, fallback?: StyleValue): StyleValue => ({ type: "var", value: name, fallback });
export const raw = (value: string): StyleValue => ({ type: "unparsed", value });

/**
 * Build the trio of transition longhands as a partial style map.
 * The `transition` shorthand is rejected at the boundary (a production site, 2026-05-21),
 * so component definitions must spread these three longhands instead.
 *
 * Example: `...transitionLonghands("opacity", "200ms", "ease")`
 * Optional delay: `...transitionLonghands("opacity", "200ms", "ease", "50ms")`
 */
export const transitionLonghands = (
  property: string,
  duration: string,
  timing: string,
  delay?: string,
): Record<string, StyleValue> => ({
  transitionProperty: { type: "unparsed", value: property },
  transitionDuration: { type: "unparsed", value: duration },
  transitionTimingFunction: { type: "unparsed", value: timing },
  ...(delay ? { transitionDelay: { type: "unparsed", value: delay } } : {}),
});

// Color in Webstudio's extended format (components in 0..1).
// IMPORTANT: the simple form {type:"color", value:"#hex"} is REJECTED by Webstudio.
// Accepts a hex string ("#ffffff" or "#fff") or direct RGB(A) components.
export const color = (input: string | { r: number; g: number; b: number; a?: number }): StyleValue => {
  if (typeof input === "string") {
    let hex = input.startsWith("#") ? input.slice(1) : input;
    if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    return { type: "color", colorSpace: "hex", components: [r, g, b], alpha: 1 };
  }
  return {
    type: "color",
    colorSpace: "hex",
    components: [input.r, input.g, input.b],
    alpha: input.a ?? 1,
  };
};
