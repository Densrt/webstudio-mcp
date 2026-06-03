// CSS shorthand expansion (builder-side adapter).
//
// Delegates to the canonical `lib/expand-shorthand.ts` so build-time and
// push-time tools share one source of truth. Behavioral differences vs the
// previous local implementation:
//   - typed `var()` / `unit` / `color` values on uniform shorthands (padding,
//     margin, inset, gap, borderRadius, borderWidth/Style/Color, place*,
//     overflow, overscrollBehavior) → replicated atomically to every axis
//     (the original shorthand decl is replaced).
//   - typed values on `flex` / `border` → throw (ambiguous mapping to axes).
//   - unparsed strings on supported shorthands → parsed and expanded.
//   - complex shorthands (background, font, grid, animation, transition,
//     outline, textDecoration, listStyle, mask) → throw with a longhand hint.
//
// a production site (2026-05-21) incident: `padding: var(--s)` posted through the build
// path crashed the Webstudio publish pipeline AND could not be neutralised by
// adding the 4 longhands in surcouche — the shorthand short-circuited the
// internal model.

import type { StyleValue } from "../types.js";
import { expandShorthand as expandShorthandLib } from "../lib/expand-shorthand.js";

export function expandShorthand(property: string, value: StyleValue): [string, StyleValue][] {
  const r = expandShorthandLib(property, value);
  if (r.kind === "error") {
    throw new Error(`Invalid shorthand ${property}: ${r.message}`);
  }
  if (r.kind === "ok") {
    return r.decls.map((d) => [d.property, d.value] as [string, StyleValue]);
  }
  return [[property, value]];
}
