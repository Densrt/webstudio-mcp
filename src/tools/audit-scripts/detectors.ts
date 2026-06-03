// Per-source regex detectors (scripts, links, trackers).

import type { Finding, HtmlSource } from "./types.js";

const TRACKERS: Array<{ name: string; pattern: RegExp }> = [
  { name: "Google Tag Manager", pattern: /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]+/i },
  { name: "Google Analytics (gtag)", pattern: /googletagmanager\.com\/gtag\/js|G-[A-Z0-9]{6,}|UA-\d{4,}/i },
  { name: "Google Analytics (analytics.js)", pattern: /google-analytics\.com\/analytics\.js/i },
  { name: "Meta Pixel", pattern: /connect\.facebook\.net\/.*\/fbevents\.js|fbq\s*\(/i },
  { name: "Hotjar", pattern: /static\.hotjar\.com|hjid\s*[:=]/i },
  { name: "Clarity (Microsoft)", pattern: /clarity\.ms\/tag/i },
  { name: "Plausible", pattern: /plausible\.io\/js/i },
  { name: "Matomo", pattern: /matomo\.js|piwik\.js/i },
  { name: "Intercom", pattern: /widget\.intercom\.io/i },
  { name: "Crisp", pattern: /client\.crisp\.chat/i },
  { name: "LinkedIn Insight", pattern: /snap\.licdn\.com\/li\.lms-analytics/i },
  { name: "TikTok Pixel", pattern: /analytics\.tiktok\.com\/i18n\/pixel/i },
  { name: "HubSpot", pattern: /js\.hs-scripts\.com|js\.hsforms\.net/i },
];

function snippet(s: string, max = 50): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max) + "…" : clean;
}

function hasAttr(tag: string, attr: string): boolean {
  return new RegExp(`\\b${attr}\\b(?:\\s*=|\\s|>|/)`, "i").test(tag);
}

export function detectInSource(src: HtmlSource): Finding[] {
  const findings: Finding[] = [];
  const html = src.html;

  // <script> opening tags
  const scriptRe = /<script\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html)) !== null) {
    const tag = m[0];
    const hasSrc = /\bsrc\s*=/i.test(tag);
    if (hasSrc) {
      const isAsync = hasAttr(tag, "async");
      const isDefer = hasAttr(tag, "defer");
      if (!isAsync && !isDefer) {
        findings.push({
          kind: "render-blocking-script",
          severity: "critical",
          source: src.label,
          snippet: snippet(tag),
        });
      }
    } else {
      findings.push({
        kind: "inline-script",
        severity: "info",
        source: src.label,
        snippet: snippet(tag),
      });
    }
  }

  // <link> tags
  const linkRe = /<link\b[^>]*>/gi;
  while ((m = linkRe.exec(html)) !== null) {
    const tag = m[0];
    const hrefMatch = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i);
    if (!hrefMatch) continue;
    const href = hrefMatch[1];
    if (/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(href)) {
      findings.push({
        kind: "google-fonts-external",
        severity: "warn",
        source: src.label,
        snippet: snippet(tag),
      });
    } else if (/\.css(\?|$)/i.test(href) || /stylesheet/i.test(tag)) {
      const hasMedia = /\bmedia\s*=/i.test(tag);
      const isPreload = /rel\s*=\s*["']?preload/i.test(tag);
      if (!hasMedia && !isPreload) {
        findings.push({
          kind: "external-css",
          severity: "info",
          source: src.label,
          snippet: snippet(tag),
        });
      }
    }
  }

  // Tracker detection — match against full html (covers inline init + external script).
  for (const tracker of TRACKERS) {
    if (tracker.pattern.test(html)) {
      findings.push({
        kind: "tracker",
        severity: "info",
        source: src.label,
        snippet: tracker.name,
        extra: tracker.name,
      });
    }
  }

  return findings;
}
