// Unit tests for the BM25 ranker (lib/bm25.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize, buildIndex, search } from "../dist/lib/bm25.js";

test("tokenize: drops short tokens + stopwords", () => {
  const t = tokenize("the quick brown fox over a lazy dog");
  // 'the', 'a' dropped as stopwords; 'fox' (3 chars) kept; 'over' kept
  assert.ok(t.includes("quick"));
  assert.ok(t.includes("brown"));
  assert.ok(t.includes("fox"));
  assert.ok(!t.includes("the"));
  assert.ok(!t.includes("a"));
});

test("tokenize: lowercase normalization", () => {
  const t = tokenize("UPPER lower MiXeD");
  assert.deepEqual(t.sort(), ["lower", "mixed", "upper"]);
});

test("tokenize: empty / non-text returns empty array", () => {
  assert.deepEqual(tokenize(""), []);
  assert.deepEqual(tokenize("!!!"), []);
});

test("buildIndex: handles empty docs", () => {
  const idx = buildIndex([]);
  assert.equal(idx.totalDocs, 0);
  assert.equal(idx.avgDocLen, 0);
});

test("search: returns ranked results", () => {
  const docs = [
    { payload: "doc1", text: "tokens cleanup orphan locals" },
    { payload: "doc2", text: "delete unused tokens project wide rebrand" },
    { payload: "doc3", text: "create page navigation menu sheet mobile" },
    { payload: "doc4", text: "audit overflow images fonts scripts" },
  ];
  const idx = buildIndex(docs);
  const results = search(idx, "clean unused tokens");
  assert.ok(results.length > 0);
  // doc1 and doc2 should rank highest (both contain "tokens")
  const topPayloads = results.map((r) => r.payload);
  assert.ok(topPayloads.includes("doc1") || topPayloads.includes("doc2"));
  // doc4 should be absent (no overlap)
  assert.ok(!topPayloads.includes("doc4"));
});

test("search: scores higher for rare terms (IDF effect)", () => {
  // Build a corpus where "common" appears in every doc but "rare" appears once
  const docs = [
    { payload: "rare-doc", text: "rare unique special term inside document body once" },
    { payload: "common1", text: "common common common common common common common common" },
    { payload: "common2", text: "common term filler more common words common words filler" },
    { payload: "common3", text: "common stuff common stuff common stuff common stuff common" },
  ];
  const idx = buildIndex(docs);
  // Query with both terms — IDF should weight 'rare' higher
  const results = search(idx, "rare common");
  assert.equal(results[0].payload, "rare-doc", "doc with rare term should rank first");
});

test("search: respects topN limit", () => {
  const docs = Array.from({ length: 20 }, (_, i) => ({
    payload: `doc${i}`,
    text: `target keyword document number ${i}`,
  }));
  const idx = buildIndex(docs);
  const results = search(idx, "target keyword document", 3);
  assert.equal(results.length, 3);
});

test("search: empty query returns []", () => {
  const idx = buildIndex([{ payload: "x", text: "some text" }]);
  assert.deepEqual(search(idx, ""), []);
});

test("search: no overlap returns []", () => {
  const idx = buildIndex([{ payload: "x", text: "completely different words here" }]);
  const results = search(idx, "octopus banana");
  assert.equal(results.length, 0);
});

test("search: French stopwords filtered", () => {
  const t = tokenize("le chat est sur la table avec une banane");
  // 'le', 'la', 'est', 'sur', 'avec', 'une' dropped
  assert.ok(t.includes("chat"));
  assert.ok(t.includes("table"));
  assert.ok(t.includes("banane"));
  assert.ok(!t.includes("le"));
  assert.ok(!t.includes("est"));
});
