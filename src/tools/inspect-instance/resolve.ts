// Resolve the target instance IDs for webstudio_inspect_instance — supports
// direct IDs OR labelContains+page filtering.

import type { WebstudioBuild } from "../../webstudio-client.js";

export type ResolveOpts = {
  labelContains?: string;
  pageId?: string;
  pagePath?: string;
};

export function resolvePageInstanceIds(build: WebstudioBuild, opts: ResolveOpts): string[] | string {
  if (!opts.labelContains && !opts.pagePath && !opts.pageId) return [];
  const page = opts.pageId
    ? build.pages.pages.find((p) => p.id === opts.pageId)
    : opts.pagePath !== undefined
      ? build.pages.pages.find((p) => p.path === opts.pagePath)
      : undefined;
  if (!page && (opts.pageId || opts.pagePath !== undefined)) {
    return `Page not found (${opts.pageId ? "id" : "path"}=${opts.pageId ?? opts.pagePath})`;
  }

  const ids = new Set<string>();
  if (page) {
    const visit = (id: string) => {
      if (ids.has(id)) return;
      ids.add(id);
      const inst = build.instances.find((i) => i.id === id);
      if (!inst) return;
      for (const c of inst.children ?? []) {
        if (c.type === "id") visit(c.value);
      }
    };
    visit(page.rootInstanceId);
  } else {
    for (const inst of build.instances) ids.add(inst.id);
  }

  if (opts.labelContains) {
    const lc = opts.labelContains.toLowerCase();
    return [...ids].filter((id) => {
      const inst = build.instances.find((i) => i.id === id);
      return inst?.label?.toLowerCase().includes(lc);
    });
  }
  return [...ids];
}
