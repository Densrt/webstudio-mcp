// Unit tests for normalizeState and stateMatches.
// Source of truth for what counts as a valid Webstudio state — keeps the lib aligned
// with packages/css-data/src/__generated__/{pseudo-classes,pseudo-elements}.ts upstream.

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeState, stateMatches, isValidState, resolveStateForWrite } from "../dist/lib/state-whitelist.js";

// ─── normalizeState — base/empty ───────────────────────────────────────────

test("normalizeState: undefined is valid base state", () => {
  const r = normalizeState(undefined);
  assert.equal(r.isValid, true);
  assert.equal(r.canonical, undefined);
});

test("normalizeState: empty string is valid base state", () => {
  const r = normalizeState("");
  assert.equal(r.isValid, true);
  assert.equal(r.canonical, undefined);
});

test("normalizeState: whitespace-only is valid base state", () => {
  const r = normalizeState("   ");
  assert.equal(r.isValid, true);
  assert.equal(r.canonical, undefined);
});

// ─── normalizeState — canonical pseudo-classes ─────────────────────────────

test("normalizeState: :hover is valid pseudo-class", () => {
  const r = normalizeState(":hover");
  assert.equal(r.isValid, true);
  assert.equal(r.canonical, ":hover");
});

test("normalizeState: :focus-visible is valid", () => {
  const r = normalizeState(":focus-visible");
  assert.equal(r.isValid, true);
  assert.equal(r.canonical, ":focus-visible");
});

test("normalizeState: :nth-child(2n) is valid (functional pseudo-class)", () => {
  const r = normalizeState(":nth-child(2n)");
  // The bare-name `nth-child` is in the whitelist; functional usage is accepted.
  // We don't deeply validate the argument syntax.
  assert.equal(r.isValid, true);
});

// ─── normalizeState — canonical pseudo-elements ────────────────────────────

test("normalizeState: ::before is valid pseudo-element", () => {
  const r = normalizeState("::before");
  assert.equal(r.isValid, true);
  assert.equal(r.canonical, "::before");
});

test("normalizeState: ::placeholder is valid pseudo-element", () => {
  const r = normalizeState("::placeholder");
  assert.equal(r.isValid, true);
  assert.equal(r.canonical, "::placeholder");
});

// ─── normalizeState — attribute selectors ──────────────────────────────────

test("normalizeState: [data-state=open] is valid attribute selector", () => {
  const r = normalizeState("[data-state=open]");
  assert.equal(r.isValid, true);
  assert.equal(r.canonical, "[data-state=open]");
});

test("normalizeState: trims whitespace around attribute selector", () => {
  const r = normalizeState("  [aria-expanded=true]  ");
  assert.equal(r.isValid, true);
  assert.equal(r.canonical, "[aria-expanded=true]");
});

// ─── normalizeState — corruption cases ─────────────────────────────────────

test("normalizeState: ::hover is invalid (pseudo-class with double colon)", () => {
  const r = normalizeState("::hover");
  assert.equal(r.isValid, false);
  assert.equal(r.suggestion, ":hover");
  assert.match(r.reason ?? "", /pseudo-class/);
});

test("normalizeState: hover (no colon) is invalid, suggests :hover", () => {
  const r = normalizeState("hover");
  assert.equal(r.isValid, false);
  assert.equal(r.suggestion, ":hover");
});

test("normalizeState: :Hover (wrong case) is invalid, suggests :hover", () => {
  const r = normalizeState(":Hover");
  assert.equal(r.isValid, false);
  assert.equal(r.suggestion, ":hover");
});

test("normalizeState: :before (legacy single-colon pseudo-element) suggests ::before", () => {
  const r = normalizeState(":before");
  assert.equal(r.isValid, false);
  assert.equal(r.suggestion, "::before");
});

test("normalizeState: :first-letter legacy suggests ::first-letter", () => {
  const r = normalizeState(":first-letter");
  assert.equal(r.isValid, false);
  assert.equal(r.suggestion, "::first-letter");
});

test("normalizeState: bare 'before' suggests ::before (legacy pseudo-element)", () => {
  const r = normalizeState("before");
  assert.equal(r.isValid, false);
  assert.equal(r.suggestion, "::before");
});

test("normalizeState: :fake-state is invalid with no suggestion", () => {
  const r = normalizeState(":fake-state");
  assert.equal(r.isValid, false);
  assert.equal(r.suggestion, undefined);
});

test("normalizeState: raw 'fake' (no colon) is invalid", () => {
  const r = normalizeState("fake");
  assert.equal(r.isValid, false);
});

// ─── stateMatches — exact and normalized matching ──────────────────────────

test("stateMatches: undefined vs undefined → true", () => {
  assert.equal(stateMatches(undefined, undefined), true);
});

test("stateMatches: undefined vs :hover → false (caller's responsibility for wildcards)", () => {
  assert.equal(stateMatches(undefined, ":hover"), false);
  assert.equal(stateMatches(":hover", undefined), false);
});

test("stateMatches: :hover === :hover (raw equality)", () => {
  assert.equal(stateMatches(":hover", ":hover"), true);
});

test("stateMatches: stored corrupted ::hover, query :hover → match via normalization", () => {
  assert.equal(stateMatches("::hover", ":hover"), true);
});

test("stateMatches: stored :hover, query corrupted ::hover → also match (symmetric)", () => {
  assert.equal(stateMatches(":hover", "::hover"), true);
});

test("stateMatches: stored corrupted, query exact-raw → match raw-first (escape hatch)", () => {
  // Both literally equal — raw equality returns true even if invalid.
  assert.equal(stateMatches("::hover", "::hover"), true);
  // Both garbage but equal — raw equality wins.
  assert.equal(stateMatches(":fake", ":fake"), true);
});

test("stateMatches: bare 'hover' vs :hover → match via normalization", () => {
  assert.equal(stateMatches("hover", ":hover"), true);
});

test("stateMatches: :Hover (bad case) vs :hover → match via normalization", () => {
  assert.equal(stateMatches(":Hover", ":hover"), true);
});

test("stateMatches: :hover vs :focus → false", () => {
  assert.equal(stateMatches(":hover", ":focus"), false);
});

test("stateMatches: ::before vs :before → match (legacy single-colon)", () => {
  assert.equal(stateMatches("::before", ":before"), true);
});

test("stateMatches: completely unrelated invalid states → false", () => {
  assert.equal(stateMatches(":fakeA", ":fakeB"), false);
});

// ─── isValidState convenience ──────────────────────────────────────────────

test("isValidState: returns boolean shorthand", () => {
  assert.equal(isValidState(undefined), true);
  assert.equal(isValidState(":hover"), true);
  assert.equal(isValidState("::hover"), false);
  assert.equal(isValidState("hover"), false);
});

// ─── resolveStateForWrite — write-boundary coerce-vs-reject ─────────────────

test("resolveStateForWrite: undefined → base, no hint", () => {
  const r = resolveStateForWrite(undefined);
  assert.equal(r.ok, true);
  assert.equal(r.state, undefined);
  assert.equal(r.hint, undefined);
});

test("resolveStateForWrite: empty string → base, no hint", () => {
  const r = resolveStateForWrite("");
  assert.equal(r.ok, true);
  assert.equal(r.state, undefined);
  assert.equal(r.hint, undefined);
});

test("resolveStateForWrite: :hover passthrough, no hint", () => {
  const r = resolveStateForWrite(":hover");
  assert.equal(r.ok, true);
  assert.equal(r.state, ":hover");
  assert.equal(r.hint, undefined);
  assert.equal(r.telemetryKey, undefined);
});

test("resolveStateForWrite: ::before passthrough, no hint", () => {
  const r = resolveStateForWrite("::before");
  assert.equal(r.ok, true);
  assert.equal(r.state, "::before");
  assert.equal(r.hint, undefined);
});

test("resolveStateForWrite: attribute selector passthrough", () => {
  const r = resolveStateForWrite("[data-state=open]");
  assert.equal(r.ok, true);
  assert.equal(r.state, "[data-state=open]");
  assert.equal(r.hint, undefined);
});

test("resolveStateForWrite: bare 'hover' coerced → :hover with hint + telemetryKey", () => {
  const r = resolveStateForWrite("hover");
  assert.equal(r.ok, true);
  assert.equal(r.state, ":hover");
  assert.equal(r.from, "hover");
  assert.equal(r.telemetryKey, "coerce:stateSelector");
  assert.ok(r.hint && r.hint.includes(":hover"));
});

test("resolveStateForWrite: ':Hover' wrong case coerced → :hover", () => {
  const r = resolveStateForWrite(":Hover");
  assert.equal(r.ok, true);
  assert.equal(r.state, ":hover");
  assert.equal(r.telemetryKey, "coerce:stateSelector");
});

test("resolveStateForWrite: legacy ':before' coerced → ::before", () => {
  const r = resolveStateForWrite(":before");
  assert.equal(r.ok, true);
  assert.equal(r.state, "::before");
  assert.ok(r.hint);
});

test("resolveStateForWrite: '::hover' (pseudo-class w/ double colon) coerced → :hover", () => {
  const r = resolveStateForWrite("::hover");
  assert.equal(r.ok, true);
  assert.equal(r.state, ":hover");
  assert.ok(r.hint);
});

test("resolveStateForWrite: ':fake-state' unrecoverable → ok:false with error", () => {
  const r = resolveStateForWrite(":fake-state");
  assert.equal(r.ok, false);
  assert.ok(r.error && r.error.includes("invalid state"));
});

test("resolveStateForWrite: bare 'zzz' unrecoverable → ok:false", () => {
  const r = resolveStateForWrite("zzz");
  assert.equal(r.ok, false);
  assert.ok(r.error);
});
