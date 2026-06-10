// v2.17.0 — wire-schema structural dedupe ($defs/$ref hoisting).
//
// The build tool carried ~29k chars of pure structure (StyleValue & friends
// inlined at every use site by zod-to-json-schema). dedupeSchemaDefs hoists
// repeated schema subtrees into $defs at the wire boundary. Correctness
// pinned here: position-awareness (properties maps and default/const data
// must NEVER become $refs) + lossless round-trip.

import { test } from "node:test";
import assert from "node:assert/strict";

import { dedupeSchemaDefs } from "../dist/lib/schema-dedupe.js";
import { toWireToolDefinition } from "../dist/lib/mega-tool.js";
import { buildTool } from "../dist/tools/build-mega.js";

// A fat repeated leaf schema (>150 chars thanks to the long description).
const fatLeaf = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["unparsed", "keyword", "unit", "rgb", "fontFamily", "var", "layers", "tuple"] },
    value: { type: "string", description: "x".repeat(80) },
  },
  required: ["type", "value"],
  additionalProperties: false,
};

/** Resolve every {$ref:"#/$defs/x"} back inline for round-trip comparison. */
function inline(node, defs) {
  if (Array.isArray(node)) return node.map((n) => inline(n, defs));
  if (typeof node !== "object" || node === null) return node;
  if (typeof node.$ref === "string" && node.$ref.startsWith("#/$defs/")) {
    return inline(defs[node.$ref.slice("#/$defs/".length)], defs);
  }
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "$defs") continue;
    out[k] = inline(v, defs);
  }
  return out;
}

test("repeated schema subtrees are hoisted, round-trip is lossless", () => {
  const schema = {
    type: "object",
    properties: {
      a: { type: "array", items: fatLeaf },
      b: { type: "array", items: fatLeaf },
      c: fatLeaf,
    },
    required: ["a"],
    additionalProperties: false,
  };
  const out = dedupeSchemaDefs(schema);
  assert.ok(out.$defs, "$defs expected");
  const json = JSON.stringify(out);
  assert.ok(json.length < JSON.stringify(schema).length, "deduped schema must be smaller");
  assert.ok(json.includes('"$ref":"#/$defs/'), "refs expected");
  // Lossless: inlining the refs reproduces the original schema.
  assert.deepEqual(inline(out, out.$defs), schema);
});

test("position-aware: a properties MAP whose shape repeats is never hoisted", () => {
  // Two schemas with identical properties MAPS — the maps must not become $refs
  // (only the schema objects containing them may).
  const props = {
    type: { type: "string", description: "discriminator ".repeat(10) },
    value: { type: "string", description: "payload ".repeat(10) },
  };
  const schema = {
    type: "object",
    properties: {
      x: { type: "object", properties: props, required: ["type"], additionalProperties: false },
      y: { type: "object", properties: { ...props, extra: { type: "number" } }, additionalProperties: false },
    },
  };
  const out = dedupeSchemaDefs(schema);
  // The shared MAP shape appears twice but only as keyword maps — walk the
  // output: no "properties" key may hold a $ref.
  const check = (n) => {
    if (typeof n !== "object" || n === null) return;
    if (!Array.isArray(n) && n.properties) {
      assert.ok(!n.properties.$ref, "properties map must never be a $ref");
    }
    for (const v of Array.isArray(n) ? n : Object.values(n)) check(v);
  };
  check(out);
});

test("data positions: a default's inner object is never independently hoisted", () => {
  // The SCHEMA node containing the default may legitimately be hoisted as a
  // whole — but the default value itself must stay a plain object (a $ref
  // inside `default` would be data corruption, not schema compression).
  const fatDefault = { kind: "x".repeat(200), nested: { deep: true } };
  const schema = {
    type: "object",
    properties: {
      a: { type: "object", default: fatDefault },
      b: { type: "object", default: fatDefault },
      // a third occurrence of the bare data shape in another data position
      c: { type: "object", const: fatDefault },
    },
  };
  const out = dedupeSchemaDefs(schema);
  const walk = (n, inData) => {
    if (typeof n !== "object" || n === null) return;
    if (!Array.isArray(n)) {
      if (inData) assert.ok(!n.$ref, "data subtree must never contain an injected $ref");
      for (const [k, v] of Object.entries(n)) walk(v, inData || k === "default" || k === "const" || k === "enum");
      return;
    }
    for (const v of n) walk(v, inData);
  };
  walk(out, false);
  // And the round-trip stays lossless.
  assert.deepEqual(inline(out, out.$defs ?? {}), schema);
});

test("schemas with nothing repeated come back untouched (same reference)", () => {
  const schema = { type: "object", properties: { a: { type: "string" } } };
  assert.equal(dedupeSchemaDefs(schema), schema);
});

test("real build tool: wire schema shrinks and stays ref-resolvable", () => {
  const wire = toWireToolDefinition(buildTool.definition);
  const inMemory = JSON.stringify(buildTool.definition.inputSchema).length;
  const onWire = JSON.stringify(wire.inputSchema).length;
  assert.ok(onWire < inMemory * 0.75, `expected ≥25% shrink, got ${inMemory} → ${onWire}`);
  // Every $ref must resolve inside the schema's own $defs.
  const defs = wire.inputSchema.$defs ?? {};
  const refs = [...JSON.stringify(wire.inputSchema).matchAll(/"\$ref":"#\/\$defs\/([^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 0, "refs expected on the build tool");
  for (const r of refs) assert.ok(defs[r], `dangling $ref #/$defs/${r}`);
  // In-memory definition untouched.
  assert.equal(buildTool.definition.inputSchema.$defs, undefined);
});

test("toWireToolDefinition is cached (same reference on repeated calls)", () => {
  assert.equal(toWireToolDefinition(buildTool.definition), toWireToolDefinition(buildTool.definition));
});
