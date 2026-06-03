// Tool: webstudio_init_brand_tokens — initialize a complete brand kit (colors, fonts, spacings)
// in a single call instead of chaining define_token calls one by one.
//
// Generates stable per-project tokens: tok_<project>_color-primary, tok_<project>_spacing-md, etc.
// Reusable via useTokens inside fragments.

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult } from "./types.js";
import { defineToken, loadProject } from "../projects.js";
import type { StyleValue } from "../types.js";

export const initBrandTokensInputSchema = z.object({
  projectSlug: z.string(),
  /** Colors: slug → hex string map (e.g. { primary: "#E07B1A", secondary: "#1A1A1A" }). */
  colors: z.record(z.string(), z.string()).optional(),
  /** Spacings: slug → px map (e.g. { sm: 8, md: 16, lg: 24, xl: 48 }). */
  spacings: z.record(z.string(), z.number()).optional(),
  /** Font families: slug → font array map (e.g. { heading: ["Bebas Neue", "Arial"] }). */
  fonts: z.record(z.string(), z.array(z.string())).optional(),
  /** Font sizes: slug → rem map (e.g. { sm: 0.875, base: 1, lg: 1.25 }). */
  fontSizes: z.record(z.string(), z.number()).optional(),
  /** Border radius: slug → px map (e.g. { sm: 4, md: 8, lg: 16 }). */
  radii: z.record(z.string(), z.number()).optional(),
  /** If true, overwrite existing tokens with the same slug. Default false (skip). */
  overwrite: z.boolean().default(false),
}).strict();

function hexToColor(hex: string): StyleValue {
  let h = hex.startsWith("#") ? hex.slice(1) : hex;
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return { type: "color", colorSpace: "hex", components: [r, g, b], alpha: 1 };
}

export const initBrandTokensTool: ToolModule = {
  definition: {
    name: "webstudio_init_brand_tokens",
    description: `Use when: onboarding a new project — initialize a complete brand token kit (colors, spacings, fonts, fontSizes, radii) in one call instead of chaining define_token.
Do NOT use when: adding ONE token to an existing kit (use webstudio_define_token), batch-pushing tokens directly to the cloud (use webstudio_create_tokens — init_brand_tokens stages LOCAL only, then chain with webstudio_sync_local_tokens to materialize them in the Webstudio cloud), or restyling existing tokens (use webstudio_update_token_styles).
Returns: list of created vs skipped slugs with the useTokens snippet to apply them in fragments.
Side effects: local mutation only (writes projects/<slug>/tokens.json — no cloud push). overwrite=false by default skips existing slugs; pass true to replace.

Each entry generates a token with stable id tok_<project>_<family>-<slug>: colors as { color }, spacings as 4-sided padding, fonts as fontFamily, fontSizes as fontSize (rem), radii as 4-sided border-radius.

Example: { projectSlug: "acme", colors: { primary: "#E07B1A", secondary: "#1A1A1A" }, spacings: { sm: 8, md: 16, lg: 24 }, radii: { md: 8 } }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        colors: { type: "object" },
        spacings: { type: "object" },
        fonts: { type: "object" },
        fontSizes: { type: "object" },
        radii: { type: "object" },
        overwrite: { type: "boolean" },
      },
      required: ["projectSlug"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  handler: async (args) => {
    const parsed = initBrandTokensInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const { projectSlug, colors, spacings, fonts, fontSizes, radii, overwrite } = parsed.data;

    const project = loadProject(projectSlug);
    if (!project) return errorResult("PROJECT_NOT_FOUND", `Project "${projectSlug}" not initialized. Run webstudio_init_project first.`);

    const created: string[] = [];
    const skipped: string[] = [];

    const define = (slug: string, name: string, styles: Record<string, StyleValue>) => {
      if (!overwrite && project.tokens[slug]) {
        skipped.push(slug);
        return;
      }
      defineToken(projectSlug, slug, name, styles);
      created.push(slug);
    };

    // Colors: token with the `color` property (can also be applied to backgroundColor/borderColor).
    if (colors) {
      for (const [slug, hex] of Object.entries(colors)) {
        const tokenSlug = `color-${slug}`;
        define(tokenSlug, `Color ${slug}`, { color: hexToColor(hex) });
      }
    }

    // Spacings: stored as multi-side padding for flexible reuse.
    if (spacings) {
      for (const [slug, value] of Object.entries(spacings)) {
        const tokenSlug = `spacing-${slug}`;
        const v: StyleValue = { type: "unit", value, unit: "px" };
        define(tokenSlug, `Spacing ${slug}`, {
          paddingTop: v, paddingRight: v, paddingBottom: v, paddingLeft: v,
        });
      }
    }

    // Fonts: font-family token.
    if (fonts) {
      for (const [slug, family] of Object.entries(fonts)) {
        const tokenSlug = `font-${slug}`;
        define(tokenSlug, `Font ${slug}`, { fontFamily: { type: "fontFamily", value: family } });
      }
    }

    // Font sizes: fontSize token.
    if (fontSizes) {
      for (const [slug, value] of Object.entries(fontSizes)) {
        const tokenSlug = `text-${slug}`;
        define(tokenSlug, `Text ${slug}`, { fontSize: { type: "unit", value, unit: "rem" } });
      }
    }

    // Radii: border-radius (4 sides).
    if (radii) {
      for (const [slug, value] of Object.entries(radii)) {
        const tokenSlug = `radius-${slug}`;
        const v: StyleValue = { type: "unit", value, unit: "px" };
        define(tokenSlug, `Radius ${slug}`, {
          borderTopLeftRadius: v, borderTopRightRadius: v,
          borderBottomRightRadius: v, borderBottomLeftRadius: v,
        });
      }
    }

    return textResult(`Tokens initialized for "${projectSlug}".
  Created (${created.length}): ${created.join(", ") || "none"}
  ${skipped.length > 0 ? `Skipped (already existed): ${skipped.join(", ")} — pass overwrite=true to replace them.` : ""}

To use in a fragment:
  useTokens: [{ instanceId: "...", tokenSlug: "color-primary" }]`);
  },
};
