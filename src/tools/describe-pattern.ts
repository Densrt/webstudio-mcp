// Tool: webstudio_describe_pattern — self-service docs for helpers and tools.
// - pattern: "<name>" → render builder helper docs (sheet, tabs, ...)
// - tool: "webstudio_<name>" → render deep usage notes for the named tool
// - no arg → list both catalogs

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult } from "./types.js";
import { HELPER_DOCS, renderHelperDoc } from "./describe-pattern/helpers-docs.js";
import { TOOL_DOCS } from "./describe-pattern/tools-docs.js";
import { LONG_PATTERN_DOCS } from "./describe-pattern/long-patterns.js";
import { findSnippets, SNIPPETS } from "./helpers.js";

export const describePatternInputSchema = z.object({
  pattern: z.string().optional(),
  tool: z.string().optional(),
  helper: z.string().optional(),
}).strict();

function renderIndex(): string {
  const helperLines = Object.entries(HELPER_DOCS).map(
    ([k, p]) => `  - ${k} (${p.category}): ${p.description.slice(0, 80)}…`
  );
  const longLines = Object.entries(LONG_PATTERN_DOCS).map(
    ([k, p]) => `  - ${k}: ${p.description.slice(0, 120)}${p.description.length > 120 ? "…" : ""}`,
  );
  const toolLines = Object.keys(TOOL_DOCS).sort().map((k) => `  - ${k}`);
  const sections = [
    `## Builder helpers (use pattern:"<name>")\n${helperLines.join("\n")}`,
  ];
  if (longLines.length) {
    sections.push(
      `## Long-form pattern recipes (use pattern:"<slug>") — full architecture + pitfalls\n${longLines.join("\n")}`,
    );
  }
  sections.push(`## Tools with deep docs (use tool:"<name>")\n${toolLines.join("\n")}`);
  return `Available docs:\n\n${sections.join("\n\n")}`;
}

export const describePatternTool: ToolModule = {
  definition: {
    name: "webstudio_describe_pattern",
    description: `Use when: need full architecture + pitfalls for a Webstudio pattern (used by push_fragment, create_sheet, create_navigation_menu, update_styles, wrap_instance) OR deep usage notes for a webstudio_* tool OR a quick StyleValue snippet (helper).
Do NOT use when: you want to find a tool by category — use webstudio_index. To inspect a live instance, use webstudio_inspect.
Returns: full markdown body (architecture, pitfalls, copy-paste recipes) for the requested pattern/tool, OR a ready-to-paste snippet (helper), OR an index of all catalogs if no arg.
Side effects: none (read-only).

Available pattern slugs (use pattern:"<slug>"): swiper-carousel, sheet-mobile-radix, navigation-menu-radix, hover-cascade-via-css-vars, carousel-scroll-snap, tabs-radix-gotchas, radix-components-reference, architecture-tokens, css-vars-scope, tokens-variants-vs-overrides, variables-and-bindings, resources-http-data, ws-collection-bindings, flexbox-flex-basis-direction-trap, border-color-ui-quirk, ticker-recipe, webstudio-fragment-format, paste-debug-method, webstudio-cloud-auth, page-management, recipes-design-system, fragment-hero, video-component, reset-margins-global, html-embed-css-injection, state-selector-format.

Available helper keys (use helper:"<query>" — substring match): flex, grid, spacing, typo (or font), container (or max-width), responsive (or breakpoint).

Example: { pattern: "swiper-carousel" }
Example: { tool: "webstudio_push_fragment" }
Example: { helper: "flex center" }
Example: { } (lists all catalogs)`,
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Pattern slug (e.g. 'swiper-carousel'). See description for full list." },
        tool: { type: "string", description: "Tool name (e.g. 'webstudio_upload_asset'). Empty = list all." },
        helper: { type: "string", description: "Quick snippet query (e.g. 'flex center', 'grid 3 cols', 'spacing scale')." },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  handler: async (args) => {
    const parsed = describePatternInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);

    const { pattern, tool, helper } = parsed.data;

    if (!pattern && !tool && !helper) return textResult(renderIndex());

    if (helper) {
      const matches = findSnippets(helper);
      if (matches.length === 0) {
        return errorResult(
          "VALIDATION_FAILED",
          `No helper snippet matches "${helper}". Available keys: ${[...new Set(SNIPPETS.flatMap((s) => s.keys))].sort().join(", ")}`,
        );
      }
      return textResult(matches.join("\n\n"));
    }

    if (pattern) {
      const key = pattern.toLowerCase();
      // 1. helper docs (compact reference cards)
      const helper = HELPER_DOCS[key];
      if (helper) return textResult(renderHelperDoc(helper));
      // 2. long-form pattern recipes (full markdown from docs/patterns/)
      const long = LONG_PATTERN_DOCS[key];
      if (long) return textResult(`# ${long.title}\n\n${long.body}`);
      return errorResult(
        "VALIDATION_FAILED",
        `Pattern "${pattern}" not found.\nHelpers: ${Object.keys(HELPER_DOCS).join(", ")}\nLong patterns: ${Object.keys(LONG_PATTERN_DOCS).join(", ") || "(none loaded)"}`,
      );
    }

    // tool branch
    const key = tool!;
    const doc = TOOL_DOCS[key];
    if (!doc) {
      return errorResult(
        "VALIDATION_FAILED",
        `Tool "${key}" has no deep docs registered. Available: ${Object.keys(TOOL_DOCS).sort().join(", ")}`
      );
    }
    return textResult(`# ${key}\n\n${doc}`);
  },
};
