import { describe, expect, test } from "bun:test"
import { parseHash, renderSvg, toScene } from "../src/core/index.ts"
import { figureHash, figurePrefix } from "../src/core/render/App.tsx"
import { renderFigure } from "../src/core/render/figure.tsx"
import { loadSpec } from "../src/node/index.ts"

const spec = (f: string) => loadSpec(f).spec
const ids = (html: string) => [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])
const refs = (html: string) => [...html.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1])

describe("idPrefix", () => {
  const files = ["examples/code-mode.architecture.json", "examples/changes/payment-retry.architecture.json", "examples/agent-session.architecture.json"]
  test("default output is unchanged", () => {
    for (const f of files) expect(renderSvg(spec(f), { idPrefix: "" })).toBe(renderSvg(spec(f)))
  })
  test("every id and url(#…) reference carries the prefix", () => {
    for (const f of files) {
      const sc = toScene(spec(f))
      const svg = renderSvg(sc, { idPrefix: "p1-", t: +((sc.timeline?.duration ?? 0) * 0.4).toFixed(2) })
      const all = ids(svg)
      expect(all.length).toBeGreaterThan(0)
      for (const id of all) expect(id.includes("p1-")).toBe(true)
      for (const r of refs(svg)) expect(all).toContain(r)
    }
  })
  test("two figures in one document have no duplicate ids", () => {
    const sc = toScene(spec("examples/code-mode.architecture.json"))
    const html = renderFigure(sc, { id: "a" }).html + renderFigure(sc, { id: "b" }).html
    const all = ids(html)
    expect(all.length).toBeGreaterThan(0)
    expect(new Set(all).size).toBe(all.length)
    expect(figurePrefix("x y")).toBe("f-x_y-")
  })
})

describe("embedded figure markup", () => {
  test("renderFigure: embedded App, no page header, focusable root, aspect stage", () => {
    const html = renderFigure(toScene(spec("examples/checkout.architecture.json")), { id: "fig-1" }).html
    expect(html).toContain('data-si-app="fig-1"')
    expect(html).toContain("si-embedded")
    expect(html).toContain('tabindex="0"')
    expect(html).toContain("cqw")
    expect(html).toContain("si-canvas-fluid")
    expect(html).toContain('class="si-captions"')
    expect(html.includes('class="si-head"')).toBe(false)
    expect(html.includes('aria-label="Toggle theme"')).toBe(false)
    expect(html).toContain('aria-label="Expand"')
  })
})

describe("page hash", () => {
  test("parseHash fig / solo", () => {
    expect(parseHash("#fig=a&solo=1&t=3")).toMatchObject({ fig: "a", solo: true, t: "3" })
    expect(parseHash("#t=3").fig).toBeUndefined()
  })
  test("figureHash scopes params to the named figure", () => {
    expect(figureHash("#fig=a&t=3&theme=dark", "a")).toMatchObject({ t: "3", theme: "dark", chrome: true })
    expect(figureHash("#fig=a&t=3&theme=dark", "b")).toEqual({ chrome: true, theme: "dark" })
    expect(figureHash("#sec-2", "a")).toEqual({ chrome: true })
    expect(figureHash("#static=1", "a")).toEqual({ chrome: true, still: true })
  })
})
