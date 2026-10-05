import { describe, expect, test } from "bun:test"
import { animatedSvg, toScene } from "../src/core/index.ts"
import { pulseFlight } from "../src/core/story/compile.ts"
import { pulseLabel } from "../src/core/story/state.ts"

const base = {
  type: "dataflow",
  title: "t",
  direction: "LR",
  nodes: [
    { id: "a", kind: "client", label: "browser" },
    { id: "b", kind: "service", label: "api" },
    { id: "c", kind: "database", label: "db" },
  ],
  edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }],
  groups: [],
}
const tl = (pulse: unknown) => toScene({ ...base, story: { steps: [{ pulse }] } }).timeline!
const flight = (pulse: unknown) => {
  const p = tl(pulse).pulses[0]
  return p.tf1 - p.tf0
}

describe("pulse flight timing", () => {
  test("unlabelled pulses keep the distance rule (L / 520 px/s in [0.45, 1.6] s)", () => {
    const p = tl("a->b").pulses[0]
    expect(p.tf1 - p.tf0).toBeCloseTo(Math.min(1.6, Math.max(0.45, p.length / 520)), 6)
    expect(flight({ edge: "a->b", tone: "note" })).toBeCloseTo(p.tf1 - p.tf0, 6)
  })
  test("labelled pulses fly slow enough to read the label, within [1.2, 3.2] s", () => {
    const plain = flight("a->b")
    const short = flight({ edge: "a->b", label: "201" })
    const long = flight({ edge: "a->b", label: "POST /orders" })
    expect(short).toBeGreaterThanOrEqual(1.2)
    expect(short).toBeGreaterThan(plain)
    expect(long).toBeGreaterThan(short)
    expect(long).toBeLessThanOrEqual(3.2)
    // Longer wires leave more legible distance: the budget needs less slowing.
    expect(pulseFlight(800, "POST /orders")).toBeLessThan(pulseFlight(250, "POST /orders"))
    expect(pulseFlight(800, "POST /orders")).toBeGreaterThanOrEqual(pulseFlight(800))
    // Unlabelled defaults are untouched.
    expect(pulseFlight(10)).toBe(0.45)
    expect(pulseFlight(400)).toBeCloseTo(400 / 520, 9)
    expect(pulseFlight(5000)).toBe(1.6)
  })
  test("an authored duration wins over the label default", () => {
    expect(flight({ edge: "a->b", label: "POST /orders", duration: 0.5 })).toBeCloseTo(0.5, 6)
  })
  test("the label is legible across most of the slower flight", () => {
    const p = tl({ edge: "a->b", label: "POST /orders" }).pulses[0]
    let shown = 0
    const n = 200
    for (let i = 0; i < n; i++) if ((pulseLabel(p, p.tf0 + ((p.tf1 - p.tf0) * i) / n)?.o ?? 0) >= 0.5) shown++
    // 0.6 s + 0.05 s × 12 chars = 1.2 s of reading budget (minus the ramp margin).
    expect((shown / n) * (p.tf1 - p.tf0)).toBeGreaterThan(1)
  })
  test("the animated SVG carries the same flight", () => {
    const S = toScene({ ...base, story: { steps: [{ pulse: { edge: "a->b", label: "POST /orders" } }] } })
    const p = S.timeline!.pulses[0]
    const svg = animatedSvg(S)
    expect(svg.svg).toContain("POST /orders")
    expect(svg.duration).toBeGreaterThanOrEqual(p.tf1)
  })
})
