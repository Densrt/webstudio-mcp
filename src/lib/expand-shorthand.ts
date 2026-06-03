// Auto-expansion of CSS shorthand properties to their longhand decls.
//
// Webstudio stores CSS as longhand declarations. Pushing a shorthand like
// `flex: 1 1 380px` as {type:"unparsed", value:"1 1 380px"} is accepted by
// the build endpoint but the runtime publish step CRASHES (cascade error on
// child instances). This module parses common shorthand grammars and emits
// N individual longhand decls instead.
//
// Strategy: Option B (auto-split) for shorthands with a deterministic grammar.
// Strategy: Option A (reject with hint) for complex shorthands where parsing
// would be a project on its own (background, font, grid, transition/animation).
//
// Discovered on a production site (2026-05-21), bug n°4.

import type { StyleValue } from "../types.js";

// ─── Property classification ────────────────────────────────────────────────

/** Shorthands we auto-expand (parsing implemented below). */
const EXPANDABLE_SHORTHANDS = new Set<string>([
  "flex",
  "padding",
  "margin",
  "inset",
  "gap",
  "overflow",
  "overscrollBehavior",
  "placeItems",
  "placeContent",
  "placeSelf",
  "borderRadius",
  "border",
  "borderWidth",
  "borderStyle",
  "borderColor",
  // Grid-child placement shortcuts — expanded into start/end longhands so the
  // Webstudio Grid Child Manual panel can read + edit the values. See pattern
  // grid-child-placement.md. a production site (2026-05-21) bento incident.
  "gridColumn",
  "gridRow",
]);

/** Shorthands we refuse — parsing too complex, force the caller to longhand. */
const REJECTED_SHORTHANDS = new Set<string>([
  "background",
  "font",
  "grid",
  "gridTemplate",
  "gridArea",
  "animation",
  "transition",
  "outline",
  "textDecoration",
  "listStyle",
  "mask",
]);

export function isShorthandProperty(p: string): boolean {
  return EXPANDABLE_SHORTHANDS.has(p) || REJECTED_SHORTHANDS.has(p);
}

export type ExpandResult =
  | { kind: "passthrough" }
  | {
      kind: "ok";
      decls: Array<{ property: string; value: StyleValue }>;
      /** Optional pedagogical hint surfaced by callers to the user when a silent
       *  coercion happened (e.g. gridColumn shortcut → 2 longhands). The caller
       *  is free to ignore it — backward-compatible with pre-v2.7.2 callers. */
      hint?: string;
      /** Optional telemetry key tagging this coercion. Stable across versions —
       *  used by scripts/telemetry-report.mjs to count "what does the model
       *  keep getting wrong". Caller passes it to logCoerce(). Backward-compat:
       *  pre-v2.7.4 callers ignore the field. v2.7.4+. */
      telemetryKey?: string;
    }
  | { kind: "error"; message: string };

// ─── Tiny parsers (string → StyleValue) ─────────────────────────────────────

function splitTokens(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (cur.trim().length) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim().length) out.push(cur.trim());
  return out;
}

function parseUnit(s: string): StyleValue | null {
  const m = s.trim().match(/^(-?\d*\.?\d+)\s*([a-zA-Z%]*)$/);
  if (!m) return null;
  return { type: "unit", value: parseFloat(m[1]), unit: m[2] || "number" };
}

function parseVar(s: string): StyleValue | null {
  const m = s.trim().match(/^var\(\s*--([^,)]+?)\s*(?:,\s*(.+))?\)$/);
  if (!m) return null;
  return { type: "var", value: m[1].trim() };
}

function parseHexColor(s: string): StyleValue | null {
  const t = s.trim();
  const m = t.match(/^#([0-9a-fA-F]{3,8})$/);
  if (!m) return null;
  const hex = m[1];
  const expand = (h: string) => parseInt(h.length === 1 ? h + h : h, 16) / 255;
  if (hex.length === 3) {
    return { type: "color", colorSpace: "rgb", components: [expand(hex[0]), expand(hex[1]), expand(hex[2])], alpha: 1 };
  }
  if (hex.length === 6) {
    return { type: "color", colorSpace: "rgb", components: [expand(hex.slice(0, 2)), expand(hex.slice(2, 4)), expand(hex.slice(4, 6))], alpha: 1 };
  }
  if (hex.length === 8) {
    return {
      type: "color",
      colorSpace: "rgb",
      components: [expand(hex.slice(0, 2)), expand(hex.slice(2, 4)), expand(hex.slice(4, 6))],
      alpha: expand(hex.slice(6, 8)),
    };
  }
  return null;
}

/** Generic value parser: var → unit → hex → keyword fallback. */
function parseValue(s: string): StyleValue {
  return parseVar(s) ?? parseUnit(s) ?? parseHexColor(s) ?? { type: "keyword", value: s };
}

// ─── CSS edges rule (1/2/3/4 values → top/right/bottom/left) ────────────────

function expandEdges(tokens: string[]): [StyleValue, StyleValue, StyleValue, StyleValue] | null {
  if (tokens.length < 1 || tokens.length > 4) return null;
  const [t1, t2, t3, t4] = tokens;
  const v1 = parseValue(t1);
  const v2 = t2 !== undefined ? parseValue(t2) : v1;
  const v3 = t3 !== undefined ? parseValue(t3) : v1;
  const v4 = t4 !== undefined ? parseValue(t4) : v2;
  return [v1, v2, v3, v4]; // [top, right, bottom, left]
}

function expandEdgeProperty(
  base: "padding" | "margin" | "inset",
  raw: string,
): ExpandResult {
  const tokens = splitTokens(raw);
  const edges = expandEdges(tokens);
  if (!edges) return { kind: "error", message: `${base}: expected 1-4 space-separated values, got "${raw}"` };
  const [top, right, bottom, left] = edges;
  const map = base === "inset"
    ? { top: "top", right: "right", bottom: "bottom", left: "left" }
    : { top: `${base}Top`, right: `${base}Right`, bottom: `${base}Bottom`, left: `${base}Left` };
  return {
    kind: "ok",
    decls: [
      { property: map.top, value: top },
      { property: map.right, value: right },
      { property: map.bottom, value: bottom },
      { property: map.left, value: left },
    ],
  };
}

// ─── flex: <grow> <shrink> <basis> ──────────────────────────────────────────

function expandFlex(raw: string): ExpandResult {
  const t = splitTokens(raw);
  // Special keywords
  if (t.length === 1) {
    const v = t[0].toLowerCase();
    if (v === "none") {
      return {
        kind: "ok",
        decls: [
          { property: "flexGrow", value: { type: "unit", value: 0, unit: "number" } },
          { property: "flexShrink", value: { type: "unit", value: 0, unit: "number" } },
          { property: "flexBasis", value: { type: "keyword", value: "auto" } },
        ],
      };
    }
    if (v === "auto") {
      return {
        kind: "ok",
        decls: [
          { property: "flexGrow", value: { type: "unit", value: 1, unit: "number" } },
          { property: "flexShrink", value: { type: "unit", value: 1, unit: "number" } },
          { property: "flexBasis", value: { type: "keyword", value: "auto" } },
        ],
      };
    }
    if (v === "initial") {
      return {
        kind: "ok",
        decls: [
          { property: "flexGrow", value: { type: "unit", value: 0, unit: "number" } },
          { property: "flexShrink", value: { type: "unit", value: 1, unit: "number" } },
          { property: "flexBasis", value: { type: "keyword", value: "auto" } },
        ],
      };
    }
    // Single number: <grow> with shrink=1, basis=0
    const u = parseUnit(t[0]);
    if (u && u.type === "unit" && u.unit === "number") {
      return {
        kind: "ok",
        decls: [
          { property: "flexGrow", value: u },
          { property: "flexShrink", value: { type: "unit", value: 1, unit: "number" } },
          { property: "flexBasis", value: { type: "unit", value: 0, unit: "px" } },
        ],
      };
    }
    return { kind: "error", message: `flex: single value "${raw}" not recognized (use none/auto/initial or a number)` };
  }
  if (t.length === 2) {
    // "<grow> <shrink>" or "<grow> <basis>"
    const g = parseUnit(t[0]);
    const second = parseUnit(t[1]);
    if (!g || g.type !== "unit") return { kind: "error", message: `flex: first value must be a number, got "${t[0]}"` };
    if (!second) return { kind: "error", message: `flex: second value "${t[1]}" not parseable` };
    const secondIsNumber = second.type === "unit" && second.unit === "number";
    return {
      kind: "ok",
      decls: secondIsNumber
        ? [
            { property: "flexGrow", value: g },
            { property: "flexShrink", value: second },
            { property: "flexBasis", value: { type: "unit", value: 0, unit: "px" } },
          ]
        : [
            { property: "flexGrow", value: g },
            { property: "flexShrink", value: { type: "unit", value: 1, unit: "number" } },
            { property: "flexBasis", value: second },
          ],
    };
  }
  if (t.length === 3) {
    const g = parseUnit(t[0]);
    const s = parseUnit(t[1]);
    const b = parseValue(t[2]);
    if (!g || !s) return { kind: "error", message: `flex: grow and shrink must be numbers in "${raw}"` };
    return {
      kind: "ok",
      decls: [
        { property: "flexGrow", value: g },
        { property: "flexShrink", value: s },
        { property: "flexBasis", value: b },
      ],
    };
  }
  return { kind: "error", message: `flex: expected 1-3 values, got ${t.length} in "${raw}"` };
}

// ─── gap / overflow / placeItems / overscrollBehavior — 1 or 2 values ───────

function expandDual(
  raw: string,
  firstProp: string,
  secondProp: string,
  label: string,
): ExpandResult {
  const t = splitTokens(raw);
  if (t.length < 1 || t.length > 2) {
    return { kind: "error", message: `${label}: expected 1-2 space-separated values, got "${raw}"` };
  }
  const a = parseValue(t[0]);
  const b = t.length === 2 ? parseValue(t[1]) : a;
  return { kind: "ok", decls: [{ property: firstProp, value: a }, { property: secondProp, value: b }] };
}

// ─── borderRadius: 1-4 values, optionally with "/" for elliptic ─────────────

function expandBorderRadius(raw: string): ExpandResult {
  // We don't support the "/" elliptic syntax — too rare, force longhand.
  if (raw.includes("/")) {
    return { kind: "error", message: `borderRadius elliptic syntax "/" not supported — push borderTopLeftRadius/etc. longhands directly.` };
  }
  const t = splitTokens(raw);
  if (t.length < 1 || t.length > 4) {
    return { kind: "error", message: `borderRadius: expected 1-4 values, got "${raw}"` };
  }
  const [t1, t2, t3, t4] = t;
  const v1 = parseValue(t1);
  const v2 = t2 !== undefined ? parseValue(t2) : v1;
  const v3 = t3 !== undefined ? parseValue(t3) : v1;
  const v4 = t4 !== undefined ? parseValue(t4) : v2;
  // CSS order: top-left, top-right, bottom-right, bottom-left
  return {
    kind: "ok",
    decls: [
      { property: "borderTopLeftRadius", value: v1 },
      { property: "borderTopRightRadius", value: v2 },
      { property: "borderBottomRightRadius", value: v3 },
      { property: "borderBottomLeftRadius", value: v4 },
    ],
  };
}

// ─── border: <width> <style> <color> (any order) → 12 decls ────────────────

const BORDER_STYLES = new Set([
  "none", "hidden", "dotted", "dashed", "solid", "double", "groove", "ridge", "inset", "outset",
]);

function classifyBorderToken(tok: string): { kind: "width" | "style" | "color"; value: StyleValue } | null {
  const lower = tok.toLowerCase();
  if (BORDER_STYLES.has(lower)) return { kind: "style", value: { type: "keyword", value: lower } };
  const hex = parseHexColor(tok);
  if (hex) return { kind: "color", value: hex };
  const v = parseVar(tok);
  if (v) {
    // var() — ambiguous, assume color (most common use). Could be enhanced if needed.
    return { kind: "color", value: v };
  }
  const u = parseUnit(tok);
  if (u) return { kind: "width", value: u };
  // Named colors fallback — treat keyword as color (heuristic)
  return { kind: "color", value: { type: "keyword", value: tok } };
}

function expandBorder(raw: string): ExpandResult {
  const t = splitTokens(raw);
  if (t.length < 1 || t.length > 3) {
    return { kind: "error", message: `border: expected 1-3 values (width, style, color in any order), got "${raw}"` };
  }
  let width: StyleValue | undefined;
  let style: StyleValue | undefined;
  let color: StyleValue | undefined;
  for (const tok of t) {
    const c = classifyBorderToken(tok);
    if (!c) return { kind: "error", message: `border: token "${tok}" not classifiable` };
    if (c.kind === "width" && !width) width = c.value;
    else if (c.kind === "style" && !style) style = c.value;
    else if (c.kind === "color" && !color) color = c.value;
    else return { kind: "error", message: `border: duplicate ${c.kind} token "${tok}" in "${raw}"` };
  }
  const sides = ["Top", "Right", "Bottom", "Left"];
  const decls: Array<{ property: string; value: StyleValue }> = [];
  for (const side of sides) {
    if (width) decls.push({ property: `border${side}Width`, value: width });
    if (style) decls.push({ property: `border${side}Style`, value: style });
    if (color) decls.push({ property: `border${side}Color`, value: color });
  }
  return { kind: "ok", decls };
}

// ─── gridColumn / gridRow shortcuts — start/end longhands ───────────────────
//
// CSS spec:
//   "4"           → grid-column-start: 4, grid-column-end: auto (treated as 1-cell span: start to start+1)
//   "4 / 5"       → grid-column-start: 4, grid-column-end: 5
//   "span 2"      → grid-column-start: auto, grid-column-end: span 2
//   "4 / span 2"  → grid-column-start: 4,    grid-column-end: span 2
//   "auto"        → both: auto
//
// The Webstudio Grid Child Manual panel reads `gridColumnStart` / `gridColumnEnd`
// (and same for Row) as separate longhands in {type:"unit", value:N, unit:"number"}.
// The shortcut form (gridColumn as a single decl) is accepted by the backend but
// invisible in the UI — user sees default 1/2/1/2. See pattern grid-child-placement.

function parseGridSide(s: string): { value: StyleValue; isSpan: boolean } | null {
  const t = s.trim();
  if (!t) return null;
  const spanMatch = t.match(/^span\s+(.+)$/i);
  if (spanMatch) {
    const innerRaw = spanMatch[1].trim();
    const inner = parseUnit(innerRaw) ?? parseVar(innerRaw) ?? ({ type: "keyword", value: innerRaw } as StyleValue);
    return {
      value: { type: "tuple", value: [{ type: "keyword", value: "span" }, inner] },
      isSpan: true,
    };
  }
  if (/^auto$/i.test(t)) {
    return { value: { type: "keyword", value: "auto" }, isSpan: false };
  }
  const num = parseUnit(t);
  if (num && num.type === "unit" && num.unit === "number") {
    return { value: num, isSpan: false };
  }
  const v = parseVar(t);
  if (v) return { value: v, isSpan: false };
  return null;
}

function expandGridLine(base: "Column" | "Row", raw: string): ExpandResult {
  const startProp = `grid${base}Start`;
  const endProp = `grid${base}End`;
  const tKey = `expand:grid${base}`; // "expand:gridColumn" or "expand:gridRow"

  if (raw.includes("/")) {
    const parts = raw.split("/");
    if (parts.length !== 2) {
      return { kind: "error", message: `grid${base}: expected "<start> / <end>" with a single "/", got "${raw}".` };
    }
    const startSide = parseGridSide(parts[0]);
    const endSide = parseGridSide(parts[1]);
    if (!startSide || !endSide) {
      return { kind: "error", message: `grid${base}: could not parse "${raw}" (expected "N / M" or "N / span K" or similar).` };
    }
    return {
      kind: "ok",
      decls: [
        { property: startProp, value: startSide.value },
        { property: endProp, value: endSide.value },
      ],
      hint: `grid${base} shortcut "${raw}" expanded to ${startProp} + ${endProp}. Webstudio Grid Child panel reads the longhands directly — see pattern grid-child-placement.`,
      telemetryKey: tKey,
    };
  }

  // Single value (no "/").
  const side = parseGridSide(raw);
  if (!side) {
    return { kind: "error", message: `grid${base}: could not parse "${raw}".` };
  }
  if (side.isSpan) {
    return {
      kind: "ok",
      decls: [
        { property: startProp, value: { type: "keyword", value: "auto" } },
        { property: endProp, value: side.value },
      ],
      hint: `grid${base} shortcut "${raw}" expanded to ${startProp}:auto + ${endProp}:span (Area mode). See pattern grid-child-placement.`,
      telemetryKey: tKey,
    };
  }
  if (side.value.type === "unit" && side.value.unit === "number") {
    const startNum = (side.value as { value: number }).value;
    return {
      kind: "ok",
      decls: [
        { property: startProp, value: { type: "unit", value: startNum, unit: "number" } },
        { property: endProp, value: { type: "unit", value: startNum + 1, unit: "number" } },
      ],
      hint: `grid${base} shortcut "${raw}" interpreted as Manual mode line ${startNum} (1-cell span) → ${startProp}:${startNum}, ${endProp}:${startNum + 1}. See pattern grid-child-placement.`,
      telemetryKey: tKey,
    };
  }
  // auto/var or other keyword
  return {
    kind: "ok",
    decls: [
      { property: startProp, value: side.value },
      { property: endProp, value: { type: "keyword", value: "auto" } },
    ],
    hint: `grid${base} shortcut "${raw}" expanded to ${startProp} + ${endProp}:auto. See pattern grid-child-placement.`,
    telemetryKey: tKey,
  };
}

// ─── Grid-child longhand coercion (unparsed digit → unit number) ────────────
//
// Even when the caller writes the longhands directly (gridColumnStart, etc.),
// they often pass them as {type:"unparsed", value:"4"} which the Webstudio
// Grid Child Manual panel cannot decode. This helper coerces those into the
// canonical {type:"unit", value:N, unit:"number"} shape. Exported separately
// from expandShorthand so callers can apply it after the shorthand pass.

const GRID_CHILD_LONGHANDS = new Set<string>([
  "gridColumnStart",
  "gridColumnEnd",
  "gridRowStart",
  "gridRowEnd",
]);

// ─── Manual single-cell grid placement detection (v2.7.3) ──────────────────
//
// "Anti-pattern C — Manual partout par mimétisme" detector. When the caller
// pushes N≥3 instances each with `gridColumnStart/End/gridRowStart/End` in
// {type:"unit", unit:"number"} forming a single-cell pattern (start=N, end=N+1)
// on the same breakpoint, the auto-flow `Area span 1` form would be more DRY,
// robust to grid changes, and reflect the intent better. We emit a soft hint —
// never block the push. See pattern grid-child-placement.

const GRID_CHILD_4_LONGHANDS = ["gridColumnStart", "gridColumnEnd", "gridRowStart", "gridRowEnd"] as const;

function isUnitNumber(v: unknown): v is { type: "unit"; value: number; unit: "number" } {
  return (
    !!v &&
    typeof v === "object" &&
    (v as { type?: string }).type === "unit" &&
    (v as { unit?: string }).unit === "number" &&
    typeof (v as { value?: unknown }).value === "number"
  );
}

export type GridDetectInput = {
  instanceId: string;
  property: string;
  value: StyleValue;
  breakpoint?: string;
  state?: string;
};

/** Result of detectManualSingleCellPattern. Each entry = one breakpoint where
 *  the anti-pattern was detected (≥ minInstances matching). `count` lets the
 *  caller emit telemetry with the exact magnitude. v2.7.4. */
export type ManualSingleCellHit = {
  hint: string;
  count: number;
  breakpoint: string;
  telemetryKey: string;
};

export function detectManualSingleCellPattern(
  updates: GridDetectInput[],
  minInstances = 3,
): ManualSingleCellHit[] {
  type GridPropMap = Map<string, StyleValue>;
  const grouped = new Map<string, GridPropMap>(); // key = `${instanceId}::${breakpoint}::${state}`

  for (const u of updates) {
    if (!(GRID_CHILD_4_LONGHANDS as readonly string[]).includes(u.property)) continue;
    const bp = u.breakpoint ?? "base";
    const st = u.state ?? "";
    const key = `${u.instanceId}::${bp}::${st}`;
    let m = grouped.get(key);
    if (!m) { m = new Map(); grouped.set(key, m); }
    m.set(u.property, u.value);
  }

  const singleCellByBpState = new Map<string, number>(); // key = `${breakpoint}::${state}` → count
  for (const [key, props] of grouped) {
    const parts = key.split("::");
    const bpKey = `${parts[1]}::${parts[2]}`;
    const colStart = props.get("gridColumnStart");
    const colEnd = props.get("gridColumnEnd");
    const rowStart = props.get("gridRowStart");
    const rowEnd = props.get("gridRowEnd");
    if (!isUnitNumber(colStart) || !isUnitNumber(colEnd) || !isUnitNumber(rowStart) || !isUnitNumber(rowEnd)) continue;
    if (colEnd.value !== colStart.value + 1) continue;
    if (rowEnd.value !== rowStart.value + 1) continue;
    singleCellByBpState.set(bpKey, (singleCellByBpState.get(bpKey) ?? 0) + 1);
  }

  const hits: ManualSingleCellHit[] = [];
  for (const [bp, count] of singleCellByBpState) {
    if (count >= minInstances) {
      const bpLabel = bp.split("::")[0] || "base";
      hits.push({
        hint: `${count} instances pushed with Manual single-cell grid placement on breakpoint "${bpLabel}" that could be Area span 1 (auto-flow). See pattern grid-child-placement (Anti-pattern C).`,
        count,
        breakpoint: bpLabel,
        telemetryKey: "detect:manual-single-cell",
      });
    }
  }
  return hits;
}

// ─── aspectRatio whitespace normalization (v2.7.3) ──────────────────────────
//
// aspectRatio is often written in two equivalent CSS forms:
//   "16/9"   — no spaces (typical when typed quickly in the UI)
//   "16 / 9" — spaces around the slash (canonical CSS)
// Both render correctly, but mixing them in the same build is ugly. a production site
// "Card Brand Bento" token had "16/9" (UI input) while the agent pushed
// "16 / 9" on local overrides — two flavors in the same project.
// We normalise to the spaced form for canonical consistency. Keywords
// ("auto", "inherit") pass through untouched.

export function coerceAspectRatio(property: string, value: StyleValue): ExpandResult {
  if (property !== "aspectRatio") return { kind: "passthrough" };
  if (value.type !== "unparsed") return { kind: "passthrough" };
  const raw = (value as { value: string }).value;
  const trimmed = raw.trim();
  if (!trimmed) return { kind: "passthrough" };
  const m = trimmed.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m) return { kind: "passthrough" };
  const canonical = `${m[1]} / ${m[2]}`;
  if (canonical === raw) return { kind: "passthrough" };
  return {
    kind: "ok",
    decls: [{ property, value: { type: "unparsed", value: canonical } }],
    hint: `aspectRatio value normalized from "${raw}" to "${canonical}" for canonical CSS format consistency. See pattern grid-child-placement.`,
    telemetryKey: "coerce:aspectRatio",
  };
}

export function coerceGridChildLonghand(property: string, value: StyleValue): ExpandResult {
  if (!GRID_CHILD_LONGHANDS.has(property)) return { kind: "passthrough" };
  if (value.type !== "unparsed") return { kind: "passthrough" };
  const raw = (value as { value: string }).value.trim();
  if (!raw) return { kind: "passthrough" };
  // Digit-only → unit number
  if (/^-?\d+$/.test(raw)) {
    return {
      kind: "ok",
      decls: [{ property, value: { type: "unit", value: parseInt(raw, 10), unit: "number" } }],
      hint: `${property} value coerced from unparsed "${raw}" to unit ${raw} (number) — the Webstudio Grid Child Manual panel requires {type:"unit"} to display + edit. See pattern grid-child-placement.`,
      telemetryKey: "coerce:gridChildLonghand-digit",
    };
  }
  // "span N" → tuple[span, N]
  const spanMatch = raw.match(/^span\s+(\d+)$/i);
  if (spanMatch) {
    const n = parseInt(spanMatch[1], 10);
    return {
      kind: "ok",
      decls: [{
        property,
        value: { type: "tuple", value: [{ type: "keyword", value: "span" }, { type: "unit", value: n, unit: "number" }] },
      }],
      hint: `${property} value coerced from unparsed "${raw}" to tuple[span, ${n}] — see pattern grid-child-placement (Area mode).`,
      telemetryKey: "coerce:gridChildLonghand-span",
    };
  }
  return { kind: "passthrough" };
}

function expandBorderUniform(raw: string, suffix: "Width" | "Style" | "Color", label: string): ExpandResult {
  const t = splitTokens(raw);
  const edges = expandEdges(t);
  if (!edges) return { kind: "error", message: `${label}: expected 1-4 values, got "${raw}"` };
  const [top, right, bottom, left] = edges;
  return {
    kind: "ok",
    decls: [
      { property: `borderTop${suffix}`, value: top },
      { property: `borderRight${suffix}`, value: right },
      { property: `borderBottom${suffix}`, value: bottom },
      { property: `borderLeft${suffix}`, value: left },
    ],
  };
}

// ─── Uniform-replicate map for typed (non-unparsed) values ──────────────────
//
// A shorthand applied with a *typed* single value (e.g. `padding: var(--s)`,
// `borderRadius: { type:"unit", value:8, unit:"px" }`) cannot be parsed as a
// multi-value string. For "uniform" shorthands the only sensible expansion is
// to replicate the same value across every longhand axis. We do so atomically
// (the original shorthand decl is replaced — never coexists with the longhands).
//
// For "non-uniform" shorthands (flex, border) a single typed value is ambiguous
// (which axis is it for?). We reject those at the boundary instead.
//
// a production site (2026-05-21) incident: a `padding` shorthand with `{type:"var"}` made
// it through expand-shorthand's old passthrough branch, broke the publish
// pipeline, and could not be reverted via update_token_styles (add/replace only).

const UNIFORM_REPLICATE: Record<string, string[]> = {
  padding: ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"],
  margin: ["marginTop", "marginRight", "marginBottom", "marginLeft"],
  inset: ["top", "right", "bottom", "left"],
  borderRadius: [
    "borderTopLeftRadius",
    "borderTopRightRadius",
    "borderBottomRightRadius",
    "borderBottomLeftRadius",
  ],
  borderWidth: ["borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth"],
  borderStyle: ["borderTopStyle", "borderRightStyle", "borderBottomStyle", "borderLeftStyle"],
  borderColor: ["borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor"],
  gap: ["rowGap", "columnGap"],
  overflow: ["overflowX", "overflowY"],
  overscrollBehavior: ["overscrollBehaviorX", "overscrollBehaviorY"],
  placeItems: ["alignItems", "justifyItems"],
  placeContent: ["alignContent", "justifyContent"],
  placeSelf: ["alignSelf", "justifySelf"],
};

/** Non-uniform expandable shorthands: typed single value is ambiguous → reject. */
const NON_UNIFORM_EXPANDABLE = new Set<string>(["flex", "border"]);

const NON_UNIFORM_TYPED_HINTS: Record<string, string> = {
  flex: "Decompose into flexGrow / flexShrink / flexBasis individually (a single typed value can't pick which axis it sets).",
  border: "Decompose into borderTop/Right/Bottom/LeftWidth/Style/Color individually (a single typed value can't pick width vs style vs color).",
};

// ─── Dispatcher ─────────────────────────────────────────────────────────────

/**
 * Try to expand a shorthand declaration into longhand decls.
 * - `passthrough` → property is not a shorthand (caller continues unchanged)
 * - `ok` → parsed; replace the original decl with `decls`
 * - `error` → recognized shorthand but parsing failed or typed value is ambiguous.
 *
 * Handles two shapes:
 *  1. `{type:"unparsed", value:"<string>"}` — parse the multi-token grammar.
 *  2. typed value on a uniform shorthand (var/unit/color/keyword/...) — replicate
 *     the same value across every longhand axis (e.g. `padding: var(--s)` → 4 sides).
 *
 * Typed values on `flex` / `border` are rejected (ambiguous mapping to axes).
 * Empty-string unparsed values are passthrough (no shorthand actually posted).
 */
export function expandShorthand(property: string, value: StyleValue): ExpandResult {
  if (!isShorthandProperty(property)) return { kind: "passthrough" };

  if (REJECTED_SHORTHANDS.has(property)) {
    const hints: Record<string, string> = {
      background: "Use backgroundColor / backgroundImage / backgroundSize / backgroundPosition / backgroundRepeat individually.",
      font: "Use fontFamily / fontSize / fontWeight / fontStyle / lineHeight individually.",
      grid: "Use gridTemplateColumns / gridTemplateRows / gridTemplateAreas / gridAutoColumns / gridAutoRows / gridAutoFlow individually.",
      gridTemplate: "Use gridTemplateColumns / gridTemplateRows / gridTemplateAreas individually.",
      gridArea: "Use gridRowStart / gridRowEnd / gridColumnStart / gridColumnEnd individually.",
      animation: "Use animationName / animationDuration / animationTimingFunction / animationDelay / animationIterationCount / animationDirection / animationFillMode / animationPlayState individually.",
      transition: "Use transitionProperty / transitionDuration / transitionTimingFunction / transitionDelay individually.",
      outline: "Use outlineWidth / outlineStyle / outlineColor / outlineOffset individually.",
      textDecoration: "Use textDecorationLine / textDecorationStyle / textDecorationColor / textDecorationThickness individually.",
      listStyle: "Use listStyleType / listStylePosition / listStyleImage individually.",
      mask: "Use maskImage / maskMode / maskRepeat / maskPosition / maskSize individually.",
    };
    const hint = hints[property] ?? "Decompose into longhand properties.";
    return { kind: "error", message: `${property} shorthand causes publish failures in Webstudio. ${hint}` };
  }

  // Typed (non-unparsed) value on an expandable shorthand.
  // a production site incident: a typed `var()` padding bypassed parsing and broke publish.
  if (value.type !== "unparsed") {
    // gridColumn/gridRow with a typed unit-number value → treat as Manual line N.
    // E.g. `{type:"unit", value:4, unit:"number"}` on gridColumn → start:4, end:5.
    // Other typed shapes (var, keyword, color) are ambiguous on a 2-axis shorthand.
    if ((property === "gridColumn" || property === "gridRow") && value.type === "unit" && (value as { unit?: string }).unit === "number") {
      const base = property === "gridColumn" ? "Column" : "Row";
      const startProp = `grid${base}Start`;
      const endProp = `grid${base}End`;
      const n = (value as { value: number }).value;
      return {
        kind: "ok",
        decls: [
          { property: startProp, value: { type: "unit", value: n, unit: "number" } },
          { property: endProp, value: { type: "unit", value: n + 1, unit: "number" } },
        ],
        hint: `${property} typed value ${n} interpreted as Manual line ${n} (1-cell span) → ${startProp}:${n}, ${endProp}:${n + 1}. See pattern grid-child-placement.`,
        telemetryKey: `expand:${property}-typed`,
      };
    }
    const longhands = UNIFORM_REPLICATE[property];
    if (longhands) {
      return { kind: "ok", decls: longhands.map((p) => ({ property: p, value })) };
    }
    if (NON_UNIFORM_EXPANDABLE.has(property)) {
      const hint = NON_UNIFORM_TYPED_HINTS[property] ?? "Decompose into longhand properties.";
      return {
        kind: "error",
        message: `${property} shorthand with a typed ${value.type} value is ambiguous and breaks Webstudio's publish pipeline. ${hint}`,
      };
    }
    // Unexpected shorthand that we declared expandable but didn't list — passthrough to stay safe.
    return { kind: "passthrough" };
  }
  const raw = value.value.trim();
  if (!raw) return { kind: "passthrough" };

  switch (property) {
    case "flex": return expandFlex(raw);
    case "padding": return expandEdgeProperty("padding", raw);
    case "margin": return expandEdgeProperty("margin", raw);
    case "inset": return expandEdgeProperty("inset", raw);
    case "gap": return expandDual(raw, "rowGap", "columnGap", "gap");
    case "overflow": return expandDual(raw, "overflowX", "overflowY", "overflow");
    case "overscrollBehavior": return expandDual(raw, "overscrollBehaviorX", "overscrollBehaviorY", "overscrollBehavior");
    case "placeItems": return expandDual(raw, "alignItems", "justifyItems", "placeItems");
    case "placeContent": return expandDual(raw, "alignContent", "justifyContent", "placeContent");
    case "placeSelf": return expandDual(raw, "alignSelf", "justifySelf", "placeSelf");
    case "borderRadius": return expandBorderRadius(raw);
    case "border": return expandBorder(raw);
    case "borderWidth": return expandBorderUniform(raw, "Width", "borderWidth");
    case "borderStyle": return expandBorderUniform(raw, "Style", "borderStyle");
    case "borderColor": return expandBorderUniform(raw, "Color", "borderColor");
    case "gridColumn": return expandGridLine("Column", raw);
    case "gridRow": return expandGridLine("Row", raw);
  }
  return { kind: "passthrough" };
}
