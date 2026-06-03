// Unit tests for buildUpdateTextTransaction:
//   - childIndex correctly targets the Nth text/expression child (skipping non-text children like <strong>)
//   - multiple updates on the same instanceId are merged into ONE cumulative patch (no clobber)
//   - idempotent no-ops are skipped
//   - out-of-range childIndex and unknown instanceId fail loudly without crashing the batch

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUpdateTextTransaction } from "../dist/tools/update-instance-text.js";

function makeBuild() {
  // Paragraph with: text[0] "AAA " + <strong> "BOLD" + text[1] " BBB " + <strong> "BOLD2" + text[2] " CCC"
  return {
    instances: [
      {
        id: "p1",
        component: "ws:element",
        tag: "p",
        label: "intro",
        children: [
          { type: "text", value: "AAA " },
          { type: "id", value: "s1" },
          { type: "text", value: " BBB " },
          { type: "id", value: "s2" },
          { type: "text", value: " CCC" },
        ],
      },
      { id: "s1", component: "ws:element", tag: "strong", children: [{ type: "text", value: "BOLD" }] },
      { id: "s2", component: "ws:element", tag: "strong", children: [{ type: "text", value: "BOLD2" }] },
    ],
  };
}

test("childIndex targets the Nth text/expression child, skipping non-text siblings", () => {
  const r = buildUpdateTextTransaction(makeBuild(), [
    { instanceId: "p1", text: "NEW MIDDLE ", childIndex: 1 },
  ]);
  assert.equal(r.patchCount, 1);
  const patch = r.transaction.payload[0].patches[0];
  assert.equal(patch.op, "replace");
  assert.deepEqual(patch.path, ["p1", "children"]);
  // text[0] untouched, strong intact, text[1] updated, strong intact, text[2] untouched
  assert.equal(patch.value[0].type, "text");
  assert.equal(patch.value[0].value, "AAA ");
  assert.equal(patch.value[1].type, "id");
  assert.equal(patch.value[2].value, "NEW MIDDLE ");
  assert.equal(patch.value[3].type, "id");
  assert.equal(patch.value[4].value, " CCC");
});

test("multiple updates on the same instanceId merge into ONE patch (no clobber)", () => {
  // This is the race-condition regression that was hit live in production 2026-05-19.
  const r = buildUpdateTextTransaction(makeBuild(), [
    { instanceId: "p1", text: "NEW START ", childIndex: 0 },
    { instanceId: "p1", text: " NEW MID ", childIndex: 1 },
    { instanceId: "p1", text: " NEW END", childIndex: 2 },
  ]);
  assert.equal(r.patchCount, 1, "expected ONE merged patch, not three competing ones");
  const patch = r.transaction.payload[0].patches[0];
  assert.equal(patch.value[0].value, "NEW START ");
  assert.equal(patch.value[2].value, " NEW MID ");
  assert.equal(patch.value[4].value, " NEW END");
  // strong children must be preserved
  assert.equal(patch.value[1].type, "id");
  assert.equal(patch.value[1].value, "s1");
  assert.equal(patch.value[3].value, "s2");
});

test("updates on different instanceIds stay independent", () => {
  const r = buildUpdateTextTransaction(makeBuild(), [
    { instanceId: "p1", text: "NEW ", childIndex: 0 },
    { instanceId: "s1", text: "NEWBOLD", childIndex: 0 },
  ]);
  assert.equal(r.patchCount, 2);
  const paths = r.transaction.payload[0].patches.map((p) => p.path[0]);
  assert.deepEqual(paths.sort(), ["p1", "s1"]);
});

test("no-op when new text equals existing", () => {
  const r = buildUpdateTextTransaction(makeBuild(), [
    { instanceId: "p1", text: "AAA ", childIndex: 0 },
  ]);
  assert.equal(r.patchCount, 0);
  assert.ok(r.details.some((d) => d.startsWith("=")));
});

test("out-of-range childIndex fails loudly without crashing the batch", () => {
  const r = buildUpdateTextTransaction(makeBuild(), [
    { instanceId: "p1", text: "NEW", childIndex: 99 },
    { instanceId: "p1", text: "OK", childIndex: 0 },
  ]);
  assert.equal(r.patchCount, 1, "the valid update should still go through");
  assert.ok(r.details.some((d) => d.includes("out of range")));
});

test("unknown instanceId is reported but does not abort the batch", () => {
  const r = buildUpdateTextTransaction(makeBuild(), [
    { instanceId: "ghost", text: "NEW" },
    { instanceId: "p1", text: "OK", childIndex: 0 },
  ]);
  assert.equal(r.patchCount, 1);
  assert.ok(r.details.some((d) => d.includes("instance not found")));
});

test("expression mode wraps the new child as type=expression", () => {
  const r = buildUpdateTextTransaction(makeBuild(), [
    { instanceId: "p1", text: "$ws$dataSource$abc", childIndex: 0, mode: "expression" },
  ]);
  assert.equal(r.patchCount, 1);
  const patch = r.transaction.payload[0].patches[0];
  assert.equal(patch.value[0].type, "expression");
  assert.equal(patch.value[0].value, "$ws$dataSource$abc");
});

// ─── BUG #1 fix (prod template-acme 2026-05-20) ───────────────────────────
// update_text used to refuse instances with no existing text/expression child.
// Now it auto-creates the child instead (so an empty <a>/<button> created via
// instances.append can be labelled without a <span> wrapper).

function makeEmptyLinkBuild() {
  return {
    instances: [
      { id: "a1", component: "ws:element", tag: "a", label: "cat_motos_link", children: [] },
    ],
  };
}

function makeLinkWithIconBuild() {
  // <a><svg/></a> — has 1 id child, zero text children. The user wants to add a label.
  return {
    instances: [
      { id: "a1", component: "ws:element", tag: "a", label: "Card CTA", children: [{ type: "id", value: "svg1" }] },
      { id: "svg1", component: "ws:element", tag: "svg", children: [] },
    ],
  };
}

test("BUG#1: empty instance + mode=text creates a text child instead of failing", () => {
  const r = buildUpdateTextTransaction(makeEmptyLinkBuild(), [
    { instanceId: "a1", text: "Voir nos motos", mode: "text" },
  ]);
  assert.equal(r.patchCount, 1, "should produce a patch, not reject");
  const patch = r.transaction.payload[0].patches[0];
  assert.deepEqual(patch.path, ["a1", "children"]);
  assert.equal(patch.value.length, 1);
  assert.equal(patch.value[0].type, "text");
  assert.equal(patch.value[0].value, "Voir nos motos");
  assert.ok(r.details.some((d) => d.startsWith("+") && d.includes("created")));
});

test("BUG#1: empty instance + mode=expression creates an expression child", () => {
  const r = buildUpdateTextTransaction(makeEmptyLinkBuild(), [
    { instanceId: "a1", text: "$ws$dataSource$xyz.label", mode: "expression" },
  ]);
  assert.equal(r.patchCount, 1);
  const patch = r.transaction.payload[0].patches[0];
  assert.equal(patch.value[0].type, "expression");
  assert.equal(patch.value[0].value, "$ws$dataSource$xyz.label");
});

test("BUG#1: instance with only id children gets the text child appended (siblings preserved)", () => {
  const r = buildUpdateTextTransaction(makeLinkWithIconBuild(), [
    { instanceId: "a1", text: "Label", mode: "text" },
  ]);
  assert.equal(r.patchCount, 1);
  const patch = r.transaction.payload[0].patches[0];
  assert.equal(patch.value.length, 2, "svg child preserved + new text appended");
  assert.equal(patch.value[0].type, "id");
  assert.equal(patch.value[0].value, "svg1");
  assert.equal(patch.value[1].type, "text");
  assert.equal(patch.value[1].value, "Label");
});

test("BUG#1: idempotent — re-running with same text finds the just-created child and no-ops", () => {
  // Simulate: 1st call creates the child, 2nd call sees it and skips.
  const buildAfterFirstCall = {
    instances: [
      { id: "a1", component: "ws:element", tag: "a", label: "cat_motos_link", children: [{ type: "text", value: "Hello" }] },
    ],
  };
  const r = buildUpdateTextTransaction(buildAfterFirstCall, [
    { instanceId: "a1", text: "Hello", mode: "text" },
  ]);
  assert.equal(r.patchCount, 0, "second identical call must be a no-op");
  assert.ok(r.details.some((d) => d.startsWith("=")));
});

test("BUG#1: childIndex > 0 on empty instance is rejected (only index 0 creates)", () => {
  const r = buildUpdateTextTransaction(makeEmptyLinkBuild(), [
    { instanceId: "a1", text: "X", childIndex: 2, mode: "text" },
  ]);
  assert.equal(r.patchCount, 0);
  assert.ok(r.details.some((d) => d.includes("out of range")));
});
