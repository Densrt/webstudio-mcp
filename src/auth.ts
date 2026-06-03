// Per-project Webstudio Cloud auth storage.
// File: projects/{slug}/webstudio-auth.json (gitignored).

import * as fs from "node:fs";
import * as path from "node:path";
import { projectDir, ensureProjectDir } from "./projects.js";
import type { WebstudioConfig } from "./webstudio-client.js";

export function authPath(slug: string): string {
  return path.join(projectDir(slug), "webstudio-auth.json");
}

export function loadAuth(slug: string): WebstudioConfig | null {
  const file = authPath(slug);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf-8")) as WebstudioConfig;
}

export function saveAuth(slug: string, config: WebstudioConfig): void {
  ensureProjectDir(slug);
  fs.writeFileSync(authPath(slug), JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

/**
 * Resolve auth for a slug. Throws if not configured.
 * Call at the start of every push tool to validate the config.
 */
export function requireAuth(slug: string): WebstudioConfig {
  const auth = loadAuth(slug);
  if (!auth) {
    throw new Error(
      `Webstudio auth not configured for project "${slug}". Run webstudio_setup_auth first.`,
    );
  }
  return auth;
}

/**
 * Like requireAuth + checks that `allowPush === true`.
 * The session cookie grants access to ALL projects on the account; allowPush forces an
 * explicit per-project opt-in to prevent accidental pushes to the wrong slug.
 */
export function requirePushAuth(slug: string): WebstudioConfig {
  const auth = requireAuth(slug);
  if (auth.allowPush !== true) {
    throw new Error(
      `Push refused: project "${slug}" does not have allowPush=true.\n\n` +
        `The Webstudio session cookie grants access to ALL projects on the account.\n` +
        `To authorize pushes on "${slug}", run webstudio_setup_auth again with allowPush=true.\n` +
        `Recommendation: never enable allowPush on a production project without a prior dry-run.`,
    );
  }
  return auth;
}

/** Toggle allowPush on a project that's already configured. Useful for enabling/disabling without re-entering cookies. */
export function setAllowPush(slug: string, allow: boolean): WebstudioConfig {
  const auth = requireAuth(slug);
  const next = { ...auth, allowPush: allow };
  saveAuth(slug, next);
  return next;
}

/**
 * Update only the appVersion (x-webstudio-client-version) on an existing auth.
 * Useful after Webstudio deploys a new build — the cookie + csrf stay valid,
 * only the version header needs to be refreshed.
 */
export function setAppVersion(slug: string, appVersion: string): WebstudioConfig {
  const auth = requireAuth(slug);
  const next = { ...auth, appVersion };
  saveAuth(slug, next);
  return next;
}
