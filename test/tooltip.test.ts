import { describe, expect, test } from "bun:test"
import { renderAnimatedSvg, renderHtml, renderSvg } from "../src/core/index.ts"

const spec = {
  type: "architecture",
  title: "Openwick Architecture",
  nodes: [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }],
  edges: [{ from: "a", to: "b", label: "reads" }],
  story: "auto",
}
/** Every <svg …>…</svg> in a document. */
const svgs = (s: string) => [...s.matchAll(/<svg[\s>][\s\S]*?<\/svg>/g)].map((m) => m[0])

describe("no hover tooltip on the diagram", () => {
  test("viewer HTML: no SVG <title>, no title attributes in the diagram; accessible name kept", () => {
    const html = renderHtml(spec)
    const diagram = svgs(html).filter((x) => x.includes('class="storyink'))
    expect(diagram.length).toBeGreaterThan(0)
    for (const d of diagram) {
      expect(d).not.toMatch(/<title[\s>]/)
      expect(d).not.toMatch(/\stitle="/)
      expect(d).toContain('role="img"')
      expect(d).toContain('aria-label="Openwick Architecture"')
    }
    // The page itself keeps its document title (the browser tab, not a tooltip).
    expect(html).toContain("<title>Openwick Architecture</title>")
  })
  test("static and animated SVG: aria-label on the root, no <title>", () => {
    for (const svg of [renderSvg(spec), renderAnimatedSvg(spec)]) {
      expect(svg).not.toMatch(/<title[\s>]/)
      expect(svg).toMatch(/<svg[^>]*role="img"[^>]*aria-label="Openwick Architecture"/)
    }
  })
})
