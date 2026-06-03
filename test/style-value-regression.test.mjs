// Regression tests for lib/style-coerce — auto-coerce of unparsed StyleValues to the canonical
// tuple/layers shapes expected by the Webstudio Style panel UI.
// Covers commits 298e30e (tuple/function coerce) and 79db85a (transition layers + longhand
// auto-completion).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  coerceStyleValue,
  coerceStyleValueWithMeta,
  coerceComposedSingleToLayers,
  ensureTransitionLonghands,
  ensureAnimationLonghands,
  completeTransitionAnimationLonghands,
  isComposedProperty,
  isShadowProperty,
  isCustomProperty,
  applyListedDefault,
  validateStyleValue,
  assertValidStyleValue,
} from "../dist/lib/style-coerce.js";

// ─── isComposedProperty ──────────────────────────────────────────────────────

test("isComposedProperty: tuple properties", () => {
  for (const p of ["filter", "backdropFilter", "transform", "willChange"]) {
    assert.equal(isComposedProperty(p), true, `${p} should be composed`);
  }
});

test("isComposedProperty: transition longhands", () => {
  for (const p of ["transitionProperty", "transitionDuration", "transitionTimingFunction",
                   "transitionDelay", "transitionBehavior"]) {
    assert.equal(isComposedProperty(p), true, `${p} should be composed`);
  }
});

test("isComposedProperty: non-composed properties", () => {
  for (const p of ["color", "width", "margin", "fontSize"]) {
    assert.equal(isComposedProperty(p), false, `${p} should NOT be composed`);
  }
});

// ─── coerceStyleValue — tuple shape (filter, transform, backdropFilter) ──────

test("coerceStyleValue: filter unparsed → tuple of functions", () => {
  const out = coerceStyleValue("filter", { type: "unparsed", value: "blur(8px) brightness(1.1)" });
  assert.equal(out.type, "tuple");
  assert.equal(out.value.length, 2);
  assert.equal(out.value[0].type, "function");
  assert.equal(out.value[0].name, "blur");
  assert.equal(out.value[1].name, "brightness");
});

test("coerceStyleValue: backdropFilter single function → tuple[function]", () => {
  const out = coerceStyleValue("backdropFilter", { type: "unparsed", value: "blur(12.75px)" });
  assert.equal(out.type, "tuple");
  assert.equal(out.value.length, 1);
  assert.equal(out.value[0].type, "function");
  assert.equal(out.value[0].name, "blur");
});

test("coerceStyleValue: transform multi-function → tuple", () => {
  const out = coerceStyleValue("transform", {
    type: "unparsed",
    value: "translateX(10px) rotate(45deg)",
  });
  assert.equal(out.type, "tuple");
  assert.equal(out.value.length, 2);
  assert.equal(out.value[0].name, "translateX");
  assert.equal(out.value[1].name, "rotate");
});

test("coerceStyleValue: willChange comma-separated → tuple of keywords", () => {
  const out = coerceStyleValue("willChange", { type: "unparsed", value: "transform, opacity" });
  assert.equal(out.type, "tuple");
  assert.equal(out.value.length, 2);
  assert.equal(out.value[0].type, "keyword");
  assert.equal(out.value[0].value, "transform");
});

// ─── coerceStyleValue — layers shape (transition / animation) ────────────────

test("coerceStyleValue: transitionProperty → layers of unparsed", () => {
  const out = coerceStyleValue("transitionProperty", { type: "unparsed", value: "opacity, transform" });
  assert.equal(out.type, "layers");
  assert.equal(out.value.length, 2);
  assert.equal(out.value[0].type, "unparsed");
  assert.equal(out.value[0].value, "opacity");
});

test("coerceStyleValue: transitionDuration → layers of unit(ms)", () => {
  const out = coerceStyleValue("transitionDuration", { type: "unparsed", value: "200ms, 350ms" });
  assert.equal(out.type, "layers");
  assert.equal(out.value.length, 2);
  assert.equal(out.value[0].type, "unit");
  assert.equal(out.value[0].value, 200);
  assert.equal(out.value[1].value, 350);
});

test("coerceStyleValue: transitionTimingFunction keyword → layers of keyword", () => {
  const out = coerceStyleValue("transitionTimingFunction", { type: "unparsed", value: "ease, linear" });
  assert.equal(out.type, "layers");
  assert.equal(out.value.length, 2);
  assert.equal(out.value[0].type, "keyword");
});

test("coerceStyleValue: animationName → layers of unparsed", () => {
  const out = coerceStyleValue("animationName", { type: "unparsed", value: "fadeIn, slideUp" });
  assert.equal(out.type, "layers");
  assert.equal(out.value.length, 2);
  assert.equal(out.value[0].value, "fadeIn");
});

// ─── B1 — Individual transform props (translate/scale/rotate) — a production site 2026-05-21 ─

test("isComposedProperty: individual transform props (translate/scale/rotate)", () => {
  for (const p of ["translate", "scale", "rotate"]) {
    assert.equal(isComposedProperty(p), true, `${p} should be composed`);
  }
});

test("coerceStyleValue: scale unparsed '1.2' → tuple[unit]", () => {
  const out = coerceStyleValue("scale", { type: "unparsed", value: "1.2" });
  assert.equal(out.type, "tuple");
  assert.equal(out.value.length, 1);
  assert.equal(out.value[0].type, "unit");
  assert.equal(out.value[0].value, 1.2);
});

test("coerceStyleValue: scale unparsed 'var(--brand-logo-scale)' → tuple[var] (no function wrap)", () => {
  const out = coerceStyleValue("scale", { type: "unparsed", value: "var(--brand-logo-scale)" });
  assert.equal(out.type, "tuple");
  assert.equal(out.value[0].type, "var");
  assert.equal(out.value[0].value, "brand-logo-scale");
});

test("coerceStyleValue: translate unparsed '10px 20px' → tuple[unit, unit]", () => {
  const out = coerceStyleValue("translate", { type: "unparsed", value: "10px 20px" });
  assert.equal(out.type, "tuple");
  assert.equal(out.value.length, 2);
  assert.equal(out.value[0].value, 10);
  assert.equal(out.value[1].value, 20);
});

test("coerceStyleValue: rotate unparsed '45deg' → tuple[unit deg]", () => {
  const out = coerceStyleValue("rotate", { type: "unparsed", value: "45deg" });
  assert.equal(out.type, "tuple");
  assert.equal(out.value[0].unit, "deg");
});

// ─── B2 — CSS custom properties auto listed:true ─────────────────────────────

test("isCustomProperty: --foo → true", () => {
  assert.equal(isCustomProperty("--brand-logo-scale"), true);
  assert.equal(isCustomProperty("color"), false);
  assert.equal(isCustomProperty(""), false);
});

test("applyListedDefault: --foo + undefined → true", () => {
  assert.equal(applyListedDefault("--brand-logo-scale", undefined), true);
});

test("applyListedDefault: --foo + explicit false → false (caller opt-out)", () => {
  assert.equal(applyListedDefault("--brand-logo-scale", false), false);
});

test("applyListedDefault: regular property + undefined → undefined (no change)", () => {
  assert.equal(applyListedDefault("color", undefined), undefined);
});

// ─── B3 — Reject transform:tuple[function(var)] with hint to modern props ─────

test("validateStyleValue: transform tuple[function(scale, [var])] → error with hint", () => {
  const value = {
    type: "tuple",
    value: [
      {
        type: "function",
        name: "scale",
        args: { type: "tuple", value: [{ type: "var", value: "brand-logo-scale" }] },
      },
    ],
  };
  const err = validateStyleValue("transform", value);
  assert.ok(err, "should return error");
  assert.match(err, /transform/i);
  assert.match(err, /scale/);
  assert.match(err, /individual transform property/);
});

test("validateStyleValue: transform tuple[function(translateY, [unit])] → OK (no var)", () => {
  const value = {
    type: "tuple",
    value: [
      {
        type: "function",
        name: "translateY",
        args: { type: "tuple", value: [{ type: "unit", value: -6, unit: "px" }] },
      },
    ],
  };
  assert.equal(validateStyleValue("transform", value), null);
});

// ─── coerceStyleValue — var() refs in transition/animation (a production site 2026-05-21) ─

test("coerceStyleValue: transitionDuration var() → layers[var] (no silent fallback to 0ms)", () => {
  const out = coerceStyleValue("transitionDuration", { type: "unparsed", value: "var(--brand-transition-fast)" });
  assert.equal(out.type, "layers");
  assert.equal(out.value.length, 1);
  assert.equal(out.value[0].type, "var");
  assert.equal(out.value[0].value, "brand-transition-fast");
});

test("coerceStyleValue: transitionTimingFunction var() → layers[var] (not keyword)", () => {
  const out = coerceStyleValue("transitionTimingFunction", { type: "unparsed", value: "var(--brand-easing-default)" });
  assert.equal(out.type, "layers");
  assert.equal(out.value[0].type, "var");
  assert.equal(out.value[0].value, "brand-easing-default");
});

test("coerceStyleValue: animationDuration var() → layers[var]", () => {
  const out = coerceStyleValue("animationDuration", { type: "unparsed", value: "var(--anim-dur)" });
  assert.equal(out.value[0].type, "var");
});

// ─── coerceStyleValue — pass-through cases ──────────────────────────────────

test("coerceStyleValue: non-composed property pass-through", () => {
  const v = { type: "unit", value: 10, unit: "px" };
  assert.deepEqual(coerceStyleValue("width", v), v);
});

test("coerceStyleValue: already-tuple value pass-through", () => {
  const v = { type: "tuple", value: [{ type: "keyword", value: "transform" }] };
  assert.deepEqual(coerceStyleValue("willChange", v), v);
});

// ─── ensureTransitionLonghands ───────────────────────────────────────────────

test("ensureTransitionLonghands: fills missing longhands with defaults at right layer count", () => {
  const decls = {
    transitionProperty: { type: "layers", value: [
      { type: "unparsed", value: "opacity" },
      { type: "unparsed", value: "transform" },
    ]},
    transitionDuration: { type: "layers", value: [
      { type: "unit", value: 200, unit: "ms" },
      { type: "unit", value: 350, unit: "ms" },
    ]},
  };
  const extras = ensureTransitionLonghands(decls);
  // 3 longhands missing : TimingFunction, Delay, Behavior — all should be added with 2 layers
  assert.ok(extras.transitionTimingFunction, "TimingFunction should be added");
  assert.ok(extras.transitionDelay, "Delay should be added");
  assert.ok(extras.transitionBehavior, "Behavior should be added");
  assert.equal(extras.transitionTimingFunction.value.length, 2);
  assert.equal(extras.transitionDelay.value.length, 2);
  assert.equal(extras.transitionBehavior.value.length, 2);
});

test("ensureTransitionLonghands: pads short layers to match longest", () => {
  const decls = {
    transitionProperty: { type: "layers", value: [
      { type: "unparsed", value: "opacity" },
      { type: "unparsed", value: "transform" },
    ]},
    transitionDuration: { type: "layers", value: [{ type: "unit", value: 200, unit: "ms" }] },
  };
  const extras = ensureTransitionLonghands(decls);
  assert.ok(extras.transitionDuration, "Duration should be padded");
  assert.equal(extras.transitionDuration.value.length, 2);
});

test("ensureTransitionLonghands: returns {} if no transition decl present", () => {
  const extras = ensureTransitionLonghands({});
  assert.deepEqual(extras, {});
});

// ─── ensureAnimationLonghands ────────────────────────────────────────────────

test("ensureAnimationLonghands: fills 7 missing longhands when only animationName present", () => {
  const decls = {
    animationName: { type: "layers", value: [{ type: "unparsed", value: "fadeIn" }] },
  };
  const extras = ensureAnimationLonghands(decls);
  // 7 longhands should be added
  assert.equal(Object.keys(extras).length, 7);
  for (const key of ["animationDuration", "animationTimingFunction", "animationDelay",
                     "animationIterationCount", "animationDirection", "animationFillMode",
                     "animationPlayState"]) {
    assert.ok(extras[key], `${key} should be added`);
    assert.equal(extras[key].value.length, 1);
  }
});

// ─── completeTransitionAnimationLonghands ────────────────────────────────────

test("completeTransitionAnimationLonghands: merges existing + incoming, injects missing", () => {
  const existing = [
    { property: "transitionProperty", value: { type: "layers", value: [{ type: "unparsed", value: "opacity" }] } },
  ];
  const incoming = [
    { property: "transitionDuration", value: { type: "layers", value: [{ type: "unit", value: 200, unit: "ms" }] } },
  ];
  const result = completeTransitionAnimationLonghands(existing, incoming);
  // Should include the original incoming + 3 additional longhands (TimingFunction, Delay, Behavior)
  // transitionProperty stays in existing, not duplicated in incoming
  const props = result.map((d) => d.property);
  assert.ok(props.includes("transitionDuration"));
  assert.ok(props.includes("transitionTimingFunction"));
  assert.ok(props.includes("transitionDelay"));
  assert.ok(props.includes("transitionBehavior"));
});

// ─── BUG #2 fix (prod template-acme 2026-05-20) ───────────────────────────
// Webstudio Cloud silently drops boxShadow/textShadow with {type:"unparsed", value:"var(...)"}.
// We refuse this at the MCP boundary with an explicit error pointing to the structured shape.

test("isShadowProperty: shadow properties", () => {
  for (const p of ["boxShadow", "textShadow", "WebkitBoxShadow"]) {
    assert.equal(isShadowProperty(p), true, `${p} should be a shadow property`);
  }
  assert.equal(isShadowProperty("color"), false);
  assert.equal(isShadowProperty("filter"), false);
});

test("validateStyleValue: boxShadow with unparsed var() is rejected", () => {
  const err = validateStyleValue("boxShadow", { type: "unparsed", value: "var(--acme-shadow-card)" });
  assert.ok(err, "should return an error message");
  assert.match(err, /silently ignored/i);
  assert.match(err, /layers/);
  assert.match(err, /shadow/);
  // Error must include a concrete example
  assert.match(err, /offsetX/);
});

test("validateStyleValue: textShadow with unparsed var() is rejected (different example)", () => {
  const err = validateStyleValue("textShadow", { type: "unparsed", value: "var(--text-shadow-base)" });
  assert.ok(err);
  assert.match(err, /textShadow/);
});

test("validateStyleValue: boxShadow with structured layers value is OK", () => {
  const ok = validateStyleValue("boxShadow", {
    type: "layers",
    value: [{
      type: "shadow",
      position: "outset",
      offsetX: { type: "unit", value: 0, unit: "px" },
      offsetY: { type: "unit", value: 4, unit: "px" },
      blur: { type: "unit", value: 12, unit: "px" },
      spread: { type: "unit", value: 0, unit: "px" },
      color: { type: "rgb", r: 0, g: 0, b: 0, alpha: 0.25 },
    }],
  });
  assert.equal(ok, null);
});

test("validateStyleValue: boxShadow with unparsed raw shadow string is OK (not a var())", () => {
  // We only block var() — raw shorthand strings may still be accepted by Webstudio
  // (the panel decoder is lenient on actual shadow tokens). Don't over-restrict.
  const ok = validateStyleValue("boxShadow", { type: "unparsed", value: "0 4px 12px rgba(0,0,0,0.25)" });
  assert.equal(ok, null);
});

test("validateStyleValue: non-shadow property with var() is OK", () => {
  const ok = validateStyleValue("color", { type: "unparsed", value: "var(--brand)" });
  assert.equal(ok, null);
});

test("assertValidStyleValue: throws on invalid shadow + var()", () => {
  assert.throws(
    () => assertValidStyleValue("boxShadow", { type: "unparsed", value: "var(--x)" }),
    /silently ignored/i,
  );
});

test("assertValidStyleValue: does not throw on valid value", () => {
  assert.doesNotThrow(() => assertValidStyleValue("color", { type: "keyword", value: "red" }));
});

// ─── single typed value wrap-to-layers (v2.7.10) ─────────────────────────────
// Callers sometimes push transition*/animation* longhands as already-typed singles
// ({type:"var"}, {type:"keyword"}, {type:"unit"}) instead of layers[1] or unparsed.
// Webstudio's Transition/Animation panels only decode layers[]; raw singles are
// silently ignored by the UI. The coerce wraps them so the panel renders.

test("coerceComposedSingleToLayers: transitionDuration {type:'var'} → layers[1] with var preserved", () => {
  const inp = { type: "var", value: "speed-fast" };
  const out = coerceComposedSingleToLayers("transitionDuration", inp);
  assert.equal(out.coerced, true);
  assert.equal(out.value.type, "layers");
  assert.equal(out.value.value.length, 1);
  assert.equal(out.value.value[0].type, "var");
  assert.equal(out.value.value[0].value, "speed-fast");
});

test("coerceComposedSingleToLayers: transitionTimingFunction {type:'keyword'} → layers[1]", () => {
  const inp = { type: "keyword", value: "ease-in-out" };
  const out = coerceComposedSingleToLayers("transitionTimingFunction", inp);
  assert.equal(out.coerced, true);
  assert.equal(out.value.type, "layers");
  assert.deepEqual(out.value.value[0], { type: "keyword", value: "ease-in-out" });
});

test("coerceComposedSingleToLayers: transitionDuration {type:'unit'} → layers[1]", () => {
  const inp = { type: "unit", value: 200, unit: "ms" };
  const out = coerceComposedSingleToLayers("transitionDuration", inp);
  assert.equal(out.coerced, true);
  assert.equal(out.value.type, "layers");
  assert.deepEqual(out.value.value[0], { type: "unit", value: 200, unit: "ms" });
});

test("coerceComposedSingleToLayers: animationTimingFunction {type:'function'} (cubic-bezier) → layers[1]", () => {
  const inp = { type: "function", name: "cubic-bezier", args: { type: "tuple", value: [
    { type: "unit", value: 0.4, unit: "number" },
    { type: "unit", value: 0, unit: "number" },
    { type: "unit", value: 0.2, unit: "number" },
    { type: "unit", value: 1, unit: "number" },
  ]}};
  const out = coerceComposedSingleToLayers("animationTimingFunction", inp);
  assert.equal(out.coerced, true);
  assert.equal(out.value.type, "layers");
  assert.equal(out.value.value[0].type, "function");
  assert.equal(out.value.value[0].name, "cubic-bezier");
});

test("coerceComposedSingleToLayers: already layers → passthrough (no double-wrap)", () => {
  const inp = { type: "layers", value: [{ type: "var", value: "speed-fast" }] };
  const out = coerceComposedSingleToLayers("transitionDuration", inp);
  assert.equal(out.coerced, false);
  assert.strictEqual(out.value, inp);
});

test("coerceComposedSingleToLayers: tuple shape left alone (validator's job to flag)", () => {
  // Tuple is wrong shape for transition* — but the pure helper doesn't silently
  // rewrite it. Let validateStyleValue / panel error surface the mismatch.
  const inp = { type: "tuple", value: [{ type: "var", value: "speed-fast" }] };
  const out = coerceComposedSingleToLayers("transitionDuration", inp);
  assert.equal(out.coerced, false);
  assert.strictEqual(out.value, inp);
});

test("coerceComposedSingleToLayers: non-transition/animation prop is NOT wrapped (transform left alone)", () => {
  // The single-to-layers wrap is intentionally scoped to transition/animation only.
  // transform / filter / backdropFilter / individual transforms use tuple, not layers.
  const inp = { type: "var", value: "scale-factor" };
  const out = coerceComposedSingleToLayers("transform", inp);
  assert.equal(out.coerced, false);
  assert.strictEqual(out.value, inp);
});

test("coerceStyleValue: transitionDuration {type:'var'} (already typed) → layers[1] with var preserved", () => {
  // Bug fix v2.7.10: previously, the early-return `if (value.type !== "unparsed") return value`
  // skipped any pre-typed value. Callers passing {type:"var"} direct got their decl through
  // unchanged, then the Webstudio UI Transition panel ignored it (single var ≠ layers).
  const out = coerceStyleValue("transitionDuration", { type: "var", value: "speed-fast" });
  assert.equal(out.type, "layers");
  assert.equal(out.value.length, 1);
  assert.equal(out.value[0].type, "var");
  assert.equal(out.value[0].value, "speed-fast");
});

test("coerceStyleValue: animationName {type:'keyword'} → layers[1]", () => {
  const out = coerceStyleValue("animationName", { type: "keyword", value: "fade-in" });
  assert.equal(out.type, "layers");
  assert.deepEqual(out.value[0], { type: "keyword", value: "fade-in" });
});

test("coerceStyleValueWithMeta: emits hint + telemetryKey on single-to-layers wrap", () => {
  const out = coerceStyleValueWithMeta("transitionTimingFunction", { type: "var", value: "easing-default" });
  assert.equal(out.value.type, "layers");
  assert.ok(out.hint, "hint should be emitted");
  assert.match(out.hint, /transitionTimingFunction/);
  assert.match(out.hint, /layers\[1\]/);
  assert.equal(out.telemetryKey, "coerce:composedSingleToLayers");
});

test("coerceStyleValueWithMeta: no hint when input is already layers", () => {
  const out = coerceStyleValueWithMeta("transitionDuration", {
    type: "layers",
    value: [{ type: "var", value: "speed-fast" }],
  });
  assert.equal(out.value.type, "layers");
  assert.equal(out.hint, undefined);
  assert.equal(out.telemetryKey, undefined);
});

test("coerceStyleValueWithMeta: no hint when input is unparsed (route 1 — parser path)", () => {
  const out = coerceStyleValueWithMeta("transitionDuration", { type: "unparsed", value: "var(--speed-fast)" });
  // The unparsed→parsed route is the canonical path; no new hint emitted here
  // (existing route already wraps via coerceTransition, no education needed).
  assert.equal(out.value.type, "layers");
  assert.equal(out.hint, undefined);
});

test("coerceStyleValueWithMeta: no hint for non-composed property", () => {
  const out = coerceStyleValueWithMeta("color", { type: "keyword", value: "red" });
  assert.equal(out.value.type, "keyword");
  assert.equal(out.hint, undefined);
});

// ─── completer regression: push-complete cloudTokens path (v2.7.10) ──────────
// preprocessTokens used to call expandStylesMap WITHOUT calling
// completeTransitionAnimationLonghands. Callers pushing 3 of the 5 transition longhands
// got a cohort where the UI panel read defaults (0ms, ease, normal) and ignored the push.

test("completer: existing=[], incoming has 3 transition longhands → 5 returned, all length-1", () => {
  const incoming = [
    { property: "transitionProperty", value: { type: "layers", value: [{ type: "unparsed", value: "color" }] } },
    { property: "transitionDuration", value: { type: "layers", value: [{ type: "var", value: "speed-fast" }] } },
    { property: "transitionTimingFunction", value: { type: "layers", value: [{ type: "var", value: "easing-default" }] } },
  ];
  const out = completeTransitionAnimationLonghands([], incoming);
  const props = out.map((d) => d.property).sort();
  assert.deepEqual(props, [
    "transitionBehavior",
    "transitionDelay",
    "transitionDuration",
    "transitionProperty",
    "transitionTimingFunction",
  ]);
  // All longhands should be layers[1] (matching the incoming count).
  for (const d of out) {
    assert.equal(d.value.type, "layers", `${d.property} should be layers`);
    assert.equal(d.value.value.length, 1, `${d.property} should have 1 layer`);
  }
  // Vars preserved in the original incoming longhands.
  const dur = out.find((d) => d.property === "transitionDuration");
  assert.equal(dur.value.value[0].type, "var");
  assert.equal(dur.value.value[0].value, "speed-fast");
});

test("completer: existing=[], incoming has only animationDuration → 8 returned, all length-1", () => {
  const incoming = [
    { property: "animationDuration", value: { type: "layers", value: [{ type: "unit", value: 500, unit: "ms" }] } },
  ];
  const out = completeTransitionAnimationLonghands([], incoming);
  assert.equal(out.length, 8);
  const props = out.map((d) => d.property).sort();
  assert.deepEqual(props, [
    "animationDelay",
    "animationDirection",
    "animationDuration",
    "animationFillMode",
    "animationIterationCount",
    "animationName",
    "animationPlayState",
    "animationTimingFunction",
  ]);
  for (const d of out) {
    assert.equal(d.value.type, "layers");
    assert.equal(d.value.value.length, 1);
  }
});

test("completer: existing has transition layers[3], incoming adds 1 layer var → upgraded to 3 layers", () => {
  // Regression: when existing cohort has N layers and incoming adds a single var,
  // the incoming should be padded to N layers (var + defaults), not collapsed to 1.
  const existing = [
    { property: "transitionProperty", value: { type: "layers", value: [
      { type: "unparsed", value: "color" },
      { type: "unparsed", value: "background-color" },
      { type: "unparsed", value: "transform" },
    ]}},
  ];
  const incoming = [
    { property: "transitionDuration", value: { type: "layers", value: [{ type: "var", value: "speed-fast" }] } },
  ];
  const out = completeTransitionAnimationLonghands(existing, incoming);
  const dur = out.find((d) => d.property === "transitionDuration");
  assert.ok(dur);
  assert.equal(dur.value.type, "layers");
  assert.equal(dur.value.value.length, 3, "incoming should be padded to match existing layer count");
  assert.equal(dur.value.value[0].type, "var", "first layer is the incoming var");
  assert.equal(dur.value.value[0].value, "speed-fast");
});
