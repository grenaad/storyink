import { createContext, useContext, type CSSProperties, type ReactElement, type ReactNode } from "react"
import type { ContentLayer, Frame, StatusFrame } from "../story/types.ts"
import { SHIMMER } from "../story/content-state.ts"
import { geometry as G, type as T } from "../../theme/tokens.ts"
import type { Arrowhead, CodeLine, Scene, SceneEdge, SceneFrame, SceneGroup, SceneNode, SceneRow } from "../scene.ts"
import { r2 } from "../layout/measure.ts"
import { ICON_PATHS, STATUS_PATHS } from "./icons.ts"
import type { IconName, RowStatus } from "../spec.ts"

export interface DiagramProps {
  scene: Scene
  /** Inline <style> (fonts, theme vars, rules) for standalone SVG. */
  style?: string
  /** Unique prefix when several copies share a page (contact sheet). */
  copy?: string
  className?: string
  /** Storyboard frame; omitted = the resting (static) diagram. */
  frame?: Frame
  /** Animated-SVG hook: SMIL children (or extra siblings) for a keyed element. */
  smil?: Smil
  /** Animated-SVG mode for rich scenes (see `Union`). */
  union?: Union
}

/** Returns SMIL elements for a key such as `node:<id>` or `wire:<id>` (undefined = none). */
export type Smil = (key: string) => ReactNode

/**
 * Animated-SVG mode (rich scenes): render every element the story ever shows (all content
 * versions, status glyphs, carets, bars, glows, shimmer, spotlight), the ones absent from the
 * base frame as `si-x` extras at opacity 0, and use literal colours (`pin`) instead of custom
 * properties / calc() / color-mix (SMIL-safe, <img>-safe).
 */
export interface Union {
  /** Theme palette (rich keys included) as literal values. */
  pin: Record<string, string>
}
const UnionCtx = createContext<Union | undefined>(undefined)
const useUnion = () => useContext(UnionCtx)
const xcls = (base: string | undefined, extra: boolean) => (extra ? `${base ? `${base} ` : ""}si-x` : base)
/** Gradient stop colour / opacity: custom properties normally, literals when pinned. */
function stop(u: Union | undefined, color: string, opacity: number, gain = true): Record<string, unknown> {
  if (!u) return { style: { stopColor: `var(--si-${color})`, stopOpacity: gain ? `calc(var(--si-glowGain) * ${+opacity.toFixed(4)})` : opacity } }
  const g = gain ? Number(u.pin.glowGain) : 1
  return { stopColor: u.pin[color], stopOpacity: +Math.min(1, g * opacity).toFixed(4) }
}
const blendStyle = (u: Union | undefined, extra?: CSSProperties): CSSProperties | undefined =>
  u ? (u.pin.glowBlend !== "normal" ? { mixBlendMode: u.pin.glowBlend as never, ...extra } : extra) : { mixBlendMode: "var(--si-glowBlend)" as never, ...extra }

type Vis = { o: number; dy: number } | undefined
const opStyle = (v: Vis, extra?: number): CSSProperties | undefined => {
  const o = (v?.o ?? 1) * (extra ?? 1)
  return o < 1 ? { opacity: +o.toFixed(3) } : undefined
}
const flashFill = (p: number | undefined, base: string): CSSProperties | undefined =>
  p && p > 0.005 ? { fill: `color-mix(in srgb, var(--si-flash) ${Math.round(p * 100)}%, var(--si-${base}))` } : undefined

const f = (n: number) => r2(n)

function Head({ h }: { h: Arrowhead }) {
  const s = G.arrowSize
  const c = Math.cos(h.angle)
  const sn = Math.sin(h.angle)
  const back = (d: number, side: number) => `${f(h.x - c * d - sn * side)},${f(h.y - sn * d + c * side)}`
  if (h.form === "open")
    return <polyline className="si-arrow-open" points={`${back(s + 1, -s * 0.62)} ${f(h.x)},${f(h.y)} ${back(s + 1, s * 0.62)}`} />
  return <polygon className="si-arrow" points={`${f(h.x)},${f(h.y)} ${back(s + 1, -s * 0.55)} ${back(s + 1, s * 0.55)}`} />
}

function NodeShape({ n }: { n: SceneNode }) {
  const { w, h } = n
  const i = G.panelInset
  const r = G.panelRadius
  switch (n.shape) {
    case "dot":
      return <circle className="si-dotfill" cx={w / 2} cy={h / 2} r={w / 2} />
    case "bullseye":
      return (
        <>
          <circle className="si-ring" cx={w / 2} cy={h / 2} r={w / 2 - 0.7} />
          <circle className="si-dotfill" cx={w / 2} cy={h / 2} r={w / 2 - 5} />
        </>
      )
    case "bar":
      return <rect className="si-dotfill" x={0} y={0} width={w} height={h} />
    case "choice":
      return <polygon className="si-face" points={`${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`} />
    case "pill":
      return <rect className="si-soft" x={0} y={0} width={w} height={h} rx={h / 2} />
    case "diamond": {
      const pts = (k: number) => `${w / 2},${k} ${w - k * 1.7},${h / 2} ${w / 2},${h - k} ${k * 1.7},${h / 2}`
      return (
        <>
          <polygon className="si-face" points={pts(0)} strokeLinejoin="round" />
          <polygon className="si-inset" points={pts(i + 1)} strokeLinejoin="round" />
        </>
      )
    }
    case "slant": {
      const k = 10
      return (
        <>
          <polygon className="si-face" points={`${k},0 ${w},0 ${w - k},${h} 0,${h}`} />
          <polygon className="si-inset" points={`${k + i + 1},${i} ${w - i - 1},${i} ${w - k - i - 1},${h - i} ${i + 1},${h - i}`} />
        </>
      )
    }
    case "cylinder": {
      const ry = 6
      return (
        <>
          <path
            className="si-face"
            d={`M0 ${ry}A${w / 2} ${ry} 0 0 1 ${w} ${ry}V${h - ry}A${w / 2} ${ry} 0 0 1 0 ${h - ry}Z`}
          />
          <path className="si-inset" d={`M0 ${ry}A${w / 2} ${ry} 0 0 0 ${w} ${ry}`} />
          <path className="si-inset" d={`M${i} ${ry + 5}A${w / 2 - i} ${ry} 0 0 0 ${w - i} ${ry + 5}`} />
          <rect className="si-ink-bar" x={i + 1} y={ry * 2 + 4} width={2} height={h - ry * 3 - 8} />
        </>
      )
    }
    case "note":
      return (
        <>
          <path className="si-note" d={`M0 0H${w - 10}L${w} 10V${h}H0Z`} />
          <path className="si-note-fold" d={`M${w - 10} 0V10H${w}`} />
        </>
      )
    case "external":
      return <rect className="si-face si-dash" x={0} y={0} width={w} height={h} rx={r} />
    case "queue":
      return (
        <>
          <rect className="si-face" x={0} y={0} width={w} height={h} rx={r} />
          <rect className="si-inset" x={i} y={i} width={w - 2 * i} height={h - 2 * i} />
          {[0, 1, 2].map((k) => (
            <line key={k} className="si-glyph" x1={w - 22 + k * 5} y1={h / 2 - 7} x2={w - 22 + k * 5} y2={h / 2 + 7} />
          ))}
          <rect className="si-ink-bar" x={i + 1} y={i + 1} width={2} height={h - 2 * i - 2} />
        </>
      )
    default:
      return (
        <>
          <rect className="si-face" x={0} y={0} width={w} height={h} rx={r} />
          <rect className="si-inset" x={i} y={i} width={w - 2 * i} height={h - 2 * i} />
          <rect className="si-ink-bar" x={i + 1} y={i + 1} width={2} height={h - 2 * i - 2} />
        </>
      )
  }
}

function NodeView({ n, copy, fr, smil, typed }: { n: SceneNode; copy: string; fr?: Frame; smil?: Smil; typed: Typed }) {
  const cx = n.text.cx
  const actorIcon = n.shape === "actor" && n.tag
  const tagW = n.tag.length * 9.5 * 0.68
  const v = fr?.el[n.id]
  const flash = fr?.flash[n.id]
  const glows = fr?.glows.filter((g) => g.node === n.id) ?? []
  const rich = n.shape === "window" || n.shape === "chip"
  const counterText = n.counter ? (fr?.counters[n.counter.id] ?? `${n.counter.prefix ?? ""}${n.counter.value}${n.counter.suffix ?? ""}`) : undefined
  return (
    <g
      className={`si-node si-a-${n.accent}`}
      data-si={`node:${n.id}`}
      data-copy={copy || undefined}
      data-box={`${n.x},${n.y},${n.w},${n.h}`}
      transform={`translate(${n.x} ${f(n.y + (v?.dy ?? 0))})`}
      style={opStyle(v, nodeLevel(n, fr))}
    >
      {smil?.(`node:${n.id}`)}
      {rich ? <RichFace n={n} /> : <NodeShape n={n} />}
      {smil?.(`glow:${n.id}`)}
      {glows.map((g, k) => {
        const gid = `si-glow-${copy}-${n.id}-${k}`.replace(/[^\w-]/g, "_")
        return (
          <g key={gid} className="si-glow" style={{ mixBlendMode: "var(--si-glowBlend)" as never }}>
            <defs>
              <radialGradient id={gid} gradientUnits="userSpaceOnUse" cx={f(g.cx - n.x)} cy={f(g.cy - n.y)} r={g.r}>
                <stop offset="0" style={{ stopColor: "var(--si-glowCrest)", stopOpacity: `calc(var(--si-glowGain) * ${g.a})` }} />
                <stop offset="0.45" style={{ stopColor: "var(--si-glow)", stopOpacity: `calc(var(--si-glowGain) * ${+(g.a * 0.45).toFixed(3)})` }} />
                <stop offset="1" style={{ stopColor: "var(--si-glow)", stopOpacity: 0 }} />
              </radialGradient>
            </defs>
            <rect x={0} y={0} width={n.w} height={n.h} fill={`url(#${gid})`} />
            <rect className="si-glow-rim" x={0.75} y={0.75} width={n.w - 1.5} height={n.h - 1.5} fill="none" stroke={`url(#${gid})`} strokeWidth={1.5} style={{ opacity: 0.4 }} />
          </g>
        )
      })}
      <LitSlot n={n} copy={copy} fr={fr} smil={smil} />
      {rich ? <RichBody n={n} copy={copy} fr={fr} smil={smil} flash={flash} typed={typed} /> : null}
      {!rich && actorIcon ? (
        <g transform={`translate(${f(cx - tagW / 2 - 13)} ${f(n.text.tagY - 8)})`}>
          <circle className="si-glyph" cx={4.5} cy={2.5} r={2.3} />
          <path className="si-glyph" d="M0.5 9.5C0.5 6.8 2.3 5.6 4.5 5.6S8.5 6.8 8.5 9.5" />
        </g>
      ) : null}
      {!rich && n.tag ? (
        <text className="si-tag" x={f(actorIcon ? cx + 6 : cx)} y={f(n.text.tagY)} textAnchor="middle">
          {n.tag}
        </text>
      ) : null}
      {(rich ? [] : n.label).map((line, k) => (
        <text key={`l${k}`} className={n.shape === "pill" ? "si-label si-pill-label" : "si-label"} x={f(cx)} y={f(n.text.labelY[k])} textAnchor="middle" style={flashFill(flash, "ink")}>
          {line}
          {smil?.(`flash:${n.id}`)}
        </text>
      ))}
      {n.detail.map((line, k) => (
        <text key={`d${k}`} className="si-detail" x={f(cx)} y={f(n.text.detailY[k])} textAnchor="middle">
          {line}
        </text>
      ))}
      {n.counter && n.text.counterY !== undefined ? (
        <text className="si-counter" x={f(cx)} y={f(n.text.counterY)} textAnchor="middle">
          {n.counter.label ? <tspan className="si-counter-label">{`${n.counter.label.toUpperCase()} `}</tspan> : null}
          <tspan className="si-counter-value" data-counter={n.counter.id} style={flashFill(flash, "ink")}>
            {counterText}
          </tspan>
          {smil?.(`ctext:${n.counter.id}`)}
        </text>
      ) : null}
      {n.counter ? smil?.(`cdup:${n.counter.id}`) : null}
    </g>
  )
}

/** Persistent glow (glow / unglow): an ink rim on the face plus the radial flood at amplitude `lit`. */
function LitView({ n, copy, lit, group, extra, smil }: { n: SceneNode; copy: string; lit: number; group?: number; extra?: boolean; smil?: Smil }) {
  const u = useUnion()
  const gid = `si-lit-${copy}-${n.id}`.replace(/[^\w-]/g, "_")
  const h = n.shape === "chip" && n.stack ? n.h - n.stack * G.stackStep : n.h
  const a = 0.28 * lit
  return (
    <g className={xcls("si-lit", !!extra)} data-si={`lit:${n.id}`} opacity={group !== undefined ? +group.toFixed(3) : undefined}>
      {smil?.(`lit:${n.id}`)}
      <g style={blendStyle(u)}>
        <defs>
          <radialGradient id={gid} gradientUnits="userSpaceOnUse" cx={f(n.w / 2)} cy={f(h / 2)} r={f(Math.max(n.w, h) * 0.75)}>
            <stop offset="0" {...stop(u, "glowCrest", a)} />
            <stop offset="0.45" {...stop(u, "glow", a * 0.45)} />
            <stop offset="1" {...stop(u, "glow", 0, false)} />
          </radialGradient>
        </defs>
        <rect x={0} y={0} width={n.w} height={h} fill={`url(#${gid})`} />
      </g>
      <rect className="si-lit-rim" x={0.5} y={0.5} width={n.w - 1} height={h - 1} style={{ opacity: +(0.6 * lit).toFixed(3) }} />
    </g>
  )
}

/** The persistent glow of a node: as in the frame, or (animated SVG) at full amplitude under an opacity track. */
function LitSlot({ n, copy, fr, smil }: { n: SceneNode; copy: string; fr?: Frame; smil?: Smil }) {
  const u = useUnion()
  const lit = fr?.lit?.[n.id]
  const tl = useContext(TlCtx)
  if (u && tl?.lit?.[n.id]) return <LitView n={n} copy={copy} lit={1} group={lit ?? 0} extra={!lit} smil={smil} />
  return lit ? <LitView n={n} copy={copy} lit={lit} /> : null
}
const TlCtx = createContext<import("../story/types.ts").Timeline | undefined>(undefined)

/** Spotlight: a soft light over the active target (after labels, before pulses). */
function SpotLayer({ fr, copy, smil }: { fr?: Frame; copy: string; smil?: Smil }) {
  const u = useUnion()
  const tl = useContext(TlCtx)
  const s0 = fr?.spot
  // Animated SVG: one circle at the peak amplitude; its opacity track carries a / peak.
  const peak = 0.06
  const s = s0 ?? (u && tl?.spot?.length ? { x: tl.spot[0].x, y: tl.spot[0].y, r: tl.spot[0].r, a: 0 } : undefined)
  if (!s) return null
  const a = u ? peak : s.a
  const id = `si-spot-${copy}`.replace(/[^\w-]/g, "_")
  return (
    <g className={xcls("si-spot", !!u && !s0)} style={blendStyle(u, { pointerEvents: "none" })} aria-hidden="true" opacity={u ? +(s.a / peak).toFixed(3) : undefined}>
      {smil?.("spot")}
      <defs>
        <radialGradient id={id} gradientUnits="objectBoundingBox" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" {...stop(u, "glowCrest", a)} />
          <stop offset="0.5" {...stop(u, "glowCrest", +(a * 0.4).toFixed(4))} />
          <stop offset="1" {...stop(u, "glowCrest", 0, false)} />
        </radialGradient>
      </defs>
      <circle cx={s.x} cy={s.y} r={s.r} fill={`url(#${id})`}>
        {smil?.("spotc")}
      </circle>
    </g>
  )
}

/** Rest / story level of a node: dim channel (`lvl`, else muted → 0.42) × visibility channel. */
function nodeLevel(n: Pick<SceneNode, "id" | "muted">, fr?: Frame): number | undefined {
  const l = fr?.lvl?.[n.id] ?? (n.muted ? G.muted : undefined)
  const v = fr?.vis?.[n.id]
  if (l === undefined && v === undefined) return undefined
  return (l ?? 1) * (v ?? 1)
}

/** Typed (target|version) → mode, from the scene's timeline (decides clip / per-word markup). */
type Typed = Map<string, "char" | "word">
const typedOf = (scene: Scene): Typed => new Map((scene.timeline?.typing ?? []).map((r) => [`${r.target}|${r.v}`, r.by]))
const clipId = (copy: string, ...parts: (string | number)[]) => `si-clip-${copy}-${parts.join("-")}`.replace(/[^\w-]/g, "_")

function Icon({ name, x, y, cls = "si-icon" }: { name: IconName; x: number; y: number; cls?: string }) {
  return <path className={cls} d={ICON_PATHS[name]} transform={`translate(${f(x)} ${f(y)})`} />
}

/** Faces of rich shapes: window (face + header strip + rule) and chip (stack sheets, double rule). */
function RichFace({ n }: { n: SceneNode }) {
  const { w, h } = n
  if (n.shape === "chip") {
    const fh = n.stack ? h - n.stack * G.stackStep : h
    const i = G.panelInset
    const sheets = []
    for (let k = n.stack ?? 0; k >= 1; k--)
      sheets.push(<rect key={k} className="si-chip-sheet" x={4 * k} y={G.stackStep * k} width={w - 8 * k} height={fh} />)
    return (
      <>
        {sheets}
        <rect className="si-face" x={0} y={0} width={w} height={fh} />
        <rect className="si-inset" x={i} y={i} width={w - 2 * i} height={fh - 2 * i} />
      </>
    )
  }
  const hh = n.header?.h ?? G.headerH
  return (
    <>
      <rect className="si-win" x={0} y={0} width={w} height={h} />
      <rect className="si-win-head" x={0.5} y={0.5} width={w - 1} height={hh - 0.5} />
      <line className="si-win-rule" x1={0} x2={w} y1={hh} y2={hh} />
    </>
  )
}

/**
 * Content layers to render. Normally the frame's; in the animated SVG every version the story
 * ever shows (version 0, each set, each typed one), those absent from the frame as extras at 0.
 */
function unionLayers(u: Union | undefined, tl: import("../story/types.ts").Timeline | undefined, target: string, layers: ContentLayer[]): { l: ContentLayer; extra: boolean }[] {
  if (!u || !tl) return layers.map((l) => ({ l, extra: false }))
  const vs = new Set([0, ...(tl.versions?.[target] ?? []).map((e) => e.v).filter((v) => v >= 0), ...(tl.typing ?? []).filter((r) => r.target === target).map((r) => r.v)])
  if (vs.size === 1 && !(tl.typing ?? []).some((r) => r.target === target)) return layers.map((l) => ({ l, extra: false }))
  return [...vs].sort((a, b) => a - b).map((v) => {
    const l = layers.find((x) => x.v === v)
    return l ? { l, extra: false } : { l: { v, o: 0 }, extra: true }
  })
}

const layerStyle = (o: number): CSSProperties | undefined => (o < 1 ? { opacity: +Math.max(0, o).toFixed(3) } : undefined)

/** Label versions (story `set` label) as crossfading layers. */
function labelLayers(n: SceneNode, fr?: Frame): { text: string; o: number; v: number }[] {
  const layers = fr?.content?.[`${n.id}@label`] ?? [{ v: 0, o: 1 }]
  const all = n.labels ?? [n.label]
  return layers.map((l) => ({ text: (all[l.v] ?? n.label).join(" "), o: l.o, v: l.v }))
}

function RichBody({ n, copy, fr, smil, flash, typed }: { n: SceneNode; copy: string; fr?: Frame; smil?: Smil; flash?: number; typed: Typed }) {
  if (n.shape === "chip") {
    const fh = n.stack ? n.h - n.stack * G.stackStep : n.h
    return (
      <>
        {n.icon ? <Icon name={n.icon} x={G.chipPadX} y={fh / 2 - 6} cls="si-icon si-chip-icon" /> : null}
        {labelLayers(n, fr).map((l) => (
          <text key={l.v} className="si-chip-label" x={f(n.text.cx)} y={f(n.text.labelY[0])} style={{ ...flashFill(flash, "ink"), ...layerStyle(l.o) }}>
            {l.text}
            {smil?.(`flash:${n.id}`)}
          </text>
        ))}
      </>
    )
  }
  const hh = n.header?.h ?? G.headerH
  const titleX = G.panelPadX + (n.icon ? G.iconW : 0)
  return (
    <>
      {n.icon ? <Icon name={n.icon} x={G.panelPadX} y={hh / 2 - 6} /> : null}
      {labelLayers(n, fr).map((l) => (
        <text key={l.v} className="si-win-title" x={titleX} y={f(hh / 2 + T.header * 0.36)} style={layerStyle(l.o)}>
          {l.v === 0 && n.header ? n.header.title : l.text.toUpperCase()}
        </text>
      ))}
      {n.rows?.map((r) => <RowView key={r.id} n={n} r={r} fr={fr} smil={smil} copy={copy} typed={typed} />)}
      {n.code ? <CodeView n={n} copy={copy} fr={fr} smil={smil} typed={typed} /> : null}
    </>
  )
}

const ADV_ROW = T.row * 0.6
const ADV_CODE = T.code * 0.6

/** One version of a row's text: plain, per-word (word typing) or clipped per line (char typing). */
function RowText({ n, r, v, layer, copy, typed, flash, smil }: { n: SceneNode; r: SceneRow; v: number; layer: ContentLayer; copy: string; typed: Typed; flash?: number; smil?: Smil }) {
  const fl = flashFill(flash, "ink")
  const key = `${n.id}#${r.id}`
  const ver = r.versions[v]
  if (!ver) return null
  const mode = typed.get(`${key}|${v}`)
  let off = 0
  let wi = 0
  return (
    <>
      {ver.lines.map((line, k) => {
        const a = off
        off += line.length + 1
        const s0 = ver.split === undefined ? line.length : Math.max(0, Math.min(line.length, ver.split - a))
        if (mode === "word") {
          const words = [...line.matchAll(/\S+/g)]
          return (
            <text key={k} className="si-row-text" y={r.lineY[k]}>
              {words.map((m) => {
                const i = wi++
                const o = layer.words?.[i] ?? 1
                return (
                  <tspan key={m.index} x={f(r.x + m.index! * ADV_ROW)} className={m.index! >= s0 ? "si-row-detail" : undefined} fillOpacity={o < 1 ? +o.toFixed(3) : undefined} style={m.index! >= s0 ? undefined : fl}>
                    {m[0]}
                    {smil?.(`word:${key}:${v}:${i}`)}
                    {m.index! >= s0 ? null : smil?.(`rflash:${key}`)}
                  </tspan>
                )
              })}
            </text>
          )
        }
        const main = line.slice(0, s0)
        const det = line.slice(s0)
        const text = (
          <text key={k} className="si-row-text" x={f(r.x)} y={r.lineY[k]}>
            {main ? (
              <tspan style={fl}>
                {main}
                {smil?.(`rflash:${key}`)}
              </tspan>
            ) : null}
            {det ? <tspan className="si-row-detail">{det}</tspan> : null}
          </text>
        )
        if (mode !== "char") return text
        const id = clipId(copy, n.id, r.id, v, k)
        const ch = layer.chars?.[k] ?? line.length
        return (
          <g key={k} clipPath={`url(#${id})`}>
            <clipPath id={id}>
              <rect x={f(r.x)} y={f(r.lineY[k] - G.rowLH + 4)} width={f(ch >= line.length ? (line.length + 1) * ADV_ROW : ch * ADV_ROW)} height={G.rowLH}>
                {smil?.(`clip:${key}:${v}:${k}`)}
              </rect>
            </clipPath>
            {text}
          </g>
        )
      })}
    </>
  )
}

function RowView({ n, r, fr, smil, copy, typed }: { n: SceneNode; r: SceneRow; fr?: Frame; smil?: Smil; copy: string; typed: Typed }) {
  const u = useUnion()
  const tl = useContext(TlCtx)
  const key = `${n.id}#${r.id}`
  const v = fr?.el[key]
  const lvl = (fr?.lvl?.[key] ?? (r.muted ? G.muted : 1)) * (fr?.vis?.[key] ?? 1)
  const sf: StatusFrame | undefined = fr?.status?.[key] ?? (r.status && r.status !== "none" ? { s: r.status, o: 1 } : undefined)
  const layers = fr?.content?.[key] ?? [{ v: 0, o: 1 }]
  const sh = sf?.shimmer
  const flash = fr?.flash[key]
  // Tag and icon belong to the row slot; a word-typed version brings them in as typing starts.
  const tagO = layers.length ? Math.max(...layers.map((l) => (l.tag ?? 1) * l.o)) : 0
  return (
    <g className="si-row" data-si={`row:${key}`} transform={v?.dy ? `translate(0 ${f(v.dy)})` : undefined} style={opStyle(v, lvl < 1 ? lvl : undefined)}>
      {smil?.(`row:${key}`)}
      {r.icon && r.iconY !== undefined ? (
        <g style={layerStyle(tagO)}>
          {smil?.(`ricon:${key}`)}
          <Icon name={r.icon} x={G.panelPadX} y={r.iconY - 6} />
        </g>
      ) : null}
      {unionLayers(u, tl, key, layers).map(({ l, extra }) => {
        const ver = r.versions[l.v]
        // A running shimmer dips the base text while the highlight sweeps over the label.
        const o = l.o * (sh ? 1 - SHIMMER.dip * sh.a : 1)
        return (
          <g key={l.v} className={xcls(undefined, extra)} data-v={l.v} style={extra ? undefined : layerStyle(o)} opacity={extra ? 0 : undefined}>
            {smil?.(`layer:${key}:${l.v}`)}
            {ver?.tag && r.tagY !== undefined ? (
              <text className="si-row-tag" x={f(r.x)} y={r.tagY} style={layerStyle(l.tag ?? 1)}>
                {ver.tag}
                {smil?.(`rtag:${key}:${l.v}`)}
              </text>
            ) : null}
            <RowText n={n} r={r} v={l.v} layer={l} copy={copy} typed={typed} flash={flash} smil={smil} />
          </g>
        )
      })}
      {sh ? (
        <Shimmer n={n} r={r} v={layers[layers.length - 1]?.v ?? 0} copy={copy} a={sh.a} x={sh.x} smil={smil} />
      ) : u && tl?.status?.[key]?.some((e) => e.to === "running") || (u && r.status === "running") ? (
        <Shimmer n={n} r={r} v={layers[layers.length - 1]?.v ?? 0} copy={copy} a={0} x={0} smil={smil} extra />
      ) : null}
      {fr?.caret
        ?.filter((c) => c.target === key)
        .map((c) => <rect key="caret" className="si-caret" x={f(r.x + c.col * ADV_ROW)} y={f(r.lineY[c.line] - 11)} width={1.5} height={13} />)}
      {u && (tl?.typing ?? []).some((x) => x.target === key && x.by === "char") ? (
        <rect className="si-caret si-x" x={f(r.x)} y={f(r.lineY[0] - 11)} width={1.5} height={13} visibility="hidden">
          {smil?.(`caret:${key}`)}
        </rect>
      ) : null}
      {u ? (
        <StatusGlyphs k={key} r={r} sf={sf} smil={smil} />
      ) : (
        <>
          {sf?.prev ? <StatusGlyph s={sf.prev.s} o={sf.prev.o} spin={sf.prev.spin} x={r.statusX} y={r.anchorY} /> : null}
          {sf ? <StatusGlyph s={sf.s} o={sf.o} spin={sf.spin} draw={sf.draw} x={r.statusX} y={r.anchorY} /> : null}
        </>
      )}
    </g>
  )
}

/** Animated SVG: every glyph the row ever shows; the base frame's at its opacity, others as extras. */
function StatusGlyphs({ k, r, sf, smil }: { k: string; r: SceneRow; sf?: StatusFrame; smil?: Smil }) {
  const tl = useContext(TlCtx)
  const kinds = [...new Set([r.status ?? "none", ...(tl?.status?.[k] ?? []).map((e) => e.to)])].filter((x) => x !== "none") as RowStatus[]
  return (
    <>
      {kinds.map((g) => {
        const o = sf?.s === g ? sf.o : sf?.prev?.s === g ? sf.prev.o : 0
        return <StatusGlyph key={g} s={g} o={o} spin={sf?.s === g ? sf.spin : undefined} x={r.statusX} y={r.anchorY} extra={o <= 0.001} smil={smil} hook={`${k}:${g}`} />
      })}
    </>
  )
}

/** Spinner arc (rotated by `spin`), check or cross (drawn on by `draw`). */
function StatusGlyph({ s, o, spin, draw, x, y, extra, smil, hook }: { s: RowStatus; o: number; spin?: number; draw?: number; x: number; y: number; extra?: boolean; smil?: Smil; hook?: string }) {
  if (s === "none" || (o <= 0.001 && !extra)) return null
  const rot = spin ? ` rotate(${spin})` : ""
  return (
    <g className={xcls(`si-status si-status-${s}`, !!extra)} transform={`translate(${f(x)} ${f(y)})${rot}`} style={extra ? undefined : layerStyle(o)} opacity={extra ? 0 : undefined}>
      {hook ? smil?.(`status:${hook}`) : null}
      <path d={STATUS_PATHS[s]} pathLength={draw !== undefined ? 1 : undefined} strokeDasharray={draw !== undefined ? "1 1" : undefined} strokeDashoffset={draw !== undefined ? +(1 - draw).toFixed(3) : undefined}>
        {hook ? smil?.(`draw:${hook}`) : null}
      </path>
    </g>
  )
}

/** Shimmer copy of a running row's main text (not the detail): a repeating gradient sweep. */
function Shimmer({ n, r, v, copy, a, x, smil, extra }: { n: SceneNode; r: SceneRow; v: number; copy: string; a: number; x: number; smil?: Smil; extra?: boolean }) {
  const u = useUnion()
  const key = `${n.id}#${r.id}`
  const ver = r.versions[v]
  if (!ver) return null
  const id = `si-shim-${copy}-${n.id}-${r.id}`.replace(/[^\w-]/g, "_")
  let off = 0
  return (
    <g className={xcls("si-shimmer", !!extra)} style={extra ? undefined : layerStyle(SHIMMER.peak * a)} opacity={extra ? 0 : undefined} aria-hidden="true">
      {smil?.(`shim:${key}`)}
      <defs>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={f(r.x)} x2={f(r.x + SHIMMER.width)} y1={0} y2={0} spreadMethod="repeat" gradientTransform={`translate(${f(x)} 0)`}>
          {smil?.(`shimx:${key}`)}
          <stop offset="0" {...stop(u, "shimmer", 0, false)} />
          <stop offset="0.5" {...stop(u, "shimmer", 1, false)} />
          <stop offset="1" {...stop(u, "shimmer", 0, false)} />
        </linearGradient>
      </defs>
      {ver.lines.map((line, k) => {
        const a0 = off
        off += line.length + 1
        const s0 = ver.split === undefined ? line.length : Math.max(0, Math.min(line.length, ver.split - a0))
        const main = line.slice(0, s0).trimEnd()
        return main ? (
          <text key={k} className="si-row-text si-shimmer-text" x={f(r.x)} y={r.lineY[k]} fill={`url(#${id})`} style={{ fill: `url(#${id})` }}>
            {main}
          </text>
        ) : null
      })}
    </g>
  )
}

function CodeLineText({ line, x, y }: { line: CodeLine; x: number; y: number }) {
  return (
    <text className="si-code-line" x={f(x + (line[0]?.c ?? 0) * ADV_CODE)} y={f(y)}>
      {line.map((tk, k) => (
        <tspan key={k} className={tk.k ? `si-tk-${tk.k}` : undefined} x={f(x + tk.c * ADV_CODE)}>
          {tk.t}
        </tspan>
      ))}
    </text>
  )
}

function CodeView({ n, fr, smil, copy, typed }: { n: SceneNode; copy: string; fr?: Frame; smil?: Smil; typed: Typed }) {
  const u = useUnion()
  const tl = useContext(TlCtx)
  const c = n.code!
  const layers = fr?.content?.[n.id] ?? [{ v: 0, o: 1 }]
  const base = (k: number) => c.top + (k + 0.5) * c.lh + T.code * 0.35
  const bar0 = fr?.bars?.[n.id]
  const tb = u ? tl?.bars?.[n.id] : undefined
  const bar = bar0 ?? (tb?.length ? { a: tb[tb.length - 1].a, b: tb[tb.length - 1].b, o: 0 } : undefined)
  const barX = !bar0 && !!bar
  return (
    <g className="si-code" data-si={`code:${n.id}`}>
      {smil?.(`code:${n.id}`)}
      {bar ? (
        <g className={xcls("si-bar", barX)} style={barX ? undefined : layerStyle(bar.o)} opacity={barX ? 0 : undefined}>
          {smil?.(`bar:${n.id}`)}
          <rect className="si-code-bar" x={1} y={f(c.top + (bar.a - 1) * c.lh)} width={n.w - 2} height={f((bar.b - bar.a + 1) * c.lh)}>
            {smil?.(`barrect:${n.id}`)}
          </rect>
          <rect className="si-code-bar-edge" x={1} y={f(c.top + (bar.a - 1) * c.lh)} width={2} height={f((bar.b - bar.a + 1) * c.lh)}>
            {smil?.(`barrect:${n.id}`)}
          </rect>
        </g>
      ) : null}
      {unionLayers(u, tl, n.id, layers).map(({ l, extra }) => {
        const ver = c.versions[l.v]
        if (!ver) return null
        const clip = typed.get(`${n.id}|${l.v}`) === "char"
        return (
          <g key={l.v} className={xcls(undefined, extra)} data-v={l.v} style={extra ? undefined : layerStyle(l.o)} opacity={extra ? 0 : undefined}>
            {smil?.(`layer:${n.id}:${l.v}`)}
            {ver.map((line, k) => {
              if (!line.length) return null
              const text = <CodeLineText key={k} line={line} x={c.x} y={base(k)} />
              if (!clip) return text
              const id = clipId(copy, n.id, l.v, k)
              const end = line[line.length - 1].c + line[line.length - 1].t.length
              const ch = l.chars?.[k]
              const cols = ch === undefined ? end + 1 : line[0].c + ch
              return (
                <g key={k} clipPath={`url(#${id})`}>
                  <clipPath id={id}>
                    <rect x={f(c.x)} y={f(c.top + k * c.lh)} width={f(ch === 0 ? 0 : cols * ADV_CODE)} height={c.lh}>
                      {smil?.(`clip:${n.id}:${l.v}:${k}`)}
                    </rect>
                  </clipPath>
                  {text}
                </g>
              )
            })}
          </g>
        )
      })}
      {fr?.caret
        ?.filter((x) => x.target === n.id)
        .map((x) => <rect key="caret" className="si-caret" x={f(c.x + x.col * ADV_CODE)} y={f(c.top + x.line * c.lh + (c.lh - 13) / 2)} width={1.5} height={13} />)}
      {u && (tl?.typing ?? []).some((x) => x.target === n.id && x.by === "char") ? (
        <rect className="si-caret si-x" x={f(c.x)} y={f(c.top + (c.lh - 13) / 2)} width={1.5} height={13} visibility="hidden">
          {smil?.(`caret:${n.id}`)}
        </rect>
      ) : null}
    </g>
  )
}

function GroupView({ g, fr, smil }: { g: SceneGroup; fr?: Frame; smil?: Smil }) {
  const labelText = g.composite ? g.label : g.label.toUpperCase()
  const v = fr?.el[g.id]
  const l = fr?.lvl?.[g.id] !== undefined || fr?.vis?.[g.id] !== undefined ? (fr?.lvl?.[g.id] ?? 1) * (fr?.vis?.[g.id] ?? 1) : undefined
  return (
    <g className="si-grp" data-si={`group:${g.id}`} style={opStyle(v, l)} transform={v?.dy ? `translate(0 ${f(v.dy)})` : undefined}>
      {smil?.(`group:${g.id}`)}
      {g.bare ? null : <rect className={g.composite ? "si-group-composite" : "si-group"} x={g.x} y={g.y} width={g.w} height={g.h} rx={G.groupRadius} />}
      {g.composite ? (
        <line className="si-group-rule" x1={g.x} x2={g.x + g.w} y1={g.y + 24} y2={g.y + 24} />
      ) : null}
      <text className={g.composite ? "si-group-title" : "si-group-label"} x={f(g.x + 12)} y={f(g.y + (g.composite ? 16 : 15))}>
        {labelText}
        {g.kind && !g.composite ? <tspan className="si-group-label" dx={8} opacity={0.7}>{`· ${g.kind.toUpperCase()}`}</tspan> : null}
      </text>
    </g>
  )
}

function EdgeView({ e, fr, smil, lvl }: { e: SceneEdge; fr?: Frame; smil?: Smil; lvl?: number }) {
  const cls = `si-wire${e.style === "dashed" ? " si-dashed" : e.style === "thick" ? " si-thick" : ""}`
  const d = fr?.draw[e.id]
  const drawing = d !== undefined
  const u = fr?.undraw?.[e.id]
  // Draw-on: a solid dash grows along the path; dashed wires reveal through a mask-free dash offset.
  const L = (e.length ?? 0) + 24
  // Retract (unwire): the dash slides off the source end first.
  const wireStyle: CSSProperties | undefined = u !== undefined
    ? u >= 1
      ? { opacity: 0 }
      : e.style === "dashed"
        ? { opacity: +Math.max(0, 1 - u * 1.4).toFixed(3) }
        : { strokeDasharray: `${f(L)} ${f(L)}`, strokeDashoffset: f(-L * u) }
    : drawing
    ? d <= 0
      ? { opacity: 0 }
      : e.style === "dashed"
        ? { opacity: +Math.min(1, d * 1.4).toFixed(3) }
        : { strokeDasharray: `${f(L)} ${f(L)}`, strokeDashoffset: f(L * (1 - d)) }
    : undefined
  return (
    <g className="si-edge" data-si={`edge:${e.id}`} style={lvl !== undefined && lvl < 1 ? { opacity: +lvl.toFixed(3) } : undefined}>
      {smil?.(`edge:${e.id}`)}
      <path className={cls} d={e.d} style={wireStyle}>
        {smil?.(`wire:${e.id}`)}
      </path>
      {e.heads.map((h, k) => (
        <g key={k} style={drawing ? { opacity: d >= 0.98 ? 1 : 0 } : undefined}>
          {smil?.(`head:${e.id}`)}
          <Head h={h} />
        </g>
      ))}
      {e.seq !== undefined ? (
        <g style={drawing ? { opacity: d > 0 ? 1 : 0 } : undefined}>
          {smil?.(`seq:${e.id}`)}
          <circle className="si-seq" cx={e.points[0].x} cy={e.points[0].y} r={7} />
          <text className="si-seq-text" x={e.points[0].x} y={e.points[0].y + 3} textAnchor="middle">
            {e.seq}
          </text>
        </g>
      ) : null}
    </g>
  )
}

function LabelView({ e, fr, smil }: { e: SceneEdge; fr?: Frame; smil?: Smil }) {
  const l = e.label!
  const text = e.seq !== undefined ? l.text.replace(/^\d+\.\s*/, "") : l.text
  const d = fr?.draw[e.id]
  const o = d === undefined ? 1 : Math.max(0, Math.min(1, (d - 0.35) / 0.4))
  return (
    <g className="si-lbl" data-si={`label:${l.id}`} data-box={`${l.x},${l.y},${l.w},${l.h}`} style={o < 1 ? { opacity: +o.toFixed(3) } : undefined}>
      {smil?.(`elabel:${e.id}`)}
      <rect className={`si-pill si-on-${l.surface ?? "bg"}`} x={l.x} y={l.y} width={l.w} height={l.h} />
      <text className="si-edge-label" x={f(l.x + l.w / 2)} y={f(l.y + l.h / 2 + 3.8)} textAnchor="middle">
        {text}
      </text>
    </g>
  )
}

function FrameBox({ fr, frame, smil }: { fr: SceneFrame; frame?: Frame; smil?: Smil }) {
  return (
    <g className="si-frm" data-si={`frame:${fr.id}`} style={opStyle(frame?.el[fr.id])}>
      {smil?.(`frame:${fr.id}`)}
      <rect className="si-frame" x={fr.x} y={fr.y} width={fr.w} height={fr.h} rx={2} />
      {fr.sections.map((s, k) => (
        <line key={k} className="si-frame-rule" x1={fr.x} x2={fr.x + fr.w} y1={s.y} y2={s.y} />
      ))}
    </g>
  )
}

/** Frame tag and guard labels sit above lifelines and activations. */
function FrameLabels({ fr, frame, smil }: { fr: SceneFrame; frame?: Frame; smil?: Smil }) {
  const tagH = 18
  const tag = fr.kind.toUpperCase()
  const guard = (text: string, x: number, y: number, key?: number) => {
    const w = text.length * 11 * 0.6 + 8
    return (
      <g key={key}>
        <rect className="si-bg" x={f(x - 4)} y={f(y - 11)} width={f(w)} height={15} rx={2} />
        <text className="si-frame-label" x={f(x)} y={f(y)}>
          {text}
        </text>
      </g>
    )
  }
  return (
    <g className="si-frm-labels" data-si={`frame-label:${fr.id}`} style={opStyle(frame?.el[fr.id])}>
      {smil?.(`frame:${fr.id}`)}
      <path className="si-frame-tag" d={`M${fr.x} ${fr.y}H${f(fr.x + fr.tagW)}V${fr.y + tagH - 5}L${f(fr.x + fr.tagW - 5)} ${fr.y + tagH}H${fr.x}Z`} />
      <text className="si-frame-kind" x={f(fr.x + 8)} y={fr.y + 12.5}>
        {tag}
      </text>
      {fr.label ? guard(`[${fr.label}]`, fr.x + fr.tagW + 8, fr.y + 13) : null}
      {fr.sections.map((s, k) => (s.label ? guard(`[${s.label}]`, fr.x + 8, s.y + 15, k) : null))}
    </g>
  )
}

/** Pure SVG view of a scene. Rendered on the server (static SVG) and hydrated in the viewer. */
function PulseLayer({ fr }: { fr: Frame }) {
  if (!fr.pulses.length) return null
  return (
    <g className="si-pulses">
      {fr.pulses.map((p) => (
        <g key={p.id} data-si={`pulse:${p.id}`}>
          {p.trail.map((t, k) => (
            <path key={k} className="si-trail" d={t.d} style={{ opacity: t.o }} />
          ))}
          {p.halo && p.halo.o > 0.005 ? <circle className="si-halo" cx={p.x} cy={p.y} r={p.halo.r} style={{ opacity: p.halo.o }} /> : null}
          {p.o > 0.005 && !p.ring ? <circle className="si-pulse" cx={p.x} cy={p.y} r={p.r} style={{ opacity: p.o }} /> : null}
          {p.ring ? <circle className="si-ring-pulse" cx={p.ring.x} cy={p.ring.y} r={p.ring.r} style={{ opacity: p.ring.o, strokeWidth: p.ring.w }} /> : null}
        </g>
      ))}
    </g>
  )
}

export function Diagram(props: DiagramProps): ReactElement {
  return (
    <UnionCtx.Provider value={props.union}>
      <TlCtx.Provider value={props.scene.timeline}>
        <DiagramInner {...props} />
      </TlCtx.Provider>
    </UnionCtx.Provider>
  )
}

function DiagramInner({ scene, style, copy = "", className, frame, smil, union }: DiagramProps): ReactElement {
  const vb = scene.viewBox
  const has = (o?: object) => !!o && Object.keys(o).length > 0
  const fr =
    frame &&
    (has(frame.el) || has(frame.draw) || has(frame.grow) || frame.pulses.length || frame.glows.length || has(frame.flash) || has(frame.counters) ||
      has(frame.lvl) || has(frame.vis) || has(frame.content) || has(frame.status) || has(frame.bars) || has(frame.lit) || has(frame.undraw) || frame.caret?.length || frame.spot)
      ? frame
      : undefined
  // Ports follow their wire: the out port appears as the wire starts, the in port when it lands.
  const portOpacity = (p: Scene["ports"][number]) => {
    const d = fr?.draw[p.edge]
    if (d === undefined) return undefined
    const o = p.end === "out" ? (d > 0 ? 1 : 0) : d >= 0.99 ? 1 : 0
    return o < 1 ? { opacity: o } : undefined
  }
  const partOf = (id: string) => fr?.el[id]
  // Muted / dimmed endpoints dim their wires and ports (node levels only).
  const nodeById = new Map(scene.nodes.map((n) => [n.id, n]))
  const edgeLevel = (id: string): number | undefined => {
    const e = scene.edges.find((x) => x.id === id)
    if (!e) return undefined
    const la = nodeById.get(e.from)
    const lb = nodeById.get(e.to)
    const a = la ? nodeLevel(la, fr) : undefined
    const b = lb ? nodeLevel(lb, fr) : undefined
    const own = fr?.lvl?.[id] !== undefined || fr?.vis?.[id] !== undefined ? (fr?.lvl?.[id] ?? 1) * (fr?.vis?.[id] ?? 1) : undefined
    if (a === undefined && b === undefined && own === undefined) return undefined
    return Math.min(a ?? 1, b ?? 1) * (own ?? 1)
  }
  const typed = typedOf(scene)
  const portStyle = (p: Scene["ports"][number]): CSSProperties | undefined => {
    const u = fr?.undraw?.[p.edge]
    // Retract: the out port goes as the retract starts, the in port when it ends.
    if (u !== undefined && (p.end === "out" ? u > 0 : u >= 0.99)) return { opacity: 0 }
    const base = portOpacity(p)
    const l = edgeLevel(p.edge)
    if (l === undefined || l >= 1) return base
    const o = ((base?.opacity as number | undefined) ?? 1) * l
    return { opacity: +o.toFixed(3) }
  }
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={`storyink${className ? ` ${className}` : ""}`}
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      width={vb.w}
      height={vb.h}
      role="img"
      aria-label={scene.title}
      data-storyink={scene.type}
      data-copy={copy || undefined}
    >
      {/* Accessible name via role="img" + aria-label only: an SVG <title> shows as a hover tooltip. */}
      {style ? <style>{style}</style> : null}
      <rect className="si-bg" x={vb.x} y={vb.y} width={vb.w} height={vb.h} />
      <g className="si-bands">
        {scene.boxes.map((b) => (
          <g key={b.id} data-si={`box:${b.id}`}>
            <rect className="si-group" x={b.x} y={b.y} width={b.w} height={b.h} />
            {b.label ? (
              <text className="si-group-label" x={f(b.x + 8)} y={f(b.y + 14)}>
                {b.label.toUpperCase()}
              </text>
            ) : null}
          </g>
        ))}
        {scene.bands.map((b) => (
          <g key={b.id} data-si={`band:${b.id}`}>
            <rect className="si-band" x={b.x} y={b.y} width={b.w} height={b.h} />
            {b.label ? (
              <text className="si-group-label" x={f(b.x + 8)} y={f(b.y + 13)}>
                {b.label.toUpperCase()}
              </text>
            ) : null}
          </g>
        ))}
      </g>
      <g className="si-groups">
        {scene.groups.map((g) => (
          <GroupView key={g.id} g={g} fr={fr} smil={smil} />
        ))}
      </g>
      <g className="si-frames">
        {scene.frames.map((fr) => (
          <FrameBox key={fr.id} fr={fr} frame={frame} smil={smil} />
        ))}
      </g>
      <g className="si-lifelines">
        {scene.lifelines.map((l) => (
          <line key={l.id} className="si-life" data-si={`lifeline:${l.id}`} x1={l.x} x2={l.x} y1={l.y1} y2={l.y2} style={opStyle(partOf(l.participant))}>
            {smil?.(`life:${l.participant}`)}
          </line>
        ))}
      </g>
      <g className="si-activations">
        {scene.activations.map((a) => (
          <rect key={a.id} className="si-act" data-si={`activation:${a.id}`} x={a.x} y={a.y} width={a.w} height={frame?.grow[a.id] ?? a.h} rx={1} style={opStyle(partOf(a.id))}>
            {smil?.(`act:${a.id}`)}
          </rect>
        ))}
      </g>
      <g className="si-frame-labels">
        {scene.frames.map((fr) => (
          <FrameLabels key={fr.id} fr={fr} frame={frame} smil={smil} />
        ))}
      </g>
      <g className="si-edges">
        {scene.edges.map((e) => (
          <EdgeView key={e.id} e={e} fr={fr} smil={smil} lvl={edgeLevel(e.id)} />
        ))}
      </g>
      <g className="si-nodes">
        {scene.nodes.map((n) => (
          <NodeView key={n.id} n={n} copy={copy} fr={fr} smil={smil} typed={typed} />
        ))}
      </g>
      <g className="si-ports">
        {scene.ports.filter((p) => !p.covered).map((p) => (
          <circle key={p.id} className="si-port" data-si={`port:${p.id}`} cx={p.x} cy={p.y} r={G.portRadius} style={portStyle(p)}>
            {smil?.(`port:${p.id}`)}
          </circle>
        ))}
      </g>
      <g className="si-labels">
        {scene.edges
          .filter((e) => e.label)
          .map((e) => (
            <LabelView key={e.id} e={e} fr={fr} smil={smil} />
          ))}
      </g>
      {fr?.spot || union ? <SpotLayer fr={fr} copy={copy} smil={smil} /> : null}
      {fr ? <PulseLayer fr={fr} /> : null}
      {smil?.("overlay")}
    </svg>
  )
}
