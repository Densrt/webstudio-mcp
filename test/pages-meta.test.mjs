// Tests for src/tools/pages/meta.ts — pure functions only (no auth, no network).
//
// Coverage:
//   buildGetMetaResult:
//     - returns all known fields when `fields` omitted
//     - returns subset when `fields` specified (others omitted from output)
//     - sparse: unset keys are NOT present in the result.meta object
//     - orphan asset detection: emits hint + telemetryKey detect:orphan-meta-asset
//     - clean state: no hint when every assetId references a live asset
//
//   buildUpdateMetaTransaction:
//     - happy path: emits replace patches for changed fields
//     - add op when field was absent in storage
//     - remove op when caller passes null
//     - no-op when every value matches stored state
//     - no-op when caller passes only null on already-absent keys
//     - throws META_INVALID_EMAIL on malformed contactEmail
//     - throws META_ASSET_NOT_FOUND on unknown faviconAssetId / socialImageAssetId
//     - allows empty string (clear via "" is distinct from null/remove)
//     - mixed batch: 2 updates + 1 removal in one transaction

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGetMetaResult, buildUpdateMetaTransaction, META_FIELDS } from "../dist/tools/pages/meta.js";

function fakeBuild(opts = {}) {
  const {
    meta = {},
    assets = [
      { id: "asset-favicon-1", type: "image" },
      { id: "asset-og-1", type: "image" },
    ],
  } = opts;
  return {
    id: "build-1",
    projectId: "p1",
    version: 42,
    createdAt: "2026-05-28",
    updatedAt: "2026-05-28",
    pages: { meta, homePageId: "home", rootFolderId: "root", pages: [], folders: [] },
    breakpoints: [],
    instances: [],
    props: [],
    styles: [],
    styleSources: [],
    styleSourceSelections: [],
    dataSources: [],
    resources: [],
    assets,
    marketplaceProduct: {},
  };
}

// ─── buildGetMetaResult ──────────────────────────────────────────────────────

test("get_meta: returns every known field when fields omitted (sparse)", () => {
  const build = fakeBuild({ meta: { siteName: "Acme", contactEmail: "a@b.test" } });
  const r = buildGetMetaResult(build);
  assert.deepEqual(r.meta, { siteName: "Acme", contactEmail: "a@b.test" });
  assert.equal(r.hint, undefined);
  assert.equal(r.telemetryKey, undefined);
});

test("get_meta: returns only requested subset", () => {
  const build = fakeBuild({ meta: { code: "<script/>", siteName: "Acme", contactEmail: "a@b.test" } });
  const r = buildGetMetaResult(build, ["code"]);
  assert.deepEqual(r.meta, { code: "<script/>" });
});

test("get_meta: empty meta → empty result, no hint", () => {
  const r = buildGetMetaResult(fakeBuild());
  assert.deepEqual(r.meta, {});
  assert.equal(r.hint, undefined);
});

test("get_meta: orphan favicon → hint + telemetryKey detect:orphan-meta-asset", () => {
  const build = fakeBuild({ meta: { faviconAssetId: "asset-missing-xxx" } });
  const r = buildGetMetaResult(build);
  assert.equal(r.meta.faviconAssetId, "asset-missing-xxx");
  assert.match(r.hint ?? "", /faviconAssetId/);
  assert.equal(r.telemetryKey, "detect:orphan-meta-asset");
});

test("get_meta: live favicon → no hint emitted", () => {
  const build = fakeBuild({ meta: { faviconAssetId: "asset-favicon-1" } });
  const r = buildGetMetaResult(build);
  assert.equal(r.hint, undefined);
  assert.equal(r.telemetryKey, undefined);
});

test("get_meta: orphan only reported for fields actually requested", () => {
  const build = fakeBuild({ meta: { faviconAssetId: "asset-missing-xxx", siteName: "Acme" } });
  const r = buildGetMetaResult(build, ["siteName"]);
  assert.deepEqual(r.meta, { siteName: "Acme" });
  assert.equal(r.hint, undefined);
});

// ─── buildUpdateMetaTransaction — happy paths ────────────────────────────────

test("update_meta: add op when field was absent", () => {
  const build = fakeBuild({ meta: {} });
  const r = buildUpdateMetaTransaction(build, { siteName: "Acme" });
  assert.equal(r.kind, "patch");
  assert.equal(r.appliedFields.length, 1);
  assert.deepEqual(r.transaction.payload[0].patches, [
    { op: "add", path: ["meta", "siteName"], value: "Acme" },
  ]);
});

test("update_meta: replace op when field already had a value", () => {
  const build = fakeBuild({ meta: { siteName: "Old" } });
  const r = buildUpdateMetaTransaction(build, { siteName: "New" });
  assert.equal(r.kind, "patch");
  assert.deepEqual(r.transaction.payload[0].patches, [
    { op: "replace", path: ["meta", "siteName"], value: "New" },
  ]);
});

test("update_meta: remove op when caller passes null on present field", () => {
  const build = fakeBuild({ meta: { faviconAssetId: "asset-favicon-1" } });
  const r = buildUpdateMetaTransaction(build, { faviconAssetId: null });
  assert.equal(r.kind, "patch");
  assert.deepEqual(r.transaction.payload[0].patches, [
    { op: "remove", path: ["meta", "faviconAssetId"] },
  ]);
});

test("update_meta: null on already-absent field → skipped (no patch)", () => {
  const build = fakeBuild({ meta: {} });
  const r = buildUpdateMetaTransaction(build, { faviconAssetId: null });
  assert.equal(r.kind, "noop");
});

test("update_meta: every value equal to current → noop", () => {
  const build = fakeBuild({ meta: { siteName: "Acme", contactEmail: "a@b.test" } });
  const r = buildUpdateMetaTransaction(build, { siteName: "Acme", contactEmail: "a@b.test" });
  assert.equal(r.kind, "noop");
});

test("update_meta: mixed batch — add + replace + remove in one transaction", () => {
  const build = fakeBuild({
    meta: { siteName: "Old", faviconAssetId: "asset-favicon-1" },
  });
  const r = buildUpdateMetaTransaction(build, {
    code: "<script>gtm</script>",
    siteName: "New",
    faviconAssetId: null,
  });
  assert.equal(r.kind, "patch");
  assert.equal(r.transaction.payload[0].patches.length, 3);
  const ops = r.transaction.payload[0].patches.map((p) => `${p.op}:${p.path[1]}`).sort();
  assert.deepEqual(ops, ["add:code", "remove:faviconAssetId", "replace:siteName"]);
});

test("update_meta: empty string is a valid value (distinct from null)", () => {
  const build = fakeBuild({ meta: { siteName: "Acme" } });
  const r = buildUpdateMetaTransaction(build, { siteName: "" });
  assert.equal(r.kind, "patch");
  assert.deepEqual(r.transaction.payload[0].patches, [
    { op: "replace", path: ["meta", "siteName"], value: "" },
  ]);
});

// ─── buildUpdateMetaTransaction — validation errors ──────────────────────────

test("update_meta: throws META_INVALID_EMAIL on malformed contactEmail", () => {
  const build = fakeBuild();
  assert.throws(
    () => buildUpdateMetaTransaction(build, { contactEmail: "not-an-email" }),
    /META_INVALID_EMAIL/,
  );
});

test("update_meta: empty contactEmail does not trip email validator", () => {
  const build = fakeBuild({ meta: { contactEmail: "a@b.test" } });
  // Empty string clears the value but should pass validation (length === 0).
  const r = buildUpdateMetaTransaction(build, { contactEmail: "" });
  assert.equal(r.kind, "patch");
});

test("update_meta: throws META_ASSET_NOT_FOUND on unknown faviconAssetId", () => {
  const build = fakeBuild();
  assert.throws(
    () => buildUpdateMetaTransaction(build, { faviconAssetId: "asset-missing-xxx" }),
    /META_ASSET_NOT_FOUND.*faviconAssetId/,
  );
});

test("update_meta: throws META_ASSET_NOT_FOUND on unknown socialImageAssetId", () => {
  const build = fakeBuild();
  assert.throws(
    () => buildUpdateMetaTransaction(build, { socialImageAssetId: "asset-missing-yyy" }),
    /META_ASSET_NOT_FOUND.*socialImageAssetId/,
  );
});

test("update_meta: null on assetId never triggers the asset existence check", () => {
  const build = fakeBuild({ meta: { faviconAssetId: "asset-favicon-1" } });
  // null clears — must NOT hit the assetIds set check.
  const r = buildUpdateMetaTransaction(build, { faviconAssetId: null });
  assert.equal(r.kind, "patch");
});

test("update_meta: valid assetId pointing to existing asset passes", () => {
  const build = fakeBuild();
  const r = buildUpdateMetaTransaction(build, { faviconAssetId: "asset-favicon-1" });
  assert.equal(r.kind, "patch");
});

// ─── META_FIELDS sanity ──────────────────────────────────────────────────────

// ─── Path shape regression guard ─────────────────────────────────────────────
//
// Bug (2026-05-28, pre-v2.10.0 release): path was ["pages","meta",field] which
// targets build.pages.pages.meta.field — but build.pages.pages is the pages
// ARRAY, not an object with meta. Webstudio's server rejects the patch with a
// minified Immer error. Correct path is ["meta",field] relative to build.pages.

test("path: never prefixes with 'pages' — must be relative to build.pages", () => {
  const build = fakeBuild({ meta: { siteName: "Old" } });
  const r = buildUpdateMetaTransaction(build, {
    code: "<script/>",
    siteName: "New",
    faviconAssetId: null,
  });
  assert.equal(r.kind, "patch");
  for (const p of r.transaction.payload[0].patches) {
    assert.notEqual(p.path[0], "pages", `patch path must not start with 'pages' — got ${JSON.stringify(p.path)}`);
    assert.equal(p.path[0], "meta", `patch path must start with 'meta' — got ${JSON.stringify(p.path)}`);
    assert.equal(p.path.length, 2, `patch path must be 2 segments [meta, field] — got ${JSON.stringify(p.path)}`);
  }
});

test("META_FIELDS exposes the canonical 5-field whitelist", () => {
  assert.deepEqual(
    [...META_FIELDS].sort(),
    ["code", "contactEmail", "faviconAssetId", "siteName", "socialImageAssetId"],
  );
});
