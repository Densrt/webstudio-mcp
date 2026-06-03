// Coverage for the radix-trigger-pollution audit kind scanner.
// Tests the pure functions (scanInstance, findFirstRenderingChild) against
// in-memory mock builds — no auth / fetch / push involved.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scanInstance,
  findFirstRenderingChild,
} from "../dist/tools/audit-radix-trigger-pollution.js";

const RADIX = "@webstudio-is/sdk-components-react-radix:";

/** Tiny WebstudioBuild stub with just the fields our scanner reads. */
function mockBuild({ instances = [], props = [], styleSourceSelections = [] } = {}) {
  return { instances, props, styleSourceSelections };
}

test("scanInstance returns null for a clean wrapper (no polluted props, no styles)", () => {
  const trigger = {
    id: "trig", component: `${RADIX}DialogTrigger`, label: "trigger",
    children: [{ type: "id", value: "btn" }],
  };
  const button = { id: "btn", component: "Button", label: "burger", children: [] };
  const b = mockBuild({
    instances: [trigger, button],
    props: [
      { instanceId: "trig", name: "aria-label", value: "Open menu" },
      { instanceId: "trig", name: "data-ws-show", value: true },
    ],
  });
  assert.equal(scanInstance(b, trigger), null);
});

test("scanInstance flags a DialogTrigger carrying a class prop", () => {
  const trigger = {
    id: "trig", component: `${RADIX}DialogTrigger`, label: "trigger",
    children: [{ type: "id", value: "btn" }],
  };
  const button = { id: "btn", component: "Button", label: "burger", children: [] };
  const b = mockBuild({
    instances: [trigger, button],
    props: [{ instanceId: "trig", name: "class", value: "burger-btn" }],
  });
  const f = scanInstance(b, trigger);
  assert.ok(f, "expected a finding");
  assert.equal(f.pollutedProps.length, 1);
  assert.equal(f.pollutedProps[0].name, "class");
  assert.equal(f.firstRenderingChild?.id, "btn");
});

test("scanInstance flags every blocked prop (class, className, style, id)", () => {
  const trigger = {
    id: "trig", component: `${RADIX}PopoverTrigger`,
    children: [{ type: "id", value: "btn" }],
  };
  const button = { id: "btn", component: "Button", children: [] };
  const b = mockBuild({
    instances: [trigger, button],
    props: [
      { instanceId: "trig", name: "class", value: "x" },
      { instanceId: "trig", name: "className", value: "y" },
      { instanceId: "trig", name: "style", value: "color:red" },
      { instanceId: "trig", name: "id", value: "trigger-1" },
    ],
  });
  const f = scanInstance(b, trigger);
  assert.equal(f.pollutedProps.length, 4);
  const names = new Set(f.pollutedProps.map((p) => p.name));
  for (const n of ["class", "className", "style", "id"]) {
    assert.equal(names.has(n), true, `expected ${n} in pollutedProps`);
  }
});

test("scanInstance flags a wrapper with a non-empty styleSourceSelection (local styles attached)", () => {
  const trigger = {
    id: "trig", component: `${RADIX}SheetTrigger`,
    children: [{ type: "id", value: "btn" }],
  };
  const button = { id: "btn", component: "Button", children: [] };
  const b = mockBuild({
    instances: [trigger, button],
    styleSourceSelections: [{ instanceId: "trig", values: ["src1", "src2"] }],
  });
  const f = scanInstance(b, trigger);
  assert.ok(f);
  assert.equal(f.hasLocalStyles, true);
  assert.equal(f.styleSourceCount, 2);
  assert.equal(f.pollutedProps.length, 0);
});

test("scanInstance correctly detects pollution on the namespaced form (regression: short-form-only bug)", () => {
  // Verifies the lib correctly handles the namespaced component identifier
  // that the real build always carries (vs the short form used in tests).
  const trigger = {
    id: "trig", component: `${RADIX}DialogTrigger`, // namespaced
    children: [{ type: "id", value: "btn" }],
  };
  const button = { id: "btn", component: "Button", children: [] };
  const b = mockBuild({
    instances: [trigger, button],
    props: [{ instanceId: "trig", name: "class", value: "burger-btn" }],
  });
  const f = scanInstance(b, trigger);
  assert.ok(f, "namespaced DialogTrigger must still be scanned");
});

test("findFirstRenderingChild returns the Button enfant of a DialogTrigger", () => {
  const trigger = {
    id: "trig", component: `${RADIX}DialogTrigger`,
    children: [{ type: "id", value: "btn" }],
  };
  const button = { id: "btn", component: "Button", label: "burger", children: [] };
  const b = mockBuild({ instances: [trigger, button] });
  const child = findFirstRenderingChild(b, trigger);
  assert.equal(child?.id, "btn");
});

test("findFirstRenderingChild descends through nested wrappers to find a real DOM child", () => {
  // Slot > DialogTrigger > Button — should return Button (skipping Slot and Trigger).
  const slot = { id: "slot", component: `${RADIX}Slot`, children: [{ type: "id", value: "trig" }] };
  const trigger = { id: "trig", component: `${RADIX}DialogTrigger`, children: [{ type: "id", value: "btn" }] };
  const button = { id: "btn", component: "Link", label: "click me", children: [] };
  const b = mockBuild({ instances: [slot, trigger, button] });
  const child = findFirstRenderingChild(b, slot);
  assert.equal(child?.id, "btn");
});

test("findFirstRenderingChild returns null when the wrapper has no rendering descendant", () => {
  const trigger = { id: "trig", component: `${RADIX}DialogTrigger`, children: [] };
  const b = mockBuild({ instances: [trigger] });
  const child = findFirstRenderingChild(b, trigger);
  assert.equal(child, null);
});

test("scanInstance: finding includes firstRenderingChild reference for migration suggestion", () => {
  const trigger = {
    id: "trig", component: `${RADIX}DialogTrigger`,
    children: [{ type: "id", value: "btn" }],
  };
  const button = { id: "btn", component: "Button", label: "Burger", children: [] };
  const b = mockBuild({
    instances: [trigger, button],
    props: [{ instanceId: "trig", name: "class", value: "x" }],
  });
  const f = scanInstance(b, trigger);
  assert.equal(f.firstRenderingChild?.id, "btn");
  assert.equal(f.firstRenderingChild?.component, "Button");
  assert.equal(f.firstRenderingChild?.label, "Burger");
});

test("scanInstance: clean styleSourceSelection (empty values array) is not flagged", () => {
  const trigger = {
    id: "trig", component: `${RADIX}DialogTrigger`,
    children: [{ type: "id", value: "btn" }],
  };
  const button = { id: "btn", component: "Button", children: [] };
  const b = mockBuild({
    instances: [trigger, button],
    styleSourceSelections: [{ instanceId: "trig", values: [] }],
  });
  assert.equal(scanInstance(b, trigger), null);
});
