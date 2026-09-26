import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { flattenPath, storyState, toScene, type Scene } from "../src/core/index.ts"

type P = { x: number; y: number }
/** Independent dense sampling of an absolute M/L/H/V/Q path (400 samples per curve). */
function dense(d: string): P[] {
  const t = d.match(/[MLHVQ]|-?\d*\.?\d+/g)!
  const out: P[] = []
  let i = 0
  let c = { x: 0, y: 0 }
  const n = () => Number(t[i++])
  while (i < t.length) {
    const k = t[i++]
    if (k === "M" || k === "L") c = { x: n(), y: n() }
    else if (k === "H") c = { x: n(), y: c.y }
    else if (k === "V") c = { x: c.x, y: n() }
    else {
      const p0 = c
      const p1 = { x: n(), y: n() }
      const p2 = { x: n(), y: n() }
      for (let j = 1; j <= 400; j++) {
        const u = j / 400
        out.push({ x: (1 - u) ** 2 * p0.x + 2 * u * (1 - u) * p1.x + u * u * p2.x, y: (1 - u) ** 2 * p0.y + 2 * u * (1 - u) * p1.y + u * u * p2.y })
      }
      c = p2
      continue
    }
    out.push(c)
  }
  return out
}
const segDist = (p: P, a: P, b: P) => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const L = dx * dx + dy * dy
  const u = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0
  return Math.hypot(p.x - a.x - u * dx, p.y - a.y - u * dy)
}
const dist = (p: P, poly: P[]) => {
  let m = Infinity
  for (let i = 1; i < poly.length; i++) m = Math.min(m, segDist(p, poly[i - 1], poly[i]))
  return m
}
const verts = (d: string): P[] => [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }))

const real = JSON.parse(fs.readFileSync(path.join(import.meta.dir, "fixtures/openwick-architecture.json"), "utf8"))
const scenes: [string, Scene][] = [
  ["openwick", toScene(real)],
  ...fs
    .readdirSync("examples")
    .filter((f) => f.endsWith(".json"))
    .map((f) => [f, toScene(JSON.parse(fs.readFileSync(`examples/${f}`, "utf8")))] as [string, Scene]),
]

describe("animated overlays follow the rounded wire", () => {
  test("flattenPath stays within 0.1 px of the curve and keeps the endpoints", () => {
    for (const [, s] of scenes)
      for (const e of s.edges) {
        const f = flattenPath(e.d)
        const ref = dense(e.d)
        for (const p of f) expect(dist(p, ref)).toBeLessThan(0.1)
        for (const p of ref.filter((_, i) => i % 7 === 0)) expect(dist(p, f)).toBeLessThan(0.1)
        expect(f[0]).toEqual({ x: e.points[0].x, y: e.points[0].y })
      }
  })
  for (const [name, s] of scenes) {
    const tl = s.timeline
    if (!tl) continue
    test(`${name}: pulse dots and trail vertices lie on the rounded curve (≤ 0.5 px), corners included`, () => {
      const byId = new Map(s.edges.map((e) => [e.id, e]))
      let checked = 0
      let atCorners = 0
      for (const p of tl.pulses) {
        // The wires of the route; between hops the dot crosses the node straight (end → next start).
        const curve = p.edges.flatMap((id) => dense(byId.get(id)!.d))
        const corners = p.edges.flatMap((id) => byId.get(id)!.points.slice(1, -1))
        for (let k = 0; k <= 40; k++) {
          const t = p.tf0 + ((p.tf1 - p.tf0) * k) / 40
          const pf = storyState(s, tl, t).pulses.find((x) => x.id === p.id)
          if (!pf) continue
          const pts = [{ x: pf.x, y: pf.y }, ...pf.trail.flatMap((x) => verts(x.d))]
          for (const q of pts) {
            expect(dist(q, curve)).toBeLessThanOrEqual(0.5)
            checked++
            if (corners.some((c) => Math.hypot(c.x - q.x, c.y - q.y) < 16)) atCorners++
          }
        }
        // The raw polyline corner is never part of an animated path.
        for (const c of corners) for (const v of verts(storyState(s, tl, p.tf1 - 0.01).pulses.find((x) => x.id === p.id)?.trail.map((x) => x.d).join("") ?? "")) expect(Math.hypot(v.x - c.x, v.y - c.y) > 0.5 || dist(c, curve) < 0.5).toBe(true)
      }
      expect(checked).toBeGreaterThan(0)
      if (s.edges.some((e) => e.points.length > 2 && e.d.includes("Q"))) expect(atCorners).toBeGreaterThan(0)
    })
  }
  test("pulse arc lengths match their route (spans, length)", () => {
    for (const [, s] of scenes)
      for (const p of s.timeline?.pulses ?? []) {
        let L = 0
        for (let i = 1; i < p.points.length; i++) L += Math.hypot(p.points[i].x - p.points[i - 1].x, p.points[i].y - p.points[i - 1].y)
        expect(Math.abs(p.length - L)).toBeLessThan(0.05)
        expect(Math.abs(p.spans.at(-1)!.s1 - p.length)).toBeLessThan(1e-6)
        for (let k = 1; k < p.spans.length; k++) expect(p.spans[k].s0).toBeGreaterThanOrEqual(p.spans[k - 1].s1)
      }
  })
  test("draw-on dash length is the rounded wire's length", () => {
    const [, s] = scenes[0]
    for (const e of s.edges) {
      const f = flattenPath(e.d)
      let L = 0
      for (let i = 1; i < f.length; i++) L += Math.hypot(f[i].x - f[i - 1].x, f[i].y - f[i - 1].y)
      expect(Math.abs((e.length ?? 0) - L)).toBeLessThan(0.02)
    }
  })
})
