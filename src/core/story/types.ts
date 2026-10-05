import type { Pt } from "../scene.ts"
import type { RowStatus } from "../spec.ts"
import type { Tone } from "../../theme/tones.ts"

export interface TimelineStep {
  id: string
  label: string
  t0: number
  t1: number
  stop?: string
  caption?: string
  /** On the last step of a beat: its reading hold (s), inserted before the next beat in continuous play. */
  hold?: number
  /** Camera / spotlight target override (`focus`): one id or several (union box). */
  focus?: string | string[]
  /** Narration (viewer rail); a narrated step without a caption gets a fallback caption. */
  narrate?: import("../spec.ts").Narrate
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
  /** Colour of dot, halo, trail, ring and arrival glow. */
  tone?: Tone
  /** Payload text riding with the dot (clipped to 32 chars). */
  label?: string
}

export interface TimelineGlow {
  node: string
  t: number
  /** Flood duration (s). */
  dur: number
  cx: number
  cy: number
  /** Toned arrival glow (a toned pulse). */
  tone?: Tone
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
  captions: TimelineCaption[]
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
  /** glow / unglow windows (`tone`: a toned glow). */
  lit?: Record<string, { t0: number; t1?: number; tone?: Tone }[]>
  /**
   * Tone events per element (node / group / edge id; later annotations, toasts, HUD ids): from
   * `t` on the element shows tone `to` (null = rest look), crossfading over `TONE_FADE`. Sources:
   * `tone` steps (staggered), pulse `tint` (arrival) and `stain` (the dot leaving each wire).
   * Sorted by time. The frame side is `toneFrame` (content-state.ts).
   */
  tones?: Record<string, { t: number; to: Tone | null }[]>
  /**
   * wire / unwire events per edge, in time order. `on` draws the wire on over [t0, t1]; off
   * retracts it (source end first). Before the first event the wire is hidden when that event
   * draws it, else drawn. Repeated cycles are allowed.
   */
  wires?: Record<string, { t0: number; t1: number; on: boolean }[]>
  /**
   * Diff code nodes: story `apply` windows per node. `hunks` = 0-based hunk indices applied over
   * [t0, t1]. Hunks no step applies show the diff from the start.
   */
  applies?: Record<string, { t0: number; t1: number; hunks: number[] }[]>
  /**
   * Change steps: elements whose after (delta) look is applied by a step, and the window over
   * which the before look turns into it (removed / modified; added ones reveal or wire instead).
   */
  changes?: Record<string, { t0: number; t1: number; delta: "added" | "modified" | "removed" }>
  /** Legend items whose every element is changed by a step: shown from this time. */
  legendAt?: Record<string, number>
  /** `spotlight: "veil"`: the focus box per step (diagram px, padded). */
  veil?: { t: number; x: number; y: number; w: number; h: number }[]
  /** Spotlight targets per step (story.spotlight): centre and radius. */
  spot?: { t: number; x: number; y: number; r: number }[]
  rewind?: "tape" | "glitch"
  /** Act stories: the acts that start, in order (see `TimelineAct`). */
  acts?: TimelineAct[]
  /**
   * Toast windows per toast id (geometry: `scene.toasts`): shown from `t0` (fade + rise + scale),
   * gone after `t1` (dismiss / `for` expiry; absent = up to the end).
   */
  toasts?: Record<string, { t0: number; t1?: number }>
  /** HUD metrics (`story.hud`): values live in `counters[id]`, visibility in `appear` / `vis`, tone in `tones`. */
  hud?: TimelineHud[]
}

/** A HUD metric: "label: value", pinned to the stage. */
export interface TimelineHud {
  id: string
  label: string
  value: number
  tone?: Tone
  prefix?: string
  suffix?: string
  at: "top-right" | "bottom-left"
}

/**
 * One act of an act story. `t0..t1` = its span on the timeline (from the start of its
 * transition); `body` = when its own steps begin (after the rewind / cut and the morph).
 */
export interface TimelineAct {
  id: string
  label: string
  tone?: Tone
  t0: number
  t1: number
  body: number
  /** How it entered (acts after the first). */
  enter?: "rewind" | "cut" | "continue"
  /** Rewind window [t0, t1]: plays the previous act backwards from `from1` to `from0` (eased). */
  rewind?: { t0: number; t1: number; from0: number; from1: number }
  /** Cut window [t0, t1]: a dip to the previous act's start state (`from0`). */
  cut?: { t0: number; t1: number; from0: number; from1: number }
  /** The morph: leaving wires retract, leaving boxes fade, entering boxes reveal, entering wires draw. */
  morph?: { t0: number; t1: number }
  /**
   * The persistent channels (appear, draw, counters, content) as they are in this act: the steps
   * of acts a rewind / cut undid are moved to `NEVER`. Absent = the timeline's own (or the
   * nearest earlier act's).
   */
  state?: Partial<Timeline>
}

/** A caption belongs to its step: shown from t0, gone by t1 (step end + settle, or the next caption). */
export interface TimelineCaption {
  i?: number
  /** Plain text (emphasis asterisks removed). */
  text: string
  t0: number
  t1: number
  step: number
  handoff: boolean
  /** `*emphasis*`: [start, end) char ranges of `text` drawn in the accent. */
  em?: [number, number][]
  /** Accent tone of the emphasis (default "note"; Phase C: the act's tone). */
  tone?: Tone
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
  tone?: Tone
  /** Payload label: left edge `x`, baseline `y`, opacity. */
  label?: { text: string; x: number; y: number; o: number }
}

export interface GlowFrame {
  id: string
  node: string
  cx: number
  cy: number
  r: number
  a: number
  tone?: Tone
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
  captions: { i?: number; text: string; o: number; words: number[]; current: boolean; em?: [number, number][]; tone?: Tone }[]
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
  /** Change steps: before → after progress 0..1 per element; omitted = after look. */
  delta?: Record<string, number>
  /** Legend item opacity while it is still to appear; omitted = shown. */
  legend?: Record<string, number>
  /** Veil (spotlight "veil"): the cutout box and the veil strength 0..1. */
  veil?: { x: number; y: number; w: number; h: number; a: number }
  /** Diff code nodes mid-apply: per-hunk progress 0..1 (0 = base version, 1 = the diff); omitted = applied. */
  diff?: Record<string, number[]>
  spot?: { x: number; y: number; r: number; a: number }
  /**
   * Tone layers per element: opacity of each tone's layer (omitted = rest look). Several tones can
   * be partly visible during a crossfade. Renderers draw one layer per tone the element ever uses.
   */
  tone?: Record<string, Partial<Record<Tone, number>>>
  /** Toned persistent glows: amplitude per tone (untoned glows stay in `lit`). */
  litTone?: Record<string, Partial<Record<Tone, number>>>
  /** Act stories: the act in effect and its chip layers (crossfading); rewind progress; cut dip. */
  act?: ActFrame
  /** Toasts on stage: opacity, rise (px) and scale; omitted = not shown. */
  toasts?: Record<string, { o: number; dy: number; s: number }>
}

export interface ActFrame {
  /** Index into `timeline.acts`. */
  k: number
  id: string
  /** Chip layers: "● label" (dot in `tone`) or the rewind chip; several during a crossfade. */
  chip: { text: string; tone?: Tone; o: number; rewind?: boolean }[]
  /** Inside a rewind window: progress 0..1 (the viewer's glitch / blur). */
  rewind?: number
  /** Inside a cut: the diagram's opacity (0 at the middle of the dip). */
  dip?: number
}
