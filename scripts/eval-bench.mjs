#!/usr/bin/env node
// Real eval bench — calls Anthropic API with the MCP tool definitions and the
// prompt, then checks which tool the model selects. Scores against expectedTool /
// acceptableTools / pitfallTools.
//
// Requires:
//   - ANTHROPIC_API_KEY env var
//   - The MCP must be built (npm run build)
//   - prompts in test/eval/prompts.json
//
// Output: tasks/eval-<date>.md
//
// Cost: ~$0.50 for the 30 prompts (Claude Sonnet 4.7, no tool_use cycle, just selection).
// Run: node scripts/eval-bench.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadToolNames } from "./lib/load-tool-names.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PROMPTS_PATH = join(here, "..", "test/eval/prompts.json");
const TOOLS_DIR = join(here, "..", "src/tools");
const OUT_PATH = join(here, "..", `tasks/eval-${new Date().toISOString().slice(0, 10)}.md`);

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error("ERROR: ANTHROPIC_API_KEY env var required.");
  console.error("Run with: ANTHROPIC_API_KEY=sk-ant-... node scripts/eval-bench.mjs");
  process.exit(1);
}

const MODEL = process.env.EVAL_MODEL ?? "claude-sonnet-4-5-20250929";

// Parse tool definitions
import { readdirSync } from "node:fs";
function findTs(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findTs(p));
    else if (entry.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

const registered = loadToolNames();
// Warn if prompts.json still references v0.4 atomic tool names
const samplePrompts = JSON.parse(readFileSync(PROMPTS_PATH, "utf8")).prompts.slice(0, 5);
if (samplePrompts.some((p) => (p.expectedTool || "").startsWith("webstudio_"))) {
  console.warn("⚠️  prompts.json still uses v0.4 atomic names (webstudio_*). Eval will be inaccurate.");
  console.warn("   TODO: regen prompts.json for v1.0 mega-tools (pages, build, tokens, ...).\n");
}

const definitions = new Map();
for (const file of findTs(TOOLS_DIR)) {
  const src = readFileSync(file, "utf8");
  const re = /name:\s*"(webstudio_[a-z_]+)"[\s\S]*?description:\s*`([\s\S]*?)`[\s\S]*?inputSchema:\s*(\{[\s\S]*?\n\s*\})\s*,/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (registered.has(m[1])) {
      definitions.set(m[1], {
        name: m[1],
        description: m[2],
        // Note: inputSchema is parsed as TS object literal — for the eval we only need name+description anyway
      });
    }
  }
}

console.log(`Eval bench — model: ${MODEL}`);
console.log(`Tools available: ${definitions.size}`);
console.log(`Prompts to evaluate: 30`);
console.log("");

const { prompts } = JSON.parse(readFileSync(PROMPTS_PATH, "utf8"));
const results = [];

async function callClaude(prompt) {
  // Build a simple tool catalog message (no real tool_use because we just want the
  // model's selection — calling the actual tool would require a Webstudio account)
  const tools = [...definitions.values()].map((d) => ({
    name: d.name,
    description: d.description,
    input_schema: { type: "object", properties: { _stub: { type: "string" } } },
  }));

  const body = {
    model: MODEL,
    max_tokens: 1024,
    tools,
    tool_choice: { type: "any" },
    messages: [{
      role: "user",
      content: `${prompt.prompt}\n\n(Pick the most appropriate tool. Reply via tool_use only — args can be stubs.)`,
    }],
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const toolUse = data.content?.find((b) => b.type === "tool_use");
  return toolUse?.name ?? null;
}

for (const prompt of prompts) {
  process.stdout.write(`${prompt.id}... `);
  try {
    const chosen = await callClaude(prompt);
    const expected = prompt.expectedTool;
    const acceptable = prompt.acceptableTools ?? [];
    const pitfalls = prompt.pitfallTools ?? [];

    let score = 0;
    let verdict = "fail";
    if (chosen === expected) { score = 1; verdict = "exact"; }
    else if (acceptable.includes(chosen)) { score = 0.75; verdict = "acceptable"; }
    else if (pitfalls.includes(chosen)) { score = -0.5; verdict = "pitfall"; }

    results.push({ id: prompt.id, category: prompt.category, expected, chosen, verdict, score });
    console.log(`${verdict} (${chosen})`);
  } catch (e) {
    results.push({ id: prompt.id, error: e.message });
    console.log(`ERROR ${e.message.slice(0, 80)}`);
  }
}

// Report
const total = results.filter((r) => !r.error).length;
const exact = results.filter((r) => r.verdict === "exact").length;
const acceptable = results.filter((r) => r.verdict === "acceptable").length;
const pitfall = results.filter((r) => r.verdict === "pitfall").length;
const fail = results.filter((r) => r.verdict === "fail").length;
const errored = results.filter((r) => r.error).length;
const totalScore = results.reduce((a, r) => a + (r.score ?? 0), 0);
const maxScore = total;
const pct = total > 0 ? Math.round(100 * totalScore / maxScore) : 0;

console.log("");
console.log(`=== Eval results ===`);
console.log(`Score: ${totalScore}/${maxScore} (${pct}%)`);
console.log(`Exact: ${exact}, Acceptable: ${acceptable}, Pitfall: ${pitfall}, Fail: ${fail}, Errored: ${errored}`);

// Markdown report
const lines = [];
lines.push(`# Eval bench — ${new Date().toISOString().slice(0, 10)}`);
lines.push("");
lines.push(`**Model**: ${MODEL}`);
lines.push(`**Tools available**: ${definitions.size}`);
lines.push(`**Prompts**: ${prompts.length}`);
lines.push("");
lines.push(`## Score`);
lines.push("");
lines.push(`**${totalScore}/${maxScore} = ${pct}%**`);
lines.push("");
lines.push(`| Verdict | Count |`);
lines.push(`|---|---|`);
lines.push(`| Exact | ${exact} |`);
lines.push(`| Acceptable | ${acceptable} |`);
lines.push(`| Pitfall (penalty) | ${pitfall} |`);
lines.push(`| Fail | ${fail} |`);
lines.push(`| Errored | ${errored} |`);
lines.push("");
lines.push(`## Per-prompt results`);
lines.push("");
lines.push(`| ID | Category | Expected | Chosen | Verdict |`);
lines.push(`|---|---|---|---|---|`);
for (const r of results) {
  if (r.error) {
    lines.push(`| ${r.id} | - | - | - | ERROR: ${r.error.slice(0, 60)} |`);
  } else {
    lines.push(`| ${r.id} | ${r.category} | ${r.expected} | ${r.chosen ?? "(none)"} | ${r.verdict} |`);
  }
}
writeFileSync(OUT_PATH, lines.join("\n"));
console.log(`Report: ${OUT_PATH}`);
