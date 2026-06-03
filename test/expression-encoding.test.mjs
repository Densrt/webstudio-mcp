// Unit tests for src/utils/expression-encoding.ts
//
// Webstudio Cloud encodes dashes `-` in dataSourceIds to `__DASH__` inside
// expressions. Sending the raw form silently breaks the renderer (empty render
// / NaN). This helper auto-encodes any `$ws$dataSource$<id>` reference in an
// expression and is strictly idempotent.

import { test } from "node:test";
import assert from "node:assert/strict";

const { encodeExpressionRefs } = await import("../dist/utils/expression-encoding.js");

test("id without dash → unchanged", () => {
  const expr = "$ws$dataSource$abc123.name";
  assert.equal(encodeExpressionRefs(expr), expr);
});

test("id with dash in the middle → encoded", () => {
  const expr = "$ws$dataSource$abc-xyz";
  assert.equal(encodeExpressionRefs(expr), "$ws$dataSource$abc__DASH__xyz");
});

test("id with trailing dash → encoded", () => {
  const expr = "$ws$dataSource$jArQLoWSBLdyVU3lBQkI-";
  assert.equal(
    encodeExpressionRefs(expr),
    "$ws$dataSource$jArQLoWSBLdyVU3lBQkI__DASH__",
  );
});

test("multiple ids in one expression → all encoded", () => {
  const expr = `$ws$dataSource$abc-def + $ws$dataSource$xyz-`;
  assert.equal(
    encodeExpressionRefs(expr),
    "$ws$dataSource$abc__DASH__def + $ws$dataSource$xyz__DASH__",
  );
});

test("string literals and operators preserved (accents, +)", () => {
  const expr = `"Découvrez chez " + $ws$dataSource$abc-def + " à " + $ws$dataSource$xyz-`;
  assert.equal(
    encodeExpressionRefs(expr),
    `"Découvrez chez " + $ws$dataSource$abc__DASH__def + " à " + $ws$dataSource$xyz__DASH__`,
  );
});

test("path access (.data.title) preserved after id", () => {
  const expr = "$ws$dataSource$abc-xyz.data.title";
  assert.equal(
    encodeExpressionRefs(expr),
    "$ws$dataSource$abc__DASH__xyz.data.title",
  );
});

test("bracket access ([0].title) preserved after id", () => {
  const expr = "$ws$dataSource$abc-xyz.items[0].title";
  assert.equal(
    encodeExpressionRefs(expr),
    "$ws$dataSource$abc__DASH__xyz.items[0].title",
  );
});

test("idempotent — already-encoded id stays the same", () => {
  const expr = "$ws$dataSource$abc__DASH__xyz.title";
  assert.equal(encodeExpressionRefs(expr), expr);
});

test("idempotent — running twice gives the same result as once", () => {
  const expr = `"x" + $ws$dataSource$abc-def + $ws$dataSource$xyz__DASH__qrs`;
  const once = encodeExpressionRefs(expr);
  const twice = encodeExpressionRefs(once);
  assert.equal(twice, once);
});

test("no dataSource refs → string returned as-is", () => {
  const expr = `"plain string without any binding"`;
  assert.equal(encodeExpressionRefs(expr), expr);
});

test("does NOT touch unrelated `-` outside dataSource refs", () => {
  const expr = `"some-text-with-dashes" + $ws$dataSource$abc-def`;
  assert.equal(
    encodeExpressionRefs(expr),
    `"some-text-with-dashes" + $ws$dataSource$abc__DASH__def`,
  );
});

test("underscore in id (non-dash) preserved", () => {
  const expr = "$ws$dataSource$abc_def-ghi";
  assert.equal(
    encodeExpressionRefs(expr),
    "$ws$dataSource$abc_def__DASH__ghi",
  );
});

test("expression mixing concat + multiple ids + accents (from the prompt)", () => {
  const expr =
    `"Découvrez chez " + $ws$dataSource$abc-def + " à " + $ws$dataSource$xyz-`;
  const encoded = encodeExpressionRefs(expr);
  assert.equal(
    encoded,
    `"Découvrez chez " + $ws$dataSource$abc__DASH__def + " à " + $ws$dataSource$xyz__DASH__`,
  );
  // And idempotent:
  assert.equal(encodeExpressionRefs(encoded), encoded);
});
