// Tool: webstudio_describe_pattern — ready-to-use StyleValue snippets.
//
// As of v0.4.0 also exposed via webstudio_describe_pattern(helper:"<key>") — the
// SNIPPETS array is exported for reuse from describe_pattern. The standalone
// webstudio_describe_pattern tool is kept for backward compat but is removed from the
// registry in v0.4.0 (use describe_pattern instead). The file remains exported
// to keep the snippet source-of-truth reusable.

import type { ToolModule } from "./types.js";
import { textResult } from "./types.js";

export const SNIPPETS: Array<{ keys: string[]; text: string }> = [
  { keys: ["flex"], text: `// Flex center
display: { type: "keyword", value: "flex" }
alignItems: { type: "keyword", value: "center" }
justifyContent: { type: "keyword", value: "center" }
gap: { type: "unit", value: 16, unit: "px" }` },
  { keys: ["grid"], text: `// 3-column grid
display: { type: "keyword", value: "grid" }
gridTemplateColumns: { type: "unparsed", value: "repeat(3, 1fr)" }
gap: { type: "unit", value: 24, unit: "px" }` },
  { keys: ["spacing", "scale"], text: `// Spacing scale (px)
4 / 8 / 16 / 24 / 32 / 48 / 64 → { type: "unit", value: N, unit: "px" }
or in rem: { type: "unit", value: 1, unit: "rem" }` },
  { keys: ["typo", "font"], text: `// Typography
fontSize: { type: "unit", value: 1, unit: "rem" }
fontWeight: { type: "keyword", value: "600" }
lineHeight: { type: "unit", value: 1.5, unit: "number" }
color: use color("#1a1a1a") from the builder` },
  { keys: ["container", "max-width"], text: `// Centered container
maxWidth: { type: "unit", value: 1200, unit: "px" }
marginLeft/Right: { type: "keyword", value: "auto" }
paddingLeft/Right: { type: "unit", value: 24, unit: "px" }` },
  { keys: ["responsive", "breakpoint"], text: `// Webstudio breakpoints
base             → desktop-first
tablet           → maxWidth 991px
mobile-landscape → maxWidth 767px
mobile-portrait  → maxWidth 479px` },
];

/**
 * Find snippets matching a query. Used by both webstudio_describe_pattern and
 * webstudio_describe_pattern(helper:"<key>") for shared logic.
 */
export function findSnippets(query: string): string[] {
  const q = query.toLowerCase();
  return SNIPPETS.filter((s) => s.keys.some((k) => q.includes(k))).map((s) => s.text);
}

export const helpersTool: ToolModule = {
  definition: {
    name: "webstudio_helpers",
    description: `Use when: need copy-pastable StyleValue snippet examples for common CSS patterns (flex center, grid 3-cols, spacing scale, typography, container, breakpoints) — quick reference while assembling a fragment.
Do NOT use when: you want deep architecture docs on a pattern — use webstudio_describe_pattern(pattern:"<slug>"). For tool-specific deep docs use webstudio_describe_pattern(tool:"<name>").
Returns: matching snippet text(s) joined by blank lines, or a usage hint if no match.
Side effects: none (read-only).

Example: { query: "flex center" }
Example: { query: "responsive breakpoints" }`,
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
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
    const query = ((args as { query: string }).query || "").toLowerCase();
    const matches = SNIPPETS.filter((s) => s.keys.some((k) => query.includes(k))).map((s) => s.text);
    return textResult(matches.length > 0
      ? matches.join("\n\n")
      : "Try: 'flex center', 'grid 3 cols', 'spacing scale', 'typography', 'container', 'responsive'");
  },
};
