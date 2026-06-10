// v2.13.1 — findReplaceTargets extracted to src/lib/ (was copy-pasted ×3 in
// push-complete / create-popup / create-sheet, audit 2026-06-10).

import { test } from "node:test";
import assert from "node:assert/strict";

import { findReplaceTargets } from "../dist/lib/find-replace-targets.js";

const build = {
  instances: [
    {
      id: "parent",
      component: "Box",
      children: [
        { type: "id", value: "a" },
        { type: "text", value: "hello" },
        { type: "id", value: "b" },
        { type: "id", value: "c" },
        { type: "id", value: "ghost" },
      ],
    },
    { id: "a", component: "Box", label: "Hero", children: [] },
    { id: "b", component: "@webstudio-is/sdk-components-react-radix:Dialog", label: "Promo", children: [] },
    { id: "c", component: "Box", children: [] }, // no label
  ],
};

test("matches direct children by label, skips text children and missing instances", () => {
  assert.deepEqual(findReplaceTargets(build, "parent", ["Hero", "Promo"]), ["a", "b"]);
});

test("unknown parent returns []", () => {
  assert.deepEqual(findReplaceTargets(build, "nope", ["Hero"]), []);
});

test("unlabelled instances never match", () => {
  assert.deepEqual(findReplaceTargets(build, "parent", ["c"]), []);
});

test("componentMatch: exact component name", () => {
  assert.deepEqual(findReplaceTargets(build, "parent", ["Hero"], "Box"), ["a"]);
});

test("componentMatch: last segment of a namespaced component", () => {
  assert.deepEqual(findReplaceTargets(build, "parent", ["Promo"], "Dialog"), ["b"]);
});

test("componentMatch: mismatch filters the instance out", () => {
  assert.deepEqual(findReplaceTargets(build, "parent", ["Hero"], "Dialog"), []);
});
