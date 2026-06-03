// Tests for src/lib/telemetry.ts — opt-in JSONL logger (v2.7.4).
//
// Coverage:
// - logTelemetry is no-op when disabled (no file write)
// - logTelemetry appends one JSON line per call when enabled
// - logTelemetry auto-adds ts if missing, preserves caller-supplied ts
// - logTelemetry extra fields preserved verbatim
// - logCoerce wraps with event:"coerce" + key
// - errors during write are swallowed (never throws)
// - ordering preserved in the JSONL log

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, unlinkSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

import {
  logTelemetry,
  logCoerce,
  isTelemetryEnabled,
  getTelemetryLogPath,
  _setTelemetryForTests,
} from "../dist/lib/telemetry.js";

function setupTempLog() {
  const dir = mkdtempSync(join(tmpdir(), "ws-telemetry-"));
  const path = join(dir, "log.jsonl");
  _setTelemetryForTests({ enabled: true, path });
  return path;
}

function readLines(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));
}

test("telemetry: disabled by default → logTelemetry no-op", async () => {
  _setTelemetryForTests({ enabled: false, path: null });
  assert.equal(isTelemetryEnabled(), false);
  assert.equal(getTelemetryLogPath(), null);
  // Should not throw, should not write anywhere.
  await logTelemetry({ event: "tool_call", tool: "foo" });
  await logCoerce("expand:gridColumn");
});

test("telemetry: enabled writes one JSON line per call", async () => {
  const path = setupTempLog();
  try {
    await logTelemetry({ event: "tool_call", tool: "styles", action: "update", success: true });
    await logTelemetry({ event: "tool_call", tool: "build", action: "push_fragment", success: true });
    const lines = readLines(path);
    assert.equal(lines.length, 2);
    assert.equal(lines[0].tool, "styles");
    assert.equal(lines[1].tool, "build");
    assert.equal(lines[0].event, "tool_call");
  } finally {
    _setTelemetryForTests({ enabled: false, path: null });
    if (existsSync(path)) unlinkSync(path);
  }
});

test("telemetry: ts auto-added if missing, preserved if supplied", async () => {
  const path = setupTempLog();
  try {
    await logTelemetry({ event: "tool_call", tool: "foo" });
    await logTelemetry({ event: "tool_call", tool: "bar", ts: "2026-01-01T00:00:00.000Z" });
    const lines = readLines(path);
    assert.equal(lines.length, 2);
    assert.ok(lines[0].ts, "expected auto ts");
    assert.match(lines[0].ts, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(lines[1].ts, "2026-01-01T00:00:00.000Z");
  } finally {
    _setTelemetryForTests({ enabled: false, path: null });
    if (existsSync(path)) unlinkSync(path);
  }
});

test("telemetry: extra fields preserved verbatim", async () => {
  const path = setupTempLog();
  try {
    await logTelemetry({
      event: "tool_call",
      tool: "styles",
      action: "update",
      args_keys: ["projectSlug", "updates"],
      success: false,
      duration_ms: 42,
      error_class: "validation",
      customField: "hello",
    });
    const lines = readLines(path);
    assert.equal(lines.length, 1);
    assert.deepEqual(lines[0].args_keys, ["projectSlug", "updates"]);
    assert.equal(lines[0].duration_ms, 42);
    assert.equal(lines[0].error_class, "validation");
    assert.equal(lines[0].customField, "hello");
  } finally {
    _setTelemetryForTests({ enabled: false, path: null });
    if (existsSync(path)) unlinkSync(path);
  }
});

test("telemetry: logCoerce sets event=coerce + key + extra", async () => {
  const path = setupTempLog();
  try {
    await logCoerce("expand:gridColumn", { source: "styles.update", projectSlug: "my-site" });
    await logCoerce("coerce:aspectRatio", { source: "styles.update" });
    const lines = readLines(path);
    assert.equal(lines.length, 2);
    assert.equal(lines[0].event, "coerce");
    assert.equal(lines[0].key, "expand:gridColumn");
    assert.equal(lines[0].source, "styles.update");
    assert.equal(lines[0].projectSlug, "my-site");
    assert.equal(lines[1].event, "coerce");
    assert.equal(lines[1].key, "coerce:aspectRatio");
  } finally {
    _setTelemetryForTests({ enabled: false, path: null });
    if (existsSync(path)) unlinkSync(path);
  }
});

test("telemetry: errors during write are swallowed (never throws)", async () => {
  // Set enabled with a path in a non-existent directory → appendFile will fail.
  _setTelemetryForTests({ enabled: true, path: "/tmp/this-dir-does-not-exist-xyz/log.jsonl" });
  // Should NOT throw.
  await logTelemetry({ event: "tool_call", tool: "foo" });
  await logCoerce("test:key");
  _setTelemetryForTests({ enabled: false, path: null });
});

test("telemetry: ordering preserved across awaited calls", async () => {
  const path = setupTempLog();
  try {
    for (let i = 0; i < 10; i++) {
      await logCoerce(`expand:test-${i}`, { idx: i });
    }
    const lines = readLines(path);
    assert.equal(lines.length, 10);
    for (let i = 0; i < 10; i++) {
      assert.equal(lines[i].key, `expand:test-${i}`);
      assert.equal(lines[i].idx, i);
    }
  } finally {
    _setTelemetryForTests({ enabled: false, path: null });
    if (existsSync(path)) unlinkSync(path);
  }
});

test("telemetry: isTelemetryEnabled() reflects override state", () => {
  _setTelemetryForTests({ enabled: false, path: null });
  assert.equal(isTelemetryEnabled(), false);
  _setTelemetryForTests({ enabled: true, path: "/tmp/test.jsonl" });
  assert.equal(isTelemetryEnabled(), true);
  assert.equal(getTelemetryLogPath(), "/tmp/test.jsonl");
  _setTelemetryForTests({ enabled: false, path: null });
});

// ─── v2.7.5 — WEBSTUDIO_MCP_TELEMETRY_PATH env override ───────────────────

test("v2.7.5 — telemetry path override doc comment present in module source", () => {
  // The module documents WEBSTUDIO_MCP_TELEMETRY_PATH at the top + uses
  // it in the init expression. Light source-grep guards against accidental
  // removal during future refactors. Full path resolution can't be exercised
  // from a single test process because env vars are read at module-import
  // time (before this test file runs).
  const src = readFileSync(resolve(here, "../dist/lib/telemetry.js"), "utf8");
  assert.match(src, /WEBSTUDIO_MCP_TELEMETRY_PATH/);
});
