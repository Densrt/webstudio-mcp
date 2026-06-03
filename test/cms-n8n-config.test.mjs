// Unit tests for n8n adapter config parsing.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const CFG_DIR = join(homedir(), ".webstudio-mcp", "cms");
const CFG_PATH = join(CFG_DIR, "n8n.json");
let backup;

async function writeConfig(content) {
  await mkdir(CFG_DIR, { recursive: true });
  await writeFile(CFG_PATH, content, "utf-8");
}

async function loadAdapter(instanceName) {
  const url = `../dist/lib/cms-adapters/n8n.js?_=${Date.now()}`;
  const { getN8nAdapter } = await import(url);
  return getN8nAdapter(instanceName);
}

before(async () => {
  try {
    const { readFile } = await import("node:fs/promises");
    backup = await readFile(CFG_PATH, "utf-8");
  } catch { backup = null; }
});

after(async () => {
  if (backup !== null) await writeFile(CFG_PATH, backup, "utf-8");
  else await rm(CFG_PATH, { force: true }).catch(() => {});
});

test("n8n single-instance config — bare 'n8n' works", async () => {
  await writeConfig(JSON.stringify({
    baseUrl: "https://n8n.example.com",
    apiKey: "abc",
  }));
  const adapter = await loadAdapter(undefined);
  assert.equal(adapter.name, "n8n");
});

test("n8n single-instance config — refuses named source", async () => {
  await writeConfig(JSON.stringify({ baseUrl: "https://n8n.example.com", apiKey: "abc" }));
  await assert.rejects(
    () => loadAdapter("prod"),
    /single-instance format but source "n8n:prod"/,
  );
});

test("n8n multi-instance — single entry, no name → picks default", async () => {
  await writeConfig(JSON.stringify({
    instances: { prod: { baseUrl: "https://n8n-prod.com", apiKey: "k1" } },
  }));
  const adapter = await loadAdapter(undefined);
  assert.equal(adapter.name, "n8n:prod");
});

test("n8n multi-instance — multiple, no name → refuses", async () => {
  await writeConfig(JSON.stringify({
    instances: {
      prod: { baseUrl: "https://n8n-prod.com", apiKey: "k1" },
      staging: { baseUrl: "https://n8n-staging.com", apiKey: "k2" },
    },
  }));
  await assert.rejects(
    () => loadAdapter(undefined),
    /defines multiple instances — pass a named source/,
  );
});

test("n8n multi-instance — named source resolves", async () => {
  await writeConfig(JSON.stringify({
    instances: {
      prod: { baseUrl: "https://n8n-prod.com", apiKey: "k1" },
      staging: { baseUrl: "https://n8n-staging.com", apiKey: "k2" },
    },
  }));
  const adapter = await loadAdapter("staging");
  assert.equal(adapter.name, "n8n:staging");
});

test("n8n resourceUrl follows webhook convention", async () => {
  await writeConfig(JSON.stringify({ baseUrl: "https://n8n.example.com/", apiKey: "k" }));
  const adapter = await loadAdapter(undefined);
  assert.equal(adapter.resourceUrl("my-workflow"), "https://n8n.example.com/webhook/my-workflow");
});

test("n8n updateItem is not supported", async () => {
  await writeConfig(JSON.stringify({ baseUrl: "https://n8n.example.com", apiKey: "k" }));
  const adapter = await loadAdapter(undefined);
  await assert.rejects(
    () => adapter.updateItem("wf", "1", {}),
    /executions are immutable/,
  );
});
