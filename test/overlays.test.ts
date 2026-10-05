import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { layout } from "../src/core/layout/index.ts"
import { validate } from "../src/core/validate.ts"
import { actTimeline, storyState } from "../src/core/story/state.ts"
import { renderHtml, renderSvg } from "../src/core/render/index.tsx"
import { animatedHeaderHeight, renderAnimatedSvg } from "../src/core/render/smil.tsx"
import { ANN } from "../src/core/layout/overlays.ts"
import { NEVER } from "../src/core/story/acts.ts"
import type { Box, Scene } from "../src/core/scene.ts"

const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

const base = (story: Record<string, unknown> | undefined, extra: Record<string, unknown> = {}) => ({
  type: "architecture",
  title: "overlays",
  direction: "LR",
  nodes: [
    { id: "agent", label: "agent" },
    { id: "broker", label: "broker", in: ["after"] },
    { id: "cli", label: "cli" },
    { id: "vault", label: "vault" },
  ],
  edges: [
    { id: "ask", from: "agent", to: "cli", in: ["before"], label: "ask" },
    { id: "ref", from: "agent", to: "broker" },
    { id: "approve", from: "broker", to: "cli" },
    { id: "fetch", from: "cli", to: "vault" },
  ],
  annotations: [{ id: "chat", on: "agent", text: "chat ▸ sk-live-123", tone: "risk" }],
  ...(story ? { story } : {}),
  ...extra,
})
const ACTS = [
  { id: "before", label: "raw", tone: "risk" },
  { id: "after", label: "fixed", tone: "good" },
]

function sceneOf(spec: unknown): Scene {
  const v = validate(spec)
  expect(v.diagnostics.filter((d) => d.severity === "error")).toEqual([])
  return layout(v.spec!)
}
const diags = (spec: unknown) => validate(spec).diagnostics.map((d) => `${d.severity}: ${d.message}${d.hint ? ` (${d.hint})` : ""}`)

describe("B1 annotations", () => {
  test("layout: a mono line on its node's left edge, room reserved (no overlap with nodes / labels)", () => {
    const sc = sceneOf(base(undefined, { annotations: [{ id: "chat", on: "agent", text: "chat ▸ a much longer line than the node is wide" }, { id: "log", on: "cli", side: "bottom", text: "log" }] }))
    const [chat, log] = sc.annotations!
    const agent = sc.nodes.find((n) => n.id === "agent")!
    const cli = sc.nodes.find((n) => n.id === "cli")!
    expect(chat.x).toBe(agent.x)
    expect(chat.side).toBe("top")
    expect(chat.y).toBeLessThan(agent.y)
    expect(log.y).toBeGreaterThan(cli.y + cli.h)
    for (const a of sc.annotations!) {
      for (const n of sc.nodes) expect(overlap(a.box, n)).toBe(false)
      for (const e of sc.edges) if (e.label) expect(overlap(a.box, e.label)).toBe(false)
      // Inside the viewBox.
      expect(a.box.y).toBeGreaterThanOrEqual(sc.viewBox.y)
      expect(a.box.x + a.box.w).toBeLessThanOrEqual(sc.viewBox.x + sc.viewBox.w)
    }
  })
  test("versions: spec text, then each set with text / tone (sized for the widest)", () => {
    const sc = sceneOf(base({ steps: [{ type: "chat" }, { set: { id: "chat", text: "chat ▸ ref://x/credential", tone: "good" } }, { set: { id: "chat", tone: "note" } }] }))
    const a = sc.annotations![0]
    expect(a.versions).toEqual([
      { text: "chat ▸ sk-live-123", tone: "risk" },
      { text: "chat ▸ ref://x/credential", tone: "good" },
      { text: "chat ▸ ref://x/credential", tone: "note" },
    ])
    expect(a.box.w).toBeCloseTo("chat ▸ ref://x/credential".length * ANN.size * 0.6, 1)
  })
  test("typed first: hidden until its type step, then typed per char with a caret; set crossfades", () => {
    const sc = sceneOf(base({ steps: [{ caption: "go", pulse: "ask" }, { type: { id: "chat", cps: 20 } }, { set: { id: "chat", text: "chat ▸ ok" } }] }))
    const tl = sc.timeline!
    const run = tl.typing!.find((r) => r.target === "chat")!
    expect(run.by).toBe("char")
    expect(run.t1 - run.t0).toBeCloseTo("chat ▸ sk-live-123".length / 20, 2)
    expect(storyState(sc, tl, run.t0 - 0.01).content!.chat[0].chars).toEqual([0])
    const mid = storyState(sc, tl, (run.t0 + run.t1) / 2)
    expect(mid.content!.chat[0].chars![0]).toBeGreaterThan(0)
    expect(mid.caret?.some((c) => c.target === "chat")).toBe(true)
    const v1 = tl.versions!.chat[0]
    expect(v1.v).toBe(1)
    expect(storyState(sc, tl, tl.duration).content!.chat).toEqual([{ v: 1, o: 1 }])
    const svg = renderSvg(sc, { theme: "light" })
    expect(svg).toContain(">chat ▸ ok</text>")
    expect(svg).toContain('class="si-ann"')
  })
  test("reveal / hide / show / tone / clear take annotation ids", () => {
    const sc = sceneOf(base({ steps: [{ reveal: "chat" }, { tone: { ids: "chat", to: "warn" } }, { hide: "chat" }, { show: "chat" }, { clear: "chat" }] }))
    const tl = sc.timeline!
    expect(tl.appear.chat).toBe(0)
    expect(tl.tones!.chat[0].to).toBe("warn")
    expect(tl.vis!.chat.map((e) => e.to)).toEqual([0, 1])
    expect(tl.versions!.chat.at(-1)!.v).toBe(-1)
    const end = storyState(sc, tl, tl.duration)
    expect(end.tone!.chat.warn).toBe(1)
    expect(renderSvg(sc)).toContain("si-t-warn")
  })
  test("diagnostics: unknown node (did-you-mean), bad side, set fields that do not apply", () => {
    expect(diags(base(undefined, { annotations: [{ id: "x", on: "agnet", text: "t" }] }))).toContain(`error: unknown node "agnet" (did you mean "agent"?)`)
    expect(diags(base(undefined, { annotations: [{ id: "x", on: "agent", text: "t", side: "left" }] })).some((d) => d.startsWith("error: unknown annotation side"))).toBe(true)
    expect(diags(base(undefined, { annotations: [{ id: "cli", on: "agent", text: "t" }] })).some((d) => d.includes(`duplicate id "cli"`))).toBe(true)
    expect(diags(base({ steps: [{ set: { id: "chat", detail: "x" } }] })).some((d) => d.includes(`set "detail" does not apply to annotation "chat"`))).toBe(true)
  })
  test("acts: an annotation follows its node's acts unless it says in", () => {
    const sc = sceneOf(base({ acts: ACTS, steps: [{ caption: "a" }, { act: "after", caption: "b" }] }, { annotations: [{ id: "chat", on: "agent", text: "x" }, { id: "b", on: "broker", text: "y" }, { id: "only", on: "agent", text: "z", in: ["before"] }] }))
    const by = new Map(sc.annotations!.map((a) => [a.id, a]))
    expect(by.get("chat")!.acts).toBeUndefined()
    expect(by.get("b")!.acts).toEqual(["after"])
    expect(by.get("only")!.acts).toEqual(["before"])
    const tl = sc.timeline!
    // Leaving with act 1: fades in the morph; the broker's annotation reveals with it.
    expect(tl.vis!.only.map((e) => e.to)).toEqual([0])
    expect(tl.appear.b).toBe(tl.appear.broker)
  })
})

describe("B2 toasts", () => {
  const STEPS = [
    { caption: "ask", toast: { id: "t1", near: "cli", title: "Allow access?", text: "one secret", tone: "warn" } },
    { toast: { id: "t2", near: "cli", title: "Approve?", text: "again", tone: "warn" } },
    { toast: [{ id: "t3", near: "cli", text: "sign in" }, { id: "t4", near: "cli", title: "AUTHORIZE?!", text: "now", tone: "risk" }] },
    { tone: { ids: ["t1", "t2"], to: "risk", stagger: 0.1 } },
    { dismiss: "all", caption: "gone" },
    { toast: { near: "agent", text: "timed", for: 1.5 } },
  ]
  const sc = sceneOf(base({ steps: STEPS }))
  const tl = sc.timeline!
  test("placed deterministically: clear of nodes, edge labels, annotations and each other; inside the viewBox", () => {
    const ts = sc.toasts!
    expect(ts.map((t) => t.id)).toEqual(["t1", "t2", "t3", "t4", "toast-6-1"])
    const fixed: Box[] = [...sc.nodes, ...sc.edges.flatMap((e) => (e.label ? [e.label] : [])), ...sc.annotations!.map((a) => a.box)]
    for (const t of ts) {
      for (const b of fixed) expect(overlap(t, b)).toBe(false)
      expect(t.x).toBeGreaterThanOrEqual(sc.viewBox.x)
      expect(t.y).toBeGreaterThanOrEqual(sc.viewBox.y)
      expect(t.x + t.w).toBeLessThanOrEqual(sc.viewBox.x + sc.viewBox.w)
      expect(t.y + t.h).toBeLessThanOrEqual(sc.viewBox.y + sc.viewBox.h)
    }
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) expect(overlap(ts[i], ts[j])).toBe(false)
    // The first sits centred above its anchor.
    const cli = sc.nodes.find((n) => n.id === "cli")!
    expect(ts[0].x + ts[0].w / 2).toBeCloseTo(cli.x + cli.w / 2, 0)
    expect(ts[0].y + ts[0].h).toBeLessThan(cli.y)
    // Same input, same slots.
    expect(sceneOf(base({ steps: STEPS })).toasts).toEqual(ts)
  })
  test("windows: dismiss all ends them; for = timed expiry; frames fade + rise + scale in", () => {
    const w = tl.toasts!
    const d = tl.steps[4].t0
    for (const id of ["t1", "t2", "t3", "t4"]) expect(w[id].t1).toBeCloseTo(d, 3)
    expect(w["toast-6-1"].t1! - w["toast-6-1"].t0).toBeCloseTo(1.5, 3)
    const f0 = storyState(sc, tl, w.t1.t0 + 0.05).toasts!.t1
    expect(f0.o).toBeLessThan(1)
    expect(f0.dy).toBeGreaterThan(0)
    expect(f0.s).toBeLessThan(1)
    expect(storyState(sc, tl, w.t1.t0 + 0.5).toasts!.t1).toEqual({ o: 1, dy: 0, s: 1 })
    expect(storyState(sc, tl, d + 0.5).toasts?.t1).toBeUndefined()
    expect(storyState(sc, tl, tl.duration).toasts).toBeUndefined()
    // Reduced motion: settled (no rise, no scale).
    expect(storyState(sc, tl, w.t1.t0 + 0.05, { reduced: true }).toasts!.t1).toEqual({ o: 1, dy: 0, s: 1 })
  })
  test("tone steps take toast ids (contagion)", () => {
    expect(tl.tones!.t1[0].to).toBe("risk")
    expect(tl.tones!.t2[0].t - tl.tones!.t1[0].t).toBeCloseTo(0.1, 3)
    const html = renderHtml(sc)
    expect(html).toContain("si-toast")
  })
  test("diagnostics: still up at the end, unknown near / dismiss ids (did-you-mean), not up yet", () => {
    expect(diags(base({ steps: [{ toast: { id: "x", near: "cli", text: "hi" } }] }))).toContain(`warning: toast "x" is still up at the end: the static diagram shows it (add "dismiss": "x" (or "all") to a later step, or give it "for": seconds)`)
    expect(diags(base({ steps: [{ toast: { near: "clii", text: "hi", for: 1 } }] }))).toContain(`error: unknown node "clii" (toasts float near a node; did you mean "cli"?)`)
    expect(diags(base({ steps: [{ toast: { id: "abc", near: "cli", text: "hi" } }, { dismiss: "abd" }] }))).toContain(`error: unknown toast "abd" (dismiss takes toast ids or "all"; did you mean "abc"?)`)
    expect(diags(base({ steps: [{ dismiss: "all" }] }))).toContain(`warning: no toast is up here; dismiss "all" has no effect`)
    expect(diags(base({ steps: [{ toast: { near: "cli", text: "hi", for: -1 } }] })).some((d) => d.startsWith(`error: "for" must be seconds`))).toBe(true)
    expect(diags(base({ steps: [{ toast: { near: "cli", text: "hi", tone: "rsik", for: 1 } }] })).some((d) => d.includes(`did you mean "risk"?`))).toBe(true)
  })
  test("acts: a toast still up when its act ends warns; the rewind reverses it and the next act starts without it", () => {
    const spec = base({ acts: ACTS, steps: [{ caption: "a", toast: { id: "x", near: "cli", text: "hi" } }, { act: "after", caption: "b" }, { caption: "c" }] })
    expect(diags(spec)).toContain(`warning: toast "x" is still up when act "before" ends (add "dismiss": "x" (or "all") to a step before, or give the toast "for": seconds)`)
    const s2 = sceneOf(spec)
    const t2 = s2.timeline!
    const a1 = t2.acts![1]
    expect(actTimeline(t2, 1).toasts!.x.t0).toBe(NEVER)
    // Mid-rewind it is still there (act 1 played backwards); after the morph it is gone.
    expect(storyState(s2, t2, (a1.rewind!.t0 + a1.rewind!.t1) / 2).toasts?.x).toBeDefined()
    expect(storyState(s2, t2, a1.body + 0.5).toasts?.x).toBeUndefined()
  })
})

describe("B3 HUD", () => {
  const story = {
    acts: ACTS,
    hud: [{ id: "prompts", label: "prompts", value: 0 }, { id: "lost", label: "lost orders", at: "bottom-left", tone: "risk" }],
    steps: [
      { caption: "a", counter: { id: "prompts", to: 1 }, reveal: "lost" },
      { counter: { id: "prompts", to: 4 }, tone: { ids: "prompts", to: "risk" } },
      { act: "after", caption: "b" },
      { caption: "c", tone: { ids: "prompts", to: "good" } },
    ],
  }
  const sc = sceneOf(base(story))
  const tl = sc.timeline!
  test("timeline.hud + counter values; rewind resets the number; tone layers", () => {
    expect(tl.hud!.map((h) => [h.id, h.at])).toEqual([["prompts", "top-right"], ["lost", "bottom-left"]])
    const before = tl.acts![1].t0 - 0.01
    expect(storyState(sc, tl, before).counters.prompts).toBe("4")
    expect(storyState(sc, tl, before).tone!.prompts.risk).toBe(1)
    const end = storyState(sc, tl, tl.duration)
    expect(end.counters.prompts).toBe("0")
    expect(end.tone!.prompts.good).toBe(1)
    // Revealed HUD: hidden until its step.
    expect(tl.appear.lost).toBe(0)
  })
  test("HTML overlay below the act chip; tiles show it; animated SVG gets a header row", () => {
    const html = renderHtml(sc)
    expect(html).toContain('class="si-hud si-hud-top-right si-hud-below"')
    expect(html).toContain("si-hud-bottom-left")
    expect(html).toContain(".si-hud{")
    const svg = renderAnimatedSvg(sc, { theme: "light" })
    expect(svg).toContain('class="si-hud"')
    expect(animatedHeaderHeight(sc)).toBeGreaterThan(animatedHeaderHeight({ ...sc, timeline: { ...tl, hud: undefined } }))
  })
  test("diagnostics: id clash, unknown counter hints the HUD", () => {
    expect(diags(base({ hud: [{ id: "cli", label: "x" }], steps: [{ caption: "a" }] })).some((d) => d.includes(`HUD id "cli" is already used`))).toBe(true)
    expect(diags(base({ hud: [{ id: "prompts", label: "p" }], steps: [{ counter: { id: "prompt", to: 1 } }] })).some((d) => d.includes(`did you mean "prompts"?`))).toBe(true)
    expect(diags(base({ hud: [{ id: "p", label: "p", at: "top-left" }], steps: [] })).some((d) => d.startsWith("error: unknown HUD position"))).toBe(true)
  })
})

describe("overlays: render", () => {
  test("animated SVG: annotation typing, toast and tone tracks", () => {
    const sc = sceneOf(base({ steps: [{ caption: "a", type: "chat", toast: { id: "t", near: "cli", text: "hi", for: 1 } }, { tone: { ids: ["t", "chat"], to: "warn" } }] }))
    const svg = renderAnimatedSvg(sc, { theme: "dark" })
    expect(svg).toContain('data-si="toast:t"')
    expect(svg).toContain('data-si="ann:chat"')
    expect(svg).toMatch(/type="scale"/)
    expect(svg).toContain(".si-toast{")
  })
  test("specs without overlays emit no overlay markup or rules", () => {
    const plain = { type: "architecture", title: "p", nodes: [{ id: "a" }, { id: "b" }], edges: [{ from: "a", to: "b" }], story: { steps: [{ pulse: "a->b" }] } }
    const sc = sceneOf(plain)
    expect(sc.annotations).toBeUndefined()
    expect(sc.toasts).toBeUndefined()
    expect(sc.timeline!.hud).toBeUndefined()
    const noViewer = (html: string) => html.replace(/<script id="storyink-viewer">[\s\S]*?<\/script>/, "")
    for (const out of [renderSvg(sc), noViewer(renderHtml(sc)), renderAnimatedSvg(sc)]) {
      expect(out).not.toContain("si-ann")
      expect(out).not.toContain("si-toast")
      expect(out).not.toContain("si-hud")
    }
  })
  test("the story examples validate without warnings", () => {
    for (const f of ["secret-broker.architecture.json", "payment-retry.acts.architecture.json"]) {
      const spec = JSON.parse(fs.readFileSync(path.join(import.meta.dir, "../examples/stories", f), "utf8"))
      expect(diags(spec)).toEqual([])
    }
  })
})
