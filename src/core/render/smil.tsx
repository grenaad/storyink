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
import { ACCENTS, fonts, palettes, story as S, type as T, type Palette, type ThemeName } from "../../theme/tokens.ts"
import type { Scene } from "../scene.ts"
import type { Spec } from "../spec.ts"
import { storyState } from "../story/state.ts"
import type { Frame } from "../story/types.ts"
import { diagramCss, fontFaceCss } from "./css.ts"
import { Diagram } from "./Diagram.tsx"
import { toScene } from "./index.tsx"

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

// ---------------------------------------------------------------------------
// Theme pinning: resolve every var(--si-*) to a literal colour.

function hex(c: string): [number, number, number] {
  const h = c.replace("#", "")
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
const toHex = (v: Vec) => `#${v.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("")}`

/** Diagram CSS with the theme's literal colours (no custom properties, no media queries). */
export function pinnedCss(theme: ThemeName): string {
  const p = palettes[theme]
  const sub = (s: string, accent?: string) =>
    s
      .replace(/var\(--si-accentFill\)/g, accent ? p[`${accent}Fill` as keyof Palette] : "")
      .replace(/var\(--si-accent\)/g, accent ? p[accent as keyof Palette] : "")
      .replace(/var\(--si-(\w+)\)/g, (_, k: string) => p[k as keyof Palette] ?? "")
  const out: string[] = []
  for (const m of diagramCss().matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
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

const HEADER = { pad: 22, title: 22, subtitle: 20, captions: 46, gap: 6 }

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
  const style = [opts.font === "embed" ? fontFaceCss(COMMIT_MONO_400, COMMIT_MONO_700) : "", pinnedCss(theme)].filter(Boolean).join("\n")

  // Header: title, subtitle, caption slot (there is no HTML around an <img>).
  const hasCaptions = !!tl?.captions.length
  const headH = HEADER.pad + HEADER.title + (scene.subtitle ? HEADER.subtitle : 0) + (hasCaptions ? HEADER.captions : 0) + HEADER.gap
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

    // Reveals.
    const nodes = new Map(scene.nodes.map((n) => [n.id, n]))
    const groups = new Set(scene.groups.map((g) => g.id))
    const frameIds = new Set(scene.frames.map((f) => f.id))
    const acts = new Map(scene.activations.map((a) => [a.id, a]))
    for (const id of Object.keys(tl.appear)) {
      const o = series((f) => [f.el[id]?.o ?? 1])
      const dy = series((f) => f.el[id]?.dy ?? 0)
      const n = nodes.get(id)
      if (n) add(`node:${id}`, anim(c, "opacity", o, O), translate(c, dy.map((d) => [n.x, n.y + d]), PX))
      else if (groups.has(id)) add(`group:${id}`, anim(c, "opacity", o, O), translate(c, dy.map((d) => [0, d]), PX))
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
      if (e.style === "dashed") add(`wire:${id}`, anim(c, "opacity", d.map((x) => [x <= 0 ? 0 : Math.min(1, x * 1.4)]), O))
      else {
        const L = (e.length ?? 0) + 24
        const off = anim(c, "stroke-dashoffset", d.map((x) => [L * (1 - x)]), 0.5)
        if (off) add(`wire:${id}`, <set attributeName="stroke-dasharray" to={`${num(L)} ${num(L)}`} begin="0s" />, off)
        add(`wire:${id}`, anim(c, "opacity", d.map((x) => [x <= 0 ? 0 : 1]), O))
      }
      add(`head:${id}`, anim(c, "opacity", d.map((x) => [x >= 0.98 ? 1 : 0]), O))
      add(`seq:${id}`, anim(c, "opacity", d.map((x) => [x > 0 ? 1 : 0]), O))
      add(`elabel:${id}`, anim(c, "opacity", d.map((x) => [Math.max(0, Math.min(1, (x - 0.35) / 0.4))]), O))
      for (const p of scene.ports.filter((q) => q.edge === id && !q.covered))
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
      list.push(
        <g key={id} className="si-x" opacity={0} style={pal.glowBlend !== "normal" ? { mixBlendMode: pal.glowBlend as never } : undefined}>
          {anim(c, "opacity", amp, O)}
          <radialGradient id={id} gradientUnits="userSpaceOnUse" cx={num(g.cx - n.x)} cy={num(g.cy - n.y)} r={num(rs[rs.length - 1][0])}>
            {anim(c, "r", rs, 0.5)}
            <stop offset="0" stopColor={pal.glowCrest} stopOpacity={num(Math.min(1, gain * S.glow.alpha))} />
            <stop offset="0.45" stopColor={pal.glow} stopOpacity={num(Math.min(1, gain * S.glow.alpha * 0.45))} />
            <stop offset="1" stopColor={pal.glow} stopOpacity={0} />
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

    // Pulses: dot + halo + arrival ring + a three-segment cooling trail (dash window on the route).
    const overlay: ReactNode[] = []
    tl.pulses.forEach((p, j) => {
      const got = frames.map((f) => f.pulses.find((x) => x.id === p.id))
      if (!got.some(Boolean)) return
      const start = p.points[0]
      const arrive = p.points[p.points.length - 1]
      const pos = got.map((x, i): Vec => (x ? [x.x, x.y] : ts[i] < p.t0 ? [start.x, start.y] : [arrive.x, arrive.y]))
      const route = p.points.map((q, i) => `${i ? "L" : "M"}${num(q.x)} ${num(q.y)}`).join("")
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
          <path key={`t${k}`} className="si-trail" d={route} opacity={0} strokeDasharray={`0 ${big}`}>
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
          <circle key="h" className="si-halo" cx={num(start.x)} cy={num(start.y)} r={num(haloR[haloR.length - 1][0])} opacity={0}>
            {anim(c, "opacity", haloO, O)}
            {anim(c, "r", haloR, PX)}
          </circle>,
        )
      const dotO = got.map((x) => [x && x.o > 0.005 && !x.ring ? x.o : 0])
      let dr = 0
      const dotR = got.map((x) => [(dr = x ? x.r : dr)])
      const last = pos[pos.length - 1]
      kids.push(
        <circle key="d" className="si-pulse" cx={num(last[0])} cy={num(last[1])} r={num(S.pulse.dot)} opacity={0}>
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
          <circle key="r" className="si-ring-pulse" cx={num(arrive.x)} cy={num(arrive.y)} r={num(ring[ring.length - 1][0])} strokeWidth={num(ring[ring.length - 1][1])} opacity={0}>
            {anim(c, "opacity", ringO, O)}
            {anim(c, "r", ring.map((v) => [v[0]]), PX)}
            {anim(c, "stroke-width", ring.map((v) => [v[1]]), 0.1)}
          </circle>,
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
          {clip(cap.text)}
          {anim(c, "opacity", o, O)}
          {discrete(c, "y", y)}
        </text>,
      )
    })
    map.set("overlay", [<g key="pl" className="si-pulses">{overlay}</g>, ...caps])
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
  let markup = renderToStaticMarkup(<Diagram scene={scene} style={`${style}\n${extraCss}`} frame={base} smil={smilWithHead} />)
  const H = vb.h + headH
  markup = markup.replace(
    `viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" width="${vb.w}" height="${vb.h}"`,
    `viewBox="${vb.x} ${num(vb.y - headH)} ${vb.w} ${num(H)}" width="${vb.w}" height="${num(H)}"`,
  )
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n${markup}\n`
  return { svg, bytes: new TextEncoder().encode(svg).length, duration: tl?.duration ?? 0, cycle, autoStory: auto, animations: count.n }
}

/** Header height the animated SVG adds above the diagram (for cropping in parity checks). */
export function animatedHeaderHeight(scene: Scene): number {
  return HEADER.pad + HEADER.title + (scene.subtitle ? HEADER.subtitle : 0) + (scene.timeline?.captions.length ? HEADER.captions : 0) + HEADER.gap
}
