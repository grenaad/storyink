import { describe, expect, test } from "bun:test"
import { citeSegments, layout, narrateCaption, parseFileRef, parseHash, renderAnimatedSvg, renderHtml, resolveCite, validate, type Spec } from "../src/core/index.ts"
import { railIndex } from "../src/core/render/Narration.tsx"
import { drawerIdForSi, drawerInfo, hasDrawer } from "../src/core/render/Drawer.tsx"

const spec = (steps: unknown[], extra: Record<string, unknown> = {}) => ({
  type: "dataflow",
  title: "N",
  nodes: [
    { id: "a", label: "Alpha", delta: "added", summary: "New source", files: ["src/a.ts"] },
    { id: "b", label: "Beta" },
  ],
  edges: [{ from: "a", to: "b", label: "rows" }],
  story: { steps },
  ...extra,
})
const errs = (v: unknown) => validate(v).diagnostics.filter((d) => d.severity === "error")
const narrated = [
  { reveal: "a", narrate: { heading: "Alpha arrives", body: "Alpha feeds Beta via src/a.ts now.", cites: [{ text: "Alpha", ref: "a" }, { text: "src/a.ts", ref: "src/a.ts#L3-9" }] } },
  { pulse: "a->b", stop: "Flow", narrate: { body: "Rows flow on. Then more." } },
]

describe("narrate: validation", () => {
  test("valid narration has no errors", () => {
    expect(errs(spec(narrated))).toEqual([])
  })
  test("shape errors carry JSON paths", () => {
    const e = errs(spec([{ narrate: { heading: 1 } }]))
    expect(e.map((d) => d.path)).toEqual(["story.steps[0].narrate.heading", "story.steps[0].narrate.body"])
    expect(errs(spec([{ narrate: "x" }]))[0].path).toBe("story.steps[0].narrate")
  })
  test("cite text must occur in the body, in order", () => {
    const missing = errs(spec([{ narrate: { body: "one two", cites: [{ text: "three", ref: "a" }] } }]))
    expect(missing[0].path).toBe("story.steps[0].narrate.cites[0].text")
    const order = errs(spec([{ narrate: { body: "one two", cites: [{ text: "two", ref: "a" }, { text: "one", ref: "b" }] } }]))
    expect(order[0].message).toContain("out of order")
  })
  test("cite refs resolve to an element or look like a path", () => {
    const e = errs(spec([{ narrate: { body: "see it", cites: [{ text: "it", ref: "nope" }] } }]))
    expect(e[0].path).toBe("story.steps[0].narrate.cites[0].ref")
    expect(errs(spec([{ narrate: { body: "see it", cites: [{ text: "it", ref: "a->b" }] } }]))).toEqual([])
  })
})

describe("narrate: compile", () => {
  test("a narrated step without a caption captions with its heading, else its first sentence", () => {
    const tl = layout(validate(spec(narrated)).spec!).timeline!
    expect(tl.steps[0].caption).toBe("Alpha arrives")
    expect(tl.steps[1].caption).toBe("Rows flow on.")
    expect(tl.steps[0].narrate?.body).toContain("Alpha")
    expect(tl.captions.map((c) => c.text)).toEqual(["Alpha arrives", "Rows flow on."])
    expect(narrateCaption({ body: "No stop here" })).toBe("No stop here")
  })
  test("an explicit caption wins; the animated SVG shows the fallback captions", () => {
    const tl = layout(validate(spec([{ ...narrated[0], caption: "Own" }])).spec!).timeline!
    expect(tl.steps[0].caption).toBe("Own")
    const svg = renderAnimatedSvg(spec(narrated))
    expect(svg).toContain("Alpha arrives")
  })
  test("railIndex follows beats, first before the story starts", () => {
    const tl = layout(validate(spec(narrated)).spec!).timeline!
    expect(railIndex(tl, -1)).toBe(0)
    expect(railIndex(tl, 0)).toBe(0)
    expect(railIndex(tl, 99)).toBe(1)
  })
})

describe("narrate: helpers", () => {
  test("cite segments and refs", () => {
    expect(citeSegments("a b c", [{ text: "b", ref: "x" }]).map((s) => s.text)).toEqual(["a ", "b", " c"])
    expect(parseFileRef("src/x.ts#L12-20")).toEqual({ path: "src/x.ts", lines: [12, 20] })
    expect(parseFileRef("src/x.ts#L7")).toEqual({ path: "src/x.ts", lines: 7 })
    const scene = layout(validate(spec(narrated)).spec!)
    expect(resolveCite(scene, "a")).toEqual({ kind: "element", id: "a", si: ["node:a"] })
    expect(resolveCite(scene, "README.md")?.kind).toBe("file")
    expect(resolveCite(scene, "zzz")).toBeUndefined()
  })
  test("parseHash drawer / rail", () => {
    expect(parseHash("#drawer=a%23b&rail=0")).toMatchObject({ drawer: "a#b", rail: false })
    expect(parseHash("#theme=dark").drawer).toBeUndefined()
  })
})

describe("viewer markup", () => {
  test("rail markup and CSS only when narrated", () => {
    const html = renderHtml(spec(narrated))
    // The rail itself is client-only (no SSR layout jump); the stage wrapper and CSS are served.
    expect(html.includes('class="si-main"')).toBe(true)
    expect(html.includes('class="si-rail"')).toBe(false)
    expect(html.includes(".si-rail{")).toBe(true)
    expect(html.includes('"narrate"')).toBe(true)
    const bare = { type: "dataflow", title: "N", nodes: [{ id: "a" }, { id: "b" }], edges: [{ from: "a", to: "b" }], story: { steps: [{ reveal: "a", caption: "x" }] } }
    const plain = renderHtml(bare)
    expect(plain.includes(".si-rail{") || plain.includes('class="si-main"')).toBe(false)
  })
  test("drawer CSS only when an element has drawer content", () => {
    expect(renderHtml(spec([{ reveal: "a" }])).includes(".si-drawer{")).toBe(true)
    const bare = { type: "dataflow", title: "N", nodes: [{ id: "a" }, { id: "b" }], edges: [{ from: "a", to: "b" }] }
    expect(renderHtml(bare).includes(".si-drawer{")).toBe(false)
  })
  test("drawer info and element mapping", () => {
    const scene = layout(validate(spec(narrated)).spec!)
    expect(hasDrawer(scene)).toBe(true)
    expect(drawerInfo(scene, "a")).toMatchObject({ kind: "node", label: "Alpha", delta: "added", summary: "New source", files: [{ path: "src/a.ts" }] })
    expect(drawerInfo(scene, "b")).toBeUndefined()
    expect(drawerIdForSi(scene, "row:a#r1")).toBe("a")
    const e = scene.edges[0]
    expect(drawerIdForSi(scene, `label:${e.label!.id}`)).toBe(e.id)
  })
  test("embedded changes ride on the scene only when present", () => {
    const changes = { files: [{ path: "src/a.ts", status: "added", add: 1, del: 0, hunks: [{ header: "@@ -0,0 +1 @@", oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: [{ kind: "add", text: "export const a = 1", new: 1 }] }] }] }
    expect(layout(validate(spec(narrated, { changes })).spec!).changes?.files.length).toBe(1)
    expect("changes" in layout(validate(spec(narrated)).spec!)).toBe(false)
  })
})
