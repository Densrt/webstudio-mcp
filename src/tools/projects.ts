// Tools: webstudio_init_project, list_projects, list_tokens, define_token

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult } from "./types.js";
import { initProject, loadProject, listProjects, listTokens, defineToken } from "../projects.js";
import { StyleValueSchema } from "../build-from-args.js";
import type { StyleValue } from "../types.js";

export const initProjectInputSchema = z.object({
  projectSlug: z.string(),
  projectName: z.string(),
  webstudioProjectId: z.string().optional(),
  figmaFileKey: z.string().optional(),
}).strict();

export const defineTokenInputSchema = z.object({
  projectSlug: z.string(),
  tokenSlug: z.string(),
  name: z.string(),
  styles: z.record(z.string(), StyleValueSchema),
}).strict();

export const listTokensInputSchema = z.object({ projectSlug: z.string() }).strict();

/** list_projects atomic takes no args — empty strict object for the Zod builder. */
export const listProjectsInputSchema = z.object({}).strict();

export const initProjectTool: ToolModule = {
  definition: {
    name: "webstudio_init_project",
    description: `Use when: onboard a new project locally — first step BEFORE webstudio_setup_auth. Creates projects/{slug}/tokens.json + project config (projectName, optional webstudioProjectId, figmaFileKey).
Do NOT use when: project already exists locally — this is idempotent but does not re-init existing files. To wipe a cloud project, use webstudio_nuke_project. For brand tokens scaffolding, use webstudio_init_brand_tokens (toolset A).
Returns: { projectSlug, projectName, tokenCount }.
Side effects: local mutation only (no push) — creates projects/{slug}/ directory.

Example: { projectSlug: "my-site", projectName: "a production site", webstudioProjectId: "xxxx-xxxx", figmaFileKey: "abc123" }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        projectName: { type: "string" },
        webstudioProjectId: { type: "string" },
        figmaFileKey: { type: "string" },
      },
      required: ["projectSlug", "projectName"],
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
    const parsed = initProjectInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const { projectSlug, projectName, webstudioProjectId, figmaFileKey } = parsed.data;
    const cfg = initProject(projectSlug, projectName, { webstudioProjectId, figmaFileKey });
    return textResult(`Project "${projectName}" (slug: ${projectSlug}) initialized.\nTokens: ${Object.keys(cfg.tokens).length}`);
  },
};

export const listProjectsTool: ToolModule = {
  definition: {
    name: "webstudio_list_projects",
    description: `Use when: list all locally-configured project slugs — find which projects are available, verify a slug before setup_auth.
Do NOT use when: you want cloud-side tokens/instances — that requires webstudio_list_tokens_cloud / webstudio_list_instances + a valid auth.
Returns: array of { slug, projectName, tokenCount }.
Side effects: none (read-only).

Example: { }`,
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      title: "List configured Webstudio projects",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  handler: async () => {
    const slugs = listProjects();
    if (slugs.length === 0) return textResult("No projects. Run webstudio_init_project.");
    const lines = slugs.map((slug) => {
      const cfg = loadProject(slug);
      return `- ${slug} (${cfg?.projectName ?? "?"}) — ${Object.keys(cfg?.tokens ?? {}).length} token(s)`;
    });
    return textResult(`Projects:\n${lines.join("\n")}`);
  },
};

export const listTokensTool: ToolModule = {
  definition: {
    name: "webstudio_list_tokens",
    description: `Use when: list a project's LOCAL staged tokens (projects/{slug}/tokens.json) — what's about to be pushed as part of a fragment build.
Do NOT use when: you want tokens already pushed to the cloud project — use webstudio_list_tokens_cloud. Local staging vs cloud inventory.
Returns: array of { slug, name, properties[] } from local tokens.json.
Side effects: none (read-only).

Example: { projectSlug: "my-site" }`,
    inputSchema: {
      type: "object",
      properties: { projectSlug: { type: "string" } },
      required: ["projectSlug"],
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
    const parsed = listTokensInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const project = loadProject(parsed.data.projectSlug);
    if (!project) return errorResult("PROJECT_NOT_FOUND", `Project "${parsed.data.projectSlug}" not found.`);
    const tokens = listTokens(parsed.data.projectSlug);
    if (tokens.length === 0) return textResult(`Project "${parsed.data.projectSlug}": no tokens.`);
    const lines = tokens.map((t) => `- ${t.slug} → "${t.name}" [${t.properties.join(", ")}]`);
    return textResult(`Tokens "${project.projectName}" (${tokens.length}):\n${lines.join("\n")}`);
  },
};

export const defineTokenTool: ToolModule = {
  definition: {
    name: "webstudio_define_token",
    description: `Use when: stage a single design token LOCALLY (projects/{slug}/tokens.json) before a fragment build — local-only, not pushed.
Do NOT use when: you want to push tokens directly to Webstudio Cloud — use webstudio_create_tokens (toolset A, direct cloud push). To update an existing cloud token's styles, use webstudio_update_token_styles.
Returns: { id, slug, name, properties } — stable ID auto-generated on first call (deterministic).
Side effects: local mutation only (no push) — writes to projects/{slug}/tokens.json.

Example: { projectSlug: "my-site", tokenSlug: "btn-primary", name: "Button Primary", styles: { backgroundColor: { type: "rgb", r: 130, g: 187, b: 37, alpha: 1 } } }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        tokenSlug: { type: "string" },
        name: { type: "string" },
        styles: { type: "object" },
      },
      required: ["projectSlug", "tokenSlug", "name", "styles"],
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
    const parsed = defineTokenInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    try {
      const def = defineToken(
        parsed.data.projectSlug,
        parsed.data.tokenSlug,
        parsed.data.name,
        parsed.data.styles as Record<string, StyleValue>,
      );
      return textResult(`Token "${parsed.data.name}" (slug: ${parsed.data.tokenSlug}) defined.\nID: ${def.id}\nProperties: ${Object.keys(def.styles).join(", ")}`);
    } catch (err) {
      return errorResult("INTERNAL_ERROR", `Error: ${(err as Error).message}`);
    }
  },
};
