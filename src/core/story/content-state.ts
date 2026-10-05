/**
 * 0.4 content steps, frame side: closed-form functions of time (seek-safe) for typing,
 * versions, line bars, dim / visibility channels and wire / unwire cycles.
 */
import { geometry as G } from "../../theme/tokens.ts"
import type { Scene } from "../scene.ts"
import { parseRef } from "../anchor.ts"
import { easeOutCubic, inOutCubic, react, smooth, smoothstep, spring } from "./ease.ts"
import { CARET_LINGER, CROSSFADE, SHIMMER_PERIOD, SPIN_PERIOD, STATUS_DRAW, TOAST_IN, TOAST_OUT, TONE_FADE } from "./content.ts"
import type { Tone } from "../../theme/tones.ts"
import type { RowStatus } from "../spec.ts"
import type { ContentLayer, Frame, StatusFrame, Timeline, TimelineTyping } from "./types.ts"

/** Shimmer gradient period (px) and peak / base-dip amplitudes. */
export const SHIMMER = { width: 140, peak: 0.85, dip: 0.4 } as const
/** Spotlight peak amplitude, glide (spring visual duration, s) and end fade (s). */
export const SPOT = { a: 0.06, glide: 0.75, fade: 0.6 } as const
/** Veil (spotlight "veil"): strength, glide spring and fade-out after the last event. */
export const VEIL = { a: 0.55, glide: 0.75, fade: 0.6 } as const

const r2 = (n: number) => Math.round(n * 100) / 100

/** Rest level of a node / row (muted → 0.42); groups and edges rest at 1. */
export function restLevel(scene: Scene, key: string): number {
  const n = scene.nodes.find((x) => x.id === key)
  if (n) return n.muted ? G.muted : 1
  const r = parseRef(key)
  if (r.anchor) {
    const row = scene.nodes.find((x) => x.id === r.node)?.rows?.find((x) => x.id === r.anchor)
    if (row) return row.muted ? G.muted : 1
  }
  return 1
}

/** Chars typed on each line of a char run at t (exact at the run boundaries). */
export function typedChars(run: TimelineTyping, t: number): number[] {
  return (run.lines ?? []).map((L) => (t < L.t0 ? 0 : t >= L.t1 ? L.n : Math.max(0, Math.min(L.n, Math.floor((L.n * (t - L.t0)) / (L.t1 - L.t0) + 1e-6)))))
}

/** Word opacities of a word run at t. */
export function typedWords(run: TimelineTyping, t: number): number[] {
  const w = run.words!
  return Array.from({ length: w.n }, (_, i) => r2(spring(t - run.t0 - w.lead - i * w.stagger, w.fade)))
}

/** Adds the content channels to `frame`. `tc` = completion clock (stepped mode), `reduced` = no motion. */
export function contentFrame(scene: Scene, tl: Timeline, t: number, tc: number, reduced: boolean, frame: Frame): void {
  const ease = (dt: number) => (reduced ? (dt >= 0 ? 1 : 0) : react(dt))

  // Level channels: L0 + Σ (toₖ − toₖ₋₁)·react(t − tₖ).
  const channel = (events: { t: number; to: number }[], L0: number) => {
    let L = L0
    let prev = L0
    for (const e of events) {
      L += (e.to - prev) * ease(t - e.t)
      prev = e.to
    }
    return L
  }
  if (tl.levels) {
    const lvl: Record<string, number> = {}
    for (const [k, ev] of Object.entries(tl.levels)) {
      const L0 = restLevel(scene, k)
      const L = r2(channel(ev, L0))
      if (Math.abs(L - L0) > 0.005) lvl[k] = L
    }
    if (Object.keys(lvl).length) frame.lvl = lvl
  }
  if (tl.vis) {
    const vis: Record<string, number> = {}
    for (const [k, ev] of Object.entries(tl.vis)) {
      const V = r2(channel(ev, 1))
      if (V < 0.995) vis[k] = Math.max(0, V)
    }
    if (Object.keys(vis).length) frame.vis = vis
  }

  // Wires: the last started event decides; before the first, hidden iff it draws.
  if (tl.wires) {
    const undraw: Record<string, number> = {}
    for (const [id, ev] of Object.entries(tl.wires)) {
      let k = -1
      for (let j = 0; j < ev.length; j++) if (ev[j].t0 <= t + 1e-9) k = j
      if (k < 0) {
        if (ev[0].on) frame.draw[id] = 0
        continue
      }
      const e = ev[k]
      const u = reduced ? (tc >= e.t1 - 1e-9 ? 1 : 0) : inOutCubic((t - e.t0) / Math.max(1e-6, e.t1 - e.t0))
      if (e.on) {
        if (r2(u) < 1) frame.draw[id] = r2(u)
        else delete frame.draw[id]
      } else if (r2(u) > 0) undraw[id] = r2(u)
    }
    if (Object.keys(undraw).length) frame.undraw = undraw
  }

  // Diff code nodes: per-hunk apply progress (linear; the renderer's phases ease it).
  if (tl.applies) {
    const diff: Record<string, number[]> = {}
    for (const [id, ev] of Object.entries(tl.applies)) {
      const n = scene.nodes.find((x) => x.id === id)
      if (!n?.diff) continue
      const us = new Array<number>(n.diff.hunks).fill(1)
      for (const e of ev) {
        const u = reduced ? (tc >= e.t1 - 1e-9 ? 1 : 0) : Math.max(0, Math.min(1, (t - e.t0) / Math.max(1e-6, e.t1 - e.t0)))
        for (const h of e.hunks) us[h] = Math.round(u * 1e4) / 1e4
      }
      if (us.some((u) => u < 1)) diff[id] = us
    }
    if (Object.keys(diff).length) frame.diff = diff
  }

  // Active-line bars: opacity and range spring between events.
  if (tl.bars) {
    const bars: Record<string, { a: number; b: number; o: number }> = {}
    for (const [id, ev] of Object.entries(tl.bars)) {
      let a = ev[0].a
      let b = ev[0].b
      let o = 0
      let pa = a
      let pb = b
      let po = 0
      for (const e of ev) {
        const p = ease(t - e.t)
        a += (e.a - pa) * p
        b += (e.b - pb) * p
        o += ((e.on ? 1 : 0) - po) * p
        pa = e.a
        pb = e.b
        po = e.on ? 1 : 0
      }
      if (o > 0.005) bars[id] = { a: r2(a), b: r2(b), o: r2(Math.min(1, o)) }
    }
    if (Object.keys(bars).length) frame.bars = bars
  }

  statusFrame(scene, tl, t, reduced, frame)

  // Persistent glows: react rise, smooth fall.
  if (tl.lit) {
    const lit: Record<string, number> = {}
    const litTone: NonNullable<Frame["litTone"]> = {}
    for (const [id, ws] of Object.entries(tl.lit)) {
      let v = 0
      const byTone: Partial<Record<Tone, number>> = {}
      for (const w of ws) {
        const up = reduced ? (t >= w.t0 ? 1 : 0) : react(t - w.t0)
        const down = w.t1 === undefined ? 0 : reduced ? (t >= w.t1 ? 1 : 0) : smooth(t - w.t1)
        if (w.tone) byTone[w.tone] = Math.max(byTone[w.tone] ?? 0, up * (1 - down))
        else v = Math.max(v, up * (1 - down))
      }
      if (v > 0.005) lit[id] = r2(v)
      const tv = Object.fromEntries(Object.entries(byTone).filter(([, x]) => x > 0.005).map(([k, x]) => [k, r2(x)]))
      if (Object.keys(tv).length) litTone[id] = tv
    }
    if (Object.keys(lit).length) frame.lit = lit
    if (Object.keys(litTone).length) frame.litTone = litTone
  }

  toneFrame(tl, t, reduced, frame)
  toastFrame(tl, t, reduced, frame)

  // Spotlight: glides between step targets; fades in with the first, out after the last event.
  if (tl.spot?.length) {
    const sp = tl.spot
    const first = sp[0]
    let x = first.x
    let y = first.y
    let r = first.r
    for (let k = 1; k < sp.length; k++) {
      const p = reduced ? (t >= sp[k].t ? 1 : 0) : spring(t - sp[k].t, SPOT.glide)
      x += (sp[k].x - sp[k - 1].x) * p
      y += (sp[k].y - sp[k - 1].y) * p
      r += (sp[k].r - sp[k - 1].r) * p
    }
    const a = SPOT.a * (reduced ? (t >= first.t ? 1 : 0) : react(t - first.t)) * (1 - smoothstep((t - tl.lastEvent) / SPOT.fade))
    if (a > 0.0005) frame.spot = { x: r2(x), y: r2(y), r: r2(r), a: Math.round(a * 1e4) / 1e4 }
  }

  // Veil (spotlight "veil"): the cutout glides between step focus boxes; gone after the last event.
  if (tl.veil?.length) {
    const v = tl.veil
    let { x, y, w, h } = v[0]
    for (let k = 1; k < v.length; k++) {
      const p = reduced ? (t >= v[k].t ? 1 : 0) : spring(t - v[k].t, VEIL.glide)
      x += (v[k].x - v[k - 1].x) * p
      y += (v[k].y - v[k - 1].y) * p
      w += (v[k].w - v[k - 1].w) * p
      h += (v[k].h - v[k - 1].h) * p
    }
    const a = (reduced ? (t >= v[0].t ? 1 : 0) : react(t - v[0].t)) * (1 - smoothstep((t - tl.lastEvent) / VEIL.fade))
    if (a > 0.0005) frame.veil = { x: r2(x), y: r2(y), w: r2(w), h: r2(h), a: Math.round(a * 1e4) / 1e4 }
  }

  // Change steps: before → after look per element (eased), legend items appearing.
  if (tl.changes) {
    const delta: Record<string, number> = {}
    for (const [id, e] of Object.entries(tl.changes)) {
      const u = reduced ? (tc >= e.t1 - 1e-9 ? 1 : 0) : inOutCubic((t - e.t0) / Math.max(1e-6, e.t1 - e.t0))
      if (u < 0.9995) delta[id] = Math.round(u * 1e4) / 1e4
    }
    if (Object.keys(delta).length) frame.delta = delta
  }
  if (tl.legendAt) {
    const legend: Record<string, number> = {}
    for (const [d, at] of Object.entries(tl.legendAt)) {
      const o = reduced ? (t >= at ? 1 : 0) : react(t - at)
      if (o < 0.9995) legend[d] = Math.round(o * 1e4) / 1e4
    }
    if (Object.keys(legend).length) frame.legend = legend
  }

  // Content versions, typing and the caret.
  const runs = new Map<string, TimelineTyping>()
  for (const r of tl.typing ?? []) if (!runs.has(`${r.target}|${r.v}`)) runs.set(`${r.target}|${r.v}`, r)
  const targets = new Set([...Object.keys(tl.versions ?? {}), ...(tl.typing ?? []).map((r) => r.target)])
  if (!targets.size) return
  const content: Record<string, ContentLayer[]> = {}
  const caret: NonNullable<Frame["caret"]> = []
  const fade = (dt: number) => (reduced ? (dt >= 0 ? 1 : 0) : smoothstep(dt / CROSSFADE))
  const layerOf = (target: string, v: number, o: number, withCaret = false): ContentLayer => {
    const run = runs.get(`${target}|${v}`)
    const L: ContentLayer = { v, o: r2(o) }
    if (!run) return L
    const clock = reduced ? (tc >= run.t0 - 1e-9 ? Infinity : -Infinity) : t
    if (run.by === "char") {
      const ch = typedChars(run, clock)
      if (ch.some((c, j) => c < run.lines![j].n)) L.chars = ch
      if (withCaret && !reduced && t >= run.t0 && t <= run.t1 + CARET_LINGER) {
        let j = ch.findIndex((c, k) => c < run.lines![k].n)
        if (j < 0) j = Math.max(0, ch.length - 1)
        const line = run.lines![j]
        if (line) caret.push({ target, line: j, col: (line.n ? line.indent : 0) + (ch[j] ?? 0) })
      }
    } else {
      const w = reduced ? Array.from({ length: run.words!.n }, () => (clock >= run.t0 ? 1 : 0)) : typedWords(run, clock)
      const tag = reduced ? (clock >= run.t0 ? 1 : 0) : r2(spring(t - run.t0, run.words!.fade))
      if (w.some((x) => x < 1) || tag < 1) {
        L.words = w
        L.tag = tag
      }
    }
    return L
  }
  for (const target of targets) {
    const ev = tl.versions?.[target] ?? []
    // States: version 0 from the start, then each event.
    let k = -1
    for (let j = 0; j < ev.length; j++) if (ev[j].t <= t + 1e-9) k = j
    const cur = k < 0 ? { t: -Infinity, v: 0 } : ev[k]
    const prev = k < 0 ? undefined : k === 0 ? { t: -Infinity, v: 0 } : ev[k - 1]
    const f = k < 0 ? 1 : fade(t - cur.t)
    const layers: ContentLayer[] = []
    if (prev && prev.v >= 0 && f < 1) layers.push(layerOf(target, prev.v, 1 - f))
    if (cur.v >= 0) {
      // A typed version starts empty (no fade-in); others crossfade in.
      const typed = runs.has(`${target}|${cur.v}`)
      layers.push(layerOf(target, cur.v, typed ? 1 : f, true))
    }
    const plain = layers.length === 1 && layers[0].v === 0 && layers[0].o === 1 && !layers[0].chars && !layers[0].words
    if (!plain) content[target] = layers.filter((l) => l.o > 0.001 || l === layers[layers.length - 1])
  }
  if (Object.keys(content).length) frame.content = content
  if (caret.length) frame.caret = caret
}

/**
 * Tone layers: per element, the opacity of each tone's layer. Superposed crossfades (each event
 * fades its tone in and the previous one out over `TONE_FADE`), so quick successive tones (a
 * stagger, a stain then a tint) blend smoothly. Omitted = the rest look. Pure function of time:
 * a reverse playback (Phase C rewinds) just evaluates earlier times.
 */
export function toneFrame(tl: Timeline, t: number, reduced: boolean, frame: Frame): void {
  if (!tl.tones) return
  const fade = (dt: number) => (reduced ? (dt >= 0 ? 1 : 0) : smoothstep(dt / TONE_FADE))
  const out: NonNullable<Frame["tone"]> = {}
  for (const [id, ev] of Object.entries(tl.tones)) {
    const L: Partial<Record<Tone, number>> = {}
    let prev: Tone | null = null
    for (const e of ev) {
      if (e.t > t + 1e-9) break
      const f = fade(t - e.t)
      if (prev) L[prev] = (L[prev] ?? 0) - f
      if (e.to) L[e.to] = (L[e.to] ?? 0) + f
      prev = e.to
    }
    const kept = Object.entries(L).filter(([, x]) => x! > 0.005).map(([k, x]) => [k, r2(Math.min(1, x!))])
    if (kept.length) out[id] = Object.fromEntries(kept)
  }
  if (Object.keys(out).length) frame.tone = out
}

/** Toast appear: fade + 4 px rise + scale 0.96 → 1 over `TOAST_IN`; dismiss / expiry: fade over `TOAST_OUT`. */
export function toastFrame(tl: Timeline, t: number, reduced: boolean, frame: Frame): void {
  if (!tl.toasts) return
  const out: NonNullable<Frame["toasts"]> = {}
  for (const [id, w] of Object.entries(tl.toasts)) {
    if (t < w.t0 - 1e-9) continue
    const u = reduced ? 1 : easeOutCubic(Math.min(1, (t - w.t0) / TOAST_IN))
    const fin = reduced ? 1 : smoothstep((t - w.t0) / TOAST_IN)
    const fout = w.t1 === undefined || t < w.t1 - 1e-9 ? 1 : reduced ? 0 : 1 - smoothstep((t - w.t1) / TOAST_OUT)
    const o = r2(fin * fout)
    if (o <= 0.005) continue
    out[id] = { o, dy: r2(4 * (1 - u)), s: Math.round((0.96 + 0.04 * u) * 1e4) / 1e4 }
  }
  if (Object.keys(out).length) frame.toasts = out
}

/** Is a row visible in this frame (its own reveal / visibility and its node's)? */
function rowShown(frame: Frame, node: string, key: string): boolean {
  const o = (id: string) => (frame.el[id]?.o ?? 1) * (frame.vis?.[id] ?? 1)
  return o(key) > 0.001 && o(node) > 0.001
}

/**
 * Row status glyphs: crossfade between statuses, spinner rotation and shimmer over running
 * rows (from t = 0 for rest-running rows), check / cross draw-on. Rows that are not visible get
 * nothing (no ambient work). Emitted when different from the rest glyph or animating.
 */
export function statusFrame(scene: Scene, tl: Timeline, t: number, reduced: boolean, frame: Frame): void {
  const out: Record<string, StatusFrame> = {}
  const ease = (dt: number) => (reduced ? (dt >= 0 ? 1 : 0) : react(dt))
  // Panel rows, and plain graph nodes given a status by the story (key = node id).
  const slots: { n: Scene["nodes"][number]; key: string; rest: RowStatus }[] = []
  for (const n of scene.nodes) {
    for (const row of n.rows ?? []) slots.push({ n, key: `${n.id}#${row.id}`, rest: row.status ?? "none" })
    if (n.glyph) slots.push({ n, key: n.id, rest: "none" })
  }
  for (const { n, key, rest } of slots) {
    {
      const ev = tl.status?.[key] ?? []
      if (rest === "none" && !ev.length) continue
      if (!rowShown(frame, n.id, key)) continue
      // States: rest from t = 0, then each event.
      const states = [{ t: 0, to: rest }, ...ev]
      let k = 0
      for (let j = 1; j < states.length; j++) if (states[j].t <= t + 1e-9) k = j
      const cur = states[k]
      const prev = k > 0 ? states[k - 1] : undefined
      const fin = k > 0 ? ease(t - cur.t) : 1
      const runStart = (s: { t: number }) => s.t
      const sf: StatusFrame = { s: cur.to, o: r2(fin) }
      if (cur.to === "running" && !reduced) sf.spin = Math.round(((360 * (t - runStart(cur))) / SPIN_PERIOD) % 360)
      if ((cur.to === "done" || cur.to === "error") && k > 0 && !reduced) {
        const d = easeOutCubic((t - cur.t) / STATUS_DRAW)
        if (d < 1) sf.draw = r2(d)
      }
      if (prev && prev.to !== "none" && fin < 1) {
        sf.prev = { s: prev.to, o: r2(1 - fin) }
        if (prev.to === "running" && !reduced) sf.prev.spin = Math.round(((360 * (t - prev.t)) / SPIN_PERIOD) % 360)
      }
      // Shimmer (rows): the most recent running interval, fading in after it starts and out after it ends.
      if (!reduced && key !== n.id) {
        let a = 0
        let x = 0
        for (let j = 0; j < states.length; j++) {
          if (states[j].to !== "running" || states[j].t > t + 1e-9) continue
          const s0 = states[j].t
          const s1 = states[j + 1]?.t
          const v = spring(t - s0 - 0.1, 0.6) * (s1 === undefined || s1 > t ? 1 : 1 - spring(t - s1, 0.4))
          if (v > a) {
            a = v
            x = (SHIMMER.width * (t - s0)) / SHIMMER_PERIOD
          }
        }
        if (a > 0.005) sf.shimmer = { a: r2(a), x: r2(x % SHIMMER.width) }
      }
      const animating = sf.spin !== undefined || sf.draw !== undefined || sf.prev || sf.shimmer || sf.o < 1
      if (cur.to !== rest || animating) out[key] = sf
    }
  }
  if (Object.keys(out).length) frame.status = out
}
