// Render the orphan-audit results as a structured text report.

import {
  CATEGORY_LABELS,
  type CategoryResult,
  type CategoryT,
} from "./types.js";

const DEFAULT_CAP = 20;

export function renderReport(
  projectSlug: string,
  projectTitle: string | undefined,
  picked: CategoryT[],
  results: Map<CategoryT, CategoryResult>,
  verbose: boolean,
): string {
  const lines: string[] = [];
  lines.push(`🔍 audit_orphans — project=${projectSlug} (real name: ${projectTitle ?? "?"})`);
  lines.push("");
  lines.push("📊 Summary:");
  for (const c of picked) {
    const r = results.get(c)!;
    lines.push(`  - ${CATEGORY_LABELS[c]}: ${r.orphans.length} orphan / ${r.total} total`);
  }
  lines.push("");

  for (const c of picked) {
    const r = results.get(c)!;
    if (r.orphans.length === 0) {
      lines.push(`✅ ${CATEGORY_LABELS[c]}: clean`);
      lines.push("");
      continue;
    }
    const sorted = [...r.orphans].sort((a, b) => a.name.localeCompare(b.name));
    const cap = verbose ? sorted.length : Math.min(DEFAULT_CAP, sorted.length);
    lines.push(`🔸 ${CATEGORY_LABELS[c]} (${r.orphans.length} orphan):`);
    for (const o of sorted.slice(0, cap)) {
      const extra = o.extra ? `  [${o.extra}]` : "";
      lines.push(`  - "${o.name}" (id=${o.id})${extra}`);
    }
    if (!verbose && sorted.length > cap) {
      lines.push(`  … (+${sorted.length - cap} more, re-run with verbose=true)`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
