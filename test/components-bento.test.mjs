// Unit tests for components/bento.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { FragmentBuilder } from "../dist/builder.js";
import { addBento } from "../dist/components/bento.js";

function build(opts) {
  const b = new FragmentBuilder();
  const r = addBento(b, opts);
  return { fragment: b.build()["@webstudio/instance/v0.1"], result: r };
}

test("throws when items array is empty", () => {
  const b = new FragmentBuilder();
  assert.throws(() => addBento(b, { items: [] }), /at least one item/);
});

test("creates 1 grid container + N card instances", () => {
  const { fragment, result } = build({
    items: [{ label: "A" }, { label: "B" }, { label: "C" }],
  });
  // 1 grid + 3 cards
  assert.equal(fragment.instances.length, 4);
  assert.equal(result.cardIds.length, 3);
  // The grid is the parent (top-level child of the fragment root)
  assert.ok(fragment.instances.find((i) => i.id === result.gridId));
  for (const cid of result.cardIds) {
    assert.ok(fragment.instances.find((i) => i.id === cid));
  }
});

test("grid uses display:grid + provided columns/rows/gap", () => {
  const { fragment, result } = build({
    items: [{ label: "X" }],
    columns: "repeat(3, 1fr)",
    rows: "auto",
    gapPx: 24,
  });
  const gridStyles = fragment.styles.filter((s) => s.instanceId ? false : true);
  // styles are keyed by styleSourceId in the build output, but addStyles
  // attaches local — easier: just look at the props/styles list for the grid id.
  // We assert via the rendered fragment's styles array.
  const styles = fragment.styles;
  const gridProps = styles.filter((s) => s.styleSourceId === result.gridStyleSourceId
    || styles.find((x) => x.styleSourceId === s.styleSourceId)
  );
  // Simpler: just check that "repeat(3, 1fr)" appears in the styles JSON.
  const json = JSON.stringify(fragment);
  assert.match(json, /repeat\(3, 1fr\)/);
  assert.match(json, /"display":"keyword","value":"grid"|"value":"grid"/);
  assert.match(json, /"value":24,"unit":"px"/);
});

test("each card gets its grid-column / grid-row from item config", () => {
  const { fragment } = build({
    items: [
      { col: "1 / 3", row: 2 },
      { col: 2, row: "1 / 4" },
    ],
  });
  const json = JSON.stringify(fragment);
  // Since v2.7.2, gridColumn/gridRow shortcuts are auto-expanded to the 4
  // longhands gridColumnStart/End/gridRowStart/End so the Webstudio Grid Child
  // Manual panel can read + edit them. See pattern grid-child-placement.
  // First card: col "1 / 3" → gridColumnStart=1, gridColumnEnd=3 ; row 2 → gridRowStart=2, gridRowEnd=3
  assert.match(json, /"gridColumnStart","value":\{"type":"unit","value":1,"unit":"number"\}/);
  assert.match(json, /"gridColumnEnd","value":\{"type":"unit","value":3,"unit":"number"\}/);
  // Second card: col 2 → gridColumnStart=2, gridColumnEnd=3 ; row "1 / 4" → gridRowStart=1, gridRowEnd=4
  assert.match(json, /"gridRowEnd","value":\{"type":"unit","value":4,"unit":"number"\}/);
});

test("item.bg renders a backgroundColor on the card", () => {
  const { fragment } = build({
    items: [{ bg: "#ff0000" }],
  });
  // hex normalized to rgb floats — just check that a backgroundColor entry exists
  const json = JSON.stringify(fragment);
  assert.match(json, /backgroundColor/);
});

test("item.text adds a text child to the card", () => {
  const { fragment, result } = build({
    items: [{ text: "Hello" }],
  });
  const card = fragment.instances.find((i) => i.id === result.cardIds[0]);
  assert.deepEqual(card.children, [{ type: "text", value: "Hello" }]);
});

test("default mobile breakpoint adds responsive override on grid + cards", () => {
  const { fragment } = build({
    items: [{ label: "A" }, { label: "B" }],
  });
  // The override styles target the "Mobile portrait" breakpoint label →
  // since the default FragmentBuilder doesn't have that breakpoint resolved
  // out of the box, it remains as the label string in the breakpointId.
  const json = JSON.stringify(fragment);
  // 1fr grid override is present
  assert.match(json, /"value":"1fr"/);
});

test("mobileBreakpointLabel=null skips responsive overrides entirely", () => {
  const { fragment } = build({
    items: [{ label: "A" }],
    mobileBreakpointLabel: null,
  });
  const json = JSON.stringify(fragment);
  assert.doesNotMatch(json, /"value":"1fr"(?!,)/); // no naked 1fr override
});

test("minHeightPx=0 omits the container minHeight", () => {
  const { fragment } = build({
    items: [{ label: "A" }],
    minHeightPx: 0,
  });
  const json = JSON.stringify(fragment);
  // No "value":540,"unit":"px" leftover from default
  assert.doesNotMatch(json, /"value":540,"unit":"px"/);
});

test("respects id prefix when provided", () => {
  const { result } = build({
    id: "myproj-bento",
    items: [{ label: "A" }, { label: "B" }],
  });
  assert.equal(result.gridId, "myproj-bento-grid");
  assert.equal(result.cardIds[0], "myproj-bento-card-0");
  assert.equal(result.cardIds[1], "myproj-bento-card-1");
});
