// v2.14.0 — bounded responses + structuredContent.
//
// Audit 2026-06-10: tokens.list_tokens_cloud and audit.page could return
// unbounded payloads on big projects (500KB+). v2.14.0 adds `limit` (tokens,
// default 200) and `maxChars` (audit.page, default 40 000), plus MCP
// structuredContent on styles.get_decls' JSON mode.

import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "response-bounds-"));
process.env.WEBSTUDIO_PROJECTS_DIR = tmpRoot;

const { listTokensCloudTool } = await import("../dist/tools/list-tokens-cloud.js");
const { truncateAuditReport } = await import("../dist/tools/audit-page.js");
const { getDeclsTool } = await import("../dist/tools/get-decls.js");
const { invalidateBuildCache } = await import("../dist/webstudio-client.js");

const slug = "boundsproj";
const projDir = path.join(tmpRoot, slug);
fs.mkdirSync(projDir, { recursive: true });
fs.writeFileSync(path.join(projDir, "webstudio-auth.json"), JSON.stringify({
  projectId: "pb", cookie: "ck", csrfToken: "csrf", appVersion: "1", allowPush: false,
}));

const makeBuild = (tokenCount) => ({
  id: "b", projectId: "pb", version: 1,
  pages: { homePageId: "h", rootFolderId: "r", pages: [], folders: [] },
  breakpoints: [{ id: "bp", label: "Base" }],
  instances: [{ id: "root", component: "Box", children: [] }],
  props: [], styles: [], styleSourceSelections: [], dataSources: [], resources: [], assets: [],
  styleSources: Array.from({ length: tokenCount }, (_, i) => ({
    type: "token", id: `tok-${i}`, name: `brand-token-${String(i).padStart(3, "0")}`,
  })),
});

const originalFetch = globalThis.fetch;
function mockFetch(build) {
  invalidateBuildCache();
  globalThis.fetch = async (url) => {
    if (String(url).includes("/rest/data/")) {
      return new Response(JSON.stringify(build), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
}

// ── tokens.list_tokens_cloud limit ──────────────────────────────────────────

test("list_tokens_cloud: default limit 200 truncates with a footer", async () => {
  mockFetch(makeBuild(250));
  try {
    const r = await listTokensCloudTool.handler({ projectSlug: slug });
    assert.notEqual(r.isError, true, r.content?.[0]?.text);
    const text = r.content[0].text;
    assert.match(text, /Total: 250/);
    assert.match(text, /\[truncated: 200\/250 rows/);
    assert.doesNotMatch(text, /brand-token-249/);
  } finally { globalThis.fetch = originalFetch; }
});

test("list_tokens_cloud: explicit limit applies, no footer when everything fits", async () => {
  mockFetch(makeBuild(10));
  try {
    const r = await listTokensCloudTool.handler({ projectSlug: slug, limit: 5 });
    assert.match(r.content[0].text, /\[truncated: 5\/10 rows/);

    mockFetch(makeBuild(10));
    const full = await listTokensCloudTool.handler({ projectSlug: slug, limit: 100 });
    assert.doesNotMatch(full.content[0].text, /truncated/);
  } finally { globalThis.fetch = originalFetch; }
});

// ── audit.page truncateAuditReport (pure) ───────────────────────────────────

test("truncateAuditReport: passthrough under the cap", () => {
  assert.equal(truncateAuditReport("short report", 1000), "short report");
});

test("truncateAuditReport: cuts at the last line boundary + appends the note", () => {
  const report = Array.from({ length: 200 }, (_, i) => `line ${i} — some finding`).join("\n");
  const out = truncateAuditReport(report, 1000);
  assert.ok(out.length < report.length);
  const body = out.split("\n\n[truncated:")[0];
  assert.ok(body.length <= 1000, "body must respect the cap");
  assert.ok(!body.endsWith("some find"), "no mid-line cut");
  assert.match(out, /\[truncated: \d+ chars > maxChars=1000/);
  assert.match(out, /audit\.overflow/);
});

// ── styles.get_decls structuredContent ──────────────────────────────────────

test("get_decls json mode: structuredContent mirrors the text payload", async () => {
  mockFetch(makeBuild(0));
  try {
    const r = await getDeclsTool.handler({ projectSlug: slug, instanceIds: ["root"], json: true });
    assert.notEqual(r.isError, true, r.content?.[0]?.text);
    assert.ok(r.structuredContent, "structuredContent expected in json mode");
    assert.equal(r.structuredContent.projectSlug, slug);
    assert.deepEqual(JSON.parse(r.content[0].text), r.structuredContent);
  } finally { globalThis.fetch = originalFetch; }
});
