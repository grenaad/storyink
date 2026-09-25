import { geometry as G, type as T, type Accent } from "../../theme/tokens.ts"
import type { SceneNode, Shape } from "../scene.ts"
import { snap, textWidth, wrap } from "./measure.ts"

export interface KindStyle {
  shape: Shape
  accent: Accent
  tag: string
}

const KINDS: Record<string, KindStyle> = {
  // architecture / dataflow
  service: { shape: "panel", accent: "blue", tag: "service" },
  function: { shape: "panel", accent: "rose", tag: "function" },
  database: { shape: "cylinder", accent: "gold", tag: "database" },
  store: { shape: "cylinder", accent: "gold", tag: "store" },
  cache: { shape: "panel", accent: "sage", tag: "cache" },
  queue: { shape: "queue", accent: "rose", tag: "queue" },
  client: { shape: "panel", accent: "plain", tag: "client" },
  user: { shape: "actor", accent: "plain", tag: "user" },
  external: { shape: "external", accent: "plain", tag: "external" },
  // workflow
  start: { shape: "pill", accent: "sage", tag: "" },
  end: { shape: "pill", accent: "rose", tag: "" },
  step: { shape: "panel", accent: "blue", tag: "" },
  decision: { shape: "diamond", accent: "gold", tag: "" },
  io: { shape: "slant", accent: "sage", tag: "" },
  // lifecycle
  initial: { shape: "dot", accent: "plain", tag: "" },
  final: { shape: "bullseye", accent: "plain", tag: "" },
  state: { shape: "panel", accent: "blue", tag: "" },
  composite: { shape: "panel", accent: "blue", tag: "" },
  choice: { shape: "choice", accent: "gold", tag: "" },
  fork: { shape: "bar", accent: "plain", tag: "" },
  join: { shape: "bar", accent: "plain", tag: "" },
  // sequence participants
  participant: { shape: "panel", accent: "blue", tag: "" },
  actor: { shape: "actor", accent: "plain", tag: "actor" },
  note: { shape: "note", accent: "gold", tag: "" },
}

export function kindStyle(kind: string): KindStyle {
  return KINDS[kind] ?? KINDS.service
}

const LABEL_LH = Math.round(T.label * T.lineHeight)
const DETAIL_LH = Math.round(T.detail * T.lineHeight)
const TAG_H = 14

export interface NodeInput {
  id: string
  kind: string
  label: string
  detail?: string
  tag?: string
}

/** Size a node and lay out its text. Coordinates are filled in later. */
export function sizeNode(n: NodeInput, opts: { tags: boolean }): SceneNode {
  const style = kindStyle(n.kind)
  const shape = style.shape
  if (shape === "dot" || shape === "bullseye" || shape === "choice" || shape === "bar") {
    const d = shape === "dot" ? 18 : shape === "choice" ? 26 : 22
    const w = shape === "bar" ? 80 : d
    const h = shape === "bar" ? 6 : d
    return {
      id: n.id,
      kind: n.kind,
      shape,
      accent: style.accent,
      label: [],
      detail: [],
      tag: "",
      x: 0,
      y: 0,
      w,
      h,
      text: { tagY: 0, labelY: [], detailY: [], cx: w / 2 },
    }
  }
  const maxChars = shape === "diamond" ? 18 : G.maxLabelChars
  const label = wrap(n.label, maxChars)
  const detail = n.detail ? wrap(n.detail, maxChars + 6) : []
  const tagText = (n.tag ?? (opts.tags ? style.tag : "")).toUpperCase()
  const labelW = Math.max(...label.map((l) => textWidth(l, T.label)))
  const detailW = detail.length ? Math.max(...detail.map((l) => textWidth(l, T.detail))) : 0
  const tagW = tagText ? textWidth(tagText, T.tag, T.tagTracking) + (shape === "actor" ? 18 : 0) : 0
  const contentW = Math.max(labelW, detailW, tagW)
  const contentH = (tagText ? TAG_H : 0) + label.length * LABEL_LH + (detail.length ? 2 + detail.length * DETAIL_LH : 0)

  let w: number
  let h: number
  let top: number
  if (shape === "diamond") {
    // Text box inscribed in the diamond: needs roughly 2x the text box.
    w = snap(Math.max(132, contentW * 1.5 + 44), 4)
    h = snap(Math.max(76, contentH * 1.9 + 16), 4)
    top = (h - contentH) / 2
  } else if (shape === "pill") {
    w = snap(Math.max(96, contentW + 44), 4)
    h = snap(Math.max(34, contentH + 14), 2)
    top = (h - contentH) / 2
  } else {
    const padX = shape === "slant" ? G.nodePadX + 12 : G.nodePadX
    const extraTop = shape === "cylinder" ? 8 : 0
    w = snap(Math.max(shape === "note" ? 96 : G.nodeMinWidth, contentW + 2 * padX + (shape === "queue" ? 16 : 0)), 4)
    h = snap(contentH + 2 * G.nodePadY + extraTop + (shape === "cylinder" ? 4 : 0), 2)
    top = G.nodePadY + extraTop
  }
  // Baselines: cap-height centring for mono ≈ 0.72 em above baseline.
  let y = top
  const tagY = tagText ? y + T.tag * 0.95 : 0
  if (tagText) y += TAG_H
  const labelY = label.map((_, i) => y + i * LABEL_LH + (LABEL_LH + T.label * 0.7) / 2)
  y += label.length * LABEL_LH
  if (detail.length) y += 2
  const detailY = detail.map((_, i) => y + i * DETAIL_LH + (DETAIL_LH + T.detail * 0.7) / 2)
  const cx = shape === "queue" ? (w - 16) / 2 : w / 2
  return {
    id: n.id,
    kind: n.kind,
    shape,
    accent: style.accent,
    label,
    detail,
    tag: tagText,
    x: 0,
    y: 0,
    w,
    h,
    text: { tagY, labelY, detailY, cx },
  }
}
