// Tool: webstudio_list_resources — list project resources + their dataSources.

import { z } from "zod";
import type { ToolModule } from "../types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "../types.js";
import { requireAuth } from "../../auth.js";
import { fetchBuild } from "../../webstudio-client.js";
import type { WebstudioBuild } from "../../webstudio-client.js";

export const listResourcesInputSchema = z.object({ projectSlug: z.string() }).strict();

export const listResourcesTool: ToolModule = {
  definition: {
    name: "webstudio_list_resources",
    description: `Use when: list a project's HTTP resources with URL + attached dataSource — discover resource IDs before update/delete/bind, or audit endpoints in use.
Do NOT use when: you want in-page variables — use webstudio_list_variables. To execute a resource and inspect its response shape, use webstudio_inspect(target:"resource").
Returns: array of { id, name, method, url, dataSourceId, scopeInstanceId } — orphan resources (no linked dataSource) appear with dataSourceId="(none)".
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
      openWorldHint: true,
    },
  },
  handler: async (args) => {
    const parsed = listResourcesInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);

    let auth;
    try { auth = requireAuth(parsed.data.projectSlug); }
    catch (err) { return authErrorResult(err); }

    let build: WebstudioBuild;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    type ResourceShape = {
      id: string;
      name: string;
      method: string;
      url: string;
      searchParams?: Array<{ name: string; value?: string }>;
      headers?: Array<{ name: string; value?: string }>;
      body?: string;
    };
    const resources = (build as unknown as { resources: ResourceShape[] }).resources ?? [];
    const dataSources = (build as unknown as { dataSources: Array<{ id: string; type: string; resourceId?: string; scopeInstanceId?: string }> }).dataSources ?? [];

    if (resources.length === 0) return textResult("No resources.");

    // Surface attached searchParams / headers names so callers don't need a
    // follow-up `inspect` to discover available filters.
    const lines = resources.map((r) => {
      const ds = dataSources.find((d) => d.type === "resource" && d.resourceId === r.id);
      const spNames = (r.searchParams ?? []).map((p) => p.name).filter(Boolean);
      const hdrNames = (r.headers ?? []).map((h) => h.name).filter(Boolean);
      const extras: string[] = [];
      if (spNames.length > 0) extras.push(`searchParams: [${spNames.join(", ")}]`);
      if (hdrNames.length > 0) extras.push(`headers: [${hdrNames.join(", ")}]`);
      if (r.body) extras.push(`body: ${r.body.length} chars`);
      const extrasLine = extras.length > 0 ? `\n    ${extras.join("\n    ")}` : "";
      return `- "${r.name}" (${r.method.toUpperCase()})\n    url-expr: ${r.url}\n    resourceId: ${r.id}\n    dataSourceId: ${ds?.id ?? "(none)"}\n    scope: ${ds?.scopeInstanceId ?? "(none)"}${extrasLine}`;
    });
    return textResult(`Resources (${resources.length}):\n${lines.join("\n")}`);
  },
};
