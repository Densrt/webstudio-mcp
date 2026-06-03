// Regression tests for lib/style-normalize — color StyleValue → wire format.
//
// Bug v2.7.11 (cas réel build cssvar 2026-05-22):
//   Caller posts "rgb(249, 249, 249)" → parser produces components [0.976, 0.976, 0.976]
//   (0..1 normalized). Pre-fix normalize treated colorSpace="rgb" as 0..255 and emitted
//   wire {r:1, g:1, b:1} (Math.round(0.976) = 1) — quasi-black instead of quasi-white.
//
// Convention v2.7.11+: components are ALWAYS 0..1 internally regardless of colorSpace name.
// A backward-compat heuristic detects legacy 0..255 input (max > 1) and emits a hint +
// `coerce:colorRgb-legacy-0-255` telemetry key.

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeStyleValue, normalizeStyleValueWithMeta } from "../dist/lib/style-normalize.js";
import { parseStringToStyleValue } from "../dist/tools/define-css-var/parse-style-value.js";

// ─── String round-trip (parser → normalize → wire) ──────────────────────────

test("string round-trip — rgb(249,249,249) → wire (249,249,249)", () => {
  const parsed = parseStringToStyleValue("rgb(249, 249, 249)");
  const { value, meta } = normalizeStyleValueWithMeta(parsed);
  assert.deepEqual(value, { type: "rgb", r: 249, g: 249, b: 249, alpha: 1 });
  assert.deepEqual(meta.hints, []);
  assert.deepEqual(meta.telemetryKeys, []);
});

test("string round-trip — rgb(0,0,0) → wire (0,0,0)", () => {
  const wire = normalizeStyleValue(parseStringToStyleValue("rgb(0, 0, 0)"));
  assert.deepEqual(wire, { type: "rgb", r: 0, g: 0, b: 0, alpha: 1 });
});

test("string round-trip — rgb(128,128,128) → wire (128,128,128)", () => {
  const wire = normalizeStyleValue(parseStringToStyleValue("rgb(128, 128, 128)"));
  assert.deepEqual(wire, { type: "rgb", r: 128, g: 128, b: 128, alpha: 1 });
});

test("string round-trip — rgb(255,255,255) → wire (255,255,255)", () => {
  const wire = normalizeStyleValue(parseStringToStyleValue("rgb(255, 255, 255)"));
  assert.deepEqual(wire, { type: "rgb", r: 255, g: 255, b: 255, alpha: 1 });
});

test("string round-trip — rgba(255,100,50,0.5) → wire with alpha 0.5", () => {
  const wire = normalizeStyleValue(parseStringToStyleValue("rgba(255, 100, 50, 0.5)"));
  assert.deepEqual(wire, { type: "rgb", r: 255, g: 100, b: 50, alpha: 0.5 });
});

test("string round-trip — #ff0000 → wire (255,0,0)", () => {
  const wire = normalizeStyleValue(parseStringToStyleValue("#ff0000"));
  assert.deepEqual(wire, { type: "rgb", r: 255, g: 0, b: 0, alpha: 1 });
});

test("string round-trip — #abc → wire (170,187,204)", () => {
  const wire = normalizeStyleValue(parseStringToStyleValue("#abc"));
  // 0xaa=170, 0xbb=187, 0xcc=204
  assert.deepEqual(wire, { type: "rgb", r: 170, g: 187, b: 204, alpha: 1 });
});

test("string round-trip — Acme #009BB4 → wire (0,155,180)", () => {
  const wire = normalizeStyleValue(parseStringToStyleValue("#009BB4"));
  assert.deepEqual(wire, { type: "rgb", r: 0, g: 155, b: 180, alpha: 1 });
});

// ─── Object canonical form (components 0..1) ────────────────────────────────

test("object canonical 0..1 — {components:[0,0,0]} → wire (0,0,0), no hint", () => {
  const { value, meta } = normalizeStyleValueWithMeta({
    type: "color",
    colorSpace: "rgb",
    components: [0, 0, 0],
    alpha: 1,
  });
  assert.deepEqual(value, { type: "rgb", r: 0, g: 0, b: 0, alpha: 1 });
  assert.deepEqual(meta.hints, []);
  assert.deepEqual(meta.telemetryKeys, []);
});

test("object canonical 0..1 — {components:[1,1,1]} → wire (255,255,255), no hint", () => {
  const { value, meta } = normalizeStyleValueWithMeta({
    type: "color",
    colorSpace: "rgb",
    components: [1, 1, 1],
    alpha: 1,
  });
  assert.deepEqual(value, { type: "rgb", r: 255, g: 255, b: 255, alpha: 1 });
  assert.deepEqual(meta.hints, []);
  assert.deepEqual(meta.telemetryKeys, []);
});

test("object canonical 0..1 — fractional components scale correctly", () => {
  const { value, meta } = normalizeStyleValueWithMeta({
    type: "color",
    colorSpace: "rgb",
    components: [0.976, 0.976, 0.976], // 249/255
    alpha: 1,
  });
  assert.deepEqual(value, { type: "rgb", r: 249, g: 249, b: 249, alpha: 1 });
  assert.deepEqual(meta.hints, []);
  assert.deepEqual(meta.telemetryKeys, []);
});

test("object canonical 0..1 — hex colorSpace works the same way", () => {
  const { value, meta } = normalizeStyleValueWithMeta({
    type: "color",
    colorSpace: "hex",
    components: [0.5, 0.5, 0.5],
    alpha: 1,
  });
  assert.deepEqual(value, { type: "rgb", r: 128, g: 128, b: 128, alpha: 1 });
  assert.deepEqual(meta.hints, []);
  assert.deepEqual(meta.telemetryKeys, []);
});

// ─── Object legacy form (components 0..255) — accepted with hint ────────────

test("object legacy 0..255 — {components:[249,249,249]} → wire (249,249,249) + hint + telemetryKey", () => {
  const { value, meta } = normalizeStyleValueWithMeta({
    type: "color",
    colorSpace: "rgb",
    components: [249, 249, 249],
    alpha: 1,
  });
  assert.deepEqual(value, { type: "rgb", r: 249, g: 249, b: 249, alpha: 1 });
  assert.equal(meta.hints.length, 1);
  assert.ok(meta.hints[0].includes("0..255"), "hint should mention 0..255");
  assert.ok(meta.hints[0].includes("style-value-color-format"), "hint should point to pattern");
  assert.deepEqual(meta.telemetryKeys, ["coerce:colorRgb-legacy-0-255"]);
});

test("object legacy 0..255 — {components:[255,0,0]} (red) → wire (255,0,0) + hint", () => {
  const { value, meta } = normalizeStyleValueWithMeta({
    type: "color",
    colorSpace: "rgb",
    components: [255, 0, 0],
    alpha: 1,
  });
  assert.deepEqual(value, { type: "rgb", r: 255, g: 0, b: 0, alpha: 1 });
  assert.equal(meta.telemetryKeys.length, 1);
});

test("object legacy 0..255 — clamp out-of-range up to 255", () => {
  const { value } = normalizeStyleValueWithMeta({
    type: "color",
    colorSpace: "rgb",
    components: [300, -5, 128],
    alpha: 1,
  });
  // 300 → max>1 → 0..255 path → clampInt(300, 0, 255) = 255
  // -5 → still triggers 0..255 path (max>1), clampInt(-5, 0, 255) = 0
  assert.deepEqual(value, { type: "rgb", r: 255, g: 0, b: 128, alpha: 1 });
});

// ─── Alpha handling ─────────────────────────────────────────────────────────

test("alpha is clamped to [0,1]", () => {
  const { value } = normalizeStyleValueWithMeta({
    type: "color",
    colorSpace: "rgb",
    components: [0, 0, 0],
    alpha: 1.5,
  });
  assert.equal(value.alpha, 1);
});

test("negative alpha clamped to 0", () => {
  const { value } = normalizeStyleValueWithMeta({
    type: "color",
    colorSpace: "rgb",
    components: [0, 0, 0],
    alpha: -0.2,
  });
  assert.equal(value.alpha, 0);
});

// ─── Recursive containers ────────────────────────────────────────────────────

test("layers — colors inside background-image gradient are normalized", () => {
  const input = {
    type: "layers",
    value: [
      {
        type: "function",
        name: "linear-gradient",
        args: {
          type: "tuple",
          value: [
            { type: "color", colorSpace: "rgb", components: [1, 0, 0], alpha: 1 },
            { type: "color", colorSpace: "rgb", components: [0, 1, 0], alpha: 1 },
          ],
        },
      },
    ],
  };
  const { value } = normalizeStyleValueWithMeta(input);
  const colors = value.value[0].args.value;
  assert.deepEqual(colors[0], { type: "rgb", r: 255, g: 0, b: 0, alpha: 1 });
  assert.deepEqual(colors[1], { type: "rgb", r: 0, g: 255, b: 0, alpha: 1 });
});

test("shadow — color is normalized", () => {
  const input = {
    type: "shadow",
    offsetX: { type: "unit", unit: "px", value: 0 },
    offsetY: { type: "unit", unit: "px", value: 4 },
    blur: { type: "unit", unit: "px", value: 8 },
    spread: { type: "unit", unit: "px", value: 0 },
    color: { type: "color", colorSpace: "rgb", components: [0, 0, 0], alpha: 0.25 },
  };
  const { value } = normalizeStyleValueWithMeta(input);
  assert.deepEqual(value.color, { type: "rgb", r: 0, g: 0, b: 0, alpha: 0.25 });
});

test("tuple — recursive normalization", () => {
  const input = {
    type: "tuple",
    value: [
      { type: "color", colorSpace: "rgb", components: [0.5, 0.5, 0.5], alpha: 1 },
      { type: "unit", unit: "px", value: 2 },
    ],
  };
  const { value } = normalizeStyleValueWithMeta(input);
  assert.deepEqual(value.value[0], { type: "rgb", r: 128, g: 128, b: 128, alpha: 1 });
  assert.deepEqual(value.value[1], { type: "unit", unit: "px", value: 2 }); // unchanged
});

test("var with fallback — fallback color is normalized", () => {
  const input = {
    type: "var",
    value: "brand-primary",
    fallback: { type: "color", colorSpace: "rgb", components: [1, 0, 0], alpha: 1 },
  };
  const { value } = normalizeStyleValueWithMeta(input);
  assert.equal(value.type, "var");
  assert.equal(value.value, "brand-primary");
  assert.deepEqual(value.fallback, { type: "rgb", r: 255, g: 0, b: 0, alpha: 1 });
});

test("hints deduplicated across multiple legacy colors in same tree", () => {
  const input = {
    type: "layers",
    value: [
      { type: "color", colorSpace: "rgb", components: [255, 0, 0], alpha: 1 },
      { type: "color", colorSpace: "rgb", components: [0, 255, 0], alpha: 1 },
      { type: "color", colorSpace: "rgb", components: [0, 0, 255], alpha: 1 },
    ],
  };
  const { meta } = normalizeStyleValueWithMeta(input);
  // All 3 are legacy 0..255 — telemetryKey should appear once after dedup
  assert.deepEqual(meta.telemetryKeys, ["coerce:colorRgb-legacy-0-255"]);
  assert.equal(meta.hints.length, 1);
});

// ─── Passthrough (non-color values) ─────────────────────────────────────────

test("passthrough — unit value unchanged", () => {
  const input = { type: "unit", unit: "px", value: 16 };
  const { value, meta } = normalizeStyleValueWithMeta(input);
  assert.strictEqual(value, input);
  assert.deepEqual(meta.hints, []);
});

test("passthrough — var without fallback unchanged", () => {
  const input = { type: "var", value: "brand-primary" };
  const { value } = normalizeStyleValueWithMeta(input);
  assert.strictEqual(value, input);
});

test("passthrough — keyword unchanged", () => {
  const input = { type: "keyword", value: "auto" };
  const { value } = normalizeStyleValueWithMeta(input);
  assert.strictEqual(value, input);
});

// ─── Backward compat — normalizeStyleValue (no-meta) still works ────────────

test("normalizeStyleValue (no-meta API) still returns StyleValue only", () => {
  const wire = normalizeStyleValue({
    type: "color",
    colorSpace: "rgb",
    components: [0.976, 0.976, 0.976],
    alpha: 1,
  });
  assert.deepEqual(wire, { type: "rgb", r: 249, g: 249, b: 249, alpha: 1 });
});

// ─── The exact incident from the bug report ─────────────────────────────────

test("incident reproduction — 'rgb(249, 249, 249)' string no longer becomes rgb(1,1,1)", () => {
  const wire = normalizeStyleValue(parseStringToStyleValue("rgb(249, 249, 249)"));
  assert.notDeepEqual(wire, { type: "rgb", r: 1, g: 1, b: 1, alpha: 1 }, "must NOT be the buggy rgb(1,1,1)");
  assert.deepEqual(wire, { type: "rgb", r: 249, g: 249, b: 249, alpha: 1 });
});
