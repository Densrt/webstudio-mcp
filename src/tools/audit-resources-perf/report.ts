// Render the resources-perf audit report.

import type { AnalyzedResource } from "./analyze.js";

const TOP_N = 20;

function cap<T>(arr: T[], verbose: boolean): { shown: T[]; more: number } {
  if (verbose || arr.length <= TOP_N) return { shown: arr, more: 0 };
  return { shown: arr.slice(0, TOP_N), more: arr.length - TOP_N };
}

export function renderReport(
  projectSlug: string,
  projectTitle: string | undefined,
  resources: AnalyzedResource[],
  maxPerPageThreshold: number,
  verbose: boolean,
): string {
  const lines: string[] = [];
  lines.push(`# Resources perf audit — ${projectTitle ?? projectSlug}`);
  lines.push(`Total resources: ${resources.length}`);

  // ── Group: by exact normalized URL (duplicates) ─────────────────────────────
  const byUrl = new Map<string, AnalyzedResource[]>();
  for (const r of resources) {
    if (!r.urlNormalized) continue;
    const arr = byUrl.get(r.urlNormalized) ?? [];
    arr.push(r);
    byUrl.set(r.urlNormalized, arr);
  }
  const dupes = [...byUrl.entries()].filter(([, arr]) => arr.length > 1)
    .sort((a, b) => b[1].length - a[1].length);

  // ── Group: by origin+path (similarity, params variable) ─────────────────────
  const byOriginPath = new Map<string, AnalyzedResource[]>();
  for (const r of resources) {
    if (!r.urlOriginPath) continue;
    const arr = byOriginPath.get(r.urlOriginPath) ?? [];
    arr.push(r);
    byOriginPath.set(r.urlOriginPath, arr);
  }
  // similarity = same origin+path, >1 resource, AND at least 2 distinct full URLs
  // (groups where all urls are identical are already reported in dupes)
  const similar = [...byOriginPath.entries()]
    .map(([originPath, arr]) => ({ originPath, resources: arr }))
    .filter(({ resources: rs }) => {
      if (rs.length < 2) return false;
      const uniq = new Set(rs.map((r) => r.urlNormalized));
      return uniq.size > 1;
    })
    .sort((a, b) => b.resources.length - a.resources.length);

  // ── Sync chains ─────────────────────────────────────────────────────────────
  const syncChains = resources.filter((r) => r.dependsOnResourceIds.length > 0);

  // ── Cache disabled (GET without max-age) ────────────────────────────────────
  const cacheDisabled = resources.filter((r) => r.isGet && (r.cacheMaxAge === null || r.cacheMaxAge === 0));

  // ── Per-page resource count ─────────────────────────────────────────────────
  const byPage = new Map<string, { path: string; resources: AnalyzedResource[] }>();
  const orphans: AnalyzedResource[] = [];
  for (const r of resources) {
    if (!r.pageId) { orphans.push(r); continue; }
    const slot = byPage.get(r.pageId) ?? { path: r.pagePath ?? "?", resources: [] };
    slot.resources.push(r);
    byPage.set(r.pageId, slot);
  }
  const pageRows = [...byPage.values()].sort((a, b) => b.resources.length - a.resources.length);
  const heavyPages = pageRows.filter((p) => p.resources.length > maxPerPageThreshold);

  // ── Summary ─────────────────────────────────────────────────────────────────
  lines.push(`\n## 📊 Summary`);
  lines.push(`  - Resources orphan (no bound dataSource scope): ${orphans.length}`);
  lines.push(`  - Pages with > ${maxPerPageThreshold} resources: ${heavyPages.length}`);
  lines.push(`  - Duplicated URLs (exact): ${dupes.length} groups`);
  lines.push(`  - Similar URLs (factorisation candidates): ${similar.length} groups`);
  lines.push(`  - Sync dependency chains: ${syncChains.length}`);
  lines.push(`  - GET without cache: ${cacheDisabled.length}`);

  // ── Duplicates ──────────────────────────────────────────────────────────────
  lines.push(`\n## 🔁 Duplicated URLs (ERROR — pure waste)`);
  if (dupes.length === 0) lines.push(`  ✅ none`);
  else {
    const { shown, more } = cap(dupes, verbose);
    for (const [url, arr] of shown) {
      lines.push(`  - [ERROR ×${arr.length}] ${url}`);
      for (const r of arr) lines.push(`      • ${r.name} [${r.id}]${r.pagePath ? ` (page ${r.pagePath})` : ""}`);
    }
    if (more > 0) lines.push(`  … (+${more} more groups, use verbose=true)`);
  }

  // ── Similar ─────────────────────────────────────────────────────────────────
  lines.push(`\n## 🌐 Similar URLs (INFO — candidate for factorisation)`);
  if (similar.length === 0) lines.push(`  ✅ none`);
  else {
    const { shown, more } = cap(similar, verbose);
    for (const grp of shown) {
      lines.push(`  - [INFO ×${grp.resources.length}] ${grp.originPath}`);
      for (const r of grp.resources) {
        const tail = r.urlLiteral && r.urlOriginPath ? r.urlLiteral.slice(r.urlOriginPath.length) : "";
        lines.push(`      • ${r.name} [${r.id}] params: ${tail || "(none)"}`);
      }
    }
    if (more > 0) lines.push(`  … (+${more} more groups, use verbose=true)`);
  }

  // ── Sync chains ─────────────────────────────────────────────────────────────
  lines.push(`\n## 🐌 Synchronous dependency chains (ERROR — serial SSR)`);
  if (syncChains.length === 0) lines.push(`  ✅ none`);
  else {
    const byId = new Map(resources.map((r) => [r.id, r] as const));
    const { shown, more } = cap(syncChains, verbose);
    for (const r of shown) {
      const deps = r.dependsOnResourceIds.map((id) => `"${byId.get(id)?.name ?? id}" [${id}]`).join(", ");
      lines.push(`  - [ERROR] "${r.name}" [${r.id}] depends on: ${deps}`);
    }
    if (more > 0) lines.push(`  … (+${more} more, use verbose=true)`);
  }

  // ── Cache disabled ──────────────────────────────────────────────────────────
  lines.push(`\n## 💾 Cache disabled — GET without Cache-Control max-age>0 (WARN)`);
  if (cacheDisabled.length === 0) lines.push(`  ✅ none`);
  else {
    const { shown, more } = cap(cacheDisabled, verbose);
    for (const r of shown) {
      const state = r.cacheMaxAge === 0 ? "max-age=0" : "absent";
      lines.push(`  - [WARN] "${r.name}" [${r.id}] cache-control: ${state}${r.pagePath ? ` (page ${r.pagePath})` : ""}`);
    }
    if (more > 0) lines.push(`  … (+${more} more, use verbose=true)`);
  }

  // ── Per-page count ──────────────────────────────────────────────────────────
  lines.push(`\n## 📃 Resources per page`);
  if (pageRows.length === 0) lines.push(`  (no page-bound resources)`);
  else {
    const { shown, more } = cap(pageRows, verbose);
    for (const p of shown) {
      const warn = p.resources.length > maxPerPageThreshold ? ` [WARN > ${maxPerPageThreshold}]` : "";
      if (p.resources.length > maxPerPageThreshold || verbose) {
        lines.push(`  - ${p.path}: ${p.resources.length} resources${warn}`);
      } else {
        lines.push(`  ✅ ${p.path}: ${p.resources.length} resources — clean`);
      }
    }
    if (more > 0) lines.push(`  … (+${more} more pages, use verbose=true)`);
  }
  if (orphans.length > 0) {
    lines.push(`\n  Orphan resources (no dataSource scope): ${orphans.length}`);
    if (verbose) for (const r of orphans) lines.push(`    • "${r.name}" [${r.id}]`);
  }

  return lines.join("\n");
}
