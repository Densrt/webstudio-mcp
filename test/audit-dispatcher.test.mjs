// Smoke tests for the webstudio_audit dispatcher.
//
// Sub-handlers do real network calls via requireAuth + fetchBuild — we can't
// execute them for real in tests. We monkey-patch each sub-tool's .handler to
// a spy that captures the args, then assert:
//   1. routing — the dispatcher invokes the right sub-handler per kind
//   2. pass-through — caller params (sans `kind`) reach the sub-handler intact
//   3. error path — missing or unknown `kind` returns errorResult, no sub call
//
// The dispatcher reads sub-tools as `KIND_TO_TOOL[kind].handler` at call time,
// so mutating the exported `.handler` property on the imported module object
// is enough (no module-loader trickery needed).

import { test } from "node:test";
import assert from "node:assert/strict";

import { auditTool } from "../dist/tools/audit.js";
import { auditFontsTool } from "../dist/tools/audit-fonts.js";
import { auditOverflowTool } from "../dist/tools/audit-overflow.js";
import { auditTokenOverlapTool } from "../dist/tools/audit-token-overlap.js";
import { auditImagesTool } from "../dist/tools/audit-images.js";

// Helper: swap a tool's handler with a spy for the duration of `fn`. Restores
// the original handler in a finally so a failing assertion doesn't pollute
// other tests.
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

test("audit dispatcher routes kind:fonts to auditFontsTool", async () => {
  await withSpy(auditFontsTool, async (spy) => {
    const result = await auditTool.handler({
      kind: "fonts",
      projectSlug: "test-slug",
      sizeThresholdKB: 80,
    });
    assert.equal(spy.calls, 1, "auditFontsTool.handler should be called exactly once");
    assert.equal(result.content[0].text, "spy-ok", "dispatcher returns sub-handler result");
    // pass-through: projectSlug + sizeThresholdKB transit, `kind` is stripped
    assert.deepEqual(spy.lastArgs, { projectSlug: "test-slug", sizeThresholdKB: 80 });
    assert.equal(spy.lastArgs.kind, undefined, "kind must be stripped before forward");
  });
});

test("audit dispatcher routes kind:overflow to auditOverflowTool", async () => {
  await withSpy(auditOverflowTool, async (spy) => {
    await auditTool.handler({
      kind: "overflow",
      projectSlug: "acme",
      pagePath: "/",
      breakpoint: "mobile-portrait",
      minSeverity: "high",
    });
    assert.equal(spy.calls, 1);
    assert.deepEqual(spy.lastArgs, {
      projectSlug: "acme",
      pagePath: "/",
      breakpoint: "mobile-portrait",
      minSeverity: "high",
    });
  });
});

test("audit dispatcher routes kind:token-overlap to auditTokenOverlapTool", async () => {
  await withSpy(auditTokenOverlapTool, async (spy) => {
    await auditTool.handler({
      kind: "token-overlap",
      projectSlug: "my-site",
      tokenName: "BrandColor",
      maxInstances: 25,
    });
    assert.equal(spy.calls, 1);
    assert.deepEqual(spy.lastArgs, {
      projectSlug: "my-site",
      tokenName: "BrandColor",
      maxInstances: 25,
    });
  });
});

test("audit dispatcher routes kind:images to auditImagesTool", async () => {
  await withSpy(auditImagesTool, async (spy) => {
    await auditTool.handler({ kind: "images", projectSlug: "my-site" });
    assert.equal(spy.calls, 1);
    assert.deepEqual(spy.lastArgs, { projectSlug: "my-site" });
  });
});

test("audit dispatcher routing isolation — calling fonts doesn't invoke overflow handler", async () => {
  // Spy both: only fonts should be hit.
  await withSpy(auditFontsTool, async (fontsSpy) => {
    await withSpy(auditOverflowTool, async (overflowSpy) => {
      await auditTool.handler({ kind: "fonts", projectSlug: "p" });
      assert.equal(fontsSpy.calls, 1);
      assert.equal(overflowSpy.calls, 0, "non-routed sub-handler must not be called");
    });
  });
});

test("audit dispatcher returns errorResult on missing kind", async () => {
  // Also verify no sub-handler is called even on error.
  await withSpy(auditFontsTool, async (spy) => {
    const result = await auditTool.handler({ projectSlug: "test" });
    assert.equal(result.isError, true);
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.ok, false);
    assert.equal(payload.code, "VALIDATION_FAILED");
    assert.match(payload.message, /Missing 'kind' param/);
    assert.equal(spy.calls, 0);
  });
});

test("audit dispatcher returns errorResult on unknown kind", async () => {
  const result = await auditTool.handler({ kind: "not-a-real-kind", projectSlug: "test" });
  assert.equal(result.isError, true);
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.code, "VALIDATION_FAILED");
  assert.match(payload.message, /Unknown audit kind/);
  assert.match(payload.message, /not-a-real-kind/);
});

test("audit dispatcher returns errorResult when called with no args at all", async () => {
  // Defensive: handler must tolerate undefined/null args without throwing.
  const result = await auditTool.handler(undefined);
  assert.equal(result.isError, true);
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.code, "VALIDATION_FAILED");
  assert.match(payload.message, /Missing 'kind' param/);
});
