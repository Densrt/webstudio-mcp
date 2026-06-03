// Unit tests for webstudio_delete_token_decl — pure transaction builder.
// Bug 2 (a production site, 2026-05-21): no MCP-side way to remove a single decl from a token.
// styles.delete_decl rejects token styleSourceIds ("instance not found"). This action
// fills the gap atomically without recreating the token.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDeleteTokenDeclTransaction } from "../dist/tools/delete-token-decl.js";

function makeBuild({ tokenId = "tok-1", tokenName = "Icon Badge", styles = [], breakpoints }) {
  const bps = breakpoints ?? [
    { id: "bp-base", label: "Base" },
    { id: "bp-md", label: "Medium" },
  ];
  return {
    id: "b",
    projectId: "p",
    pages: { meta: { name: "" }, homePage: { id: "h", path: "/", name: "home" }, pages: [] },
    instances: [],
    styleSources: [{ id: tokenId, type: "token", name: tokenName }],
    styleSourceSelections: [],
    props: [],
    styles,
    breakpoints: bps,
    dataSources: [],
    resources: [],
    assets: [],
  };
}

const decl = (overrides) => ({
  styleSourceId: "tok-1",
  breakpointId: "bp-base",
  property: "color",
  value: { type: "keyword", value: "red" },
  ...overrides,
});

test("delete single decl by property → one remove patch", () => {
  const build = makeBuild({ styles: [decl({ property: "padding" })] });
  const tx = buildDeleteTokenDeclTransaction(build, "tok-1", [{ property: "padding" }]);
  assert.equal(tx.matchedCount, 1);
  assert.equal(tx.transaction.payload[0].patches.length, 1);
  assert.equal(tx.transaction.payload[0].patches[0].op, "remove");
  assert.equal(tx.transaction.payload[0].patches[0].path[0], "tok-1:bp-base:padding:");
});

test("omitting breakpoint matches every breakpoint for that property", () => {
  const build = makeBuild({
    styles: [
      decl({ property: "padding", breakpointId: "bp-base" }),
      decl({ property: "padding", breakpointId: "bp-md" }),
      decl({ property: "color", breakpointId: "bp-base" }),
    ],
  });
  const tx = buildDeleteTokenDeclTransaction(build, "tok-1", [{ property: "padding" }]);
  assert.equal(tx.matchedCount, 2);
});

test("breakpoint filter restricts removals to that bp", () => {
  const build = makeBuild({
    styles: [
      decl({ property: "padding", breakpointId: "bp-base" }),
      decl({ property: "padding", breakpointId: "bp-md" }),
    ],
  });
  const tx = buildDeleteTokenDeclTransaction(build, "tok-1", [{ property: "padding", breakpoint: "Medium" }]);
  assert.equal(tx.matchedCount, 1);
  assert.equal(tx.transaction.payload[0].patches[0].path[0], "tok-1:bp-md:padding:");
});

test("unknown breakpoint → skipped with hint, no patches", () => {
  const build = makeBuild({ styles: [decl({ property: "padding" })] });
  const tx = buildDeleteTokenDeclTransaction(build, "tok-1", [{ property: "padding", breakpoint: "Nope" }]);
  assert.equal(tx.matchedCount, 0);
  assert.match(tx.details.join("\n"), /not found/);
});

test("no match → no-op (idempotent)", () => {
  const build = makeBuild({ styles: [decl({ property: "color" })] });
  const tx = buildDeleteTokenDeclTransaction(build, "tok-1", [{ property: "padding" }]);
  assert.equal(tx.matchedCount, 0);
  assert.equal(tx.transaction.payload.length, 0);
});

test("state filter — omitted state matches every variant", () => {
  const build = makeBuild({
    styles: [
      decl({ property: "color" }), // base
      decl({ property: "color", state: ":hover" }),
    ],
  });
  const tx = buildDeleteTokenDeclTransaction(build, "tok-1", [{ property: "color" }]);
  assert.equal(tx.matchedCount, 2);
});

test("state filter — empty string targets base only", () => {
  const build = makeBuild({
    styles: [
      decl({ property: "color" }), // base
      decl({ property: "color", state: ":hover" }),
    ],
  });
  const tx = buildDeleteTokenDeclTransaction(build, "tok-1", [{ property: "color", state: "" }]);
  assert.equal(tx.matchedCount, 1);
});

test("does NOT touch decls of other tokens or instances", () => {
  const build = makeBuild({
    styles: [
      decl({ property: "padding" }),
      decl({ property: "padding", styleSourceId: "tok-other" }),
      decl({ property: "padding", styleSourceId: "local-x" }),
    ],
  });
  const tx = buildDeleteTokenDeclTransaction(build, "tok-1", [{ property: "padding" }]);
  assert.equal(tx.matchedCount, 1);
  assert.equal(tx.transaction.payload[0].patches[0].path[0].startsWith("tok-1:"), true);
});

test("multiple deletions in one call → multiple patches", () => {
  const build = makeBuild({
    styles: [decl({ property: "padding" }), decl({ property: "color" })],
  });
  const tx = buildDeleteTokenDeclTransaction(build, "tok-1", [
    { property: "padding" },
    { property: "color" },
  ]);
  assert.equal(tx.matchedCount, 2);
});
