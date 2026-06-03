// Filter, dedupe, sort, and render overflow audit issues into a text report.

import type { Issue } from "./types.js";
import { MIN_SEV_RANK, SEV_RANK, VIEWPORT_BY_BP } from "./types.js";

export type ReportInput = {
  page: { path: string; name: string };
  breakpoint: string;
  targetBpSlugs: string[];
  issues: Issue[];
  minSeverity: string;
  maxIssues: number;
};

export function buildReport(input: ReportInput): string {
  const { issues, minSeverity, maxIssues, page, breakpoint, targetBpSlugs } = input;
  const minRank = MIN_SEV_RANK[minSeverity];
  const filtered = issues.filter((i) => SEV_RANK[i.severity] >= minRank);

  // Dedupe by (instanceId, property, bp, reason)
  const seen = new Set<string>();
  const dedup: Issue[] = [];
  for (const i of filtered) {
    const key = `${i.instanceId}|${i.property ?? ""}|${i.bp ?? ""}|${i.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(i);
  }

  // Sort by severity then by instance
  dedup.sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity]);
  const limited = dedup.slice(0, maxIssues);

  const header = `Page: ${page.path || "/"} (${page.name})\nBreakpoint(s): ${targetBpSlugs.join(", ")} ${breakpoint !== "all" ? `(viewport ≤ ${VIEWPORT_BY_BP[breakpoint]}px)` : ""}\nFound ${dedup.length} issue(s) (showing ${limited.length}).`;

  if (limited.length === 0) {
    return `${header}\n\n✅ No overflow issues detected.`;
  }

  const counts = {
    "🔴": dedup.filter((i) => i.severity === "🔴").length,
    "🟡": dedup.filter((i) => i.severity === "🟡").length,
    "🟠": dedup.filter((i) => i.severity === "🟠").length,
  };

  const lines: string[] = [
    header,
    `Severity: 🔴 ${counts["🔴"]} critical · 🟡 ${counts["🟡"]} warning · 🟠 ${counts["🟠"]} hint\n`,
  ];
  for (const i of limited) {
    lines.push(`${i.severity} [${i.instanceId}] ${i.label}`);
    const propPart = i.property ? `${i.property}=${i.value} ` : i.value ? `${i.value} ` : "";
    const bpPart = i.bp ? `@ ${i.bp}` : "";
    if (propPart || bpPart) lines.push(`    ${propPart}${bpPart}`.trim());
    lines.push(`    └─ ${i.reason}`);
    if (i.suggestion) lines.push(`       💡 ${i.suggestion}`);
  }
  return lines.join("\n");
}
