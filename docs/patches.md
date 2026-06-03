# Patches and transactions

All writes flow through a single mutation: `build.patch`. Its input is a
**transaction** — a list of `BuildPatchChange` entries, one per container
namespace, each carrying an array of Immer patches.

```ts
type BuildPatchTransaction = {
  id: string;                       // free-form, used for response correlation
  payload: BuildPatchChange[];
};

type BuildPatchChange = {
  namespace: string;                // "instances" | "props" | "styles" | …
  patches: Patch[];
};

type Patch = {
  op: "add" | "replace" | "remove";
  path: Array<string | number>;
  value?: unknown;
};
```

See `src/webstudio-client.ts:95-115` for the wire types.

## Map-style paths

Each container is an Immer Map server-side. Patches address entries by **map
key first**, never by array index.

| Namespace | `path[0]` |
|---|---|
| `instances` | `instance.id` |
| `props` | `prop.id` |
| `breakpoints` | `breakpoint.id` |
| `styleSources` | `styleSource.id` |
| `styleSourceSelections` | `selection.instanceId` |
| `styles` | composite key `${styleSourceId}:${breakpointId}:${property}:${state ?? ""}` |
| `dataSources` | `dataSource.id` |
| `resources` | `resource.id` |
| `assets` | `asset.id` |
| `pages.pages` | `page.id` (under top-level `pages` namespace) |
| `pages.folders` | `folder.id` |

So adding an instance:

```json
{
  "op": "add",
  "path": ["new-instance-id"],
  "value": {
    "type": "instance",
    "id": "new-instance-id",
    "component": "ws:element",
    "tag": "section",
    "children": []
  }
}
```

## Inserting into `children`

Children are an array inside the instance value. Patch into them with a path
of length 3. JSON Patch semantics apply — `op:add` at index `n` shifts
existing items rightward.

```json
{
  "op": "add",
  "path": ["parent-id", "children", 0],
  "value": { "type": "id", "value": "new-instance-id" }
}
```

To insert several siblings (e.g. a Dialog plus an HtmlEmbed carrying its
animation CSS), emit consecutive patches at `index, index+1, …`. The MCP does
this in `src/fragment-to-patches.ts:57-63`.

## Style key (composite, order-sensitive)

```
${styleSourceId}:${breakpointId}:${property}:${state ?? ""}
```

Property comes **before** state. The reverse order silently fails on
`op:remove` (the key under which the existing record is stored does not
match the key the patch produced) while `op:add` continues to look like it
works because the server re-keys from the value. Mirror in
`src/fragment-to-patches.ts:168`.

## Building a transaction

The full request body shape (validated 2026-05-08):

```http
POST /trpc/build.patch?batch=1
Content-Type: application/json

{"0":{"source":"browser","appVersion":"<hash>","buildId":"<uuid>",
 "projectId":"<uuid>","version":14,
 "entries":[{"transaction":{"id":"mcp-…","payload":[
   {"namespace":"instances","patches":[…]},
   {"namespace":"props","patches":[…]},
   {"namespace":"styles","patches":[…]}
 ]}}]}}
```

Empty `payload` arrays return `errors: "Transaction entries required"`. Filter
out namespaces with zero patches before sending.

## Response shapes

```ts
type PatchResult =
  | { status: "ok"; version: number; entries: EntryResult[] }
  | { status: "partial"; version: number; entries: EntryResult[] }
  | { status: "version_mismatched"; errors: string }
  | { status: "authorization_error" | "error"; errors: string };
```

- `ok` — patch applied, `version` is the new build version. Cache it.
- `version_mismatched` — the build moved between fetch and apply. Re-fetch and
  retry (`pushWithRetry` in `src/webstudio-client.ts:198-242` does up to 3
  attempts and refreshes `appVersion` once on demand).
- `authorization_error` — surface to the user; auth needs refresh.
- `error` — Zod errors are usually returned in `errors` as a JSON string with
  the path of the offending field. Useful for blind discovery.

## Multi-root push

A fragment's `payload.children` may contain multiple `{type:"id", value:…}`
entries — for example a `Dialog` together with its sibling `HtmlEmbed` that
ships keyframes. The conversion in `src/fragment-to-patches.ts:30-63` iterates
all roots and emits one `children` insertion per root at consecutive indices.
The earlier implementation only handled `children[0]` and orphaned the rest.

## Breakpoint remap by label

A fragment carries its own breakpoint ids. Before patching, the client matches
by `label` against the target build's breakpoints and rewrites every
`style.breakpointId`. Unmatched breakpoints are pushed as new `breakpoints`
entries. See `src/fragment-to-patches.ts:147-159`.

This is what makes a fragment portable across projects without keeping a
breakpoint registry per project.

## Skipping pre-existing style sources

When a fragment uses tokens with stable ids (`tok_<projectSlug>_<slug>`), the
fragment may carry a token definition that already exists in the target
build. Re-adding it would error. The implementation diffs `payload.styleSources`
against `build.styleSources` by id and pushes only the new ones
(`src/fragment-to-patches.ts:80-91`). Per-instance `styleSourceSelections`
still get pushed so the new instances are wired up.

## HtmlEmbed: known multi-element gotcha

When an `HtmlEmbed` instance carries SVG markup with multiple top-level
graphic elements (e.g. `<path>` plus `<circle>`), the server-side sanitizer
silently drops the `code` prop at paste time. A single `<path>` (even with
many M/L/Z segments) goes through. Workarounds:

- Emit one `<path>` per icon, using path commands for circles/rectangles
- Or push the embed without `code`, then set the prop manually in the
  builder UI (a different code path that bypasses the paste sanitizer)
