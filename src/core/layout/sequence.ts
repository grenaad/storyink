import { geometry as G, type as T } from "../../theme/tokens.ts"
import type { Box, Pt, Scene, SceneActivation, SceneEdge, SceneFrame, SceneLifeline, SceneNode } from "../scene.ts"
import type { SequenceSpec } from "../spec.ts"
import { r2, snap, textWidth } from "./measure.ts"
import { sizeNode } from "./nodes.ts"
import { roundedPolyline } from "./paths.ts"

const LABEL_H = T.edgeLabel + 2 * G.pillPadY + 4
const ACT_W = 10

export function layoutSequence(spec: SequenceSpec): Scene {
  const M = G.margin
  const parts = spec.participants.map((p) =>
    sizeNode({ id: p.id, kind: p.kind === "actor" ? "actor" : p.kind === "participant" ? "participant" : p.kind ?? "participant", label: p.label ?? p.id }, { tags: p.kind !== "participant" }),
  )
  const col = new Map(spec.participants.map((p, i) => [p.id, i]))
  const n = parts.length
  const messages = spec.messages
  const labelOf = (i: number) => {
    const m = messages[i]
    const base = m.label ?? ""
    return spec.autonumber ? `${i + 1}. ${base}`.trim() : base
  }
  const lw = (i: number) => (labelOf(i) ? textWidth(labelOf(i), T.edgeLabel) + 2 * G.pillPadX : 0)

  // Column spacing.
  const gap = new Array(Math.max(0, n - 1)).fill(0).map((_, i) => (parts[i].w + parts[i + 1].w) / 2 + 48)
  let tailRoom = 0
  const spanNeed: { a: number; b: number; need: number }[] = []
  messages.forEach((m, i) => {
    const a = col.get(m.from) ?? 0
    const b = col.get(m.to) ?? 0
    if (m.kind === "self" || a === b) {
      const need = Math.max(lw(i), 30) + 44
      if (a < n - 1) spanNeed.push({ a, b: a + 1, need: need + parts[a + 1].w / 2 })
      else tailRoom = Math.max(tailRoom, need)
    } else spanNeed.push({ a: Math.min(a, b), b: Math.max(a, b), need: lw(i) + 36 })
  })
  for (const note of spec.notes ?? []) {
    const w = textWidth(note.text, T.detail) + 40
    if (note.over && note.over.length === 2) {
      const a = col.get(note.over[0]) ?? 0
      const b = col.get(note.over[1]) ?? 0
      if (a !== b) spanNeed.push({ a: Math.min(a, b), b: Math.max(a, b), need: Math.min(w, 380) - 40 })
    } else if (note.right) {
      const a = col.get(note.right) ?? 0
      if (a < n - 1) spanNeed.push({ a, b: a + 1, need: Math.min(w, 260) + 24 + parts[a + 1].w / 2 })
      else tailRoom = Math.max(tailRoom, Math.min(w, 260) + 24)
    }
  }
  spanNeed.sort((x, y) => x.b - x.a - (y.b - y.a))
  for (const s of spanNeed) {
    let have = 0
    for (let k = s.a; k < s.b; k++) have += gap[k]
    if (have < s.need) {
      const extra = (s.need - have) / (s.b - s.a)
      for (let k = s.a; k < s.b; k++) gap[k] += extra
    }
  }
  let leftRoom = 0
  for (const note of spec.notes ?? [])
    if (note.left && col.get(note.left) === 0) leftRoom = Math.max(leftRoom, Math.min(textWidth(note.text, T.detail) + 40, 260) + 24 - parts[0].w / 2)
  const xs: number[] = []
  let x = M + Math.max(parts[0]?.w ?? 0, 0) / 2 + Math.max(0, leftRoom) + 24
  for (let i = 0; i < n; i++) {
    xs.push(r2(x))
    x += gap[i] ?? 0
  }
  const headerH = Math.max(0, ...parts.map((p) => p.h))
  parts.forEach((p, i) => {
    // Equal header heights; text re-centred.
    const dy = (headerH - p.h) / 2
    p.text.tagY += dy
    p.text.labelY = p.text.labelY.map((y) => y + dy)
    p.text.detailY = p.text.detailY.map((y) => y + dy)
    p.h = headerH
    p.x = r2(xs[i] - p.w / 2)
    p.y = M + 24
  })

  // Rows.
  // Validated specs carry numeric message references.
  type NFrame = { kind: import("../spec.ts").FrameKind; label?: string; start: number; end: number; sections?: { label?: string; start: number }[] }
  const frames = (spec.frames ?? []) as unknown as NFrame[]
  const depthInside = frames.map((f) => {
    let d = 0
    const inner = (g: typeof f): number =>
      1 + Math.max(0, ...frames.filter((h) => h !== g && g.start <= h.start && h.end <= g.end && !(h.start === g.start && h.end === g.end && frames.indexOf(h) < frames.indexOf(g))).map(inner))
    d = inner(f) - 1
    return d
  })
  const byOuter = frames.map((f, i) => ({ f, i })).sort((a, b) => a.f.start - b.f.start || b.f.end - a.f.end)
  const frameTop = new Map<number, number>()
  const frameBottom = new Map<number, number>()
  const sectionY = new Map<string, number>()
  const noteNodes: SceneNode[] = []
  const lineY: number[] = []
  let y = M + 24 + headerH + 30
  const notesAfter = (k: number | undefined) => (spec.notes ?? []).filter((nt) => (nt.after as number | undefined) === k)
  const placeNote = (nt: NonNullable<SequenceSpec["notes"]>[number], idx: number) => {
    const node = sizeNode({ id: `note-${idx}`, kind: "note", label: nt.text }, { tags: false })
    if (nt.over && nt.over.length) {
      const a = xs[col.get(nt.over[0]) ?? 0]
      const b = xs[col.get(nt.over[nt.over.length - 1]) ?? 0]
      const lo = Math.min(a, b)
      const hi = Math.max(a, b)
      node.w = snap(Math.max(node.w, hi - lo + 40), 2)
      node.x = r2((lo + hi) / 2 - node.w / 2)
    } else if (nt.left) node.x = r2(xs[col.get(nt.left) ?? 0] - 14 - node.w)
    else node.x = r2(xs[col.get(nt.right ?? "") ?? 0] + 14)
    node.text.cx = node.w / 2
    node.y = r2(y)
    y += node.h + 14
    noteNodes.push(node)
  }
  const allNotes = spec.notes ?? []
  const before = notesAfter(undefined)
  before.forEach((nt) => placeNote(nt, allNotes.indexOf(nt)))
  for (let k = 0; k < messages.length; k++) {
    for (const { f, i } of byOuter)
      if (f.start === k) {
        frameTop.set(i, y)
        y += 30
      }
    frames.forEach((f, i) =>
      (f.sections ?? []).forEach((s, j) => {
        if (s.start === k) {
          y += 6
          sectionY.set(`${i}:${j}`, y)
          y += 26
        }
      }),
    )
    const m = messages[k]
    const self = m.kind === "self" || m.from === m.to
    const lh = labelOf(k) ? LABEL_H : 0
    lineY.push(r2(y + lh + 4))
    y += lh + 4 + (self ? 22 : 0) + 22
    const closing = byOuter.filter(({ f }) => f.end === k).reverse()
    for (const { i } of closing) {
      y += 8
      frameBottom.set(i, y)
      y += 10
    }
    // Notes after message k follow any frames that close at k.
    notesAfter(k).forEach((nt) => placeNote(nt, allNotes.indexOf(nt)))
  }
  const bottom = y + 10

  // Activations.
  const activations: SceneActivation[] = []
  const actDepth = new Map<string, { start: number; end: number; depth: number }[]>()
  for (const a of spec.activations ?? []) {
    const list = actDepth.get(a.participant) ?? []
    const s = a.start as number
    const e = a.end as number
    const depth = list.filter((o) => o.start <= s && s <= o.end).length
    list.push({ start: s, end: e, depth })
    actDepth.set(a.participant, list)
    const cx = xs[col.get(a.participant) ?? 0] + depth * 5
    const y1 = lineY[s] - 8
    const y2 = lineY[e] + (messages[e]?.kind === "self" ? 30 : 8)
    activations.push({ id: `act-${a.participant}-${s}-${e}`, participant: a.participant, x: r2(cx - ACT_W / 2), y: r2(y1), w: ACT_W, h: r2(y2 - y1) })
  }
  const activeOffset = (pid: string, k: number, towardRight: boolean) => {
    const list = actDepth.get(pid) ?? []
    const act = list.filter((o) => o.start <= k && k <= o.end)
    if (!act.length) return 0
    const d = Math.max(...act.map((o) => o.depth))
    return towardRight ? ACT_W / 2 + d * 5 : -ACT_W / 2 + (d > 0 ? d * 5 : 0)
  }

  // Messages.
  const edges: SceneEdge[] = messages.map((m, k) => {
    const a = xs[col.get(m.from) ?? 0]
    const b = xs[col.get(m.to) ?? 0]
    const ly = lineY[k]
    const id = m.id ?? `msg-${k}`
    const text = labelOf(k)
    const self = m.kind === "self" || m.from === m.to
    let points: Pt[]
    let label: SceneEdge["label"]
    const ls = text ? { w: textWidth(text, T.edgeLabel) + 2 * G.pillPadX, h: LABEL_H - 4 } : undefined
    if (self) {
      const x0 = a + activeOffset(m.from, k, true)
      points = [
        { x: x0, y: ly },
        { x: x0 + 32, y: ly },
        { x: x0 + 32, y: ly + 22 },
        { x: x0 + (actDepth.get(m.from) ? ACT_W / 2 : 0), y: ly + 22 },
      ]
      if (ls) label = { id: `${id}:label`, text, x: r2(x0 + 40), y: r2(ly + 11 - ls.h / 2), w: r2(ls.w), h: ls.h }
    } else {
      const right = b > a
      const x1 = a + activeOffset(m.from, k, right)
      const x2 = b + activeOffset(m.to, k, !right) + (right ? -1 : 1)
      points = [
        { x: r2(x1), y: ly },
        { x: r2(x2), y: ly },
      ]
      if (ls) label = { id: `${id}:label`, text, x: r2((a + b) / 2 - ls.w / 2), y: r2(ly - 5 - ls.h), w: r2(ls.w), h: ls.h }
    }
    const tip = points[points.length - 1]
    const prev = points[points.length - 2]
    const kind = m.kind ?? "sync"
    return {
      id,
      from: m.from,
      to: m.to,
      d: roundedPolyline(points, 6),
      points,
      style: kind === "return" ? "dashed" : "solid",
      arrow: "end",
      heads: [{ x: tip.x, y: tip.y, angle: r2(Math.atan2(tip.y - prev.y, tip.x - prev.x)), form: kind === "async" ? "open" : "filled" }],
      ...(label ? { label } : {}),
      message: kind,
      ...(spec.autonumber ? { seq: k + 1 } : {}),
    }
  })

  // Frames: span their content horizontally.
  const sceneFrames: SceneFrame[] = frames.map((f, i) => {
    let lo = Infinity
    let hi = -Infinity
    for (let k = f.start; k <= f.end; k++) {
      const e = edges[k]
      for (const p of e.points) {
        lo = Math.min(lo, p.x)
        hi = Math.max(hi, p.x)
      }
      if (e.label) {
        lo = Math.min(lo, e.label.x)
        hi = Math.max(hi, e.label.x + e.label.w)
      }
    }
    for (const nn of noteNodes) {
      const top = frameTop.get(i) ?? 0
      const bot = frameBottom.get(i) ?? 0
      if (nn.y > top && nn.y < bot) {
        lo = Math.min(lo, nn.x)
        hi = Math.max(hi, nn.x + nn.w)
      }
    }
    const pad = 20 + depthInside[i] * 12
    const tag = f.kind.toUpperCase()
    const tagW = textWidth(tag, T.tag, T.tagTracking) + 16
    const labelW = f.label ? textWidth(`[${f.label}]`, T.detail) + 14 : 0
    const x0 = lo - pad
    const w = Math.max(hi - lo + 2 * pad, tagW + labelW + 16)
    const top = frameTop.get(i)!
    const bot = frameBottom.get(i)!
    return {
      id: `frame-${i}`,
      kind: f.kind,
      ...(f.label ? { label: f.label } : {}),
      tagW: r2(tagW),
      x: r2(x0),
      y: r2(top),
      w: r2(w),
      h: r2(bot - top),
      sections: (f.sections ?? []).map((s, j) => ({ y: r2(sectionY.get(`${i}:${j}`) ?? top), ...(s.label ? { label: s.label } : {}) })),
    }
  })

  const lifelines: SceneLifeline[] = parts.map((p, i) => ({
    id: `life-${p.id}`,
    participant: p.id,
    x: xs[i],
    y1: r2(p.y + p.h),
    y2: r2(bottom),
  }))

  // Bounds.
  const all: Box[] = [...parts, ...noteNodes, ...sceneFrames, ...activations]
  for (const e of edges) {
    for (const p of e.points) all.push({ x: p.x, y: p.y, w: 0, h: 0 })
    if (e.label) all.push(e.label)
  }
  let minX = Infinity
  let maxX = -Infinity
  let maxY = bottom
  for (const b of all) {
    minX = Math.min(minX, b.x)
    maxX = Math.max(maxX, b.x + b.w)
    maxY = Math.max(maxY, b.y + b.h)
  }
  maxX = Math.max(maxX, (xs[n - 1] ?? 0) + tailRoom)
  const vx = Math.min(0, minX - M)
  return {
    type: "sequence",
    title: spec.title,
    ...(spec.subtitle ? { subtitle: spec.subtitle } : {}),
    viewBox: { x: r2(vx), y: 0, w: r2(snap(maxX + M - vx)), h: r2(snap(maxY + M)) },
    groups: [],
    nodes: [...parts, ...noteNodes],
    edges,
    ports: [],
    lifelines,
    activations,
    frames: sceneFrames,
  }
}
