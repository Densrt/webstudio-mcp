# Components cheat-sheet

Quick reference for which Webstudio component to use vs `ws:element`. The
`addInstance()` helper in `FragmentBuilder` already maps a small set of
high-level aliases (Box → div, Heading → h1, …). Everything else passes
through as-is and must match a real Webstudio component name.

## First-class components — never use `ws:element` for these

These are real React components shipped by Webstudio (runtime, assets,
canvas behaviour). Using `ws:element` with the equivalent HTML tag breaks
the editor UI and skips runtime features (lazy loading, poster, etc.).

| Component | Use for | Notes |
|---|---|---|
| `Image` | `<img>` | Asset-bound dims, srcset, lazy loading |
| `Video` | `<video>` (incl. hero bg) | See props below |
| `YouTube` | YouTube embeds | Privacy-enhanced iframe |
| `Vimeo` | Vimeo embeds | Privacy-enhanced iframe |
| `HtmlEmbed` | raw HTML | `executeScriptOnCanvas` prop |
| `Form` / `Input` / `Textarea` | form fields | Webstudio form runtime |
| `Dialog`, `Tabs`, `NavigationMenu`, `Tooltip`, `Popover`, `Switch`, `Checkbox`, `Select`, `RadioGroup`, `Collapsible`, `Label` | interactive primitives | Radix-based — prefixed automatically |

## Video — supported props

`Video` is the first-class component for HTML5 video. **Do not** use
`addInstance("ws:element", { tag: "video" })`.

| Prop | Type | Notes |
|---|---|---|
| `src` | string | URL of the video file |
| `autoPlay` | boolean | iOS requires `muted=true` to honour autoplay |
| `muted` | boolean | |
| `loop` | boolean | |
| `playsInline` | boolean | Required on iOS to avoid fullscreen takeover |
| `crossOrigin` | string | `"anonymous"` is the safe default |
| `preload` | string | `"auto"` \| `"metadata"` \| `"none"` |
| `poster` | string | URL of the preview image |
| `aria-hidden` | boolean | Set to `true` for decorative bg videos |

For hero/background videos use the helper:

```ts
import { addVideoBackground } from "@webstudio-mcp/components";

addVideoBackground(b, {
  parentId: heroBoxId,
  src: "https://cdn.example.com/hero.mp4",
  poster: "https://cdn.example.com/hero-poster.jpg",
});
```

The helper defaults to: `autoPlay`, `muted`, `loop`, `playsInline`,
`preload="auto"`, `crossOrigin="anonymous"`, `aria-hidden`, plus
`position:absolute; inset:0; width:100%; height:100%; object-fit:cover;
z-index:0; pointer-events:none`.
