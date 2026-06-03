// Unit tests for webstudio_move_instance — re-parent instances under a new parent.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMoveChanges } from "../dist/tools/move-instance.js";

function makeBuild(instances) {
  return {
    id: "b1",
    projectId: "p1",
    version: 1,
    createdAt: "",
    updatedAt: "",
    pages: { homePageId: "home", rootFolderId: "root", pages: [], folders: [] },
    breakpoints: [{ id: "base", label: "Base" }],
    instances,
    props: [],
    styles: [],
    styleSources: [],
    styleSourceSelections: [],
    dataSources: [],
    resources: [],
    deployments: [],
    assets: [],
    marketplaceProduct: null,
  };
}

const inst = (id, children = []) => ({
  id,
  component: "Box",
  tag: "div",
  label: id,
  children: children.map((c) => ({ type: "id", value: c })),
});

test("move — single move re-parents instance under new parent (append at end)", () => {
  const build = makeBuild([
    inst("root", ["a", "b"]),
    inst("a", []),
    inst("b", ["c"]),
    inst("c", []),
  ]);
  const r = buildMoveChanges(build, {
    projectSlug: "x",
    moves: [{ instanceId: "a", parentInstanceId: "b" }],
    dryRun: true,
  });
  assert.equal(r.plans.length, 1);
  assert.equal(r.plans[0].oldParentId, "root");
  assert.equal(r.plans[0].newParentId, "b");
  assert.equal(r.plans[0].sameParent, false);

  const patches = r.changes[0].patches;
  // 2 parent children arrays updated: root and b
  assert.equal(patches.length, 2);
  const rootPatch = patches.find((p) => p.path[0] === "root");
  const bPatch = patches.find((p) => p.path[0] === "b");
  assert.deepEqual(rootPatch.value, [{ type: "id", value: "b" }]);
  assert.deepEqual(bPatch.value, [
    { type: "id", value: "c" },
    { type: "id", value: "a" }, // appended at end
  ]);
});

test("move — insertIndex 0 inserts at the start", () => {
  const build = makeBuild([
    inst("root", ["a", "b"]),
    inst("a", []),
    inst("b", ["c", "d"]),
    inst("c", []),
    inst("d", []),
  ]);
  const r = buildMoveChanges(build, {
    projectSlug: "x",
    moves: [{ instanceId: "a", parentInstanceId: "b", insertIndex: 0 }],
    dryRun: true,
  });
  const bPatch = r.changes[0].patches.find((p) => p.path[0] === "b");
  assert.deepEqual(bPatch.value, [
    { type: "id", value: "a" },
    { type: "id", value: "c" },
    { type: "id", value: "d" },
  ]);
});

test("move — same-parent reorder", () => {
  const build = makeBuild([
    inst("root", ["a", "b", "c"]),
    inst("a", []),
    inst("b", []),
    inst("c", []),
  ]);
  const r = buildMoveChanges(build, {
    projectSlug: "x",
    moves: [{ instanceId: "c", parentInstanceId: "root", insertIndex: 0 }],
    dryRun: true,
  });
  assert.equal(r.plans[0].sameParent, true);
  const rootPatch = r.changes[0].patches.find((p) => p.path[0] === "root");
  assert.deepEqual(rootPatch.value, [
    { type: "id", value: "c" },
    { type: "id", value: "a" },
    { type: "id", value: "b" },
  ]);
});

test("move — batch: 2 instances into a new wrapper", () => {
  // Mimics the use case: section has h1 + p direct, want to group them under a new heading div.
  const build = makeBuild([
    inst("section", ["h1", "p", "heading"]),
    inst("h1", []),
    inst("p", []),
    inst("heading", []),
  ]);
  const r = buildMoveChanges(build, {
    projectSlug: "x",
    moves: [
      { instanceId: "h1", parentInstanceId: "heading" },
      { instanceId: "p", parentInstanceId: "heading" },
    ],
    dryRun: true,
  });
  const sectionPatch = r.changes[0].patches.find((p) => p.path[0] === "section");
  const headingPatch = r.changes[0].patches.find((p) => p.path[0] === "heading");
  assert.deepEqual(sectionPatch.value, [{ type: "id", value: "heading" }]);
  assert.deepEqual(headingPatch.value, [
    { type: "id", value: "h1" },
    { type: "id", value: "p" },
  ]);
});

test("move — refuses moving instance into itself", () => {
  const build = makeBuild([inst("root", ["a"]), inst("a", [])]);
  assert.throws(
    () => buildMoveChanges(build, {
      projectSlug: "x",
      moves: [{ instanceId: "a", parentInstanceId: "a" }],
      dryRun: true,
    }),
    /Cannot move instance into itself/,
  );
});

test("move — refuses cycle (parent is a descendant)", () => {
  const build = makeBuild([
    inst("root", ["a"]),
    inst("a", ["b"]),
    inst("b", ["c"]),
    inst("c", []),
  ]);
  assert.throws(
    () => buildMoveChanges(build, {
      projectSlug: "x",
      moves: [{ instanceId: "a", parentInstanceId: "c" }],
      dryRun: true,
    }),
    /Cycle detected/,
  );
});

test("move — refuses moving a root instance (no parent)", () => {
  const build = makeBuild([inst("root", ["a"]), inst("a", [])]);
  assert.throws(
    () => buildMoveChanges(build, {
      projectSlug: "x",
      moves: [{ instanceId: "root", parentInstanceId: "a" }],
      dryRun: true,
    }),
    /Cannot move root instance/,
  );
});

test("move — refuses unknown instance", () => {
  const build = makeBuild([inst("root", [])]);
  assert.throws(
    () => buildMoveChanges(build, {
      projectSlug: "x",
      moves: [{ instanceId: "ghost", parentInstanceId: "root" }],
      dryRun: true,
    }),
    /Instance not found/,
  );
});

test("move — refuses unknown target parent", () => {
  const build = makeBuild([inst("root", ["a"]), inst("a", [])]);
  assert.throws(
    () => buildMoveChanges(build, {
      projectSlug: "x",
      moves: [{ instanceId: "a", parentInstanceId: "ghost" }],
      dryRun: true,
    }),
    /New parent not found/,
  );
});

test("move — insertIndex larger than children count clamps to end", () => {
  const build = makeBuild([inst("root", ["a", "b"]), inst("a", []), inst("b", [])]);
  const r = buildMoveChanges(build, {
    projectSlug: "x",
    moves: [{ instanceId: "a", parentInstanceId: "b", insertIndex: 999 }],
    dryRun: true,
  });
  const bPatch = r.changes[0].patches.find((p) => p.path[0] === "b");
  assert.deepEqual(bPatch.value, [{ type: "id", value: "a" }]);
});

test("move — preserves text children of moved instance (only parent reference changes)", () => {
  // The tool ONLY edits parent.children arrays. The moved instance's own subtree is untouched.
  const build = makeBuild([
    inst("root", ["a", "b"]),
    { id: "a", component: "Heading", tag: "h1", label: "a", children: [{ type: "text", value: "Hello" }] },
    inst("b", []),
  ]);
  const r = buildMoveChanges(build, {
    projectSlug: "x",
    moves: [{ instanceId: "a", parentInstanceId: "b" }],
    dryRun: true,
  });
  // No patch touching "a" (the moved instance itself).
  const patchedIds = r.changes[0].patches.map((p) => p.path[0]);
  assert.ok(!patchedIds.includes("a"), "moved instance should not be re-emitted");
});
