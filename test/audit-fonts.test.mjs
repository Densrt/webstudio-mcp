// Unit tests for webstudio_audit_fonts — focus on the parseSubfamily bug detector.

import { test } from "node:test";
import assert from "node:assert/strict";
import { detectSubfamilyBug } from "../dist/tools/audit-fonts/scanners.js";

test("detectSubfamilyBug — italic without weight keyword triggers the bug", () => {
  // Webstudio assigns weight=900 to these because subfamily has no weight token.
  assert.equal(detectSubfamilyBug("SupremeLLTT-Italic.woff2"), true);
  assert.equal(detectSubfamilyBug("MyFont-Italic_abcdefghijklmno.woff2"), true);
  assert.equal(detectSubfamilyBug("MyFont-Oblique.woff2"), true);
  assert.equal(detectSubfamilyBug("Inter-Italic.ttf"), true);
});

test("detectSubfamilyBug — italic with explicit weight keyword is safe", () => {
  assert.equal(detectSubfamilyBug("SupremeLLTT-Regular-Italic.woff2"), false);
  assert.equal(detectSubfamilyBug("SupremeLLTT-Light-Italic.woff2"), false);
  assert.equal(detectSubfamilyBug("SupremeLLTT-Medium-Italic.woff2"), false);
  assert.equal(detectSubfamilyBug("SupremeLLTT-Bold-Italic.woff2"), false);
  assert.equal(detectSubfamilyBug("SupremeLLTT-Bold-Oblique.woff2"), false);
  assert.equal(detectSubfamilyBug("Font-Black-Italic.woff2"), false);
});

test("detectSubfamilyBug — numeric weight in filename is recognised", () => {
  assert.equal(detectSubfamilyBug("Inter-400-Italic.woff2"), false);
  assert.equal(detectSubfamilyBug("Roboto-700-Italic.woff2"), false);
});

test("detectSubfamilyBug — non-italic fonts always safe", () => {
  assert.equal(detectSubfamilyBug("SupremeLLTT-Regular.woff2"), false);
  assert.equal(detectSubfamilyBug("SupremeLLTT-Bold.woff2"), false);
  assert.equal(detectSubfamilyBug("Inter-Medium.ttf"), false);
});

test("detectSubfamilyBug — handles Webstudio random suffix correctly", () => {
  // Real Webstudio asset names look like Foo-Italic_<15-25 char hash>.woff2
  assert.equal(
    detectSubfamilyBug("SupremeLLTT-Italic_5n4ZF_mrcon2DF8Q7Zr19.woff2"),
    true,
  );
  assert.equal(
    detectSubfamilyBug("SupremeLLTT-Regular-Italic_P9xCdnrC_BE6ewvOrzL7L.woff2"),
    false,
  );
});

test("detectSubfamilyBug — separator variations (dash/underscore/space)", () => {
  assert.equal(detectSubfamilyBug("Font_Italic.woff2"), true);
  assert.equal(detectSubfamilyBug("Font Italic.woff2"), true);
  assert.equal(detectSubfamilyBug("Font_Regular_Italic.woff2"), false);
  assert.equal(detectSubfamilyBug("Font Regular Italic.woff2"), false);
});
