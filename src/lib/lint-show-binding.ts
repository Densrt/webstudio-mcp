// Lint data-ws-show bindings: the value MUST be boolean (v2.19.0).
//
// Real case (a multi-tenant template, 2026-06-10): a numeric
// expression (`….length`) bound to data-ws-show leaks a literal "0" as TEXT
// on the live page instead of hiding the element. The 2026-06-10 sweep also
// found bare field accesses (`$ws$dataSource$X.data.champ`) used as show
// bindings in production — same risk class.
//
// Policy (mirrors lint-expression.ts's graduated approach):
//   - `.length` tail → AUTO-FIX to `.length > 0` (the documented incident,
//     unambiguous numeric → coerce:show-binding-length);
//   - expression with no boolean operator → WARN (detect:show-binding-not-boolean),
//     pushed as-is (a truthy string/array may render fine — we can't know);
//   - boolean-shaped expression → clean.

const BOOLEAN_SHAPE = /(===|!==|==|!=|>=|<=|>|<|&&|\|\||^!|\s!|^\s*(true|false)\s*$)/;

export type ShowBindingLint =
  | { kind: "clean" }
  | { kind: "fixed"; expression: string; hint: string; telemetryKey: "coerce:show-binding-length" }
  | { kind: "warning"; hint: string; telemetryKey: "detect:show-binding-not-boolean" };

export function lintShowBinding(expression: string): ShowBindingLint {
  const expr = expression.trim();
  if (expr === "") return { kind: "clean" };
  if (BOOLEAN_SHAPE.test(expr)) return { kind: "clean" };

  if (/\.length\s*$/.test(expr)) {
    const fixed = `${expr} > 0`;
    return {
      kind: "fixed",
      expression: fixed,
      hint:
        `data-ws-show bound to a NUMBER (\`${expr.slice(0, 60)}\`) leaks a literal "0" as text on the live page ` +
        `instead of hiding — auto-fixed to \`… > 0\`. Always bind a boolean.`,
      telemetryKey: "coerce:show-binding-length",
    };
  }

  return {
    kind: "warning",
    hint:
      `data-ws-show bound to a non-boolean expression (\`${expr.slice(0, 60)}\`) — if it resolves to a number, ` +
      `a "0" leaks as text on the live page. Wrap it: \`expr != null\`, \`expr !== ""\` or \`expr.length > 0\`.`,
    telemetryKey: "detect:show-binding-not-boolean",
  };
}

/**
 * Apply the lint to a fragment's props in place. Returns hints + telemetry
 * for the boundary handler to surface/log.
 */
export function lintShowBindingProps(
  props: Array<{ name: string; type: string; value: unknown }>,
): { hints: string[]; telemetry: Array<{ key: string; count: number }> } {
  const hints: string[] = [];
  let fixed = 0;
  let warned = 0;
  for (const p of props) {
    if (p.name !== "data-ws-show" || p.type !== "expression") continue;
    const lint = lintShowBinding(String(p.value));
    if (lint.kind === "fixed") {
      p.value = lint.expression;
      hints.push(lint.hint);
      fixed += 1;
    } else if (lint.kind === "warning") {
      hints.push(lint.hint);
      warned += 1;
    }
  }
  const telemetry: Array<{ key: string; count: number }> = [];
  if (fixed > 0) telemetry.push({ key: "coerce:show-binding-length", count: fixed });
  if (warned > 0) telemetry.push({ key: "detect:show-binding-not-boolean", count: warned });
  return { hints, telemetry };
}
