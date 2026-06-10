// Pure expression linter — mirrors Webstudio's `lintExpression` allowlist
// (@webstudio-is/sdk, packages/sdk/src/expression.ts, verified against the published SDK 0.268.0)
// so the MCP can tell the caller — BEFORE pushing — that an expression Webstudio's editor will flag.
//
// WHY this WARNS for allowlist violations instead of hard-blocking:
//   Webstudio's `lintExpression` runs ONLY in the builder/editor (CodeMirror). It is NOT on the
//   publish path. Publication goes generateExpression → transpileExpression, which recopies the
//   method name verbatim and only adds optional-chaining:
//       prix.toLocaleString("fr-FR")  →  prix?.toLocaleString?.("fr-FR")
//   then executeExpression runs it via `new Function`. So native methods (toLocaleString, toFixed,
//   replaceAll, map…) EXECUTE fine on the published page — they merely show a red
//   `"<name>" function is not supported` diagnostic when the expression is reopened in the editor.
//   Hard-blocking them would reject working production templates (e.g. concessionnaire price
//   formatting). We therefore WARN + educate, and reserve a hard ERROR for the one case that truly
//   breaks the build: a JS-unparseable expression (transpile parses with the same acorn engine and
//   throws → publish fails).
//
// Cas réel (production templates, 2026-06): `coloris.map(c => c.nom).join(" / ")` and
// `texte_hero.replaceAll("<p>","")` were pushed raw; the editor showed `"map" / "replaceAll"
// function is not supported`. Both run at runtime, but the red diagnostic alarmed the user.
//
// See docs/patterns/expression-allowlist.md.

import { parseExpressionAt, type CallExpression } from "acorn";
import { simple as walkSimple } from "acorn-walk";

/** String methods Webstudio's allowlist accepts (SDK 0.268.0). */
export const ALLOWED_STRING_METHODS = [
  "toLowerCase", "toUpperCase", "toLocaleLowerCase", "toLocaleUpperCase",
  "replace", "split", "slice", "at", "startsWith", "endsWith", "includes", "toString",
] as const;

/** Array methods Webstudio's allowlist accepts (SDK 0.268.0). */
export const ALLOWED_ARRAY_METHODS = ["join", "at", "slice", "includes", "toString"] as const;

// Receivers are usually dataSource variables of unknown type, so — like the SDK does for an
// unknown receiver — we accept the union (String ∪ Array) and avoid false positives.
const ALLOWED_METHODS = new Set<string>([...ALLOWED_STRING_METHODS, ...ALLOWED_ARRAY_METHODS]);

export type ExprViolation =
  | { type: "parse-error"; detail: string }
  | { type: "method"; detail: string } // non-allowlisted method name (e.g. "toLocaleString")
  | { type: "construct"; detail: string }; // arrow / function / this / new / class / await / …

export interface LintResult {
  /** "error" → unparseable → breaks the published build → refuse. "warning" → runs at runtime but
   *  the editor flags it → pass through + educate. */
  severity: "error" | "warning";
  /** Short context — used as the errorResult(message) and the first sentence of the hint. */
  message: string;
  /** Pedagogical string surfaced to the caller (response hint / errorResult hint). */
  hint: string;
  /** Telemetry key for logCoerce — `detect:*` family. */
  telemetryKey: string;
  violations: ExprViolation[];
}

const PATTERN_REF = "See pattern expression-allowlist (meta.guide).";

const CONSTRUCT_LABELS: Record<string, string> = {
  "arrow-function": "arrow function / callback (map/filter/reduce/find…)",
  "function": "function expression",
  "this": "`this`",
  "increment-decrement": "increment/decrement (++/--)",
  "new": "`new` instantiation",
  "class": "class expression",
  "await": "`await`",
  "tagged-template": "tagged template",
  "sequence": "comma sequence (multiple expressions)",
};

function constructLabel(kind: string): string {
  return CONSTRUCT_LABELS[kind] ?? kind;
}

/**
 * Lint a dataSource-encoded Webstudio expression against Webstudio's allowlist.
 * Returns `null` when the expression is clean.
 *
 *  - severity "error"   → unparseable JS — WILL break the published build → caller should refuse.
 *  - severity "warning" → valid JS but outside Webstudio's editor allowlist — runs at runtime,
 *                         shows a red diagnostic in the builder → caller should pass through + warn.
 *
 * Pass the EXPRESSION AFTER `encodeExpressionRefs` (dashes → __DASH__) so `$ws$dataSource$a-b`
 * parses as one identifier rather than a subtraction.
 */
export function lintExpression(expression: string): LintResult | null {
  // 1. Parse. transpileExpression uses the same acorn engine at publish time — a parse failure
  //    here means the published build would throw.
  let node: ReturnType<typeof parseExpressionAt>;
  try {
    node = parseExpressionAt(expression, 0, { ecmaVersion: "latest" });
  } catch (err) {
    const detail = (err as Error).message;
    return {
      severity: "error",
      message: `Expression is not valid JavaScript: ${detail}`,
      hint:
        `The expression failed to parse (${detail}). Webstudio transpiles expressions at publish ` +
        `time with the same parser, so an unparseable expression breaks the published build. ` +
        `Fix the syntax. ${PATTERN_REF}`,
      telemetryKey: "detect:expr-parse-error",
      violations: [{ type: "parse-error", detail }],
    };
  }

  // Trailing tokens (e.g. "a; b", "a, b") — Webstudio supports a single expression only.
  const trailing = expression.slice(node.end).trim();
  if (trailing.length > 0) {
    const detail = `unexpected trailing tokens after a single expression: "${trailing.slice(0, 24)}"`;
    return {
      severity: "error",
      message: `Expression is not a single JavaScript expression: ${detail}`,
      hint:
        `Webstudio supports only ONE expression (no ';' statements or ',' sequences). ${detail}. ` +
        PATTERN_REF,
      telemetryKey: "detect:expr-parse-error",
      violations: [{ type: "parse-error", detail }],
    };
  }

  // 2. Walk for allowlist violations — all valid JS that runs at runtime but the editor flags.
  const methods: string[] = [];
  const constructs: string[] = [];
  walkSimple(node, {
    ArrowFunctionExpression() { constructs.push("arrow-function"); },
    FunctionExpression() { constructs.push("function"); },
    ThisExpression() { constructs.push("this"); },
    UpdateExpression() { constructs.push("increment-decrement"); },
    NewExpression() { constructs.push("new"); },
    ClassExpression() { constructs.push("class"); },
    AwaitExpression() { constructs.push("await"); },
    TaggedTemplateExpression() { constructs.push("tagged-template"); },
    SequenceExpression() { constructs.push("sequence"); },
    CallExpression(call: CallExpression) {
      const callee = call.callee;
      if (callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier") {
        const name = callee.property.name;
        if (!ALLOWED_METHODS.has(name)) methods.push(name);
      } else if (callee.type === "Identifier") {
        // bare function call — Webstudio rejects with "Functions are not supported"
        methods.push(`${callee.name}()`);
      }
    },
  });

  const uniqMethods = [...new Set(methods)];
  const uniqConstructs = [...new Set(constructs)];
  if (uniqMethods.length === 0 && uniqConstructs.length === 0) return null;

  const violations: ExprViolation[] = [
    ...uniqMethods.map((m): ExprViolation => ({ type: "method", detail: m })),
    ...uniqConstructs.map((c): ExprViolation => ({ type: "construct", detail: c })),
  ];

  const parts: string[] = [];
  if (uniqMethods.length > 0) {
    parts.push(`method(s) not in the allowlist: ${uniqMethods.map((m) => `.${m}`).join(", ")}`);
  }
  if (uniqConstructs.length > 0) {
    parts.push(`unsupported construct(s): ${uniqConstructs.map(constructLabel).join(", ")}`);
  }
  const message = `Expression uses ${parts.join(" and ")}`;

  const hint =
    `${message}. These are valid JS and RUN on the published page, but Webstudio's editor flags ` +
    `them with a red "… is not supported" diagnostic (allowlist). ` +
    `Allowed string methods: ${ALLOWED_STRING_METHODS.join(", ")}; array methods: ` +
    `${ALLOWED_ARRAY_METHODS.join(", ")}. Common parades: replaceAll → split(x).join(""); ` +
    `.map(cb).join → pre-shape the data in the Resource (or .join() if already strings); ` +
    `toLocaleString/toFixed → keep (runs fine) or pre-format in the Resource. ${PATTERN_REF}`;

  const telemetryKey =
    uniqMethods.length > 0 ? "detect:expr-non-allowlisted-method" : "detect:expr-unsupported-construct";

  return { severity: "warning", message, hint, telemetryKey, violations };
}
