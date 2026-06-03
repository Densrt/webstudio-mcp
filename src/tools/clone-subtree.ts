// Tool: webstudio_clone_subtree — clone an instance subtree to another location
// with full ID remap (instances + local style sources). Tokens are preserved.
//
// Three target forms (mutually exclusive — provide exactly one):
//   - targetInstanceId        : direct atomic clone (source + target instanceIds known)
//   - targetAnchor            : single page target identified by {pagePath|pageId, label, tag?}
//   - targetAnchors           : N page targets (batch mode with refetch+retry per target)
//
// Modes:
//   - append (default) : add cloned children at the end of target's existing children
//   - prepend          : insert cloned children at the beginning
//   - replace          : delete target's existing children first
//
// What gets cloned (with new IDs): instances, their props, local style sources + their styles,
// styleSourceSelections (with token IDs preserved as-is), dataSources/resources scoped on
// cloned instances.

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type { WebstudioBuild } from "../webstudio-client.js";
import { buildCloneSubtreeChanges } from "../clone-helpers.js";
import { logCoerce } from "../lib/telemetry.js";
import { customAlphabet } from "nanoid";

const txId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);

const targetAnchorSchema = z
  .object({
    pagePath: z.string().optional(),
    pageId: z.string().optional(),
    label: z.string().default("main"),
    tag: z.string().optional(),
  })
  .strict()
  .refine((d) => Boolean(d.pagePath || d.pageId), {
    message: "targetAnchor requires pagePath or pageId",
  });

export type TargetAnchor = z.infer<typeof targetAnchorSchema>;

export const cloneSubtreeInputSchema = z
  .object({
    projectSlug: z.string(),
    /** Source instance — see `includeSource` for whether the instance itself is cloned. */
    sourceInstanceId: z.string(),
    /** Atomic target: provide an instanceId directly (caller already knows it). */
    targetInstanceId: z.string().optional(),
    /** Single-page target identified by an anchor (label, optional tag) on a page. */
    targetAnchor: targetAnchorSchema.optional(),
    /** Multi-page batch: N anchors, processed with refetch+retry per target. */
    targetAnchors: z.array(targetAnchorSchema).optional(),
    /** "append" (default): add to end. "prepend": add to beginning. "replace": delete existing first. */
    mode: z.enum(["append", "prepend", "replace"]).default("append"),
    /** When false (default): clone CHILDREN of sourceInstanceId only — historical "regenerate
     *  contents of a container template" semantics, used by the clone_page legacy wrapper.
     *  When true: include sourceInstanceId itself as the root of the cloned subtree — natural
     *  "clone this section into that target" semantics. Cannot combine with skipChildLabels. */
    includeSource: z.boolean().default(false),
    /** Skip top-level source children whose label matches one of these. Only valid when
     *  includeSource:false. */
    skipChildLabels: z.array(z.string()).optional(),
    dryRun: z.boolean().default(true),
  })
  .strict()
  .superRefine((data, ctx) => {
    const forms = [data.targetInstanceId, data.targetAnchor, data.targetAnchors];
    const count = forms.filter((x) => x !== undefined).length;
    if (count === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide exactly one of: targetInstanceId, targetAnchor, targetAnchors.",
      });
    }
    if (count > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide ONLY one of: targetInstanceId, targetAnchor, targetAnchors (mutually exclusive).",
      });
    }
    if (data.targetAnchors && data.targetAnchors.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "targetAnchors must contain at least one entry.",
      });
    }
    if (data.includeSource && data.skipChildLabels && data.skipChildLabels.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Cannot combine includeSource:true with skipChildLabels. Either clone the entire source subtree (includeSource:true, skipChildLabels:[]) or clone selected children (includeSource:false, skipChildLabels:[...]).",
      });
    }
  });

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

export type PageRef = { id: string; name: string; path: string; rootInstanceId: string };

export function resolvePage(build: WebstudioBuild, byPath?: string, byId?: string): PageRef | null {
  for (const p of build.pages.pages) {
    if (byId && p.id === byId) return p;
    if (byPath && p.path === byPath) return p;
  }
  return null;
}

export function findAnchor(
  build: WebstudioBuild,
  page: PageRef,
  label: string,
  tag?: string,
): string | null {
  const instById = new Map(build.instances.map((i) => [i.id, i]));
  const stack = [page.rootInstanceId];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const inst = instById.get(id);
    if (!inst) continue;
    if (inst.label === label && (!tag || inst.tag === tag)) return id;
    for (const c of inst.children ?? []) {
      if (c.type === "id") stack.push(c.value);
    }
  }
  return null;
}

export type TargetOutcome =
  | {
      pageRef: string;
      status: "ok";
      summary: ReturnType<typeof buildCloneSubtreeChanges>["summary"];
      patchCount: number;
      finalVersion?: number;
    }
  | { pageRef: string; status: "skipped"; reason: string; hint?: string };

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const cloneSubtreeTool: ToolModule = {
  definition: {
    name: "webstudio_clone_subtree",
    description: `Use when: duplicate an instance's CHILDREN (subset of a tree) to one or many targets with new IDs (instances, props, local styleSources, styles, selections, dataSources, resources all remapped).
Targets (exactly one): (a) targetInstanceId — atomic same-build target (caller already knows the id); (b) targetAnchor: {pagePath|pageId, label, tag?} — single-page anchor lookup; (c) targetAnchors: [{...}, ...] — multi-page batch with per-target refetch+retry (replaces clone_page).
Do NOT use when: (a) you want a fresh page from scratch — use pages.create / pages.duplicate; (b) you want to SHARE a Slot across pages (DAG, edits propagate) — use share_slot_to_page; (c) you want to add a single brand-new child — use append_child.
Returns: dry-run summary OR (per-target) outcome report. Batch with targetAnchors: skips non-fatal on missing anchors.
Tokens are preserved BY REFERENCE (not cloned). mode="append" (default) adds at the end, "prepend" at the beginning, "replace" deletes target's existing children first.
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default.

Example (atomic): { projectSlug: "p", sourceInstanceId: "src", targetInstanceId: "tgt", mode: "append" }
Example (cross-page single): { projectSlug: "p", sourceInstanceId: "hero_src", targetAnchor: { pagePath: "/atelier", label: "Main" }, mode: "append" }
Example (multi-page batch — replaces clone_page): { projectSlug: "p", sourceInstanceId: "tpl_main", targetAnchors: [{ pagePath: "/concession-1", label: "main" }, { pagePath: "/concession-2", label: "main" }], mode: "replace" }
[PATTERN] cross-page-section-cloning → workflow create page + append anchor + clone_subtree with targetAnchor.`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        sourceInstanceId: { type: "string" },
        targetInstanceId: { type: "string" },
        targetAnchor: {
          type: "object",
          properties: {
            pagePath: { type: "string" },
            pageId: { type: "string" },
            label: { type: "string" },
            tag: { type: "string" },
          },
          additionalProperties: false,
        },
        targetAnchors: {
          type: "array",
          items: {
            type: "object",
            properties: {
              pagePath: { type: "string" },
              pageId: { type: "string" },
              label: { type: "string" },
              tag: { type: "string" },
            },
            additionalProperties: false,
          },
        },
        mode: { type: "string", enum: ["append", "prepend", "replace"] },
        includeSource: { type: "boolean" },
        skipChildLabels: { type: "array", items: { type: "string" } },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug", "sourceInstanceId"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  handler: async (args) => {
    const parsed = cloneSubtreeInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const data = parsed.data;

    let auth;
    try {
      auth = data.dryRun ? requireAuth(data.projectSlug) : requirePushAuth(data.projectSlug);
    } catch (err) {
      return authErrorResult(err);
    }

    // Path 1 — atomic by instanceId (legacy/simple path, preserved verbatim).
    if (data.targetInstanceId) {
      return handleByInstanceId(data, auth);
    }

    // Path 2/3 — anchor-based (single or batch). Unified through targetAnchors[].
    const anchors: TargetAnchor[] = data.targetAnchors
      ? data.targetAnchors
      : data.targetAnchor
        ? [data.targetAnchor]
        : [];
    return handleByAnchors(data, anchors, auth);
  },
};

// ---------------------------------------------------------------------------
// Path 1 — atomic by instanceId (single fetch, single push)
// ---------------------------------------------------------------------------

async function handleByInstanceId(
  data: z.infer<typeof cloneSubtreeInputSchema>,
  auth: ReturnType<typeof requireAuth>,
) {
  const { projectSlug, sourceInstanceId, targetInstanceId, mode, includeSource, skipChildLabels, dryRun } = data;

  let build;
  try {
    build = await fetchBuild(auth);
  } catch (err) {
    return runtimeErrorResult(err, "fetch build failed");
  }

  let result;
  try {
    result = buildCloneSubtreeChanges(build, {
      sourceInstanceId,
      targetInstanceId: targetInstanceId!,
      mode,
      includeSource,
      skipChildLabels,
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (/instance .* not found/i.test(msg)) return errorResult("INSTANCE_NOT_FOUND", msg);
    return errorResult("INTERNAL_ERROR", msg);
  }

  const summaryText = renderAtomicSummary(result, mode);

  if (dryRun) {
    return textResult(`DRY-RUN clone_subtree (atomic)

Source: ${sourceInstanceId}${includeSource ? " (INCLUDED as root of clone)" : " (children only — source itself NOT cloned)"}
Target: ${targetInstanceId}
Mode  : ${mode}${skipChildLabels?.length ? `\nSkipped labels: ${skipChildLabels.join(", ")}` : ""}

${summaryText}

Patches per namespace:
${result.changes.map((c) => `  - ${c.namespace}: ${c.patches.length}`).join("\n")}

If OK, re-run with dryRun=false.`);
  }

  try {
    const { result: pushResult, finalVersion } = await pushWithRetry(auth, (cur) => {
      const r = buildCloneSubtreeChanges(cur, {
        sourceInstanceId,
        targetInstanceId: targetInstanceId!,
        mode,
        includeSource,
        skipChildLabels,
      });
      return { id: `mcp-clone-subtree-${txId()}`, payload: r.changes };
    });
    return textResult(
      `Clone successful — version → ${finalVersion}\nstatus: ${pushResult.status}\n\n${summaryText}`,
    );
  } catch (err) {
    return runtimeErrorResult(err, "Clone failed");
  }
  void projectSlug; // keep param destructured even if unused below
}

function renderAtomicSummary(
  result: ReturnType<typeof buildCloneSubtreeChanges>,
  mode: "append" | "prepend" | "replace",
): string {
  return `Clone summary:
  Instances cloned         : ${result.summary.instancesCloned}
  Props cloned             : ${result.summary.propsCloned}
  Local styleSources cloned: ${result.summary.localStyleSourcesCloned}
  Styles cloned            : ${result.summary.stylesCloned}
  Selections cloned        : ${result.summary.selectionsCloned}
  DataSources cloned       : ${result.summary.dataSourcesCloned}
  Resources cloned         : ${result.summary.resourcesCloned}${mode === "replace" ? `\n  Old children deleted     : ${result.summary.childrenDeleted}` : ""}`;
}

// ---------------------------------------------------------------------------
// Path 2/3 — anchor-based (single or batch), refetch+retry per target
// ---------------------------------------------------------------------------

async function handleByAnchors(
  data: z.infer<typeof cloneSubtreeInputSchema>,
  anchors: TargetAnchor[],
  auth: ReturnType<typeof requireAuth>,
) {
  const { projectSlug, sourceInstanceId, mode, includeSource, skipChildLabels, dryRun } = data;

  let build: WebstudioBuild;
  try {
    build = await fetchBuild(auth);
  } catch (err) {
    return runtimeErrorResult(err, "fetch build failed");
  }

  // Resolve source instance (must exist somewhere in the build — agnostic of page).
  const sourceInst = build.instances.find((i) => i.id === sourceInstanceId);
  if (!sourceInst) {
    return errorResult("INSTANCE_NOT_FOUND", `Source instance "${sourceInstanceId}" not found.`);
  }

  const outcomes: TargetOutcome[] = [];

  // DRY-RUN: single fetch, compute changes for each anchor in turn.
  if (dryRun) {
    for (const anchor of anchors) {
      const ref = anchor.pagePath ?? anchor.pageId ?? "?";
      const page = resolvePage(build, anchor.pagePath, anchor.pageId);
      if (!page) {
        outcomes.push({ pageRef: ref, status: "skipped", reason: "page not found" });
        continue;
      }
      const targetAnchor = findAnchor(build, page, anchor.label, anchor.tag);
      if (!targetAnchor) {
        outcomes.push({
          pageRef: ref,
          status: "skipped",
          reason: `target anchor not found on "${page.path}" (label="${anchor.label}"${anchor.tag ? `, tag="${anchor.tag}"` : ""})`,
          hint: `Append an anchor first: instances.append({ parentInstanceId: "${page.rootInstanceId}", component: "ws:element", tag: "${anchor.tag ?? "div"}", label: "${anchor.label}" }) — then re-run.`,
        });
        void logCoerce("detect:clone-page-missing-anchor", {
          source: "clone_subtree.targetAnchor",
          projectSlug,
          pagePath: page.path,
          label: anchor.label,
        });
        continue;
      }
      try {
        const r = buildCloneSubtreeChanges(build, {
          sourceInstanceId,
          targetInstanceId: targetAnchor,
          mode,
          includeSource,
          skipChildLabels,
        });
        const patchCount = r.changes.reduce((acc, c) => acc + c.patches.length, 0);
        outcomes.push({ pageRef: ref, status: "ok", summary: r.summary, patchCount });
      } catch (err) {
        outcomes.push({ pageRef: ref, status: "skipped", reason: (err as Error).message });
      }
    }
    return textResult(renderAnchorReport(data, anchors, sourceInstanceId, outcomes, true));
  }

  // APPLY: per-target push with fresh fetch each iteration (so anchors stay valid across pushes).
  for (const anchor of anchors) {
    const ref = anchor.pagePath ?? anchor.pageId ?? "?";
    let curBuild: WebstudioBuild;
    try {
      curBuild = await fetchBuild(auth);
    } catch (err) {
      outcomes.push({ pageRef: ref, status: "skipped", reason: `refetch failed: ${(err as Error).message}` });
      continue;
    }
    const refreshedSourceInst = curBuild.instances.find((i) => i.id === sourceInstanceId);
    const page = resolvePage(curBuild, anchor.pagePath, anchor.pageId);
    const targetAnchor = page ? findAnchor(curBuild, page, anchor.label, anchor.tag) : null;
    if (!refreshedSourceInst) {
      outcomes.push({ pageRef: ref, status: "skipped", reason: "source instance lost on refetch" });
      continue;
    }
    if (!page) {
      outcomes.push({ pageRef: ref, status: "skipped", reason: "page not found" });
      continue;
    }
    if (!targetAnchor) {
      outcomes.push({
        pageRef: ref,
        status: "skipped",
        reason: `target anchor not found on "${page.path}" (label="${anchor.label}")`,
        hint: `Append an anchor first: instances.append({ parentInstanceId: "${page.rootInstanceId}", component: "ws:element", tag: "${anchor.tag ?? "div"}", label: "${anchor.label}" }) — then re-run.`,
      });
      void logCoerce("detect:clone-page-missing-anchor", {
        source: "clone_subtree.targetAnchor",
        projectSlug,
        pagePath: page.path,
        label: anchor.label,
      });
      continue;
    }

    try {
      const { finalVersion } = await pushWithRetry(auth, (cur) => {
        const curPage = resolvePage(cur, anchor.pagePath, anchor.pageId);
        const curAnchor = curPage ? findAnchor(cur, curPage, anchor.label, anchor.tag) : null;
        if (!curAnchor) throw new Error("anchor not resolvable on retry");
        const r = buildCloneSubtreeChanges(cur, {
          sourceInstanceId,
          targetInstanceId: curAnchor,
          mode,
          includeSource,
          skipChildLabels,
        });
        return { id: `mcp-clone-subtree-${txId()}`, payload: r.changes };
      });
      // Re-derive summary from curBuild for reporting (best-effort).
      const r = buildCloneSubtreeChanges(curBuild, {
        sourceInstanceId,
        targetInstanceId: targetAnchor,
        mode,
        includeSource,
        skipChildLabels,
      });
      const patchCount = r.changes.reduce((acc, c) => acc + c.patches.length, 0);
      outcomes.push({ pageRef: ref, status: "ok", summary: r.summary, patchCount, finalVersion });
    } catch (err) {
      outcomes.push({ pageRef: ref, status: "skipped", reason: `push failed: ${(err as Error).message}` });
    }
  }

  return textResult(renderAnchorReport(data, anchors, sourceInstanceId, outcomes, false));
}

function renderAnchorReport(
  data: z.infer<typeof cloneSubtreeInputSchema>,
  anchors: TargetAnchor[],
  sourceInstanceId: string,
  outcomes: TargetOutcome[],
  dryRun: boolean,
): string {
  const lines: string[] = [];
  lines.push(`# clone_subtree — ${dryRun ? "DRY-RUN" : "APPLY"} (anchor mode)`);
  lines.push(`Project : ${data.projectSlug}`);
  lines.push(`Source  : instance ${sourceInstanceId.slice(0, 8)}`);
  lines.push(`Mode    : ${data.mode}`);
  lines.push(`Targets : ${outcomes.length} anchor(s)`);
  lines.push("");
  const okCount = outcomes.filter((o) => o.status === "ok").length;
  const skipCount = outcomes.filter((o) => o.status === "skipped").length;
  lines.push(`Outcomes: ${okCount} ok, ${skipCount} skipped`);
  lines.push("");
  for (const o of outcomes) {
    if (o.status === "ok") {
      lines.push(`  ✓ ${o.pageRef}`);
      lines.push(
        `      ${o.summary.instancesCloned} instances · ${o.summary.propsCloned} props · ${o.summary.localStyleSourcesCloned} local sources · ${o.summary.stylesCloned} styles · ${o.summary.selectionsCloned} selections${data.mode === "replace" ? ` · ${o.summary.childrenDeleted} deleted` : ""}`,
      );
      lines.push(`      patches: ${o.patchCount}${o.finalVersion !== undefined ? ` · version → ${o.finalVersion}` : ""}`);
    } else {
      lines.push(`  ⤬ ${o.pageRef} — skipped (${o.reason})`);
      if (o.hint) lines.push(`      hint: ${o.hint}`);
    }
  }
  if (dryRun) {
    lines.push("");
    lines.push(`→ Re-run with dryRun=false to apply.`);
  }
  void anchors;
  return lines.join("\n");
}
