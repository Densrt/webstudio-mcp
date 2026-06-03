// Coverage for the addSheet a11y auto-injection (DialogTitle + DialogDescription
// rendered visually-hidden inside the panel). Required by Radix Dialog runtime,
// which logs a warning on every open when DialogTitle is missing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { FragmentBuilder } from "../dist/builder.js";
import { addSheet } from "../dist/components/sheet.js";

const RADIX_NS_PREFIX = "@webstudio-is/sdk-components-react-radix:";

function buildSheet(opts = {}) {
  const b = new FragmentBuilder();
  const result = addSheet(b, {
    links: [{ label: "Home", href: "/" }, { label: "About", href: "/about" }],
    ...opts,
  });
  const fragment = b.build();
  const payload = fragment["@webstudio/instance/v0.1"];
  return { result, payload };
}

test("addSheet injects DialogTitle + DialogDescription by default (a11y on)", () => {
  const { result, payload } = buildSheet();
  assert.ok(result.a11yTitleId, "expected a11yTitleId in result");
  assert.ok(result.a11yDescId, "expected a11yDescId in result");
  const title = payload.instances.find((i) => i.id === result.a11yTitleId);
  const desc = payload.instances.find((i) => i.id === result.a11yDescId);
  assert.ok(title, "DialogTitle instance must exist");
  assert.ok(desc, "DialogDescription instance must exist");
  assert.equal(title.component, `${RADIX_NS_PREFIX}DialogTitle`);
  assert.equal(desc.component, `${RADIX_NS_PREFIX}DialogDescription`);
});

test("addSheet defaults — default a11y copy is provided when caller doesn't override", () => {
  const { result, payload } = buildSheet();
  // Each text node has children of type "text" carrying the actual string.
  const title = payload.instances.find((i) => i.id === result.a11yTitleId);
  const desc = payload.instances.find((i) => i.id === result.a11yDescId);
  const titleText = title.children.find((c) => c.type === "text")?.value;
  const descText = desc.children.find((c) => c.type === "text")?.value;
  assert.equal(titleText, "Navigation menu");
  assert.equal(descText, "Links to the main sections of the site.");
});

test("addSheet honors custom a11yTitle and a11yDescription", () => {
  const { result, payload } = buildSheet({
    a11yTitle: "Custom title",
    a11yDescription: "Custom description for screen readers",
  });
  const title = payload.instances.find((i) => i.id === result.a11yTitleId);
  const desc = payload.instances.find((i) => i.id === result.a11yDescId);
  assert.equal(title.children.find((c) => c.type === "text")?.value, "Custom title");
  assert.equal(desc.children.find((c) => c.type === "text")?.value, "Custom description for screen readers");
});

test("addSheet opt-out: a11yTitle=null AND a11yDescription=null skips injection", () => {
  const { result, payload } = buildSheet({ a11yTitle: null, a11yDescription: null });
  assert.equal(result.a11yTitleId, undefined);
  assert.equal(result.a11yDescId, undefined);
  assert.equal(payload.instances.some((i) => i.component === `${RADIX_NS_PREFIX}DialogTitle`), false);
  assert.equal(payload.instances.some((i) => i.component === `${RADIX_NS_PREFIX}DialogDescription`), false);
});

test("addSheet partial opt-out: a11yTitle=null keeps DialogDescription", () => {
  const { result, payload } = buildSheet({ a11yTitle: null });
  assert.equal(result.a11yTitleId, undefined);
  assert.ok(result.a11yDescId);
  assert.equal(payload.instances.some((i) => i.component === `${RADIX_NS_PREFIX}DialogTitle`), false);
  assert.equal(payload.instances.some((i) => i.component === `${RADIX_NS_PREFIX}DialogDescription`), true);
});

test("addSheet a11y title is FIRST child of the panel (before logo, nav, socials)", () => {
  const { result, payload } = buildSheet();
  const panel = payload.instances.find((i) => i.id === result.panelId);
  assert.ok(panel, "panel must exist");
  const firstChildId = panel.children.find((c) => c.type === "id")?.value;
  assert.equal(firstChildId, result.a11yTitleId, "DialogTitle must be the first id-child of the panel");
});

test("addSheet a11y title styles include sr-only properties (position absolute + clipPath inset)", () => {
  const { result, payload } = buildSheet();
  // styleSourceSelection links the title to its local styleSource; styles carry the decls.
  const sel = payload.styleSourceSelections.find((s) => s.instanceId === result.a11yTitleId);
  assert.ok(sel, "expected a styleSourceSelection for a11yTitle");
  const titleStyleSources = new Set(sel.values);
  const titleStyles = payload.styles.filter((s) => titleStyleSources.has(s.styleSourceId));
  const positionStyle = titleStyles.find((s) => s.property === "position");
  const clipPathStyle = titleStyles.find((s) => s.property === "clipPath");
  const whiteSpaceStyle = titleStyles.find((s) => s.property === "whiteSpace");
  // Shorthand `overflow` is rejected at the boundary (a production site); longhands are emitted.
  const overflowX = titleStyles.find((s) => s.property === "overflowX");
  const overflowY = titleStyles.find((s) => s.property === "overflowY");
  assert.ok(positionStyle, "position style must be present");
  assert.equal(positionStyle.value.type, "keyword");
  assert.equal(positionStyle.value.value, "absolute");
  assert.ok(clipPathStyle, "clipPath inset(50%) must be present (sr-only crop)");
  assert.ok(whiteSpaceStyle, "whiteSpace: nowrap must be present");
  assert.ok(overflowX && overflowX.value.value === "hidden", "overflowX: hidden must be present");
  assert.ok(overflowY && overflowY.value.value === "hidden", "overflowY: hidden must be present");
});

test("addSheet does NOT pollute the DialogTrigger with class/style props (regression guard)", () => {
  const { result, payload } = buildSheet();
  const trigger = payload.instances.find((i) => i.id === result.triggerId);
  assert.ok(trigger);
  assert.equal(trigger.component, `${RADIX_NS_PREFIX}DialogTrigger`);
  // Verify no class/className/style/id prop is set on the Trigger itself.
  const triggerProps = payload.props.filter((p) => p.instanceId === result.triggerId);
  for (const p of triggerProps) {
    assert.notEqual(p.name, "class", "DialogTrigger must not carry a class prop");
    assert.notEqual(p.name, "className", "DialogTrigger must not carry className");
    assert.notEqual(p.name, "style", "DialogTrigger must not carry style");
    assert.notEqual(p.name, "id", "DialogTrigger must not carry id");
  }
  // The class prop MUST be on the Button child instead.
  const burgerProps = payload.props.filter((p) => p.instanceId === result.buttonId);
  const classProp = burgerProps.find((p) => p.name === "class");
  assert.ok(classProp, "burger Button must carry the class prop (not the Trigger)");
  assert.equal(classProp.value, "burger-btn");
});
