// Integration tests for the `resources` mega-tool (v1.0).
import { test } from "node:test";
import assert from "node:assert/strict";
import { resourcesTool } from "../dist/tools/resources-mega.js";

const PROJECT = "ghost-project-no-auth";
const parseError = (r) => JSON.parse(r.content[0].text);

test("resourcesTool: definition name is 'resources'", () => {
  assert.equal(resourcesTool.definition.name, "resources");
});

test("resourcesTool: 4 actions (flat schema, xActions metadata)", () => {
  const s = resourcesTool.definition.inputSchema;
  assert.equal(s.oneOf, undefined);
  assert.equal(s.xActions.length, 4);
  const actions = s.xActions.map((a) => a.action).sort();
  assert.deepEqual(actions, ["create", "delete", "list", "update"]);
});

test("resourcesTool: delete is CRITICAL (v2: validated at dispatch, not via xActions.required)", () => {
  // v2: context lives at mega-tool Base, no longer in xActions.required[].
  // Runtime tier check (see the next test) enforces it.
  const byA = {};
  for (const a of resourcesTool.definition.inputSchema.xActions) byA[a.action] = a;
  assert.ok(byA.delete, "delete action must be present");
  assert.ok(byA.create, "create action must be present");
});

test("resourcesTool: delete without context → CONTEXT_REQUIRED_FOR_CRITICAL", async () => {
  const res = await resourcesTool.handler({
    action: "delete", label: "drop-res", projectSlug: PROJECT, resourceId: "r1",
  });
  assert.equal(res.isError, true);
  assert.equal(parseError(res).code, "CONTEXT_REQUIRED_FOR_CRITICAL");
});

test("resourcesTool: missing label → VALIDATION_FAILED", async () => {
  const res = await resourcesTool.handler({ action: "list", projectSlug: PROJECT });
  assert.equal(res.isError, true);
  assert.equal(parseError(res).code, "VALIDATION_FAILED");
});

test("resourcesTool: list with unknown project → AUTH_MISSING (delegation)", async () => {
  const res = await resourcesTool.handler({
    action: "list", label: "audit-resources", projectSlug: PROJECT,
  });
  assert.equal(res.isError, true);
  assert.equal(parseError(res).code, "AUTH_MISSING");
});

test("resourcesTool: unknown action → VALIDATION_FAILED", async () => {
  const res = await resourcesTool.handler({
    action: "ghost", label: "valid-label", projectSlug: PROJECT,
  });
  assert.equal(res.isError, true);
  assert.equal(parseError(res).code, "VALIDATION_FAILED");
});
