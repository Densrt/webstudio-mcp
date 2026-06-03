# Tool search & deferred loading

## Why it matters

The MCP server exposes 65 tools. Loaded as a flat manifest, that's ~20-30k tokens
of tool descriptions sent on every request — way past the 30-50 tools threshold
beyond which Anthropic measures significant degradation in tool selection
accuracy ([Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents),
[Tool Search Tool docs](https://platform.claude.com/docs/en/docs/agents-and-tools/tool-use/tool-search-tool)).

The remediation has two parts:

1. **Server-side** — categorize tools and expose a discovery tool. ✅ Done in this MCP.
2. **Client-side** — wire the harness to load only a small core set by default and
   fetch the rest on demand. ⚠️ Requires harness config (see below).

## What this MCP provides (server-side)

- `webstudio_index` — discovery tool returning a categorized listing with 1-liner
  triggers. Use `category` / `search` / `verbose` filters.
- `webstudio_describe_pattern` — patterns + helpers documentation surfaced inline.
- `CORE_TOOL_NAMES` exported from `src/tools/index-tool-categories.ts` — the 10
  always-loaded tools. Reference for the client-side config.
- `TOOL_CATEGORY` — name → category mapping (13 categories).

## Recommended client-side wiring

### Anthropic API direct (Claude.ai / API)

Add `tool_search_tool_bm25_20251119` to the request:

```json
{
  "tool_choice": "auto",
  "tools": [...],
  "tool_search_tool": { "type": "bm25_20251119", "max_results": 5 }
}
```

Mark non-core tools with `defer_loading: true` in the tool definition (requires
SDK update — server-side `defer_loading` field is currently a no-op on stdio MCP
clients because the SDK passes the full manifest).

### Claude Code CLI

As of 2026-05, Claude Code doesn't yet expose a per-tool `defer_loading` toggle
in `~/.claude.json`. Workarounds:

- **Restrict via `allowedTools`** in agent definitions to limit which webstudio_*
  tools an agent can call. Combined with `webstudio_index`, this gives the agent
  a small surface + a discovery escape hatch.
- **Use sub-agents per toolset** (e.g. `agent-webstudio-styles` with only the
  17 style/token tools). Drops the loaded manifest by 75% on those agents.
- **Wait for Tool Search Tool support** in Claude Code (tracked).

## Cost vs benefit

Anthropic's own measurement on multi-MCP deployments with Tool Search:
> ~85% reduction in tool-context tokens when defer_loading is active for
> non-core tools.

For Webstudio MCP:
- Current manifest: ~65 tools × ~350 tokens (post-revamp v0.4.0) ≈ 22.5k tokens
- Core only: 10 tools × ~350 tokens ≈ 3.5k tokens
- **Potential savings: ~22k tokens per request, or ~86%.**

Until the harness supports it, the consolidation + description quality work in
this MCP still pays off: the agent's selection accuracy improves even at the
full manifest size, because each tool is now disambiguated, exampled, and
side-effect-tagged.
