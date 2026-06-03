// Video background helper — wraps the first-class Webstudio `Video` component
// with the props + styles required for a hero/section background:
// autoplay + muted + loop + playsInline, absolutely positioned, object-fit cover.
//
// IMPORTANT: Webstudio exposes `Video` as a first-class component. Never use
// `ws:element` with tag="video" — the editor won't recognise it as a video
// node and the runtime preload/poster behaviour will not apply.

import { FragmentBuilder, num, px, keyword } from "../builder.js";
import type { InstanceId } from "../types.js";

export interface VideoBackgroundOptions {
  /** Required — parent Box that hosts the video. */
  parentId: InstanceId;
  /** Required — URL of the .mp4 / .webm file. */
  src: string;
  /** Optional — deterministic instance ID prefix. */
  id?: string;
  /** Default "Video Background". */
  label?: string;
  /** Optional poster image URL shown before playback starts. */
  poster?: string;
  /** Default true. iOS requires muted=true alongside playsInline=true for autoplay. */
  autoPlay?: boolean;
  /** Default true. */
  muted?: boolean;
  /** Default true. */
  loop?: boolean;
  /** Default true — keeps iOS from forcing fullscreen on play. */
  playsInline?: boolean;
  /** Default "auto". */
  preload?: "auto" | "metadata" | "none";
  /** Default "anonymous". Set to "" to omit (rare). */
  crossOrigin?: "anonymous" | "use-credentials" | "";
  /** Default true — hero bg videos are decorative. */
  ariaHidden?: boolean;
  /** Default 0. Override if the video must sit above other absolute children. */
  zIndex?: number;
  /** Default "cover". */
  objectFit?: "cover" | "contain" | "fill" | "none" | "scale-down";
}

export interface VideoBackgroundResult {
  videoId: InstanceId;
}

export function addVideoBackground(
  b: FragmentBuilder,
  options: VideoBackgroundOptions,
): VideoBackgroundResult {
  const videoId = b.addInstance("Video", {
    id: options.id,
    parentId: options.parentId,
    label: options.label ?? "Video Background",
  });

  b.addProp(videoId, "src", "string", options.src);
  b.addProp(videoId, "autoPlay", "boolean", options.autoPlay ?? true);
  b.addProp(videoId, "muted", "boolean", options.muted ?? true);
  b.addProp(videoId, "loop", "boolean", options.loop ?? true);
  b.addProp(videoId, "playsInline", "boolean", options.playsInline ?? true);
  b.addProp(videoId, "preload", "string", options.preload ?? "auto");
  const crossOrigin = options.crossOrigin ?? "anonymous";
  if (crossOrigin) b.addProp(videoId, "crossOrigin", "string", crossOrigin);
  if (options.poster) b.addProp(videoId, "poster", "string", options.poster);
  if (options.ariaHidden ?? true) b.addProp(videoId, "aria-hidden", "boolean", true);

  b.addStyles(videoId, {
    position: keyword("absolute"),
    top: num(0),
    left: num(0),
    width: { type: "unit", value: 100, unit: "%" },
    height: { type: "unit", value: 100, unit: "%" },
    objectFit: keyword(options.objectFit ?? "cover"),
    zIndex: num(options.zIndex ?? 0),
    // Decorative background: prevent pointer events from intercepting clicks
    // on overlaid hero content (CTAs, headings).
    pointerEvents: keyword("none"),
  });

  return { videoId };
}
