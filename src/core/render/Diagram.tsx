import type { CSSProperties, ReactElement } from "react"
import type { Frame } from "../story/types.ts"
import { geometry as G } from "../../theme/tokens.ts"
import type { Arrowhead, Scene, SceneEdge, SceneFrame, SceneGroup, SceneNode } from "../scene.ts"
import { r2 } from "../layout/measure.ts"

export interface DiagramProps {
  scene: Scene
  /** Inline <style> (fonts, theme vars, rules) for standalone SVG. */
  style?: string
  /** Unique prefix when several copies share a page (contact sheet). */
  copy?: string
  className?: string
  /** Storyboard frame; omitted = the resting (static) diagram. */
  frame?: Frame
}

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

function NodeView({ n, copy, fr }: { n: SceneNode; copy: string; fr?: Frame }) {
  const cx = n.text.cx
  const actorIcon = n.shape === "actor" && n.tag
  const tagW = n.tag.length * 9.5 * 0.68
  const v = fr?.el[n.id]
  const flash = fr?.flash[n.id]
  const glows = fr?.glows.filter((g) => g.node === n.id) ?? []
  const counterText = n.counter ? (fr?.counters[n.counter.id] ?? `${n.counter.prefix ?? ""}${n.counter.value}${n.counter.suffix ?? ""}`) : undefined
  return (
    <g
      className={`si-node si-a-${n.accent}`}
      data-si={`node:${n.id}`}
      data-copy={copy || undefined}
      data-box={`${n.x},${n.y},${n.w},${n.h}`}
      transform={`translate(${n.x} ${f(n.y + (v?.dy ?? 0))})`}
      style={opStyle(v)}
    >
      <NodeShape n={n} />
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
      {actorIcon ? (
        <g transform={`translate(${f(cx - tagW / 2 - 13)} ${f(n.text.tagY - 8)})`}>
          <circle className="si-glyph" cx={4.5} cy={2.5} r={2.3} />
          <path className="si-glyph" d="M0.5 9.5C0.5 6.8 2.3 5.6 4.5 5.6S8.5 6.8 8.5 9.5" />
        </g>
      ) : null}
      {n.tag ? (
        <text className="si-tag" x={f(actorIcon ? cx + 6 : cx)} y={f(n.text.tagY)} textAnchor="middle">
          {n.tag}
        </text>
      ) : null}
      {n.label.map((line, k) => (
        <text key={`l${k}`} className={n.shape === "pill" ? "si-label si-pill-label" : "si-label"} x={f(cx)} y={f(n.text.labelY[k])} textAnchor="middle" style={flashFill(flash, "ink")}>
          {line}
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
        </text>
      ) : null}
    </g>
  )
}

function GroupView({ g, fr }: { g: SceneGroup; fr?: Frame }) {
  const labelText = g.composite ? g.label : g.label.toUpperCase()
  const v = fr?.el[g.id]
  return (
    <g className="si-grp" data-si={`group:${g.id}`} style={opStyle(v)} transform={v?.dy ? `translate(0 ${f(v.dy)})` : undefined}>
      <rect className={g.composite ? "si-group-composite" : "si-group"} x={g.x} y={g.y} width={g.w} height={g.h} rx={G.groupRadius} />
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

function EdgeView({ e, fr }: { e: SceneEdge; fr?: Frame }) {
  const cls = `si-wire${e.style === "dashed" ? " si-dashed" : e.style === "thick" ? " si-thick" : ""}`
  const d = fr?.draw[e.id]
  const drawing = d !== undefined
  // Draw-on: a solid dash grows along the path; dashed wires reveal through a mask-free dash offset.
  const L = (e.length ?? 0) + 24
  const wireStyle: CSSProperties | undefined = drawing
    ? d <= 0
      ? { opacity: 0 }
      : e.style === "dashed"
        ? { opacity: +Math.min(1, d * 1.4).toFixed(3) }
        : { strokeDasharray: `${f(L)} ${f(L)}`, strokeDashoffset: f(L * (1 - d)) }
    : undefined
  return (
    <g className="si-edge" data-si={`edge:${e.id}`}>
      <path className={cls} d={e.d} style={wireStyle} />
      {e.heads.map((h, k) => (
        <g key={k} style={drawing ? { opacity: d >= 0.98 ? 1 : 0 } : undefined}>
          <Head h={h} />
        </g>
      ))}
      {e.seq !== undefined ? (
        <g style={drawing ? { opacity: d > 0 ? 1 : 0 } : undefined}>
          <circle className="si-seq" cx={e.points[0].x} cy={e.points[0].y} r={7} />
          <text className="si-seq-text" x={e.points[0].x} y={e.points[0].y + 3} textAnchor="middle">
            {e.seq}
          </text>
        </g>
      ) : null}
    </g>
  )
}

function LabelView({ e, fr }: { e: SceneEdge; fr?: Frame }) {
  const l = e.label!
  const text = e.seq !== undefined ? l.text.replace(/^\d+\.\s*/, "") : l.text
  const d = fr?.draw[e.id]
  const o = d === undefined ? 1 : Math.max(0, Math.min(1, (d - 0.35) / 0.4))
  return (
    <g className="si-lbl" data-si={`label:${l.id}`} data-box={`${l.x},${l.y},${l.w},${l.h}`} style={o < 1 ? { opacity: +o.toFixed(3) } : undefined}>
      <rect className={`si-pill si-on-${l.surface ?? "bg"}`} x={l.x} y={l.y} width={l.w} height={l.h} />
      <text className="si-edge-label" x={f(l.x + l.w / 2)} y={f(l.y + l.h / 2 + 3.8)} textAnchor="middle">
        {text}
      </text>
    </g>
  )
}

function FrameBox({ fr, frame }: { fr: SceneFrame; frame?: Frame }) {
  return (
    <g className="si-frm" data-si={`frame:${fr.id}`} style={opStyle(frame?.el[fr.id])}>
      <rect className="si-frame" x={fr.x} y={fr.y} width={fr.w} height={fr.h} rx={2} />
      {fr.sections.map((s, k) => (
        <line key={k} className="si-frame-rule" x1={fr.x} x2={fr.x + fr.w} y1={s.y} y2={s.y} />
      ))}
    </g>
  )
}

/** Frame tag and guard labels sit above lifelines and activations. */
function FrameLabels({ fr, frame }: { fr: SceneFrame; frame?: Frame }) {
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

export function Diagram({ scene, style, copy = "", className, frame }: DiagramProps): ReactElement {
  const vb = scene.viewBox
  const fr = frame && (Object.keys(frame.el).length || Object.keys(frame.draw).length || Object.keys(frame.grow).length || frame.pulses.length || frame.glows.length || Object.keys(frame.flash).length || Object.keys(frame.counters).length) ? frame : undefined
  // Ports follow their wire: the out port appears as the wire starts, the in port when it lands.
  const portOpacity = (p: Scene["ports"][number]) => {
    const d = fr?.draw[p.edge]
    if (d === undefined) return undefined
    const o = p.end === "out" ? (d > 0 ? 1 : 0) : d >= 0.99 ? 1 : 0
    return o < 1 ? { opacity: o } : undefined
  }
  const partOf = (id: string) => fr?.el[id]
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
      <title>{scene.title}</title>
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
          <GroupView key={g.id} g={g} fr={fr} />
        ))}
      </g>
      <g className="si-frames">
        {scene.frames.map((fr) => (
          <FrameBox key={fr.id} fr={fr} frame={frame} />
        ))}
      </g>
      <g className="si-lifelines">
        {scene.lifelines.map((l) => (
          <line key={l.id} className="si-life" data-si={`lifeline:${l.id}`} x1={l.x} x2={l.x} y1={l.y1} y2={l.y2} style={opStyle(partOf(l.participant))} />
        ))}
      </g>
      <g className="si-activations">
        {scene.activations.map((a) => (
          <rect key={a.id} className="si-act" data-si={`activation:${a.id}`} x={a.x} y={a.y} width={a.w} height={frame?.grow[a.id] ?? a.h} rx={1} style={opStyle(partOf(a.id))} />
        ))}
      </g>
      <g className="si-frame-labels">
        {scene.frames.map((fr) => (
          <FrameLabels key={fr.id} fr={fr} frame={frame} />
        ))}
      </g>
      <g className="si-edges">
        {scene.edges.map((e) => (
          <EdgeView key={e.id} e={e} fr={fr} />
        ))}
      </g>
      <g className="si-nodes">
        {scene.nodes.map((n) => (
          <NodeView key={n.id} n={n} copy={copy} fr={fr} />
        ))}
      </g>
      <g className="si-ports">
        {scene.ports.filter((p) => !p.covered).map((p) => (
          <circle key={p.id} className="si-port" data-si={`port:${p.id}`} cx={p.x} cy={p.y} r={G.portRadius} style={portOpacity(p)} />
        ))}
      </g>
      <g className="si-labels">
        {scene.edges
          .filter((e) => e.label)
          .map((e) => (
            <LabelView key={e.id} e={e} fr={fr} />
          ))}
      </g>
      {fr ? <PulseLayer fr={fr} /> : null}
    </svg>
  )
}
