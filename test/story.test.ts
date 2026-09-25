import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { layout } from "../src/core/layout/index.ts"
import { fromMermaid } from "../src/core/mermaid/index.ts"
import { renderSvg } from "../src/core/render/index.tsx"
import { beatCaption, beatTimes, counterValue, MAX_BEATS, restFrame, storyState } from "../src/core/story/state.ts"
import { composeTitle, readTime, truncate } from "../src/core/story/compile.ts"
import { validate } from "../src/core/validate.ts"

const ex = (f: string) => JSON.parse(fs.readFileSync(path.join(import.meta.dir, "..", "examples", f), "utf8"))
const base = {
  type: "architecture",
  title: "s",
  nodes: [{ id: "a" }, { id: "b" }, { id: "c", counter: { id: "hits", value: 0, label: "hits" } }],
  edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }],
}
const errs = (spec: unknown) => validate(spec).diagnostics.filter((d) => d.severity === "error")

describe("story validation", () => {
  test("unknown ids, edges and counters", () => {
    const e = errs({ ...base, story: { steps: [{ reveal: ["zz"] }, { pulse: "a->c" }, { counter: { id: "nope", to: 1 } }, { highlight: ["q"] }] } })
    expect(e.map((d) => d.path)).toEqual(["story.steps[0].reveal", "story.steps[1].pulse", "story.steps[2].counter", "story.steps[3].highlight"])
  })
  test("ambiguous from->to", () => {
    const e = errs({ ...base, edges: [{ from: "a", to: "b" }, { from: "a", to: "b", label: "again" }], story: { steps: [{ pulse: "a->b" }] } })
    expect(e[0].message).toContain("ambiguous")
    expect(errs({ ...base, edges: [{ from: "a", to: "b" }, { from: "a", to: "b" }], story: { steps: [{ pulse: "a->b#2" }] } })).toEqual([])
  })
  test("at going backwards", () => {
    const e = errs({ ...base, story: { steps: [{ at: 2, reveal: ["a"] }, { at: 1, reveal: ["b"] }] } })
    expect(e[0].path).toBe("story.steps[1].at")
    expect(e[0].message).toContain("backwards")
  })
  test("long stories warn over 60 s", () => {
    const d = validate({ ...base, story: { steps: [{ at: 70, reveal: ["a"] }] } }).diagnostics
    expect(d.some((x) => x.severity === "warning" && x.message.includes("over 60"))).toBe(true)
  })
})

describe("storyState", () => {
  const v = validate({
    ...base,
    story: {
      steps: [
        { at: 0, reveal: ["a"], caption: "One two three" },
        { at: "+0.2", pulse: "a->b" },
        { reveal: ["b"] },
        { at: "+0.3", pulse: "b->c", counter: { id: "hits", to: 42 }, stop: "Count" },
        { reveal: ["c"] },
      ],
    },
  })
  const scene = layout(v.spec!)
  const tl = scene.timeline!

  test("timeline resolution", () => {
    expect(tl.steps.length).toBe(5)
    expect(tl.steps[1].t0).toBeCloseTo(tl.steps[0].t1 + 0.2, 3)
    // A pulse step ends when it arrives; the reveal chained with "+0" starts there.
    expect(tl.steps[2].t0).toBeCloseTo(tl.steps[1].t1, 3)
    expect(tl.steps[0].t1).toBeCloseTo(readTime("One two three"), 3)
    expect(tl.duration).toBeGreaterThan(tl.lastEvent)
  })

  test("pure and deterministic", () => {
    for (const t of [0, 0.37, 1.234, tl.duration / 2, tl.duration])
      expect(JSON.stringify(storyState(scene, tl, t))).toBe(JSON.stringify(storyState(scene, tl, t)))
  })

  test("step boundaries", () => {
    const at0 = storyState(scene, tl, 0)
    expect(at0.el.b.o).toBe(0) // not yet revealed
    expect(at0.el.a.o).toBe(0) // opacity lags the rise
    expect(at0.draw["a->b"]).toBe(0)
    const s2 = tl.steps[2]
    expect(storyState(scene, tl, s2.t0 - 0.01).el.b.o).toBe(0) // nothing appears before its cause
    const landed = storyState(scene, tl, s2.t0 + 0.6)
    expect(landed.el.b).toBeUndefined() // settled
    expect(landed.draw["a->b"]).toBeUndefined() // wire fully drawn
    // Mid-flight: the pulse is on the wire.
    const p = tl.pulses[0]
    const mid = storyState(scene, tl, (p.tf0 + p.tf1) / 2)
    expect(mid.pulses.length).toBe(1)
    expect(mid.pulses[0].r).toBe(4)
    expect(mid.draw["a->b"]).toBeGreaterThan(0.2)
    expect(mid.draw["a->b"]).toBeLessThan(0.8)
  })

  test("end frame is the static diagram (plus final counter values)", () => {
    const end = storyState(scene, tl, tl.duration)
    expect({ ...end, t: 0, counters: {}, settled: true }).toEqual(restFrame(0))
    expect(end.counters.hits).toBe("42")
    expect(counterValue(tl.counters.hits, 0)).toBe(0)
    expect(counterValue(tl.counters.hits, tl.duration)).toBe(42)
  })

  test("reduced motion: steps, no pulses or glows", () => {
    const t = (tl.pulses[0].tf0 + tl.pulses[0].tf1) / 2
    const r = storyState(scene, tl, t, { reduced: true })
    expect(r.pulses).toEqual([])
    expect(r.glows).toEqual([])
    expect(Object.values(r.el).every((x) => x.o === 0 || x.o === 1)).toBe(true)
  })

  test("glows: at most 3 flashes per second", () => {
    const starts = [...new Set(tl.glows.map((g) => g.t))].sort((a, b) => a - b)
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(1 / 3 - 1e-9)
  })

  test("beat times include a final frame and skip chained steps", () => {
    const b = beatTimes(tl)
    expect(b[b.length - 1]).toMatchObject({ id: "end", label: "Final frame", t: tl.duration })
    expect(b.length).toBeLessThan(tl.steps.length + 1)
  })

  test("a caption belongs to its step and fades after it settles", () => {
    const c = tl.captions[0]
    const on = storyState(scene, tl, c.t0 + 0.5)
    expect(on.captions.map((x) => [x.text, x.current])).toEqual([["One two three", true]])
    expect(c.handoff).toBe(false)
    expect(storyState(scene, tl, c.t1 + 0.01).captions).toEqual([])
    // Beat tiles only print a caption set by one of their own steps.
    const beats = beatTimes(tl)
    const fr = storyState(scene, tl, beats[1].t)
    expect(beatCaption(tl, fr, beats[1])).toBeUndefined()
  })

  test("handover: the superseded caption is dimmed and not current", () => {
    const v2 = validate({ ...base, story: { steps: [{ at: 0, caption: "First line here" }, { at: "+0", caption: "Second line" }] } })
    const s2 = layout(v2.spec!)
    const t = s2.timeline!.captions[1].t0 + 0.4
    const f = storyState(s2, s2.timeline!, t)
    expect(f.captions.map((x) => x.current)).toEqual([false, true])
    expect(f.captions[0].o).toBeLessThan(0.6)
  })

  test("SSR / static SVG equals the story-less diagram", () => {
    const spec = ex("release.workflow.json")
    const withStory = { ...spec, story: "auto" }
    expect(renderSvg(withStory, { font: false })).toBe(renderSvg(spec, { font: false }))
  })
})

describe("auto story", () => {
  test("graph: every node revealed, never before its cause", () => {
    const sc = layout(validate({ ...ex("release.workflow.json"), story: "auto" }).spec!)
    const tl = sc.timeline!
    for (const n of sc.nodes) expect(tl.appear[n.id] !== undefined || !sc.edges.some((e) => e.to === n.id)).toBe(true)
    for (const e of sc.edges) {
      const d = tl.draw[e.id]
      if (d && tl.appear[e.to] !== undefined && d.mode === "flight") expect(tl.appear[e.to]).toBeGreaterThanOrEqual(d.t1 - 1e-6)
    }
  })
  test("sequence: one pulse per message, activations follow", () => {
    const m = fromMermaid(fs.readFileSync(path.join(import.meta.dir, "..", "examples/mermaid/cache.sequence.mmd"), "utf8"))
    const sc = layout({ ...m.spec!, story: "auto" } as never)
    expect(sc.timeline!.pulses.length).toBe(sc.edges.length)
    for (const a of sc.activations) expect(sc.timeline!.appear[a.id]).toBeDefined()
  })
  test("mermaid lifecycle: composite inner start waits for the composite", () => {
    const m = fromMermaid(fs.readFileSync(path.join(import.meta.dir, "..", "examples/mermaid/order.state.mmd"), "utf8"))
    const sc = layout({ ...m.spec!, story: "auto" } as never)
    const tl = sc.timeline!
    expect(tl.appear["Fulfilment__start"]).toBeGreaterThan(tl.appear["Paid"])
    expect(tl.appear["note_1"]).toBe(tl.appear["Refunded"])
  })
})

describe("beat titles", () => {
  const P = (paths: string[], reveals: string[] = [], counters: string[] = []) => ({ paths, reveals, counters })
  test("humanised, deduplicated, short", () => {
    expect(composeTitle([P(["API gateway → Orders"], ["Orders"], ["Orders count → 1"])])).toBe("API gateway → Orders · Orders count → 1")
    expect(composeTitle([P(["Orders → order-events → Send receipt"])])).toBe("Orders → order-events → Send receipt")
    expect(composeTitle([P(["Check → Paid", "Check → Cancelled"])])).toBe("Check → Paid, Cancelled")
    expect(composeTitle([P(["Picking → Join", "Invoicing → Join"])])).toBe("Picking, Invoicing → Join")
    expect(composeTitle([P(["A → B"]), P([], ["B", "C"])])).toBe("A → B · C")
    expect(truncate("The app makes a one-time verifier and its hash", 40)).toBe("The app makes a one-time verifier and…")
  })
  test("examples: labels, not ids; no repeated tokens", () => {
    const sc = layout(validate(ex("checkout.architecture.json")).spec!)
    const labels = beatTimes(sc.timeline!).map((b) => b.label)
    expect(labels).toContain("API gateway → Orders · Orders count → 1")
    expect(labels.join("|")).not.toMatch(/ORDERS · ORDERS|->|__/)
    const m = fromMermaid(fs.readFileSync(path.join(import.meta.dir, "..", "examples/mermaid/order.state.mmd"), "utf8"))
    const st = layout({ ...m.spec!, story: "auto" } as never).timeline!
    const b = beatTimes(st)
    expect(b.length).toBeLessThanOrEqual(MAX_BEATS + 1)
    expect(b.map((x) => x.label).join("|")).not.toMatch(/__|root/)
  })
})
