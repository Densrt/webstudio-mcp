// Regression tests for lib/expand-shorthand — CSS shorthand decomposition.
// Bug n°4 discovered on a production site (2026-05-21): shorthand-as-unparsed crashes Webstudio publish.

import { test } from "node:test";
import assert from "node:assert/strict";
import { expandShorthand, isShorthandProperty } from "../dist/lib/expand-shorthand.js";

const u = (raw) => ({ type: "unparsed", value: raw });

// ─── isShorthandProperty ────────────────────────────────────────────────────

test("isShorthandProperty: flex, padding, margin, border, gap", () => {
  for (const p of ["flex", "padding", "margin", "border", "gap", "inset", "borderRadius", "overflow", "placeItems"]) {
    assert.equal(isShorthandProperty(p), true, `${p}`);
  }
});

test("isShorthandProperty: rejected complex shorthands", () => {
  for (const p of ["background", "font", "grid", "animation", "transition", "outline", "textDecoration"]) {
    assert.equal(isShorthandProperty(p), true, `${p}`);
  }
});

test("isShorthandProperty: non-shorthand pass", () => {
  for (const p of ["color", "width", "paddingTop", "flexGrow"]) {
    assert.equal(isShorthandProperty(p), false, `${p}`);
  }
});

// ─── flex ───────────────────────────────────────────────────────────────────

test("flex: '1 1 380px' → grow=1 shrink=1 basis=380px", () => {
  const r = expandShorthand("flex", u("1 1 380px"));
  assert.equal(r.kind, "ok");
  assert.equal(r.decls.length, 3);
  assert.equal(r.decls[0].property, "flexGrow");
  assert.equal(r.decls[0].value.value, 1);
  assert.equal(r.decls[1].property, "flexShrink");
  assert.equal(r.decls[2].property, "flexBasis");
  assert.equal(r.decls[2].value.unit, "px");
  assert.equal(r.decls[2].value.value, 380);
});

test("flex: 'none' → 0 0 auto", () => {
  const r = expandShorthand("flex", u("none"));
  assert.equal(r.kind, "ok");
  assert.equal(r.decls[0].value.value, 0);
  assert.equal(r.decls[1].value.value, 0);
  assert.equal(r.decls[2].value.value, "auto");
});

test("flex: '1' (single number) → 1 1 0", () => {
  const r = expandShorthand("flex", u("1"));
  assert.equal(r.kind, "ok");
  assert.equal(r.decls[0].value.value, 1);
  assert.equal(r.decls[2].value.value, 0);
  assert.equal(r.decls[2].value.unit, "px");
});

test("flex: '2 200px' → grow=2 shrink=1 basis=200px", () => {
  const r = expandShorthand("flex", u("2 200px"));
  assert.equal(r.kind, "ok");
  assert.equal(r.decls[0].value.value, 2);
  assert.equal(r.decls[1].value.value, 1);
  assert.equal(r.decls[2].value.value, 200);
});

// ─── padding / margin / inset (edges rule) ──────────────────────────────────

test("padding: '8px 16px' → top/bottom 8, left/right 16", () => {
  const r = expandShorthand("padding", u("8px 16px"));
  assert.equal(r.kind, "ok");
  assert.equal(r.decls.length, 4);
  const map = Object.fromEntries(r.decls.map((d) => [d.property, d.value.value]));
  assert.equal(map.paddingTop, 8);
  assert.equal(map.paddingRight, 16);
  assert.equal(map.paddingBottom, 8);
  assert.equal(map.paddingLeft, 16);
});

test("padding: '8px' → 4 sides equal", () => {
  const r = expandShorthand("padding", u("8px"));
  assert.equal(r.kind, "ok");
  for (const d of r.decls) assert.equal(d.value.value, 8);
});

test("padding: '8px 16px 12px 24px' → 4 distinct values", () => {
  const r = expandShorthand("padding", u("8px 16px 12px 24px"));
  const map = Object.fromEntries(r.decls.map((d) => [d.property, d.value.value]));
  assert.deepEqual([map.paddingTop, map.paddingRight, map.paddingBottom, map.paddingLeft], [8, 16, 12, 24]);
});

test("margin: '0 auto' → top/bottom 0, left/right auto", () => {
  const r = expandShorthand("margin", u("0 auto"));
  assert.equal(r.kind, "ok");
  const map = Object.fromEntries(r.decls.map((d) => [d.property, d.value]));
  assert.equal(map.marginRight.value, "auto");
  assert.equal(map.marginLeft.value, "auto");
  assert.equal(map.marginTop.value, 0);
});

test("inset: '0' → top/right/bottom/left 0", () => {
  const r = expandShorthand("inset", u("0"));
  assert.equal(r.kind, "ok");
  const props = r.decls.map((d) => d.property).sort();
  assert.deepEqual(props, ["bottom", "left", "right", "top"]);
});

// ─── gap / overflow / placeItems ────────────────────────────────────────────

test("gap: '12px 24px' → rowGap 12px, columnGap 24px", () => {
  const r = expandShorthand("gap", u("12px 24px"));
  assert.equal(r.kind, "ok");
  assert.equal(r.decls[0].property, "rowGap");
  assert.equal(r.decls[0].value.value, 12);
  assert.equal(r.decls[1].property, "columnGap");
  assert.equal(r.decls[1].value.value, 24);
});

test("gap: '16px' → row and column both 16px", () => {
  const r = expandShorthand("gap", u("16px"));
  assert.equal(r.decls[0].value.value, 16);
  assert.equal(r.decls[1].value.value, 16);
});

test("overflow: 'hidden auto' → overflowX hidden, overflowY auto", () => {
  const r = expandShorthand("overflow", u("hidden auto"));
  assert.equal(r.decls[0].property, "overflowX");
  assert.equal(r.decls[0].value.value, "hidden");
  assert.equal(r.decls[1].property, "overflowY");
  assert.equal(r.decls[1].value.value, "auto");
});

test("placeItems: 'center' → alignItems + justifyItems both center", () => {
  const r = expandShorthand("placeItems", u("center"));
  assert.equal(r.decls[0].property, "alignItems");
  assert.equal(r.decls[1].property, "justifyItems");
  assert.equal(r.decls[0].value.value, "center");
});

// ─── borderRadius ───────────────────────────────────────────────────────────

test("borderRadius: '1rem' → 4 corners equal", () => {
  const r = expandShorthand("borderRadius", u("1rem"));
  assert.equal(r.kind, "ok");
  assert.equal(r.decls.length, 4);
  const props = r.decls.map((d) => d.property).sort();
  assert.deepEqual(props, [
    "borderBottomLeftRadius", "borderBottomRightRadius",
    "borderTopLeftRadius", "borderTopRightRadius",
  ]);
  for (const d of r.decls) {
    assert.equal(d.value.value, 1);
    assert.equal(d.value.unit, "rem");
  }
});

test("borderRadius: elliptic '/' syntax rejected", () => {
  const r = expandShorthand("borderRadius", u("10px / 20px"));
  assert.equal(r.kind, "error");
});

// ─── border (the edge case: 3 props × 4 sides = 12 decls) ──────────────────

test("border: '1px solid #fff' → 12 decls (4 sides × 3 props)", () => {
  const r = expandShorthand("border", u("1px solid #fff"));
  assert.equal(r.kind, "ok");
  assert.equal(r.decls.length, 12);
  const widths = r.decls.filter((d) => d.property.endsWith("Width"));
  const styles = r.decls.filter((d) => d.property.endsWith("Style"));
  const colors = r.decls.filter((d) => d.property.endsWith("Color"));
  assert.equal(widths.length, 4);
  assert.equal(styles.length, 4);
  assert.equal(colors.length, 4);
  assert.equal(widths[0].value.value, 1);
  assert.equal(styles[0].value.value, "solid");
});

test("border: '2px dashed' (partial — no color) → 8 decls", () => {
  const r = expandShorthand("border", u("2px dashed"));
  assert.equal(r.kind, "ok");
  assert.equal(r.decls.length, 8);
});

test("borderWidth: '1px 2px' (1-4 edges) → 4 decls", () => {
  const r = expandShorthand("borderWidth", u("1px 2px"));
  assert.equal(r.kind, "ok");
  assert.equal(r.decls.length, 4);
  const map = Object.fromEntries(r.decls.map((d) => [d.property, d.value.value]));
  assert.equal(map.borderTopWidth, 1);
  assert.equal(map.borderRightWidth, 2);
});

// ─── REJECTED shorthands (complex) ──────────────────────────────────────────

test("background shorthand → error with hint to longhands", () => {
  const r = expandShorthand("background", u("#fff url(x.jpg) no-repeat center"));
  assert.equal(r.kind, "error");
  assert.match(r.message, /backgroundColor/);
});

test("font shorthand → error with hint", () => {
  const r = expandShorthand("font", u("16px Arial"));
  assert.equal(r.kind, "error");
  assert.match(r.message, /fontFamily/);
});

test("animation shorthand → error with hint", () => {
  const r = expandShorthand("animation", u("fadeIn 200ms ease"));
  assert.equal(r.kind, "error");
  assert.match(r.message, /animationName/);
});

test("transition shorthand → error with hint", () => {
  const r = expandShorthand("transition", u("transform 200ms ease"));
  assert.equal(r.kind, "error");
  assert.match(r.message, /transitionProperty/);
});

// ─── Passthrough cases ──────────────────────────────────────────────────────

test("non-shorthand property → passthrough", () => {
  const r = expandShorthand("color", { type: "keyword", value: "red" });
  assert.equal(r.kind, "passthrough");
});

test("shorthand with empty unparsed → passthrough", () => {
  const r = expandShorthand("flex", u("   "));
  assert.equal(r.kind, "passthrough");
});

// ─── Typed-value handling on shorthands (a production site incident, 2026-05-21) ──────
// A typed value like {type:"var"} or {type:"unit"} used to be passed through
// untouched, which crashed Webstudio's publish pipeline (the shorthand
// short-circuited the internal model even with the 4 longhands in surcouche).
// Now: uniform shorthands auto-replicate the value to every axis; non-uniform
// (flex, border) reject with a clear hint.

test("padding with typed var() → 4 longhands replicated", () => {
  const v = { type: "var", value: "brand-space-s" };
  const r = expandShorthand("padding", v);
  assert.equal(r.kind, "ok");
  assert.equal(r.decls.length, 4);
  const props = r.decls.map((d) => d.property).sort();
  assert.deepEqual(props, ["paddingBottom", "paddingLeft", "paddingRight", "paddingTop"]);
  for (const d of r.decls) {
    assert.equal(d.value.type, "var");
    assert.equal(d.value.value, "brand-space-s");
  }
});

test("margin with typed unit → 4 longhands replicated", () => {
  const v = { type: "unit", value: 16, unit: "px" };
  const r = expandShorthand("margin", v);
  assert.equal(r.kind, "ok");
  assert.equal(r.decls.length, 4);
  const props = r.decls.map((d) => d.property).sort();
  assert.deepEqual(props, ["marginBottom", "marginLeft", "marginRight", "marginTop"]);
});

test("gap with typed unit → rowGap + columnGap", () => {
  const r = expandShorthand("gap", { type: "unit", value: 12, unit: "px" });
  assert.equal(r.kind, "ok");
  assert.equal(r.decls.length, 2);
  const props = r.decls.map((d) => d.property).sort();
  assert.deepEqual(props, ["columnGap", "rowGap"]);
});

test("borderRadius with typed unit → 4 corners replicated", () => {
  const r = expandShorthand("borderRadius", { type: "unit", value: 8, unit: "px" });
  assert.equal(r.kind, "ok");
  assert.equal(r.decls.length, 4);
});

test("borderColor with typed var → 4 sides replicated", () => {
  const r = expandShorthand("borderColor", { type: "var", value: "brand-primary" });
  assert.equal(r.kind, "ok");
  const props = r.decls.map((d) => d.property).sort();
  assert.deepEqual(props, [
    "borderBottomColor", "borderLeftColor", "borderRightColor", "borderTopColor",
  ]);
});

test("inset with typed keyword → 4 sides replicated", () => {
  const r = expandShorthand("inset", { type: "keyword", value: "0" });
  assert.equal(r.kind, "ok");
  const props = r.decls.map((d) => d.property).sort();
  assert.deepEqual(props, ["bottom", "left", "right", "top"]);
});

test("placeItems with typed keyword → alignItems + justifyItems", () => {
  const r = expandShorthand("placeItems", { type: "keyword", value: "center" });
  assert.equal(r.kind, "ok");
  assert.equal(r.decls.length, 2);
});

test("flex with typed unit → REJECTED (ambiguous)", () => {
  const r = expandShorthand("flex", { type: "unit", value: 1, unit: "number" });
  assert.equal(r.kind, "error");
  assert.match(r.message, /flexGrow|flexShrink|flexBasis/);
});

test("border with typed var → REJECTED (ambiguous)", () => {
  const r = expandShorthand("border", { type: "var", value: "border-default" });
  assert.equal(r.kind, "error");
  assert.match(r.message, /Width|Style|Color/);
});

// ─── grid-child placement (v2.7.2) — a production site bento incident ─────────────────

import { coerceGridChildLonghand } from "../dist/lib/expand-shorthand.js";

test("isShorthandProperty: gridColumn, gridRow", () => {
  assert.equal(isShorthandProperty("gridColumn"), true);
  assert.equal(isShorthandProperty("gridRow"), true);
});

test("gridColumn: '4' → start unit 4, end unit 5 + hint + telemetryKey", () => {
  const r = expandShorthand("gridColumn", u("4"));
  assert.equal(r.kind, "ok");
  assert.equal(r.decls.length, 2);
  assert.equal(r.decls[0].property, "gridColumnStart");
  assert.deepEqual(r.decls[0].value, { type: "unit", value: 4, unit: "number" });
  assert.equal(r.decls[1].property, "gridColumnEnd");
  assert.deepEqual(r.decls[1].value, { type: "unit", value: 5, unit: "number" });
  assert.match(r.hint, /grid-child-placement/);
  assert.match(r.hint, /Manual mode/);
  assert.equal(r.telemetryKey, "expand:gridColumn");
});

test("gridColumn: '4 / 5' → start unit 4, end unit 5 + hint", () => {
  const r = expandShorthand("gridColumn", u("4 / 5"));
  assert.equal(r.kind, "ok");
  assert.deepEqual(r.decls[0].value, { type: "unit", value: 4, unit: "number" });
  assert.deepEqual(r.decls[1].value, { type: "unit", value: 5, unit: "number" });
  assert.match(r.hint, /grid-child-placement/);
});

test("gridColumn: 'span 2' → start auto, end tuple[span, 2]", () => {
  const r = expandShorthand("gridColumn", u("span 2"));
  assert.equal(r.kind, "ok");
  assert.deepEqual(r.decls[0].value, { type: "keyword", value: "auto" });
  assert.equal(r.decls[1].value.type, "tuple");
  assert.deepEqual(r.decls[1].value.value[0], { type: "keyword", value: "span" });
  assert.deepEqual(r.decls[1].value.value[1], { type: "unit", value: 2, unit: "number" });
  assert.match(r.hint, /Area mode/);
});

test("gridColumn: '4 / span 2' → start unit 4, end tuple[span, 2]", () => {
  const r = expandShorthand("gridColumn", u("4 / span 2"));
  assert.equal(r.kind, "ok");
  assert.deepEqual(r.decls[0].value, { type: "unit", value: 4, unit: "number" });
  assert.equal(r.decls[1].value.type, "tuple");
  assert.deepEqual(r.decls[1].value.value[0], { type: "keyword", value: "span" });
  assert.deepEqual(r.decls[1].value.value[1], { type: "unit", value: 2, unit: "number" });
});

test("gridRow: '3' → start unit 3, end unit 4 + telemetryKey expand:gridRow", () => {
  const r = expandShorthand("gridRow", u("3"));
  assert.equal(r.kind, "ok");
  assert.equal(r.decls[0].property, "gridRowStart");
  assert.deepEqual(r.decls[0].value, { type: "unit", value: 3, unit: "number" });
  assert.equal(r.decls[1].property, "gridRowEnd");
  assert.deepEqual(r.decls[1].value, { type: "unit", value: 4, unit: "number" });
  assert.equal(r.telemetryKey, "expand:gridRow");
});

test("gridColumn with typed unit number → expanded to start+end (1-cell span) + telemetryKey", () => {
  const r = expandShorthand("gridColumn", { type: "unit", value: 4, unit: "number" });
  assert.equal(r.kind, "ok");
  assert.deepEqual(r.decls[0].value, { type: "unit", value: 4, unit: "number" });
  assert.deepEqual(r.decls[1].value, { type: "unit", value: 5, unit: "number" });
  assert.match(r.hint, /typed value/);
  assert.equal(r.telemetryKey, "expand:gridColumn-typed");
});

test("gridColumn: 'auto' → start auto, end auto", () => {
  const r = expandShorthand("gridColumn", u("auto"));
  assert.equal(r.kind, "ok");
  assert.deepEqual(r.decls[0].value, { type: "keyword", value: "auto" });
  assert.deepEqual(r.decls[1].value, { type: "keyword", value: "auto" });
});

test("gridColumn: malformed string → error with hint", () => {
  const r = expandShorthand("gridColumn", u("foo / bar / baz"));
  assert.equal(r.kind, "error");
  assert.match(r.message, /grid/i);
});

// coerceGridChildLonghand — longhand-level coerce

test("coerceGridChildLonghand: gridColumnStart unparsed '4' → unit 4 number + hint + telemetryKey", () => {
  const r = coerceGridChildLonghand("gridColumnStart", { type: "unparsed", value: "4" });
  assert.equal(r.kind, "ok");
  assert.equal(r.decls.length, 1);
  assert.equal(r.decls[0].property, "gridColumnStart");
  assert.deepEqual(r.decls[0].value, { type: "unit", value: 4, unit: "number" });
  assert.match(r.hint, /unit.*number/);
  assert.match(r.hint, /grid-child-placement/);
  assert.equal(r.telemetryKey, "coerce:gridChildLonghand-digit");
});

test("coerceGridChildLonghand: gridRowEnd unparsed 'span 2' → tuple[span, 2] + telemetryKey", () => {
  const r = coerceGridChildLonghand("gridRowEnd", { type: "unparsed", value: "span 2" });
  assert.equal(r.kind, "ok");
  assert.equal(r.decls[0].value.type, "tuple");
  assert.deepEqual(r.decls[0].value.value[0], { type: "keyword", value: "span" });
  assert.deepEqual(r.decls[0].value.value[1], { type: "unit", value: 2, unit: "number" });
  assert.equal(r.telemetryKey, "coerce:gridChildLonghand-span");
});

test("coerceGridChildLonghand: gridColumnStart already typed → passthrough", () => {
  const r = coerceGridChildLonghand("gridColumnStart", { type: "unit", value: 4, unit: "number" });
  assert.equal(r.kind, "passthrough");
});

test("coerceGridChildLonghand: gridRowStart unparsed 'auto' → passthrough (not a coerce target)", () => {
  const r = coerceGridChildLonghand("gridRowStart", { type: "unparsed", value: "auto" });
  assert.equal(r.kind, "passthrough");
});

test("coerceGridChildLonghand: non-grid property → passthrough", () => {
  const r = coerceGridChildLonghand("color", { type: "unparsed", value: "4" });
  assert.equal(r.kind, "passthrough");
});

test("coerceGridChildLonghand: 4 longhands all supported", () => {
  for (const prop of ["gridColumnStart", "gridColumnEnd", "gridRowStart", "gridRowEnd"]) {
    const r = coerceGridChildLonghand(prop, { type: "unparsed", value: "7" });
    assert.equal(r.kind, "ok", `${prop} should coerce`);
    assert.equal(r.decls[0].property, prop);
    assert.deepEqual(r.decls[0].value, { type: "unit", value: 7, unit: "number" });
  }
});

// ─── aspectRatio whitespace normalization (v2.7.3) ────────────────────────

import { coerceAspectRatio } from "../dist/lib/expand-shorthand.js";

test("coerceAspectRatio: '16/9' → '16 / 9' + hint + telemetryKey", () => {
  const r = coerceAspectRatio("aspectRatio", { type: "unparsed", value: "16/9" });
  assert.equal(r.kind, "ok");
  assert.deepEqual(r.decls[0].value, { type: "unparsed", value: "16 / 9" });
  assert.match(r.hint, /normalized from "16\/9" to "16 \/ 9"/);
  assert.match(r.hint, /grid-child-placement/);
  assert.equal(r.telemetryKey, "coerce:aspectRatio");
});

test("coerceAspectRatio: '16 / 9' → passthrough (already canonical)", () => {
  const r = coerceAspectRatio("aspectRatio", { type: "unparsed", value: "16 / 9" });
  assert.equal(r.kind, "passthrough");
});

test("coerceAspectRatio: '16  /  9' (double spaces) → '16 / 9'", () => {
  const r = coerceAspectRatio("aspectRatio", { type: "unparsed", value: "16  /  9" });
  assert.equal(r.kind, "ok");
  assert.deepEqual(r.decls[0].value, { type: "unparsed", value: "16 / 9" });
});

test("coerceAspectRatio: '4/3' → '4 / 3'", () => {
  const r = coerceAspectRatio("aspectRatio", { type: "unparsed", value: "4/3" });
  assert.equal(r.kind, "ok");
  assert.deepEqual(r.decls[0].value, { type: "unparsed", value: "4 / 3" });
});

test("coerceAspectRatio: keyword 'auto' → passthrough", () => {
  const r = coerceAspectRatio("aspectRatio", { type: "keyword", value: "auto" });
  assert.equal(r.kind, "passthrough");
});

test("coerceAspectRatio: keyword 'inherit' → passthrough", () => {
  const r = coerceAspectRatio("aspectRatio", { type: "keyword", value: "inherit" });
  assert.equal(r.kind, "passthrough");
});

test("coerceAspectRatio: non-aspectRatio property → passthrough", () => {
  const r = coerceAspectRatio("width", { type: "unparsed", value: "16/9" });
  assert.equal(r.kind, "passthrough");
});

test("coerceAspectRatio: malformed value (no slash) → passthrough", () => {
  const r = coerceAspectRatio("aspectRatio", { type: "unparsed", value: "16" });
  assert.equal(r.kind, "passthrough");
});

test("coerceAspectRatio: malformed value (3 segments) → passthrough", () => {
  const r = coerceAspectRatio("aspectRatio", { type: "unparsed", value: "16/9/2" });
  assert.equal(r.kind, "passthrough");
});

// ─── detectManualSingleCellPattern (v2.7.3) — Anti-pattern C detector ──────

import { detectManualSingleCellPattern } from "../dist/lib/expand-shorthand.js";

const manualCellSet = (instanceId, col, row, breakpoint = "base") => [
  { instanceId, property: "gridColumnStart", value: { type: "unit", value: col, unit: "number" }, breakpoint },
  { instanceId, property: "gridColumnEnd",   value: { type: "unit", value: col + 1, unit: "number" }, breakpoint },
  { instanceId, property: "gridRowStart",    value: { type: "unit", value: row, unit: "number" }, breakpoint },
  { instanceId, property: "gridRowEnd",      value: { type: "unit", value: row + 1, unit: "number" }, breakpoint },
];

test("detectManualSingleCellPattern: 4 single-cell Manual instances → 1 hint", () => {
  const updates = [
    ...manualCellSet("a", 1, 1),
    ...manualCellSet("b", 3, 1),
    ...manualCellSet("c", 1, 2),
    ...manualCellSet("d", 3, 2),
  ];
  const hits = detectManualSingleCellPattern(updates);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].count, 4);
  assert.equal(hits[0].breakpoint, "base");
  assert.equal(hits[0].telemetryKey, "detect:manual-single-cell");
  assert.match(hits[0].hint, /4 instances/);
  assert.match(hits[0].hint, /Manual single-cell/);
  assert.match(hits[0].hint, /Area span 1/);
  assert.match(hits[0].hint, /grid-child-placement/);
  assert.match(hits[0].hint, /Anti-pattern C/);
});

test("detectManualSingleCellPattern: 2 instances → no hint (under threshold)", () => {
  const updates = [
    ...manualCellSet("a", 1, 1),
    ...manualCellSet("b", 3, 1),
  ];
  const hints = detectManualSingleCellPattern(updates);
  assert.equal(hints.length, 0);
});

test("detectManualSingleCellPattern: 3 instances → 1 hit (at threshold)", () => {
  const updates = [
    ...manualCellSet("a", 1, 1),
    ...manualCellSet("b", 3, 1),
    ...manualCellSet("c", 1, 2),
  ];
  const hits = detectManualSingleCellPattern(updates);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].count, 3);
  assert.match(hits[0].hint, /3 instances/);
});

test("detectManualSingleCellPattern: instance with multi-cell Manual → not counted", () => {
  // Acme centre: col 2, rows 1-2 (span 2 rows manually)
  const acme = [
    { instanceId: "acme", property: "gridColumnStart", value: { type: "unit", value: 2, unit: "number" }, breakpoint: "base" },
    { instanceId: "acme", property: "gridColumnEnd",   value: { type: "unit", value: 3, unit: "number" }, breakpoint: "base" },
    { instanceId: "acme", property: "gridRowStart",    value: { type: "unit", value: 1, unit: "number" }, breakpoint: "base" },
    { instanceId: "acme", property: "gridRowEnd",      value: { type: "unit", value: 3, unit: "number" }, breakpoint: "base" }, // rows 1-2 = end 3 (NOT single-cell)
  ];
  const updates = [...acme, ...manualCellSet("b", 3, 1)];
  const hints = detectManualSingleCellPattern(updates);
  assert.equal(hints.length, 0); // only 1 single-cell (b), Acme is excluded
});

test("detectManualSingleCellPattern: Area span tuples → not counted (good pattern)", () => {
  const spanTuple = { type: "tuple", value: [{ type: "keyword", value: "span" }, { type: "unit", value: 1, unit: "number" }] };
  const areaCard = (id) => [
    { instanceId: id, property: "gridColumnStart", value: spanTuple, breakpoint: "base" },
    { instanceId: id, property: "gridColumnEnd",   value: spanTuple, breakpoint: "base" },
    { instanceId: id, property: "gridRowStart",    value: spanTuple, breakpoint: "base" },
    { instanceId: id, property: "gridRowEnd",      value: spanTuple, breakpoint: "base" },
  ];
  const updates = [...areaCard("a"), ...areaCard("b"), ...areaCard("c"), ...areaCard("d")];
  const hints = detectManualSingleCellPattern(updates);
  assert.equal(hints.length, 0); // already span 1, nothing to suggest
});

test("detectManualSingleCellPattern: split across breakpoints → per-breakpoint threshold", () => {
  // 3 instances on base + 3 on tablet → 2 hits (one per breakpoint)
  const updates = [
    ...manualCellSet("a", 1, 1, "base"),
    ...manualCellSet("b", 3, 1, "base"),
    ...manualCellSet("c", 1, 2, "base"),
    ...manualCellSet("d", 1, 1, "tablet"),
    ...manualCellSet("e", 3, 1, "tablet"),
    ...manualCellSet("f", 1, 2, "tablet"),
  ];
  const hits = detectManualSingleCellPattern(updates);
  assert.equal(hits.length, 2);
  assert.ok(hits.some((h) => h.breakpoint === "base"));
  assert.ok(hits.some((h) => h.breakpoint === "tablet"));
});

test("detectManualSingleCellPattern: minInstances configurable", () => {
  const updates = [
    ...manualCellSet("a", 1, 1),
    ...manualCellSet("b", 3, 1),
  ];
  // Default threshold 3 → no hint
  assert.equal(detectManualSingleCellPattern(updates).length, 0);
  // Lowered threshold 2 → 1 hint
  assert.equal(detectManualSingleCellPattern(updates, 2).length, 1);
});

test("detectManualSingleCellPattern: instance with incomplete grid decls → not counted", () => {
  // Only gridColumnStart/End — missing Row decls
  const updates = [
    { instanceId: "a", property: "gridColumnStart", value: { type: "unit", value: 1, unit: "number" }, breakpoint: "base" },
    { instanceId: "a", property: "gridColumnEnd",   value: { type: "unit", value: 2, unit: "number" }, breakpoint: "base" },
    ...manualCellSet("b", 1, 1),
    ...manualCellSet("c", 3, 1),
    ...manualCellSet("d", 1, 2),
  ];
  const hits = detectManualSingleCellPattern(updates);
  // a has only 2 props → excluded. b, c, d complete = 3 → 1 hit
  assert.equal(hits.length, 1);
  assert.equal(hits[0].count, 3);
});
