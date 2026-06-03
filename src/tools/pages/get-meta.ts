// Sub-tool: pages.get_meta — read project-level meta fields (head Custom Code,
// siteName, contactEmail, faviconAssetId, socialImageAssetId).
//
// Read-only — no auth-push required, no dryRun semantics.

import { z } from "zod";
import type { ToolModule } from "../types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "../types.js";
import { requireAuth } from "../../auth.js";
import { fetchBuild } from "../../webstudio-client.js";
import { logCoerce } from "../../lib/telemetry.js";
import { buildGetMetaResult, META_FIELDS, type MetaField } from "./meta.js";

const FieldEnum = z.enum(META_FIELDS);

export const getMetaInputSchema = z.object({
  projectSlug: z.string(),
  fields: z.array(FieldEnum).optional(),
}).strict();

export const getMetaTool: ToolModule = {
  definition: {
    name: "webstudio_get_project_meta",
    description: `Use when: read the project-level meta block — head Custom Code (GTM, Consent Mode, JSON-LD, preconnect…), siteName, contactEmail, faviconAssetId, socialImageAssetId. Typically used to audit a project's global settings or to copy them when initialising a sibling project.
Do NOT use when: reading per-page meta (title, description, OG image override) — use read.inspect on the page, or read.fetch_pages.
Returns: { meta: { code?, siteName?, contactEmail?, faviconAssetId?, socialImageAssetId? } }. Only set fields are present (sparse). Emits a hint when an asset id references a deleted asset.
Side effects: none (read-only).

Example: { projectSlug: "acme", fields: ["code", "siteName"] }
Example (all fields): { projectSlug: "acme" }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        fields: {
          type: "array",
          items: { type: "string", enum: [...META_FIELDS] },
          description: "Subset of meta fields to read. Default: all known fields.",
        },
      },
      required: ["projectSlug"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  handler: async (args) => {
    const parsed = getMetaInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const { projectSlug, fields } = parsed.data;

    let auth;
    try { auth = requireAuth(projectSlug); }
    catch (err) { return authErrorResult(err); }

    let build;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    const result = buildGetMetaResult(build, fields as readonly MetaField[] | undefined);

    if (result.telemetryKey) {
      void logCoerce(result.telemetryKey, { source: "pages.get_meta", projectSlug });
    }

    const lines = [
      `Project meta — "${build.project?.title ?? projectSlug}" (build version ${build.version})`,
      "",
    ];
    if (Object.keys(result.meta).length === 0) {
      lines.push("(no meta fields set on this project)");
    } else {
      for (const f of META_FIELDS) {
        const v = result.meta[f];
        if (v === undefined) continue;
        const display = f === "code" && v.length > 200 ? `${v.slice(0, 200)}… (${v.length} chars total)` : v;
        lines.push(`  ${f}: ${JSON.stringify(display)}`);
      }
    }
    if (result.hint) {
      lines.push("", `[hint] ${result.hint}`);
    }

    return textResult(lines.join("\n"));
  },
};
