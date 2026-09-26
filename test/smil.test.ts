import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import { animatedSvg, renderAnimatedSvg, renderSvg, simplify, simplifyError } from "../src/core/index.ts"
import { loadSpec } from "../src/node/index.ts"

const spec = (f: string) => {
  const l = loadSpec(`examples/${f}`)
  if (!l.spec) throw new Error(f)
  return l.spec
}
const stories = ["checkout.architecture.json", "oauth.sequence.json"]

/** Strip SMIL children, the animation-only overlay (header, pulses, captions) and helper copies. */
function base(svg: string): string {
  return svg
    .replace(/<style>[\s\S]*?<\/style>/, "")
    .replace(/<svg[^>]*>/, "<svg>")
    .replace(/<g class="si-head">[\s\S]*<\/svg>/, "</svg>")
    .replace(/<(animate|animateTransform|set)\b[^>]*>(<\/\1>)?/g, "")
    .replace(/<g class="si-x"[^>]*>[\s\S]*?<\/radialGradient>(<rect[^>]*><\/rect>)+<\/g>/g, "")
    .replace(/<text class="si-counter si-x"[\s\S]*?<\/text>/g, "")
}

describe("animated svg (SMIL)", () => {
  test("deterministic: same input, same bytes", () => {
    for (const f of stories) for (const theme of ["light", "dark"] as const) expect(renderAnimatedSvg(spec(f), { theme })).toBe(renderAnimatedSvg(spec(f), { theme }))
  })

  test("self-contained: no script, foreignObject, external refs, custom properties or media queries", () => {
    for (const f of stories)
      for (const font of ["system", "embed"] as const) {
        const s = renderAnimatedSvg(spec(f), { font })
        expect(s).not.toMatch(/<script/i)
        expect(s).not.toMatch(/foreignObject/i)
        expect(s).not.toMatch(/var\(--/)
        expect(s).not.toMatch(/--si-/)
        expect(s).not.toMatch(/@import|@media|prefers-/)
        expect(s).not.toMatch(/(?:href|src)="(?!#)/)
        expect(s).not.toMatch(/url\((?!#|data:)/)
        expect(s).not.toMatch(/color-mix|calc\(/)
      }
  })

  test("base attributes are the final frame (static diagram)", () => {
    for (const f of stories) {
      const a = base(renderAnimatedSvg(spec(f), { theme: "light" }))
      const b = base(renderSvg(spec(f), { theme: "light" }).replace(/<\/svg>/, '<g class="si-head"></g></svg>'))
      expect(a).toBe(b)
    }
  })

  test("loop: every linear track returns to its first value; once: frozen, no repeat", () => {
    const loop = renderAnimatedSvg(spec("checkout.architecture.json"))
    const lin = [...loop.matchAll(/<animate[^>]*calcMode="linear"[^>]*>/g)].map((m) => m[0])
    expect(lin.length).toBeGreaterThan(50)
    for (const a of lin) {
      const v = /values="([^"]*)"/.exec(a)![1].split(";")
      const k = /keyTimes="([^"]*)"/.exec(a)![1].split(";")
      expect(v.length).toBe(k.length)
      expect(k[0]).toBe("0")
      expect(k[k.length - 1]).toBe("1")
      expect(v[v.length - 1]).toBe(v[0])
      for (let i = 1; i < k.length; i++) expect(Number(k[i])).toBeGreaterThan(Number(k[i - 1]))
      expect(a).toContain('repeatCount="indefinite"')
    }
    const durs = new Set([...loop.matchAll(/ dur="([^"]+)"/g)].map((m) => m[1]))
    expect(durs.size).toBe(1)
    const once = renderAnimatedSvg(spec("checkout.architecture.json"), { once: true })
    expect(once).not.toContain("repeatCount")
    expect(once).toContain('fill="freeze"')
  })

  test("keyframe compression stays within tolerance", () => {
    const ts = Array.from({ length: 601 }, (_, i) => i / 60)
    const vs = ts.map((t) => [Math.sin(t) * 40, t < 4 ? 0 : 1 - Math.exp(-(t - 4) * 3)])
    for (const tol of [0.01, 0.3, 1]) {
      const kept = simplify(ts, vs, tol)
      expect(simplifyError(ts, vs, kept)).toBeLessThanOrEqual(tol + 1e-9)
      if (tol >= 0.3) expect(kept.length).toBeLessThan(ts.length / 3)
      expect(kept[0]).toBe(0)
      expect(kept[kept.length - 1]).toBe(ts.length - 1)
    }
  })

  test("a spec without a story uses the auto story", () => {
    const r = animatedSvg(spec("release.workflow.json"))
    expect(r.autoStory).toBe(true)
    expect(r.animations).toBeGreaterThan(0)
  })

  test("sizes: lean without the font, bounded with it", () => {
    for (const f of stories) {
      const sys = animatedSvg(spec(f), { font: "system" }).bytes
      const emb = animatedSvg(spec(f), { font: "embed" }).bytes
      expect(sys).toBeLessThan(250 * 1024)
      expect(emb).toBeLessThan(1024 * 1024)
      expect(emb - sys).toBeGreaterThan(100 * 1024)
    }
    expect(fs.existsSync("fonts/OFL.txt")).toBe(true)
  })
})
