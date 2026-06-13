---
name: Staged push — confirm a dry-run by stageId without re-sending the payload
description: The two-stage push protocol (dryRun:true → confirm with dryRun:false + forceConfirmed:true) made the caller re-emit the entire fragment on the confirm call — 8-15 kB for a mid-size section, tens of kB for 100+ instance pushes. A successful dry-run now stores its validated args under a single-use stageId; confirming costs one ~60-char call (build.push_staged({stageId})). The full push pipeline (auth, allowPush, coercions, Radix pre-flight, version-mismatch retries) re-runs on confirm — staging skips re-transmission, never validation.
category: workflow
complexity: simple
lastUpdated: 2026-06-13
recommendedTool: build.push_staged
recommendedToolNote: confirm a previewed push by its stageId (from the dry-run report) instead of re-sending the payload. Single-use, 10-min TTL. Optionally pass projectSlug to refuse a mismatched target before pushing.
---

# Staged push — confirm a dry-run without re-sending the payload

## The problem

`push_fragment` and `push_complete` are dry-run-by-default. The safe two-step flow was:

1. `dryRun:true` → the server validates and previews the transaction without applying it.
2. Confirm → call again with `dryRun:false` + `forceConfirmed:true`, **re-sending the entire fragment** (instances + props + styles).

Step 2 re-transmits a payload that can run 8-15 kB for a mid-size section and tens of kB for 100+ instance pushes — pure token overhead, since the server already validated that exact payload at step 1.

## The mechanic

A **successful** dry-run of `push_fragment` / `push_complete` stores its validated args in a per-process map and returns a `stageId` (`st_…`) in its report. Confirming is then one short call:

```
build.push_staged({ stageId: "st_V1StGXR8_Z", label: "confirm-hero" })
```

The replay reconstructs the captured args with `dryRun:false` + `forceConfirmed:true` and re-invokes the underlying handler. **The full pipeline re-runs**: `requirePushAuth` (so `allowPush` is still enforced), image/video coercions, Radix pre-flight, and version-mismatch retries. Staging skips only the re-transmission of the payload — never the validation.

Properties:
- **Single-use** — a stage is consumed on take, whether the replayed push succeeds or fails. After any failure, a fresh dry-run is the safe default.
- **10-minute TTL** — stale previews must not stay pushable forever.
- **Per-process memory** — stdio servers are long-lived per session. If the server restarts between the dry-run and the confirm, the stage is gone and the confirm returns an actionable error (re-run the dry-run).

## Anti-wrong-project guard

An opaque `stageId` hides which project the push targets — a caller that previewed several projects could confirm the wrong one. Two safeguards:

- The confirm result is **prefixed with the target project**: `[staged push confirmed] target project: "<slug>"` — so the target is always visible (and auditable) at confirm time.
- Pass an optional `projectSlug` to make it a hard gate: if it does not match the staged project, the push is **refused before any cloud mutation** (the stage is still consumed — re-run the dry-run on the intended project).

```
build.push_staged({ stageId: "st_V1StGXR8_Z", projectSlug: "my-site", label: "confirm-hero" })
// → refused if the stage was for a different project, before pushing
```

## When NOT to use it

- The payload changed since the dry-run → re-run the dry-run instead. Stages replay **exactly** what was previewed; they do not pick up edits.
- More than 10 minutes elapsed, or the server restarted → the stage is gone; re-run the dry-run.
