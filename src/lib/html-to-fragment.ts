// HTML+CSS → WebstudioFragment converter (workstream #5, v1.0).
//
// Parses raw HTML markup + CSS rules and produces a WebstudioFragment ready for
// push_fragment delegation. Aligned with Webflow whtml_builder limits:
//   - 1 root element max
//   - No <style> tags in HTML (pass CSS separately)
//   - No @keyframes (use HtmlEmbed for that)
//   - Media queries limited to Webstudio breakpoints (base / tablet 991 /
//     mobile-landscape 767 / mobile-portrait 479)

import { parse, type HTMLElement, type Node } from "node-html-parser";
import { FragmentBuilder } from "../builder/fragment-builder.js";
import type { WebstudioFragment, StyleValue } from "../types.js";

const SKIP_ATTRS = new Set(["class", "style"]);

function isHtmlElement(node: Node): node is HTMLElement {
  return node.nodeType === 1;
}

/**
 * Walk the HTML AST and add each element/text to the FragmentBuilder.
 * Returns a map (className → instanceId[]) used later to apply CSS rules.
 */
function walkHtml(
  builder: FragmentBuilder,
  node: HTMLElement,
  parentId: string | undefined,
  classToInstances: Map<string, string[]>,
): string {
  const tag = node.tagName?.toLowerCase() ?? "div";
  // <img> maps to the native Image component (v2.18.0 — src accepts URL
  // strings, see pattern image-component), everything else to Box + tag.
  const isImg = tag === "img";
  const instanceId = isImg
    ? builder.addInstance("Image", { label: "img", parentId })
    : builder.addInstance("Box", { tag, label: tag, parentId });

  // Register classes
  const classAttr = node.getAttribute("class") ?? "";
  for (const cls of classAttr.split(/\s+/).filter(Boolean)) {
    const arr = classToInstances.get(cls) ?? [];
    arr.push(instanceId);
    classToInstances.set(cls, arr);
  }

  // Register props for non-class/style attributes
  for (const [name, value] of Object.entries(node.attributes)) {
    if (SKIP_ATTRS.has(name)) continue;
    if (value === undefined || value === null) continue;
    // Image's width/height are numeric props (CLS hints).
    if (isImg && (name === "width" || name === "height") && /^\d+$/.test(String(value))) {
      builder.addProp(instanceId, name, "number", Number(value));
      continue;
    }
    builder.addProp(instanceId, name, "string", String(value));
  }

  // Walk children (text + element)
  for (const child of node.childNodes) {
    if (isHtmlElement(child)) {
      walkHtml(builder, child, instanceId, classToInstances);
    } else if (child.nodeType === 3) {
      // Text node
      const text = (child.rawText ?? "").trim();
      if (text.length > 0) builder.addText(instanceId, text);
    }
  }
  return instanceId;
}

const MEDIA_TO_BREAKPOINT: Array<{ pattern: RegExp; breakpoint: string }> = [
  { pattern: /max-width:\s*479/, breakpoint: "mobile-portrait" },
  { pattern: /max-width:\s*767/, breakpoint: "mobile-landscape" },
  { pattern: /max-width:\s*991/, breakpoint: "tablet" },
];

function detectBreakpoint(mediaQuery: string | undefined): string {
  if (!mediaQuery) return "base";
  for (const { pattern, breakpoint } of MEDIA_TO_BREAKPOINT) {
    if (pattern.test(mediaQuery)) return breakpoint;
  }
  return "base";
}

/**
 * Minimal CSS parser — splits on `{`/`}` to extract rules. Supports nested
 * @media blocks (single level). Returns array of {selector, decls, breakpoint}.
 */
function parseCss(css: string): Array<{ selector: string; decls: Record<string, string>; breakpoint: string }> {
  const rules: Array<{ selector: string; decls: Record<string, string>; breakpoint: string }> = [];

  // Strip comments
  css = css.replace(/\/\*[\s\S]*?\*\//g, "");

  // Reject @keyframes
  if (/@keyframes/.test(css)) {
    throw new Error("@keyframes is not supported in push_html (use HtmlEmbed instead).");
  }

  // Extract @media blocks first
  const mediaRegex = /@media\s+([^{]+)\{((?:[^{}]|\{[^{}]*\})*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = mediaRegex.exec(css))) {
    const query = match[1].trim();
    const breakpoint = detectBreakpoint(query);
    const body = match[2];
    rules.push(...parseRulesFlat(body, breakpoint));
  }

  // Strip media blocks then parse remaining as flat
  const flat = css.replace(mediaRegex, "");
  rules.push(...parseRulesFlat(flat, "base"));

  return rules;
}

function parseRulesFlat(css: string, breakpoint: string): Array<{ selector: string; decls: Record<string, string>; breakpoint: string }> {
  const rules: Array<{ selector: string; decls: Record<string, string>; breakpoint: string }> = [];
  const ruleRegex = /([^{}]+)\{([^}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = ruleRegex.exec(css))) {
    const selector = match[1].trim();
    const body = match[2];
    const decls: Record<string, string> = {};
    for (const decl of body.split(";")) {
      const t = decl.trim();
      if (!t.includes(":")) continue;
      const [prop, ...rest] = t.split(":");
      decls[prop.trim()] = rest.join(":").trim();
    }
    if (selector && Object.keys(decls).length > 0) {
      rules.push({ selector, decls, breakpoint });
    }
  }
  return rules;
}

function decodeStyleValue(raw: string): StyleValue {
  // Try unit (12px, 1.5rem)
  const unitMatch = raw.match(/^(-?\d+(?:\.\d+)?)\s*(px|rem|em|%|vh|vw|fr)$/);
  if (unitMatch) return { type: "unit", value: Number(unitMatch[1]), unit: unitMatch[2] };
  // Number-only
  if (/^-?\d+(\.\d+)?$/.test(raw)) return { type: "unit", value: Number(raw), unit: "number" } as StyleValue;
  // var()
  const varMatch = raw.match(/^var\(\s*--([a-zA-Z0-9_-]+)\s*\)$/);
  if (varMatch) return { type: "var", value: varMatch[1] } as StyleValue;
  // Color hex
  if (/^#[0-9a-fA-F]{3,8}$/.test(raw)) return { type: "keyword", value: raw } as StyleValue;
  // Fallback: keyword
  return { type: "keyword", value: raw } as StyleValue;
}

/**
 * Apply parsed CSS rules to the FragmentBuilder by matching .classname selectors
 * to instance ids via classToInstances. Only supports simple class selectors
 * (.foo, .foo.bar) — complex selectors (descendant, attribute, pseudo, etc.)
 * are skipped with a warning collected for the caller.
 */
function applyRules(
  builder: FragmentBuilder,
  rules: Array<{ selector: string; decls: Record<string, string>; breakpoint: string }>,
  classToInstances: Map<string, string[]>,
): { applied: number; skipped: number; warnings: string[] } {
  let applied = 0;
  let skipped = 0;
  const warnings: string[] = [];

  for (const rule of rules) {
    // Accept ".foo" or ".foo.bar" or "tag.foo" — pick the simplest first
    const simpleClassMatch = rule.selector.match(/^\.([a-zA-Z][\w-]*)\s*$/);
    if (!simpleClassMatch) {
      skipped += 1;
      if (warnings.length < 10) warnings.push(`skipped selector "${rule.selector}" (only simple class selectors supported)`);
      continue;
    }
    const cls = simpleClassMatch[1];
    const targets = classToInstances.get(cls);
    if (!targets || targets.length === 0) {
      skipped += 1;
      continue;
    }
    for (const instanceId of targets) {
      for (const [prop, raw] of Object.entries(rule.decls)) {
        const value = decodeStyleValue(raw);
        builder.addStyle(instanceId, prop, value, rule.breakpoint);
        applied += 1;
      }
    }
  }
  return { applied, skipped, warnings };
}

export type HtmlToFragmentResult = {
  fragment: WebstudioFragment;
  rootInstanceId: string;
  applied: number;
  skipped: number;
  warnings: string[];
};

export function htmlToFragment(html: string, css: string = ""): HtmlToFragmentResult {
  const root = parse(html, { lowerCaseTagName: true });
  const elements = root.childNodes.filter(isHtmlElement);
  if (elements.length === 0) throw new Error("No root element found in HTML.");
  if (elements.length > 1) throw new Error("Multiple root elements found — push_html requires exactly one root.");

  const builder = new FragmentBuilder();
  const classToInstances = new Map<string, string[]>();
  const rootInstanceId = walkHtml(builder, elements[0], undefined, classToInstances);

  let applied = 0;
  let skipped = 0;
  let warnings: string[] = [];
  if (css.trim().length > 0) {
    const rules = parseCss(css);
    const stats = applyRules(builder, rules, classToInstances);
    applied = stats.applied;
    skipped = stats.skipped;
    warnings = stats.warnings;
  }

  return { fragment: builder.build(), rootInstanceId, applied, skipped, warnings };
}
