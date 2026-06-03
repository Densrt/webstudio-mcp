// Unit tests for parseStringToStyleValue.
// Critical: color components MUST be in [0-1] (normalised), not [0-255].
// Webstudio renders via Math.round(c * 255) after clamp to [0,1], so passing 0-255
// makes every value > 0 collapse to 255 → all colors render as white/cyan.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStringToStyleValue } from "../dist/tools/define-css-var/parse-style-value.js";

test("hex6 — components stored in [0-1], not [0-255]", () => {
  // Acme primary-blue → #009BB4 → 0/155/180 in 8-bit → 0/0.6078/0.7058 normalised
  const v = parseStringToStyleValue("#009BB4");
  assert.equal(v.type, "color");
  assert.equal(v.colorSpace, "hex");
  assert.equal(v.components[0], 0);
  // 155/255 ≈ 0.6078431372549019
  assert.ok(Math.abs(v.components[1] - 155 / 255) < 1e-10);
  // 180/255 ≈ 0.7058823529411765
  assert.ok(Math.abs(v.components[2] - 180 / 255) < 1e-10);
  assert.equal(v.alpha, 1);
});

test("hex6 — black is (0,0,0) — no normalisation needed", () => {
  const v = parseStringToStyleValue("#000000");
  assert.deepEqual(v.components, [0, 0, 0]);
});

test("hex6 — white is (1,1,1) after normalisation", () => {
  const v = parseStringToStyleValue("#FFFFFF");
  assert.deepEqual(v.components, [1, 1, 1]);
});

test("hex6 — grey #919292 is normalised correctly", () => {
  // Acme grey-300 — was the bug case (rendered as #FFFFFF before fix).
  const v = parseStringToStyleValue("#919292");
  assert.ok(Math.abs(v.components[0] - 145 / 255) < 1e-10);
  assert.ok(Math.abs(v.components[1] - 146 / 255) < 1e-10);
  assert.ok(Math.abs(v.components[2] - 146 / 255) < 1e-10);
});

test("hex3 shorthand — components stored in [0-1]", () => {
  // #f0a → expands to #ff00aa → 1, 0, 170/255
  const v = parseStringToStyleValue("#f0a");
  assert.equal(v.type, "color");
  assert.equal(v.components[0], 1);
  assert.equal(v.components[1], 0);
  assert.ok(Math.abs(v.components[2] - 170 / 255) < 1e-10);
});

test("rgb() — components stored in [0-1]", () => {
  const v = parseStringToStyleValue("rgb(0, 155, 180)");
  assert.equal(v.type, "color");
  assert.equal(v.colorSpace, "rgb");
  assert.equal(v.components[0], 0);
  assert.ok(Math.abs(v.components[1] - 155 / 255) < 1e-10);
  assert.ok(Math.abs(v.components[2] - 180 / 255) < 1e-10);
  assert.equal(v.alpha, 1);
});

test("rgba() — alpha kept as-is, components normalised", () => {
  const v = parseStringToStyleValue("rgba(0, 0, 0, 0.6)");
  assert.deepEqual(v.components, [0, 0, 0]);
  assert.equal(v.alpha, 0.6);
});

test("rendered hex from stored components → matches input hex", () => {
  // Round-trip: input hex → stored components → re-render via Math.round(c * 255) → same hex.
  const cases = ["#009BB4", "#919292", "#A59270", "#96D2D3", "#001A21", "#ECECED"];
  for (const input of cases) {
    const v = parseStringToStyleValue(input);
    const rendered =
      "#" +
      v.components
        .map((c) => Math.round(Math.min(Math.max(c, 0), 1) * 255).toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();
    assert.equal(rendered, input, `round-trip failed for ${input}`);
  }
});

test("var() — not a color, no components", () => {
  const v = parseStringToStyleValue("var(--brand-primary)");
  assert.equal(v.type, "var");
  assert.equal(v.value, "brand-primary");
});

test("unparsed — gradients fall through unchanged", () => {
  const v = parseStringToStyleValue("linear-gradient(to right, #fff, #000)");
  assert.equal(v.type, "unparsed");
});
