// Tool: webstudio_create_resource — create an SSR HTTP resource + its bindable dataSource.

import { z } from "zod";
import { customAlphabet } from "nanoid";
import type { ToolModule } from "../types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "../types.js";
import { requireAuth, requirePushAuth } from "../../auth.js";
import { fetchBuild, pushWithRetry } from "../../webstudio-client.js";
import type { WebstudioBuild, BuildPatchTransaction } from "../../webstudio-client.js";
import { encodeExpressionRefs } from "../../utils/expression-encoding.js";
import { logCoerce } from "../../lib/telemetry.js";

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
  scopeInstanceId: z.string().optional().describe("Instance scope for the dataSource (page rootInstanceId for a 'page resource'). REQUIRED when the resource is exposed as a dataSource (GET default); omit for form actions."),
  name: z.string().describe("Name of the resource (and of the dataSource when exposed)"),
  url: z.string().describe("Literal URL (auto-stringified as expression). For dynamic URLs, use urlExpression"),
  urlExpression: z.string().optional().describe("URL as a raw expression (e.g. '\"https://api.com/\" + system.params.slug')"),
  method: z.enum(["get", "post", "put", "delete"]).default("get"),
  searchParams: z.array(NameValueSchema).default([]).describe("Query string params. Each value supports mode:'literal' (JSON-encoded) or 'expression' (raw Webstudio expr)."),
  headers: z.array(NameValueSchema).default([]).describe("Headers. Each value supports mode:'literal' (JSON-encoded) or 'expression' (raw Webstudio expr, e.g. $ws$dataSource$<varId>)."),
  body: z.string().optional().describe("Literal body (auto-stringified)"),
  bodyExpression: z.string().optional().describe("Body as a raw expression"),
  cacheMaxAge: z.number().int().min(0).optional().describe("SSR cache TTL in seconds, injected as 'Cache-Control: max-age=N'. Default: 3600 for GET, 0 (no header) for POST/PUT/DELETE. Ignored if you provide a Cache-Control header."),
  exposeAsDataSource: z.boolean().optional().describe("Create the bindable dataSource alongside the resource. Default: true for GET (SSR data fetch), FALSE for POST/PUT/DELETE — a dataSource is FETCHED ON EVERY RENDER of its scope, so exposing a mutation fires it on page load (cas réel: empty webhook POSTs, 2026-06-10). Form actions need NO dataSource."),
  dryRun: z.boolean().default(false),
}).strict();

type CreateResourceInput = z.infer<typeof createResourceInputSchema>;

export type ResolvedCreateOptions = {
  /** Resolved: create the bindable dataSource (default method==="get"). */
  expose: boolean;
  /** Resolved Cache-Control TTL (default 3600 for GET, 0 otherwise). */
  cacheMaxAge: number;
};

/** Method-aware defaults (v2.20.0 — see pattern form-action-resource). */
export function resolveCreateOptions(input: Pick<CreateResourceInput, "method" | "exposeAsDataSource" | "cacheMaxAge">): ResolvedCreateOptions {
  const isGet = input.method === "get";
  return {
    expose: input.exposeAsDataSource ?? isGet,
    cacheMaxAge: input.cacheMaxAge ?? (isGet ? 3600 : 0),
  };
}

export function buildCreateResourceTransaction(
  resourceId: string,
  dataSourceId: string,
  input: CreateResourceInput,
  resolved: ResolvedCreateOptions,
): BuildPatchTransaction {
  // Fields marked "expression" = string-encoded JS expressions. Literal value → JSON.stringify;
  // raw expression → use as-is.
  const urlExpr = input.urlExpression !== undefined
    ? encodeExpressionRefs(input.urlExpression)
    : JSON.stringify(input.url);
  const userHeaders = input.headers.map((h) => ({ name: h.name, value: encode(h) }));
  const hasCacheControl = userHeaders.some((h) => h.name.toLowerCase() === "cache-control");
  const headers =
    !hasCacheControl && resolved.cacheMaxAge > 0
      ? [...userHeaders, { name: "Cache-Control", value: JSON.stringify(`max-age=${resolved.cacheMaxAge}`) }]
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

  const payload: BuildPatchTransaction["payload"] = [
    { namespace: "resources", patches: [{ op: "add", path: [resourceId], value: resource }] },
  ];

  // A dataSource of type "resource" is fetched on EVERY render of its scope —
  // only created when the resource is a data fetch, never for form actions.
  if (resolved.expose) {
    const dataSource = {
      type: "resource" as const,
      id: dataSourceId,
      scopeInstanceId: input.scopeInstanceId,
      name: input.name,
      resourceId,
    };
    payload.push({ namespace: "dataSources", patches: [{ op: "add", path: [dataSourceId], value: dataSource }] });
  }

  return { id: `mcp-resource-${txId()}`, payload };
}

export const createResourceTool: ToolModule = {
  definition: {
    name: "webstudio_create_resource",
    description: `Use when: a page needs server-side data (GET — creates the SSR fetch + bindable dataSource) OR a Form needs a submit action (POST — creates the resource ALONE, then bind it via the Form's action prop).
Do NOT use when: you need a simple in-page state value (email, flag, counter) — use webstudio_create_variable (no network round-trip). To update an existing resource's URL/headers, use webstudio_update_resource.
Returns: { resourceId, dataSourceId? }. GET response is wrapped { ok, status, statusText, data } — bindings to body MUST start with path ["data", ...].
Side effects: push to Webstudio Cloud (requires allowPush). Method-aware defaults (v2.20.0): GET → dataSource created (scopeInstanceId REQUIRED) + Cache-Control max-age=3600; POST/PUT/DELETE → NO dataSource and NO cache header (a dataSource is fetched on EVERY render of its scope — exposing a mutation fires it on page load; cas réel: empty webhook POSTs on a live form, 2026-06-10). Override via exposeAsDataSource / cacheMaxAge.

Example (data fetch): { projectSlug: "my-site", scopeInstanceId: "<pageRootId>", name: "motoData", url: "https://api.example.com/motos/123", method: "get" }
Example (FORM ACTION — no dataSource): { projectSlug: "my-site", name: "action", method: "post", url: "$ws$dataSource$<webhookVarId>", urlExpression: "$ws$dataSource$<webhookVarId>" } then bind: instances.prop_update { instanceId: "<formId>", name: "action", type: "resource", value: "<resourceId>" }
Example with expression header (dynamic auth): { projectSlug: "acme", scopeInstanceId: "<pageRootId>", name: "secured", url: "https://api.example.com", headers: [{ name: "x-api-key", value: "$ws$dataSource$PWknbbLQzZPU7GknHl__DASH__OV", mode: "expression" }] }
[PATTERN] form-action-resource — the faulty vs healthy form action, and why a POST dataSource fires on every page render.`,
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
        cacheMaxAge: { type: "number", description: "SSR cache TTL in seconds. Default: 3600 for GET, 0 for POST/PUT/DELETE." },
        exposeAsDataSource: { type: "boolean", description: "Create the bindable dataSource. Default: true for GET, false for POST/PUT/DELETE (form actions need none — a dataSource fires on every render)." },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug", "name", "url"],
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
    const resolved = resolveCreateOptions(input);

    if (resolved.expose && !input.scopeInstanceId) {
      return errorResult(
        "VALIDATION_FAILED",
        `scopeInstanceId is required when the resource is exposed as a dataSource (GET default / exposeAsDataSource:true). ` +
          `For a form action (no dataSource), omit scopeInstanceId — the default for ${input.method.toUpperCase()} already skips the dataSource.`,
      );
    }

    // Forcing a dataSource on a mutation = it fires on EVERY render of its
    // scope (cas réel: empty webhook POSTs, 2026-06-10). Allowed but loud.
    let mutationWarning = "";
    if (resolved.expose && input.method !== "get") {
      void logCoerce("detect:resource-mutation-datasource", {
        source: "resources.create",
        projectSlug: input.projectSlug,
        method: input.method,
      });
      mutationWarning = `\n\n⚠ exposeAsDataSource:true on a ${input.method.toUpperCase()} — this resource will FIRE ON EVERY RENDER of its scope (empty-body calls on page load). If this is a form action, drop exposeAsDataSource and bind the Form's action prop instead (pattern form-action-resource).`;
    }

    let auth;
    try { auth = input.dryRun ? requireAuth(input.projectSlug) : requirePushAuth(input.projectSlug); }
    catch (err) { return authErrorResult(err); }

    let build: WebstudioBuild;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    // ":root" is a special Webstudio pseudo-scope meaning "site-global" — not an actual instance id.
    if (resolved.expose && input.scopeInstanceId !== ":root" && !build.instances.find((i) => i.id === input.scopeInstanceId)) {
      return errorResult("INSTANCE_NOT_FOUND", `Instance "${input.scopeInstanceId}" not found`);
    }

    const resourceId = wsId();
    const dataSourceId = wsId();
    const projectTitle = build.project?.title ?? "(?)";
    const dsSummary = resolved.expose
      ? `dataSourceId (generated): ${dataSourceId}\nscope: ${input.scopeInstanceId}`
      : `dataSource: (none — the resource is standalone; bind it via a prop type:"resource", e.g. a Form's action)`;

    if (input.dryRun) {
      return textResult(`DRY-RUN create_resource
Project: ${projectTitle}
Resource: "${input.name}" (${input.method.toUpperCase()})
  url-expr: ${input.urlExpression ?? JSON.stringify(input.url)}
  searchParams: ${input.searchParams.length}
  headers: ${input.headers.length}${
    !input.headers.some((h) => h.name.toLowerCase() === "cache-control") && resolved.cacheMaxAge > 0
      ? ` (+ auto Cache-Control: max-age=${resolved.cacheMaxAge})`
      : ""
  }
  body: ${input.bodyExpression ?? input.body ?? "(none)"}
resourceId (generated): ${resourceId}
${dsSummary}${mutationWarning}`);
    }

    try {
      const { result, finalVersion } = await pushWithRetry(auth, () =>
        buildCreateResourceTransaction(resourceId, dataSourceId, input, resolved),
      );
      const nextStep = resolved.expose
        ? `To bind a field to the response body: webstudio_bind_page_field
   binding={kind:"variable", dataSourceId:"${dataSourceId}", path:["data","field","name"]}
The path starts with "data" because the response is wrapped in { ok, status, statusText, data }.`
        : `Form action next step: instances.prop_update { instanceId: "<formId>", name: "action", type: "resource", value: "${resourceId}" } (pattern form-action-resource).`;
      return textResult(`Resource "${input.name}" created in "${projectTitle}"
  resourceId: ${resourceId}
  ${dsSummary}
  build version → ${finalVersion}
  status: ${result.status}

${nextStep}${mutationWarning}`);
    } catch (err) {
      return runtimeErrorResult(err, "Push failed");
    }
  },
};
