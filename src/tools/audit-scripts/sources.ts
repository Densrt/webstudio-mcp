// Collect all HTML sources to scan: project-level head slot, page meta, HtmlEmbed/ContentEmbed.

import type { WebstudioBuild } from "../../webstudio-client.js";
import type { HtmlSource } from "./types.js";

/** Heuristic: a string is HTML-like if it contains an opening tag we care about. */
function looksLikeHeadHtml(s: string): boolean {
  return /<\s*(script|link|meta|style)\b/i.test(s);
}

export function collectProjectHeadSources(build: WebstudioBuild): HtmlSource[] {
  const out: HtmlSource[] = [];
  // Webstudio doesn't expose a strongly-typed "head slot" field in our local
  // WebstudioBuild type — scan loosely. Anything string-valued on `build.project`
  // or on `build.pages` (excluding the structured `pages`/`folders` arrays)
  // that looks like HTML wins.
  const candidates: Array<{ obj: unknown; prefix: string }> = [
    { obj: (build as unknown as { project?: Record<string, unknown> }).project, prefix: "build.project" },
    { obj: (build as unknown as { pages?: Record<string, unknown> }).pages, prefix: "build.pages" },
  ];
  for (const { obj, prefix } of candidates) {
    if (!obj || typeof obj !== "object") continue;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (k === "pages" || k === "folders") continue;
      if (typeof v === "string" && looksLikeHeadHtml(v)) {
        out.push({ label: `Head slot global (${prefix}.${k})`, html: v });
      }
    }
  }
  return out;
}

export function collectPageMetaSources(build: WebstudioBuild): HtmlSource[] {
  const out: HtmlSource[] = [];
  for (const page of build.pages.pages) {
    const meta = page.meta as Record<string, unknown> | undefined;
    if (!meta) continue;
    for (const [k, v] of Object.entries(meta)) {
      if (typeof v !== "string") continue;
      if (!looksLikeHeadHtml(v)) continue;
      out.push({
        label: `page "${page.name}" (${page.path || "/"})  meta.${k}`,
        html: v,
      });
    }
  }
  return out;
}

export function collectEmbedSources(build: WebstudioBuild): HtmlSource[] {
  const out: HtmlSource[] = [];
  const embedInstances = build.instances.filter(
    (i) => i.component === "HtmlEmbed" || i.component === "ContentEmbed",
  );
  const embedIds = new Set(embedInstances.map((i) => i.id));
  for (const p of build.props) {
    if (!embedIds.has(p.instanceId)) continue;
    if (p.name !== "code") continue;
    if (typeof p.value !== "string") continue;
    if (!looksLikeHeadHtml(p.value)) continue;
    const inst = embedInstances.find((i) => i.id === p.instanceId);
    const labelPart = inst?.label ? ` "${inst.label}"` : "";
    out.push({
      label: `${inst?.component ?? "Embed"}${labelPart} [${p.instanceId}]`,
      html: p.value,
    });
  }
  return out;
}
