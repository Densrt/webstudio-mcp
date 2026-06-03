// Coverage for the Radix non-rendering wrapper guard.
//
// Asserts that the shared lib correctly:
//   - identifies wrappers whether component is in short or namespaced form
//   - allows aria-*, data-*, data-ws-show props on wrappers
//   - refuses class/className/style/id on wrappers (SPA-navigation bug class)
//   - lets non-wrapper components through unconstrained

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RADIX_NON_RENDERING_WRAPPERS,
  BLOCKED_PRESENTATION_PROPS,
  SAFE_WRAPPER_PROP_EXAMPLES,
  isNonRenderingWrapper,
  assertSafeRadixProp,
} from "../dist/lib/radix-wrappers.js";

void SAFE_WRAPPER_PROP_EXAMPLES; // re-export sanity check (informational regex)

const NAMESPACED = "@webstudio-is/sdk-components-react-radix:DialogTrigger";

test("RADIX_NON_RENDERING_WRAPPERS contains the expected core wrappers", () => {
  for (const name of [
    "DialogTrigger", "DialogClose", "DialogPortal",
    "PopoverTrigger", "PopoverClose", "PopoverPortal",
    "SheetTrigger", "SheetClose", "SheetPortal",
    "AccordionTrigger", "TooltipTrigger", "TooltipPortal",
    "DropdownMenuTrigger", "DropdownMenuPortal",
    "NavigationMenuLink",
    "Slot",
  ]) {
    assert.equal(RADIX_NON_RENDERING_WRAPPERS.has(name), true, `expected ${name}`);
  }
});

test("RADIX_NON_RENDERING_WRAPPERS does NOT include TabsTrigger or NavigationMenuTrigger (they render their own <button>)", () => {
  assert.equal(RADIX_NON_RENDERING_WRAPPERS.has("TabsTrigger"), false);
  assert.equal(RADIX_NON_RENDERING_WRAPPERS.has("NavigationMenuTrigger"), false);
});

test("BLOCKED_PRESENTATION_PROPS contains class/className/style/id", () => {
  for (const p of ["class", "className", "style", "id"]) {
    assert.equal(BLOCKED_PRESENTATION_PROPS.has(p), true);
  }
});

test("isNonRenderingWrapper accepts short form", () => {
  assert.equal(isNonRenderingWrapper("DialogTrigger"), true);
  assert.equal(isNonRenderingWrapper("Slot"), true);
});

test("isNonRenderingWrapper accepts namespaced form (real build format)", () => {
  assert.equal(isNonRenderingWrapper(NAMESPACED), true);
  assert.equal(isNonRenderingWrapper("@webstudio-is/sdk-components-react-radix:SheetTrigger"), true);
});

test("isNonRenderingWrapper rejects non-wrapper Radix components", () => {
  assert.equal(isNonRenderingWrapper("Dialog"), false);
  assert.equal(isNonRenderingWrapper("DialogContent"), false);
  assert.equal(isNonRenderingWrapper("DialogOverlay"), false);
  assert.equal(isNonRenderingWrapper("TabsTrigger"), false);
  assert.equal(isNonRenderingWrapper("@webstudio-is/sdk-components-react-radix:TabsTrigger"), false);
});

test("isNonRenderingWrapper rejects HTML / Webstudio native components", () => {
  assert.equal(isNonRenderingWrapper("ws:element"), false);
  assert.equal(isNonRenderingWrapper("Box"), false);
  assert.equal(isNonRenderingWrapper("Button"), false);
  assert.equal(isNonRenderingWrapper("Image"), false);
  assert.equal(isNonRenderingWrapper("HtmlEmbed"), false);
});

test("assertSafeRadixProp lets any prop through on non-wrapper components", () => {
  assert.deepEqual(assertSafeRadixProp("Box", "class"), { ok: true });
  assert.deepEqual(assertSafeRadixProp("Button", "className"), { ok: true });
  assert.deepEqual(assertSafeRadixProp("ws:element", "style"), { ok: true });
  assert.deepEqual(assertSafeRadixProp("@webstudio-is/sdk-components-react-radix:DialogContent", "class"), { ok: true });
});

test("assertSafeRadixProp refuses blocked presentation props on a wrapper (short form)", () => {
  for (const prop of ["class", "className", "style", "id"]) {
    const r = assertSafeRadixProp("DialogTrigger", prop);
    assert.equal(r.ok, false, `expected refusal for ${prop}`);
    assert.match(r.reason, /asChild|cloneElement|Webstudio/i);
    assert.match(r.hint, /rendering child|Button|Link/i);
  }
});

test("assertSafeRadixProp refuses blocked presentation props on a wrapper (namespaced form)", () => {
  const r = assertSafeRadixProp(NAMESPACED, "class");
  assert.equal(r.ok, false);
  assert.match(r.reason, /atomic hash/);
});

test("assertSafeRadixProp allows aria-* on a wrapper", () => {
  assert.deepEqual(assertSafeRadixProp("DialogTrigger", "aria-label"), { ok: true });
  assert.deepEqual(assertSafeRadixProp("DialogTrigger", "aria-describedby"), { ok: true });
  assert.deepEqual(assertSafeRadixProp(NAMESPACED, "aria-labelledby"), { ok: true });
});

test("assertSafeRadixProp allows data-ws-show on a wrapper (Webstudio canvas flag)", () => {
  assert.deepEqual(assertSafeRadixProp("DialogTrigger", "data-ws-show"), { ok: true });
});

test("assertSafeRadixProp allows arbitrary data-* on a wrapper", () => {
  assert.deepEqual(assertSafeRadixProp("DialogTrigger", "data-role"), { ok: true });
  assert.deepEqual(assertSafeRadixProp("DialogTrigger", "data-testid"), { ok: true });
});

test("assertSafeRadixProp lets through Radix-native props on a wrapper (blacklist-only policy)", () => {
  // Radix exposes legitimate props on its wrappers that we cannot exhaustively
  // enumerate (active on NavigationMenuLink, value/defaultValue on TabsTrigger
  // when it was in the set, open on Dialog, ...). The policy is to only refuse
  // the demonstrably-harmful class/className/style/id quad. Everything else
  // passes through.
  assert.deepEqual(assertSafeRadixProp("NavigationMenuLink", "active"), { ok: true });
  assert.deepEqual(assertSafeRadixProp("DialogTrigger", "tabIndex"), { ok: true });
  assert.deepEqual(assertSafeRadixProp("DropdownMenuTrigger", "asChild"), { ok: true });
});

test("assertSafeRadixProp regression: short form bug — pre-lib check missed namespaced components", () => {
  // Before the lib was extracted, the in-place check used `Set.has(inst.component)`
  // against the short-form set. Real build components carry the namespace prefix
  // (Webstudio always namespaces Radix), so the check silently never fired in prod.
  // This test pins the fix.
  const r = assertSafeRadixProp(NAMESPACED, "class");
  assert.equal(r.ok, false, "must refuse class on the namespaced form, not just the short form");
});
