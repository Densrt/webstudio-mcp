// Regression tests for the pages.duplicate action.
//
// Critical scenario: variableSubstitutions must rewrite expressions WITHOUT
// cloning the source variable into the substitution-target's ID. The first
// implementation merged subs into maps.dsIdMap, which made addClonedDataSources
// iterate the subs entries and create an op:add patch overwriting the target
// variable with the source value (e.g. "Arnac Pompadour" → "Limoges" + name reset).

import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "duplicate-page-"));
process.env.WEBSTUDIO_PROJECTS_DIR = tmpRoot;

const { duplicatePageTool } = await import("../dist/tools/pages/duplicate.js");

const slug = "testproj";
const projDir = path.join(tmpRoot, slug);
fs.mkdirSync(projDir, { recursive: true });
fs.writeFileSync(path.join(projDir, "tokens.json"), JSON.stringify({ version: 1, projectSlug: slug, projectName: slug, tokens: {} }));
fs.writeFileSync(path.join(projDir, "webstudio-auth.json"), JSON.stringify({
  projectId: "p", cookie: "ck", csrfToken: "csrf", appVersion: "1", allowPush: true,
}));

function makeBuild() {
  // Source page uses $ws$dataSource$varA in a child text expression.
  // varA and varB are BOTH :root-scoped (NOT in any page subtree → not auto-cloned).
  return {
    id: "b", projectId: "p", version: 1, createdAt: "", updatedAt: "",
    project: { title: "Test Project" },
    pages: {
      homePageId: "src",
      rootFolderId: "root",
      folders: [{ id: "root", name: "Root", children: ["src"] }],
      pages: [{
        id: "src", name: "Source", path: "/source", rootInstanceId: "src-root",
        title: '"Hello " + $ws$dataSource$varA',
        meta: {
          description: '"intro " + $ws$dataSource$varA',
          language: '"fr"',
          excludePageFromSearch: 'false',
          socialImageUrl: '""',
          redirect: '""',
          documentType: "html",
          custom: [],
        },
        marketplace: { include: false },
      }],
    },
    breakpoints: [{ id: "bp", label: "Base" }],
    instances: [
      { id: "src-root", component: "ws:element", tag: "body", children: [{ type: "id", value: "src-h1" }] },
      { id: "src-h1", component: "ws:element", tag: "h1", label: "Title",
        children: [{ type: "expression", value: '"Welcome to " + $ws$dataSource$varA' }] },
    ],
    props: [], deployments: [], assets: [], marketplaceProduct: null,
    styles: [], styleSources: [], styleSourceSelections: [],
    dataSources: [
      { type: "variable", id: "varA", scopeInstanceId: ":root", name: "City A", value: { type: "string", value: "Limoges" } },
      { type: "variable", id: "varB", scopeInstanceId: ":root", name: "City B", value: { type: "string", value: "Springfield" } },
    ],
    resources: [],
  };
}

const originalFetch = globalThis.fetch;
function mockPushFlow(build) {
  let buildVersion = build.version;
  let capturedTransactions = [];
  globalThis.fetch = async (url, opts) => {
    const u = url.toString();
    if (u.includes("/rest/data/")) {
      return { ok: true, status: 200, statusText: "OK", headers: new Map(),
        json: async () => build, text: async () => JSON.stringify(build) };
    }
    if (u.includes("/trpc/build.patch")) {
      const body = JSON.parse(opts?.body ?? "{}");
      capturedTransactions.push(body);
      buildVersion += 1;
      return { ok: true, status: 200, statusText: "OK", headers: new Map(),
        json: async () => [{ result: { data: { status: "ok" } } }],
        text: async () => JSON.stringify([{ result: { data: { status: "ok" } } }]) };
    }
    throw new Error(`Unmocked URL: ${u}`);
  };
  return () => capturedTransactions;
}

test("duplicate: variableSubstitutions DOES NOT clone the source var into the target var", async () => {
  const getTxns = mockPushFlow(makeBuild());
  try {
    const r = await duplicatePageTool.handler({
      projectSlug: slug,
      sourcePagePath: "/source",
      targetPath: "/target",
      targetName: "Target",
      variableSubstitutions: [{ from: "varA", to: "varB" }],
      dryRun: false,
    });
    if (r.isError) console.error(r.content[0]?.text);
    assert.equal(r.isError, undefined, "duplicate should succeed");
    const txns = getTxns();
    // Search every dataSources patch in any pushed transaction. None of them
    // may overwrite varB (the substitution target).
    const allDsPatches = [];
    for (const t of txns) {
      const payload = t?.["0"]?.json?.transactions?.[0]?.payload ?? t?.transactions?.[0]?.payload ?? [];
      for (const change of payload) {
        if (change.namespace === "dataSources") allDsPatches.push(...change.patches);
      }
    }
    const overwrites = allDsPatches.filter((p) => Array.isArray(p.path) && p.path[0] === "varB");
    assert.equal(overwrites.length, 0, `varB must not be touched by the duplicate. Got ${overwrites.length} overwrite(s): ${JSON.stringify(overwrites)}`);
  } finally { globalThis.fetch = originalFetch; }
});

test("duplicate: dryRun reports substitution count without pushing", async () => {
  const getTxns = mockPushFlow(makeBuild());
  try {
    const r = await duplicatePageTool.handler({
      projectSlug: slug,
      sourcePagePath: "/source",
      targetPath: "/target",
      targetName: "Target",
      variableSubstitutions: [{ from: "varA", to: "varB" }],
      dryRun: true,
    });
    assert.equal(r.isError, undefined);
    assert.match(r.content[0].text, /DRY-RUN duplicate_page/);
    assert.match(r.content[0].text, /variableSubstitutions applied: 1/);
    assert.match(r.content[0].text, /varA → varB/);
    assert.equal(getTxns().length, 0, "dryRun must not push");
  } finally { globalThis.fetch = originalFetch; }
});

test("duplicate: rejects when targetPath already exists in the SAME target folder", async () => {
  // After v2.7.13 the conflict check is folder-scoped — the conflicting page
  // must be a direct child of the target folder (defaults to the source page's
  // folder, i.e. root in this build) for the rejection to fire.
  const build = makeBuild();
  build.pages.pages.push({
    id: "existing", name: "Existing", path: "/target", rootInstanceId: "x-root",
    title: '""', meta: { description: '""', language: '""', excludePageFromSearch: 'false', socialImageUrl: '""', redirect: '""', documentType: "html", custom: [] },
  });
  // Attach the conflicting page to root.children so it qualifies as a sibling
  // of the (default) target folder.
  build.pages.folders[0].children.push("existing");
  build.instances.push({ id: "x-root", component: "ws:element", tag: "body", children: [] });
  mockPushFlow(build);
  try {
    const r = await duplicatePageTool.handler({
      projectSlug: slug,
      sourcePagePath: "/source",
      targetPath: "/target",
      targetName: "Target",
      dryRun: true,
    });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /already used/);
  } finally { globalThis.fetch = originalFetch; }
});

test("duplicate: same path under a DIFFERENT target folder is allowed (folder-scoped path uniqueness)", async () => {
  // Regression test for v2.7.13: an existing page at /target in root must NOT
  // block a duplicate targeting the same path under a different folder.
  const build = makeBuild();
  build.pages.pages.push({
    id: "existing", name: "Existing", path: "/target", rootInstanceId: "x-root",
    title: '""', meta: { description: '""', language: '""', excludePageFromSearch: 'false', socialImageUrl: '""', redirect: '""', documentType: "html", custom: [] },
  });
  build.pages.folders[0].children.push("existing");
  build.instances.push({ id: "x-root", component: "ws:element", tag: "body", children: [] });
  // Add an empty sub-folder we'll target.
  build.pages.folders.push({ id: "fld_sub", name: "Sub", slug: "sub", children: [] });
  build.pages.folders[0].children.push("fld_sub");
  mockPushFlow(build);
  try {
    const r = await duplicatePageTool.handler({
      projectSlug: slug,
      sourcePagePath: "/source",
      targetPath: "/target",
      targetName: "Target",
      parentFolderId: "fld_sub",
      dryRun: true,
    });
    assert.equal(r.isError, undefined);
    assert.match(r.content[0].text, /DRY-RUN duplicate_page/);
  } finally { globalThis.fetch = originalFetch; }
});

test("duplicate: rejects when variableSubstitutions reference unknown ids", async () => {
  mockPushFlow(makeBuild());
  try {
    const r = await duplicatePageTool.handler({
      projectSlug: slug,
      sourcePagePath: "/source",
      targetPath: "/target",
      targetName: "Target",
      variableSubstitutions: [{ from: "unknown", to: "varB" }],
      dryRun: true,
    });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /variableSubstitution\.from .* is not an existing/);
  } finally { globalThis.fetch = originalFetch; }
});
