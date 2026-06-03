// Sub-tool: pages.update_meta — write project-level meta fields.
//
// `code` is a full replacement (single blob storage — agents that need
// "append a snippet" do read-modify-write via pages.get_meta + pages.update_meta).
// Asset id fields validate against build.assets; invalid email is rejected.
// Setting a field to `null` removes the key. Submitting values equal to current
// state is a no-op (no patch emitted).

import { z } from "zod";
import type { ToolModule } from "../types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "../types.js";
import { requireAuth, requirePushAuth } from "../../auth.js";
import { fetchBuild, pushWithRetry } from "../../webstudio-client.js";
import { logCoerce } from "../../lib/telemetry.js";
import { buildUpdateMetaTransaction, META_FIELDS } from "./meta.js";

const Nullable = z.union([z.string(), z.null()]);

export const updateMetaInputSchema = z.object({
  projectSlug: z.string(),
  meta: z.object({
    code: Nullable.optional(),
    siteName: Nullable.optional(),
    contactEmail: Nullable.optional(),
    faviconAssetId: Nullable.optional(),
    socialImageAssetId: Nullable.optional(),
  }).strict(),
  dryRun: z.boolean().default(true),
}).strict();

export const updateMetaTool: ToolModule = {
  definition: {
    name: "webstudio_update_project_meta",
    description: `Use when: write project-level meta — typically initialising a new project (GTM + Consent Mode + JSON-LD head Custom Code, siteName, contactEmail, favicon, social image) or syncing settings across cloned projects.
Do NOT use when: updating per-page meta (title, description, redirect, language) — use pages.update with updates.meta. Appending a snippet to existing head code: read-modify-write via pages.get_meta + pages.update_meta (no atomic append on the server — code is a single-blob field).
Returns: dry-run summary (per-field operation, applied count) OR push result with final build version + applied fields list. Passing null removes the key. Submitting values equal to current state emits no patch (idempotent).
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default — pass dryRun=false to apply.

Example: { projectSlug: "acme", meta: { code: "<script>gtag('config','G-XXX')</script>", siteName: "Acme" }, dryRun: false }
Example (clear favicon): { projectSlug: "acme", meta: { faviconAssetId: null } }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        meta: {
          type: "object",
          properties: {
            code: { type: ["string", "null"], description: "Head Custom Code blob (GTM, Consent Mode, JSON-LD…). Full replacement — there is no server-side append." },
            siteName: { type: ["string", "null"] },
            contactEmail: { type: ["string", "null"], description: "Validated as RFC-lite email when non-empty." },
            faviconAssetId: { type: ["string", "null"], description: "Asset sha256 — must exist in the project. Use assets.list to find ids." },
            socialImageAssetId: { type: ["string", "null"], description: "Asset sha256 — must exist in the project. Used as default OG image when no per-page override is set." },
          },
          additionalProperties: false,
        },
        dryRun: { type: "boolean", description: "Default true. Pass false to push." },
      },
      required: ["projectSlug", "meta"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  handler: async (args) => {
    const parsed = updateMetaInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const { projectSlug, meta, dryRun } = parsed.data;

    let auth;
    try {
      auth = dryRun ? requireAuth(projectSlug) : requirePushAuth(projectSlug);
    } catch (err) {
      return authErrorResult(err);
    }

    let build;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    let result;
    try { result = buildUpdateMetaTransaction(build, meta); }
    catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith("META_INVALID_EMAIL")) return errorResult("VALIDATION_FAILED", msg);
      if (msg.startsWith("META_ASSET_NOT_FOUND")) return errorResult("ASSET_NOT_FOUND", msg);
      return errorResult("INTERNAL_ERROR", msg);
    }

    const projectTitle = build.project?.title ?? projectSlug;

    if (result.kind === "noop") {
      return textResult(`No-op update_project_meta on "${projectTitle}"\n  ${result.reason}`);
    }

    const fields = result.appliedFields;
    void logCoerce("write:project-meta", { source: "pages.update_meta", projectSlug, fields });

    const summary = fields
      .map((f) => {
        const next = meta[f];
        if (next === null) return `  ${f} → (cleared)`;
        const v = typeof next === "string" && f === "code" && next.length > 200
          ? `${next.slice(0, 200)}… (${next.length} chars total)`
          : next;
        return `  ${f} → ${JSON.stringify(v)}`;
      })
      .join("\n");

    if (dryRun) {
      return textResult(`DRY-RUN update_project_meta

Target:
  projectSlug: ${projectSlug}
  Real name: ${projectTitle}

Changes (${fields.length} field${fields.length === 1 ? "" : "s"}):
${summary}

${result.transaction.payload[0].patches.length} patch(es) on namespace "pages" — build version ${build.version}

If OK, re-run with dryRun=false (and allowPush=true).`);
    }

    try {
      const { result: pushResult, finalVersion } = await pushWithRetry(auth, (cur) => {
        const next = buildUpdateMetaTransaction(cur, meta);
        if (next.kind === "noop") throw new Error("No-op after refetch — concurrent edit already applied the same change.");
        return next.transaction;
      });
      return textResult(`Project meta updated on "${projectTitle}"
  ${fields.length} field(s) applied — build version → ${finalVersion}
  status: ${pushResult.status}

Changes:
${summary}`);
    } catch (err) {
      return runtimeErrorResult(err, "Push failed");
    }
  },
};

// Re-export for external testing / type sharing.
export { META_FIELDS } from "./meta.js";
