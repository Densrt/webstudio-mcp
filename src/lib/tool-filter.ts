// Reduced tool-surface mode (v2.15.0 — item 5 of the 2026-06-10 audit backlog).
//
// WEBSTUDIO_MCP_TOOLS="meta,read,audit" registers only the named mega-tools.
// Two motivations, both routine-driven (cron crawls / audits run headless):
//   - safety: a read-only routine has no business mounting mutation tools;
//   - context: a 3-tool surface costs ~8k tokens instead of ~26k per session.
//
// Rules:
//   - unset / empty → inactive, every tool registered (default unchanged);
//   - names are trimmed + case-insensitive;
//   - "meta" is ALWAYS kept (discovery is core; meta.index reflects the
//     filtered list via its closure);
//   - unknown names are reported (caller prints them on stderr);
//   - active filter matching ZERO known tools → fail-safe: keep meta only.
//     Serving the full surface on a typo would defeat the safety use case.

export type ToolFilterResult = {
  /** False when the env var is unset/empty — register everything. */
  active: boolean;
  /** Tool names to register (lowercase match, original casing preserved). */
  keep: Set<string>;
  /** Names from the env var that matched no known tool. */
  unknown: string[];
};

export function applyToolFilter(
  knownToolNames: string[],
  envValue: string | undefined,
): ToolFilterResult {
  const raw = (envValue ?? "").trim();
  if (raw === "") {
    return { active: false, keep: new Set(knownToolNames), unknown: [] };
  }
  const wanted = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const byLower = new Map(knownToolNames.map((n) => [n.toLowerCase(), n]));
  const keep = new Set<string>();
  const unknown: string[] = [];
  for (const w of wanted) {
    if (w === "meta") continue; // always present, declared or not
    const match = byLower.get(w);
    if (match) keep.add(match);
    else unknown.push(w);
  }
  return { active: true, keep, unknown };
}
