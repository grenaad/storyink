/**
 * Things outside the node layout (Phase B): node annotations (one mono line above / below a node,
 * room reserved by the layout) and story toasts (floating cards placed deterministically at
 * layout time, never over nodes, groups, edge labels, annotations or toasts up at the same time).
 * Browser-safe.
 */
import type { Box, Scene, SceneAnnotation, SceneNode, SceneToast } from "../scene.ts"
import type { Annotation, GraphSpec, SetRef, StoryStep, ToastRef } from "../spec.ts"
import { isTone, type Tone } from "../../theme/tones.ts"
import { authoredSteps } from "./storyscan.ts"
import { r2, textWidth } from "./measure.ts"
import { actPlan, specActs } from "../story/acts.ts"

/** Annotation text: font size, gap to the node, reserved band (gap + line). */
export const ANN = { size: 10, gap: 6, band: 18 } as const
/** Toast card: title / text sizes, padding, gap between cards and to the anchor, the tone stripe. */
export const TOAST = { title: 11, text: 10, padX: 12, padY: 8, gap: 8, stripe: 3, line: 14 } as const

const asList = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x])

/** The spec's annotations (well-formed ones on known nodes). */
export function specAnnotations(spec: GraphSpec): Annotation[] {
  const ids = new Set(spec.nodes.map((n) => n.id))
  return (spec.annotations ?? []).filter((a) => a && typeof a.id === "string" && typeof a.text === "string" && ids.has(a.on))
}

/** Text versions of an annotation ([0] = spec, then each story `set` on it with text / tone). */
export function annotationVersions(spec: GraphSpec, a: Annotation): { text: string; tone?: Tone }[] {
  const out: { text: string; tone?: Tone }[] = [{ text: a.text, ...(isTone(a.tone) ? { tone: a.tone } : {}) }]
  for (const st of authoredSteps(spec))
    for (const s of asList(st.set as SetRef | SetRef[] | undefined)) {
      if (!s || typeof s !== "object" || s.id !== a.id) continue
      if (s.text === undefined && s.tone === undefined) continue
      const prev = out[out.length - 1]
      const text = typeof s.text === "string" ? s.text : prev.text
      // Like a node's detail line: new text is untoned unless the set gives a tone; a tone-only set keeps the text.
      const tone = s.tone !== undefined ? (isTone(s.tone) ? s.tone : undefined) : s.text !== undefined ? undefined : prev.tone
      out.push({ text, ...(tone ? { tone } : {}) })
    }
  return out
}

/** Room a node's annotations need: the widest version width (0 = none). */
export function annotationRoom(spec: GraphSpec): Map<string, number> {
  const out = new Map<string, number>()
  for (const a of specAnnotations(spec)) {
    const w = Math.max(...annotationVersions(spec, a).map((v) => textWidth(v.text, ANN.size)))
    out.set(a.on, Math.max(out.get(a.on) ?? 0, w))
  }
  return out
}

/** Place annotations on their (placed) nodes. */
export function placeAnnotations(spec: GraphSpec, nodes: SceneNode[], actsOf?: (id: string) => string[] | undefined): SceneAnnotation[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  return specAnnotations(spec).map((a) => {
    const n = byId.get(a.on)!
    const side = a.side === "bottom" ? "bottom" : "top"
    const versions = annotationVersions(spec, a)
    const w = Math.max(...versions.map((v) => textWidth(v.text, ANN.size)))
    const y = side === "top" ? n.y - ANN.gap - 2 : n.y + n.h + ANN.gap + ANN.size * 0.75
    const box = { x: r2(n.x), y: r2(y - ANN.size * 0.8), w: r2(w), h: r2(ANN.size * 1.1) }
    const acts = a.in ? a.in : actsOf?.(a.on)
    return { id: a.id, on: a.on, side, x: r2(n.x), y: r2(y), box, versions, ...(acts ? { acts } : {}) }
  })
}

/** Toast card size. */
export function toastSize(t: { title?: string; text: string }): { w: number; h: number } {
  const w = Math.max(t.title ? textWidth(t.title, TOAST.title) : 0, textWidth(t.text, TOAST.text)) + 2 * TOAST.padX + TOAST.stripe
  const h = 2 * TOAST.padY + (t.title ? TOAST.line + TOAST.text : TOAST.text + 2)
  return { w: Math.ceil(w), h: Math.ceil(h) }
}

/** Toast id of the k-th toast of step i (when the author gives none). */
export const toastId = (i: number, k: number, t: { id?: unknown }): string => (typeof t.id === "string" && t.id ? t.id : `toast-${i + 1}-${k + 1}`)

const overlaps = (a: Box, b: Box, pad = 0) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad

/**
 * Place the story's toasts in step order. Visibility is simulated by step order: a toast is up
 * from its step until a `dismiss` names it (or "all"), or its act ends by a rewind / cut. (A `for`
 * expiry is not known at layout time: such a toast counts as up until then, so slots never
 * collide.) Candidates: above the anchor (centred, then shifted left / right by card width + gap),
 * a row higher, and so on; then below. Grows the viewBox to fit.
 */
export function placeToasts(spec: GraphSpec, scene: Scene): SceneToast[] {
  const steps = authoredSteps(spec)
  if (!steps.some((s) => s.toast !== undefined)) return []
  const acts = specActs(spec)
  const ap = acts ? actPlan(steps as StoryStep[], acts, () => {}, () => {}) : undefined
  const nodes = new Map(scene.nodes.map((n) => [n.id, n]))
  const fixed: Box[] = [
    ...scene.nodes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h })),
    ...scene.edges.flatMap((e) => (e.label ? [e.label] : [])),
    ...(scene.annotations ?? []).map((a) => a.box),
  ]
  const out: SceneToast[] = []
  let up: SceneToast[] = []
  steps.forEach((st, i) => {
    if (ap && ap.entry.indexOf(i) > 0 && ap.enter[ap.entry.indexOf(i)] !== "continue") up = []
    const d = st.dismiss
    if (d === "all") up = []
    else for (const id of asList(d as string | string[] | undefined)) up = up.filter((t) => t.id !== id)
    asList(st.toast as ToastRef | ToastRef[] | undefined).forEach((t, k) => {
      if (!t || typeof t !== "object" || typeof t.text !== "string") return
      const n = nodes.get(t.near)
      if (!n) return
      const size = toastSize(t)
      const groups = scene.groups.filter((g) => !(n.x >= g.x && n.x + n.w <= g.x + g.w && n.y >= g.y && n.y + n.h <= g.y + g.h))
      const blocked = (b: Box) => [...fixed, ...groups, ...up].some((o) => overlaps(b, o, 4))
      const cx = n.x + n.w / 2
      const cands: Box[] = []
      for (const dir of [-1, 1])
        for (let row = 0; row < 8; row++) {
          const y = dir < 0 ? n.y - TOAST.gap - size.h - row * (size.h + TOAST.gap) : n.y + n.h + TOAST.gap + row * (size.h + TOAST.gap)
          for (const s of [0, -1, 1]) cands.push({ x: cx - size.w / 2 + s * (size.w + TOAST.gap), y, w: size.w, h: size.h })
        }
      const slot = cands.find((b) => !blocked(b)) ?? cands[0]
      const toast: SceneToast = {
        id: toastId(i, k, t),
        step: i,
        k,
        near: t.near,
        ...(typeof t.title === "string" && t.title ? { title: t.title } : {}),
        text: t.text,
        ...(isTone(t.tone) ? { tone: t.tone } : {}),
        x: r2(slot.x),
        y: r2(slot.y),
        w: size.w,
        h: size.h,
      }
      out.push(toast)
      up.push(toast)
    })
  })
  // The viewBox grows to fit them (fit / follow camera include them).
  const vb = scene.viewBox
  const M = 16
  const x0 = Math.min(vb.x, ...out.map((t) => t.x - M))
  const y0 = Math.min(vb.y, ...out.map((t) => t.y - M))
  const x1 = Math.max(vb.x + vb.w, ...out.map((t) => t.x + t.w + M))
  const y1 = Math.max(vb.y + vb.h, ...out.map((t) => t.y + t.h + M))
  scene.viewBox = { x: r2(x0), y: r2(y0), w: r2(Math.ceil((x1 - x0) / 2) * 2), h: r2(Math.ceil((y1 - y0) / 2) * 2) }
  return out
}

/** Annotation boxes also bound the viewBox. */
export function growForAnnotations(scene: Scene): void {
  const as = scene.annotations ?? []
  if (!as.length) return
  const vb = scene.viewBox
  const M = 12
  const x0 = Math.min(vb.x, ...as.map((a) => a.box.x - M))
  const y0 = Math.min(vb.y, ...as.map((a) => a.box.y - M))
  const x1 = Math.max(vb.x + vb.w, ...as.map((a) => a.box.x + a.box.w + M))
  const y1 = Math.max(vb.y + vb.h, ...as.map((a) => a.box.y + a.box.h + M))
  scene.viewBox = { x: r2(x0), y: r2(y0), w: r2(Math.ceil((x1 - x0) / 2) * 2), h: r2(Math.ceil((y1 - y0) / 2) * 2) }
}
