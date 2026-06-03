# Webstudio MCP — Technical Documentation

Reference notes accumulated while reverse-engineering the Webstudio Cloud API and
building an external MCP client. Each document focuses on one slice of what the
implementation had to figure out.

## Index

| Document | One-liner |
|---|---|
| [data-model.md](data-model.md) | Build = ten Immer Map containers. Fragment envelope. Breakpoint remap by label. |
| [auth.md](auth.md) | Cookie + CSRF + sec-fetch headers. `appVersion` discovery. `{"0": …}` batch quirk. |
| [patches.md](patches.md) | Immer Map-style patch keys per container. Children insertion. Multi-root push. |
| [pages.md](pages.md) | Page CRUD, variables, resources, expression encoding (`$ws$dataSource$…`). |
| [patterns.md](patterns.md) | Carousel, Swiper, NavigationMenu, Sheet, Tabs, Disclosure, CSS var scope. |
| [debugging.md](debugging.md) | Bisection method when paste yields raw text. Working CSS types. HtmlEmbed bug. |
| [safety.md](safety.md) | Cookie scope is account-wide. Dry-run + confirmation + `allowPush` whitelist. |

## Source layout

The runtime lives under `src/`. Everything pushed to Webstudio goes through the
helpers in:

- `src/webstudio-client.ts` — auth wrapper, `fetchBuild`, `applyTransaction`, retry loop
- `src/fragment-to-patches.ts` — fragment-shaped JSON to `BuildPatchTransaction`
- `src/builder.ts` — `FragmentBuilder` API for assembling fragments
- `src/expressions.ts` — `$ws$dataSource$…` expression encoding
- `src/types.ts` — fragment / build types observed on the wire
- `src/tools/*.ts` — one MCP tool per file (push-fragment, pages, variables, resources…)

These docs cite line ranges where helpful but the source remains the ground truth.
