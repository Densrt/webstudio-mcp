// Unit tests for the anchor-resolution + dryRun reporting logic of
// webstudio_clone_page_subtree. The cloning core itself is covered by the
// existing buildCloneSubtreeChanges tests.

import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Isolate auth filesystem BEFORE importing dist modules (projects.ts reads
// the env var at module-load time).
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clone-page-subtree-"));
process.env.WEBSTUDIO_PROJECTS_DIR = tmpRoot;

const { clonePageSubtreeTool } = await import("../dist/tools/clone-page-subtree.js");

function makeBuild() {
  // Two pages: /source has <div label="main"> with a child Box.
  //            /target has <div label="main"> empty.
  // Plus /no-anchor has no main div.
  return {
    id: "b", projectId: "p", version: 1, createdAt: "", updatedAt: "",
    pages: {
      homePageId: "src",
      rootFolderId: "r",
      folders: [],
      pages: [
        { id: "src", name: "Source", path: "/source", rootInstanceId: "src-root" },
        { id: "tgt", name: "Target", path: "/target", rootInstanceId: "tgt-root" },
        { id: "no", name: "NoAnchor", path: "/no-anchor", rootInstanceId: "no-root" },
      ],
    },
    breakpoints: [{ id: "bp", label: "Base" }],
    instances: [
      { id: "src-root", component: "Body", tag: "body", children: [{ type: "id", value: "src-main" }] },
      { id: "src-main", component: "Box", tag: "div", label: "main", children: [{ type: "id", value: "src-card" }] },
      { id: "src-card", component: "Box", tag: "div", label: "card", children: [] },
      { id: "tgt-root", component: "Body", tag: "body", children: [{ type: "id", value: "tgt-main" }] },
      { id: "tgt-main", component: "Box", tag: "div", label: "main", children: [] },
      { id: "no-root", component: "Body", tag: "body", children: [] },
    ],
    props: [], dataSources: [], resources: [], deployments: [], assets: [], marketplaceProduct: null,
    styles: [],
    styleSources: [],
    styleSourceSelections: [],
  };
}

// Stand up an auth file matching the slug.
const slug = "testproj";
const projDir = path.join(tmpRoot, slug);
fs.mkdirSync(projDir, { recursive: true });
fs.writeFileSync(path.join(projDir, "tokens.json"), JSON.stringify({ version: 1, projectSlug: slug, projectName: slug, tokens: {} }));
fs.writeFileSync(path.join(projDir, "webstudio-auth.json"), JSON.stringify({
  projectId: "p", cookie: "ck", csrfToken: "csrf", appVersion: "1",
}));

const originalFetch = globalThis.fetch;
function mockFetchToReturnBuild(build) {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Map(),
    json: async () => build,
    text: async () => JSON.stringify(build),
  });
}

test("dry-run reports ok for a target with matching anchor", async () => {
  mockFetchToReturnBuild(makeBuild());
  try {
    const r = await clonePageSubtreeTool.handler({
      projectSlug: slug,
      sourcePagePath: "/source",
      targetPagePaths: ["/target"],
      anchorLabel: "main",
      dryRun: true,
    });
    assert.equal(r.isError, undefined);
    assert.match(r.content[0].text, /DRY-RUN/);
    assert.match(r.content[0].text, /1 ok, 0 skipped/);
    assert.match(r.content[0].text, /\/target/);
  } finally { globalThis.fetch = originalFetch; }
});

test("dry-run skips a target page without anchor (non-fatal)", async () => {
  mockFetchToReturnBuild(makeBuild());
  try {
    const r = await clonePageSubtreeTool.handler({
      projectSlug: slug,
      sourcePagePath: "/source",
      targetPagePaths: ["/target", "/no-anchor"],
      anchorLabel: "main",
      dryRun: true,
    });
    assert.equal(r.isError, undefined);
    assert.match(r.content[0].text, /1 ok, 1 skipped/);
    // v2.9.0: clone_page is a thin wrapper around clone_subtree which produces a
    // slightly different message ("target anchor not found on ..." instead of
    // "anchor not found"). Behaviour (skip non-fatal) is preserved.
    assert.match(r.content[0].text, /no-anchor — skipped \(target anchor not found/);
  } finally { globalThis.fetch = originalFetch; }
});

test("returns PAGE_NOT_FOUND when source page does not exist", async () => {
  mockFetchToReturnBuild(makeBuild());
  try {
    const r = await clonePageSubtreeTool.handler({
      projectSlug: slug,
      sourcePagePath: "/nowhere",
      targetPagePaths: ["/target"],
      anchorLabel: "main",
      dryRun: true,
    });
    assert.equal(r.isError, true);
    const payload = JSON.parse(r.content[0].text);
    assert.equal(payload.code, "PAGE_NOT_FOUND");
  } finally { globalThis.fetch = originalFetch; }
});

test("returns INSTANCE_NOT_FOUND when source anchor missing", async () => {
  mockFetchToReturnBuild(makeBuild());
  try {
    const r = await clonePageSubtreeTool.handler({
      projectSlug: slug,
      sourcePagePath: "/no-anchor",
      targetPagePaths: ["/target"],
      anchorLabel: "main",
      dryRun: true,
    });
    assert.equal(r.isError, true);
    const payload = JSON.parse(r.content[0].text);
    assert.equal(payload.code, "INSTANCE_NOT_FOUND");
  } finally { globalThis.fetch = originalFetch; }
});

test("VALIDATION_FAILED when neither source identifier is provided", async () => {
  const r = await clonePageSubtreeTool.handler({
    projectSlug: slug,
    targetPagePaths: ["/target"],
    dryRun: true,
  });
  assert.equal(r.isError, true);
  const payload = JSON.parse(r.content[0].text);
  assert.equal(payload.code, "VALIDATION_FAILED");
});

test("VALIDATION_FAILED when no target is provided", async () => {
  const r = await clonePageSubtreeTool.handler({
    projectSlug: slug,
    sourcePagePath: "/source",
    dryRun: true,
  });
  assert.equal(r.isError, true);
  const payload = JSON.parse(r.content[0].text);
  assert.equal(payload.code, "VALIDATION_FAILED");
});

test("resolves source by id when sourcePageId is provided", async () => {
  mockFetchToReturnBuild(makeBuild());
  try {
    const r = await clonePageSubtreeTool.handler({
      projectSlug: slug,
      sourcePageId: "src",
      targetPageIds: ["tgt"],
      anchorLabel: "main",
      dryRun: true,
    });
    assert.equal(r.isError, undefined);
    assert.match(r.content[0].text, /1 ok, 0 skipped/);
  } finally { globalThis.fetch = originalFetch; }
});
