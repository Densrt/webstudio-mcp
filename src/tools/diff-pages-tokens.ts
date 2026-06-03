// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HANDLER — dispatched via webstudio_audit(kind:"diff-pages-tokens").
//
// As of v0.3.0 this file is NOT exposed as a standalone tool in the MCP manifest.
// It remains as a handler delegated to by src/tools/audit.ts. Editing this file:
//   - The `description` field is irrelevant (the dispatcher's description wins).
//   - The `handler` is what runs when `audit({kind:"diff-pages-tokens", ...})` is called.
//   - The Zod `Schema` still validates the dispatched args.
// To expose this back as a standalone tool: add `webstudio_<name>` to TOOLS in
// src/index.ts and add an entry in src/tools/index-tool-categories.ts.
// ─────────────────────────────────────────────────────────────────────────────
// Tool: webstudio_diff_pages_tokens
//
// Produces a matrix `token × page → usageCount` to detect design-system drift
// between pages of the same project (token used on Home but missing on Page B,
// residual tokens that only appear on one page, etc.).
//
// Read-only.

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth } from "../auth.js";
import { fetchBuild } from "../webstudio-client.js";
import type { WebstudioBuild } from "../webstudio-client.js";

export const diffPagesTokensInputSchema = z.object({
  projectSlug: z.string(),
  /** Pages to compare: list of pageIds OR page paths (e.g. ["/", "/about"]). If empty, all pages. */
  pages: z.array(z.string()).default([]),
  /** Filter tokens by name prefix (e.g. "MyBrand "). If omitted, all tokens. */
  prefix: z.string().optional(),
  /** Hide tokens used identically on every targeted page (focus on drift). Default true. */
  hideUniform: z.boolean().default(true),
  /** Hide tokens with 0 usage on every targeted page (orphans). Default false. */
  hideOrphans: z.boolean().default(false),
}).strict();

type PageRef = { id: string; name: string; path: string; rootInstanceId: string };

export function buildReport(build: WebstudioBuild, args: z.infer<typeof diffPagesTokensInputSchema>) {
  // Resolve pages
  const allPages: PageRef[] = build.pages.pages.map((p) => ({
    id: p.id,
    name: p.name,
    path: p.path,
    rootInstanceId: p.rootInstanceId,
  }));
  let targets: PageRef[];
  if (args.pages.length === 0) {
    targets = allPages;
  } else {
    targets = [];
    for (const ref of args.pages) {
      const match = allPages.find((p) => p.id === ref || p.path === ref);
      if (!match) return { error: "PAGE_NOT_FOUND" as const, missing: ref };
      targets.push(match);
    }
  }

  // For each target page, collect the set of instance IDs in its subtree
  const instById = new Map(build.instances.map((i) => [i.id, i]));
  function collectInstances(rootId: string): Set<string> {
    const ids = new Set<string>();
    const stack = [rootId];
    while (stack.length) {
      const id = stack.pop()!;
      if (ids.has(id)) continue;
      const inst = instById.get(id);
      if (!inst) continue;
      ids.add(id);
      for (const c of inst.children ?? []) {
        if (c.type === "id") stack.push(c.value);
      }
    }
    return ids;
  }
  const instancesByPage = new Map<string, Set<string>>();
  for (const p of targets) instancesByPage.set(p.id, collectInstances(p.rootInstanceId));

  // Filter tokens by prefix
  const tokens = build.styleSources.filter((s) => {
    if (s.type !== "token") return false;
    if (args.prefix && !s.name.startsWith(args.prefix)) return false;
    return true;
  }) as Array<Extract<WebstudioBuild["styleSources"][number], { type: "token" }>>;

  // Count usage per (token, page)
  const matrix: Record<string, Record<string, number>> = {};
  for (const t of tokens) matrix[t.id] = Object.fromEntries(targets.map((p) => [p.id, 0]));
  for (const sel of build.styleSourceSelections) {
    if (!sel.values || sel.values.length === 0) continue;
    for (const p of targets) {
      if (!instancesByPage.get(p.id)!.has(sel.instanceId)) continue;
      for (const ssId of sel.values) {
        if (matrix[ssId]) matrix[ssId][p.id]++;
      }
    }
  }

  // Compute per-token shape: uniform / drift / orphan
  const rows = tokens.map((t) => {
    const counts = targets.map((p) => matrix[t.id][p.id]);
    const total = counts.reduce((a, b) => a + b, 0);
    const usedPages = counts.filter((c) => c > 0).length;
    const orphan = total === 0;
    const uniform = !orphan && usedPages === targets.length;
    const drift = !orphan && !uniform; // present on some, missing on others
    return { id: t.id, name: t.name, counts, total, usedPages, orphan, uniform, drift };
  });

  // Apply filters
  let filtered = rows;
  if (args.hideUniform) filtered = filtered.filter((r) => !r.uniform);
  if (args.hideOrphans) filtered = filtered.filter((r) => !r.orphan);

  filtered.sort((a, b) => {
    // Drift first, then orphans, then alphabetical
    if (a.drift !== b.drift) return a.drift ? -1 : 1;
    if (a.orphan !== b.orphan) return a.orphan ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  return {
    targets,
    rows: filtered,
    totals: {
      tokensInspected: tokens.length,
      drift: rows.filter((r) => r.drift).length,
      uniform: rows.filter((r) => r.uniform).length,
      orphans: rows.filter((r) => r.orphan).length,
    },
  };
}

export const diffPagesTokensTool: ToolModule = {
  definition: {
    name: "webstudio_diff_pages_tokens",
    description: `Use when: you want to detect design-system drift between pages — token X is used on page A but missing on page B.
Output: matrix token × page → usage count, with rows flagged as DRIFT / UNIFORM / ORPHAN.
pages: array of pageIds or paths (default: all pages). prefix: filter tokens by name prefix.
hideUniform=true by default (focus on drift). Read-only.`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        pages: { type: "array", items: { type: "string" } },
        prefix: { type: "string" },
        hideUniform: { type: "boolean" },
        hideOrphans: { type: "boolean" },
      },
      required: ["projectSlug"],
      additionalProperties: false,
    },
  },
  handler: async (args) => {
    const parsed = diffPagesTokensInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const data = parsed.data;

    let auth;
    try { auth = requireAuth(data.projectSlug); }
    catch (err) { return authErrorResult(err); }

    let build: WebstudioBuild;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    const r = buildReport(build, data);
    if ("error" in r) {
      return errorResult("PAGE_NOT_FOUND", `Page not found: ${r.missing}. Use pageId or exact path.`);
    }

    const lines: string[] = [];
    lines.push(`# Token × Page drift — ${data.projectSlug}`);
    lines.push(
      `Pages: ${r.targets.length} | Tokens inspected: ${r.totals.tokensInspected} | DRIFT: ${r.totals.drift} · UNIFORM: ${r.totals.uniform} · ORPHANS: ${r.totals.orphans}`
    );
    if (data.prefix) lines.push(`Prefix filter: "${data.prefix}"`);
    lines.push("");

    // Header
    const colWidths = r.targets.map((p) => Math.max(4, Math.min(20, p.path.length)));
    const header = r.targets.map((p, i) => p.path.padEnd(colWidths[i])).join("  ");
    lines.push(`| token name                                       | ${header} | flags`);
    lines.push("|" + "-".repeat(50) + "|" + "-".repeat(header.length + 2) + "|-------");

    for (const row of r.rows) {
      const cells = row.counts.map((c, i) => String(c).padEnd(colWidths[i])).join("  ");
      const flag = row.drift ? "DRIFT" : row.orphan ? "ORPHAN" : "uniform";
      const name = `"${row.name}"`.slice(0, 49).padEnd(49);
      lines.push(`| ${name}| ${cells} | ${flag}`);
    }

    if (r.rows.length === 0) {
      lines.push("");
      lines.push("(no rows after filters — try hideUniform=false or hideOrphans=false)");
    }

    lines.push("");
    lines.push(`## Notes`);
    lines.push(`- DRIFT  = used on some pages, missing on others (probable inconsistency)`);
    lines.push(`- UNIFORM = used on every targeted page (filtered by default; pass hideUniform=false to see)`);
    lines.push(`- ORPHAN = present in the registry but 0 usage across the targeted pages`);

    return textResult(lines.join("\n"));
  },
};
