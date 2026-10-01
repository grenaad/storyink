import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { layout } from "../src/core/layout/index.ts"
import { renderSvg } from "../src/core/render/index.tsx"
import { validate, type Diagnostic } from "../src/core/validate.ts"
import { anchorPoint, boxOfRef, parseRef } from "../src/core/anchor.ts"
import { geometry as G } from "../src/theme/tokens.ts"
import type { GraphSpec, Spec } from "../src/core/spec.ts"

const next = path.join(import.meta.dir, "..", "examples")
const load = (f: string): Spec => {
  const v = validate(fs.readFileSync(path.join(next, f), "utf8"))
  if (!v.spec) throw new Error(`${f}: ${JSON.stringify(v.diagnostics)}`)
  return v.spec
}
const NEXT = ["code-mode.architecture.json", "retry-helper.architecture.json", "agent-session.architecture.json", "failover.dataflow.json"]
const codeMode = layout(load("code-mode.architecture.json"))
const edge = (id: string) => codeMode.edges.find((e) => e.id === id)!
const node = (id: string) => codeMode.nodes.find((n) => n.id === id)!
const port = (id: string) => codeMode.ports.find((p) => p.id === id)!

describe("0.4 examples", () => {
  test("all four validate cleanly (no errors, no warnings)", () => {
    for (const f of NEXT) {
      const v = validate(fs.readFileSync(path.join(next, f), "utf8"))
      expect({ f, d: v.diagnostics }).toEqual({ f, d: [] })
    }
  })

  test("layout is deterministic and finite", () => {
    for (const f of NEXT) {
      const a = JSON.stringify(layout(load(f)))
      expect(a).toBe(JSON.stringify(layout(load(f))))
      expect(a).not.toMatch(/NaN|Infinity|null/)
    }
  })
})

describe("anchors and straight wires (code mode)", () => {
  test("call1 is a 2-point horizontal wire from session#exec1 to code#1", () => {
    const e = edge("call1")
    expect(e.points.length).toBe(2)
    expect(e.points[0].y).toBe(e.points[1].y)
    expect(e.from).toBe("session")
    expect(e.to).toBe("code")
    expect(e.fromAnchor).toBe("exec1")
    expect(e.toAnchor).toBe("1")
    const s = node("session")
    const c = node("code")
    expect(e.points[0]).toEqual({ x: s.x + s.w, y: s.y + s.rows!.find((r) => r.id === "exec1")!.anchorY })
    expect(e.points[1]).toEqual({ x: c.x, y: c.y + c.code!.top + 0.5 * c.code!.lh })
  })

  test("gh / ln / se are 2-point horizontal wires to the chip face centres", () => {
    for (const [id, chip] of [["gh", "github"], ["ln", "linear"], ["se", "sentry"]] as const) {
      const e = edge(id)
      expect(e.points.length).toBe(2)
      expect(e.points[0].y).toBe(e.points[1].y)
      const n = node(chip)
      const face = n.h - (n.stack ?? 0) * G.stackStep
      expect(e.points[1].y).toBe(n.y + face / 2)
    }
  })

  test("the exec2 port sits at the row anchor", () => {
    const s = node("session")
    const r = s.rows!.find((x) => x.id === "exec2")!
    expect(port("call2:out").y).toBe(s.y + r.anchorY)
    expect(port("call2:out").anchor).toBe("exec2")
  })

  test("both call edges end at the same point (fan-in on code#1)", () => {
    const a = edge("call1").points.at(-1)
    const b = edge("call2").points.at(-1)
    expect(a).toEqual(b!)
    expect(port("call1:in")).toMatchObject(a!)
    expect(port("call2:in")).toMatchObject(b!)
  })

  test("chip face excludes the stack; chips in a parent share a width", () => {
    const se = node("sentry")
    expect(se.stack).toBe(2)
    expect(se.h).toBe(G.chipH + 2 * G.stackStep)
    expect(port("se:in").y).toBe(se.y + G.chipH / 2)
    expect(new Set(["github", "linear", "sentry"].map((id) => node(id).w)).size).toBe(1)
  })

  test("code sizing covers every version (program 2 is longer)", () => {
    const c = node("code").code!
    expect(c.versions.length).toBe(2)
    expect(c.slots).toBe(9)
    const spec = load("code-mode.architecture.json") as GraphSpec
    const story = spec.story as { steps: { set?: { code?: string[] } }[] }
    const all = [...(spec.nodes[1].code as string[]), ...story.steps.flatMap((s) => s.set?.code ?? [])]
    expect(c.cols).toBe(Math.max(...all.map((l) => l.length)))
    expect(c.versions[1].length).toBe(7)
  })

  test("bare group: label only, no rect; not an obstacle", () => {
    const svg = renderSvg(codeMode, { theme: "dark", font: false })
    const g = /<g class="si-grp" data-si="group:servers"[^>]*>([\s\S]*?)<\/g>/.exec(svg)![1]
    expect(g).not.toContain("<rect")
    expect(g).toContain("MCP SERVERS")
    expect(codeMode.groups[0].bare).toBe(true)
  })

  test("muted chips render at 0.42 and dim their wire", () => {
    const svg = renderSvg(codeMode, { theme: "dark", font: false })
    expect(svg).toMatch(/data-si="node:sentry"[^>]*style="opacity:0.42"/)
    expect(svg).toMatch(/data-si="edge:se" style="opacity:0.42"/)
    expect(svg).not.toMatch(/data-si="edge:gh" style=/)
  })

  test("code tokens render as classed tspans with explicit x", () => {
    const svg = renderSvg(codeMode, { theme: "light", font: false })
    expect(svg).toContain(`<tspan class="si-tk-kw" x="${node("code").code!.x}">return</tspan>`)
    expect(svg).toContain(".si-tk-fn{fill:var(--si-codeFn);}")
    expect(svg).toContain("--si-codeKw:#d73a49;")
  })

  test("anchor helpers", () => {
    expect(parseRef("session#exec1")).toEqual({ node: "session", anchor: "exec1" })
    expect(parseRef("code")).toEqual({ node: "code" })
    expect(anchorPoint(node("code"), "1", "left")).toEqual(edge("call1").points[1])
    expect(boxOfRef(codeMode, "code#9")).toBeDefined()
    expect(boxOfRef(codeMode, "code#10")).toBeUndefined()
    expect(boxOfRef(codeMode, "session#nope")).toBeUndefined()
  })
})

describe("failover", () => {
  test("client → router#req is straight; row ports are fixed at their anchors", () => {
    const sc = layout(load("failover.dataflow.json"))
    const e = sc.edges.find((x) => x.id === "in")!
    expect(e.points.length).toBe(2)
    const r = sc.nodes.find((n) => n.id === "router")!
    for (const [id, row] of [["to-a", "a"], ["to-b", "b"]]) {
      const p = sc.ports.find((x) => x.id === `${id}:out`)!
      expect(p).toMatchObject({ x: r.x + r.w, y: r.y + r.rows!.find((x) => x.id === row)!.anchorY })
    }
  })
})

describe("validation (rich nodes and anchors)", () => {
  const diag = (nodes: unknown[], edges: unknown[] = [], extra: object = {}): Diagnostic[] =>
    validate({ type: "architecture", title: "t", nodes, edges, ...extra }).diagnostics
  const msgs = (d: Diagnostic[]) => d.map((x) => `${x.severity}: ${x.message}`)

  test("row shape", () => {
    expect(msgs(diag([{ id: "p", kind: "panel", rows: [{ detail: "x" }] }]))).toContain(`error: row needs "text" (or "tag")`)
    expect(msgs(diag([{ id: "p", kind: "panel", rows: [{ id: "12", text: "x" }] }]))).toContain(`error: invalid row id "12"`)
    expect(msgs(diag([{ id: "p", kind: "panel", rows: [{ id: "a", text: "x" }, { id: "a", text: "y" }] }]))).toContain(`error: duplicate row id "a" in "p"`)
    expect(msgs(diag([{ id: "p", kind: "panel", rows: [{ text: "x", status: "ok" }] }]))).toContain(`error: unknown row status "ok"`)
    expect(msgs(diag([{ id: "p", kind: "panel", rows: [{ text: "x", indent: 5 }] }]))).toContain(`error: "indent" must be an integer from 0 to 4`)
    expect(msgs(diag([{ id: "s", rows: [{ text: "x" }] }]))).toContain(`warning: "rows" is only drawn on "panel" nodes`)
  })

  test("icons, code, lang, size, stack", () => {
    const d = diag([{ id: "c", kind: "chip", icon: "plugg" }])
    expect(msgs(d)).toContain(`error: unknown icon "plugg"`)
    expect(d[0].hint).toContain(`did you mean "plug"?`)
    expect(msgs(diag([{ id: "c", kind: "code", code: 3 }]))).toContain(`error: "code" must be a string or a list of lines`)
    expect(msgs(diag([{ id: "c", kind: "service", code: "x" }]))).toContain(`warning: "code" is only drawn on "code" nodes`)
    expect(msgs(diag([{ id: "c", kind: "code", code: "x", lang: "rust" }]))).toContain(`error: unknown code language "rust"`)
    expect(msgs(diag([{ id: "c", kind: "code", code: "x", size: { cols: 2 } }]))).toContain(`error: "size" must be { "cols": 8–160, "lines": 1–60 }`)
    expect(msgs(diag([{ id: "c", kind: "chip", stack: 5 }]))).toContain(`error: "stack" must be 1, 2 or 3`)
    expect(msgs(diag([{ id: "c", kind: "code", code: ["\tx", "y".repeat(131)] }]))).toEqual([`warning: tabs are shown as 2 spaces`, `warning: code line 2 is 131 characters; the panel grows to fit`])
    expect(msgs(diag([{ id: "p", kind: "panel", rows: [{ text: "🔧 fix" }] }]))).toContain(`warning: "🔧" is not monospace; use "icon": "wrench"`)
  })

  test("edge anchors", () => {
    const nodes = [
      { id: "p", kind: "panel", rows: [{ id: "r1", text: "x" }] },
      { id: "c", kind: "code", code: ["a", "b"] },
      { id: "api" },
    ]
    expect(msgs(diag(nodes, [{ from: "api#r1", to: "c" }]))).toContain(`error: "api#r1": anchors work on panel rows and code lines only`)
    const d = diag(nodes, [{ from: "p#r3", to: "c" }])
    expect(msgs(d)).toContain(`error: unknown row "r3" in "p"`)
    expect(d.find((x) => x.message.startsWith("unknown row"))!.hint).toBe("rows: r1")
    const l = diag(nodes, [{ from: "p#r1", to: "c#9" }])
    expect(msgs(l)).toContain(`error: "c#9": "c" has 2 lines`)
    expect(l.find((x) => x.message.includes("has 2 lines"))!.hint).toBe(`reserve more with "size": { "lines": 9 }`)
    expect(diag(nodes, [{ from: "p#r1", to: "c#2" }])).toEqual([])
    // Lines added by a story `set` count.
    expect(diag(nodes, [{ from: "p#r1", to: "c#3" }], { story: { steps: [{ set: { id: "c", code: ["1", "2", "3"] } }] } })).toEqual([])
  })

  test("new step and story keys are known", () => {
    const d = diag([{ id: "c", kind: "code", code: "x" }], [], {
      story: { spotlight: true, rewind: "glitch", steps: [{ type: "c", line: "c#1", dim: "c", undim: "c", hide: "c", show: "c", glow: "c", unglow: "c", focus: "c", clear: "c" }] },
    })
    expect(d.filter((x) => x.message.startsWith("unknown field"))).toEqual([])
  })

  test("pre-0.4 kinds are unaffected: plain nodes carry no rich fields", () => {
    const sc = layout(validate({ type: "architecture", title: "t", nodes: [{ id: "a" }] }).spec!)
    expect(Object.keys(sc.nodes[0]).sort()).toEqual(["accent", "detail", "h", "id", "kind", "label", "shape", "tag", "text", "w", "x", "y"])
  })
})
