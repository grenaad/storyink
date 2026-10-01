import type { Pt } from "../scene.ts"
import type { RowStatus } from "../spec.ts"

export interface TimelineStep {
  id: string
  label: string
  t0: number
  t1: number
  stop?: string
  caption?: string
  /** On the last step of a beat: its reading hold (s), inserted before the next beat in continuous play. */
  hold?: number
  /** Camera / spotlight target override (`focus`). */
  focus?: string
  /** Title parts for beat tiles: pulse paths, revealed node names, counter changes. */
  parts?: { paths: string[]; reveals: string[]; counters: string[]; acts?: string[] }
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
  /** Travels the route backwards (return pulse). */
  reverse?: boolean
  /** Arrival on a node (and optionally a row / code line anchor). */
  arrive?: { node: string; anchor?: string }
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
  mode: "flight" | "fade" | "wire"
  /** For flight draws: the pulse and this edge's span on its route. */
  pulse?: string
  s0?: number
  s1?: number
}

/** Minimal compile input: node / group parents and the story with auto steps expanded. */
export interface StorySource {
  type: string
  nodes: { id: string; parent?: string }[]
  groups: { id: string; parent?: string }[]
  story: Record<string, unknown> & { steps: unknown[] }
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
  /** The reading-hold pace this timeline was compiled with. */
  pace?: number
  /** What the viewer needs to recompile for another pace (`recompilePace`). */
  source?: StorySource
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
  // 0.4 content timeline (all optional; absent = nothing of that kind).
  typing?: TimelineTyping[]
  /**
   * set / clear events per target (code node id, "node#row", or "node@label" for a label);
   * v = the version shown from t on, -1 = cleared.
   */
  versions?: Record<string, { t: number; v: number }[]>
  /** Active-line bar ranges per code node (1-based inclusive lines). */
  bars?: Record<string, { t: number; a: number; b: number; on: boolean }[]>
  status?: Record<string, { t: number; to: RowStatus }[]>
  /** dim / undim level events (the dim channel; rest = muted ? 0.42 : 1). */
  levels?: Record<string, { t: number; to: number }[]>
  /** hide / show events (the visibility channel, independent of the dim channel). */
  vis?: Record<string, { t: number; to: 0 | 1 }[]>
  /** glow / unglow windows. */
  lit?: Record<string, { t0: number; t1?: number }[]>
  /**
   * wire / unwire events per edge, in time order. `on` draws the wire on over [t0, t1]; off
   * retracts it (source end first). Before the first event the wire is hidden when that event
   * draws it, else drawn. Repeated cycles are allowed.
   */
  wires?: Record<string, { t0: number; t1: number; on: boolean }[]>
  /** Spotlight targets per step (story.spotlight): centre and radius. */
  spot?: { t: number; x: number; y: number; r: number }[]
  rewind?: "tape" | "glitch"
}

export interface TimelineTyping {
  /** Code node id or "node#row". */
  target: string
  /** Version being typed. */
  v: number
  by: "char" | "word"
  t0: number
  t1: number
  /** Rows: the version's text lines; code: the program lines. char mode: per-line runs. */
  lines?: { t0: number; t1: number; n: number; indent: number }[]
  /** word mode (caption formula). */
  words?: { n: number; lead: number; fade: number; stagger: number }
}

export interface ContentLayer {
  v: number
  o: number
  chars?: number[]
  words?: number[]
  /** Word-typed rows: the tag / icon opacity (they appear as the typing starts). */
  tag?: number
}

export interface StatusFrame {
  /** Glyph shown ("none" = no glyph, only the outgoing one fades). */
  s: RowStatus
  o: number
  /** Spinner rotation (deg); absent = the static arc. */
  spin?: number
  /** Check / cross draw-on 0..1; absent = drawn. */
  draw?: number
  /** Shimmer over the running label: amplitude and gradient offset (px). */
  shimmer?: { a: number; x: number }
  /** The outgoing glyph during a transition. */
  prev?: { s: RowStatus; o: number; spin?: number }
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
  // 0.4 content keys (deltas from the spec's static default; optional until the compiler emits them).
  /** Level per node / group / edge / row; omitted = rest (muted ? 0.42 : 1). */
  lvl?: Record<string, number>
  /** Omitted = version 0, whole. */
  content?: Record<string, ContentLayer[]>
  caret?: { target: string; line: number; col: number }[]
  bars?: Record<string, { a: number; b: number; o: number }>
  status?: Record<string, StatusFrame>
  lit?: Record<string, number>
  /** hide / show channel per node / group / edge / row; omitted = shown. */
  vis?: Record<string, number>
  /** Wire retract progress 0..1 (1 = gone). */
  undraw?: Record<string, number>
  spot?: { x: number; y: number; r: number; a: number }
}
