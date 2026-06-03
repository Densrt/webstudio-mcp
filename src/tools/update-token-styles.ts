// Tool: webstudio_update_token_styles — patch the style declarations of an existing design token.
//
// Sibling of webstudio_styles, but targets a shared token (styleSource type="token") instead
// of an instance's local styleSource. Changes propagate to every instance using the token.
//
// Use cases:
//  - Tweak a token color/size/background without re-creating it
//  - Swap a placeholder backgroundImage value for a clean gradient on a token used by 20+ cards
//  - Add a new declaration to a token (property absent → "add", present → "replace")
//
// Resolution: by tokenName (exact match) or tokenId. Breakpoint label is case-insensitive.

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { StyleValueSchema } from "../build-from-args.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type { WebstudioBuild, BuildPatchTransaction, BuildPatchOperation } from "../webstudio-client.js";
import type { StyleDecl, StyleValue } from "../types.js";
import { coerceStyleValue, completeTransitionAnimationLonghands, validateStyleValue, applyListedDefault } from "../lib/style-coerce.js";
import { expandShorthand } from "../lib/expand-shorthand.js";
import { normalizeStyleValue } from "../lib/style-normalize.js";
import { stateMatches } from "../lib/state-whitelist.js";
import { customAlphabet } from "nanoid";

const txId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);

const StyleUpdateSchema = z.object({
  property: z.string(),
  value: StyleValueSchema,
  breakpoint: z.string().default("base"),
  state: z.string().optional(),
  listed: z.boolean().optional(),
}).strict();

export const updateTokenStylesInputSchema = z.object({
  projectSlug: z.string(),
  tokenName: z.string().optional().describe("Token display name (exact match). Provide tokenName OR tokenId."),
  tokenId: z.string().optional().describe("StyleSource id of the token. Provide tokenName OR tokenId."),
  updates: z.array(StyleUpdateSchema).min(1),
  dryRun: z.boolean().default(true),
}).strict().refine((v) => v.tokenName || v.tokenId, {
  message: "Provide tokenName or tokenId.",
});

function styleKey(s: { styleSourceId: string; breakpointId: string; property: string; state?: string }): string {
  return `${s.styleSourceId}:${s.breakpointId}:${s.property}:${s.state ?? ""}`;
}

function buildUpdateTransaction(
  build: WebstudioBuild,
  tokenId: string,
  updates: z.infer<typeof StyleUpdateSchema>[],
): { transaction: BuildPatchTransaction; details: string[] } {
  const patches: BuildPatchOperation[] = [];
  const details: string[] = [];

  // First pass: coerce, resolve breakpoint, group by (breakpointId, state).
  type Resolved = { property: string; value: StyleValue; breakpointId: string; state?: string; listed?: boolean; bpLabel: string };
  const resolved: Resolved[] = [];
  for (const u of updates) {
    const bpQuery = u.breakpoint.toLowerCase();
    const bp = build.breakpoints.find((b) => b.label.toLowerCase() === bpQuery || b.id === u.breakpoint);
    if (!bp) {
      const available = build.breakpoints.map((b) => `"${b.label}"`).join(", ");
      details.push(`! breakpoint "${u.breakpoint}" not found (available: ${available})`);
      continue;
    }
    // Expand CSS shorthands into longhand decls (e.g. `flex: "1 1 380px"` → 3 decls).
    const exp = expandShorthand(u.property, u.value as StyleValue);
    if (exp.kind === "error") {
      details.push(`! shorthand "${u.property}" rejected: ${exp.message}`);
      continue;
    }
    const decls = exp.kind === "ok"
      ? exp.decls
      : [{ property: u.property, value: u.value as StyleValue }];

    for (const d of decls) {
      resolved.push({
        property: d.property,
        // coerce (unparsed → tuple/function/layers) THEN normalize colors to wire format.
        value: normalizeStyleValue(coerceStyleValue(d.property, d.value)),
        breakpointId: bp.id,
        state: u.state,
        listed: applyListedDefault(d.property, u.listed),
        bpLabel: u.breakpoint,
      });
    }
  }

  // Second pass: per (breakpointId, state) cohort, complete transition/animation longhands.
  const groupKey = (r: { breakpointId: string; state?: string }) => `${r.breakpointId}::${r.state ?? ""}`;
  const groups = new Map<string, Resolved[]>();
  for (const r of resolved) {
    const k = groupKey(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }

  for (const [, group] of groups) {
    const { breakpointId, state } = group[0];
    // Existing decls on the same target (token + bp + state-equivalent via stateMatches).
    // Tolerance lets us see decls with corrupted state ("::hover" when user wrote ":hover")
    // and feed their properties to the longhand completer.
    const existingDecls = build.styles
      .filter((s) =>
        s.styleSourceId === tokenId &&
        s.breakpointId === breakpointId &&
        stateMatches(s.state, state),
      )
      .map((s) => ({ property: s.property, value: s.value as StyleValue }));
    const incoming = group.map((g) => ({ property: g.property, value: g.value }));
    const completed = completeTransitionAnimationLonghands(existingDecls, incoming);

    for (const c of completed) {
      const matchedGroupEntry = group.find((g) => g.property === c.property);
      const listed = matchedGroupEntry?.listed;
      const newDecl: StyleDecl = {
        styleSourceId: tokenId,
        breakpointId,
        property: c.property,
        value: c.value,
        ...(state && { state }),
        ...(listed && { listed: true }),
      };
      // Identify exact-state match (canonical path target) and any corrupted variants
      // (state-equivalent via stateMatches but stored with a non-canonical state value).
      const exact = build.styles.find((s) =>
        s.styleSourceId === newDecl.styleSourceId &&
        s.breakpointId === newDecl.breakpointId &&
        s.property === newDecl.property &&
        (s.state ?? undefined) === (newDecl.state ?? undefined)
      );
      const corruptedVariants = build.styles.filter((s) =>
        s.styleSourceId === newDecl.styleSourceId &&
        s.breakpointId === newDecl.breakpointId &&
        s.property === newDecl.property &&
        (s.state ?? undefined) !== (newDecl.state ?? undefined) &&
        stateMatches(s.state, newDecl.state)
      );
      // Emit one `remove` patch per corrupted variant so the canonical write doesn't end up
      // as a duplicate sibling next to the corruption.
      for (const corr of corruptedVariants) {
        patches.push({ op: "remove", path: [styleKey(corr)] });
        details.push(`✂ removed corrupted variant ${corr.property} (state="${corr.state}") (${group[0].bpLabel})`);
      }
      const key = styleKey(newDecl);
      const op = exact ? "replace" : "add";
      patches.push({ op, path: [key], value: newDecl });
      const wasIncoming = !!matchedGroupEntry;
      const tag = wasIncoming ? "" : " (auto-completed)";
      details.push(`${op} ${c.property}${state ? `[${state}]` : ""} (${group[0].bpLabel})${tag}`);
    }
  }

  return {
    transaction: {
      id: `mcp-update-token-${txId()}`,
      payload: patches.length > 0 ? [{ namespace: "styles", patches }] : [],
    },
    details,
  };
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

export const updateTokenStylesTool: ToolModule = {
  definition: {
    name: "webstudio_update_token_styles",
    description: `Use when: edit a shared design TOKEN's decls (propagates to every instance using it). Sibling of webstudio_styles for the token side.
Do NOT use when: tweaking a single instance's LOCAL styles (use webstudio_styles), creating a new variant from N instances' overrides (use webstudio_extract_variant_token), renaming a token (use webstudio_replace_token rename mode or webstudio_rename_tokens), or removing a decl entirely (no direct tool — push a corrective value or delete the token).
Returns: dry-run report listing each patch (add/replace) per property/breakpoint/state with auto-completed transition/animation longhands tagged, or push result.
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default. Local overrides on instances are NOT touched — chain with webstudio_dedupe_token_locals after to clean now-redundant duplicates.

Resolve by tokenName (exact match) OR tokenId. breakpoint label case-insensitive. Same patch semantics as update_styles.

Example: { projectSlug: "acme", tokenName: "Color Primary", updates: [{ property: "color", value: { type: "rgb", r: 224, g: 123, b: 26, alpha: 1 } }], dryRun: true }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        tokenName: { type: "string", description: "Token display name (exact match). Provide tokenName OR tokenId." },
        tokenId: { type: "string", description: "StyleSource id of the token. Provide tokenName OR tokenId." },
        updates: {
          type: "array",
          items: {
            type: "object",
            properties: {
              property: { type: "string" },
              value: { type: "object" },
              breakpoint: { type: "string" },
              state: { type: "string" },
              listed: { type: "boolean" },
            },
            required: ["property", "value"],
          },
        },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug", "updates"],
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
    const parsed = updateTokenStylesInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const { projectSlug, tokenName, tokenId, updates, dryRun } = parsed.data;

    // Pre-flight: refuse shadow values that Webstudio Cloud silently drops
    // (e.g. boxShadow={type:"unparsed", value:"var(--xxx)"}). See lib/style-coerce.ts.
    for (const u of updates) {
      const verr = validateStyleValue(u.property, u.value as never);
      if (verr) {
        return errorResult("VALIDATION_FAILED", `Invalid style value on property ${u.property}: ${verr}`);
      }
    }

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

    const tx = buildUpdateTransaction(build, token.id, updates);
    const patchCount = tx.transaction.payload[0]?.patches.length ?? 0;

    if (patchCount === 0) {
      const hasFailure = tx.details.some((d) => d.startsWith("!"));
      if (hasFailure) {
        return errorResult("VALIDATION_FAILED", `No patches generated:\n${tx.details.join("\n")}`);
      }
      return textResult(`No-op (all updates already match):\n${tx.details.join("\n")}`);
    }

    if (dryRun) {
      return textResult(
        `DRY-RUN update_token_styles\n\nToken: "${token.name}" [${token.id}]\n\n${patchCount} patch(es) over ${updates.length} update(s):\n${tx.details.join("\n")}\n\nIf OK, re-run with dryRun=false.`,
      );
    }

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) =>
        buildUpdateTransaction(cur, token.id, updates).transaction,
      );
      return textResult(
        `Token "${token.name}" updated — version → ${finalVersion}\nstatus: ${result.status}\n\n${patchCount} decl(s) applied:\n${tx.details.join("\n")}`,
      );
    } catch (err) {
      return runtimeErrorResult(err, "Push failed");
    }
  },
};
