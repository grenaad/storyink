import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { layout } from "../src/core/layout/index.ts"
import { flattenPath } from "../src/core/layout/paths.ts"
import { renderSvg } from "../src/core/render/index.tsx"
import { validate, type Diagnostic } from "../src/core/validate.ts"
import { compileStory, recompilePace } from "../src/core/story/compile.ts"
import { beatGroups, beatMotionEnds, mapStoryTime, steppedSchedule, storyState } from "../src/core/story/state.ts"
import { typedChars } from "../src/core/story/content-state.ts"
import { stepFocus } from "../src/core/story/camera.ts"
import type { Scene } from "../src/core/scene.ts"
import type { Spec } from "../src/core/spec.ts"

const next = path.join(import.meta.dir, "..", "examples")
const spec = (f: string): Spec => validate(fs.readFileSync(path.join(next, f), "utf8")).spec!
const scene = (s: Spec): Scene => layout(s)
const CM = scene(spec("code-mode.architecture.json"))
const RH = scene(spec("retry-helper.architecture.json"))
const AS = scene(spec("agent-session.architecture.json"))
const FO = scene(spec("failover.dataflow.json"))
const at = (sc: Scene, t: number, opts = {}) => storyState(sc, sc.timeline, t, opts)

/** A small graph spec with a code node, a panel and a chip, plus the given steps. */
function mini(steps: unknown[], extra: object = {}): { v: ReturnType<typeof validate>; sc?: Scene } {
  const v = validate({
    type: "architecture",
    title: "t",
    direction: "LR",
    nodes: [
      { id: "p", kind: "panel", rows: [{ id: "r1", tag: "You", text: "hello there world" }, { id: "r2", text: "two", detail: "more" }] },
      { id: "c", kind: "code", code: ["const a = 1", "  return a"] },
      { id: "k", kind: "chip", label: "k" },
      { id: "s" },
    ],
    edges: [
      { id: "e1", from: "p#r1", to: "c#1" },
      { id: "e2", from: "c", to: "k" },
    ],
    story: { pace: 0, steps },
    ...extra,
  })
  return { v, sc: v.spec ? layout(v.spec) : undefined }
}
const msgs = (d: Diagnostic[]) => d.map((x) => `${x.severity}: ${x.message}`)

describe("frames are pure functions of time", () => {
  test("deterministic and seek-safe (forward, back, forward)", () => {
    for (const sc of [CM, RH, AS, FO]) {
      const d = sc.timeline!.duration
      const ts = Array.from({ length: 40 }, (_, k) => (k * d) / 39)
      const a = ts.map((t) => JSON.stringify(at(sc, t)))
      const b = [...ts].reverse().map((t) => JSON.stringify(at(sc, t))).reverse()
      expect(b).toEqual(a)
    }
  })
})

describe("typing", () => {
  test("char runs: monotonic, exact at boundaries, newline costs 2 chars, indentation instant", () => {
    const run = CM.timeline!.typing!.find((r) => r.target === "code" && r.v === 1)!
    expect(run.by).toBe("char")
    const per = 1 / 170
    expect(run.lines![0].t0).toBe(6.8)
    expect(run.lines![1].t0).toBeCloseTo(run.lines![0].t1 + 2 * per, 3)
    expect(run.lines![1].indent).toBe(2)
    expect(run.lines![1].n).toBe("owner: \"anomalyco\", repo: \"opencode\",".length)
    let prev = run.lines!.map(() => 0)
    for (let t = run.t0 - 0.1; t <= run.t1 + 0.1; t += 0.01) {
      const ch = typedChars(run, t)
      ch.forEach((c, j) => expect(c).toBeGreaterThanOrEqual(prev[j]))
      prev = ch
    }
    for (const L of run.lines!) {
      expect(typedChars(run, L.t0 - 1e-6)[run.lines!.indexOf(L)]).toBe(0)
      expect(typedChars(run, L.t1)[run.lines!.indexOf(L)]).toBe(L.n)
    }
  })

  test("set + type starts the new version empty (no flash of full content)", () => {
    const f = at(CM, 6.81)
    const layers = f.content!.code
    expect(layers.map((l) => l.v)).toEqual([1])
    expect(layers[0].chars!.every((c) => c <= 2)).toBe(true)
    expect(f.caret).toEqual([{ target: "code", line: 0, col: layers[0].chars![0] }])
  })

  test("a typed version is hidden from its version start until its run", () => {
    expect(at(CM, 1).content!.code[0]).toMatchObject({ v: 0, chars: [0, 0] })
    expect(at(CM, 0.2).content!["session#ask"][0]).toMatchObject({ v: 0, tag: 0 })
  })

  test("rows type by word by default; tag first; explicit by char on a row and by word on code", () => {
    const ask = AS.timeline!.typing!.find((r) => r.target === "chat#ask")!
    expect(ask.by).toBe("word")
    expect(ask.words).toMatchObject({ n: 5, lead: 0.1 })
    const { sc, v } = mini([{ type: { id: "p#r1", by: "char", cps: 10 } }, { type: { id: "c", by: "word" } }])
    expect(v.diagnostics).toEqual([])
    const [r, c] = sc!.timeline!.typing!
    expect(r.by).toBe("char")
    expect(r.lines![0].n).toBe("hello there world".length)
    expect(r.t1 - r.t0).toBeCloseTo(1.7, 3)
    expect(c.by).toBe("word")
    expect(c.words!.n).toBe(6)
    // Row char typing renders clipped lines; word typing per-word tspans with explicit x.
    const mid = renderSvg({ ...v.spec!, story: { pace: 0, steps: [{ type: { id: "p#r1", by: "char", cps: 10 } }] } } as Spec, { t: 0.5, font: false })
    expect(mid).toMatch(/clipPath id="si-clip--p-r1-0-0"><rect[^>]*width="(\d+(\.\d+)?)"/)
  })

  test("the caret lingers briefly, never in reduced / stepped mode", () => {
    const run = RH.timeline!.typing![0]
    expect(at(RH, run.t1 + 0.2).caret?.length).toBe(1)
    expect(at(RH, run.t1 + 0.4).caret).toBeUndefined()
    const mid = (run.t0 + run.t1) / 2
    const red = at(RH, mid, { reduced: true })
    expect(red.caret).toBeUndefined()
    expect(red.content?.fetch?.[0]?.chars).toBeUndefined()
  })
})

describe("versions, set and clear", () => {
  test("code: static final shows the final program (not program 1)", () => {
    const svg = renderSvg(CM, { theme: "light", font: false })
    expect(svg).toContain("list_issues")
    expect(svg).not.toContain("list github issues")
    expect(svg).toMatch(/data-si="code:code"><g data-v="1">/)
    // Retry helper ends on its third program (typed); clip paths are full width.
    const r = renderSvg(RH, { theme: "dark", font: false })
    expect(r).toContain("retry")
    expect(r).not.toContain("statusText")
    expect(r).toMatch(/si-clip--fetch-2-0/)
  })

  test("clear fades the old program out and keeps the panel and header", () => {
    expect(at(CM, 6.2).content!.code[0].v).toBe(0)
    expect(at(CM, 6.2).content!.code[0].o).toBeLessThan(1)
    expect(at(CM, 6.5).content!.code).toEqual([])
    const svg = renderSvg(CM, { t: 6.5, font: false })
    expect(svg).toContain("CODE MODE")
    expect(svg).not.toMatch(/data-si="code:code"><g data-v/)
  })

  test("set crossfades: both layers mid-fade, then only the new one", () => {
    const s = RH.timeline!.versions!.fetch[0]
    const mid = at(RH, s.t + 0.1).content!.fetch
    expect(mid.map((l) => l.v)).toEqual([0, 1])
    expect(mid[0].o + mid[1].o).toBeCloseTo(1, 1)
    expect(at(RH, s.t + 0.3).content!.fetch).toEqual([{ v: 1, o: 1 }])
  })

  test("row versions merge fields (detail swap keeps text; text swaps keep the row)", () => {
    const n = AS.nodes.find((x) => x.id === "chat")!
    const edit = n.rows!.find((r) => r.id === "edit")!
    expect(edit.versions.map((v) => v.lines.join(" "))).toEqual(["EDIT src/auth/session.ts", "EDIT test/helpers/clock.ts"])
    expect(edit.versions[1].split).toBe(5)
    const out = n.rows!.find((r) => r.id === "out")!
    expect(out.versions.map((v) => v.lines.join(" "))).toEqual(["1 failed: token expired", "rerunning...", "12 passed"])
    const end = at(AS, AS.timeline!.duration)
    expect(end.content).toMatchObject({ "chat#edit": [{ v: 1, o: 1 }], "chat#out": [{ v: 2, o: 1 }] })
    expect(renderSvg(AS, { font: false })).toContain("12 passed")
  })
})

describe("levels: dim and visibility are independent channels", () => {
  const steps = [{ dim: "s" }, { hide: "s" }, { show: "s" }, { undim: "s" }, { hide: ["p#r2", "e2"] }, { dim: { ids: ["k"], to: 0.3 }, undim: "k" }]
  const { sc, v } = mini(steps)
  const t = (i: number) => sc!.timeline!.steps[i].t1 - 0.001
  test("dim → hide → show keeps the dim; undim restores 1", () => {
    expect(v.diagnostics.filter((d) => d.severity === "error")).toEqual([])
    expect(at(sc!, t(0))).toMatchObject({ lvl: { s: 0.42 } })
    const hidden = at(sc!, t(1))
    expect(hidden.lvl).toMatchObject({ s: 0.42 })
    expect(hidden.vis).toMatchObject({ s: 0 })
    const shown = at(sc!, t(2))
    expect(shown.lvl).toMatchObject({ s: 0.42 })
    expect(shown.vis?.s).toBeUndefined()
    expect(at(sc!, t(3)).lvl?.s).toBeUndefined()
  })
  test("rows and edges hide; the static diagram keeps the final state", () => {
    const end = at(sc!, sc!.timeline!.duration)
    expect(end.vis).toEqual({ "p#r2": 0, e2: 0 })
    const svg = renderSvg(sc!, { font: false })
    expect(svg).toMatch(/data-si="row:p#r2"[^>]*style="opacity:0"/)
    expect(svg).toMatch(/data-si="edge:e2" style="opacity:0"/)
  })
  test("muted rest levels: undim lifts to 1, show no-op warns", () => {
    const m = validate({
      type: "architecture",
      title: "t",
      nodes: [{ id: "a", muted: true }],
      story: { steps: [{ undim: "a" }, { show: "a" }, { undim: "a" }] },
    })
    expect(msgs(m.diagnostics)).toEqual([`warning: "a" is not hidden here; show has no effect`, `warning: "a" is not dimmed here; undim has no effect`])
    const s2 = layout(m.spec!)
    expect(at(s2, s2.timeline!.duration).lvl).toEqual({ a: 1 })
  })
})

describe("wires", () => {
  test("repeat retire / draw cycles on one edge", () => {
    const { sc, v } = mini([{ unwire: "e2" }, { at: "+0.5", wire: { edge: "e2", duration: 0.4 } }, { at: "+0.5", unwire: "e2" }, { at: "+0.5", wire: "e2" }])
    expect(v.diagnostics).toEqual([])
    const ev = sc!.timeline!.wires!.e2
    expect(ev.map((e) => e.on)).toEqual([false, true, false, true])
    expect(at(sc!, 0).draw.e2).toBeUndefined() // drawn at start (first event retracts)
    expect(at(sc!, ev[0].t1 + 0.01).undraw?.e2).toBe(1)
    expect(at(sc!, (ev[1].t0 + ev[1].t1) / 2).draw.e2).toBeGreaterThan(0)
    expect(at(sc!, ev[1].t1 + 0.01).draw.e2).toBeUndefined()
    expect(at(sc!, ev[2].t1 + 0.01).undraw?.e2).toBe(1)
    const end = at(sc!, sc!.timeline!.duration)
    expect(end.draw.e2).toBeUndefined()
    expect(end.undraw).toBeUndefined()
    expect(sc!.timeline!.draw.e2).toBeUndefined()
  })
  test("a wire-first edge is hidden until drawn; redundant wire warns", () => {
    const { sc, v } = mini([{ at: 1, wire: "e2" }, { wire: "e2" }, { unwire: "e1" }, { unwire: "e1" }])
    expect(msgs(v.diagnostics)).toEqual([`warning: "e2" is already drawn by step 1; wire has no effect`, `warning: "e1" is not drawn here; unwire has no effect`])
    expect(at(sc!, 0.5).draw.e2).toBe(0)
    expect(renderSvg(sc!, { t: 0.5, font: false })).toMatch(/data-si="port:e2:out"[^>]*style="opacity:0"/)
  })
  test("failover: to-a retracts and stays gone in the static diagram; to-b draws", () => {
    const end = at(FO, FO.timeline!.duration)
    expect(end.undraw).toEqual({ "to-a": 1 })
    expect(end.draw["to-b"]).toBeUndefined()
    expect(at(FO, 1).draw["to-b"]).toBe(0)
    const svg = renderSvg(FO, { font: false })
    expect(svg).toMatch(/data-si="port:to-a:out"[^>]*style="opacity:0"/)
  })
})

describe("pulses: reverse and delayed", () => {
  const tl = CM.timeline!
  test("reverse pulses travel the reversed rounded wire and arrive at the row anchor", () => {
    const p = tl.pulses.find((x) => x.reverse && x.edges[0] === "call1")!
    const fwd = flattenPath(CM.edges.find((e) => e.id === "call1")!.d)
    expect(p.points).toEqual([...fwd].reverse())
    expect(p.arrive).toEqual({ node: "session", anchor: "exec1" })
    expect(tl.glows.some((g) => g.node === "session#exec1" && g.dur === 0)).toBe(true)
  })
  test("reverse pulses never draw hidden wires", () => {
    const { sc, v } = mini([{ reveal: "k" }, { pulse: { edge: "e2", reverse: true } }])
    expect(msgs(v.diagnostics)).toEqual([])
    expect(sc!.timeline!.draw.e2.mode).toBe("fade")
    const w = mini([{ pulse: { edge: "e2", reverse: true } }, { wire: "e2" }])
    expect(msgs(w.v.diagnostics)).toEqual([`warning: reverse pulse on "e2" before it is drawn`])
  })
  test("delayed parallel pulses are staggered", () => {
    const i = tl.steps.findIndex((s) => Math.abs(s.t0 - 10.45) < 1e-6)
    const ps = tl.pulses.filter((p) => p.id.startsWith(`pulse-${i}-`))
    expect(ps.map((p) => +(p.t0 - 10.45).toFixed(3))).toEqual([0, 0.2, 0.4])
    expect(tl.steps[i].t1).toBeGreaterThanOrEqual(ps[2].tf1 - 1e-6)
  })
  test("pulse after unwire warns", () => {
    const { v } = mini([{ unwire: "e2" }, { pulse: "e2" }])
    expect(msgs(v.diagnostics)).toEqual([`warning: pulse on "e2" after it is unwired`])
  })
})

describe("step-level validation", () => {
  const errs = (steps: unknown[]) => msgs(mini(steps).v.diagnostics)
  test("type", () => {
    expect(errs([{ type: "k" }])).toEqual([`error: type takes a code node or a panel row ("p#r1"), got "k"`])
    expect(errs([{ type: "p" }])).toEqual([`error: type takes a code node or a panel row ("p#r1"), got "p"`])
    expect(errs([{ clear: "c" }, { type: "c" }])).toEqual([`error: nothing to type: "c" was cleared`])
    expect(errs([{ type: "c" }, { type: "c" }])).toEqual([`warning: "c" is already typed`])
    expect(errs([{ clear: "c" }, { set: { id: "c", code: "x" }, type: "c" }])).toEqual([])
  })
  test("line: current version, not reserved slots", () => {
    expect(errs([{ line: "k#1" }])).toEqual([`error: line takes a code node: "k#2-4"`])
    expect(errs([{ line: "c#2-1" }])).toEqual([`error: invalid line range "c#2-1"`])
    expect(errs([{ line: "c#2-3" }])).toEqual([`error: line 2-3 is past the last line (2) of "c"`])
    expect(errs([{ set: { id: "c", code: ["1", "2", "3"] }, line: "c#3" }])).toEqual([])
    expect(errs([{ line: { id: "c", lines: [1, 2] } }, { line: { id: "c", off: true } }])).toEqual([])
    expect(errs([{ clear: "c" }, { line: "c#1" }])).toEqual([`error: "c" is cleared here; nothing to highlight`])
  })
  test("set / clear / dim / show / focus / status / wire", () => {
    expect(errs([{ set: { id: "p", code: "x" } }])).toEqual([`error: set "code" needs a code node; "p" is a panel`])
    expect(errs([{ set: { id: "c", text: "x" } }])).toEqual([`error: set "text" needs a panel row ("p#r1")`])
    expect(errs([{ set: { id: "c", code: "x" }, clear: "c" }])).toEqual([`error: "c" is set and cleared in one step`])
    expect(errs([{ dim: "nope" }])).toEqual([`error: unknown id "nope"`])
    expect(errs([{ hide: "p#nope" }])).toEqual([`error: unknown id "p#nope"`])
    expect(errs([{ show: "s" }])).toEqual([`warning: "s" is not hidden here; show has no effect`])
    expect(errs([{ focus: "zz" }])).toEqual([`error: unknown id "zz"`])
    expect(errs([{ focus: "c#2" }])).toEqual([])
    expect(errs([{ status: { id: "c", to: "done" } }])).toEqual([`error: status takes a panel row ("p#r1") or a plain graph node`])
    expect(errs([{ wire: "nope" }])[0]).toMatch(/^error: unknown edge "nope"/)
    expect(errs([{ dim: ["p#r1", "e1", "c"], hide: "c->k" }])).toEqual([])
  })
  test("invalid input never crashes compile", () => {
    const junk = [{ type: { id: 3 } }, { line: { id: "c", lines: "x" } }, { set: { id: "c", code: 5 } }, { dim: { ids: "x" } }, { wire: {} }, { pulse: { edge: "e2", delay: -1 } }]
    expect(() => mini(junk)).not.toThrow()
  })
})

describe("pace, beats, stepped", () => {
  test("recompilePace equals compiling with that pace; typing speeds unchanged", () => {
    const s = spec("retry-helper.architecture.json")
    for (const pace of [0, 0.6, 1.5]) {
      const re = recompilePace(RH, pace)!
      const direct = compileStory({ ...RH, timeline: undefined }, { ...s, story: { ...(s.story as object), pace } } as Spec).timeline!
      expect(JSON.stringify({ ...re, source: undefined })).toBe(JSON.stringify({ ...direct, source: undefined }))
      expect(re.typing!.map((r) => +(r.t1 - r.t0).toFixed(3))).toEqual(RH.timeline!.typing!.map((r) => +(r.t1 - r.t0).toFixed(3)))
    }
  })
  test("mapStoryTime keeps typing progress across paces", () => {
    const a = RH.timeline!
    const b = recompilePace(RH, 1.5)!
    const run = a.typing![1]
    const t = (run.t0 + run.t1) / 2
    const ca = storyState(RH, a, t).content!.fetch.at(-1)!.chars
    const cb = storyState(RH, b, mapStoryTime(a, b, t)).content!.fetch.at(-1)!.chars
    expect(cb).toEqual(ca!)
  })
  test("holds wait for typing; step moves land with the content typed", () => {
    const tl = RH.timeline!
    const run = tl.typing![0]
    expect(tl.steps[1].t0).toBeGreaterThan(run.t1)
    const ends = beatMotionEnds(tl)
    const g = beatGroups(tl)
    g.forEach((grp, k) => {
      for (const r of tl.typing!) if (grp.includes(tl.steps.findIndex((s) => Math.abs(s.t0 - r.t0) < 1e-6))) expect(ends[k]).toBeGreaterThanOrEqual(r.t1 - 1e-6)
    })
    const k = g.findIndex((grp) => grp.includes(0))
    const f = storyState(RH, tl, ends[k])
    expect(f.content?.fetch?.[0]?.chars).toBeUndefined()
  })
  test("stepped stops are settled: typing complete, no caret", () => {
    const tl = CM.timeline!
    for (const s of steppedSchedule(tl)) {
      const f = storyState(CM, tl, s.t, { reduced: true, stepped: true })
      expect(f.caret).toBeUndefined()
      for (const l of Object.values(f.content ?? {})) for (const x of l) expect(x.chars === undefined || x.chars.every((c) => c === 0)).toBe(true)
    }
  })
  test("lastEvent covers content; the end frame is settled and equals the static SVG", () => {
    for (const sc of [CM, RH, AS, FO]) {
      const tl = sc.timeline!
      expect(at(sc, tl.duration).settled).toBe(true)
      expect(renderSvg(sc, { font: false })).toBe(renderSvg(sc, { font: false, t: tl.duration }))
    }
  })
})

describe("camera", () => {
  test("focus overrides; typing / bars / rows focus their boxes", () => {
    const i = FO.timeline!.steps.findIndex((s) => s.focus === "router#b")
    const b = stepFocus(FO, FO.timeline!, i, 0)!
    const r = FO.nodes.find((n) => n.id === "router")!
    const row = r.rows!.find((x) => x.id === "b")!
    expect(b).toEqual({ x: r.x, y: r.y + row.y, w: r.w, h: row.h })
    const j = RH.timeline!.steps.findIndex((s) => s.label === "One request")
    const fb = stepFocus(RH, RH.timeline!, j, 0)!
    const c = RH.nodes[0]
    expect(fb.y).toBeCloseTo(c.y + c.code!.top + c.code!.lh, 5)
    expect(fb.h).toBeCloseTo(c.code!.lh, 5)
  })
})
