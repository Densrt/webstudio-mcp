// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HANDLER — dispatched via webstudio_inspect(target:"resource").
//
// As of v0.3.0 this file is NOT exposed as a standalone tool in the MCP manifest.
// It remains as a handler delegated to by src/tools/inspect.ts. Editing this file:
//   - The `description` field is irrelevant (the dispatcher's description wins).
//   - The `handler` is what runs when `inspect({target:"resource", ...})` is called.
//   - The Zod `Schema` still validates the dispatched args.
// To expose this back as a standalone tool: add `webstudio_<name>` to TOOLS in
// src/index.ts and add an entry in src/tools/index-tool-categories.ts.
// ─────────────────────────────────────────────────────────────────────────────
// Tool: webstudio_inspect_resource — execute a project resource and return a
// sample of its response. Useful before binding to plan field paths.

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth } from "../auth.js";
import { fetchBuild } from "../webstudio-client.js";
import type { WebstudioBuild } from "../webstudio-client.js";
import { inferTopLevelSchema } from "./inspect-resource/decode.js";
import { formatRawDefinition, resolveResourceCall, type Resource } from "./inspect-resource/resolve.js";

export const inspectResourceInputSchema = z.object({
  projectSlug: z.string(),
  resourceId: z.string().optional(),
  resourceName: z.string().optional(),
  searchParams: z.record(z.string(), z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  bodyMaxChars: z.number().int().positive().default(4000),
  raw: z.boolean().default(false),
}).strict().refine((d) => !!d.resourceId || !!d.resourceName, { message: "Provide resourceId or resourceName" });

export const inspectResourceTool: ToolModule = {
  definition: {
    name: "webstudio_inspect_resource",
    description: `Use when: before binding to a resource, you need to see its response shape and field paths.
Executes the resource (literal URL only) and returns resolved URL, status, body sample, and a
top-level schema. Pass searchParams/headers to override values bound to runtime expressions.
raw=true: skip the HTTP call and just dump the decoded resource definition.
Read-only.`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        resourceId: { type: "string" },
        resourceName: { type: "string" },
        searchParams: { type: "object", additionalProperties: { type: "string" } },
        headers: { type: "object", additionalProperties: { type: "string" } },
        bodyMaxChars: { type: "number" },
        raw: { type: "boolean", description: "Skip HTTP call, just dump the resource definition" },
      },
      required: ["projectSlug"],
      additionalProperties: false,
    },
  },
  handler: async (args) => {
    const parsed = inspectResourceInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const data = parsed.data;

    let auth;
    try { auth = requireAuth(data.projectSlug); }
    catch (err) { return authErrorResult(err); }

    let build: WebstudioBuild;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    const resources = (build as unknown as { resources?: Resource[] }).resources ?? [];
    const resource = resources.find((r) =>
      (data.resourceId && r.id === data.resourceId) ||
      (data.resourceName && r.name === data.resourceName),
    );
    if (!resource) {
      return errorResult(
        "RESOURCE_NOT_FOUND",
        `Resource not found. Looked for ${data.resourceId ? `id "${data.resourceId}"` : `name "${data.resourceName}"`}.\n\nAvailable resources:\n${resources.map((r) => `  - "${r.name}" [${r.id}]`).join("\n")}`,
      );
    }

    if (data.raw) {
      return textResult(formatRawDefinition(resource));
    }

    const resolved = resolveResourceCall(resource, { searchParams: data.searchParams, headers: data.headers });
    if ("error" in resolved) return errorResult("VALIDATION_FAILED", resolved.error);

    const { url, headers: reqHeaders, body, expressionParams, expressionHeaders } = resolved;

    const lines: string[] = [];
    const log = (s: string) => lines.push(s);

    log(`# Resource "${resource.name}" [${resource.id}]`);
    log(`Method: ${resource.method.toUpperCase()}`);
    log(`URL   : ${url.toString()}`);
    if (Object.keys(reqHeaders).length > 0) log(`Headers:\n${Object.entries(reqHeaders).map(([k, v]) => `  ${k}: ${v}`).join("\n")}`);
    if (body !== undefined) log(`Body  : ${body.slice(0, 300)}${body.length > 300 ? " …" : ""}`);
    if (expressionParams.length > 0) log(`\n⚠ Skipped searchParams bound to expressions (provide override):\n${expressionParams.map((x) => `  ${x}`).join("\n")}`);
    if (expressionHeaders.length > 0) log(`\n⚠ Skipped headers bound to expressions:\n${expressionHeaders.map((x) => `  ${x}`).join("\n")}`);

    log(`\n## Calling…`);
    let res;
    try {
      res = await fetch(url.toString(), {
        method: resource.method.toUpperCase(),
        headers: reqHeaders,
        ...(body && { body }),
      });
    } catch (err) {
      log(`✗ Network error: ${(err as Error).message}`);
      return textResult(lines.join("\n"));
    }

    log(`Status: ${res.status} ${res.statusText}`);
    log(`Content-Type: ${res.headers.get("content-type") ?? "(unknown)"}`);

    const bodyText = await res.text();
    const truncated = bodyText.length > data.bodyMaxChars
      ? bodyText.slice(0, data.bodyMaxChars) + `\n… (truncated, ${bodyText.length - data.bodyMaxChars} more chars)`
      : bodyText;
    log(`\n## Body sample`);
    log(truncated);

    try {
      const json = JSON.parse(bodyText);
      log(`\n## Schema (top-level)`);
      log(`Note: this is the raw response. In Webstudio bindings the body is wrapped: $ws$dataSource$<id>.data = <below>.`);
      log(`Use binding paths starting with "data" — e.g. data.${Object.keys(json as object)[0] ?? "..."}`);
      log(`\n${inferTopLevelSchema(json)}`);
    } catch {
      log(`\n(Not valid JSON — treated as raw text body)`);
    }

    return textResult(lines.join("\n"));
  },
};
