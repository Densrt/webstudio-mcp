// Tests for the v2.9.0 clone_subtree extension:
//   - validation: exactly one target form (instanceId | anchor | anchors)
//   - targetAnchor (single page) ok + missing-anchor error with actionable hint
//   - targetAnchors batch (per-target outcomes, non-fatal skip)
//   - mode "prepend" (pure function test on buildCloneSubtreeChanges)
//
// The core remap engine is already covered by clone-helpers.extra.test.mjs and
// clone-subtree-bracket.test.mjs — this file focuses on the NEW orchestration.

import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Isolate auth filesystem BEFORE importing dist modules.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clone-subtree-"));
process.env.WEBSTUDIO_PROJECTS_DIR = tmpRoot;

const { cloneSubtreeTool } = await import("../dist/tools/clone-subtree.js");
const { buildCloneSubtreeChanges } = await import("../dist/clone-helpers.js");

function makeBuild() {
  // /source page: <main label="Main"> with a child "src-card".
  // /target page: <main label="Main"> empty (ready to receive).
  // /no-anchor page: no main, just an empty body.
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
      { id: "src-main", component: "Box", tag: "main", label: "Main", children: [{ type: "id", value: "src-card" }] },
      { id: "src-card", component: "Box", tag: "div", label: "card", children: [] },
      { id: "tgt-root", component: "Body", tag: "body", children: [{ type: "id", value: "tgt-main" }] },
      { id: "tgt-main", component: "Box", tag: "main", label: "Main", children: [] },
      { id: "no-root", component: "Body", tag: "body", children: [] },
    ],
    props: [], dataSources: [], resources: [], deployments: [], assets: [], marketplaceProduct: null,
    styles: [],
    styleSources: [],
    styleSourceSelections: [],
  };
}

const slug = "testproj";
const projDir = path.join(tmpRoot, slug);
fs.mkdirSync(projDir, { recursive: true });
fs.writeFileSync(
  path.join(projDir, "tokens.json"),
  JSON.stringify({ version: 1, projectSlug: slug, projectName: slug, tokens: {} }),
);
fs.writeFileSync(
  path.join(projDir, "webstudio-auth.json"),
  JSON.stringify({ projectId: "p", cookie: "ck", csrfToken: "csrf", appVersion: "1" }),
);

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

// ---------------------------------------------------------------------------
// Validation — exactly one target form
// ---------------------------------------------------------------------------

test("VALIDATION_FAILED when no target form is provided", async () => {
  const r = await cloneSubtreeTool.handler({
    projectSlug: slug,
    sourceInstanceId: "src-main",
    dryRun: true,
  });
  assert.equal(r.isError, true);
  const payload = JSON.parse(r.content[0].text);
  assert.equal(payload.code, "VALIDATION_FAILED");
  assert.match(payload.message, /Provide exactly one of/i);
});

test("VALIDATION_FAILED when multiple target forms are provided", async () => {
  const r = await cloneSubtreeTool.handler({
    projectSlug: slug,
    sourceInstanceId: "src-main",
    targetInstanceId: "tgt-main",
    targetAnchor: { pagePath: "/target", label: "Main" },
    dryRun: true,
  });
  assert.equal(r.isError, true);
  const payload = JSON.parse(r.content[0].text);
  assert.equal(payload.code, "VALIDATION_FAILED");
  assert.match(payload.message, /ONLY one of/i);
});

test("VALIDATION_FAILED when targetAnchors is empty", async () => {
  const r = await cloneSubtreeTool.handler({
    projectSlug: slug,
    sourceInstanceId: "src-main",
    targetAnchors: [],
    dryRun: true,
  });
  assert.equal(r.isError, true);
  const payload = JSON.parse(r.content[0].text);
  assert.equal(payload.code, "VALIDATION_FAILED");
});

// ---------------------------------------------------------------------------
// targetAnchor — single page, success path
// ---------------------------------------------------------------------------

test("targetAnchor single — dry-run reports ok when anchor exists on target page", async () => {
  mockFetchToReturnBuild(makeBuild());
  try {
    const r = await cloneSubtreeTool.handler({
      projectSlug: slug,
      sourceInstanceId: "src-main",
      targetAnchor: { pagePath: "/target", label: "Main" },
      mode: "append",
      dryRun: true,
    });
    assert.equal(r.isError, undefined);
    assert.match(r.content[0].text, /DRY-RUN \(anchor mode\)/);
    assert.match(r.content[0].text, /1 ok, 0 skipped/);
    assert.match(r.content[0].text, /\/target/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("targetAnchor missing — skipped non-fatal with actionable hint pointing at instances.append", async () => {
  mockFetchToReturnBuild(makeBuild());
  try {
    const r = await cloneSubtreeTool.handler({
      projectSlug: slug,
      sourceInstanceId: "src-main",
      targetAnchor: { pagePath: "/no-anchor", label: "Main" },
      mode: "append",
      dryRun: true,
    });
    assert.equal(r.isError, undefined);
    assert.match(r.content[0].text, /0 ok, 1 skipped/);
    assert.match(r.content[0].text, /target anchor not found/);
    assert.match(r.content[0].text, /hint:.*instances\.append/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// targetAnchors — multi-target batch
// ---------------------------------------------------------------------------

test("targetAnchors batch — one ok + one skipped (non-fatal)", async () => {
  mockFetchToReturnBuild(makeBuild());
  try {
    const r = await cloneSubtreeTool.handler({
      projectSlug: slug,
      sourceInstanceId: "src-main",
      targetAnchors: [
        { pagePath: "/target", label: "Main" },
        { pagePath: "/no-anchor", label: "Main" },
      ],
      mode: "replace",
      dryRun: true,
    });
    assert.equal(r.isError, undefined);
    assert.match(r.content[0].text, /1 ok, 1 skipped/);
    assert.match(r.content[0].text, /\/target/);
    assert.match(r.content[0].text, /\/no-anchor — skipped/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("targetAnchors with missing source instance returns INSTANCE_NOT_FOUND", async () => {
  mockFetchToReturnBuild(makeBuild());
  try {
    const r = await cloneSubtreeTool.handler({
      projectSlug: slug,
      sourceInstanceId: "nonexistent_src",
      targetAnchors: [{ pagePath: "/target", label: "Main" }],
      dryRun: true,
    });
    assert.equal(r.isError, true);
    const payload = JSON.parse(r.content[0].text);
    assert.equal(payload.code, "INSTANCE_NOT_FOUND");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// Mode prepend — pure function test on the engine
// ---------------------------------------------------------------------------

test("mode prepend — cloned children inserted at the beginning of target children", () => {
  const build = {
    instances: [
      { id: "root", component: "Body", children: [{ type: "id", value: "src" }, { type: "id", value: "dst" }] },
      { id: "src", component: "Box", children: [{ type: "id", value: "newkid" }] },
      { id: "dst", component: "Box", children: [{ type: "id", value: "existing1" }, { type: "id", value: "existing2" }] },
      { id: "newkid", component: "Box", children: [] },
      { id: "existing1", component: "Box", children: [] },
      { id: "existing2", component: "Box", children: [] },
    ],
    props: [], styleSourceSelections: [], styleSources: [], styles: [], breakpoints: [], dataSources: [], resources: [],
  };
  const { changes } = buildCloneSubtreeChanges(build, {
    sourceInstanceId: "src",
    targetInstanceId: "dst",
    mode: "prepend",
  });
  const instChange = changes.find((c) => c.namespace === "instances");
  const dstReplace = instChange.patches.find(
    (p) => p.op === "replace" && p.path[0] === "dst" && p.path[1] === "children",
  );
  assert.ok(dstReplace, "expected a replace patch on dst.children");
  const ids = dstReplace.value.filter((c) => c.type === "id").map((c) => c.value);
  // Prepend: cloned newkid (remapped) at index 0, then existing1, then existing2.
  assert.equal(ids.length, 3);
  assert.notEqual(ids[0], "newkid", "first child should be the REMAPPED clone, not the original");
  assert.equal(ids[1], "existing1");
  assert.equal(ids[2], "existing2");
});

test("mode append — cloned children inserted at the end (regression — default mode unchanged)", () => {
  const build = {
    instances: [
      { id: "root", component: "Body", children: [{ type: "id", value: "src" }, { type: "id", value: "dst" }] },
      { id: "src", component: "Box", children: [{ type: "id", value: "newkid" }] },
      { id: "dst", component: "Box", children: [{ type: "id", value: "existing1" }] },
      { id: "newkid", component: "Box", children: [] },
      { id: "existing1", component: "Box", children: [] },
    ],
    props: [], styleSourceSelections: [], styleSources: [], styles: [], breakpoints: [], dataSources: [], resources: [],
  };
  const { changes } = buildCloneSubtreeChanges(build, {
    sourceInstanceId: "src",
    targetInstanceId: "dst",
    mode: "append",
  });
  const instChange = changes.find((c) => c.namespace === "instances");
  const dstReplace = instChange.patches.find(
    (p) => p.op === "replace" && p.path[0] === "dst" && p.path[1] === "children",
  );
  const ids = dstReplace.value.filter((c) => c.type === "id").map((c) => c.value);
  // Append: existing1 first, then remapped newkid.
  assert.equal(ids.length, 2);
  assert.equal(ids[0], "existing1");
  assert.notEqual(ids[1], "newkid");
});

// ---------------------------------------------------------------------------
// Atomic path (targetInstanceId) — back-compat sanity check
// ---------------------------------------------------------------------------

test("targetInstanceId atomic — back-compat path still works (dry-run)", async () => {
  mockFetchToReturnBuild(makeBuild());
  try {
    const r = await cloneSubtreeTool.handler({
      projectSlug: slug,
      sourceInstanceId: "src-main",
      targetInstanceId: "tgt-main",
      mode: "append",
      dryRun: true,
    });
    assert.equal(r.isError, undefined);
    assert.match(r.content[0].text, /DRY-RUN clone_subtree \(atomic\)/);
    assert.match(r.content[0].text, /Instances cloned\s+:\s*1/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// v2.9.2 — includeSource flag (clone whole subtree vs children only)
// ---------------------------------------------------------------------------

test("includeSource:true atomic — clones source as root of subtree", () => {
  // src has 1 child (newkid). With includeSource:true we clone [src, newkid]
  // (so dst receives a SINGLE new child = the remap of src, which itself contains
  // the remap of newkid as its child).
  const build = {
    instances: [
      { id: "root", component: "Body", children: [{ type: "id", value: "src" }, { type: "id", value: "dst" }] },
      { id: "src", component: "Box", children: [{ type: "id", value: "newkid" }] },
      { id: "dst", component: "Box", children: [] },
      { id: "newkid", component: "Box", children: [] },
    ],
    props: [], styleSourceSelections: [], styleSources: [], styles: [], breakpoints: [], dataSources: [], resources: [],
  };
  const { changes, summary } = buildCloneSubtreeChanges(build, {
    sourceInstanceId: "src",
    targetInstanceId: "dst",
    mode: "append",
    includeSource: true,
  });
  // 2 instances cloned (src + newkid), vs 1 (newkid only) without includeSource.
  assert.equal(summary.instancesCloned, 2);

  const instChange = changes.find((c) => c.namespace === "instances");
  const dstReplace = instChange.patches.find(
    (p) => p.op === "replace" && p.path[0] === "dst" && p.path[1] === "children",
  );
  const ids = dstReplace.value.filter((c) => c.type === "id").map((c) => c.value);
  // Single new child = the remap of src (not its children directly).
  assert.equal(ids.length, 1);
  assert.notEqual(ids[0], "src", "should be REMAP of src, not src itself");

  // The new src clone should still have one child (remap of newkid).
  const newSrcId = ids[0];
  const adds = instChange.patches.filter((p) => p.op === "add");
  const newSrcAdd = adds.find((a) => a.path[0] === newSrcId);
  assert.ok(newSrcAdd, "expected the cloned src to appear as an add patch");
  const newSrcChildIds = newSrcAdd.value.children.filter((c) => c.type === "id").map((c) => c.value);
  assert.equal(newSrcChildIds.length, 1);
  assert.notEqual(newSrcChildIds[0], "newkid", "newkid should be remapped too");
});

test("includeSource:false (default) — back-compat: clones children only", () => {
  // Sanity check that the default behaviour is unchanged — covers the v2.9.0 wrapper
  // clone_page semantics (regenerate container contents).
  const build = {
    instances: [
      { id: "root", component: "Body", children: [{ type: "id", value: "src" }, { type: "id", value: "dst" }] },
      { id: "src", component: "Box", children: [{ type: "id", value: "newkid" }] },
      { id: "dst", component: "Box", children: [] },
      { id: "newkid", component: "Box", children: [] },
    ],
    props: [], styleSourceSelections: [], styleSources: [], styles: [], breakpoints: [], dataSources: [], resources: [],
  };
  const { changes, summary } = buildCloneSubtreeChanges(build, {
    sourceInstanceId: "src",
    targetInstanceId: "dst",
    mode: "append",
    // includeSource: false   ← default, explicit for clarity
  });
  // 1 instance cloned (newkid only) — src is NOT included.
  assert.equal(summary.instancesCloned, 1);

  const instChange = changes.find((c) => c.namespace === "instances");
  const dstReplace = instChange.patches.find(
    (p) => p.op === "replace" && p.path[0] === "dst" && p.path[1] === "children",
  );
  const ids = dstReplace.value.filter((c) => c.type === "id").map((c) => c.value);
  // dst gets 1 new child = the remap of newkid (NOT src).
  assert.equal(ids.length, 1);
  assert.notEqual(ids[0], "newkid");
  assert.notEqual(ids[0], "src");
});

test("includeSource:true + skipChildLabels → throws (ambiguous semantics)", () => {
  const build = {
    instances: [
      { id: "root", component: "Body", children: [{ type: "id", value: "src" }, { type: "id", value: "dst" }] },
      { id: "src", component: "Box", children: [{ type: "id", value: "kid1" }, { type: "id", value: "kid2" }] },
      { id: "dst", component: "Box", children: [] },
      { id: "kid1", component: "Box", label: "Keep", children: [] },
      { id: "kid2", component: "Box", label: "Drop", children: [] },
    ],
    props: [], styleSourceSelections: [], styleSources: [], styles: [], breakpoints: [], dataSources: [], resources: [],
  };
  assert.throws(
    () =>
      buildCloneSubtreeChanges(build, {
        sourceInstanceId: "src",
        targetInstanceId: "dst",
        mode: "append",
        includeSource: true,
        skipChildLabels: ["Drop"],
      }),
    /Cannot combine includeSource:true with skipChildLabels/i,
  );
});

test("includeSource:true via handler — Zod validation surfaces the combo error as VALIDATION_FAILED", async () => {
  mockFetchToReturnBuild(makeBuild());
  try {
    const r = await cloneSubtreeTool.handler({
      projectSlug: slug,
      sourceInstanceId: "src-main",
      targetInstanceId: "tgt-main",
      mode: "append",
      includeSource: true,
      skipChildLabels: ["card"],
      dryRun: true,
    });
    assert.equal(r.isError, true);
    const payload = JSON.parse(r.content[0].text);
    assert.equal(payload.code, "VALIDATION_FAILED");
    assert.match(payload.message, /Cannot combine includeSource:true with skipChildLabels/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("includeSource:true via handler with targetAnchor — clone whole section into anchor target", async () => {
  mockFetchToReturnBuild(makeBuild());
  try {
    const r = await cloneSubtreeTool.handler({
      projectSlug: slug,
      sourceInstanceId: "src-main",
      targetAnchor: { pagePath: "/target", label: "Main" },
      mode: "append",
      includeSource: true,
      dryRun: true,
    });
    assert.equal(r.isError, undefined);
    assert.match(r.content[0].text, /DRY-RUN \(anchor mode\)/);
    assert.match(r.content[0].text, /1 ok, 0 skipped/);
    // includeSource:true clones src-main + its child src-card = 2 instances
    assert.match(r.content[0].text, /2 instances/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
