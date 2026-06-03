// Regression tests for the audit-detection + delete-safety bugs discovered during
// a production cleanup session (2026-05-20). Each bug below caused operator
// damage and required recovery — these tests pin the fixed behaviour so we don't
// regress.

import { test } from "node:test";
import assert from "node:assert/strict";

// ─── Bug A — audit.orphans resources: prop refs type=resource were ignored ───

test("findOrphanResources: does NOT flag a resource referenced only via prop type=resource", async () => {
  const { CATEGORY_RUNNERS } = await import("../dist/tools/audit-orphans/scanners.js");
  const build = {
    instances: [{ id: "form1", component: "Form", tag: "form", children: [] }],
    props: [{ id: "p1", instanceId: "form1", name: "action", type: "resource", value: "res-A" }],
    dataSources: [],
    resources: [{ id: "res-A", name: "action", method: "post", url: '"https://x"' }],
    styles: [],
    styleSources: [],
    styleSourceSelections: [],
    pages: { rootFolderId: "root", folders: [], pages: [] },
    breakpoints: [],
  };
  const r = { resources: CATEGORY_RUNNERS.resources(build) };
  assert.equal(r.resources.orphans.length, 0,
    `resource still referenced by prop must not be orphan; got ${r.resources.orphans.map((o) => o.id).join(",")}`);
});

test("findOrphanResources: DOES flag a truly orphan resource (no DS, no prop ref)", async () => {
  const { CATEGORY_RUNNERS } = await import("../dist/tools/audit-orphans/scanners.js");
  const build = {
    instances: [], props: [], dataSources: [],
    resources: [{ id: "lonely", name: "old-api", method: "get", url: '"https://y"' }],
    styles: [], styleSources: [], styleSourceSelections: [],
    pages: { rootFolderId: "root", folders: [], pages: [] }, breakpoints: [],
  };
  const r = CATEGORY_RUNNERS.resources(build);
  assert.equal(r.orphans.length, 1);
  assert.equal(r.orphans[0].id, "lonely");
});

// ─── Bug B — audit.orphans cssvars: var(--name) in unparsed strings was ignored ───

test("findOrphanCssVars: does NOT flag a var referenced via var(--name) in an unparsed value (linear-gradient case)", async () => {
  const { CATEGORY_RUNNERS } = await import("../dist/tools/audit-orphans/scanners.js");
  // ROOT_INSTANCE_ID = ":root" — define on a styleSource selected by :root.
  const build = {
    pages: { rootFolderId: "root", folders: [], pages: [] },
    breakpoints: [{ id: "bp", label: "Base" }],
    instances: [], props: [], dataSources: [], resources: [],
    styleSources: [{ id: "rootSrc", type: "local" }],
    styleSourceSelections: [
      { instanceId: ":root", values: ["rootSrc"] },
      { instanceId: "x", values: ["other"] },
    ],
    styles: [
      // The :root defines --overlay-color.
      { styleSourceId: "rootSrc", breakpointId: "bp", property: "--overlay-color",
        value: { type: "color", colorSpace: "srgb", components: [0,0,0], alpha: 0.6 } },
      // Another decl references it via linear-gradient inside an unparsed value.
      { styleSourceId: "other", breakpointId: "bp", property: "backgroundImage",
        value: { type: "unparsed", value: "linear-gradient(var(--overlay-color), var(--overlay-color))" } },
    ],
  };
  const r = CATEGORY_RUNNERS.cssVars(build);
  assert.equal(r.orphans.length, 0,
    `var used in linear-gradient unparsed must not be orphan; got ${r.orphans.map((o) => o.id).join(",")}`);
});

// ─── Bug C — audit.fonts: family name comparison ignored separator variations ───

test("audit-fonts normaliseFamilyStrict: matches across separator variants", async () => {
  const { normaliseFamilyStrict } = await import("../dist/tools/audit-fonts/scanners.js");
  // Asset filename → "helveticaneueltpro-ex". CSS value → "helveticaneuelt pro ex".
  assert.equal(normaliseFamilyStrict("helveticaneueltpro-ex"), "helveticaneueltproex");
  assert.equal(normaliseFamilyStrict("helveticaneuelt pro ex"), "helveticaneueltproex");
  assert.equal(normaliseFamilyStrict("Helvetica_Neue_LT_Pro Ex"), "helveticaneueltproex");
  // Different families stay different.
  assert.notEqual(
    normaliseFamilyStrict("roboto"),
    normaliseFamilyStrict("supremelltt"),
  );
});

// ─── Bug F — resources.delete with force=true must cascade-delete prop refs ───

import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "audit-delete-safety-"));
process.env.WEBSTUDIO_PROJECTS_DIR = tmpRoot;

const { deleteResourceTool } = await import("../dist/tools/resources.js");

const slug = "testproj";
const projDir = path.join(tmpRoot, slug);
fs.mkdirSync(projDir, { recursive: true });
fs.writeFileSync(path.join(projDir, "tokens.json"), JSON.stringify({ version: 1, projectSlug: slug, projectName: slug, tokens: {} }));
fs.writeFileSync(path.join(projDir, "webstudio-auth.json"), JSON.stringify({
  projectId: "p", cookie: "ck", csrfToken: "csrf", appVersion: "1", allowPush: true,
}));

function makeBuildWithFormAction() {
  return {
    id: "b", projectId: "p", version: 1, createdAt: "", updatedAt: "",
    project: { title: "Test" },
    pages: { homePageId: "h", rootFolderId: "root", folders: [{ id: "root", name: "Root", children: [] }], pages: [] },
    breakpoints: [{ id: "bp", label: "Base" }],
    instances: [{ id: "form1", component: "Form", tag: "form", label: "Form", children: [] }],
    props: [{ id: "p1", instanceId: "form1", name: "action", type: "resource", value: "res-A" }],
    dataSources: [],
    resources: [{ id: "res-A", name: "action", method: "post", url: '"$ws$dataSource$x"' }],
    styles: [], styleSources: [], styleSourceSelections: [],
    deployments: [], assets: [], marketplaceProduct: null,
  };
}

const originalFetch = globalThis.fetch;
function mockPush(build) {
  let v = build.version;
  let txs = [];
  globalThis.fetch = async (url, opts) => {
    const u = url.toString();
    if (u.includes("/rest/data/")) {
      return { ok: true, status: 200, statusText: "OK", headers: new Map(),
        json: async () => build, text: async () => JSON.stringify(build) };
    }
    if (u.includes("/trpc/build.patch")) {
      txs.push(JSON.parse(opts?.body ?? "{}"));
      v += 1;
      return { ok: true, status: 200, statusText: "OK", headers: new Map(),
        json: async () => [{ result: { data: { status: "ok" } } }],
        text: async () => JSON.stringify([{ result: { data: { status: "ok" } } }]) };
    }
    throw new Error(`Unmocked: ${u}`);
  };
  return () => txs;
}

test("resources.delete force=true cascades: deletes the prop ref too (no dangling)", async () => {
  const build = makeBuildWithFormAction();
  const getTxs = mockPush(build);
  try {
    const r = await deleteResourceTool.handler({
      projectSlug: slug, resourceId: "res-A", force: true, dryRun: false,
    });
    assert.equal(r.isError, undefined, r.content?.[0]?.text);
    // Verify the transaction contains a props.remove patch for prop p1.
    const tx = getTxs()[0];
    const payload = tx?.["0"]?.entries?.[0]?.transaction?.payload ?? [];
    const propChange = payload.find((c) => c.namespace === "props");
    assert.ok(propChange, "props namespace change missing — cascade did not run");
    assert.equal(propChange.patches.length, 1);
    assert.equal(propChange.patches[0].op, "remove");
    assert.equal(propChange.patches[0].path[0], "p1");
  } finally { globalThis.fetch = originalFetch; }
});

test("resources.delete force=false refuses when prop ref exists", async () => {
  const build = makeBuildWithFormAction();
  mockPush(build);
  try {
    const r = await deleteResourceTool.handler({
      projectSlug: slug, resourceId: "res-A", force: false, dryRun: true,
    });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /ref\(s\) found|REFUSED/);
  } finally { globalThis.fetch = originalFetch; }
});

test("resources.delete supports batch form via resourceIdsOrNames", async () => {
  const build = makeBuildWithFormAction();
  // Add a second resource we'll batch-delete.
  build.resources.push({ id: "res-B", name: "another", method: "get", url: '"https://z"' });
  mockPush(build);
  try {
    const r = await deleteResourceTool.handler({
      projectSlug: slug, resourceIdsOrNames: ["res-A", "res-B"], force: true, dryRun: true,
    });
    assert.equal(r.isError, undefined, r.content?.[0]?.text);
    assert.match(r.content[0].text, /Succeeded \(2\)/);
  } finally { globalThis.fetch = originalFetch; }
});
