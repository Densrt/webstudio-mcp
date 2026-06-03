// Per-category orphan scanners. Each one is read-only and pure: takes the
// build, returns { total, orphans }.

import type { WebstudioBuild } from "../../webstudio-client.js";
import { countAllUsages, getAssets } from "../../lib/asset-helpers.js";
import type { CategoryResult, CategoryT, OrphanItem } from "./types.js";

const ROOT_INSTANCE_ID = ":root";

type DataSourceLike = {
  id: string;
  type: string;
  name: string;
  scopeInstanceId?: string;
  resourceId?: string;
  value?: unknown;
  [k: string]: unknown;
};

type Resource = { id: string; name: string; [k: string]: unknown };
type FolderLike = { id: string; name: string; slug?: string; children: string[] };

// ─────────────────────────────────────────────────────────────────────────────
// Variables (dataSources type="variable")
// ─────────────────────────────────────────────────────────────────────────────

/** A variable id is referenced if it appears (raw or with `__DASH__` escaping)
 *  inside any: other dataSource record, resource record, prop value, or
 *  instance child expression. */
function findOrphanVariables(build: WebstudioBuild): CategoryResult {
  const dataSources = (build as unknown as { dataSources?: DataSourceLike[] }).dataSources ?? [];
  const variables = dataSources.filter((d) => d.type === "variable");

  const propsStr = JSON.stringify(build.props ?? []);
  const resourcesStr = JSON.stringify(
    (build as unknown as { resources?: unknown[] }).resources ?? [],
  );
  const expressionsStr = JSON.stringify(
    (build.instances ?? []).flatMap((inst) =>
      (inst.children ?? [])
        .filter((c) => c.type === "expression" && typeof c.value === "string")
        .map((c) => c.value),
    ),
  );

  const orphans: OrphanItem[] = [];
  for (const v of variables) {
    const escapedId = v.id.replace(/-/g, "__DASH__");
    // Other dataSources: strip the variable's own record so self-mentions don't count.
    const others = dataSources.filter((d) => d.id !== v.id);
    const otherDsStr = JSON.stringify(others);
    const referenced =
      otherDsStr.includes(v.id) ||
      otherDsStr.includes(escapedId) ||
      propsStr.includes(v.id) ||
      propsStr.includes(escapedId) ||
      resourcesStr.includes(v.id) ||
      resourcesStr.includes(escapedId) ||
      expressionsStr.includes(v.id) ||
      expressionsStr.includes(escapedId);
    if (!referenced) {
      orphans.push({
        id: v.id,
        name: v.name || "(unnamed)",
        extra: `scope=${v.scopeInstanceId ?? "?"}`,
      });
    }
  }
  return { total: variables.length, orphans };
}

// ─────────────────────────────────────────────────────────────────────────────
// Resources
// ─────────────────────────────────────────────────────────────────────────────

function findOrphanResources(build: WebstudioBuild): CategoryResult {
  const resources = (build as unknown as { resources?: Resource[] }).resources ?? [];
  const dataSources = (build as unknown as { dataSources?: DataSourceLike[] }).dataSources ?? [];

  const dsByResourceId = new Map<string, DataSourceLike>();
  for (const ds of dataSources) {
    if (ds.type === "resource" && typeof ds.resourceId === "string") {
      dsByResourceId.set(ds.resourceId, ds);
    }
  }

  const propsStr = JSON.stringify(build.props ?? []);
  const expressionsStr = JSON.stringify(
    (build.instances ?? []).flatMap((inst) =>
      (inst.children ?? [])
        .filter((c) => c.type === "expression" && typeof c.value === "string")
        .map((c) => c.value),
    ),
  );

  // A resource is referenced if its OWN id appears anywhere in props (form action
  // prop with type:"resource", value=resourceId — observed pattern on the GD France
  // dealer template) or in instance expression children. Bug 2026-05-20: previous
  // implementation only checked the wrapping dataSource id, missing these direct
  // resource-id prop refs → 45 active form action resources falsely flagged orphan.
  const containsResourceRef = (resourceId: string): boolean => {
    const escapedId = resourceId.replace(/-/g, "__DASH__");
    return (
      propsStr.includes(resourceId) ||
      propsStr.includes(escapedId) ||
      expressionsStr.includes(resourceId) ||
      expressionsStr.includes(escapedId)
    );
  };

  const orphans: OrphanItem[] = [];
  for (const r of resources) {
    // First: direct prop ref to the resource id itself — used regardless of DS state.
    if (containsResourceRef(r.id)) continue;

    const ds = dsByResourceId.get(r.id);
    if (!ds) {
      orphans.push({ id: r.id, name: r.name || "(unnamed)", extra: "no dataSource bound + no prop ref" });
      continue;
    }
    const dsId = ds.id;
    const escapedDsId = dsId.replace(/-/g, "__DASH__");
    // Other dataSources besides this resource's own record.
    const others = dataSources.filter((d) => d.id !== ds.id);
    const otherDsStr = JSON.stringify(others);
    const referenced =
      propsStr.includes(dsId) ||
      propsStr.includes(escapedDsId) ||
      expressionsStr.includes(dsId) ||
      expressionsStr.includes(escapedDsId) ||
      otherDsStr.includes(dsId) ||
      otherDsStr.includes(escapedDsId);
    if (!referenced) {
      orphans.push({ id: r.id, name: r.name || "(unnamed)", extra: `dataSourceId=${dsId} (unreferenced)` });
    }
  }
  return { total: resources.length, orphans };
}

// ─────────────────────────────────────────────────────────────────────────────
// Assets
// ─────────────────────────────────────────────────────────────────────────────

function findOrphanAssets(build: WebstudioBuild): CategoryResult {
  const assets = getAssets(build);
  const counts = countAllUsages(build);

  // Safety net : serialize the rest of the build once and test substring inclusion
  // for any asset whose counts says 0 — catches references in unusual JSON fields.
  const buildMinusAssets = { ...build, assets: [] };
  const haystack = JSON.stringify(buildMinusAssets);

  const orphans: OrphanItem[] = [];
  for (const a of assets) {
    if ((counts.get(a.id) ?? 0) > 0) continue;
    if (haystack.includes(a.id)) continue;
    orphans.push({ id: a.id, name: a.name, extra: `${a.size}B` });
  }
  return { total: assets.length, orphans };
}

// ─────────────────────────────────────────────────────────────────────────────
// Local styleSources orphans (mirrors cleanup-orphan-locals.ts)
// ─────────────────────────────────────────────────────────────────────────────

function findOrphanLocalStyleSources(build: WebstudioBuild): CategoryResult {
  const usedSourceIds = new Set<string>();
  for (const sel of build.styleSourceSelections) {
    for (const v of sel.values ?? []) usedSourceIds.add(v);
  }
  const locals = build.styleSources.filter((s) => s.type === "local");
  const declsBySource = new Map<string, number>();
  for (const d of build.styles) {
    declsBySource.set(d.styleSourceId, (declsBySource.get(d.styleSourceId) ?? 0) + 1);
  }
  const orphans: OrphanItem[] = locals
    .filter((s) => !usedSourceIds.has(s.id))
    .map((s) => ({
      id: s.id,
      name: `local(${s.id.slice(0, 8)})`,
      extra: `${declsBySource.get(s.id) ?? 0} decls`,
    }));
  return { total: locals.length, orphans };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tokens
// ─────────────────────────────────────────────────────────────────────────────

type TokenSource = WebstudioBuild["styleSources"][number] & { type: "token"; name: string };

function findOrphanTokens(build: WebstudioBuild): CategoryResult {
  const tokens: TokenSource[] = build.styleSources.filter(
    (s): s is TokenSource => s.type === "token",
  );
  const used = new Set<string>();
  for (const sel of build.styleSourceSelections) {
    for (const v of sel.values ?? []) used.add(v);
  }
  const orphans: OrphanItem[] = tokens
    .filter((t) => !used.has(t.id))
    .map((t) => ({ id: t.id, name: t.name || "(unnamed)" }));
  return { total: tokens.length, orphans };
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS vars
// ─────────────────────────────────────────────────────────────────────────────

// Match `var(--name)` references — handles whitespace + optional fallback.
const VAR_REF_RE = /var\(\s*(--[A-Za-z0-9_-]+)/g;

function collectVarReferences(value: unknown, refs: Set<string>): void {
  if (value === null || typeof value === "undefined") return;
  // Strings inside `unparsed` decl values (linear-gradient, calc, complex shorthand)
  // carry their var(--name) references as raw text, not as `type:"var"` nodes. Webstudio
  // doesn't parse them so the recursive structural walk misses them entirely. Bug
  // 2026-05-20: 4 active CSS vars deleted because their refs lived in linear-gradient
  // unparsed strings — broke the hero overlay across all Acme product pages.
  if (typeof value === "string") {
    let m: RegExpExecArray | null;
    VAR_REF_RE.lastIndex = 0;
    while ((m = VAR_REF_RE.exec(value)) !== null) refs.add(m[1]);
    return;
  }
  if (typeof value !== "object") return;
  const v = value as Record<string, unknown>;
  if (v.type === "var" && typeof v.value === "string") {
    refs.add(`--${v.value}`);
    // Fallthrough: a var{} can also have a "fallback" field referencing more vars.
  }
  if (Array.isArray(value)) {
    for (const item of value) collectVarReferences(item, refs);
    return;
  }
  for (const val of Object.values(v)) collectVarReferences(val, refs);
}

function findOrphanCssVars(build: WebstudioBuild): CategoryResult {
  const rootSel = build.styleSourceSelections.find((s) => s.instanceId === ROOT_INSTANCE_ID);
  const rootSourceIds = new Set(
    (rootSel?.values ?? []).filter(
      (v) => build.styleSources.find((s) => s.id === v)?.type === "local",
    ),
  );
  const defined = new Set<string>();
  for (const d of build.styles) {
    if (!rootSourceIds.has(d.styleSourceId)) continue;
    if (!d.property.startsWith("--")) continue;
    defined.add(d.property);
  }
  const refs = new Set<string>();
  for (const d of build.styles) collectVarReferences(d.value, refs);

  const orphans: OrphanItem[] = [];
  for (const name of defined) {
    if (!refs.has(name)) orphans.push({ id: name, name });
  }
  return { total: defined.size, orphans };
}

// ─────────────────────────────────────────────────────────────────────────────
// Folders
// ─────────────────────────────────────────────────────────────────────────────

function findOrphanFolders(build: WebstudioBuild): CategoryResult {
  const folders = (build.pages.folders ?? []) as FolderLike[];
  const rootId = build.pages.rootFolderId;
  const orphans: OrphanItem[] = folders
    .filter((f) => f.id !== rootId && (f.children?.length ?? 0) === 0)
    .map((f) => ({
      id: f.id,
      name: f.name || "(unnamed)",
      extra: f.slug ? `slug=${f.slug}` : undefined,
    }));
  return { total: folders.length, orphans };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch table
// ─────────────────────────────────────────────────────────────────────────────

export const CATEGORY_RUNNERS: Record<CategoryT, (b: WebstudioBuild) => CategoryResult> = {
  variables: findOrphanVariables,
  resources: findOrphanResources,
  assets: findOrphanAssets,
  styleSources: findOrphanLocalStyleSources,
  tokens: findOrphanTokens,
  cssVars: findOrphanCssVars,
  folders: findOrphanFolders,
};
