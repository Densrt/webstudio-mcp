// Assemble the Webstudio transaction for an imported Figma variable set.
//
// Two outputs:
//  - CSS vars (root-scoped) for primitives (colors, spacing, radii, typo sizes)
//  - Tokens (styleSource type="token") for Font(...) composites
//
// Everything is bundled into ONE BuildPatchTransaction with three namespaces:
//   styleSources, styleSourceSelections, styles.

import { customAlphabet } from "nanoid";
import type { StyleValue } from "../../types.js";
import type { WebstudioBuild, BuildPatchOperation, BuildPatchTransaction } from "../../webstudio-client.js";
import {
  isHex, hexToColor, parseNumber, pxToRem, parseFont, convertLineHeight,
  deriveCssVarName, humanizeTokenName, categorizeKey, ensurePrefix, normalizeName,
} from "./parse.js";

const newId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);

const ROOT_INSTANCE_ID = ":root";

export type Override = { kind: "cssVar" | "token" | "skip"; name?: string };

export type PlanCssVar = {
  figmaKey: string;
  cssVarName: string;     // without leading "--"
  value: StyleValue;
  category: string;
};

export type PlanToken = {
  figmaKey: string;
  tokenName: string;
  styles: Record<string, StyleValue>;
};

export type Plan = {
  cssVars: PlanCssVar[];
  tokens: PlanToken[];
  skipped: { figmaKey: string; reason: string }[];
  warnings: string[];
};

export type BuildPlanArgs = {
  variables: Record<string, string>;
  prefix: string;
  overrides: Record<string, Override>;
};

/** First pass: turn the raw Figma dict into a structured Plan. */
export function buildPlan(args: BuildPlanArgs): Plan {
  const { variables, prefix, overrides } = args;
  const plan: Plan = { cssVars: [], tokens: [], skipped: [], warnings: [] };

  // Build a lookup index: figmaKey → derived cssVar name, for resolving Font(size: ref).
  const sizeRefIndex = new Map<string, string>();
  for (const [k, v] of Object.entries(variables)) {
    const cat = categorizeKey(k, v);
    if (cat === "spacing" || cat === "radius" || cat === "typo-size" || cat === "unknown") {
      sizeRefIndex.set(k.toLowerCase(), deriveCssVarName(k, prefix));
    }
  }

  for (const [figmaKey, figmaValue] of Object.entries(variables)) {
    const ov = overrides[figmaKey];
    if (ov?.kind === "skip") {
      plan.skipped.push({ figmaKey, reason: "override:skip" });
      continue;
    }

    const category = categorizeKey(figmaKey, figmaValue);

    // ---- Font composite → token --------------------------------------
    if (category === "typo-token") {
      const font = parseFont(figmaValue);
      if (!font) {
        plan.skipped.push({ figmaKey, reason: "Font(...) parse failed" });
        continue;
      }
      const styles: Record<string, StyleValue> = {};
      if (font.family) styles.fontFamily = { type: "fontFamily", value: [font.family] };
      if (font.weight !== undefined && !isNaN(font.weight)) {
        styles.fontWeight = { type: "unit", unit: "number", value: font.weight };
      }
      if (font.sizeRaw) {
        // size can be a ref (key) OR a raw number string
        const refKey = font.sizeRaw.toLowerCase();
        if (sizeRefIndex.has(refKey)) {
          styles.fontSize = { type: "var", value: sizeRefIndex.get(refKey)! };
        } else if (variables[font.sizeRaw] !== undefined) {
          // direct key match (case sensitive)
          styles.fontSize = { type: "var", value: deriveCssVarName(font.sizeRaw, prefix) };
        } else {
          const { n } = parseNumber(font.sizeRaw);
          if (!isNaN(n)) {
            styles.fontSize = { type: "unit", unit: "rem", value: pxToRem(n) };
          } else {
            plan.warnings.push(`${figmaKey}: size ref "${font.sizeRaw}" not found and not numeric, fontSize skipped.`);
          }
        }
      }
      if (font.lineHeightRaw !== undefined) {
        const { value, warning } = convertLineHeight(font.lineHeightRaw);
        styles.lineHeight = value;
        if (warning) plan.warnings.push(`${figmaKey}: ${warning}`);
      }
      if (font.letterSpacingRaw !== undefined && font.letterSpacingRaw !== 0) {
        styles.letterSpacing = { type: "unit", unit: "px", value: font.letterSpacingRaw };
      }

      const tokenName = ov?.kind === "token" && ov.name ? ov.name : humanizeTokenName(figmaKey);
      plan.tokens.push({ figmaKey, tokenName, styles });
      continue;
    }

    // ---- Override force-cssVar -----------------------------------------
    if (ov?.kind === "cssVar" && ov.name) {
      const cssVarName = ensurePrefix(normalizeName(ov.name), prefix);
      const parsed = resolvePrimitiveValue(figmaKey, figmaValue, category);
      if (!parsed) {
        plan.skipped.push({ figmaKey, reason: `cannot parse value "${figmaValue}"` });
        continue;
      }
      plan.cssVars.push({ figmaKey, cssVarName, value: parsed, category });
      continue;
    }

    // ---- Primitives → CSS var ------------------------------------------
    const value = resolvePrimitiveValue(figmaKey, figmaValue, category);
    if (!value) {
      plan.skipped.push({ figmaKey, reason: `cannot parse value "${figmaValue}" (category=${category})` });
      continue;
    }
    plan.cssVars.push({
      figmaKey,
      cssVarName: deriveCssVarName(figmaKey, prefix),
      value,
      category,
    });
  }

  return plan;
}

function resolvePrimitiveValue(figmaKey: string, figmaValue: string, category: string): StyleValue | null {
  if (isHex(figmaValue)) return hexToColor(figmaValue);

  const { n, explicitUnit } = parseNumber(figmaValue);
  if (isNaN(n)) return null;

  if (explicitUnit) {
    return { type: "unit", value: n, unit: explicitUnit };
  }

  switch (category) {
    case "radius":
      // Huge values (>=1000) → keep as px (full-pill convention is 9999px in CSS, but rem works too).
      if (n >= 1000) return { type: "unit", value: n, unit: "px" };
      return { type: "unit", value: pxToRem(n), unit: "rem" };
    case "spacing":
    case "typo-size":
      return { type: "unit", value: pxToRem(n), unit: "rem" };
    default:
      // unknown numeric → rem
      return { type: "unit", value: pxToRem(n), unit: "rem" };
  }
}

// ---- Patch assembly -------------------------------------------------------

export type AssembleResult = {
  transaction: BuildPatchTransaction;
  cssVarsCreated: string[];
  cssVarsUpdated: string[];
  cssVarsSkipped: string[];
  tokensCreated: { name: string; id: string }[];
  tokensUpdated: { name: string; id: string }[];
  tokensSkipped: string[];
  rootStyleSourceId: string;
  createdRootSource: boolean;
};

export function assembleTransaction(
  build: WebstudioBuild,
  plan: Plan,
  breakpointLabel: string,
  txId: string,
  overwrite: boolean,
): AssembleResult {
  const bp = build.breakpoints.find(
    (b) => b.label.toLowerCase() === breakpointLabel.toLowerCase() || b.id === breakpointLabel,
  );
  if (!bp) throw new Error(`Breakpoint "${breakpointLabel}" not found`);

  const styleSourcePatches: BuildPatchOperation[] = [];
  const selectionPatches: BuildPatchOperation[] = [];
  const stylePatches: BuildPatchOperation[] = [];

  // --- Root styleSource bootstrap --------------------------------------
  const rootSelection = build.styleSourceSelections.find((s) => s.instanceId === ROOT_INSTANCE_ID);
  let rootStyleSourceId: string | undefined;
  if (rootSelection) {
    const localId = rootSelection.values.find(
      (v) => build.styleSources.find((s) => s.id === v)?.type === "local",
    );
    if (localId) rootStyleSourceId = localId;
  }
  let createdRootSource = false;
  if (!rootStyleSourceId) {
    rootStyleSourceId = newId();
    createdRootSource = true;
    styleSourcePatches.push({
      op: "add",
      path: [rootStyleSourceId],
      value: { type: "local", id: rootStyleSourceId },
    });
    const newSel = rootSelection
      ? { instanceId: ROOT_INSTANCE_ID, values: [...rootSelection.values, rootStyleSourceId] }
      : { instanceId: ROOT_INSTANCE_ID, values: [rootStyleSourceId] };
    selectionPatches.push({
      op: rootSelection ? "replace" : "add",
      path: [ROOT_INSTANCE_ID],
      value: newSel,
    });
  }

  // --- Index existing CSS vars on root source for this breakpoint -----
  const existingVars = new Map<string, (typeof build.styles)[number]>();
  for (const d of build.styles) {
    if (d.styleSourceId !== rootStyleSourceId) continue;
    if (!d.property.startsWith("--")) continue;
    if (d.breakpointId !== bp.id) continue;
    existingVars.set(d.property, d);
  }

  const cssVarsCreated: string[] = [];
  const cssVarsUpdated: string[] = [];
  const cssVarsSkipped: string[] = [];

  for (const v of plan.cssVars) {
    const property = `--${v.cssVarName}`;
    const existing = existingVars.get(property);
    if (existing) {
      if (JSON.stringify(existing.value) === JSON.stringify(v.value)) {
        cssVarsSkipped.push(`${property} (identical)`);
        continue;
      }
      if (!overwrite) {
        cssVarsSkipped.push(`${property} (exists, overwrite=false)`);
        continue;
      }
      stylePatches.push({
        op: "replace",
        path: [`${rootStyleSourceId}:${bp.id}:${property}:`],
        value: { ...existing, value: v.value },
      });
      cssVarsUpdated.push(property);
    } else {
      stylePatches.push({
        op: "add",
        path: [`${rootStyleSourceId}:${bp.id}:${property}:`],
        value: {
          styleSourceId: rootStyleSourceId,
          breakpointId: bp.id,
          property,
          value: v.value,
          listed: false,
        },
      });
      cssVarsCreated.push(property);
    }
  }

  // --- Tokens ----------------------------------------------------------
  type WsStyleSource = { id: string; type: string; name?: string };
  const styleSources = (build.styleSources ?? []) as WsStyleSource[];

  const tokensCreated: { name: string; id: string }[] = [];
  const tokensUpdated: { name: string; id: string }[] = [];
  const tokensSkipped: string[] = [];

  for (const t of plan.tokens) {
    const existingToken = styleSources.find((s) => s.type === "token" && s.name === t.tokenName);
    let tokenId: string;
    let isNew = false;
    if (existingToken) {
      if (!overwrite) {
        tokensSkipped.push(`${t.tokenName} (exists, overwrite=false)`);
        continue;
      }
      tokenId = existingToken.id;
    } else {
      tokenId = newId();
      isNew = true;
      styleSourcePatches.push({
        op: "add",
        path: [tokenId],
        value: { id: tokenId, type: "token", name: t.tokenName } as unknown as BuildPatchOperation["value"],
      });
    }

    let addedAny = false;
    for (const [property, value] of Object.entries(t.styles)) {
      const state = "";
      const exists = !isNew && build.styles.some(
        (s) => s.styleSourceId === tokenId && s.breakpointId === bp.id && s.property === property && (s.state ?? "") === state,
      );
      if (exists) continue;
      stylePatches.push({
        op: "add",
        path: [`${tokenId}:${bp.id}:${property}:${state}`],
        value: { styleSourceId: tokenId, breakpointId: bp.id, property, value } as unknown as BuildPatchOperation["value"],
      });
      addedAny = true;
    }

    if (isNew) tokensCreated.push({ name: t.tokenName, id: tokenId });
    else if (addedAny) tokensUpdated.push({ name: t.tokenName, id: tokenId });
    else tokensSkipped.push(`${t.tokenName} (all decls already present)`);
  }

  const transaction: BuildPatchTransaction = {
    id: `mcp-import-figma-vars-${txId}`,
    payload: [
      ...(styleSourcePatches.length ? [{ namespace: "styleSources" as const, patches: styleSourcePatches }] : []),
      ...(selectionPatches.length ? [{ namespace: "styleSourceSelections" as const, patches: selectionPatches }] : []),
      ...(stylePatches.length ? [{ namespace: "styles" as const, patches: stylePatches }] : []),
    ],
  };

  return {
    transaction,
    cssVarsCreated,
    cssVarsUpdated,
    cssVarsSkipped,
    tokensCreated,
    tokensUpdated,
    tokensSkipped,
    rootStyleSourceId: rootStyleSourceId!,
    createdRootSource,
  };
}
