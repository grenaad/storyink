import type { ReactElement } from "react"
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
}

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

function NodeView({ n, copy }: { n: SceneNode; copy: string }) {
  const cx = n.text.cx
  const actorIcon = n.shape === "actor" && n.tag
  const tagW = n.tag.length * 9.5 * 0.68
  return (
    <g
      className={`si-node si-a-${n.accent}`}
      data-si={`node:${n.id}`}
      data-copy={copy || undefined}
      data-box={`${n.x},${n.y},${n.w},${n.h}`}
      transform={`translate(${n.x} ${n.y})`}
    >
      <NodeShape n={n} />
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
        <text key={`l${k}`} className={n.shape === "pill" ? "si-label si-pill-label" : "si-label"} x={f(cx)} y={f(n.text.labelY[k])} textAnchor="middle">
          {line}
        </text>
      ))}
      {n.detail.map((line, k) => (
        <text key={`d${k}`} className="si-detail" x={f(cx)} y={f(n.text.detailY[k])} textAnchor="middle">
          {line}
        </text>
      ))}
    </g>
  )
}

function GroupView({ g }: { g: SceneGroup }) {
  const labelText = g.composite ? g.label : g.label.toUpperCase()
  return (
    <g className="si-grp" data-si={`group:${g.id}`}>
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

function EdgeView({ e }: { e: SceneEdge }) {
  const cls = `si-wire${e.style === "dashed" ? " si-dashed" : e.style === "thick" ? " si-thick" : ""}`
  return (
    <g className="si-edge" data-si={`edge:${e.id}`}>
      <path className={cls} d={e.d} />
      {e.heads.map((h, k) => (
        <Head key={k} h={h} />
      ))}
      {e.seq !== undefined ? (
        <g>
          <circle className="si-seq" cx={e.points[0].x} cy={e.points[0].y} r={7} />
          <text className="si-seq-text" x={e.points[0].x} y={e.points[0].y + 3} textAnchor="middle">
            {e.seq}
          </text>
        </g>
      ) : null}
    </g>
  )
}

function LabelView({ e }: { e: SceneEdge }) {
  const l = e.label!
  const text = e.seq !== undefined ? l.text.replace(/^\d+\.\s*/, "") : l.text
  return (
    <g className="si-lbl" data-si={`label:${l.id}`} data-box={`${l.x},${l.y},${l.w},${l.h}`}>
      <rect className="si-pill" x={l.x} y={l.y} width={l.w} height={l.h} rx={l.h / 2} />
      <text className="si-edge-label" x={f(l.x + l.w / 2)} y={f(l.y + l.h / 2 + 3.8)} textAnchor="middle">
        {text}
      </text>
    </g>
  )
}

function FrameBox({ fr }: { fr: SceneFrame }) {
  return (
    <g className="si-frm" data-si={`frame:${fr.id}`}>
      <rect className="si-frame" x={fr.x} y={fr.y} width={fr.w} height={fr.h} rx={2} />
      {fr.sections.map((s, k) => (
        <line key={k} className="si-frame-rule" x1={fr.x} x2={fr.x + fr.w} y1={s.y} y2={s.y} />
      ))}
    </g>
  )
}

/** Frame tag and guard labels sit above lifelines and activations. */
function FrameLabels({ fr }: { fr: SceneFrame }) {
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
    <g className="si-frm-labels" data-si={`frame-label:${fr.id}`}>
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
export function Diagram({ scene, style, copy = "", className }: DiagramProps): ReactElement {
  const vb = scene.viewBox
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
      <g className="si-groups">
        {scene.groups.map((g) => (
          <GroupView key={g.id} g={g} />
        ))}
      </g>
      <g className="si-frames">
        {scene.frames.map((fr) => (
          <FrameBox key={fr.id} fr={fr} />
        ))}
      </g>
      <g className="si-lifelines">
        {scene.lifelines.map((l) => (
          <line key={l.id} className="si-life" data-si={`lifeline:${l.id}`} x1={l.x} x2={l.x} y1={l.y1} y2={l.y2} />
        ))}
      </g>
      <g className="si-activations">
        {scene.activations.map((a) => (
          <rect key={a.id} className="si-act" data-si={`activation:${a.id}`} x={a.x} y={a.y} width={a.w} height={a.h} rx={1} />
        ))}
      </g>
      <g className="si-frame-labels">
        {scene.frames.map((fr) => (
          <FrameLabels key={fr.id} fr={fr} />
        ))}
      </g>
      <g className="si-edges">
        {scene.edges.map((e) => (
          <EdgeView key={e.id} e={e} />
        ))}
      </g>
      <g className="si-nodes">
        {scene.nodes.map((n) => (
          <NodeView key={n.id} n={n} copy={copy} />
        ))}
      </g>
      <g className="si-ports">
        {scene.ports.filter((p) => !p.covered).map((p) => (
          <circle key={p.id} className="si-port" data-si={`port:${p.id}`} cx={p.x} cy={p.y} r={G.portRadius} />
        ))}
      </g>
      <g className="si-labels">
        {scene.edges
          .filter((e) => e.label)
          .map((e) => (
            <LabelView key={e.id} e={e} />
          ))}
      </g>
    </svg>
  )
}
