import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { layout } from "../src/core/layout/index.ts"
import { validate } from "../src/core/validate.ts"
import { actEndTime, actTimeline, beatGroups, storyState } from "../src/core/story/state.ts"
import { inOutCubic } from "../src/core/story/ease.ts"
import { renderSvg } from "../src/core/render/index.tsx"
import { renderAnimatedSvg } from "../src/core/render/smil.tsx"
import type { Spec } from "../src/core/spec.ts"

/** agent → cli in act 1; agent → broker → cli in act 2 (the broker sits in the gap). */
const base = (story: Record<string, unknown>, extra: Partial<Record<"nodes" | "edges", unknown[]>> = {}) => ({
  type: "architecture",
  title: "acts",
  direction: "LR",
  nodes: [
    { id: "agent", label: "agent" },
    { id: "broker", label: "broker", in: ["after"] },
    { id: "cli", label: "cli" },
    { id: "vault", label: "vault" },
    ...(extra.nodes ?? []),
  ],
  edges: [
    { id: "ask", from: "agent", to: "cli", in: ["before"] },
    { id: "ref", from: "agent", to: "broker" },
    { id: "approve", from: "broker", to: "cli" },
    { id: "fetch", from: "cli", to: "vault" },
    ...(extra.edges ?? []),
  ],
  story,
})

const ACTS = [
  { id: "before", label: "raw", tone: "risk" },
  { id: "after", label: "fixed", tone: "good" },
]
const STEPS = [
  { caption: "ask", pulse: { edge: "ask", tone: "note", tint: true } },
  { caption: "leak", tone: { ids: ["cli", "ask"], to: "risk" }, status: { id: "agent", to: "error" } },
  { act: "after", caption: "with the *broker*" },
  { caption: "ref", pulse: { edge: "ref", tone: "good", tint: true }, status: { id: "agent", to: "done" } },
]

function sceneOf(spec: unknown) {
  const v = validate(spec)
  expect(v.diagnostics.filter((d) => d.severity === "error")).toEqual([])
  return layout(v.spec!)
}

describe("acts: compile", () => {
  const sc = sceneOf(base({ acts: ACTS, steps: STEPS }))
  const tl = sc.timeline!
  const [a0, a1] = tl.acts!

  test("timeline.acts: spans, rewind window and morph", () => {
    expect(tl.acts!.map((a) => a.id)).toEqual(["before", "after"])
    expect(a0.t0).toBe(0)
    expect(a0.t1).toBe(a1.t0)
    expect(a1.enter).toBe("rewind")
    const rw = a1.rewind!
    expect(rw.t0).toBe(a1.t0)
    expect(rw.from0).toBe(0)
    expect(rw.from1).toBeCloseTo(a1.t0, 3)
    // clamp((actEnd − actStart) / 4, 0.6, 1.5)
    expect(rw.t1 - rw.t0).toBeCloseTo(Math.min(1.5, Math.max(0.6, (rw.from1 - rw.from0) / 4)), 2)
    expect(a1.morph!.t0).toBeCloseTo(rw.t1, 3)
    expect(a1.body).toBe(a1.morph!.t1)
    // The entry step is a chapter named after the act; its caption waits for the rewind.
    const entry = tl.steps[2]
    expect(entry.stop).toBe("fixed")
    expect(entry.t0).toBe(a1.t0)
    expect(tl.captions.find((c) => c.step === 2)!.t0).toBeCloseTo(rw.t1, 3)
    // Caption emphasis takes the act's tone.
    expect(tl.captions.find((c) => c.step === 2)!.tone).toBe("good")
  })

  test("membership: scene acts, and the morph order retract → fade → reveal → wire", () => {
    expect(sc.nodes.find((n) => n.id === "broker")!.acts).toEqual(["after"])
    expect(sc.edges.find((e) => e.id === "ask")!.acts).toEqual(["before"])
    // An edge to an after-only node is after-only too.
    expect(sc.edges.find((e) => e.id === "ref")!.acts).toEqual(["after"])
    expect(sc.nodes.find((n) => n.id === "agent")!.acts).toBeUndefined()
    const off = tl.wires!.ask.find((w) => !w.on)!
    const on = tl.wires!.ref.find((w) => w.on)!
    const reveal = tl.appear.broker
    expect(off.t0).toBeCloseTo(a1.morph!.t0, 3)
    expect(reveal).toBeGreaterThanOrEqual(off.t1 - 1e-6)
    expect(on.t0).toBeGreaterThanOrEqual(reveal + 0.5)
    expect(on.t1).toBeCloseTo(a1.morph!.t1, 3)
  })

  test("delta membership: removed → first act only, added → every act but the first; no delta look", () => {
    const spec = {
      type: "architecture",
      title: "d",
      nodes: [
        { id: "a", label: "a" },
        { id: "old", label: "old", delta: "removed" },
        { id: "new", label: "new", delta: "added" },
      ],
      edges: [
        { from: "a", to: "old", delta: "removed" },
        { from: "a", to: "new", delta: "added" },
      ],
      story: { acts: ACTS, steps: [{ caption: "x" }, { act: "after", caption: "y" }] },
    }
    const s = sceneOf(spec)
    expect(s.nodes.find((n) => n.id === "old")!.acts).toEqual(["before"])
    expect(s.nodes.find((n) => n.id === "new")!.acts).toEqual(["after"])
    expect(s.edges.find((e) => e.id === "a->new")!.acts).toEqual(["after"])
    expect(s.legend).toBeUndefined()
    expect(s.nodes.some((n) => n.delta || n.badge)).toBe(false)
    expect(s.edges.some((e) => e.delta)).toBe(false)
  })

  test("cut and continue", () => {
    const cut = sceneOf(base({ acts: ACTS, steps: STEPS.map((s, i) => (i === 2 ? { ...s, enter: "cut" } : s)) })).timeline!
    expect(cut.acts![1].cut!.t1 - cut.acts![1].cut!.t0).toBeCloseTo(0.4, 3)
    expect(cut.acts![1].rewind).toBeUndefined()
    expect(cut.acts![1].state).toBeDefined()
    const mid = (cut.acts![1].cut!.t0 + cut.acts![1].cut!.t1) / 2
    expect(storyState(sceneOf(base({ acts: ACTS, steps: STEPS })), cut, mid).act!.dip).toBeLessThan(0.1)
    const cont = sceneOf(base({ acts: ACTS, steps: STEPS.map((s, i) => (i === 2 ? { ...s, enter: "continue" } : s)) })).timeline!
    expect(cont.acts![1].rewind).toBeUndefined()
    expect(cont.acts![1].state).toBeUndefined()
    expect(cont.acts![1].morph!.t0).toBe(cont.acts![1].t0)
  })

  test("beats: the act start is its own beat and a chapter", () => {
    const g = beatGroups(tl)
    expect(g.some((x) => x[0] === 2)).toBe(true)
    expect(tl.steps.filter((s) => s.stop).map((s) => s.stop)).toEqual(["fixed"])
  })
})

describe("acts: state", () => {
  const sc = sceneOf(base({ acts: ACTS, steps: STEPS }))
  const tl = sc.timeline!
  const a1 = tl.acts![1]
  const rw = a1.rewind!
  const strip = (f: ReturnType<typeof storyState>) => ({ ...f, t: 0, captions: [], settled: false, act: undefined })

  test("frames in the rewind window equal earlier frames (played backwards, eased)", () => {
    for (const u of [0.1, 0.35, 0.5, 0.8]) {
      const t = rw.t0 + u * (rw.t1 - rw.t0)
      const m = rw.from1 - inOutCubic(u) * (rw.from1 - rw.from0)
      const f = storyState(sc, tl, t)
      expect(f.captions).toEqual([])
      expect(f.act!.rewind).toBeCloseTo(u, 2)
      expect(f.act!.chip.some((c) => c.rewind)).toBe(true)
      expect(strip(f)).toEqual(strip(storyState(sc, tl, m)))
    }
  })

  test("after the rewind the act starts from the first act's start state", () => {
    const f = storyState(sc, tl, a1.morph!.t0 + 1e-3)
    // Tones and statuses of act 1 are undone; the leak never happened.
    expect(f.tone?.cli).toBeUndefined()
    expect(f.status?.agent).toBeUndefined()
    // The end state is act 2's.
    const end = storyState(sc, tl, tl.duration)
    expect(end.status?.agent?.s).toBe("done")
    expect(end.tone?.cli).toBeUndefined()
    expect(end.undraw?.ask).toBe(1)
    expect(end.el.broker).toBeUndefined()
    expect(end.act!.chip).toEqual([{ text: "fixed", tone: "good", o: 1 }])
    // The act's own segment carries the undone steps at "never".
    expect(actTimeline(tl, 1)).not.toBe(tl)
  })

  test("act 1: the after-only node and wires are hidden", () => {
    const f = storyState(sc, tl, rw.t0 - 0.01)
    expect(f.el.broker.o).toBe(0)
    expect(f.draw.ref).toBe(0)
    expect(f.draw.ask).toBeUndefined()
    expect(f.act!.id).toBe("before")
  })

  test("actEndTime: the act's settled end; the last act = the story's end", () => {
    const t = actEndTime(tl, "before")!
    expect(t).toBeLessThan(a1.t0)
    expect(storyState(sc, tl, t).status?.agent?.s).toBe("error")
    expect(actEndTime(tl, "after")).toBe(tl.duration)
    expect(actEndTime(tl, "nope")).toBeUndefined()
  })

  test("static SVG: --act renders that act's end; the animated SVG has the chip and the rewind", () => {
    const svg = renderSvg(sc, { t: actEndTime(tl, "before")!, font: false })
    expect(svg).toContain("si-t-risk")
    const anim = renderAnimatedSvg(sc, { font: "system" })
    expect(anim).toContain("si-act-chip")
    expect(anim).toContain("\u25c0\u25c0 rewind")
  })
})

describe("acts: layout", () => {
  test("a first-act wire runs straight through the slot of an after-only node", () => {
    const sc = sceneOf(base({ acts: ACTS, steps: STEPS }))
    const ask = sc.edges.find((e) => e.id === "ask")!
    const broker = sc.nodes.find((n) => n.id === "broker")!
    const ys = new Set(ask.points.map((p) => p.y))
    expect(ys.size).toBe(1)
    const y = ask.points[0].y
    expect(y > broker.y && y < broker.y + broker.h).toBe(true)
    expect(ask.points[0].x < broker.x && ask.points[ask.points.length - 1].x > broker.x + broker.w).toBe(true)
  })

  test("without acts the layout is unchanged by the act code path", () => {
    const plain = base({ steps: [{ caption: "x" }] }) as Record<string, unknown>
    for (const k of ["nodes", "edges"] as const) (plain[k] as Record<string, unknown>[]).forEach((x) => delete x.in)
    const sc = sceneOf(plain)
    expect(sc.nodes.some((n) => n.acts) || sc.edges.some((e) => e.acts)).toBe(false)
    expect(sc.timeline!.acts).toBeUndefined()
  })
})

describe("acts: validate", () => {
  const diag = (spec: unknown) => validate(spec).diagnostics
  test("unknown act in `in`: did-you-mean", () => {
    const d = diag(base({ acts: ACTS, steps: STEPS }, { nodes: [{ id: "x", label: "x", in: ["aftr"] }] }))
    expect(d.find((x) => x.path === "nodes[4].in[0]")).toMatchObject({ severity: "error", message: 'unknown act "aftr"' })
    expect(d.find((x) => x.path === "nodes[4].in[0]")!.hint).toContain('"after"')
  })
  test("an edge whose ends never share its acts", () => {
    const d = diag(base({ acts: ACTS, steps: STEPS }, { edges: [{ id: "bad", from: "broker", to: "vault", in: ["before"] }] }))
    expect(d.find((x) => x.path === "edges[4]")).toMatchObject({ severity: "error" })
  })
  test("act steps: unknown, out of order, enter, change; acts with no steps", () => {
    const d = diag(base({ acts: ACTS, steps: [{ caption: "a" }, { act: "aftre" }, { caption: "b", enter: "rewnd" }] }))
    expect(d.find((x) => x.path === "story.steps[1].act")!.hint).toContain('"after"')
    expect(d.find((x) => x.path === "story.steps[2].enter")).toMatchObject({ severity: "warning" })
    expect(d.find((x) => x.path === "story.acts[1]")).toMatchObject({ severity: "warning", message: 'act "after" never starts' })
    const e = diag(base({ acts: ACTS, steps: [{ caption: "a", change: "ask" }, { act: "after", enter: "rewnd" }] }))
    expect(e.find((x) => x.path === "story.steps[1].enter")!.hint).toContain('"rewind"')
    expect(e.find((x) => x.path === "story.steps[0].change")).toMatchObject({ severity: "warning" })
  })
  test("acts shape, sequence diagrams, `in` without acts", () => {
    expect(diag(base({ acts: [ACTS[0]], steps: STEPS.slice(0, 2) })).find((x) => x.path === "story.acts")).toMatchObject({ severity: "error" })
    expect(diag(base({ acts: [ACTS[0], { ...ACTS[0] }], steps: STEPS.slice(0, 2) })).find((x) => x.message.startsWith("duplicate act"))).toBeDefined()
    expect(diag(base({ acts: [ACTS[0], { id: "b", label: "b", tone: "riks" }], steps: STEPS.slice(0, 2) })).find((x) => x.path === "story.acts[1].tone")!.hint).toContain('"risk"')
    const seq = { type: "sequence", title: "s", participants: [{ id: "a" }, { id: "b" }], messages: [{ from: "a", to: "b" }], story: { acts: ACTS, steps: [{ caption: "x" }] } }
    expect(diag(seq).find((x) => x.path === "story.acts")).toMatchObject({ severity: "error", message: "acts need a graph diagram" })
    expect(diag(base({ steps: [{ caption: "x" }] })).find((x) => x.path === "nodes[1].in")).toMatchObject({ severity: "warning" })
  })
})

describe("acts: examples", () => {
  const dir = path.join(import.meta.dir, "..", "examples", "stories")
  for (const f of ["secret-broker.architecture.json", "payment-retry.acts.architecture.json"])
    test(f, () => {
      const v = validate(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Spec)
      expect(v.diagnostics).toEqual([])
      const sc = layout(v.spec!)
      expect(sc.timeline!.acts!.length).toBe(2)
      expect(sc.timeline!.acts![1].state).toBeDefined()
    })
})

describe("acts: edge cases (regressions)", () => {
  test("a leaving wire that only its undone act wired is not retracted (it was never drawn in the act's start state)", () => {
    const sc = sceneOf(base({ acts: ACTS, steps: [{ caption: "wire it", wire: "ask" }, { act: "after", caption: "fix" }, { caption: "ref", pulse: "ref" }] }))
    const tl = sc.timeline!
    const a1 = tl.acts![1]
    // Act 1 draws it and plays; after the rewind the act starts without it: no retract in the morph.
    expect(tl.wires!.ask.filter((e) => !e.on)).toEqual([])
    for (const t of [a1.rewind!.t1 + 0.01, (a1.morph?.t0 ?? a1.body) + 0.2, a1.body + 0.5]) {
      const f = storyState(sc, tl, t)
      expect(f.draw.ask === 0 || (f.undraw?.ask ?? 0) >= 1).toBe(true)
    }
    // Mid act 1 it is drawn.
    expect(storyState(sc, tl, a1.t0 - 0.05).draw.ask).toBeUndefined()
  })
  test("a node back on stage after an act without it: its reveal step shows it again; earlier acts keep it", () => {
    const three = [...ACTS, { id: "third", label: "third", tone: "note" }]
    const spec = base(
      { acts: three, steps: [{ caption: "one" }, { act: "after", enter: "continue", caption: "two" }, { act: "third", enter: "continue", caption: "three" }, { caption: "back", reveal: "vault2" }] },
      { nodes: [{ id: "vault2", label: "vault 2", in: ["before", "third"] }] },
    )
    const sc = sceneOf(spec)
    const tl = sc.timeline!
    const [a0, a1, a2] = tl.acts!
    expect(tl.appear.vault2).toBeUndefined()
    const o = (t: number) => (storyState(sc, tl, t).el.vault2?.o ?? 1) * (storyState(sc, tl, t).vis?.vault2 ?? 1)
    expect(o(a0.t1 - 0.1)).toBe(1)
    expect(o(a1.body + 0.5)).toBe(0)
    const back = tl.steps[3].t0
    expect(o(back - 0.05)).toBe(0)
    expect(o(tl.duration)).toBe(1)
    expect(a2.id).toBe("third")
  })
})
