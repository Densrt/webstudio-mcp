// Guards the projectSlug path-traversal fix in src/projects.ts.
// projectSlug becomes an on-disk directory name, so it must reject "../", absolute
// paths, separators and dots before touching the filesystem.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isSafeSlug, assertSafeSlug } from "../dist/projects.js";

test("isSafeSlug accepts realistic slugs", () => {
  for (const s of ["my-site", "acme", "demo_2", "a", "Project-1", "x".repeat(64)]) {
    assert.equal(isSafeSlug(s), true, `should accept ${JSON.stringify(s)}`);
  }
});

test("isSafeSlug rejects traversal, separators, dots, empty, overlong, non-string", () => {
  for (const s of [
    "", ".", "..", "../x", "../../etc/passwd", "/abs", "a/b", "a\\b", "a.b",
    "-leading", "_leading", " spaced", "x".repeat(65), null, undefined, 42, {},
  ]) {
    assert.equal(isSafeSlug(s), false, `should reject ${JSON.stringify(s)}`);
  }
});

test("assertSafeSlug allows a valid slug, throws on traversal/absolute/separators", () => {
  assert.doesNotThrow(() => assertSafeSlug("my-site"));
  for (const bad of ["../escape", "../../etc/passwd", "/abs/path", "a/b", "..", "."]) {
    assert.throws(() => assertSafeSlug(bad), /Invalid projectSlug|resolves outside/, `should throw for ${JSON.stringify(bad)}`);
  }
});
