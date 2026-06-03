// Tool: webstudio_sync_local_tokens — materialize locally-staged tokens (tokens.json) as
// actual Webstudio styleSources type="token" + their style decls, so they appear in the
// Style Sources panel even without any consuming instance.
//
// Fills the gap between define_token (local catalog) and Webstudio Cloud:
//   - define_token / init_brand_tokens only write to projects/<slug>/tokens.json
//   - extract_token_from_instances creates Webstudio tokens but requires ≥2 instances
//   - update_token_styles only edits already-existing Webstudio tokens
// → No path to "seed a design system kit from scratch" without dummy instances.
// This tool fills that gap.

import { z } from "zod";
import { customAlphabet } from "nanoid";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type { WebstudioBuild, BuildPatchTransaction, BuildPatchOperation } from "../webstudio-client.js";
import type { StyleValue } from "../types.js";
import { loadProject } from "../projects.js";
import { expandStylesMap } from "./create-token/shared.js";

const newId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);
const txId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);

export const syncLocalTokensInputSchema = z.object({
  projectSlug: z.string(),
  /** Filter: only sync these slug(s). Default = all tokens in local tokens.json. */
  tokenSlugs: z.array(z.string()).optional(),
  /** Breakpoint to attach the style decls to. Default "Base". */
  breakpoint: z.string().default("Base"),
  /** If a Webstudio token with the same name already exists: false (default) = skip, true = add missing style decls to it. */
  overwrite: z.boolean().default(false),
  dryRun: z.boolean().default(true),
}).strict();

type WsStyleSource = { id: string; type: string; name?: string };

type LocalToken = {
  id: string;
  name: string;
  styles: Record<string, StyleValue>;
};

export const syncLocalTokensTool: ToolModule = {
  definition: {
    name: "webstudio_sync_local_tokens",
    description: `Use when: materialize tokens previously staged LOCALLY (via webstudio_define_token / webstudio_init_brand_tokens, stored in projects/<slug>/tokens.json) as actual Webstudio cloud styleSources type="token", so they appear in the Style Sources panel even without consuming instances.
Do NOT use when: pushing tokens DIRECTLY to cloud without local staging (use webstudio_create_tokens — single fetchBuild + single transaction, no tokens.json roundtrip; accepts 1 or N definitions), or editing existing cloud tokens (use webstudio_update_token_styles).
Returns: dry-run with per-token Created/Updated/Skipped lists and total style decl count, or push result.
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default. Per-token skip if a token with the same display name already exists in cloud (use overwrite=true to merge missing decls into the existing one).

Fills the gap between local staging (define_token) and cloud — covers "seed a design system kit from scratch" without dummy instances.

Example: { projectSlug: "acme", breakpoint: "Base", dryRun: true }  // sync all local tokens
Example: { projectSlug: "acme", tokenSlugs: ["color-primary", "color-secondary"], overwrite: true, dryRun: true }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        tokenSlugs: { type: "array", items: { type: "string" } },
        breakpoint: { type: "string" },
        overwrite: { type: "boolean" },
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
    const parsed = syncLocalTokensInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const data = parsed.data;

    let auth;
    try {
      auth = data.dryRun ? requireAuth(data.projectSlug) : requirePushAuth(data.projectSlug);
    } catch (err) {
      return authErrorResult(err);
    }

    // Load local tokens.json
    let project: ReturnType<typeof loadProject>;
    try {
      project = loadProject(data.projectSlug);
    } catch (err) {
      return errorResult("PROJECT_NOT_FOUND", `Local project not initialized: ${(err as Error).message}`);
    }
    if (!project) {
      return errorResult("PROJECT_NOT_FOUND", `Local project "${data.projectSlug}" not initialized (run webstudio_init_project first).`);
    }

    const localTokens = Object.entries(project.tokens ?? {}) as Array<[string, LocalToken]>;
    if (localTokens.length === 0) {
      return textResult("No local tokens in tokens.json. Run define_token or init_brand_tokens first.");
    }

    const filtered = data.tokenSlugs
      ? localTokens.filter(([slug]) => data.tokenSlugs!.includes(slug))
      : localTokens;
    if (filtered.length === 0) {
      return errorResult("VALIDATION_FAILED", `No matching local tokens for slugs: ${data.tokenSlugs?.join(", ")}`);
    }

    let build: WebstudioBuild;
    try { build = await fetchBuild(auth); } catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    const bp = build.breakpoints.find((b) => b.label.toLowerCase() === data.breakpoint.toLowerCase() || b.id === data.breakpoint);
    if (!bp) {
      const available = build.breakpoints.map((b) => `"${b.label}"`).join(", ");
      return errorResult("VALIDATION_FAILED", `Breakpoint "${data.breakpoint}" not found (available: ${available})`);
    }

    const styleSources = (build.styleSources ?? []) as WsStyleSource[];

    const styleSourcePatches: BuildPatchOperation[] = [];
    const stylePatches: BuildPatchOperation[] = [];
    const created: string[] = [];
    const updated: string[] = [];
    const skipped: string[] = [];

    for (const [slug, def] of filtered) {
      // Boundary protection: refuse non-expandable shorthands (background, font, …)
      // and atomically replace uniform shorthands with their longhands.
      // a production site (2026-05-21): `padding: var(--s)` posted as a single decl broke publish.
      const expanded = expandStylesMap(def.styles);
      if (!expanded.ok) {
        skipped.push(`"${def.name}" (slug=${slug}) — ${expanded.error}`);
        continue;
      }
      const stylesForToken = expanded.styles;

      const existing = styleSources.find((s) => s.type === "token" && s.name === def.name);

      let tokenId: string;
      let isNew = false;

      if (existing) {
        if (!data.overwrite) {
          skipped.push(`"${def.name}" (already exists, use overwrite=true to add missing decls)`);
          continue;
        }
        tokenId = existing.id;
        updated.push(`${def.name} [${tokenId}]`);
      } else {
        tokenId = newId();
        isNew = true;
        created.push(`${def.name} [${tokenId}] (slug=${slug})`);
        styleSourcePatches.push({
          op: "add",
          path: [tokenId],
          value: { id: tokenId, type: "token", name: def.name } as unknown as BuildPatchOperation["value"],
        });
      }

      // Style decls: { styleSourceId, breakpointId, property, value, state? }
      for (const [property, value] of Object.entries(stylesForToken)) {
        const state = ""; // base state, no pseudo
        // For an existing token in overwrite mode, skip declarations already set on the same key.
        if (!isNew && build.styles.some((s) =>
          s.styleSourceId === tokenId &&
          s.breakpointId === bp.id &&
          s.property === property &&
          (s.state ?? "") === state
        )) continue;

        stylePatches.push({
          op: "add",
          path: [`${tokenId}:${bp.id}:${property}:${state}`],
          value: {
            styleSourceId: tokenId,
            breakpointId: bp.id,
            property,
            value,
          } as unknown as BuildPatchOperation["value"],
        });
      }
    }

    const summary = `Tokens sync plan (breakpoint="${bp.label}"):
  Created     : ${created.length}
${created.map((n) => `    + ${n}`).join("\n") || "    (none)"}
  Updated     : ${updated.length}
${updated.map((n) => `    ~ ${n}`).join("\n") || "    (none)"}
  Skipped     : ${skipped.length}
${skipped.map((n) => `    - ${n}`).join("\n") || "    (none)"}
  Style decls : ${stylePatches.length}`;

    if (styleSourcePatches.length === 0 && stylePatches.length === 0) {
      return textResult(`Nothing to push.\n\n${summary}`);
    }

    if (data.dryRun) {
      return textResult(`DRY-RUN sync_local_tokens\n\n${summary}\n\nRe-run with dryRun=false and allowPush=true to apply.`);
    }

    const transaction: BuildPatchTransaction = {
      id: `mcp-sync-tokens-${txId()}`,
      payload: [
        ...(styleSourcePatches.length > 0 ? [{ namespace: "styleSources" as const, patches: styleSourcePatches }] : []),
        ...(stylePatches.length > 0 ? [{ namespace: "styles" as const, patches: stylePatches }] : []),
      ],
    };

    try {
      const { result, finalVersion } = await pushWithRetry(auth, () => transaction);
      return textResult(`Tokens synced — version → ${finalVersion}\nstatus: ${result.status}\n\n${summary}`);
    } catch (err) {
      return runtimeErrorResult(err, "Push failed");
    }
  },
};
