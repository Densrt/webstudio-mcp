// Data sources, expression bindings and label-based inconsistency detectors
// for audit-page.

import type { WebstudioBuild } from "../../webstudio-client.js";
import type { Logger } from "./sections-tokens.js";

type DataSource = { id: string; type: string; name?: string; scopeInstanceId?: string; resourceId?: string };
type Resource = { id: string; name: string; method: string; url: string };

export function reportBindings(
  build: WebstudioBuild,
  pageIds: Set<string>,
  page: { rootInstanceId: string; title?: unknown; meta?: unknown },
  log: Logger,
) {
  log(`\n## Data sources & bindings`);
  const allDataSources = (build as unknown as { dataSources?: DataSource[] }).dataSources ?? [];
  const allResources = (build as unknown as { resources?: Resource[] }).resources ?? [];
  const dsOnPage = allDataSources.filter(
    (d) => d.scopeInstanceId && (pageIds.has(d.scopeInstanceId) || d.scopeInstanceId === page.rootInstanceId),
  );
  log(`  ${dsOnPage.length} dataSource(s) scoped on this page:`);
  for (const ds of dsOnPage) {
    let extra = "";
    if (ds.type === "resource" && ds.resourceId) {
      const r = allResources.find((x) => x.id === ds.resourceId);
      extra = r ? `  resource "${r.name}" ${r.method.toUpperCase()} ${r.url.slice(0, 80)}` : `  (resource ${ds.resourceId} not found)`;
    }
    log(`    - [${ds.id}] type=${ds.type} name="${ds.name ?? ""}"${extra}`);
  }
  const exprProps = build.props.filter((p) => p.type === "expression" && pageIds.has(p.instanceId));
  log(`\n  ${exprProps.length} expression-bound prop(s) on the page:`);
  for (const p of exprProps.slice(0, 30)) {
    const inst = build.instances.find((i) => i.id === p.instanceId);
    log(`    - [${p.instanceId}] (${inst?.tag ?? inst?.component} "${inst?.label ?? ""}") ${p.name} = ${String(p.value).slice(0, 100)}`);
  }
  if (exprProps.length > 30) log(`    … (${exprProps.length - 30} more)`);

  const pageMetaBindings: Array<{ field: string; expr: string }> = [];
  if (typeof page.title === "string" && page.title.includes("$ws$dataSource")) pageMetaBindings.push({ field: "title", expr: page.title });
  if (page.meta) {
    for (const [k, v] of Object.entries(page.meta as Record<string, unknown>)) {
      if (typeof v === "string" && v.includes("$ws$dataSource")) pageMetaBindings.push({ field: `meta.${k}`, expr: v });
    }
  }
  if (pageMetaBindings.length > 0) {
    log(`\n  ${pageMetaBindings.length} page meta field(s) bound to expressions:`);
    for (const b of pageMetaBindings) log(`    - ${b.field} = ${b.expr.slice(0, 120)}`);
  } else {
    log(`\n  No page meta field bound to an expression (title/description are literals or empty).`);
  }
}

export function reportInconsistencies(build: WebstudioBuild, pageIds: Set<string>, log: Logger) {
  log(`\n## Inter-instance inconsistencies (≥2 instances same label)`);
  const byLabel = new Map<string, typeof build.instances>();
  for (const id of pageIds) {
    const inst = build.instances.find((i) => i.id === id);
    if (!inst?.label) continue;
    const arr = byLabel.get(inst.label) ?? [];
    arr.push(inst);
    byLabel.set(inst.label, arr);
  }
  const getLocalKeys = (instId: string): Map<string, string> => {
    const sel = build.styleSourceSelections.find((s) => s.instanceId === instId);
    if (!sel) return new Map();
    const localId = sel.values.find((v) => build.styleSources.find((ss) => ss.id === v)?.type === "local");
    if (!localId) return new Map();
    const m = new Map<string, string>();
    for (const d of build.styles.filter((s) => s.styleSourceId === localId)) {
      const bp = build.breakpoints.find((b) => b.id === d.breakpointId);
      m.set(`${d.property}@${bp?.label ?? "?"}${d.state ?? ""}`, JSON.stringify(d.value));
    }
    return m;
  };
  let totalInc = 0;
  for (const [label, arr] of byLabel) {
    if (arr.length < 2) continue;
    const maps = arr.map((inst) => getLocalKeys(inst.id));
    const allKeys = new Set<string>();
    for (const m of maps) for (const k of m.keys()) allKeys.add(k);
    let divergent = 0;
    for (const k of allKeys) {
      const vals = new Set(maps.map((m) => m.get(k) ?? "(absent)"));
      if (vals.size > 1) divergent++;
    }
    if (divergent > 0) {
      log(`  ⚠ "${label}" (${arr.length} instances, ${divergent} divergent props)`);
      totalInc += divergent;
    }
  }
  log(`\n  TOTAL inconsistencies: ${totalInc}`);
}
