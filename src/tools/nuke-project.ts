// Tool: webstudio_nuke_project
//
// One-shot orchestrator that wipes a Webstudio Cloud project back to a near-empty state
// (home page kept by default, but stripped of its content). Replaces ~120 individual
// MCP calls (one per page / variable / asset / token / orphan) by a single, atomic
// (or near-atomic) operation built on top of the same BuildPatchTransaction primitive.
//
// Safety:
//   - Requires `confirm === projectSlug` (caller must literally type the slug again).
//   - dryRun=true by default; reports the full plan without pushing.
//   - Real run requires allowPush=true on the auth file.
//   - Optional `exportBackupTo` writes a full JSON snapshot to disk before any push.
//
// Architecture:
//   - 1st push: pages, instances/props/styleSourceSelections, folders, dataSources,
//     resources, assets, CSS vars, tokens (+ their styles) — all in one transaction.
//   - 2nd push (if scope.orphanLocals): a fresh fetch then orphan-locals cleanup.
//     Two passes because most orphans are *created* by the first push and can only be
//     enumerated reliably against the post-push build state.
//
// IMPORTANT: this tool is intentionally permissive once `confirm` matches — it is meant
// for empty-template reuse, not for trimming production sites.

import { promises as fs } from "node:fs";
import { z } from "zod";
import { customAlphabet } from "nanoid";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type {
  WebstudioBuild,
  BuildPatchOperation,
  BuildPatchChange,
  BuildPatchTransaction,
} from "../webstudio-client.js";
import { buildInstanceRemovalChanges, collectDescendantIds } from "../cleanup-helpers.js";
import { detectRootFolderId } from "./pages/folders-list.js";
import { dumpBuild, writeBuildDump, defaultExportPath } from "./export-project.js";

const txId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);

const ROOT_INSTANCE_ID = ":root";

// Max patches we squeeze into one BuildPatchTransaction before splitting. Webstudio's tRPC
// accepts very large transactions in practice, but we cap to keep individual requests reasonable
// and avoid tipping over any future limits.
const MAX_PATCHES_PER_TX = 10000;

const ScopeSchema = z
  .object({
    pages: z.boolean().default(true),
    folders: z.boolean().default(true),
    variables: z.boolean().default(true),
    resources: z.boolean().default(true),
    assets: z.boolean().default(true),
    cssVars: z.boolean().default(true),
    tokens: z.boolean().default(true),
    orphanLocals: z.boolean().default(true),
  }).strict()
  .default({
    pages: true, folders: true, variables: true, resources: true,
    assets: true, cssVars: true, tokens: true, orphanLocals: true,
  });

export const nukeProjectInputSchema = z.object({
  projectSlug: z.string(),
  /** Must equal projectSlug verbatim. The single most important safety guard. */
  confirm: z.string(),
  /** Keep the home page entry in build.pages.pages, but wipe its content tree. Default true. */
  keepHomeEmpty: z.boolean().default(true),
  scope: ScopeSchema,
  dryRun: z.boolean().default(true),
  /** If set AND dryRun=false: dump full build to this path BEFORE pushing anything. */
  exportBackupTo: z.string().optional(),
}).strict();

type DataSourceLite = { id: string; type: string; resourceId?: string; name?: string };
type ResourceLite = { id: string; name?: string };
type AssetLite = { id: string; name?: string };
type FolderLite = { id: string; name?: string; children: string[] };

// ─── Plan computation ─────────────────────────────────────────────────────────

type NukePlan = {
  before: Counts;
  pageIdsToDelete: string[];
  instanceIdsToDelete: Set<string>;
  /** Patches to apply on the home root's `children` when keepHomeEmpty (empty array replacement). */
  homeRootChildrenReset?: { rootInstanceId: string };
  folderIdsToDelete: string[];
  rootFolderId?: string;
  rootFolderChildrenAfter?: string[];
  dataSourceIdsToDelete: string[]; // variables + resource-linked dataSources (per scope)
  resourceIdsToDelete: string[];
  assetIdsToDelete: string[];
  /** CSS var :root style decl rows (path strings) to remove. */
  cssVarStylePaths: string[];
  /** Token styleSources to remove. */
  tokenIdsToDelete: string[];
  /** Token style decl rows (path strings) to remove. */
  tokenStylePaths: string[];
};

type Counts = {
  pages: number;
  folders: number;
  instances: number;
  props: number;
  styleSources: number;
  styles: number;
  styleSourceSelections: number;
  dataSources: number;
  resources: number;
  assets: number;
};

function snapshotCounts(build: WebstudioBuild): Counts {
  return {
    pages: build.pages.pages.length,
    folders: (build.pages.folders as unknown[]).length,
    instances: build.instances.length,
    props: build.props.length,
    styleSources: build.styleSources.length,
    styles: build.styles.length,
    styleSourceSelections: build.styleSourceSelections.length,
    dataSources: (build.dataSources as unknown[]).length,
    resources: (build.resources as unknown[]).length,
    assets: (build.assets as unknown[]).length,
  };
}

function buildPlan(build: WebstudioBuild, args: z.infer<typeof nukeProjectInputSchema>): NukePlan {
  const homePageId = build.pages.homePageId;
  const folders = (build.pages.folders as FolderLite[]) ?? [];
  const dataSources = (build.dataSources as DataSourceLite[]) ?? [];
  const resources = (build.resources as ResourceLite[]) ?? [];
  const assets = (build.assets as AssetLite[]) ?? [];

  // ── Pages: every page except the home (home is never deleted) ──────────────
  const pageIdsToDelete = args.scope.pages
    ? build.pages.pages.filter((p) => p.id !== homePageId).map((p) => p.id)
    : [];

  // ── Instances to delete ────────────────────────────────────────────────────
  // For each deleted page: collect its root + descendants.
  // For the kept home page (keepHomeEmpty): collect ALL descendants of the home root
  // and exclude the root itself (we keep the root, just zero its children).
  const instanceIdsToDelete = new Set<string>();
  let homeRootChildrenReset: NukePlan["homeRootChildrenReset"] | undefined;

  if (args.scope.pages) {
    for (const p of build.pages.pages) {
      if (p.id === homePageId) continue;
      for (const id of collectDescendantIds(p.rootInstanceId, build.instances)) {
        instanceIdsToDelete.add(id);
      }
    }
  }

  // Helper: only emit a children-reset patch if the home root currently HAS children.
  // Otherwise the `replace` no-ops on Webstudio but still counts as a non-zero plan,
  // which makes the drain loop spin forever.
  const homeRootHasChildren = (rootId: string): boolean => {
    const root = build.instances.find((i) => i.id === rootId);
    return !!root && Array.isArray(root.children) && root.children.length > 0;
  };

  if (args.keepHomeEmpty) {
    const home = build.pages.pages.find((p) => p.id === homePageId);
    if (home) {
      // All descendants EXCLUDING the root itself.
      const all = collectDescendantIds(home.rootInstanceId, build.instances);
      for (const id of all) {
        if (id !== home.rootInstanceId) instanceIdsToDelete.add(id);
      }
      if (homeRootHasChildren(home.rootInstanceId)) {
        homeRootChildrenReset = { rootInstanceId: home.rootInstanceId };
      }
    }
  } else if (args.scope.pages) {
    // No keepHomeEmpty AND pages scoped → caller is asking to wipe home too,
    // but Webstudio won't allow deleting the home page itself. We still wipe its content
    // (same as keepHomeEmpty=true) — there is no safe alternative.
    const home = build.pages.pages.find((p) => p.id === homePageId);
    if (home) {
      const all = collectDescendantIds(home.rootInstanceId, build.instances);
      for (const id of all) {
        if (id !== home.rootInstanceId) instanceIdsToDelete.add(id);
      }
      if (homeRootHasChildren(home.rootInstanceId)) {
        homeRootChildrenReset = { rootInstanceId: home.rootInstanceId };
      }
    }
  }

  // ── Folders ────────────────────────────────────────────────────────────────
  // Never delete the root folder. Reset its `children` to `[homePageId]` only.
  let folderIdsToDelete: string[] = [];
  let rootFolderId: string | undefined;
  let rootFolderChildrenAfter: string[] | undefined;

  if (args.scope.folders) {
    rootFolderId = detectRootFolderId(build);
    if (rootFolderId) {
      folderIdsToDelete = folders.filter((f) => f.id !== rootFolderId).map((f) => f.id);
      // After: root contains only the home page (any other pages are deleted).
      // Only set the patch if root.children is NOT already `[homePageId]` exactly — otherwise
      // we'd emit a no-op `replace` every drain iteration and the loop never converges.
      const rootFolder = folders.find((f) => f.id === rootFolderId);
      const currentChildren = (rootFolder?.children as string[] | undefined) ?? [];
      const alreadyTarget =
        currentChildren.length === 1 && currentChildren[0] === homePageId;
      if (!alreadyTarget) {
        rootFolderChildrenAfter = [homePageId];
      }
    }
  }

  // ── DataSources & Resources ────────────────────────────────────────────────
  // Variables: dataSources of type !== "resource" (typically "variable"; legacy "parameter" left alone unless explicit).
  // Resources: the resource entries + their linked dataSources (type="resource").
  const dataSourceIdsToDelete: string[] = [];
  if (args.scope.variables) {
    for (const ds of dataSources) {
      if (ds.type === "variable") dataSourceIdsToDelete.push(ds.id);
    }
  }
  const resourceIdsToDelete = args.scope.resources ? resources.map((r) => r.id) : [];
  if (args.scope.resources) {
    for (const ds of dataSources) {
      if (ds.type === "resource") dataSourceIdsToDelete.push(ds.id);
    }
  }

  // ── Assets ─────────────────────────────────────────────────────────────────
  const assetIdsToDelete = args.scope.assets ? assets.map((a) => a.id) : [];

  // ── CSS vars (:root local sources) ─────────────────────────────────────────
  const cssVarStylePaths: string[] = [];
  if (args.scope.cssVars) {
    const rootSel = build.styleSourceSelections.find((s) => s.instanceId === ROOT_INSTANCE_ID);
    const rootSourceIds = new Set(
      (rootSel?.values ?? []).filter(
        (v) => build.styleSources.find((s) => s.id === v)?.type === "local",
      ),
    );
    for (const d of build.styles) {
      if (rootSourceIds.has(d.styleSourceId) && d.property.startsWith("--")) {
        cssVarStylePaths.push(`${d.styleSourceId}:${d.breakpointId}:${d.property}:${d.state ?? ""}`);
      }
    }
  }

  // ── Tokens ─────────────────────────────────────────────────────────────────
  const tokenIdsToDelete: string[] = [];
  const tokenStylePaths: string[] = [];
  if (args.scope.tokens) {
    const tokenIds = new Set<string>();
    for (const s of build.styleSources) {
      if (s.type === "token") {
        tokenIds.add(s.id);
        tokenIdsToDelete.push(s.id);
      }
    }
    for (const d of build.styles) {
      if (tokenIds.has(d.styleSourceId)) {
        tokenStylePaths.push(`${d.styleSourceId}:${d.breakpointId}:${d.property}:${d.state ?? ""}`);
      }
    }
  }

  return {
    before: snapshotCounts(build),
    pageIdsToDelete,
    instanceIdsToDelete,
    homeRootChildrenReset,
    folderIdsToDelete,
    rootFolderId,
    rootFolderChildrenAfter,
    dataSourceIdsToDelete,
    resourceIdsToDelete,
    assetIdsToDelete,
    cssVarStylePaths,
    tokenIdsToDelete,
    tokenStylePaths,
  };
}

// ─── Transaction assembly ─────────────────────────────────────────────────────

/**
 * Build the main destructive transaction (everything EXCEPT orphan-local cleanup).
 *
 * Patch order is informational — Webstudio applies the entire transaction atomically.
 * We keep a logical order that mirrors the dependency graph (children before parents).
 */
function buildMainTransaction(build: WebstudioBuild, plan: NukePlan): BuildPatchTransaction {
  const payload: BuildPatchChange[] = [];

  // 1. Instances + props + styleSourceSelections — via shared helper.
  if (plan.instanceIdsToDelete.size > 0) {
    // Synthesize a "virtual root list" so the helper traverses only the ids we want.
    // We use rootIds = collected descendants directly. The helper re-collects descendants
    // from the build graph; pages already deleted contribute their full sub-trees.
    // For correctness we feed the actual root instance ids of pages to delete + the home
    // root (if keepHomeEmpty) so the walk reaches everything reachable.
    const rootInstanceIds = new Set<string>();
    for (const p of build.pages.pages) {
      if (plan.pageIdsToDelete.includes(p.id)) rootInstanceIds.add(p.rootInstanceId);
    }
    if (plan.homeRootChildrenReset) rootInstanceIds.add(plan.homeRootChildrenReset.rootInstanceId);
    const removalChanges = buildInstanceRemovalChanges(build, [...rootInstanceIds]);

    // If keepHomeEmpty: filter the home root OUT of the instances removal list
    // (we only want to clear its children, not delete it).
    if (plan.homeRootChildrenReset) {
      const homeRoot = plan.homeRootChildrenReset.rootInstanceId;
      for (const ch of removalChanges) {
        if (ch.namespace === "instances") {
          ch.patches = ch.patches.filter((p) => p.path[0] !== homeRoot);
        }
        if (ch.namespace === "styleSourceSelections") {
          // Likewise keep the home root selection (it may legitimately stay).
          ch.patches = ch.patches.filter((p) => p.path[0] !== homeRoot);
        }
        // props on the home root itself are unlikely to be relevant; they get removed too.
      }
    }
    payload.push(...removalChanges);
  }

  // 2. Home root children reset to [] (only if we're keeping the home page).
  if (plan.homeRootChildrenReset) {
    payload.push({
      namespace: "instances",
      patches: [
        {
          op: "replace",
          path: [plan.homeRootChildrenReset.rootInstanceId, "children"],
          value: [],
        },
      ],
    });
  }

  // 3. Pages: remove each page entry.
  if (plan.pageIdsToDelete.length > 0) {
    payload.push({
      namespace: "pages",
      patches: plan.pageIdsToDelete.map((id) => ({
        op: "remove" as const,
        path: ["pages", id],
      })),
    });
  }

  // 4. Folders: remove all non-root folders + reset root.children.
  if (plan.folderIdsToDelete.length > 0 && plan.rootFolderId) {
    const folderPatches: BuildPatchOperation[] = plan.folderIdsToDelete.map((id) => ({
      op: "remove" as const,
      path: ["folders", id],
    }));
    folderPatches.push({
      op: "replace",
      path: ["folders", plan.rootFolderId, "children"],
      value: plan.rootFolderChildrenAfter ?? [],
    });
    payload.push({ namespace: "pages", patches: folderPatches });
  } else if (plan.rootFolderId && plan.rootFolderChildrenAfter) {
    // No subfolder to delete but we still want to trim root.children (e.g. remove deleted pages).
    payload.push({
      namespace: "pages",
      patches: [{
        op: "replace",
        path: ["folders", plan.rootFolderId, "children"],
        value: plan.rootFolderChildrenAfter,
      }],
    });
  }

  // 5. DataSources (variables + resource-linked).
  if (plan.dataSourceIdsToDelete.length > 0) {
    payload.push({
      namespace: "dataSources",
      patches: plan.dataSourceIdsToDelete.map((id) => ({ op: "remove" as const, path: [id] })),
    });
  }

  // 6. Resources.
  if (plan.resourceIdsToDelete.length > 0) {
    payload.push({
      namespace: "resources",
      patches: plan.resourceIdsToDelete.map((id) => ({ op: "remove" as const, path: [id] })),
    });
  }

  // 7. Assets.
  if (plan.assetIdsToDelete.length > 0) {
    payload.push({
      namespace: "assets",
      patches: plan.assetIdsToDelete.map((id) => ({ op: "remove" as const, path: [id] })),
    });
  }

  // 8. CSS var :root style rows.
  if (plan.cssVarStylePaths.length > 0) {
    payload.push({
      namespace: "styles",
      patches: plan.cssVarStylePaths.map((p) => ({ op: "remove" as const, path: [p] })),
    });
  }

  // 9. Token style rows (decls) THEN styleSources.
  if (plan.tokenStylePaths.length > 0) {
    payload.push({
      namespace: "styles",
      patches: plan.tokenStylePaths.map((p) => ({ op: "remove" as const, path: [p] })),
    });
  }
  if (plan.tokenIdsToDelete.length > 0) {
    payload.push({
      namespace: "styleSources",
      patches: plan.tokenIdsToDelete.map((id) => ({ op: "remove" as const, path: [id] })),
    });
  }

  return { id: `mcp-nuke-${txId()}`, payload };
}

/**
 * Split a transaction into N transactions whose patch totals stay below `maxPatches`.
 * Splits between BuildPatchChange entries — never inside one (a single namespace's patches
 * stay together to preserve Webstudio's intra-namespace ordering semantics).
 *
 * If even one BuildPatchChange exceeds maxPatches alone it stays as one tx (Webstudio
 * accepts it; this only ever happens for very large instance dumps).
 */
function splitTransaction(tx: BuildPatchTransaction, maxPatches: number): BuildPatchTransaction[] {
  const out: BuildPatchTransaction[] = [];
  let bucket: BuildPatchChange[] = [];
  let count = 0;
  let part = 0;
  for (const change of tx.payload) {
    const size = change.patches.length;
    if (count > 0 && count + size > maxPatches) {
      out.push({ id: `${tx.id}-p${part++}`, payload: bucket });
      bucket = [];
      count = 0;
    }
    bucket.push(change);
    count += size;
  }
  if (bucket.length > 0) out.push({ id: `${tx.id}-p${part}`, payload: bucket });
  return out;
}

/** Build the orphan-local cleanup transaction against a fresh build state. */
function buildOrphanLocalsTransaction(build: WebstudioBuild): BuildPatchTransaction | null {
  const usedSourceIds = new Set<string>();
  for (const sel of build.styleSourceSelections) {
    for (const v of sel.values ?? []) usedSourceIds.add(v);
  }
  const orphans = build.styleSources.filter((s) => s.type === "local" && !usedSourceIds.has(s.id));
  if (orphans.length === 0) return null;

  const orphanIds = new Set(orphans.map((s) => s.id));
  const orphanDecls = build.styles.filter((d) => orphanIds.has(d.styleSourceId));

  const payload: BuildPatchChange[] = [];
  if (orphanDecls.length > 0) {
    payload.push({
      namespace: "styles",
      patches: orphanDecls.map((d) => ({
        op: "remove" as const,
        path: [`${d.styleSourceId}:${d.breakpointId}:${d.property}:${d.state ?? ""}`],
      })),
    });
  }
  payload.push({
    namespace: "styleSources",
    patches: orphans.map((s) => ({ op: "remove" as const, path: [s.id] })),
  });
  return { id: `mcp-nuke-orphans-${txId()}`, payload };
}

// ─── Reporting ────────────────────────────────────────────────────────────────

function planTotalPatches(tx: BuildPatchTransaction): number {
  return tx.payload.reduce((s, c) => s + c.patches.length, 0);
}

function renderPlanReport(plan: NukePlan, args: z.infer<typeof nukeProjectInputSchema>, tx: BuildPatchTransaction): string {
  const total = planTotalPatches(tx);
  const lines: string[] = [];
  lines.push(`Plan summary  (scope: ${Object.entries(args.scope).filter(([, v]) => v).map(([k]) => k).join(", ")})`);
  lines.push(`  pages to delete:           ${plan.pageIdsToDelete.length}  (home${args.keepHomeEmpty ? " kept, content wiped" : " kept — Webstudio refuses to delete it"})`);
  lines.push(`  instances to delete:       ${plan.instanceIdsToDelete.size}${plan.homeRootChildrenReset ? "  (home root preserved)" : ""}`);
  lines.push(`  folders to delete:         ${plan.folderIdsToDelete.length}${plan.rootFolderId ? "  (root kept, children reset to [homePageId])" : ""}`);
  lines.push(`  dataSources to delete:     ${plan.dataSourceIdsToDelete.length}`);
  lines.push(`  resources to delete:       ${plan.resourceIdsToDelete.length}`);
  lines.push(`  assets to delete:          ${plan.assetIdsToDelete.length}`);
  lines.push(`  CSS var decls to delete:   ${plan.cssVarStylePaths.length}`);
  lines.push(`  tokens to delete:          ${plan.tokenIdsToDelete.length}  (+ ${plan.tokenStylePaths.length} decl rows)`);
  lines.push(`  orphan-locals pass:        ${args.scope.orphanLocals ? "yes (run after main push, on fresh build)" : "skipped"}`);
  lines.push(``);
  lines.push(`Total patches in main tx:    ${total}${total > MAX_PATCHES_PER_TX ? ` → will split into ${Math.ceil(total / MAX_PATCHES_PER_TX)} chunks` : ""}`);
  return lines.join("\n");
}

function renderBeforeAfter(before: Counts, after: Counts): string {
  const fmt = (k: keyof Counts) =>
    `  ${k.padEnd(24)} ${String(before[k]).padStart(6)}  →  ${String(after[k]).padStart(6)}  (Δ ${after[k] - before[k]})`;
  return [
    fmt("pages"),
    fmt("folders"),
    fmt("instances"),
    fmt("props"),
    fmt("styleSources"),
    fmt("styles"),
    fmt("styleSourceSelections"),
    fmt("dataSources"),
    fmt("resources"),
    fmt("assets"),
  ].join("\n");
}

// ─── Tool ────────────────────────────────────────────────────────────────────

export const nukeProjectTool: ToolModule = {
  definition: {
    name: "webstudio_nuke_project",
    description: `Use when: reset a Webstudio Cloud project to a near-empty state (template reuse, full wipe before re-import). One-shot orchestrator replacing ~120 individual delete calls.
*** DANGER — DESTRUCTIVE *** Deletes pages, instances, folders, variables, resources, assets, CSS vars, tokens in a single atomic transaction. The home page entry is preserved (Webstudio refuses to delete it) but its content is wiped.
Do NOT use when: you want to trim a production site — this is for template reuse, NOT selective cleanup. For pages use webstudio_delete_pages, for 1 resource use webstudio_delete_resource, for a batch of variables use webstudio_delete_variables.
Returns: { before, after } counts + plan report + orphan-locals pass result. Splits into chunks if > 10000 patches.
Side effects: push to Webstudio Cloud (requires allowPush). Safety guards: (1) confirm MUST equal projectSlug verbatim or refuses; (2) dryRun=true by default; (3) optional exportBackupTo writes a full JSON dump BEFORE push (refuses to push if backup fails).

Example DRY-RUN: { projectSlug: "my-site", confirm: "my-site" }
Example REAL: { projectSlug: "my-site", confirm: "my-site", dryRun: false, exportBackupTo: "/tmp/my-site-pre-nuke.json" }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        confirm: { type: "string", description: "Must equal projectSlug verbatim." },
        keepHomeEmpty: { type: "boolean", description: "Default true. Keeps the home page entry; wipes its content." },
        scope: {
          type: "object",
          properties: {
            pages: { type: "boolean" },
            folders: { type: "boolean" },
            variables: { type: "boolean" },
            resources: { type: "boolean" },
            assets: { type: "boolean" },
            cssVars: { type: "boolean" },
            tokens: { type: "boolean" },
            orphanLocals: { type: "boolean" },
          },
        },
        dryRun: { type: "boolean" },
        exportBackupTo: { type: "string", description: "Optional file path for a pre-nuke JSON backup (created if missing)." },
      },
      required: ["projectSlug", "confirm"],
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
    const parsed = nukeProjectInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const data = parsed.data;

    // ── HARD SAFETY: confirm must equal projectSlug — checked BEFORE anything else.
    if (data.confirm !== data.projectSlug) {
      return errorResult(
        "VALIDATION_FAILED",
        `confirm must equal projectSlug for safety (got confirm="${data.confirm}", projectSlug="${data.projectSlug}").`,
      );
    }

    let auth;
    try {
      auth = data.dryRun ? requireAuth(data.projectSlug) : requirePushAuth(data.projectSlug);
    } catch (err) {
      return authErrorResult(err);
    }

    let build: WebstudioBuild;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    const plan = buildPlan(build, data);
    const mainTx = buildMainTransaction(build, plan);
    const planReport = renderPlanReport(plan, data, mainTx);

    if (data.dryRun) {
      return textResult(
        `DRY-RUN nuke_project — project "${data.projectSlug}" (${build.project?.title ?? "?"})\n\n${planReport}\n\nIf OK, re-run with dryRun=false (requires allowPush=true).`,
      );
    }

    // ── Optional backup BEFORE any destructive push.
    let backupNote = "";
    if (data.exportBackupTo) {
      try {
        const dump = dumpBuild(build, data.projectSlug);
        const target = data.exportBackupTo || defaultExportPath(data.projectSlug);
        const w = await writeBuildDump(dump, target, true);
        backupNote = `\nBackup written: ${w.absPath}  (${w.sizeMB.toFixed(2)} MB)`;
      } catch (err) {
        return runtimeErrorResult(err, "Backup write failed (refusing to push without successful backup)");
      }
    }

    // ── Push main transaction (drain loop — handles split internally).
    //
    // FIX 2026-05-20: the previous strategy iterated `for (i = 0; i < chunks.length; i++)`
    // and used `freshChunks[i]` after each push. But re-fetching between pushes shrinks the
    // remaining plan, so freshChunks ends up SHORTER than chunks → indices i≥1 become
    // `undefined` → silent no-op. Result: only the first chunk ever landed (instances), all
    // remaining work (pages, folders, dataSources, resources, assets, cssvars, tokens)
    // was skipped. We now drain: re-fetch + re-plan + push the FIRST chunk each iteration
    // until the plan is empty. Bounded by a safety cap to avoid infinite loops on pathological
    // partial-apply scenarios.
    let lastVersion = build.version;
    const MAX_DRAIN_ITERATIONS = 50;
    let iteration = 0;
    let lastStatus: string = "ok";
    try {
      while (iteration < MAX_DRAIN_ITERATIONS) {
        iteration++;
        let drained = false;
        const { result, finalVersion } = await pushWithRetry(auth, (cur) => {
          const freshPlan = buildPlan(cur, data);
          const freshFull = buildMainTransaction(cur, freshPlan);
          if (planTotalPatches(freshFull) === 0) {
            drained = true;
            return { id: `mcp-nuke-drained-${txId()}`, payload: [] };
          }
          const freshChunks = splitTransaction(freshFull, MAX_PATCHES_PER_TX);
          return freshChunks[0];
        });
        lastVersion = finalVersion;
        lastStatus = result.status;
        if (drained) break;
        if (result.status !== "ok" && result.status !== "partial") {
          return runtimeErrorResult(new Error(`Push status: ${result.status}`), "Push failed");
        }
      }
      if (iteration >= MAX_DRAIN_ITERATIONS) {
        return runtimeErrorResult(
          new Error(`Drain loop hit safety cap of ${MAX_DRAIN_ITERATIONS} iterations (last status: ${lastStatus})`),
          "Main nuke push failed",
        );
      }
    } catch (err) {
      return runtimeErrorResult(err, "Main nuke push failed");
    }

    // ── 2nd pass: orphan-local cleanup against fresh build.
    let orphanReport = "";
    if (data.scope.orphanLocals) {
      try {
        const { result, finalVersion } = await pushWithRetry(auth, (cur) => {
          const tx = buildOrphanLocalsTransaction(cur);
          return tx ?? { id: `mcp-nuke-orphans-noop-${txId()}`, payload: [] };
        });
        if (result.status === "ok" || result.status === "partial") {
          lastVersion = finalVersion;
          orphanReport = `\nOrphan-locals pass: ok (version → ${finalVersion}).`;
        } else {
          orphanReport = `\nOrphan-locals pass: ${result.status}.`;
        }
      } catch (err) {
        orphanReport = `\nOrphan-locals pass FAILED: ${(err as Error).message}`;
      }
    }

    // ── After-state snapshot for the diff.
    let after: Counts;
    try {
      const fresh = await fetchBuild(auth);
      after = snapshotCounts(fresh);
    } catch {
      // Best-effort; if refetch fails we still report the plan-side numbers.
      after = plan.before;
    }

    return textResult(
      `Project "${data.projectSlug}" NUKED — version → ${lastVersion}${backupNote}

${planReport}

Before → After:
${renderBeforeAfter(plan.before, after)}
${orphanReport}`,
    );
  },
};
