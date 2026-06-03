// Per-project client config: tokens.json (design token registry).
// Each project lives at projects/{slug}/tokens.json.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { StyleValue } from "./types.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TokenDefinition = {
  /** Stable token ID (reused across pastes so Webstudio matches). */
  id: string;
  /** Display name shown in the Webstudio Tokens panel. */
  name: string;
  /** Styles to apply (per CSS property, camelCase). "base" mode only for v1. */
  styles: Record<string, StyleValue>;
};

export type ProjectConfig = {
  version: 1;
  projectSlug: string;
  projectName: string;
  /** Webstudio project ID (used for direct push, optional). */
  webstudioProjectId?: string;
  /** Source Figma file key (used for re-sync, optional). */
  figmaFileKey?: string;
  /** Map of slug → TokenDefinition. */
  tokens: Record<string, TokenDefinition>;
};

// ─── Paths ────────────────────────────────────────────────────────────────────

/** Projects root — override via env WEBSTUDIO_PROJECTS_DIR. */
export const PROJECTS_DIR =
  process.env.WEBSTUDIO_PROJECTS_DIR || path.join(os.homedir(), ".webstudio-mcp", "projects");

// ─── Slug safety (path-traversal guard) ─────────────────────────────────────────
// projectSlug becomes an on-disk directory name (PROJECTS_DIR/<slug>) and part of every
// credential/token file path. It originates from tool input, so it must be validated
// before it touches the filesystem — otherwise "../../.ssh/authorized_keys" or an
// absolute path would let a caller read/write outside the projects root.

/** Allowed slug charset: a letter/digit, then letters/digits/"-"/"_", max 64 chars.
 *  No "/", no ".", no "..", no leading separator. */
const SAFE_SLUG = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

/** Non-throwing predicate — used to skip malformed directory names when listing. */
export function isSafeSlug(slug: unknown): slug is string {
  return typeof slug === "string" && SAFE_SLUG.test(slug);
}

/** Throws if `slug` is unsafe as a path segment. Belt-and-suspenders: also asserts the
 *  resolved directory stays inside PROJECTS_DIR, catching any gap in the charset rule. */
export function assertSafeSlug(slug: string): void {
  if (!isSafeSlug(slug)) {
    throw new Error(
      `Invalid projectSlug ${JSON.stringify(slug)}. Allowed: a letter or digit followed by ` +
        `letters, digits, "-" or "_" (max 64 chars). This guards the on-disk project ` +
        `directory against path traversal.`,
    );
  }
  const root = path.resolve(PROJECTS_DIR);
  const resolved = path.resolve(root, slug);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`projectSlug ${JSON.stringify(slug)} resolves outside the projects root.`);
  }
}

/**
 * Ensure the project directory exists with the right permissions.
 * Webstudio MCP stores per-project config (tokens.json, webstudio-auth.json) here.
 *
 * If the parent ~/.webstudio-mcp/ exists but is owned by a different user (e.g. created by root
 * before the MCP runs as a non-root user), we throw a clear error explaining how to fix it.
 */
export function ensureProjectDir(slug: string): string {
  const dir = projectDir(slug);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "EACCES") {
      throw new Error(
        `Cannot write to "${dir}" (permission denied).\n\n` +
          `The MCP storage root is "${PROJECTS_DIR}". If it was created by another user, fix ownership:\n` +
          `  sudo chown -R $(whoami) "${path.dirname(PROJECTS_DIR)}"\n\n` +
          `Or override the storage path with the WEBSTUDIO_PROJECTS_DIR env variable.`,
      );
    }
    throw err;
  }
  return dir;
}

export function projectDir(slug: string): string {
  assertSafeSlug(slug);
  return path.join(PROJECTS_DIR, slug);
}

export function tokensPath(slug: string): string {
  return path.join(projectDir(slug), "tokens.json");
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/** Load a project config. Returns null if the project doesn't exist. */
export function loadProject(slug: string): ProjectConfig | null {
  const file = tokensPath(slug);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf-8");
  return JSON.parse(raw) as ProjectConfig;
}

/** List every project available in PROJECTS_DIR. */
export function listProjects(): string[] {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  return fs
    .readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((slug) => isSafeSlug(slug))
    .filter((slug) => fs.existsSync(tokensPath(slug)));
}

/** List a project's tokens (slug + name + properties). */
export function listTokens(slug: string): Array<{ slug: string; name: string; properties: string[] }> {
  const project = loadProject(slug);
  if (!project) return [];
  return Object.entries(project.tokens).map(([tokenSlug, def]) => ({
    slug: tokenSlug,
    name: def.name,
    properties: Object.keys(def.styles),
  }));
}

/** Get a token by slug (or undefined). */
export function getToken(projectSlug: string, tokenSlug: string): TokenDefinition | undefined {
  const project = loadProject(projectSlug);
  return project?.tokens[tokenSlug];
}

// ─── Write ────────────────────────────────────────────────────────────────────

/** Initialize an empty project (creates tokens.json if missing). */
export function initProject(slug: string, name: string, options: { webstudioProjectId?: string; figmaFileKey?: string } = {}): ProjectConfig {
  ensureProjectDir(slug);
  const existing = loadProject(slug);
  if (existing) return existing;
  const config: ProjectConfig = {
    version: 1,
    projectSlug: slug,
    projectName: name,
    ...(options.webstudioProjectId && { webstudioProjectId: options.webstudioProjectId }),
    ...(options.figmaFileKey && { figmaFileKey: options.figmaFileKey }),
    tokens: {},
  };
  saveProject(config);
  return config;
}

/** Save a config (overwrite). */
export function saveProject(config: ProjectConfig): void {
  fs.mkdirSync(projectDir(config.projectSlug), { recursive: true });
  fs.writeFileSync(tokensPath(config.projectSlug), JSON.stringify(config, null, 2) + "\n");
}

/** Create or update a token. Generates a stable ID on first use. */
export function defineToken(
  projectSlug: string,
  tokenSlug: string,
  name: string,
  styles: Record<string, StyleValue>
): TokenDefinition {
  let project = loadProject(projectSlug);
  if (!project) {
    throw new Error(`Project "${projectSlug}" not initialized. Call initProject() first.`);
  }
  const existing = project.tokens[tokenSlug];
  const def: TokenDefinition = {
    id: existing?.id ?? makeStableTokenId(projectSlug, tokenSlug),
    name,
    styles,
  };
  project.tokens[tokenSlug] = def;
  saveProject(project);
  return def;
}

/** Build a stable ID for a token: `tok_<projectSlug>_<tokenSlug>`. */
function makeStableTokenId(projectSlug: string, tokenSlug: string): string {
  // Readable, stable ID (not a random nanoid).
  // Format: tok_<projectSlug>_<tokenSlug>, capped to ~30 chars to stay close to Webstudio nanoids (12 chars).
  const cleanSlug = tokenSlug.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 20);
  const cleanProj = projectSlug.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 8);
  return `tok_${cleanProj}_${cleanSlug}`;
}
