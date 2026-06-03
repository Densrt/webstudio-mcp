// Integration tests for the `pages` mega-tool (v1.0).
// Validates the dispatcher layer: Zod parsing, label/context enforcement,
// tier-based error codes. Does NOT exercise the underlying sub-handlers
// (those have their own tests + would need live Webstudio auth).

import { test } from "node:test";
import assert from "node:assert/strict";
import { pagesTool } from "../dist/tools/pages.js";

const PROJECT = "ghost-project-no-auth"; // no auth → sub-handler returns AUTH_MISSING

function parseError(result) {
  return JSON.parse(result.content[0].text);
}

// ─── manifest shape ────────────────────────────────────────────────────────

test("pagesTool: definition name is 'pages' (no webstudio_ prefix)", () => {
  assert.equal(pagesTool.definition.name, "pages");
});

test("pagesTool: inputSchema has 9 actions (flat schema, xActions metadata)", () => {
  const schema = pagesTool.definition.inputSchema;
  assert.equal(schema.type, "object");
  assert.equal(schema.oneOf, undefined);
  assert.equal(schema.xActions.length, 9);
  const actions = schema.xActions.map((a) => a.action);
  const expected = [
    "create", "create_folder", "delete", "delete_folder", "duplicate",
    "get_meta", "list_folders", "update", "update_meta",
  ];
  assert.deepEqual(actions.sort(), expected);
  assert.deepEqual(schema.properties.action.enum.sort(), expected);
});

test("pagesTool: top-level required is action + label", () => {
  assert.deepEqual(pagesTool.definition.inputSchema.required, ["action", "label"]);
});

test("pagesTool: delete + delete_folder require context (CRITICAL, validated at dispatch in v2)", async () => {
  // v2: context lives at mega-tool Base, not in the atomic Zod, so it no longer
  // shows up in xActions[action].required[]. Runtime tier check enforces it.
  const res = await pagesTool.handler({
    action: "delete", label: "drop-pages", projectSlug: PROJECT, pageIds: ["pg1"],
  });
  assert.equal(res.isError, true);
  assert.equal(parseError(res).code, "CONTEXT_REQUIRED_FOR_CRITICAL");

  const res2 = await pagesTool.handler({
    action: "delete_folder", label: "drop-folder", projectSlug: PROJECT, folderId: "fld1",
  });
  assert.equal(res2.isError, true);
  assert.equal(parseError(res2).code, "CONTEXT_REQUIRED_FOR_CRITICAL");
});

// ─── label validation ──────────────────────────────────────────────────────

test("pagesTool: missing label → VALIDATION_FAILED", async () => {
  const res = await pagesTool.handler({
    action: "list_folders",
    projectSlug: PROJECT,
  });
  assert.equal(res.isError, true);
  assert.equal(parseError(res).code, "VALIDATION_FAILED");
});

test("pagesTool: label too short → VALIDATION_FAILED", async () => {
  const res = await pagesTool.handler({
    action: "list_folders",
    label: "ab",
    projectSlug: PROJECT,
  });
  assert.equal(res.isError, true);
  const e = parseError(res);
  assert.equal(e.code, "VALIDATION_FAILED");
});

// ─── context tier enforcement ──────────────────────────────────────────────

test("pagesTool: delete (CRITICAL) without context → CONTEXT_REQUIRED_FOR_CRITICAL", async () => {
  const res = await pagesTool.handler({
    action: "delete",
    label: "purge-old",
    projectSlug: PROJECT,
    pageIds: ["pg1"],
  });
  assert.equal(res.isError, true);
  assert.equal(parseError(res).code, "CONTEXT_REQUIRED_FOR_CRITICAL");
});

test("pagesTool: delete_folder (CRITICAL) without context → CONTEXT_REQUIRED_FOR_CRITICAL", async () => {
  const res = await pagesTool.handler({
    action: "delete_folder",
    label: "drop-folder",
    projectSlug: PROJECT,
    folderId: "fld_x",
  });
  assert.equal(res.isError, true);
  assert.equal(parseError(res).code, "CONTEXT_REQUIRED_FOR_CRITICAL");
});

test("pagesTool: delete with bad-format context → CONTEXT_INVALID_FORMAT", async () => {
  const res = await pagesTool.handler({
    action: "delete",
    label: "purge-old",
    projectSlug: PROJECT,
    pageIds: ["pg1"],
    context: "too short",
  });
  assert.equal(res.isError, true);
  assert.equal(parseError(res).code, "CONTEXT_INVALID_FORMAT");
});

// ─── delegation: AUTH_MISSING bubbles up from sub-handler ──────────────────

test("pagesTool: list_folders with unknown project → AUTH_MISSING from sub-handler", async () => {
  const res = await pagesTool.handler({
    action: "list_folders",
    label: "list-folders",
    projectSlug: PROJECT,
  });
  assert.equal(res.isError, true);
  assert.equal(parseError(res).code, "AUTH_MISSING");
});

// ─── unknown action / bad schema ───────────────────────────────────────────

test("pagesTool: unknown action → Zod refuses", async () => {
  const res = await pagesTool.handler({
    action: "ghost",
    label: "valid-label",
    projectSlug: PROJECT,
  });
  assert.equal(res.isError, true);
  assert.equal(parseError(res).code, "VALIDATION_FAILED");
});

test("pagesTool: create with valid context passes validation (delegates to sub-handler)", async () => {
  // The sub-handler will fail with AUTH_MISSING — but it means the mega-tool layer
  // passed and delegation happened.
  const res = await pagesTool.handler({
    action: "create",
    label: "create-test",
    projectSlug: PROJECT,
    name: "Test",
    path: "/test",
    context: "The agent is creating a test page to verify the mega-tool delegation pipeline works end to end here.",
  });
  assert.equal(res.isError, true);
  assert.equal(parseError(res).code, "AUTH_MISSING");
});
