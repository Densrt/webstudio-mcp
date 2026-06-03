// Tool: webstudio_rename_tokens
//
// Apply a regex-based rename to many tokens at once. Useful for:
//   - Removing a redundant prefix from all tokens (e.g. project name when scoped to that project)
//   - Renaming a family of tokens (e.g. "Texte" → "Text")
//   - Migrating naming conventions
//
// Read tokens, apply the regex, push only the renames that changed.

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type { WebstudioBuild, BuildPatchOperation } from "../webstudio-client.js";
import { customAlphabet } from "nanoid";

const txId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);

export const bulkRenameTokensInputSchema = z.object({
  projectSlug: z.string(),
  /** Regex source (JS syntax). Tested against the current token name. Example: "^MyBrand "  */
  fromPattern: z.string(),
  /** Replacement string. Supports JS replacement syntax ($1, $2). Example: ""  */
  toReplacement: z.string(),
  /** Regex flags (default "g" — replace all occurrences in name). */
  flags: z.string().default("g"),
  /** Restrict to tokens whose CURRENT name matches this substring filter (case-insensitive). Optional. */
  nameContains: z.string().optional(),
  /** Verbose: list each rename. Default true (this tool's purpose is to show them). */
  verbose: z.boolean().default(true),
  dryRun: z.boolean().default(true),
}).strict();

function buildChanges(build: WebstudioBuild, args: z.infer<typeof bulkRenameTokensInputSchema>) {
  let regex: RegExp;
  try { regex = new RegExp(args.fromPattern, args.flags); }
  catch (err) { throw new Error(`Invalid regex "${args.fromPattern}" with flags "${args.flags}": ${(err as Error).message}`); }

  const tokens = build.styleSources.filter(
    (s): s is typeof s & { type: "token"; name: string } => s.type === "token",
  );
  const filterLower = args.nameContains?.toLowerCase();

  const renames: Array<{ id: string; from: string; to: string }> = [];
  const conflicts: Array<{ from: string; to: string }> = [];
  const existingNames = new Set(tokens.map((t) => t.name));

  for (const t of tokens) {
    if (filterLower && !t.name.toLowerCase().includes(filterLower)) continue;
    const newName = t.name.replace(regex, args.toReplacement);
    if (newName === t.name) continue;
    if (newName.length === 0) {
      conflicts.push({ from: t.name, to: "(empty)" });
      continue;
    }
    // Conflict: the new name is already taken by another token (and won't itself be renamed away)
    if (existingNames.has(newName)) {
      const otherTok = tokens.find((x) => x.name === newName);
      const otherWillBeRenamed = otherTok && otherTok.name.replace(regex, args.toReplacement) !== otherTok.name;
      if (!otherWillBeRenamed) {
        conflicts.push({ from: t.name, to: newName });
        continue;
      }
    }
    renames.push({ id: t.id, from: t.name, to: newName });
  }

  // styleSources patches: replace each renamed token's name
  const styleSourcePatches: BuildPatchOperation[] = renames.map((r) => {
    const tok = tokens.find((t) => t.id === r.id)!;
    return { op: "replace", path: [r.id], value: { ...tok, name: r.to } };
  });

  return { renames, conflicts, styleSourcePatches };
}

export const bulkRenameTokensTool: ToolModule = {
  definition: {
    name: "webstudio_rename_tokens",
    description: `Use when: regex-rename many tokens at once — renames the NAMES (display labels) without touching selections, decls, or instances. Use for stripping a prefix, renaming a family, migrating a naming convention.
Do NOT use when: swapping selection REFERENCES from token A to token B (use webstudio_replace_token), editing a token's STYLE DECLS (use webstudio_update_token_styles), or renaming CSS var references (use webstudio_css_var).
Returns: dry-run with { renames: [{from, to}], conflicts: [{from, to}] }. Conflicts (target name already taken by a non-renamed token) are listed and skipped, not aborted.
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default.

fromPattern is a JS regex SOURCE (no leading/trailing slash); toReplacement supports $1/$2 backrefs; flags default "g". nameContains restricts scope to names containing the substring (case-insensitive).

Example: { projectSlug: "acme", fromPattern: "^Acme Color ", toReplacement: "Color ", dryRun: true }
Example: { projectSlug: "my-site", fromPattern: "Texte", toReplacement: "Text", nameContains: "Texte" }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        fromPattern: { type: "string" },
        toReplacement: { type: "string" },
        flags: { type: "string" },
        nameContains: { type: "string" },
        verbose: { type: "boolean" },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug", "fromPattern", "toReplacement"],
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
    const parsed = bulkRenameTokensInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const data = parsed.data;

    let auth;
    try { auth = data.dryRun ? requireAuth(data.projectSlug) : requirePushAuth(data.projectSlug); }
    catch (err) { return authErrorResult(err); }

    let build;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    let r;
    try { r = buildChanges(build, data); }
    catch (err) { return errorResult("VALIDATION_FAILED", (err as Error).message); }

    const lines: string[] = [];
    lines.push(`Renames: ${r.renames.length} | Conflicts: ${r.conflicts.length}`);
    if (data.verbose) {
      lines.push("");
      for (const ren of r.renames) lines.push(`  ✓ "${ren.from}" → "${ren.to}"`);
      if (r.conflicts.length) {
        lines.push("");
        lines.push(`Conflicts (skipped):`);
        for (const c of r.conflicts) lines.push(`  ✗ "${c.from}" → "${c.to}"  (target already exists)`);
      }
    }
    const summary = lines.join("\n");

    if (data.dryRun) return textResult(`DRY-RUN bulk_rename_tokens\n\n${summary}\n\nIf OK, re-run with dryRun=false.`);
    if (r.styleSourcePatches.length === 0) return textResult(`No-op (nothing to rename):\n\n${summary}`);

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) => {
        const re = buildChanges(cur, data);
        const payload = [{ namespace: "styleSources" as const, patches: re.styleSourcePatches }];
        return { id: `mcp-bulk-rename-${txId()}`, payload };
      });
      return textResult(`Renames pushed — version → ${finalVersion}\nstatus: ${result.status}\n\n${summary}`);
    } catch (err) {
      return runtimeErrorResult(err, "Bulk rename failed");
    }
  },
};
