// Project-level meta — read/write helpers for the global "Project Settings" fields
// (head Custom Code, siteName, contactEmail, favicon asset id, social image asset id).
//
// Storage convention (verified against a real Webstudio Cloud build):
//   - In the build object: build.pages.meta.<field>
//   - Patch namespace:     "pages"
//   - Patch path:          ["meta", "<field>"]   ← RELATIVE to build.pages.
//                          NOT ["pages","meta",field] — that would target
//                          build.pages.pages.meta.field, but build.pages.pages
//                          is the pages ARRAY, not an object with meta.
//   - Encoding:            plain literal strings — NO JSON-stringify wrapping
//                          (unlike per-page title / meta.description which are
//                          stored as JS expressions).
//   - Sparsity:            only set keys exist; unset fields are absent
//                          (not "" / null).
//
// Whitelist of supported fields is explicit (no wildcard) so the MCP never leaks
// future Webstudio additions the caller cannot model.

import { customAlphabet } from "nanoid";
import type { WebstudioBuild, BuildPatchOperation, BuildPatchTransaction } from "../../webstudio-client.js";

const txId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);

export const META_FIELDS = ["code", "siteName", "contactEmail", "faviconAssetId", "socialImageAssetId"] as const;
export type MetaField = (typeof META_FIELDS)[number];

export type ProjectMeta = Partial<Record<MetaField, string | null>>;

export type GetMetaResult = {
  meta: Partial<Record<MetaField, string>>;
  hint?: string;
  telemetryKey?: string;
};

export type BuildUpdateMetaResult =
  | { kind: "noop"; reason: string }
  | { kind: "patch"; transaction: BuildPatchTransaction; appliedFields: MetaField[]; hint?: string; telemetryKey?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readProjectMeta(build: WebstudioBuild): Record<string, unknown> {
  const pages = build.pages as unknown as { meta?: Record<string, unknown> };
  return (pages.meta && typeof pages.meta === "object") ? pages.meta : {};
}

function listAssetIds(build: WebstudioBuild): Set<string> {
  const out = new Set<string>();
  for (const a of build.assets ?? []) {
    const id = (a as { id?: unknown }).id;
    if (typeof id === "string") out.add(id);
  }
  return out;
}

/**
 * Pure read: returns the requested fields (or all known fields if `fields` is
 * omitted/empty). Skips keys that are unset in storage — the caller distinguishes
 * "field absent" from "field empty string" by key presence in the returned object.
 *
 * Emits a hint + telemetryKey if a stored asset id references an asset that has
 * been deleted from the project (orphan).
 */
export function buildGetMetaResult(build: WebstudioBuild, fields?: readonly MetaField[]): GetMetaResult {
  const stored = readProjectMeta(build);
  const wanted = fields && fields.length > 0 ? fields : META_FIELDS;

  const meta: Partial<Record<MetaField, string>> = {};
  for (const f of wanted) {
    const v = stored[f];
    if (typeof v === "string") meta[f] = v;
  }

  const assetIds = listAssetIds(build);
  const orphans: string[] = [];
  for (const f of ["faviconAssetId", "socialImageAssetId"] as const) {
    if (!wanted.includes(f)) continue;
    const v = meta[f];
    if (typeof v === "string" && v.length > 0 && !assetIds.has(v)) orphans.push(f);
  }

  if (orphans.length > 0) {
    return {
      meta,
      hint: `${orphans.join(", ")} reference(s) an asset id no longer present in the project. Use assets.list to find a replacement and pages.update_meta to fix.`,
      telemetryKey: "detect:orphan-meta-asset",
    };
  }
  return { meta };
}

/**
 * Pure write: builds the patch transaction for the provided partial meta object.
 *
 * Semantics:
 *   - Each field's value is either a string (set) or null (remove key).
 *   - Fields whose new value equals the stored value are skipped (idempotent).
 *   - If no field changes at all → returns kind:"noop".
 *
 * Validation errors are thrown as Error with codes embedded in the message
 * (`META_INVALID_EMAIL`, `META_ASSET_NOT_FOUND`) — the calling tool maps them to
 * MCP error codes.
 */
export function buildUpdateMetaTransaction(build: WebstudioBuild, meta: ProjectMeta): BuildUpdateMetaResult {
  const stored = readProjectMeta(build);
  const assetIds = listAssetIds(build);

  if (typeof meta.contactEmail === "string" && meta.contactEmail.length > 0 && !EMAIL_RE.test(meta.contactEmail)) {
    throw new Error(`META_INVALID_EMAIL: "${meta.contactEmail}" is not a syntactically valid email address.`);
  }
  for (const f of ["faviconAssetId", "socialImageAssetId"] as const) {
    const v = meta[f];
    if (typeof v === "string" && v.length > 0 && !assetIds.has(v)) {
      throw new Error(`META_ASSET_NOT_FOUND: ${f}="${v}" — no such asset in the project. Use assets.list to find the right id.`);
    }
  }

  const patches: BuildPatchOperation[] = [];
  const appliedFields: MetaField[] = [];

  for (const f of META_FIELDS) {
    if (!(f in meta)) continue;
    const next = meta[f];
    const current = stored[f];

    if (next === null) {
      if (current === undefined) continue;
      patches.push({ op: "remove", path: ["meta", f] });
      appliedFields.push(f);
      continue;
    }
    if (typeof next === "string") {
      if (next === current) continue;
      if (current === undefined) {
        patches.push({ op: "add", path: ["meta", f], value: next });
      } else {
        patches.push({ op: "replace", path: ["meta", f], value: next });
      }
      appliedFields.push(f);
    }
  }

  if (patches.length === 0) {
    return { kind: "noop", reason: "All submitted fields already match the stored values." };
  }

  return {
    kind: "patch",
    transaction: {
      id: `mcp-update-meta-${txId()}`,
      payload: [{ namespace: "pages", patches }],
    },
    appliedFields,
  };
}
