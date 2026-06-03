// Action label validator (workstream 7, v1.0 prep).
//
// Each entry in a mega-tool's `actions[]` array MUST carry a `label: string` (3-30 chars,
// trimmed). The label is echoed back in the response, letting the caller match results to
// inputs when N actions are batched. Duplicate labels in a single call are refused — the
// caller gets a clear error pointing at the offending names.

const MIN_LEN = 3;
const MAX_LEN = 30;

export type LabelValidation = { ok: true } | { ok: false; error: string };

/**
 * Validate a single action label. Must be a non-empty string of 3-30 chars after trimming,
 * with no leading/trailing whitespace in the raw value.
 */
export function validateLabel(label: unknown): LabelValidation {
  if (typeof label !== "string") {
    return { ok: false, error: `label must be a string, got ${typeof label}` };
  }
  if (label !== label.trim()) {
    return { ok: false, error: `label must not have leading/trailing whitespace ("${label}")` };
  }
  if (label.length < MIN_LEN) {
    return { ok: false, error: `label too short: ${label.length} chars (min ${MIN_LEN})` };
  }
  if (label.length > MAX_LEN) {
    return { ok: false, error: `label too long: ${label.length} chars (max ${MAX_LEN})` };
  }
  return { ok: true };
}

export type UniqueLabelsValidation =
  | { ok: true }
  | { ok: false; error: string; duplicates: string[] };

/**
 * Check that all labels in the array are unique. For multi-action calls only.
 * Returns the list of duplicated labels (each appearing once) for actionable error.
 */
export function ensureUniqueLabels(labels: string[]): UniqueLabelsValidation {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const l of labels) {
    if (seen.has(l)) dupes.add(l);
    else seen.add(l);
  }
  if (dupes.size === 0) return { ok: true };
  const duplicates = Array.from(dupes);
  return {
    ok: false,
    error: `duplicate label(s) in actions[]: ${duplicates.map((d) => `"${d}"`).join(", ")}. Each action label must be unique within a single call.`,
    duplicates,
  };
}
