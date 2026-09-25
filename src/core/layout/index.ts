import type { Scene } from "../scene.ts"
import { isSequence, type Spec } from "../spec.ts"
import { layoutGraph } from "./graph.ts"
import { layoutSequence } from "./sequence.ts"

/** Pure, deterministic layout of a validated spec into absolute geometry. */
export function layout(spec: Spec): Scene {
  return isSequence(spec) ? layoutSequence(spec) : layoutGraph(spec)
}

export { layoutGraph, layoutSequence }
export { elbowPath, elbowPathV, roundedPolyline, wirePath } from "./paths.ts"
export { textWidth, wrap } from "./measure.ts"
