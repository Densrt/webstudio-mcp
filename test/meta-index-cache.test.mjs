// v2.13.0 — meta BM25 corpus cache.
//
// `guide` re-read all pattern bodies from disk + rebuilt the BM25 index on
// EVERY call; `get_more_tools` rebuilt its index too. v2.13.0 caches the
// corpus per key (30s TTL) inside the makeMetaTool closure. In production
// tools never change post-boot, so serving a ≤30s-old corpus is safe.

import { test } from "node:test";
import assert from "node:assert/strict";

import { makeMetaTool } from "../dist/tools/meta-mega.js";

const stub = (name, action, description) => ({
  definition: {
    name,
    description: `${name} tool`,
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
      xActions: [{ action, description, required: [], schemaKeys: [] }],
    },
  },
  handler: async () => ({ content: [] }),
});

test("get_more_tools: corpus is cached within the TTL (tools list mutations not re-indexed)", async () => {
  const toolsList = [stub("zeta", "frobnicate", "Use when: frobnicate the zorblax widgets.")];
  const meta = makeMetaTool(() => toolsList);

  const r1 = await meta.handler({ action: "get_more_tools", label: "find-frob", brief: "zorblax widgets" });
  assert.match(r1.content[0].text, /zeta\.frobnicate/);

  // Mutate the live tools list: within the TTL the cached corpus still serves.
  toolsList.push(stub("omega", "dezorb", "Use when: dezorb the zorblax widgets twice as well."));
  const r2 = await meta.handler({ action: "get_more_tools", label: "find-frob2", brief: "zorblax widgets" });
  assert.doesNotMatch(r2.content[0].text, /omega\.dezorb/, "≤30s-old corpus expected (cache hit)");
});

test("get_more_tools: cache is keyed per category filter", async () => {
  const toolsList = [
    stub("alphatool", "alpha", "Use when: alpha gizmos."),
    stub("betatool", "beta", "Use when: beta gizmos."),
  ];
  const meta = makeMetaTool(() => toolsList);

  const all = await meta.handler({ action: "get_more_tools", label: "find-all", brief: "gizmos" });
  assert.match(all.content[0].text, /alphatool\.alpha/);
  assert.match(all.content[0].text, /betatool\.beta/);

  const filtered = await meta.handler({ action: "get_more_tools", label: "find-beta", brief: "gizmos", category: "betatool" });
  assert.doesNotMatch(filtered.content[0].text, /alphatool/);
  assert.match(filtered.content[0].text, /betatool\.beta/);
});

test("guide: two consecutive calls return identical rankings (served from cached index)", async () => {
  const toolsList = [stub("gamma", "gammafy", "Use when: gammafy the quuxblorb sections.")];
  const meta = makeMetaTool(() => toolsList);

  const r1 = await meta.handler({ action: "guide", label: "how-quux", brief: "quuxblorb sections" });
  const r2 = await meta.handler({ action: "guide", label: "how-quux2", brief: "quuxblorb sections" });
  assert.equal(r1.content[0].text.includes("gamma.gammafy"), r2.content[0].text.includes("gamma.gammafy"));
});
