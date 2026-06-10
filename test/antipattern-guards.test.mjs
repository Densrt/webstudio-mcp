// v2.19.0 — global anti-pattern audit guards.
//
// Three protections born from the 2026-06-10 audit:
//   1. coerceRawVideoInstances — raw <video> → native Video (SSR-correct
//      boolean attrs), conditional (never with <source> children), + iframe
//      YouTube/Vimeo detection.
//   2. lintShowBinding — data-ws-show MUST be boolean (a number leaks "0" as
//      text on the live page; 5 bare-access bindings found in production
//      during the sweep).
//   3. findSharedRemovalConflicts — instances.delete refuses to destroy
//      content still referenced outside the deleted set (shared-Slot DAG).

import { test } from "node:test";
import assert from "node:assert/strict";

import { coerceRawVideoInstances } from "../dist/lib/coerce-video-component.js";
import { lintShowBinding, lintShowBindingProps } from "../dist/lib/lint-show-binding.js";
import { findSharedRemovalConflicts } from "../dist/cleanup-helpers.js";

// ── coerceRawVideoInstances ─────────────────────────────────────────────────

test("video: childless raw <video> converts, boolean attrs renamed + retyped", () => {
  const instances = [{ id: "v1", component: "ws:element", tag: "video", children: [] }];
  const props = [
    { id: "p1", instanceId: "v1", name: "src", type: "string", value: "https://cdn.x/clip.mp4" },
    { id: "p2", instanceId: "v1", name: "autoplay", type: "string", value: "" },
    { id: "p3", instanceId: "v1", name: "playsinline", type: "string", value: "true" },
    { id: "p4", instanceId: "v1", name: "muted", type: "string", value: "false" },
  ];
  const res = coerceRawVideoInstances(instances, props);
  assert.equal(res.converted.length, 1);
  assert.equal(instances[0].component, "Video");
  assert.ok(!("tag" in instances[0]));
  const byName = Object.fromEntries(props.map((p) => [p.name, p]));
  assert.ok(byName.autoPlay, "autoplay renamed to autoPlay");
  assert.equal(byName.autoPlay.type, "boolean");
  assert.equal(byName.autoPlay.value, true, "HTML presence semantics: empty string = true");
  assert.equal(byName.playsInline.value, true);
  assert.equal(byName.muted.value, false, "explicit false stays false");
  assert.equal(byName.src.type, "string", "src untouched");
  assert.deepEqual(res.telemetry.map((t) => t.key), ["coerce:video-component"]);
});

test("video: raw <video> WITH <source> children is detected, never converted", () => {
  const instances = [
    { id: "v2", component: "ws:element", tag: "video", children: [{ type: "id", value: "s1" }] },
    { id: "s1", component: "ws:element", tag: "source", children: [] },
  ];
  const res = coerceRawVideoInstances(instances, []);
  assert.equal(res.converted.length, 0);
  assert.equal(res.skippedWithChildren.length, 1);
  assert.equal(instances[0].component, "ws:element", "untouched");
  assert.ok(res.telemetry.some((t) => t.key === "detect:raw-video-with-children"));
});

test("video: iframe YouTube/Vimeo embeds detected with platform, left as-is", () => {
  const instances = [
    { id: "f1", component: "ws:element", tag: "iframe", children: [] },
    { id: "f2", component: "ws:element", tag: "iframe", children: [] },
    { id: "f3", component: "ws:element", tag: "iframe", children: [] },
  ];
  const props = [
    { id: "a", instanceId: "f1", name: "src", type: "string", value: "https://www.youtube-nocookie.com/embed/xyz" },
    { id: "b", instanceId: "f2", name: "src", type: "string", value: "https://player.vimeo.com/video/123" },
    { id: "c", instanceId: "f3", name: "src", type: "string", value: "https://maps.google.com/embed" },
  ];
  const res = coerceRawVideoInstances(instances, props);
  assert.deepEqual(res.iframeEmbeds.map((e) => e.platform), ["YouTube", "Vimeo"]);
  assert.ok(instances.every((i) => i.component === "ws:element"), "iframes never converted");
});

// ── lintShowBinding ─────────────────────────────────────────────────────────

test("show lint: .length tail auto-fixed to > 0", () => {
  const lint = lintShowBinding("$ws$dataSource$abc.data.items.length");
  assert.equal(lint.kind, "fixed");
  assert.equal(lint.expression, "$ws$dataSource$abc.data.items.length > 0");
  assert.equal(lint.telemetryKey, "coerce:show-binding-length");
});

test("show lint: bare field access warns (the production sweep case)", () => {
  const lint = lintShowBinding("$ws$dataSource$HN4.data.tableau_moteur");
  assert.equal(lint.kind, "warning");
  assert.equal(lint.telemetryKey, "detect:show-binding-not-boolean");
});

test("show lint: boolean-shaped expressions are clean", () => {
  for (const e of [
    "$ws$ds$x.data.items.length > 0",
    '$ws$ds$x.data.titre !== ""',
    "!!$ws$ds$x.data.flag",
    "$ws$ds$x.data.a && $ws$ds$x.data.b",
    "true",
  ]) {
    assert.equal(lintShowBinding(e).kind, "clean", e);
  }
});

test("show lint props: only data-ws-show expression props touched, fix applied in place", () => {
  const props = [
    { name: "data-ws-show", type: "expression", value: "$ws$ds$x.data.list.length" },
    { name: "data-ws-show", type: "boolean", value: true },
    { name: "alt", type: "expression", value: "$ws$ds$x.data.items.length" },
  ];
  const { hints, telemetry } = lintShowBindingProps(props);
  assert.equal(props[0].value, "$ws$ds$x.data.list.length > 0");
  assert.equal(props[2].value, "$ws$ds$x.data.items.length", "non-show props untouched");
  assert.equal(hints.length, 1);
  assert.deepEqual(telemetry, [{ key: "coerce:show-binding-length", count: 1 }]);
});

// ── findSharedRemovalConflicts ──────────────────────────────────────────────

const dagBuild = {
  instances: [
    { id: "pageA-slot", component: "Slot", children: [{ type: "id", value: "shared-frag" }] },
    { id: "pageB-slot", component: "Slot", children: [{ type: "id", value: "shared-frag" }] },
    { id: "shared-frag", component: "Fragment", children: [{ type: "id", value: "frag-child" }] },
    { id: "frag-child", component: "Box", children: [] },
    { id: "lonely", component: "Box", children: [{ type: "id", value: "lonely-child" }] },
    { id: "lonely-child", component: "Box", children: [] },
    { id: "parent-of-lonely", component: "Box", children: [{ type: "id", value: "lonely" }] },
  ],
  props: [],
  styleSourceSelections: [],
};

test("delete guard: deleting a shared Fragment root directly is a conflict (2 referrers)", () => {
  const conflicts = findSharedRemovalConflicts(dagBuild, ["shared-frag"]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].id, "shared-frag");
  assert.equal(conflicts[0].isRoot, true);
  assert.equal(conflicts[0].referrers.length, 2);
});

test("delete guard: normal subtree with its single parent outside is NOT a conflict", () => {
  assert.deepEqual(findSharedRemovalConflicts(dagBuild, ["lonely"]), []);
});

test("delete guard: a swept DESCENDANT referenced from outside IS a conflict", () => {
  const build = structuredClone(dagBuild);
  // wrapper contains the shared fragment as a normal child (no Slot stop)
  build.instances.push({ id: "wrapper", component: "Box", children: [{ type: "id", value: "shared-frag" }] });
  const conflicts = findSharedRemovalConflicts(build, ["wrapper"]);
  assert.ok(conflicts.some((c) => c.id === "shared-frag" && c.isRoot === false));
});
