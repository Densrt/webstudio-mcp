---
name: Tokens cloud vs local — avoid silent duplication via useTokens
description: The useTokens param of build.push_complete consumes the LOCAL registry (~/.webstudio-mcp/projects/<slug>/tokens.json), not the cloud. If the slug matches an existing cloud token by normalized name, Webstudio creates a silent duplicate (no error, no warning). Correct workflow - list_tokens_cloud then tokens.attach_token. Production incident: H1 Title / Body M duplicated.
category: workflow
complexity: medium
lastUpdated: 2026-05-22
recommendedTool: tokens.attach_token (existing cloud) OR push_complete.cloudTokens (new token)
recommendedToolNote: NEVER use push_complete.useTokens to reference an existing cloud token — silently duplicates. Rejected server-side since v2.7.6.
---

# Tokens cloud vs local — correct workflow to avoid duplicating

## TL;DR

- `useTokens` in `build.push_complete` **consumes the LOCAL registry** (`~/.webstudio-mcp/projects/<slug>/tokens.json`), not the cloud.
- If `tokenSlug` matches an existing cloud token **by normalized name**, Webstudio creates a **silent duplicate** (no error, no warning).
- To reuse an existing cloud token: `tokens.list_tokens_cloud` then `tokens.attach_token({tokenId})` or `({tokenName})`.
- To create a new token: `build.push_complete` with `cloudTokens:[{name, styles, attachToInstances}]`.
- Since **v2.7.6**: the server rejects `useTokens` if the slug matches an existing cloud token.

## The 2 worlds — clearing up the confusion

Webstudio MCP has two notions of "token":

| Concept | Lives where | Shape | Workflow |
|---|---|---|---|
| **LOCAL token** (registry) | `~/.webstudio-mcp/projects/<slug>/tokens.json` | `{slug, styles}` | Sync via `tokens.sync_local` or `tokens.init_brand_kit` (Figma → Webstudio) |
| **CLOUD token** (Webstudio) | Webstudio Cloud project | `{tokenId, name, styles}` | Create via `tokens.create_tokens` or `push_complete.cloudTokens`; attach via `tokens.attach_token` |

**The trap**: `useTokens` talks to the LOCAL world. If you write `useTokens:[{tokenSlug:"titre-h1"}]` thinking it points to the cloud token "Titre H1", that is **wrong** — you trigger a cloud creation from the local registry.

## Real case — a production project (2026-05-22)

Incident: after a `build.push_complete` with `useTokens:[{instanceId:"h1", tokenSlug:"titre-h1"}]`, **two tokens with the same name** show up in the Webstudio project:

```
Titre H1 (id jljK03PO…)              ← the original (cloud), 1 existing usage
Titre H1 (id tok_brand_titre-h1)        ← new one duplicated by useTokens, 1 usage
```

Visually identical in the panel (case-insensitive human matching), technically distinct (two different `tokenId`s, two different `styleSourceId`s).

Worse: the slug `titre-h1` (lowercase-dash, registry format) becomes `Titre H1` (capitalized) in the Webstudio Cloud rendering → indistinguishable to the eye. You end up with useless `styleSources`, a polluted panel, and future edits that touch only half of the system.

## CORRECT workflow (reusing an existing cloud token)

### Step 1 — Verify the cloud token exists

```
tokens.list_tokens_cloud({projectSlug: "<project>", filter: "titre"})
→ confirms "Titre H1" exists with short tokenId "jljK03PO"
```

### Step 2 — Push the fragment WITHOUT attaching this token

```
build.push_complete({
  projectSlug: "<project>",
  pushTo: {...},
  instances: [...],
  cloudTokens: [
    // ONLY the GENUINELY NEW tokens from the fragment
    { name: "Card Promo Border", styles: {...}, attachToInstances: ["..."] }
  ]
  // ⚠️ NO useTokens for Titre H1
})
```

### Step 3 — Attach the existing cloud token AFTER the push

```
tokens.attach_token({
  projectSlug: "<project>",
  tokenName: "Titre H1",         // ou tokenId: "jljK03PO" si tu l'as
  instanceIds: ["<real-h1-id-after-push>"]
})
```

## CORRECT workflow (creating a new token + attaching in 1 call)

If you want to create a new token AND attach it to instances in a single push:

```
build.push_complete({
  projectSlug: "<project>",
  pushTo: {...},
  instances: [...],
  cloudTokens: [
    {
      name: "Card Bento Span 1",     // ← UNIQUE name in cloud (verify beforehand)
      styles: {...},
      attachToInstances: ["card-1", "card-2", "card-3"]
    }
  ]
})
```

⚠️ Before a `push_complete` with `cloudTokens`, **always** call `tokens.list_tokens_cloud` to verify the `name` does not already exist — otherwise the same duplication problem (two cloud tokens with the same name).

## ❌ Anti-pattern — useTokens on an existing cloud token

```
// ❌ NEVER DO THIS
build.push_complete({
  ...,
  useTokens: [
    { instanceId: "h1", tokenSlug: "titre-h1" }  // "Titre H1" already exists in cloud
  ]
})
```

**Since v2.7.6**: the server **rejects** this call with:

```
ERROR — VALIDATION_FAILED
useTokens slug "titre-h1" matches an existing cloud token "Titre H1" (id: jljK03PO).
Pushing via useTokens would silently duplicate it. Use one of:
  • tokens.attach_token({ tokenName: "Titre H1", instanceIds: [...] })
    to attach the existing cloud token to instances.
  • build.push_complete with cloudTokens:[{ name: "<Unique Name>", ... }]
    if you really want to create a NEW token (then verify the name isn't already used).
See pattern: tokens-cloud-vs-local.
```

Telemetry emitted: `coerce:useTokens-duplicate-blocked` — appears in the weekly report. If the counter rises, it means this description or this pattern doc is not being seen by agents.

## Post-error fix (if you already have duplicates)

### Diagnosis

```
audit.duplicate_tokens({projectSlug: "<project>"})
→ lists the pairs of cloud tokens with identical normalized name
```

Example output:

```
⚠️ Duplicate token candidates in <project>:
  - "Titre H1" (id jljK03PO, 47 instances attached)
  - "Titre H1" (id tok_project_titre-h1, 1 instance attached)
  → Likely useTokens-duplication. Merge with tokens.migrate_token_selections.

  - "Body M" (id 4kP9aZ12, 23 instances)
  - "Body M" (id tok_brand_body-m, 2 instances)
  → Same.
```

### Migration

For each pair (original token `keepId`, duplicate `dropId`):

```
tokens.migrate_token_selections({
  projectSlug: "<project>",
  fromTokenId: "tok_brand_titre-h1",   // the duplicate
  toTokenId: "jljK03PO",              // the original
  deleteOldStyles: true
})
```

Then delete the empty duplicate:

```
tokens.delete_token({ projectSlug, tokenId: "tok_brand_titre-h1" })
```

## When to use what — decision table

| You want to... | Tool to use |
|---|---|
| Reuse a token that ALREADY exists in the cloud on new instances | `tokens.attach_token` |
| Create a NEW token + attach it to instances in a single call | `push_complete` with `cloudTokens` |
| Sync tokens from the local registry to the cloud (Figma → Webstudio onboarding workflow) | `tokens.sync_local` or `tokens.init_brand_kit` |
| Update the styles of an existing cloud token | `tokens.update_token_styles` |
| Find the short `tokenId` of a cloud token by its name | `tokens.list_tokens_cloud({filter})` |
| Detach a token from an instance without deleting it | `tokens.detach_token` |
| **NEVER**: `useTokens` in `push_complete` to point at an existing cloud token | — |

## Why `useTokens` exists anyway

`useTokens` is not a bad design — it has a legitimate use:

- **Initial onboarding**: you have a local registry (synced from Figma) with 30 tokens, and you want to push them all at once with their first attachment on your template fragment. `useTokens` consumes the local registry and creates them in the cloud on the fly.
- **Fragment-local tokens**: created via `cloudTokens` in the same call and referenced via `useTokens` on other instances of the fragment.

The only trap is **using `useTokens` to point at an already-existing cloud token**. The v2.7.6+ server catches this case with an explicit message.

## Rules recap

1. **Before** any `push_complete` that might attach a token: `tokens.list_tokens_cloud` to verify what exists.
2. **If the token exists in the cloud**: `tokens.attach_token` after the push.
3. **If the token is new**: `cloudTokens` in the `push_complete`, with a `name` you have verified is unique.
4. **`useTokens` reserved** for: local registry tokens or fragment-local tokens created in the same call.
5. Since v2.7.6 the server **rejects** `useTokens` that match an existing cloud token.
6. For already-contaminated projects: `audit.duplicate_tokens` then `tokens.migrate_token_selections`.
