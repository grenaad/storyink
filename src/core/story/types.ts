import type { Pt } from "../scene.ts"

export interface TimelineStep {
  id: string
  label: string
  t0: number
  t1: number
  stop?: string
  caption?: string
  /** Title parts for beat tiles: pulse paths, revealed node names, counter changes. */
  parts?: { paths: string[]; reveals: string[]; counters: string[] }
}

export interface TimelinePulse {
  id: string
  edges: string[]
  /** Route polyline (concatenated edge points) and per-edge [start, end] arc lengths. */
  points: Pt[]
  spans: { edge: string; s0: number; s1: number }[]
  length: number
  /** Gather start, flight start, arrival. */
  t0: number
  tf0: number
  tf1: number
  target?: string
}

export interface TimelineGlow {
  node: string
  t: number
  /** Flood duration (s). */
  dur: number
  cx: number
  cy: number
}

export interface TimelineDraw {
  t0: number
  t1: number
  mode: "flight" | "fade"
  /** For flight draws: the pulse and this edge's span on its route. */
  pulse?: string
  s0?: number
  s1?: number
}

/**
 * A compiled story: absolute times for everything. Pure data (JSON-safe), so
 * it ships inside the HTML and the browser evaluates the same function.
 */
export interface Timeline {
  duration: number
  lastEvent: number
  autoplay: boolean
  /** Author's playback motion ("full" default; "system" follows prefers-reduced-motion). */
  motion: "full" | "reduced" | "system"
  /** Author's viewer camera ("follow" default). */
  camera?: "follow" | "fit"
  loop: boolean
  steps: TimelineStep[]
  /** Element id → time it is revealed. Absent = visible from t = 0. */
  appear: Record<string, number>
  /** Hidden-at-start edges / messages → how they draw on. */
  draw: Record<string, TimelineDraw>
  pulses: TimelinePulse[]
  glows: TimelineGlow[]
  /** A caption belongs to its step: shown from t0, gone by t1 (step end + settle, or the next caption). */
  captions: { i?: number; text: string; t0: number; t1: number; step: number; handoff: boolean }[]
  counters: Record<string, { node: string; start: number; events: { t: number; to: number }[]; prefix?: string; suffix?: string; decimals: number }>
}

export interface PulseFrame {
  id: string
  x: number
  y: number
  r: number
  o: number
  halo?: { r: number; o: number }
  ring?: { x: number; y: number; r: number; w: number; o: number }
  /** Trail segments; `k` = segment index (0 nearest the dot), `s0..s1` = arc-length span on the route. */
  trail: { d: string; o: number; k?: number; s0?: number; s1?: number }[]
}

export interface GlowFrame {
  id: string
  node: string
  cx: number
  cy: number
  r: number
  a: number
}

/** Visual state of every animated element at one instant. Omitted keys are at rest (fully shown). */
export interface Frame {
  t: number
  /** Element opacity / rise (px) for nodes, groups, frames, notes, activations, participants. */
  el: Record<string, { o: number; dy: number }>
  /** Sequence activations that are still growing: visible height (px). */
  grow: Record<string, number>
  /** Wire draw-on progress 0..1 for edges / messages that are not fully drawn. */
  draw: Record<string, number>
  pulses: PulseFrame[]
  glows: GlowFrame[]
  /** Arrival flash 0..1 for node text. */
  flash: Record<string, number>
  counters: Record<string, string>
  /** `current` = the caption of the step in progress; a superseded line is dimmed (0.52) and not current. */
  captions: { i?: number; text: string; o: number; words: number[]; current: boolean }[]
  /** Every event has settled (the frame equals the static diagram). */
  settled: boolean
}
