// Tests for the folder-scoped path uniqueness check in pages.create.
//
// Bug fixed in v2.7.13: the previous global scan refused any /path that already
// existed anywhere in the project, even under a different folder. Webstudio
// Cloud accepts that scenario (URL = cumulative folder slugs + page.path).

import { test } from "node:test";
import assert from "node:assert/strict";

const { buildCreatePageTransaction } = await import("../dist/tools/pages/create.js");

function makeBuild() {
  // Tree:
  //   Root (root)
  //   ├── Home (home)
  //   ├── Offres root (pg_root_offres)  — path "/offres"
  //   └── Globex (fld_globex) [slug "globex"]
  //       └── (empty initially)
  return {
    id: "b", projectId: "p", version: 1, createdAt: "", updatedAt: "",
    project: { title: "T" },
    pages: {
      homePageId: "home",
      rootFolderId: "root",
      folders: [
        { id: "root", name: "Root", children: ["home", "pg_root_offres", "fld_globex"] },
        { id: "fld_globex", name: "Globex", slug: "globex", children: [] },
      ],
      pages: [
        { id: "home", name: "Home", path: "/", rootInstanceId: "home-root" },
        { id: "pg_root_offres", name: "Offres", path: "/offres", rootInstanceId: "r-offres" },
      ],
    },
    breakpoints: [], instances: [], props: [], deployments: [], assets: [],
    marketplaceProduct: null, styles: [], styleSources: [], styleSourceSelections: [],
    dataSources: [], resources: [],
  };
}

const baseInput = {
  name: "Offres Globex",
  path: "/offres",
  title: "Offres Globex",
  parentFolderId: "fld_globex",
};

test("create: same path under a DIFFERENT folder is allowed (regression for v2.7.13 bug)", () => {
  const build = makeBuild();
  assert.doesNotThrow(() =>
    buildCreatePageTransaction(build, baseInput, "pg_new", "inst_new"),
  );
});

test("create: produces 2 page-namespace patches + 1 instance-namespace patch", () => {
  const build = makeBuild();
  const tx = buildCreatePageTransaction(build, baseInput, "pg_new", "inst_new");
  assert.equal(tx.payload.length, 2);
  const pagesNs = tx.payload.find((p) => p.namespace === "pages");
  const instNs = tx.payload.find((p) => p.namespace === "instances");
  assert.equal(pagesNs.patches.length, 2);
  assert.equal(instNs.patches.length, 1);
  // Page added.
  assert.deepEqual(pagesNs.patches[0].path, ["pages", "pg_new"]);
  // Folder children replaced — pg_new appended to Globex (was empty).
  assert.deepEqual(pagesNs.patches[1], {
    op: "replace",
    path: ["folders", "fld_globex", "children"],
    value: ["pg_new"],
  });
});

test("create: same path in the SAME folder is rejected (legitimate conflict)", () => {
  const build = makeBuild();
  // Try to create "/offres" again under root, where pg_root_offres already lives.
  assert.throws(
    () => buildCreatePageTransaction(
      build,
      { ...baseInput, path: "/offres", parentFolderId: "root" },
      "pg_new",
      "inst_new",
    ),
    (err) => {
      assert.match(err.message, /Path "\/offres" is already used by page "Offres" \(id=pg_root_offres\) in folder "Root"/);
      assert.match(err.message, /folder-scoped/);
      return true;
    },
  );
});

test("create: unknown parentFolderId is rejected", () => {
  const build = makeBuild();
  assert.throws(
    () => buildCreatePageTransaction(
      build,
      { ...baseInput, parentFolderId: "fld_ghost" },
      "pg_new",
      "inst_new",
    ),
    /Folder "fld_ghost" not found/,
  );
});

test("create: error message guides the caller (mentions sibling page + folder + actionable fix)", () => {
  const build = makeBuild();
  try {
    buildCreatePageTransaction(
      build,
      { ...baseInput, path: "/offres", parentFolderId: "root" },
      "pg_new",
      "inst_new",
    );
    assert.fail("expected throw");
  } catch (err) {
    // The message should contain the conflicting page name, id, folder name,
    // and an instruction telling the LLM/caller how to pivot.
    assert.match(err.message, /Offres/);
    assert.match(err.message, /pg_root_offres/);
    assert.match(err.message, /Root/);
    assert.match(err.message, /pick a different path or a different parentFolderId/);
  }
});
