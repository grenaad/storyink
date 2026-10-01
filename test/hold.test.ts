import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { beatGroups, beatMotionEnds, compileStoryAuthored, layout, readingHold, readTime, steppedSchedule, storyState, tokens, validate, type Spec } from "../src/core/index.ts"

const S = tokens.story
const load = (f: string) => validate(JSON.parse(fs.readFileSync(f, "utf8"))).spec as Spec
const specs: [string, Spec][] = [
  ["openwick", load(path.join(import.meta.dir, "fixtures/openwick-architecture.json"))],
  ...fs.readdirSync("examples").filter((f) => f.endsWith(".json")).map((f) => [f, load(`examples/${f}`)] as [string, Spec]),
].filter((x): x is [string, Spec] => (x[1] as Spec).story !== undefined)
const tlOf = (spec: Spec) => layout(spec).timeline!
const base: Spec = validate({
  type: "architecture",
  title: "t",
  nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }],
  edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }],
}).spec as Spec
const withStory = (story: unknown) => validate({ ...base, story }).spec as Spec

describe("reading hold", () => {
  test("1 s + 0.3 s per word, clamped 1.5–6 s; bare beats 0.8 s", () => {
    expect(readingHold()).toBe(S.hold.bare)
    expect(readingHold("")).toBe(0.8)
    expect(readingHold("Two words")).toBe(1.6)
    expect(readingHold("One")).toBe(1.5)
    expect(readingHold("a b c d e f g h i j")).toBe(4)
    expect(readingHold(Array(40).fill("w").join(" "))).toBe(6)
  })
  for (const [name, spec] of specs)
    test(`${name}: a hold is inserted after every beat (next beat starts ≥ settle + hold)`, () => {
      const tl = tlOf(spec)
      const g = beatGroups(tl)
      expect(g).toEqual(beatGroups(compileStoryAuthored({ ...layout(spec), timeline: undefined }, spec).timeline!))
      for (let k = 1; k < g.length; k++) {
        const prev = g[k - 1]
        const end = Math.max(...prev.map((i) => tl.steps[i].t1))
        const hold = tl.steps[prev.at(-1)!].hold!
        const cap = prev.map((i) => tl.steps[i].caption).filter((c) => c).pop()
        // The spec's pace (default 0.6), or the step's own `hold`.
        const story = (spec as { story?: { pace?: number; steps?: { hold?: number }[] } }).story
        const own = Array.isArray(story?.steps) ? story.steps[prev.at(-1)!]?.hold : undefined
        const pace = typeof story?.pace === "number" ? story.pace : S.hold.pace
        expect(hold).toBeCloseTo(own ?? readingHold(cap) * pace, 3)
        if (hold > 0) expect(tl.steps[g[k][0]].t0).toBeGreaterThanOrEqual(end + hold - 2e-3)
      }
      // Stepped playback uses the same numbers.
      const sched = steppedSchedule(tl)
      g.forEach((grp, k) => {
        const h = tl.steps[grp.at(-1)!].hold!
        const cap = grp.map((i) => tl.steps[i].caption).filter((c) => c).pop()
        // A zero hold (pace 0 / hold 0): the stop still shows for the caption's read time.
        expect(sched[k].hold).toBe(h > 0 ? Math.max(0.8, h) : cap ? readTime(cap) : 1.5)
      })
    })
})

describe("timing semantics", () => {
  test("pace 0 reproduces the authored (pre-0.3.5) timing", () => {
    for (const [, spec] of specs) {
      const zero = { ...spec, story: typeof spec.story === "object" ? { ...spec.story, pace: 0 } : { steps: "auto" as const, pace: 0 } } as Spec
      const a = tlOf(zero)
      const b = compileStoryAuthored({ ...layout(zero), timeline: undefined }, zero).timeline!
      expect(a.steps.map((s) => [s.t0, s.t1])).toEqual(b.steps.map((s) => [s.t0, s.t1]))
      expect(a.duration).toBe(b.duration)
    }
  })
  test("pace scales the holds; per-step hold overrides", () => {
    const steps = [
      { at: 0.3, reveal: ["a"], caption: "Alpha starts" },
      { at: "+0.1", pulse: "a->b", caption: "Then it calls beta with the request" },
      { at: "+0", reveal: ["b"] },
      { at: "+0.1", pulse: "b->c", hold: 0.25 },
      { at: "+0", reveal: ["c"], hold: 0.25 },
    ]
    const t1 = tlOf(withStory({ steps, pace: 1 }))
    const t2 = tlOf(withStory({ steps, pace: 2 }))
    expect(tlOf(withStory({ steps })).steps[0].hold).toBeCloseTo(0.6 * readingHold("Alpha starts"), 3) // default pace 0.6
    expect(t1.steps[0].hold).toBeCloseTo(readingHold("Alpha starts"), 3)
    expect(t2.steps[0].hold).toBeCloseTo(2 * readingHold("Alpha starts"), 3)
    expect(t2.duration).toBeGreaterThan(t1.duration)
    // Beat 1 = pulse a->b + the reveal of b; its hold sits on step 2 (the beat's end).
    expect(t1.steps[2].hold).toBeCloseTo(readingHold("Then it calls beta with the request"), 3)
    // The last beat's step carries its own hold (seconds, not scaled by pace).
    expect(t2.steps[4].hold).toBe(0.25)
  })
  test("an absolute at is a minimum start; enough authored room adds nothing", () => {
    const tight = tlOf(withStory({ steps: [{ at: 0.3, reveal: ["a"], caption: "Alpha starts here" }, { at: 1.5, reveal: ["b"] }] }))
    const hold = tight.steps[0].hold!
    expect(tight.steps[1].t0).toBeCloseTo(tight.steps[0].t1 + hold, 3) // pushed later than 1.5
    expect(tight.steps[1].t0).toBeGreaterThan(1.5)
    const roomy = tlOf(withStory({ steps: [{ at: 0.3, reveal: ["a"], caption: "Alpha starts here" }, { at: 12, reveal: ["b"] }] }))
    expect(roomy.steps[1].t0).toBe(12) // already past settle + hold
    const rel = tlOf(withStory({ steps: [{ at: 0.3, reveal: ["a"], caption: "Alpha starts here" }, { at: "+9", reveal: ["b"] }] }))
    expect(rel.steps[1].t0).toBeCloseTo(rel.steps[0].t1 + 9, 3) // "+9" > hold: no extra
  })
  test("an absolute at inside a beat moves with its held beat (never before its beat-mates)", () => {
    // code-mode's shape: a pulse step, then an absolute step chained right after it (one beat)
    // carrying staggered pulses.
    const mk = (at: number) => withStory({ pace: 1, steps: [{ at: 0.3, reveal: ["a"], caption: "Alpha starts here" }, { at: 2, pulse: "a->b" }, { at, pulse: [{ edge: "b->c" }, { edge: "b->c", delay: 0.2 }] }] })
    const t1 = compileStoryAuthored({ ...layout(mk(5)), timeline: undefined }, mk(5)).timeline!.steps[1].t1
    const spec = mk(+(t1 + 0.01).toFixed(3))
    const tl = tlOf(spec)
    const authored = compileStoryAuthored({ ...layout(spec), timeline: undefined }, spec).timeline!
    expect(beatGroups(tl)[1]).toEqual([1, 2]) // one beat, pushed by the hold
    expect(tl.steps[1].t0).toBeGreaterThan(2)
    expect(beatMotionEnds(tl)[1]).toBeCloseTo(Math.max(...tl.pulses.map((p) => p.tf1)), 3) // lands after the last staggered pulse
    for (let i = 1; i < tl.steps.length; i++) expect(tl.steps[i].t0).toBeGreaterThanOrEqual(tl.steps[i - 1].t0)
    expect(tl.steps[1].t0).toBeGreaterThan(1) // pushed by the hold
    expect(tl.steps[2].t0 - tl.steps[1].t0).toBeCloseTo(authored.steps[2].t0 - authored.steps[1].t0, 6) // keeps its offset
  })
  for (const pace of [0, 1, 2])
    for (const [name, spec] of specs)
      test(`${name} @ pace ${pace}: steps stay in order and every pulse has landed at its beat's motion end`, () => {
        const s = { ...spec, story: typeof spec.story === "object" ? { ...spec.story, pace } : { steps: "auto" as const, pace } } as Spec
        const tl = tlOf(s)
        for (let i = 1; i < tl.steps.length; i++) expect(tl.steps[i].t0).toBeGreaterThanOrEqual(tl.steps[i - 1].t0 - 1e-6)
        const ends = beatMotionEnds(tl)
        const g = beatGroups(tl)
        g.forEach((grp, k) => {
          for (const p of tl.pulses.filter((p) => grp.some((i) => p.id.startsWith(`pulse-${i}-`)))) expect(p.tf1).toBeLessThanOrEqual(ends[k] + 1e-6)
        })
        // No pulse is mid-flight at any arrow-key stop.
        // (At pace 0 authored timing may overlap beats on purpose.)
        if (pace > 0) for (const e of ends) for (const p of tl.pulses) expect(e > p.t0 + 1e-6 && e < p.tf1 - 1e-6).toBe(false)
      })
  test("validation: pace and hold", () => {
    expect(validate({ ...base, story: { pace: -1, steps: [] } }).ok).toBe(false)
    expect(validate({ ...base, story: { pace: 1.5, steps: [{ reveal: ["a"], hold: 2 }] } }).ok).toBe(true)
    expect(validate({ ...base, story: { steps: [{ reveal: ["a"], hold: "x" }] } }).ok).toBe(false)
  })
})

describe("holds are still", () => {
  for (const [name, spec] of specs.filter(([, s]) => s.type !== "sequence"))
    test(`${name}: nothing on the diagram changes during a beat's reading hold`, () => {
      const scene = layout(spec)
      const tl = scene.timeline!
      const g = beatGroups(tl)
      for (let k = 1; k < g.length; k++) {
        const next = tl.steps[g[k][0]].t0
        const hold = tl.steps[g[k - 1].at(-1)!].hold!
        let prev: string | undefined
        for (let t = next - hold + 0.005; t < next - 0.005; t += 0.05) {
          const fr = storyState(scene, tl, t)
          // Ambient motion (spinner rotation, shimmer sweep, spotlight glide) runs through holds by design.
          const status = fr.status && Object.fromEntries(Object.entries(fr.status).map(([k, v]) => [k, { ...v, spin: 0, shimmer: v.shimmer ? 1 : 0 }]))
          const j = JSON.stringify({ ...fr, t: 0, captions: 0, settled: 0, spot: 0, ...(status ? { status } : {}) })
          if (prev) expect(j).toBe(prev)
          prev = j
          // The beat's caption stays up (fully typed) through its hold.
          const cap = g[k - 1].map((i) => tl.steps[i].caption).filter((c) => c).pop()
          if (cap) expect(fr.captions.find((c) => c.current && c.text === cap.trim())?.words.every((w) => w >= 0.999)).toBe(true)
        }
      }
    })
})
