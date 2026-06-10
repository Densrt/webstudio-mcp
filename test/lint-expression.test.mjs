// Tests for the pure expression linter (src/lib/lint-expression.ts) + the lintBinding wrapper
// (src/expressions.ts). Mirrors Webstudio's allowlist (SDK 0.268.0).
//
// Policy under test:
//   - parse failure / multiple expressions → severity "error"   (would break the published build)
//   - non-allowlisted method / unsupported construct → severity "warning" (runs at runtime, editor flags it)
//   - clean expression → null

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lintExpression,
  ALLOWED_STRING_METHODS,
  ALLOWED_ARRAY_METHODS,
} from "../dist/lib/lint-expression.js";
import { lintBinding } from "../dist/expressions.js";

// ─── allowlist constants ──────────────────────────────────────────────────────

test("allowlist constants match the SDK 0.268.0 shape (12 string / 5 array)", () => {
  assert.equal(ALLOWED_STRING_METHODS.length, 12);
  assert.equal(ALLOWED_ARRAY_METHODS.length, 5);
  for (const m of ["toLowerCase", "replace", "split", "slice", "at", "includes", "toString"]) {
    assert.ok(ALLOWED_STRING_METHODS.includes(m), `${m} should be allowed`);
  }
  for (const m of ["join", "at", "slice", "includes", "toString"]) {
    assert.ok(ALLOWED_ARRAY_METHODS.includes(m), `${m} should be allowed (array)`);
  }
});

// ─── error: unparseable / multiple expressions (the only hard block) ────────────

test("parse error → severity error, telemetryKey detect:expr-parse-error", () => {
  const r = lintExpression("a +");
  assert.ok(r);
  assert.equal(r.severity, "error");
  assert.equal(r.telemetryKey, "detect:expr-parse-error");
  assert.equal(r.violations[0].type, "parse-error");
});

test("trailing tokens (a; b) → severity error (single expression only)", () => {
  const r = lintExpression("a; b");
  assert.ok(r);
  assert.equal(r.severity, "error");
  assert.equal(r.telemetryKey, "detect:expr-parse-error");
  assert.match(r.message, /single JavaScript expression/);
});

test("comma sequence (a, b) → warning, NOT error (runtime `return (a, b)` evaluates to b, does not throw)", () => {
  // Contrast with "a; b": `return (a; b)` is a SyntaxError at runtime → error. `return (a, b)`
  // is valid and yields `b` → it does not break the page, so it is a (sequence) warning.
  const r = lintExpression("a, b");
  assert.ok(r);
  assert.equal(r.severity, "warning");
  assert.ok(r.violations.some((v) => v.type === "construct" && v.detail === "sequence"));
});

// ─── warning: non-allowlisted methods (run at runtime, editor flags) ────────────

test("toLocaleString → warning method (NOT a block — runs natively at runtime)", () => {
  const r = lintExpression('prix.toLocaleString("fr-FR")');
  assert.ok(r);
  assert.equal(r.severity, "warning");
  assert.equal(r.telemetryKey, "detect:expr-non-allowlisted-method");
  assert.deepEqual(r.violations, [{ type: "method", detail: "toLocaleString" }]);
});

test("toFixed → warning method", () => {
  const r = lintExpression("prix.toFixed(2)");
  assert.equal(r.severity, "warning");
  assert.ok(r.violations.some((v) => v.type === "method" && v.detail === "toFixed"));
});

test("replaceAll → warning method", () => {
  const r = lintExpression('texte_hero.replaceAll("<p>","")');
  assert.equal(r.severity, "warning");
  assert.ok(r.violations.some((v) => v.type === "method" && v.detail === "replaceAll"));
});

test("map + arrow callback → warning, BOTH method:map and construct:arrow-function", () => {
  const r = lintExpression('coloris.map(c => c.nom).join(" / ")');
  assert.equal(r.severity, "warning");
  assert.equal(r.telemetryKey, "detect:expr-non-allowlisted-method");
  assert.ok(r.violations.some((v) => v.type === "method" && v.detail === "map"));
  assert.ok(r.violations.some((v) => v.type === "construct" && v.detail === "arrow-function"));
  // join is allowlisted → must NOT be reported
  assert.ok(!r.violations.some((v) => v.detail === "join"));
});

test("reduce with callback → warning method + arrow", () => {
  const r = lintExpression("items.reduce((a,b) => a + b, 0)");
  assert.equal(r.severity, "warning");
  assert.ok(r.violations.some((v) => v.detail === "reduce"));
});

test("bare function call foo() → warning method (Webstudio: functions not supported)", () => {
  const r = lintExpression("foo(bar)");
  assert.equal(r.severity, "warning");
  assert.ok(r.violations.some((v) => v.type === "method" && v.detail === "foo()"));
});

// ─── warning: unsupported constructs without a method ───────────────────────────

test("`this` → warning construct (key detect:expr-unsupported-construct)", () => {
  const r = lintExpression("this.x");
  assert.ok(r);
  assert.equal(r.severity, "warning");
  assert.equal(r.telemetryKey, "detect:expr-unsupported-construct");
  assert.ok(r.violations.some((v) => v.type === "construct" && v.detail === "this"));
});

test("new Date() → warning construct (new)", () => {
  const r = lintExpression("new Date()");
  assert.equal(r.severity, "warning");
  assert.ok(r.violations.some((v) => v.type === "construct" && v.detail === "new"));
});

// ─── passthrough: clean expressions return null ─────────────────────────────────

test("allowlisted string method chain → null (clean)", () => {
  assert.equal(lintExpression("nom.toLowerCase()"), null);
  assert.equal(lintExpression("nom.toUpperCase().toLowerCase()"), null);
  assert.equal(lintExpression('titre.replace("a","b")'), null);
});

test("allowlisted array method join → null (clean)", () => {
  assert.equal(lintExpression('coloris.join(" / ")'), null);
});

test("split().join() parade → null (the recommended replaceAll alternative)", () => {
  assert.equal(lintExpression('texte_hero.split("<p>").join("")'), null);
});

test("property access without call → null (clean)", () => {
  assert.equal(lintExpression("$ws$dataSource$abc.data.title"), null);
  assert.equal(lintExpression("$ws$dataSource$abc.data.items[0].title"), null);
});

test("encoded dataSource ref with allowlisted method → null (clean)", () => {
  assert.equal(lintExpression("$ws$dataSource$abc__DASH__xyz.data.title.toUpperCase()"), null);
});

// ─── hint quality ───────────────────────────────────────────────────────────────

test("warning hint educates: mentions the allowlist + the pattern doc", () => {
  const r = lintExpression('prix.toLocaleString("fr-FR")');
  assert.match(r.hint, /allowlist|allowed string methods/i);
  assert.match(r.hint, /expression-allowlist/);
});

test("error hint explains the published-build risk", () => {
  const r = lintExpression("a +");
  assert.match(r.hint, /publish|build/i);
});

// ─── lintBinding wrapper ─────────────────────────────────────────────────────────

test("lintBinding: variable / template kinds → null (nothing author-written to lint)", () => {
  assert.equal(lintBinding({ kind: "variable", dataSourceId: "x" }), null);
  assert.equal(lintBinding({ kind: "template", parts: [{ type: "text", value: "Hi" }] }), null);
});

test("lintBinding: raw clean → null; raw with toLocaleString → warning; raw unparseable → error", () => {
  assert.equal(lintBinding({ kind: "raw", expression: "nom.toUpperCase()" }), null);
  assert.equal(lintBinding({ kind: "raw", expression: 'prix.toLocaleString("fr-FR")' }).severity, "warning");
  assert.equal(lintBinding({ kind: "raw", expression: "a +" }).severity, "error");
});

test("lintBinding: raw with dash in dataSourceId is encoded before lint (no false subtraction)", () => {
  // raw expression carrying an un-encoded dash id + an allowlisted method → must stay clean
  const r = lintBinding({ kind: "raw", expression: "$ws$dataSource$ab-cd.data.title.toUpperCase()" });
  assert.equal(r, null);
});
