// Auto-coercion for "composed" CSS properties.
//
// Webstudio stores values for properties like `filter`, `backdropFilter`, `transform`,
// `transition*`, `animation*` as a wrapper (`tuple` or `layers`) containing typed children.
// When such a property is set as `{type:"unparsed", value:"..."}` the cloud accepts it
// but the Style panel UI does NOT decode it — the user sees an empty field and has to re-input.
// This module best-effort parses common shorthand strings and converts them to the canonical
// shape so the UI displays them correctly. If parsing fails the original value is returned.
//
// Wrapper choice per property (observed from real Webstudio exports, 2026-05-13):
//   • filter / backdropFilter / transform     → `tuple[function(...)]`
//   • transition* (5 longhands)               → `layers[item]` where item type depends on the longhand
//   • animation* (8 longhands)                → `layers[item]` (same convention as transition)
//   • willChange                              → `tuple[keyword]` (multi-value but no per-index pairing)
//
// IMPORTANT — transitions and animations require ALL longhands at matching layer indexes for the
// UI to display correctly. See ensureTransitionLonghands() and ensureAnimationLonghands() helpers.

import type { StyleValue, StyleDecl } from "../types.js";

// ─── Property classification ─────────────────────────────────────────────────

/**
 * True if the property is a CSS custom property (starts with `--`).
 * Custom properties pushed to Webstudio without `listed: true` are silently invisible
 * in the Styles panel — the value is stored but the user has no way to see/edit it.
 * Always pair with `listed: true`. See applyListedDefault().
 */
export function isCustomProperty(property: string): boolean {
  return typeof property === "string" && property.startsWith("--");
}

/**
 * Returns the effective `listed` flag for a (property, listed?) pair.
 * Custom properties (--*) default to `listed: true` so they appear in the Webstudio
 * Styles panel. Non-custom properties keep the caller-provided value (default falsy).
 * Callers can still pass `listed: false` explicitly to override — but the panel will
 * then hide the decl, which is rarely what you want for a custom property.
 */
export function applyListedDefault(property: string, listed: boolean | undefined): boolean | undefined {
  if (isCustomProperty(property) && listed === undefined) return true;
  return listed;
}


const TUPLE_PROPS = new Set<string>(["filter", "backdropFilter", "transform", "willChange"]);

// Modern individual transform properties (translate, scale, rotate) accept a tuple of
// raw values DIRECTLY — no function() wrapping. Critical: this is the recommended path
// when using CSS variables, because `transform: scale(var(--x))` is invisible in the
// Webstudio UI Transform panel (it can't decode function(var)). Using individual props
// with `tuple[{type:"var", value:"x"}]` works in both runtime and UI.
// Discovered on a production site brand-logo-scale, 2026-05-21.
const INDIVIDUAL_TRANSFORM_PROPS = new Set<string>(["translate", "scale", "rotate"]);

const TRANSITION_LONGHANDS = [
  "transitionProperty",
  "transitionDuration",
  "transitionTimingFunction",
  "transitionDelay",
  "transitionBehavior",
] as const;

const ANIMATION_LONGHANDS = [
  "animationName",
  "animationDuration",
  "animationTimingFunction",
  "animationDelay",
  "animationIterationCount",
  "animationDirection",
  "animationFillMode",
  "animationPlayState",
] as const;

const TRANSITION_SET = new Set<string>(TRANSITION_LONGHANDS);
const ANIMATION_SET = new Set<string>(ANIMATION_LONGHANDS);

/** True if `property` is one of the CSS properties that the Webstudio UI expects in tuple/layers shape. */
export function isComposedProperty(property: string): boolean {
  return (
    TUPLE_PROPS.has(property) ||
    TRANSITION_SET.has(property) ||
    ANIMATION_SET.has(property) ||
    INDIVIDUAL_TRANSFORM_PROPS.has(property)
  );
}
/** @deprecated kept for older callers */
export const isTupleFunctionProperty = isComposedProperty;

// ─── Tiny parsers ────────────────────────────────────────────────────────────

function parseUnit(s: string): StyleValue | null {
  const m = s.trim().match(/^(-?\d*\.?\d+)\s*([a-zA-Z%]*)$/);
  if (!m) return null;
  return { type: "unit", value: parseFloat(m[1]), unit: m[2] || "number" };
}

function parseVar(s: string): StyleValue | null {
  const m = s.trim().match(/^var\(\s*--([^,)]+?)\s*(?:,\s*(.+))?\)$/);
  if (!m) return null;
  const name = m[1].trim();
  const fbStr = m[2]?.trim();
  return fbStr
    ? { type: "var", value: name, fallback: parseArg(fbStr) }
    : { type: "var", value: name };
}

function parseArg(s: string): StyleValue {
  const t = s.trim();
  const v = parseVar(t);
  if (v) return v;
  const fn = parseFunction(t);
  if (fn) return fn;
  const u = parseUnit(t);
  if (u) return u;
  return { type: "keyword", value: t };
}

function splitTopLevel(s: string, sep: "," | " "): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    const isSep = sep === " " ? /\s/.test(ch) : ch === sep;
    if (isSep && depth === 0) {
      if (cur.trim().length) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim().length) out.push(cur.trim());
  return out;
}

function parseFunction(s: string): StyleValue | null {
  const m = s.trim().match(/^([a-zA-Z][a-zA-Z0-9_-]*)\((.*)\)$/s);
  if (!m) return null;
  const name = m[1];
  if (name === "var") return null;
  const argsStr = m[2];
  const args: StyleValue[] = argsStr.length ? splitTopLevel(argsStr, ",").map(parseArg) : [];
  return { type: "function", name, args: { type: "tuple", value: args } };
}

// ─── Coercion helpers per property family ────────────────────────────────────

function coerceTransition(property: string, raw: string): StyleValue {
  const parts = splitTopLevel(raw, ",");
  let items: StyleValue[];
  if (property === "transitionProperty") {
    // UI uses {type:"unparsed", value:"<ident>"} per layer (NOT keyword).
    // var() is uncommon here but still handled so it round-trips through the UI.
    items = parts.map((p) => parseVar(p) ?? ({ type: "unparsed", value: p } as StyleValue));
  } else if (property === "transitionDuration" || property === "transitionDelay") {
    // var() MUST be tried before parseUnit — otherwise a `var(--brand-transition-fast)`
    // silently falls back to 0ms (no transition at runtime). Prod production incident 2026-05-21.
    items = parts.map((p) => parseVar(p) ?? parseUnit(p) ?? ({ type: "unit", value: 0, unit: "ms" } as StyleValue));
  } else if (property === "transitionTimingFunction") {
    // parseFunction explicitly skips name==="var" (returns null), so we must try parseVar first;
    // otherwise a `var(--brand-easing-default)` becomes {type:"keyword", value:"var(...)"} which
    // is invalid in the cohort (panel reads as default `ease`, runtime drops the timing).
    items = parts.map((p) => parseVar(p) ?? parseFunction(p) ?? ({ type: "keyword", value: p } as StyleValue));
  } else {
    // transitionBehavior
    items = parts.map((p) => parseVar(p) ?? ({ type: "keyword", value: p } as StyleValue));
  }
  return { type: "layers", value: items };
}

function coerceAnimation(property: string, raw: string): StyleValue {
  const parts = splitTopLevel(raw, ",");
  let items: StyleValue[];
  if (property === "animationDuration" || property === "animationDelay") {
    items = parts.map((p) => parseVar(p) ?? parseUnit(p) ?? ({ type: "unit", value: 0, unit: "ms" } as StyleValue));
  } else if (property === "animationTimingFunction") {
    items = parts.map((p) => parseVar(p) ?? parseFunction(p) ?? ({ type: "keyword", value: p } as StyleValue));
  } else if (property === "animationIterationCount") {
    items = parts.map((p) => parseVar(p) ?? parseUnit(p) ?? ({ type: "keyword", value: p } as StyleValue));
  } else {
    // animationName / Direction / FillMode / PlayState
    items = parts.map((p) => parseVar(p) ?? ({ type: "unparsed", value: p } as StyleValue));
  }
  return { type: "layers", value: items };
}

/**
 * Modern individual transform props (translate / scale / rotate) accept a tuple of raw
 * values — NO function() wrapping. Each whitespace-separated token becomes one tuple item.
 *   "1.2"            → tuple[unit 1.2 number]
 *   "10px 20px"      → tuple[unit 10 px, unit 20 px]
 *   "var(--x)"       → tuple[var x]
 *   "var(--x) var(--y)" → tuple[var x, var y]
 *   "45deg"          → tuple[unit 45 deg]
 */
function coerceIndividualTransform(_property: string, raw: string): StyleValue {
  const parts = splitTopLevel(raw, " ");
  const items: StyleValue[] = parts.map(
    (p) => parseVar(p) ?? parseUnit(p) ?? ({ type: "keyword", value: p } as StyleValue),
  );
  return items.length ? { type: "tuple", value: items } : { type: "unparsed", value: raw };
}

function coerceTuple(property: string, raw: string): StyleValue {
  if (property === "willChange") {
    const parts = splitTopLevel(raw, ",").map<StyleValue>((p) => ({ type: "keyword", value: p }));
    return parts.length ? { type: "tuple", value: parts } : { type: "unparsed", value: raw };
  }
  // filter / backdropFilter / transform: space-separated functions.
  const fns = splitTopLevel(raw, " ").map<StyleValue>(
    (p) => parseFunction(p) ?? ({ type: "unparsed", value: p }),
  );
  return fns.length ? { type: "tuple", value: fns } : { type: "unparsed", value: raw };
}

/**
 * Wrap a single typed value into `{type:"layers", value:[value]}` for transition / animation
 * longhands. Webstudio's Transition / Animation panels only decode `layers[]` per longhand;
 * a raw `{type:"var"|"keyword"|"unit"|"function"}` is silently ignored by the UI.
 *
 * This helper is the counterpart of `coerceTransition` / `coerceAnimation` for callers that
 * already produced typed values (instead of passing `{type:"unparsed", value:"..."}` and
 * letting the server parse). Both paths must converge on the same UI-decodable shape.
 *
 * Exported for direct testing and for `coerceStyleValueWithMeta` consumers.
 */
export function coerceComposedSingleToLayers(
  property: string,
  value: StyleValue,
): { value: StyleValue; coerced: boolean } {
  if (!TRANSITION_SET.has(property) && !ANIMATION_SET.has(property)) {
    return { value, coerced: false };
  }
  if (value.type === "layers" || value.type === "tuple") {
    return { value, coerced: false };
  }
  if (
    value.type === "var" ||
    value.type === "keyword" ||
    value.type === "unit" ||
    value.type === "function"
  ) {
    return { value: { type: "layers", value: [value] } as StyleValue, coerced: true };
  }
  return { value, coerced: false };
}

/**
 * Coerce a single StyleValue to the canonical UI-decodable shape, if the property requires it.
 * Returns the original value if no coercion applies or if parsing fails.
 *
 * Two routes converge here:
 *   1. `{type:"unparsed", value:"raw css"}` → parser → typed layers/tuple
 *   2. Already-typed single value (`{type:"var"|"keyword"|"unit"|"function"}`) on a
 *      transition / animation longhand -> wrapped into `layers[1]` via
 *      `coerceComposedSingleToLayers`.
 */
export function coerceStyleValue(property: string, value: StyleValue): StyleValue {
  if (!isComposedProperty(property)) return value;
  if (value.type !== "unparsed") {
    // Route 2: typed single value on a transition/animation longhand → wrap to layers.
    return coerceComposedSingleToLayers(property, value).value;
  }
  const raw = value.value.trim();
  if (!raw) return value;
  try {
    if (TRANSITION_SET.has(property)) return coerceTransition(property, raw);
    if (ANIMATION_SET.has(property)) return coerceAnimation(property, raw);
    if (INDIVIDUAL_TRANSFORM_PROPS.has(property)) return coerceIndividualTransform(property, raw);
    return coerceTuple(property, raw);
  } catch {
    return value;
  }
}

/**
 * Same as `coerceStyleValue` but also returns a pedagogical `hint` + `telemetryKey` when
 * a silent coercion fired. Callers that have a `coerceHints[]` + telemetry channel should
 * use this variant; `coerceStyleValue` stays as the thin pure form for legacy call sites.
 */
export function coerceStyleValueWithMeta(
  property: string,
  value: StyleValue,
): { value: StyleValue; hint?: string; telemetryKey?: string } {
  if (!isComposedProperty(property)) return { value };
  if (value.type !== "unparsed") {
    const wrap = coerceComposedSingleToLayers(property, value);
    if (!wrap.coerced) return { value: wrap.value };
    return {
      value: wrap.value,
      hint: `${property}: single typed {type:"${value.type}"} wrapped in layers[1] so the Webstudio Transition/Animation panel decodes it. Pass {type:"layers", value:[<your value>]} directly to silence this hint. For multi-layer transitions, push all longhands with matching layer counts.`,
      telemetryKey: "coerce:composedSingleToLayers",
    };
  }
  return { value: coerceStyleValue(property, value) };
}

// ─── Longhand completer (transition / animation) ─────────────────────────────
//
// Webstudio's Transition / Animation panels render layer N from the value at index N of EACH
// longhand. If `transitionProperty.layers[0]` exists but `transitionTimingFunction.layers[0]`
// is missing, the panel reads the property as `all 0s ease 0s` (defaults) — i.e. the user's
// intent is invisible. These completers ensure all longhands are present with matching layer
// counts, filling missing ones with CSS defaults (ease, 0ms, normal, ...).

const TRANSITION_DEFAULTS: Record<(typeof TRANSITION_LONGHANDS)[number], StyleValue> = {
  transitionProperty: { type: "unparsed", value: "all" },
  transitionDuration: { type: "unit", value: 0, unit: "ms" },
  transitionTimingFunction: { type: "keyword", value: "ease" },
  transitionDelay: { type: "unit", value: 0, unit: "ms" },
  transitionBehavior: { type: "keyword", value: "normal" },
};

const ANIMATION_DEFAULTS: Record<(typeof ANIMATION_LONGHANDS)[number], StyleValue> = {
  animationName: { type: "unparsed", value: "none" },
  animationDuration: { type: "unit", value: 0, unit: "ms" },
  animationTimingFunction: { type: "keyword", value: "ease" },
  animationDelay: { type: "unit", value: 0, unit: "ms" },
  animationIterationCount: { type: "unit", value: 1, unit: "number" },
  animationDirection: { type: "unparsed", value: "normal" },
  animationFillMode: { type: "unparsed", value: "none" },
  animationPlayState: { type: "unparsed", value: "running" },
};

function getLayerCount(v: StyleValue | undefined): number {
  if (!v) return 0;
  if (v.type === "layers" || v.type === "tuple") return v.value.length;
  return 1;
}

function toLayersWithLength(v: StyleValue, target: number, fill: StyleValue): StyleValue {
  const base = v.type === "layers" ? v.value.slice() : v.type === "tuple" ? v.value.slice() : [v];
  while (base.length < target) base.push(fill);
  return { type: "layers", value: base };
}

/**
 * Given a set of partial decls (one breakpoint+state cohort), returns the additional decls
 * needed to complete the missing transition longhands, plus possibly upgrading existing
 * ones to layers shape with the right length.
 *
 * Call this from tools that batch-apply styles, grouped by (styleSourceId, breakpointId, state).
 */
export function ensureTransitionLonghands(
  current: Record<string, StyleValue | undefined>,
): Record<string, StyleValue> {
  const presentCount = TRANSITION_LONGHANDS.map((p) => getLayerCount(current[p])).reduce(
    (a, b) => Math.max(a, b),
    0,
  );
  if (presentCount === 0) return {};
  const out: Record<string, StyleValue> = {};
  for (const p of TRANSITION_LONGHANDS) {
    const existing = current[p];
    if (!existing) {
      out[p] = { type: "layers", value: Array(presentCount).fill(TRANSITION_DEFAULTS[p]) };
    } else if (existing.type !== "layers" || existing.value.length < presentCount) {
      out[p] = toLayersWithLength(existing, presentCount, TRANSITION_DEFAULTS[p]);
    }
  }
  return out;
}

/** Same logic for animation longhands. */
export function ensureAnimationLonghands(
  current: Record<string, StyleValue | undefined>,
): Record<string, StyleValue> {
  const presentCount = ANIMATION_LONGHANDS.map((p) => getLayerCount(current[p])).reduce(
    (a, b) => Math.max(a, b),
    0,
  );
  if (presentCount === 0) return {};
  const out: Record<string, StyleValue> = {};
  for (const p of ANIMATION_LONGHANDS) {
    const existing = current[p];
    if (!existing) {
      out[p] = { type: "layers", value: Array(presentCount).fill(ANIMATION_DEFAULTS[p]) };
    } else if (existing.type !== "layers" || existing.value.length < presentCount) {
      out[p] = toLayersWithLength(existing, presentCount, ANIMATION_DEFAULTS[p]);
    }
  }
  return out;
}

/**
 * Convenience for callers (update_styles / update_token_styles): given a batch of in-flight
 * decls + a snapshot of existing decls on the same target, returns the augmented batch with
 * any missing transition/animation longhand decls injected.
 *
 * `existing` = decls already on the same styleSource+breakpoint+state (read from the build).
 * `incoming` = decls the user is pushing in this call.
 * Returns the union with completer decls added (existing transitions are NOT overwritten if
 * the incoming batch doesn't touch a given longhand).
 */
// ─── Shadow properties — validation ─────────────────────────────────────────
//
// Webstudio Cloud accepts decls like `{property:"boxShadow", value:{type:"unparsed", value:"var(--xxx)"}}`
// silently (no API error) but does NOT render them — the Style panel reads them as empty.
// The UI only decodes `{type:"layers", value:[{type:"shadow", offsetX, offsetY, blur, spread, color, position?}]}`.
// Detected in prod 2026-05-20 (template-acme): user pushed `boxShadow: var(--acme-shadow-card)`,
// Webstudio accepted the patch but the shadow never appeared until manually re-entered via the UI.
// We refuse this at the MCP boundary with an explicit error guiding to the structured shape.

const SHADOW_PROPS = new Set<string>(["boxShadow", "textShadow", "WebkitBoxShadow"]);

/** True if `property` is a shadow CSS property whose value must be structured (`layers`). */
export function isShadowProperty(property: string): boolean {
  return SHADOW_PROPS.has(property);
}

/**
 * Validates a single (property, value) pair. Returns null if OK, else a human-readable error.
 * Currently catches: shadow properties with `{type:"unparsed", value:"var(...)"}` (silently
 * accepted by Webstudio but never rendered).
 */
/** Recursively walks a StyleValue tree and returns true if any descendant has type "var". */
function containsVar(v: StyleValue): boolean {
  if (!v || typeof v !== "object") return false;
  if (v.type === "var") return true;
  if (v.type === "tuple" || v.type === "layers") {
    return (v.value as StyleValue[]).some(containsVar);
  }
  if (v.type === "function") {
    const args = (v as { args?: StyleValue }).args;
    return args ? containsVar(args) : false;
  }
  return false;
}

export function validateStyleValue(property: string, value: StyleValue): string | null {
  // Webstudio Transform panel cannot decode `transform: tuple[function(scale, [var]) ]` —
  // CSS sortie est `scale(var(--x))` (runtime OK) MAIS le champ UI Transform reste vide.
  // Recommander les props individuelles modernes (scale/translate/rotate) qui acceptent
  // tuple[var] directement. Incident a production site brand-logo-scale 2026-05-21.
  if (property === "transform" && value && (value as StyleValue).type === "tuple") {
    const items = (value as { value: StyleValue[] }).value;
    for (const item of items) {
      if (item && item.type === "function") {
        const fn = item as { name: string; args?: StyleValue };
        if (fn.args && containsVar(fn.args)) {
          const example = `{ "property": "${fn.name}", "value": { "type": "tuple", "value": [{ "type": "var", "value": "your-var-name" }] } }`;
          return `transform value contains ${fn.name}(var(...)) which is invisible in the Webstudio Transform panel (runtime renders but UI field stays empty). Use the modern individual transform property "${fn.name}" with a tuple of vars: ${example}.`;
        }
      }
    }
  }
  if (isShadowProperty(property) && value.type === "unparsed") {
    const v = (value as { value: string }).value.trim();
    if (/var\s*\(/i.test(v)) {
      const example =
        property === "textShadow"
          ? `{ "type": "layers", "value": [{ "type": "shadow", "offsetX": {"type":"unit","value":0,"unit":"px"}, "offsetY": {"type":"unit","value":2,"unit":"px"}, "blur": {"type":"unit","value":4,"unit":"px"}, "color": {"type":"rgb","r":0,"g":0,"b":0,"alpha":0.25} }] }`
          : `{ "type": "layers", "value": [{ "type": "shadow", "position": "outset", "offsetX": {"type":"unit","value":0,"unit":"px"}, "offsetY": {"type":"unit","value":4,"unit":"px"}, "blur": {"type":"unit","value":12,"unit":"px"}, "spread": {"type":"unit","value":0,"unit":"px"}, "color": {"type":"rgb","r":0,"g":0,"b":0,"alpha":0.25} }] }`;
      return `${property} value {type:"unparsed", value:"${v}"} is silently ignored by Webstudio (the UI cannot decode var() in shadow shorthand). Use the structured shape instead: ${example}. If you need the var() indirection, resolve it client-side first or hard-code the shadow values.`;
    }
  }
  return null;
}

/** Throwing variant of validateStyleValue — for code paths that build then push (buildFromArgs). */
export function assertValidStyleValue(property: string, value: StyleValue): void {
  const err = validateStyleValue(property, value);
  if (err) throw new Error(err);
}

export function completeTransitionAnimationLonghands(
  existing: Pick<StyleDecl, "property" | "value">[],
  incoming: Pick<StyleDecl, "property" | "value">[],
): Pick<StyleDecl, "property" | "value">[] {
  const merged: Record<string, StyleValue> = {};
  for (const d of existing) merged[d.property] = d.value;
  for (const d of incoming) merged[d.property] = d.value;

  const transitionExtras = ensureTransitionLonghands(merged);
  const animationExtras = ensureAnimationLonghands(merged);

  const result = [...incoming];
  const incomingKeys = new Set(incoming.map((d) => d.property));
  for (const [property, value] of Object.entries({ ...transitionExtras, ...animationExtras })) {
    if (!incomingKeys.has(property)) {
      result.push({ property, value });
    } else {
      // Replace the incoming decl with the completer-upgraded version
      const idx = result.findIndex((d) => d.property === property);
      if (idx >= 0) result[idx] = { property, value };
    }
  }
  return result;
}
