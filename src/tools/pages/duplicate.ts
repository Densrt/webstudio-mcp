// Tool: webstudio_duplicate_page — clone a full page (rootInstance subtree +
// page-scoped dataSources/resources + title/meta) into a new page.
//
// Differs from clone_page_subtree:
//   - Creates a brand-new target page (no need to pre-create it).
//   - Clones the ENTIRE rootInstance (header + main + footer + every slot),
//     not just the anchor's children.
//   - Auto-clones page-scoped dataSources & resources (re-scoped to the new root).
//   - Honours variableSubstitutions: pairs {from, to} merged into the expression
//     remap so any reference to `from` becomes a reference to `to`.

import { z } from "zod";
import type { ToolModule } from "../types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "../types.js";
import { requireAuth, requirePushAuth } from "../../auth.js";
import { fetchBuild, pushWithRetry } from "../../webstudio-client.js";
import type { WebstudioBuild, BuildPatchTransaction, BuildPatchOperation } from "../../webstudio-client.js";
import { buildCloneMaps, newId } from "../../clone/id-maps.js";
import { makeExprRemap } from "../../clone/expr-remap.js";
import {
  emptyPatches,
  addClonedInstances,
  addClonedProps,
  addClonedDataSources,
  addClonedResources,
  addClonedStyles,
  addClonedSelections,
} from "../../clone/build-patches.js";
import { wsId, txId } from "./ids.js";
import { findFolderOfPage, findPageInFolderByPath } from "./folder-utils.js";

const VariableSubstitutionSchema = z.object({
  from: z.string().describe("Existing dataSourceId to replace (e.g. the source-page Limoges variable)"),
  to: z.string().describe("Existing dataSourceId to use instead (e.g. the new city variable)"),
}).strict();

export const duplicatePageInputSchema = z.object({
  projectSlug: z.string(),
  sourcePagePath: z.string().optional(),
  sourcePageId: z.string().optional(),
  targetPath: z.string().describe("URL path of the new page (must be unique). Ex: '/quads-acme-springfield'"),
  targetName: z.string().describe("Display name of the new page. Ex: 'Quads Acme Springfield'"),
  parentFolderId: z.string().optional().describe("Target folder id. Defaults to the source page's folder."),
  variableSubstitutions: z.array(VariableSubstitutionSchema).default([])
    .describe("Optional overlay on the auto-remap: rewrites $ws$dataSource$<from> → $ws$dataSource$<to> in every cloned expression (text, props, meta, title, resources). Used for SEO multi-city duplication where the only difference is the city variable."),
  dryRun: z.boolean().default(true),
}).strict();

type PageMeta = Record<string, unknown>;
type PageRecord = {
  id: string;
  name: string;
  path: string;
  title: string;
  rootInstanceId: string;
  meta: PageMeta;
  marketplace?: { include: boolean };
};

function remapMeta(meta: PageMeta, remapExpr: (s: string) => string): PageMeta {
  const out: PageMeta = {};
  for (const [k, v] of Object.entries(meta)) {
    if (k === "custom" && Array.isArray(v)) {
      out[k] = (v as Array<Record<string, unknown>>).map((entry) => {
        const e = { ...entry };
        for (const [ek, ev] of Object.entries(e)) {
          if (typeof ev === "string") e[ek] = remapExpr(ev);
        }
        return e;
      });
    } else if (typeof v === "string") {
      // documentType is "html"|"xml" raw, but it has no $ws$dataSource$ tokens so remapExpr is a no-op.
      out[k] = remapExpr(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export const duplicatePageTool: ToolModule = {
  definition: {
    name: "webstudio_duplicate_page",
    description: "Clone a full page (rootInstance subtree + page-scoped dataSources/resources + title/meta) into a new page. See webstudio_pages action:'duplicate' for the routed entry point.",
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        sourcePagePath: { type: "string" },
        sourcePageId: { type: "string" },
        targetPath: { type: "string" },
        targetName: { type: "string" },
        parentFolderId: { type: "string" },
        variableSubstitutions: {
          type: "array",
          items: {
            type: "object",
            properties: { from: { type: "string" }, to: { type: "string" } },
            required: ["from", "to"],
          },
        },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug", "targetPath", "targetName"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  handler: async (args) => {
    const parsed = duplicatePageInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const input = parsed.data;
    if (!input.sourcePagePath && !input.sourcePageId) {
      return errorResult("VALIDATION_FAILED", "Provide sourcePagePath or sourcePageId.");
    }

    let auth;
    try { auth = input.dryRun ? requireAuth(input.projectSlug) : requirePushAuth(input.projectSlug); }
    catch (err) { return authErrorResult(err); }

    let build: WebstudioBuild;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    const sourcePage = (build.pages.pages as PageRecord[]).find(
      (p) => (input.sourcePageId && p.id === input.sourcePageId) || (input.sourcePagePath && p.path === input.sourcePagePath),
    );
    if (!sourcePage) {
      return errorResult("PAGE_NOT_FOUND", `Source page not found (path="${input.sourcePagePath ?? ""}" id="${input.sourcePageId ?? ""}")`);
    }
    const folderId = input.parentFolderId ?? findFolderOfPage(build, sourcePage.id) ?? "root";
    const folder = (build.pages.folders as Array<{ id: string; name: string; children: string[] }>).find((f) => f.id === folderId);
    if (!folder) return errorResult("VALIDATION_FAILED", `Folder "${folderId}" not found`);

    const conflict = findPageInFolderByPath(build, input.targetPath, folderId);
    if (conflict) {
      return errorResult(
        "VALIDATION_FAILED",
        `targetPath "${input.targetPath}" is already used by page "${conflict.name}" (id=${conflict.id}) in folder "${folder.name}". Webstudio path uniqueness is folder-scoped — pick a different targetPath or a different parentFolderId.`,
      );
    }

    // Validate variableSubstitutions (from/to must reference existing dataSources)
    const dsIds = new Set((build.dataSources as Array<{ id: string }>).map((d) => d.id));
    for (const s of input.variableSubstitutions) {
      if (!dsIds.has(s.from)) return errorResult("VALIDATION_FAILED", `variableSubstitution.from "${s.from}" is not an existing dataSourceId.`);
      if (!dsIds.has(s.to)) return errorResult("VALIDATION_FAILED", `variableSubstitution.to "${s.to}" is not an existing dataSourceId.`);
    }

    const pageId = wsId();
    const cloneMaps = buildCloneMaps(build, [sourcePage.rootInstanceId]);
    const newRootInstanceId = cloneMaps.idMap.get(sourcePage.rootInstanceId)!;

    // Two distinct maps:
    //   cloneMaps.dsIdMap  — only auto-clones (page-scoped vars/resources). Used by
    //                        addClonedDataSources/Resources to ITERATE and create new
    //                        entities. Must NEVER contain substitutions, otherwise the
    //                        source variable would be cloned into the substitution
    //                        target's ID and OVERWRITE the existing target variable.
    //   remapMap           — auto-clones + variableSubstitutions. Used by remapExpr to
    //                        rewrite $ws$dataSource$ tokens in expressions, and by
    //                        addClonedInstances/Props to rewire `parameter`-typed props
    //                        and `id`-typed children.
    const remapMap = new Map(cloneMaps.dsIdMap);
    for (const s of input.variableSubstitutions) remapMap.set(s.from, s.to);
    const mapsForRemap = { ...cloneMaps, dsIdMap: remapMap };

    const remapExpr = makeExprRemap(remapMap);
    const patches = emptyPatches();

    addClonedInstances(patches, build, mapsForRemap, remapExpr);
    addClonedProps(patches, build, mapsForRemap, remapExpr, newId);
    addClonedDataSources(patches, build, cloneMaps); // ← iterate on cloneMaps (no subs) to avoid overwrite
    addClonedResources(patches, build, cloneMaps, remapExpr);
    addClonedStyles(patches, build, cloneMaps);
    addClonedSelections(patches, build, cloneMaps);

    // Page record + folder placement
    const newPage: PageRecord = {
      id: pageId,
      name: input.targetName,
      path: input.targetPath,
      title: typeof sourcePage.title === "string" ? remapExpr(sourcePage.title) : sourcePage.title,
      rootInstanceId: newRootInstanceId,
      meta: remapMeta(sourcePage.meta ?? {}, remapExpr),
      marketplace: sourcePage.marketplace ?? { include: false },
    };
    const pagesPatches: BuildPatchOperation[] = [
      { op: "add", path: ["pages", pageId], value: newPage },
      { op: "replace", path: ["folders", folderId, "children"], value: [...folder.children, pageId] },
    ];

    const transaction: BuildPatchTransaction = {
      id: `mcp-duplicate-${txId()}`,
      payload: [
        { namespace: "pages", patches: pagesPatches },
        { namespace: "instances", patches: patches.instancePatches },
        { namespace: "props", patches: patches.propPatches },
        { namespace: "styleSources", patches: patches.styleSourcePatches },
        { namespace: "styles", patches: patches.stylePatches },
        { namespace: "styleSourceSelections", patches: patches.selectionPatches },
        { namespace: "dataSources", patches: patches.dataSourcePatches },
        { namespace: "resources", patches: patches.resourcePatches },
      ].filter((ns) => ns.patches.length > 0),
    };

    const summary = `Source: "${sourcePage.name}" (${sourcePage.path}) → "${input.targetName}" (${input.targetPath})
  pageId: ${pageId}  rootInstanceId: ${newRootInstanceId}
  folder: ${folderId}
  instances cloned:    ${cloneMaps.allSourceIds.size}
  props cloned:        ${patches.propPatches.length}
  dataSources cloned:  ${patches.dataSourcePatches.length} (page-scoped only — :root vars untouched)
  resources cloned:    ${patches.resourcePatches.length}
  styleSources cloned: ${cloneMaps.localSourceRemap.size}
  styles cloned:       ${patches.stylePatches.length}
  selections cloned:   ${patches.selectionPatches.length}
  variableSubstitutions applied: ${input.variableSubstitutions.length}${input.variableSubstitutions.length > 0 ? "\n    " + input.variableSubstitutions.map((s) => `${s.from} → ${s.to}`).join("\n    ") : ""}`;

    if (input.dryRun) return textResult(`DRY-RUN duplicate_page\nProject: ${build.project?.title ?? "(?)"}\n${summary}\n\nTransaction: ${transaction.payload.length} namespace(s). Re-run with dryRun=false to push.`);

    try {
      const { result, finalVersion } = await pushWithRetry(auth, () => transaction);
      return textResult(`Page duplicated.\n${summary}\n  build version → ${finalVersion}\n  status: ${result.status}`);
    } catch (err) {
      return runtimeErrorResult(err, "Push failed");
    }
  },
};
