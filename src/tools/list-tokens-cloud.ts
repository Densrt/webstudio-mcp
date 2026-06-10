// Tool: webstudio_list_tokens_cloud
//
// Inventory of every design token (styleSource type="token") that lives in the
// Webstudio CLOUD build. Different from webstudio_list_tokens which lists the
// LOCAL tokens.json staging file.
//
// Pairs with webstudio_create_token / create_tokens (write side, Cloud).
// Read-only.

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth } from "../auth.js";
import { fetchBuild } from "../webstudio-client.js";
import type { WebstudioBuild } from "../webstudio-client.js";

export const listTokensCloudInputSchema = z.object({
  projectSlug: z.string(),
  /** Substring match on token name (case-insensitive). */
  filter: z.string().optional(),
  /** Include usage count (number of distinct instances selecting this token). Default true. */
  withUsage: z.boolean().default(true),
  /** Sort: "name" (default) | "usage" (desc). */
  sort: z.enum(["name", "usage"]).default("name"),
  /** Max rows returned (v2.14.0 — responses were unbounded on token-heavy projects). */
  limit: z.number().int().min(1).max(1000).default(200)
    .describe("Max rows returned (default 200). A footer reports how many rows were cut."),
}).strict();

type Token = WebstudioBuild["styleSources"][number] & { type: "token"; name: string };

type Row = {
  id: string;
  name: string;
  decls: number;
  usage: number;
};

function buildRows(build: WebstudioBuild, args: z.infer<typeof listTokensCloudInputSchema>): Row[] {
  const tokens: Token[] = build.styleSources.filter((s): s is Token => s.type === "token");

  // Decl count per token id
  const declCount = new Map<string, number>();
  for (const t of tokens) declCount.set(t.id, 0);
  for (const d of build.styles) {
    if (declCount.has(d.styleSourceId)) {
      declCount.set(d.styleSourceId, (declCount.get(d.styleSourceId) ?? 0) + 1);
    }
  }

  // Usage count: number of distinct instances selecting each token
  const usageCount = new Map<string, Set<string>>();
  if (args.withUsage) {
    for (const t of tokens) usageCount.set(t.id, new Set());
    for (const sel of build.styleSourceSelections) {
      for (const v of sel.values ?? []) {
        if (usageCount.has(v)) usageCount.get(v)!.add(sel.instanceId);
      }
    }
  }

  const filter = args.filter?.toLowerCase();

  const rows: Row[] = tokens
    .filter((t) => !filter || t.name.toLowerCase().includes(filter))
    .map((t) => ({
      id: t.id,
      name: t.name,
      decls: declCount.get(t.id) ?? 0,
      usage: usageCount.get(t.id)?.size ?? 0,
    }));

  if (args.sort === "name") {
    rows.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    rows.sort((a, b) => b.usage - a.usage || a.name.localeCompare(b.name));
  }

  return rows;
}

function renderTable(rows: Row[], withUsage: boolean): string {
  if (rows.length === 0) return "(no tokens)";
  const headers = withUsage
    ? ["name", "id (short)", "decls", "usage"]
    : ["name", "id (short)", "decls"];

  const data = rows.map((r) => [
    r.name,
    r.id.slice(0, 8),
    String(r.decls),
    String(r.usage),
  ]);

  const cols = withUsage ? 4 : 3;
  const widths = headers.slice(0, cols).map((h, i) =>
    Math.max(h.length, ...data.map((row) => (row[i] ?? "").length)),
  );

  const fmt = (cells: string[]) =>
    cells.slice(0, cols).map((c, i) => (c ?? "").padEnd(widths[i])).join("  ");

  const lines: string[] = [];
  lines.push(fmt(headers));
  lines.push(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of data) lines.push(fmt(row));
  return lines.join("\n");
}

export const listTokensCloudTool: ToolModule = {
  definition: {
    name: "webstudio_list_tokens_cloud",
    description: `Use when: inventory of design tokens living in the Webstudio CLOUD build (styleSource type="token").
Do NOT use when: listing tokens staged LOCALLY in tokens.json (use webstudio_list_tokens — local staging side), inspecting which instances use a specific token in detail (use webstudio_inspect target:"token" or filter list_instances by styleSource), or listing CSS custom properties (use webstudio_css_var).
Returns: table of { name, short id, decls, usage } where usage = distinct instances selecting the token (if withUsage=true).
Side effects: none (read-only).

filter: case-insensitive substring on name. sort: "name" (default, alpha) | "usage" (desc by selection count, then alpha).

Example: { projectSlug: "acme" }
Example: { projectSlug: "acme", filter: "color", sort: "usage" }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        filter: { type: "string" },
        withUsage: { type: "boolean" },
        sort: { type: "string", enum: ["name", "usage"] },
        limit: { type: "number", description: "Max rows returned (default 200)." },
      },
      required: ["projectSlug"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  handler: async (args) => {
    const parsed = listTokensCloudInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const data = parsed.data;

    let auth;
    try { auth = requireAuth(data.projectSlug); }
    catch (err) { return authErrorResult(err); }

    let build: WebstudioBuild;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    const rows = buildRows(build, data);
    const shown = rows.slice(0, data.limit);

    const lines: string[] = [];
    lines.push(`# Cloud tokens — ${data.projectSlug}`);
    lines.push(`Total: ${rows.length}${data.filter ? `  (filter: "${data.filter}")` : ""}  Sort: ${data.sort}`);
    lines.push("");
    lines.push(renderTable(shown, data.withUsage));
    if (shown.length < rows.length) {
      lines.push("");
      lines.push(`[truncated: ${shown.length}/${rows.length} rows — raise \`limit\` or narrow with \`filter\`]`);
    }

    return textResult(lines.join("\n"));
  },
};
