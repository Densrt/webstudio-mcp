// FragmentBuilder — fluent API for building a WebstudioFragment.
// Real format observed via copy from the Webstudio builder (May 2026):
// - Top-level wrapper {"@webstudio/instance/v0.1": {...}}
// - styleSourceSelections (camelCase)
// - HTML components mapped to {component: "ws:element", tag: "..."}
// - Breakpoints with nanoid IDs (mapped from logical labels)

import type {
  Instance,
  InstanceChild,
  InstanceId,
  Prop,
  PropType,
  StyleDecl,
  StyleSource,
  StyleSourceId,
  StyleSourceSelection,
  StyleValue,
  Breakpoint,
  BreakpointLabel,
  WebstudioFragment,
  WebstudioFragmentPayload,
  DataSource,
} from "../types.js";
import { DEFAULT_BREAKPOINT_DEFS, COMPONENT_TO_TAG, RADIX_COMPONENTS, RADIX_NS } from "../types.js";
import type { ProjectConfig } from "../projects.js";
import { newId } from "./ids.js";
import { attachToken, createToken, pushStyle } from "./fragment-styles.js";
import { loadProjectOrThrow, useProjectToken } from "./fragment-project-tokens.js";
import { encodeExpressionRefs } from "../utils/expression-encoding.js";

export class FragmentBuilder {
  private instances: Instance[] = [];
  private props: Prop[] = [];
  private styleSources: StyleSource[] = [];
  private styleSelections: StyleSourceSelection[] = [];
  private styles: StyleDecl[] = [];
  private dataSources: DataSource[] = [];
  private rootChildren: InstanceChild[] = [];

  // Breakpoints with nanoid IDs generated at construction (mapped from labels).
  private breakpointMap: Record<BreakpointLabel, string>;
  private breakpoints: Breakpoint[];

  // Loaded project config (if any) — provides design tokens.
  private project: ProjectConfig | null = null;
  // Map tokenSlug → real tokenId used in the fragment (avoids duplicates).
  private projectTokenSourceIds: Map<string, StyleSourceId> = new Map();

  constructor() {
    this.breakpointMap = {} as Record<BreakpointLabel, string>;
    this.breakpoints = DEFAULT_BREAKPOINT_DEFS.map((def) => {
      const id = newId();
      this.breakpointMap[def.label] = id;
      return {
        id,
        label: def.displayLabel,
        ...(def.maxWidth !== undefined && { maxWidth: def.maxWidth }),
      };
    });
  }

  // Resolve a breakpoint label to its real ID; also accepts a raw ID.
  private resolveBreakpoint = (labelOrId: string): string => {
    if (labelOrId in this.breakpointMap) {
      return this.breakpointMap[labelOrId as BreakpointLabel];
    }
    return labelOrId;
  };

  private get styleState() {
    return { styleSources: this.styleSources, styleSelections: this.styleSelections, styles: this.styles };
  }

  // Create an instance and add it to the fragment. Auto-maps high-level
  // component names (Box, Heading, Paragraph, Button, Image, Link) to
  // {component: "ws:element", tag: "<html-tag>"}. Special components
  // (HtmlEmbed, etc.) are passed through as-is.
  addInstance(
    component: string,
    options: {
      id?: string;
      tag?: string;
      label?: string;
      children?: InstanceChild[];
      parentId?: InstanceId;
    } = {},
  ): InstanceId {
    const id = options.id ?? newId();
    const isRadix = RADIX_COMPONENTS.has(component);
    const mapping = isRadix ? null : COMPONENT_TO_TAG[component];
    const resolvedComponent = isRadix ? `${RADIX_NS}:${component}` : (mapping ? mapping.component : component);
    const resolvedTag = isRadix ? undefined : (options.tag ?? (mapping ? mapping.defaultTag : undefined));

    // Auto-encode `-` → `__DASH__` in dataSourceId refs of expression children (idempotent).
    const safeChildren = (options.children ?? []).map((c) =>
      c.type === "expression"
        ? ({ type: "expression", value: encodeExpressionRefs(c.value) } as InstanceChild)
        : c,
    );
    const instance: Instance = {
      type: "instance",
      id,
      component: resolvedComponent,
      ...(resolvedTag && { tag: resolvedTag }),
      ...(options.label && { label: options.label }),
      children: safeChildren,
    };
    this.instances.push(instance);

    if (options.parentId) {
      this.addChild(options.parentId, { type: "id", value: id });
    } else {
      this.rootChildren.push({ type: "id", value: id });
    }
    return id;
  }

  addChild(parentId: InstanceId, child: InstanceChild): this {
    const parent = this.instances.find((i) => i.id === parentId);
    // Auto-encode `-` → `__DASH__` in dataSourceId refs on expression children (idempotent).
    const safeChild: InstanceChild =
      child.type === "expression"
        ? { type: "expression", value: encodeExpressionRefs(child.value) }
        : child;
    if (parent) parent.children.push(safeChild);
    return this;
  }

  addText(parentId: InstanceId, text: string): this {
    return this.addChild(parentId, { type: "text", value: text });
  }

  addProp(instanceId: InstanceId, name: string, type: PropType, value: unknown): this {
    // Auto-encode dataSourceId refs in expression-typed props (idempotent).
    const safeValue =
      type === "expression" && typeof value === "string"
        ? encodeExpressionRefs(value)
        : value;
    this.props.push({ id: newId(), instanceId, name, type, value: safeValue });
    return this;
  }

  // Add a CSS style. Auto-expands shorthands not supported by Webstudio.
  addStyle(
    instanceId: InstanceId,
    property: string,
    value: StyleValue,
    breakpoint: string = "base",
    state?: string,
    listed?: boolean,
  ): this {
    pushStyle(this.styleState, instanceId, this.resolveBreakpoint, property, value, breakpoint, state, listed);
    return this;
  }

  addStyles(
    instanceId: InstanceId,
    styles: Record<string, StyleValue>,
    breakpoint: string = "base",
    state?: string,
  ): this {
    for (const [property, value] of Object.entries(styles)) {
      this.addStyle(instanceId, property, value, breakpoint, state);
    }
    return this;
  }

  addToken(name: string, styles: Record<string, StyleValue>, breakpoint = "base"): StyleSourceId {
    return createToken(this.styleState, this.resolveBreakpoint, name, styles, breakpoint);
  }

  applyToken(instanceId: InstanceId, tokenId: StyleSourceId): this {
    attachToken(this.styleState, instanceId, tokenId);
    return this;
  }

  // ─── Project tokens (tokens.json registry) ─────────────────────────────────

  /** Load a project config (`projects/{slug}/tokens.json`). */
  loadProject(projectSlug: string): this {
    this.project = loadProjectOrThrow(projectSlug);
    return this;
  }

  /** List the tokens of the loaded project (useful for debug/listing). */
  getProjectTokens(): Array<{ slug: string; name: string }> {
    if (!this.project) return [];
    return Object.entries(this.project.tokens).map(([slug, def]) => ({ slug, name: def.name }));
  }

  /**
   * Apply a token from the project registry to an instance, by slug. The
   * token is created in the fragment on first use (with its stable ID);
   * subsequent uses reuse the same styleSourceId.
   */
  useToken(instanceId: InstanceId, tokenSlug: string): this {
    if (!this.project) {
      throw new Error(`No project loaded. Call loadProject(slug) before useToken().`);
    }
    useProjectToken(
      this.styleState,
      this.project,
      this.projectTokenSourceIds,
      this.resolveBreakpoint,
      instanceId,
      tokenSlug,
    );
    return this;
  }

  addVariable(
    scopeInstanceId: InstanceId,
    name: string,
    valueType: "string" | "number" | "boolean" | "json",
    initialValue: unknown,
  ): string {
    const id = newId();
    this.dataSources.push({
      type: "variable",
      id,
      scopeInstanceId,
      name,
      value: { type: valueType, value: initialValue },
    });
    return id;
  }

  /**
   * Add a `parameter` dataSource — the runtime-injected variable that wraps
   * each iteration of a ws:collection (the `item` prop) and the request
   * params of a Resource. Distinct from `addVariable` (which holds a static
   * initial value); a parameter is filled by its parent component at render
   * time. See `docs/patterns/ws-collection-bindings.md` for the full recipe.
   *
   * Returns the dataSourceId — pass it to `addProp(collectionId, "item",
   * "parameter", id)` and reference it from descendants via
   * `$ws$dataSource$<id>.<field>` (escape `-` to `__DASH__` in the id).
   */
  addParameter(
    scopeInstanceId: InstanceId,
    name: string,
    id: string = newId(),
  ): string {
    this.dataSources.push({
      type: "parameter",
      id,
      scopeInstanceId,
      name,
    });
    return id;
  }

  /**
   * Push a pre-built DataSource entry as-is. Used by build-from-args when the
   * caller hands in a typed dataSource (variable or parameter) instead of
   * letting the builder synthesize it. Returns the entry's id so callers can
   * chain prop bindings.
   */
  addRawDataSource(ds: DataSource): string {
    this.dataSources.push(ds);
    return ds.id;
  }

  private buildPayload(): WebstudioFragmentPayload {
    const rootId =
      this.rootChildren.length > 0 && this.rootChildren[0].type === "id"
        ? this.rootChildren[0].value
        : undefined;
    const instanceSelector = rootId ? [rootId] : [];

    return {
      instanceSelector,
      children: this.rootChildren,
      instances: this.instances,
      styleSourceSelections: this.styleSelections,
      styleSources: this.styleSources,
      breakpoints: this.breakpoints,
      styles: this.styles,
      dataSources: this.dataSources,
      resources: [],
      props: this.props,
      assets: [],
    };
  }

  build(): WebstudioFragment {
    return { "@webstudio/instance/v0.1": this.buildPayload() };
  }

  toJSON(): string { return JSON.stringify(this.build()); }
  toPrettyJSON(): string { return JSON.stringify(this.build(), null, 2); }
}
