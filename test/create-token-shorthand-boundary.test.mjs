// Boundary tests: shorthand rejection / auto-expansion via buildTokenPatches
// (the path used by create-token, create-tokens, sync-local-tokens).
//
// a production site (2026-05-21): `padding: {type:"var"}` posted into a token broke publish.
// expandStylesMap is the centralised guard.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTokenPatches,
  expandStylesMap,
} from "../dist/tools/create-token/shared.js";

const emptyBuild = {
  id: "b",
  projectId: "p",
  pages: { meta: { name: "" }, homePage: { id: "h", path: "/", name: "home" }, pages: [] },
  instances: [],
  styleSources: [],
  styleSourceSelections: [],
  props: [],
  styles: [],
  breakpoints: [{ id: "bp-base", label: "Base" }],
  dataSources: [],
  resources: [],
  assets: [],
};

// ─── expandStylesMap ────────────────────────────────────────────────────────

test("expandStylesMap: padding{type:'var'} → 4 paddingT/R/B/L = var", () => {
  const r = expandStylesMap({ padding: { type: "var", value: "brand-space-s" } });
  assert.equal(r.ok, true);
  const keys = Object.keys(r.styles).sort();
  assert.deepEqual(keys, ["paddingBottom", "paddingLeft", "paddingRight", "paddingTop"]);
  for (const k of keys) {
    assert.equal(r.styles[k].type, "var");
    assert.equal(r.styles[k].value, "brand-space-s");
  }
});

test("expandStylesMap: flex{type:'unit'} → rejected", () => {
  const r = expandStylesMap({ flex: { type: "unit", value: 1, unit: "number" } });
  assert.equal(r.ok, false);
  assert.match(r.error, /flex/);
});

test("expandStylesMap: background shorthand always rejected", () => {
  const r = expandStylesMap({ background: { type: "keyword", value: "red" } });
  assert.equal(r.ok, false);
  assert.match(r.error, /background/);
});

test("expandStylesMap: non-shorthand passes through untouched", () => {
  const v = { type: "rgb", r: 1, g: 2, b: 3, alpha: 1 };
  const r = expandStylesMap({ color: v });
  assert.equal(r.ok, true);
  assert.deepEqual(r.styles, { color: v });
});

test("expandStylesMap: unparsed shorthand also expanded", () => {
  const r = expandStylesMap({ padding: { type: "unparsed", value: "8px 16px" } });
  assert.equal(r.ok, true);
  const map = r.styles;
  assert.equal(map.paddingTop.value, 8);
  assert.equal(map.paddingRight.value, 16);
});

// ─── buildTokenPatches integration ──────────────────────────────────────────

test("buildTokenPatches: padding shorthand → 4 longhand stylePatches", () => {
  const res = buildTokenPatches(emptyBuild, {
    name: "Icon Badge",
    styles: { padding: { type: "var", value: "brand-space-s" } },
    breakpointId: "bp-base",
    overwrite: false,
  });
  assert.ok(!("shorthandError" in res), "should not error");
  assert.ok(!("conflict" in res));
  assert.equal(res.stylePatches.length, 4);
  const properties = res.stylePatches.map((p) => p.value.property).sort();
  assert.deepEqual(properties, [
    "paddingBottom", "paddingLeft", "paddingRight", "paddingTop",
  ]);
  // styleSourcePatches has the new token; should reference the same id everywhere.
  assert.equal(res.styleSourcePatches.length, 1);
});

test("buildTokenPatches: flex shorthand with typed value → shorthandError", () => {
  const res = buildTokenPatches(emptyBuild, {
    name: "Bad",
    styles: { flex: { type: "unit", value: 1, unit: "number" } },
    breakpointId: "bp-base",
    overwrite: false,
  });
  assert.ok("shorthandError" in res);
  assert.match(res.shorthandError, /flex/);
});

test("buildTokenPatches: rejected shorthand (background) → shorthandError", () => {
  const res = buildTokenPatches(emptyBuild, {
    name: "Bad",
    styles: { background: { type: "unparsed", value: "#fff" } },
    breakpointId: "bp-base",
    overwrite: false,
  });
  assert.ok("shorthandError" in res);
  assert.match(res.shorthandError, /background/);
});
