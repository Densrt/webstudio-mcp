// Shared helpers for create-token / create-tokens tools.
//
// - newId / txId: 21-char URL-safe nanoid (Webstudio convention)
// - findCssVarRefs: walks a styles map and collects every {type:"var", value:"xxx"} reference (recursive)
// - collectKnownCssVars: enumerate every "--xxx" property defined anywhere in build.styles (the universe of defined vars)
// - validateCssVarRefs: report a list of unknown var refs against the project's defined vars
// - buildTokenPatches: shared patch builder used by both single and batch create-token tools

import { customAlphabet } from "nanoid";
import type { WebstudioBuild, BuildPatchOperation } from "../../webstudio-client.js";
import type { StyleValue } from "../../types.js";
import { expandShorthand } from "../../lib/expand-shorthand.js";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
export const newId = customAlphabet(ALPHABET, 21);
export const txId = customAlphabet(ALPHABET, 21);

export type WsStyleSource = { id: string; type: string; name?: string };

/** Recursively collect every `--xxx` var name referenced by a StyleValue. */
export function collectVarRefs(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (!value || typeof value !== "object") return out;
  const v = value as { type?: string; value?: unknown; fallback?: unknown; components?: unknown[] };
  if (v.type === "var" && typeof v.value === "string") {
    out.add(v.value);
    if (v.fallback) collectVarRefs(v.fallback, out);
    return out;
  }
  // recurse into nested style values (layers, shadows, tuples, etc.)
  if (Array.isArray(v.value)) {
    for (const x of v.value) collectVarRefs(x, out);
  } else if (v.value && typeof v.value === "object") {
    collectVarRefs(v.value, out);
  }
  // shadow-like { offsetX, offsetY, blur, spread, color }
  for (const k of ["offsetX", "offsetY", "blur", "spread", "color"]) {
    const child = (value as Record<string, unknown>)[k];
    if (child) collectVarRefs(child, out);
  }
  return out;
}

/** Set of CSS var names (without leading `--`) defined anywhere in the project's styles. */
export function collectKnownCssVars(build: WebstudioBuild): Set<string> {
  const known = new Set<string>();
  for (const d of build.styles) {
    if (d.property.startsWith("--")) known.add(d.property.slice(2));
  }
  return known;
}

/**
 * Given a styles map, return the list of `--xxx` references that are NOT defined in the project.
 * Names are returned without the leading `--`.
 */
export function findMissingVarRefs(
  styles: Record<string, StyleValue>,
  known: Set<string>,
): string[] {
  const refs = new Set<string>();
  for (const v of Object.values(styles)) collectVarRefs(v, refs);
  const missing: string[] = [];
  for (const r of refs) if (!known.has(r)) missing.push(r);
  missing.sort();
  return missing;
}

export type BuildTokenPatchesResult = {
  tokenId: string;
  isNew: boolean;
  styleSourcePatches: BuildPatchOperation[];
  stylePatches: BuildPatchOperation[];
  addedDecls: string[];
  skippedDecls: string[];
};

/**
 * Expand any shorthand entries in a styles map to their longhand counterparts,
 * or throw with a clear hint when the shorthand is non-expandable. Mirrors the
 * boundary protection applied by build-from-args / update-styles / update-token-styles.
 *
 * a production site (2026-05-21): without this guard, `create_tokens` could seed a token
 * with `padding: var(--s)` — which then broke the Webstudio publish pipeline.
 */
export function expandStylesMap(
  styles: Record<string, StyleValue>,
): { ok: true; styles: Record<string, StyleValue> } | { ok: false; error: string } {
  const out: Record<string, StyleValue> = {};
  for (const [property, value] of Object.entries(styles)) {
    const r = expandShorthand(property, value);
    if (r.kind === "error") {
      return { ok: false, error: `property "${property}" — ${r.message}` };
    }
    if (r.kind === "ok") {
      for (const d of r.decls) out[d.property] = d.value;
    } else {
      out[property] = value;
    }
  }
  return { ok: true, styles: out };
}

/**
 * Compute the patches needed to create a token (or extend an existing one) with the given decls.
 * Pure: no fetch, no push. Caller wires the patches into a transaction.
 *
 * - Existing token + !overwrite → returns null to signal a conflict (caller decides what to do).
 * - state is always "" for now (no per-state decls in this helper).
 */
export function buildTokenPatches(
  build: WebstudioBuild,
  args: {
    name: string;
    styles: Record<string, StyleValue>;
    breakpointId: string;
    overwrite: boolean;
  },
): BuildTokenPatchesResult | { conflict: true; existingId: string } | { shorthandError: string } {
  const expanded = expandStylesMap(args.styles);
  if (!expanded.ok) return { shorthandError: expanded.error };
  const stylesMap = expanded.styles;

  const styleSources = (build.styleSources ?? []) as WsStyleSource[];
  const existing = styleSources.find((s) => s.type === "token" && s.name === args.name);

  let tokenId: string;
  let isNew = false;
  const styleSourcePatches: BuildPatchOperation[] = [];
  const stylePatches: BuildPatchOperation[] = [];

  if (existing) {
    if (!args.overwrite) return { conflict: true, existingId: existing.id };
    tokenId = existing.id;
  } else {
    tokenId = newId();
    isNew = true;
    styleSourcePatches.push({
      op: "add",
      path: [tokenId],
      value: { id: tokenId, type: "token", name: args.name } as unknown as BuildPatchOperation["value"],
    });
  }

  const skippedDecls: string[] = [];
  const addedDecls: string[] = [];
  const state = "";

  for (const [property, value] of Object.entries(stylesMap)) {
    if (!isNew && build.styles.some((s) =>
      s.styleSourceId === tokenId &&
      s.breakpointId === args.breakpointId &&
      s.property === property &&
      (s.state ?? "") === state
    )) {
      skippedDecls.push(property);
      continue;
    }
    stylePatches.push({
      op: "add",
      path: [`${tokenId}:${args.breakpointId}:${property}:${state}`],
      value: {
        styleSourceId: tokenId,
        breakpointId: args.breakpointId,
        property,
        value: value as StyleValue,
      } as unknown as BuildPatchOperation["value"],
    });
    addedDecls.push(property);
  }

  return { tokenId, isNew, styleSourcePatches, stylePatches, addedDecls, skippedDecls };
}
