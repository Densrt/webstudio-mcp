// Tests for src/tools/share-slot-to-page.ts (v2.7.7).
//
// Coverage (via buildChanges pure function — no auth, no network):
// - source not found → throws SOURCE_NOT_FOUND
// - source not a Slot → throws SOURCE_NOT_A_SLOT with clone_page hint
// - source Slot empty → throws SOURCE_SLOT_EMPTY
// - source Slot multi-child → throws SOURCE_SLOT_MULTI_CHILD
// - no targets → throws NO_TARGETS
// - target page not found → outcome.status="error"
// - target parent not in target page → outcome.status="error"
// - happy path → outcome.status="ok" + correct instance patch + parent.children patch
// - idempotence: target already contains a Slot pointing to the shared child → skipped
// - batch mixed (ok + skipped + error) → correct outcomes per target

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildChanges } from "../dist/tools/share-slot-to-page.js";

function fakeBuild(options = {}) {
  const {
    sourceSlotId = "src-slot-id",
    sourceSlotComponent = "Slot",
    sourceSlotChildren = [{ type: "id", value: "shared-child-id" }],
    pages = [
      { id: "page-home", name: "Home", path: "/", rootInstanceId: "home-root" },
      { id: "page-offres", name: "Offres", path: "/offres", rootInstanceId: "offres-root" },
    ],
    offresAlreadyHasShared = false,
  } = options;

  const instances = [
    { type: "instance", id: "shared-child-id", component: "ws:element", tag: "div", label: "Shared Header", children: [] },
    { type: "instance", id: sourceSlotId, component: sourceSlotComponent, tag: "div", label: "Header Slot", children: sourceSlotChildren },
    { type: "instance", id: "home-root", component: "ws:element", tag: "div", label: "Home root", children: [{ type: "id", value: sourceSlotId }] },
  ];

  const offresChildren = [];
  if (offresAlreadyHasShared) {
    instances.push({ type: "instance", id: "offres-slot-existing", component: "Slot", tag: "div", label: "Header Slot", children: [{ type: "id", value: "shared-child-id" }] });
    offresChildren.push({ type: "id", value: "offres-slot-existing" });
  }
  instances.push({ type: "instance", id: "offres-root", component: "ws:element", tag: "div", label: "Offres root", children: offresChildren });

  return {
    instances,
    pages: { pages },
    props: [],
    styles: [],
    styleSources: [],
    styleSourceSelections: [],
    breakpoints: [],
    dataSources: [],
    resources: [],
    assets: [],
  };
}

function defaultArgs(overrides = {}) {
  return {
    projectSlug: "fake",
    sourceSlotInstanceId: "src-slot-id",
    targetPagePaths: [],
    targetPageIds: [],
    targetParentInstanceId: undefined,
    insertIndex: undefined,
    dryRun: true,
    ...overrides,
  };
}

test("buildChanges: source not found → throws SOURCE_NOT_FOUND", () => {
  const build = fakeBuild();
  assert.throws(
    () => buildChanges(build, defaultArgs({ sourceSlotInstanceId: "does-not-exist", targetPagePaths: ["/offres"] })),
    /SOURCE_NOT_FOUND/,
  );
});

test("buildChanges: source not a Slot → throws with clone_page hint", () => {
  const build = fakeBuild({ sourceSlotComponent: "ws:element" });
  assert.throws(
    () => buildChanges(build, defaultArgs({ targetPagePaths: ["/offres"] })),
    /SOURCE_NOT_A_SLOT[\s\S]*clone_page/,
  );
});

test("buildChanges: source Slot empty → throws SOURCE_SLOT_EMPTY", () => {
  const build = fakeBuild({ sourceSlotChildren: [] });
  assert.throws(
    () => buildChanges(build, defaultArgs({ targetPagePaths: ["/offres"] })),
    /SOURCE_SLOT_EMPTY/,
  );
});

test("buildChanges: source Slot multi-child → throws SOURCE_SLOT_MULTI_CHILD", () => {
  const build = fakeBuild({ sourceSlotChildren: [{ type: "id", value: "a" }, { type: "id", value: "b" }] });
  assert.throws(
    () => buildChanges(build, defaultArgs({ targetPagePaths: ["/offres"] })),
    /SOURCE_SLOT_MULTI_CHILD/,
  );
});

test("buildChanges: no targets → throws NO_TARGETS", () => {
  const build = fakeBuild();
  assert.throws(
    () => buildChanges(build, defaultArgs()),
    /NO_TARGETS/,
  );
});

test("buildChanges: target page not found → outcome error", () => {
  const build = fakeBuild();
  const r = buildChanges(build, defaultArgs({ targetPagePaths: ["/nonexistent"] }));
  assert.equal(r.outcomes.length, 1);
  assert.equal(r.outcomes[0].status, "error");
  assert.match(r.outcomes[0].reason, /page not found/);
});

test("buildChanges: happy path → ok outcome + 2 patches", () => {
  const build = fakeBuild();
  const r = buildChanges(build, defaultArgs({ targetPagePaths: ["/offres"] }));
  assert.equal(r.outcomes.length, 1);
  assert.equal(r.outcomes[0].status, "ok");
  assert.equal(r.outcomes[0].parentId, "offres-root");
  assert.ok(r.outcomes[0].newSlotId.length > 0);

  assert.equal(r.changes.length, 1);
  assert.equal(r.changes[0].namespace, "instances");
  // 1 patch for the new Slot wrapper + 1 patch for the parent.children update
  assert.equal(r.changes[0].patches.length, 2);

  const addPatch = r.changes[0].patches.find((p) => p.op === "add");
  assert.ok(addPatch);
  assert.equal(addPatch.value.component, "Slot");
  assert.deepEqual(addPatch.value.children, [{ type: "id", value: "shared-child-id" }]);
  assert.equal(addPatch.value.label, "Header Slot");

  const replacePatch = r.changes[0].patches.find((p) => p.op === "replace");
  assert.ok(replacePatch);
  assert.deepEqual(replacePatch.path, ["offres-root", "children"]);
  assert.equal(replacePatch.value.length, 1);
  assert.equal(replacePatch.value[0].type, "id");
  assert.equal(replacePatch.value[0].value, r.outcomes[0].newSlotId);
});

test("buildChanges: idempotence → target already has shared slot → skipped", () => {
  const build = fakeBuild({ offresAlreadyHasShared: true });
  const r = buildChanges(build, defaultArgs({ targetPagePaths: ["/offres"] }));
  assert.equal(r.outcomes.length, 1);
  assert.equal(r.outcomes[0].status, "skipped");
  assert.match(r.outcomes[0].reason, /idempotent/);
  assert.equal(r.changes.length, 0);
});

test("buildChanges: batch mixed (ok + skipped + error)", () => {
  const build = fakeBuild({
    pages: [
      { id: "page-home", name: "Home", path: "/", rootInstanceId: "home-root" },
      { id: "page-offres", name: "Offres", path: "/offres", rootInstanceId: "offres-root" },
      { id: "page-contact", name: "Contact", path: "/contact", rootInstanceId: "contact-root" },
    ],
    offresAlreadyHasShared: true,
  });
  build.instances.push({ type: "instance", id: "contact-root", component: "ws:element", tag: "div", label: "Contact root", children: [] });

  const r = buildChanges(build, defaultArgs({ targetPagePaths: ["/offres", "/contact", "/nonexistent"] }));
  assert.equal(r.outcomes.length, 3);
  const byRef = Object.fromEntries(r.outcomes.map((o) => [o.pageRef, o]));
  assert.equal(byRef["/offres"].status, "skipped");
  assert.equal(byRef["/contact"].status, "ok");
  assert.equal(byRef["/nonexistent"].status, "error");
  assert.match(byRef["/nonexistent"].reason, /page not found/);
});

test("buildChanges: targetParentInstanceId not in target page → outcome error", () => {
  const build = fakeBuild();
  const r = buildChanges(build, defaultArgs({
    targetPagePaths: ["/offres"],
    targetParentInstanceId: "home-root",
  }));
  assert.equal(r.outcomes.length, 1);
  assert.equal(r.outcomes[0].status, "error");
  assert.match(r.outcomes[0].reason, /not in page/);
});

test("buildChanges: insertIndex inserts at correct position", () => {
  const build = fakeBuild();
  // Add a sibling already in offres-root so insertIndex matters
  build.instances.find((i) => i.id === "offres-root").children = [
    { type: "id", value: "shared-child-id" }, // pre-existing child (using shared-child-id just as a placeholder id)
  ];
  const r = buildChanges(build, defaultArgs({ targetPagePaths: ["/offres"], insertIndex: 0 }));
  assert.equal(r.outcomes[0].status, "ok");
  const replacePatch = r.changes[0].patches.find((p) => p.op === "replace");
  // The new slot should be at index 0
  assert.equal(replacePatch.value[0].value, r.outcomes[0].newSlotId);
});
