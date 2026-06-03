// Tool: webstudio_update_resource — modify an existing project resource (URL, searchParams, headers).
// Useful to rebrand webhook endpoints, tweak headers (auth tokens, cache-control), or repoint a
// resource to a different backend without recreating it.
//
// Storage convention (handled by build-patches.ts): literal values are JSON-encoded ("http://x"
// stored as `"http://x"`), expressions are stored raw (e.g. `system.params.slug`).

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type { WebstudioBuild } from "../webstudio-client.js";
import { buildUpdateResourceTransaction } from "./update-resource/build-patches.js";

const NameValueSchema = z.object({
  name: z.string(),
  value: z.string(),
  mode: z.enum(["literal", "expression"]).default("literal"),
}).strict();

export const updateResourceInputSchema = z.object({
  projectSlug: z.string(),
  resourceId: z.string().optional(),
  resourceName: z.string().optional(),
  url: z
    .object({
      value: z.string(),
      mode: z.enum(["literal", "expression"]).default("literal"),
    })
    .optional(),
  method: z.enum(["get", "post", "put", "patch", "delete"]).optional(),
  searchParams: z.array(NameValueSchema).optional(),
  headers: z.array(NameValueSchema).optional(),
  body: z
    .object({
      value: z.string(),
      mode: z.enum(["literal", "expression"]).default("literal"),
    })
    .optional(),
  dryRun: z.boolean().default(true),
}).strict();

export const updateResourceTool: ToolModule = {
  definition: {
    name: "webstudio_update_resource",
    description: `Use when: change an existing resource's URL, method, searchParams, headers or body — rebrand a webhook endpoint, rotate an auth token header, repoint to a new backend, tweak cache-control.
Do NOT use when: you want to change a variable's value (email, flag) — use webstudio_update_variable. To create a new resource, use webstudio_create_resource.
Returns: { details, version }. Each value supports mode:"literal" (JSON-encoded) or "expression" (raw Webstudio expr). searchParams/headers REPLACE the array entirely.
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default. Idempotent.

Example: { projectSlug: "my-site", resourceName: "motoData", url: { value: "https://api-v2.example.com/motos", mode: "literal" } }
Example: { projectSlug: "acme", resourceId: "abc123", headers: [{ name: "Authorization", value: "Bearer xyz", mode: "literal" }] }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        resourceId: { type: "string" },
        resourceName: { type: "string" },
        url: {
          type: "object",
          properties: {
            value: { type: "string" },
            mode: { type: "string", enum: ["literal", "expression"] },
          },
          required: ["value"],
        },
        method: { type: "string", enum: ["get", "post", "put", "patch", "delete"] },
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
        body: {
          type: "object",
          properties: {
            value: { type: "string" },
            mode: { type: "string", enum: ["literal", "expression"] },
          },
          required: ["value"],
        },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug"],
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
    const parsed = updateResourceInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const data = parsed.data;
    if (!data.resourceId && !data.resourceName) {
      return errorResult("VALIDATION_FAILED", "Provide resourceId or resourceName");
    }

    let auth;
    try {
      auth = data.dryRun ? requireAuth(data.projectSlug) : requirePushAuth(data.projectSlug);
    } catch (err) {
      return authErrorResult(err);
    }

    let build: WebstudioBuild;
    try {
      build = await fetchBuild(auth);
    } catch (err) {
      return runtimeErrorResult(err, "fetch build failed");
    }

    const tx = buildUpdateResourceTransaction(build, data);
    if (tx.patchCount === 0) {
      const isError = tx.details[0]?.startsWith("!") ?? false;
      if (isError) return errorResult("RESOURCE_NOT_FOUND", tx.details.join("\n"));
      return textResult(tx.details.join("\n"));
    }

    if (data.dryRun) {
      return textResult(
        `DRY-RUN update_resource\n\n${tx.details.join("\n")}\n\nIf OK, re-run with dryRun=false.`,
      );
    }

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) =>
        buildUpdateResourceTransaction(cur, data).transaction,
      );
      return textResult(
        `Resource updated — version → ${finalVersion}\nstatus: ${result.status}\n\n${tx.details.join("\n")}`,
      );
    } catch (err) {
      return runtimeErrorResult(err, "Update failed");
    }
  },
};
