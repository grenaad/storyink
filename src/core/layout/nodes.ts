import { geometry as G, type as T, type Accent } from "../../theme/tokens.ts"
import type { SceneNode, Shape } from "../scene.ts"
import { snap, textWidth, wrap } from "./measure.ts"
import type { NodeTextVersions } from "./storyscan.ts"

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
  // rich nodes (sized by panels.ts)
  panel: { shape: "window", accent: "plain", tag: "" },
  code: { shape: "window", accent: "plain", tag: "" },
  chip: { shape: "chip", accent: "plain", tag: "" },
}

export function kindStyle(kind: string): KindStyle {
  return KINDS[kind] ?? KINDS.service
}

export const LABEL_LH = Math.round(T.label * T.lineHeight)
export const DETAIL_LH = Math.round(T.detail * T.lineHeight)
const TAG_H = 14

export interface NodeInput {
  id: string
  kind: string
  label: string
  detail?: string
  tag?: string
  counter?: { id: string; value: number; label?: string; prefix?: string; suffix?: string; widest: string }
  /** Story text versions ([0] = the spec's): the box fits every one, so nothing resizes mid-story. */
  versions?: NodeTextVersions
}

/** Status glyph slot before a plain node's detail line: width (glyph + gap). */
export const GLYPH_W = 16

const COUNTER_H = 24

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
  // Story versions: every label / detail / tag version fits (the slots take the most lines).
  const V = n.versions
  const labelsV = V ? V.labels.map((l) => wrap(l, maxChars)) : [label]
  const detailsV = V ? V.details.map((d) => (d.text ? wrap(d.text, maxChars + 6) : [])) : [detail]
  const tagsV = V ? V.tags.map((t, k) => (k === 0 ? tagText : t.toUpperCase())) : [tagText]
  const glyph = !!V?.status
  const labelN = Math.max(...labelsV.map((l) => l.length))
  const detailN = Math.max(glyph ? 1 : 0, ...detailsV.map((d) => d.length))
  const hasTag = tagsV.some((t) => t)
  const labelW = Math.max(...labelsV.flat().map((l) => textWidth(l, T.label)))
  const detailTextW = Math.max(0, ...detailsV.flat().map((l) => textWidth(l, T.detail)))
  const detailW = detailTextW + (glyph ? GLYPH_W : 0)
  const tagW = hasTag ? Math.max(...tagsV.map((t) => (t ? textWidth(t, T.tag, T.tagTracking) : 0))) + (shape === "actor" ? 18 : 0) : 0
  const counterW = n.counter ? Math.max(textWidth(n.counter.widest, T.counter), n.counter.label ? textWidth(n.counter.label.toUpperCase(), T.tag, T.tagTracking) + 8 + textWidth(n.counter.widest, T.counter) : 0) : 0
  const contentW = Math.max(labelW, detailW, tagW, counterW)
  const contentH = (hasTag ? TAG_H : 0) + labelN * LABEL_LH + (detailN ? 2 + detailN * DETAIL_LH : 0) + (n.counter ? COUNTER_H : 0)

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
  const tagY = hasTag ? y + T.tag * 0.95 : 0
  if (hasTag) y += TAG_H
  const labelY = Array.from({ length: labelN }, (_, i) => y + i * LABEL_LH + (LABEL_LH + T.label * 0.7) / 2)
  y += labelN * LABEL_LH
  if (detailN) y += 2
  const detailY = Array.from({ length: detailN }, (_, i) => y + i * DETAIL_LH + (DETAIL_LH + T.detail * 0.7) / 2)
  y += detailN * DETAIL_LH
  const counterY = n.counter ? y + 4 + T.counter * 0.95 : 0
  const cx = shape === "queue" ? (w - 16) / 2 : w / 2
  const textX = cx - detailW / 2 + GLYPH_W
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
    text: { tagY, labelY, detailY, cx, ...(n.counter ? { counterY } : {}) },
    ...(V && V.labels.length > 1 ? { labels: labelsV } : {}),
    ...(V && V.details.length > 1 ? { details: V.details.map((d, k) => ({ lines: detailsV[k], ...(d.tone ? { tone: d.tone } : {}) })) } : {}),
    ...(V && V.tags.length > 1 ? { tags: tagsV } : {}),
    ...(glyph ? { glyph: { x: r2(textX - GLYPH_W / 2 - 1), y: r2(detailY[0] - T.detail * 0.36), textX: r2(textX) } } : {}),
    ...(n.counter
      ? { counter: { id: n.counter.id, value: n.counter.value, ...(n.counter.label ? { label: n.counter.label } : {}), ...(n.counter.prefix ? { prefix: n.counter.prefix } : {}), ...(n.counter.suffix ? { suffix: n.counter.suffix } : {}) } }
      : {}),
  }
}

const r2 = (x: number) => Math.round(x * 100) / 100
