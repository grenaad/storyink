import { story as S } from "../../theme/tokens.ts"
import { narrateCaption, narrateReading, resolveCite } from "./narrate.ts"
import type { Pt, Scene } from "../scene.ts"
import type { PulseRef, Spec, Story, StoryStep } from "../spec.ts"
import type { Diagnostic } from "../validate.ts"
import { autoStory } from "./auto.ts"
import { changesStory, changeWindow, expandChanges, wireDuration } from "./changes.ts"
import { stepFocus } from "./camera.ts"
import { cruise, inOutCubic, springSettle } from "./ease.ts"
import { isTone, TONES, type Tone } from "../../theme/tones.ts"
import { closest } from "../suggest.ts"
import { clipLabel, PULSE_LABEL_MAX } from "../layout/storyscan.ts"
import { flattenPath } from "../layout/paths.ts"
import { beatGroups, pulseLabelAnchor, pulseLabelWindows } from "./state.ts"
import { actMorphs, actPlan, CUT, NEVER, REWIND, timelineActs, unset, type ActWindow } from "./acts.ts"
import { boxOfRef, parseRef } from "../anchor.ts"
import { CARET_LINGER, Content, CROSSFADE, LIT_FALL, LIT_RISE, STATUS_DRAW, TOAST_IN, TOAST_OUT, TONE_FADE } from "./content.ts"
import type { StorySource, Timeline, TimelineDraw, TimelineGlow, TimelinePulse } from "./types.ts"

const REACT_SETTLE = springSettle(S.springs.react)

export const readTime = (text: string): number => {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  return Math.min(S.read.max, Math.max(S.read.min, S.read.base + S.read.perWord * words))
}

/** Reading hold for a beat whose on-screen caption is `caption` (seconds, before `pace`). */
export const readingHold = (caption?: string): number => {
  if (!caption?.trim()) return S.hold.bare
  const words = caption.trim().split(/\s+/).filter(Boolean).length
  return Math.min(S.hold.max, Math.max(S.hold.min, S.hold.base + S.hold.perWord * words))
}

const asList = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x])

export function polyLength(points: Pt[]): number {
  let L = 0
  for (let i = 1; i < points.length; i++) L += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  return L
}

/** Resolve an edge / message reference: exact id, else a unique "from->to". */
/**
 * Default flight time of a pulse over route length `L` px. Unlabelled: L / 520 px/s in
 * [0.45, 1.6] s (unchanged). Labelled: the label must move with the dot (not held clear of a
 * box, not mid-handoff — `pulseLabelAnchor`'s `follow`) for a reading budget of 0.6 s + 0.05 s
 * per shown character; the flight is that budget divided by the following share of the
 * (cruise-eased) flight, clamped to [1.2, 3.2] s and never faster than the unlabelled flight.
 * An authored `duration` always wins (handled by the caller).
 */
export function pulseFlight(L: number, label?: string, spans: { s0: number; s1: number }[] = [], points?: Pt[]): number {
  const P = S.pulse
  const base = Math.min(P.flightMax, Math.max(P.flightMin, L / P.pxPerSecond))
  if (!label) return base
  const read = P.labelRead + P.labelPerChar * Array.from(label).length
  const hops = spans.length ? spans : [{ s0: 0, s1: L }]
  const win = pulseLabelWindows(label, L, hops, points)
  const N = 400
  let ok = 0
  for (let i = 0; i < N; i++) if (pulseLabelAnchor(win, hops, cruise((i + 0.5) / N) * L).follow) ok++
  const share = ok / N
  const flight = share < 0.05 ? P.labelFlightMin : Math.min(P.labelFlightMax, Math.max(P.labelFlightMin, read / share))
  return Math.round(Math.max(base, flight) * 1000) / 1000
}

export function resolveEdge(scene: Scene, ref: string): { id?: string; error?: string; hint?: string } {
  const m = /^(.+?)->(.+)$/.exec(ref)
  const dup = m ? scene.edges.filter((e) => e.from === m[1] && e.to === m[2]).length : 0
  if (scene.edges.some((e) => e.id === ref) && dup <= 1) return { id: ref }
  if (m) {
    const hits = scene.edges.filter((e) => e.from === m[1] && e.to === m[2])
    if (hits.length === 1) return { id: hits[0].id }
    if (hits.length > 1)
      return { error: `"${ref}" is ambiguous (${hits.length} edges)`, hint: `use an edge id: ${hits.map((h) => h.id).join(", ")}` }
  }
  const near = scene.edges.slice(0, 6).map((e) => e.id)
  return { error: `unknown edge "${ref}"`, hint: `edges: ${near.join(", ")}${scene.edges.length > 6 ? ", ..." : ""}` }
}

export interface CompileResult {
  timeline?: Timeline
  diagnostics: Diagnostic[]
}

/**
 * The pause plan for pass 2: for the first step of each beat after the first, the previous beat's
 * steps and the reading hold that must pass after they settle before this step may start.
 */
type HoldPlan = Map<number, { prev: number[]; hold: number; still: number }>

/**
 * How long after its last step ends a beat is visually still (pass-1 timing): every event that
 * starts in the beat's window has finished — arrival rings, cooling trails, glows and label
 * flashes, implicit reveals (sequence notes, activations), fade-in wires, counter rolls.
 */
function stillAfter(tl: Timeline, groups: number[][]): number[] {
  const P = Math.max(S.pulse.ring, S.pulse.cooling, S.flash.decay)
  return groups.map((g, k) => {
    const a = tl.steps[g[0]].t0 - 1e-6
    const next = groups[k + 1]
    const b = next ? tl.steps[next[0]].t0 - 1e-6 : Infinity
    const inBeat = (t: number) => t >= a && t < b
    const end = Math.max(...g.map((i) => tl.steps[i].t1))
    const events = [
      end,
      ...tl.pulses.filter((q) => g.some((i) => q.id.startsWith(`pulse-${i}-`))).map((q) => q.tf1 + P),
      // + minGap: the ≤ 3 flashes/s rule may space glows differently once holds shift them.
      ...tl.glows.filter((q) => inBeat(q.t)).map((q) => q.t + Math.max(q.dur, S.flash.decay) + S.glow.minGap),
      ...Object.values(tl.appear).filter(inBeat).map((t) => t + REACT_SETTLE),
      ...Object.values(tl.draw).filter((d) => inBeat(d.t0)).map((d) => d.t1 + REACT_SETTLE),
      ...Object.values(tl.counters).flatMap((c) => c.events.filter((e) => inBeat(e.t)).map((e) => e.t + REACT_SETTLE)),
      ...contentEvents(tl).filter(([t]) => inBeat(t)).map(([, e]) => e),
      // The caret lingers briefly after a char run; a hold starts once it has gone.
      ...(tl.typing ?? []).filter((r) => r.by === "char" && inBeat(r.t0)).map((r) => r.t1 + CARET_LINGER + 0.02),
    ]
    return Math.max(0, Math.max(...events) - end)
  })
}

/**
 * Content events as [start, settled] pairs: typing runs, crossfades, bar moves, dim / hide
 * transitions, wire draws and retracts. Ambient motion (caret linger) is not included.
 */
export function contentEvents(tl: Timeline): [number, number][] {
  const out: [number, number][] = []
  for (const x of tl.typing ?? []) out.push([x.t0, x.t1])
  for (const l of Object.values(tl.versions ?? {})) for (const e of l) out.push([e.t, e.t + CROSSFADE])
  for (const l of Object.values(tl.bars ?? {})) for (const e of l) out.push([e.t, e.t + REACT_SETTLE])
  for (const l of Object.values(tl.levels ?? {})) for (const e of l) out.push([e.t, e.t + REACT_SETTLE])
  for (const l of Object.values(tl.vis ?? {})) for (const e of l) out.push([e.t, e.t + REACT_SETTLE])
  for (const l of Object.values(tl.wires ?? {})) for (const e of l) out.push([e.t0, e.t1])
  for (const l of Object.values(tl.applies ?? {})) for (const e of l) out.push([e.t0, e.t1])
  for (const e of Object.values(tl.changes ?? {})) out.push([e.t0, e.t1])
  for (const l of Object.values(tl.tones ?? {})) for (const e of l) out.push([e.t, e.t + TONE_FADE])
  for (const w of Object.values(tl.toasts ?? {})) {
    out.push([w.t0, w.t0 + TOAST_IN])
    if (w.t1 !== undefined) out.push([w.t1, w.t1 + TOAST_OUT])
  }
  // Status glyph transitions (not the spinner / shimmer: ambient, never part of a settle).
  for (const l of Object.values(tl.status ?? {})) for (const e of l) out.push([e.t, e.t + Math.max(REACT_SETTLE, e.to === "done" || e.to === "error" ? STATUS_DRAW : 0)])
  for (const l of Object.values(tl.lit ?? {}))
    for (const w of l) {
      out.push([w.t0, w.t0 + springSettle(LIT_RISE)])
      if (w.t1 !== undefined) out.push([w.t1, w.t1 + springSettle(LIT_FALL)])
    }
  return out
}

/**
 * How far before its first step a beat's implicit events start (pass-1 timing): a sequence frame
 * rises `gather + 0.1` s before its first message draws (the only pre-roll the compiler makes).
 * The hold must also clear this lead.
 */
function leadBefore(scene: Scene, tl: Timeline, groups: number[][]): number[] {
  return groups.map((g, k) => {
    if (k === 0) return 0
    const t0 = tl.steps[g[0]].t0
    const early = scene.frames.map((f) => tl.appear[f.id]).filter((t): t is number => t !== undefined && t < t0 - 1e-6 && t > t0 - 1)
    return early.length ? t0 - Math.min(...early) : 0
  })
}

/**
 * Compile `spec.story` against a laid-out scene into absolute times. Never throws.
 *
 * Two passes: the first compiles the authored timing and finds the beats (`beatGroups`); the
 * second inserts a **reading hold** after each beat (`readingHold` of the beat's caption × `pace`,
 * or the ending step's `hold`): a beat's first step never starts before the previous beat has
 * settled plus its hold. Relative `"+x"` steps shift; an absolute `at` becomes a minimum start; a
 * step whose own timing already leaves enough room adds nothing.
 */
export function compileStory(scene: Scene, spec: Spec): CompileResult {
  const first = compileOnce(scene, spec)
  if (!first.timeline || spec.story === undefined) return first
  const story = spec.story === "auto" ? undefined : spec.story
  const pace = typeof story?.pace === "number" ? story.pace : S.hold.pace
  const authored = story && Array.isArray(story.steps) ? story.steps : undefined
  const tl1 = first.timeline
  const groups = beatGroups(tl1)
  const holdOf = (g: number[]): number => {
    const last = g[g.length - 1]
    const own = authored?.[last]?.hold
    if (typeof own === "number") return own
    // A narrated beat holds for its narration (heading + body), not only the fallback caption.
    const narr = g.map((i) => tl1.steps[i].narrate).filter((n) => n).pop()
    const cap = narr ? narrateReading(narr) : g.map((i) => tl1.steps[i].caption).filter((c) => c).pop()
    return readingHold(cap) * pace
  }
  const holds = groups.map(holdOf)
  const still = stillAfter(tl1, groups)
  const lead = leadBefore(scene, tl1, groups)
  const plan: HoldPlan = new Map()
  groups.forEach((g, k) => {
    // A zero hold adds nothing (not even a "wait until still"): pace 0 is the authored timing.
    if (k > 0 && holds[k - 1] > 0) plan.set(g[0], { prev: groups[k - 1], hold: holds[k - 1], still: still[k - 1] + lead[k] })
  })
  const second = compileOnce(scene, spec, plan, new Map(groups.map((g, k) => [g[g.length - 1], { group: g, hold: holds[k], still: still[k] }])), tl1.steps.map((s) => s.t0))
  // Diagnostics are about the authored story (pass 1), including the length warning: reading
  // holds are the viewer's pacing, not story the author has to shorten.
  const timeline = second.timeline && { ...second.timeline, pace, source: storySource(scene, spec) }
  if (timeline?.acts && timeline.acts.length > 1) actStates(scene, spec, timeline)
  return { timeline, diagnostics: first.diagnostics }
}

/** Persistent channels: what an act's segment overrides (everything time-local stays shared). */
const STATE_KEYS = ["appear", "draw", "counters", "typing", "versions", "bars", "levels", "vis", "wires", "status", "lit", "applies", "tones", "changes", "toasts"] as const

/**
 * Acts entered by a rewind or a cut start from the previous act's start state: compile the story
 * again with the steps of every undone act moved to `NEVER` (pinned to the same step starts) and
 * keep its persistent channels as that act's `state`.
 */
function actStates(scene: Scene, spec: Spec, tl: Timeline): void {
  const st = spec.story as Story & { steps: StoryStep[] }
  const ap = actPlan(st.steps, st.acts!, () => {}, () => {})
  const t0 = tl.steps.map((s) => s.t0)
  const undone = new Set<number>()
  let last = ""
  for (let j = 1; j < tl.acts!.length; j++) {
    const a = tl.acts![j]
    const k = ap.acts.findIndex((x) => x.id === a.id)
    if (a.enter === "continue") continue
    undone.add(k - 1)
    const cancel = new Set(st.steps.map((_, i) => i).filter((i) => undone.has(ap.of[i])))
    const key = [...cancel].join(",")
    if (key === last) continue
    last = key
    const seg = compileOnce(scene, spec, undefined, undefined, undefined, { t0, cancel }).timeline
    if (!seg) continue
    const state: Partial<Timeline> = {}
    for (const f of STATE_KEYS) {
      const v = seg[f] ?? tl[f]
      if (v === undefined) continue
      ;(state as Record<string, unknown>)[f] = seg[f] !== undefined ? sortChannel(seg[f]) : Array.isArray(v) ? [] : {}
    }
    a.state = state
  }
}

/** Channel lists in time order (a segment's "never" events sit after later acts' events). */
function sortChannel(v: unknown): unknown {
  const tOf = (e: { t?: number; t0?: number }) => e.t ?? e.t0 ?? 0
  if (Array.isArray(v)) return [...v].sort((a, b) => tOf(a) - tOf(b))
  if (!v || typeof v !== "object") return v
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v)) {
    if (Array.isArray(x)) out[k] = [...x].sort((a, b) => tOf(a) - tOf(b))
    else if (x && typeof x === "object" && Array.isArray((x as { events?: unknown }).events))
      out[k] = { ...x, events: [...(x as { events: { t: number }[] }).events].sort((a, b) => a.t - b.t) }
    else out[k] = x
  }
  return out
}

/**
 * The minimal input `compileStory` needs to compile this story again (the viewer's pace control):
 * the node / group parents and the story with `"auto"` steps expanded. Small, JSON-safe.
 */
function storySource(scene: Scene, spec: Spec): StorySource {
  const st = spec.story!
  const steps = derivedSteps(scene, spec) ?? (st as Story & { steps: StoryStep[] }).steps
  // Everything but the steps and the pace (a compile parameter, stored as `timeline.pace`).
  const opts = st === "auto" ? {} : (({ steps: _s, pace: _p, ...rest }) => rest)(st)
  const par = (xs: { id: string; parent?: string }[] | undefined) => (xs ?? []).map((x) => (x.parent ? { id: x.id, parent: x.parent } : { id: x.id }))
  return spec.type === "sequence"
    ? { type: spec.type, nodes: [], groups: [], story: { ...opts, steps } }
    : { type: spec.type, nodes: par(spec.nodes), groups: par(spec.groups), story: { ...opts, steps } }
}

/**
 * Recompile a scene's story for another reading-hold `pace` (browser-safe; the HTML viewer calls
 * it when the reader changes Pauses). Identical to compiling the original spec with that pace.
 */
export function recompilePace(scene: Scene, pace: number): Timeline | undefined {
  const src = scene.timeline?.source
  if (!src) return scene.timeline
  if (scene.timeline!.pace === pace) return scene.timeline
  const spec = { type: src.type, title: "", nodes: src.nodes, groups: src.groups, edges: [], story: { ...src.story, pace } } as unknown as Spec
  return compileStory({ ...scene, timeline: undefined }, spec).timeline
}

/** The authored timing without reading holds (pass 1 of `compileStory`; for tests and tooling). */
export const compileStoryAuthored = (scene: Scene, spec: Spec): CompileResult => compileOnce(scene, spec)

/** Act segments: pinned step starts (from the full compile) and the steps a rewind / cut undid. */
interface Pin {
  t0: number[]
  cancel: Set<number>
}

function compileOnce(scene: Scene, spec: Spec, plan?: HoldPlan, beatEnds?: Map<number, { group: number[]; hold: number; still: number }>, authoredT0?: number[], pin?: Pin): CompileResult {
  const diagnostics: Diagnostic[] = []
  const err = (path: string, message: string, hint?: string) => diagnostics.push({ severity: "error", path, message, hint })
  const warn = (path: string, message: string, hint?: string) => diagnostics.push({ severity: "warning", path, message, hint })
  if (spec.story === undefined) return { diagnostics }
  const derived = derivedSteps(scene, spec)
  let story: Story & { steps: StoryStep[] } =
    spec.story === "auto"
      ? (autoStory(scene, spec) as Story & { steps: StoryStep[] })
      : derived
        ? { ...spec.story, steps: derived }
        : (spec.story as Story & { steps: StoryStep[] })
  // Caption emphasis: `*phrase*` → plain text + accent ranges (`\*` = a literal asterisk).
  const emOf = new Map<number, [number, number][]>()
  if (story.steps.some((st) => typeof st?.caption === "string" && st.caption.includes("*")))
    story = {
      ...story,
      steps: story.steps.map((st, i) => {
        if (typeof st?.caption !== "string" || !st.caption.includes("*")) return st
        const e = parseEmphasis(st.caption.trim())
        if (e.em.length) emOf.set(i, e.em)
        return { ...st, caption: e.text }
      }),
    }
  // A narrated step without a caption captions with its heading (or first sentence): the
  // animated SVG, header captions and beat tiles agree. Steps without `narrate` are untouched.
  if (story.steps.some((st) => st.narrate && !st.caption)) story = { ...story, steps: story.steps.map((st) => (st.narrate && !st.caption ? { ...st, caption: narrateCaption(st.narrate) } : st)) }
  const seq = scene.type === "sequence"

  const nodeIds = new Set(scene.nodes.map((n) => n.id))
  const groupIds = new Set(scene.groups.map((g) => g.id))
  const frameIds = new Set(scene.frames.map((f) => f.id))
  const actIds = new Set(scene.activations.map((a) => a.id))
  const edgeById = new Map(scene.edges.map((e) => [e.id, e]))
  const counterDefs = new Map<string, { node: string; value: number; prefix?: string; suffix?: string }>()
  for (const n of scene.nodes) if (n.counter) counterDefs.set(n.counter.id, { node: n.id, value: n.counter.value, prefix: n.counter.prefix, suffix: n.counter.suffix })
  // HUD metrics (story.hud): stage numbers driven by `counter` steps (node = the HUD id).
  const hud = hudItems(story.hud, seq, err, scene)
  for (const h of hud) if (!counterDefs.has(h.id)) counterDefs.set(h.id, { node: h.id, value: h.value, prefix: h.prefix, suffix: h.suffix })

  const appear: Record<string, number> = {}
  const edgeReveal: Record<string, number> = {}
  const flights: Record<string, TimelineDraw> = {}
  const pulses: TimelinePulse[] = []
  let glows: TimelineGlow[] = []
  const captions: Timeline["captions"] = []
  const counters: Timeline["counters"] = {}
  const steps: Timeline["steps"] = []

  const nodeBox = (id: string) => scene.nodes.find((n) => n.id === id) ?? scene.groups.find((g) => g.id === id)
  // Change steps become reveal / wire / unwire / apply / highlight plus delta-look windows.
  const expanded = expandChanges(scene, story.steps, (ref) => resolveEdge(scene, ref).id, warn, err)
  if (expanded.steps !== story.steps) story = { ...story, steps: expanded.steps }
  const changes: NonNullable<Timeline["changes"]> = {}
  const content = new Content(scene, story.steps, (ref) => resolveEdge(scene, ref).id)
  for (const h of hud) content.hud.add(h.id)
  const annIds = new Set((scene.annotations ?? []).map((a) => a.id))

  let prevEnd = 0
  let prevT0 = 0

  // Acts: one stage, several scenarios (graph diagrams).
  const storyActs = Array.isArray(story.acts) && story.acts.length ? story.acts : undefined
  if (storyActs && seq) err("story.acts", "acts need a graph diagram", "sequence diagrams: tell the scenarios as two diagrams (or use an architecture / dataflow diagram)")
  const ap = storyActs && !seq ? actPlan(story.steps, storyActs, err, warn) : undefined
  const am = ap ? actMorphs(scene, ap, story.steps) : undefined
  if (am) for (const e of scene.edges) if (e.acts) content.managed.add(e.id)
  const actWin: ActWindow[] = []
  const snaps: (() => void)[] = []
  const body: number[] = []

  story.steps.forEach((step: StoryStep, i) => {
    const p = `story.steps[${i}]`
    let t0: number
    if (step.at === undefined) t0 = i === 0 ? 0 : prevEnd
    else if (typeof step.at === "number") {
      t0 = step.at
      // Pass 2: an absolute `at` keeps at least its authored offset from the previous step's
      // start, so a step inside a beat a reading hold pushed later moves with its beat (never
      // before its beat-mates, e.g. a staggered pulse step chained after a "+0" neighbour).
      if (authoredT0 && i > 0 && steps[i - 1]) t0 = Math.max(t0, steps[i - 1].t0 + (step.at - authoredT0[i - 1]))
      if (t0 < prevT0 - 1e-9) err(`${p}.at`, `at ${t0}s goes backwards (previous step starts at ${+prevT0.toFixed(3)}s)`, `use "+${Math.max(0, +(t0 - prevEnd).toFixed(2))}" or a later time`)
    } else {
      const m = /^\+\s*(\d+(?:\.\d+)?)$/.exec(step.at.trim())
      if (!m) {
        err(`${p}.at`, `invalid at ${JSON.stringify(step.at)}`, `use seconds (2.5) or "+0.3" (after the previous step)`)
        t0 = prevEnd
      } else t0 = prevEnd + Number(m[1])
    }
    // Reading hold: a beat's first step waits for the previous beat to settle plus its hold.
    const h = plan?.get(i)
    if (h) t0 = Math.max(t0, Math.max(...h.prev.map((j) => steps[j].t1)) + h.still + h.hold)
    if (pin) t0 = pin.t0[i]
    // Acts: the entry step of a later act starts with the rewind / cut and the morph; its own
    // events (and caption) follow them.
    const stepStart = t0
    let capT0 = t0
    let actLabel: string | undefined
    let actFocus: string[] | undefined
    if (ap && am) {
      if (i === 0) {
        snaps[0] = content.snapshot()
        body[0] = 0
      }
      const k = ap.entry.indexOf(i)
      if (k > 0) {
        const how = ap.enter[k]
        const B = body[k - 1] ?? 0
        const len = how === "rewind" ? Math.min(REWIND.max, Math.max(REWIND.min, (t0 - B) * REWIND.share)) : how === "cut" ? CUT : 0
        // Toasts still up when an act ends: a warning; a rewind / cut takes them off the stage.
        for (const id of content.toastsUp(t0)) {
          warn(`story.steps[${i}]`, `toast "${id}" is still up when act "${ap.acts[k - 1].id}" ends`, `add "dismiss": "${id}" (or "all") to a step before, or give the toast "for": seconds`)
          if (how !== "continue") content.out.toasts[id].t1 = Math.round(t0 * 1e4) / 1e4
        }
        const w = am.window(k, t0, t0 + len)
        const win: ActWindow = { ...w, k, how, B, E: t0 }
        actWin.push(win)
        if (how !== "continue") snaps[k - 1]?.()
        // Wires the act starts without (a rewind / cut undid their `wire`): no retract in the morph.
        const undrawn = scene.edges.filter((e) => e.acts && content.drawn.get(e.id) === false).map((e) => e.id)
        if (undrawn.length) win.undrawn = new Set(undrawn)
        snaps[k] = content.snapshot()
        body[k] = w.M
        capT0 = w.R
        t0 = w.M
        actLabel = ap.acts[k].label
        if (am.changed[k].length) actFocus = am.changed[k]
      }
    }
    // A segment of an act story: steps of undone acts happen "never".
    if (pin?.cancel.has(i)) t0 = capT0 = NEVER
    const cancelled = pin?.cancel.has(i) === true
    const ends = [t0]

    // Reveal.
    for (const id of asList(step.reveal)) {
      if (edgeById.has(id) || /->/.test(id)) {
        const r = resolveEdge(scene, id)
        if (!r.id) err(`${p}.reveal`, r.error!, r.hint)
        else if (unset(edgeReveal[r.id])) edgeReveal[r.id] = t0
      } else if (nodeIds.has(id) || groupIds.has(id) || frameIds.has(id) || actIds.has(id) || annIds.has(id) || content.hud.has(id)) {
        // Acts: a box back on stage after an act without it shows again (its first reveal stays).
        if (ap && am && am.reenters(id, ap.of[i])) (content.out.vis[id] ??= []).push({ t: Math.round(t0 * 1000) / 1000, to: 1 })
        else if (unset(appear[id])) appear[id] = t0
      } else if (id.includes("#") && nodeIds.has(parseRef(id).node) && boxOfRef(scene, id)) {
        // A panel row / code line ("session#exec1").
        if (unset(appear[id])) appear[id] = t0
      } else err(`${p}.reveal`, `unknown id "${id}"`, `reveal takes node, group, edge, note, frame, annotation or HUD ids${hintOf(id, [...nodeIds, ...groupIds, ...annIds, ...content.hud])}`)
      ends.push(t0 + REACT_SETTLE)
    }

    // Content steps (0.4): set / clear, type, line, dim / hide, wire.
    for (const [key, list] of [["wire", step.wire], ["unwire", step.unwire]] as const)
      asList(list as unknown).forEach((w, k) => {
        const ref = typeof w === "string" ? w : w && typeof w === "object" ? (w as { edge?: unknown }).edge : undefined
        if (typeof ref !== "string") return
        const r = resolveEdge(scene, ref)
        if (!r.id) err(`${p}.${key}${Array.isArray(list) ? `[${k}]` : ""}`, r.error!, r.hint)
      })
    const cs = content.step(step, i, t0, p, appear, err, warn)
    ends.push(...cs.ends)
    for (const op of expanded.ops[i]) {
      const e = op.kind === "edge" ? edgeById.get(op.id) : undefined
      const w = changeWindow(op, Math.round(t0 * 1000) / 1000, e ? wireDuration(e) : undefined)
      changes[op.id] = { ...w, delta: op.delta }
      ends.push(w.t1)
    }

    // Pulses.
    asList(step.pulse as PulseRef | PulseRef[]).forEach((ref, k) => {
      const pp = `${p}.pulse${Array.isArray(step.pulse) ? `[${k}]` : ""}`
      const reverse = typeof ref === "object" && ref.reverse === true
      const delay = typeof ref === "object" && typeof ref.delay === "number" && ref.delay > 0 ? ref.delay : 0
      const pt0 = t0 + delay
      const refs = typeof ref === "string" ? [ref] : ref.route ?? (ref.edge ? [ref.edge] : [])
      if (!refs.length) return err(pp, "pulse needs an edge or a route", `{ "edge": "a->b" } or { "route": ["a->b", "b->c"] }`)
      const ids: string[] = []
      for (const r0 of refs) {
        const r = resolveEdge(scene, r0)
        if (!r.id) err(pp, r.error!, r.hint)
        else ids.push(r.id)
      }
      if (ids.length !== refs.length) return
      for (let j = 1; j < ids.length; j++)
        if (edgeById.get(ids[j - 1])!.to !== edgeById.get(ids[j])!.from)
          warn(pp, `route breaks between "${ids[j - 1]}" and "${ids[j]}"`, "each hop should start where the previous one ends")
      for (const id of ids) {
        const w = content.wireState(id)
        if (w === "unwired") warn(pp, `${reverse ? "reverse " : ""}pulse on "${id}" after it is unwired`, `wire it again first`)
        else if (w === "undrawn" && reverse) warn(pp, `reverse pulse on "${id}" before it is drawn`, `add "wire": "${id}" to an earlier step`)
      }
      // Reverse pulses travel the same rounded wires backwards (last hop first).
      const hops = reverse ? [...ids].reverse() : ids
      const points: Pt[] = []
      const spans: TimelinePulse["spans"] = []
      let L = 0
      for (const id of hops) {
        // The drawn (rounded) wire, not its corner points: the dot and trail stay on the curve.
        const fwd = flattenPath(edgeById.get(id)!.d)
        const pts = reverse ? [...fwd].reverse() : fwd
        const len = polyLength(pts)
        // Keep each hop's own start (skip it only when it repeats the previous end), so the route
        // never cuts a corner off the next wire; the dot crosses the node straight between hops.
        const last = points[points.length - 1]
        if (last) L += Math.hypot(pts[0].x - last.x, pts[0].y - last.y)
        spans.push({ edge: id, s0: L, s1: L + len })
        L += len
        points.push(...(last && Math.hypot(last.x - pts[0].x, last.y - pts[0].y) < 1e-6 ? pts.slice(1) : pts))
      }
      const rawLabel = typeof ref === "object" && typeof ref.label === "string" && ref.label.trim() ? clipLabel(ref.label) : undefined
      const flight = typeof ref === "object" && ref.duration ? ref.duration : pulseFlight(L, rawLabel, spans, points)
      const tf0 = pt0 + S.pulse.gather
      const tf1 = tf0 + flight
      const lastE = edgeById.get(ids[reverse ? 0 : ids.length - 1])!
      const arriveNode = reverse ? lastE.from : lastE.to
      const arriveAnchor = reverse ? lastE.fromAnchor : lastE.toAnchor
      const pid = `pulse-${i}-${k}`
      // Colour carries meaning: tone, payload label, landing on the edge, tint on arrival, stain.
      const o = typeof ref === "object" ? ref : undefined
      let tone: Tone | undefined
      if (o?.tone !== undefined) {
        if (isTone(o.tone)) tone = o.tone
        else err(`${pp}.tone`, `unknown tone ${JSON.stringify(o.tone)}`, toneHint(o.tone))
      }
      let label: string | undefined
      if (o?.label !== undefined) {
        if (typeof o.label !== "string" || !o.label.trim()) err(`${pp}.label`, `pulse "label" must be non-empty text`)
        else {
          label = clipLabel(o.label)
          if (o.label.length > PULSE_LABEL_MAX) warn(`${pp}.label`, `pulse label is ${o.label.length} chars; shown as "${label}"`, `keep payload labels to ${PULSE_LABEL_MAX} chars`)
        }
      }
      if (o?.land !== undefined) {
        if (o.land !== "edge") err(`${pp}.land`, `unknown land ${JSON.stringify(o.land)}`, `use "edge" (the label stays as the arriving edge's label)`)
        else if (!label) warn(`${pp}.land`, `"land" needs a "label"; nothing lands`, `add "label": "..."`)
        else if (seq) err(`${pp}.land`, `"land" needs a graph diagram`, "sequence messages keep their labels")
        else if (edgeById.get(lastE.id)?.labels) {
          content.landLabel(lastE.id, tf1)
          ends.push(tf1 + CROSSFADE)
        }
      }
      for (const key of ["tint", "stain"] as const) {
        if (o?.[key] === undefined) continue
        if (typeof o[key] !== "boolean") err(`${pp}.${key}`, `"${key}" must be true or false`)
        else if (o[key] && !tone) warn(`${pp}.${key}`, `"${key}" needs a pulse "tone"; nothing changes colour`, `add "tone": "note" | "warn" | "risk" | "good" | "neutral"`)
        else if (o[key] && seq) err(`${pp}.${key}`, `"${key}" needs a graph diagram`, "sequence diagrams: toned pulses only")
      }
      if (tone && o?.tint === true && !seq) {
        content.toneEvent(arriveNode, tf1, tone)
        ends.push(tf1 + TONE_FADE)
      }
      if (tone && o?.stain === true && !seq)
        for (const sp of spans) {
          // The moment the dot leaves this wire's span (the flight eases over the whole route).
          const u = invEase(sp.s1 / L, label ? cruise : inOutCubic)
          content.toneEvent(sp.edge, tf0 + u * flight, tone)
        }
      pulses.push({
        id: pid,
        edges: hops,
        points,
        spans,
        length: L,
        t0: pt0,
        tf0,
        tf1,
        target: seq ? undefined : arriveNode,
        ...(reverse ? { reverse: true } : {}),
        ...(!seq && (reverse || arriveAnchor) ? { arrive: { node: arriveNode, ...(arriveAnchor ? { anchor: arriveAnchor } : {}) } } : {}),
        ...(tone ? { tone } : {}),
        ...(label ? { label } : {}),
      })
      // Forward pulses draw hidden wires as they fly; reverse pulses and wire-managed edges never do.
      if (!reverse && !cancelled)
        for (const sp of spans)
          if (!flights[sp.edge] && !content.managed.has(sp.edge)) flights[sp.edge] = { mode: "flight", pulse: pid, t0: tf0 + (sp.s0 / L) * flight, t1: tf0 + (sp.s1 / L) * flight, s0: sp.s0, s1: sp.s1 }
      if (!seq && nodeBox(arriveNode)) {
        const end = points[points.length - 1]
        // On a row / code line: a ring and a flash on that row, no panel flood.
        if (arriveAnchor) glows.push({ node: `${arriveNode}#${arriveAnchor}`, t: tf1, dur: 0, cx: end.x, cy: end.y, ...(tone ? { tone } : {}) })
        else glows.push({ node: arriveNode, t: tf1, dur: S.glow.duration, cx: end.x, cy: end.y, ...(tone ? { tone } : {}) })
      }
      ends.push(tf1)
    })

    // Highlights.
    const hl = step.highlight
    const hlIds = hl === undefined ? [] : typeof hl === "string" ? [hl] : Array.isArray(hl) ? hl : hl.ids
    const hlFor = hl && typeof hl === "object" && !Array.isArray(hl) && typeof hl.for === "number" ? hl.for : S.glow.duration
    for (const id of hlIds) {
      const b = nodeBox(id)
      if (!b) {
        err(`${p}.highlight`, `unknown id "${id}"`, "highlight takes node or group ids")
        continue
      }
      glows.push({ node: id, t: t0, dur: Math.max(0.4, hlFor), cx: b.x + b.w / 2, cy: b.y + b.h / 2 })
      ends.push(t0 + REACT_SETTLE)
    }

    // Narration cites must point at an element or a file.
    step.narrate?.cites?.forEach((c, k) => {
      if (c && typeof c.ref === "string" && !resolveCite(scene, c.ref))
        err(`${p}.narrate.cites[${k}].ref`, `unknown cite ref "${c.ref}"`, "cite a node / edge / group id, \"node#row\", or a file path like \"src/x.ts#L12-20\"")
    })

    // Caption.
    if (typeof step.caption === "string" && step.caption.trim()) {
      const em = emOf.get(i)
      const actTone = ap ? ap.acts[ap.of[i]]?.tone : undefined
      captions.push({ text: step.caption.trim(), t0: capT0, t1: 0, step: i, handoff: false, ...(em ? { em } : {}), ...(em && actTone && isTone(actTone) ? { tone: actTone } : {}) })
      ends.push(t0 + readTime(step.caption))
    }

    // Counters.
    for (const c of asList(step.counter)) {
      const def = counterDefs.get(c.id)
      if (!def) {
        err(`${p}.counter`, `unknown counter "${c.id}"`, counterDefs.size ? `${closest(c.id, [...counterDefs.keys()]) ? `did you mean "${closest(c.id, [...counterDefs.keys()])}"? ` : ""}counters: ${[...counterDefs.keys()].join(", ")}` : `declare it on a node: "counter": { "id": "${c.id}" }, or as a HUD metric: "story": { "hud": [{ "id": "${c.id}", "label": "..." }] }`)
        continue
      }
      if (typeof c.to !== "number" || !Number.isFinite(c.to)) {
        err(`${p}.counter`, `counter "${c.id}" needs a numeric "to"`)
        continue
      }
      const entry = (counters[c.id] ??= { node: def.node, start: def.value, events: [], prefix: def.prefix, suffix: def.suffix, decimals: 0 })
      entry.events.push({ t: t0, to: c.to })
      ends.push(t0 + REACT_SETTLE)
    }

    const t1 = Math.max(...ends)
    const parts = titleParts(step, scene)
    if (cs.acts.length) parts.acts = cs.acts
    const stop = step.stop ?? actLabel
    const label = stop ?? (step.caption ? truncate(step.caption, 40) : composeTitle([parts], 48, i > 0 && isEmptyStep(step) ? "Hold" : "Start"))
    const be = beatEnds?.get(i)
    const focus = cs.focus ?? actFocus
    steps.push({ id: step.id ?? `step-${i + 1}`, label, t0: stepStart, t1, parts, ...(focus ? { focus } : {}), ...(stop ? { stop } : {}), ...(step.caption ? { caption: step.caption } : {}), ...(step.narrate ? { narrate: step.narrate } : {}), ...(be ? { hold: Math.round(be.hold * 1000) / 1000 } : {}) })
    prevEnd = t1
    prevT0 = t0

  })
  for (const c of Object.values(counters)) {
    const all = [c.start, ...c.events.map((e) => e.to)]
    c.decimals = Math.max(...all.map((v) => (Number.isInteger(v) ? 0 : Math.min(3, String(v).split(".")[1]?.length ?? 0))))
  }

  // ≤ 3 flashes per second: glows that start within 1/3 s of the previous (distinct) start are delayed.
  glows = glows.sort((a, b) => a.t - b.t || a.node.localeCompare(b.node))
  let lastStart = -Infinity
  for (const g of glows) {
    if (g.t > lastStart + 1e-6 && g.t < lastStart + S.glow.minGap) g.t = lastStart + S.glow.minGap
    if (g.t > lastStart + 1e-6) lastStart = g.t
  }
  // One glow per node at a time: drop overlapping duplicates.
  glows = glows.filter((g, k) => !glows.slice(0, k).some((h) => h.node === g.node && Math.abs(h.t - g.t) < 1e-6))

  // Acts: membership events (the morphs) on the appear / visibility / wire channels.
  if (ap && am) am.emit(actWin, appear, content.out)

  // Groups revealed implicitly with their first child when all children are hidden.
  const childrenOf = (gid: string): string[] => [
    ...scene.nodes.filter((n) => parentOf(spec, n.id) === gid).map((n) => n.id),
    ...scene.groups.filter((g) => parentOf(spec, g.id) === gid).map((g) => g.id),
  ]
  const groupAppear = (gid: string): number | undefined => {
    if (appear[gid] !== undefined) return appear[gid]
    const kids = childrenOf(gid)
    if (!kids.length) return undefined
    const times = kids.map((k) => (groupIds.has(k) ? groupAppear(k) : appear[k]))
    if (times.some((x) => x === undefined)) return undefined
    return Math.min(...(times as number[]))
  }
  for (const g of scene.groups) {
    const t = groupAppear(g.id)
    if (t !== undefined) appear[g.id] = t
  }

  // Which wires start hidden, and how they draw on.
  const draw: Record<string, TimelineDraw> = {}
  const FADE = 0.45
  for (const e of scene.edges) {
    if (content.managed.has(e.id)) continue
    const fa = appear[e.from]
    const ta = appear[e.to]
    const hidden = seq ? flights[e.id] !== undefined || edgeReveal[e.id] !== undefined : fa !== undefined || ta !== undefined || edgeReveal[e.id] !== undefined
    if (!hidden) continue
    if (flights[e.id]) draw[e.id] = flights[e.id]
    else if (edgeReveal[e.id] !== undefined) draw[e.id] = { mode: "fade", t0: edgeReveal[e.id], t1: edgeReveal[e.id] + FADE }
    else {
      const t = Math.max(fa ?? 0, ta ?? 0) + 0.15
      draw[e.id] = { mode: "fade", t0: t, t1: t + FADE }
    }
    if (!seq && flights[e.id]) {
      // Nothing appears before its cause: a pulse cannot leave a node that is not there yet.
      if (fa !== undefined && fa > flights[e.id].t0 + 1e-6) warn("story", `pulse on "${e.id}" starts before "${e.from}" is revealed`)
    }
  }
  if (seq) {
    // Activations / frames / notes follow the messages that cause them.
    scene.activations.forEach((a) => {
      if (appear[a.id] !== undefined) return
      const m = /-(\d+)-(\d+)$/.exec(a.id)
      const start = m ? scene.edges[Number(m[1])] : undefined
      if (start && draw[start.id]) appear[a.id] = draw[start.id].t1
    })
    scene.frames.forEach((f) => {
      if (appear[f.id] !== undefined) return
      const first = scene.edges.find((e) => f.y < e.points[0].y && e.points[0].y < f.y + f.h)
      if (first && draw[first.id]) appear[f.id] = Math.max(0, draw[first.id].t0 - S.pulse.gather - 0.1)
    })
    for (const n of scene.nodes) {
      if (n.kind !== "note" || appear[n.id] !== undefined) continue
      const before = scene.edges.filter((e) => e.points[0].y < n.y).pop()
      if (before && draw[before.id]) appear[n.id] = draw[before.id].t1 + 0.1
    }
  }

  // Timeline extent: everything settles, then the end hold.
  const events = [
    ...steps.map((s) => s.t1),
    ...pulses.map((p) => p.tf1 + S.pulse.ring),
    ...glows.map((g) => g.t + g.dur),
    ...Object.values(draw).map((d) => d.t1 + REACT_SETTLE),
    ...Object.values(appear).map((t) => t + REACT_SETTLE),
    ...Object.values(counters).flatMap((c) => c.events.map((e) => e.t + REACT_SETTLE)),
    ...contentEvents({ ...content.fields(), changes } as Timeline).map(([, e]) => e),
    0,
  ]
  const lastEvent = Math.max(...events)
  const duration = lastEvent + S.endHold
  // A caption belongs to its step: it stays through the step and a settle beat, then fades.
  // If the next caption arrives first, it hands over (the old line dims to 0.52 briefly).
  captions.forEach((c, k) => {
    // The caption covers its step and any caption-less steps chained straight after it ("+0").
    let last = c.step
    while (steps[last + 1] && steps[last + 1].t0 - steps[last].t1 <= 0.05 && !steps[last + 1].caption) last++
    // …and through its beat's reading hold, when it is the beat's caption.
    const be = [...(beatEnds?.values() ?? [])].find((b) => b.group.includes(c.step))
    const beatEnd = be ? Math.max(...be.group.map((j) => steps[j].t1)) + be.still : 0
    const own = Math.min(Math.max(steps[last].t1 + S.beats.settle, be ? beatEnd + be.hold : 0), duration - 0.5)
    const next = captions[k + 1]
    if (next && next.t0 <= own) {
      c.t1 = next.t0
      c.handoff = true
    } else c.t1 = own
  })
  // End state: the static diagram is the final frame.
  {
    const end = content.endState()
    for (const id of end.lit) warn("story", `"${id}" still glows at the end: the static diagram shows it lit`, `add "unglow": "${id}"`)
    for (const n of scene.nodes)
      for (const r of n.rows ?? []) {
        const key = `${n.id}#${r.id}`
        if (content.status(key) !== "running" || end.hidden(key) || end.hidden(n.id)) continue
        warn("story", `"${key}" is still running at the end: the static diagram shows a spinner`, `add "status": { "id": "${key}", "to": "done" }`)
      }
    for (const n of scene.nodes)
      if (n.glyph && content.status(n.id) === "running" && !end.hidden(n.id))
        warn("story", `"${n.id}" is still running at the end: the static diagram shows a spinner`, `add "status": { "id": "${n.id}", "to": "done" }`)
    for (const id of content.toastsUp(Infinity))
      if (content.out.toasts[id].t0 < NEVER) warn("story", `toast "${id}" is still up at the end: the static diagram shows it`, `add "dismiss": "${id}" (or "all") to a later step, or give it "for": seconds`)
  }
  if (duration > S.warnTotal) warn("story", `story runs ${duration.toFixed(1)}s (over ${S.warnTotal}s, reading holds not counted)`, "shorten gaps or split the story")
  if (!story.steps.length) warn("story.steps", "story has no steps")

  const r3 = (x: number) => Math.round(x * 1000) / 1000
  const timeline: Timeline = {
    duration: r3(duration),
    lastEvent: r3(lastEvent),
    autoplay: story.autoplay === true,
    motion: story.motion ?? "full",
    ...(story.camera ? { camera: story.camera } : {}),
    loop: story.end === "loop",
    // Step ends round up, so a step's settled stop is never a hair before its own events (a dot
    // 0.4 ms short of arrival is still drawn in flight).
    steps: steps.map((s) => ({ ...s, t0: r3(s.t0), t1: Math.ceil(s.t1 * 1000 - 1e-6) / 1000 })),
    appear,
    draw,
    pulses,
    glows,
    captions,
    counters,
    ...content.fields(),
    ...(Object.keys(changes).length ? { changes } : {}),
    ...legendTimes(scene, changes, appear, content.fields()),
    ...(story.spotlight === true ? { spot: spotTargets(scene, steps, pulses, glows, content.fields() as Timeline, story.steps) } : {}),
    ...(story.rewind ? { rewind: story.rewind } : {}),
    ...(ap ? { acts: timelineActs(ap, actWin, r3(duration)) } : {}),
    ...(hud.length ? { hud } : {}),
  }
  if (story.spotlight === "veil") {
    const veil = veilTargets(scene, timeline)
    if (veil.length) timeline.veil = veil
  }
  return { timeline, diagnostics }
}

/**
 * Spotlight target per step, first match: focus → status slot → pulse arrival → glow /
 * highlight node → typed box → lit bar → wire midpoint → reveal union. Steps with nothing keep
 * the previous target.
 */
function spotTargets(scene: Scene, steps: Timeline["steps"], pulses: TimelinePulse[], glows: TimelineGlow[], c: Timeline, src: StoryStep[]): NonNullable<Timeline["spot"]> {
  const out: NonNullable<Timeline["spot"]> = []
  const r3 = (x: number) => Math.round(x * 1000) / 1000
  const box = (id: string) => boxOfRef(scene, id.replace(/@\w+$/, ""))
  const at0 = (t: number, t0: number) => Math.abs(t - t0) < 1e-6
  const ofBox = (b: { x: number; y: number; w: number; h: number }) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2, r: Math.max(90, Math.min(260, 0.6 * Math.max(b.w, b.h))) })
  steps.forEach((st, i) => {
    // Content events sit on the published (ms-rounded) step start.
    const t0 = r3(st.t0)
    let p: { x: number; y: number; r: number } | undefined
    const fs = st.focus === undefined ? [] : (Array.isArray(st.focus) ? st.focus : [st.focus]).map(box).filter((b): b is NonNullable<typeof b> => !!b)
    const f = fs.length ? { x: Math.min(...fs.map((b) => b.x)), y: Math.min(...fs.map((b) => b.y)), w: Math.max(...fs.map((b) => b.x + b.w)) - Math.min(...fs.map((b) => b.x)), h: Math.max(...fs.map((b) => b.y + b.h)) - Math.min(...fs.map((b) => b.y)) } : undefined
    if (f) p = ofBox(f)
    if (!p)
      for (const [key, ev] of Object.entries(c.status ?? {}))
        if (ev.some((e) => at0(e.t, t0))) {
          const r = parseRef(key)
          const n = scene.nodes.find((x) => x.id === r.node)
          const row = n?.rows?.find((x) => x.id === r.anchor)
          if (n && row) {
            p = { x: n.x + row.statusX, y: n.y + row.anchorY, r: 110 }
            break
          }
        }
    if (!p) {
      const q = pulses.find((x) => x.id.startsWith(`pulse-${i}-`))
      if (q) p = { ...q.points[q.points.length - 1], r: 120 }
    }
    if (!p) {
      const lit = Object.entries(c.lit ?? {}).find(([, w]) => w.some((x) => at0(x.t0, t0)))?.[0]
      const g = lit ?? glows.find((x) => at0(x.t, t0) && !x.node.includes("#"))?.node
      const b = g ? box(g) : undefined
      if (b) p = ofBox(b)
    }
    if (!p) {
      const ty = (c.typing ?? []).find((x) => at0(x.t0, t0))
      const b = ty ? box(ty.target) : undefined
      if (b) p = ofBox(b)
    }
    if (!p)
      for (const [id, ev] of Object.entries(c.bars ?? {})) {
        const e = ev.find((x) => at0(x.t, t0) && x.on)
        const a = e && box(`${id}#${e.a}`)
        const b = e && box(`${id}#${e.b}`)
        if (a && b) {
          p = ofBox({ x: a.x, y: a.y, w: a.w, h: b.y + b.h - a.y })
          break
        }
      }
    if (!p)
      for (const [id, ev] of Object.entries(c.wires ?? {}))
        if (ev.some((x) => at0(x.t0, t0))) {
          const e = scene.edges.find((x) => x.id === id)
          if (e) {
            const m = e.points[Math.floor(e.points.length / 2)]
            const a = e.points[Math.floor((e.points.length - 1) / 2)]
            p = { x: (a.x + m.x) / 2, y: (a.y + m.y) / 2, r: 110 }
            break
          }
        }
    if (!p) {
      const bs = asList(src[i]?.reveal)
        .map((id) => (typeof id === "string" ? box(id) : undefined))
        .filter((b): b is NonNullable<typeof b> => !!b)
      if (bs.length) {
        const x0 = Math.min(...bs.map((b) => b.x))
        const y0 = Math.min(...bs.map((b) => b.y))
        p = ofBox({ x: x0, y: y0, w: Math.max(...bs.map((b) => b.x + b.w)) - x0, h: Math.max(...bs.map((b) => b.y + b.h)) - y0 })
      }
    }
    if (p) out.push({ t: r3(t0), x: r3(p.x), y: r3(p.y), r: r3(p.r) })
  })
  return out
}

/**
 * Legend items whose every element (nodes, groups, edges with that delta) is changed by a step
 * (or, for added ones, revealed / wired by a step) appear with the first of them.
 */
function legendTimes(scene: Scene, changes: NonNullable<Timeline["changes"]>, appear: Record<string, number>, c: Partial<Timeline>): { legendAt?: Record<string, number> } {
  if (!scene.legend) return {}
  const at = (id: string, kind: "edge" | "other"): number | undefined =>
    changes[id]?.t0 ?? (kind === "edge" ? c.wires?.[id]?.find((w) => w.on)?.t0 : appear[id])
  const out: Record<string, number> = {}
  for (const d of scene.legend.items) {
    if (d === "unchanged") continue
    const els = [
      ...scene.nodes.filter((n) => n.delta === d).map((n) => at(n.id, "other")),
      ...scene.groups.filter((g) => g.delta === d).map((g) => at(g.id, "other")),
      ...scene.edges.filter((e) => e.delta === d).map((e) => at(e.id, "edge")),
    ]
    if (els.length && els.every((t) => t !== undefined)) out[d] = Math.round(Math.min(...(els as number[])) * 1000) / 1000
  }
  return Object.keys(out).length ? { legendAt: out } : {}
}

/** Veil cutout per step: the step's focus box (stepFocus); steps with none keep the previous. */
function veilTargets(scene: Scene, tl: Timeline): NonNullable<Timeline["veil"]> {
  const r3 = (x: number) => Math.round(x * 1000) / 1000
  const out: NonNullable<Timeline["veil"]> = []
  tl.steps.forEach((st, i) => {
    const b = stepFocus(scene, tl, i, 18)
    if (b) out.push({ t: r3(st.t0), x: r3(b.x), y: r3(b.y), w: r3(b.w), h: r3(b.h) })
  })
  return out
}

/** `"auto"` / `"changes"` steps expanded; undefined for authored steps. */
function derivedSteps(scene: Scene, spec: Spec): StoryStep[] | undefined {
  const st = spec.story
  if (st === undefined) return undefined
  if (st === "auto" || st.steps === "auto") return autoStory(scene, spec).steps as StoryStep[]
  if (st.steps === "changes") return changesStory(scene, spec).steps as StoryStep[]
  return undefined
}

/** A step that does nothing (only id / at / hold): a held pause. */
function isEmptyStep(step: StoryStep): boolean {
  return Object.keys(step).every((k) => k === "id" || k === "at" || k === "hold")
}

function parentOf(spec: Spec, id: string): string | undefined {
  if (spec.type === "sequence") return undefined
  return spec.nodes.find((n) => n.id === id)?.parent ?? spec.groups?.find((g) => g.id === id)?.parent
}

export function truncate(s: string, n: number): string {
  const t = s.trim()
  if (t.length <= n) return t
  const cut = t.slice(0, n - 1)
  const sp = cut.lastIndexOf(" ")
  return `${(sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:·-]+$/, "")}…`
}

/** Humanised pieces of a step: pulse paths (A → B → C), revealed names, counter changes. */
const PSEUDO: Record<string, string> = { initial: "Start", final: "End", choice: "Choice", fork: "Fork", join: "Join" }

/** Human name for an element: its label, or a word for label-less pseudo states. */
export function humanName(scene: Scene, id: string): string {
  if (id.includes("#") && !scene.nodes.some((x) => x.id === id)) {
    const r = parseRef(id)
    const row = scene.nodes.find((x) => x.id === r.node)?.rows?.find((x) => x.id === r.anchor)
    const v = row?.versions[0]
    if (v) return (v.lines.join(" ") || v.tag || id).trim()
  }
  const n = scene.nodes.find((x) => x.id === id)
  if (n) {
    const l = n.label.join(" ").trim()
    if (l) return l
    const word = PSEUDO[n.kind] ?? n.kind
    const owner = /^(.+)__(start|end)$/.exec(id)?.[1]
    const group = owner && owner !== "root" ? scene.groups.find((g) => g.id === owner)?.label : undefined
    return group ? `${group} ${word.toLowerCase()}` : word
  }
  return scene.groups.find((g) => g.id === id)?.label || id
}

export function titleParts(step: StoryStep, scene: Scene): NonNullable<import("./types.ts").TimelineStep["parts"]> {
  const name = (id: string) => humanName(scene, id)
  const edgeOf = (ref: string) => {
    const r = resolveEdge(scene, ref)
    return r.id ? scene.edges.find((x) => x.id === r.id) : undefined
  }
  const paths: string[] = []
  for (const p of asList(step.pulse as PulseRef | PulseRef[])) {
    const refs = typeof p === "string" ? [p] : (p.route ?? (p.edge ? [p.edge] : []))
    const es = refs.map(edgeOf).filter((e): e is NonNullable<typeof e> => !!e)
    if (!es.length) continue
    if (scene.type === "sequence") {
      const l = es.map((e) => e.label?.text.replace(/^\d+\.\s*/, "") || `${name(e.from)} → ${name(e.to)}`).join(" · ")
      paths.push(l)
      continue
    }
    const fwd = [name(es[0].from), ...es.map((e) => name(e.to))]
    const hops = typeof p === "object" && p.reverse ? fwd.reverse() : fwd
    paths.push(hops.filter((h, i) => h !== hops[i - 1]).join(" → "))
  }
  const reveals = asList(step.reveal)
    .filter((id) => !["note", "initial", "final", "choice", "fork", "join"].includes(scene.nodes.find((n) => n.id === id)?.kind ?? ""))
    .map(name)
  const counters = asList(step.counter).map((c) => {
    const n = scene.nodes.find((x) => x.counter?.id === c.id)
    const node = n ? n.label.join(" ") : c.id
    const lab = n?.counter?.label
    const what = lab && lab.toLowerCase() !== node.toLowerCase() ? `${node} ${lab}` : node
    return `${what.charAt(0).toUpperCase()}${what.slice(1)} count → ${c.to.toLocaleString("en-US")}`
  })
  return { paths, reveals, counters }
}

/** Join the parts of one or more merged steps into a short title, without repeating names. */
export function composeTitle(list: NonNullable<import("./types.ts").TimelineStep["parts"]>[], max = 48, empty = "Start"): string {
  // Parallel single hops from one source read as "A → B, C".
  const raw = [...new Set(list.flatMap((p) => p.paths))]
  const bySource = new Map<string, string[]>()
  const paths: string[] = []
  const single = raw.map((p) => p.split(" → ")).filter((h) => h.length === 2)
  if (raw.length > 1 && single.length === raw.length && new Set(single.map((h) => h[1])).size === 1) {
    // Fan-in: "A, B → C".
    paths.push(`${[...new Set(single.map((h) => h[0]))].join(", ")} → ${single[0][1]}`)
    raw.length = 0
  }
  for (const p of raw) {
    const hops = p.split(" → ")
    if (hops.length === 2) {
      const l = bySource.get(hops[0])
      if (l) l.push(hops[1])
      else {
        const nl = [hops[1]]
        bySource.set(hops[0], nl)
        paths.push(`\u0000${hops[0]}`)
      }
    } else paths.push(p)
  }
  for (let i = 0; i < paths.length; i++)
    if (paths[i].startsWith("\u0000")) {
      const src = paths[i].slice(1)
      paths[i] = `${src} → ${bySource.get(src)!.join(", ")}`
    }
  const inPaths = new Set(paths.flatMap((p) => p.split(/ → | · |, /)))
  const reveals = [...new Set(list.flatMap((p) => p.reveals))].filter((r) => !inPaths.has(r))
  const counters = list.flatMap((p) => p.counters)
  const acts = [...new Set(list.flatMap((p) => p.acts ?? []))]
  const bits = [paths.length ? paths.join(" + ") : "", reveals.length ? reveals.join(", ") : "", ...counters, ...acts].filter(Boolean)
  return truncate(bits.join(" · ") || empty, max)
}

/** Inverse of a pulse ease (default `inOutCubic`) on [0, 1] (bisection; monotonic). */
function invEase(y: number, ease: (x: number) => number = inOutCubic): number {
  if (y <= 0) return 0
  if (y >= 1) return 1
  let a = 0
  let b = 1
  for (let k = 0; k < 40; k++) {
    const m = (a + b) / 2
    if (ease(m) < y) a = m
    else b = m
  }
  return (a + b) / 2
}

const hintOf = (id: string, ids: string[]): string => {
  const g = closest(id, ids)
  return g ? `; did you mean "${g}"?` : ""
}

/** `story.hud` items, normalised (graph diagrams; unique ids not clashing with elements). */
function hudItems(raw: unknown, seq: boolean, err: (path: string, message: string, hint?: string) => void, scene: Scene): NonNullable<Timeline["hud"]> {
  if (!Array.isArray(raw) || !raw.length) return []
  if (seq) {
    err("story.hud", "HUD metrics need a graph diagram", "sequence diagrams: use a node counter")
    return []
  }
  const out: NonNullable<Timeline["hud"]> = []
  const taken = new Set([...scene.nodes.map((n) => n.id), ...scene.groups.map((g) => g.id), ...scene.edges.map((e) => e.id), ...(scene.annotations ?? []).map((a) => a.id)])
  raw.forEach((h, k) => {
    if (!h || typeof h !== "object" || typeof h.id !== "string" || typeof h.label !== "string") return
    if (taken.has(h.id)) return err(`story.hud[${k}].id`, `HUD id "${h.id}" is already used by an element`, "ids share one namespace: pick another id")
    if (out.some((x) => x.id === h.id)) return err(`story.hud[${k}].id`, `duplicate HUD id "${h.id}"`)
    if (h.tone !== undefined && !isTone(h.tone)) err(`story.hud[${k}].tone`, `unknown tone ${JSON.stringify(h.tone)}`, toneHint(h.tone))
    out.push({
      id: h.id,
      label: h.label,
      value: typeof h.value === "number" && Number.isFinite(h.value) ? h.value : 0,
      ...(isTone(h.tone) ? { tone: h.tone } : {}),
      ...(typeof h.prefix === "string" ? { prefix: h.prefix } : {}),
      ...(typeof h.suffix === "string" ? { suffix: h.suffix } : {}),
      at: h.at === "bottom-left" ? "bottom-left" : "top-right",
    })
  })
  return out
}

const toneHint = (x: unknown): string => {
  const g = typeof x === "string" ? closest(x, TONES) : undefined
  return g ? `did you mean "${g}"? (one of: ${TONES.join(", ")})` : `use one of: ${TONES.join(", ")}`
}

/**
 * Caption emphasis: `*phrase*` pairs become [start, end) ranges of the returned plain text;
 * `\*` is a literal asterisk; an unpaired `*` stays literal.
 */
export function parseEmphasis(src: string): { text: string; em: [number, number][] } {
  let out = ""
  const em: [number, number][] = []
  let open = -1
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === "\\" && src[i + 1] === "*") {
      out += "*"
      i++
    } else if (c === "*") {
      if (open < 0) open = out.length
      else {
        if (out.length > open) em.push([open, out.length])
        open = -1
      }
    } else out += c
  }
  if (open >= 0) out = `${out.slice(0, open)}*${out.slice(open)}`
  return { text: out, em }
}
