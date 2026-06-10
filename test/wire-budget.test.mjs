// v2.14.1 — wire-budget regression guard.
//
// v2.12.0 cut the tools/list handshake from 228 831 chars (~57k tokens) to
// ~103k chars (~26k tokens). Nothing protected that gain: any fat new action
// description or schema metadata would silently regress it. This test spawns
// the REAL server over stdio, measures the actual tools/list payload, and
// fails above the budget.
//
// Budget: 120 000 chars (~30k tokens) — headroom for a few new actions while
// staying far below the pre-v2.12.0 weight. If you hit it legitimately, slim
// the offending descriptions first (see pattern wire-schema-economy); raising
// the budget is the LAST resort and must be argued in the PR.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const WIRE_BUDGET_CHARS = 120_000;

function fetchToolsList() {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", ["dist/index.js"], { stdio: ["pipe", "pipe", "ignore"] });
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("MCP server did not answer tools/list within 15s"));
    }, 15_000);
    let buf = "";
    const send = (obj) => proc.stdin.write(JSON.stringify(obj) + "\n");
    proc.stdout.on("data", (d) => {
      buf += d.toString();
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 1) {
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
        }
        if (msg.id === 2) {
          clearTimeout(timer);
          proc.kill();
          resolve(msg.result);
        }
      }
    });
    proc.on("error", (e) => { clearTimeout(timer); reject(e); });
    send({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "wire-budget-test", version: "1.0" } },
    });
  });
}

test("tools/list stays under the wire budget and ships no xActions", async () => {
  const result = await fetchToolsList();
  assert.ok(Array.isArray(result.tools) && result.tools.length >= 10, "tool list looks wrong");

  const payloadChars = JSON.stringify(result).length;
  const perTool = result.tools
    .map((t) => ({ name: t.name, chars: JSON.stringify(t).length }))
    .sort((a, b) => b.chars - a.chars);
  const top = perTool.slice(0, 3).map((t) => `${t.name}=${t.chars}`).join(", ");

  assert.ok(
    payloadChars <= WIRE_BUDGET_CHARS,
    `tools/list payload is ${payloadChars} chars > budget ${WIRE_BUDGET_CHARS}. ` +
      `Fattest tools: ${top}. Slim the offending descriptions (pattern wire-schema-economy) before raising the budget.`,
  );

  for (const t of result.tools) {
    assert.ok(!("xActions" in (t.inputSchema ?? {})), `tool "${t.name}" leaks xActions on the wire (v2.12.0 regression)`);
  }
});
