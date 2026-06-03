// Webstudio encodes dashes `-` in dataSourceIds to `__DASH__` inside expressions.
// A raw expression like `$ws$dataSource$abc-xyz.title` is silently dropped by the
// Webstudio renderer (empty render / NaN) — it MUST be sent as
// `$ws$dataSource$abc__DASH__xyz.title`.
//
// This helper auto-encodes any `$ws$dataSource$<id>` reference embedded in a raw
// expression string. It is idempotent: an already-encoded id is left alone.
//
// Bug observed in prod on template-acme (2026-05-20) on a Hero paragraph
// bound via `mode:"expression"` — the dataSourceId ended with `-` and the
// renderer produced empty content (and "NaN" once concatenated).

/**
 * Match `$ws$dataSource$<id>`. The id continues as long as we see chars that
 * are valid in a Webstudio dataSourceId (nanoid alphabet) — letters, digits,
 * `_`, `-`. We then replace every `-` in the captured id by `__DASH__`.
 *
 * Note: `__DASH__` contains only `_` and letters, both inside the captured
 * character class, so re-running the function on an already-encoded
 * expression is a no-op.
 */
const DATA_SOURCE_REF = /\$ws\$dataSource\$([A-Za-z0-9_-]+)/g;

export function encodeExpressionRefs(expression: string): string {
  return expression.replace(DATA_SOURCE_REF, (_match, id: string) => {
    return `$ws$dataSource$${id.replace(/-/g, "__DASH__")}`;
  });
}
