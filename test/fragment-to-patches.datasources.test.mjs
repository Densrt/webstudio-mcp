// Test coverage for the `dataSources` namespace emitted by fragmentToTransaction
// when a fragment carries variable / parameter dataSources (added 2026-05-18
// to support ws:collection per-item bindings — see
// docs/patterns/ws-collection-bindings.md).

import { test } from "node:test";
import assert from "node:assert/strict";
import { FragmentBuilder } from "../dist/builder.js";
import { fragmentToTransaction } from "../dist/fragment-to-patches.js";
import { BuildFragmentSchema, buildFromArgs } from "../dist/build-from-args.js";

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

test("FragmentBuilder.addParameter() stages a parameter dataSource", () => {
  const b = new FragmentBuilder();
  const collectionId = b.addInstance("ws:element", { id: "col" });
  const itemId = b.addParameter(collectionId, "occasion", "item-id-1");
  const payload = b.build()["@webstudio/instance/v0.1"];
  assert.equal(itemId, "item-id-1");
  assert.equal(payload.dataSources.length, 1);
  assert.deepEqual(payload.dataSources[0], {
    type: "parameter",
    id: "item-id-1",
    scopeInstanceId: "col",
    name: "occasion",
  });
});

test("fragmentToTransaction emits a 'dataSources' namespace patch when present", () => {
  const b = new FragmentBuilder();
  b.addInstance("ws:element", { id: "col" });
  b.addParameter("col", "occasion", "item-1");
  const fragment = b.build();
  const tx = fragmentToTransaction(fragment, makeBuild(), { parentInstanceId: "home-root" });
  const dsChange = tx.payload.find((c) => c.namespace === "dataSources");
  assert.ok(dsChange, "should emit a dataSources namespace change");
  assert.equal(dsChange.patches.length, 1);
  assert.equal(dsChange.patches[0].op, "add");
  assert.deepEqual(dsChange.patches[0].path, ["item-1"]);
  assert.equal(dsChange.patches[0].value.type, "parameter");
  assert.equal(dsChange.patches[0].value.scopeInstanceId, "col");
});

test("fragmentToTransaction OMITS dataSources namespace when fragment has none", () => {
  const b = new FragmentBuilder();
  b.addInstance("Box", { id: "section1" });
  const fragment = b.build();
  const tx = fragmentToTransaction(fragment, makeBuild(), { parentInstanceId: "home-root" });
  const dsChange = tx.payload.find((c) => c.namespace === "dataSources");
  assert.equal(dsChange, undefined, "no namespace patch when array is empty");
});

test("BuildFragmentSchema accepts dataSources input (parameter + variable)", () => {
  const args = {
    instances: [{ id: "col", component: "ws:element", children: [] }],
    dataSources: [
      { type: "parameter", id: "p1", scopeInstanceId: "col", name: "item" },
      { type: "variable", id: "v1", scopeInstanceId: "col", name: "count", value: { type: "number", value: 0 } },
    ],
  };
  const parsed = BuildFragmentSchema.safeParse(args);
  assert.ok(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error?.issues));
});

test("BuildFragmentSchema rejects dataSources with unknown type", () => {
  const args = {
    instances: [{ id: "col", component: "ws:element", children: [] }],
    dataSources: [{ type: "bogus", id: "x", scopeInstanceId: "col", name: "y" }],
  };
  const parsed = BuildFragmentSchema.safeParse(args);
  assert.equal(parsed.success, false);
});

test("buildFromArgs forwards dataSources to the builder payload", () => {
  const builder = buildFromArgs({
    instances: [{ id: "col", component: "ws:element", children: [] }],
    props: [],
    styles: [],
    tokens: [],
    useTokens: [],
    dataSources: [
      { type: "parameter", id: "ds-1", scopeInstanceId: "col", name: "occasion" },
    ],
  });
  const payload = builder.build()["@webstudio/instance/v0.1"];
  assert.equal(payload.dataSources.length, 1);
  assert.equal(payload.dataSources[0].id, "ds-1");
});

test("Full ws:collection roundtrip: instances + parameter dataSource + props in same fragment", () => {
  const builder = buildFromArgs({
    instances: [
      { id: "col", component: "ws:collection", children: [{ type: "id", value: "tpl" }] },
      { id: "tpl", component: "ws:element", tag: "article", children: [
        { type: "expression", value: "$ws$dataSource$item.brand" },
      ] },
    ],
    props: [
      { instanceId: "col", name: "data", type: "expression", value: '[{"brand":"Acme"}]' },
      { instanceId: "col", name: "item", type: "parameter", value: "item" },
    ],
    styles: [], tokens: [], useTokens: [],
    dataSources: [
      { type: "parameter", id: "item", scopeInstanceId: "col", name: "occasion" },
    ],
  });
  const fragment = builder.build();
  const tx = fragmentToTransaction(fragment, makeBuild(), { parentInstanceId: "home-root" });

  // Should emit all 3 namespaces in same transaction (atomic).
  const namespaces = tx.payload.map((c) => c.namespace);
  assert.ok(namespaces.includes("instances"));
  assert.ok(namespaces.includes("props"));
  assert.ok(namespaces.includes("dataSources"));
});
