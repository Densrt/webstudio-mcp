// Tools: webstudio_setup_auth, webstudio_allow_push

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { saveAuth, setAllowPush, setAppVersion } from "../auth.js";
import { loadProject } from "../projects.js";
import { fetchAppVersion } from "../webstudio-client.js";

export const setupAuthInputSchema = z.object({
  projectSlug: z.string(),
  webstudioProjectId: z.string(),
  cookie: z.string(),
  csrfToken: z.string(),
  appVersion: z.string().optional(),
  allowPush: z.boolean().default(false),
}).strict();

export const allowPushInputSchema = z.object({
  projectSlug: z.string(),
  allow: z.boolean(),
}).strict();

export const updateAppVersionInputSchema = z.object({
  projectSlug: z.string(),
  appVersion: z.string().min(8),
}).strict();

export const setupAuthTool: ToolModule = {
  definition: {
    name: "webstudio_setup_auth",
    description: `Use when: onboard a project for direct push — second step AFTER webstudio_init_project. Registers cookie + x-csrf-token grabbed from F12 → Network → /trpc/... → Headers. appVersion auto-fetched if missing.
Do NOT use when: project not initialized yet — run webstudio_init_project first. To flip the allowPush flag later (without re-supplying cookie), use webstudio_allow_push.
Returns: { projectId, appVersion, allowPush } — stored at ~/.webstudio-mcp/auth/{slug}.json.
Side effects: local mutation only (writes auth file). Cookie grants account-wide access — keep file out of git.

Example: { projectSlug: "my-site", webstudioProjectId: "xxxx-xxxx", cookie: "_ws_session=...", csrfToken: "abc...", allowPush: true }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        webstudioProjectId: { type: "string" },
        cookie: { type: "string" },
        csrfToken: { type: "string" },
        appVersion: { type: "string", description: "Optional — auto-fetched if absent (x-webstudio-client-version)" },
        allowPush: { type: "boolean" },
      },
      required: ["projectSlug", "webstudioProjectId", "cookie", "csrfToken"],
      additionalProperties: false,
    },
    annotations: {
      title: "Set up Webstudio auth credentials",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  handler: async (args) => {
    const parsed = setupAuthInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const { projectSlug, webstudioProjectId, cookie, csrfToken, allowPush } = parsed.data;
    let { appVersion } = parsed.data;

    if (!loadProject(projectSlug)) {
      return errorResult("PROJECT_NOT_FOUND", `Project "${projectSlug}" not found. Run webstudio_init_project first.`);
    }

    if (!appVersion) {
      try {
        appVersion = await fetchAppVersion(webstudioProjectId, cookie);
      } catch (err) {
        return runtimeErrorResult(
          err,
          "appVersion not provided and auto-fetch failed. Provide it manually via F12 → Network → /trpc/... → Headers → x-webstudio-client-version",
        );
      }
    }

    saveAuth(projectSlug, { projectId: webstudioProjectId, cookie, csrfToken, appVersion, allowPush });
    return textResult(`Auth saved for "${projectSlug}".
Webstudio project ID: ${webstudioProjectId}
appVersion: ${appVersion}
allowPush: ${allowPush ? "true" : "false (pushes refused)"}`);
  },
};

export const allowPushTool: ToolModule = {
  definition: {
    name: "webstudio_allow_push",
    description: `Use when: toggle the per-project push authorization flag — mandatory opt-in before any write tool can push. Run this AFTER webstudio_setup_auth to enable pushes, or with allow=false to lock the project.
Do NOT use when: auth file does not exist yet — run webstudio_setup_auth first (also accepts allowPush there). To revoke auth entirely, delete ~/.webstudio-mcp/auth/{slug}.json.
Returns: { allowPush, projectId }.
Side effects: local mutation only (updates auth file).

Example: { projectSlug: "my-site", allow: true }
Example: { projectSlug: "acme", allow: false }`,
    inputSchema: {
      type: "object",
      properties: { projectSlug: { type: "string" }, allow: { type: "boolean" } },
      required: ["projectSlug", "allow"],
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
    const parsed = allowPushInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    try {
      const next = setAllowPush(parsed.data.projectSlug, parsed.data.allow);
      return textResult(`allowPush=${next.allowPush} for "${parsed.data.projectSlug}".\nProject ID: ${next.projectId}`);
    } catch (err) {
      return authErrorResult(err);
    }
  },
};

export const updateAppVersionTool: ToolModule = {
  definition: {
    name: "webstudio_update_app_version",
    description: `Use when: refresh the x-webstudio-client-version header on an existing project auth — typically after a VERSION_MISMATCHED error (Webstudio deployed a new build). Keeps cookie + csrfToken intact.
Do NOT use when: project auth doesn't exist yet — run webstudio_setup_auth first. The MCP cannot derive this value automatically (Webstudio no longer inlines GIT_SHA): grab it from F12 → Network → any /trpc/ request → Request Headers → x-webstudio-client-version.
Returns: { projectId, appVersion }.
Side effects: local mutation only (updates auth file).

Example: { projectSlug: "my-site", appVersion: "ac14670d9e8490796aecab87d91901263dff35bf" }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        appVersion: { type: "string", description: "Value of the x-webstudio-client-version request header (Git-SHA-like, ~40 chars)" },
      },
      required: ["projectSlug", "appVersion"],
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
    const parsed = updateAppVersionInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    try {
      const next = setAppVersion(parsed.data.projectSlug, parsed.data.appVersion);
      return textResult(`appVersion updated for "${parsed.data.projectSlug}".\nProject ID: ${next.projectId}\nappVersion: ${next.appVersion}`);
    } catch (err) {
      return authErrorResult(err);
    }
  },
};
