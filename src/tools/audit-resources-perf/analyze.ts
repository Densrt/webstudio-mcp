// Helpers for webstudio_audit_resources_perf — pure analysis of resources.
//
// Webstudio stores resource URLs/headers as JS expressions: a literal "https://x"
// is stored as the JSON-encoded string `"\"https://x\""`. Other resources may be
// real expressions referencing variables (`$ws$dataSource$<id>.data.foo`).
//
// Sync dependency chain detection: an URL expression that references another
// resource's bound dataSource id forces sequential SSR fetches → big TTFB hit.

import type { WebstudioBuild } from "../../webstudio-client.js";
import { decodeStored } from "../inspect-resource/decode.js";
import { encodedForms } from "../resources/delete-helpers.js";

export type RawResource = {
  id: string;
  name: string;
  method?: string;
  url: string;
  headers?: Array<{ name: string; value: string }>;
  searchParams?: Array<{ name: string; value: string }>;
  body?: string;
};

export type RawDataSource = {
  type: string;
  id: string;
  name?: string;
  scopeInstanceId?: string;
  resourceId?: string;
};

export type AnalyzedResource = {
  id: string;
  name: string;
  method: string;
  urlExpression: string;
  urlLiteral?: string;       // decoded literal URL (if literal)
  urlNormalized?: string;    // origin + pathname (for similarity grouping)
  urlOriginPath?: string;    // for similarity (same as normalized for now)
  cacheMaxAge: number | null; // null = no Cache-Control header found
  isGet: boolean;
  linkedDataSourceId?: string;
  linkedScopeInstanceId?: string;
  pageId?: string;
  pagePath?: string;
  dependsOnResourceIds: string[]; // sync-chain dependencies
};

/** Parse Cache-Control header value (literal or expression) and extract max-age. */
function extractMaxAge(headerValue: string): number | null {
  const dec = decodeStored(headerValue);
  const s = dec.literal ?? dec.expression ?? "";
  const m = s.match(/max-age\s*=\s*(\d+)/i);
  if (m) return Number(m[1]);
  if (/no-store|no-cache/i.test(s)) return 0;
  return null;
}

/** Try to normalize a URL for duplicate / similarity detection. */
function normalizeUrl(literal: string): { full: string; originPath: string } | undefined {
  try {
    const u = new URL(literal);
    // canonical form: lowercase origin, keep path as-is, sort search params
    const origin = u.origin.toLowerCase();
    const path = u.pathname.replace(/\/+$/, "") || "/";
    const params = [...u.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
    const qs = params.map(([k, v]) => `${k}=${v}`).join("&");
    return {
      full: qs ? `${origin}${path}?${qs}` : `${origin}${path}`,
      originPath: `${origin}${path}`,
    };
  } catch {
    return undefined;
  }
}

/** Build a quick lookup from instanceId → page (root or descendant). */
function buildInstanceToPage(build: WebstudioBuild): Map<string, { id: string; path: string }> {
  const out = new Map<string, { id: string; path: string }>();
  // child → parent map
  const parents = new Map<string, string>();
  for (const inst of build.instances) {
    for (const c of inst.children ?? []) {
      if (c.type === "id" && typeof c.value === "string") parents.set(c.value, inst.id);
    }
  }
  for (const p of build.pages.pages) {
    // mark root and walk DOWN
    const stack = [p.rootInstanceId];
    const seen = new Set<string>();
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      out.set(cur, { id: p.id, path: p.path });
      const inst = build.instances.find((i) => i.id === cur);
      if (!inst) continue;
      for (const c of inst.children ?? []) {
        if (c.type === "id" && typeof c.value === "string") stack.push(c.value);
      }
    }
  }
  // fallback: walk UP using parent map for any instance still unknown
  for (const inst of build.instances) {
    if (out.has(inst.id)) continue;
    let cur: string | undefined = inst.id;
    const visited = new Set<string>();
    while (cur && !visited.has(cur)) {
      visited.add(cur);
      const mapped = out.get(cur);
      if (mapped) { out.set(inst.id, mapped); break; }
      cur = parents.get(cur);
    }
  }
  return out;
}

export function analyzeResources(build: WebstudioBuild): AnalyzedResource[] {
  const resources = (build as unknown as { resources?: RawResource[] }).resources ?? [];
  const dataSources = (build as unknown as { dataSources?: RawDataSource[] }).dataSources ?? [];
  const dsByResourceId = new Map<string, RawDataSource>();
  for (const ds of dataSources) {
    if (ds.type === "resource" && ds.resourceId) dsByResourceId.set(ds.resourceId, ds);
  }

  const instanceToPage = buildInstanceToPage(build);

  // For sync-chain detection: precompute encoded-form needles for each resource's
  // linked dataSource id (a sync-chain ref looks like `$ws$dataSource$<id>` in expressions).
  const dsIdNeedles = new Map<string, string[]>(); // resourceId → encoded needles of its dataSourceId
  for (const r of resources) {
    const ds = dsByResourceId.get(r.id);
    if (ds) dsIdNeedles.set(r.id, encodedForms(ds.id));
  }

  return resources.map<AnalyzedResource>((r) => {
    const ds = dsByResourceId.get(r.id);
    const urlDec = decodeStored(r.url);
    const urlLiteral = urlDec.literal;
    const norm = urlLiteral ? normalizeUrl(urlLiteral) : undefined;

    // Cache-Control header detection (case-insensitive)
    let cacheMaxAge: number | null = null;
    for (const h of r.headers ?? []) {
      if (h.name.toLowerCase() === "cache-control") {
        cacheMaxAge = extractMaxAge(h.value);
        break;
      }
    }

    const method = (r.method ?? "get").toLowerCase();

    // Sync-chain: scan THIS resource's url + body + search params + header values
    // for references to ANOTHER resource's dataSourceId.
    const scanText = JSON.stringify({
      url: r.url,
      headers: r.headers,
      body: r.body,
      searchParams: r.searchParams,
    });
    const dependsOn: string[] = [];
    for (const [otherResId, needles] of dsIdNeedles) {
      if (otherResId === r.id) continue;
      if (needles.some((n) => scanText.includes(n))) dependsOn.push(otherResId);
    }

    const page = ds?.scopeInstanceId ? instanceToPage.get(ds.scopeInstanceId) : undefined;

    return {
      id: r.id,
      name: r.name,
      method,
      urlExpression: r.url,
      urlLiteral,
      urlNormalized: norm?.full,
      urlOriginPath: norm?.originPath,
      cacheMaxAge,
      isGet: method === "get",
      linkedDataSourceId: ds?.id,
      linkedScopeInstanceId: ds?.scopeInstanceId,
      pageId: page?.id,
      pagePath: page?.path,
      dependsOnResourceIds: dependsOn,
    };
  });
}
