// Tool: webstudio_bind_page_field
// Bind a page field (title, meta.*) to a JS expression that may reference variables.

import { z } from "zod";
import { BindingSchema } from "../lib/zod-binding.js";
import { customAlphabet } from "nanoid";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type { WebstudioBuild, BuildPatchTransaction } from "../webstudio-client.js";
import { bindingToExpression, lintBinding, type Binding } from "../expressions.js";
import { logCoerce } from "../lib/telemetry.js";

const txId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);

const BINDABLE_FIELDS = [
  "title",
  "meta.description",
  "meta.language",
  "meta.redirect",
  "meta.socialImageUrl",
  "meta.excludePageFromSearch",
] as const;


export const bindPageFieldInputSchema = z.object({
  projectSlug: z.string(),
  pageId: z.string(),
  field: z.enum(BINDABLE_FIELDS),
  binding: BindingSchema,
  dryRun: z.boolean().default(false),
}).strict();

function fieldPath(pageId: string, field: typeof BINDABLE_FIELDS[number]): Array<string | number> {
  if (field === "title") return ["pages", pageId, "title"];
  // meta.<x> → ["pages", pageId, "meta", "<x>"]
  const metaField = field.slice("meta.".length);
  return ["pages", pageId, "meta", metaField];
}

function buildBindTransaction(pageId: string, field: typeof BINDABLE_FIELDS[number], expression: string): BuildPatchTransaction {
  return {
    id: `mcp-bind-${txId()}`,
    payload: [{
      namespace: "pages",
      patches: [{ op: "replace", path: fieldPath(pageId, field), value: expression }],
    }],
  };
}

function validateDataSourceRefs(build: WebstudioBuild, binding: Binding): string | null {
  const ids: string[] = [];
  if (binding.kind === "variable") ids.push(binding.dataSourceId);
  if (binding.kind === "template") {
    for (const p of binding.parts) if (p.type === "variable") ids.push(p.dataSourceId);
  }
  if (ids.length === 0) return null;
  const dataSources = (build as unknown as { dataSources: Array<{ id: string }> }).dataSources ?? [];
  const knownIds = new Set(dataSources.map((d) => d.id));
  const missing = ids.filter((id) => !knownIds.has(id));
  if (missing.length > 0) return `dataSourceId(s) not found in build: ${missing.join(", ")}`;
  return null;
}

export const bindPageFieldTool: ToolModule = {
  definition: {
    name: "webstudio_bind_page_field",
    description: `Use when: bind a page-level field (title, meta.description, meta.language, meta.socialImageUrl, etc.) to a dynamic expression — typically for SSR pages where SEO meta depends on the resource response.
Do NOT use when: you need to bind an INSTANCE prop (alt, src, href, text) to a dynamic value — use webstudio_instance_prop instead. This tool is page-level only.
Returns: { expression, version } — the resolved expression string is shown in builder Page Settings.
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=false by default. Bindable fields: ${BINDABLE_FIELDS.join(", ")}.

Example: { projectSlug: "my-site", pageId: "pageXyz", field: "title", binding: { kind: "template", parts: [{type:"text",value:"Product "},{type:"variable",dataSourceId:"resDsId",path:["data","name"]}] } }
Example: { projectSlug: "acme", pageId: "p1", field: "meta.description", binding: { kind: "variable", dataSourceId: "<resourceDsId>", path: ["data","description"] } }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        pageId: { type: "string" },
        field: { type: "string", enum: [...BINDABLE_FIELDS] },
        binding: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["variable", "template", "raw"] },
            dataSourceId: { type: "string" },
            parts: { type: "array" },
            expression: { type: "string" },
          },
          required: ["kind"],
        },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug", "pageId", "field", "binding"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  handler: async (args) => {
    const parsed = bindPageFieldInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const { projectSlug, pageId, field, binding, dryRun } = parsed.data;

    // Lint a hand-written `raw` expression against Webstudio's allowlist (see lib/lint-expression).
    const lint = lintBinding(binding);
    if (lint?.severity === "error") return errorResult("EXPRESSION_INVALID", lint.message, lint.hint);
    if (lint?.severity === "warning") {
      void logCoerce(lint.telemetryKey, {
        source: "pages.bind_field",
        projectSlug,
        pageId,
        field,
        violations: lint.violations.map((v) => `${v.type}:${v.detail}`),
      });
    }
    const lintNote = lint?.severity === "warning" ? `\n\n⚠️  ${lint.hint}` : "";

    let auth;
    try {
      auth = dryRun ? requireAuth(projectSlug) : requirePushAuth(projectSlug);
    } catch (err) { return authErrorResult(err); }

    let build: WebstudioBuild;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    if (!build.pages.pages.find((p) => p.id === pageId)) {
      return errorResult("PAGE_NOT_FOUND", `Page "${pageId}" not found`);
    }

    const refError = validateDataSourceRefs(build, binding);
    if (refError) return errorResult("VARIABLE_NOT_FOUND", refError);

    const expression = bindingToExpression(binding);
    const transaction = buildBindTransaction(pageId, field, expression);
    const projectTitle = build.project?.title ?? "(?)";

    if (dryRun) {
      return textResult(`DRY-RUN bind_page_field
Project: ${projectTitle}
Page: ${pageId}
Field: ${field}
Resolved expression: ${expression}
build version: ${build.version}${lintNote}`);
    }

    try {
      const { result, finalVersion } = await pushWithRetry(auth, () => transaction);
      return textResult(`${field} bound in "${projectTitle}"
  page: ${pageId}
  expression: ${expression}
  build version → ${finalVersion}
  status: ${result.status}

Reload the builder tab to see the binding appear in Page Settings.${lintNote}`);
    } catch (err) {
      return runtimeErrorResult(err, "Push failed");
    }
  },
};
