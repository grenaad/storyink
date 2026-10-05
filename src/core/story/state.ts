import { story as S } from "../../theme/tokens.ts"
import type { Pt, Scene } from "../scene.ts"
import { textWidth } from "../layout/measure.ts"
import { clamp01, easeOutCubic, inOutCubic, pulseEase, react, smooth, smoothstep, spring, springSettle } from "./ease.ts"
import type { Frame, GlowFrame, PulseFrame, Timeline } from "./types.ts"
import { composeTitle, contentEvents, readTime, truncate } from "./compile.ts"
import { contentFrame } from "./content-state.ts"
import { CHIP_FADE, REWIND_CHIP } from "./acts.ts"
import type { Tone } from "../../theme/tones.ts"

export interface StateOptions {
  /** Reduced motion: springs become steps, no pulses or glows. */
  reduced?: boolean
  /**
   * Stepped playback (implies `reduced`): `t` names the step in effect (see `steppedTime`) and
   * the frame is that step's settled state: its pulses have landed (wires drawn), while
   * reveals, counters and captions of later steps have not begun.
   */
  stepped?: boolean
  /**
   * Step-move rendering (→ / ←): show beat `captionBeat`'s caption whole and instantly (no word
   * typing, no fade), whatever `t` is; `null` = no caption. Undefined (the default) = the normal
   * typed captions of continuous play.
   */
  captionBeat?: number | null
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

/**
 * Pulse label timing (s) and geometry (px): fade-in after departure, fade-out after arrival,
 * offset from the wire, font size, gap kept from node boxes, and the minimum arc length of an
 * intermediate-node handoff (old hop fades out, next hop fades in).
 */
export const PULSE_LABEL = { fadeIn: 0.15, fadeOut: 0.2, above: 9, right: 9, size: 10, gap: 8, handoff: 24 } as const

/** Share of horizontal travel (1 = horizontal, 0 = vertical) of `points` over arc lengths [lo, hi]. */
function horizontality(points: Pt[], lo: number, hi: number): number {
  let dx = 0
  let dy = 0
  let acc = 0
  for (let i = 1; i < points.length; i++) {
    const q0 = points[i - 1]
    const q1 = points[i]
    const L = Math.hypot(q1.x - q0.x, q1.y - q0.y)
    const a0 = acc
    acc += L
    if (L <= 0 || acc < lo || a0 > hi) continue
    const frac = (Math.min(acc, hi) - Math.max(a0, lo)) / L
    dx += Math.abs(q1.x - q0.x) * frac
    dy += Math.abs(q1.y - q0.y) * frac
  }
  return dx + dy > 1e-6 ? dx / (dx + dy) : 1
}

/**
 * Per hop, the arc-length window [a, b] where the label's footprint clears both end boxes:
 * half the label width (+gap) on a horizontal run, a text line (+gap) on a vertical one, judged
 * by the wire's direction over its first / last 40 px. A hop too short for that pins the label at
 * its midpoint (it may then touch a box: unavoidable without leaving the wire). Without
 * `points` the route is taken as horizontal (compile-time estimates).
 */
export function pulseLabelWindows(label: string, length: number, spans: { s0: number; s1: number }[], points?: Pt[]): { a: number; b: number }[] {
  const w = textWidth(label, PULSE_LABEL.size)
  const clear = (h: number) => PULSE_LABEL.gap + (w / 2) * h + (PULSE_LABEL.size + 2) * (1 - h)
  const hops = spans.length ? spans : [{ s0: 0, s1: length }]
  return hops.map((sp) => {
    const a = sp.s0 + clear(points ? horizontality(points, sp.s0, Math.min(sp.s1, sp.s0 + 40)) : 1)
    const b = sp.s1 - clear(points ? horizontality(points, Math.max(sp.s0, sp.s1 - 40), sp.s1) : 1)
    if (a <= b) return { a, b }
    const m = (sp.s0 + sp.s1) / 2
    return { a: m, b: m }
  })
}

/**
 * Where the label sits for a dot at arc length `s`: the dot clamped into the current hop's
 * window (held at the source side until the dot catches up, then following it, then held at
 * the destination side while the dot arrives). Between hops (the dot crossing a node, or the
 * first `handoff` px past it) the label fades out at the old hop's end and back in on the new
 * hop, never drawn across the node. `o` is that handoff opacity; `follow` = moving with the dot.
 */
export function pulseLabelAnchor(windows: { a: number; b: number }[], spans: { s0: number; s1: number }[], s: number): { s: number; o: number; follow: boolean } {
  const at = (k: number) => {
    const { a, b } = windows[k]
    return { s: Math.min(b, Math.max(a, s)), o: 1, follow: s > a && s < b }
  }
  for (let k = 1; k < windows.length; k++) {
    const h0 = spans[k - 1].s1
    const h1 = Math.max(spans[k].s0, h0 + PULSE_LABEL.handoff)
    if (s < h0) return at(k - 1)
    if (s < h1) {
      const u = (s - h0) / (h1 - h0)
      return u < 0.5 ? { ...at(k - 1), o: 1 - smoothstep(u * 2), follow: false } : { ...at(k), o: smoothstep(u * 2 - 1), follow: false }
    }
  }
  return at(windows.length - 1)
}

/**
 * The payload label of a pulse from departure until just after arrival: horizontal text above a
 * horizontal wire and right of a vertical one (blended through corners by the local direction),
 * placed by `pulseLabelAnchor`. Fades in over `fadeIn` from departure, stays fully visible through
 * the dot's contact with the destination box, then fades out over `fadeOut` after arrival (with
 * `land: "edge"` that fade is the handoff to the edge label). `x` is the left edge, `y` the baseline.
 */
export function pulseLabel(p: Timeline["pulses"][number], t: number): PulseFrame["label"] | undefined {
  if (!p.label || t < p.tf0 || t >= p.tf1 + PULSE_LABEL.fadeOut) return undefined
  const fin = clamp01((t - p.tf0) / PULSE_LABEL.fadeIn)
  const fout = t <= p.tf1 ? 1 : 1 - clamp01((t - p.tf1) / PULSE_LABEL.fadeOut)
  const s = t >= p.tf1 ? p.length : pulseEase(p, (t - p.tf0) / (p.tf1 - p.tf0)) * p.length
  const anc = pulseLabelAnchor(pulseLabelWindows(p.label, p.length, p.spans, p.points), p.spans, s)
  const o = r2(smoothstep(fin) * smoothstep(fout) * anc.o)
  if (o <= 0.005) return undefined
  const at = pointAt(p.points, anc.s)
  // Orientation over a ±40 px window (integrated, so the label glides around corners).
  const h = horizontality(p.points, anc.s - 40, anc.s + 40)
  const w = textWidth(p.label, PULSE_LABEL.size)
  const cap = PULSE_LABEL.size * 0.36
  const xH = at.x - w / 2
  const yH = at.y - PULSE_LABEL.above
  const xV = at.x + PULSE_LABEL.right
  const yV = at.y + cap
  // Through a corner the label rises first, then slides over, so it never sits on the dot.
  const hy = smoothstep(h * 2)
  const hx = smoothstep(h * 2 - 1)
  return { text: p.label, x: r2(xV + (xH - xV) * hx), y: r2(yV + (yH - yV) * hy), o }
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
  if (tl.acts?.length) return actState(scene, tl, t, opts)
  return baseState(scene, tl, t, opts)
}

const segCache = new WeakMap<Timeline, Timeline[]>()

/** The timeline as act k sees it: the persistent channels of its segment (`acts[j].state`, nearest j ≤ k). */
export function actTimeline(tl: Timeline, k: number): Timeline {
  let list = segCache.get(tl)
  if (!list) {
    list = []
    let cur = tl
    for (const a of tl.acts ?? []) {
      if (a.state) cur = { ...tl, ...a.state }
      list.push(cur)
    }
    segCache.set(tl, list)
  }
  return list[Math.max(0, Math.min(k, list.length - 1))] ?? tl
}

/**
 * The settled end of an act (`#act=`, `--act`, `#sheet=acts`): its last beat's tile time (settled,
 * caption on) before the next act's transition; the last act = the story's end. Undefined for an
 * unknown act.
 */
export function actEndTime(tl: Timeline, id: string): number | undefined {
  const acts = tl.acts ?? []
  const k = acts.findIndex((a) => a.id === id)
  if (k < 0) return undefined
  if (k === acts.length - 1) return tl.duration
  const next = acts[k + 1].t0
  const tiles = beatTimes(tl, Infinity).filter((b) => b.t < next - 1e-6 && b.t >= acts[k].t0 - 1e-6)
  return tiles.length ? tiles[tiles.length - 1].t : Math.max(acts[k].t0, next - 0.001)
}

/** Index of the act in effect at `t` (its transition included). */
export function actIndexAt(tl: Timeline, t: number): number {
  const acts = tl.acts ?? []
  let k = 0
  for (let j = 1; j < acts.length; j++) if (acts[j].t0 <= t + 1e-9) k = j
  return k
}

/**
 * Act stories: inside a rewind window the frame is the previous act at an earlier time (played
 * backwards, eased; no captions); inside a cut, its end then its start under a dip; elsewhere
 * the act's own segment. Plus the act chip.
 */
function actState(scene: Scene, tl: Timeline, t: number, opts: StateOptions): Frame {
  const acts = tl.acts!
  const k = actIndexAt(tl, t)
  const a = acts[k]
  const reduced = opts.reduced === true || opts.stepped === true
  const win = a.rewind ?? a.cut
  let frame: Frame
  let rewind: number | undefined
  let dip: number | undefined
  if (win && t < win.t1 - 1e-9 && !opts.stepped) {
    const u = clamp01((t - win.t0) / Math.max(1e-6, win.t1 - win.t0))
    let m: number
    if (a.rewind) {
      m = reduced ? win.from0 : win.from1 - inOutCubic(u) * (win.from1 - win.from0)
      rewind = r2(u)
    } else {
      m = u < 0.5 && !reduced ? win.from1 : win.from0
      dip = reduced ? 1 : r2(Math.abs(1 - 2 * u))
    }
    frame = baseState(scene, actTimeline(tl, k - 1), m, { ...opts, captionBeat: undefined })
    frame.t = t
    frame.captions = []
    frame.settled = false
  } else frame = baseState(scene, actTimeline(tl, k), t, opts)
  frame.act = { k, id: a.id, chip: actChip(tl, t, reduced), ...(rewind !== undefined ? { rewind } : {}), ...(dip !== undefined && dip < 1 ? { dip } : {}) }
  return frame
}

/** Chip layers at `t`: "● label" per act, "◀◀ rewind" during rewinds, crossfading. */
export function actChip(tl: Timeline, t: number, reduced = false): NonNullable<Frame["act"]>["chip"] {
  type C = { text: string; tone?: Tone; rewind?: boolean }
  const seq: { t: number; c: C }[] = []
  for (const [j, a] of (tl.acts ?? []).entries()) {
    const c: C = { text: a.label, ...(a.tone ? { tone: a.tone } : {}) }
    if (j === 0) seq.push({ t: -Infinity, c })
    else if (a.rewind) {
      seq.push({ t: a.rewind.t0, c: { text: REWIND_CHIP, rewind: true } })
      seq.push({ t: a.rewind.t1, c })
    } else if (a.cut) seq.push({ t: (a.cut.t0 + a.cut.t1) / 2, c })
    else seq.push({ t: a.t0, c })
  }
  let j = 0
  for (let x = 1; x < seq.length; x++) if (seq[x].t <= t + 1e-9) j = x
  const cur = seq[j]
  const f = reduced || j === 0 ? 1 : smoothstep((t - cur.t) / CHIP_FADE)
  const out: NonNullable<Frame["act"]>["chip"] = []
  if (f < 1 && j > 0) out.push({ ...seq[j - 1].c, o: r2(1 - f) })
  out.push({ ...cur.c, o: r2(f) })
  return out.filter((x) => x.o > 0.005 || x === out[out.length - 1])
}

function baseState(scene: Scene, tl: Timeline, t: number, opts: StateOptions = {}): Frame {
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
      const u = pulseEase(p, (t - p.tf0) / (p.tf1 - p.tf0))
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
      } else if (t < p.tf1 - 1e-6) {
        // (Within 1 µs of arrival counts as landed: step times are rounded to the ms.)
        const s = pulseEase(p, (t - p.tf0) / (p.tf1 - p.tf0)) * p.length
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
      if (p.tone) pf.tone = p.tone
      if (p.label) {
        const L = pulseLabel(p, t)
        if (L) pf.label = L
      }
      if (pf.o > 0 || pf.ring || pf.trail.length || pf.label) frame.pulses.push(pf)
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
      const gf: GlowFrame = { id: `${g.node}@${g.t}`, node: g.node, cx: r2(g.cx), cy: r2(g.cy), r: r2(Sz * (0.12 + 0.6 * easeOutCubic(u))), a: r2(S.glow.alpha * amp), ...(g.tone ? { tone: g.tone } : {}) }
      frame.glows.push(gf)
    }
  }

  // Counters: exact values from the clock.
  for (const [id, c] of Object.entries(tl.counters)) frame.counters[id] = formatCounter(counterValue(c, t, reduced), c.decimals, c.prefix, c.suffix)

  // 0.4 content: typing, versions, line bars, dim / visibility, wire cycles.
  contentFrame(scene, tl, t, tc, reduced, frame)

  // Captions belong to their step: words stagger in, the line fades after its step settles.
  // When the next caption takes over directly, the old line lingers dimmed to 0.52 (not current).
  const cur = tl.captions.findIndex((c) => t >= c.t0 && t < c.t1)
  if (cur >= 0) {
    const c = tl.captions[cur]
    const words = c.text.split(/\s+/)
    // The words finish typing within their step (so a step move / stepped stop shows the whole line).
    const span = (tl.steps[c.step]?.t1 ?? c.t1) - c.t0
    const W = Math.min(2.8, Math.max(0.12, Math.min(c.t1 - c.t0, 1.2, span) - 0.08))
    const f = Math.min(S.springs.word, W / 2)
    const stagger = words.length > 1 ? (W - 1.5 * f) / (words.length - 1) : 0
    const fadeOut = c.handoff ? 1 : reduced ? 1 : 1 - smoothstep((t - (c.t1 - 0.3)) / 0.3)
    const prev = cur > 0 ? tl.captions[cur - 1] : undefined
    if (prev && prev.handoff && prev.t1 === c.t0) {
      const dim = 1 - (1 - S.dimSuperseded) * (reduced ? 1 : react(t - c.t0))
      const gone = reduced ? 0 : 1 - smoothstep((t - c.t0 - 0.9) / 0.4)
      const o = r2(dim * gone)
      if (o > 0.01) frame.captions.push({ i: cur - 1, text: prev.text, o, words: prev.text.split(/\s+/).map(() => 1), current: false, ...(prev.em ? { em: prev.em } : {}), ...(prev.tone ? { tone: prev.tone } : {}) })
    }
    frame.captions.push({
      i: cur,
      text: c.text,
      o: r2(fadeOut),
      words: words.map((_, i) => r2(reduced ? 1 : spring(t - c.t0 - i * stagger, f))),
      current: true,
      ...(c.em ? { em: c.em } : {}),
      ...(c.tone ? { tone: c.tone } : {}),
    })
  }
  if (opts.captionBeat !== undefined) {
    // Step moves: the target beat's caption, whole, at once.
    const k = opts.captionBeat === null ? -1 : captionForBeat(tl, opts.captionBeat)
    const c = k >= 0 ? tl.captions[k] : undefined
    frame.captions = c ? [{ i: k, text: c.text, o: 1, words: c.text.split(/\s+/).map(() => 1), current: true, ...(c.em ? { em: c.em } : {}), ...(c.tone ? { tone: c.tone } : {}) }] : []
  }
  return frame
}

/**
 * The story's **beats**: consecutive step indices that read as one change. A step joins the next
 * when the next starts with it (same `t0`), or is chained straight on ("+0", within 50 ms of this
 * step's end) and either adds no chapter `stop` or caption of its own, or (without a `stop`)
 * reveals the box this step's pulse arrives at. So a pulse and the reveal of its
 * target are always one beat. One definition for step moves (→ / ←), stepped (reduced) playback,
 * scrubber ticks and beat tiles (tiles may merge further to fit `MAX_BEATS`).
 */
export function beatGroups(tl: Timeline): number[][] {
  const groups: number[][] = []
  let open: number[] = []
  tl.steps.forEach((s, i) => {
    open.push(i)
    const next = tl.steps[i + 1]
    const chained = !!next && next.t0 - s.t1 <= 0.05 && !next.stop
    const joins = next && (next.t0 <= s.t0 + 1e-9 || (chained && (!next.caption || revealsTarget(tl, i, i + 1))))
    if (!joins) {
      groups.push(open)
      open = []
    }
  })
  if (open.length) groups.push(open)
  return groups
}

/**
 * Whether step j reveals (at its t0) a box that step i's pulses arrive at. (Highlights aren't
 * distinguishable from the arrival glow in the timeline, which starts at the same time.)
 */
function revealsTarget(tl: Timeline, i: number, j: number): boolean {
  const t0 = tl.steps[j].t0
  const targets = tl.pulses.filter((p) => p.id.startsWith(`pulse-${i}-`) && p.target).map((p) => p.target!)
  if (!targets.length) return false
  return targets.some((id) => Math.abs((tl.appear[id] ?? -1) - t0) < 1e-6)
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
  const groups = beatGroups(tl)
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

/** Shortest stepped (reduced-motion) stop when reading holds are on (the bare-beat hold). */
export const STEPPED_MIN = 0.8

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
  // One stop per beat, at its last step's settled time, held for the beat's caption.
  for (const g of beatGroups(tl)) {
    const last = g[g.length - 1]
    // Hold for the caption on screen at the stop (the beat's last).
    const cap = g.map((i) => tl.steps[i].caption).filter((c) => c).pop()
    // The same reading hold continuous play inserts after the beat (compiled onto its last step);
    // when that is 0 (pace 0 / hold 0) a stepped stop still shows for the caption's read time.
    // Floored at the bare-beat hold: a stepped stop has no animation time to read in.
    const h = tl.steps[last].hold
    out.push({ step: last, t: stopTime(tl, last), hold: h && h > 0 ? Math.max(h, STEPPED_MIN) : cap ? readTime(cap) : STEP_BEAT })
  }
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

/**
 * Step-move boundaries: every beat's settled stop time, then the end. → / ← land on these, so a
 * move includes a pulse and the reveal, highlight, counter and caption it causes.
 */
export function beatStops(tl: Timeline): number[] {
  return steppedSchedule(tl).map((x) => x.t)
}

/** Chapter boundaries (Shift+→ / ←): the settled stop of each beat holding a `stop`, and the end. */
export function beatChapters(tl: Timeline): number[] {
  const sched = steppedSchedule(tl)
  const groups = beatGroups(tl)
  return [...groups.flatMap((g, k) => (g.some((i) => tl.steps[i].stop) ? [sched[k].t] : [])), tl.duration]
}

/** Scrubber ticks: one per beat at its first step's start, labelled with its chapter stop if any. */
export function beatTicks(tl: Timeline): { id: string; t: number; label: string; stop?: string }[] {
  return beatGroups(tl).map((g) => {
    const first = tl.steps[g[0]]
    const stop = g.map((i) => tl.steps[i].stop).find((x) => x)
    return { id: first.id, t: first.t0, label: first.label, ...(stop ? { stop } : {}) }
  })
}

/**
 * Map story time `t` on timeline `from` to the same moment on `to`, the same story compiled with
 * another reading-hold pace: the same beat, the same progress through it. Beats shift as a unit
 * between paces, so the part of a beat before its hold keeps its offset exactly; the rest (the
 * reading hold and any authored slack) maps proportionally. Before the first beat and after the
 * last one, the offset is kept.
 */
export function mapStoryTime(from: Timeline, to: Timeline, t: number): number {
  const gf = beatGroups(from)
  const gt = beatGroups(to)
  if (gf.length !== gt.length || !gf.length) return Math.min(t, to.duration)
  const start = (tl: Timeline, g: number[][], k: number) => (k < g.length ? tl.steps[g[k][0]].t0 : tl.duration)
  if (t >= from.duration - 1e-9) return to.duration
  if (t < start(from, gf, 0)) return Math.min(t, start(to, gt, 0))
  let k = 0
  while (k + 1 < gf.length && start(from, gf, k + 1) <= t + 1e-9) k++
  const a0 = start(from, gf, k)
  const b0 = start(to, gt, k)
  const G0 = start(from, gf, k + 1) - a0
  const G1 = start(to, gt, k + 1) - b0
  const hold = (tl: Timeline, g: number[][]) => (k + 1 < g.length ? (tl.steps[g[k][g[k].length - 1]].hold ?? 0) : 0)
  // The shared, un-held part of the beat keeps its offset.
  const A = Math.max(0, Math.min(G0 - hold(from, gf), G1 - hold(to, gt)))
  const off = t - a0
  if (off <= A || G0 - A <= 1e-9) return Math.min(b0 + off, b0 + G1)
  return b0 + A + ((off - A) / (G0 - A)) * (G1 - A)
}

const REACT_END = springSettle(S.springs.react)

/**
 * Where each beat's graph motion starts: its first step, or earlier when a sequence frame rises
 * ahead of its first message (the compiler's only pre-roll). Last entry: the story's end.
 */
export function beatMotionStarts(tl: Timeline): number[] {
  const g = beatGroups(tl)
  const out = g.map((grp) => {
    const t0 = tl.steps[grp[0]].t0
    const pre = Object.entries(tl.appear)
      .filter(([id, at]) => id.startsWith("frame-") && at < t0 - 1e-6 && at > t0 - 1)
      .map(([, at]) => at)
    return pre.length ? Math.min(t0, ...pre) : t0
  })
  out.push(tl.duration)
  return out
}

/**
 * **Move stops** (→ / ← in full motion): the end of each beat's *graph* motion. Its pulses have
 * arrived, its reveals and wire draw-ons (implicit ones too) and counter rolls have reached
 * their end state. Not its caption typing or reading time, glows, flashes, cooling trails or
 * arrival rings: a stop may show those still fading. Always at or after the beat's start.
 */
export function beatMotionEnds(tl: Timeline): number[] {
  const g = beatGroups(tl)
  const starts = beatMotionStarts(tl)
  return g.map((grp, k) => {
    // Step times are rounded to the ms, event times aren't: 2 ms of slack at the window edges.
    const a = tl.steps[grp[0]].t0 - 2e-3
    // Up to the next beat's motion start (a sequence frame's pre-roll belongs to that beat).
    const b = k + 1 < g.length ? starts[k + 1] - 2e-3 : Infinity
    const inBeat = (t: number) => t >= a && t < b
    const ev = [
      starts[k],
      ...tl.pulses.filter((p) => grp.some((i) => p.id.startsWith(`pulse-${i}-`))).map((p) => p.tf1),
      ...Object.values(tl.appear).filter(inBeat).map((t) => t + REACT_END),
      ...Object.values(tl.draw).filter((d) => inBeat(d.t0)).map((d) => d.t1),
      ...Object.values(tl.counters).flatMap((c) => c.events.filter((e) => inBeat(e.t)).map((e) => e.t + REACT_END)),
      ...contentEvents(tl).filter(([t0]) => inBeat(t0)).map(([, e]) => e),
    ]
    // Rounded up, so a stop is never a hair before an arrival.
    return Math.ceil(Math.max(...ev) * 1e4 - 1e-9) / 1e4
  })
}

/** Move-stop chapters (Shift+→ / ←): the motion end of each beat holding a `stop`, and the end. */
export function beatMotionChapters(tl: Timeline): number[] {
  const ends = beatMotionEnds(tl)
  return [...beatGroups(tl).flatMap((g, k) => (g.some((i) => tl.steps[i].stop) ? [ends[k]] : [])), tl.duration]
}

/** Index of the beat in effect at `t` (the last one started, by `beatMotionStarts`; -1 before). */
export function beatIndexAt(tl: Timeline, t: number): number {
  const s = beatMotionStarts(tl)
  let k = -1
  for (let i = 0; i + 1 < s.length; i++) if (s[i] <= t + 1e-9) k = i
  return k
}

/**
 * The caption a beat shows (index into `timeline.captions`): its own last caption, else the one
 * still on screen when it starts (an earlier beat's line carrying over); -1 for none.
 */
export function captionForBeat(tl: Timeline, k: number): number {
  const g = beatGroups(tl)[k]
  if (!g) return -1
  for (let j = tl.captions.length - 1; j >= 0; j--) if (g.includes(tl.captions[j].step)) return j
  const t0 = tl.steps[g[0]].t0
  for (let j = tl.captions.length - 1; j >= 0; j--) if (tl.captions[j].t0 <= t0 + 1e-9 && tl.captions[j].t1 > t0 + 1e-9) return j
  return -1
}

/**
 * Dead time a step move skips: after beat k's graph motion ends and before beat k+1's starts
 * (the reading hold and any authored gap). Forward from inside such a gap, heading past it:
 * the next beat's start. Backward: the earlier beat's motion end. Otherwise `t`.
 */
export function skipGap(ends: number[], starts: number[], t: number, dir: 1 | -1, target: number): number {
  for (let k = 0; k < ends.length; k++) {
    const e = ends[k]
    const n = starts[k + 1]
    if (n === undefined || n <= e + 1e-6) continue
    if (dir > 0 && t >= e - 1e-6 && t < n - 1e-6 && target >= n - 1e-6) return n
    if (dir < 0 && t <= n + 1e-6 && t > e + 1e-6 && target <= e + 1e-6) return e
  }
  return t
}
