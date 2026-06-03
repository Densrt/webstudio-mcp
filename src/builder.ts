// Backwards-compatible entry point — re-exports from ./builder/index.js
// so existing imports from "./builder.js" / "./dist/builder.js" keep working after the split.

export * from "./builder/index.js";
