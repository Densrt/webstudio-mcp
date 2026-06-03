// State whitelist + normalization for Webstudio style decls.
//
// Source of truth: Webstudio upstream `packages/css-data/src/__generated__/`.
// Lists are vendored verbatim from the MDN-generated files in the Webstudio
// monorepo to avoid pulling `css-tree` as a runtime dependency.
//
// Vendor info (resync trimestriel recommandé):
//   - pseudo-classes.ts   @ webstudio-is/webstudio commit 1f4c53419da2 (2026-01-19, "feat: Pseudo elements (#5572)")
//   - pseudo-elements.ts  @ webstudio-is/webstudio commit 4abb7cf3e254 (2025-07-18, "feat: support svg properties in style panel (#5332)")
//   - last verified head  @ webstudio-is/webstudio commit 976ffd33f4d7 (2026-05-14)
//
// Webstudio convention (cf. src/types.ts:106, packages/html-data/src/pseudo-classes.ts):
// the `state` field stores the selector WITH its leading colon — ":hover", "::before",
// "[data-state=open]". Empty/undefined means base.

// Vendored from packages/css-data/src/__generated__/pseudo-classes.ts
const PSEUDO_CLASSES_NAMES = [
  "active",
  "active-view-transition",
  "active-view-transition-type()",
  "any-link",
  "autofill",
  "blank",
  "buffering",
  "checked",
  "current",
  "default",
  "defined",
  "dir()",
  "disabled",
  "empty",
  "enabled",
  "first",
  "first-child",
  "first-of-type",
  "focus",
  "focus-visible",
  "focus-within",
  "fullscreen",
  "future",
  "has()",
  "has-slotted",
  "host",
  "host()",
  "host-context()",
  "hover",
  "in-range",
  "indeterminate",
  "invalid",
  "is()",
  "lang()",
  "last-child",
  "last-of-type",
  "left",
  "link",
  "local-link",
  "modal",
  "muted",
  "not()",
  "nth-child()",
  "nth-last-child()",
  "nth-last-of-type()",
  "nth-of-type()",
  "only-child",
  "only-of-type",
  "open",
  "optional",
  "out-of-range",
  "past",
  "paused",
  "picture-in-picture",
  "placeholder-shown",
  "playing",
  "popover-open",
  "read-only",
  "read-write",
  "required",
  "right",
  "root",
  "scope",
  "seeking",
  "stalled",
  "state()",
  "target",
  "target-current",
  "target-within",
  "user-invalid",
  "user-valid",
  "valid",
  "visited",
  "volume-locked",
  "where()",
  "xr-overlay",
] as const;

// Vendored from packages/css-data/src/__generated__/pseudo-elements.ts
const PSEUDO_ELEMENTS_NAMES = [
  "-ms-browse",
  "-ms-check",
  "-ms-clear",
  "-ms-expand",
  "-ms-fill",
  "-ms-fill-lower",
  "-ms-fill-upper",
  "-ms-reveal",
  "-ms-thumb",
  "-ms-ticks-after",
  "-ms-ticks-before",
  "-ms-tooltip",
  "-ms-track",
  "-ms-value",
  "-moz-progress-bar",
  "-moz-range-progress",
  "-moz-range-thumb",
  "-moz-range-track",
  "-webkit-progress-bar",
  "-webkit-progress-inner-value",
  "-webkit-progress-value",
  "-webkit-slider-runnable-track",
  "-webkit-slider-thumb",
  "after",
  "backdrop",
  "before",
  "checkmark",
  "cue",
  "cue()",
  "cue-region",
  "cue-region()",
  "details-content",
  "file-selector-button",
  "first-letter",
  "first-line",
  "grammar-error",
  "highlight()",
  "marker",
  "part()",
  "picker-icon",
  "picker()",
  "placeholder",
  "scroll-marker",
  "scroll-marker-group",
  "selection",
  "slotted()",
  "spelling-error",
  "target-text",
  "view-transition",
  "view-transition-group()",
  "view-transition-image-pair()",
  "view-transition-new()",
  "view-transition-old()",
] as const;

// Per `selector-validation.ts` in Webstudio upstream: single-colon syntax for
// these four is treated as a pseudo-element (legacy CSS2). Canonical form is `::name`.
const LEGACY_SINGLE_COLON_AS_ELEMENT = new Set(["before", "after", "first-letter", "first-line"]);

// Strip `()` suffix for set membership (`has()` and `has` both valid in upstream).
function bareName(name: string): string {
  return name.replace(/\(\)$/, "");
}

// Functional usage like `:nth-child(2n)` or `::part(label)` — extract the function name
// before the arguments so we can look it up in the whitelist.
function functionalBareName(name: string): string {
  const i = name.indexOf("(");
  return i === -1 ? name : name.slice(0, i);
}

const PSEUDO_CLASSES: ReadonlySet<string> = new Set(PSEUDO_CLASSES_NAMES.flatMap((n) => [n, bareName(n)]));
const PSEUDO_ELEMENTS: ReadonlySet<string> = new Set(PSEUDO_ELEMENTS_NAMES.flatMap((n) => [n, bareName(n)]));

// Helper: does the whitelist contain this name, accounting for functional arguments?
function inSet(set: ReadonlySet<string>, name: string): boolean {
  if (set.has(name)) return true;
  const bare = functionalBareName(name);
  if (bare !== name && set.has(bare)) return true;
  return false;
}

export type NormalizedState = {
  /** Canonical form (e.g. ":hover", "::before", "[data-state=open]") or undefined for base. */
  canonical: string | undefined;
  /** True when the input is a recognized base/pseudo-class/pseudo-element/attribute selector. */
  isValid: boolean;
  /** Suggested canonical form when input is invalid but a near-match was found. */
  suggestion?: string;
  /** Human-readable reason when isValid=false. */
  reason?: string;
};

/**
 * Parse and normalize a `state` field as stored by Webstudio.
 *
 * Rules (aligned with packages/css-data/src/selector-validation.ts):
 * - undefined / "" / whitespace-only → base state (valid).
 * - "[...]" → attribute selector, accepted as-is (we don't validate attribute syntax).
 * - "::name" → pseudo-element if name is in PSEUDO_ELEMENTS, else invalid.
 * - ":name" → pseudo-class if name is in PSEUDO_CLASSES; legacy pseudo-element if name is in
 *   LEGACY_SINGLE_COLON_AS_ELEMENT (canonicalized to "::name"); else invalid.
 * - Anything else (bare "hover", typo, weird casing) → invalid with suggestion when possible.
 *
 * The function is case-sensitive (Webstudio is); a `:Hover` input is invalid with `:hover`
 * suggested. Whitespace at edges is stripped.
 */
export function normalizeState(raw: string | undefined): NormalizedState {
  if (raw === undefined) return { canonical: undefined, isValid: true };
  const trimmed = raw.trim();
  if (trimmed === "") return { canonical: undefined, isValid: true };

  // Attribute selector — pass through verbatim.
  if (trimmed.startsWith("[")) {
    return { canonical: trimmed, isValid: true };
  }

  // Double-colon form.
  if (trimmed.startsWith("::")) {
    const name = trimmed.slice(2);
    const lower = name.toLowerCase();
    if (inSet(PSEUDO_ELEMENTS, name)) {
      return { canonical: `::${name}`, isValid: true };
    }
    if (inSet(PSEUDO_ELEMENTS, lower)) {
      return { canonical: `::${lower}`, isValid: false, suggestion: `::${lower}`, reason: `case mismatch on pseudo-element "${name}"` };
    }
    if (inSet(PSEUDO_CLASSES, name) || inSet(PSEUDO_CLASSES, lower)) {
      const fixed = inSet(PSEUDO_CLASSES, name) ? name : lower;
      return { canonical: `:${fixed}`, isValid: false, suggestion: `:${fixed}`, reason: `"${name}" is a pseudo-class, not a pseudo-element (use single colon)` };
    }
    return { canonical: undefined, isValid: false, reason: `unknown pseudo-element "::${name}"` };
  }

  // Single-colon form.
  if (trimmed.startsWith(":")) {
    const name = trimmed.slice(1);
    const lower = name.toLowerCase();

    // Legacy single-colon pseudo-element (CSS2): :before, :after, :first-letter, :first-line.
    if (LEGACY_SINGLE_COLON_AS_ELEMENT.has(name)) {
      return { canonical: `::${name}`, isValid: false, suggestion: `::${name}`, reason: `legacy single-colon pseudo-element; canonical form is "::${name}"` };
    }

    if (inSet(PSEUDO_CLASSES, name)) {
      return { canonical: `:${name}`, isValid: true };
    }
    if (inSet(PSEUDO_CLASSES, lower)) {
      return { canonical: `:${lower}`, isValid: false, suggestion: `:${lower}`, reason: `case mismatch on pseudo-class "${name}"` };
    }
    // Maybe a pseudo-element written with single colon (non-legacy)?
    if (inSet(PSEUDO_ELEMENTS, name) || inSet(PSEUDO_ELEMENTS, lower)) {
      const fixed = inSet(PSEUDO_ELEMENTS, name) ? name : lower;
      return { canonical: `::${fixed}`, isValid: false, suggestion: `::${fixed}`, reason: `"${name}" is a pseudo-element; use double colon "::${fixed}"` };
    }
    return { canonical: undefined, isValid: false, reason: `unknown pseudo-class ":${name}"` };
  }

  // Bare name (no colon, no bracket) — try to recover.
  const lower = trimmed.toLowerCase();
  if (inSet(PSEUDO_CLASSES, trimmed) || inSet(PSEUDO_CLASSES, lower)) {
    const fixed = inSet(PSEUDO_CLASSES, trimmed) ? trimmed : lower;
    return { canonical: `:${fixed}`, isValid: false, suggestion: `:${fixed}`, reason: `missing leading colon on pseudo-class` };
  }
  if (inSet(PSEUDO_ELEMENTS, trimmed) || inSet(PSEUDO_ELEMENTS, lower)) {
    const fixed = inSet(PSEUDO_ELEMENTS, trimmed) ? trimmed : lower;
    return { canonical: `::${fixed}`, isValid: false, suggestion: `::${fixed}`, reason: `missing leading colons on pseudo-element` };
  }
  return { canonical: undefined, isValid: false, reason: `selector must start with ":", "::" or "[" (got "${trimmed}")` };
}

/**
 * Compare two stored `state` values with tolerance for malformed inputs.
 *
 * - Raw equality first: a user explicitly targeting a corrupted decl by typing its literal
 *   stored value (e.g. "::hover") still matches. This is the escape hatch for repairing
 *   corruption via MCP.
 * - Normalized equality fallback: variants ":hover" / "hover" / "::hover" / ":Hover" all
 *   resolve to the same canonical form and match each other.
 *
 * Both states must be defined; wildcard semantics (one side `undefined`) is the caller's
 * responsibility (cf. `delete-local-style-decl` and `replace-local-value` which treat
 * `query.state === undefined` as "match all states").
 */
export function stateMatches(stored: string | undefined, query: string | undefined): boolean {
  if (stored === undefined && query === undefined) return true;
  if (stored === undefined || query === undefined) return false;
  if (stored === query) return true;
  const ns = normalizeState(stored);
  const nq = normalizeState(query);
  return ns.canonical !== undefined && ns.canonical === nq.canonical;
}

/** Convenience predicate — true when the state is a recognized form. */
export function isValidState(raw: string | undefined): boolean {
  return normalizeState(raw).isValid;
}

/**
 * Outcome of resolving a caller-supplied `state` for a WRITE path.
 *
 * Discriminated on `ok`:
 * - `ok:false` → the input is an unrecoverable selector (e.g. ":fake-state"); the
 *   write path must reject with `error` instead of silently storing a dead state.
 * - `ok:true`  → use `state` (canonical form, `undefined` = base). When `hint` is
 *   present the input was a RECOVERABLE non-canonical form (e.g. "hover" → ":hover",
 *   ":before" → "::before") that we coerced: the caller surfaces `hint` to the user
 *   and emits `logCoerce(telemetryKey, { source, projectSlug, from, to: state, reason })`.
 */
export type StateForWrite =
  | { ok: false; error: string }
  // Valid / base: passthrough, no coercion. `hint` absent (the discriminant).
  | { ok: true; state: string | undefined; hint?: undefined; telemetryKey?: undefined; from?: undefined; reason?: undefined }
  // Recoverable: coerced to canonical — `hint`/`telemetryKey` guaranteed present so
  // `if (res.hint)` narrows them to non-undefined at the call site.
  | { ok: true; state: string; hint: string; telemetryKey: string; from: string; reason: string };

/**
 * Normalize a caller-supplied `state` at a style WRITE boundary.
 *
 * Wraps `normalizeState` with the repo's coerce-vs-reject convention so every write
 * path (update_styles, update_token_styles, buildFromArgs, extract_variant) behaves
 * identically:
 * - valid (":hover", "::before", "[...]", base)      → passthrough, no hint.
 * - recoverable ("hover", ":Hover", ":before", …)    → coerce to canonical + hint + telemetryKey.
 * - unrecoverable (":fake-state", "zzz", "::hover" w/ no element match) → { ok:false, error }.
 *
 * Cas réel (2026-06): `tokens.update_token_styles` accepted `state:"hover"` (no colon)
 * verbatim and stored a dead state that never triggered at runtime — zero warning.
 * The brick (`normalizeState`) already existed but was never called on write paths.
 */
export function resolveStateForWrite(raw: string | undefined): StateForWrite {
  const ns = normalizeState(raw);
  if (ns.isValid) {
    return { ok: true, state: ns.canonical };
  }
  const from = (raw ?? "").trim();
  // Recoverable: normalizeState found a canonical form despite the bad input.
  if (ns.canonical !== undefined) {
    return {
      ok: true,
      state: ns.canonical,
      from,
      reason: ns.reason ?? "",
      telemetryKey: "coerce:stateSelector",
      hint: `state "${from}" normalized to "${ns.canonical}" (${ns.reason}). Webstudio stores states as selectors WITH a leading colon (":hover", "::before", "[data-state=open]"); a bare "${from}" is a dead state that never matches at runtime. See pattern state-selector-format.`,
    };
  }
  // Unrecoverable: reject explicitly rather than store a state that will never fire.
  return { ok: false, error: `invalid state "${from}": ${ns.reason}` };
}
