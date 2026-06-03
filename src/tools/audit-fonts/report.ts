// Text-report builder for webstudio_audit_fonts.

import type { WebstudioBuild } from "../../webstudio-client.js";
import { formatBytes, countAllUsages } from "../../lib/asset-helpers.js";
import {
  PREFERRED_FONT_FORMAT,
  detectGoogleFontsInHead,
  detectSubfamilyBug,
  getFontAssets,
  normaliseFamily,
  normaliseFamilyStrict,
  scanStyleFontUsage,
  type FontAsset,
} from "./scanners.js";

const CAP = 20;

export type ReportArgs = {
  projectSlug: string;
  sizeThresholdKB: number;
  verbose: boolean;
};

export function buildFontsReport(build: WebstudioBuild, args: ReportArgs): string {
  const fonts = getFontAssets(build);
  const usageCounts = countAllUsages(build);

  // Group uploaded fonts by normalised family.
  const uploadedByFamily = new Map<string, FontAsset[]>();
  for (const f of fonts) {
    const key = normaliseFamily(f.family);
    const arr = uploadedByFamily.get(key) ?? [];
    arr.push(f);
    uploadedByFamily.set(key, arr);
  }

  const { familiesUsed, weightsByFamily, weightsAnyFamily } = scanStyleFontUsage(build);
  const googleFonts = detectGoogleFontsInHead(build);

  // ── Detections ─────────────────────────────────────────────────────────────
  const uploadedFamilies = [...uploadedByFamily.keys()];

  // STRICT match (no separators) so an uploaded "helveticaneueltpro-ex" matches a
  // CSS "helveticaneuelt pro ex" — both collapse to "helveticaneueltproex".
  // Bug 2026-05-20: previous code did `!familiesUsed.has(f)` with raw lowercased
  // strings → 10 active families flagged "0 usage" → assets deleted → broken typo.
  const usedStrictKeys = new Set<string>();
  for (const fam of familiesUsed) usedStrictKeys.add(normaliseFamilyStrict(fam));

  const uploadedStrictKeys = new Set<string>();
  for (const fam of uploadedFamilies) uploadedStrictKeys.add(normaliseFamilyStrict(fam));

  const familyIsUsed = (uploadedKey: string): boolean =>
    usedStrictKeys.has(normaliseFamilyStrict(uploadedKey));

  const familiesUploadedUnused = uploadedFamilies.filter((f) => !familyIsUsed(f));
  const familiesUsedNotUploaded = [...familiesUsed].filter(
    (f) => !uploadedStrictKeys.has(normaliseFamilyStrict(f)) && !isSystemFamily(f),
  );

  // Weights uploaded but not referenced in any fontWeight decl (under that family).
  type UnusedWeight = { family: string; weight: number; assets: FontAsset[] };
  const unusedWeights: UnusedWeight[] = [];
  for (const [fam, assets] of uploadedByFamily) {
    if (!familyIsUsed(fam)) continue; // family entirely unused — covered separately
    const usedWeights = weightsByFamily.get(fam) ?? new Set<number>();
    const byWeight = new Map<number | "?", FontAsset[]>();
    for (const a of assets) {
      const w = a.weight ?? "?";
      const arr = byWeight.get(w) ?? [];
      arr.push(a);
      byWeight.set(w, arr);
    }
    for (const [w, group] of byWeight) {
      if (w === "?") continue;
      if (!usedWeights.has(w as number) && !weightsAnyFamily.has(w as number)) {
        unusedWeights.push({ family: fam, weight: w as number, assets: group });
      }
    }
  }

  // Format flags: anything that isn't .woff2.
  const nonWoff2 = fonts.filter((f) => f.ext !== PREFERRED_FONT_FORMAT);

  // Size flags.
  const thresholdBytes = args.sizeThresholdKB * 1024;
  const oversized = fonts.filter((f) => f.size > thresholdBytes);

  // ── Render ─────────────────────────────────────────────────────────────────
  const lines: string[] = [];
  lines.push(`🔤 audit_fonts — project=${args.projectSlug} (real name: ${build.project?.title ?? "?"})`);
  lines.push("");
  lines.push("📊 Summary:");
  lines.push(`  - Font assets uploaded: ${fonts.length} (${formatBytes(fonts.reduce((s, f) => s + f.size, 0))})`);
  lines.push(`  - Families uploaded: ${uploadedFamilies.length} | used in styles: ${familiesUsed.size}`);
  lines.push(`  - Unused families (uploaded, never referenced): ${familiesUploadedUnused.length}`);
  lines.push(`  - Unused uploaded weights: ${unusedWeights.length}`);
  lines.push(`  - Non-woff2 assets: ${nonWoff2.length}`);
  lines.push(`  - Oversized (>${args.sizeThresholdKB} KB): ${oversized.length}`);
  lines.push(`  - Google Fonts hits in HtmlEmbed: ${googleFonts.length}`);
  lines.push("");

  // 📁 Familles
  lines.push(`📁 Familles:`);
  if (uploadedFamilies.length === 0 && familiesUsed.size === 0) {
    lines.push(`  ✅ Familles: clean (no fonts uploaded, no fontFamily decls)`);
  } else {
    if (uploadedFamilies.length > 2) {
      lines.push(`  ⚠ WARN: ${uploadedFamilies.length} families uploaded — recommended ≤ 2 for perf.`);
    } else {
      lines.push(`  ✓ ${uploadedFamilies.length} family/families uploaded (≤ 2).`);
    }
    lines.push(`  Uploaded: ${uploadedFamilies.map((f) => `"${f}"`).join(", ") || "(none)"}`);
    lines.push(`  Used in styles: ${[...familiesUsed].map((f) => `"${f}"`).join(", ") || "(none)"}`);
    if (familiesUploadedUnused.length > 0) {
      lines.push(`  ❌ ERROR — uploaded but zero usage in fontFamily decls (prefetched for nothing):`);
      for (const f of familiesUploadedUnused) {
        const assets = uploadedByFamily.get(f) ?? [];
        const totalSize = assets.reduce((s, a) => s + a.size, 0);
        lines.push(`    - "${f}" → ${assets.length} file(s), ${formatBytes(totalSize)}`);
      }
    }
    if (familiesUsedNotUploaded.length > 0) {
      lines.push(`  ⚠ Families referenced in styles but not uploaded (system fallback or Google CDN?):`);
      for (const f of familiesUsedNotUploaded) lines.push(`    - "${f}"`);
    }
    if (familiesUploadedUnused.length === 0 && familiesUsedNotUploaded.length === 0 && uploadedFamilies.length <= 2) {
      lines.push(`  ✅ Familles: clean`);
    }
  }
  lines.push("");

  // ⚖️ Poids par famille
  lines.push(`⚖️ Poids par famille:`);
  if (uploadedFamilies.length === 0) {
    lines.push(`  ✅ Poids: clean (no font assets uploaded)`);
  } else {
    let anyIssue = false;
    for (const [fam, assets] of uploadedByFamily) {
      const uploadedWeights = [...new Set(assets.map((a) => a.weight).filter((w): w is number => typeof w === "number"))].sort((a, b) => a - b);
      const unknownCount = assets.filter((a) => a.weight === undefined).length;
      const used = [...(weightsByFamily.get(fam) ?? new Set<number>())].sort((a, b) => a - b);
      const wasted = uploadedWeights.filter((w) => !used.includes(w) && !weightsAnyFamily.has(w));
      lines.push(`  "${fam}":`);
      lines.push(`    uploaded: [${uploadedWeights.join(", ")}]${unknownCount ? ` (+${unknownCount} unparseable)` : ""}`);
      lines.push(`    used in styles: [${used.join(", ") || "—"}]`);
      if (wasted.length > 0) {
        anyIssue = true;
        lines.push(`    ❌ wasted (prefetched, never referenced): [${wasted.join(", ")}]`);
      }
    }
    if (!anyIssue) lines.push(`  ✅ Poids: clean`);
  }
  lines.push("");

  // 🐛 Webstudio parseSubfamily bug (italic without weight keyword)
  // Webstudio's parseSubfamily() returns weight=900 on no keyword match instead of the
  // intended 400. Files like "Font-Italic.woff2" get @font-face weight:900 — wrong.
  // Workaround: rename to include an explicit weight (e.g. "Font-Regular-Italic.woff2").
  // See pattern doc: meta.describe_pattern({ pattern: "font-naming-conventions" }).
  const subfamilyBugFonts = fonts.filter((f) => detectSubfamilyBug(f.name));
  lines.push(`🐛 parseSubfamily Webstudio bug:`);
  if (fonts.length === 0) {
    lines.push(`  ✅ Clean (no fonts uploaded)`);
  } else if (subfamilyBugFonts.length === 0) {
    lines.push(`  ✅ Clean (no italic/oblique font without an explicit weight keyword)`);
  } else {
    lines.push(`  ⚠ ${subfamilyBugFonts.length} italic/oblique font(s) with no weight keyword in filename → Webstudio @font-face assigns weight 900 instead of 400:`);
    const list = args.verbose ? subfamilyBugFonts : subfamilyBugFonts.slice(0, CAP);
    for (const f of list) {
      lines.push(`    - "${f.name}" — rename with explicit weight (e.g. "Regular-Italic", "Light-Italic", "Medium-Italic")`);
    }
    if (!args.verbose && subfamilyBugFonts.length > CAP) {
      lines.push(`    … (+${subfamilyBugFonts.length - CAP} more, re-run with verbose=true)`);
    }
    lines.push(`  Reference: parseSubfamily() in webstudio-is/webstudio packages/asset-uploader/src/utils/font-data.ts`);
    lines.push(`  Pattern doc: meta.describe_pattern({ pattern: "font-naming-conventions" })`);
  }
  lines.push("");

  // 📐 Format
  lines.push(`📐 Format:`);
  if (fonts.length === 0) {
    lines.push(`  ✅ Format: clean (no font assets)`);
  } else if (nonWoff2.length === 0) {
    lines.push(`  ✅ Format: clean (all assets are .${PREFERRED_FONT_FORMAT})`);
  } else {
    lines.push(`  ❌ ${nonWoff2.length} asset(s) not in .${PREFERRED_FONT_FORMAT} — convert to woff2 for ~30% smaller payloads:`);
    const list = args.verbose ? nonWoff2 : nonWoff2.slice(0, CAP);
    for (const f of list) {
      lines.push(`    - "${f.name}" (.${f.ext || "?"}, ${formatBytes(f.size)}, used=${usageCounts.get(f.id) ?? 0})`);
    }
    if (!args.verbose && nonWoff2.length > CAP) {
      lines.push(`    … (+${nonWoff2.length - CAP} more, re-run with verbose=true)`);
    }
  }
  lines.push("");

  // 📏 Tailles
  lines.push(`📏 Tailles (>${args.sizeThresholdKB} KB):`);
  if (oversized.length === 0) {
    lines.push(`  ✅ Tailles: clean (all assets ≤ ${args.sizeThresholdKB} KB)`);
  } else {
    lines.push(`  ⚠ ${oversized.length} oversized asset(s) — subset Latin-only with glyphhanger / FontSquirrel / Transfonter:`);
    const sorted = [...oversized].sort((a, b) => b.size - a.size);
    const list = args.verbose ? sorted : sorted.slice(0, CAP);
    for (const f of list) {
      lines.push(`    - ${formatBytes(f.size).padStart(9)}  "${f.name}" (family="${f.family}", weight=${f.weight ?? "?"})`);
    }
    if (!args.verbose && sorted.length > CAP) {
      lines.push(`    … (+${sorted.length - CAP} more, re-run with verbose=true)`);
    }
  }
  lines.push("");

  // 🔗 Google Fonts externes
  lines.push(`🔗 Google Fonts externes:`);
  if (googleFonts.length === 0) {
    lines.push(`  ✅ Google Fonts: clean (no external fonts.googleapis.com / fonts.gstatic.com link detected)`);
  } else {
    lines.push(`  ❌ ${googleFonts.length} reference(s) to Google Fonts CDN — upload locally to drop 3rd-party TLS handshake + IP logging:`);
    const list = args.verbose ? googleFonts : googleFonts.slice(0, CAP);
    for (const g of list) {
      lines.push(`    - instance=${g.instanceId}  ${g.snippet}`);
    }
    if (!args.verbose && googleFonts.length > CAP) {
      lines.push(`    … (+${googleFonts.length - CAP} more, re-run with verbose=true)`);
    }
  }

  return lines.join("\n").trimEnd();
}

const SYSTEM_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "inherit",
  "initial",
  "unset",
  "revert",
  "arial",
  "helvetica",
  "georgia",
  "times",
  "times new roman",
  "courier",
  "courier new",
  "verdana",
  "tahoma",
  "trebuchet ms",
]);

function isSystemFamily(name: string): boolean {
  return SYSTEM_FAMILIES.has(name);
}
