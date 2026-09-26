import { story as S } from "../../theme/tokens.ts"
import type { Pt, Scene } from "../scene.ts"
import { clamp01, easeOutCubic, inOutCubic, react, smooth, smoothstep, spring } from "./ease.ts"
import type { Frame, GlowFrame, PulseFrame, Timeline } from "./types.ts"
import { composeTitle, readTime, truncate } from "./compile.ts"

export interface StateOptions {
  /** Reduced motion: springs become steps, no pulses or glows. */
  reduced?: boolean
  /**
   * Stepped playback (implies `reduced`): `t` names the step in effect (see `steppedTime`) and
   * the frame is that step's settled state: its pulses have landed (wires drawn), while
   * reveals, counters and captions of later steps have not begun.
   */
  stepped?: boolean
}

const r2 = (n: number) => Math.round(n * 100) / 100

/** Point at arc length `s` along a polyline, plus the sub-polyline between two arc lengths. */
function pointAt(points: Pt[], s: number): Pt {
  let acc = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const L = Math.hypot(b.x - a.x, b.y - a.y)
    if (acc + L >= s || i === points.length - 1) {
      const u = L ? clamp01((s - acc) / L) : 0
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }
    }
    acc += L
  }
  return points[points.length - 1] ?? { x: 0, y: 0 }
}

function subPath(points: Pt[], s0: number, s1: number): string {
  if (s1 <= s0) return ""
  const out: Pt[] = [pointAt(points, s0)]
  let acc = 0
  for (let i = 1; i < points.length; i++) {
    const L = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
    acc += L
    if (acc > s0 && acc < s1) out.push(points[i])
  }
  out.push(pointAt(points, s1))
  return out.map((p, i) => `${i ? "L" : "M"}${r2(p.x)} ${r2(p.y)}`).join("")
}

/** The resting frame: everything shown, nothing moving. Equals the static diagram. */
export function restFrame(t = 0): Frame {
  return { t, el: {}, grow: {}, draw: {}, pulses: [], glows: [], flash: {}, counters: {}, captions: [], settled: true }
}

function formatCounter(v: number, decimals: number, prefix = "", suffix = ""): string {
  const s = v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  return `${prefix}${s}${suffix}`
}

/** Counter value at t (exact, deterministic). */
export function counterValue(c: Timeline["counters"][string], t: number, reduced = false): number {
  let v = c.start
  let prev = c.start
  for (const e of c.events) {
    const p = reduced ? (t >= e.t ? 1 : 0) : react(t - e.t)
    v += (e.to - prev) * p
    prev = e.to
  }
  return v
}

/**
 * Pure function of time: the visual state of every element at `t`.
 * Used for SSR (t = end → the static diagram), in the browser every frame,
 * for scrubbing, snapshots and beat sheets.
 */
export function storyState(scene: Scene, tl: Timeline | undefined, t: number, opts: StateOptions = {}): Frame {
  if (!tl) return restFrame(t)
  const reduced = opts.reduced === true || opts.stepped === true
  // Completion clock: in stepped mode, draws finish as of the end of the step in effect.
  let tc = t
  if (opts.stepped) {
    const k = steppedIndex(tl, t)
    if (k >= 0 && k < tl.steps.length) tc = Math.max(t, Math.min(tl.steps[k].t1, tl.duration))
  }
  const step = (dt: number) => (dt >= 0 ? 1 : 0)
  const rise = (dt: number) => (reduced ? step(dt) : react(dt))
  const frame: Frame = { t, el: {}, grow: {}, draw: {}, pulses: [], glows: [], flash: {}, counters: {}, captions: [], settled: t >= tl.lastEvent }

  // Reveals: opacity lags the rise by 75 ms (STYLE.md §5 Reveal).
  for (const [id, at] of Object.entries(tl.appear)) {
    const dt = t - at
    const o = reduced ? step(dt) : react(dt - S.reveal.opacityDelay)
    const dy = reduced ? 0 : S.reveal.rise * (1 - react(dt))
    const ro = r2(o)
    const rdy = r2(dy)
    if (ro < 1 || rdy > 0) frame.el[id] = { o: ro, dy: rdy }
  }

  // Wires draw on in their flow direction.
  const pulseById = new Map(tl.pulses.map((p) => [p.id, p]))
  for (const [id, d] of Object.entries(tl.draw)) {
    let v: number
    if (reduced) v = step(tc - d.t1)
    else if (d.mode === "flight" && d.pulse) {
      const p = pulseById.get(d.pulse)!
      const u = inOutCubic((t - p.tf0) / (p.tf1 - p.tf0))
      const s = t < p.tf0 ? 0 : u * p.length
      v = clamp01((s - (d.s0 ?? 0)) / Math.max(1e-6, (d.s1 ?? 0) - (d.s0 ?? 0)))
    } else v = smooth(t - d.t0)
    if (r2(v) < 1) frame.draw[id] = r2(v)
  }

  // Activations grow with the messages that have landed inside them.
  for (const a of scene.activations) {
    const m = /-(\d+)-(\d+)$/.exec(a.id)
    if (!m) continue
    const s0 = Number(m[1])
    const s1 = Number(m[2])
    let bottom = a.y
    let complete = true
    for (let k = s0; k <= s1; k++) {
      const e = scene.edges[k]
      if (!e) continue
      const d = frame.draw[e.id]
      if (d === undefined || d >= 0.999) bottom = Math.max(bottom, Math.max(...e.points.map((p) => p.y)) + 8)
      else {
        complete = false
        if (d > 0) bottom = Math.max(bottom, e.points[0].y + 8 * d)
      }
    }
    if (!complete) frame.grow[a.id] = r2(Math.max(0, Math.min(a.h, bottom - a.y)))
  }

  if (!reduced) {
    // Pulses: gather → flight (one ease over the whole route) → arrival ring, with a cooling trail.
    for (const p of tl.pulses) {
      const end = p.tf1 + Math.max(S.pulse.ring, S.pulse.cooling)
      if (t < p.t0 || t > end) continue
      const start = p.points[0]
      const arrive = p.points[p.points.length - 1]
      const pf: PulseFrame = { id: p.id, x: start.x, y: start.y, r: 0, o: 0, trail: [] }
      if (t < p.tf0) {
        const e = easeOutCubic((t - p.t0) / S.pulse.gather)
        pf.r = r2(S.pulse.dot * e)
        pf.o = r2(Math.pow(e, 1.5))
        pf.halo = { r: r2(S.pulse.halo - (S.pulse.halo - S.pulse.dot) * e), o: r2(0.5 * Math.sin(Math.PI * e)) }
      } else if (t < p.tf1) {
        const s = inOutCubic((t - p.tf0) / (p.tf1 - p.tf0)) * p.length
        const at = pointAt(p.points, s)
        pf.x = r2(at.x)
        pf.y = r2(at.y)
        pf.r = S.pulse.dot
        pf.o = 1
        const tail = Math.min(72, s)
        const alphas = [0.55, 0.3, 0.12]
        alphas.forEach((a, k) => {
          const s0 = s - (tail * (k + 1)) / 3
          const s1 = s - (tail * k) / 3
          const d = subPath(p.points, s0, s1)
          if (d) pf.trail.push({ d, o: a, k, s0: r2(s0), s1: r2(s1) })
        })
      } else {
        pf.x = arrive.x
        pf.y = arrive.y
        const u = (t - p.tf1) / S.pulse.ring
        if (u < 1) {
          const sm = smoothstep(u / 0.24)
          pf.ring = { x: arrive.x, y: arrive.y, r: r2(2 + 2 * sm + 9.1 * (1 - (1 - u) ** 2)), w: r2(4 - 2.5 * sm), o: r2((1 - 0.734 * sm) * (1 - u) ** 2.52) }
        }
        // Trail cools behind the arrival.
        const cool = Math.pow(1 - clamp01((t - p.tf1) / S.pulse.cooling), 1.7)
        if (cool > 0.01) {
          const tail = Math.min(72, p.length)
          ;[0.55, 0.3, 0.12].forEach((a, k) => {
            const s0 = p.length - (tail * (k + 1)) / 3
            const s1 = p.length - (tail * k) / 3
            const d = subPath(p.points, s0, s1)
            if (d) pf.trail.push({ d, o: r2(a * cool), k, s0: r2(s0), s1: r2(s1) })
          })
        }
      }
      if (pf.o > 0 || pf.ring || pf.trail.length) frame.pulses.push(pf)
    }

    // Flood glows and arrival flashes.
    for (const g of tl.glows) {
      const dt = t - g.t
      if (dt < 0) continue
      const flash = react(dt) * Math.max(0, 1 - dt / S.flash.decay)
      if (flash > 0.005) frame.flash[g.node] = Math.max(frame.flash[g.node] ?? 0, r2(flash))
      if (dt > g.dur) continue
      const box = scene.nodes.find((n) => n.id === g.node) ?? scene.groups.find((x) => x.id === g.node)
      if (!box) continue
      const u = dt / g.dur
      const Sz = Math.min(Math.max(box.w, box.h) * 1.15, Math.min(box.w, box.h) * 2.6)
      const amp = smoothstep(u / 0.06) * (1 - smoothstep((u - 0.55) / 0.45))
      if (amp < 0.005) continue
      const gf: GlowFrame = { id: `${g.node}@${g.t}`, node: g.node, cx: r2(g.cx), cy: r2(g.cy), r: r2(Sz * (0.12 + 0.6 * easeOutCubic(u))), a: r2(S.glow.alpha * amp) }
      frame.glows.push(gf)
    }
  }

  // Counters: exact values from the clock.
  for (const [id, c] of Object.entries(tl.counters)) frame.counters[id] = formatCounter(counterValue(c, t, reduced), c.decimals, c.prefix, c.suffix)

  // Captions belong to their step: words stagger in, the line fades after its step settles.
  // When the next caption takes over directly, the old line lingers dimmed to 0.52 (not current).
  const cur = tl.captions.findIndex((c) => t >= c.t0 && t < c.t1)
  if (cur >= 0) {
    const c = tl.captions[cur]
    const words = c.text.split(/\s+/)
    const W = Math.min(2.8, Math.max(0.12, Math.min(c.t1 - c.t0, 1.2) - 0.08))
    const f = Math.min(S.springs.word, W / 2)
    const stagger = words.length > 1 ? (W - 1.5 * f) / (words.length - 1) : 0
    const fadeOut = c.handoff ? 1 : reduced ? 1 : 1 - smoothstep((t - (c.t1 - 0.3)) / 0.3)
    const prev = cur > 0 ? tl.captions[cur - 1] : undefined
    if (prev && prev.handoff && prev.t1 === c.t0) {
      const dim = 1 - (1 - S.dimSuperseded) * (reduced ? 1 : react(t - c.t0))
      const gone = reduced ? 0 : 1 - smoothstep((t - c.t0 - 0.9) / 0.4)
      const o = r2(dim * gone)
      if (o > 0.01) frame.captions.push({ i: cur - 1, text: prev.text, o, words: prev.text.split(/\s+/).map(() => 1), current: false })
    }
    frame.captions.push({
      i: cur,
      text: c.text,
      o: r2(fadeOut),
      words: words.map((_, i) => r2(reduced ? 1 : spring(t - c.t0 - i * stagger, f))),
      current: true,
    })
  }
  return frame
}

/** Time of a beat tile: after the step lands, before the next one moves. */
export interface Beat {
  id: string
  label: string
  t: number
  /** Indices of the story steps this tile shows (first..last). */
  steps: [number, number]
}

/** Default cap on beat tiles (plus the final frame); minor steps are grouped to fit. */
export const MAX_BEATS = 12

/**
 * Beat tiles: one per visible change. A step chained straight into the next
 * ("+0") shares the next tile; long stories group minor steps (no stop or
 * caption) until at most `max` tiles remain. The last tile is the final frame.
 */
export function beatTimes(tl: Timeline, max = MAX_BEATS): Beat[] {
  const groups: number[][] = []
  let open: number[] = []
  tl.steps.forEach((s, i) => {
    open.push(i)
    const next = tl.steps[i + 1]
    const chained = next && next.t0 - s.t1 <= 0.05 && !next.stop && !next.caption
    if (!chained) {
      groups.push(open)
      open = []
    }
  })
  if (open.length) groups.push(open)
  const major = (g: number[]) => g.some((i) => tl.steps[i].stop || tl.steps[i].caption)
  while (groups.length > max) {
    // Merge the minor group with its closest neighbour in time.
    let best = -1
    let gap = Infinity
    for (let k = 0; k + 1 < groups.length; k++) {
      if (major(groups[k + 1]) && major(groups[k])) continue
      const d = tl.steps[groups[k + 1][0]].t0 - tl.steps[groups[k][groups[k].length - 1]].t1
      if (d < gap) {
        gap = d
        best = k
      }
    }
    if (best < 0) break
    groups.splice(best, 2, [...groups[best], ...groups[best + 1]])
  }
  const out: Beat[] = groups.map((g) => {
    const last = g[g.length - 1]
    const s = tl.steps[last]
    const next = tl.steps[last + 1]
    const settle = s.t1 + 0.6
    const t = next ? Math.max(s.t1, Math.min(settle, next.t0 - 0.02)) : Math.min(settle, tl.duration)
    const withStop = g.map((i) => tl.steps[i]).find((x) => x.stop)
    const withCaption = g.map((i) => tl.steps[i]).find((x) => x.caption)
    const label = withStop?.stop ?? (withCaption?.caption ? truncate(withCaption.caption, 40) : composeTitle(g.map((i) => tl.steps[i].parts ?? { paths: [], reveals: [], counters: [] })))
    return { id: s.id, label, t: Math.round(t * 1000) / 1000, steps: [g[0], last] }
  })
  out.push({ id: "end", label: "Final frame", t: tl.duration, steps: [tl.steps.length, tl.steps.length] })
  return out
}

/** The caption to print under a beat tile: only a current caption set by one of the tile's steps. */
export function beatCaption(tl: Timeline, frame: Frame, beat: Beat): string | undefined {
  const c = frame.captions.find((x) => x.current)
  if (!c) return undefined
  const owner = tl.captions.find((x) => x.text === c.text && frame.t >= x.t0 && frame.t < x.t1)
  return owner && owner.step >= beat.steps[0] && owner.step <= beat.steps[1] ? c.text : undefined
}

/** Minimum beat-tile width for a diagram (wide diagrams get fewer, larger tiles). */
export const beatTileMin = (w: number): number => (w > 1000 ? 660 : w > 640 ? 440 : 340)

/** Reduced-motion hold for a step without a caption (STYLE.md: a beat of ~1.2–1.8 s). */
export const STEP_BEAT = 1.5

/** One stop of stepped (reduced-motion) playback: the settled time of a step and how long it holds. */
export interface SteppedStop {
  /** Step index (-1 = before the story, `steps.length` = the final frame). */
  step: number
  /** Story time whose reduced frame is this step's settled state. */
  t: number
  /** Seconds to hold before advancing (0 for the final frame). */
  hold: number
}

/**
 * Stepped playback schedule (reduced motion, "Play steps"): each step shown
 * settled (its reveals, draws, counters and caption applied at once) for its
 * reading time, then the final frame. Pure data: the same for every run.
 */
export function steppedSchedule(tl: Timeline): SteppedStop[] {
  const out: SteppedStop[] = []
  tl.steps.forEach((s, i) => {
    const next = tl.steps[i + 1]
    // Steps that start together share one stop (the later one).
    if (next && next.t0 <= s.t0 + 1e-9) return
    out.push({ step: i, t: stopTime(tl, i), hold: s.caption ? readTime(s.caption) : STEP_BEAT })
  })
  out.push({ step: tl.steps.length, t: tl.duration, hold: 0 })
  return out
}

/**
 * The stop time of step i: its end, or just before the next step starts when that is sooner
 * (a "+0" chain), so the time always names step i. `stepped` state applies step i's
 * completions up to its end regardless.
 */
function stopTime(tl: Timeline, i: number): number {
  const s = tl.steps[i]
  const next = tl.steps[i + 1]
  const end = Math.min(s.t1, tl.duration)
  const t = next && next.t0 <= end ? next.t0 - 1e-4 : end
  return Math.max(s.t0, Math.round(t * 1e4) / 1e4)
}

/** Index into `steppedSchedule` of the step in effect at `t` (-1 before the first step starts). */
export function steppedIndex(tl: Timeline, t: number): number {
  if (t >= tl.duration - 1e-9) return tl.steps.length
  let k = -1
  for (let i = 0; i < tl.steps.length; i++) if (tl.steps[i].t0 <= t + 1e-9) k = i
  return k
}

/** Position in `steppedSchedule` of the stop in effect at `t` (-1 before the first step). */
export function steppedStop(tl: Timeline, t: number): number {
  const k = steppedIndex(tl, t)
  if (k < 0) return -1
  return steppedSchedule(tl).findIndex((x) => x.step >= k)
}

/**
 * Quantise any `t` to the settled time of the step in effect (reduced motion).
 * Before the first step: 0. At or after the end: the duration (final frame).
 */
export function steppedTime(tl: Timeline, t: number): number {
  const j = steppedStop(tl, t)
  if (j < 0) return 0
  return steppedSchedule(tl)[j].t
}

/** Animated step moves (→ / ←): backward speed (story seconds per second) and the reverse ease (s). */
export const STEP_MOVE = { back: 2, ease: 0.12, minSpeed: 0.3 } as const

/** The next boundary strictly past `from` in direction `dir` (0 and `duration` are the ends). */
export function stepBoundary(list: number[], from: number, dir: 1 | -1, duration: number): number {
  return dir > 0 ? (list.find((x) => x > from + 0.02) ?? duration) : ([...list].reverse().find((x) => x < from - 0.02) ?? 0)
}

/**
 * Target of an animated step move. A press in the direction of a running move extends it to the
 * following boundary; otherwise (no move, or the opposite direction) it heads to the boundary
 * adjacent to `now`.
 */
export function stepMoveTarget(list: number[], now: number, dir: 1 | -1, duration: number, current?: { dir: 1 | -1; target: number }): number {
  if (current && current.dir === dir) return stepBoundary(list, current.target, dir, duration)
  return stepBoundary(list, now, dir, duration)
}

/**
 * Speed of a move at a moment: forward plays at 1×; backward at `STEP_MOVE.back`× with a short
 * bounce-free ease in and out (never below `minSpeed` of full so it always arrives).
 */
export function stepMoveSpeed(dir: 1 | -1, elapsed: number, remaining: number): number {
  if (dir > 0) return 1
  const v = STEP_MOVE.back
  const e = STEP_MOVE.ease
  const k = Math.min(1, elapsed / e, remaining / (v * e))
  return v * Math.max(STEP_MOVE.minSpeed, k)
}
