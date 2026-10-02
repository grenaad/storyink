import { describe, expect, test } from "bun:test"
import { layout, renderAnimatedSvg, renderSvg, stepFocus, storyState, validate } from "../src/core/index.ts"
import { changesStory, changesStoryOf } from "../src/core/story/changes.ts"

const graph = (story: unknown, extra: Record<string, unknown> = {}) => ({
  type: "dataflow",
  title: "T",
  change: { base: "main", head: "x", title: "Batch it" },
  nodes: [
    { id: "src", label: "Source", delta: "unchanged" },
    { id: "old", label: "Old loop", delta: "removed", summary: "The loop goes.", files: ["a/old.ts"] },
    { id: "new", label: "Bulk sender", delta: "added", summary: "Sends in bulk." },
    { id: "api", label: "API", delta: "modified" },
    { id: "d", kind: "code", label: "api.ts", delta: "modified", diff: "@@ -1,1 +1,1 @@\n-a()\n+b()" },
  ],
  edges: [
    { id: "s-o", from: "src", to: "old", delta: "removed" },
    { id: "s-n", from: "src", to: "new", delta: "added" },
    { id: "n-a", from: "new", to: "api", delta: "added", emphasis: "hero" },
    { id: "a-d", from: "api", to: "d", style: "dashed", arrow: "none" },
  ],
  story,
  ...extra,
})
const steps = (s: unknown[]) => ({ steps: s })
const warns = (v: unknown) => validate(v).diagnostics.filter((d) => d.severity === "warning")

describe("change steps: validation", () => {
  test("no delta / unchanged / twice / reveal + change", () => {
    expect(warns(graph(steps([{ change: "src" }])))[0].message).toContain("no delta")
    expect(warns(graph(steps([{ change: "a-d" }])))[0].message).toContain("no delta")
    expect(warns(graph(steps([{ change: "old" }, { change: "old" }])))[0].message).toContain("already changed")
    expect(warns(graph(steps([{ reveal: "new" }, { change: "new" }]))).some((d) => d.message.includes("both revealed and changed"))).toBe(true)
    expect(validate(graph(steps([{ change: "nope" }]))).diagnostics[0].message).toContain('unknown id "nope"')
    expect(validate(graph(steps([{ change: ["old", "s-o", "new", "s-n", "api", "d", "n-a"] }]))).diagnostics).toEqual([])
  })
})

describe("change steps: timeline and frames", () => {
  const sc = layout(validate(graph(steps([{ at: 1, change: ["old", "s-o"] }, { change: ["new", "s-n", "n-a"] }, { change: ["api", "d"] }]))).spec!)
  const tl = sc.timeline!
  test("added reveal / wire, removed unwire + ghost window, diff node applies, modified flashes", () => {
    expect(tl.appear.new).toBeDefined()
    expect(tl.wires!["s-n"][0].on).toBe(true)
    expect(tl.wires!["s-o"][0].on).toBe(false)
    expect(tl.changes!["s-o"].delta).toBe("removed")
    expect(tl.changes!["s-o"].t0).toBeGreaterThan(tl.wires!["s-o"][0].t0)
    expect(tl.changes!.old.delta).toBe("removed")
    expect(tl.changes!.api.delta).toBe("modified")
    expect(tl.changes!.new).toBeUndefined()
    expect(tl.applies!.d).toBeDefined()
    expect(tl.glows.some((g) => g.node === "api")).toBe(true)
    expect(Object.keys(tl.legendAt!)).toEqual(["added", "modified", "removed"])
  })
  test("before look until the step, after look after it; final frame is the static diagram", () => {
    const f0 = storyState(sc, tl, 0.5)
    expect(f0.delta).toMatchObject({ old: 0, "s-o": 0, api: 0 })
    expect(f0.legend).toMatchObject({ added: 0, removed: 0 })
    const end = storyState(sc, tl, tl.duration)
    expect(end.delta).toBeUndefined()
    expect(end.legend).toBeUndefined()
    const sp = validate(graph(steps([{ at: 1, change: ["old", "s-o"] }, { change: ["new", "s-n", "n-a"] }, { change: ["api", "d"] }]))).spec!
    const before = renderSvg(sp, { theme: "light", font: false, t: 0.5 })
    expect(before).not.toMatch(/data-si="node:old"[^>]*si-d-removed/)
    expect(before).not.toMatch(/si-badge-text-removed"[^>]*>REMOVED/)
    expect(before).not.toContain('class="si-strike"')
    const after = renderSvg(sp, { theme: "light", font: false })
    expect(after).toMatch(/si-badge-text-removed"[^>]*>REMOVED/)
    expect(after).toContain('class="si-dface si-a-rose si-d-removed"')
    expect(after).toContain('class="si-edge si-d-removed"')
    const anim = renderAnimatedSvg(sp, { theme: "light" })
    expect(anim).not.toMatch(/var\(--/)
    expect(anim).toMatch(/class="si-dface si-a-rose si-d-removed"><animate attributeName="opacity"/)
  })
  test("unchanged-by-story deltas are in their after look from the start", () => {
    const s2 = layout(validate(graph(steps([{ at: 1, change: "old" }]))).spec!)
    expect(s2.timeline!.changes!.api).toBeUndefined()
    expect(storyState(s2, s2.timeline, 0.2).delta).toEqual({ old: 0 })
  })
})

describe("story: changes", () => {
  test("derivation: opening, beats in flow order with edges and attached diffs, hero pulse, overview, narrate", () => {
    const v = validate(graph("changes"))
    expect(v.diagnostics).toEqual([])
    const sc = layout(v.spec!)
    const st = changesStory(sc, v.spec!).steps as Record<string, unknown>[]
    expect(st[0]).toMatchObject({ caption: "Batch it", stop: "Before" })
    expect(st.slice(1, 4).map((s) => s.change)).toEqual([["old", "s-o"], ["new", "s-n"], ["api", "d", "n-a"]])
    expect(st[1].narrate).toEqual({ heading: "Old loop removed", body: "Old loop: The loop goes. See a/old.ts.", cites: [{ text: "Old loop", ref: "old" }, { text: "a/old.ts", ref: "a/old.ts" }] })
    expect(st[3].focus).toEqual(["api", "d"])
    expect(st[4].pulse).toBeDefined()
    expect(st[st.length - 1]).toMatchObject({ stop: "After", caption: "1 added · 1 changed · 1 removed" })
    expect(sc.timeline!.steps.some((s) => s.narrate)).toBe(true)
  })
  test("sequences: message order; CLI / tool option keeps the story options", () => {
    const seq = {
      type: "sequence",
      title: "S",
      participants: [{ id: "a" }, { id: "b", delta: "added" }],
      messages: [{ from: "a", to: "a", kind: "self", label: "x" }, { id: "m", from: "a", to: "b", label: "call", delta: "added" }],
      story: { steps: "changes", spotlight: "veil" },
    }
    const v = validate(seq)
    expect(v.diagnostics).toEqual([])
    const sc = layout(v.spec!)
    expect(sc.timeline!.steps[1].label).toBe("call")
    expect(sc.timeline!.veil?.length).toBeGreaterThan(0)
    expect(changesStoryOf({ steps: [], pace: 1 })).toEqual({ pace: 1, steps: "changes" })
    expect(changesStoryOf(undefined)).toEqual({ steps: "changes" })
  })
})

describe("focus lists and the veil", () => {
  const sp = validate(graph({ spotlight: "veil", steps: [{ at: 1, focus: ["src", "api"], caption: "x" }, { change: "old", caption: "y" }] })).spec!
  const sc = layout(sp)
  const tl = sc.timeline!
  test("focus: the union box", () => {
    const b = stepFocus(sc, tl, 0, 0)!
    const a = sc.nodes.find((n) => n.id === "src")!
    const c = sc.nodes.find((n) => n.id === "api")!
    expect(b.x).toBe(Math.min(a.x, c.x))
    expect(b.y + b.h).toBe(Math.max(a.y + a.h, c.y + c.h))
  })
  test("veil glides between focus boxes and is gone at the end", () => {
    expect(tl.veil!.length).toBe(2)
    expect(storyState(sc, tl, 1.5).veil!.a).toBeGreaterThan(0.5)
    expect(storyState(sc, tl, tl.duration).veil).toBeUndefined()
    expect(renderSvg(sp, { theme: "dark", font: false, t: 1.5 })).toContain('class="si-veil-shade"')
    expect(renderSvg(sp, { theme: "dark", font: false })).not.toContain(`class="si-veil`)
    const anim = renderAnimatedSvg(sp, { theme: "dark" })
    expect(anim).toMatch(/class="si-veil si-x"[^>]*><animate attributeName="opacity"/)
    expect(anim).toMatch(/class="si-veil-rim"[^>]*><animate attributeName="x"/)
  })
  test("spotlight true is unchanged (circle spot, no veil)", () => {
    const s2 = layout(validate(graph({ spotlight: true, steps: [{ at: 1, focus: "src" }] })).spec!)
    expect(s2.timeline!.spot?.length).toBe(1)
    expect(s2.timeline!.veil).toBeUndefined()
  })
})
