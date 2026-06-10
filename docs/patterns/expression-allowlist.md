---
name: Expression allowlist — what Webstudio accepts in a binding
description: Webstudio's lintExpression allowlist (12 String / 5 Array methods, no callbacks/Number methods) and the MCP's warn-vs-block policy for raw bindings. Native methods like toLocaleString RUN at runtime but the editor flags them. Production templates incident 2026-06 (map/replaceAll raw bindings).
category: workflow
complexity: medium
lastUpdated: 2026-06-06
recommendedTool: webstudio_bind_instance_prop
recommendedToolNote: Raw bindings are linted pre-push (since v2.11.0). Unparseable → refused (EXPRESSION_INVALID); allowlist violation → pushed + warned. Also applies to webstudio_bind_page_field and build.push_complete bindings.
---

# Expression allowlist — what Webstudio accepts in a binding

> When you bind a value to a `{kind:"raw", expression:"…"}` binding (instance prop, page field, or a
> `build.push_complete` binding), Webstudio's editor lints the JS against a strict allowlist. The MCP
> mirrors that allowlist and tells you BEFORE pushing.

## The key insight (do not over-react)

Webstudio's `lintExpression` runs **only in the builder/editor** (CodeMirror diagnostics). It is **NOT**
on the publish path. Publication is `generateExpression → transpileExpression`, which copies the method
name verbatim and only adds optional-chaining:

```
prix.toLocaleString("fr-FR")   →   prix?.toLocaleString?.("fr-FR")
```

then the runtime executes it via `new Function`. So **native JS methods run fine on the published page**
— `toLocaleString`, `toFixed`, `replaceAll`, even `map`/`filter` execute. They merely show a red
`"<name>" function is not supported` diagnostic when the expression is reopened in the editor.

**Consequence:** the MCP does NOT block these. It **warns** (so you can pick an allowlisted form if you
want a clean editor) and **pushes anyway**. The only hard refusal is an expression that is not valid /
not a single JavaScript expression — that one breaks the published build (`transpileExpression` parses
with the same engine and throws).

## The allowlist (verified against @webstudio-is/sdk 0.268.0)

**String methods (12):** `toLowerCase` · `toUpperCase` · `toLocaleLowerCase` · `toLocaleUpperCase` ·
`replace` · `split` · `slice` · `at` · `startsWith` · `endsWith` · `includes` · `toString`

**Array methods (5):** `join` · `at` · `slice` · `includes` · `toString`

**Rejected by the editor lint** (all valid JS — run at runtime, but flagged):

| Construct | Editor diagnostic |
|---|---|
| Any method NOT in the lists above (`toLocaleString`, `toFixed`, `replaceAll`, `map`, `filter`, `reduce`, `find`…) | `"<name>" function is not supported` |
| Arrow functions / callbacks (`x => …`) | `Functions are not supported` |
| `this` | `"this" keyword is not supported` |
| `++` / `--` | `Increment and decrement are not supported` |
| `new …` / classes | `Classes are not supported` |
| `await` | `"await" keyword is not supported` |
| comma sequence `a, b` | `Only single expression is supported` |

## MCP behaviour (since v2.11.0)

The linter (`src/lib/lint-expression.ts`) runs on every `raw` binding before push:

- **severity `error`** → unparseable JS, multiple statements (`a; b`), or any syntax the runtime
  `return (…)` wrapper can't compile → **refused** with `EXPRESSION_INVALID`. Fix the syntax.
- **severity `warning`** → valid JS outside the editor allowlist → **pushed**, with a `⚠️` hint in the
  response and a `detect:expr-*` telemetry event. The page works; the builder shows a red diagnostic.

`variable` and `template` bindings are never linted (they produce safe auto-generated expressions).

## Parades (keep a clean editor without losing functionality)

| You wrote | Editor flags | Clean equivalent |
|---|---|---|
| `texte.replaceAll("<p>", "")` | `replaceAll` | **`texte.split("<p>").join("")`** (both allowlisted) |
| `coloris.map(c => c.nom).join(" / ")` | `map` + arrow | **pre-shape the data in the Resource** (return the joined string), or `coloris.join(" / ")` if already strings |
| `prix.toLocaleString("fr-FR")` | `toLocaleString` | keep it (runs fine) **or** pre-format the number in the Resource / a computed variable |
| `prix.toFixed(2)` | `toFixed` | keep it, or pre-format in the Resource |

Rule of thumb: when a value needs Number/locale formatting or list shaping, the cleanest place is the
**Resource** (transform the data at the source) so the binding stays a simple property access.

## Related

- `variables-and-bindings.md` — the three binding kinds (`variable` / `template` / `raw`) and dataSource refs.
- `resources-http-data.md` — shaping/formatting data at the source so bindings stay simple.
- Tools: `webstudio_bind_instance_prop`, `webstudio_bind_page_field`, `build.push_complete` (bindings[]).
