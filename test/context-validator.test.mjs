// Unit tests for context-validator — chantier 2 (v1.0 prep).

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateContext } from "../dist/lib/context-validator.js";

// ─── happy path ────────────────────────────────────────────────────────────

test("validateContext: valid 15-25 word third-person context passes", () => {
  const ctx = "The caller wants to delete legacy pages that are no longer linked from the navigation menu after the redesign.";
  const r = validateContext(ctx, "CRITICAL");
  assert.equal(r.ok, true);
});

test("validateContext: TACTICAL with undefined context passes (no friction)", () => {
  const r = validateContext(undefined, "TACTICAL");
  assert.equal(r.ok, true);
});

test("validateContext: READ-ONLY with undefined context passes", () => {
  const r = validateContext(undefined, "READ-ONLY");
  assert.equal(r.ok, true);
});

test("validateContext: STRUCTURING with undefined context passes with hint", () => {
  const r = validateContext(undefined, "STRUCTURING");
  assert.equal(r.ok, true);
  assert.ok(r.ok && r.hint && r.hint.includes("STRUCTURING"));
});

// ─── CRITICAL enforcement ──────────────────────────────────────────────────

test("validateContext: CRITICAL with undefined context refused with code", () => {
  const r = validateContext(undefined, "CRITICAL");
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.code, "CONTEXT_REQUIRED_FOR_CRITICAL");
});

test("validateContext: CRITICAL with empty string refused", () => {
  const r = validateContext("", "CRITICAL");
  assert.equal(r.ok, false);
});

// ─── format violations ─────────────────────────────────────────────────────

test("validateContext: under 15 words refused", () => {
  const r = validateContext("Too short context here only twelve words this is not enough for", "TACTICAL");
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.code, "CONTEXT_INVALID_FORMAT");
  assert.match(r.ok === false ? r.error : "", /too short/);
});

test("validateContext: over 25 words refused", () => {
  const ctx = "this context is intentionally crafted to be very long and exceed the upper limit of twenty five words which the validator should refuse with a clear error message saying so";
  const r = validateContext(ctx, "TACTICAL");
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /too long/);
});

test("validateContext: first-person 'I' refused", () => {
  const ctx = "I want to delete legacy pages that are no longer linked from the navigation menu after the redesign of the home.";
  const r = validateContext(ctx, "TACTICAL");
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /third-person/);
});

test("validateContext: first-person 'we' refused", () => {
  const ctx = "we are removing legacy pages because they are no longer linked from the navigation after the recent redesign push of the site";
  const r = validateContext(ctx, "TACTICAL");
  assert.equal(r.ok, false);
});

test("validateContext: PII email refused", () => {
  const ctx = "The caller wants to delete pages owned by admin@example.com that are no longer linked from any navigation menu";
  const r = validateContext(ctx, "TACTICAL");
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /PII/);
});

test("validateContext: secret keyword refused", () => {
  const ctx = "The caller wants to update the page meta and inject a token into the description field for tracking purposes only this time";
  const r = validateContext(ctx, "TACTICAL");
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /secret|credential/);
});
