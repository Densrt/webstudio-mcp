// Helpers for webstudio_delete_resource: reference scanning across the build.
//
// Webstudio compiles dataSource/resource ids into JS identifiers, replacing every
// "-" with "__DASH__" inside expressions like "$ws$dataSource$<escaped>". The raw
// form is also present in JSON-stored fields (resource definitions, prop.value).
// We must scan for BOTH encodings.

import type { WebstudioBuild } from "../../webstudio-client.js";

export type Resource = {
  id: string;
  name: string;
  method?: string;
  url?: string;
  headers?: unknown;
  body?: unknown;
};

export type DataSource = {
  type: string;
  id: string;
  name?: string;
  scopeInstanceId?: string;
  resourceId?: string;
};

/** Both raw + __DASH__-escaped encodings of an id (deduped). */
export function encodedForms(id: string): string[] {
  const escaped = id.replace(/-/g, "__DASH__");
  return escaped === id ? [id] : [id, escaped];
}

function containsAny(s: string, needles: string[]): boolean {
  for (const n of needles) {
    if (s.includes(n)) return true;
  }
  return false;
}

/** Scan the build for references to the resource AND its linked dataSource.
 *  The target resource and the linked dataSource definitions themselves are
 *  excluded (they're the things being deleted).
 *  Returns one human-readable line per reference site. */
export function findResourceReferences(
  build: WebstudioBuild,
  targetResourceId: string,
  targetDataSourceId: string | undefined,
): string[] {
  const refs: string[] = [];
  const needles = [
    ...encodedForms(targetResourceId),
    ...(targetDataSourceId ? encodedForms(targetDataSourceId) : []),
  ];

  // Other dataSources — could reference (rare, but defensive).
  for (const ds of (build as unknown as { dataSources: DataSource[] }).dataSources ?? []) {
    if (ds.id === targetDataSourceId) continue;
    const s = JSON.stringify(ds);
    if (containsAny(s, needles)) {
      refs.push(`dataSource ${ds.id} ("${ds.name ?? "?"}", type=${ds.type})`);
    }
  }

  // Other resources — could reference (e.g. URL built from another resource's data).
  for (const r of (build as unknown as { resources: Resource[] }).resources ?? []) {
    if (r.id === targetResourceId) continue;
    const s = JSON.stringify(r);
    if (containsAny(s, needles)) {
      refs.push(`resource ${r.id} ("${r.name}")`);
    }
  }

  // Props — action handlers, expression-typed props, etc.
  for (const p of build.props) {
    const s = JSON.stringify(p.value);
    if (containsAny(s, needles)) {
      refs.push(`prop ${p.name} (type=${p.type}) on instance ${p.instanceId}`);
    }
  }

  // Instance expression children (text replaced by expression).
  for (const inst of build.instances) {
    for (const c of inst.children ?? []) {
      if (c.type === "expression" && typeof c.value === "string") {
        if (containsAny(c.value, needles)) {
          refs.push(
            `expression child of instance ${inst.id} (${inst.label || inst.component})`,
          );
        }
      }
    }
  }

  return refs;
}
