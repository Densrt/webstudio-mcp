// Additional fragment-to-patches coverage.
// fragmentToTransaction remaps breakpoints by label (NOT by id). When fragment defines
// "Base" / "Mobile portrait" with synthetic IDs, those IDs must be rewritten to the
// build's actual breakpoint IDs in every style patch.

import { test } from "node:test";
import assert from "node:assert/strict";
import { FragmentBuilder } from "../dist/builder.js";
import { fragmentToTransaction } from "../dist/fragment-to-patches.js";

function makeBuild(breakpoints) {
  return {
    id: "build1",
    projectId: "proj1",
    version: 1,
    createdAt: "", updatedAt: "",
    pages: { homePageId: "home", rootFolderId: "root", pages: [{ id: "home", name: "Home", path: "/", rootInstanceId: "home-root" }], folders: [] },
    breakpoints,
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

test("fragmentToTransaction remaps breakpoint IDs by label across fragment + build", () => {
  // Build's breakpoints: stable, real IDs.
  const buildBps = [
    { id: "bp-base-REAL", label: "Base" },
    { id: "bp-mobile-REAL", label: "Mobile portrait", maxWidth: 479 },
  ];
  const build = makeBuild(buildBps);

  // Fragment uses different (synthetic) breakpoint IDs.
  const b = new FragmentBuilder();
  b.addInstance("Box", { id: "section1" });
  b.addStyle("section1", "color", { type: "keyword", value: "red" }, "base");
  b.addStyle("section1", "color", { type: "keyword", value: "blue" }, "mobile-portrait");

  const fragment = b.build();
  const fragBpBase = fragment["@webstudio/instance/v0.1"].breakpoints.find((bp) => bp.label === "Base");
  const fragBpMobile = fragment["@webstudio/instance/v0.1"].breakpoints.find((bp) => bp.label === "Mobile portrait");
  assert.ok(fragBpBase);
  assert.ok(fragBpMobile);
  // Sanity: synthetic IDs differ from the build's real IDs.
  assert.notEqual(fragBpBase.id, "bp-base-REAL");
  assert.notEqual(fragBpMobile.id, "bp-mobile-REAL");

  const tx = fragmentToTransaction(fragment, build, { parentInstanceId: "home-root" });
  const stylesChange = tx.payload.find((c) => c.namespace === "styles");
  assert.ok(stylesChange);
  // Each style patch's value.breakpointId must be one of the build's REAL ids.
  for (const patch of stylesChange.patches) {
    assert.ok(
      buildBps.some((bp) => bp.id === patch.value.breakpointId),
      `style breakpointId "${patch.value.breakpointId}" was not remapped to a build id`,
    );
  }
  // The style key (path[0]) embeds the breakpointId too — it must be the REAL one.
  for (const patch of stylesChange.patches) {
    const key = patch.path[0];
    assert.ok(
      key.includes(patch.value.breakpointId),
      `style key "${key}" should embed the remapped breakpointId "${patch.value.breakpointId}"`,
    );
  }

  // breakpoints namespace: only the NEW (unmatched) labels are added.
  // FragmentBuilder always emits all 4 defaults; the build only owns "Base" + "Mobile portrait",
  // so we expect Tablet + "Mobile landscape" to be added — and the two matching ones to be absent.
  const bpsChange = tx.payload.find((c) => c.namespace === "breakpoints");
  assert.ok(bpsChange, "unmatched breakpoints should be added");
  const addedLabels = bpsChange.patches.map((p) => p.value.label).sort();
  assert.deepEqual(addedLabels, ["Mobile landscape", "Tablet"]);
  // The matching labels must NOT have been added (they were remapped).
  assert.ok(!addedLabels.includes("Base"));
  assert.ok(!addedLabels.includes("Mobile portrait"));
});

test("fragmentToTransaction adds NEW breakpoints when the build lacks some labels", () => {
  // Build only has "Base" — fragment will have "Base" + the three mobile labels.
  const build = makeBuild([{ id: "bp-base-REAL", label: "Base" }]);

  const b = new FragmentBuilder();
  b.addInstance("Box", { id: "sec" });
  const fragment = b.build();

  const tx = fragmentToTransaction(fragment, build, { parentInstanceId: "home-root" });
  const bpsChange = tx.payload.find((c) => c.namespace === "breakpoints");
  assert.ok(bpsChange, "missing breakpoints should be added");
  // Base maps to the existing one → 3 new breakpoints are added (tablet, mobile-landscape, mobile-portrait).
  assert.equal(bpsChange.patches.length, 3);
  const labels = bpsChange.patches.map((p) => p.value.label).sort();
  assert.deepEqual(labels, ["Mobile landscape", "Mobile portrait", "Tablet"]);
});

test("fragmentToTransaction inserts multi-root siblings (HtmlEmbed CSS + tree) at consecutive indices", () => {
  // Reproduces the pattern used by sheet/mobile-radix where a pattern emits
  // a dialog tree AND an HtmlEmbed sibling with shared CSS.
  const build = makeBuild([{ id: "bp-base-REAL", label: "Base" }]);
  build.instances[0].children = [{ type: "id", value: "existing-1" }];
  build.instances.push({ id: "existing-1", component: "Box", children: [] });

  const b = new FragmentBuilder();
  b.addInstance("Box", { id: "dialog" });
  b.addInstance("HtmlEmbed", { id: "css-embed" });
  const fragment = b.build();

  const tx = fragmentToTransaction(fragment, build, { parentInstanceId: "home-root" });
  const instChange = tx.payload.find((c) => c.namespace === "instances");
  // Insert patches appended at the end (index 1 and 2, since home-root already had 1 child).
  const inserts = instChange.patches.filter((p) => p.path.includes("children"));
  assert.equal(inserts.length, 2);
  assert.equal(inserts[0].path[2], 1);
  assert.equal(inserts[1].path[2], 2);
  assert.equal(inserts[0].value.value, "dialog");
  assert.equal(inserts[1].value.value, "css-embed");
});

test("fragmentToTransaction skips styleSources already present in the build (dedup by ID)", () => {
  const build = makeBuild([{ id: "bp-base-REAL", label: "Base" }]);
  // The build already owns a token by the same ID the fragment will reuse.
  build.styleSources = [{ id: "tok_shared", type: "token", name: "Brand" }];

  const b = new FragmentBuilder();
  b.addInstance("Box", { id: "sec" });
  const fragment = b.build();
  // Inject the shared token directly into the fragment payload (simulating reuse).
  fragment["@webstudio/instance/v0.1"].styleSources.push({ id: "tok_shared", type: "token", name: "Brand" });
  fragment["@webstudio/instance/v0.1"].styleSources.push({ id: "tok_new", type: "token", name: "New" });

  const tx = fragmentToTransaction(fragment, build, { parentInstanceId: "home-root" });
  const ssChange = tx.payload.find((c) => c.namespace === "styleSources");
  assert.ok(ssChange);
  const newIds = ssChange.patches.map((p) => p.path[0]);
  assert.deepEqual(newIds, ["tok_new"], "tok_shared should not be re-added; tok_new should be added");
});
