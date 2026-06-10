---
name: Wire-schema economy — one-line summaries on the wire, full docs on demand
description: Why tools/list ships one-line action summaries instead of full docs, and the writing convention that makes it work. Cas réel — audit 2026-06-10, the 15-tool handshake weighed ~57k tokens (228 831 chars), every action description travelled twice (action enum description + xActions metadata).
category: architecture
complexity: simple
lastUpdated: 2026-06-10
recommendedTool: meta.get_more_tools
recommendedToolNote: Pass brief:"<tool>.<action>" for the FULL doc of one action — wire schemas only carry the one-line lead.
---

# Wire-schema economy

> Every MCP client loads the full `tools/list` payload into the agent's context **permanently**.
> Measured on v2.11.0 (audit 2026-06-10): 228 831 chars ≈ **57k tokens** for 15 tools — a quarter
> of a typical context window spent before the first call. Root cause: each action description
> travelled **twice** in each `inputSchema` (concatenated in the `action` enum description + again
> in the non-standard `xActions` metadata).

## The mechanism (v2.12.0)

| Layer | What travels | Where the full docs live |
|---|---|---|
| Wire (`tools/list`) | One-line summary per action + per-property descriptions | — |
| In-memory (`TOOLS` registry) | Full `xActions` (description, required, schemaKeys) | `meta.get_more_tools`, `meta.guide` BM25, `wrapper-schema-coherence` guard test |

Three pieces, all in `src/lib/mega-tool.ts` + `src/index.ts`:

1. **`summarizeActionDescription(description)`** — cuts the full description at the first
   canonical detail marker (`Do NOT use when:` / `Returns:` / `Side effects:` / `Example:`),
   hard cap 220 chars, always preserves the `CRITICAL — context required` safety marker.
2. **`toWireToolDefinition(definition)`** — strips `xActions` from the `inputSchema` served by
   the `ListToolsRequestSchema` handler. The in-memory definition keeps it (meta + tests read it).
3. **`meta.get_more_tools({brief:"<tool>.<action>"})`** — exact-match lookup returns the FULL
   action doc on demand. This is the progressive-disclosure path: agents pay for detail only
   when they need it (the Webflow MCP model: lean schemas + guide on demand).

Result measured after the change: 102 587 chars ≈ **25.6k tokens** (-55 %), zero functional loss.

## Writing convention for action descriptions (MANDATORY)

Because only the lead travels on the wire, the canonical description shape from `CLAUDE.md`
gains one hard rule:

- **The first sentence ("Use when: …") must be self-sufficient** — an agent seeing ONLY that
  sentence must know whether this action is the right one. Put redirections to sibling actions
  in the `Do NOT use when:` section (fetched on demand), but if confusing the two actions is
  *destructive*, put the warning in the lead.
- **`CRITICAL — context required` must appear for critical actions** — anywhere in the
  description is fine (the summarizer re-appends it to the lead if it was cut), but prefer
  putting it in the lead for clarity.
- Detail sections must start with their exact canonical markers (`Do NOT use when:`,
  `Returns:`, `Side effects:`, `Example:`) — the summarizer cuts on these strings.

## Pitfalls

- **Do not re-add metadata to the wire schema.** Anything placed inside `inputSchema` is paid
  for by every agent on every session. Server-side consumers read the in-memory definition.
- **Do not weaken the guard test.** `wrapper-schema-coherence.test.mjs` reads `xActions` from
  the in-memory definitions (`dist/tools/*.js` imports) — stripping happens only at the
  ListTools boundary, so the guard keeps working untouched.
- **Measuring**: spawn `dist/index.js`, send `initialize` + `tools/list` over stdio, sum
  `JSON.stringify(result).length / 4`. Re-measure after touching descriptions or the builder.
