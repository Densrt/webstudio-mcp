// Coerce / normalize / complete pipeline on create_tokens — parity with update_token_styles.
//
// a production site (2026-06-03): a "Card" component token created via create_tokens with a
// partial transition (3 of 5 longhands, unparsed) was stored as-is — the Transition panel fell
// back to defaults and the hover effect did not apply. create_tokens used to only expand
// shorthands (expandStylesMap); it now runs the full pipeline like every other style route.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTokenStyles,
  buildTokenPatches,
} from "../dist/tools/create-token/shared.js";
import { planCreateTokens } from "../dist/tools/create-tokens/build-patches.js";

const emptyBuild = {
  id: "b",
  projectId: "p",
  pages: { meta: { name: "" }, homePage: { id: "h", path: "/", name: "home" }, pages: [] },
  instances: [],
  styleSources: [],
  styleSourceSelections: [],
  props: [],
  styles: [],
  breakpoints: [{ id: "bp-base", label: "Base" }],
  dataSources: [],
  resources: [],
  assets: [],
};

const TRANSITION_LONGHANDS = [
  "transitionBehavior", "transitionDelay", "transitionDuration",
  "transitionProperty", "transitionTimingFunction",
];

// ─── normalizeTokenStyles: transition / animation completion ──────────────────

test("normalizeTokenStyles: 3 partial transition longhands → 5 complete layers", () => {
  const r = normalizeTokenStyles({
    transitionProperty: { type: "unparsed", value: "border-color" },
    transitionDuration: { type: "unparsed", value: "0.2s" },
    transitionTimingFunction: { type: "unparsed", value: "ease" },
  }, []);
  assert.deepEqual(Object.keys(r.decls).sort(), TRANSITION_LONGHANDS);
  for (const k of TRANSITION_LONGHANDS) assert.equal(r.decls[k].type, "layers");
  assert.ok(r.events.some((e) => e.key === "coerce:completeTransitionLonghands"));
});

test("normalizeTokenStyles: 2 partial animation longhands → 8 complete layers", () => {
  const r = normalizeTokenStyles({
    animationName: { type: "unparsed", value: "fade" },
    animationDuration: { type: "unparsed", value: "300ms" },
  }, []);
  assert.equal(Object.keys(r.decls).length, 8);
  for (const v of Object.values(r.decls)) assert.equal(v.type, "layers");
  assert.ok(r.events.some((e) => e.key === "coerce:completeAnimationLonghands"));
});

// ─── normalizeTokenStyles: color normalization ────────────────────────────────

test("normalizeTokenStyles: internal color (0..1) → wire rgb, no event", () => {
  const r = normalizeTokenStyles({
    color: { type: "color", colorSpace: "rgb", components: [1, 0, 0], alpha: 1 },
  }, []);
  assert.deepEqual(r.decls.color, { type: "rgb", r: 255, g: 0, b: 0, alpha: 1 });
  assert.equal(r.events.length, 0);
});

test("normalizeTokenStyles: legacy 0..255 color → wire rgb + telemetry hint", () => {
  const r = normalizeTokenStyles({
    color: { type: "color", colorSpace: "rgb", components: [255, 0, 0], alpha: 1 },
  }, []);
  assert.equal(r.decls.color.type, "rgb");
  assert.ok(r.events.some((e) => e.key === "coerce:colorRgb-legacy-0-255" && e.property === "color"));
});

// ─── normalizeTokenStyles: pre-flight validation ──────────────────────────────

test("normalizeTokenStyles: boxShadow var() unparsed → validationError, no decls", () => {
  const r = normalizeTokenStyles({
    boxShadow: { type: "unparsed", value: "var(--shadow)" },
  }, []);
  assert.ok(r.validationError);
  assert.match(r.validationError, /boxShadow/);
  assert.deepEqual(r.decls, {});
});

// ─── normalizeTokenStyles: passthrough ────────────────────────────────────────

test("normalizeTokenStyles: plain keyword passes through untouched, no event", () => {
  const v = { type: "keyword", value: "red" };
  const r = normalizeTokenStyles({ color: v }, []);
  assert.deepEqual(r.decls, { color: v });
  assert.equal(r.events.length, 0);
});

// ─── normalizeTokenStyles: overwrite cohort (existing decls) ──────────────────

test("normalizeTokenStyles: existing transitionProperty is not re-emitted; missing longhands completed", () => {
  const existing = [
    { property: "transitionProperty", value: { type: "layers", value: [{ type: "unparsed", value: "color" }] } },
  ];
  const r = normalizeTokenStyles({ transitionDuration: { type: "unparsed", value: "200ms" } }, existing);
  const keys = Object.keys(r.decls).sort();
  // transitionProperty lives in `existing` (already on the token) → NOT rewritten.
  assert.ok(!keys.includes("transitionProperty"));
  // incoming + the 3 missing longhands get produced.
  assert.deepEqual(keys, ["transitionBehavior", "transitionDelay", "transitionDuration", "transitionTimingFunction"]);
  for (const k of keys) assert.equal(r.decls[k].type, "layers");
});

// ─── buildTokenPatches integration ────────────────────────────────────────────

test("buildTokenPatches: partial transition → 5 longhand layer stylePatches + coerceEvents", () => {
  const res = buildTokenPatches(emptyBuild, {
    name: "Card",
    styles: {
      transitionProperty: { type: "unparsed", value: "border-color" },
      transitionDuration: { type: "unparsed", value: "0.2s" },
      transitionTimingFunction: { type: "unparsed", value: "ease" },
    },
    breakpointId: "bp-base",
    overwrite: false,
  });
  assert.ok(!("validationError" in res));
  assert.equal(res.stylePatches.length, 5);
  assert.deepEqual(res.stylePatches.map((p) => p.value.property).sort(), TRANSITION_LONGHANDS);
  assert.ok(res.stylePatches.every((p) => p.value.value.type === "layers"));
  assert.ok(res.coerceEvents.some((e) => e.key === "coerce:completeTransitionLonghands"));
});

test("buildTokenPatches: boxShadow var() unparsed → validationError (no patches)", () => {
  const res = buildTokenPatches(emptyBuild, {
    name: "Bad",
    styles: { boxShadow: { type: "unparsed", value: "var(--x)" } },
    breakpointId: "bp-base",
    overwrite: false,
  });
  assert.ok("validationError" in res);
  assert.match(res.validationError, /boxShadow/);
});

// ─── planCreateTokens: continueOnError routing + tagged coerceEvents ───────────

test("planCreateTokens: invalid token → failed; valid token still succeeds with tagged events", () => {
  const plan = planCreateTokens(emptyBuild, {
    tokens: [
      { name: "Card", styles: { transitionProperty: { type: "unparsed", value: "color" }, transitionDuration: { type: "unparsed", value: "0.2s" } } },
      { name: "Bad", styles: { boxShadow: { type: "unparsed", value: "var(--x)" } } },
    ],
    breakpoint: "Base",
    overwrite: false,
    continueOnError: true,
    strict: false,
  });
  assert.equal(plan.succeeded.length, 1);
  assert.equal(plan.succeeded[0].name, "Card");
  assert.equal(plan.failed.length, 1);
  assert.equal(plan.failed[0].name, "Bad");
  assert.match(plan.failed[0].reason, /invalid style value/);
  assert.ok(plan.coerceEvents.some((e) => e.tokenName === "Card" && e.key === "coerce:completeTransitionLonghands"));
});
