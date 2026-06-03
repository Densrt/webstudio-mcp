#!/usr/bin/env node
// Analyze ~/.webstudio-mcp-telemetry.jsonl — per-tool call counts, success rates,
// dead-tool candidates (no call ≥ 4 weeks), AND server-side silent coercions
// emitted by lib/expand-shorthand.ts / style-coerce.ts (v2.7.4+).
//
// Telemetry capture is set up in src/lib/telemetry.ts. Two event families:
//   • event:"tool_call"  { ts, tool, args_keys, success, duration_ms, error_class }
//   • event:"coerce"     { ts, key, source, projectSlug?, ...extra }
//
// The coerce report surfaces "what does the model keep getting wrong" — high-
// count keys = places where descriptions/patterns/handshake instructions are
// failing to educate the caller and the server is silently cleaning up. Use
// the report to prioritise pattern docs, description rewrites, or new detectors.
//
// Run: node scripts/telemetry-report.mjs
// Run with custom file: node scripts/telemetry-report.mjs --file=/path/to/log.jsonl
// Filter to coerces only: node scripts/telemetry-report.mjs --coerce-only
// Top N coerces (default 20): node scripts/telemetry-report.mjs --top=10

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const argFile = process.argv.find((a) => a.startsWith("--file="))?.slice(7);
const argTop = process.argv.find((a) => a.startsWith("--top="))?.slice(6);
const COERCE_ONLY = process.argv.includes("--coerce-only");
const TOP_N = argTop ? parseInt(argTop, 10) : 20;
const DEFAULT_PATH = join(homedir(), ".webstudio-mcp-telemetry.jsonl");
const LOG_PATH = argFile ?? DEFAULT_PATH;

const FOUR_WEEKS_MS = 28 * 24 * 60 * 60 * 1000;
const EIGHT_WEEKS_MS = 56 * 24 * 60 * 60 * 1000;

if (!existsSync(LOG_PATH)) {
  console.log(`No telemetry log found at ${LOG_PATH}`);
  console.log("");
  console.log("To enable telemetry, set the env var:");
  console.log("  export WEBSTUDIO_MCP_TELEMETRY=1");
  console.log("");
  console.log("Each tool call appends one JSON line to ~/.webstudio-mcp-telemetry.jsonl.");
  process.exit(0);
}

const raw = readFileSync(LOG_PATH, "utf8");
const lines = raw.split("\n").filter((l) => l.trim().length > 0);

const entries = [];
for (const line of lines) {
  try { entries.push(JSON.parse(line)); }
  catch { /* skip malformed */ }
}

if (entries.length === 0) {
  console.log(`Telemetry log at ${LOG_PATH} is empty.`);
  process.exit(0);
}

const now = Date.now();

// Split events into tool_call (legacy + explicit) and coerce.
// Pre-v2.7.4 events lack an explicit `event` field — they're tool_calls by
// convention (they have `tool` set). Newer events always carry `event`.
const toolCallEvents = entries.filter((e) => (e.event === "tool_call" || (!e.event && e.tool)));
const coerceEvents = entries.filter((e) => e.event === "coerce");

const byTool = new Map();
for (const e of toolCallEvents) {
  if (!e.tool) continue;
  const cur = byTool.get(e.tool) ?? { calls: 0, success: 0, fail: 0, totalMs: 0, lastTs: 0, firstTs: Infinity };
  cur.calls++;
  if (e.success === true) cur.success++;
  else cur.fail++;
  cur.totalMs += (e.duration_ms ?? 0);
  const ts = Date.parse(e.ts);
  if (Number.isFinite(ts)) {
    if (ts > cur.lastTs) cur.lastTs = ts;
    if (ts < cur.firstTs) cur.firstTs = ts;
  }
  byTool.set(e.tool, cur);
}

const tools = [...byTool.entries()].map(([tool, s]) => ({
  tool,
  ...s,
  avgMs: s.calls ? Math.round(s.totalMs / s.calls) : 0,
  successRate: s.calls ? (s.success / s.calls) : 0,
  daysSinceLast: s.lastTs ? Math.floor((now - s.lastTs) / (24 * 60 * 60 * 1000)) : Infinity,
}));

console.log(`=== Webstudio MCP — Telemetry report ===`);
console.log(`Source: ${LOG_PATH}`);
console.log(`Total events: ${entries.length}  (tool_call: ${toolCallEvents.length}, coerce: ${coerceEvents.length})`);
if (!COERCE_ONLY) {
  console.log(`Unique tools called: ${tools.length}`);
  if (tools.length > 0) {
    console.log(`Range: ${new Date(Math.min(...tools.map(t => t.firstTs))).toISOString()} → ${new Date(Math.max(...tools.map(t => t.lastTs))).toISOString()}`);
  }
}
console.log("");

if (!COERCE_ONLY) {
  // Top 10 most-called
  console.log("Top 10 most-called tools:");
  const topCalled = [...tools].sort((a, b) => b.calls - a.calls).slice(0, 10);
  for (const t of topCalled) {
    console.log(`  ${String(t.calls).padStart(5)}  ${(t.successRate * 100).toFixed(0).padStart(3)}% ok  ${String(t.avgMs).padStart(5)}ms avg  ${t.tool}`);
  }
  console.log("");
}

if (!COERCE_ONLY) {
  // Tools with low success rate (potential redesign candidates)
  const lowSuccess = tools.filter((t) => t.calls >= 5 && t.successRate < 0.7);
  if (lowSuccess.length) {
    console.log("⚠️  Tools with success rate < 70% (≥5 calls):");
    for (const t of lowSuccess.sort((a, b) => a.successRate - b.successRate)) {
      console.log(`  ${(t.successRate * 100).toFixed(0)}% — ${t.tool} (${t.calls} calls, ${t.fail} failures)`);
    }
    console.log("");
  }

  // Dead tools (no call ≥ 4 weeks)
  const dead4w = tools.filter((t) => t.daysSinceLast >= 28);
  if (dead4w.length) {
    console.log("💤  Tools unused ≥ 4 weeks (sunset candidates):");
    for (const t of dead4w.sort((a, b) => b.daysSinceLast - a.daysSinceLast)) {
      console.log(`  ${t.daysSinceLast}d — ${t.tool} (${t.calls} historical calls)`);
    }
    console.log("");
  }

  // 8-week danger zone
  const dead8w = tools.filter((t) => t.daysSinceLast >= 56);
  if (dead8w.length) {
    console.log("⛔ Tools unused ≥ 8 weeks (per charter §5, candidates for removal):");
    for (const t of dead8w) {
      console.log(`  ${t.daysSinceLast}d — ${t.tool}`);
    }
    console.log("");
  }

  // Tools in manifest never called (read from src/index.ts mega-tool registry, v1.0)
  try {
    const { loadToolNames } = await import("./lib/load-tool-names.mjs");
    const registered = [...loadToolNames()];
    const calledSet = new Set(tools.map((t) => t.tool));
    const neverCalled = registered.filter((r) => !calledSet.has(r));
    if (neverCalled.length) {
      console.log(`📭 Tools registered but never called (${neverCalled.length}/${registered.length}):`);
      for (const t of neverCalled) console.log(`  ${t}`);
      console.log("");
    }
  } catch (e) {
    // best-effort, fail silently
  }
}

// ─── Coerce events (v2.7.4+) — what does the model keep getting wrong? ────
//
// Each coerce event represents a silent server-side normalisation that the
// caller would otherwise have invisible behavior on (e.g. gridColumn shortcut
// rewritten to longhands, aspectRatio "16/9" rewritten to "16 / 9"). High
// counts = signal that a pattern doc, a tool description, or the handshake
// instructions aren't reaching the caller. Use as priority list for the next
// iteration of MCP improvements.

if (coerceEvents.length > 0) {
  const byKey = new Map();
  for (const e of coerceEvents) {
    if (!e.key) continue;
    const cur = byKey.get(e.key) ?? { count: 0, lastTs: 0, sources: new Set(), projects: new Set() };
    cur.count++;
    if (e.source) cur.sources.add(e.source);
    if (e.projectSlug) cur.projects.add(e.projectSlug);
    const ts = Date.parse(e.ts);
    if (Number.isFinite(ts) && ts > cur.lastTs) cur.lastTs = ts;
    byKey.set(e.key, cur);
  }

  const sorted = [...byKey.entries()]
    .map(([key, s]) => ({
      key,
      count: s.count,
      sources: [...s.sources].join(", "),
      projects: [...s.projects].join(", "),
      daysSinceLast: s.lastTs ? Math.floor((now - s.lastTs) / (24 * 60 * 60 * 1000)) : Infinity,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_N);

  console.log(`Top ${sorted.length} silent coercions emitted by the server:`);
  console.log("  (high count = pattern docs / descriptions / handshake aren't educating the caller well enough)");
  console.log("");
  for (const e of sorted) {
    const proj = e.projects ? ` projects: ${e.projects}` : "";
    const days = e.daysSinceLast === Infinity ? "?" : `${e.daysSinceLast}d ago`;
    console.log(`  ${String(e.count).padStart(5)}× ${e.key.padEnd(40)} (last: ${days}, source: ${e.sources}${proj})`);
  }
  console.log("");
} else if (COERCE_ONLY) {
  console.log("No coerce events in the log yet (need WEBSTUDIO_MCP_TELEMETRY=1 + v2.7.4+ server).");
}
