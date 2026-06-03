// Parsers for Figma variable values + naming normalization.
//
// Figma `get_variable_defs` returns a flat dict where values can be:
//  - hex color string ("#82bb25")
//  - number-as-string ("16", "9999")
//  - composite Font string: Font(family: "Sora", style: Bold, size: <ref>, weight: 700, lineHeight: 100, letterSpacing: 0)
// Names use "/" as namespace separator ("the project/color/primary", "title/h1", "acme-title/h1").

import type { StyleValue } from "../../types.js";

// ---- ASCII transliteration (FR common chars) ------------------------------
const TRANSLIT_MAP: Record<string, string> = {
  "à": "a", "â": "a", "ä": "a", "á": "a", "ã": "a", "å": "a",
  "ç": "c",
  "é": "e", "è": "e", "ê": "e", "ë": "e",
  "í": "i", "ì": "i", "î": "i", "ï": "i",
  "ñ": "n",
  "ó": "o", "ò": "o", "ô": "o", "ö": "o", "õ": "o", "ø": "o",
  "ú": "u", "ù": "u", "û": "u", "ü": "u",
  "ý": "y", "ÿ": "y",
  "œ": "oe", "æ": "ae",
  "ß": "ss",
};

export function translitAscii(input: string): string {
  let out = "";
  for (const ch of input) {
    const lower = ch.toLowerCase();
    if (TRANSLIT_MAP[lower] !== undefined) {
      out += ch === lower ? TRANSLIT_MAP[lower] : TRANSLIT_MAP[lower].toUpperCase();
    } else {
      out += ch;
    }
  }
  // Strip any remaining non-ASCII char
  return out.replace(/[^\x00-\x7F]/g, "");
}

/** Normalize: ASCII + lowercase + slashes/spaces/underscores → dashes + collapse dashes. */
export function normalizeName(raw: string): string {
  return translitAscii(raw)
    .toLowerCase()
    .replace(/[\s/_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Ensure a CSS var name (no leading "--") starts with `<prefix>-`. */
export function ensurePrefix(name: string, prefix: string): string {
  const p = normalizeName(prefix);
  const n = normalizeName(name);
  if (!p) return n;
  if (n === p || n.startsWith(`${p}-`)) return n;
  return `${p}-${n}`;
}

/** Strip leading "the project/" or similar leading "<prefix>/" segment from a figma key. Returns canonical "category/sub". */
export function stripFigmaPrefix(figmaKey: string): string {
  // Figma keys like "the project/color/primary" → we strip the brand namespace token (1st segment if it looks like a brand).
  // Heuristic: if 1st segment is ALL UPPERCASE OR contains no known category word and there are 3+ segments, strip.
  const parts = figmaKey.split("/");
  if (parts.length < 2) return figmaKey;
  const first = parts[0];
  if (/^[A-Z0-9_-]+$/.test(first) && parts.length >= 2) {
    return parts.slice(1).join("/");
  }
  return figmaKey;
}

// ---- Value parsers --------------------------------------------------------

export function isHex(value: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value.trim());
}

export function hexToColor(hex: string): StyleValue {
  let h = hex.trim().startsWith("#") ? hex.trim().slice(1) : hex.trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  let alpha = 1;
  if (h.length === 8) {
    alpha = parseInt(h.slice(6, 8), 16) / 255;
    h = h.slice(0, 6);
  }
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return { type: "color", colorSpace: "hex", components: [r, g, b], alpha };
}

export function isNumberLike(value: string): boolean {
  return /^-?\d+(\.\d+)?(px|rem|em|%)?$/.test(value.trim());
}

/** Parses a numeric value, returning the bare number + an optional explicit unit. */
export function parseNumber(value: string): { n: number; explicitUnit?: string } {
  const m = value.trim().match(/^(-?\d+(?:\.\d+)?)(px|rem|em|%)?$/);
  if (!m) return { n: NaN };
  return { n: parseFloat(m[1]), explicitUnit: m[2] };
}

/** Convert a raw px value to rem, rounded to 4 decimals. */
export function pxToRem(px: number): number {
  return Math.round((px / 16) * 10000) / 10000;
}

// ---- Font composite parser -----------------------------------------------

export type ParsedFont = {
  family?: string;
  style?: string;
  /** Either { type:"unit", value, unit } OR { type:"var", value:"<name>" } — caller resolves the ref. */
  sizeRaw?: string;
  weight?: number;
  lineHeightRaw?: number;
  letterSpacingRaw?: number;
};

/**
 * Parse a Figma Font(...) composite string.
 * Example: Font(family: "Sora", style: Bold, size: acme-title/h1, weight: 700, lineHeight: 100, letterSpacing: 0)
 */
export function parseFont(value: string): ParsedFont | null {
  const trimmed = value.trim();
  if (!trimmed.toLowerCase().startsWith("font(") || !trimmed.endsWith(")")) return null;
  const inner = trimmed.slice(5, -1);

  const out: ParsedFont = {};
  // Split by comma at top level (no nested parens expected here)
  const parts = inner.split(",").map((s) => s.trim());
  for (const part of parts) {
    const eq = part.indexOf(":");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    let val = part.slice(eq + 1).trim();
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    switch (key) {
      case "family": out.family = val; break;
      case "style": out.style = val; break;
      case "size": out.sizeRaw = val; break;
      case "weight": out.weight = parseFloat(val); break;
      case "lineheight": out.lineHeightRaw = parseFloat(val); break;
      case "letterspacing": out.letterSpacingRaw = parseFloat(val); break;
    }
  }
  return out;
}

/**
 * Heuristic conversion of Figma lineHeight to a CSS value.
 * - < 10  → unitless multiplier (e.g. 1.5 → 1.5)
 * - 10..200 → treat as % (100 → 1.0 unitless), warn if unusual
 * - else → px
 */
export function convertLineHeight(raw: number): { value: StyleValue; warning?: string } {
  if (isNaN(raw)) return { value: { type: "unit", value: 1, unit: "number" } };
  if (raw < 10) {
    return { value: { type: "unit", value: raw, unit: "number" } };
  }
  if (raw <= 200) {
    const ratio = Math.round((raw / 100) * 1000) / 1000;
    let warning: string | undefined;
    if (raw !== 100 && raw !== 120 && raw !== 130 && raw !== 140 && raw !== 150) {
      warning = `lineHeight=${raw} treated as ${ratio} (% / 100). Verify intent.`;
    }
    return { value: { type: "unit", value: ratio, unit: "number" }, warning };
  }
  return {
    value: { type: "unit", value: raw, unit: "px" },
    warning: `lineHeight=${raw} treated as px. Verify intent.`,
  };
}

// ---- Token name humanization (figmaKey → display name) -------------------

/** "title/h1" → "Title H1"; "text/m" → "Body M"; "brand/heading/large" → "Heading Large". */
export function humanizeTokenName(figmaKey: string): string {
  const stripped = stripFigmaPrefix(figmaKey);
  const parts = stripped.split("/").map((p) => p.trim()).filter(Boolean);
  // category aliases
  const aliasMap: Record<string, string> = { text: "Body", title: "Title", heading: "Heading", body: "Body" };
  const remap = parts.map((p, i) => {
    if (i === 0 && aliasMap[p.toLowerCase()]) return aliasMap[p.toLowerCase()];
    return p.charAt(0).toUpperCase() + p.slice(1);
  });
  return remap.join(" ");
}

// ---- CSS var name derivation ---------------------------------------------

/** Strip well-known typography source prefixes (e.g. "acme-") from the FRONT of a key. */
export function stripSizeSourcePrefix(name: string): string {
  // Heuristic: any "<word>-title-..." or "<word>-text-..." → drop the leading word.
  return name.replace(/^[a-z0-9]+-(title|text|heading|body)-/, "$1-");
}

/**
 * Derive a CSS var name (without "--") from the figma key + category hint.
 * category drives the resulting prefix segment (e.g. "color", "space", "radius", "title", "text").
 */
export function deriveCssVarName(figmaKey: string, prefix: string): string {
  const stripped = stripFigmaPrefix(figmaKey);
  let normalized = normalizeName(stripped);
  // Map "spacing" → "space" for shorter vars (CSS convention)
  normalized = normalized.replace(/^spacing-/, "space-");
  // Strip leading source-prefix on typo size keys (e.g. "acme-title-h1" → "title-h1")
  normalized = stripSizeSourcePrefix(normalized);
  return ensurePrefix(normalized, prefix);
}

/** Categorize a figma key into a kind (color | size | radius | typo-size | typo-token | unknown). */
export type FigmaKeyCategory = "color" | "spacing" | "radius" | "typo-size" | "typo-token" | "unknown";

export function categorizeKey(figmaKey: string, figmaValue: string): FigmaKeyCategory {
  const key = figmaKey.toLowerCase();
  if (isHex(figmaValue)) return "color";
  if (parseFont(figmaValue)) return "typo-token";
  if (/(^|\/|-)(color|colour)(\/|-|$)/.test(key)) return "color";
  if (/(^|\/|-)(spacing|space|gap|padding|margin)(\/|-|$)/.test(key)) return "spacing";
  if (/(^|\/|-)radius(\/|-|$)/.test(key)) return "radius";
  if (/(^|\/|-)(title|text|heading|body|font-size|fontsize)(\/|-|$)/.test(key)) return "typo-size";
  return "unknown";
}
