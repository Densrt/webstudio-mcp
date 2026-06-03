// Scanners for webstudio_audit_fonts — pure, read-only analyses over the build.

import type { WebstudioBuild } from "../../webstudio-client.js";
import { getAssets, type Asset } from "../../lib/asset-helpers.js";

/** Webstudio preferred web-font format. */
export const PREFERRED_FONT_FORMAT = "woff2";

/** Extensions we treat as fonts when type is missing/unknown. */
const FONT_EXTENSIONS = new Set(["woff2", "woff", "ttf", "otf", "eot"]);

export type FontAsset = Asset & {
  /** Normalised family extracted from the asset name (best effort). */
  family: string;
  /** Numeric weight if recognisable in the filename (100..900), else undefined. */
  weight?: number;
  /** Normalised lowercase format ("woff2", "woff", ...). */
  ext: string;
};

/** Webstudio asset names look like "Inter-Regular_xxxxxxxxxxxxxxxxx.woff2".
 *  We strip the random suffix + extension and the weight suffix to derive a family. */
function parseFontMetadata(name: string, format?: string): { family: string; weight?: number; ext: string } {
  // Strip the "_<8-25 chars>.<ext>" Webstudio suffix.
  const stripped = name.replace(/_[A-Za-z0-9_-]{15,25}(\.[A-Za-z0-9]+)$/i, "$1");
  // Pull the extension.
  const extMatch = stripped.match(/\.([A-Za-z0-9]+)$/);
  const ext = (extMatch?.[1] ?? format ?? "").toLowerCase();
  // Base = filename without extension.
  const base = stripped.replace(/\.[A-Za-z0-9]+$/, "");

  // Detect weight: either explicit number (e.g. "Inter-400"), or a known keyword.
  const weight = detectWeight(base);

  // Family = strip trailing "-Weight", "_Weight", " Weight", "Italic" tokens.
  const family = base
    .replace(/[-_ ](?:Thin|ExtraLight|UltraLight|Light|Regular|Normal|Book|Medium|SemiBold|DemiBold|Bold|ExtraBold|UltraBold|Black|Heavy)\b/gi, "")
    .replace(/[-_ ](?:Italic|Oblique)\b/gi, "")
    .replace(/[-_ ]?(?:100|200|300|400|500|600|700|800|900)\b/g, "")
    .replace(/[-_ ]+$/g, "")
    .trim();

  return { family: family || base, weight, ext };
}

/** Detect the Webstudio Cloud `parseSubfamily()` bug: an italic/oblique font file
 *  whose subfamily contains NO weight keyword. Webstudio's parser loops over
 *  fontWeights {100..900} with `for…in`, breaks on the first keyword match, but on
 *  no match `weight` keeps its LAST iterated value = "900" (not the intended 400).
 *  Symptom: `font-weight: 400 italic` renders too heavy (browser fallback); selecting
 *  `font-weight: 900` paradoxically renders the thin italic correctly.
 *  Source: packages/asset-uploader/src/utils/font-data.ts in webstudio-is/webstudio.
 *  Workaround: rename the file so the base contains an explicit weight keyword,
 *  e.g. "Font-Italic.woff2" → "Font-Regular-Italic.woff2". The "regular" keyword
 *  then maps the @font-face to weight 400. */
export function detectSubfamilyBug(assetName: string): boolean {
  // Strip Webstudio random suffix + extension, same as parseFontMetadata.
  const stripped = assetName.replace(/_[A-Za-z0-9_-]{15,25}(\.[A-Za-z0-9]+)$/i, "$1");
  const base = stripped.replace(/\.[A-Za-z0-9]+$/, "");
  const hasItalicMarker = /(?:^|[-_ ])(italic|oblique)(?:[-_ ]|$)/i.test(base);
  if (!hasItalicMarker) return false;
  // Has a recognisable weight keyword OR numeric weight? Then no bug.
  return detectWeight(base) === undefined;
}

function detectWeight(base: string): number | undefined {
  // Explicit numeric (e.g. "Inter-400", "Roboto_700")
  const num = base.match(/(?:^|[-_ ])([1-9]00)(?:[-_ ]|$)/);
  if (num) return Number(num[1]);
  // Keyword
  const KEYWORDS: Record<string, number> = {
    thin: 100,
    extralight: 200,
    ultralight: 200,
    light: 300,
    regular: 400,
    normal: 400,
    book: 400,
    medium: 500,
    semibold: 600,
    demibold: 600,
    bold: 700,
    extrabold: 800,
    ultrabold: 800,
    black: 900,
    heavy: 900,
  };
  const lower = base.toLowerCase();
  for (const [kw, w] of Object.entries(KEYWORDS)) {
    if (new RegExp(`(?:^|[-_ ])${kw}(?:[-_ ]|$)`, "i").test(lower)) return w;
  }
  return undefined;
}

/** Filter build assets to font assets and decorate each with parsed metadata. */
export function getFontAssets(build: WebstudioBuild): FontAsset[] {
  const out: FontAsset[] = [];
  for (const a of getAssets(build)) {
    const ext = (a.format ?? "").toLowerCase();
    const isFont =
      a.type === "font" ||
      FONT_EXTENSIONS.has(ext) ||
      FONT_EXTENSIONS.has(extOf(a.name));
    if (!isFont) continue;
    const meta = parseFontMetadata(a.name, a.format);
    out.push({ ...a, ...meta });
  }
  return out;
}

function extOf(name: string): string {
  const m = name.match(/\.([A-Za-z0-9]+)$/);
  return (m?.[1] ?? "").toLowerCase();
}

/** Collect every distinct (family, weight) pair referenced in styles.
 *  Looks at:
 *   - "fontFamily" decls (type "fontFamily" → array of family names)
 *   - "fontWeight" decls (numeric "unit" or keyword) */
export function scanStyleFontUsage(build: WebstudioBuild): {
  familiesUsed: Set<string>;
  weightsByFamily: Map<string, Set<number>>;
  weightsAnyFamily: Set<number>;
} {
  const familiesUsed = new Set<string>();
  const weightsAnyFamily = new Set<number>();

  // Index decls by (styleSourceId, breakpointId, state) so we can correlate family + weight
  // when both are set on the same selector. This is best-effort: usually fontFamily lives
  // on a token while fontWeight lives on a more specific local — so we also track a global
  // pool of weights (= any weight used anywhere).
  type Key = string;
  const familiesByKey = new Map<Key, string[]>();
  const weightsByKey = new Map<Key, number[]>();

  for (const d of build.styles) {
    const key: Key = `${d.styleSourceId}|${d.breakpointId}|${d.state ?? ""}`;
    if (d.property === "fontFamily") {
      const v = d.value as { type?: string; value?: unknown };
      if (v?.type === "fontFamily" && Array.isArray(v.value)) {
        const fams = v.value.filter((x): x is string => typeof x === "string");
        for (const f of fams) familiesUsed.add(normaliseFamily(f));
        const arr = familiesByKey.get(key) ?? [];
        arr.push(...fams.map(normaliseFamily));
        familiesByKey.set(key, arr);
      }
    } else if (d.property === "fontWeight") {
      const w = parseFontWeight(d.value);
      if (w !== undefined) {
        weightsAnyFamily.add(w);
        const arr = weightsByKey.get(key) ?? [];
        arr.push(w);
        weightsByKey.set(key, arr);
      }
    }
  }

  // Per-family weight inference: for each style source, if it sets both a family and a weight,
  // attribute the weight to that family. For sources that only set a weight, attribute it to
  // ALL families used in the project (conservative — avoids false-positive "unused weight").
  const weightsByFamily = new Map<string, Set<number>>();
  for (const fam of familiesUsed) weightsByFamily.set(fam, new Set());

  // Pass 1: same-source family+weight.
  const sourcesWithFamily = new Map<string, Set<string>>(); // styleSourceId → families
  for (const [k, fams] of familiesByKey) {
    const sid = k.split("|")[0];
    const set = sourcesWithFamily.get(sid) ?? new Set<string>();
    for (const f of fams) set.add(f);
    sourcesWithFamily.set(sid, set);
  }
  for (const [k, weights] of weightsByKey) {
    const sid = k.split("|")[0];
    const fams = sourcesWithFamily.get(sid);
    if (fams && fams.size > 0) {
      for (const f of fams) {
        const ws = weightsByFamily.get(f) ?? new Set<number>();
        for (const w of weights) ws.add(w);
        weightsByFamily.set(f, ws);
      }
    }
  }

  // Pass 2: orphan weights (no co-located family) → assume they apply to all families.
  const orphanWeights = new Set<number>();
  for (const [k, weights] of weightsByKey) {
    const sid = k.split("|")[0];
    if (!sourcesWithFamily.has(sid)) for (const w of weights) orphanWeights.add(w);
  }
  if (orphanWeights.size > 0) {
    for (const fam of familiesUsed) {
      const ws = weightsByFamily.get(fam) ?? new Set<number>();
      for (const w of orphanWeights) ws.add(w);
      weightsByFamily.set(fam, ws);
    }
  }

  return { familiesUsed, weightsByFamily, weightsAnyFamily };
}

/** Lowercase + strip surrounding quotes. Used for display + same-source key dedup. */
export function normaliseFamily(name: string): string {
  return name.replace(/^["']|["']$/g, "").trim().toLowerCase();
}

/** STRICT comparison key: lowercase + strip quotes + drop ALL separators
 *  (spaces, hyphens, underscores). Used to match an upload-derived family
 *  (e.g. "helveticaneueltpro-ex" parsed from filename "HelveticaNeueLTPro-Ex.ttf")
 *  with its CSS reference form (e.g. "helveticaneuelt pro ex" written by the user
 *  in a fontFamily decl). Webstudio's font normalisation accepts both at runtime
 *  because @font-face name matching is case-insensitive and tolerates separator
 *  variation. Bug 2026-05-20: previous audit compared raw lowercased strings →
 *  10 active families flagged "0 usage" → operator deleted the assets → broken
 *  typography across the site. See feedback_webstudio_mcp_audit_fonts.md. */
export function normaliseFamilyStrict(name: string): string {
  return normaliseFamily(name).replace(/[\s\-_]+/g, "");
}

function parseFontWeight(value: unknown): number | undefined {
  const v = value as { type?: string; value?: unknown };
  if (!v || typeof v !== "object") return undefined;
  if (v.type === "unit" && typeof v.value === "number") return Math.round(v.value);
  if (v.type === "keyword" && typeof v.value === "string") {
    const KW: Record<string, number> = {
      normal: 400,
      bold: 700,
      lighter: 300,
      bolder: 700,
    };
    return KW[v.value.toLowerCase()];
  }
  return undefined;
}

/** Detect Google Fonts links injected via HtmlEmbed `code` props.
 *  Returns matched snippets (truncated). */
export function detectGoogleFontsInHead(build: WebstudioBuild): Array<{ instanceId: string; snippet: string }> {
  const hits: Array<{ instanceId: string; snippet: string }> = [];
  const fontInstanceIds = new Set<string>();
  for (const inst of build.instances) {
    if (inst.component === "HtmlEmbed") fontInstanceIds.add(inst.id);
  }
  const RX = /https?:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com)[^\s"'<>]+/gi;
  for (const p of build.props) {
    if (p.name !== "code" || p.type !== "string") continue;
    if (!fontInstanceIds.has(p.instanceId)) continue;
    const code = p.value;
    if (typeof code !== "string") continue;
    const matches = code.match(RX);
    if (!matches) continue;
    for (const m of matches) {
      hits.push({ instanceId: p.instanceId, snippet: m.length > 120 ? `${m.slice(0, 117)}…` : m });
    }
  }
  return hits;
}
