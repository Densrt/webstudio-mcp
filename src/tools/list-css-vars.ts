// Tool: webstudio_css_var
//
// Inventory of every CSS custom property declared at the project's root scope.
// Pairs with webstudio_css_var (write side).
//
// Groups vars by semantic family detected from the name's prefix
// (color-, space-, padding-, font-, radius-, etc.) so the design system shows up
// in a structured way rather than as a flat dump.
//
// Read-only.

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth } from "../auth.js";
import { fetchBuild } from "../webstudio-client.js";
import type { WebstudioBuild } from "../webstudio-client.js";

const ROOT_INSTANCE_ID = ":root";

export const listCssVarsInputSchema = z.object({
  projectSlug: z.string(),
  /** Filter vars whose name (without "--" prefix) contains this substring (case-insensitive). */
  filter: z.string().optional(),
  /** Restrict to a specific breakpoint label/id. Default: all breakpoints (Base + responsive overrides). */
  breakpoint: z.string().optional(),
  /** Show usage count (number of decls referencing each var via var()). Default true. */
  withUsage: z.boolean().default(true),
  /** Sort: "name" (default) | "family" | "usage-desc". */
  sort: z.enum(["name", "family", "usage-desc"]).default("name"),
}).strict();

function valueToString(v: unknown): string {
  const o = v as { type?: string; value?: unknown; unit?: string; alpha?: number; r?: number; g?: number; b?: number };
  if (!o || typeof o !== "object") return JSON.stringify(v);
  switch (o.type) {
    case "unit": return `${String(o.value)}${o.unit ?? ""}`;
    case "var": return `var(--${String(o.value)})`;
    case "keyword": return String(o.value);
    case "rgb": return `rgb(${o.r},${o.g},${o.b}${o.alpha != null && o.alpha !== 1 ? `,${o.alpha}` : ""})`;
    case "color": {
      const c = o as { components?: number[]; alpha?: number };
      if (Array.isArray(c.components)) {
        const [r, g, b] = c.components;
        const hex = "#" + [r, g, b].map((n) => Math.round((n ?? 0) * 255).toString(16).padStart(2, "0")).join("");
        return c.alpha != null && c.alpha !== 1 ? `${hex} (α=${c.alpha})` : hex;
      }
      return JSON.stringify(v);
    }
    case "fontFamily": return Array.isArray(o.value) ? o.value.join(", ") : JSON.stringify(o.value);
    default: return JSON.stringify(v);
  }
}

/** Extract the family from a var name. Conventions:
 *  --<project>-<family>-<variant>  →  family = "color", "space", "padding", "font", etc. */
function familyOf(name: string): string {
  // Strip the leading "--" and project prefix (first segment before "-")
  const noPrefix = name.replace(/^--/, "");
  const segments = noPrefix.split("-");
  if (segments.length < 2) return "misc";
  // Take 2nd segment as family (after project slug). For "mybrand-color-primary-red" → "color".
  return segments[1] ?? "misc";
}

function buildReport(build: WebstudioBuild, args: z.infer<typeof listCssVarsInputSchema>) {
  // Resolve allowed breakpoints
  const allowedBpIds = args.breakpoint
    ? [build.breakpoints.find((b) => b.label === args.breakpoint || b.id === args.breakpoint)?.id]
    : null;
  if (args.breakpoint && (!allowedBpIds || !allowedBpIds[0])) {
    throw new Error(`Breakpoint not found: ${args.breakpoint}`);
  }
  const bpLabels = new Map(build.breakpoints.map((b) => [b.id, b.label]));

  // Find root selection + extract local source(s) hosting :root vars
  const rootSel = build.styleSourceSelections.find((s) => s.instanceId === ROOT_INSTANCE_ID);
  const rootSourceIds = new Set(
    (rootSel?.values ?? []).filter((v) => build.styleSources.find((s) => s.id === v)?.type === "local"),
  );

  // Collect var declarations
  type VarDecl = { name: string; family: string; breakpoint: string; valueStr: string; rawValue: unknown };
  const decls: VarDecl[] = [];
  for (const d of build.styles) {
    if (!rootSourceIds.has(d.styleSourceId)) continue;
    if (!d.property.startsWith("--")) continue;
    if (allowedBpIds && !allowedBpIds.includes(d.breakpointId)) continue;
    const name = d.property;
    if (args.filter && !name.toLowerCase().includes(args.filter.toLowerCase())) continue;
    decls.push({
      name,
      family: familyOf(name),
      breakpoint: bpLabels.get(d.breakpointId) ?? d.breakpointId,
      valueStr: valueToString(d.value),
      rawValue: d.value,
    });
  }

  // Optional: count usages
  const usageByName = new Map<string, number>();
  if (args.withUsage) {
    for (const d of build.styles) {
      const v = d.value as { type?: string; value?: unknown };
      if (v?.type !== "var") continue;
      const refName = `--${String(v.value)}`;
      usageByName.set(refName, (usageByName.get(refName) ?? 0) + 1);
    }
  }

  // Sort
  if (args.sort === "name") decls.sort((a, b) => a.name.localeCompare(b.name));
  else if (args.sort === "family") decls.sort((a, b) => a.family.localeCompare(b.family) || a.name.localeCompare(b.name));
  else if (args.sort === "usage-desc") {
    decls.sort((a, b) => (usageByName.get(b.name) ?? 0) - (usageByName.get(a.name) ?? 0) || a.name.localeCompare(b.name));
  }

  // Group by family for display
  const byFamily = new Map<string, VarDecl[]>();
  for (const d of decls) {
    if (!byFamily.has(d.family)) byFamily.set(d.family, []);
    byFamily.get(d.family)!.push(d);
  }

  return { decls, byFamily, usageByName, rootSourceIds: [...rootSourceIds] };
}

export const listCssVarsTool: ToolModule = {
  definition: {
    name: "webstudio_list_css_vars",
    description: `Use when: inventory the project's :root CSS custom properties (--xxx). Pairs with webstudio_css_var (write side) and webstudio_css_var.
Do NOT use when: listing design TOKENS / styleSources type="token" (use webstudio_list_tokens_cloud — tokens are a different model from CSS vars), inspecting a single instance's styles (use webstudio_inspect target:"instance"), or auditing token overlap (use webstudio_audit({kind:"token-overlap"})).
Returns: grouped report { name, value (decoded), breakpoint, usage } per family inferred from name segments (e.g. "mybrand-color-primary" → family "color"). Family grouping in display when sort="family".
Side effects: none (read-only).

Filters: filter (case-insensitive substring on name), breakpoint (restrict to one bp; default all), withUsage (default true; count of decls referencing the var via var()), sort ("name"|"family"|"usage-desc").

Example: { projectSlug: "acme" }
Example: { projectSlug: "acme", filter: "color", sort: "usage-desc" }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        filter: { type: "string" },
        breakpoint: { type: "string" },
        withUsage: { type: "boolean" },
        sort: { type: "string", enum: ["name", "family", "usage-desc"] },
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
    const parsed = listCssVarsInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const data = parsed.data;

    let auth;
    try { auth = requireAuth(data.projectSlug); }
    catch (err) { return authErrorResult(err); }

    let build;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    let r;
    try { r = buildReport(build, data); }
    catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith("Breakpoint not found")) return errorResult("VALIDATION_FAILED", msg);
      return errorResult("INTERNAL_ERROR", msg);
    }

    const lines: string[] = [];
    lines.push(`# CSS vars — ${data.projectSlug}`);
    lines.push(`Hosted on ${r.rootSourceIds.length} root styleSource(s) | Total vars: ${r.decls.length}`);
    if (data.filter) lines.push(`Filter: "${data.filter}"`);
    lines.push("");

    if (r.decls.length === 0) {
      lines.push("(no CSS vars under current filters)");
    } else if (data.sort === "name" || data.sort === "usage-desc") {
      // Flat listing, grouped optionally
      for (const d of r.decls) {
        const usage = data.withUsage ? `  ×${r.usageByName.get(d.name) ?? 0}` : "";
        const bp = d.breakpoint !== "Base" ? `  @${d.breakpoint}` : "";
        lines.push(`  ${d.name} = ${d.valueStr}${bp}${usage}`);
      }
    } else {
      // Family grouping
      for (const [family, fdecls] of r.byFamily.entries()) {
        lines.push(`## ${family}  (${fdecls.length})`);
        for (const d of fdecls) {
          const usage = data.withUsage ? `  ×${r.usageByName.get(d.name) ?? 0}` : "";
          const bp = d.breakpoint !== "Base" ? `  @${d.breakpoint}` : "";
          lines.push(`  ${d.name} = ${d.valueStr}${bp}${usage}`);
        }
        lines.push("");
      }
    }

    return textResult(lines.join("\n"));
  },
};
