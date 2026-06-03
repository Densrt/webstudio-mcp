#!/usr/bin/env node
// List tools unused ≥ 8 weeks per the design charter §5 sunset policy.
// Reads ~/.webstudio-mcp-telemetry.jsonl + src/index.ts (mega-tool registry).
//
// Exits 0 always (informational). Output is empty if no candidates.

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadToolNames } from "./lib/load-tool-names.mjs";

const LOG_PATH = join(homedir(), ".webstudio-mcp-telemetry.jsonl");
const EIGHT_WEEKS_MS = 56 * 24 * 60 * 60 * 1000;

if (!existsSync(LOG_PATH)) {
  console.log("No telemetry available. Cannot identify sunset candidates.");
  console.log("Enable telemetry first: WEBSTUDIO_MCP_TELEMETRY=1");
  process.exit(0);
}

const registered = [...loadToolNames()];

const raw = readFileSync(LOG_PATH, "utf8");
const now = Date.now();
const lastCall = new Map();

for (const line of raw.split("\n")) {
  if (!line.trim()) continue;
  try {
    const e = JSON.parse(line);
    if (!e.tool || !e.ts) continue;
    const ts = Date.parse(e.ts);
    if (!Number.isFinite(ts)) continue;
    if (!lastCall.has(e.tool) || lastCall.get(e.tool) < ts) {
      lastCall.set(e.tool, ts);
    }
  } catch { /* skip */ }
}

const candidates = [];
for (const tool of registered) {
  const last = lastCall.get(tool);
  if (!last) {
    candidates.push({ tool, status: "never_called", daysSinceLast: Infinity });
    continue;
  }
  const days = Math.floor((now - last) / (24 * 60 * 60 * 1000));
  if (days >= 56) {
    candidates.push({ tool, status: "unused_8w", daysSinceLast: days });
  }
}

if (candidates.length === 0) {
  console.log("✓ No sunset candidates. All registered tools called within last 8 weeks.");
  process.exit(0);
}

console.log(`=== Sunset candidates (${candidates.length}) ===`);
console.log(`Generated: ${new Date().toISOString()}`);
console.log("");
console.log("Per design charter §5, tools unused ≥ 8 weeks should be evaluated for");
console.log("removal. Review each below and decide: keep / deprecate / remove.");
console.log("");

const neverCalled = candidates.filter((c) => c.status === "never_called");
const unused8w = candidates.filter((c) => c.status === "unused_8w");

if (neverCalled.length) {
  console.log(`Never called (${neverCalled.length}):`);
  for (const c of neverCalled) {
    console.log(`  📭 ${c.tool}`);
  }
  console.log("");
}

if (unused8w.length) {
  console.log(`Unused ≥ 8 weeks (${unused8w.length}):`);
  for (const c of unused8w.sort((a, b) => b.daysSinceLast - a.daysSinceLast)) {
    console.log(`  💤 ${String(c.daysSinceLast).padStart(4)}d — ${c.tool}`);
  }
  console.log("");
}

console.log("Next steps:");
console.log("  1. Validate the telemetry log covers a representative period.");
console.log("  2. For each candidate: confirm it's not part of a planned but unreleased feature.");
console.log("  3. Mark for deprecation in next minor release (add @deprecated comment, keep tool).");
console.log("  4. Remove in the release after, per charter §3.2.");
