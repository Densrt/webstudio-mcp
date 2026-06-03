// Unit tests for webstudio_push_complete — pure helpers (pattern expansion,
// binding application, token preprocessing, ref validation, fromFile merging).
//
// The handler itself touches the network (auth + fetchBuild + pushWithRetry),
// so its end-to-end flow is exercised by manual smoke runs against a fixture
// project. These tests cover the synchronous transformations that build the
// transaction payload — the only place a logic bug can land us in a bad cloud
// state.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _pure, pushCompleteInputSchema } from "../dist/tools/push-complete.js";

const {
  expandPattern,
  applyBindingToFragment,
  validateBindingRefs,
  preprocessTokens,
  substituteInString,
  mergeFromFile,
} = _pure;

// ── substituteInString ────────────────────────────────────────────────────

test("substituteInString — basic substitution", () => {
  assert.equal(substituteInString("Hello {{name}}", { name: "World" }), "Hello World");
  assert.equal(substituteInString("{{a}} and {{b}}", { a: "x", b: "y" }), "x and y");
});

test("substituteInString — no placeholder returns input unchanged", () => {
  assert.equal(substituteInString("no vars here", { unused: "x" }), "no vars here");
});

test("substituteInString — missing var throws with key in message", () => {
  assert.throws(() => substituteInString("{{missing}}", { other: "x" }), /missing/);
});

// ── expandPattern ─────────────────────────────────────────────────────────

const minimalPattern = {
  subtree: [
    { id: "lnk", component: "ws:element", tag: "a", parentId: "col-1", children: [{ type: "text", value: "{{label}}" }] },
  ],
  patternProps: [],
  patternStyles: [],
  patternBindings: [],
  repeat: [
    { idSuffix: "1", vars: { label: "Quads" } },
    { idSuffix: "2", vars: { label: "Bikes" } },
  ],
};

test("expandPattern — N=2 produces 2 cloned instances", () => {
  const r = expandPattern(minimalPattern, [], [], [], []);
  assert.equal(r.instances.length, 2);
  assert.equal(r.instances[0].id, "lnk-1");
  assert.equal(r.instances[1].id, "lnk-2");
  assert.equal(r.instances[0].children[0].value, "Quads");
  assert.equal(r.instances[1].children[0].value, "Bikes");
});

test("expandPattern — idPrefix is prepended to remapped ids", () => {
  const r = expandPattern({ ...minimalPattern, idPrefix: "footer-" }, [], [], [], []);
  assert.equal(r.instances[0].id, "footer-lnk-1");
  assert.equal(r.instances[1].id, "footer-lnk-2");
});

test("expandPattern — patternProps cloned with substituted value + remapped instanceId", () => {
  const r = expandPattern(
    {
      ...minimalPattern,
      patternProps: [{ instanceId: "lnk", name: "href", type: "string", value: "{{href}}" }],
      repeat: [
        { idSuffix: "1", vars: { label: "Quads", href: "/q" } },
        { idSuffix: "2", vars: { label: "Bikes", href: "/m" } },
      ],
    },
    [], [], [], [],
  );
  assert.equal(r.props.length, 2);
  assert.equal(r.props[0].instanceId, "lnk-1");
  assert.equal(r.props[0].value, "/q");
  assert.equal(r.props[1].instanceId, "lnk-2");
  assert.equal(r.props[1].value, "/m");
});

test("expandPattern — patternStyles cloned with unparsed substitution", () => {
  const r = expandPattern(
    {
      ...minimalPattern,
      patternStyles: [
        { instanceId: "lnk", property: "color", value: { type: "unparsed", value: "{{c}}" }, breakpoint: "base" },
      ],
      repeat: [
        { idSuffix: "1", vars: { label: "x", c: "red" } },
      ],
    },
    [], [], [], [],
  );
  assert.equal(r.styles.length, 1);
  assert.equal(r.styles[0].instanceId, "lnk-1");
  assert.deepEqual(r.styles[0].value, { type: "unparsed", value: "red" });
});

test("expandPattern — patternBindings cloned with substituted raw expression", () => {
  const r = expandPattern(
    {
      ...minimalPattern,
      patternBindings: [
        { instanceId: "lnk", propName: "ariaLabel", binding: { kind: "raw", expression: "\"Card {{idx}}\"" } },
      ],
      repeat: [
        { idSuffix: "1", vars: { label: "x", idx: "1" } },
        { idSuffix: "2", vars: { label: "y", idx: "2" } },
      ],
    },
    [], [], [], [],
  );
  assert.equal(r.bindings.length, 2);
  assert.equal(r.bindings[0].instanceId, "lnk-1");
  assert.equal(r.bindings[0].binding.expression, '"Card 1"');
});

test("expandPattern — internal parentId is remapped, external parentId preserved", () => {
  const pattern = {
    subtree: [
      { id: "wrap", component: "ws:element", tag: "li", parentId: "external-parent", children: [] },
      { id: "inner", component: "ws:element", tag: "span", parentId: "wrap", children: [{ type: "text", value: "{{t}}" }] },
    ],
    patternProps: [], patternStyles: [], patternBindings: [],
    repeat: [{ idSuffix: "1", vars: { t: "hi" } }],
  };
  const r = expandPattern(pattern, [], [], [], []);
  assert.equal(r.instances.length, 2);
  const wrap = r.instances.find((i) => i.id === "wrap-1");
  const inner = r.instances.find((i) => i.id === "inner-1");
  assert.equal(wrap.parentId, "external-parent");
  assert.equal(inner.parentId, "wrap-1");
});

test("expandPattern — missing var throws", () => {
  assert.throws(
    () => expandPattern(
      { ...minimalPattern, repeat: [{ idSuffix: "1", vars: {} }] },
      [], [], [], [],
    ),
    /Pattern var "{{label}}"/,
  );
});

test("expandPattern — patternProps.instanceId not in subtree → throws", () => {
  assert.throws(
    () => expandPattern(
      { ...minimalPattern, patternProps: [{ instanceId: "rogue", name: "href", type: "string", value: "/" }] },
      [], [], [], [],
    ),
    /not in pattern.subtree/,
  );
});

// ── applyBindingToFragment ────────────────────────────────────────────────

test("applyBindingToFragment — prop binding adds new prop with expression type", () => {
  const instances = [{ id: "a", component: "ws:element", tag: "div", children: [] }];
  const props = [];
  const detail = applyBindingToFragment(instances, props, {
    instanceId: "a",
    propName: "href",
    binding: { kind: "variable", dataSourceId: "ds_x" },
  });
  assert.equal(props.length, 1);
  assert.equal(props[0].type, "expression");
  assert.equal(props[0].value, "$ws$dataSource$ds__DASH__x".replace("__DASH__", "_")); // no dash here
  assert.match(detail, /add prop a\.href/);
});

test("applyBindingToFragment — prop binding replaces existing prop", () => {
  const instances = [{ id: "a", component: "ws:element", tag: "div", children: [] }];
  const props = [{ instanceId: "a", name: "href", type: "string", value: "/old" }];
  applyBindingToFragment(instances, props, {
    instanceId: "a",
    propName: "href",
    binding: { kind: "raw", expression: "$ws$dataSource$X.url" },
  });
  assert.equal(props.length, 1);
  assert.equal(props[0].type, "expression");
  assert.equal(props[0].value, "$ws$dataSource$X.url");
});

test("applyBindingToFragment — text binding replaces first text child", () => {
  const instances = [{
    id: "a",
    component: "ws:element",
    tag: "h2",
    children: [{ type: "text", value: "Old title" }],
  }];
  const props = [];
  applyBindingToFragment(instances, props, {
    instanceId: "a",
    binding: { kind: "raw", expression: "$ws$dataSource$X.title" },
  });
  assert.equal(instances[0].children[0].type, "expression");
  assert.equal(instances[0].children[0].value, "$ws$dataSource$X.title");
});

test("applyBindingToFragment — text binding appends expression child on empty instance", () => {
  const instances = [{ id: "a", component: "ws:element", tag: "div", children: [] }];
  const props = [];
  applyBindingToFragment(instances, props, {
    instanceId: "a",
    binding: { kind: "raw", expression: "$ws$dataSource$X.txt" },
  });
  assert.equal(instances[0].children.length, 1);
  assert.equal(instances[0].children[0].type, "expression");
});

test("applyBindingToFragment — unknown instanceId throws", () => {
  assert.throws(
    () => applyBindingToFragment([], [], {
      instanceId: "ghost",
      propName: "href",
      binding: { kind: "raw", expression: "x" },
    }),
    /not in instances/,
  );
});

// ── validateBindingRefs ───────────────────────────────────────────────────

test("validateBindingRefs — all refs known returns null", () => {
  const err = validateBindingRefs(
    [{ instanceId: "a", binding: { kind: "variable", dataSourceId: "ds1" } }],
    new Set(["ds1"]),
    new Set(),
  );
  assert.equal(err, null);
});

test("validateBindingRefs — ref in build but not fragment is OK", () => {
  const err = validateBindingRefs(
    [{ instanceId: "a", binding: { kind: "variable", dataSourceId: "ds_cloud" } }],
    new Set(),
    new Set(["ds_cloud"]),
  );
  assert.equal(err, null);
});

test("validateBindingRefs — missing ref is reported", () => {
  const err = validateBindingRefs(
    [{ instanceId: "a", binding: { kind: "variable", dataSourceId: "ghost" } }],
    new Set(["other"]),
    new Set(["whatever"]),
  );
  assert.match(err, /ghost/);
});

test("validateBindingRefs — template parts with unknown variable ref are reported", () => {
  const err = validateBindingRefs(
    [{
      instanceId: "a",
      binding: {
        kind: "template",
        parts: [
          { type: "text", value: "x" },
          { type: "variable", dataSourceId: "ghost" },
        ],
      },
    }],
    new Set(),
    new Set(),
  );
  assert.match(err, /ghost/);
});

// ── preprocessTokens ──────────────────────────────────────────────────────

test("preprocessTokens — accepts unique name + expands shorthand padding", () => {
  const r = preprocessTokens(
    [{
      name: "T1",
      styles: { padding: { type: "unit", value: 12, unit: "px" } },
      attachToInstances: [],
    }],
    new Set(),
    new Set(),
  );
  assert.equal(r.ok, true);
  assert.equal(r.expanded.length, 1);
  // padding → paddingTop/Right/Bottom/Left
  const keys = Object.keys(r.expanded[0].styles).sort();
  assert.deepEqual(keys, ["paddingBottom", "paddingLeft", "paddingRight", "paddingTop"]);
});

test("preprocessTokens — rejects existing token name", () => {
  const r = preprocessTokens(
    [{ name: "Existing", styles: { color: { type: "keyword", value: "red" } }, attachToInstances: [] }],
    new Set(),
    new Set(["Existing"]),
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /already exists/);
});

test("preprocessTokens — rejects attachToInstances not in fragment", () => {
  const r = preprocessTokens(
    [{ name: "T1", styles: { color: { type: "keyword", value: "red" } }, attachToInstances: ["cloud-inst"] }],
    new Set(["frag-inst"]),
    new Set(),
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /not a fragment-local instance/);
});

test("preprocessTokens — rejects non-expandable shorthand (flex)", () => {
  const r = preprocessTokens(
    [{
      name: "T1",
      styles: { flex: { type: "var", value: "foo" } }, // typed value on flex = ambiguous axis
      attachToInstances: [],
    }],
    new Set(),
    new Set(),
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /flex/);
});

test("preprocessTokens — preserves typed values (color, var, layers, shadow)", () => {
  const r = preprocessTokens(
    [{
      name: "T1",
      styles: {
        color: { type: "color", colorSpace: "rgb", components: [255, 0, 0], alpha: 1 },
        backgroundColor: { type: "var", value: "brand-primary" },
        boxShadow: {
          type: "layers",
          value: [{
            type: "shadow", position: "outset",
            offsetX: { type: "unit", value: 0, unit: "px" },
            offsetY: { type: "unit", value: 4, unit: "px" },
            blur: { type: "unit", value: 8, unit: "px" },
            spread: { type: "unit", value: 0, unit: "px" },
            color: { type: "color", colorSpace: "rgb", components: [0, 0, 0], alpha: 0.2 },
          }],
        },
      },
      attachToInstances: [],
    }],
    new Set(),
    new Set(),
  );
  assert.equal(r.ok, true);
  assert.equal(r.expanded[0].styles.color.type, "color");
  assert.equal(r.expanded[0].styles.backgroundColor.type, "var");
  assert.equal(r.expanded[0].styles.boxShadow.type, "layers");
});

// ── mergeFromFile ─────────────────────────────────────────────────────────

test("mergeFromFile — reads file and overrides matching keys", () => {
  const dir = mkdtempSync(join(tmpdir(), "wsmcp-"));
  try {
    const path = join(dir, "frag.json");
    writeFileSync(path, JSON.stringify({
      instances: [{ id: "fromfile", component: "ws:element", tag: "div", children: [] }],
      cloudTokens: [{ name: "FF", styles: { color: { type: "keyword", value: "blue" } }, attachToInstances: [] }],
    }));
    const out = mergeFromFile({
      fromFile: path,
      instances: [{ id: "inline-only", component: "ws:element", tag: "div", children: [] }],
      props: [], styles: [], dataSources: [], useTokens: [], tokens: [],
      cloudTokens: [], bindings: [],
      pushTo: { projectSlug: "x", dryRun: true, forceConfirmed: false, ignoreWrapperWarning: false },
    });
    assert.equal(out.instances.length, 1);
    assert.equal(out.instances[0].id, "fromfile");
    assert.equal(out.cloudTokens.length, 1);
    assert.equal(out.cloudTokens[0].name, "FF");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mergeFromFile — no fromFile returns input unchanged", () => {
  const input = {
    instances: [{ id: "a", component: "ws:element", tag: "div", children: [] }],
    props: [], styles: [], dataSources: [], useTokens: [], tokens: [],
    cloudTokens: [], bindings: [],
    pushTo: { projectSlug: "x", dryRun: true, forceConfirmed: false, ignoreWrapperWarning: false },
  };
  const out = mergeFromFile(input);
  assert.deepEqual(out, input);
});

test("mergeFromFile — missing file throws clear error", () => {
  assert.throws(
    () => mergeFromFile({
      fromFile: "/does/not/exist.json",
      instances: [], props: [], styles: [], dataSources: [], useTokens: [], tokens: [],
      cloudTokens: [], bindings: [],
      pushTo: { projectSlug: "x", dryRun: true, forceConfirmed: false, ignoreWrapperWarning: false },
    }),
    /fromFile read failed/,
  );
});

// ── Schema round-trip / boundary ──────────────────────────────────────────

test("schema — minimal valid input (instances + pushTo) parses", () => {
  const parsed = pushCompleteInputSchema.safeParse({
    pushTo: { projectSlug: "x", parentInstanceId: "p", dryRun: true },
    instances: [{ id: "a", component: "ws:element", tag: "div", children: [] }],
  });
  assert.equal(parsed.success, true);
});

test("schema — push without dryRun and without forceConfirmed parses (handler enforces protocol)", () => {
  const parsed = pushCompleteInputSchema.safeParse({
    pushTo: { projectSlug: "x", dryRun: false },
    instances: [],
  });
  assert.equal(parsed.success, true);
});

test("schema — bindings reject extra fields (strict)", () => {
  const parsed = pushCompleteInputSchema.safeParse({
    pushTo: { projectSlug: "x", dryRun: true },
    bindings: [{ instanceId: "a", binding: { kind: "raw", expression: "x" }, rogue: true }],
  });
  assert.equal(parsed.success, false);
});

test("schema — cloudTokens accepts every StyleValue variant", () => {
  const parsed = pushCompleteInputSchema.safeParse({
    pushTo: { projectSlug: "x", dryRun: true },
    cloudTokens: [{
      name: "AllTypes",
      styles: {
        color: { type: "color", colorSpace: "rgb", components: [1, 2, 3], alpha: 1 },
        bg: { type: "var", value: "v1" },
        ff: { type: "fontFamily", value: ["Arial"] },
        img: { type: "image", value: { type: "url", url: "/i.png" } },
        kw: { type: "keyword", value: "auto" },
        unit: { type: "unit", value: 10, unit: "px" },
        unparsed: { type: "unparsed", value: "0 0 10px" },
        layers: { type: "layers", value: [{ type: "keyword", value: "none" }] },
        tup: { type: "tuple", value: [{ type: "unit", value: 1, unit: "px" }] },
        fn: { type: "function", name: "blur", args: { type: "tuple", value: [{ type: "unit", value: 4, unit: "px" }] } },
      },
      attachToInstances: [],
    }],
  });
  assert.equal(parsed.success, true);
});

test("schema — pattern requires repeat with >=1 entry", () => {
  const ok = pushCompleteInputSchema.safeParse({
    pushTo: { projectSlug: "x", dryRun: true },
    pattern: {
      subtree: [{ id: "a", component: "ws:element", tag: "div", children: [] }],
      repeat: [{ vars: {} }],
    },
  });
  assert.equal(ok.success, true);

  const bad = pushCompleteInputSchema.safeParse({
    pushTo: { projectSlug: "x", dryRun: true },
    pattern: {
      subtree: [{ id: "a", component: "ws:element", tag: "div", children: [] }],
      repeat: [],
    },
  });
  assert.equal(bad.success, false);
});
