// Regression tests for the Slot-children cascade bug.
//
// SCENARIO: a project has a Slot Header instance whose only child is a Fragment
// instance shared across multiple pages. The Fragment instance contains the actual
// header content (logo, nav links).
//
// PRE-FIX BUG #1 (DESTRUCTIVE): buildInstanceRemovalChanges descended into the
// Slot's children → cascade-removed the Fragment + its content. Any page deletion
// would wipe out the site-wide header/footer.
//
// PRE-FIX BUG #2 (clone): buildCloneMaps descended into the Slot's children →
// cloned the Fragment (with new ids) into the duplicate page. Cosmetically wrong
// because the clone should share the source's header by reference.
//
// FIX: collectDescendantIds accepts a stopAtComponents set. Removal + clone both
// pass {"Slot"} so the Fragment subtree is never walked.

import { test } from "node:test";
import assert from "node:assert/strict";

const { collectDescendantIds, buildInstanceRemovalChanges, SHARED_CHILDREN_COMPONENTS } = await import("../dist/cleanup-helpers.js");
const { buildCloneMaps } = await import("../dist/clone/id-maps.js");

function makeBuild() {
  return {
    instances: [
      // Page body with Slot header + main + Slot footer.
      { id: "body", component: "ws:element", tag: "body", children: [
        { type: "id", value: "slotH" },
        { type: "id", value: "main" },
        { type: "id", value: "slotF" },
      ]},
      // Slots reference shared Fragments.
      { id: "slotH", component: "Slot", label: "Slot Header", children: [{ type: "id", value: "fragH" }] },
      { id: "slotF", component: "Slot", label: "Slot Footer", children: [{ type: "id", value: "fragF" }] },
      // Shared fragments with content.
      { id: "fragH", component: "Fragment", children: [{ type: "id", value: "logo" }] },
      { id: "logo", component: "Image", tag: "img", children: [] },
      { id: "fragF", component: "Fragment", children: [{ type: "id", value: "copyright" }] },
      { id: "copyright", component: "ws:element", tag: "p", children: [] },
      // Page-specific main content.
      { id: "main", component: "ws:element", tag: "main", children: [{ type: "id", value: "h1" }] },
      { id: "h1", component: "ws:element", tag: "h1", children: [] },
    ],
    props: [],
    styleSourceSelections: [],
    styleSources: [],
    styles: [],
    dataSources: [],
    resources: [],
  };
}

test("collectDescendantIds: default walks everything (no stop)", () => {
  const b = makeBuild();
  const ids = collectDescendantIds("body", b.instances);
  assert.ok(ids.includes("fragH"), "should include shared header fragment");
  assert.ok(ids.includes("logo"), "should include logo inside fragment");
  assert.ok(ids.includes("fragF"), "should include shared footer fragment");
  assert.ok(ids.includes("copyright"));
});

test("collectDescendantIds: stopAtComponents=Slot does NOT descend into Fragment", () => {
  const b = makeBuild();
  const ids = collectDescendantIds("body", b.instances, new Set(["Slot"]));
  // Slot itself is collected (it's part of the page) but its children aren't.
  assert.ok(ids.includes("slotH"));
  assert.ok(ids.includes("slotF"));
  assert.ok(!ids.includes("fragH"), `should NOT include shared header fragment; got ${ids.join(",")}`);
  assert.ok(!ids.includes("logo"), "should NOT include logo (inside Slot)");
  assert.ok(!ids.includes("fragF"), "should NOT include shared footer fragment");
  assert.ok(!ids.includes("copyright"));
  // Main content is still walked normally.
  assert.ok(ids.includes("main"));
  assert.ok(ids.includes("h1"));
});

test("buildInstanceRemovalChanges: removing a page-body does NOT cascade into Slot fragments", () => {
  const b = makeBuild();
  const changes = buildInstanceRemovalChanges(b, ["body"]);
  const removed = new Set(
    changes.find((c) => c.namespace === "instances").patches.map((p) => p.path[0]),
  );
  // Page chrome and main content removed.
  assert.ok(removed.has("body"));
  assert.ok(removed.has("slotH"));
  assert.ok(removed.has("slotF"));
  assert.ok(removed.has("main"));
  assert.ok(removed.has("h1"));
  // Shared header/footer NOT removed.
  assert.ok(!removed.has("fragH"), "shared header fragment must survive page deletion");
  assert.ok(!removed.has("logo"), "shared header content must survive");
  assert.ok(!removed.has("fragF"), "shared footer fragment must survive page deletion");
  assert.ok(!removed.has("copyright"));
});

test("buildCloneMaps: cloning a page-body does NOT generate new ids for Slot fragments", () => {
  const b = makeBuild();
  const maps = buildCloneMaps(b, ["body"]);
  // Body + main + sloth itself + slotf are all remapped.
  assert.ok(maps.idMap.has("body"));
  assert.ok(maps.idMap.has("slotH"));
  assert.ok(maps.idMap.has("main"));
  // Shared fragments NOT in the remap → cloned Slot will keep the original id reference.
  assert.ok(!maps.idMap.has("fragH"), "Shared header fragment must NOT be cloned");
  assert.ok(!maps.idMap.has("logo"));
  assert.ok(!maps.idMap.has("fragF"));
});

test("SHARED_CHILDREN_COMPONENTS includes Slot", () => {
  assert.ok(SHARED_CHILDREN_COMPONENTS.has("Slot"));
});
