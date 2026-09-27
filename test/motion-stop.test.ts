import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { beatGroups, beatIndexAt, beatMotionEnds, beatMotionStarts, beatStops, captionForBeat, skipGap, stepMoveTarget, storyState, toScene } from "../src/core/index.ts"

const cases: [string, unknown][] = [
  ["openwick", JSON.parse(fs.readFileSync(path.join(import.meta.dir, "fixtures/openwick-architecture.json"), "utf8"))],
  ["checkout", JSON.parse(fs.readFileSync("examples/checkout.architecture.json", "utf8"))],
  ["oauth", JSON.parse(fs.readFileSync("examples/oauth.sequence.json", "utf8"))],
]

describe("step moves stop at the end of the graph motion", () => {
  for (const [name, spec] of cases) {
    const s = toScene(spec)
    const tl = s.timeline!
    const G = beatGroups(tl)
    const E = beatMotionEnds(tl)
    const S = beatMotionStarts(tl)
    const settled = beatStops(tl)
    test(`${name}: targets are the graph-motion ends, before the settled stop and the hold`, () => {
      const list = [...E, tl.duration]
      let from = 0
      let faster = 0
      G.forEach((g, k) => {
        const t = stepMoveTarget(list, from, 1, tl.duration)
        expect(t).toBe(E[k])
        // Graph done: pulses landed, the beat's reveals at full opacity, target boxes shown.
        const fr = storyState(s, tl, t)
        for (const p of tl.pulses.filter((q) => g.some((i) => q.id.startsWith(`pulse-${i}-`)))) {
          expect(t).toBeGreaterThanOrEqual(p.tf1 - 1e-6)
          if (p.target && fr.el[p.target]) expect(fr.el[p.target].o).toBe(1)
        }
        for (const [id, at] of Object.entries(tl.appear)) if (g.some((i) => Math.abs(tl.steps[i].t0 - at) < 1e-6)) expect({ id, o: fr.el[id]?.o ?? 1 }).toEqual({ id, o: 1 })
        // Not waiting for text, glows or the hold: at or before the beat's still point, i.e. the
        // start of its reading hold (next beat start − hold − lead ≤ that).
        if (k + 1 < G.length) {
          const hold = tl.steps[g[g.length - 1]].hold ?? 0
          expect(t).toBeLessThanOrEqual(S[k + 1] - hold + 1e-6)
        }
        // Usually well before the old (text-inclusive) settled stop.
        if (t < settled[k] - 0.05) faster++
        from = t
      })
      if (G.some((g) => g.some((i) => tl.steps[i].caption))) expect(faster).toBeGreaterThan(0)
    })
    test(`${name}: a press during a reading hold starts the next beat at once`, () => {
      for (let k = 0; k + 1 < G.length; k++) {
        const holdMid = (E[k] + S[k + 1]) / 2
        if (S[k + 1] - E[k] < 0.05) continue
        expect(skipGap(E, S, holdMid, 1, E[k + 1])).toBe(S[k + 1])
        expect(skipGap(E, S, E[k], 1, E[k + 1])).toBe(S[k + 1])
        // Rewinding across the gap lands on the earlier beat's motion end.
        expect(skipGap(E, S, S[k + 1], -1, E[k])).toBe(E[k])
        // Inside a beat's own motion nothing is skipped.
        const inside = (S[k] + E[k]) / 2
        if (E[k] - S[k] > 0.05) expect(skipGap(E, S, inside, 1, E[k + 1])).toBe(inside)
      }
      expect(beatIndexAt(tl, S[1])).toBe(1)
    })
    test(`${name}: step-move rendering shows the beat's caption whole, instantly; default unchanged`, () => {
      G.forEach((_, k) => {
        const c = captionForBeat(tl, k)
        const fr = storyState(s, tl, S[k] + 0.01, { captionBeat: k })
        if (c < 0) expect(fr.captions).toEqual([])
        else {
          expect(fr.captions).toHaveLength(1)
          expect(fr.captions[0].text).toBe(tl.captions[c].text)
          expect(fr.captions[0].o).toBe(1)
          expect(fr.captions[0].words.every((w) => w === 1)).toBe(true)
        }
      })
      // The default (continuous play) still types: early in a captioned beat the words aren't all in.
      const k = G.findIndex((g) => g.some((i) => tl.steps[i].caption))
      const typed = storyState(s, tl, tl.steps[G[k].find((i) => tl.steps[i].caption)!].t0 + 0.05)
      expect(typed.captions.find((c) => c.current)!.words.some((w) => w < 1)).toBe(true)
      expect(JSON.stringify(storyState(s, tl, 3.3))).toBe(JSON.stringify(storyState(s, tl, 3.3, {})))
    })
  }
})
