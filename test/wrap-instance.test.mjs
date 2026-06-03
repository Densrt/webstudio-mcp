// Unit tests for wrap_instance.buildChanges logic.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildChanges } from "../dist/tools/wrap-instance.js";

function makeBuild() {
  // Body → [Collection (with local source + token)]
  return {
    id: "b", projectId: "p", version: 1, createdAt: "", updatedAt: "",
    pages: { homePageId: "h", rootFolderId: "r", pages: [], folders: [] },
    breakpoints: [{ id: "bp", label: "Base" }],
    instances: [
      { id: "body", component: "Body", tag: "body", children: [{ type: "id", value: "coll" }] },
      { id: "coll", component: "ws:collection", children: [] },
    ],
    props: [], dataSources: [], resources: [], deployments: [], assets: [], marketplaceProduct: null,
    styles: [],
    styleSources: [
      { type: "token", id: "tok-1", name: "Layout Grid" },
      { type: "local", id: "local-1" },
    ],
    styleSourceSelections: [
      { instanceId: "coll", values: ["tok-1", "local-1"] },
    ],
  };
}

test("creates wrapper instance and replaces target in parent's children", () => {
  const build = makeBuild();
  const r = buildChanges(build, {
    projectSlug: "p", instanceId: "coll",
    component: "ws:element", tag: "div", label: "Grid wrapper",
    transferLocalSource: true, dryRun: true,
  });
  const instancePatches = r.changes.find((c) => c.namespace === "instances").patches;
  // add wrapper
  const addOp = instancePatches.find((p) => p.op === "add" && p.path[0] === r.wrapperId);
  assert.ok(addOp, "wrapper add patch missing");
  assert.equal(addOp.value.tag, "div");
  assert.equal(addOp.value.label, "Grid wrapper");
  assert.deepEqual(addOp.value.children, [{ type: "id", value: "coll" }]);
  // body.children replaced
  const replaceOp = instancePatches.find((p) => p.op === "replace" && p.path[0] === "body");
  assert.ok(replaceOp);
  assert.deepEqual(replaceOp.value, [{ type: "id", value: r.wrapperId }]);
});

test("transfers local styleSource to wrapper and keeps tokens on source", () => {
  const build = makeBuild();
  const r = buildChanges(build, {
    projectSlug: "p", instanceId: "coll",
    component: "ws:element", tag: "div", label: "W",
    transferLocalSource: true, dryRun: true,
  });
  assert.equal(r.transferredLocalSourceId, "local-1");
  const selPatches = r.changes.find((c) => c.namespace === "styleSourceSelections").patches;
  // Source selection: keep token only
  const replaceSel = selPatches.find((p) => p.op === "replace" && p.path[0] === "coll");
  assert.ok(replaceSel);
  assert.deepEqual(replaceSel.value.values, ["tok-1"]);
  // Wrapper selection: gets the local source
  const addSel = selPatches.find((p) => p.op === "add" && p.path[0] === r.wrapperId);
  assert.ok(addSel);
  assert.deepEqual(addSel.value.values, ["local-1"]);
});

test("removes source selection entirely when local was the only value", () => {
  const build = makeBuild();
  // Override: source has ONLY the local, no token
  build.styleSourceSelections = [{ instanceId: "coll", values: ["local-1"] }];
  const r = buildChanges(build, {
    projectSlug: "p", instanceId: "coll",
    component: "ws:element", tag: "div", label: "W",
    transferLocalSource: true, dryRun: true,
  });
  const selPatches = r.changes.find((c) => c.namespace === "styleSourceSelections").patches;
  const removeOp = selPatches.find((p) => p.op === "remove" && p.path[0] === "coll");
  assert.ok(removeOp, "should remove source selection when nothing left");
});

test("transferLocalSource=false leaves selection untouched", () => {
  const build = makeBuild();
  const r = buildChanges(build, {
    projectSlug: "p", instanceId: "coll",
    component: "ws:element", tag: "div", label: "W",
    transferLocalSource: false, dryRun: true,
  });
  assert.equal(r.transferredLocalSourceId, null);
  const selectionChange = r.changes.find((c) => c.namespace === "styleSourceSelections");
  assert.equal(selectionChange, undefined, "should produce no selection patches");
});

test("no local source on target: nothing to transfer, no error", () => {
  const build = makeBuild();
  build.styleSourceSelections = [{ instanceId: "coll", values: ["tok-1"] }];
  const r = buildChanges(build, {
    projectSlug: "p", instanceId: "coll",
    component: "ws:element", tag: "div", label: "W",
    transferLocalSource: true, dryRun: true,
  });
  assert.equal(r.transferredLocalSourceId, null);
  const selectionChange = r.changes.find((c) => c.namespace === "styleSourceSelections");
  assert.equal(selectionChange, undefined);
});

test("throws INSTANCE_NOT_FOUND when target id absent", () => {
  const build = makeBuild();
  assert.throws(() => {
    buildChanges(build, { projectSlug: "p", instanceId: "ghost", component: "ws:element", tag: "div", label: "W", transferLocalSource: true, dryRun: true });
  }, /Instance not found/);
});

test("throws when target has no parent (root)", () => {
  const build = makeBuild();
  assert.throws(() => {
    buildChanges(build, { projectSlug: "p", instanceId: "body", component: "ws:element", tag: "div", label: "W", transferLocalSource: true, dryRun: true });
  }, /Parent of body not found/);
});

test("preserves sibling order when target is not the only child of parent", () => {
  const build = makeBuild();
  build.instances[0] = {
    id: "body", component: "Body", tag: "body",
    children: [
      { type: "id", value: "header" },
      { type: "id", value: "coll" },
      { type: "id", value: "footer" },
    ],
  };
  build.instances.push({ id: "header", component: "Box", children: [] });
  build.instances.push({ id: "footer", component: "Box", children: [] });

  const r = buildChanges(build, {
    projectSlug: "p", instanceId: "coll",
    component: "ws:element", tag: "div", label: "W",
    transferLocalSource: true, dryRun: true,
  });
  const replaceOp = r.changes.find((c) => c.namespace === "instances").patches.find((p) => p.op === "replace" && p.path[0] === "body");
  assert.deepEqual(replaceOp.value, [
    { type: "id", value: "header" },
    { type: "id", value: r.wrapperId },
    { type: "id", value: "footer" },
  ]);
});
