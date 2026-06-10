// Shared Zod schemas for expression bindings (extracted v2.13.1 — were
// copy-pasted verbatim in push-complete.ts / bind-instance-prop.ts /
// bind-page-field.ts, audit 2026-06-10).
//
// Mirrors the Binding union in src/expressions.ts: `variable` (single
// dataSource ref + optional path), `template` (text/variable parts), `raw`
// (free expression — linted by lib/lint-expression.ts before push).

import { z } from "zod";

export const PathSegmentSchema = z.union([z.string(), z.number()]);

export const TemplatePartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), value: z.string() }),
  z.object({
    type: z.literal("variable"),
    dataSourceId: z.string(),
    path: z.array(PathSegmentSchema).optional(),
  }),
]);

export const BindingSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("variable"),
    dataSourceId: z.string(),
    path: z.array(PathSegmentSchema).optional(),
  }),
  z.object({ kind: z.literal("template"), parts: z.array(TemplatePartSchema) }),
  z.object({ kind: z.literal("raw"), expression: z.string() }),
]);
