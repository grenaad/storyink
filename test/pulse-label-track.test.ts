import { describe, expect, test } from "bun:test"
import { toScene } from "../src/core/index.ts"
import { PULSE_LABEL, pulseLabel, storyState } from "../src/core/story/state.ts"
import { pulseEase } from "../src/core/story/ease.ts"
import { textWidth } from "../src/core/layout/measure.ts"
import type { Scene } from "../src/core/scene.ts"
import type { Timeline } from "../src/core/story/types.ts"

const spec = (pulse: unknown, direction = "LR", extraEdges: object[] = []) => ({
  type: "dataflow",
  title: "t",
  direction,
  nodes: [
    { id: "a", kind: "client", label: "browser" },
    { id: "b", kind: "service", label: "api" },
    { id: "c", kind: "database", label: "db" },
  ],
  edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }, ...extraEdges],
  groups: [],
  story: { steps: [{ pulse }] },
})
type P = Timeline["pulses"][number]
const dotS = (p: P, t: number) => pulseEase(p, (t - p.tf0) / (p.tf1 - p.tf0)) * p.length
/** Label box (approximate text extent) and whether it overlaps a node box. */
const box = (l: { x: number; y: number; text: string }) => ({ x0: l.x, x1: l.x + textWidth(l.text, PULSE_LABEL.size), y0: l.y - PULSE_LABEL.size * 0.72, y1: l.y + PULSE_LABEL.size * 0.22 })
const hitsNode = (S: Scene, l: { x: number; y: number; text: string }) => {
  const b = box(l)
  return S.nodes.some((n) => b.x1 > n.x && b.x0 < n.x + n.w && b.y1 > n.y && b.y0 < n.y + n.h)
}
const samples = (p: P, n = 120) => Array.from({ length: n + 1 }, (_, i) => p.tf0 + ((p.tf1 - p.tf0) * i) / n)

describe("pulse label track: hold, follow, hold, then fade after arrival", () => {
  const S = toScene(spec({ edge: "a->b", label: "POST /orders" }))
  const p = S.timeline!.pulses[0]
  test("source hold: visible right after departure, parked clear of the source box", () => {
    const l0 = pulseLabel(p, p.tf0 + PULSE_LABEL.fadeIn)!
    const l1 = pulseLabel(p, p.tf0 + PULSE_LABEL.fadeIn + 0.05)!
    expect(l0.o).toBe(1)
    expect(l1.x).toBe(l0.x) // held while the dot catches up
    expect(hitsNode(S, l0)).toBe(false)
  })
  test("following: in the middle the label is centred over the dot", () => {
    const t = (p.tf0 + p.tf1) / 2
    const f = storyState(S, S.timeline!, t).pulses.find((x) => x.id === p.id)!
    expect(f.label!.x + textWidth("POST /orders", PULSE_LABEL.size) / 2).toBeCloseTo(f.x, 1)
    expect(f.label!.y).toBeLessThan(f.y)
  })
  test("destination hold and contact: parked, fully visible until the dot touches; fades after", () => {
    const pre = pulseLabel(p, p.tf1 - 0.08)!
    const at = pulseLabel(p, p.tf1)!
    expect(pre.o).toBe(1)
    expect(at.o).toBe(1)
    expect(at.x).toBe(pre.x)
    expect(hitsNode(S, at)).toBe(false)
    expect(pulseLabel(p, p.tf1 + PULSE_LABEL.fadeOut / 2)!.o).toBeLessThan(1)
    expect(pulseLabel(p, p.tf1 + PULSE_LABEL.fadeOut)).toBeUndefined()
    // The frame keeps the label through contact (storyState includes it at tf1).
    expect(storyState(S, S.timeline!, p.tf1).pulses.find((x) => x.id === p.id)?.label?.o).toBe(1)
  })
  test("never overlaps a box and never jumps across the whole flight", () => {
    let prev: { x: number; y: number } | undefined
    for (const t of samples(p)) {
      const l = pulseLabel(p, t)
      if (!l) continue
      expect(hitsNode(S, l)).toBe(false)
      if (prev) expect(Math.hypot(l.x - prev.x, l.y - prev.y)).toBeLessThan(p.length / 20)
      prev = l
    }
  })
})

describe("pulse label track: variants", () => {
  test("reversed pulse: holds at the (visual) source, follows, holds at the arrival end", () => {
    const S = toScene(spec({ edge: "a->b", reverse: true, label: "201" }))
    const p = S.timeline!.pulses[0]
    const first = pulseLabel(p, p.tf0 + PULSE_LABEL.fadeIn)!
    const last = pulseLabel(p, p.tf1)!
    // Travelling right-to-left: starts near b, ends near a.
    expect(first.x).toBeGreaterThan(last.x)
    for (const t of samples(p)) {
      const l = pulseLabel(p, t)
      if (l) expect(hitsNode(S, l)).toBe(false)
    }
  })
  test("land: edge — label visible at arrival, then crossfades out as the edge label lands", () => {
    const S = toScene(spec({ edge: "a->b", label: "201", land: "edge" }))
    const p = S.timeline!.pulses[0]
    expect(pulseLabel(p, p.tf1)!.o).toBe(1)
    expect(pulseLabel(p, p.tf1 + PULSE_LABEL.fadeOut)).toBeUndefined()
  })
  test("multi-hop: hands off between hops without drawing over the intermediate node", () => {
    const S = toScene(spec({ route: ["a->b", "b->c"], label: "POST /orders" }))
    const p = S.timeline!.pulses[0]
    let dipped = false
    let prev: { x: number; y: number; o: number } | undefined
    for (const t of samples(p, 400)) {
      const l = pulseLabel(p, t)
      const s = dotS(p, t)
      if (s > p.spans[0].s1 && s < p.spans[1].s0 && (!l || l.o < 1)) dipped = true
      if (!l) continue
      expect(hitsNode(S, l)).toBe(false)
      // A position change larger than a frame's drift only happens while nearly transparent.
      if (prev && Math.hypot(l.x - prev.x, l.y - prev.y) > 20) expect(Math.min(prev.o, l.o)).toBeLessThan(0.1)
      prev = l
    }
    expect(dipped).toBe(true)
    expect(pulseLabel(p, p.tf1)!.o).toBe(1)
  })
  test("very short path: the label is pinned at the midpoint, still visible to contact", () => {
    const S = toScene({ ...spec({ edge: "a->b", label: "a very long label!!" }), nodes: [{ id: "a", label: "a" }, { id: "b", label: "b" }], edges: [{ from: "a", to: "b" }] })
    const p = S.timeline!.pulses[0]
    const a = pulseLabel(p, p.tf0 + PULSE_LABEL.fadeIn)!
    const b = pulseLabel(p, p.tf1)!
    if (p.length < textWidth("a very long label!!", PULSE_LABEL.size) + 2 * PULSE_LABEL.gap) expect(b.x).toBe(a.x)
    expect(b.o).toBe(1)
  })
  test("vertical wire: label right of the wire, clear of the boxes", () => {
    const S = toScene(spec({ edge: "a->b", label: "GET /x" }, "TB"))
    const p = S.timeline!.pulses[0]
    for (const t of samples(p)) {
      const l = pulseLabel(p, t)
      if (l) expect(hitsNode(S, l)).toBe(false)
    }
  })
  test("reduced motion: still no in-flight labels", () => {
    const S = toScene(spec({ edge: "a->b", label: "201" }))
    const p = S.timeline!.pulses[0]
    expect(storyState(S, S.timeline!, (p.tf0 + p.tf1) / 2, { reduced: true }).pulses).toEqual([])
  })
})
