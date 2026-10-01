import { geometry as G, type as T } from "../../theme/tokens.ts"
import type { SceneNode, SceneRow, SceneRowVersion } from "../scene.ts"
import type { GraphNode, GraphSpec, PanelRow, SetRef } from "../spec.ts"
import { parseRef } from "../anchor.ts"
import { snap, textWidth, wrap } from "./measure.ts"
import { codeLines, tokenize } from "./tokenize.ts"

/** Rich node kinds (0.4). */
export const RICH_KINDS = new Set(["panel", "code", "chip"])
export const isRichKind = (k?: string): boolean => !!k && RICH_KINDS.has(k)

const ADV_ROW = T.row * 0.6
const ADV_CODE = T.code * 0.6

/** Every story `set` step in order (static scan; auto stories have none). */
function setSteps(spec: GraphSpec): SetRef[] {
  const st = spec.story
  if (!st || st === "auto" || st.steps === "auto") return []
  const out: SetRef[] = []
  for (const s of st.steps) {
    const list = s.set === undefined ? [] : Array.isArray(s.set) ? s.set : [s.set]
    for (const x of list) if (x && typeof x === "object" && typeof x.id === "string") out.push(x)
  }
  return out
}

/** Code versions of a code node: [0] = spec code, then each story `set` code in step order. */
export function codeVersions(spec: GraphSpec, n: GraphNode): string[][] {
  const out = [codeLines(n.code ?? "")]
  for (const s of setSteps(spec)) if (s.id === n.id && s.code !== undefined) out.push(codeLines(s.code))
  return out
}

/** Row content versions: [0] = spec, then each `set` on "node#row" (fields carry over). */
function rowVersions(spec: GraphSpec, node: string, id: string, row: PanelRow): PanelRow[] {
  const out: PanelRow[] = [row]
  for (const s of setSteps(spec)) {
    const r = parseRef(s.id)
    if (r.node !== node || r.anchor !== id) continue
    const prev = out[out.length - 1]
    out.push({
      ...prev,
      ...(s.text !== undefined ? { text: s.text } : {}),
      ...(s.detail !== undefined ? { detail: s.detail } : {}),
      ...(s.tag !== undefined ? { tag: s.tag } : {}),
    })
  }
  return out
}

/** Label versions (story `set` label on the node). */
export function labelVersions(spec: GraphSpec, n: GraphNode): string[] {
  const out = [n.label ?? n.id]
  for (const s of setSteps(spec)) if (s.id === n.id && typeof s.label === "string") out.push(s.label)
  return out
}

const rowId = (r: PanelRow, k: number) => r.id ?? `row-${k + 1}`
const indentPx = (r: PanelRow) => Math.max(0, Math.min(4, r.indent ?? 0)) * G.iconW

function rowVersion(r: PanelRow, cols: number): SceneRowVersion {
  const text = r.text ?? ""
  const detail = r.detail ?? ""
  const joined = [text, detail].filter(Boolean).join(" ")
  const lines = joined ? wrap(joined, Math.max(4, cols)) : []
  const split = detail && text ? text.trim().split(/\s+/).join(" ").length + 1 : detail ? 0 : undefined
  return { lines, ...(split !== undefined ? { split } : {}), ...(r.tag ? { tag: r.tag.toUpperCase() } : {}) }
}

/** Header strip title width (tag style). */
const headerW = (title: string, icon: boolean) => textWidth(title, T.header, T.tagTracking) + (icon ? G.iconW : 0)

/** Size a `panel` node: header strip + rows. Rows reserve their slot from the start (no reflow). */
export function sizePanel(spec: GraphSpec, n: GraphNode): SceneNode {
  const cols = n.size?.cols ?? G.rowCols
  const title = (n.label ?? n.id).toUpperCase()
  const src = n.rows ?? []
  const rows: SceneRow[] = []
  let y = G.headerH + G.panelPadY
  let maxRight = 0
  src.forEach((r, k) => {
    if (k > 0) {
      const child = (x: PanelRow) => (x.indent ?? 0) > 0
      y += child(r) ? (child(src[k - 1]) ? 0 : G.rowGapChild) : G.rowGap
    }
    const id = rowId(r, k)
    const vs = rowVersions(spec, n.id, id, r)
    const x = G.panelPadX + (r.icon ? G.iconW : 0) + indentPx(r)
    const wrapCols = Math.max(4, cols - Math.round(indentPx(r) / ADV_ROW) - (r.icon ? Math.round(G.iconW / ADV_ROW) : 0))
    const versions = vs.map((v) => rowVersion(v, wrapCols))
    const nLines = Math.max(1, ...versions.map((v) => v.lines.length))
    const hasTag = versions.some((v) => v.tag)
    const top = y
    let cy = top
    const tagY = hasTag ? cy + T.tag * 0.95 + 2 : undefined
    if (hasTag) cy += G.tagH
    const lineY = Array.from({ length: nLines }, (_, i) => r2(cy + i * G.rowLH + (G.rowLH + T.row * 0.7) / 2))
    const anchorY = cy + G.rowLH / 2
    const h = cy - top + nLines * G.rowLH
    for (const v of versions) for (const l of v.lines) maxRight = Math.max(maxRight, x + textWidth(l, T.row))
    for (const v of versions) if (v.tag) maxRight = Math.max(maxRight, x + textWidth(v.tag, T.tag, T.tagTracking))
    rows.push({
      id,
      y: top,
      h,
      x,
      ...(tagY !== undefined ? { tagY: r2(tagY) } : {}),
      lineY,
      ...(r.icon ? { icon: r.icon, iconY: anchorY } : {}),
      ...(r.status && r.status !== "none" ? { status: r.status } : {}),
      ...(r.muted ? { muted: true } : {}),
      ...(r.indent ? { indent: r.indent } : {}),
      statusX: 0,
      anchorY,
      versions,
    })
    y += h
  })
  const reserveW = n.size?.cols ? 2 * G.panelPadX + G.iconW + G.statusW + cols * ADV_ROW : 0
  const w = snap(Math.max(G.nodeMinWidth, reserveW, maxRight + G.statusW + G.panelPadX, headerW(title, !!n.icon) + 2 * G.panelPadX), 4)
  const minBody = (n.size?.lines ?? 0) * G.rowLH
  const h = snap(Math.max(y - G.headerH - G.panelPadY, minBody) + G.headerH + 2 * G.panelPadY, 2)
  for (const r of rows) r.statusX = w - G.panelPadX - 7
  return {
    ...windowBase(n, title, w, h),
    rows,
  }
}

/** Size a `code` node: header strip + code body, big enough for every version. */
export function sizeCode(spec: GraphSpec, n: GraphNode): SceneNode {
  const title = (n.label ?? n.id).toUpperCase()
  const lang = n.lang ?? "ts"
  const versions = codeVersions(spec, n)
  const slots = Math.max(1, n.size?.lines ?? 0, ...versions.map((v) => v.length))
  const cols = Math.max(n.size?.cols ?? 0, ...versions.flatMap((v) => v.map((l) => Array.from(l).length)))
  const top = G.headerH + G.panelPadY
  const w = snap(Math.max(G.nodeMinWidth, 2 * G.codePadX + cols * ADV_CODE, headerW(title, !!n.icon) + 2 * G.panelPadX), 4)
  const h = snap(top + slots * G.codeLH + G.panelPadY, 2)
  return {
    ...windowBase(n, title, w, h),
    code: { lang, versions: versions.map((v) => tokenize(v, lang)), x: G.codePadX, top, lh: G.codeLH, slots, cols },
  }
}

function windowBase(n: GraphNode, title: string, w: number, h: number): SceneNode {
  return {
    id: n.id,
    kind: n.kind ?? "panel",
    shape: "window",
    accent: "plain",
    label: [n.label ?? n.id],
    detail: [],
    tag: "",
    x: 0,
    y: 0,
    w,
    h,
    text: { tagY: 0, labelY: [], detailY: [], cx: w / 2 },
    header: { h: G.headerH, title },
    ...(n.icon ? { icon: n.icon } : {}),
    ...(n.muted ? { muted: true } : {}),
  }
}

/** Size a `chip`: icon + left label on a double-rule face, optional stack sheets below. */
export function sizeChip(n: GraphNode): SceneNode {
  const label = n.label ?? n.id
  const stack = Math.max(0, Math.min(3, n.stack ?? 0))
  const w = snap(Math.max(G.chipMinW, 2 * G.chipPadX + (n.icon ? G.iconW + 2 : 0) + textWidth(label, T.label)), 4)
  const h = G.chipH + stack * G.stackStep
  const x0 = G.chipPadX + (n.icon ? G.iconW + 2 : 0)
  return {
    id: n.id,
    kind: "chip",
    shape: "chip",
    accent: "plain",
    label: [label],
    detail: [],
    tag: "",
    x: 0,
    y: 0,
    w,
    h,
    text: { tagY: 0, labelY: [r2(G.chipH / 2 + T.label * 0.35)], detailY: [], cx: x0 },
    ...(n.icon ? { icon: n.icon } : {}),
    ...(n.muted ? { muted: true } : {}),
    ...(stack ? { stack } : {}),
  }
}

/** Face height of a node (chips exclude their stack sheets). */
export const faceH = (n: Pick<SceneNode, "h" | "shape" | "stack">): number => (n.shape === "chip" && n.stack ? n.h - n.stack * G.stackStep : n.h)

/** Size any rich node. */
export function sizeRich(spec: GraphSpec, n: GraphNode): SceneNode {
  const s = n.kind === "chip" ? sizeChip(n) : n.kind === "code" ? sizeCode(spec, n) : sizePanel(spec, n)
  const labels = labelVersions(spec, n)
  if (labels.length > 1) s.labels = labels.map((l) => [l])
  if (n.kind !== "chip" && labels.length > 1) {
    const title = labels.reduce((a, b) => (b.length > a.length ? b : a)).toUpperCase()
    s.w = Math.max(s.w, snap(headerW(title, !!n.icon) + 2 * G.panelPadX, 4))
  }
  return s
}

const r2 = (x: number) => Math.round(x * 100) / 100
