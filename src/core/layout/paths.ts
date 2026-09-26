import type { Pt } from "../scene.ts"
import { r2 } from "./measure.ts"

const f = (n: number) => String(r2(n))

/**
 * Horizontal-first rounded elbow between (x1,y1) and (x2,y2) turning at xm:
 * `M x1 y1 H xm-r Q xm y1 xm y1+s·r V y2-s·r Q xm y2 xm+r y2 H x2`.
 * Radius is clamped to the available room; |Δy| < 1 is a straight line.
 */
export function elbowPath(x1: number, y1: number, x2: number, y2: number, xm: number, radius: number): string {
  if (Math.abs(y2 - y1) < 1) return `M${f(x1)} ${f(y1)}H${f(x2)}`
  const s = Math.sign(y2 - y1)
  const h1 = Math.sign(xm - x1) || 1
  const h2 = Math.sign(x2 - xm) || 1
  const r = Math.min(radius, Math.abs(y2 - y1) / 2, Math.abs(xm - x1) || radius, Math.abs(x2 - xm) || radius)
  return (
    `M${f(x1)} ${f(y1)}H${f(xm - h1 * r)}Q${f(xm)} ${f(y1)} ${f(xm)} ${f(y1 + s * r)}` +
    `V${f(y2 - s * r)}Q${f(xm)} ${f(y2)} ${f(xm + h2 * r)} ${f(y2)}H${f(x2)}`
  )
}

/** Vertical-first variant (for top-to-bottom layouts), same construction with axes swapped. */
export function elbowPathV(x1: number, y1: number, x2: number, y2: number, ym: number, radius: number): string {
  if (Math.abs(x2 - x1) < 1) return `M${f(x1)} ${f(y1)}V${f(y2)}`
  const s = Math.sign(x2 - x1)
  const v1 = Math.sign(ym - y1) || 1
  const v2 = Math.sign(y2 - ym) || 1
  const r = Math.min(radius, Math.abs(x2 - x1) / 2, Math.abs(ym - y1) || radius, Math.abs(y2 - ym) || radius)
  return (
    `M${f(x1)} ${f(y1)}V${f(ym - v1 * r)}Q${f(x1)} ${f(ym)} ${f(x1 + s * r)} ${f(ym)}` +
    `H${f(x2 - s * r)}Q${f(x2)} ${f(ym)} ${f(x2)} ${f(ym + v2 * r)}V${f(y2)}`
  )
}

/**
 * General rounded polyline: at each corner B (neighbours A, C) the radius is
 * r' = min(r, |AB|/2, |BC|/2) and we emit `L a Q B b`.
 */
export function roundedPolyline(points: Pt[], radius: number): string {
  if (points.length === 0) return ""
  const pts = dedupe(points)
  let d = `M${f(pts[0].x)} ${f(pts[0].y)}`
  for (let i = 1; i < pts.length - 1; i++) {
    const A = pts[i - 1]
    const B = pts[i]
    const C = pts[i + 1]
    const ab = Math.hypot(B.x - A.x, B.y - A.y)
    const bc = Math.hypot(C.x - B.x, C.y - B.y)
    const r = Math.min(radius, ab / 2, bc / 2)
    if (r < 0.5 || ab === 0 || bc === 0) {
      d += `L${f(B.x)} ${f(B.y)}`
      continue
    }
    const a = { x: B.x + ((A.x - B.x) / ab) * r, y: B.y + ((A.y - B.y) / ab) * r }
    const b = { x: B.x + ((C.x - B.x) / bc) * r, y: B.y + ((C.y - B.y) / bc) * r }
    d += `L${f(a.x)} ${f(a.y)}Q${f(B.x)} ${f(B.y)} ${f(b.x)} ${f(b.y)}`
  }
  const last = pts[pts.length - 1]
  if (pts.length > 1) d += `L${f(last.x)} ${f(last.y)}`
  return d
}

/** Drop repeated and collinear points. */
export function dedupe(points: Pt[]): Pt[] {
  const out: Pt[] = []
  for (const p of points) {
    const q = out[out.length - 1]
    if (q && Math.abs(q.x - p.x) < 0.01 && Math.abs(q.y - p.y) < 0.01) continue
    out.push(p)
  }
  for (let i = out.length - 2; i >= 1; i--) {
    const A = out[i - 1]
    const B = out[i]
    const C = out[i + 1]
    const cross = (B.x - A.x) * (C.y - B.y) - (B.y - A.y) * (C.x - B.x)
    const dot = (B.x - A.x) * (C.x - B.x) + (B.y - A.y) * (C.y - B.y)
    if (Math.abs(cross) < 0.01 && dot >= 0) out.splice(i, 1)
  }
  return out
}

/**
 * Pick the path form: a clean 2-bend orthogonal route uses the elbow
 * (radius 18); everything else the rounded polyline (radius 12).
 */
export function wirePath(points: Pt[], elbowRadius: number, cornerRadius: number): string {
  const p = dedupe(points)
  if (p.length === 2) return roundedPolyline(p, cornerRadius)
  if (p.length === 4) {
    const [a, b, c, d] = p
    const hvh = Math.abs(a.y - b.y) < 0.01 && Math.abs(b.x - c.x) < 0.01 && Math.abs(c.y - d.y) < 0.01
    const vhv = Math.abs(a.x - b.x) < 0.01 && Math.abs(b.y - c.y) < 0.01 && Math.abs(c.x - d.x) < 0.01
    if (hvh && Math.sign(b.x - a.x) === Math.sign(d.x - c.x)) return elbowPath(a.x, a.y, d.x, d.y, b.x, elbowRadius)
    if (vhv && Math.sign(b.y - a.y) === Math.sign(d.y - c.y)) return elbowPathV(a.x, a.y, d.x, d.y, b.y, elbowRadius)
  }
  return roundedPolyline(p, cornerRadius)
}

/**
 * Flatten a wire path (absolute `M L H V Q`, as the builders above emit) into a dense polyline
 * that follows the drawn curve: each quadratic corner is sampled so the chord error stays well
 * under 0.1 px. Pulse routes, trails and draw-on lengths use this, so everything animated along a
 * wire lies on the same rounded geometry as the wire itself.
 */
export function flattenPath(d: string): Pt[] {
  const out: Pt[] = []
  const toks = d.match(/[MLHVQ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []
  let i = 0
  let cur: Pt = { x: 0, y: 0 }
  const num = () => Number(toks[i++])
  const push = (p: Pt) => {
    const q = out[out.length - 1]
    if (!q || Math.abs(q.x - p.x) > 1e-6 || Math.abs(q.y - p.y) > 1e-6) out.push({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 })
    cur = p
  }
  while (i < toks.length) {
    const c = toks[i++].toUpperCase()
    if (c === "M" || c === "L") push({ x: num(), y: num() })
    else if (c === "H") push({ x: num(), y: cur.y })
    else if (c === "V") push({ x: cur.x, y: num() })
    else if (c === "Q") {
      const p0 = cur
      const p1 = { x: num(), y: num() }
      const p2 = { x: num(), y: num() }
      // Segments from the control polygon length: ~1 per 1.5 px, at least 8.
      const len = Math.hypot(p1.x - p0.x, p1.y - p0.y) + Math.hypot(p2.x - p1.x, p2.y - p1.y)
      const n = Math.max(8, Math.ceil(len / 1.5))
      for (let k = 1; k <= n; k++) {
        const u = k / n
        const a = (1 - u) * (1 - u)
        const b = 2 * u * (1 - u)
        const e = u * u
        push({ x: a * p0.x + b * p1.x + e * p2.x, y: a * p0.y + b * p1.y + e * p2.y })
      }
    }
  }
  return out
}
