/**
 * storyink/core: browser-safe library (no Node APIs).
 */
export * from "./spec.ts"
export type * from "./scene.ts"
export { validate, formatDiagnostic, type Diagnostic, type Severity, type ValidationResult } from "./validate.ts"
export { fromMermaid, detectMermaid, type MermaidResult, type MermaidFamily } from "./mermaid/index.ts"
export { layout, elbowPath, elbowPathV, roundedPolyline, wirePath, textWidth, wrap } from "./layout/index.ts"
export { renderSvg, renderHtml, toScene, fontCss, StoryinkError, type SvgOptions, type HtmlOptions } from "./render/index.tsx"
export { parseHash, type HashParams } from "./render/App.tsx"
export * as tokens from "../theme/tokens.ts"
export { VERSION } from "../generated/meta.ts"
