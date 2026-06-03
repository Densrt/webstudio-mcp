// Tool: webstudio_delete_token_decl — surgical removal of style declarations from a
// SHARED token (styleSource type="token"). Counterpart to update_token_styles, which
// can only add/replace but never delete.
//
// Required to neutralise a production site (2026-05-21) leftovers: a shorthand decl posted into
// a token via the legacy path could not be removed without delete+recreate (which
// loses all attachments). This action removes one decl key per token without
// touching other decls or the token itself.
//
// Resolution: by tokenName (exact match) or tokenId. Same matching semantics as
// delete_local_style_decl on instances: omit breakpoint to match every bp; omit
// state to match every state variant; pass state:"" to target base only.

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type { WebstudioBuild, BuildPatchTransaction, BuildPatchOperation } from "../webstudio-client.js";
import type { StyleDecl } from "../types.js";
import { stateMatches } from "../lib/state-whitelist.js";
import { customAlphabet } from "nanoid";

const txId = customAlphabet(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
  21,
);

const DeletionSchema = z.object({
  property: z.string(),
  breakpoint: z.string().optional(),
  state: z.string().optional(),
}).strict();

export const deleteTokenDeclInputSchema = z.object({
  projectSlug: z.string(),
  tokenName: z.string().optional().describe("Token display name (exact match). Provide tokenName OR tokenId."),
  tokenId: z.string().optional().describe("StyleSource id of the token. Provide tokenName OR tokenId."),
  deletions: z.array(DeletionSchema).min(1),
  dryRun: z.boolean().default(true),
}).strict().refine((v) => v.tokenName || v.tokenId, {
  message: "Provide tokenName or tokenId.",
});

type Deletion = z.infer<typeof DeletionSchema>;

function styleKey(d: { styleSourceId: string; breakpointId: string; property: string; state?: string }): string {
  return `${d.styleSourceId}:${d.breakpointId}:${d.property}:${d.state ?? ""}`;
}

function resolveToken(
  build: WebstudioBuild,
  byName?: string,
  byId?: string,
): { id: string; name?: string } | null {
  const sources = build.styleSources as Array<{ id: string; type: string; name?: string }>;
  if (byId) {
    const t = sources.find((s) => s.id === byId && s.type === "token");
    return t ? { id: t.id, name: t.name } : null;
  }
  if (byName) {
    const t = sources.find((s) => s.type === "token" && s.name === byName);
    return t ? { id: t.id, name: t.name } : null;
  }
  return null;
}

export function buildDeleteTokenDeclTransaction(
  build: WebstudioBuild,
  tokenId: string,
  deletions: Deletion[],
): { transaction: BuildPatchTransaction; details: string[]; matchedCount: number } {
  const stylePatches: BuildPatchOperation[] = [];
  const details: string[] = [];
  const seenKeys = new Set<string>();

  for (const d of deletions) {
    let bpFilterId: string | undefined;
    if (d.breakpoint) {
      const q = d.breakpoint.toLowerCase();
      const bp = build.breakpoints.find((b) => b.label.toLowerCase() === q || b.id === d.breakpoint);
      if (!bp) {
        const available = build.breakpoints.map((b) => `"${b.label}"`).join(", ");
        details.push(`! breakpoint "${d.breakpoint}" not found (available: ${available}) — skipped`);
        continue;
      }
      bpFilterId = bp.id;
    }

    // state semantics — aligned with delete-local-style-decl:
    //  - undefined: match every state variant (wildcard)
    //  - "": match base only (stored state undefined or empty string)
    //  - "<sel>": match that selector with raw-first equality + normalized fallback
    const stateAccepts = (stored: string | undefined): boolean => {
      if (d.state === undefined) return true;
      if (d.state === "") return stored === undefined || stored === "";
      return stateMatches(stored, d.state);
    };
    const matches = build.styles.filter((s: StyleDecl) =>
      s.styleSourceId === tokenId &&
      s.property === d.property &&
      (bpFilterId === undefined || s.breakpointId === bpFilterId) &&
      stateAccepts(s.state),
    );

    if (matches.length === 0) {
      const filter = [
        d.property,
        d.breakpoint ? `bp=${d.breakpoint}` : "bp=*",
        d.state !== undefined ? `state=${d.state || "base"}` : "state=*",
      ].join(" ");
      details.push(`· no token decl matches ${filter}`);
      continue;
    }

    for (const m of matches) {
      const key = styleKey(m);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      stylePatches.push({ op: "remove", path: [key] });
      const bpLabel = build.breakpoints.find((b) => b.id === m.breakpointId)?.label ?? m.breakpointId;
      details.push(`- ${m.property}${m.state ? `[${m.state}]` : ""} @${bpLabel}`);
    }
  }

  const payload = stylePatches.length > 0
    ? [{ namespace: "styles" as const, patches: stylePatches }]
    : [];

  return {
    transaction: { id: `mcp-delete-token-decl-${txId()}`, payload },
    details,
    matchedCount: stylePatches.length,
  };
}

export const deleteTokenDeclTool: ToolModule = {
  definition: {
    name: "webstudio_delete_token_decl",
    description: `Use when: REMOVE one or more style declarations from a SHARED token (styleSource type="token"). Counterpart to update_token_styles which only adds/replaces.
Do NOT use when: removing a LOCAL decl from an instance (use styles.delete_decl), deleting the whole token (use tokens.delete_token), or clearing instance overrides (use cleanup_orphan_locals).
Returns: dry-run report with each matched (property, breakpoint, state) row, or push result with count removed.
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default. Instances using the token keep their selection — they just lose this decl from the token. Idempotent (no-op if nothing matches).

Each deletion is keyed by (property, breakpoint?, state?). Omitting breakpoint matches all bp; omitting state matches every state variant (base + hover/focus/etc.). Pass state:"" to target base only.

Example: { projectSlug: "my-site", tokenName: "Icon Badge", deletions: [{ property: "padding" }], dryRun: true }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        tokenName: { type: "string", description: "Token display name (exact match). Provide tokenName OR tokenId." },
        tokenId: { type: "string", description: "StyleSource id of the token. Provide tokenName OR tokenId." },
        deletions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              property: { type: "string" },
              breakpoint: { type: "string", description: "Optional. Omit to match all breakpoints." },
              state: { type: "string", description: "Optional. Omit to match all states. Pass empty string \"\" to target base only." },
            },
            required: ["property"],
          },
        },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug", "deletions"],
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
    const parsed = deleteTokenDeclInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const { projectSlug, tokenName, tokenId, deletions, dryRun } = parsed.data;

    let auth;
    try { auth = dryRun ? requireAuth(projectSlug) : requirePushAuth(projectSlug); }
    catch (err) { return authErrorResult(err); }

    let build;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    const token = resolveToken(build, tokenName, tokenId);
    if (!token) {
      const tokens = (build.styleSources as Array<{ id: string; type: string; name?: string }>)
        .filter((s) => s.type === "token").slice(0, 20).map((s) => `  - "${s.name}" [${s.id}]`).join("\n");
      return errorResult(
        "TOKEN_NOT_FOUND",
        `Token not found. Provided: tokenName="${tokenName ?? ""}" tokenId="${tokenId ?? ""}"\n\nSample tokens in project:\n${tokens}`,
      );
    }

    const tx = buildDeleteTokenDeclTransaction(build, token.id, deletions);

    if (tx.matchedCount === 0) {
      return textResult(`No-op (nothing matched) on token "${token.name}" [${token.id}]:\n${tx.details.join("\n")}`);
    }

    if (dryRun) {
      return textResult(
        `DRY-RUN delete_token_decl\n\nToken: "${token.name}" [${token.id}]\n\n${tx.matchedCount} decl(s) to remove:\n${tx.details.join("\n")}\n\nIf OK, re-run with dryRun=false.`,
      );
    }

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) =>
        buildDeleteTokenDeclTransaction(cur, token.id, deletions).transaction,
      );
      return textResult(
        `Token "${token.name}" — ${tx.matchedCount} decl(s) removed — version → ${finalVersion}\nstatus: ${result.status}\n\n${tx.details.join("\n")}`,
      );
    } catch (err) {
      return runtimeErrorResult(err, "Delete failed");
    }
  },
};
