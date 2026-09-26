import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import { parseHash, steppedIndex, steppedSchedule, steppedStop, steppedTime, storyState, STEP_BEAT, toScene } from "../src/core/index.ts"
import { resolveMotion } from "../src/core/render/App.tsx"
import { readTime } from "../src/core/story/compile.ts"

const scene = (f: string) => toScene(JSON.parse(fs.readFileSync(`examples/${f}`, "utf8")))
const stories = ["checkout.architecture.json", "oauth.sequence.json"].map(scene)

describe("stepped playback (reduced motion)", () => {
  test("schedule: one settled stop per step plus the final frame; holds are reading times", () => {
    for (const s of stories) {
      const tl = s.timeline!
      const sched = steppedSchedule(tl)
      expect(sched.length).toBeGreaterThan(tl.steps.length / 2)
      expect(sched[sched.length - 1]).toEqual({ step: tl.steps.length, t: tl.duration, hold: 0 })
      sched.slice(0, -1).forEach((x) => {
        const st = tl.steps[x.step]
        // The stop time names its own step and lies within it.
        expect(steppedIndex(tl, x.t)).toBe(x.step)
        expect(x.t).toBeGreaterThanOrEqual(st.t0)
        expect(x.t).toBeLessThanOrEqual(st.t1 + 1e-9)
        expect(x.hold).toBe(st.caption ? readTime(st.caption) : STEP_BEAT)
        expect(x.hold).toBeGreaterThanOrEqual(1)
        expect(x.hold).toBeLessThanOrEqual(3)
      })
      for (let i = 1; i < sched.length; i++) expect(sched[i].t).toBeGreaterThanOrEqual(sched[i - 1].t)
    }
  })

  test("steppedTime quantises any t to the step in effect", () => {
    for (const s of stories) {
      const tl = s.timeline!
      const sched = steppedSchedule(tl)
      expect(steppedTime(tl, tl.duration)).toBe(tl.duration)
      expect(steppedTime(tl, tl.duration + 5)).toBe(tl.duration)
      if (tl.steps[0].t0 > 0) expect(steppedTime(tl, 0)).toBe(0)
      tl.steps.forEach((st, i) => {
        const mid = (st.t0 + Math.min(st.t1, tl.steps[i + 1]?.t0 ?? st.t1)) / 2
        const j = steppedStop(tl, mid)
        expect(sched[j].step).toBeGreaterThanOrEqual(i)
        expect(steppedTime(tl, mid)).toBe(sched[j].t)
        // Idempotent.
        expect(steppedTime(tl, steppedTime(tl, mid))).toBe(steppedTime(tl, mid))
      })
    }
  })

  test("reduced frames are settled: no pulses, glows, flashes, partial draws or tweens", () => {
    for (const s of stories) {
      const tl = s.timeline!
      for (let t = 0; t <= tl.duration; t += 0.05) {
        const f = storyState(s, tl, steppedTime(tl, t), { stepped: true })
        expect(f.pulses).toEqual([])
        expect(f.glows).toEqual([])
        expect(f.flash).toEqual({})
        for (const v of Object.values(f.draw)) expect(v === 0 || v === 1).toBe(true)
        for (const v of Object.values(f.el)) {
          expect(v.o === 0 || v.o === 1).toBe(true)
          expect(v.dy).toBe(0)
        }
        for (const c of f.captions) {
          if (!c.current) continue
          expect(c.o).toBe(1)
          expect(c.words.every((w) => w === 1)).toBe(true)
        }
      }
      // The final frame is the static diagram.
      const end = storyState(s, tl, steppedTime(tl, tl.duration), { stepped: true })
      expect(end.el).toEqual({})
      expect(end.draw).toEqual({})
    }
  })

  test("each settled step shows its own step's result", () => {
    const s = stories[0]
    const tl = s.timeline!
    const sched = steppedSchedule(tl)
    const frames = sched.map((x) => storyState(s, tl, x.t, { stepped: true }))
    expect(new Set(frames.map((f) => JSON.stringify(f))).size).toBe(sched.length)
    // A pulse's wire is fully drawn in its own step's settled state (not only in the next one).
    for (const [j, x] of sched.entries()) {
      const st = tl.steps[x.step]
      if (!st) continue
      for (const [id, d] of Object.entries(tl.draw)) if (d.t1 <= st.t1 + 1e-9 && d.t1 >= st.t0) expect(frames[j].draw[id]).toBeUndefined()
    }
  })

  test("motion precedence: #motion hash > stored choice > OS setting", () => {
    expect(resolveMotion({ system: false })).toBe("full")
    expect(resolveMotion({ system: true })).toBe("reduced")
    expect(resolveMotion({ system: true, stored: "full" })).toBe("full")
    expect(resolveMotion({ system: false, stored: "reduced" })).toBe("reduced")
    expect(resolveMotion({ system: false, stored: "junk" })).toBe("full")
    expect(resolveMotion({ system: false, stored: "full", hash: "reduced" })).toBe("reduced")
    expect(resolveMotion({ system: true, stored: "reduced", hash: "full" })).toBe("full")
    expect(parseHash("#motion=reduced").motion).toBe("reduced")
    expect(parseHash("#motion=x").motion).toBeUndefined()
  })
})
