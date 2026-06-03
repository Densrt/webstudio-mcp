// Tool: webstudio_create_resource — create an SSR HTTP resource + its bindable dataSource.

import { z } from "zod";
import { customAlphabet } from "nanoid";
import type { ToolModule } from "../types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "../types.js";
import { requireAuth, requirePushAuth } from "../../auth.js";
import { fetchBuild, pushWithRetry } from "../../webstudio-client.js";
import type { WebstudioBuild, BuildPatchTransaction } from "../../webstudio-client.js";
import { encodeExpressionRefs } from "../../utils/expression-encoding.js";

const wsId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);
const txId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);

const NameValueSchema = z.object({
  name: z.string(),
  value: z.string(),
  mode: z.enum(["literal", "expression"]).default("literal"),
}).strict();

// Expression mode → raw JS string sent as-is. Auto-encode dataSourceId refs
// (`-` → `__DASH__`) so users can pass raw ids without the Webstudio renderer
// silently dropping the binding. Idempotent — see utils/expression-encoding.ts.
const encode = (v: { value: string; mode: "literal" | "expression" }): string =>
  v.mode === "literal" ? JSON.stringify(v.value) : encodeExpressionRefs(v.value);

export const createResourceInputSchema = z.object({
  projectSlug: z.string(),
  scopeInstanceId: z.string().describe("Instance scope for the dataSource (page rootInstanceId for a 'page resource')"),
  name: z.string().describe("Name of the resource AND the dataSource (visible in the panel)"),
  url: z.string().describe("Literal URL (auto-stringified as expression). For dynamic URLs, use urlExpression"),
  urlExpression: z.string().optional().describe("URL as a raw expression (e.g. '\"https://api.com/\" + system.params.slug')"),
  method: z.enum(["get", "post", "put", "delete"]).default("get"),
  searchParams: z.array(NameValueSchema).default([]).describe("Query string params. Each value supports mode:'literal' (JSON-encoded) or 'expression' (raw Webstudio expr)."),
  headers: z.array(NameValueSchema).default([]).describe("Headers. Each value supports mode:'literal' (JSON-encoded) or 'expression' (raw Webstudio expr, e.g. $ws$dataSource$<varId>)."),
  body: z.string().optional().describe("Literal body (auto-stringified)"),
  bodyExpression: z.string().optional().describe("Body as a raw expression"),
  cacheMaxAge: z.number().int().min(0).default(3600).describe("Default SSR cache TTL in seconds — injected as request header 'Cache-Control: max-age=N'. Set to 0 to disable. Ignored if user already provides a Cache-Control header."),
  dryRun: z.boolean().default(false),
}).strict();

type CreateResourceInput = z.infer<typeof createResourceInputSchema>;

function buildCreateResourceTransaction(
  resourceId: string,
  dataSourceId: string,
  input: CreateResourceInput,
): BuildPatchTransaction {
  // Fields marked "expression" = string-encoded JS expressions. Literal value → JSON.stringify;
  // raw expression → use as-is.
  const urlExpr = input.urlExpression !== undefined
    ? encodeExpressionRefs(input.urlExpression)
    : JSON.stringify(input.url);
  const userHeaders = input.headers.map((h) => ({ name: h.name, value: encode(h) }));
  const hasCacheControl = userHeaders.some((h) => h.name.toLowerCase() === "cache-control");
  const headers =
    !hasCacheControl && input.cacheMaxAge > 0
      ? [...userHeaders, { name: "Cache-Control", value: JSON.stringify(`max-age=${input.cacheMaxAge}`) }]
      : userHeaders;
  const searchParams = input.searchParams.map((p) => ({ name: p.name, value: encode(p) }));
  let bodyExpr: string | undefined;
  if (input.bodyExpression !== undefined) bodyExpr = encodeExpressionRefs(input.bodyExpression);
  else if (input.body !== undefined) bodyExpr = JSON.stringify(input.body);

  const resource = {
    id: resourceId,
    name: input.name,
    method: input.method,
    url: urlExpr,
    ...(searchParams.length > 0 && { searchParams }),
    headers,
    ...(bodyExpr !== undefined && { body: bodyExpr }),
  };

  const dataSource = {
    type: "resource" as const,
    id: dataSourceId,
    scopeInstanceId: input.scopeInstanceId,
    name: input.name,
    resourceId,
  };

  return {
    id: `mcp-resource-${txId()}`,
    payload: [
      { namespace: "resources", patches: [{ op: "add", path: [resourceId], value: resource }] },
      { namespace: "dataSources", patches: [{ op: "add", path: [dataSourceId], value: dataSource }] },
    ],
  };
}

export const createResourceTool: ToolModule = {
  definition: {
    name: "webstudio_create_resource",
    description: `Use when: a page needs server-side data — dynamic product page from a REST API, WordPress headless content, GraphQL fetch. Creates an SSR HTTP call + bindable dataSource.
Do NOT use when: you need a simple in-page state value (email, flag, counter) — use webstudio_create_variable (no network round-trip). To update an existing resource's URL/headers, use webstudio_update_resource.
Returns: { resourceId, dataSourceId }. Response is wrapped { ok, status, statusText, data } — bindings to body MUST start with path ["data", ...].
Side effects: push to Webstudio Cloud (requires allowPush). Auto-injects Cache-Control: max-age=3600 (override via cacheMaxAge, 0 to disable).

Example: { projectSlug: "my-site", scopeInstanceId: "<pageRootId>", name: "motoData", url: "https://api.example.com/motos/123", method: "get" }
Example with searchParams: { projectSlug: "acme", scopeInstanceId: "<pageRootId>", name: "list", url: "https://api.example.com/list", searchParams: [{ name: "category", value: "17", mode: "literal" }] }
Example with expression header (dynamic auth): { projectSlug: "acme", scopeInstanceId: "<pageRootId>", name: "secured", url: "https://api.example.com", headers: [{ name: "x-api-key", value: "$ws$dataSource$PWknbbLQzZPU7GknHl__DASH__OV", mode: "expression" }] }
Example dynamic URL: { projectSlug: "acme", scopeInstanceId: "<pageRootId>", name: "product", urlExpression: "\"https://api.acme.com/p/\" + system.params.slug" }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        scopeInstanceId: { type: "string" },
        name: { type: "string" },
        url: { type: "string", description: "Literal URL (auto-stringified)" },
        urlExpression: { type: "string", description: "URL as a raw expression (overrides url)" },
        method: { type: "string", enum: ["get", "post", "put", "delete"] },
        searchParams: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              value: { type: "string" },
              mode: { type: "string", enum: ["literal", "expression"] },
            },
            required: ["name", "value"],
          },
        },
        headers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              value: { type: "string" },
              mode: { type: "string", enum: ["literal", "expression"] },
            },
            required: ["name", "value"],
          },
        },
        body: { type: "string" },
        bodyExpression: { type: "string" },
        cacheMaxAge: { type: "number", description: "SSR cache TTL in seconds (default 3600). 0 = no cache." },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug", "scopeInstanceId", "name", "url"],
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
    const parsed = createResourceInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const input = parsed.data;

    let auth;
    try { auth = input.dryRun ? requireAuth(input.projectSlug) : requirePushAuth(input.projectSlug); }
    catch (err) { return authErrorResult(err); }

    let build: WebstudioBuild;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    // ":root" is a special Webstudio pseudo-scope meaning "site-global" — not an actual instance id.
    if (input.scopeInstanceId !== ":root" && !build.instances.find((i) => i.id === input.scopeInstanceId)) {
      return errorResult("INSTANCE_NOT_FOUND", `Instance "${input.scopeInstanceId}" not found`);
    }

    const resourceId = wsId();
    const dataSourceId = wsId();
    const projectTitle = build.project?.title ?? "(?)";

    if (input.dryRun) {
      return textResult(`DRY-RUN create_resource
Project: ${projectTitle}
Resource: "${input.name}" (${input.method.toUpperCase()})
  url-expr: ${input.urlExpression ?? JSON.stringify(input.url)}
  searchParams: ${input.searchParams.length}
  headers: ${input.headers.length}${
    !input.headers.some((h) => h.name.toLowerCase() === "cache-control") && input.cacheMaxAge > 0
      ? ` (+ auto Cache-Control: max-age=${input.cacheMaxAge})`
      : ""
  }
  body: ${input.bodyExpression ?? input.body ?? "(none)"}
scope: ${input.scopeInstanceId}
resourceId (generated): ${resourceId}
dataSourceId (generated): ${dataSourceId}`);
    }

    try {
      const { result, finalVersion } = await pushWithRetry(auth, () =>
        buildCreateResourceTransaction(resourceId, dataSourceId, input),
      );
      return textResult(`Resource "${input.name}" created in "${projectTitle}"
  resourceId: ${resourceId}
  dataSourceId: ${dataSourceId}
  scope: ${input.scopeInstanceId}
  build version → ${finalVersion}
  status: ${result.status}

To bind a field to the response body: webstudio_bind_page_field
   binding={kind:"variable", dataSourceId:"${dataSourceId}", path:["data","field","name"]}
The path starts with "data" because the response is wrapped in { ok, status, statusText, data }.`);
    } catch (err) {
      return runtimeErrorResult(err, "Push failed");
    }
  },
};
