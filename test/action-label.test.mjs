// Unit tests for action-label — chantier 7 (v1.0 prep).

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateLabel, ensureUniqueLabels } from "../dist/lib/action-label.js";

test("validateLabel: 3-30 char string passes", () => {
  assert.equal(validateLabel("create-home").ok, true);
  assert.equal(validateLabel("upd").ok, true);
  assert.equal(validateLabel("delete-legacy-cascade-v2").ok, true); // 24 chars, max=30
});

test("validateLabel: too short refused", () => {
  const r = validateLabel("ab");
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /too short/);
});

test("validateLabel: too long refused", () => {
  const r = validateLabel("a".repeat(31));
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /too long/);
});

test("validateLabel: non-string refused", () => {
  const r = validateLabel(42);
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /must be a string/);
});

test("validateLabel: whitespace edges refused", () => {
  const r = validateLabel(" create");
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /whitespace/);
});

test("ensureUniqueLabels: distinct labels OK", () => {
  const r = ensureUniqueLabels(["create-home", "update-meta", "delete-old"]);
  assert.equal(r.ok, true);
});

test("ensureUniqueLabels: duplicate refused with names", () => {
  const r = ensureUniqueLabels(["create-home", "update-meta", "create-home"]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.ok === false ? r.duplicates : null, ["create-home"]);
});

test("ensureUniqueLabels: multiple dupes listed once each", () => {
  const r = ensureUniqueLabels(["a-label", "b-label", "a-label", "b-label", "c-label"]);
  assert.equal(r.ok, false);
  assert.deepEqual((r.ok === false ? r.duplicates : []).sort(), ["a-label", "b-label"]);
});

test("ensureUniqueLabels: empty array OK", () => {
  const r = ensureUniqueLabels([]);
  assert.equal(r.ok, true);
});
