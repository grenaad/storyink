import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { animatedSvg, renderHtml, renderSvg, toScene, validate } from "../src/core/index.ts"
import { parseEmphasis } from "../src/core/story/compile.ts"
import { pulseLabel, storyState } from "../src/core/story/state.ts"
import { TONE_FADE } from "../src/core/story/content.ts"
import { toneInk, toneTint, TONE_SOURCE } from "../src/theme/tones.ts"
import { textWidth } from "../src/core/layout/measure.ts"
import type { Scene } from "../src/core/scene.ts"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { Captions } from "../src/core/render/Story.tsx"

const base = {
  type: "dataflow",
  title: "t",
  direction: "LR",
  nodes: [
    { id: "a", kind: "client", label: "browser" },
    { id: "b", kind: "service", label: "api", detail: "idle" },
    { id: "c", kind: "database", label: "db" },
  ],
  edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }],
  groups: [],
}
const mk = (steps: unknown[], extra: object = {}) => ({ ...base, ...extra, story: { steps } })
const scene = (steps: unknown[], extra: object = {}): Scene => toScene(mk(steps, extra))
const diags = (steps: unknown[], extra: object = {}) =>
  validate(mk(steps, extra)).diagnostics.map((d) => `${d.severity}: ${d.message}${d.hint ? ` (${d.hint})` : ""}`)

describe("tone palette (one source for pages and diagrams)", () => {
  test("page tone inks are the diagram tone inks", () => {
    expect(TONE_SOURCE.good.ink).toEqual(["delta", "deltaAdded"])
    expect(toneInk("light", "note")).toBe("#4a6a86")
    expect(toneInk("dark", "risk")).toBe("#e3a597")
    // The tint is a light mix of the ink into the node face.
    expect(toneTint("light", "good")).not.toBe(toneInk("light", "good"))
    expect(toneTint("light", "good")).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe("A1 pulse options", () => {
  const S = scene([
    { pulse: { route: ["a->b", "b->c"], tone: "note", label: "POST /orders", stain: true, tint: true } },
    { pulse: { edge: "b->c", reverse: true, tone: "good", label: "201", land: "edge" } },
  ])
  const tl = S.timeline!
  test("tone and label ride on the timeline pulse", () => {
    expect(tl.pulses[0].tone).toBe("note")
    expect(tl.pulses[0].label).toBe("POST /orders")
    expect(tl.glows.find((g) => g.node === "c")?.tone).toBe("note")
  })
  test("tint: the target takes the tone at arrival; stain: each wire as the dot leaves it", () => {
    const p = tl.pulses[0]
    expect(tl.tones!.c).toEqual([{ t: Math.round(p.tf1 * 1e4) / 1e4, to: "note" }])
    const ab = tl.tones!["a->b"][0].t
    const bc = tl.tones!["b->c"][0].t
    expect(ab).toBeGreaterThan(p.tf0)
    expect(ab).toBeLessThan(bc)
    expect(bc).toBeCloseTo(p.tf1, 2)
  })
  test("land: the label becomes the arriving edge's label (end state)", () => {
    const e = S.edges.find((x) => x.id === "b->c")!
    expect(e.labels).toEqual([{ text: "" }, { text: "201", tone: "good" }])
    expect(e.label?.text).toBe("")
    expect(tl.versions!["b->c@elabel"]).toHaveLength(1)
    const svg = renderSvg(S, { font: false })
    expect(svg).toContain(">201</text>")
    expect(svg).toMatch(/class="si-t-good" data-v="1"/)
  })
  test("the label fades in after departure, out after arrival, sits above a horizontal wire", () => {
    const p = tl.pulses[0]
    expect(pulseLabel(p, p.tf0 - 0.01)).toBeUndefined()
    // Visible through contact; gone once the post-arrival fade completes.
    expect(pulseLabel(p, p.tf1)?.o).toBe(1)
    expect(pulseLabel(p, p.tf1 + 0.2)).toBeUndefined()
    // Mid first hop (a horizontal wire): centred on the dot, above it.
    const sp = p.spans[0]
    const midX = p.points[0].x + (sp.s0 + sp.s1) / 2
    let mid = p.tf0
    for (let t = p.tf0; t < p.tf1; t += 0.005) if (Math.abs((storyState(S, tl, t).pulses.find((x) => x.id === p.id)?.x ?? 0) - midX) < Math.abs((storyState(S, tl, mid).pulses.find((x) => x.id === p.id)?.x ?? 0) - midX)) mid = t
    const f = storyState(S, tl, mid).pulses.find((x) => x.id === p.id)!
    expect(f.tone).toBe("note")
    expect(f.label).toBeDefined()
    expect(f.label!.y).toBeLessThan(f.y)
    expect(f.label!.x + textWidth("POST /orders", 10) / 2).toBeCloseTo(f.x, 0)
  })
  test("reduced motion: no flights, so no labels; tones are settled", () => {
    const end = tl.steps[0].t1
    const f = storyState(S, tl, end, { reduced: true, stepped: true })
    expect(f.pulses).toEqual([])
    expect(f.tone?.c?.note).toBe(1)
  })
  test("diagnostics: truncation, land / tint / stain prerequisites, did-you-mean", () => {
    const long = "x".repeat(40)
    expect(diags([{ pulse: { edge: "a->b", label: long } }])[0]).toMatch(/^warning: pulse label is 40 chars; shown as "x{31}…"/)
    expect(diags([{ pulse: { edge: "a->b", land: "edge" } }])).toEqual([`warning: "land" needs a "label"; nothing lands (add "label": "...")`])
    expect(diags([{ pulse: { edge: "a->b", tint: true } }])[0]).toMatch(/^warning: "tint" needs a pulse "tone"/)
    expect(diags([{ pulse: { edge: "a->b", stain: true } }])[0]).toMatch(/^warning: "stain" needs a pulse "tone"/)
    expect(diags([{ pulse: { edge: "a->b", tone: "nte" } }])).toEqual([`error: unknown tone "nte" (did you mean "note"? (one of: neutral, note, good, warn, risk))`])
    expect(diags([{ pulse: { edge: "a->b", lable: "x" } }])).toEqual([`warning: unknown field "lable" is ignored (did you mean "label"?)`])
  })
  test("pulse labels widen the layer gap they ride in", () => {
    const plain = toScene(mk([{ pulse: "b->c" }]))
    const labelled = toScene(mk([{ pulse: { edge: "b->c", label: "a long payload label" } }]))
    const gap = (s: Scene) => s.nodes.find((n) => n.id === "c")!.x - (s.nodes.find((n) => n.id === "b")!.x + s.nodes.find((n) => n.id === "b")!.w)
    expect(gap(labelled)).toBeGreaterThan(gap(plain))
  })
})

describe("A2 tone step", () => {
  const S = scene([{ tone: { ids: ["a", "a->b", "b"], to: "risk", stagger: 0.2 } }, { tone: { ids: "b", to: null } }])
  const tl = S.timeline!
  test("stagger in list order; null clears", () => {
    const t0 = tl.steps[0].t0
    expect(tl.tones!.a[0]).toEqual({ t: t0, to: "risk" })
    expect(tl.tones!["a->b"][0].t).toBeCloseTo(t0 + 0.2, 6)
    expect(tl.tones!.b[0].t).toBeCloseTo(t0 + 0.4, 6)
    expect(tl.tones!.b[1].to).toBeNull()
    expect(tl.steps[0].t1).toBeGreaterThanOrEqual(t0 + 0.4 + TONE_FADE - 1e-3)
  })
  test("crossfade over TONE_FADE; persists into the final frame; a cleared element rests", () => {
    const t0 = tl.steps[0].t0
    const half = storyState(S, tl, t0 + TONE_FADE / 2).tone!.a!.risk!
    expect(half).toBeGreaterThan(0.3)
    expect(half).toBeLessThan(0.7)
    const end = storyState(S, tl, tl.duration)
    expect(end.tone).toEqual({ a: { risk: 1 }, "a->b": { risk: 1 } })
  })
  test("render: a tone layer per element and tone (face, wire, ports); none without tones", () => {
    const svg = renderSvg(S, { font: false })
    expect(svg).toContain(`class="si-tone si-t-risk"`)
    expect(svg).toContain("--si-toneRisk:")
    expect(svg).toContain(".si-t-risk .si-face")
    const plain = renderSvg(scene([{ pulse: "a->b" }]), { font: false })
    expect(plain).not.toMatch(/si-tone|--si-tone|si-t-/)
  })
  test("crossfade between two tones keeps both layers partly visible", () => {
    const S2 = scene([{ tone: { ids: "b", to: "warn" } }, { tone: { ids: "b", to: "good" } }])
    const t1 = S2.timeline!.tones!.b[1].t
    const f = storyState(S2, S2.timeline, t1 + TONE_FADE / 2).tone!.b!
    expect(f.warn! + f.good!).toBeCloseTo(1, 1)
    expect(f.warn).toBeGreaterThan(0.2)
  })
  test("diagnostics: unknown ids / tones (did-you-mean), no-ops, sequence", () => {
    expect(diags([{ tone: { ids: "bb", to: "risk" } }])).toEqual([`error: unknown id "bb" (tone takes node, group, edge, annotation, toast or HUD ids; did you mean "b"?)`])
    expect(diags([{ tone: { ids: "b", to: "rsik" } }])).toEqual([`error: unknown tone "rsik" (did you mean "risk"? (one of: neutral, note, good, warn, risk, null))`])
    expect(diags([{ tone: { ids: "b", to: null } }])).toEqual([`warning: "b" has no tone here; tone null has no effect`])
    expect(diags([{ tone: { ids: "b", to: "good" } }, { tone: { ids: "b", to: "good" } }])).toEqual([`warning: "b" is already good here; tone has no effect`])
    expect(diags([{ tone: { ids: "b" } }])[0]).toMatch(/^error: "tone" must be/)
    const seq = { type: "sequence", title: "s", participants: [{ id: "x" }, { id: "y" }], messages: [{ from: "x", to: "y" }], story: { steps: [{ tone: { ids: "x", to: "risk" } }] } }
    expect(validate(seq).diagnostics.map((d) => d.message)).toEqual([`"tone" needs a graph diagram`])
  })
})

describe("A3 set and status on plain nodes", () => {
  const S = scene([
    { set: { id: "b", label: "API gateway service", detail: "charging the card now…", tone: "warn" }, status: { id: "b", to: "running" } },
    { set: { id: "b", detail: "paid ✓", tone: "good" }, status: { id: "b", to: "done" } },
    { set: { id: "b", tag: "edge" } },
  ])
  const b = S.nodes.find((n) => n.id === "b")!
  test("versions on the scene; the box fits every version and a glyph slot", () => {
    expect(b.labels).toEqual([["api"], ["API gateway service"]])
    expect(b.details).toEqual([{ lines: ["idle"] }, { lines: ["charging the card now…"], tone: "warn" }, { lines: ["paid ✓"], tone: "good" }])
    expect(b.tags).toEqual(["SERVICE", "EDGE"])
    expect(b.glyph).toBeDefined()
    expect(b.w).toBeGreaterThanOrEqual(textWidth("charging the card now…", 11) + 16)
  })
  test("the frame crossfades versions and drives the node's status glyph", () => {
    const tl = S.timeline!
    expect(tl.versions!["b@detail"].map((e) => e.v)).toEqual([1, 2])
    expect(tl.versions!["b@label"].map((e) => e.v)).toEqual([1])
    expect(tl.versions!["b@tag"].map((e) => e.v)).toEqual([1])
    const mid = storyState(S, tl, tl.steps[0].t0 + 0.5)
    expect(mid.status?.b?.s).toBe("running")
    expect(mid.status?.b?.spin).toBeDefined()
    const end = storyState(S, tl, tl.duration)
    expect(end.content?.["b@detail"]).toEqual([{ v: 2, o: 1 }])
    expect(end.status?.b?.s).toBe("done")
  })
  test("static SVG: final versions, detail tone, glyph; nothing resizes (box from the layout)", () => {
    const svg = renderSvg(S, { font: false })
    expect(svg).toContain(">paid ✓</text>")
    expect(svg).toMatch(/class="si-t-good" data-v="2"/)
    expect(svg).toContain("si-status si-status-done")
    expect(svg).toContain(`data-box="${b.x},${b.y},${b.w},${b.h}"`)
  })
  test("diagnostics: running at the end, rich nodes, pseudo states, sequences", () => {
    expect(diags([{ status: { id: "b", to: "running" } }])).toEqual([`warning: "b" is still running at the end: the static diagram shows a spinner (add "status": { "id": "b", "to": "done" })`])
    expect(diags([{ status: { id: "bb", to: "done" } }])[0]).toMatch(/did you mean "b"/)
    const chip = { nodes: [...base.nodes, { id: "k", kind: "chip", label: "k" }] }
    expect(diags([{ set: { id: "k", detail: "x" } }], chip)[0]).toMatch(/^error: set "detail" needs a panel row/)
    expect(diags([{ set: { id: "k", tone: "warn" } }], chip)[0]).toMatch(/^error: set "tone" colours a plain node's detail line/)
  })
  test("label-only, tag-only and tone-only sets keep the other fields", () => {
    const S2 = scene([{ set: { id: "b", tone: "risk" } }])
    expect(S2.nodes.find((n) => n.id === "b")!.details).toEqual([{ lines: ["idle"] }, { lines: ["idle"], tone: "risk" }])
  })
})

describe("A4 toned glow", () => {
  const S = scene([{ glow: { ids: "b", tone: "warn" } }, { glow: { ids: "b", tone: "good" } }, { unglow: "b" }])
  const tl = S.timeline!
  test("a toned window; a new tone takes over; unglow ends it", () => {
    expect(tl.lit!.b.map((w) => w.tone)).toEqual(["warn", "good"])
    expect(tl.lit!.b[0].t1).toBe(tl.steps[1].t0)
    const f = storyState(S, tl, tl.steps[0].t1)
    expect(f.litTone?.b?.warn).toBeGreaterThan(0.9)
    expect(f.lit).toBeUndefined()
    expect(storyState(S, tl, tl.duration).litTone).toBeUndefined()
  })
  test("HTML render uses the tone ink and the toned rim", () => {
    const svg = renderSvg(S, { font: false, t: tl.steps[0].t1 })
    expect(svg).toContain("si-lit si-lit-tone si-t-warn")
    expect(svg).toContain("var(--si-toneWarn)")
  })
  test("string / list forms unchanged; bad tone did-you-mean", () => {
    expect(diags([{ glow: { ids: "b", tone: "gold" } }, { unglow: "b" }])[0]).toMatch(/^error: unknown tone "gold"/)
    expect(diags([{ glow: "b" }, { unglow: "b" }])).toEqual([])
  })
})

describe("A5 caption emphasis", () => {
  test("parseEmphasis: ranges, escapes, unpaired", () => {
    expect(parseEmphasis("secrets go to processes, *never to the agent*")).toEqual({ text: "secrets go to processes, never to the agent", em: [[25, 43]] })
    expect(parseEmphasis("a \\* b *c*")).toEqual({ text: "a * b c", em: [[6, 7]] })
    expect(parseEmphasis("2 * 3")).toEqual({ text: "2 * 3", em: [] })
  })
  test("timeline captions and step labels carry plain text; frames carry the ranges", () => {
    const S = scene([{ caption: "a *b* c", pulse: "a->b" }])
    const tl = S.timeline!
    expect(tl.captions[0]).toMatchObject({ text: "a b c", em: [[2, 3]] })
    expect(tl.steps[0].label).toBe("a b c")
    expect(tl.steps[0].caption).toBe("a b c")
    const f = storyState(S, tl, tl.steps[0].t0 + 0.5)
    expect(f.captions[0].em).toEqual([[2, 3]])
  })
  test("viewer and animated SVG draw the phrase in the accent", () => {
    const S = scene([{ caption: "a *b* c", pulse: "a->b" }])
    const f = storyState(S, S.timeline, S.timeline!.steps[0].t0 + 1)
    const html = renderToStaticMarkup(createElement(Captions, { frame: f }))
    expect(html).toContain(`<span class="si-em si-t-note">b</span>`)
    expect(renderHtml(S, { viewer: false })).toContain(".si-em.si-t-note{fill:var(--si-toneNote)")
    const svg = animatedSvg(S).svg
    expect(svg).toContain(`<tspan class="si-em si-t-note">b</tspan>`)
    expect(svg).toMatch(/\.si-em\.si-t-note\{fill:#4a6a86/)
  })
  test("captions without * are untouched (no em key)", () => {
    const S = scene([{ caption: "plain words", pulse: "a->b" }])
    expect(S.timeline!.captions[0]).not.toHaveProperty("em")
  })
})

describe("animated SVG (SMIL) for tones", () => {
  const S = scene([
    { pulse: { edge: "a->b", tone: "warn", label: "job", tint: true, stain: true } },
    { set: { id: "b", detail: "busy", tone: "warn" }, status: { id: "b", to: "done" } },
  ])
  const svg = animatedSvg(S).svg
  test("tone layers animate opacity; pulses are toned; the label has x / y / opacity tracks", () => {
    expect(svg).toContain(`class="si-tone si-t-warn"`)
    expect(svg).toMatch(/<circle class="si-pulse si-t-warn"/)
    expect(svg).toMatch(/<text class="si-plabel si-t-warn"[^>]*>job<animate attributeName="opacity"/)
    expect(svg).toMatch(/\.si-t-warn \.si-win-head\{fill:#[0-9a-f]{6};stroke:#8a7426;\}/)
    expect(svg).not.toContain("var(--si-")
  })
  test("deterministic", () => {
    expect(animatedSvg(S).svg).toBe(svg)
  })
})

describe("example", () => {
  test("request-colours validates clean", () => {
    const f = path.join(import.meta.dir, "..", "examples", "stories", "request-colours.dataflow.json")
    expect(validate(fs.readFileSync(f, "utf8")).diagnostics).toEqual([])
  })
})
