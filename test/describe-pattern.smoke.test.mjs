// Smoke test for webstudio_describe_pattern: index + helper + tool branches.
// Run after `npx tsc`: node --test test/describe-pattern.smoke.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { describePatternTool } from "../dist/tools/describe-pattern.js";

test("no arg lists both helper and tool catalogs", async () => {
  const r = await describePatternTool.handler({});
  assert.equal(r.isError, undefined);
  const txt = r.content[0].text;
  assert.match(txt, /Builder helpers/);
  assert.match(txt, /Tools with deep docs/);
  assert.match(txt, /sheet/);
  assert.match(txt, /webstudio_upload_asset/);
});

test("pattern arg renders helper doc", async () => {
  const r = await describePatternTool.handler({ pattern: "sheet" });
  assert.equal(r.isError, undefined);
  assert.match(r.content[0].text, /Sheet \(mobile drawer\)/);
  assert.match(r.content[0].text, /addSheet/);
});

test("pattern arg is case-insensitive", async () => {
  const r = await describePatternTool.handler({ pattern: "SHEET" });
  assert.equal(r.isError, undefined);
  assert.match(r.content[0].text, /Sheet \(mobile drawer\)/);
});

test("unknown pattern returns VALIDATION_FAILED", async () => {
  const r = await describePatternTool.handler({ pattern: "nope" });
  assert.equal(r.isError, true);
  const payload = JSON.parse(r.content[0].text);
  assert.equal(payload.code, "VALIDATION_FAILED");
  assert.match(payload.message, /Pattern .*nope.* not found/);
});

test("tool arg renders deep doc", async () => {
  const r = await describePatternTool.handler({ tool: "webstudio_upload_asset" });
  assert.equal(r.isError, undefined);
  const txt = r.content[0].text;
  assert.match(txt, /# webstudio_upload_asset/);
  assert.match(txt, /Two-step workflow/);
});

test("unknown tool returns VALIDATION_FAILED with available list", async () => {
  const r = await describePatternTool.handler({ tool: "webstudio_unknown" });
  assert.equal(r.isError, true);
  const payload = JSON.parse(r.content[0].text);
  assert.equal(payload.code, "VALIDATION_FAILED");
  assert.match(payload.message, /no deep docs registered/);
  assert.match(payload.message, /webstudio_upload_asset/);
});

test("all tool docs are wired and non-empty", async () => {
  const { TOOL_DOCS } = await import("../dist/tools/describe-pattern/tools-docs.js");
  const keys = Object.keys(TOOL_DOCS);
  // v0.4.0: count adjusted — some entries consolidated when tools merged into dispatchers
  // (webstudio_styles, webstudio_instance_prop, webstudio_css_var, webstudio_helpers removed).
  assert.ok(keys.length >= 15, `expected >=15 tool docs, got ${keys.length}`);
  for (const k of keys) {
    assert.ok(TOOL_DOCS[k].length > 50, `${k} doc too short`);
  }
});
