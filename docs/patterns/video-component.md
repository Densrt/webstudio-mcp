---
name: Video — use the native component, never ws:element tag="video"
description: Webstudio ships a first-class Video component. Using ws:element tag="video" instead breaks SSR rendering of boolean attributes (autoPlay, muted, loop, playsInline) and is silently wrong.
category: component
complexity: simple
lastUpdated: 2026-05-20
recommendedTool: build.push_fragment
recommendedToolNote: use the native Video component — NEVER ws:element tag='video' (breaks SSR)
---

# Video — native component pattern

## Rule

**Always use the Webstudio `Video` component**, never `ws:element tag="video"`.

## Why

The native `Video` component:
- Correctly renders **boolean HTML attributes** under SSR (autoPlay, muted, loop, playsInline) — these need attribute presence, not `="true"`, and Webstudio's runtime handles that only on first-class components.
- Wraps the source URL in the asset pipeline (CDN, caching headers).
- Exposes typed props that map 1:1 to `<video>` attributes — no string serialization edge cases.

A raw `ws:element tag="video"` ends up emitting `<video autoPlay="true">` which most browsers parse as truthy but some legacy validators flag as invalid. More importantly, the React Router v7 runtime serializes booleans differently than Webstudio's component shim.

## Supported props

| Prop | Type | Notes |
|---|---|---|
| `src` | string | Asset URL or external. Required. |
| `autoPlay` | boolean | Auto-start on mount. Requires `muted` for mobile. |
| `muted` | boolean | Mandatory for autoplay on mobile. |
| `loop` | boolean | Loop indefinitely. |
| `playsInline` | boolean | Mandatory for mobile Safari (avoids fullscreen takeover). |
| `crossOrigin` | string | `"anonymous"` if you need CORS (CDN). |
| `preload` | string | `"none"` / `"metadata"` / `"auto"`. |
| `poster` | string | Asset URL for thumbnail before play. |

## Example fragment

```json
{
  "instances": [
    {
      "id": "videoHeroId",
      "label": "VideoHero",
      "component": "@webstudio-is/sdk-components-react:Video",
      "props": [
        { "name": "src", "value": "https://cdn.example.com/hero.mp4" },
        { "name": "autoPlay", "value": true },
        { "name": "muted", "value": true },
        { "name": "loop", "value": true },
        { "name": "playsInline", "value": true },
        { "name": "preload", "value": "auto" }
      ],
      "children": []
    }
  ]
}
```

## Anti-pattern (DO NOT)

```json
{
  "component": "ws:element",
  "tag": "video",
  "props": [
    { "name": "autoplay", "value": "true" }
  ]
}
```

This **compiles**, **pushes successfully**, and **may even play in Chrome**, but is wrong: SSR markup is brittle, mobile Safari may stutter, and the Style panel cannot decode all attribute states.

## Verified on

Production and single-brand projects, hero video sections (2026-05).
