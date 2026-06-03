// Unit tests for mega-tool dispatcher + JSON Schema builder (v1.0 prep).

import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatchAction, buildJsonSchemaForActions } from "../dist/lib/mega-tool.js";

test("dispatchAction: routes to the right handler", async () => {
  const handlers = {
    create: async (input) => ({ content: [{ type: "text", text: `created ${input.action}` }] }),
    delete: async (input) => ({ content: [{ type: "text", text: `deleted` }] }),
  };
  const out = await dispatchAction({ action: "create" }, handlers);
  assert.equal(out.content[0].text, "created create");
});

test("dispatchAction: unknown action returns structured error", async () => {
  const handlers = { create: async () => ({ content: [{ type: "text", text: "ok" }] }) };
  const out = await dispatchAction({ action: "ghost" }, handlers);
  assert.equal(out.isError, true);
  const payload = JSON.parse(out.content[0].text);
  assert.equal(payload.code, "VALIDATION_FAILED");
  assert.match(payload.message, /Unknown action "ghost"/);
  assert.match(payload.message, /create/);
});

test("dispatchAction: handler errors propagate (handler responsible for own errorResult)", async () => {
  const handlers = {
    boom: async () => ({ content: [{ type: "text", text: "internal" }], isError: true }),
  };
  const out = await dispatchAction({ action: "boom" }, handlers);
  assert.equal(out.isError, true);
});

test("buildJsonSchemaForActions: produces flat schema with xActions metadata", () => {
  const schema = buildJsonSchemaForActions([
    {
      action: "create",
      description: "Create a page",
      schema: { projectSlug: { type: "string" }, path: { type: "string" } },
      required: ["projectSlug", "path"],
    },
    {
      action: "delete",
      description: "Delete a page",
      schema: { projectSlug: { type: "string" }, pageIds: { type: "array", items: { type: "string" } } },
      required: ["projectSlug", "pageIds"],
    },
  ]);
  assert.equal(schema.type, "object");
  // No top-level oneOf — Anthropic API rejects it. Flat schema instead.
  assert.equal(schema.oneOf, undefined);
  assert.deepEqual(schema.properties.action.enum, ["create", "delete"]);
  assert.equal(schema.properties.label.minLength, 3);
  assert.equal(schema.properties.label.maxLength, 30);
  // Merged properties from all branches
  assert.equal(schema.properties.projectSlug.type, "string");
  assert.equal(schema.properties.path.type, "string");
  assert.equal(schema.properties.pageIds.type, "array");
  // Only action + label required at JSON Schema level (per-action required enforced by Zod at runtime)
  assert.deepEqual(schema.required, ["action", "label"]);
  assert.equal(schema.additionalProperties, false);
  // xActions exposes per-action metadata for the meta mega-tool
  assert.equal(schema.xActions.length, 2);
  assert.equal(schema.xActions[0].action, "create");
  assert.deepEqual(schema.xActions[0].required, ["projectSlug", "path"]);
  assert.equal(schema.xActions[1].action, "delete");
});

test("buildJsonSchemaForActions: empty array throws", () => {
  assert.throws(() => buildJsonSchemaForActions([]), /at least 1 action/);
});

test("buildJsonSchemaForActions: per-action required surfaced via xActions", () => {
  const schema = buildJsonSchemaForActions([
    { action: "list", description: "List", schema: { projectSlug: { type: "string" } }, required: ["projectSlug"] },
  ]);
  assert.deepEqual(schema.xActions[0].required, ["projectSlug"]);
  // JSON Schema top-level required is always just action + label
  assert.deepEqual(schema.required, ["action", "label"]);
});

test("buildJsonSchemaForActions: action description concatenates per-variant docs", () => {
  const schema = buildJsonSchemaForActions([
    { action: "a", description: "doc A", schema: {}, required: [] },
    { action: "b", description: "doc B", schema: {}, required: [] },
  ]);
  assert.match(schema.properties.action.description, /action="a" — doc A/);
  assert.match(schema.properties.action.description, /action="b" — doc B/);
});
