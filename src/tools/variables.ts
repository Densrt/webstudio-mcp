// Tools: webstudio_create_variable, webstudio_list_variables

import { z } from "zod";
import { customAlphabet } from "nanoid";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type { WebstudioBuild, BuildPatchTransaction } from "../webstudio-client.js";

const wsId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);
const txId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);

const VarValueSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("string"), value: z.string() }),
  z.object({ type: z.literal("number"), value: z.number() }),
  z.object({ type: z.literal("boolean"), value: z.boolean() }),
  z.object({ type: z.literal("json"), value: z.unknown() }),
]);

export const createVariableInputSchema = z.object({
  projectSlug: z.string(),
  scopeInstanceId: z.string().describe("ID of the instance that defines the scope (page rootInstanceId for a page-global variable)"),
  name: z.string(),
  value: VarValueSchema,
  dryRun: z.boolean().default(false),
}).strict();

export const listVariablesInputSchema = z.object({
  projectSlug: z.string(),
  scopeInstanceId: z.string().optional().describe("Filter by scope (optional)"),
}).strict();

function buildCreateVariableTransaction(dataSourceId: string, input: z.infer<typeof createVariableInputSchema>): BuildPatchTransaction {
  return {
    id: `mcp-var-${txId()}`,
    payload: [{
      namespace: "dataSources",
      patches: [{
        op: "add",
        path: [dataSourceId],
        value: {
          id: dataSourceId,
          scopeInstanceId: input.scopeInstanceId,
          name: input.name,
          type: "variable",
          value: input.value,
        },
      }],
    }],
  };
}

export const createVariableTool: ToolModule = {
  definition: {
    name: "webstudio_create_variable",
    description: `Use when: create an in-page state variable (dataSource type="variable") — site config (email/phone), page-local state, or a value to bind to a prop/page field.
Do NOT use when: you need data from an HTTP endpoint — use webstudio_create_resource (returns wrapped {ok,status,data}). To update an existing variable, use webstudio_update_variable.
Returns: { dataSourceId } — pass to webstudio_bind_page_field or webstudio_instance_prop.
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=false by default.

Example: { projectSlug: "acme", scopeInstanceId: ":root", name: "contactEmail", value: { type: "string", value: "contact@acme.com" } }
Example: { projectSlug: "my-site", scopeInstanceId: "<pageRootId>", name: "showBanner", value: { type: "boolean", value: true } }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        scopeInstanceId: { type: "string" },
        name: { type: "string" },
        value: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["string", "number", "boolean", "json"] },
            value: {},
          },
          required: ["type", "value"],
        },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug", "scopeInstanceId", "name", "value"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  handler: async (args) => {
    const parsed = createVariableInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const { projectSlug, scopeInstanceId, name, dryRun } = parsed.data;

    let auth;
    try {
      auth = dryRun ? requireAuth(projectSlug) : requirePushAuth(projectSlug);
    } catch (err) { return authErrorResult(err); }

    let build: WebstudioBuild;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    // ":root" is a special Webstudio pseudo-scope meaning "site-global" — not an actual instance id.
    if (scopeInstanceId !== ":root" && !build.instances.find((i) => i.id === scopeInstanceId)) {
      return errorResult("INSTANCE_NOT_FOUND", `Instance "${scopeInstanceId}" not found in build`);
    }

    const dataSourceId = wsId();
    const projectTitle = build.project?.title ?? "(?)";

    if (dryRun) {
      return textResult(`DRY-RUN create_variable
Project: ${projectTitle}
Variable: "${name}" (type ${parsed.data.value.type})
scopeInstanceId: ${scopeInstanceId}
dataSourceId (generated): ${dataSourceId}`);
    }

    try {
      const { result, finalVersion } = await pushWithRetry(auth, () => buildCreateVariableTransaction(dataSourceId, parsed.data));
      return textResult(`Variable "${name}" created in "${projectTitle}"
  dataSourceId: ${dataSourceId}
  scope: ${scopeInstanceId}
  build version → ${finalVersion}
  status: ${result.status}

To bind a field: webstudio_bind_page_field with binding={kind:"variable", dataSourceId:"${dataSourceId}"}`);
    } catch (err) {
      return runtimeErrorResult(err, "Push failed");
    }
  },
};

export const listVariablesTool: ToolModule = {
  definition: {
    name: "webstudio_list_variables",
    description: `Use when: list a project's variables (dataSources type="variable") with their scope and current value — discover IDs before update/delete/bind.
Do NOT use when: you want HTTP resources — use webstudio_list_resources. For tokens, use webstudio_list_tokens_cloud.
Returns: array of { id, name, scopeInstanceId, value:{type,value} }. Filtered by scopeInstanceId if provided.
Side effects: none (read-only).

Example: { projectSlug: "acme" }
Example: { projectSlug: "acme", scopeInstanceId: ":root" }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        scopeInstanceId: { type: "string" },
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
    const parsed = listVariablesInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);

    let auth;
    try { auth = requireAuth(parsed.data.projectSlug); }
    catch (err) { return authErrorResult(err); }

    let build: WebstudioBuild;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    const dataSources = (build as unknown as { dataSources: Array<{ id: string; type: string; name: string; scopeInstanceId: string; value?: { type: string; value: unknown } }> }).dataSources ?? [];
    const variables = dataSources.filter((ds) => ds.type === "variable" && (!parsed.data.scopeInstanceId || ds.scopeInstanceId === parsed.data.scopeInstanceId));

    if (variables.length === 0) {
      return textResult(`No variables${parsed.data.scopeInstanceId ? ` for scope ${parsed.data.scopeInstanceId}` : ""}.`);
    }

    const lines = variables.map((v) => {
      const valueStr = v.value ? `${v.value.type}=${JSON.stringify(v.value.value)}` : "?";
      return `- "${v.name}" (${valueStr})\n    id: ${v.id}\n    scope: ${v.scopeInstanceId}`;
    });
    return textResult(`Variables (${variables.length}):\n${lines.join("\n")}`);
  },
};
