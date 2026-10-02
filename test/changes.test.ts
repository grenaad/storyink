import { describe, expect, test } from "bun:test"
import { layout, renderAnimatedSvg, renderHtml, renderSvg, validate, type Spec } from "../src/core/index.ts"
import { loadSpec } from "../src/node/index.ts"

const graph = (extra: Record<string, unknown> = {}, nodes?: unknown[], edges?: unknown[]) => ({
  type: "architecture",
  title: "T",
  nodes: nodes ?? [
    { id: "a", delta: "added" },
    { id: "b", delta: "modified", stat: { add: 3, del: 1 } },
    { id: "c", delta: "removed" },
    { id: "d", delta: "unchanged" },
  ],
  edges: edges ?? [
    { from: "a", to: "b", delta: "added", emphasis: "hero" },
    { from: "b", to: "c", delta: "removed", label: "old" },
    { from: "d", to: "b" },
  ],
  ...extra,
})
const errs = (v: unknown) => validate(v).diagnostics.filter((d) => d.severity === "error")
const warns = (v: unknown) => validate(v).diagnostics.filter((d) => d.severity === "warning")
const example = (f: string) => {
  const l = loadSpec(`examples/changes/${f}`)
  if (!l.spec) throw new Error(f)
  return l.spec as Spec
}

describe("change diagrams: validation", () => {
  test("a valid change spec has no diagnostics", () => {
    const v = validate(graph({ change: { base: "main", head: "feat" }, style: { legend: true } }))
    expect(v.diagnostics).toEqual([])
    expect(v.ok).toBe(true)
  })

  test("enums: delta, emphasis with did-you-mean hints", () => {
    const e = errs(graph({}, [{ id: "a", delta: "add" }], [{ from: "a", to: "a", emphasis: "heroic" }]))
    expect(e.map((d) => d.path)).toEqual(["nodes[0].delta", "edges[0].emphasis"])
    expect(e[0].hint).toContain("added")
    expect(e[1].hint).toContain("hero")
    expect(errs(graph({}, [{ id: "a" }, { id: "g2" }], [])).length).toBe(0)
    expect(errs({ type: "architecture", title: "T", groups: [{ id: "g", delta: "gone" }], nodes: [{ id: "a", parent: "g" }] })[0].path).toBe("groups[0].delta")
  })

  test("files: paths, line numbers and ranges", () => {
    const e = errs(graph({}, [{ id: "a", files: ["", { path: "x.ts", lines: 0 }, { path: "y.ts", lines: [9, 3] }, { path: "z.ts", revision: "old" }, { lines: 3 }] }], []))
    expect(e.map((d) => d.path)).toEqual(["nodes[0].files[0]", "nodes[0].files[1].lines", "nodes[0].files[2].lines", "nodes[0].files[3].revision", "nodes[0].files[4].path"])
    expect(e[2].hint).toContain("[3, 9]")
    const ok = validate(graph({}, [{ id: "a", files: ["src/a.ts", { path: "src/b.ts", lines: [1, 4], revision: "base" }, { path: "c.ts", lines: 7 }] }], []))
    expect(ok.ok).toBe(true)
    const n = (ok.spec as { nodes: { files?: unknown }[] }).nodes[0]
    expect(n.files).toEqual(["src/a.ts", { path: "src/b.ts", lines: [1, 4], revision: "base" }, { path: "c.ts", lines: 7 }])
  })

  test("stat: negatives and fractions are errors", () => {
    const e = errs(graph({}, [{ id: "a", stat: { add: -2, del: 1.5 } }], []))
    expect(e.map((d) => d.path)).toEqual(["nodes[0].stat.add", "nodes[0].stat.del"])
    expect(e[0].message).toContain("negative")
  })

  test("consistency: removed endpoints, added edge to removed node, hero budget", () => {
    const w = warns(graph({}, undefined, [{ from: "a", to: "c" }]))
    expect(w.some((d) => d.path === "edges[0]" && d.message.includes("removed node"))).toBe(true)
    const e = errs(graph({}, undefined, [{ from: "a", to: "c", delta: "added" }]))
    expect(e[0].path).toBe("edges[0].delta")
    expect(e[0].hint).toContain("removed")
    const heroes = [{ from: "a", to: "b", emphasis: "hero" }, { from: "b", to: "a", emphasis: "hero" }, { from: "d", to: "a", emphasis: "hero" }]
    const hw = warns(graph({}, undefined, heroes))
    expect(hw.map((d) => d.path)).toContain("edges[2].emphasis")
    expect(warns(graph({}, undefined, heroes.slice(0, 2))).length).toBe(0)
    // Sequences: messages to a removed participant.
    const seq = {
      type: "sequence",
      title: "S",
      participants: [{ id: "a" }, { id: "b", delta: "removed" }],
      messages: [
        { from: "a", to: "b", delta: "removed" },
        { from: "a", to: "b" },
        { from: "a", to: "b", delta: "added" },
      ],
    }
    expect(warns(seq).map((d) => d.path)).toEqual(["messages[1]"])
    expect(errs(seq).map((d) => d.path)).toEqual(["messages[2].delta"])
  })

  test("change meta, style.legend, and later-phase keys are accepted", () => {
    expect(errs(graph({ change: "main" }))[0].path).toBe("change")
    expect(errs(graph({ change: { base: 3 } }))[0].path).toBe("change.base")
    expect(errs(graph({ style: { legend: "yes" } }))[0].path).toBe("style.legend")
    expect(warns(graph({ style: { legend: true } }, [{ id: "a" }], [])).map((d) => d.path)).toEqual(["style.legend"])
    const v = validate(graph({ changes: { files: [] } }, [{ id: "a", kind: "code", diff: "@@ -1 +1 @@\n-a\n+b" }], []))
    expect(v.diagnostics.filter((d) => d.message.includes("unknown field"))).toEqual([])
  })
})

describe("change diagrams: scene", () => {
  const scene = layout(validate(graph({ change: { base: "main", head: "feat" } })).spec!)

  test("node, edge and group change fields", () => {
    const by = new Map(scene.nodes.map((n) => [n.id, n]))
    expect(by.get("a")!.delta).toBe("added")
    expect(by.get("a")!.accent).toBe("sage")
    expect(by.get("b")!.stat).toEqual({ add: 3, del: 1 })
    expect(by.get("b")!.badge!.text).toBe("CHANGED")
    expect(by.get("b")!.badge!.stat).toMatchObject({ add: 3, del: 1 })
    expect(by.get("d")!.badge).toBeUndefined()
    const e = scene.edges.find((x) => x.from === "a")!
    expect(e.delta).toBe("added")
    expect(e.emphasis).toBe("hero")
    expect(scene.change).toEqual({ base: "main", head: "feat" })
  })

  test("badges sit inside their node box, for every shape", () => {
    const shapes = [
      { type: "workflow", kinds: ["start", "end", "step", "decision", "io", "note", "panel", "code", "chip"] },
      { type: "lifecycle", kinds: ["state", "choice", "initial", "final"] },
      { type: "architecture", kinds: ["service", "database", "queue", "user", "external", "cache"] },
    ]
    for (const s of shapes) {
      const nodes = s.kinds.map((k, i) => ({ id: `n${i}`, kind: k, label: `Node ${k}`, delta: (["added", "modified", "removed"] as const)[i % 3], stat: { add: 120, del: 7 }, ...(k === "code" ? { code: "x" } : k === "panel" ? { rows: [{ text: "row" }] } : {}) }))
      const sc = layout(validate({ type: s.type, title: "T", nodes }).spec!)
      for (const n of sc.nodes) {
        if (!n.badge) continue
        const b = n.badge
        const x = b.cx !== undefined ? b.cx - b.w / 2 : n.w - (b.right ?? 0) - b.w
        const statW = b.stat?.w ?? 0
        expect(x - (statW ? statW + 5 : 0)).toBeGreaterThanOrEqual(0)
        expect(x + b.w).toBeLessThanOrEqual(n.w)
        expect(b.y).toBeGreaterThanOrEqual(0)
        expect(b.y + b.h).toBeLessThanOrEqual(n.h)
      }
    }
  })

  test("legend: deltas present, in order; style.legend false hides it; plain specs have none", () => {
    expect(scene.legend!.items).toEqual(["added", "modified", "removed", "unchanged"])
    expect(scene.legend!.meta).toBe("main → feat")
    const plain = layout(validate(graph({}, [{ id: "a" }, { id: "b" }], [{ from: "a", to: "b" }])).spec!)
    expect(plain.legend).toBeUndefined()
    const off = layout(validate(graph({ style: { legend: false } })).spec!)
    expect(off.legend).toBeUndefined()
    expect(scene.viewBox.y).toBeLessThan(off.viewBox.y)
  })

  test("sequence participants and messages", () => {
    const sc = layout(example("auth-session-to-jwt.sequence.json"))
    expect(sc.nodes.find((n) => n.id === "signer")!.badge!.text).toBe("NEW")
    expect(sc.edges.find((e) => e.id === "lookup")!.delta).toBe("removed")
    expect(sc.edges.filter((e) => e.emphasis === "hero").map((e) => e.id)).toEqual(["cookie", "verify"])
  })
})

describe("change diagrams: render", () => {
  const spec = validate(graph({ change: { base: "main", head: "feat" } })).spec!

  test("static svg: badges, stat, strike, hero, legend, palette only when used", () => {
    const svg = renderSvg(spec, { theme: "light", font: false })
    expect(svg).toContain(">NEW</text>")
    expect(svg).toContain(">CHANGED</text>")
    expect(svg).toContain(">REMOVED</text>")
    expect(svg).toContain('class="si-stat-add">+3<')
    expect(svg).toContain("si-stat-del")
    expect((svg.match(/class="si-strike"/g) ?? []).length).toBe(2) // node label + edge label
    expect(svg).toContain("si-edge si-d-added si-hero")
    expect(svg).toContain('class="si-hero-glow"')
    expect(svg).toContain('data-si="legend"')
    expect(svg).toContain("main → feat")
    expect(svg).toContain("--si-deltaAdded:")
    expect(svg).toContain('class="si-dl" opacity="0.55"')
    expect(svg).toContain('class="si-dl" opacity="0.82"')
    const plain = renderSvg(validate(graph({}, [{ id: "a" }], [])).spec!, { theme: "light", font: false })
    expect(plain).not.toContain("delta")
    expect(plain).not.toContain("si-badge")
  })

  test("html carries the change palette and scene fields", () => {
    const html = renderHtml(spec)
    expect(html).toContain("--si-deltaRemoved:")
    expect(html).toContain('"delta":"removed"')
    expect(renderHtml(validate(graph({}, [{ id: "a" }], [])).spec!)).not.toContain("--si-delta")
  })

  test("delta looks compose with story levels (dim multiplies the ghost level)", () => {
    const s = validate(graph({ story: { steps: [{ dim: "c" }] } })).spec!
    const svg = renderSvg(s, { theme: "light", font: false })
    expect(svg).toMatch(/data-si="node:c"[^>]*style="opacity:0.42"/)
    expect(svg).toContain('class="si-dl" opacity="0.55"')
  })
})

/** As in smil.test.ts: strip SMIL children and the animation-only overlay. */
function base(svg: string): string {
  return svg
    .replace(/<style>[\s\S]*?<\/style>/, "")
    .replace(/<svg[^>]*>/, "<svg>")
    .replace(/<g class="si-head">[\s\S]*<\/svg>/, "</svg>")
    .replace(/<(animate|animateTransform|set)\b[^>]*>(<\/\1>)?/g, "")
    .replace(/<g class="si-x"[^>]*>[\s\S]*?<\/radialGradient>(<rect[^>]*><\/rect>)+<\/g>/g, "")
    .replace(/<text class="si-counter si-x"[\s\S]*?<\/text>/g, "")
    .replace(/ opacity="([0-9.]+)"/g, ' style="opacity:$1"')
}

describe("change diagrams: animated svg", () => {
  const files = ["batch-email.dataflow.json", "auth-session-to-jwt.sequence.json", "rate-limit-plugin.architecture.json"]

  test("self-contained and pinned (no custom properties)", () => {
    for (const f of files) {
      const s = renderAnimatedSvg(example(f), { theme: "dark" })
      expect(s).not.toMatch(/var\(--/)
      expect(s).toContain(">REMOVED</text>")
      expect(s).toContain('data-si="legend"')
    }
  })

  test("base attributes are the final frame (static diagram), deltas included", () => {
    for (const f of files) {
      const a = base(renderAnimatedSvg(example(f), { theme: "light" }))
      const b = base(renderSvg(example(f), { theme: "light" }).replace(/<\/svg>/, '<g class="si-head"></g></svg>'))
      expect(a.replace(/ class="si-x"/g, "")).toContain('data-si="legend"')
      // Union mode adds never-shown extras (si-x); every static element is present with the same attributes.
      const strip = (s: string) => s.replace(/<g class="[^"]*si-x[^"]*"[\s\S]*?<\/g>/g, "")
      expect(strip(a).length).toBeGreaterThan(0)
      for (const el of b.match(/<(?:rect|text|line|path) [^>]*>/g) ?? []) expect(a).toContain(el)
    }
  })

  test("removed edges keep their dash through a draw (no dasharray override)", () => {
    const s = renderAnimatedSvg(example("auth-session-to-jwt.sequence.json"), { theme: "light" })
    const create = /data-si="edge:create"[\s\S]*?<\/g>/.exec(s)![0]
    expect(create).not.toContain('attributeName="stroke-dasharray"')
  })
})
