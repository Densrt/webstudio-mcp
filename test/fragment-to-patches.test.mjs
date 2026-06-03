// Unit tests for fragmentToTransaction — mainly multi-root and breakpoint remapping.

import { test } from "node:test";
import assert from "node:assert/strict";
import { FragmentBuilder } from "../dist/builder.js";
import { fragmentToTransaction } from "../dist/fragment-to-patches.js";

function makeBuild() {
  return {
    id: "build1",
    projectId: "proj1",
    version: 1,
    createdAt: "", updatedAt: "",
    pages: { homePageId: "home", rootFolderId: "root", pages: [{ id: "home", name: "Home", path: "/", rootInstanceId: "home-root" }], folders: [] },
    breakpoints: [{ id: "bp-base", label: "Base" }],
    instances: [{ id: "home-root", component: "Body", children: [] }],
    props: [],
    styles: [],
    styleSources: [],
    styleSourceSelections: [],
    dataSources: [],
    resources: [],
    assets: [],
    marketplaceProduct: null,
  };
}

test("fragmentToTransaction inserts a single root into the parent's children", () => {
  const b = new FragmentBuilder();
  b.addInstance("Box", { id: "section1" });
  const fragment = b.build();
  const tx = fragmentToTransaction(fragment, makeBuild(), { parentInstanceId: "home-root" });
  const instChange = tx.payload.find((c) => c.namespace === "instances");
  // 1 add patch for section1 + 1 add patch to insert into home-root.children
  assert.equal(instChange.patches.length, 2);
  const insertPatch = instChange.patches.find((p) => p.path.includes("children"));
  assert.ok(insertPatch);
  assert.equal(insertPatch.value.value, "section1");
});

test("fragmentToTransaction inserts ALL top-level roots (multi-root)", () => {
  const b = new FragmentBuilder();
  b.addInstance("Box", { id: "dialog" });
  b.addInstance("HtmlEmbed", { id: "css-embed" });
  const fragment = b.build();
  const tx = fragmentToTransaction(fragment, makeBuild(), { parentInstanceId: "home-root" });
  const instChange = tx.payload.find((c) => c.namespace === "instances");
  // 2 add patches for the instances + 2 add patches to insert them into children
  const childrenPatches = instChange.patches.filter((p) => p.path.includes("children"));
  assert.equal(childrenPatches.length, 2, "should insert 2 children into home-root");
  // Consecutive indices
  assert.equal(childrenPatches[0].path[2], 0);
  assert.equal(childrenPatches[1].path[2], 1);
});

test("fragmentToTransaction throws if there is no root", () => {
  const b = new FragmentBuilder();
  const fragment = b.build();
  assert.throws(() => fragmentToTransaction(fragment, makeBuild(), { parentInstanceId: "home-root" }), /no root/i);
});

test("fragmentToTransaction throws if the parent cannot be found", () => {
  const b = new FragmentBuilder();
  b.addInstance("Box", { id: "x" });
  const fragment = b.build();
  assert.throws(() => fragmentToTransaction(fragment, makeBuild(), { parentInstanceId: "ghost" }), /not found/i);
});

test("fragmentToTransaction respects insertIndex", () => {
  const build = makeBuild();
  // Pre-existing: home-root already has a child
  build.instances[0].children = [{ type: "id", value: "existing" }];
  build.instances.push({ id: "existing", component: "Box", children: [] });

  const b = new FragmentBuilder();
  b.addInstance("Box", { id: "new-section" });
  const fragment = b.build();
  const tx = fragmentToTransaction(fragment, build, { parentInstanceId: "home-root", insertIndex: 0 });
  const insertPatch = tx.payload.find((c) => c.namespace === "instances")
    .patches.find((p) => p.path.includes("children"));
  assert.equal(insertPatch.path[2], 0, "should insert at position 0");
});
