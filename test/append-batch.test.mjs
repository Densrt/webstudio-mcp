// v2.16.0 — instances.append batch form (children[]).
//
// Appending N simple children used to cost N MCP calls (one fetch + one push
// each). The batch form lands them all in ONE transaction with a single
// parent.children replace. Single form normalises to a 1-entry batch.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildAppendChanges, appendChildInputSchema } from "../dist/tools/append-child.js";

const makeBuild = () => ({
  instances: [
    { id: "parent", component: "Box", children: [{ type: "id", value: "existing" }] },
    { id: "existing", component: "Box", children: [] },
  ],
  styleSources: [{ type: "token", id: "tok-h2", name: "Heading 2" }],
});

test("batch: N children → one transaction, one parent.children replace, order preserved", () => {
  const r = buildAppendChanges(makeBuild(), {
    parentInstanceId: "parent",
    children: [
      { tag: "a", text: "Accueil" },
      { tag: "a", text: "Occasions" },
      { tag: "a", text: "Contact" },
    ],
  });
  assert.equal(r.newInstanceIds.length, 3);
  const inst = r.changes.find((c) => c.namespace === "instances");
  // 3 adds + exactly 1 parent.children replace
  assert.equal(inst.patches.filter((p) => p.op === "add").length, 3);
  const replaces = inst.patches.filter((p) => p.op === "replace");
  assert.equal(replaces.length, 1);
  const childIds = replaces[0].value.filter((c) => c.type === "id").map((c) => c.value);
  assert.deepEqual(childIds, ["existing", ...r.newInstanceIds], "batch appended at the end, in input order");
});

test("batch: insertIndex inserts the children consecutively at that position", () => {
  const r = buildAppendChanges(makeBuild(), {
    parentInstanceId: "parent",
    children: [{ tag: "p", text: "one" }, { tag: "p", text: "two" }],
    insertIndex: 0,
  });
  const replace = r.changes[0].patches.find((p) => p.op === "replace");
  const ids = replace.value.map((c) => c.value);
  assert.deepEqual(ids, [...r.newInstanceIds, "existing"]);
});

test("batch: per-child tokenName + top-level default component", () => {
  const r = buildAppendChanges(makeBuild(), {
    parentInstanceId: "parent",
    defaultComponent: "ws:element",
    children: [
      { tag: "h2", text: "Titre", tokenName: "Heading 2" },
      { tag: "p", text: "Body", component: "Text" },
    ],
  });
  const adds = r.changes[0].patches.filter((p) => p.op === "add");
  assert.equal(adds[0].value.component, "ws:element");
  assert.equal(adds[1].value.component, "Text");
  const sel = r.changes.find((c) => c.namespace === "styleSourceSelections");
  assert.equal(sel.patches.length, 1, "only the tokened child gets a selection");
  assert.deepEqual(sel.patches[0].value.values, ["tok-h2"]);
});

test("batch: unknown token throws (whole transaction refused, no partial state)", () => {
  assert.throws(
    () => buildAppendChanges(makeBuild(), { parentInstanceId: "parent", children: [{ tag: "p", tokenName: "Nope" }] }),
    /Token not found/,
  );
});

test("schema: tag XOR children enforced, top-level text forbidden with children", () => {
  const base = { projectSlug: "p", parentInstanceId: "x" };
  assert.equal(appendChildInputSchema.safeParse({ ...base, tag: "p" }).success, true);
  assert.equal(appendChildInputSchema.safeParse({ ...base, children: [{ tag: "p" }] }).success, true);
  assert.equal(appendChildInputSchema.safeParse({ ...base }).success, false);
  assert.equal(appendChildInputSchema.safeParse({ ...base, tag: "p", children: [{ tag: "p" }] }).success, false);
  assert.equal(appendChildInputSchema.safeParse({ ...base, children: [{ tag: "p" }], text: "no" }).success, false);
});
