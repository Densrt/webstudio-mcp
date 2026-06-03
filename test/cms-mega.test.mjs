// Integration tests for the `cms` mega-tool (chantier #11).
// All actions are routed through validators (label, context tier).
// Sub-handlers throw AUTH_MISSING when ~/.webstudio-mcp/cms/directus.json is absent.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cmsTool } from "../dist/tools/cms-mega.js";

const parseError = (r) => JSON.parse(r.content[0].text);

test("cmsTool: definition name is 'cms'", () => {
  assert.equal(cmsTool.definition.name, "cms");
});

test("cmsTool: 7 actions (flat schema, xActions metadata)", () => {
  const s = cmsTool.definition.inputSchema;
  assert.equal(s.oneOf, undefined);
  assert.equal(s.xActions.length, 7);
  const actions = s.xActions.map((a) => a.action).sort();
  assert.deepEqual(actions, [
    "bind_collection_to_instance", "create_item", "delete_item", "discover_schema",
    "list_collections", "list_items", "update_item",
  ]);
});

test("cmsTool: delete_item + bind_collection_to_instance are CRITICAL (v2: enforced at dispatch)", () => {
  // v2: context lives at the mega-tool Base, no longer in xActions.required[].
  const byA = {};
  for (const a of cmsTool.definition.inputSchema.xActions) byA[a.action] = a;
  assert.ok(byA.delete_item, "delete_item action present");
  assert.ok(byA.bind_collection_to_instance, "bind_collection_to_instance action present");
});

test("cmsTool: missing label → VALIDATION_FAILED", async () => {
  const res = await cmsTool.handler({ action: "list_collections" });
  assert.equal(res.isError, true);
  assert.equal(parseError(res).code, "VALIDATION_FAILED");
});

test("cmsTool: delete_item without context → CONTEXT_REQUIRED_FOR_CRITICAL", async () => {
  const res = await cmsTool.handler({
    action: "delete_item", label: "del-test",
    collection: "motos", itemId: "abc",
  });
  assert.equal(res.isError, true);
  assert.equal(parseError(res).code, "CONTEXT_REQUIRED_FOR_CRITICAL");
});

test("cmsTool: bind_collection_to_instance without context → CONTEXT_REQUIRED_FOR_CRITICAL", async () => {
  const res = await cmsTool.handler({
    action: "bind_collection_to_instance", label: "bind-test",
    projectSlug: "my-site", collection: "motos", scopeInstanceId: "abc",
  });
  assert.equal(res.isError, true);
  assert.equal(parseError(res).code, "CONTEXT_REQUIRED_FOR_CRITICAL");
});

test("cmsTool: list_collections without config → AUTH_MISSING (sub-handler graceful)", async () => {
  const res = await cmsTool.handler({ action: "list_collections", label: "list-test" });
  assert.equal(res.isError, true);
  assert.equal(parseError(res).code, "AUTH_MISSING");
});

test("cmsTool: discover_schema without config → AUTH_MISSING", async () => {
  const res = await cmsTool.handler({
    action: "discover_schema", label: "schema-test", collection: "motos",
  });
  assert.equal(res.isError, true);
  assert.equal(parseError(res).code, "AUTH_MISSING");
});

test("cmsTool: list_items without config → AUTH_MISSING", async () => {
  const res = await cmsTool.handler({
    action: "list_items", label: "list-items-test", collection: "motos",
  });
  assert.equal(res.isError, true);
  assert.equal(parseError(res).code, "AUTH_MISSING");
});

test("cmsTool: delete_item dry-run with context → returns dry-run text without hitting Directus", async () => {
  // dry-run defaults to true, so should not call adapter (and not return AUTH_MISSING)
  const res = await cmsTool.handler({
    action: "delete_item", label: "del-dry",
    collection: "motos", itemId: "abc",
    context: "Testing the cms delete dry-run action returns a preview without hitting the live Directus source to verify safety gate.",
  });
  // dry-run mode returns text — no error, no AUTH_MISSING
  const text = res.content[0]?.text ?? "";
  assert.ok(!res.isError, "expected no error in dry-run");
  assert.match(text, /DRY-RUN delete_item/);
  assert.match(text, /motos\/abc/);
});

test("cmsTool: bind_collection_to_instance dry-run → AUTH_MISSING (schema discovery hits adapter)", async () => {
  // bind dry-run still calls discoverSchema for the preview — so it hits AUTH_MISSING
  const res = await cmsTool.handler({
    action: "bind_collection_to_instance", label: "bind-dry",
    projectSlug: "my-site", collection: "motos", scopeInstanceId: "abc",
    context: "Testing the cms bind action dry-run delegation pipeline to verify schema discovery is attempted even in preview mode.",
  });
  assert.equal(res.isError, true);
  assert.equal(parseError(res).code, "AUTH_MISSING");
});

test("cmsTool: unknown action → VALIDATION_FAILED", async () => {
  const res = await cmsTool.handler({
    action: "ghost", label: "valid-label",
  });
  assert.equal(res.isError, true);
  assert.equal(parseError(res).code, "VALIDATION_FAILED");
});
