#!/usr/bin/env node
// v2.0 — standardise the YAML frontmatter of docs/patterns/*.md.
//
// Convention (cf plan §C):
//   name:        existing
//   description: existing
//   category:    component | workflow | architecture | gotcha (mapped from old `type:`)
//   complexity:  simple | medium | advanced (heuristic from file size)
//   lastUpdated: 2026-05-20 (today by default)
//
// `type:` legacy field is REMOVED — old values mapped:
//   pattern → component (most common Radix/CSS patterns)
//   project → workflow  (multi-step recipes)
//   anything else → preserved verbatim

import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const PATTERNS_DIR = "docs/patterns";
const TODAY = "2026-05-20";

// Heuristic: complexity from file LOC.
function inferComplexity(loc) {
  if (loc < 100) return "simple";
  if (loc < 250) return "medium";
  return "advanced";
}

// Heuristic from filename / old type.
function inferCategory(slug, oldType) {
  if (oldType === "pattern") return "component";
  if (oldType === "project") return "workflow";
  if (oldType === "architecture") return "architecture";
  if (oldType === "gotcha") return "gotcha";
  // Fallback by slug
  if (/^(carousel|navigation|sheet|swiper|tabs|ticker|video|hover|css-vars|html-embed|reset|fragment|radix)/.test(slug)) {
    return "component";
  }
  if (/-trap|-gotcha|-quirk/.test(slug)) return "gotcha";
  if (/^(architecture|page-management|webstudio-cloud-auth|webstudio-fragment-format|trpc-api)/.test(slug)) {
    return "architecture";
  }
  if (/^(recipes|paste-debug|tokens-variants|variables-and-bindings|resources-http|ws-collection)/.test(slug)) {
    return "workflow";
  }
  return "workflow";
}

function parseFrontmatter(content) {
  // Match opening `---\n...\n---\n` (frontmatter block).
  const m = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { fields: null, rest: content };
  const fields = {};
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    fields[key] = value;
  }
  return { fields, rest: content.slice(m[0].length) };
}

function serializeFrontmatter(fields) {
  const order = ["name", "description", "category", "complexity", "lastUpdated"];
  const lines = ["---"];
  for (const key of order) {
    if (fields[key] !== undefined) lines.push(`${key}: ${fields[key]}`);
  }
  // Preserve any extra fields the script didn't expect.
  for (const [key, value] of Object.entries(fields)) {
    if (order.includes(key) || key === "type") continue;
    lines.push(`${key}: ${value}`);
  }
  lines.push("---");
  return lines.join("\n") + "\n";
}

const entries = await readdir(PATTERNS_DIR);
let updated = 0;
let unchanged = 0;
for (const entry of entries) {
  if (!entry.endsWith(".md")) continue;
  const path = join(PATTERNS_DIR, entry);
  const slug = entry.replace(/\.md$/, "");
  const raw = await readFile(path, "utf-8");
  const { fields, rest } = parseFrontmatter(raw);

  const loc = raw.split("\n").length;
  const next = {
    name: fields?.name ?? slug.replace(/-/g, " "),
    description: fields?.description ?? "(no description)",
    category: inferCategory(slug, fields?.type),
    complexity: fields?.complexity ?? inferComplexity(loc),
    lastUpdated: fields?.lastUpdated ?? TODAY,
  };

  // Preserve unknown fields (excluding `type:` which is renamed to `category:`).
  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      if (["name", "description", "type", "complexity", "lastUpdated"].includes(key)) continue;
      next[key] = value;
    }
  }

  const newBlock = serializeFrontmatter(next);
  const newContent = newBlock + rest;
  if (newContent === raw) {
    unchanged++;
    continue;
  }
  await writeFile(path, newContent);
  updated++;
  console.log(`✓ ${slug} → category:${next.category}, complexity:${next.complexity}`);
}

console.log(`\nDone: ${updated} updated, ${unchanged} unchanged (${entries.filter((e) => e.endsWith(".md")).length} total).`);
