// Tool: webstudio_audit — unified audit dispatcher.
//
// Consolidates 11 specialised audit tools behind one tool with `kind` enum.
// Each kind delegates to the existing handler — no logic duplication.
//
// audit_page stays separate as the comprehensive entry point for a single page.

import type { ToolModule } from "./types.js";
import { errorResult } from "./types.js";
import { auditOverflowTool } from "./audit-overflow.js";
import { auditLocalStylesTool } from "./audit-local-styles.js";
import { auditTokenUsageTool } from "./audit-token-usage.js";
import { auditTokenOverlapTool } from "./audit-token-overlap.js";
import { auditOrphansTool } from "./audit-orphans.js";
import { auditAssetsTool } from "./audit-assets.js";
import { auditFontsTool } from "./audit-fonts.js";
import { auditImagesTool } from "./audit-images.js";
import { auditScriptsTool } from "./audit-scripts.js";
import { auditResourcesPerfTool } from "./audit-resources-perf.js";
import { diffPagesTokensTool } from "./diff-pages-tokens.js";
import { auditRadixTriggerPollutionTool } from "./audit-radix-trigger-pollution.js";

const KIND_TO_TOOL: Record<string, ToolModule> = {
  "overflow": auditOverflowTool,
  "local-styles": auditLocalStylesTool,
  "token-usage": auditTokenUsageTool,
  "token-overlap": auditTokenOverlapTool,
  "orphans": auditOrphansTool,
  "assets": auditAssetsTool,
  "fonts": auditFontsTool,
  "images": auditImagesTool,
  "scripts": auditScriptsTool,
  "resources-perf": auditResourcesPerfTool,
  "diff-pages-tokens": diffPagesTokensTool,
  "radix-trigger-pollution": auditRadixTriggerPollutionTool,
};

const KIND_DESCRIPTIONS: Record<string, string> = {
  "overflow": "Detect horizontal scroll causes on a page (fixed widths, grid 1fr without minmax, flex nowrap...). Params: projectSlug, pageId|pagePath, breakpoint?, minSeverity?, maxIssues?",
  "local-styles": "Find hardcoded values in local styles that should be tokens (spacing, colors, typography). Params: projectSlug, pageId|pagePath",
  "token-usage": "List tokens vs their usage count across the project (identify dead tokens, over-used tokens). Params: projectSlug",
  "token-overlap": "Classify local overrides as DUPE/OVERRIDE/UNIQUE vs existing tokens — find overrides that should be consolidated. Params: projectSlug",
  "orphans": "Find styles/props/sources that reference deleted instances (cleanup candidates). Params: projectSlug",
  "assets": "Project-wide audit of uploaded assets (unused, oversized, format issues). Params: projectSlug",
  "fonts": "Cross-reference uploaded fonts with font-family/font-weight actually used in styles. Flags prefetched-but-unused weights. Params: projectSlug, sizeThresholdKB?, verbose?",
  "images": "Audit images (alt text quality, oversized, format/format-suitability). Params: projectSlug",
  "scripts": "Audit HtmlEmbed scripts and inline JS (size, external loads, perf cost). Params: projectSlug",
  "resources-perf": "Audit project resources (REST calls) for perf cost (latency, payload size, caching). Params: projectSlug",
  "diff-pages-tokens": "Compare tokens used across two pages to find divergence. Params: projectSlug, pageIdA|pagePathA, pageIdB|pagePathB",
  "radix-trigger-pollution": "Scan all Radix non-rendering wrappers (DialogTrigger, *Portal, *Close, NavigationMenuLink, Slot, ...) for forbidden class/style/id props or local styles — root cause of the SPA-navigation class-hash drop bug. Suggests the rendering child to migrate each finding to. Params: projectSlug, verbose?",
};

export const auditTool: ToolModule = {
  definition: {
    name: "webstudio_audit",
    description: `Use when: focused audit on ONE specific aspect of a project (overflow, dead tokens, oversized images, etc.) — pick a kind from the enum below.
Do NOT use when: you want a comprehensive audit of a single page (sections + tokens + anomalies + bindings in one shot) — use webstudio_audit_page. For raw instance details, use webstudio_inspect.
Returns: kind-specific report (markdown text). Pick a kind:
${Object.entries(KIND_DESCRIPTIONS).map(([k, v]) => `  - ${k}: ${v}`).join("\n")}
Side effects: none (read-only) — no push, no mutation.

Example: { kind: "token-overlap", projectSlug: "my-site" }
Example: { kind: "overflow", projectSlug: "acme", pagePath: "/", breakpoint: "mobile-portrait" }
Example: { kind: "fonts", projectSlug: "my-site", sizeThresholdKB: 80 }`,
    inputSchema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: Object.keys(KIND_TO_TOOL),
          description: "Audit kind to run. Each kind has its own set of params (see description).",
        },
        projectSlug: { type: "string" },
      },
      required: ["kind", "projectSlug"],
      additionalProperties: true,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  handler: async (args) => {
    const raw = (args ?? {}) as Record<string, unknown>;
    const kind = typeof raw.kind === "string" ? raw.kind : undefined;
    if (!kind) {
      return errorResult(
        "VALIDATION_FAILED",
        `Missing 'kind' param. Valid values: ${Object.keys(KIND_TO_TOOL).join(", ")}`,
      );
    }
    const sub = KIND_TO_TOOL[kind];
    if (!sub) {
      return errorResult(
        "VALIDATION_FAILED",
        `Unknown audit kind "${kind}". Valid values: ${Object.keys(KIND_TO_TOOL).join(", ")}`,
      );
    }
    const { kind: _kind, ...rest } = raw;
    return sub.handler(rest);
  },
};
