// Helpers to remap $ws$dataSource$<id> tokens in Webstudio JS expressions.
//
// Webstudio encodes `-` as `__DASH__` in expression dataSource refs. Some old
// data may already carry the raw form — we accept both on input and emit the
// canonical encoded form on output.

const dashEncode = (s: string): string => s.replace(/-/g, "__DASH__");

/**
 * Build a remap function from an oldId → newId map; rewrites $ws$dataSource$<id>
 * tokens in any string. Uses a single regex pass with identifier-boundary handling
 * so that an ID which is a substring of another doesn't get corrupted.
 */
export function makeExprRemap(dsIdMap: Map<string, string>): (s: string) => string {
  if (dsIdMap.size === 0) return (s) => s;
  const lookup = new Map<string, string>();
  for (const [oldId, nId] of dsIdMap.entries()) {
    const encNew = dashEncode(nId);
    lookup.set(dashEncode(oldId), encNew);
    if (oldId !== dashEncode(oldId)) lookup.set(oldId, encNew);
  }
  // Match $ws$dataSource$ followed by the longest run of identifier-safe chars
  // (including `-` so the raw form is captured as a single token). Matches stop
  // at `.`, `[`, `}`, whitespace, end-of-string — valid JS delimiters.
  const re = /\$ws\$dataSource\$([A-Za-z0-9_\-]+)/g;
  return (s) => s.replace(re, (full, captured: string) => {
    const mapped = lookup.get(captured);
    return mapped ? `$ws$dataSource$${mapped}` : full;
  });
}
