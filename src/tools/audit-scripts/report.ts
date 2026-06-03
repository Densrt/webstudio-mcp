// Report rendering for audit-scripts.

import type { Finding, FindingKind, HtmlSource } from "./types.js";

export function renderReport(
  projectSlug: string,
  projectTitle: string | undefined,
  sources: HtmlSource[],
  findings: Finding[],
  verbose: boolean,
): string {
  const byKind = (k: FindingKind) => findings.filter((f) => f.kind === k);
  const blocking = byKind("render-blocking-script");
  const gFonts = byKind("google-fonts-external");
  const trackers = byKind("tracker");
  const inlines = byKind("inline-script");
  const cssExt = byKind("external-css");

  const lines: string[] = [];
  lines.push(`# Scripts audit — ${projectTitle ?? projectSlug}`);
  lines.push(`Sources scanned: ${sources.length} (head slot + page meta + embeds)`);

  if (findings.length === 0) {
    lines.push("");
    lines.push("✅ no third-party scripts found");
    return lines.join("\n");
  }

  lines.push("");
  lines.push("## 📊 Summary");
  lines.push(`  🚫 render-blocking scripts: ${blocking.length}`);
  lines.push(`  🌐 Google Fonts external:   ${gFonts.length}`);
  lines.push(`  📋 trackers detected:       ${trackers.length}`);
  lines.push(`  💉 inline scripts:          ${inlines.length}`);
  lines.push(`  🔗 external CSS:            ${cssExt.length}`);

  if (blocking.length > 0) {
    lines.push("");
    lines.push("## 🚫 Scripts render-blocking (CRITIQUE)");
    lines.push("  Add `defer` (recommended) or `async` to these <script src> tags.");
    for (const f of blocking) {
      lines.push(`  - [${f.source}]`);
      lines.push(`      ${f.snippet}`);
    }
  }

  if (gFonts.length > 0) {
    lines.push("");
    lines.push("## 🌐 Google Fonts externes");
    lines.push("  External handshake (TLS + IP log). Upload .woff2 to Assets and self-host.");
    for (const f of gFonts) {
      lines.push(`  - [${f.source}]`);
      lines.push(`      ${f.snippet}`);
    }
  }

  if (trackers.length > 0) {
    lines.push("");
    lines.push("## 📋 Trackers détectés (info)");
    const seen = new Set<string>();
    for (const f of trackers) {
      const key = `${f.extra ?? f.snippet}::${f.source}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`  - ${f.extra ?? f.snippet}  —  ${f.source}`);
    }
  }

  if (inlines.length > 0) {
    lines.push("");
    lines.push(`## 💉 Scripts inline (${inlines.length})`);
    lines.push("  Verify each is minimal (config snippets are fine; large code → move to asset).");
    const list = verbose ? inlines : inlines.slice(0, 10);
    for (const f of list) lines.push(`  - [${f.source}] ${f.snippet}`);
    if (!verbose && inlines.length > 10) {
      lines.push(`  … (+${inlines.length - 10} more — verbose=true to expand)`);
    }
  }

  if (cssExt.length > 0) {
    lines.push("");
    lines.push(`## 🔗 CSS tiers (${cssExt.length})`);
    lines.push("  Critical CSS should be inlined; defer the rest (media=print swap or rel=preload).");
    const list = verbose ? cssExt : cssExt.slice(0, 10);
    for (const f of list) lines.push(`  - [${f.source}] ${f.snippet}`);
    if (!verbose && cssExt.length > 10) {
      lines.push(`  … (+${cssExt.length - 10} more — verbose=true to expand)`);
    }
  }

  return lines.join("\n");
}
