import { encodeExpressionRefs } from "./utils/expression-encoding.js";
import { lintExpression, type LintResult } from "./lib/lint-expression.js";

export type { LintResult } from "./lib/lint-expression.js";

// Helpers for building Webstudio JS expressions bound to dataSources.
//
// Observed format (builder capture, 2026-05-08):
//   $ws$dataSource$<id-encoded>
// where <id-encoded> = id with non-JS-safe characters escaped (`-` → `__DASH__`).
//
// Expressions are stored as strings in bindable fields:
// title, meta.description, meta.language, meta.redirect, meta.socialImageUrl, meta.excludePageFromSearch.

export function encodeDataSourceVariable(id: string): string {
  return id.replace(/-/g, "__DASH__");
}

export function decodeDataSourceVariable(name: string): string {
  return name.replace(/__DASH__/g, "-");
}

/**
 * Reference to a variable, optionally with a JS access path for resources.
 *  variableExpr("xxx") → "$ws$dataSource$xxx"
 *  variableExpr("xxx", ["name"]) → "$ws$dataSource$xxx.name"
 *  variableExpr("xxx", ["address", "city"]) → "$ws$dataSource$xxx.address.city"
 *  variableExpr("xxx", ["items", 0, "title"]) → "$ws$dataSource$xxx.items[0].title"
 */
export function variableExpr(dataSourceId: string, path?: Array<string | number>): string {
  let expr = `$ws$dataSource$${encodeDataSourceVariable(dataSourceId)}`;
  if (path) {
    for (const seg of path) {
      if (typeof seg === "number") expr += `[${seg}]`;
      else if (/^[A-Za-z_$][\w$]*$/.test(seg)) expr += `.${seg}`;
      else expr += `[${JSON.stringify(seg)}]`;
    }
  }
  return expr;
}

export type TemplatePart =
  | { type: "text"; value: string }
  | { type: "variable"; dataSourceId: string; path?: Array<string | number> };

/**
 * Assemble a string-concat expression from text/variable parts.
 * Ex: [{type:"text",value:"Hello "}, {type:"variable",dataSourceId:"x"}]
 *  → "\"Hello \" + $ws$dataSource$x"
 */
export function templateExpr(parts: TemplatePart[]): string {
  if (parts.length === 0) return JSON.stringify("");
  return parts
    .map((p) => (p.type === "text" ? JSON.stringify(p.value) : variableExpr(p.dataSourceId, p.path)))
    .join(" + ");
}

export type Binding =
  | { kind: "variable"; dataSourceId: string; path?: Array<string | number> }
  | { kind: "template"; parts: TemplatePart[] }
  | { kind: "raw"; expression: string };

export function bindingToExpression(binding: Binding): string {
  if (binding.kind === "variable") return variableExpr(binding.dataSourceId, binding.path);
  if (binding.kind === "template") return templateExpr(binding.parts);
  // `raw` lets callers pass a hand-written expression. Auto-encode dataSourceId
  // refs (`-` → `__DASH__`) so a raw id with a dash doesn't silently render empty.
  // Idempotent: re-encoding an already-encoded ref is a no-op.
  return encodeExpressionRefs(binding.expression);
}

/**
 * Lint a binding's hand-written expression against Webstudio's allowlist.
 * Only `raw` bindings carry author-written JS — `variable` / `template` produce safe
 * auto-generated expressions, so they return `null` (nothing to lint).
 * Lints the ENCODED form so `$ws$dataSource$a-b` parses as one identifier.
 * See src/lib/lint-expression.ts for the warn-vs-error rationale.
 */
export function lintBinding(binding: Binding): LintResult | null {
  if (binding.kind !== "raw") return null;
  return lintExpression(encodeExpressionRefs(binding.expression));
}
