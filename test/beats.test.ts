import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { beatGroups, beatStops, stepBoundary, stepMoveTarget, storyState, toScene } from "../src/core/index.ts"

const real = JSON.parse(fs.readFileSync(path.join(import.meta.dir, "fixtures/openwick-architecture.json"), "utf8"))
const cases: [string, unknown][] = [
  ["openwick architecture", real],
  ...fs
    .readdirSync("examples")
    .filter((f) => f.endsWith(".json"))
    .map((f) => [f, JSON.parse(fs.readFileSync(`examples/${f}`, "utf8"))] as [string, unknown]),
]

describe("beats: → lands on a settled beat", () => {
  for (const [name, spec] of cases) {
    const s = toScene(spec)
    const tl = s.timeline
    if (!tl) continue
    test(`${name}: from each beat stop, → ends with the beat's reveals at full opacity and no pulse in flight`, () => {
      const stops = beatStops(tl)
      const groups = beatGroups(tl)
      expect(stops.length).toBe(groups.length + 1)
      let from = 0
      groups.forEach((g, k) => {
        // → from the previous stop (or 0) lands exactly on this beat's stop.
        const t = stepMoveTarget(stops, from, 1, tl.duration)
        expect(t).toBe(stops[k])
        const fr = storyState(s, tl, t)
        const t0 = tl.steps[g[0]].t0
        const t1 = tl.steps[g[g.length - 1]].t1
        // Everything this beat's steps reveal (at a step start) and every box its pulses reach is fully visible.
        const starts = g.map((i) => tl.steps[i].t0)
        const ids = Object.entries(tl.appear).filter(([, at]) => starts.some((x) => Math.abs(x - at) < 1e-6)).map(([id]) => id)
        for (const p of tl.pulses) if (p.t0 >= t0 - 1e-6 && p.t0 <= t && p.target && s.nodes.some((n) => n.id === p.target)) ids.push(p.target)
        for (const id of ids) {
          const e = fr.el[id]
          expect({ id, o: e ? e.o : 1, dy: e ? Math.abs(e.dy) < 0.05 : true }).toEqual({ id, o: 1, dy: true })
        }
        // No dot still flying.
        for (const p of tl.pulses) {
          const f = fr.pulses.find((x) => x.id === p.id)
          // Not drawn as a moving dot: either not started, or landed (ring / cooling trail only).
          expect({ p: p.id, flying: !!f && f.o > 0.005 && !f.ring && t >= p.tf0 }).toEqual({ p: p.id, flying: false })
        }
        // The beat's caption, if any, is whole.
        const cur = fr.captions.find((c) => c.current)
        if (g.some((i) => tl.steps[i].caption)) {
          expect(cur).toBeDefined()
          expect(cur!.words.every((w) => w >= 0.999)).toBe(true)
        }
        expect(t).toBeLessThanOrEqual(t1 + 1e-6)
        from = t
      })
      // ← from each stop goes back to the previous stop.
      for (let k = stops.length - 1; k > 0; k--) expect(stepBoundary(stops, stops[k], -1, tl.duration)).toBe(stops[k - 1])
    })
  }
  test("openwick: a pulse and the reveal it causes are one beat", () => {
    const tl = toScene(real).timeline!
    const g = beatGroups(tl).find((x) => x.includes(7))!
    expect(g).toEqual([7, 8])
  })
})
