// Section listing + token usage detectors for audit-page.

import type { WebstudioBuild } from "../../webstudio-client.js";

export type Logger = (s: string) => void;

export function reportSections(build: WebstudioBuild, pageIds: Set<string>, log: Logger) {
  log(`## Sections`);
  const sections = Array.from(pageIds)
    .map((id) => build.instances.find((i) => i.id === id))
    .filter((i) => i?.tag === "section");
  for (const s of sections) {
    if (!s) continue;
    const sel = build.styleSourceSelections.find((x) => x.instanceId === s.id);
    let bg = "(none)";
    const tokens: string[] = [];
    if (sel) {
      for (const ssId of sel.values) {
        const ss = build.styleSources.find((x) => x.id === ssId);
        if (ss?.type === "token") tokens.push(ss.name ?? ssId);
        const styles = build.styles.filter((st) => st.styleSourceId === ssId);
        const bgStyle = styles.find((st) => st.property === "backgroundColor");
        if (bgStyle) bg = JSON.stringify(bgStyle.value).slice(0, 60);
      }
    }
    log(`  - "${s.label ?? ""}" [${s.id}] : bg=${bg} tokens=[${tokens.join(", ")}]`);
  }
}

export function reportTokens(build: WebstudioBuild, pageIds: Set<string>, log: Logger): Map<string, number> {
  log(`\n## Tokens used on this page`);
  const usedTokens = new Map<string, number>();
  for (const sel of build.styleSourceSelections) {
    if (!pageIds.has(sel.instanceId)) continue;
    for (const ssId of sel.values) {
      const ss = build.styleSources.find((s) => s.id === ssId);
      if (ss?.type === "token") usedTokens.set(ss.name ?? ssId, (usedTokens.get(ss.name ?? ssId) ?? 0) + 1);
    }
  }
  log(`  ${usedTokens.size} distinct token(s)`);
  for (const [n, c] of [...usedTokens.entries()].sort((a, b) => b[1] - a[1])) {
    log(`  - ${n}  (×${c})`);
  }
  return usedTokens;
}

export function reportLocalStyles(
  build: WebstudioBuild,
  pageIds: Set<string>,
  log: Logger,
): { localSources: Set<string>; localDecls: WebstudioBuild["styles"] } {
  log(`\n## Local styles`);
  const localSources = new Set<string>();
  for (const sel of build.styleSourceSelections) {
    if (!pageIds.has(sel.instanceId)) continue;
    for (const ssId of sel.values) {
      const ss = build.styleSources.find((s) => s.id === ssId);
      if (ss?.type === "local") localSources.add(ssId);
    }
  }
  const localDecls = build.styles.filter((s) => localSources.has(s.styleSourceId));
  log(`  ${localDecls.length} local declaration(s) across ${localSources.size} source(s)`);
  const propCounts: Record<string, number> = {};
  for (const d of localDecls) propCounts[d.property] = (propCounts[d.property] ?? 0) + 1;
  log(`  Top 10 properties:`);
  for (const [p, n] of Object.entries(propCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)) log(`    - ${p}: ${n}`);
  return { localSources, localDecls };
}
