/**
 * The follow camera: pure geometry. Where each story step happens (`stepFocus`) and where the
 * viewer's camera sits for it (`followStep`, `cameraAt`). No DOM, no wall time: the viewer, the
 * snapshot `#camera=follow` capture and the tests all evaluate the same functions.
 *
 * Camera convention (the viewer's `.si-canvas` transform): a diagram point p is drawn on screen at
 * `x + (p.x - viewBox.x) * k`, `y + (p.y - viewBox.y) * k`.
 */
import type { Box, Pt, Scene } from "../scene.ts"
import type { Timeline } from "./types.ts"

export interface Camera {
  k: number
  x: number
  y: number
}

/** The stage in CSS px. `bottom` is reserved for overlaid chrome (transport, toolbar). */
export interface Viewport {
  w: number
  h: number
  bottom?: number
}

export const CAMERA = {
  /** Node label size in diagram px. */
  label: 11,
  /** Fit is readable when labels render at least this large on screen. */
  minLabel: 10,
  /** Target on-screen label size when fit is too small. */
  readableLabel: 12.5,
  /** Never zoom in past this for readability. */
  maxK: 2,
  /** Fit padding (matches the viewer's Fit button). */
  fitPad: 32,
  /** Padding around a step's focus, diagram px. */
  focusPad: 24,
  /** Follow only when the focus leaves the inner share of the viewport. */
  deadZone: 0.8,
  /** Keep this much page margin at the diagram's edges when clamping, CSS px. */
  edge: 24,
  /** Camera move: bounce-free spring (STYLE.md: content springs have no bounce). */
  spring: { type: "spring", bounce: 0, visualDuration: 0.75 } as const,
} as const

/** The whole diagram in view (identical to the viewer's Fit, snapped for pixel-stable captures). */
export function fitCamera(vb: Box, vp: Viewport): Camera {
  const pad = CAMERA.fitPad
  const k = Math.floor(Math.max(0.1, Math.min((vp.w - 2 * pad) / vb.w, (vp.h - 2 * pad) / vb.h, 1.25)) * 64) / 64
  return { k, x: Math.round((vp.w - vb.w * k) / 2), y: Math.round(Math.max(pad / 2, (vp.h - vb.h * k) / 2)) }
}

/** Fit when its labels are readable (≥ 10 px on screen); otherwise the scale for ~12.5 px labels (capped). */
export function readableScale(vb: Box, vp: Viewport): number {
  const fk = fitCamera(vb, vp).k
  if (fk * CAMERA.label >= CAMERA.minLabel) return fk
  return Math.max(fk, snapK(Math.min(CAMERA.maxK, CAMERA.readableLabel / CAMERA.label)))
}

/** Scales snap to 1/64 steps (like fit) so repeated captures rasterize identically. */
const snapK = (k: number) => Math.max(1 / 64, Math.floor(k * 64 + 1e-9) / 64)

/** Whether fit already renders labels readably. */
export const fitIsReadable = (vb: Box, vp: Viewport): boolean => fitCamera(vb, vp).k * CAMERA.label >= CAMERA.minLabel

const union = (bs: Box[]): Box | undefined => {
  if (!bs.length) return undefined
  const x0 = Math.min(...bs.map((b) => b.x))
  const y0 = Math.min(...bs.map((b) => b.y))
  const x1 = Math.max(...bs.map((b) => b.x + b.w))
  const y1 = Math.max(...bs.map((b) => b.y + b.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
const ptsBox = (pts: Pt[]): Box | undefined => (pts.length ? union(pts.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 }))) : undefined)

/** Index of the step in effect at `t` (the last one started; 0 before the first). */
export function stepAt(tl: Timeline, t: number): number {
  let k = 0
  for (let i = 0; i < tl.steps.length; i++) if (tl.steps[i].t0 <= t + 1e-6) k = i
  return k
}

/**
 * Bounding box (diagram px, padded) of everything step i animates: reveals, pulse routes, drawn
 * wires, highlights and arrival glows, counter nodes (captions point at those same elements).
 * Undefined when the step touches nothing on the diagram (a caption-only step).
 */
export function stepFocus(scene: Scene, tl: Timeline, i: number, pad: number = CAMERA.focusPad): Box | undefined {
  const st = tl.steps[i]
  if (!st) return undefined
  const next = tl.steps[i + 1]
  // A step owns events from its start until the next step starts (or its own end, if later).
  const lo = st.t0 - 1e-6
  const hi = Math.max(st.t1, next ? next.t0 : st.t1) - 1e-6
  const inStep = (t: number) => t >= lo && t < hi
  const boxOf = (id: string): Box | undefined => {
    const n = scene.nodes.find((x) => x.id === id) ?? scene.groups.find((x) => x.id === id) ?? scene.frames.find((x) => x.id === id) ?? scene.activations.find((x) => x.id === id)
    if (n) return { x: n.x, y: n.y, w: n.w, h: n.h }
    const e = scene.edges.find((x) => x.id === id)
    if (e) return union([ptsBox(e.points)!, ...(e.label ? [e.label] : [])])
    const p = scene.lifelines.find((x) => x.participant === id)
    return p ? { x: p.x, y: p.y1, w: 0, h: p.y2 - p.y1 } : undefined
  }
  const boxes: Box[] = []
  const add = (b: Box | undefined) => b && boxes.push(b)
  // Explicit reveals start exactly at t0; implicit ones (groups, activations, notes) fall in the window.
  for (const [id, t] of Object.entries(tl.appear)) if (inStep(t)) add(boxOf(id))
  for (const p of tl.pulses) if (p.id.startsWith(`pulse-${i}-`)) add(ptsBox(p.points))
  for (const [id, d] of Object.entries(tl.draw)) if (d.mode === "fade" && inStep(d.t0)) add(boxOf(id))
  for (const g of tl.glows) if (inStep(g.t)) add(boxOf(g.node))
  for (const c of Object.values(tl.counters)) if (c.events.some((e) => inStep(e.t))) add(boxOf(c.node))
  const u = union(boxes)
  if (!u) return undefined
  return { x: u.x - pad, y: u.y - pad, w: u.w + 2 * pad, h: u.h + 2 * pad }
}

/** A diagram box on screen under `cam`. */
export function toScreen(cam: Camera, vb: Box, b: Box): Box {
  return { x: cam.x + (b.x - vb.x) * cam.k, y: cam.y + (b.y - vb.y) * cam.k, w: b.w * cam.k, h: b.h * cam.k }
}

/** The inner `deadZone` share of the usable viewport, CSS px. */
export function deadZoneRect(vp: Viewport, dz: number = CAMERA.deadZone): Box {
  const h = vp.h - (vp.bottom ?? 0)
  return { x: (vp.w * (1 - dz)) / 2, y: (h * (1 - dz)) / 2, w: vp.w * dz, h: h * dz }
}

/** True when `focus` (diagram px) sits inside the dead zone under `cam`. */
export function inView(cam: Camera, vb: Box, vp: Viewport, focus: Box, dz: number = CAMERA.deadZone): boolean {
  const s = toScreen(cam, vb, focus)
  const r = deadZoneRect(vp, dz)
  const e = 0.5
  return s.x >= r.x - e && s.y >= r.y - e && s.x + s.w <= r.x + r.w + e && s.y + s.h <= r.y + r.h + e
}

/** Keep the diagram covering the viewport where it can (no panning into empty page), whole pixels. */
export function clampCamera(cam: Camera, vb: Box, vp: Viewport): Camera {
  const m = CAMERA.edge
  const uh = vp.h - (vp.bottom ?? 0)
  const axis = (v: number, size: number, span: number) => {
    const d = size * cam.k
    if (d + 2 * m <= span) return (span - d) / 2
    return Math.min(m, Math.max(span - d - m, v))
  }
  return { k: cam.k, x: Math.round(axis(cam.x, vb.w, vp.w)), y: Math.round(axis(cam.y, vb.h, uh)) }
}

/** Centre `focus` at scale k (clamped to the diagram). */
export function centreOn(vb: Box, vp: Viewport, focus: Box, k: number): Camera {
  const uh = vp.h - (vp.bottom ?? 0)
  const cx = focus.x - vb.x + focus.w / 2
  const cy = focus.y - vb.y + focus.h / 2
  return clampCamera({ k, x: vp.w / 2 - cx * k, y: uh / 2 - cy * k }, vb, vp)
}

/**
 * One follow move. The scale is the base (readable or the user's zoom), reduced only as far as
 * needed for the focus to fit the dead zone. Inside the dead zone at that scale: stay. Otherwise
 * centre on the focus (clamped to the diagram edges). A camera zoomed out for an earlier, larger
 * focus zooms back to the base when the focus allows it.
 */
export function followStep(cam: Camera, vb: Box, vp: Viewport, focus: Box | undefined, base: number = cam.k, dz: number = CAMERA.deadZone): Camera {
  if (!focus) return cam
  const r = deadZoneRect(vp, dz)
  const k = Math.max(0.1, Math.min(base, snapK(Math.min(r.w / Math.max(1, focus.w), r.h / Math.max(1, focus.h)))))
  if (cam.k >= k - 1e-6 && inView(cam, vb, vp, focus, dz)) return cam
  // The whole diagram already fits at this scale and the focus is on screen: nothing to chase.
  const uh = vp.h - (vp.bottom ?? 0)
  if (Math.abs(cam.k - k) < 1e-6 && vb.w * k <= vp.w && vb.h * k <= uh && inView(cam, vb, vp, focus, 1)) return cam
  const next = centreOn(vb, vp, focus, k)
  return next.k === cam.k && next.x === cam.x && next.y === cam.y ? cam : next
}

/** True once every event has settled: the camera shows the whole diagram again. */
export const cameraAtEnd = (tl: Timeline, t: number): boolean => t >= tl.lastEvent - 1e-6

/**
 * Where the follow camera sits at story time t for a viewport and base scale (default: readable).
 * Pure: plays the dead-zone moves forward from fit through step 0..i, so a capture at t equals the uninterrupted
 * live camera. After the last event it is fit.
 */
export function cameraAt(scene: Scene, tl: Timeline, t: number, vp: Viewport, k?: number): Camera {
  const vb = scene.viewBox
  if (cameraAtEnd(tl, t) || !tl.steps.length) return fitCamera(vb, vp)
  const i = stepAt(tl, t)
  const base = k ?? readableScale(vb, vp)
  // The live viewer starts at fit and applies one follow move per step; so does this.
  let cam = fitCamera(vb, vp)
  for (let j = 0; j <= i; j++) cam = followStep(cam, vb, vp, stepFocus(scene, tl, j), base)
  return cam
}
