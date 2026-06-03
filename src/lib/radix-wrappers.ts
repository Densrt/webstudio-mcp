// Shared guard for Radix non-rendering wrappers (asChild + Portal).
//
// These components don't render their own DOM node — they forward props onto
// their first child via React.cloneElement (asChild) or render in a Portal.
// Two consequences:
//   1. Styles applied directly to them are silently ignored.
//   2. Setting `class`/`className`/`style`/`id` on them overwrites the
//      Webstudio atomic hash classes on the rendered child via the
//      cloneElement merge — invisible bug in SSR, deterministic bug after
//      SPA-navigation re-renders (cf. docs/patterns/sheet-mobile-radix.md
//      § Major pitfall).
//
// Consumers:
//   - src/tools/update-styles/build-patches.ts → blocks styles
//   - src/tools/update-instance-prop.ts        → blocks presentation props
//   - src/tools/bind-instance-prop.ts          → blocks presentation props
//   - src/tools/push-fragment.ts               → validates fragment props
//   - src/tools/audit-radix-trigger-pollution.ts → scans existing projects
//
// Exceptions: TabsTrigger and NavigationMenuTrigger render their own
// <button> element — they are NOT in this set and can be styled directly.

/** Components that don't render their own DOM node (asChild forwarders + Portals). */
export const RADIX_NON_RENDERING_WRAPPERS = new Set([
  "DialogTrigger", "DialogClose", "DialogPortal",
  "PopoverTrigger", "PopoverClose", "PopoverPortal",
  "SheetTrigger", "SheetClose", "SheetPortal",
  "AccordionTrigger", "TooltipTrigger", "TooltipPortal",
  "DropdownMenuTrigger", "DropdownMenuPortal",
  "NavigationMenuLink",
  "Slot",
]);

/**
 * Props that overwrite the child's className / inline style / element id via
 * the cloneElement merge. Setting these on a wrapper is the SPA-navigation
 * bug class.
 */
export const BLOCKED_PRESENTATION_PROPS = new Set([
  "class", "className",
  "style",
  "id",
]);

/**
 * Examples of safe-by-construction props that the regex would catch.
 * Kept as documentation only — the live policy is BLACKLIST-ONLY:
 * anything not in BLOCKED_PRESENTATION_PROPS is let through. This avoids
 * false-positives on legitimate Radix-native props (`active` on
 * NavigationMenuLink, `value` on TabsTrigger, `open` on Dialog, ...) which
 * we cannot enumerate exhaustively.
 */
export const SAFE_WRAPPER_PROP_EXAMPLES = /^(data-ws-show|aria-|data-)/;

/** True if `component` is one of the Radix wrappers that don't render a DOM node.
 *  Accepts both the short form ("DialogTrigger") and the namespaced form
 *  ("@webstudio-is/sdk-components-react-radix:DialogTrigger"). The build always
 *  stores the namespaced form; helpers and tests sometimes use the short form. */
export function isNonRenderingWrapper(component: string): boolean {
  const short = component.includes(":") ? component.split(":").pop() ?? component : component;
  return RADIX_NON_RENDERING_WRAPPERS.has(short);
}

/**
 * Validate that `propName` is safe to set on a non-rendering wrapper.
 *
 * Policy: BLACKLIST-ONLY. We only refuse the four presentation props that
 * demonstrably break the cloneElement merge (class, className, style, id).
 * Everything else (Radix-native props like `active`, `value`, `defaultValue`,
 * `open` + aria-* + data-* + custom) is let through. Whitelist-only would
 * false-positive on legitimate Radix props we can't enumerate.
 *
 * Returns `{ ok: true }` for non-wrappers (no constraint), for wrappers with
 * a non-blocked prop, or for wrappers with a blocked prop when the caller
 * has explicit opt-out (handled by callers, not here).
 */
export function assertSafeRadixProp(
  component: string,
  propName: string,
): { ok: true } | { ok: false; reason: string; hint: string } {
  if (!isNonRenderingWrapper(component)) return { ok: true };

  if (BLOCKED_PRESENTATION_PROPS.has(propName)) {
    return {
      ok: false,
      reason: `"${propName}" on ${component} is blocked: this prop overwrites the child's className via React.cloneElement (asChild merge), silently dropping Webstudio's atomic hash classes. The bug is invisible on first SSR load but becomes deterministic after SPA navigation when sibling components (NavigationMenu, etc.) re-render the cascade.`,
      hint: `Move "${propName}" to the rendering child instead (the Button/Link directly under ${component}). For the rare case where the polluted wrapper MUST stay, pass ignoreWrapperWarning=true (not recommended).`,
    };
  }

  return { ok: true };
}
