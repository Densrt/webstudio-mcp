// Anomaly detectors for audit-page (hardcoded px, hardcoded colors, residues,
// dashes, images, links).

import type { WebstudioBuild } from "../../webstudio-client.js";
import { findVarsInValue } from "./helpers.js";
import type { Logger } from "./sections-tokens.js";

export function reportPxSpacings(localDecls: WebstudioBuild["styles"], log: Logger) {
  const pxSpacings = localDecls.filter((s) => {
    const v = s.value as { type?: string; unit?: string; value?: number };
    return v?.type === "unit" && v.unit === "px" && (v.value ?? 0) > 1 && /padding|margin|gap/i.test(s.property);
  });
  log(`  ${pxSpacings.length === 0 ? "✓" : "⚠"} ${pxSpacings.length} px hardcoded in spacing props`);
  const pxGroups: Record<string, number> = {};
  for (const s of pxSpacings) {
    const v = s.value as { value: number };
    const k = `${s.property}=${v.value}px`;
    pxGroups[k] = (pxGroups[k] ?? 0) + 1;
  }
  for (const [k, n] of Object.entries(pxGroups)) log(`    - ${k} : ${n}×`);
}

export function reportHardcodedColors(localDecls: WebstudioBuild["styles"], log: Logger) {
  const colors = localDecls.filter((s) => {
    const v = s.value as { type?: string; value?: unknown };
    if (!v) return false;
    if (v.type === "rgb") return true;
    if (v.type === "keyword" && typeof v.value === "string" && /^(#|red|blue|green|black|white|orange|purple|yellow|gray)/i.test(v.value)) return true;
    return false;
  });
  log(`  ${colors.length === 0 ? "✓" : "⚠"} ${colors.length} hardcoded color(s) without var()`);
  for (const c of colors.slice(0, 8)) log(`    - ${c.property} = ${JSON.stringify(c.value).slice(0, 70)}`);
}

export function reportResidues(
  build: WebstudioBuild,
  localSources: Set<string>,
  usedTokens: Map<string, number>,
  allowedPrefix: string,
  log: Logger,
) {
  log(`\n  Residue check (prefix "${allowedPrefix}"):`);
  const usedVars = new Set<string>();
  for (const s of build.styles) {
    if (!localSources.has(s.styleSourceId)) {
      // also check token-borne styles whose owners are referenced from this page
      // (we don't have an easy way; skip — focus on local)
    }
    const found: string[] = [];
    findVarsInValue(s.value, found);
    for (const f of found) usedVars.add(f);
  }
  const badVars = [...usedVars].filter((v) => !v.startsWith(allowedPrefix));
  log(`    ${badVars.length === 0 ? "✓" : "⚠"} ${badVars.length} var() name(s) not starting with "${allowedPrefix}"`);
  for (const v of badVars.slice(0, 12)) log(`      - var(--${v})`);

  const usedTokenNames = [...usedTokens.keys()];
  const badTokens = usedTokenNames.filter((n) => !n.toLowerCase().startsWith(allowedPrefix.toLowerCase()));
  log(`    ${badTokens.length === 0 ? "✓" : "⚠"} ${badTokens.length} token name(s) not starting with "${allowedPrefix}"`);
  for (const n of badTokens) log(`      - "${n}"`);
}

export function reportDashes(build: WebstudioBuild, pageIds: Set<string>, log: Logger) {
  let dashCount = 0;
  for (const id of pageIds) {
    const inst = build.instances.find((i) => i.id === id);
    if (!inst) continue;
    for (const c of inst.children) {
      if (c.type === "text" && /[—–]/.test(c.value)) {
        dashCount++;
        log(`  ⚠ em-dash in [${id}]: "${c.value.slice(0, 80)}"`);
      }
    }
  }
  if (dashCount === 0) log(`  ✓ No em/en-dashes in text content`);
}

export function reportImages(build: WebstudioBuild, pageIds: Set<string>, log: Logger) {
  log(`\n  Images:`);
  const images = Array.from(pageIds).map((id) => build.instances.find((i) => i.id === id)).filter((i) => i?.component === "Image");
  log(`    ${images.length} image(s)`);
  for (const img of images) {
    if (!img) continue;
    const altProp = build.props.find((p) => p.instanceId === img.id && p.name === "alt");
    if (!altProp) log(`    ⚠ ${img.id}: alt MISSING`);
    else if (altProp.type === "asset") log(`    ⚠ ${img.id}: alt = asset hash`);
    else if (!altProp.value || String(altProp.value).trim() === "") log(`    ⚠ ${img.id}: alt empty`);
    else log(`    ✓ ${img.id}: "${String(altProp.value).slice(0, 60)}"`);
  }
}

export function reportLinks(build: WebstudioBuild, pageIds: Set<string>, log: Logger) {
  log(`\n  Links:`);
  const links = Array.from(pageIds).map((id) => build.instances.find((i) => i.id === id)).filter((i) => i?.component === "Link" || i?.tag === "a");
  let badLinks = 0;
  for (const l of links) {
    if (!l) continue;
    const href = build.props.find((p) => p.instanceId === l.id && p.name === "href");
    const v = href ? (typeof href.value === "object" ? JSON.stringify(href.value).slice(0, 50) : String(href.value)) : "(absent)";
    if (!href || v === "#" || v === "" || v === "(absent)") {
      badLinks++;
      log(`    ⚠ ${l.id} (${l.label ?? l.tag ?? l.component}): href=${v}`);
    }
  }
  if (badLinks === 0) log(`    ✓ All links have an href`);
}
