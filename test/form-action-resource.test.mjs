// v2.20.0 — form-action resource decoupling.
//
// Cas réel (2026-06-10): a form action created via resources.create got the
// systematic companion dataSource at :root scope — a dataSource is fetched on
// EVERY render, so the lead webhook received empty-body POSTs on page load
// (rhythm shaped by the auto Cache-Control: max-age=3600). v2.20.0 makes the
// dataSource and the cache header method-aware: POST/PUT/DELETE default to a
// STANDALONE resource (the healthy form-action shape verified on production
// builds: resource present, zero dataSource, Form action prop type:"resource").

import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "form-action-"));
process.env.WEBSTUDIO_PROJECTS_DIR = tmpRoot;

const { resolveCreateOptions, buildCreateResourceTransaction, createResourceTool } =
  await import("../dist/tools/resources/create.js");
const { renderReport } = await import("../dist/tools/audit-resources-perf/report.js");
const { invalidateBuildCache } = await import("../dist/webstudio-client.js");

const slug = "formproj";
fs.mkdirSync(path.join(tmpRoot, slug), { recursive: true });
fs.writeFileSync(path.join(tmpRoot, slug, "webstudio-auth.json"), JSON.stringify({
  projectId: "pf", cookie: "ck", csrfToken: "csrf", appVersion: "1", allowPush: false,
}));

const baseInput = {
  projectSlug: slug,
  name: "action",
  url: "https://hooks.example.com/leads",
  method: "post",
  searchParams: [],
  headers: [],
  dryRun: true,
};

// ── resolveCreateOptions (method-aware defaults) ────────────────────────────

test("defaults: GET exposes + caches, mutations are standalone + uncached", () => {
  assert.deepEqual(resolveCreateOptions({ method: "get" }), { expose: true, cacheMaxAge: 3600 });
  assert.deepEqual(resolveCreateOptions({ method: "post" }), { expose: false, cacheMaxAge: 0 });
  assert.deepEqual(resolveCreateOptions({ method: "delete" }), { expose: false, cacheMaxAge: 0 });
  // explicit overrides win
  assert.deepEqual(
    resolveCreateOptions({ method: "post", exposeAsDataSource: true, cacheMaxAge: 60 }),
    { expose: true, cacheMaxAge: 60 },
  );
  assert.equal(resolveCreateOptions({ method: "get", exposeAsDataSource: false }).expose, false);
});

// ── buildCreateResourceTransaction ──────────────────────────────────────────

test("standalone form action: resources namespace only, no dataSource, no cache header", () => {
  const tx = buildCreateResourceTransaction("res1", "ds1", baseInput, { expose: false, cacheMaxAge: 0 });
  assert.deepEqual(tx.payload.map((c) => c.namespace), ["resources"]);
  const resource = tx.payload[0].patches[0].value;
  assert.equal(resource.method, "post");
  assert.ok(!resource.headers.some((h) => h.name.toLowerCase() === "cache-control"), "no auto cache header on a form action");
});

test("exposed GET: dataSource patch present with the scope, cache header injected", () => {
  const input = { ...baseInput, method: "get", scopeInstanceId: ":root" };
  const tx = buildCreateResourceTransaction("res1", "ds1", input, { expose: true, cacheMaxAge: 3600 });
  assert.deepEqual(tx.payload.map((c) => c.namespace), ["resources", "dataSources"]);
  const ds = tx.payload[1].patches[0].value;
  assert.equal(ds.type, "resource");
  assert.equal(ds.resourceId, "res1");
  assert.equal(ds.scopeInstanceId, ":root");
  const resource = tx.payload[0].patches[0].value;
  assert.ok(resource.headers.some((h) => h.value === JSON.stringify("max-age=3600")));
});

// ── handler validations (dry-run, no network mutation) ─────────────────────

const stubFetch = () => {
  invalidateBuildCache();
  globalThis.fetch = async (url) => {
    if (String(url).includes("/rest/data/")) {
      return new Response(JSON.stringify({
        id: "b", projectId: "pf", version: 1, project: { title: "Form Proj" },
        pages: { homePageId: "h", rootFolderId: "r", pages: [], folders: [] },
        breakpoints: [], instances: [], props: [], styles: [], styleSources: [],
        styleSourceSelections: [], dataSources: [], resources: [], assets: [],
      }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
};
const realFetch = globalThis.fetch;

test("handler: GET without scopeInstanceId is refused with the form-action redirect", async () => {
  stubFetch();
  try {
    const r = await createResourceTool.handler({ ...baseInput, method: "get" });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /scopeInstanceId is required/);
    assert.match(r.content[0].text, /form action/);
  } finally { globalThis.fetch = realFetch; }
});

test("handler: POST default dry-run reports no dataSource and no warning", async () => {
  stubFetch();
  try {
    const r = await createResourceTool.handler({ ...baseInput });
    assert.notEqual(r.isError, true, r.content?.[0]?.text);
    assert.match(r.content[0].text, /dataSource: \(none/);
    assert.doesNotMatch(r.content[0].text, /FIRE ON EVERY RENDER/);
  } finally { globalThis.fetch = realFetch; }
});

test("handler: forcing exposeAsDataSource on a POST emits the render-time warning", async () => {
  stubFetch();
  try {
    const r = await createResourceTool.handler({ ...baseInput, exposeAsDataSource: true, scopeInstanceId: ":root" });
    assert.notEqual(r.isError, true, r.content?.[0]?.text);
    assert.match(r.content[0].text, /FIRE ON EVERY RENDER/);
  } finally { globalThis.fetch = realFetch; }
});

// ── audit: render-time mutation detection ───────────────────────────────────

const analyzed = (over) => ({
  id: "res1", name: "action_x", method: "post", urlExpression: '"https://h.example/leads"',
  urlLiteral: "https://h.example/leads", urlNormalized: "https://h.example/leads",
  urlOriginPath: "https://h.example/leads", cacheMaxAge: 3600, isGet: false,
  linkedDataSourceId: "ds1", linkedScopeInstanceId: ":root",
  pageId: undefined, pagePath: undefined, dependsOnResourceIds: [],
  ...over,
});

test("audit: non-GET exposed as dataSource is flagged as render-time mutation", () => {
  const report = renderReport("p", "P", [analyzed({})], 6, false);
  assert.match(report, /Render-time mutations \(non-GET exposed as dataSource\): 1/);
  assert.match(report, /\[ERROR\] "action_x".*POST exposed as dataSource ds1 @ :root/);
  assert.match(report, /form-action-resource/);
});

test("audit: standalone POST (healthy form action) is NOT flagged", () => {
  const report = renderReport("p", "P", [analyzed({ linkedDataSourceId: undefined, linkedScopeInstanceId: undefined })], 6, false);
  assert.match(report, /Render-time mutations \(non-GET exposed as dataSource\): 0/);
  assert.match(report, /🔥 Render-time mutations.*\n  ✅ none/);
});
