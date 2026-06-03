// Tool: webstudio_share_slot_to_page
//
// Share a Webstudio Slot instance across N target pages so they all reference
// the SAME child content (DAG reference, not a copy). Edits to the shared
// child instantly propagate to every page that uses it.
//
// Mechanics: Webstudio's instance tree is a DAG — a single child instance can
// be referenced by multiple parent Slot wrappers via `children:[{type:"id", value:<id>}]`.
// This tool creates a NEW Slot wrapper instance on each target page whose
// `children` points to the same child id as the source. Replicates the UI
// builder's "Create Component / Use Component" feature.
//
// Use case canonical: Header + Footer slots reused on every page of a site.
// Discovered on a production site (2026-05-22) — 3 Slot Header wrappers share the same
// `brand-header-root` child across Home / Contact / Offres.

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type { WebstudioBuild, BuildPatchOperation, BuildPatchChange, BuildPatchTransaction } from "../webstudio-client.js";
import { customAlphabet } from "nanoid";

const txId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);
const newInstanceId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);

export const shareSlotToPageInputSchema = z.object({
  projectSlug: z.string(),
  /** Instance id of the existing Slot wrapper to share (NOT its child). */
  sourceSlotInstanceId: z.string(),
  /** Target pages by path (e.g. "/offres"). At least one of paths/ids required. */
  targetPagePaths: z.array(z.string()).default([]),
  /** Target pages by id. At least one of paths/ids required. */
  targetPageIds: z.array(z.string()).default([]),
  /** Where to insert the shared slot in each target page. Default = page rootInstanceId. */
  targetParentInstanceId: z.string().optional(),
  /** Position in parent.children (default: append at end). */
  insertIndex: z.number().int().nonnegative().optional(),
  dryRun: z.boolean().default(true),
}).strict();

type PageRef = { id: string; name: string; path: string; rootInstanceId: string };

function resolvePage(build: WebstudioBuild, byPath?: string, byId?: string): PageRef | null {
  const all: PageRef[] = [...build.pages.pages];
  const home = (build.pages as { homePage?: PageRef }).homePage;
  if (home) all.push(home);
  for (const p of all) {
    if (byId && p.id === byId) return p;
    if (byPath && p.path === byPath) return p;
  }
  return null;
}

/** Collect every instance id that is a descendant of `rootId` (inclusive). */
function collectDescendants(build: WebstudioBuild, rootId: string): Set<string> {
  const instById = new Map(build.instances.map((i) => [i.id, i]));
  const visited = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const inst = instById.get(id);
    if (!inst) continue;
    for (const c of inst.children ?? []) {
      if (c.type === "id") stack.push(c.value);
    }
  }
  return visited;
}

type Outcome =
  | { pageRef: string; status: "ok"; newSlotId: string; parentId: string }
  | { pageRef: string; status: "skipped"; reason: string }
  | { pageRef: string; status: "error"; reason: string };

type ChangesResult = {
  changes: BuildPatchChange[];
  outcomes: Outcome[];
  sharedChildId: string;
  sourceLabel?: string;
  sourceTag?: string;
};

/**
 * Pure function — given a build + args, compute the changes + per-target outcomes
 * WITHOUT side effects. Exported for unit tests (no auth / no network).
 */
export function buildChanges(
  build: WebstudioBuild,
  data: z.infer<typeof shareSlotToPageInputSchema>,
): ChangesResult {
  // 1. Find + validate source slot
  const source = build.instances.find((i) => i.id === data.sourceSlotInstanceId);
  if (!source) {
    throw new Error(`SOURCE_NOT_FOUND: source slot instance "${data.sourceSlotInstanceId}" not found in build.`);
  }
  if (source.component !== "Slot") {
    throw new Error(
      `SOURCE_NOT_A_SLOT: instance "${data.sourceSlotInstanceId}" has component="${source.component}", expected "Slot". ` +
      `To share content of a non-slot subtree, the correct approach is to (1) wrap it in a Slot via the UI builder, then (2) call share_slot_to_page on the new Slot. ` +
      `Or use instances.clone_page to DUPLICATE (different semantics — copies independent of source).`
    );
  }
  const children = source.children ?? [];
  const idChildren = children.filter((c) => c.type === "id");
  if (idChildren.length === 0) {
    throw new Error(
      `SOURCE_SLOT_EMPTY: slot "${data.sourceSlotInstanceId}" has no child to share. ` +
      `Populate the source slot via the UI builder or push_fragment first, then re-run share_slot_to_page.`
    );
  }
  if (idChildren.length > 1) {
    throw new Error(
      `SOURCE_SLOT_MULTI_CHILD: slot "${data.sourceSlotInstanceId}" has ${idChildren.length} children. ` +
      `Webstudio Slots conventionally hold exactly 1 root child (the shared content). Investigate the source.`
    );
  }
  const sharedChildId = (idChildren[0] as { type: "id"; value: string }).value;

  // 2. Resolve targets
  const targets: Array<{ ref: string; page: PageRef | null }> = [];
  for (const path of data.targetPagePaths) targets.push({ ref: path, page: resolvePage(build, path, undefined) });
  for (const id of data.targetPageIds) targets.push({ ref: id, page: resolvePage(build, undefined, id) });
  if (targets.length === 0) {
    throw new Error(`NO_TARGETS: pass at least one targetPagePaths[] or targetPageIds[] entry.`);
  }

  // 3. Locate the source page (used to detect self-share)
  const allPages: PageRef[] = [...build.pages.pages];
  const home = (build.pages as { homePage?: PageRef }).homePage;
  if (home) allPages.push(home);
  let sourcePage: PageRef | null = null;
  for (const candidate of allPages) {
    const desc = collectDescendants(build, candidate.rootInstanceId);
    if (desc.has(data.sourceSlotInstanceId)) { sourcePage = candidate; break; }
  }

  // 4. For each target, compute the new slot wrapper + parent.children update
  const outcomes: Outcome[] = [];
  const instancePatches: BuildPatchOperation[] = [];
  // Accumulator: parentId → current children list to write at the end (lets us batch when same parent serves multiple targets — rare but safe).
  const parentChildrenUpdates = new Map<string, Array<{ type: "id" | "text" | "expression"; value: string }>>();

  function getCurrentParentChildren(parentId: string) {
    if (parentChildrenUpdates.has(parentId)) return parentChildrenUpdates.get(parentId)!;
    const parent = build.instances.find((i) => i.id === parentId);
    if (!parent) return [];
    return [...parent.children];
  }

  for (const t of targets) {
    if (!t.page) {
      outcomes.push({ pageRef: t.ref, status: "error", reason: "page not found" });
      continue;
    }

    // Self-share: targeting the same page rootInstance where the source slot already lives.
    // Refuse only when no explicit targetParentInstanceId is provided (which would default to that very rootInstance).
    if (sourcePage && sourcePage.id === t.page.id && !data.targetParentInstanceId) {
      outcomes.push({
        pageRef: t.ref,
        status: "skipped",
        reason: `source slot already lives in this page (id=${t.page.id}). Targeting an explicit non-root targetParentInstanceId is the only way to add a second wrapper on the same page.`,
      });
      continue;
    }

    // Resolve target parent (default = page rootInstance)
    const parentId = data.targetParentInstanceId ?? t.page.rootInstanceId;

    // Validate parent is a descendant of target page rootInstance
    const pageDescendants = collectDescendants(build, t.page.rootInstanceId);
    if (!pageDescendants.has(parentId)) {
      outcomes.push({
        pageRef: t.ref,
        status: "error",
        reason: `targetParentInstanceId "${parentId}" is not in page "${t.page.path}" (id=${t.page.id})`,
      });
      continue;
    }

    // Idempotence: scan parent's current children for existing Slot pointing to sharedChildId
    const currentParentChildren = getCurrentParentChildren(parentId);
    const alreadyShared = currentParentChildren.some((c) => {
      if (c.type !== "id") return false;
      const ch = build.instances.find((i) => i.id === c.value);
      if (!ch || ch.component !== "Slot") return false;
      return (ch.children ?? []).some((cc) => cc.type === "id" && cc.value === sharedChildId);
    });
    if (alreadyShared) {
      outcomes.push({
        pageRef: t.ref,
        status: "skipped",
        reason: `target parent already contains a Slot pointing to ${sharedChildId.slice(0, 8)}… (idempotent)`,
      });
      continue;
    }

    // Generate new Slot wrapper instance
    const newId = newInstanceId();
    const newSlot: WebstudioBuild["instances"][number] = {
      type: "instance",
      id: newId,
      component: "Slot",
      tag: source.tag,
      ...(source.label && { label: source.label }),
      children: [{ type: "id", value: sharedChildId }],
    };
    instancePatches.push({ op: "add", path: [newId], value: newSlot });

    // Update parent.children
    const newParentChildren = [...currentParentChildren];
    const newRef = { type: "id" as const, value: newId };
    if (typeof data.insertIndex === "number" && data.insertIndex >= 0 && data.insertIndex <= newParentChildren.length) {
      newParentChildren.splice(data.insertIndex, 0, newRef);
    } else {
      newParentChildren.push(newRef);
    }
    parentChildrenUpdates.set(parentId, newParentChildren);

    outcomes.push({ pageRef: t.ref, status: "ok", newSlotId: newId, parentId });
  }

  // 5. Emit parent.children patches (one per modified parent)
  for (const [parentId, newChildren] of parentChildrenUpdates) {
    instancePatches.push({ op: "replace", path: [parentId, "children"], value: newChildren });
  }

  const changes: BuildPatchChange[] = instancePatches.length > 0
    ? [{ namespace: "instances", patches: instancePatches }]
    : [];

  return { changes, outcomes, sharedChildId, sourceLabel: source.label, sourceTag: source.tag };
}

export const shareSlotToPageTool: ToolModule = {
  definition: {
    name: "webstudio_share_slot_to_page",
    description: `Use when: share an existing Slot instance across N target pages — all referencing the SAME child content (DAG, not a copy). Edits to the shared child instantly propagate to every page that uses it. Canonical use case: Header / Footer / Cookie banner / Newsletter signup reused on every page of a site.
Webstudio's instance tree is a DAG: a single child instance can be referenced by multiple parent Slot wrappers via children:[{type:"id", value:<id>}]. This tool creates a NEW Slot wrapper instance on each target page, pointing to the same child id as the source — replicating the UI builder's "Create Component / Use Component" feature.

Do NOT use when:
  • Duplicating (copying) a subtree with independent IDs — use instances.clone_page (different semantics: edits on one don't propagate).
  • Source is not a Slot — share_slot_to_page only operates on instances with component:"Slot".
  • Creating a NEW empty Slot — use instances.append component:"Slot".

Returns: per-target outcome report — status="ok" (new wrapper id + parent), "skipped" (already shared / self-share), or "error" (page/parent not found).
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default.
Idempotence: target parent already containing a Slot pointing to the same shared child is silently skipped — safe to re-run.

Pattern reference: meta.describe_pattern({pattern:"shared-slots-between-pages"}) — full mechanics + workflow.

Example (Header on Offres + Contact):
  { projectSlug:"my-site", sourceSlotInstanceId:"Gy8SFH0MCVTzJ0BacaQxW", targetPagePaths:["/offres","/contact"], dryRun:true }
Example (custom parent + position):
  { projectSlug:"my-site", sourceSlotInstanceId:"aPbKkwoxDFAKChDG4St69", targetPagePaths:["/a-propos"], targetParentInstanceId:"some-wrapper-id", insertIndex:0 }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        sourceSlotInstanceId: { type: "string" },
        targetPagePaths: { type: "array", items: { type: "string" } },
        targetPageIds: { type: "array", items: { type: "string" } },
        targetParentInstanceId: { type: "string" },
        insertIndex: { type: "number" },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug", "sourceSlotInstanceId"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  handler: async (args) => {
    const parsed = shareSlotToPageInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const data = parsed.data;

    let auth;
    try { auth = data.dryRun ? requireAuth(data.projectSlug) : requirePushAuth(data.projectSlug); }
    catch (err) { return authErrorResult(err); }

    let build;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    let r: ChangesResult;
    try { r = buildChanges(build, data); }
    catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith("SOURCE_NOT_FOUND")) return errorResult("INSTANCE_NOT_FOUND", msg);
      if (msg.startsWith("SOURCE_NOT_A_SLOT")) return errorResult("VALIDATION_FAILED", msg);
      if (msg.startsWith("SOURCE_SLOT_EMPTY")) return errorResult("VALIDATION_FAILED", msg);
      if (msg.startsWith("SOURCE_SLOT_MULTI_CHILD")) return errorResult("VALIDATION_FAILED", msg);
      if (msg.startsWith("NO_TARGETS")) return errorResult("VALIDATION_FAILED", msg);
      return errorResult("INTERNAL_ERROR", msg);
    }

    const okCount = r.outcomes.filter((o) => o.status === "ok").length;
    const skipCount = r.outcomes.filter((o) => o.status === "skipped").length;
    const errCount = r.outcomes.filter((o) => o.status === "error").length;

    const lines: string[] = [];
    lines.push(`# share_slot_to_page — ${data.dryRun ? "DRY-RUN" : "APPLY"}`);
    lines.push(`Project       : ${data.projectSlug}`);
    lines.push(`Source slot   : ${data.sourceSlotInstanceId} (label="${r.sourceLabel ?? ""}", tag="${r.sourceTag ?? ""}")`);
    lines.push(`Shared child  : ${r.sharedChildId}`);
    lines.push(`Targets total : ${r.outcomes.length} (${okCount} ok, ${skipCount} skipped, ${errCount} error)`);
    lines.push("");
    for (const o of r.outcomes) {
      if (o.status === "ok") {
        lines.push(`  ✓ ${o.pageRef} → new Slot wrapper id=${o.newSlotId.slice(0, 8)}… under parent ${o.parentId.slice(0, 8)}…`);
      } else if (o.status === "skipped") {
        lines.push(`  − ${o.pageRef} — skipped (${o.reason})`);
      } else {
        lines.push(`  ✗ ${o.pageRef} — error (${o.reason})`);
      }
    }

    const patchCount = r.changes.reduce((acc, c) => acc + c.patches.length, 0);

    if (okCount === 0) {
      lines.push("");
      lines.push(`No changes to apply (${skipCount} skipped, ${errCount} errored). If everything was already shared, this is the expected idempotent behaviour.`);
      return textResult(lines.join("\n"));
    }

    if (data.dryRun) {
      lines.push("");
      lines.push(`Patches: ${patchCount} on namespaces: ${r.changes.map((c) => c.namespace).join(", ")}`);
      lines.push(`→ Re-run with dryRun=false to apply.`);
      return textResult(lines.join("\n"));
    }

    try {
      const { finalVersion } = await pushWithRetry(auth, (cur) => {
        const re = buildChanges(cur, data);
        const tx: BuildPatchTransaction = { id: `mcp-share-slot-${txId()}`, payload: re.changes };
        return tx;
      });
      lines.push("");
      lines.push(`${okCount} slot(s) shared — version → ${finalVersion}`);
      return textResult(lines.join("\n"));
    } catch (err) {
      return runtimeErrorResult(err, "share_slot_to_page failed");
    }
  },
};
