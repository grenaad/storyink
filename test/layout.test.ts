import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { layout } from "../src/core/layout/index.ts"
import { elbowPath, roundedPolyline } from "../src/core/layout/paths.ts"
import { textWidth } from "../src/core/layout/measure.ts"
import { validate } from "../src/core/validate.ts"
import { fromMermaid } from "../src/core/mermaid/index.ts"

const ex = path.join(import.meta.dir, "..", "examples")
const specs = [
  ...fs.readdirSync(ex).filter((f) => f.endsWith(".json")).map((f) => validate(fs.readFileSync(path.join(ex, f), "utf8")).spec!),
  ...fs.readdirSync(path.join(ex, "mermaid")).map((f) => fromMermaid(fs.readFileSync(path.join(ex, "mermaid", f), "utf8")).spec!),
]

describe("paths", () => {
  test("elbow matches the documented form", () => {
    expect(elbowPath(0, 0, 100, 60, 50, 18)).toBe("M0 0H32Q50 0 50 18V42Q50 60 68 60H100")
    expect(elbowPath(0, 0, 100, 0.5, 50, 18)).toBe("M0 0H100")
  })
  test("polyline clamps the radius to half-segments", () => {
    expect(roundedPolyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 100 }], 12)).toBe("M0 0L5 0Q10 0 10 5L10 100")
  })
  test("mono measurement", () => {
    expect(textWidth("abcd", 10)).toBe(24)
  })
})

describe("layout", () => {
  test("examples: deterministic, finite, no overlapping nodes, stable ids", () => {
    expect(specs.length).toBe(8)
    for (const s of specs) {
      const a = layout(s)
      const b = layout(s)
      expect(JSON.stringify(a)).toBe(JSON.stringify(b))
      expect(JSON.stringify(a)).not.toMatch(/NaN|Infinity|null/)
      const n = a.nodes
      for (let i = 0; i < n.length; i++)
        for (let j = i + 1; j < n.length; j++) {
          const p = n[i]
          const q = n[j]
          const hit = p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h
          if (hit) throw new Error(`${s.title}: ${p.id} overlaps ${q.id}`)
        }
      const ids = [...a.nodes.map((x) => x.id), ...a.edges.map((x) => x.id), ...a.groups.map((x) => x.id), ...a.ports.map((x) => x.id)]
      expect(new Set(ids).size).toBe(ids.length)
      // Every node sits inside the viewBox.
      for (const x of a.nodes) {
        expect(x.x).toBeGreaterThanOrEqual(a.viewBox.x)
        expect(x.x + x.w).toBeLessThanOrEqual(a.viewBox.x + a.viewBox.w)
      }
    }
  })

  test("group boxes contain their members", () => {
    const s = specs.find((x) => x.title === "Checkout platform")!
    const sc = layout(s)
    const g = sc.groups.find((x) => x.id === "data")!
    for (const id of ["db", "cache", "events"]) {
      const n = sc.nodes.find((x) => x.id === id)!
      expect(n.x).toBeGreaterThan(g.x)
      expect(n.y).toBeGreaterThan(g.y)
      expect(n.x + n.w).toBeLessThan(g.x + g.w)
      expect(n.y + n.h).toBeLessThan(g.y + g.h)
    }
  })

  test("cycles are laid out", () => {
    const v = validate({ type: "workflow", title: "c", nodes: [{ id: "a" }, { id: "b" }, { id: "c" }], edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "a" }, { from: "b", to: "b" }] })
    const sc = layout(v.spec!)
    expect(sc.edges.length).toBe(4)
    for (const e of sc.edges) expect(e.d.startsWith("M")).toBe(true)
  })
})
