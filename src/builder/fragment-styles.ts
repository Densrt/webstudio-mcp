// Internal helpers for FragmentBuilder style application — kept separate to
// keep the main builder lean. These operate on the builder's underlying arrays.

import type {
  InstanceId,
  StyleDecl,
  StyleSource,
  StyleSourceId,
  StyleSourceSelection,
  StyleValue,
} from "../types.js";
import { newId } from "./ids.js";
import { expandShorthand } from "./shorthands.js";

type State = {
  styleSources: StyleSource[];
  styleSelections: StyleSourceSelection[];
  styles: StyleDecl[];
};

/**
 * Ensure a local StyleSource exists for the given instance. Returns its id.
 * Reuses an existing local source if one already maps to this instance.
 */
export function ensureLocalSource(state: State, instanceId: InstanceId): StyleSourceId {
  const existing = state.styleSources.find(
    (s) => s.type === "local" && state.styleSelections.find(
      (sel) => sel.instanceId === instanceId && sel.values.includes(s.id),
    ),
  );
  if (existing) return existing.id;

  const sourceId = newId();
  state.styleSources.push({ type: "local", id: sourceId });

  const selection = state.styleSelections.find((s) => s.instanceId === instanceId);
  if (selection) {
    selection.values.unshift(sourceId);
  } else {
    state.styleSelections.push({ instanceId, values: [sourceId] });
  }
  return sourceId;
}

/**
 * Append a single style declaration to an instance's local style source.
 * Auto-expands shorthands (padding, margin, border-radius, gap, etc.) and
 * auto-flags CSS custom properties as listed.
 */
export function pushStyle(
  state: State,
  instanceId: InstanceId,
  resolveBreakpoint: (b: string) => string,
  property: string,
  value: StyleValue,
  breakpoint: string,
  state_?: string,
  listed?: boolean,
): void {
  const sourceId = ensureLocalSource(state, instanceId);
  const breakpointId = resolveBreakpoint(breakpoint);
  const expanded = expandShorthand(property, value);
  const autoListed = listed ?? property.startsWith("--");
  for (const [p, v] of expanded) {
    state.styles.push({
      styleSourceId: sourceId,
      breakpointId,
      property: p,
      value: v,
      ...(state_ && { state: state_ }),
      ...(autoListed && { listed: true }),
    });
  }
}

/**
 * Create a reusable design token (StyleSource of type=token) and seed its
 * style declarations. Returns the new tokenId.
 */
export function createToken(
  state: State,
  resolveBreakpoint: (b: string) => string,
  name: string,
  styles: Record<string, StyleValue>,
  breakpoint: string,
): StyleSourceId {
  const sourceId = newId();
  state.styleSources.push({ type: "token", id: sourceId, name });
  const breakpointId = resolveBreakpoint(breakpoint);
  for (const [property, value] of Object.entries(styles)) {
    state.styles.push({ styleSourceId: sourceId, breakpointId, property, value });
  }
  return sourceId;
}

/**
 * Attach an existing token to an instance via its style-source selection.
 */
export function attachToken(state: State, instanceId: InstanceId, tokenId: StyleSourceId): void {
  const selection = state.styleSelections.find((s) => s.instanceId === instanceId);
  if (selection) {
    selection.values.push(tokenId);
  } else {
    state.styleSelections.push({ instanceId, values: [tokenId] });
  }
}
