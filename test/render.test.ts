import { describe, expect, test } from "bun:test"
import { renderHtml, renderSvg, StoryinkError } from "../src/core/render/index.tsx"

const spec = { type: "architecture", title: "A & <B>", subtitle: "s", nodes: [{ id: "a", label: "Alpha" }, { id: "b", kind: "database" }], edges: [{ from: "a", to: "b", label: "reads" }] }

describe("render", () => {
  test("svg is self-contained and themeable", () => {
    const svg = renderSvg(spec)
    expect(svg.startsWith("<?xml")).toBe(true)
    expect(svg).toContain("@font-face")
    expect(svg).toContain("prefers-color-scheme")
    expect(svg).toContain('data-si="node:a"')
    expect(svg).not.toMatch(/NaN|undefined|Infinity/)
    const dark = renderSvg(spec, { theme: "dark", font: false })
    expect(dark).not.toContain("prefers-color-scheme")
    expect(dark).not.toContain("@font-face")
  })

  test("html embeds data, viewer, font and escapes the title", () => {
    const html = renderHtml(spec)
    expect(html).toContain('<script type="application/json" id="storyink-data">')
    expect(html).toContain('id="storyink-viewer"')
    expect(html).toContain("<title>A &amp; &lt;B&gt;</title>")
    expect(html).toContain("Commit Mono")
    expect(html).toContain("MIT License")
    const data = /id="storyink-data">([\s\S]*?)<\/script>/.exec(html)![1]
    expect(JSON.parse(data).scene.title).toBe("A & <B>")
    expect(data).not.toContain("<B>")
  })

  test("invalid spec throws StoryinkError with diagnostics", () => {
    try {
      renderSvg({ type: "architecture", title: "x", nodes: [] })
      throw new Error("expected throw")
    } catch (e) {
      expect(e).toBeInstanceOf(StoryinkError)
      expect((e as StoryinkError).diagnostics.length).toBeGreaterThan(0)
    }
  })
})
