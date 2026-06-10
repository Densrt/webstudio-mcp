// v2.18.0 — raw <img> → native Image component coercion.
//
// Cas réel (2026-06-10): callers systematically pushed ws:element tag="img"
// instead of the native Image component (debunked "asset-only" myth — see
// pattern image-component). The coerce converts them at every push boundary;
// html-to-fragment and the internal helpers (cards, swiper) emit Image
// directly at the source.

import { test } from "node:test";
import assert from "node:assert/strict";

import { coerceRawImgInstances } from "../dist/lib/coerce-image-component.js";
import { buildAppendChanges } from "../dist/tools/append-child.js";
import { htmlToFragment } from "../dist/lib/html-to-fragment.js";

// ── coerceRawImgInstances (pure) ────────────────────────────────────────────

test("converts ws:element tag=img to Image, drops the tag, keeps everything else", () => {
  const instances = [
    { id: "a", component: "ws:element", tag: "img", label: "Hero img", children: [] },
    { id: "b", component: "ws:element", tag: "div", children: [] },
    { id: "c", component: "Image", children: [] },
    { id: "d", component: "Box", tag: "img", children: [] },
  ];
  const res = coerceRawImgInstances(instances);
  assert.equal(res.count, 2);
  assert.deepEqual(res.converted.map((c) => c.id), ["a", "d"]);
  assert.equal(instances[0].component, "Image");
  assert.ok(!("tag" in instances[0]), "tag must be dropped");
  assert.equal(instances[0].label, "Hero img");
  assert.equal(instances[1].component, "ws:element", "div untouched");
  assert.equal(instances[1].tag, "div");
  assert.equal(instances[2].component, "Image", "already-Image untouched");
  assert.match(res.hint, /image-component/);
  assert.equal(res.telemetryKey, "coerce:image-component");
});

test("no raw img → count 0, no hint, instances untouched", () => {
  const instances = [{ id: "x", component: "ws:element", tag: "section", children: [] }];
  const res = coerceRawImgInstances(instances);
  assert.equal(res.count, 0);
  assert.equal(res.hint, undefined);
  assert.equal(instances[0].tag, "section");
});

test("custom components with tag img are NOT touched (only ws:element/Box)", () => {
  const instances = [{ id: "v", component: "Vimeo", tag: "img", children: [] }];
  const res = coerceRawImgInstances(instances);
  assert.equal(res.count, 0);
  assert.equal(instances[0].component, "Vimeo");
});

// ── instances.append: tag img → Image at creation ───────────────────────────

const appendBuild = {
  instances: [{ id: "parent", component: "Box", children: [] }],
  styleSources: [],
};

test("append: tag img child is created as Image (no tag), conversion reported", () => {
  const r = buildAppendChanges(appendBuild, {
    parentInstanceId: "parent",
    children: [{ tag: "img" }, { tag: "p", text: "caption" }],
  });
  const adds = r.changes[0].patches.filter((p) => p.op === "add");
  assert.equal(adds[0].value.component, "Image");
  assert.ok(!("tag" in adds[0].value));
  assert.equal(adds[1].value.component, "ws:element");
  assert.equal(adds[1].value.tag, "p");
  assert.deepEqual(r.imgConversions, [adds[0].value.id]);
});

test("append: explicit non-generic component with tag img is respected", () => {
  const r = buildAppendChanges(appendBuild, {
    parentInstanceId: "parent",
    children: [{ tag: "img", component: "HtmlEmbed" }],
  });
  const add = r.changes[0].patches.find((p) => p.op === "add");
  assert.equal(add.value.component, "HtmlEmbed");
  assert.deepEqual(r.imgConversions, []);
});

// ── html-to-fragment: <img> → Image with typed props ────────────────────────

test("push_html: <img> maps to the Image component with typed width/height props", () => {
  const { fragment } = htmlToFragment(
    '<div><img src="https://cdn.example.com/photo.webp" alt="Photo" width="800" height="600" loading="lazy"></div>',
  );
  const payload = fragment["@webstudio/instance/v0.1"];
  const img = payload.instances.find((i) => i.component === "Image");
  assert.ok(img, "Image instance expected");
  assert.ok(!("tag" in img) || img.tag === undefined, "Image carries no tag");
  assert.ok(!payload.instances.some((i) => i.tag === "img"), "no raw img instance left");
  const propsFor = payload.props.filter((p) => p.instanceId === img.id);
  const byName = Object.fromEntries(propsFor.map((p) => [p.name, p]));
  assert.equal(byName.src.value, "https://cdn.example.com/photo.webp");
  assert.equal(byName.alt.value, "Photo");
  assert.equal(byName.width.type, "number");
  assert.equal(byName.width.value, 800);
  assert.equal(byName.height.type, "number");
  assert.equal(byName.height.value, 600);
  assert.equal(byName.loading.value, "lazy");
});
