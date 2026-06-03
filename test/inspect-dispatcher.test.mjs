// Smoke tests for the webstudio_inspect dispatcher.
//
// Same approach as audit-dispatcher.test.mjs: spy each sub-tool's .handler,
// assert routing + pass-through + error paths. See that file's header for
// rationale on why monkey-patching the exported object works here.

import { test } from "node:test";
import assert from "node:assert/strict";

import { inspectTool } from "../dist/tools/inspect.js";
import { inspectInstanceTool } from "../dist/tools/inspect-instance.js";
import { inspectFormTool } from "../dist/tools/inspect-form.js";
import { inspectResourceTool } from "../dist/tools/inspect-resource.js";

async function withSpy(tool, fn) {
  const original = tool.handler;
  const spy = { calls: 0, lastArgs: null };
  tool.handler = async (args) => {
    spy.calls += 1;
    spy.lastArgs = args;
    return { content: [{ type: "text", text: "spy-ok" }] };
  };
  try {
    await fn(spy);
  } finally {
    tool.handler = original;
  }
}

test("inspect dispatcher routes target:instance to inspectInstanceTool", async () => {
  await withSpy(inspectInstanceTool, async (spy) => {
    const result = await inspectTool.handler({
      target: "instance",
      projectSlug: "acme",
      instanceIds: ["abc123"],
      childDepth: 2,
    });
    assert.equal(spy.calls, 1);
    assert.equal(result.content[0].text, "spy-ok");
    // pass-through: target is stripped, every other param forwarded
    assert.deepEqual(spy.lastArgs, {
      projectSlug: "acme",
      instanceIds: ["abc123"],
      childDepth: 2,
    });
    assert.equal(spy.lastArgs.target, undefined, "target must be stripped before forward");
  });
});

test("inspect dispatcher routes target:form to inspectFormTool", async () => {
  await withSpy(inspectFormTool, async (spy) => {
    await inspectTool.handler({
      target: "form",
      projectSlug: "my-site",
      pagePath: "/contact",
    });
    assert.equal(spy.calls, 1);
    assert.deepEqual(spy.lastArgs, { projectSlug: "my-site", pagePath: "/contact" });
  });
});

test("inspect dispatcher routes target:resource to inspectResourceTool", async () => {
  await withSpy(inspectResourceTool, async (spy) => {
    await inspectTool.handler({
      target: "resource",
      projectSlug: "my-site",
      resourceName: "motoData",
      raw: true,
    });
    assert.equal(spy.calls, 1);
    assert.deepEqual(spy.lastArgs, {
      projectSlug: "my-site",
      resourceName: "motoData",
      raw: true,
    });
  });
});

test("inspect dispatcher routing isolation — calling instance doesn't invoke form handler", async () => {
  await withSpy(inspectInstanceTool, async (instanceSpy) => {
    await withSpy(inspectFormTool, async (formSpy) => {
      await inspectTool.handler({ target: "instance", projectSlug: "p" });
      assert.equal(instanceSpy.calls, 1);
      assert.equal(formSpy.calls, 0);
    });
  });
});

test("inspect dispatcher returns errorResult on missing target", async () => {
  await withSpy(inspectInstanceTool, async (spy) => {
    const result = await inspectTool.handler({ projectSlug: "p" });
    assert.equal(result.isError, true);
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.code, "VALIDATION_FAILED");
    assert.match(payload.message, /Missing 'target' param/);
    assert.equal(spy.calls, 0);
  });
});

test("inspect dispatcher returns errorResult on unknown target", async () => {
  const result = await inspectTool.handler({ target: "bogus-target", projectSlug: "p" });
  assert.equal(result.isError, true);
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.code, "VALIDATION_FAILED");
  assert.match(payload.message, /Unknown inspect target/);
  assert.match(payload.message, /bogus-target/);
});

test("inspect dispatcher returns errorResult when called with no args at all", async () => {
  const result = await inspectTool.handler(undefined);
  assert.equal(result.isError, true);
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.code, "VALIDATION_FAILED");
  assert.match(payload.message, /Missing 'target' param/);
});
