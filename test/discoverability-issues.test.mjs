// Tests for issues #1 + #2 on Densrt/webstudio-mcp — discoverability.
//
// Issue #2: meta.list_patterns enumerates docs/patterns/*.md, meta.index appends
// a footer with the pattern count + categories.
// Issue #1: styles mega-tool gains a read action (get_decls), the inspect target
// "instance" appends a hint pointing to get_decls, and the server constructor
// passes `instructions` to the MCP handshake.

import { test } from "node:test";
import assert from "node:assert/strict";

import { stylesMegaTool } from "../dist/tools/styles-mega.js";
import { getDeclsTool } from "../dist/tools/get-decls.js";
import { inspectInstanceTool } from "../dist/tools/inspect-instance.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// makeMetaTool requires a getToolsList closure — we feed it a tiny fake registry
// so the catalog/footer logic still runs. The point of these tests is the meta-tool's
// own logic, not the full registry.
import { makeMetaTool } from "../dist/tools/meta-mega.js";

const here = dirname(fileURLToPath(import.meta.url));

const fakeTools = () => [
  { definition: { name: "alpha", description: "A — first tool", inputSchema: { xActions: [{ action: "x", description: "do x" }] } } },
  { definition: { name: "beta", description: "B — second tool", inputSchema: {} } },
];

// ─── Issue #2 ────────────────────────────────────────────────────────────────

test("issue#2 — meta exposes list_patterns action in its xActions", () => {
  const meta = makeMetaTool(fakeTools);
  const xActions = meta.definition.inputSchema.xActions ?? [];
  const actions = xActions.map((a) => a.action);
  assert.ok(actions.includes("list_patterns"), `expected list_patterns in actions, got: ${actions.join(",")}`);
  assert.ok(actions.includes("index"));
  assert.ok(actions.includes("describe_pattern"));
});

test("issue#2 — meta.list_patterns returns the pattern catalog", async () => {
  const meta = makeMetaTool(fakeTools);
  const r = await meta.handler({ action: "list_patterns", label: "discover-patterns" });
  assert.equal(r.isError, undefined, `expected no error, got: ${r.content[0].text}`);
  const txt = r.content[0].text;
  assert.match(txt, /# Pattern recipes \(\d+\)/);
  // Spot-check a few well-known slugs.
  assert.match(txt, /\*\*sheet-mobile-radix\*\*/);
  assert.match(txt, /\*\*inline-bg-image-overlay\*\*/);
  assert.match(txt, /\*\*swiper-carousel\*\*/);
  // Should also mention the MCP-resource URI form.
  assert.match(txt, /webstudio:\/\/patterns\/<slug>/);
});

test("issue#2 — meta.list_patterns with filter narrows results", async () => {
  const meta = makeMetaTool(fakeTools);
  const r = await meta.handler({ action: "list_patterns", label: "find-sheet", filter: "sheet" });
  assert.equal(r.isError, undefined);
  const txt = r.content[0].text;
  assert.match(txt, /matching "sheet"/);
  assert.match(txt, /\*\*sheet-mobile-radix\*\*/);
  // Unrelated pattern should not appear.
  assert.doesNotMatch(txt, /\*\*swiper-carousel\*\*/);
});

test("issue#2 — meta.list_patterns with no-match filter returns hint", async () => {
  const meta = makeMetaTool(fakeTools);
  const r = await meta.handler({ action: "list_patterns", label: "no-match", filter: "zzzz-not-a-real-slug" });
  assert.equal(r.isError, undefined);
  assert.match(r.content[0].text, /No pattern matched/);
});

test("issue#2 — meta.index appends a footer cross-referencing the patterns", async () => {
  const meta = makeMetaTool(fakeTools);
  const r = await meta.handler({ action: "index", label: "discover" });
  assert.equal(r.isError, undefined);
  const txt = r.content[0].text;
  // Body still lists the fake tools.
  assert.match(txt, /\*\*alpha\*\*/);
  // Footer mentions patterns count + cross-refs to list_patterns / resources.
  assert.match(txt, /pattern recipes available/);
  assert.match(txt, /meta\.list_patterns/);
  assert.match(txt, /webstudio:\/\/patterns/);
});

// ─── Issue #1 — A: styles.get_decls ──────────────────────────────────────────

test("issue#1A — styles mega-tool advertises a get_decls action", () => {
  const xActions = stylesMegaTool.definition.inputSchema.xActions ?? [];
  const actions = xActions.map((a) => a.action);
  assert.ok(actions.includes("get_decls"), `expected get_decls in actions, got: ${actions.join(",")}`);
  // The other write actions must still be there.
  assert.ok(actions.includes("update"));
  assert.ok(actions.includes("delete_decl"));
  assert.ok(actions.includes("replace_value"));
});

test("issue#1A — styles.get_decls description nudges toward read-before-mutate", () => {
  const xActions = stylesMegaTool.definition.inputSchema.xActions ?? [];
  const getDecls = xActions.find((a) => a.action === "get_decls");
  assert.ok(getDecls);
  assert.match(getDecls.description, /READ effective/i);
  assert.match(getDecls.description, /BEFORE mutating/i);
});

test("issue#1A — get_decls handler rejects missing instance selector", async () => {
  const r = await getDeclsTool.handler({ projectSlug: "my-site" });
  assert.equal(r.isError, true);
  const payload = JSON.parse(r.content[0].text);
  assert.equal(payload.code, "VALIDATION_FAILED");
  assert.match(payload.message, /instanceIds|labelContains/);
});

test("issue#1A — get_decls validates schema (rejects unknown extra field)", async () => {
  const r = await getDeclsTool.handler({ projectSlug: "my-site", instanceIds: ["a"], bogus: 1 });
  assert.equal(r.isError, true);
  const payload = JSON.parse(r.content[0].text);
  assert.equal(payload.code, "VALIDATION_FAILED");
});

// ─── Issue #1 — B: inspect-instance hint ─────────────────────────────────────

test("issue#1B — inspect-instance source lists get_decls in its hint copy", () => {
  // The hint string is a static `\n\n[hint] ...` block in inspect-instance.ts.
  // Read the compiled source to assert it stayed in place after refactors.
  const src = readFileSync(resolve(here, "../dist/tools/inspect-instance.js"), "utf8");
  assert.match(src, /\[hint\]/);
  assert.match(src, /styles\.get_decls/);
  assert.match(src, /project\.export/);
});

// ─── Issue #1 — C: MCP instructions at handshake ─────────────────────────────

test("issue#1C — index.js passes `instructions` to the Server constructor", () => {
  const src = readFileSync(resolve(here, "../dist/index.js"), "utf8");
  assert.match(src, /instructions:/);
  assert.match(src, /SERVER_INSTRUCTIONS/);
  // Sanity-check a couple of the rule keywords show up in the instruction string.
  assert.match(src, /styles\.get_decls/);
  assert.match(src, /meta\.list_patterns/);
});

// ─── v2.7.0 — meta.guide (single-shot triage) ────────────────────────────────

test("v2.7 — meta exposes guide action in xActions", () => {
  const meta = makeMetaTool(fakeTools);
  const xActions = meta.definition.inputSchema.xActions ?? [];
  const actions = xActions.map((a) => a.action);
  assert.ok(actions.includes("guide"), `expected guide in actions, got: ${actions.join(",")}`);
  // Existing actions still registered.
  assert.ok(actions.includes("index"));
  assert.ok(actions.includes("list_patterns"));
  assert.ok(actions.includes("describe_pattern"));
  assert.ok(actions.includes("get_more_tools"));
});

test("v2.7 — guide description points at it as the single entry point", () => {
  const meta = makeMetaTool(fakeTools);
  const xActions = meta.definition.inputSchema.xActions ?? [];
  const guide = xActions.find((a) => a.action === "guide");
  assert.ok(guide);
  assert.match(guide.description, /SINGLE-SHOT/i);
  assert.match(guide.description, /BM25/);
  assert.match(guide.description, /pattern/i);
});

test("v2.7 — guide rejects missing brief", async () => {
  const meta = makeMetaTool(fakeTools);
  const r = await meta.handler({ action: "guide", label: "no-brief" });
  assert.equal(r.isError, true);
  const payload = JSON.parse(r.content[0].text);
  assert.equal(payload.code, "VALIDATION_FAILED");
});

test("v2.7 — guide finds navigation-menu-radix + maps to create_navigation_menu", async () => {
  const meta = makeMetaTool(fakeTools);
  const r = await meta.handler({
    action: "guide",
    label: "find-nav",
    brief: "desktop mega menu with chevron rotation",
  });
  assert.equal(r.isError, undefined, `expected no error, got: ${r.content[0].text}`);
  const txt = r.content[0].text;
  assert.match(txt, /\[PATTERN\]/);
  assert.match(txt, /navigation-menu-radix/);
  assert.match(txt, /build\.create_navigation_menu/);
  // Next-step footer present.
  assert.match(txt, /Next step/);
});

test("v2.7 — guide finds sheet-mobile-radix + maps to create_sheet", async () => {
  const meta = makeMetaTool(fakeTools);
  const r = await meta.handler({
    action: "guide",
    label: "find-sheet",
    brief: "mobile burger drawer with collapsibles",
  });
  assert.equal(r.isError, undefined);
  const txt = r.content[0].text;
  assert.match(txt, /sheet-mobile-radix/);
  assert.match(txt, /build\.create_sheet/);
});

test("v2.7 — guide includeTools:false drops tool xActions from corpus header", async () => {
  const meta = makeMetaTool(fakeTools);
  const r = await meta.handler({
    action: "guide",
    label: "patterns-only",
    brief: "background image overlay",
    includeTools: false,
  });
  assert.equal(r.isError, undefined);
  const txt = r.content[0].text;
  // Header should NOT mention "tool xActions" when includeTools is false.
  assert.doesNotMatch(txt, /tool xActions/);
  // But patterns should still be searched + ranked.
  assert.match(txt, /pattern/i);
});

test("v2.7 — guide footer recommends high-level tools over push_fragment", async () => {
  const meta = makeMetaTool(fakeTools);
  const r = await meta.handler({
    action: "guide",
    label: "footer-check",
    brief: "image background hero with gradient overlay",
  });
  assert.equal(r.isError, undefined);
  const txt = r.content[0].text;
  assert.match(txt, /push_fragment/);
  // Footer mentions at least one high-level tool by name.
  assert.match(txt, /create_sheet|create_navigation_menu|bind_collection_to_instance|push_complete/);
});

test("v2.7 — handshake rule #1 promotes meta.guide as entry point", () => {
  const src = readFileSync(resolve(here, "../dist/index.js"), "utf8");
  assert.match(src, /meta\.guide/);
  // Version bumped to at least 2.7.0 — parsed via semver to keep the test stable across future minors.
  const m = src.match(/SERVER_VERSION = "(\d+)\.(\d+)\.(\d+)"/);
  assert.ok(m, "SERVER_VERSION declaration not found in built index.js");
  const [, majS, minS] = m;
  const maj = Number(majS);
  const min = Number(minS);
  assert.ok(maj > 2 || (maj === 2 && min >= 7), `expected SERVER_VERSION ≥ 2.7.0, got ${m[0]}`);
});

test("v2.7 — package.json version is at least 2.7.0", () => {
  const pkg = JSON.parse(readFileSync(resolve(here, "../package.json"), "utf8"));
  const [maj, min] = pkg.version.split(".").map(Number);
  assert.ok(maj > 2 || (maj === 2 && min >= 7), `expected ≥ 2.7.0, got ${pkg.version}`);
});

// ─── v2.7.1 — frontmatter migration (recommendedTool / recommendedToolNote) ──

import { listPatternResources } from "../dist/resources.js";

test("v2.7.1 — every pattern declares a recommendedTool in its frontmatter", () => {
  const patterns = listPatternResources();
  assert.ok(patterns.length > 0, "no patterns loaded — check docs/patterns/");
  const missing = patterns.filter((p) => !p.recommendedTool || p.recommendedTool.trim().length === 0);
  assert.equal(
    missing.length,
    0,
    `patterns missing recommendedTool in frontmatter: ${missing.map((p) => p.slug).join(", ")}`,
  );
});

test("v2.7.1 — recommendedToolNote is optional but recommended", () => {
  // Soft check — patterns without a note should be rare (only reference-style docs).
  const patterns = listPatternResources();
  const noteCount = patterns.filter((p) => p.recommendedToolNote && p.recommendedToolNote.trim().length > 0).length;
  assert.ok(noteCount >= patterns.length * 0.8, `expected ≥80% of patterns to carry a recommendedToolNote, got ${noteCount}/${patterns.length}`);
});

test("v2.7.1 — guide output reads recommendedTool from frontmatter (navigation-menu-radix)", async () => {
  const meta = makeMetaTool(fakeTools);
  const r = await meta.handler({
    action: "guide",
    label: "fm-check",
    brief: "desktop mega menu with chevron rotation",
  });
  assert.equal(r.isError, undefined);
  const txt = r.content[0].text;
  // The exact note string lives in docs/patterns/navigation-menu-radix.md frontmatter.
  assert.match(txt, /build\.create_navigation_menu/);
  assert.match(txt, /one-call desktop mega menu/);
});

test("v2.7.1 — PATTERN_TO_TOOL constant has been removed from meta-mega.ts source", () => {
  const src = readFileSync(resolve(here, "../dist/tools/meta-mega.js"), "utf8");
  // The constant declaration must be gone. The handler now reads p.recommendedTool from the
  // pattern resource directly. A grep on "PATTERN_TO_TOOL" should miss in the compiled JS.
  assert.doesNotMatch(src, /PATTERN_TO_TOOL\s*=/);
});
