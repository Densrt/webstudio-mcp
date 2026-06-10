// v2.13.1 — buildReplaceMergeTransaction extracted to src/lib/ (was the
// copy-pasted buildFullTransaction closure in create-popup / create-sheet,
// audit 2026-06-10). Patch ordering is load-bearing — pinned here.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildReplaceMergeTransaction } from "../dist/lib/replace-merge-transaction.js";

const BASE_BP = { id: "bp-base", label: "Base" };

const fragment = {
  "@webstudio/instance/v0.1": {
    instanceSelector: [],
    children: [{ type: "id", value: "new-dialog" }],
    instances: [{ id: "new-dialog", component: "Box", label: "Mobile menu", children: [] }],
    styleSourceSelections: [],
    styleSources: [],
    breakpoints: [BASE_BP],
    styles: [],
    dataSources: [],
    resources: [],
    props: [],
    assets: [],
  },
};

const makeBuild = (withOldTree) => ({
  id: "b1",
  projectId: "p1",
  version: 1,
  breakpoints: [BASE_BP],
  instances: [
    {
      id: "parent",
      component: "Box",
      children: withOldTree ? [{ type: "id", value: "old-dialog" }] : [],
    },
    ...(withOldTree
      ? [{ id: "old-dialog", component: "Box", label: "Mobile menu", children: [] }]
      : []),
  ],
  props: withOldTree ? [{ id: "old-prop", instanceId: "old-dialog", name: "tag", type: "string", value: "div" }] : [],
  styles: [],
  styleSources: [],
  styleSourceSelections: [],
  dataSources: [],
  resources: [],
  assets: [],
  pages: { homePageId: "h", rootFolderId: "r", pages: [], folders: [] },
});

test("no replace target → plain fragment transaction", () => {
  const tx = buildReplaceMergeTransaction(fragment, makeBuild(false), "parent", ["Mobile menu"]);
  const inst = tx.payload.find((c) => c.namespace === "instances");
  assert.ok(inst, "instances namespace expected");
  assert.ok(!inst.patches.some((p) => p.op === "remove"), "no removals expected on first push");
});

test("replace mode: old subtree removed in the SAME transaction, cleanup patches first", () => {
  const tx = buildReplaceMergeTransaction(fragment, makeBuild(true), "parent", ["Mobile menu"]);
  const inst = tx.payload.find((c) => c.namespace === "instances");
  assert.ok(inst);

  // The parent-children patch (detach old id) must be the FIRST instances patch.
  const first = inst.patches[0];
  assert.deepEqual(first.path, ["parent", "children"], "parent children patch must run first");
  assert.ok(
    !JSON.stringify(first.value).includes("old-dialog"),
    "rewritten children must not reference the old subtree",
  );

  // Old instance removal precedes the new instance add within the namespace.
  const removeIdx = inst.patches.findIndex((p) => p.op === "remove" && p.path[0] === "old-dialog");
  const addIdx = inst.patches.findIndex((p) => JSON.stringify(p).includes("new-dialog"));
  assert.ok(removeIdx >= 0, "old-dialog removal expected");
  assert.ok(addIdx >= 0, "new-dialog add expected");
  assert.ok(removeIdx < addIdx, "cleanup must precede fragment patches");

  // Cascade: the old subtree's props are cleaned up too.
  const props = tx.payload.find((c) => c.namespace === "props");
  assert.ok(props?.patches.some((p) => p.op === "remove" && p.path[0] === "old-prop"), "orphan prop removal expected");
});
