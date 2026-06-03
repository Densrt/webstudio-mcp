// Integration tests for the `assets` mega-tool (v1.0).
import { test } from "node:test";
import assert from "node:assert/strict";
import { assetsTool } from "../dist/tools/assets.js";

const PROJECT = "ghost-project-no-auth";
const parseError = (r) => JSON.parse(r.content[0].text);

test("assetsTool: definition name is 'assets'", () => {
  assert.equal(assetsTool.definition.name, "assets");
});

test("assetsTool: 5 actions (flat schema, xActions metadata)", () => {
  const s = assetsTool.definition.inputSchema;
  assert.equal(s.oneOf, undefined);
  assert.equal(s.xActions.length, 5);
  const actions = s.xActions.map((a) => a.action).sort();
  assert.deepEqual(actions, ["delete", "find_usage", "list", "replace", "upload"]);
});

test("assetsTool: replace + delete are CRITICAL (v2: enforced at dispatch)", () => {
  // v2: context lives at the mega-tool Base, no longer in xActions.required[].
  // Runtime tier check enforces it (see next test).
  const byA = {};
  for (const a of assetsTool.definition.inputSchema.xActions) byA[a.action] = a;
  assert.ok(byA.replace, "replace action present");
  assert.ok(byA.delete, "delete action present");
  assert.ok(byA.upload, "upload action present");
});

test("assetsTool: replace without context → CONTEXT_REQUIRED_FOR_CRITICAL", async () => {
  const res = await assetsTool.handler({
    action: "replace", label: "swap-logo", projectSlug: PROJECT,
    fromAssetId: "abc", toAssetId: "def",
  });
  assert.equal(res.isError, true);
  assert.equal(parseError(res).code, "CONTEXT_REQUIRED_FOR_CRITICAL");
});

test("assetsTool: delete without context → CONTEXT_REQUIRED_FOR_CRITICAL", async () => {
  const res = await assetsTool.handler({
    action: "delete", label: "purge-old", projectSlug: PROJECT,
    assetIds: ["abc"],
  });
  assert.equal(res.isError, true);
  assert.equal(parseError(res).code, "CONTEXT_REQUIRED_FOR_CRITICAL");
});

test("assetsTool: missing label → VALIDATION_FAILED", async () => {
  const res = await assetsTool.handler({ action: "list", projectSlug: PROJECT });
  assert.equal(res.isError, true);
  assert.equal(parseError(res).code, "VALIDATION_FAILED");
});

test("assetsTool: list with unknown project → AUTH_MISSING (delegation)", async () => {
  const res = await assetsTool.handler({
    action: "list", label: "audit-assets", projectSlug: PROJECT,
  });
  assert.equal(res.isError, true);
  assert.equal(parseError(res).code, "AUTH_MISSING");
});

test("assetsTool: find_usage with unknown project → AUTH_MISSING (READ-ONLY delegation)", async () => {
  const res = await assetsTool.handler({
    action: "find_usage", label: "audit-asset", projectSlug: PROJECT, assetId: "abc",
  });
  assert.equal(res.isError, true);
  assert.equal(parseError(res).code, "AUTH_MISSING");
});

test("assetsTool: unknown action → VALIDATION_FAILED", async () => {
  const res = await assetsTool.handler({
    action: "ghost", label: "valid-label", projectSlug: PROJECT,
  });
  assert.equal(res.isError, true);
  assert.equal(parseError(res).code, "VALIDATION_FAILED");
});
