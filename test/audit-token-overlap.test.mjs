// Unit tests for webstudio_audit_token_overlap classification logic.
// Tests buildReport directly to avoid network/auth.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport } from "../dist/tools/audit-token-overlap.js";

function makeBuild(opts) {
  const { tokenDecls = [], localDecls = [], instanceIds = ["inst-a"], extraTokens = [] } = opts;
  const tokenId = "tok-1";
  const localBaseId = "local-";
  const instances = instanceIds.map((id) => ({ id, component: "Box", label: `Instance ${id}`, children: [] }));
  const styleSources = [
    { type: "token", id: tokenId, name: "MyToken" },
    ...instanceIds.map((id, i) => ({ type: "local", id: `${localBaseId}${i}` })),
    ...extraTokens,
  ];
  const styleSourceSelections = instanceIds.map((id, i) => ({
    instanceId: id,
    values: [tokenId, `${localBaseId}${i}`],
  }));
  const styles = [
    ...tokenDecls.map((d) => ({ ...d, styleSourceId: tokenId })),
    ...localDecls.flatMap((arr, i) =>
      arr.map((d) => ({ ...d, styleSourceId: `${localBaseId}${i}` }))
    ),
  ];
  return {
    id: "build1",
    projectId: "proj1",
    version: 1,
    createdAt: "",
    updatedAt: "",
    pages: { homePageId: "home", rootFolderId: "root", pages: [], folders: [] },
    breakpoints: [
      { id: "bp-base", label: "Base" },
      { id: "bp-mobile", label: "Mobile" },
    ],
    instances,
    props: [],
    styles,
    styleSources,
    styleSourceSelections,
    dataSources: [],
    resources: [],
    deployments: [],
    assets: [],
    marketplaceProduct: null,
  };
}

test("returns TOKEN_NOT_FOUND when token name does not match", () => {
  const build = makeBuild({});
  const r = buildReport(build, { projectSlug: "p", tokenName: "Nope", maxInstances: 25, verbose: true });
  assert.equal(r.error, "TOKEN_NOT_FOUND");
});

test("classifies DUPE when local value equals token value on same (bp, prop, state)", () => {
  const build = makeBuild({
    tokenDecls: [{ breakpointId: "bp-base", property: "color", value: { type: "keyword", value: "red" } }],
    localDecls: [[{ breakpointId: "bp-base", property: "color", value: { type: "keyword", value: "red" } }]],
  });
  const r = buildReport(build, { projectSlug: "p", tokenName: "MyToken", maxInstances: 25, verbose: true });
  assert.ok(!r.error);
  assert.equal(r.totals.dupes, 1);
  assert.equal(r.totals.overrides, 0);
  assert.equal(r.totals.uniques, 0);
  assert.equal(r.perInstance[0].classified[0].kind, "DUPE");
});

test("classifies OVERRIDE when local value differs from token on same (bp, prop, state)", () => {
  const build = makeBuild({
    tokenDecls: [{ breakpointId: "bp-base", property: "color", value: { type: "keyword", value: "red" } }],
    localDecls: [[{ breakpointId: "bp-base", property: "color", value: { type: "keyword", value: "blue" } }]],
  });
  const r = buildReport(build, { projectSlug: "p", tokenName: "MyToken", maxInstances: 25, verbose: true });
  assert.ok(!r.error);
  assert.equal(r.totals.overrides, 1);
  assert.equal(r.totals.dupes, 0);
  assert.equal(r.perInstance[0].classified[0].kind, "OVERRIDE");
});

test("classifies UNIQUE when local prop has no matching token decl on same (bp, prop, state)", () => {
  const build = makeBuild({
    tokenDecls: [{ breakpointId: "bp-base", property: "color", value: { type: "keyword", value: "red" } }],
    localDecls: [[{ breakpointId: "bp-base", property: "fontSize", value: { type: "unit", value: 16, unit: "px" } }]],
  });
  const r = buildReport(build, { projectSlug: "p", tokenName: "MyToken", maxInstances: 25, verbose: true });
  assert.ok(!r.error);
  assert.equal(r.totals.uniques, 1);
  assert.equal(r.perInstance[0].classified[0].kind, "UNIQUE");
});

test("matching is per-breakpoint: same prop different bp is UNIQUE not DUPE", () => {
  const build = makeBuild({
    tokenDecls: [{ breakpointId: "bp-base", property: "color", value: { type: "keyword", value: "red" } }],
    localDecls: [[{ breakpointId: "bp-mobile", property: "color", value: { type: "keyword", value: "red" } }]],
  });
  const r = buildReport(build, { projectSlug: "p", tokenName: "MyToken", maxInstances: 25, verbose: true });
  assert.equal(r.totals.uniques, 1);
  assert.equal(r.totals.dupes, 0);
});

test("matching is per-state: same prop different state is UNIQUE not DUPE", () => {
  const build = makeBuild({
    tokenDecls: [{ breakpointId: "bp-base", property: "color", value: { type: "keyword", value: "red" } }],
    localDecls: [[{ breakpointId: "bp-base", property: "color", state: ":hover", value: { type: "keyword", value: "red" } }]],
  });
  const r = buildReport(build, { projectSlug: "p", tokenName: "MyToken", maxInstances: 25, verbose: true });
  assert.equal(r.totals.uniques, 1);
  assert.equal(r.totals.dupes, 0);
});

test("aggregates totals across multiple consumer instances", () => {
  const build = makeBuild({
    instanceIds: ["a", "b"],
    tokenDecls: [{ breakpointId: "bp-base", property: "color", value: { type: "keyword", value: "red" } }],
    localDecls: [
      [{ breakpointId: "bp-base", property: "color", value: { type: "keyword", value: "red" } }],
      [{ breakpointId: "bp-base", property: "color", value: { type: "keyword", value: "blue" } }],
    ],
  });
  const r = buildReport(build, { projectSlug: "p", tokenName: "MyToken", maxInstances: 25, verbose: true });
  assert.equal(r.perInstance.length, 2);
  assert.equal(r.totals.dupes, 1);
  assert.equal(r.totals.overrides, 1);
});

test("instance with no local style source is reported but contributes 0 to totals", () => {
  const tokenId = "tok-1";
  const build = {
    id: "b", projectId: "p", version: 1, createdAt: "", updatedAt: "",
    pages: { homePageId: "h", rootFolderId: "r", pages: [], folders: [] },
    breakpoints: [{ id: "bp-base", label: "Base" }],
    instances: [{ id: "x", component: "Box", label: "X", children: [] }],
    props: [], dataSources: [], resources: [], deployments: [], assets: [], marketplaceProduct: null,
    styles: [{ styleSourceId: tokenId, breakpointId: "bp-base", property: "color", value: { type: "keyword", value: "red" } }],
    styleSources: [{ type: "token", id: tokenId, name: "MyToken" }],
    styleSourceSelections: [{ instanceId: "x", values: [tokenId] }],
  };
  const r = buildReport(build, { projectSlug: "p", tokenName: "MyToken", maxInstances: 25, verbose: true });
  assert.equal(r.perInstance.length, 1);
  assert.equal(r.perInstance[0].hasLocal, false);
  assert.equal(r.totals.dupes, 0);
});

test("identifies token by id when tokenId is provided", () => {
  const build = makeBuild({
    tokenDecls: [{ breakpointId: "bp-base", property: "color", value: { type: "keyword", value: "red" } }],
  });
  const r = buildReport(build, { projectSlug: "p", tokenId: "tok-1", maxInstances: 25, verbose: true });
  assert.ok(!r.error);
  assert.equal(r.token.id, "tok-1");
});

// ─── Token health (corruption detection) ────────────────────────────────────

test("corruptDecls is empty when every token state is canonical", () => {
  const build = makeBuild({
    tokenDecls: [
      { breakpointId: "bp-base", property: "color", value: { type: "keyword", value: "red" } },
      { breakpointId: "bp-base", property: "color", state: ":hover", value: { type: "keyword", value: "blue" } },
      { breakpointId: "bp-base", property: "color", state: "::before", value: { type: "keyword", value: "green" } },
    ],
  });
  const r = buildReport(build, { projectSlug: "p", tokenName: "MyToken", maxInstances: 25, verbose: true });
  assert.equal(r.corruptDecls.length, 0);
});

test("corruptDecls flags malformed state like '::hover' (pseudo-class with double colon)", () => {
  const build = makeBuild({
    tokenDecls: [
      { breakpointId: "bp-base", property: "color", state: "::hover", value: { type: "keyword", value: "red" } },
    ],
  });
  const r = buildReport(build, { projectSlug: "p", tokenName: "MyToken", maxInstances: 25, verbose: true });
  assert.equal(r.corruptDecls.length, 1);
  assert.equal(r.corruptDecls[0].rawState, "::hover");
  assert.equal(r.corruptDecls[0].suggestion, ":hover");
});

test("corruptDecls flags bare state like 'hover' (missing leading colon)", () => {
  const build = makeBuild({
    tokenDecls: [
      { breakpointId: "bp-base", property: "color", state: "hover", value: { type: "keyword", value: "red" } },
    ],
  });
  const r = buildReport(build, { projectSlug: "p", tokenName: "MyToken", maxInstances: 25, verbose: true });
  assert.equal(r.corruptDecls.length, 1);
  assert.equal(r.corruptDecls[0].suggestion, ":hover");
});

test("corruptDecls flags legacy ':before' as needing ::before", () => {
  const build = makeBuild({
    tokenDecls: [
      { breakpointId: "bp-base", property: "content", state: ":before", value: { type: "keyword", value: "" } },
    ],
  });
  const r = buildReport(build, { projectSlug: "p", tokenName: "MyToken", maxInstances: 25, verbose: true });
  assert.equal(r.corruptDecls.length, 1);
  assert.equal(r.corruptDecls[0].suggestion, "::before");
});

test("tolerant matcher: corrupted local '::hover' value-equal to token ':hover' classifies as DUPE", () => {
  // Regression for the matcher-aveugle bug: previously this local would be UNIQUE (no match)
  // because the index key `::hover` ≠ `:hover`. With stateMatches, it correctly classifies as DUPE.
  const build = makeBuild({
    tokenDecls: [
      { breakpointId: "bp-base", property: "color", state: ":hover", value: { type: "keyword", value: "red" } },
    ],
    localDecls: [[
      { breakpointId: "bp-base", property: "color", state: "::hover", value: { type: "keyword", value: "red" } },
    ]],
  });
  const r = buildReport(build, { projectSlug: "p", tokenName: "MyToken", maxInstances: 25, verbose: true });
  assert.equal(r.totals.dupes, 1);
  assert.equal(r.totals.uniques, 0);
});

test("tolerant matcher: corrupted local '::hover' value-DIFF from token ':hover' classifies as OVERRIDE", () => {
  const build = makeBuild({
    tokenDecls: [
      { breakpointId: "bp-base", property: "color", state: ":hover", value: { type: "keyword", value: "red" } },
    ],
    localDecls: [[
      { breakpointId: "bp-base", property: "color", state: "::hover", value: { type: "keyword", value: "blue" } },
    ]],
  });
  const r = buildReport(build, { projectSlug: "p", tokenName: "MyToken", maxInstances: 25, verbose: true });
  assert.equal(r.totals.overrides, 1);
  assert.equal(r.totals.uniques, 0);
});
