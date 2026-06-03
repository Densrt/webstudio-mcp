// Generic audit: every mega-tool action advertises a set of params in its inputSchema.
// This test asserts those params match the sub-handler's accepted params (i.e. the
// keys in its own `inputSchema.properties`). Mismatches mean the wrapper documents
// something the sub-handler will reject — the exact bug fixed in v1.0.1 (update_text)
// and v1.0.2 (variables.update).
//
// How it works:
//   1. Each mega-tool exposes per-action `schemaKeys` via `inputSchema.xActions[i]`
//      (added in v1.0.3 — see src/lib/mega-tool.ts buildJsonSchemaForActions).
//   2. The mapping below names the sub-handler each action delegates to.
//   3. Optional `aliases` declare wrapper-only keys that are translated by the
//      wrapper into the sub-handler's accepted form (legacy compat, sugar, etc.).
//   4. The test asserts every wrapper key for action X is either:
//        a. a common boilerplate key (action/label/context/dryRun)
//        b. accepted by the sub-handler's inputSchema.properties
//        c. listed in `aliases` for that action
//      Otherwise it FAILS with the offending mega.action + the unknown key.
//
// To add a new action: add a row to MEGA_ACTION_SUBHANDLER (or skip via `SKIP`).
// To document an alias: add it under aliases for that row.

import { test } from "node:test";
import assert from "node:assert/strict";

import { variablesTool } from "../dist/tools/variables-mega.js";
import { resourcesTool } from "../dist/tools/resources-mega.js";
import { instancesTool } from "../dist/tools/instances-mega.js";
import { stylesMegaTool } from "../dist/tools/styles-mega.js";
import { tokensTool } from "../dist/tools/tokens-mega.js";
import { cssvarTool } from "../dist/tools/cssvar-mega.js";
import { pagesTool } from "../dist/tools/pages.js";
import { authTool } from "../dist/tools/auth-mega.js";

import { createVariableTool, listVariablesTool } from "../dist/tools/variables.js";
import { updateVariableTool } from "../dist/tools/update-variable.js";
import { deleteVariablesBatchTool } from "../dist/tools/delete-variables-batch.js";
import { bindPageFieldTool } from "../dist/tools/bind-page-field.js";

import { createResourceTool, listResourcesTool, deleteResourceTool } from "../dist/tools/resources.js";
import { updateResourceTool } from "../dist/tools/update-resource.js";

import { appendChildTool } from "../dist/tools/append-child.js";
import { deleteInstanceTool } from "../dist/tools/delete-instance.js";
import { cloneSubtreeTool } from "../dist/tools/clone-subtree.js";
import { clonePageSubtreeTool } from "../dist/tools/clone-page-subtree.js";
import { wrapInstanceTool } from "../dist/tools/wrap-instance.js";
import { flattenInstanceTool } from "../dist/tools/flatten-instance.js";
import { moveInstanceTool } from "../dist/tools/move-instance.js";
import { updateInstanceLabelTool } from "../dist/tools/update-instance-label.js";
import { updateInstanceTagTool } from "../dist/tools/update-instance-tag.js";
import { updateInstanceTextTool } from "../dist/tools/update-instance-text.js";
import { updateInstancePropTool } from "../dist/tools/update-instance-prop.js";
import { deleteInstancePropTool } from "../dist/tools/delete-instance-prop.js";
import { bindInstancePropTool } from "../dist/tools/bind-instance-prop.js";

import { updateStylesTool } from "../dist/tools/update-styles.js";
import { deleteLocalStyleDeclTool } from "../dist/tools/delete-local-style-decl.js";
import { replaceLocalValueTool } from "../dist/tools/replace-local-value.js";
import { getDeclsTool } from "../dist/tools/get-decls.js";

import { defineTokenTool, listTokensTool } from "../dist/tools/projects.js";
import { initBrandTokensTool } from "../dist/tools/init-brand-tokens.js";
import { syncLocalTokensTool } from "../dist/tools/sync-local-tokens.js";
import { createTokensTool } from "../dist/tools/create-tokens.js";
import { listTokensCloudTool } from "../dist/tools/list-tokens-cloud.js";
import { updateTokenStylesTool } from "../dist/tools/update-token-styles.js";
import { deleteTokenDeclTool } from "../dist/tools/delete-token-decl.js";
import { applyTokenToInstancesTool } from "../dist/tools/apply-token-to-instances.js";
import { detachTokenFromInstancesTool } from "../dist/tools/detach-token-from-instances.js";
import { extractTokenFromInstancesTool } from "../dist/tools/extract-token-from-instances.js";
import { shareSlotToPageTool } from "../dist/tools/share-slot-to-page.js";
import { extractVariantTokenTool } from "../dist/tools/extract-variant-token.js";
import { deleteTokenTool } from "../dist/tools/delete-token.js";
import { bulkRenameTokensTool } from "../dist/tools/bulk-rename-tokens.js";
import { replaceTokenTool } from "../dist/tools/replace-token.js";
import { dedupeTokenLocalsTool } from "../dist/tools/dedupe-token-locals.js";
import { cleanupOrphanLocalsTool } from "../dist/tools/cleanup-orphan-locals.js";

import { defineCssVarTool } from "../dist/tools/define-css-var.js";
import { listCssVarsTool } from "../dist/tools/list-css-vars.js";
import { deleteCssVarTool } from "../dist/tools/delete-css-var.js";
import { rewriteVarReferencesTool } from "../dist/tools/rewrite-var-references.js";

import { createPageTool } from "../dist/tools/pages/create.js";
import { duplicatePageTool } from "../dist/tools/pages/duplicate.js";
import { updatePageTool } from "../dist/tools/update-page.js";
import { deletePagesBatchTool } from "../dist/tools/delete-pages-batch.js";
import { listFoldersTool } from "../dist/tools/pages/folders-list.js";
import { deleteFolderTool } from "../dist/tools/pages/folders-delete.js";
import { createFolderTool } from "../dist/tools/pages/folders-create.js";
import { getMetaTool } from "../dist/tools/pages/get-meta.js";
import { updateMetaTool } from "../dist/tools/pages/update-meta.js";

import { setupAuthTool, allowPushTool, updateAppVersionTool } from "../dist/tools/auth-tools.js";

// Additional mega-tools NOT in MEGA_ACTION_SUBHANDLER but still subject to the
// `context` top-level coherence test (v2.9.1 regression guard).
import { buildTool } from "../dist/tools/build-mega.js";
import { cmsTool } from "../dist/tools/cms-mega.js";
import { projectTool } from "../dist/tools/project-mega.js";
import { readTool } from "../dist/tools/read-mega.js";
import { auditMegaTool } from "../dist/tools/audit-mega.js";
import { assetsTool } from "../dist/tools/assets.js";
import { makeMetaTool } from "../dist/tools/meta-mega.js";

// Common boilerplate keys the mega-tool adds — never a sub-handler concern.
const COMMON_KEYS = new Set(["action", "label", "context"]);

// ─── Single source of truth: the full mega-tool surface (mirror of src/index.ts TOOLS) ──
// Both coherence guards below iterate this list. meta-mega is a factory (needs the tools
// list for BM25) — instantiate with an empty list; we only read its schema, never run it.
// When you add a mega-tool: register it HERE, AND either add per-action rows to
// MEGA_ACTION_SUBHANDLER or a COHERENCE_SKIP[name] reason — the coverage test fails otherwise.
const metaToolInstance = makeMetaTool(() => []);
const ALL_MEGAS = [
  variablesTool, resourcesTool, instancesTool, stylesMegaTool,
  tokensTool, cssvarTool, pagesTool, authTool,
  buildTool, cmsTool, projectTool, readTool, auditMegaTool, assetsTool, metaToolInstance,
];

// Megas whose actions are PURE PASS-THROUGH (the wrapper's strip() removes only
// action/label/context and forwards the rest unchanged) or INLINE handlers. They carry
// NO alias/packing layer, so the "wrapper advertises a key the sub-handler rejects"
// divergence the per-action loop guards against is impossible by construction — their
// advertised schema IS the action's own Zod (buildJsonSchemaFromZodActions, single source).
// They stay covered by the v2.9.1 context guard + tsc. Whole-mega skip, with a stated reason.
// (Adding genuine per-action rows for these is a possible future refinement — low value
//  while they remain alias-free, since the rows would be trivially-true.)
const COHERENCE_SKIP = {
  build: "pure pass-through to discrete sub-handlers + inline push_html; single-source Zod, no alias layer",
  project: "pure pass-through to discrete sub-handlers; single-source Zod, no alias layer",
  read: "pure pass-through to discrete sub-handlers + inline snapshot; single-source Zod, no alias layer",
  assets: "pure pass-through to discrete sub-handlers; single-source Zod, no alias layer",
  audit: "per-action Zod routed to a shared detector via `kind`; read-only, no alias layer",
  cms: "inline adapter handlers; single-source Zod, no alias layer",
  meta: "inline meta/BM25 handlers; single-source Zod, no alias layer",
};

/** One row per (mega, action). Sub-handler is the strict-schema receiver. `aliases`
 *  declares wrapper-only keys (legacy sugar, single→batch single-form keys) that the
 *  wrapper translates into the sub-handler form. */
const MEGA_ACTION_SUBHANDLER = [
  // ─── variables ─────────────────────────────────────────────────────────────
  { mega: variablesTool, action: "create", sub: createVariableTool, aliases: {} },
  { mega: variablesTool, action: "list", sub: listVariablesTool, aliases: {} },
  { mega: variablesTool, action: "update", sub: updateVariableTool, aliases: {
    variableId: "alias of dataSourceId (legacy)",
    updates: "legacy nested form, destructured to top-level",
  } },
  { mega: variablesTool, action: "delete", sub: deleteVariablesBatchTool, aliases: {
    variableIds: "remapped to dataSourceIdsOrNames",
  } },
  { mega: variablesTool, action: "bind_page_field", sub: bindPageFieldTool, aliases: {
    expression: "legacy raw-expression sugar — packed into binding:{kind:'raw', expression}",
  } },

  // ─── resources ─────────────────────────────────────────────────────────────
  { mega: resourcesTool, action: "create", sub: createResourceTool, aliases: {} },
  { mega: resourcesTool, action: "list", sub: listResourcesTool, aliases: {} },
  { mega: resourcesTool, action: "update", sub: updateResourceTool, aliases: {} },
  { mega: resourcesTool, action: "delete", sub: deleteResourceTool, aliases: {} },

  // ─── instances ─────────────────────────────────────────────────────────────
  // Shared aliases for ALL instances actions: pagePath/pageId are documented at the
  // wrapper level (legacy convenience for callers) but no sub-handler accepts them —
  // they're stripped by the wrapper before dispatch.
  { mega: instancesTool, action: "append", sub: appendChildTool, aliases: {
    pagePath: "wrapper-shared doc — stripped before dispatch",
    pageId: "wrapper-shared doc — stripped before dispatch",
  } },
  { mega: instancesTool, action: "delete", sub: deleteInstanceTool, aliases: {
    pagePath: "wrapper-shared — stripped",
    pageId: "wrapper-shared — stripped",
    instanceId: "single-form sugar — packed into instanceIds:[instanceId]",
  } },
  { mega: instancesTool, action: "clone", sub: cloneSubtreeTool, aliases: {
    pagePath: "wrapper-shared — stripped",
    pageId: "wrapper-shared — stripped",
    targetParentInstanceId: "legacy alias of targetInstanceId",
  } },
  { mega: instancesTool, action: "clone_page", sub: clonePageSubtreeTool, aliases: {
    sourceInstanceId: "legacy — sub-handler matches by anchorLabel, not by instance id",
    targetPagePath: "legacy single-target — packed into targetPagePaths:[targetPagePath]",
    targetParentInstanceId: "legacy — sub-handler has no equivalent (anchor-based)",
  } },
  { mega: instancesTool, action: "wrap", sub: wrapInstanceTool, aliases: {
    pagePath: "wrapper-shared — stripped",
    pageId: "wrapper-shared — stripped",
    wrapperComponent: "legacy alias of component",
    wrapperTag: "legacy alias of tag",
  } },
  { mega: instancesTool, action: "flatten", sub: flattenInstanceTool, aliases: {
    pagePath: "wrapper-shared — stripped",
    pageId: "wrapper-shared — stripped",
    instanceId: "single-form sugar — packed into instanceIds:[instanceId]",
  } },
  { mega: instancesTool, action: "move", sub: moveInstanceTool, aliases: {
    pagePath: "wrapper-shared — stripped",
    pageId: "wrapper-shared — stripped",
  } },
  { mega: instancesTool, action: "update_label", sub: updateInstanceLabelTool, aliases: {
    pagePath: "wrapper-shared — stripped",
    pageId: "wrapper-shared — stripped",
    instanceId: "single-form sugar — packed into updates[0].instanceId",
    newLabel: "single-form sugar — packed into updates[0].label",
  } },
  { mega: instancesTool, action: "update_tag", sub: updateInstanceTagTool, aliases: {
    pagePath: "wrapper-shared — stripped",
    pageId: "wrapper-shared — stripped",
  } },
  { mega: instancesTool, action: "update_text", sub: updateInstanceTextTool, aliases: {
    instanceId: "single-form alias, packed into updates[0].instanceId",
    newText: "single-form alias, packed into updates[0].text",
    childIndex: "single-form alias, packed into updates[0].childIndex",
    mode: "single-form alias, packed into updates[0].mode",
    pagePath: "wrapper-shared base prop (stripped)",
    pageId: "wrapper-shared base prop (stripped)",
  } },
  { mega: instancesTool, action: "prop_update", sub: updateInstancePropTool, aliases: {
    pagePath: "wrapper-shared — stripped",
    pageId: "wrapper-shared — stripped",
    instanceId: "single-form sugar — packed into updates[0].instanceId",
    propName: "single-form sugar — packed into updates[0].propName",
    value: "single-form sugar — packed into updates[0].value",
    type: "single-form sugar — packed into updates[0].type",
    propValue: "legacy alias of value (packed into updates[0].value)",
    propType: "legacy alias of type (packed into updates[0].type)",
    createIfMissing: "single-form — packed into updates[0]",
    preserveExpressions: "single-form — packed into updates[0]",
    force: "single-form — packed into updates[0]",
    ignoreWrapperWarning: "single-form — packed into updates[0]",
  } },
  { mega: instancesTool, action: "prop_delete", sub: deleteInstancePropTool, aliases: {
    pagePath: "wrapper-shared — stripped",
    pageId: "wrapper-shared — stripped",
    instanceId: "single-form sugar — packed into deletions[0].instanceId",
    propName: "single-form sugar — packed into deletions[0].propName",
  } },
  { mega: instancesTool, action: "prop_bind", sub: bindInstancePropTool, aliases: {} },
  { mega: instancesTool, action: "share_slot_to_page", sub: shareSlotToPageTool, aliases: {} },

  // ─── styles ────────────────────────────────────────────────────────────────
  { mega: stylesMegaTool, action: "get_decls", sub: getDeclsTool, aliases: {} },
  { mega: stylesMegaTool, action: "update", sub: updateStylesTool, aliases: {
    instanceId: "single-form locator — duplicated into each updates[i].instanceId",
    styles: "single-form {property:value} map — expanded into batch updates",
    breakpoint: "single-form — copied into each updates[i].breakpoint",
    breakpointId: "legacy alias of breakpoint",
    state: "single-form — copied into each updates[i].state",
  } },
  { mega: stylesMegaTool, action: "delete_decl", sub: deleteLocalStyleDeclTool, aliases: {
    instanceId: "single-form sugar — packed into deletions[0].instanceId",
    property: "single-form sugar — packed into deletions[0].property",
    breakpoint: "single-form — packed into deletions[0].breakpoint",
    breakpointId: "legacy alias of breakpoint",
    state: "single-form — packed into deletions[0].state",
  } },
  { mega: stylesMegaTool, action: "replace_value", sub: replaceLocalValueTool, aliases: {
    instanceLabelContains: "legacy alias of instanceLabel (still exact-match)",
  } },

  // ─── tokens ────────────────────────────────────────────────────────────────
  { mega: tokensTool, action: "define_local", sub: defineTokenTool, aliases: {} },
  { mega: tokensTool, action: "list_local", sub: listTokensTool, aliases: {} },
  { mega: tokensTool, action: "init_brand_kit", sub: initBrandTokensTool, aliases: {
    brandKit: "nested form — destructured to top-level {colors, spacings, fonts, fontSizes, radii, overwrite}",
    dryRun: "wrapper-only (sub-handler always pushes)",
  } },
  { mega: tokensTool, action: "sync_local", sub: syncLocalTokensTool, aliases: {} },
  { mega: tokensTool, action: "create_tokens", sub: createTokensTool, aliases: {} },
  { mega: tokensTool, action: "list_tokens_cloud", sub: listTokensCloudTool, aliases: {} },
  { mega: tokensTool, action: "update_token_styles", sub: updateTokenStylesTool, aliases: {
    styles: "single-form {property:value} map — expanded into batch updates",
    breakpoint: "single-form — copied into each updates[i].breakpoint",
    state: "single-form — copied into each updates[i].state",
  } },
  { mega: tokensTool, action: "delete_token_decl", sub: deleteTokenDeclTool, aliases: {} },
  { mega: tokensTool, action: "attach_token", sub: applyTokenToInstancesTool, aliases: {} },
  { mega: tokensTool, action: "detach_token", sub: detachTokenFromInstancesTool, aliases: {} },
  { mega: tokensTool, action: "extract_token", sub: extractTokenFromInstancesTool, aliases: {
    newTokenName: "legacy alias of tokenName",
  } },
  { mega: tokensTool, action: "extract_variant", sub: extractVariantTokenTool, aliases: {
    baseTokenName: "legacy alias of sourceTokenName",
    variantState: "legacy alias of state",
  } },
  { mega: tokensTool, action: "delete_token", sub: deleteTokenTool, aliases: {} },
  { mega: tokensTool, action: "bulk_rename_token_names", sub: bulkRenameTokensTool, aliases: {
    renames: "map form {[from]:to} — translated to literal-match regex (first entry only per call)",
  } },
  { mega: tokensTool, action: "migrate_token_selections", sub: replaceTokenTool, aliases: {} },
  { mega: tokensTool, action: "dedupe_locals", sub: dedupeTokenLocalsTool, aliases: {} },
  { mega: tokensTool, action: "cleanup_orphan_locals", sub: cleanupOrphanLocalsTool, aliases: {} },

  // ─── cssvar ────────────────────────────────────────────────────────────────
  { mega: cssvarTool, action: "define", sub: defineCssVarTool, aliases: {
    name: "single-form sugar — packed into vars:{[name]:value}",
    value: "single-form sugar — packed into vars:{[name]:value}",
    scope: "legacy field, no sub-handler equivalent — dropped",
  } },
  { mega: cssvarTool, action: "list", sub: listCssVarsTool, aliases: {} },
  { mega: cssvarTool, action: "delete", sub: deleteCssVarTool, aliases: {
    name: "single-form sugar — packed into names:[name]",
  } },
  { mega: cssvarTool, action: "rewrite_refs", sub: rewriteVarReferencesTool, aliases: {
    fromName: "single-form sugar — packed into map:{[fromName]:toName}",
    toName: "single-form sugar — packed into map:{[fromName]:toName}",
  } },

  // ─── pages ─────────────────────────────────────────────────────────────────
  { mega: pagesTool, action: "create", sub: createPageTool, aliases: {} },
  { mega: pagesTool, action: "duplicate", sub: duplicatePageTool, aliases: {} },
  { mega: pagesTool, action: "update", sub: updatePageTool, aliases: {} },
  { mega: pagesTool, action: "delete", sub: deletePagesBatchTool, aliases: {} },
  { mega: pagesTool, action: "list_folders", sub: listFoldersTool, aliases: {} },
  { mega: pagesTool, action: "create_folder", sub: createFolderTool, aliases: {} },
  { mega: pagesTool, action: "delete_folder", sub: deleteFolderTool, aliases: {} },
  { mega: pagesTool, action: "get_meta", sub: getMetaTool, aliases: {} },
  { mega: pagesTool, action: "update_meta", sub: updateMetaTool, aliases: {} },

  // ─── auth ──────────────────────────────────────────────────────────────────
  { mega: authTool, action: "setup", sub: setupAuthTool, aliases: {} },
  { mega: authTool, action: "allow_push", sub: allowPushTool, aliases: {} },
  { mega: authTool, action: "update_app_version", sub: updateAppVersionTool, aliases: {} },
];

function getActionMeta(megaTool, action) {
  const x = megaTool.definition.inputSchema.xActions ?? [];
  return x.find((a) => a.action === action);
}

function getSubHandlerKeys(subTool) {
  const props = subTool.definition.inputSchema.properties ?? {};
  return new Set(Object.keys(props));
}

for (const row of MEGA_ACTION_SUBHANDLER) {
  const megaName = row.mega.definition.name;
  test(`${megaName}.${row.action} — wrapper keys ⊆ sub-handler keys ∪ aliases`, () => {
    const meta = getActionMeta(row.mega, row.action);
    assert.ok(meta, `${megaName}.${row.action}: missing xActions metadata`);
    assert.ok(Array.isArray(meta.schemaKeys), `${megaName}.${row.action}: schemaKeys not exposed — rebuild?`);

    const subKeys = getSubHandlerKeys(row.sub);
    const aliasKeys = new Set(Object.keys(row.aliases));

    const unknown = [];
    for (const key of meta.schemaKeys) {
      if (COMMON_KEYS.has(key)) continue;
      if (subKeys.has(key)) continue;
      if (aliasKeys.has(key)) continue;
      unknown.push(key);
    }

    if (unknown.length > 0) {
      const subSummary = [...subKeys].sort().join(", ");
      const aliasSummary = aliasKeys.size ? [...aliasKeys].sort().join(", ") : "(none)";
      assert.fail(
        `${megaName}.${row.action} advertises ${unknown.length} key(s) the sub-handler ${row.sub.definition.name} rejects: ${unknown.join(", ")}\n` +
        `  sub-handler accepts: ${subSummary}\n` +
        `  declared aliases:    ${aliasSummary}\n` +
        `  Fix: either add the keys to the sub-handler's inputSchema, drop them from the wrapper, or document them as aliases in test/wrapper-schema-coherence.test.mjs and translate them in the wrapper before dispatch.`,
      );
    }
  });
}

test("every registered mega-action is explicitly classified (covered OR skipped-with-reason)", () => {
  // Iterates the FULL registry (ALL_MEGAS), not a hand-picked subset — so a NEW mega-tool
  // or action that nobody classified fails CI instead of silently escaping the guard.
  const covered = new Set(MEGA_ACTION_SUBHANDLER.map((r) => `${r.mega.definition.name}.${r.action}`));
  const unclassified = [];
  for (const mega of ALL_MEGAS) {
    const name = mega.definition.name;
    if (COHERENCE_SKIP[name]) continue; // whole-mega skip, documented reason
    const xActions = mega.definition.inputSchema.xActions ?? [];
    for (const a of xActions) {
      const key = `${name}.${a.action}`;
      if (!covered.has(key)) unclassified.push(key);
    }
  }
  assert.deepEqual(
    unclassified,
    [],
    `Unclassified mega-actions — add a row to MEGA_ACTION_SUBHANDLER or a COHERENCE_SKIP[mega] reason: ${unclassified.join(", ")}`,
  );
});

test("COHERENCE_SKIP entries are real, reasoned, and not double-listed", () => {
  // Keeps the skip-list honest: each key must be a registered mega, carry a real reason,
  // and never coexist with per-action rows (which would hide a half-covered surface).
  const megaNames = new Set(ALL_MEGAS.map((m) => m.definition.name));
  const rowMegas = new Set(MEGA_ACTION_SUBHANDLER.map((r) => r.mega.definition.name));
  for (const [name, reason] of Object.entries(COHERENCE_SKIP)) {
    assert.ok(megaNames.has(name), `COHERENCE_SKIP["${name}"] is not a registered mega-tool`);
    assert.ok(typeof reason === "string" && reason.length > 10, `COHERENCE_SKIP["${name}"] needs a real reason`);
    assert.ok(!rowMegas.has(name), `${name} is in BOTH COHERENCE_SKIP and MEGA_ACTION_SUBHANDLER — pick one`);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// v2.9.1 regression: every mega-tool must expose `context` at the top-level of
// inputSchema.properties. Without it, additionalProperties:false rejects the
// param at API validation, before validateContext gets to enforce the
// CRITICAL-tier requirement — making CRITICAL actions literally uncallable.
// Incident 2026-05-26 (instances.delete unusable from caller).
// ────────────────────────────────────────────────────────────────────────────
for (const mega of ALL_MEGAS) {
  test(`${mega.definition.name} — exposes 'context' at inputSchema top-level (v2.9.1 regression guard)`, () => {
    const props = mega.definition.inputSchema.properties ?? {};
    assert.ok(
      props.context,
      `${mega.definition.name}: missing 'context' in inputSchema.properties — additionalProperties:false will reject any caller-supplied context, breaking CRITICAL actions.`,
    );
    assert.equal(props.context.type, "string", `${mega.definition.name}: 'context' type should be "string"`);
    assert.ok(props.context.description, `${mega.definition.name}: 'context' missing description`);
    assert.match(
      props.context.description,
      /CRITICAL/,
      `${mega.definition.name}: 'context' description should mention CRITICAL tier requirement`,
    );
  });
}
