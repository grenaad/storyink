/**
 * storyink: diagram library (named exports) + OpenCode v2 plugin (default export).
 */
export * from "./core/index.ts"
export { loadSpec, parseSource, writeDiagram, snapshot, findBrowser, type LoadResult, type WriteResult } from "./node/index.ts"
export { PLUGIN_ID } from "./plugin.ts"
export { default } from "./plugin.ts"
