// Tests for the shared pure helpers `findFolderOfPage` and `findPageInFolderByPath`.

import { test } from "node:test";
import assert from "node:assert/strict";

const { findFolderOfPage, findPageInFolderByPath } =
  await import("../dist/tools/pages/folder-utils.js");

function makeBuild() {
  return {
    id: "b", projectId: "p", version: 1, createdAt: "", updatedAt: "",
    project: { title: "T" },
    pages: {
      homePageId: "home",
      rootFolderId: "root",
      folders: [
        { id: "root", name: "Root", children: ["home", "pg_root_offres", "fld_globex"] },
        { id: "fld_globex", name: "Globex", slug: "globex", children: ["pg_globex_offres", "pg_globex_quads"] },
      ],
      pages: [
        { id: "home", name: "Home", path: "/", rootInstanceId: "home-root" },
        { id: "pg_root_offres", name: "Offres (root)", path: "/offres", rootInstanceId: "r-offres" },
        { id: "pg_globex_offres", name: "Offres Globex", path: "/offres", rootInstanceId: "g-offres" },
        { id: "pg_globex_quads", name: "Quads Globex", path: "/quads", rootInstanceId: "g-quads" },
      ],
    },
    breakpoints: [], instances: [], props: [], deployments: [], assets: [],
    marketplaceProduct: null, styles: [], styleSources: [], styleSourceSelections: [],
    dataSources: [], resources: [],
  };
}

// ── findFolderOfPage ────────────────────────────────────────────────────────

test("findFolderOfPage: returns the folder id whose children include the page", () => {
  const build = makeBuild();
  assert.equal(findFolderOfPage(build, "pg_root_offres"), "root");
  assert.equal(findFolderOfPage(build, "pg_globex_offres"), "fld_globex");
  assert.equal(findFolderOfPage(build, "home"), "root");
});

test("findFolderOfPage: returns undefined for an orphan/unknown pageId", () => {
  const build = makeBuild();
  assert.equal(findFolderOfPage(build, "pg_missing"), undefined);
});

// ── findPageInFolderByPath ──────────────────────────────────────────────────

test("findPageInFolderByPath: finds a page that lives directly in the given folder", () => {
  const build = makeBuild();
  const r = findPageInFolderByPath(build, "/offres", "root");
  assert.equal(r?.id, "pg_root_offres");
});

test("findPageInFolderByPath: same path under DIFFERENT folder is not a match (folder-scoped)", () => {
  const build = makeBuild();
  // /offres exists both at root and in fld_globex — searching under root must
  // return only the root one.
  const rootMatch = findPageInFolderByPath(build, "/offres", "root");
  const globexMatch = findPageInFolderByPath(build, "/offres", "fld_globex");
  assert.equal(rootMatch?.id, "pg_root_offres");
  assert.equal(globexMatch?.id, "pg_globex_offres");
});

test("findPageInFolderByPath: does NOT recurse into sub-folders", () => {
  // pg_globex_quads lives in fld_globex (not in root). Searching from root must
  // not return it — even though fld_globex is a child of root.
  const build = makeBuild();
  assert.equal(findPageInFolderByPath(build, "/quads", "root"), undefined);
});

test("findPageInFolderByPath: returns undefined when no sibling page matches the path", () => {
  const build = makeBuild();
  assert.equal(findPageInFolderByPath(build, "/no-such-page", "root"), undefined);
});

test("findPageInFolderByPath: returns undefined when the folder id is unknown", () => {
  const build = makeBuild();
  assert.equal(findPageInFolderByPath(build, "/offres", "fld_ghost"), undefined);
});
