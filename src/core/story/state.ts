import { story as S } from "../../theme/tokens.ts"
import type { Pt, Scene } from "../scene.ts"
import { clamp01, easeOutCubic, inOutCubic, react, smooth, smoothstep, spring } from "./ease.ts"
import type { Frame, GlowFrame, PulseFrame, Timeline } from "./types.ts"

export interface StateOptions {
  /** Reduced motion: springs become steps, no pulses or glows. */
  reduced?: boolean
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
  const reduced = opts.reduced === true
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
    if (reduced) v = step(t - d.t1)
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
          const d = subPath(p.points, s - (tail * (k + 1)) / 3, s - (tail * k) / 3)
          if (d) pf.trail.push({ d, o: a })
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
            const d = subPath(p.points, p.length - (tail * (k + 1)) / 3, p.length - (tail * k) / 3)
            if (d) pf.trail.push({ d, o: r2(a * cool) })
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

  // Captions: current line with staggered words; the superseded line dims to 0.52.
  const cur = tl.captions.findIndex((c) => t >= c.t0 && t < c.t1)
  if (cur >= 0) {
    const c = tl.captions[cur]
    const words = c.text.split(/\s+/)
    const W = Math.min(2.8, Math.max(0.12, Math.min(c.t1 - c.t0, 1.2) - 0.08))
    const f = Math.min(S.springs.word, W / 2)
    const stagger = words.length > 1 ? (W - 1.5 * f) / (words.length - 1) : 0
    const fadeOut = 1 - smoothstep((t - (c.t1 - 0.3)) / 0.3)
    const lastCaption = cur === tl.captions.length - 1
    frame.captions.push({
      text: c.text,
      o: r2(lastCaption ? fadeOut : 1),
      words: words.map((_, i) => r2(reduced ? 1 : spring(t - c.t0 - i * stagger, f))),
    })
    if (cur > 0 && !lastCaption) void 0
    const prev = cur > 0 ? tl.captions[cur - 1] : undefined
    if (prev) {
      const dim = 1 - (1 - S.dimSuperseded) * (reduced ? 1 : react(t - c.t0))
      const gone = 1 - smoothstep((t - c.t0 - 1.2) / 0.4)
      const o = r2(dim * gone * (lastCaption ? fadeOut : 1))
      if (o > 0.01) frame.captions.unshift({ text: prev.text, o, words: prev.text.split(/\s+/).map(() => 1) })
    }
  }
  return frame
}

/** Time of a beat tile: after the step lands, before the next one moves. */
export function beatTimes(tl: Timeline): { id: string; label: string; t: number }[] {
  // A step chained straight into the next ("+0") is shown by the next tile.
  const kept = tl.steps.filter((s, i) => {
    const next = tl.steps[i + 1]
    return !next || next.t0 - s.t1 > 0.05 || !!s.stop || !!s.caption
  })
  let pending: string[] = []
  const out: { id: string; label: string; t: number }[] = []
  tl.steps.forEach((s, i) => {
    if (!kept.includes(s)) {
      pending.push(s.label)
      return
    }
    const next = tl.steps[i + 1]
    const settle = s.t1 + 0.6
    const t = next ? Math.max(s.t1, Math.min(settle, next.t0 - 0.02)) : Math.min(settle, tl.duration)
    const label = s.stop || s.caption ? s.label : [...pending, s.label].join(" · ")
    out.push({ id: s.id, label, t })
    pending = []
  })
  out.push({ id: "end", label: "final frame", t: tl.duration })
  return out
}

/** Minimum beat-tile width for a diagram (wide diagrams get fewer, larger tiles). */
export const beatTileMin = (w: number): number => (w > 1000 ? 660 : w > 640 ? 440 : 340)
