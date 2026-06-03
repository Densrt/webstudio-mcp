// Tool: webstudio_wrap_instance — insert a new wrapper instance around an existing one.
//
// Primary use case: ws:collection (and other non-rendering components like
// ws:fragment, Slot, *Trigger/*Portal/*Close from Radix) don't render a DOM
// node, so layout styles set on them are ignored. Wrapping them in a div lets
// you apply grid/flex/spacing to the wrapper while the inner instance keeps
// its semantics.
//
// Behaviour:
//   - Creates a new instance `wrapper` (configurable component/tag/label).
//   - Replaces the source instance in its parent's children with the wrapper.
//   - Puts the source instance as the sole child of the wrapper.
//   - transferLocalSource=true (default): moves the source's local styleSource
//     to the wrapper, so the layout styles end up where they can actually render.
//     Tokens on the source instance are NOT touched.

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type { WebstudioBuild, BuildPatchOperation, BuildPatchChange, BuildPatchTransaction } from "../webstudio-client.js";
import { COMPONENT_TO_TAG, RADIX_COMPONENTS, RADIX_NS } from "../types.js";
import { customAlphabet } from "nanoid";

const txId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);
const newId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);

export const wrapInstanceInputSchema = z.object({
  projectSlug: z.string(),
  /** Instance to wrap. */
  instanceId: z.string(),
  /** Wrapper component. Default "ws:element". Aliases (Link, Button, Box, Heading, etc.) are
   *  auto-resolved to ws:element with the matching default tag (e.g. Link → tag="a", Button → "button").
   *  Radix names (Dialog, NavigationMenu, etc.) are auto-prefixed with the Radix namespace. */
  component: z.string().default("ws:element"),
  /** Wrapper HTML tag. If omitted: defaults to the component's natural tag (a for Link, button for
   *  Button, div for ws:element, etc.), otherwise overrides whatever the component would have used. */
  tag: z.string().optional(),
  /** Wrapper label shown in the navigator. Default "Wrapper". */
  label: z.string().default("Wrapper"),
  /** Move the source's local styleSource to the wrapper. Default true. */
  transferLocalSource: z.boolean().default(true),
  dryRun: z.boolean().default(true),
}).strict();

/**
 * Resolve a user-facing component alias to the actual stored component + tag.
 * Mirrors FragmentBuilder.addInstance's behavior so wrap_instance and push_fragment produce
 * identical instance shapes for the same input.
 *
 * Examples:
 *   resolve("Link", undefined)          → { component: "ws:element", tag: "a" }
 *   resolve("Button", "div")            → { component: "ws:element", tag: "div" }  // explicit override
 *   resolve("Dialog", undefined)        → { component: "@webstudio-is/sdk-components-react-radix:Dialog", tag: undefined }
 *   resolve("ws:element", undefined)    → { component: "ws:element", tag: "div" }  // generic fallback
 */
function resolveComponentAndTag(rawComponent: string, explicitTag: string | undefined): { component: string; tag: string | undefined } {
  const isRadix = RADIX_COMPONENTS.has(rawComponent);
  if (isRadix) {
    // Radix components don't take a tag (they render their own markup).
    return { component: `${RADIX_NS}:${rawComponent}`, tag: undefined };
  }
  const mapping = COMPONENT_TO_TAG[rawComponent];
  if (mapping) {
    return { component: mapping.component, tag: explicitTag ?? mapping.defaultTag };
  }
  // Unknown component name: pass through, fall back to "div" tag if none provided.
  return { component: rawComponent, tag: explicitTag ?? "div" };
}

export type WrapResult = {
  changes: BuildPatchChange[];
  wrapperId: string;
  parentId: string;
  transferredLocalSourceId: string | null;
};

export function buildChanges(build: WebstudioBuild, args: z.infer<typeof wrapInstanceInputSchema>, stableWrapperId?: string): WrapResult {
  const target = build.instances.find((i) => i.id === args.instanceId);
  if (!target) throw new Error(`Instance not found: ${args.instanceId}`);

  // Find parent: scan all instances for one whose children include args.instanceId
  let parent: WebstudioBuild["instances"][number] | undefined;
  let childIndex = -1;
  for (const inst of build.instances) {
    const idx = (inst.children ?? []).findIndex((c) => c.type === "id" && c.value === args.instanceId);
    if (idx !== -1) {
      parent = inst;
      childIndex = idx;
      break;
    }
  }
  if (!parent) throw new Error(`Parent of ${args.instanceId} not found (cannot wrap a root instance).`);

  // wrapperId is generated once by the handler and reused across buildChanges() invocations
  // (so the dry-run reported ID matches what gets actually pushed).
  const wrapperId = stableWrapperId ?? newId();
  // Resolve aliases (Link → ws:element + a, Dialog → @webstudio-is/...:Dialog + no tag, etc.).
  const { component, tag } = resolveComponentAndTag(args.component, args.tag);
  const wrapper = {
    type: "instance" as const,
    id: wrapperId,
    component,
    ...(tag !== undefined && { tag }),
    label: args.label,
    children: [{ type: "id" as const, value: args.instanceId }],
  };

  // Replace the source in the parent's children with the wrapper
  const newParentChildren = [...parent.children];
  newParentChildren[childIndex] = { type: "id" as const, value: wrapperId };

  const instancePatches: BuildPatchOperation[] = [
    { op: "add", path: [wrapperId], value: wrapper },
    { op: "replace", path: [parent.id, "children"], value: newParentChildren },
  ];

  const changes: BuildPatchChange[] = [{ namespace: "instances", patches: instancePatches }];

  // Optional local styleSource transfer
  let transferredLocalSourceId: string | null = null;
  if (args.transferLocalSource) {
    const sel = build.styleSourceSelections.find((s) => s.instanceId === args.instanceId);
    if (sel) {
      const localId = sel.values.find((v) => build.styleSources.find((s) => s.id === v)?.type === "local") ?? null;
      if (localId) {
        transferredLocalSourceId = localId;
        const remainingValues = sel.values.filter((v) => v !== localId);
        const selectionPatches: BuildPatchOperation[] = [];

        // Source selection: keep its tokens (or remove entirely if it only had the local)
        if (remainingValues.length === 0) {
          selectionPatches.push({ op: "remove", path: [args.instanceId] });
        } else {
          selectionPatches.push({
            op: "replace",
            path: [args.instanceId],
            value: { instanceId: args.instanceId, values: remainingValues },
          });
        }
        // Wrapper selection: gets the moved local source
        selectionPatches.push({
          op: "add",
          path: [wrapperId],
          value: { instanceId: wrapperId, values: [localId] },
        });

        changes.push({ namespace: "styleSourceSelections", patches: selectionPatches });
      }
    }
  }

  return { changes, wrapperId, parentId: parent.id, transferredLocalSourceId };
}

export const wrapInstanceTool: ToolModule = {
  definition: {
    name: "webstudio_wrap_instance",
    description: `Use when: insert a NEW wrapper element AROUND an existing instance. Two canonical uses: (1) make a non-rendering component layoutable, (2) make an Image clickable by wrapping it in a Link.
Do NOT use when: you want to REMOVE a wrapper and lift its children — use webstudio_flatten_instance (the opposite operation). To add a new sibling/child without wrapping, use webstudio_append_child or webstudio_push_fragment.
Returns: dry-run summary with the generated wrapperId + parentId + transferredLocalSourceId + patch counts, OR push result with finalVersion.

CRITICAL — ws:collection is DOM-TRANSPARENT. Layout styles (display:flex, grid-template-columns, gap, padding, etc.) set DIRECTLY on a ws:collection are silently ignored because Webstudio renders no DOM node for it. Same goes for ws:fragment, Slot, and Radix *Trigger/*Portal/*Close. ALWAYS call wrap_instance BEFORE webstudio_styles when the styling target is one of these — wrap them in a ws:element div first, then style the wrapper. Failing to do this is a recurring source of "my flex doesn't work" bugs.

transferLocalSource=true (default) moves the target's local styleSource onto the wrapper so layout styles end up where they can actually render. Tokens stay on the target. component supports aliases auto-resolved by FragmentBuilder: "Link" → ws:element + tag="a", "Button" → "button", "Heading" → "h1", "Box" → "div", "Section" → "section". Radix names (Dialog, NavigationMenu, ...) get the Radix namespace prefix automatically and no tag.
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default.

Example (collection wrapping): { projectSlug: "my-site", instanceId: "products_collection", component: "ws:element", tag: "div", label: "Products grid" }
Example (image → link): { projectSlug: "acme", instanceId: "hero_img", component: "Link", label: "Hero link" }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        instanceId: { type: "string" },
        component: { type: "string", description: 'Webstudio component name. Aliases like "Link"/"Button"/"Heading" auto-resolve to ws:element + correct tag. Default ws:element.' },
        tag: { type: "string", description: "HTML tag override. Defaults to the component's natural tag (a for Link, button for Button, div for ws:element, etc.)." },
        label: { type: "string" },
        transferLocalSource: { type: "boolean" },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug", "instanceId"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  handler: async (args) => {
    const parsed = wrapInstanceInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const data = parsed.data;

    let auth;
    try { auth = data.dryRun ? requireAuth(data.projectSlug) : requirePushAuth(data.projectSlug); }
    catch (err) { return authErrorResult(err); }

    let build;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    // Generate wrapperId once so dry-run + real push + retry all use the same value (eliminates
    // the "summary shows X but actual instance has Y" bug observed earlier).
    const stableWrapperId = newId();

    let r: WrapResult;
    try { r = buildChanges(build, data, stableWrapperId); }
    catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith("Instance not found") || msg.startsWith("Parent of")) {
        return errorResult("INSTANCE_NOT_FOUND", msg);
      }
      return errorResult("INTERNAL_ERROR", msg);
    }

    const { component: resolvedComponent, tag: resolvedTag } = resolveComponentAndTag(data.component, data.tag);
    const summary = `Wrapper created
  Wrapper id        : ${r.wrapperId}
  Wrapper component : ${resolvedComponent}${resolvedTag ? ` (tag: <${resolvedTag}>)` : " (no tag — Radix component)"}
  Wrapper label     : "${data.label}"
  Parent (unchanged): ${r.parentId}
  Wrapped instance  : ${data.instanceId}
  Local source      : ${r.transferredLocalSourceId ? `transferred (${r.transferredLocalSourceId})` : "none to transfer"}`;

    if (data.dryRun) {
      return textResult(`DRY-RUN wrap_instance\n\n${summary}\n\nPatches:\n${r.changes.map((c) => `  - ${c.namespace}: ${c.patches.length}`).join("\n")}\n\nIf OK, re-run with dryRun=false.`);
    }

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) => {
        const re = buildChanges(cur, data, stableWrapperId);
        const tx: BuildPatchTransaction = { id: `mcp-wrap-instance-${txId()}`, payload: re.changes };
        return tx;
      });
      return textResult(`Wrap successful — version → ${finalVersion}\nstatus: ${result.status}\n\n${summary}`);
    } catch (err) {
      return runtimeErrorResult(err, "Wrap failed");
    }
  },
};
