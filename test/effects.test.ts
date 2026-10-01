import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { layout } from "../src/core/layout/index.ts"
import { renderSvg } from "../src/core/render/index.tsx"
import { validate, type Diagnostic } from "../src/core/validate.ts"
import { compileStory, recompilePace } from "../src/core/story/compile.ts"
import { steppedSchedule, storyState } from "../src/core/story/state.ts"
import { SPIN_PERIOD } from "../src/core/story/content.ts"
import type { Scene } from "../src/core/scene.ts"
import type { Spec } from "../src/core/spec.ts"

const ex = path.join(import.meta.dir, "..", "examples")
const spec = (f: string): Spec => validate(fs.readFileSync(path.join(ex, f), "utf8")).spec!
const CM = layout(spec("code-mode.architecture.json"))
const AS = layout(spec("agent-session.architecture.json"))
const FO = layout(spec("failover.dataflow.json"))
const at = (sc: Scene, t: number, o = {}) => storyState(sc, sc.timeline, t, o)
const msgs = (d: Diagnostic[]) => d.map((x) => `${x.severity}: ${x.message}`)

/** A panel with rows, a chip and an edge; `steps` is the story. */
function mini(steps: unknown[], rows: object[] = [{ id: "a", text: "Run", detail: "job" }, { id: "b", text: "Idle", status: "running" }], story: object = {}) {
  const v = validate({
    type: "architecture",
    title: "t",
    nodes: [{ id: "p", kind: "panel", rows }, { id: "k", kind: "chip", label: "k" }],
    edges: [{ id: "e", from: "p#a", to: "k" }],
    story: { pace: 0, steps, ...story },
  })
  return { v, sc: v.spec ? layout(v.spec) : undefined }
}

describe("row status", () => {
  const run = CM.timeline!.status!["session#exec1"]
  test("spinner rotation is linear in time from the run start", () => {
    const t0 = run[0].t
    for (const dt of [0.1, 0.33, 0.61]) {
      const a = at(CM, t0 + dt).status!["session#exec1"].spin!
      expect(Math.abs(a - ((360 * dt) / SPIN_PERIOD) % 360)).toBeLessThanOrEqual(1)
    }
  })
  test("done: crossfade from the spinner, check draws on over 0.32 s, then rests", () => {
    const done = run[1].t
    const mid = at(CM, done + 0.1).status!["session#exec1"]
    expect(mid.s).toBe("done")
    expect(mid.draw!).toBeGreaterThan(0)
    expect(mid.draw!).toBeLessThan(1)
    expect(mid.prev?.s).toBe("running")
    expect(at(CM, done + 1.5).status!["session#exec1"]).toEqual({ s: "done", o: 1 })
  })
  test("shimmer: rises after the run starts, peaks, fades after it ends; label only", () => {
    const [s0, s1] = [run[0].t, run[1].t]
    const a = (t: number) => at(CM, t).status?.["session#exec1"]?.shimmer?.a ?? 0
    expect(a(s0 + 0.05)).toBe(0)
    expect(a(s0 + 1)).toBeGreaterThan(0.9)
    expect(a(s1 + 0.3)).toBeLessThan(a(s1))
    expect(a(s1 + 2)).toBe(0)
    const svg = renderSvg(CM, { t: s0 + 1, font: false })
    expect(svg).toMatch(/class="si-row-text si-shimmer-text"[^>]*>EXECUTE<\/text>/)
    expect(svg).not.toMatch(/si-shimmer-text[^>]*>[^<]*code/)
  })
  test("reduced / stepped: static arc, no shimmer, drawn checks", () => {
    for (const st of steppedSchedule(CM.timeline!)) {
      const f = storyState(CM, CM.timeline, st.t, { reduced: true, stepped: true })
      for (const s of Object.values(f.status ?? {})) {
        expect(s.spin).toBeUndefined()
        expect(s.shimmer).toBeUndefined()
        expect(s.draw).toBeUndefined()
      }
    }
  })
  test("rest-running rows animate from t = 0 only while visible; hidden at the end: no warning", () => {
    expect(at(AS, 0).status?.["chat#work"]).toBeUndefined() // not revealed yet
    const shown = AS.timeline!.appear["chat#work"]
    expect(at(AS, shown + 1).status!["chat#work"].spin).toBeDefined()
    expect(at(AS, AS.timeline!.duration).status?.["chat#work"]).toBeUndefined()
    expect(validate(fs.readFileSync(path.join(ex, "agent-session.architecture.json"), "utf8")).diagnostics).toEqual([])
  })
  test("the static diagram shows the final statuses (code mode: two checks)", () => {
    const svg = renderSvg(CM, { font: false }).replace(/<style>[\s\S]*?<\/style>/, "")
    expect(svg.match(/si-status-done/g)?.length).toBe(2)
    expect(svg).not.toMatch(/si-status-running|si-shimmer|si-spot|si-lit/)
  })
  test("validation: targets, values, no-ops and the end state", () => {
    const one = [{ id: "a", text: "x" }]
    expect(msgs(mini([{ status: { id: "k", to: "done" } }], one).v.diagnostics)).toEqual([`error: status takes a panel row ("p#a")`])
    expect(msgs(mini([{ status: { id: "p#a", to: "ok" } }], one).v.diagnostics)[0]).toMatch(/^error: "status" must be/)
    expect(msgs(mini([{ status: { id: "p#a", to: "done" } }, { status: { id: "p#a", to: "done" } }], one).v.diagnostics)).toEqual([`warning: "p#a" is already done here; status has no effect`])
    expect(msgs(mini([{ status: { id: "p#a", to: "running" } }]).v.diagnostics)).toEqual([
      `warning: "p#a" is still running at the end: the static diagram shows a spinner`,
      `warning: "p#b" is still running at the end: the static diagram shows a spinner`,
    ])
    expect(msgs(mini([{ status: { id: "p#b", to: "done" } }, { hide: "p#a" }], [{ id: "a", text: "x", status: "running" }, { id: "b", text: "y" }]).v.diagnostics)).toEqual([])
  })
})

describe("glow / unglow", () => {
  test("persistent window: react rise, smooth fall, gone after", () => {
    const w = CM.timeline!.lit!.github[1]
    expect(at(CM, w.t0 - 0.01).lit?.github).toBeUndefined()
    expect(at(CM, w.t0 + 0.6).lit!.github).toBeGreaterThan(0.98)
    const mid = at(CM, w.t1! + 0.2).lit!.github
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
    expect(at(CM, w.t1! + 1.5).lit?.github).toBeUndefined()
    expect(renderSvg(CM, { t: w.t0 + 0.6, font: false })).toMatch(/data-si="lit:github"/)
  })
  test("validation", () => {
    expect(msgs(mini([{ glow: "e" }]).v.diagnostics)).toEqual([`error: glow takes node ids, got "e" (a edge)`, `warning: "p#b" is still running at the end: the static diagram shows a spinner`])
    const d = (steps: unknown[]) => msgs(mini(steps, [{ id: "a", text: "x" }]).v.diagnostics)
    expect(d([{ unglow: "k" }])).toEqual([`warning: "k" is not glowing here; unglow has no effect`])
    expect(d([{ glow: "k" }, { glow: "k" }, { unglow: "k" }])).toEqual([`warning: "k" already glows here; glow has no effect`])
    expect(d([{ glow: "k" }])).toEqual([`warning: "k" still glows at the end: the static diagram shows it lit`])
    expect(d([{ glow: "zz" }])).toEqual([`error: unknown id "zz"`])
  })
})

describe("spotlight", () => {
  test("focus wins; status slots next; pulse arrivals after", () => {
    const tl = FO.timeline!
    const i = tl.steps.findIndex((s) => s.focus === "router#b")
    const sp = tl.spot!.find((x) => Math.abs(x.t - tl.steps[i].t0) < 1e-6)!
    const r = FO.nodes.find((n) => n.id === "router")!
    const row = r.rows!.find((x) => x.id === "b")!
    expect(sp.x).toBeCloseTo(r.x + r.w / 2, 3)
    expect(sp.y).toBeCloseTo(r.y + row.y + row.h / 2, 3)
    const s1 = tl.steps.findIndex((s) => s.caption === "The primary serves them")
    const p1 = tl.spot!.find((x) => Math.abs(x.t - tl.steps[s1].t0) < 1e-6)!
    const ra = r.rows!.find((x) => x.id === "a")!
    expect(p1).toMatchObject({ x: r.x + ra.statusX, y: r.y + ra.anchorY })
  })
  test("fades in with the first target and out before the end; static SVG unaffected", () => {
    const tl = CM.timeline!
    expect(at(CM, tl.spot![0].t - 0.01).spot).toBeUndefined()
    expect(at(CM, tl.spot![0].t + 1).spot!.a).toBeCloseTo(0.06, 3)
    expect(at(CM, tl.lastEvent + 0.6).spot).toBeUndefined()
    expect(at(CM, tl.duration).spot).toBeUndefined()
  })
  test("no spotlight without story.spotlight", () => {
    expect(AS.timeline!.spot).toBeUndefined()
  })
})

describe("arrival flash on rows (reverse pulses)", () => {
  test("the row flashes, not the panel", () => {
    const p = CM.timeline!.pulses.find((x) => x.reverse && x.arrive?.anchor === "exec1")!
    const f = at(CM, p.tf1 + 0.2)
    expect(f.flash["session#exec1"]).toBeGreaterThan(0)
    expect(f.glows.some((g) => g.node === "session")).toBe(false)
    expect(renderSvg(CM, { t: p.tf1 + 0.2, font: false })).toMatch(/data-si="row:session#exec1"[\s\S]*?color-mix\(in srgb, var\(--si-flash\)/)
  })
})

describe("compile invariants", () => {
  test("pace recompiles keep status / glow / spot / rewind identical to a direct compile", () => {
    const s = spec("failover.dataflow.json")
    for (const pace of [0, 1, 2]) {
      const re = recompilePace(FO, pace)!
      const direct = compileStory({ ...FO, timeline: undefined }, { ...s, story: { ...(s.story as object), pace } } as Spec).timeline!
      for (const k of ["status", "lit", "spot", "rewind"] as const) expect(JSON.stringify(re[k])).toBe(JSON.stringify(direct[k]))
    }
    expect(CM.timeline!.rewind).toBe("glitch")
  })
  test("pre-0.4 timelines carry none of the new keys", () => {
    const old = layout(validate(fs.readFileSync(path.join(ex, "checkout.architecture.json"), "utf8")).spec!)
    for (const k of ["typing", "versions", "bars", "levels", "vis", "wires", "status", "lit", "spot", "rewind"]) expect(k in old.timeline!).toBe(false)
  })
})
