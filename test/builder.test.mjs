// Unit tests for FragmentBuilder + builder helpers
// Run: node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { FragmentBuilder, color, px, num, keyword } from "../dist/builder.js";

test("FragmentBuilder.addInstance creates an instance with a stable ID and empty children", () => {
  const b = new FragmentBuilder();
  const id = b.addInstance("Box", { id: "test-box" });
  const fragment = b.build();
  const data = fragment["@webstudio/instance/v0.1"];
  assert.equal(data.instances.length, 1);
  assert.equal(data.instances[0].id, "test-box");
  assert.deepEqual(data.instances[0].children, []);
  assert.equal(id, "test-box");
});

test("FragmentBuilder handles multiple top-level roots (multi-root)", () => {
  const b = new FragmentBuilder();
  b.addInstance("Box", { id: "root1" });
  b.addInstance("HtmlEmbed", { id: "root2" });
  const fragment = b.build();
  const data = fragment["@webstudio/instance/v0.1"];
  assert.equal(data.children.length, 2, "should have 2 top-level children");
  assert.equal(data.children[0].value, "root1");
  assert.equal(data.children[1].value, "root2");
});

test("FragmentBuilder.addStyle auto-detects CSS custom properties (--foo) with listed:true", () => {
  const b = new FragmentBuilder();
  b.addInstance("Box", { id: "btn" });
  b.addStyle("btn", "--angle", { type: "unit", value: 45, unit: "deg" });
  b.addStyle("btn", "color", color("#000"));
  const fragment = b.build();
  const data = fragment["@webstudio/instance/v0.1"];
  const angleStyle = data.styles.find((s) => s.property === "--angle");
  const colorStyle = data.styles.find((s) => s.property === "color");
  assert.equal(angleStyle?.listed, true, "--angle should have listed:true");
  assert.equal(colorStyle?.listed, undefined, "color (non-custom) should not have listed");
});

test("FragmentBuilder.addStyle respects an explicit listed value", () => {
  const b = new FragmentBuilder();
  b.addInstance("Box", { id: "btn" });
  b.addStyle("btn", "--foo", { type: "unit", value: 1, unit: "number" }, "base", undefined, false);
  const fragment = b.build();
  const data = fragment["@webstudio/instance/v0.1"];
  const fooStyle = data.styles.find((s) => s.property === "--foo");
  assert.equal(fooStyle?.listed, undefined, "explicit listed:false overrides the auto-detect");
});

test("FragmentBuilder.addProp adds a prop with a stable ID", () => {
  const b = new FragmentBuilder();
  b.addInstance("Box", { id: "btn" });
  b.addProp("btn", "class", "string", "my-class");
  const fragment = b.build();
  const data = fragment["@webstudio/instance/v0.1"];
  assert.equal(data.props.length, 1);
  assert.equal(data.props[0].instanceId, "btn");
  assert.equal(data.props[0].name, "class");
  assert.equal(data.props[0].value, "my-class");
});

test("FragmentBuilder parent/child: addInstance with parentId attaches to the parent", () => {
  const b = new FragmentBuilder();
  b.addInstance("Box", { id: "parent" });
  b.addInstance("Heading", { id: "child", parentId: "parent" });
  const fragment = b.build();
  const data = fragment["@webstudio/instance/v0.1"];
  const parent = data.instances.find((i) => i.id === "parent");
  assert.equal(parent.children.length, 1);
  assert.equal(parent.children[0].value, "child");
  // Child shouldn't be in top-level children
  assert.equal(data.children.length, 1);
  assert.equal(data.children[0].value, "parent");
});

test("color helper converts hex to 0-1 components", () => {
  const c = color("#FFFFFF");
  assert.equal(c.type, "color");
  assert.equal(c.colorSpace, "hex");
  assert.deepEqual(c.components, [1, 1, 1]);
  assert.equal(c.alpha, 1);

  const half = color({ r: 0.5, g: 0.5, b: 0.5, a: 0.7 });
  assert.deepEqual(half.components, [0.5, 0.5, 0.5]);
  assert.equal(half.alpha, 0.7);
});

test("FragmentBuilder.addText adds a text child", () => {
  const b = new FragmentBuilder();
  b.addInstance("Heading", { id: "h" });
  b.addText("h", "Bonjour");
  const fragment = b.build();
  const data = fragment["@webstudio/instance/v0.1"];
  const h = data.instances.find((i) => i.id === "h");
  assert.equal(h.children.length, 1);
  assert.equal(h.children[0].type, "text");
  assert.equal(h.children[0].value, "Bonjour");
});

test("FragmentBuilder accepts CSS states (:hover, [data-state])", () => {
  const b = new FragmentBuilder();
  b.addInstance("Box", { id: "btn" });
  b.addStyle("btn", "color", color("#000"), "base", ":hover");
  const fragment = b.build();
  const data = fragment["@webstudio/instance/v0.1"];
  const hoverStyle = data.styles.find((s) => s.state === ":hover");
  assert.ok(hoverStyle, "the :hover style should exist");
});
