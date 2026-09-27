import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { beatGroups, mapStoryTime, parseHash, recompilePace, tokens, toScene, validate, type Spec } from "../src/core/index.ts"
import { PACE_PRESETS, paceLabel, resolvePace } from "../src/core/render/App.tsx"

const load = (f: string) => validate(JSON.parse(fs.readFileSync(f, "utf8"))).spec as Spec
const specs: [string, Spec][] = [
  ["openwick", load(path.join(import.meta.dir, "fixtures/openwick-architecture.json"))],
  ["checkout", load("examples/checkout.architecture.json")],
  ["oauth", load("examples/oauth.sequence.json")],
  ["auto", validate({ ...JSON.parse(fs.readFileSync("examples/release.workflow.json", "utf8")), story: "auto" }).spec as Spec],
]
const withPace = (spec: Spec, pace: number): Spec =>
  ({ ...spec, story: spec.story === "auto" ? { steps: "auto", pace } : { ...(spec.story as object), pace } }) as Spec

describe("pace", () => {
  test("default is 0.6", () => {
    expect(tokens.story.hold.pace).toBe(0.6)
    for (const [, spec] of specs) expect(toScene(spec).timeline!.pace).toBe(0.6)
  })
  test("resolver precedence: #pace= > stored > author > 0.6", () => {
    expect(resolvePace({})).toBe(0.6)
    expect(resolvePace({ author: 1 })).toBe(1)
    expect(resolvePace({ author: 1, stored: "0.3" })).toBe(0.3)
    expect(resolvePace({ author: 1, stored: "0.3", hash: 0 })).toBe(0)
    expect(resolvePace({ author: 1, stored: "junk" })).toBe(1)
    expect(resolvePace({ stored: "-2" })).toBe(0.6)
    expect(parseHash("#pace=1.5").pace).toBe(1.5)
    expect(parseHash("#pace=x").pace).toBeUndefined()
    expect(PACE_PRESETS.map((p) => p.pace)).toEqual([0, 0.3, 0.6, 1, 1.5])
    expect(paceLabel(0.6)).toBe("Normal")
    expect(paceLabel(0.8)).toBe("0.8×")
  })
  for (const [name, spec] of specs)
    test(`${name}: browser recompile equals the Node compile at several paces`, () => {
      const scene = toScene(spec) // as embedded in the HTML (JSON round trip below)
      const embedded = JSON.parse(JSON.stringify(scene))
      for (const p of [0, 0.3, 0.6, 1, 1.5, 2.25]) {
        const node = toScene(withPace(spec, p)).timeline
        const browser = recompilePace(embedded, p)
        expect(JSON.stringify(browser)).toBe(JSON.stringify(node))
      }
    })
  for (const [name, spec] of specs)
    test(`${name}: a pace change keeps the beat and the progress through it`, () => {
      const a = toScene(withPace(spec, 0.6)).timeline!
      const b = toScene(withPace(spec, 1.5)).timeline!
      const ga = beatGroups(a)
      const beatAt = (tl: typeof a, t: number) => {
        const g = beatGroups(tl)
        let k = -1
        for (let i = 0; i < g.length; i++) if (tl.steps[g[i][0]].t0 <= t + 1e-9) k = i
        return k
      }
      for (let k = 0; k < ga.length; k++) {
        const s0 = a.steps[ga[k][0]].t0
        const s1 = k + 1 < ga.length ? a.steps[ga[k + 1][0]].t0 : a.duration
        for (const f of [0, 0.1, 0.4, 0.8, 0.99]) {
          const t = s0 + (s1 - s0) * f
          const u = mapStoryTime(a, b, t)
          expect(beatAt(b, u)).toBe(beatAt(a, t))
          // Animated part keeps its offset exactly (the holds are what changed).
          if (t - s0 < 0.5) expect(u - b.steps[beatGroups(b)[k][0]].t0).toBeCloseTo(t - s0, 6)
          // Round trip.
          expect(mapStoryTime(b, a, u)).toBeCloseTo(t, 6)
        }
      }
      expect(mapStoryTime(a, b, a.duration)).toBe(b.duration)
      expect(mapStoryTime(a, b, 0)).toBe(0)
    })
})
