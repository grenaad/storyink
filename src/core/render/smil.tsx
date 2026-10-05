/**
 * Animated SVG: the story compiled to SMIL, for places where no script runs
 * (a GitHub README / PR comment `<img>`, docs, chat previews).
 *
 * Architecture: nothing here models motion. The story is sampled through the
 * same pure `storyState(scene, timeline, t)` the HTML runtime uses, one track
 * per element attribute; each track is compressed (Douglas–Peucker on the
 * samples, within a per-attribute tolerance) and written as `<animate>` /
 * `<animateTransform>` with `keyTimes`/`values` over one shared cycle.
 * Base attribute values are the final frame, so a viewer without SMIL (or with
 * animation stripped) shows the complete static diagram.
 *
 * Constraints (GitHub camo / `<img>`): no script, no foreignObject, no external
 * references, no CSS custom properties, no media queries; one pinned theme per file.
 * Patterns follow PR Lens's GitHub-safe SVG renderer (MIT, see THIRD_PARTY_NOTICES.md).
 */
import { Fragment, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { COMMIT_MONO_400, COMMIT_MONO_700 } from "../../generated/font.ts"
import { ACCENTS, delta as DL, deltaPalettes, fonts, geometry as G, palettes, richPalettes, story as S, type as T, type Palette, type ThemeName } from "../../theme/tokens.ts"
import { CARET_LINGER, SHIMMER_PERIOD, SPIN_PERIOD } from "../story/content.ts"
import { SHIMMER, SPOT } from "../story/content-state.ts"
import { STATUS_PATHS } from "./icons.ts"
import type { Scene } from "../scene.ts"
import type { RowStatus, Spec } from "../spec.ts"
import { storyState } from "../story/state.ts"
import type { Frame, Timeline } from "../story/types.ts"
import { ANN } from "../layout/overlays.ts"
import { diagramCss, fontFaceCss } from "./css.ts"
import { dashedLook, Diagram } from "./Diagram.tsx"
import { diffGeom } from "../layout/diffnode.ts"
import { textWidth } from "../layout/measure.ts"
import { isChangeScene, isOverlayScene, isRichScene, isStoryTextScene, isToneScene, toScene } from "./index.tsx"
import { tonePalette, toneInk, type Tone } from "../../theme/tones.ts"

export interface AnimatedSvgOptions {
  /** Pinned theme (SVG-as-image never follows the page). Default "light". */
  theme?: ThemeName
  /** Play once and freeze on the final frame (default: loop forever). */
  once?: boolean
  /** "system" (default): system mono stack, small files; "embed": Commit Mono as data-URI @font-face (+~127 KB). */
  font?: "embed" | "system"
  /** Final-frame hold before the loop resets, counted from the last event (default 3 s). */
  hold?: number
  /** Reset (tween back to the first frame) before the loop repeats (default 0.4 s). */
  reset?: number
  /** Sampling rate of the story clock (default 60). */
  fps?: number
}

export interface AnimatedSvgInfo {
  svg: string
  bytes: number
  /** Story duration (s) and full SMIL cycle (s). */
  duration: number
  cycle: number
  /** True when the spec had no story and `story: "auto"` was used. */
  autoStory: boolean
  animations: number
}

// ---------------------------------------------------------------------------
// Tracks: sample → compress → keyTimes/values

type Vec = number[]

/**
 * Douglas–Peucker over (t, v): keep the fewest samples such that linear
 * interpolation between kept samples reproduces every sample within `tol`
 * (each component). Returns kept indices (always includes first and last).
 */
export function simplify(ts: number[], vs: Vec[], tol: number): number[] {
  const n = ts.length
  if (n <= 2) return [...Array(n).keys()]
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    let worst = -1
    let at = -1
    const span = ts[b] - ts[a]
    for (let i = a + 1; i < b; i++) {
      const u = span > 0 ? (ts[i] - ts[a]) / span : 0
      let err = 0
      for (let k = 0; k < vs[i].length; k++) err = Math.max(err, Math.abs(vs[i][k] - (vs[a][k] + (vs[b][k] - vs[a][k]) * u)))
      if (err > worst) {
        worst = err
        at = i
      }
    }
    if (worst > tol && at > 0) {
      keep[at] = 1
      stack.push([a, at], [at, b])
    }
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i)
  return out
}

/** Max linear-interpolation error of the kept samples against all samples (for tests). */
export function simplifyError(ts: number[], vs: Vec[], kept: number[]): number {
  let err = 0
  for (let j = 0; j + 1 < kept.length; j++) {
    const a = kept[j]
    const b = kept[j + 1]
    for (let i = a; i <= b; i++) {
      const u = ts[b] > ts[a] ? (ts[i] - ts[a]) / (ts[b] - ts[a]) : 0
      for (let k = 0; k < vs[i].length; k++) err = Math.max(err, Math.abs(vs[i][k] - (vs[a][k] + (vs[b][k] - vs[a][k]) * u)))
    }
  }
  return err
}

const num = (x: number): string => {
  const r = Math.round(x * 100) / 100
  return Object.is(r, -0) ? "0" : String(r)
}
const kt = (x: number): string => {
  const r = Math.round(x * 1e5) / 1e5
  return String(r)
}
const eqVec = (a: Vec, b: Vec) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-9)

interface Clock {
  ts: number[]
  frames: Frame[]
  dur: number
  hold: number
  reset: number
  cycle: number
  once: boolean
  count: { n: number }
}

const timing = (c: Clock) => (c.once ? { dur: `${num(c.cycle)}s`, begin: "0s", fill: "freeze" } : { dur: `${num(c.cycle)}s`, begin: "0s", repeatCount: "indefinite" })

/** Keyframes for a continuous track, mapped onto the cycle (story → hold → reset). */
function linearKeys(c: Clock, vs: Vec[], tol: number): { keyTimes: string; vals: Vec[] } | undefined {
  const last = vs[vs.length - 1]
  if (vs.every((v) => eqVec(v, last))) return undefined
  const kept = simplify(c.ts, vs, tol)
  const pts: [number, Vec][] = kept.map((i) => [c.ts[i], vs[i]])
  if (!c.once) {
    if (c.hold > 0) pts.push([c.dur + c.hold, last])
    pts.push([c.cycle, vs[0]])
  }
  const times: string[] = []
  const vals: Vec[] = []
  let prev = -1
  for (const [t, v] of pts) {
    let k = t / c.cycle
    if (k <= prev) continue
    if (t === pts[pts.length - 1][0]) k = 1
    times.push(kt(k))
    vals.push(v)
    prev = k
  }
  times[0] = "0"
  times[times.length - 1] = "1"
  return { keyTimes: times.join(";"), vals }
}

/** Keyframes for a discrete track (value changes only). */
function discreteKeys(c: Clock, vs: string[]): { keyTimes: string; values: string } | undefined {
  const last = vs[vs.length - 1]
  if (vs.every((v) => v === last)) return undefined
  const pts: [number, string][] = [[0, vs[0]]]
  for (let i = 1; i < vs.length; i++) if (vs[i] !== vs[i - 1]) pts.push([c.ts[i], vs[i]])
  if (!c.once && vs[0] !== last) pts.push([c.dur + c.hold + c.reset / 2, vs[0]])
  const times: string[] = []
  const values: string[] = []
  let prev = -1
  for (const [t, v] of pts) {
    const k = t / c.cycle
    if (k <= prev) {
      values[values.length - 1] = v
      continue
    }
    times.push(kt(k))
    values.push(v)
    prev = k
  }
  times[0] = "0"
  return { keyTimes: times.join(";"), values: values.join(";") }
}

function anim(c: Clock, attr: string, vs: Vec[], tol: number, fmt: (v: Vec) => string = (v) => num(v[0])): ReactElement | null {
  const k = linearKeys(c, vs, tol)
  if (!k) return null
  c.count.n++
  return <animate attributeName={attr} calcMode="linear" keyTimes={k.keyTimes} values={k.vals.map(fmt).join(";")} {...timing(c)} />
}

function translate(c: Clock, vs: Vec[], tol: number): ReactElement | null {
  const k = linearKeys(c, vs, tol)
  if (!k) return null
  c.count.n++
  return <animateTransform attributeName="transform" type="translate" calcMode="linear" keyTimes={k.keyTimes} values={k.vals.map((v) => `${num(v[0])} ${num(v[1])}`).join(";")} {...timing(c)} />
}

function discrete(c: Clock, attr: string, vs: string[]): ReactElement | null {
  const k = discreteKeys(c, vs)
  if (!k) return null
  c.count.n++
  return <animate attributeName={attr} calcMode="discrete" keyTimes={k.keyTimes} values={k.values} {...timing(c)} />
}

/**
 * Keyframes from exact (t, value) points (no sampling), mapped onto the cycle: holds the last
 * value through the end hold, then returns to the first over the reset. Equal times are nudged
 * apart by 0.1 ms so jumps stay jumps.
 */
function pointKeys(c: Clock, pts0: [number, Vec][]): { keyTimes: string; vals: Vec[] } | undefined {
  if (!pts0.length) return undefined
  const first = pts0[0][1]
  const last = pts0[pts0.length - 1][1]
  if (pts0.every(([, v]) => eqVec(v, first))) return undefined
  const pts: [number, Vec][] = [[0, first], ...pts0.filter(([t]) => t > 0 && t < c.dur), [c.dur, last]]
  if (!c.once) {
    if (c.hold > 0) pts.push([c.dur + c.hold, last])
    pts.push([c.cycle, first])
  }
  const times: string[] = []
  const vals: Vec[] = []
  let prev = -1
  for (let [t, v] of pts) {
    let k = Math.round((t / c.cycle) * 1e5) / 1e5
    if (k <= prev) k = prev + 1e-5
    if (k > 1) continue
    times.push(kt(k))
    vals.push(v)
    prev = k
  }
  times[0] = "0"
  times[times.length - 1] = "1"
  return { keyTimes: times.join(";"), vals }
}

/** Discrete keyframes from exact change times (value from t on); resets to the first value in the reset. */
function changeKeys(c: Clock, init: string, changes: [number, string][]): { keyTimes: string; values: string } | undefined {
  const pts: [number, string][] = [[0, init]]
  // Only actual changes (a caret's y repeats per character on a line).
  for (const [t, v] of changes) if (t > 0 && t <= c.dur && v !== pts[pts.length - 1][1]) pts.push([t, v])
  const last = pts[pts.length - 1][1]
  if (pts.every(([, v]) => v === init)) return undefined
  if (!c.once && last !== init) pts.push([c.dur + c.hold + c.reset / 2, init])
  const times: string[] = []
  const values: string[] = []
  let prev = -1
  for (const [t, v] of pts) {
    const k = Math.round((t / c.cycle) * 1e5) / 1e5
    if (k <= prev) {
      values[values.length - 1] = v
      continue
    }
    times.push(kt(k))
    values.push(v)
    prev = k
  }
  times[0] = "0"
  return { keyTimes: times.join(";"), values: values.join(";") }
}

function discreteAt(c: Clock, attr: string, init: string, changes: [number, string][]): ReactElement | null {
  const k = changeKeys(c, init, changes)
  if (!k) return null
  c.count.n++
  return <animate attributeName={attr} calcMode="discrete" keyTimes={k.keyTimes} values={k.values} {...timing(c)} />
}

/** Length of the longest subpath of a status glyph (for the dash draw-on). */
function glyphLength(d: string): number {
  let best = 0
  for (const sub of d.split("M").filter(Boolean)) {
    const n = sub.match(/-?[\d.]+/g)!.map(Number)
    let L = 0
    for (let i = 2; i + 1 < n.length; i += 2) L += Math.hypot(n[i] - n[i - 2], n[i + 1] - n[i - 1])
    best = Math.max(best, L)
  }
  return Math.ceil(best + 1)
}

/**
 * Tracks for 0.4 rich scenes (panels, code, chips): content layers and typing (analytic clip
 * widths and carets), bars, row / node / group / edge / port levels, wire cycles, status glyphs
 * (analytic spin, dash draw-on), shimmer (analytic sweep), persistent glows, spotlight, row flashes.
 */
function richTracks(scene: Scene, c: Clock, add: (key: string, ...els: (ReactNode | null)[]) => void, pal: Palette): void {
  const tl = scene.timeline!
  const { frames, ts } = c
  const series = <V,>(get: (f: Frame) => V) => frames.map(get)
  const O = 0.01
  const PX = 0.3
  const nodes = new Map(scene.nodes.map((n) => [n.id, n]))
  const rest = (key: string) => {
    const n = nodes.get(key)
    if (n) return n.muted ? G.muted : 1
    const [nid, rid] = key.split("#")
    const r = nodes.get(nid)?.rows?.find((x) => x.id === rid)
    return r?.muted ? G.muted : 1
  }
  const level = (f: Frame, key: string) => (f.lvl?.[key] ?? rest(key)) * (f.vis?.[key] ?? 1)
  const elo = (f: Frame, key: string) => f.el[key]?.o ?? 1

  // Nodes, groups, rows: reveal × dim × visibility.
  for (const n of scene.nodes) add(`node:${n.id}`, anim(c, "opacity", series((f) => [elo(f, n.id) * level(f, n.id)]), O))
  for (const g of scene.groups) add(`group:${g.id}`, anim(c, "opacity", series((f) => [elo(f, g.id) * level(f, g.id)]), O))
  for (const n of scene.nodes)
    for (const r of n.rows ?? []) {
      const key = `${n.id}#${r.id}`
      add(`row:${key}`, anim(c, "opacity", series((f) => [elo(f, key) * level(f, key)]), O), translate(c, series((f) => [0, f.el[key]?.dy ?? 0]), PX))
    }

  // Edges and ports: own level × endpoint node levels; wire / unwire cycles.
  const edgeLevel = (f: Frame, e: Scene["edges"][number]) => Math.min(level(f, e.from), level(f, e.to)) * (f.lvl?.[e.id] ?? 1) * (f.vis?.[e.id] ?? 1)
  for (const e of scene.edges) {
    add(`edge:${e.id}`, anim(c, "opacity", series((f) => [edgeLevel(f, e)]), O))
    for (const p of scene.ports.filter((q) => q.edge === e.id && !q.covered))
      add(
        `port:${p.id}`,
        anim(
          c,
          "opacity",
          series((f) => {
            const d = f.draw[e.id]
            const u = f.undraw?.[e.id]
            if (u !== undefined && (p.end === "out" ? u > 0 : u >= 0.99)) return [0]
            const o = d === undefined ? 1 : p.end === "out" ? (d > 0 ? 1 : 0) : d >= 0.99 ? 1 : 0
            return [o]
          }),
          O,
        ),
      )
    if (tl.wires?.[e.id] && !dashedLook(e)) {
      const L = (e.length ?? 0) + 24
      const off = anim(c, "stroke-dashoffset", series((f) => [f.undraw?.[e.id] !== undefined ? -L * f.undraw[e.id] : f.draw[e.id] !== undefined ? L * (1 - f.draw[e.id]) : 0]), 0.5)
      if (off) add(`wire:${e.id}`, <set attributeName="stroke-dasharray" to={`${num(L)} ${num(L)}`} begin="0s" />, off)
      add(`wire:${e.id}`, anim(c, "opacity", series((f) => [(f.draw[e.id] !== undefined && f.draw[e.id] <= 0) || (f.undraw?.[e.id] ?? 0) >= 1 ? 0 : 1]), O))
    }
    // Dashed wires (and removed edges) fade on / off; labels of wired edges follow the draw (as the HTML).
    if (tl.wires?.[e.id] && !tl.draw[e.id]) {
      if (dashedLook(e))
        add(
          `wire:${e.id}`,
          anim(c, "opacity", series((f) => {
            const u = f.undraw?.[e.id]
            if (u !== undefined) return [u >= 1 ? 0 : Math.max(0, 1 - u * 1.4)]
            const d = f.draw[e.id]
            return [d === undefined ? 1 : d <= 0 ? 0 : Math.min(1, d * 1.4)]
          }), O),
        )
      if (e.label) add(`elabel:${e.id}`, anim(c, "opacity", series((f) => [f.draw[e.id] === undefined ? 1 : Math.max(0, Math.min(1, (f.draw[e.id] - 0.35) / 0.4))]), O))
    }
  }

  // Content layers (versions, crossfades, clear), tags, icons, words.
  const runs = new Map((tl.typing ?? []).map((r) => [`${r.target}|${r.v}`, r]))
  const targets = new Set([...Object.keys(tl.versions ?? {}), ...(tl.typing ?? []).map((r) => r.target)])
  const dip = (f: Frame, key: string) => {
    const a = f.status?.[key]?.shimmer?.a
    return a ? 1 - SHIMMER.dip * a : 1
  }
  for (const target of targets) {
    const isRow = target.includes("#")
    const vs = new Set([0, ...(tl.versions?.[target] ?? []).map((e) => e.v).filter((v) => v >= 0), ...(tl.typing ?? []).filter((r) => r.target === target).map((r) => r.v)])
    for (const v of vs) {
      const layer = (f: Frame) => (f.content?.[target] ? f.content[target].find((l) => l.v === v) : v === 0 ? { v: 0, o: 1 } : undefined)
      add(`layer:${target}:${v}`, anim(c, "opacity", series((f) => [(layer(f)?.o ?? 0) * (isRow ? dip(f, target) : 1)]), O))
      if (isRow) {
        add(`rtag:${target}:${v}`, anim(c, "opacity", series((f) => [layer(f)?.tag ?? 1]), O))
        const run = runs.get(`${target}|${v}`)
        if (run?.by === "word") for (let i = 0; i < run.words!.n; i++) add(`word:${target}:${v}:${i}`, anim(c, "fill-opacity", series((f) => [layer(f)?.words?.[i] ?? 1]), O))
      }
    }
    if (isRow) add(`ricon:${target}`, anim(c, "opacity", series((f) => {
      const ls = f.content?.[target] ?? [{ v: 0, o: 1 }]
      return [ls.length ? Math.max(...ls.map((l) => (l.tag ?? 1) * l.o)) : 0]
    }), O))
  }

  // Char typing: exact per-character clip widths and the caret (from the run's own timing).
  const anns = new Map((scene.annotations ?? []).map((a) => [a.id, a]))
  const careted = new Set<string>()
  for (const run of tl.typing ?? []) {
    const ann = anns.get(run.target)
    if (ann) {
      annTyping(c, add, ann, run, careted)
      continue
    }
    if (run.by !== "char") continue
    const isRow = run.target.includes("#")
    const [nid, rid] = run.target.split("#")
    const n = nodes.get(isRow ? nid : run.target)!
    const row = isRow ? n.rows!.find((x) => x.id === rid)! : undefined
    const adv = (isRow ? T.row : T.code) * 0.6
    const caret: [number, string, string, string][] = []
    run.lines!.forEach((L, k) => {
      const full = isRow ? (L.n + 1) * adv : (L.indent + L.n + 1) * adv
      const w = (j: number) => (j <= 0 ? 0 : j >= L.n ? full : isRow ? j * adv : (L.indent + j) * adv)
      const ch: [number, string][] = []
      for (let j = 1; j <= L.n; j++) ch.push([L.t0 + (j * (L.t1 - L.t0)) / L.n - 1e-6, num(w(j))])
      if (!L.n) ch.push([L.t0, num(0)])
      add(`clip:${run.target}:${run.v}:${k}`, discreteAt(c, "width", "0", ch))
      // Caret: at this line from its start, one column per character.
      const cx = (col: number) => num((isRow ? row!.x : n.code!.x) + col * adv)
      const cy = isRow ? num(row!.lineY[k] - 11) : num(n.code!.top + k * n.code!.lh + (n.code!.lh - 13) / 2)
      const col0 = L.n ? L.indent : 0
      caret.push([L.t0, cx(col0), cy, "visible"])
      for (let j = 1; j <= L.n; j++) caret.push([L.t0 + (j * (L.t1 - L.t0)) / L.n - 1e-6, cx(col0 + j), cy, "visible"])
    })
    caret.push([run.t1 + CARET_LINGER, caret[caret.length - 1]?.[1] ?? "0", caret[caret.length - 1]?.[2] ?? "0", "hidden"])
    const first = caret[0]
    add(
      `caret:${run.target}`,
      discreteAt(c, "visibility", "hidden", caret.map(([t, , , v]) => [t, v])),
      discreteAt(c, "x", first[1], caret.map(([t, x]) => [t, x])),
      discreteAt(c, "y", first[2], caret.map(([t, , y]) => [t, y])),
    )
  }

  // Active-line bars.
  for (const [id, ev] of Object.entries(tl.bars ?? {})) {
    const n = nodes.get(id)!
    const cd = n.code!
    let a = ev[0].a
    let b = ev[0].b
    const ab = series((f) => {
      const x = f.bars?.[id]
      if (x) {
        a = x.a
        b = x.b
      }
      return [cd.top + (a - 1) * cd.lh, (b - a + 1) * cd.lh]
    })
    add(`bar:${id}`, anim(c, "opacity", series((f) => [f.bars?.[id]?.o ?? 0]), O))
    add(`barrect:${id}`, anim(c, "y", ab.map((v) => [v[0]]), PX), anim(c, "height", ab.map((v) => [v[1]]), PX))
  }

  // Row (and plain node) statuses: glyph opacity, analytic spin, dash draw-on; shimmer (rows).
  const slots: { key: string; rest: RowStatus }[] = []
  for (const n of scene.nodes) {
    for (const r of n.rows ?? []) slots.push({ key: `${n.id}#${r.id}`, rest: r.status ?? "none" })
    if (n.glyph) slots.push({ key: n.id, rest: "none" })
  }
  for (const { key, rest: restS } of slots) {
    {
      const ev = tl.status?.[key] ?? []
      if (restS === "none" && !ev.length) continue
      const states = [{ t: 0, to: restS }, ...ev]
      const kinds = [...new Set(states.map((x) => x.to))].filter((x) => x !== "none")
      for (const g of kinds) {
        const o = series((f) => {
          const sf = f.status?.[key]
          if (!sf) return [restS === g ? 1 : 0]
          return [(sf.s === g ? sf.o : 0) + (sf.prev?.s === g ? sf.prev.o : 0)]
        })
        const els: (ReactNode | null)[] = [anim(c, "opacity", o, O)]
        if (g === "running") {
          // rotate = 360°·(t − start)/period through each run and its fade-out.
          const pts: [number, Vec][] = []
          states.forEach((st, j) => {
            if (st.to !== "running") return
            const end = Math.min(states[j + 1] ? states[j + 1].t + 0.8 : c.dur, c.dur)
            pts.push([st.t, [0]], [end, [(360 * (end - st.t)) / SPIN_PERIOD]])
          })
          const k = pointKeys(c, pts)
          if (k) {
            c.count.n++
            els.push(<animateTransform attributeName="transform" type="rotate" additive="sum" calcMode="linear" keyTimes={k.keyTimes} values={k.vals.map((v) => num(v[0])).join(";")} {...timing(c)} />)
          }
        }
        add(`status:${key}:${g}`, ...els)
        if (g === "done" || g === "error") {
          const L = glyphLength(STATUS_PATHS[g])
          const d = anim(c, "stroke-dasharray", series((f) => {
            const sf = f.status?.[key]
            return [sf?.s === g ? (sf.draw ?? 1) * L : L]
          }), 0.2, (v) => `${num(v[0])} ${L}`)
          add(`draw:${key}:${g}`, d)
        }
      }
      if (kinds.includes("running") && key.includes("#")) {
        add(`shim:${key}`, anim(c, "opacity", series((f) => [SHIMMER.peak * (f.status?.[key]?.shimmer?.a ?? 0)]), O))
        const pts: [number, Vec][] = []
        states.forEach((st, j) => {
          if (st.to !== "running") return
          const nextRun = states.slice(j + 1).find((x) => x.to === "running")
          const end = Math.min(nextRun ? nextRun.t - 1e-3 : c.dur, states[j + 1] ? states[j + 1].t + 1.5 : c.dur, c.dur)
          pts.push([st.t, [0, 0]], [end, [(SHIMMER.width * (end - st.t)) / SHIMMER_PERIOD, 0]])
        })
        const k = pointKeys(c, pts)
        if (k) {
          c.count.n++
          add(`shimx:${key}`, <animateTransform attributeName="gradientTransform" type="translate" calcMode="linear" keyTimes={k.keyTimes} values={k.vals.map((v) => `${num(v[0])} 0`).join(";")} {...timing(c)} />)
        }
      }
    }
  }

  // Persistent glows (toned ones per tone) and the spotlight.
  for (const [id, ws] of Object.entries(tl.lit ?? {})) {
    if (ws.some((w) => !w.tone)) add(`lit:${id}`, anim(c, "opacity", series((f) => [f.lit?.[id] ?? 0]), O))
    for (const t of new Set(ws.map((w) => w.tone).filter((x): x is Tone => !!x))) add(`lit:${id}:${t}`, anim(c, "opacity", series((f) => [f.litTone?.[id]?.[t] ?? 0]), O))
  }
  // Annotations (with their node) and toasts.
  for (const a of scene.annotations ?? []) {
    add(`ann:${a.id}`, anim(c, "opacity", series((f) => [(f.el[a.id]?.o ?? 1) * (f.vis?.[a.id] ?? 1) * (f.el[a.on]?.o ?? 1) * (f.vis?.[a.on] ?? 1)]), O), translate(c, series((f) => [0, (f.el[a.id]?.dy ?? 0) + (f.el[a.on]?.dy ?? 0)]), PX))
  }
  for (const t of scene.toasts ?? []) {
    const cx = t.x + t.w / 2
    const cy = t.y + t.h / 2
    let last = { dy: 0, s: 1 }
    const st = series((f) => {
      const x = f.toasts?.[t.id]
      if (x) last = x
      return { o: (x?.o ?? 0) * (f.vis?.[t.id] ?? 1), dy: last.dy, s: last.s }
    })
    add(`toast:${t.id}`, anim(c, "opacity", st.map((x) => [x.o]), O))
    add(`toastxy:${t.id}`, translate(c, st.map((x) => [cx, cy + x.dy]), PX))
    const k = linearKeys(c, st.map((x) => [x.s]), 0.002)
    if (k) {
      c.count.n++
      add(`toastsc:${t.id}`, <animateTransform attributeName="transform" type="scale" calcMode="linear" keyTimes={k.keyTimes} values={k.vals.map((v) => num(v[0])).join(";")} {...timing(c)} />)
    }
  }
  // Tone layers: one opacity track per element and tone.
  for (const [id, ev] of Object.entries(tl.tones ?? {}))
    for (const t of new Set(ev.map((e) => e.to).filter((x): x is Tone => !!x))) add(`tone:${id}:${t}`, anim(c, "opacity", series((f) => [f.tone?.[id]?.[t] ?? 0]), O))
  if (tl.spot?.length) {
    let last = { x: tl.spot[0].x, y: tl.spot[0].y, r: tl.spot[0].r }
    const sp = series((f) => {
      if (f.spot) last = f.spot
      return [last.x, last.y, last.r]
    })
    add("spot", anim(c, "opacity", series((f) => [(f.spot?.a ?? 0) / SPOT.a]), O))
    // The spot is a soft radial glow (r ≈ 120 px, fading to 0): 1.5 px of path error is invisible
    // and keeps the glide to a handful of keys instead of one per frame.
    const SPOT_PX = 1.5
    add("spotc", anim(c, "cx", sp.map((v) => [v[0]]), SPOT_PX), anim(c, "cy", sp.map((v) => [v[1]]), SPOT_PX), anim(c, "r", sp.map((v) => [v[2]]), SPOT_PX))
  }

  // Row arrival flashes (reverse pulses): literal sRGB mix like the runtime's color-mix.
  const ink = hex(pal.ink)
  const flashC = hex(pal.flash)
  for (const g of new Set(tl.glows.map((x) => x.node).filter((x) => x.includes("#")))) {
    const col = series((f) => {
      const p = f.flash[g]
      if (!p || p <= 0.005) return ink as Vec
      const w = Math.round(p * 100) / 100
      return ink.map((x, i) => flashC[i] * w + x * (1 - w))
    })
    const k = linearKeys(c, col, 2)
    if (k) {
      c.count.n++
      add(`rflash:${g}`, <animate attributeName="fill" calcMode="linear" keyTimes={k.keyTimes} values={k.vals.map(toHex).join(";")} {...timing(c)} />)
    }
  }
  void ts
}

/**
 * An annotation's typing: char clip width + caret, or per-word fill opacity. Sampled from the
 * frames (not the run's own timing): act stories rewind and reset typing, which the frames know.
 */
function annTyping(c: Clock, add: (key: string, ...els: (ReactNode | null)[]) => void, a: NonNullable<Scene["annotations"]>[number], run: NonNullable<Timeline["typing"]>[number], careted: Set<string>): void {
  const adv = ANN.size * 0.6
  const layer = (f: Frame) => f.content?.[a.id]?.find((l) => l.v === run.v)
  if (run.by === "word") {
    for (let i = 0; i < run.words!.n; i++) add(`word:${a.id}:${run.v}:${i}`, anim(c, "fill-opacity", c.frames.map((f) => [layer(f)?.words?.[i] ?? 1]), 0.01))
    return
  }
  const n = a.versions[run.v]?.text.length ?? 0
  const width = (f: Frame) => {
    const ch = layer(f)?.chars?.[0]
    return num(ch === undefined || ch >= n ? (n + 1) * adv : ch * adv)
  }
  add(`clip:${a.id}:${run.v}:0`, discrete(c, "width", c.frames.map(width)))
  // One caret track per annotation (its first char run).
  if (careted.has(a.id)) return
  careted.add(a.id)
  const caret = (f: Frame) => f.caret?.find((x) => x.target === a.id)
  add(
    `caret:${a.id}`,
    discrete(c, "visibility", c.frames.map((f) => (caret(f) ? "visible" : "hidden"))),
    discrete(c, "x", c.frames.map((f) => num(a.x + (caret(f)?.col ?? 0) * adv))),
  )
}

/** Change steps (delta-look fades, levels, legend items) and the veil. */
function changeTracks(scene: Scene, c: Clock, add: (key: string, ...els: (ReactNode | null)[]) => void): void {
  const tl = scene.timeline!
  const O = 0.01
  const series = (get: (f: Frame) => number) => c.frames.map((f) => [get(f)] as Vec)
  const lvlOf = (d?: string, em?: string) => (d === "removed" ? DL.ghost : d === "unchanged" ? DL.context : 1) * (em === "muted" ? DL.mutedEdge : 1)
  for (const [id, ch] of Object.entries(tl.changes ?? {})) {
    const p = series((f) => f.delta?.[id] ?? 1)
    const n = scene.nodes.find((x) => x.id === id)
    const e = n ? undefined : scene.edges.find((x) => x.id === id)
    const g = n || e ? undefined : scene.groups.find((x) => x.id === id)
    if (n) {
      const after = lvlOf(n.delta)
      add(`dlvl:${id}`, anim(c, "opacity", p.map((v) => [1 + (after - 1) * v[0]]), O))
      for (const k of ["dface", "dstrike", "dbadge", "lifeafter"]) add(`${k}:${id}`, anim(c, "opacity", p, O))
    } else if (e) {
      add(`eafter:${id}`, anim(c, "opacity", p, O))
      const after = lvlOf(e.delta, e.emphasis)
      add(`llvl:${id}`, anim(c, "opacity", p.map((v) => [1 + (after - 1) * v[0]]), O))
      add(`lstrike:${id}`, anim(c, "opacity", p, O))
    } else if (g) add(`gbadge:${id}`, anim(c, "fill-opacity", p, O))
    void ch
  }
  for (const d of Object.keys(tl.legendAt ?? {})) add(`legend:${d}`, anim(c, "opacity", series((f) => f.legend?.[d] ?? 1), O))
  if (tl.veil?.length) {
    add("veil", anim(c, "opacity", series((f) => f.veil?.a ?? 0), O))
    let last = tl.veil[0]
    const box = c.frames.map((f): Vec => {
      if (f.veil) last = { ...last, ...f.veil }
      return [last.x, last.y, last.w, last.h]
    })
    add("veilr", ...(["x", "y", "width", "height"] as const).map((attr, k) => anim(c, attr, box.map((b) => [b[k]]), 0.5)))
  }
}

/** Diff code nodes (story `apply`): row slide, tint / gutter fades, added rows opening and typing. */
function diffTracks(scene: Scene, c: Clock, add: (key: string, ...els: (ReactNode | null)[]) => void): void {
  const tl = scene.timeline!
  const ADV = T.code * 0.6
  for (const n of scene.nodes) {
    const d = n.diff
    if (!d || !tl.applies?.[n.id]) continue
    const looks = c.frames.map((f) => diffGeom(d, f.diff?.[n.id]))
    d.rows.forEach((r, k) => {
      const key = `${n.id}:${k}`
      const L = looks.map((x) => x[k])
      // Tight tolerance: a 0.1 px rest offset (a long simplified tail) shifts every glyph's
      // anti-aliasing, which the parity check reads as a real difference.
      add(`drow:${key}`, translate(c, L.map((l) => [0, l.y]), 0.02))
      if (r.kind === "add" || r.kind === "del") add(`dtint:${key}`, anim(c, "opacity", L.map((l) => [l.tint]), 0.01))
      if (r.kind !== "fold") add(`dnum:${key}`, anim(c, "opacity", L.map((l) => [l.num]), 0.01))
      if (r.kind === "add") {
        add(`dh:${key}`, anim(c, "height", L.map((l) => [l.h]), 0.02))
        add(`dclip:${key}`, anim(c, "width", L.map((l) => [l.chars !== undefined ? l.chars * ADV + 2 : n.w - d.codeX]), 0.5))
      }
    })
  }
}

// ---------------------------------------------------------------------------
// Theme pinning: resolve every var(--si-*) to a literal colour.

function hex(c: string): [number, number, number] {
  const h = c.replace("#", "")
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
const toHex = (v: Vec) => `#${v.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("")}`

/** Diagram CSS with the theme's literal colours (no custom properties, no media queries). */
export function pinnedCss(theme: ThemeName, rich = false, changes = false, tones = false, overlays = false): string {
  const p = { ...palettes[theme], ...(rich ? richPalettes[theme] : {}), ...(changes ? deltaPalettes[theme] : {}), ...(tones ? tonePalette(theme) : {}) } as Palette
  const sub = (s: string, accent?: string) =>
    s
      .replace(/var\(--si-accentFill\)/g, accent ? p[`${accent}Fill` as keyof Palette] : "")
      .replace(/var\(--si-accent\)/g, accent ? p[accent as keyof Palette] : "")
      .replace(/var\(--si-(\w+)\)/g, (_, k: string) => p[k as keyof Palette] ?? "")
  const out: string[] = []
  for (const m of diagramCss(rich, changes, tones, overlays).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim()
    const body = m[2]
    if (body.trim().startsWith("--")) continue
    if (/var\(--si-accent/.test(body)) {
      const sels = sel.split(",").map((x) => x.trim().replace(/^\.storyink\s+/, ""))
      for (const a of ACCENTS) out.push(`${sels.map((x) => `.si-a-${a} ${x}`).join(",")}{${sub(body, a)}}`)
      continue
    }
    out.push(`${sel}{${sub(body)}}`)
  }
  return out.join("\n")
}

// ---------------------------------------------------------------------------

const HEADER = { pad: 22, title: 22, subtitle: 20, captions: 46, gap: 6, hud: 34 }

/** The story as a SMIL-animated, self-contained SVG. Deterministic: same input, same bytes. */
export function renderAnimatedSvg(spec: Spec | Scene | unknown, opts: AnimatedSvgOptions = {}): string {
  return animatedSvg(spec, opts).svg
}

/** `renderAnimatedSvg` plus metadata (bytes, cycle, whether the auto story was used). */
export function animatedSvg(spec: Spec | Scene | unknown, opts: AnimatedSvgOptions = {}): AnimatedSvgInfo {
  let scene = toScene(spec)
  let auto = false
  if (!scene.timeline && typeof spec === "object" && spec !== null && !("viewBox" in spec)) {
    scene = toScene({ ...(spec as Spec), story: "auto" })
    auto = true
  }
  const theme = opts.theme ?? "light"
  const pal = palettes[theme]
  const tl = scene.timeline
  const vb = scene.viewBox
  const tones = isToneScene(scene)
  const style = [opts.font === "embed" ? fontFaceCss(COMMIT_MONO_400, COMMIT_MONO_700) : "", pinnedCss(theme, isRichScene(scene), isChangeScene(scene), tones, isOverlayScene(scene))].filter(Boolean).join("\n")

  // Header: title, subtitle, caption slot (there is no HTML around an <img>).
  const headH = animatedHeaderHeight(scene)
  const X = vb.x + 32
  const titleY = vb.y - headH + HEADER.pad + 16
  const subY = titleY + HEADER.subtitle
  const capY = (scene.subtitle ? subY : titleY) + 30
  const maxChars = Math.floor((vb.w - 64) / (13 * fonts.monoAdvance))
  const clip = (s: string) => (s.length > maxChars ? `${s.slice(0, maxChars - 1)}…` : s)

  const count = { n: 0 }
  let smil: ((key: string) => ReactNode) | undefined
  let cycle = 0
  if (tl) {
    const fps = opts.fps ?? 60
    const dur = tl.duration
    const ts: number[] = []
    for (let i = 0; i * (1 / fps) < dur - 1e-9; i++) ts.push(Math.round((i / fps) * 1e6) / 1e6)
    ts.push(dur)
    const frames = ts.map((t) => storyState(scene, tl, t))
    const hold = Math.max(0, (opts.hold ?? 3) - (dur - tl.lastEvent))
    const reset = opts.reset ?? 0.4
    cycle = opts.once ? dur : dur + hold + reset
    const c: Clock = { ts, frames, dur, hold, reset, cycle, once: !!opts.once, count }
    const map = new Map<string, ReactNode[]>()
    const add = (key: string, ...els: (ReactNode | null)[]) => {
      const list = map.get(key) ?? []
      for (const e of els) if (e) list.push(e)
      map.set(key, list)
    }
    const series = <V,>(get: (f: Frame) => V) => frames.map(get)
    const O = 0.01
    const PX = 0.3

    // Change scenes use the union mode too (their stories mix 0.4 steps: wire, dim, undim...).
    const rich = isRichScene(scene) || isChangeScene(scene) || isStoryTextScene(scene)
    // Reveals.
    const nodes = new Map(scene.nodes.map((n) => [n.id, n]))
    const groups = new Set(scene.groups.map((g) => g.id))
    const frameIds = new Set(scene.frames.map((f) => f.id))
    const acts = new Map(scene.activations.map((a) => [a.id, a]))
    for (const id of Object.keys(tl.appear)) {
      const o = series((f) => [f.el[id]?.o ?? 1])
      const dy = series((f) => f.el[id]?.dy ?? 0)
      const n = nodes.get(id)
      // Rich scenes: opacity comes from the combined reveal × dim × visibility track (richTracks).
      if (n) add(`node:${id}`, rich ? null : anim(c, "opacity", o, O), translate(c, dy.map((d) => [n.x, n.y + d]), PX))
      else if (groups.has(id)) add(`group:${id}`, rich ? null : anim(c, "opacity", o, O), translate(c, dy.map((d) => [0, d]), PX))
      else if (frameIds.has(id)) add(`frame:${id}`, anim(c, "opacity", o, O))
      else if (acts.has(id)) add(`act:${id}`, anim(c, "opacity", o, O))
      if (n) add(`life:${id}`, anim(c, "opacity", o, O))
    }
    // Activations grow.
    for (const a of scene.activations) add(`act:${a.id}`, anim(c, "height", series((f) => [f.grow[a.id] ?? a.h]), PX))

    // Wires draw on; heads, sequence badges, labels and ports follow.
    const edges = new Map(scene.edges.map((e) => [e.id, e]))
    for (const id of Object.keys(tl.draw)) {
      const e = edges.get(id)
      if (!e) continue
      const d = series((f) => f.draw[id] ?? 1)
      if (dashedLook(e)) add(`wire:${id}`, anim(c, "opacity", d.map((x) => [x <= 0 ? 0 : Math.min(1, x * 1.4)]), O))
      else {
        const L = (e.length ?? 0) + 24
        const off = anim(c, "stroke-dashoffset", d.map((x) => [L * (1 - x)]), 0.5)
        if (off) add(`wire:${id}`, <set attributeName="stroke-dasharray" to={`${num(L)} ${num(L)}`} begin="0s" />, off)
        add(`wire:${id}`, anim(c, "opacity", d.map((x) => [x <= 0 ? 0 : 1]), O))
      }
      add(`head:${id}`, anim(c, "opacity", d.map((x) => [x >= 0.98 ? 1 : 0]), O))
      add(`seq:${id}`, anim(c, "opacity", d.map((x) => [x > 0 ? 1 : 0]), O))
      add(`elabel:${id}`, anim(c, "opacity", d.map((x) => [Math.max(0, Math.min(1, (x - 0.35) / 0.4))]), O))
      for (const p of rich ? [] : scene.ports.filter((q) => q.edge === id && !q.covered))
        add(`port:${p.id}`, anim(c, "opacity", d.map((x) => [p.end === "out" ? (x > 0 ? 1 : 0) : x >= 0.99 ? 1 : 0]), O))
    }

    // Arrival flash on node labels (colour-mix in sRGB, as the runtime's color-mix).
    const ink = hex(pal.ink)
    const flashC = hex(pal.flash)
    for (const id of new Set(tl.glows.map((g) => g.node))) {
      if (!nodes.has(id)) continue
      const col = series((f) => {
        const p = f.flash[id]
        if (!p || p <= 0.005) return ink as Vec
        const w = Math.round(p * 100) / 100
        return ink.map((x, i) => flashC[i] * w + x * (1 - w))
      })
      const k = linearKeys(c, col, 2)
      if (k) {
        const el = () => <animate attributeName="fill" calcMode="linear" keyTimes={k.keyTimes} values={k.vals.map(toHex).join(";")} {...timing(c)} />
        const nLines = nodes.get(id)!.label.length
        count.n += nLines
        map.set(`flash:${id}`, [el()])
      }
    }

    // Flood glows: a pre-built radial gradient per glow event; radius and group opacity animate.
    const gain = Number(pal.glowGain)
    const glowsByNode = new Map<string, ReactNode[]>()
    tl.glows.forEach((g, j) => {
      const n = nodes.get(g.node)
      if (!n) return
      const gid = `${g.node}@${g.t}`
      const got = frames.map((f) => f.glows.find((x) => x.id === gid))
      if (!got.some(Boolean)) return
      const first = got.find(Boolean)!
      let r = first.r
      const rs = got.map((x) => [(r = x ? x.r : r)])
      const amp = got.map((x) => [x ? x.a / S.glow.alpha : 0])
      const id = `g${j}`
      const list = glowsByNode.get(g.node) ?? []
      // A toned pulse's arrival glow: the tone's ink, normal blend, no theme gain (as the HTML).
      const tc = g.tone ? toneInk(theme, g.tone) : undefined
      list.push(
        <g key={id} className="si-x" opacity={0} style={!tc && pal.glowBlend !== "normal" ? { mixBlendMode: pal.glowBlend as never } : undefined}>
          {anim(c, "opacity", amp, O)}
          <radialGradient id={id} gradientUnits="userSpaceOnUse" cx={num(g.cx - n.x)} cy={num(g.cy - n.y)} r={num(rs[rs.length - 1][0])}>
            {anim(c, "r", rs, 0.5)}
            <stop offset="0" stopColor={tc ?? pal.glowCrest} stopOpacity={num(Math.min(1, tc ? TONED_GLOW * S.glow.alpha : gain * S.glow.alpha))} />
            <stop offset="0.45" stopColor={tc ?? pal.glow} stopOpacity={num(Math.min(1, (tc ? TONED_GLOW : gain) * S.glow.alpha * 0.45))} />
            <stop offset="1" stopColor={tc ?? pal.glow} stopOpacity={0} />
          </radialGradient>
          <rect width={n.w} height={n.h} fill={`url(#${id})`} />
          <rect x={0.75} y={0.75} width={n.w - 1.5} height={n.h - 1.5} fill="none" stroke={`url(#${id})`} strokeWidth={1.5} opacity={0.4} />
        </g>,
      )
      glowsByNode.set(g.node, list)
    })
    for (const [k, v] of glowsByNode) add(`glow:${k}`, ...v)

    // Counters: one <text> per distinct value, switched with discrete visibility (SMIL cannot change text).
    const every = Math.max(1, Math.round(fps / 30))
    for (const n of scene.nodes) {
      const cn = n.counter
      if (!cn || !tl.counters[cn.id] || n.text.counterY === undefined) continue
      const raw = series((f) => f.counters[cn.id] ?? "")
      // 30 fps is plenty for a number flipping; hold each value between the coarser samples.
      const vals = raw.map((_, i) => raw[Math.min(raw.length - 1, i - (i % every))])
      vals[vals.length - 1] = raw[raw.length - 1]
      const final = vals[vals.length - 1]
      const distinct = [...new Set(vals)]
      if (distinct.length < 2) continue
      add(`ctext:${cn.id}`, discrete(c, "visibility", vals.map((v) => (v === final ? "visible" : "hidden"))))
      const dups = distinct
        .filter((v) => v !== final)
        .map((v, k) => (
          <text key={k} className="si-counter si-x" x={num(n.text.cx)} y={num(n.text.counterY!)} textAnchor="middle" visibility="hidden">
            {cn.label ? <tspan className="si-counter-label">{`${cn.label.toUpperCase()} `}</tspan> : null}
            <tspan className="si-counter-value">{v}</tspan>
            {discrete(c, "visibility", vals.map((x) => (x === v ? "visible" : "hidden")))}
          </text>
        ))
      add(`cdup:${cn.id}`, ...dups)
    }

    if (rich) richTracks(scene, c, add, { ...pal, ...richPalettes[theme] } as Palette)
    if (rich) diffTracks(scene, c, add)
    if (rich) changeTracks(scene, c, add)

    // Pulses: dot + halo + arrival ring + a three-segment cooling trail (dash window on the route).
    const overlay: ReactNode[] = []
    tl.pulses.forEach((p, j) => {
      const got = frames.map((f) => f.pulses.find((x) => x.id === p.id))
      if (!got.some(Boolean)) return
      const start = p.points[0]
      const arrive = p.points[p.points.length - 1]
      const pos = got.map((x, i): Vec => (x ? [x.x, x.y] : ts[i] < p.t0 ? [start.x, start.y] : [arrive.x, arrive.y]))
      const route = p.points.map((q, i) => `${i ? "L" : "M"}${num(q.x)} ${num(q.y)}`).join("")
      const tcls = p.tone ? ` si-t-${p.tone}` : ""
      const big = num(p.length + 100)
      const kids: ReactNode[] = []
      for (let k = 0; k < 3; k++) {
        let s0 = 0
        let s1 = 0
        const seg = got.map((x) => {
          const t = x?.trail.find((q) => q.k === k)
          if (t) {
            s0 = t.s0 ?? 0
            s1 = t.s1 ?? 0
          }
          return { o: t ? t.o : 0, s0, s1 }
        })
        if (!seg.some((q) => q.o > 0)) continue
        kids.push(
          <path key={`t${k}`} className={`si-trail${tcls}`} d={route} opacity={0} strokeDasharray={`0 ${big}`}>
            {anim(c, "opacity", seg.map((q) => [q.o]), O)}
            {anim(c, "stroke-dasharray", seg.map((q) => [q.s1 - q.s0]), PX, (v) => `${num(v[0])} ${big}`)}
            {anim(c, "stroke-dashoffset", seg.map((q) => [-q.s0]), PX)}
          </path>,
        )
      }
      const haloO = got.map((x) => [x?.halo && x.halo.o > 0.005 ? x.halo.o : 0])
      let hr = S.pulse.halo
      const haloR = got.map((x) => [(hr = x?.halo ? x.halo.r : hr)])
      if (haloO.some((v) => v[0] > 0))
        kids.push(
          <circle key="h" className={`si-halo${tcls}`} cx={num(start.x)} cy={num(start.y)} r={num(haloR[haloR.length - 1][0])} opacity={0}>
            {anim(c, "opacity", haloO, O)}
            {anim(c, "r", haloR, PX)}
          </circle>,
        )
      const dotO = got.map((x) => [x && x.o > 0.005 && !x.ring ? x.o : 0])
      let dr = 0
      const dotR = got.map((x) => [(dr = x ? x.r : dr)])
      const last = pos[pos.length - 1]
      kids.push(
        <circle key="d" className={`si-pulse${tcls}`} cx={num(last[0])} cy={num(last[1])} r={num(S.pulse.dot)} opacity={0}>
          {anim(c, "opacity", dotO, O)}
          {anim(c, "r", dotR, PX)}
          {anim(c, "cx", pos.map((v) => [v[0]]), PX)}
          {anim(c, "cy", pos.map((v) => [v[1]]), PX)}
        </circle>,
      )
      const ringO = got.map((x) => [x?.ring ? x.ring.o : 0])
      if (ringO.some((v) => v[0] > 0)) {
        let rr = 2
        let rw = 4
        const ring = got.map((x) => {
          if (x?.ring) {
            rr = x.ring.r
            rw = x.ring.w
          }
          return [rr, rw]
        })
        kids.push(
          <circle key="r" className={`si-ring-pulse${tcls}`} cx={num(arrive.x)} cy={num(arrive.y)} r={num(ring[ring.length - 1][0])} strokeWidth={num(ring[ring.length - 1][1])} opacity={0}>
            {anim(c, "opacity", ringO, O)}
            {anim(c, "r", ring.map((v) => [v[0]]), PX)}
            {anim(c, "stroke-width", ring.map((v) => [v[1]]), 0.1)}
          </circle>,
        )
      }
      if (p.label) {
        // Payload label: left edge / baseline / opacity tracks (hidden outside the flight).
        let lx = start.x
        let ly = start.y
        const lab = got.map((x) => {
          if (x?.label) {
            lx = x.label.x
            ly = x.label.y
          }
          return [lx, ly, x?.label?.o ?? 0]
        })
        const lastL = lab[lab.length - 1]
        kids.push(
          <text key="l" className={`si-plabel${tcls}`} x={num(lastL[0])} y={num(lastL[1])} opacity={0}>
            {p.label}
            {anim(c, "opacity", lab.map((v) => [v[2]]), O)}
            {anim(c, "x", lab.map((v) => [v[0]]), PX)}
            {anim(c, "y", lab.map((v) => [v[1]]), PX)}
          </text>,
        )
      }
      overlay.push(<g key={`p${j}`}>{kids}</g>)
    })

    // Captions: one <text> per caption in the header; opacity (line × word reveal) and line slot.
    const caps: ReactNode[] = []
    tl.captions.forEach((cap, i) => {
      const got = frames.map((f) => f.captions.find((x) => x.i === i))
      const o = got.map((x) => [x ? x.o * (x.words.reduce((a, b) => a + b, 0) / Math.max(1, x.words.length)) : 0])
      let slot = 0
      const y = got.map((x, k) => {
        if (x) slot = frames[k].captions.indexOf(x)
        return String(num(capY + slot * 20))
      })
      caps.push(
        <text key={`c${i}`} className="si-cap" x={X} y={y[y.length - 1]} opacity={0}>
          {cap.em ? emSpans(clip(cap.text), cap.em, cap.tone ?? "note") : clip(cap.text)}
          {anim(c, "opacity", o, O)}
          {discrete(c, "y", y)}
        </text>,
      )
    })
    // Acts: a cut dips the diagram (a background veil), and the act chip sits right in the header row.
    const actEls: ReactNode[] = []
    if (tl.acts) {
      const dip = frames.map((f) => [1 - (f.act?.dip ?? 1)])
      if (dip.some((v) => v[0] > 0.005))
        actEls.push(
          <rect key="dip" className="si-bg" x={vb.x} y={vb.y} width={vb.w} height={vb.h} opacity={0}>
            {anim(c, "opacity", dip, O)}
          </rect>,
        )
      const texts = [...new Set(frames.flatMap((f) => (f.act?.chip ?? []).map((x) => x.text)))]
      const right = vb.x + vb.w - 32
      texts.forEach((text, j) => {
        const o = frames.map((f) => [f.act?.chip.find((x) => x.text === text)?.o ?? 0])
        const any = frames.flatMap((f) => f.act?.chip ?? []).find((x) => x.text === text)!
        const w = textWidth(text, 12)
        const lastO = o[o.length - 1][0]
        actEls.push(
          <g key={`chip${j}`} className="si-act-chip" opacity={num(lastO)}>
            {anim(c, "opacity", o, O)}
            {any.rewind ? null : <circle cx={num(right - w - 10)} cy={num(titleY - 4.5)} r={4} fill={any.tone ? toneInk(theme, any.tone) : pal.inkMuted} />}
            <text x={num(right)} y={num(titleY)} textAnchor="end" style={{ fontSize: "12px", fill: any.rewind ? pal.inkMuted : pal.ink }}>
              {text}
            </text>
          </g>,
        )
      })
    }
    // HUD metrics: a row of their own at the bottom of the header (values switch by visibility,
    // colour layers crossfade by opacity).
    const hudEls: ReactNode[] = []
    if (tl.hud?.length) {
      const y = vb.y - HEADER.gap - 9
      let right = vb.x + vb.w - 32
      let left = X
      tl.hud.forEach((h, j) => {
        const raw = series((f) => f.counters[h.id] ?? "")
        const vals = [...new Set(raw)]
        const widest = Math.max(...vals.map((v) => textWidth(v, 22)))
        const labelW = textWidth(`${h.label}:`, 13)
        const w = labelW + 8 + widest
        const x0 = h.at === "bottom-left" ? left : right - w
        if (h.at === "bottom-left") left += w + 28
        else right -= w + 28
        const tones = [...new Set((tl.tones?.[h.id] ?? []).map((e) => e.to).filter((x): x is Tone => !!x))]
        const sum = (f: Frame) => Object.values(f.tone?.[h.id] ?? {}).reduce((a: number, b) => a + (b ?? 0), 0)
        const lay: { tone?: Tone; o: Vec[] }[] = [{ ...(h.tone ? { tone: h.tone } : {}), o: series((f) => [Math.max(0, 1 - sum(f))]) }, ...tones.map((t) => ({ tone: t, o: series((f) => [f.tone?.[h.id]?.[t] ?? 0]) }))]
        const final = raw[raw.length - 1]
        const vis = series((f) => [(f.el[h.id]?.o ?? 1) * (f.vis?.[h.id] ?? 1)])
        hudEls.push(
          <g key={`hud${j}`} className="si-hud" opacity={num(vis[vis.length - 1][0])}>
            {anim(c, "opacity", vis, O)}
            <text x={num(x0)} y={num(y)} style={{ fontSize: "13px", fill: pal.inkMuted }}>
              {`${h.label}:`}
            </text>
            {lay.map((l, k) => {
              const lo = l.o[l.o.length - 1][0]
              return (
                <g key={k} opacity={num(lo)}>
                  {anim(c, "opacity", l.o, O)}
                  {vals.map((v, i) => (
                    <text key={i} x={num(x0 + w)} y={num(y)} textAnchor="end" visibility={v === final ? "visible" : "hidden"} style={{ fontSize: "22px", fontWeight: 700, fill: l.tone ? toneInk(theme, l.tone) : pal.ink }}>
                      {v}
                      {discrete(c, "visibility", raw.map((x) => (x === v ? "visible" : "hidden")))}
                    </text>
                  ))}
                </g>
              )
            })}
          </g>,
        )
      })
    }
    map.set("overlay", [...(actEls.length ? [actEls[0]] : []), <g key="pl" className="si-pulses">{overlay}</g>, ...caps, ...actEls.slice(1), ...hudEls].filter((x) => x !== undefined))
    smil = (key) => {
      const v = map.get(key)
      return v && v.length ? v.map((e, i) => <Fragment key={i}>{e}</Fragment>) : undefined
    }
  }

  const head = (
    <g className="si-head">
      <rect className="si-bg" x={vb.x} y={vb.y - headH} width={vb.w} height={headH} />
      <text className="si-title" x={X} y={titleY}>
        {scene.title}
      </text>
      {scene.subtitle ? (
        <text className="si-sub" x={X} y={subY}>
          {scene.subtitle}
        </text>
      ) : null}
    </g>
  )
  const extraCss = `.storyink .si-title{font-family:${fonts.serif};font-size:${T.title - 8}px;font-weight:500;fill:${pal.title};}.storyink .si-sub{font-family:${fonts.serif};font-style:italic;font-size:${T.subtitle - 1}px;fill:${pal.inkMuted};}.storyink .si-cap{font-size:13px;fill:${pal.ink};}`
  const final = tl ? storyState(scene, tl, tl.duration) : undefined
  // Base = final frame (flash / glows / pulses are transient and drawn by the SMIL layer).
  const base: Frame | undefined = final ? { ...final, flash: {}, glows: [], pulses: [] } : undefined
  const smilWithHead = (key: string): ReactNode => (key === "overlay" ? (
    <>
      {head}
      {smil?.(key)}
    </>
  ) : smil?.(key))
  const richScene = isRichScene(scene) || isChangeScene(scene) || isStoryTextScene(scene)
  const union = richScene ? { pin: { ...pal, ...richPalettes[theme], ...(tones ? tonePalette(theme) : {}) } as unknown as Record<string, string> } : undefined
  let markup = renderToStaticMarkup(<Diagram scene={scene} style={`${style}\n${extraCss}`} frame={base} smil={smilWithHead} {...(union ? { union } : {})} />)
  // Rich scenes animate opacity on elements whose base opacity is inline style; SMIL animates the
  // presentation attribute, which an inline style would override: move it to the attribute.
  if (richScene) markup = markup.replace(/ style="opacity:([0-9.]+)"/g, ' opacity="$1"')
  const H = vb.h + headH
  markup = markup.replace(
    `viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" width="${vb.w}" height="${vb.h}"`,
    `viewBox="${vb.x} ${num(vb.y - headH)} ${vb.w} ${num(H)}" width="${vb.w}" height="${num(H)}"`,
  )
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n${markup}\n`
  return { svg, bytes: new TextEncoder().encode(svg).length, duration: tl?.duration ?? 0, cycle, autoStory: auto, animations: count.n }
}

/** Toned glows: peak alpha of the tone ink (matches Diagram.tsx). */
const TONED_GLOW = 0.9

/** Caption text with `*emphasis*` ranges as accent tspans (literal tone colour from the pinned CSS). */
function emSpans(text: string, em: [number, number][], tone: Tone): ReactNode[] {
  const out: ReactNode[] = []
  let at = 0
  em.forEach(([a, b], k) => {
    if (a >= text.length) return
    if (a > at) out.push(text.slice(at, a))
    out.push(
      <tspan key={k} className={`si-em si-t-${tone}`}>
        {text.slice(a, Math.min(b, text.length))}
      </tspan>,
    )
    at = Math.min(b, text.length)
  })
  if (at < text.length) out.push(text.slice(at))
  return out
}

/** Header height the animated SVG adds above the diagram (for cropping in parity checks). */
export function animatedHeaderHeight(scene: Scene): number {
  return HEADER.pad + HEADER.title + (scene.subtitle ? HEADER.subtitle : 0) + (scene.timeline?.captions.length ? HEADER.captions : 0) + (scene.timeline?.hud?.length ? HEADER.hud : 0) + HEADER.gap
}
