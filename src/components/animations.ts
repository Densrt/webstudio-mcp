// CSS keyframes used by the Sheet (mobile drawer) helper.
// Names are namespaced ws-mcp-* so they don't collide with user CSS.

/**
 * Build the CSS embed block for the Sheet animations.
 * @param fromOff translateX value the panel slides from (e.g. "100%" or "-100%").
 */
export function sheetAnimationCss(fromOff: string): string {
  return `<style>
.burger-btn[data-state="open"] {
  --angle: 45deg; --move: 6px; --middle-op: 0;
  --angle-rev: -45deg; --move-rev: -6px;
}
@keyframes ws-mcp-slide-in { from { transform: translateX(${fromOff}); } to { transform: translateX(0); } }
@keyframes ws-mcp-slide-out { from { transform: translateX(0); } to { transform: translateX(${fromOff}); } }
@keyframes ws-mcp-fade-out { from { opacity: 1; } to { opacity: 0; } }
[data-role="menu-content"] { will-change: transform; }
[data-role="menu-content"][data-state="open"] { animation: ws-mcp-slide-in 400ms cubic-bezier(0.16, 1, 0.3, 1) forwards; }
[data-role="menu-content"][data-state="closed"] { animation: ws-mcp-slide-out 200ms ease-in forwards; }
[data-role="menu-overlay"][data-state="closed"] { animation: ws-mcp-fade-out 200ms ease-in forwards; }
[data-role="menu-content"] details > summary { list-style: none; cursor: pointer; }
[data-role="menu-content"] details > summary::-webkit-details-marker { display: none; }
[data-role="menu-content"] details > summary .ws-mcp-details-chevron { transition: rotate 200ms ease; display: inline-flex; align-items: center; }
[data-role="menu-content"] details[open] > summary .ws-mcp-details-chevron { rotate: 180deg; }
</style>`;
}
