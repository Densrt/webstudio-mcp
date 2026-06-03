// Tests for the new MOVE feature on pages.update (v2.7.13) — updates.parentFolderId
// emits two folder.children patches (remove from source, append to target).
// Combined with updates.path, move + rename is atomic.
//
// Also covers the folder-scoped path uniqueness regression fix on rename-only
// (path uniqueness must check the current folder, not the whole project).

import { test } from "node:test";
import assert from "node:assert/strict";

const { buildUpdatePageTransaction } = await import("../dist/tools/update-page.js");

function makeBuild() {
  // Tree:
  //   Root (root)
  //   ├── Home (home, path "/")
  //   ├── Offres root (pg_root_offres, path "/offres")
  //   ├── Quads root (pg_root_quads, path "/quads")
  //   └── Globex (fld_globex, slug "globex")
  //       ├── Offres Globex (pg_globex_offres, path "/offres-globex")
  //       └── Quads Globex (pg_globex_quads, path "/quads")
  return {
    id: "b", projectId: "p", version: 1, createdAt: "", updatedAt: "",
    project: { title: "T" },
    pages: {
      homePageId: "home",
      rootFolderId: "root",
      folders: [
        { id: "root", name: "Root", children: ["home", "pg_root_offres", "pg_root_quads", "fld_globex"] },
        { id: "fld_globex", name: "Globex", slug: "globex", children: ["pg_globex_offres", "pg_globex_quads"] },
      ],
      pages: [
        { id: "home", name: "Home", path: "/", rootInstanceId: "home-root" },
        { id: "pg_root_offres", name: "Offres", path: "/offres", rootInstanceId: "r-offres" },
        { id: "pg_root_quads", name: "Quads", path: "/quads", rootInstanceId: "r-quads" },
        { id: "pg_globex_offres", name: "Offres Globex", path: "/offres-globex", rootInstanceId: "g-offres" },
        { id: "pg_globex_quads", name: "Quads Globex", path: "/quads", rootInstanceId: "g-quads" },
      ],
    },
    breakpoints: [], instances: [], props: [], deployments: [], assets: [],
    marketplaceProduct: null, styles: [], styleSources: [], styleSourceSelections: [],
    dataSources: [], resources: [],
  };
}

// ── Move (parentFolderId change) ────────────────────────────────────────────

test("move-only: emits 2 patches removing pageId from source and appending to target", () => {
  const build = makeBuild();
  const tx = buildUpdatePageTransaction(build, "pg_root_offres", { parentFolderId: "fld_globex" });
  const patches = tx.payload[0].patches;
  assert.equal(patches.length, 2);
  assert.deepEqual(patches[0], {
    op: "replace",
    path: ["folders", "root", "children"],
    value: ["home", "pg_root_quads", "fld_globex"],
  });
  assert.deepEqual(patches[1], {
    op: "replace",
    path: ["folders", "fld_globex", "children"],
    value: ["pg_globex_offres", "pg_globex_quads", "pg_root_offres"],
  });
});

test("move-only: same parentFolderId as current = no-op throws No fields to update", () => {
  const build = makeBuild();
  assert.throws(
    () => buildUpdatePageTransaction(build, "pg_root_offres", { parentFolderId: "root" }),
    /No fields to update/,
  );
});

test("move-only: rejects when target folder does not exist", () => {
  const build = makeBuild();
  assert.throws(
    () => buildUpdatePageTransaction(build, "pg_root_offres", { parentFolderId: "fld_ghost" }),
    /Folder "fld_ghost" not found/,
  );
});

test("move-only: rejects when target folder already has a sibling with the same path", () => {
  // pg_root_quads has path "/quads" — move it into fld_globex which already has
  // pg_globex_quads with the same path. Should refuse.
  const build = makeBuild();
  assert.throws(
    () => buildUpdatePageTransaction(build, "pg_root_quads", { parentFolderId: "fld_globex" }),
    /already used by page "Quads Globex".*in folder "Globex"/,
  );
});

// ── Move + rename atomic ─────────────────────────────────────────────────────

test("move + rename: emits the path patch + 2 move patches in the same transaction", () => {
  const build = makeBuild();
  const tx = buildUpdatePageTransaction(build, "pg_root_offres", {
    parentFolderId: "fld_globex",
    path: "/offres",
  });
  const patches = tx.payload[0].patches;
  // 1 path patch + 2 move patches = 3 total.
  assert.equal(patches.length, 3);
  const pathPatch = patches.find((p) => p.path[0] === "pages" && p.path[2] === "path");
  assert.deepEqual(pathPatch, {
    op: "replace",
    path: ["pages", "pg_root_offres", "path"],
    value: "/offres",
  });
  const moveOut = patches.find((p) => p.path[0] === "folders" && p.path[1] === "root");
  const moveIn = patches.find((p) => p.path[0] === "folders" && p.path[1] === "fld_globex");
  assert.ok(moveOut);
  assert.ok(moveIn);
  assert.ok(!moveOut.value.includes("pg_root_offres"));
  assert.ok(moveIn.value.includes("pg_root_offres"));
});

test("move + rename: rejects when target folder already has the new path among siblings", () => {
  // Trying to move pg_root_offres to fld_globex AND rename its path to "/offres-globex"
  // which is already taken by pg_globex_offres in fld_globex.
  const build = makeBuild();
  assert.throws(
    () => buildUpdatePageTransaction(build, "pg_root_offres", {
      parentFolderId: "fld_globex",
      path: "/offres-globex",
    }),
    /already used by page "Offres Globex".*in folder "Globex"/,
  );
});

// ── Rename only (no move) ────────────────────────────────────────────────────

test("rename-only: same path as a page in a DIFFERENT folder is allowed (regression fix)", () => {
  // pg_root_offres exists at /offres. Rename pg_root_quads to /offres should
  // FAIL because they share root — but rename to a path that exists in fld_globex
  // (e.g. "/offres-globex") should SUCCEED because that's a different folder.
  const build = makeBuild();
  assert.doesNotThrow(() =>
    buildUpdatePageTransaction(build, "pg_root_quads", { path: "/offres-globex" }),
  );
});

test("rename-only: rejects when the new path collides with a sibling in the current folder", () => {
  // pg_root_quads in root tries to take "/offres" which pg_root_offres already
  // owns in root.
  const build = makeBuild();
  assert.throws(
    () => buildUpdatePageTransaction(build, "pg_root_quads", { path: "/offres" }),
    /already used by page "Offres".*in folder "Root"/,
  );
});

test("rename-only: same path as itself = no path change, no validation needed", () => {
  const build = makeBuild();
  // Renaming "/offres" to "/offres" — the path field is set but identical.
  // buildUpdatePatches still emits a patch (technically a no-op replace), but
  // no validation conflict because the only existing /offres in root IS the
  // page itself.
  assert.doesNotThrow(() =>
    buildUpdatePageTransaction(build, "pg_root_offres", { path: "/offres" }),
  );
});

// ── No-op + error cases ──────────────────────────────────────────────────────

test("update: unknown pageId throws PAGE_NOT_FOUND message", () => {
  const build = makeBuild();
  assert.throws(
    () => buildUpdatePageTransaction(build, "pg_ghost", { path: "/x" }),
    /Page "pg_ghost" not found/,
  );
});

test("update: combining move + name change emits 2 move patches + 1 name patch", () => {
  const build = makeBuild();
  const tx = buildUpdatePageTransaction(build, "pg_root_offres", {
    parentFolderId: "fld_globex",
    name: "Offres Globex",
  });
  const patches = tx.payload[0].patches;
  assert.equal(patches.length, 3);
  const namePatch = patches.find((p) => p.path[0] === "pages" && p.path[2] === "name");
  assert.deepEqual(namePatch, {
    op: "replace",
    path: ["pages", "pg_root_offres", "name"],
    value: "Offres Globex",
  });
});
