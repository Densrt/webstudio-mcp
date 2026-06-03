// Regression tests for the pages.create_folder action.
//
// Tests focus on the pure `buildCreateFolderTransaction` and the Zod schema —
// no network mocking required (mirrors the convention used by folders-delete
// and share-slot-to-page tests).

import { test } from "node:test";
import assert from "node:assert/strict";

const { buildCreateFolderTransaction, createFolderInputSchema } =
  await import("../dist/tools/pages/folders-create.js");

function makeBuild(extraFolders = [], extraPages = []) {
  return {
    id: "b", projectId: "p", version: 1, createdAt: "", updatedAt: "",
    project: { title: "Test Project" },
    pages: {
      homePageId: "home",
      rootFolderId: "root",
      folders: [
        { id: "root", name: "Root", children: ["home", ...extraFolders.map((f) => f.id)] },
        ...extraFolders,
      ],
      pages: [
        { id: "home", name: "Home", path: "/", rootInstanceId: "home-root" },
        ...extraPages,
      ],
    },
    breakpoints: [], instances: [], props: [], deployments: [], assets: [],
    marketplaceProduct: null, styles: [], styleSources: [], styleSourceSelections: [],
    dataSources: [], resources: [],
  };
}

// ── Pure function: buildCreateFolderTransaction ────────────────────────────

test("create_folder: happy path under root", () => {
  const build = makeBuild();
  const tx = buildCreateFolderTransaction(
    build,
    { name: "Acme", slug: "acme", parentFolderId: "root" },
    "fld_new123",
  );
  assert.equal(tx.payload.length, 1);
  assert.equal(tx.payload[0].namespace, "pages");

  const patches = tx.payload[0].patches;
  assert.equal(patches.length, 2);

  // Patch 1: add the new folder entity.
  assert.deepEqual(patches[0], {
    op: "add",
    path: ["folders", "fld_new123"],
    value: { id: "fld_new123", name: "Acme", slug: "acme", children: [] },
  });

  // Patch 2: append the new folderId to root's children (full list replace).
  assert.deepEqual(patches[1], {
    op: "replace",
    path: ["folders", "root", "children"],
    value: ["home", "fld_new123"],
  });
});

test("create_folder: happy path under a custom parent (keeps existing siblings)", () => {
  const build = makeBuild(
    [{ id: "fld_marques", name: "Marques", slug: "marques", children: ["fld_existing"] },
     { id: "fld_existing", name: "Globex", slug: "globex", children: [] }],
  );
  const tx = buildCreateFolderTransaction(
    build,
    { name: "Acme", slug: "acme", parentFolderId: "fld_marques" },
    "fld_acme",
  );
  const patches = tx.payload[0].patches;
  assert.deepEqual(patches[1], {
    op: "replace",
    path: ["folders", "fld_marques", "children"],
    value: ["fld_existing", "fld_acme"],
  });
});

test("create_folder: throws when parent folder does not exist", () => {
  const build = makeBuild();
  assert.throws(
    () => buildCreateFolderTransaction(
      build,
      { name: "X", slug: "x", parentFolderId: "fld_ghost" },
      "fld_new",
    ),
    /Folder "fld_ghost" not found/,
  );
});

test("create_folder: throws when a sibling folder already uses the slug", () => {
  const build = makeBuild(
    [{ id: "fld_a", name: "Alpha", slug: "alpha", children: [] }],
  );
  assert.throws(
    () => buildCreateFolderTransaction(
      build,
      { name: "Alpha duplicate", slug: "alpha", parentFolderId: "root" },
      "fld_new",
    ),
    /Slug "alpha" is already used by a sibling folder under parent "Root"/,
  );
});

test("create_folder: same slug under a DIFFERENT parent is allowed", () => {
  // Webstudio UI rule: slugs only have to be unique among siblings, not globally.
  // Built manually so "fld_a_in_marques" lives ONLY under fld_marques, not under root.
  const build = {
    id: "b", projectId: "p", version: 1, createdAt: "", updatedAt: "",
    project: { title: "Test Project" },
    pages: {
      homePageId: "home",
      rootFolderId: "root",
      folders: [
        { id: "root", name: "Root", children: ["home", "fld_marques"] },
        { id: "fld_marques", name: "Marques", slug: "marques", children: ["fld_a_in_marques"] },
        { id: "fld_a_in_marques", name: "Alpha", slug: "alpha", children: [] },
      ],
      pages: [{ id: "home", name: "Home", path: "/", rootInstanceId: "home-root" }],
    },
    breakpoints: [], instances: [], props: [], deployments: [], assets: [],
    marketplaceProduct: null, styles: [], styleSources: [], styleSourceSelections: [],
    dataSources: [], resources: [],
  };
  assert.doesNotThrow(() =>
    buildCreateFolderTransaction(
      build,
      { name: "Alpha at root", slug: "alpha", parentFolderId: "root" },
      "fld_new",
    ),
  );
});

test("create_folder: transaction id is prefixed mcp-create-folder-", () => {
  const build = makeBuild();
  const tx = buildCreateFolderTransaction(
    build,
    { name: "N", slug: "n", parentFolderId: "root" },
    "fld_id",
  );
  assert.match(tx.id, /^mcp-create-folder-/);
});

// ── Schema validation ───────────────────────────────────────────────────────

test("schema: rejects slug with uppercase", () => {
  const r = createFolderInputSchema.safeParse({ projectSlug: "p", name: "X", slug: "Acme" });
  assert.equal(r.success, false);
});

test("schema: rejects slug with spaces", () => {
  const r = createFolderInputSchema.safeParse({ projectSlug: "p", name: "X", slug: "bad slug" });
  assert.equal(r.success, false);
});

test("schema: rejects slug with leading/trailing dash", () => {
  const r1 = createFolderInputSchema.safeParse({ projectSlug: "p", name: "X", slug: "-foo" });
  const r2 = createFolderInputSchema.safeParse({ projectSlug: "p", name: "X", slug: "foo-" });
  assert.equal(r1.success, false);
  assert.equal(r2.success, false);
});

test("schema: rejects double-dash slug", () => {
  const r = createFolderInputSchema.safeParse({ projectSlug: "p", name: "X", slug: "foo--bar" });
  assert.equal(r.success, false);
});

test("schema: accepts valid kebab-case slugs", () => {
  for (const slug of ["acme", "globex", "globex-modeles-2026", "a1", "1acme", "z-9"]) {
    const r = createFolderInputSchema.safeParse({ projectSlug: "p", name: "X", slug });
    assert.equal(r.success, true, `expected slug "${slug}" to be accepted`);
  }
});

test("schema: rejects empty name", () => {
  const r = createFolderInputSchema.safeParse({ projectSlug: "p", name: "", slug: "x" });
  assert.equal(r.success, false);
});

test("schema: rejects unknown fields (strict)", () => {
  const r = createFolderInputSchema.safeParse({
    projectSlug: "p", name: "X", slug: "x", surprise: true,
  });
  assert.equal(r.success, false);
});

test("schema: defaults parentFolderId to 'root' and dryRun to true", () => {
  const r = createFolderInputSchema.safeParse({ projectSlug: "p", name: "X", slug: "x" });
  assert.equal(r.success, true);
  assert.equal(r.data.parentFolderId, "root");
  assert.equal(r.data.dryRun, true);
});
