import type { Scene } from "../scene.ts"
import { isSequence, type Spec } from "../spec.ts"
import { compileStory, polyLength } from "../story/compile.ts"
import { layoutGraph } from "./graph.ts"
import { flattenPath } from "./paths.ts"
import { layoutSequence } from "./sequence.ts"

/** Pure, deterministic layout of a validated spec into absolute geometry. */
export function layout(spec: Spec): Scene {
  const scene = isSequence(spec) ? layoutSequence(spec) : layoutGraph(spec)
  // Length of the drawn (rounded) wire, for draw-on dashes.
  for (const e of scene.edges) e.length = Math.round(polyLength(flattenPath(e.d)) * 100) / 100
  if (spec.story !== undefined) {
    const { timeline } = compileStory(scene, spec)
    if (timeline) scene.timeline = timeline
  }
  return scene
}

export { layoutGraph, layoutSequence }
export { elbowPath, elbowPathV, flattenPath, roundedPolyline, wirePath } from "./paths.ts"
export { textWidth, wrap } from "./measure.ts"
