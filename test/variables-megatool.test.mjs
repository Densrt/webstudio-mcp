// Integration tests for the `variables` mega-tool (v1.0).
import { test } from "node:test";
import assert from "node:assert/strict";
import { variablesTool } from "../dist/tools/variables-mega.js";

const PROJECT = "ghost-project-no-auth";
const parseError = (r) => JSON.parse(r.content[0].text);

test("variablesTool: definition name is 'variables'", () => {
  assert.equal(variablesTool.definition.name, "variables");
});

test("variablesTool: 5 actions (flat schema, xActions metadata)", () => {
  const s = variablesTool.definition.inputSchema;
  assert.equal(s.oneOf, undefined);
  assert.equal(s.xActions.length, 5);
  const actions = s.xActions.map((a) => a.action).sort();
  assert.deepEqual(actions, ["bind_page_field", "create", "delete", "list", "update"]);
});

test("variablesTool: delete without context → CONTEXT_REQUIRED_FOR_CRITICAL (v2: validated at dispatch, not via xActions.required)", async () => {
  // v2: context lives at mega-tool boundary (Base wrapper), not in the atomic Zod.
  // xActions only carries sub-handler fields, so `context` is no longer surfaced
  // in xActions.required[]. The runtime tier check (CRITICAL → context required)
  // is the actual enforcement.
  const res = await variablesTool.handler({
    action: "delete", label: "drop-vars", projectSlug: PROJECT, dataSourceIdsOrNames: ["v1"],
  });
  assert.equal(res.isError, true);
  assert.equal(parseError(res).code, "CONTEXT_REQUIRED_FOR_CRITICAL");
});

test("variablesTool: missing label → VALIDATION_FAILED", async () => {
  const res = await variablesTool.handler({ action: "list", projectSlug: PROJECT });
  assert.equal(res.isError, true);
  assert.equal(parseError(res).code, "VALIDATION_FAILED");
});

test("variablesTool: list with unknown project → AUTH_MISSING (delegation)", async () => {
  const res = await variablesTool.handler({
    action: "list", label: "audit-vars", projectSlug: PROJECT,
  });
  assert.equal(res.isError, true);
  assert.equal(parseError(res).code, "AUTH_MISSING");
});

test("variablesTool: bind_page_field is TACTICAL (no context required)", async () => {
  const res = await variablesTool.handler({
    action: "bind_page_field", label: "bind-title", projectSlug: PROJECT,
    pageId: "pg1", field: "title", binding: { kind: "variable", dataSourceId: "abc" },
  });
  // delegated to bindPageFieldTool → AUTH_MISSING since project doesn't exist
  assert.equal(res.isError, true);
  assert.equal(parseError(res).code, "AUTH_MISSING");
});

test("variablesTool: unknown action → VALIDATION_FAILED", async () => {
  const res = await variablesTool.handler({
    action: "ghost", label: "valid-label", projectSlug: PROJECT,
  });
  assert.equal(res.isError, true);
  assert.equal(parseError(res).code, "VALIDATION_FAILED");
});
