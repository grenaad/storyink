/**
 * storyink/core: browser-safe library (no Node APIs).
 */
export * from "./spec.ts"
export type * from "./scene.ts"
export { validate, formatDiagnostic, type Diagnostic, type Severity, type ValidationResult } from "./validate.ts"
export { fromMermaid, detectMermaid, type MermaidResult, type MermaidFamily } from "./mermaid/index.ts"
export { layout, elbowPath, elbowPathV, flattenPath, roundedPolyline, wirePath, textWidth, wrap } from "./layout/index.ts"
export { renderSvg, renderHtml, toScene, fontCss, StoryinkError, type SvgOptions, type HtmlOptions } from "./render/index.tsx"
export { parseHash, type HashParams } from "./render/App.tsx"
export * as tokens from "../theme/tokens.ts"
export { VERSION } from "../generated/meta.ts"
export { storyState, restFrame, beatTimes, counterValue, steppedSchedule, steppedIndex, steppedStop, steppedTime, STEP_BEAT, STEP_MOVE, stepBoundary, stepMoveTarget, stepMoveSpeed, beatGroups, beatStops, beatChapters, beatTicks, type StateOptions, type SteppedStop } from "./story/state.ts"
export { CAMERA, cameraAt, cameraAtEnd, centreOn, clampCamera, deadZoneRect, fitCamera, fitIsReadable, followStep, inView, readableScale, stepAt, stepFocus, toScreen, type Camera, type Viewport } from "./story/camera.ts"
export { compileStory, resolveEdge, readTime, type CompileResult } from "./story/compile.ts"
export { autoStory } from "./story/auto.ts"
export type { Timeline, TimelineStep, TimelinePulse, TimelineGlow, TimelineDraw, PulseFrame, GlowFrame, Frame as StoryFrame } from "./story/types.ts"
export { renderAnimatedSvg, animatedSvg, animatedHeaderHeight, pinnedCss, simplify, simplifyError, type AnimatedSvgOptions, type AnimatedSvgInfo } from "./render/smil.tsx"
