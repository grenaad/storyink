import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import { beatGroups, beatMotionEnds, beatStops, stepMoveTarget, storyState } from "../src/core/story/state.ts"
import { recompilePace } from "../src/core/story/compile.ts"
import { layout } from "../src/core/layout/index.ts"
import { renderSvg } from "../src/core/render/index.tsx"
import { validate } from "../src/core/validate.ts"
import type { Spec } from "../src/core/spec.ts"

// The README hero: an on-call agent triages a 5xx spike and shifts traffic to a healthy pool.
const v = validate(fs.readFileSync("examples/checkout-recovery.architecture.json", "utf8"))
const spec = v.spec as Spec
const sc = layout(spec)

describe("checkout-recovery example", () => {
  test("validates with no diagnostics", () => {
    expect(v.diagnostics).toEqual([])
  })

  for (const pace of [0, 0.3, 0.6, 1, 1.5]) {
    test(`pace ${pace}: → steps stop only after every pulse of the beat has arrived`, () => {
      const tl = recompilePace(sc, pace)!
      const G = beatGroups(tl)
      // Both → targets (graph-motion ends) and settled beat stops: no dot in flight at any of them.
      for (const list of [[...beatMotionEnds(tl), tl.duration], beatStops(tl)]) {
        let from = 0
        G.forEach((g, k) => {
          const t = stepMoveTarget(list, from, 1, tl.duration)
          expect(t).toBe(list[k])
          for (const p of tl.pulses.filter((q) => g.some((i) => q.id.startsWith(`pulse-${i}-`)))) expect(t).toBeGreaterThanOrEqual(p.tf1 - 1e-6)
          const fr = storyState(sc, tl, t)
          for (const p of tl.pulses) {
            const f = fr.pulses.find((x) => x.id === p.id)
            expect({ p: p.id, flying: !!f && f.o > 0.005 && !f.ring && t >= p.tf0 }).toEqual({ p: p.id, flying: false })
          }
          from = t
        })
      }
      const from = beatStops(tl)[G.length - 1]
      expect(from).toBeLessThanOrEqual(tl.duration)
    })
  }

  test("no future content before its step", () => {
    const tl = sc.timeline!
    const t0 = (i: number) => tl.steps[i].t0
    const steps = (spec.story as { steps: any[] }).steps
    const stepOf = (pred: (s: any) => boolean) => steps.findIndex(pred)
    for (const [row, at] of Object.entries(tl.appear)) expect(storyState(sc, tl, at - 0.01).el[row].o).toBe(0)
    // Program 1 is untyped until its run; program 2 doesn't exist before its set.
    const typeRun = tl.typing!.filter((r) => r.target === "script")
    expect(typeRun).toHaveLength(2)
    expect(storyState(sc, tl, typeRun[0].t0 - 0.01).content!.script[0].chars!.every((c) => c === 0)).toBe(true)
    const swap = stepOf((s) => s.set?.id === "script")
    for (const t of [0.5, 4, 8, t0(swap) - 0.3]) expect((storyState(sc, tl, t).content?.script ?? []).every((l) => l.v === 0)).toBe(true)
    const f = storyState(sc, tl, t0(swap) + 0.01)
    expect(f.content!.script.map((l) => l.v)).toEqual([1])
    expect(f.content!.script[0].chars!.every((c) => c <= 2)).toBe(true)
    // run2 is undrawn until its wire step; to-a is retired at the shift.
    expect(storyState(sc, tl, t0(stepOf((s) => s.wire?.edge === "run2")) - 0.01).draw.run2).toBe(0)
    expect((storyState(sc, tl, t0(stepOf((s) => s.unwire === "to-a")) - 0.01) as any).undraw?.["to-a"] ?? 0).toBe(0)
    expect((storyState(sc, tl, tl.duration) as any).undraw["to-a"]).toBe(1)
  })

  test("end frame is the static diagram's story end state (no spinner, no glow)", () => {
    const tl = sc.timeline!
    const end = storyState(sc, tl, tl.duration)
    expect(end.settled).toBe(true)
    expect(Object.values(end.status ?? {}).some((s) => s.spin !== undefined)).toBe(false)
    expect(Object.values(end.lit ?? {}).some((x) => x > 0)).toBe(false)
    expect(renderSvg(spec, { theme: "dark", t: tl.duration })).toBe(renderSvg(spec, { theme: "dark" }))
  })
})
