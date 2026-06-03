// Unit tests for WordPress adapter config parsing.
// We don't hit a real WP instance — we just verify pickSite() / config branching
// by mocking the config-loading via a temp file.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const CFG_DIR = join(homedir(), ".webstudio-mcp", "cms");
const CFG_PATH = join(CFG_DIR, "wordpress.json");
let backup;

async function writeConfig(content) {
  await mkdir(CFG_DIR, { recursive: true });
  await writeFile(CFG_PATH, content, "utf-8");
}

async function loadAdapter(siteName) {
  // Bust module cache so loadWordPressConfig() re-reads the file each test.
  const url = `../dist/lib/cms-adapters/wordpress.js?_=${Date.now()}`;
  const { getWordPressAdapter } = await import(url);
  return getWordPressAdapter(siteName);
}

before(async () => {
  // Backup any existing config so we don't trash a real one.
  try {
    const { readFile } = await import("node:fs/promises");
    backup = await readFile(CFG_PATH, "utf-8");
  } catch { backup = null; }
});

after(async () => {
  if (backup !== null) await writeFile(CFG_PATH, backup, "utf-8");
  else await rm(CFG_PATH, { force: true }).catch(() => {});
});

test("WordPress single-site config — bare 'wordpress' works", async () => {
  await writeConfig(JSON.stringify({
    baseUrl: "https://example.com",
    username: "admin",
    appPassword: "xxxx xxxx xxxx xxxx",
  }));
  const adapter = await loadAdapter(undefined);
  assert.equal(adapter.name, "wordpress");
});

test("WordPress single-site config — refuses named source", async () => {
  await writeConfig(JSON.stringify({
    baseUrl: "https://example.com",
    username: "admin",
    appPassword: "xxxx",
  }));
  await assert.rejects(
    () => loadAdapter("crs"),
    /single-site format but source "wordpress:crs"/,
  );
});

test("WordPress multi-site config — single entry, no name → picks default", async () => {
  await writeConfig(JSON.stringify({
    sites: { crs: { baseUrl: "https://crs.com", username: "admin", appPassword: "xxxx" } },
  }));
  const adapter = await loadAdapter(undefined);
  assert.equal(adapter.name, "wordpress:crs");
});

test("WordPress multi-site config — multi entries, no name → refuses", async () => {
  await writeConfig(JSON.stringify({
    sites: {
      crs: { baseUrl: "https://crs.com", username: "u", appPassword: "p" },
      "dealer-1": { baseUrl: "https://d1.com", username: "u", appPassword: "p" },
    },
  }));
  await assert.rejects(
    () => loadAdapter(undefined),
    /defines multiple sites — pass a named source/,
  );
});

test("WordPress multi-site config — named source resolves", async () => {
  await writeConfig(JSON.stringify({
    sites: {
      crs: { baseUrl: "https://crs.com", username: "u", appPassword: "p" },
      "dealer-1": { baseUrl: "https://d1.com", username: "u", appPassword: "p" },
    },
  }));
  const adapter = await loadAdapter("dealer-1");
  assert.equal(adapter.name, "wordpress:dealer-1");
});

test("WordPress multi-site config — unknown name → clear error", async () => {
  await writeConfig(JSON.stringify({
    sites: {
      crs: { baseUrl: "https://crs.com", username: "u", appPassword: "p" },
    },
  }));
  await assert.rejects(
    () => loadAdapter("ghost"),
    /no site named "ghost"\. Available: crs/,
  );
});

test("WordPress resourceUrl follows REST convention", async () => {
  await writeConfig(JSON.stringify({
    baseUrl: "https://crs.com/",
    username: "u",
    appPassword: "p",
  }));
  const adapter = await loadAdapter(undefined);
  assert.equal(adapter.resourceUrl("posts"), "https://crs.com/wp-json/wp/v2/posts");
});
