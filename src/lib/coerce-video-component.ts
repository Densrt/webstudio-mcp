// Coerce raw <video> instances to the native Video component + detect
// iframe-based YouTube/Vimeo embeds (v2.19.0 — global anti-pattern audit).
//
// Ground truth (docs/patterns/video-component.md): the native Video component
// renders boolean HTML attributes correctly under SSR (autoPlay, muted, loop,
// playsInline need attribute PRESENCE, not ="true") — a raw ws:element
// tag="video" serializes them as strings and breaks on some runtimes.
//
// Unlike the Image coerce, this one is CONDITIONAL: a raw <video> carrying
// element children (<source> tags) cannot be converted (Video takes a single
// `src` prop) — those are detected + hinted, never silently rewritten.
// Boolean-ish props are coerced to type:"boolean" and renamed to the Video
// component's camelCase names (autoplay → autoPlay, playsinline → playsInline).

import type { Instance, Prop } from "../types.js";

const RAW_COMPONENTS = new Set(["ws:element", "Box"]);

/** Lowercase HTML attribute → Video component prop name. */
const VIDEO_PROP_RENAMES: Record<string, string> = {
  autoplay: "autoPlay",
  playsinline: "playsInline",
  crossorigin: "crossOrigin",
};
const VIDEO_BOOLEAN_PROPS = new Set(["autoPlay", "muted", "loop", "playsInline", "controls"]);

export type VideoCoerceResult = {
  converted: Array<{ id: string; label?: string }>;
  /** Raw <video> with element children (<source>…) — NOT converted. */
  skippedWithChildren: Array<{ id: string; label?: string }>;
  /** ws:element iframes whose src points to YouTube/Vimeo. */
  iframeEmbeds: Array<{ id: string; label?: string; platform: "YouTube" | "Vimeo" }>;
  hints: string[];
  telemetry: Array<{ key: string; count: number }>;
};

export function coerceRawVideoInstances(instances: Instance[], props: Prop[]): VideoCoerceResult {
  const res: VideoCoerceResult = { converted: [], skippedWithChildren: [], iframeEmbeds: [], hints: [], telemetry: [] };

  for (const inst of instances) {
    if (!RAW_COMPONENTS.has(inst.component)) continue;
    const tag = (inst as { tag?: string }).tag;

    if (tag === "video") {
      const hasElementChildren = inst.children.some((c) => c.type === "id");
      if (hasElementChildren) {
        res.skippedWithChildren.push({ id: inst.id, label: inst.label });
        continue;
      }
      inst.component = "Video";
      delete (inst as { tag?: string }).tag;
      for (const p of props) {
        if (p.instanceId !== inst.id) continue;
        const renamed = VIDEO_PROP_RENAMES[p.name];
        if (renamed) p.name = renamed;
        if (VIDEO_BOOLEAN_PROPS.has(p.name) && p.type === "string") {
          const v = String(p.value).toLowerCase();
          (p as { type: string }).type = "boolean";
          // HTML boolean attribute semantics: presence = true ("", "autoplay",
          // "true"…); only an explicit "false" means false.
          (p as { value: unknown }).value = v !== "false";
        }
      }
      res.converted.push({ id: inst.id, label: inst.label });
      continue;
    }

    if (tag === "iframe") {
      const src = props.find((p) => p.instanceId === inst.id && p.name === "src");
      const url = src ? String(src.value) : "";
      if (/youtube\.com|youtu\.be|youtube-nocookie/.test(url)) {
        res.iframeEmbeds.push({ id: inst.id, label: inst.label, platform: "YouTube" });
      } else if (/vimeo\.com/.test(url)) {
        res.iframeEmbeds.push({ id: inst.id, label: inst.label, platform: "Vimeo" });
      }
    }
  }

  if (res.converted.length > 0) {
    res.hints.push(
      `${res.converted.length} raw <video> instance(s) auto-converted to the native Video component ` +
        `(SSR-correct boolean attributes — pattern video-component). Write component:"Video" directly next time.`,
    );
    res.telemetry.push({ key: "coerce:video-component", count: res.converted.length });
  }
  if (res.skippedWithChildren.length > 0) {
    res.hints.push(
      `${res.skippedWithChildren.length} raw <video> with <source> children left as-is (cannot auto-convert) — ` +
        `prefer the native Video component with a single src prop (pattern video-component).`,
    );
    res.telemetry.push({ key: "detect:raw-video-with-children", count: res.skippedWithChildren.length });
  }
  if (res.iframeEmbeds.length > 0) {
    res.hints.push(
      `${res.iframeEmbeds.length} iframe video embed(s) (${res.iframeEmbeds.map((e) => e.platform).join(", ")}) — ` +
        `consider the native YouTube/Vimeo components (privacy-enhanced, lazy facade). Left as-is.`,
    );
    res.telemetry.push({ key: "detect:iframe-video-embed", count: res.iframeEmbeds.length });
  }
  return res;
}
