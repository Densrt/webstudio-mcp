// Unit tests for html-to-fragment parser (chantier #5, build.push_html backend).

import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlToFragment } from "../dist/lib/html-to-fragment.js";

test("htmlToFragment: simple div with text", () => {
  const r = htmlToFragment("<div>Hello</div>");
  const payload = r.fragment["@webstudio/instance/v0.1"];
  assert.equal(payload.instances.length, 1);
  assert.equal(payload.instances[0].tag, "div");
  assert.equal(payload.instances[0].children.length, 1);
  assert.equal(payload.instances[0].children[0].type, "text");
  assert.equal(payload.instances[0].children[0].value, "Hello");
});

test("htmlToFragment: nested structure", () => {
  const r = htmlToFragment("<section><h1>Title</h1><p>Body</p></section>");
  const payload = r.fragment["@webstudio/instance/v0.1"];
  assert.equal(payload.instances.length, 3);
  const tags = payload.instances.map((i) => i.tag);
  assert.deepEqual(tags.sort(), ["h1", "p", "section"]);
});

test("htmlToFragment: refuses 0 root", () => {
  assert.throws(() => htmlToFragment(""), /No root element/);
});

test("htmlToFragment: refuses multiple roots", () => {
  assert.throws(() => htmlToFragment("<div>a</div><div>b</div>"), /Multiple root elements/);
});

test("htmlToFragment: refuses @keyframes in CSS", () => {
  assert.throws(
    () => htmlToFragment("<div>x</div>", "@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }"),
    /@keyframes is not supported/,
  );
});

test("htmlToFragment: applies class selector styles", () => {
  const r = htmlToFragment(
    '<div class="hero"><h1 class="title">Title</h1></div>',
    ".hero { padding: 40px; } .title { font-size: 48px; color: red; }",
  );
  assert.ok(r.applied >= 3, `expected at least 3 styles applied, got ${r.applied}`);
  assert.equal(r.skipped, 0);
});

test("htmlToFragment: media query → mobile-landscape breakpoint", () => {
  const r = htmlToFragment(
    '<div class="x">.</div>',
    "@media (max-width: 767px) { .x { padding: 8px; } }",
  );
  // padding expanded to 4 longhand decls (top/right/bottom/left), each on mobile-landscape
  assert.ok(r.applied >= 1, `expected at least 1 style applied`);
  const payload = r.fragment["@webstudio/instance/v0.1"];
  const mobileLandscape = payload.breakpoints.find((b) => b.maxWidth === 767);
  assert.ok(mobileLandscape, "Mobile landscape breakpoint should exist");
  const mobileStyles = payload.styles.filter((s) => s.breakpointId === mobileLandscape.id);
  assert.ok(mobileStyles.length > 0, "expected styles on mobile-landscape breakpoint");
});

test("htmlToFragment: media query → tablet breakpoint", () => {
  const r = htmlToFragment(
    '<div class="x">.</div>',
    "@media (max-width: 991px) { .x { padding: 16px; } }",
  );
  assert.ok(r.applied >= 1);
  const payload = r.fragment["@webstudio/instance/v0.1"];
  const tablet = payload.breakpoints.find((b) => b.maxWidth === 991);
  assert.ok(tablet, "Tablet breakpoint should exist");
  const tabletStyles = payload.styles.filter((s) => s.breakpointId === tablet.id);
  assert.ok(tabletStyles.length > 0, "expected styles on tablet breakpoint");
});

test("htmlToFragment: complex selector skipped with warning", () => {
  const r = htmlToFragment(
    '<div class="x"><span>a</span></div>',
    ".x span { color: blue; } /* descendant selector — skipped */",
  );
  // No simple class selector for ".x span" → skipped
  assert.ok(r.skipped > 0 || r.warnings.length > 0, "expected complex selector to be skipped/warned");
});

test("htmlToFragment: non-class/style attributes preserved as props", () => {
  const r = htmlToFragment('<a href="/contact" aria-label="Contact us">Link</a>');
  const payload = r.fragment["@webstudio/instance/v0.1"];
  const aInstance = payload.instances.find((i) => i.tag === "a");
  const props = payload.props.filter((p) => p.instanceId === aInstance.id);
  const propNames = props.map((p) => p.name);
  assert.ok(propNames.includes("href"));
  assert.ok(propNames.includes("aria-label"));
  // class + style are excluded
  assert.ok(!propNames.includes("class"));
  assert.ok(!propNames.includes("style"));
});

test("htmlToFragment: rootInstanceId returned matches first instance", () => {
  const r = htmlToFragment("<div><p>hello</p></div>");
  const payload = r.fragment["@webstudio/instance/v0.1"];
  const root = payload.instances.find((i) => i.id === r.rootInstanceId);
  assert.ok(root, "rootInstanceId not found in instances");
  assert.equal(root.tag, "div");
});

test("htmlToFragment: empty CSS handled gracefully", () => {
  const r = htmlToFragment("<div>x</div>", "");
  assert.equal(r.applied, 0);
  assert.equal(r.skipped, 0);
  assert.equal(r.warnings.length, 0);
});
