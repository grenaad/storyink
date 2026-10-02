import { describe, expect, test } from "bun:test"
import { layout, renderAnimatedSvg, renderSvg, storyState, validate } from "../src/core/index.ts"
import { diffGeom } from "../src/core/layout/diffnode.ts"
import { boxOfRef } from "../src/core/anchor.ts"

const DIFF = `@@ -10,4 +10,6 @@ async function pay()
 const res = await charge(card)
-if (!res.ok) throw new Error(res.code)
+if (!res.ok) {
+  return retry(() => charge(card))
+}
 return res
@@ -30,2 +32,2 @@
-log("paid")
+log("paid", res.id)`

const spec = (extra: Record<string, unknown> = {}, node: Record<string, unknown> = {}) => ({
  type: "architecture",
  title: "T",
  nodes: [{ id: "svc" }, { id: "d", kind: "code", label: "pay.ts", diff: DIFF, ...node }, { id: "db", kind: "database" }],
  edges: [{ from: "svc", to: "d", style: "dashed", arrow: "none" }, { from: "d#+12", to: "db" }],
  ...extra,
})
const diag = (v: unknown) => validate(v).diagnostics
const errs = (v: unknown) => diag(v).filter((d) => d.severity === "error")

describe("diff code nodes: validation", () => {
  test("valid inline diff, anchors and apply", () => {
    expect(diag(spec({ story: { steps: [{ apply: "d" }, { line: "d#+12" }, { line: { id: "d", hunk: 2 } }] } }))).toEqual([])
  })
  test("diff shapes", () => {
    expect(errs(spec({}, { kind: "service" }))[0]).toMatchObject({ path: "nodes[1].diff" })
    expect(errs(spec({}, { diff: "@@ -1 +1 @@" })).find((d) => d.path === "nodes[1].diff")!.message).toContain("no diff lines")
    const unresolved = errs(spec({}, { diff: { file: "src/pay.ts", lines: [10, 20] } }))
    expect(unresolved[0].path).toBe("nodes[1].diff")
    expect(unresolved[0].message).toContain("--changes")
    expect(unresolved[0].hint).toContain("storyink diff")
    expect(errs(spec({}, { diff: { file: "x.ts", context: 50, hunks: [] } }))[0].path).toBe("nodes[1].diff.context")
    expect(errs(spec({}, { diff: { file: "x.ts", max: 1, hunks: [] } }))[0].path).toBe("nodes[1].diff.max")
    expect(errs(spec({}, { diff: { file: "x.ts", lines: [9, 3], hunks: [] } }))[0].path).toBe("nodes[1].diff.lines")
    expect(diag(spec({}, { code: "x" })).some((d) => d.severity === "warning" && d.path === "nodes[1].code")).toBe(true)
  })
  test("anchors: head / base lines must be shown", () => {
    const e = errs({ ...spec(), edges: [{ from: "d#+99", to: "db" }] })
    expect(e[0].message).toContain("no head line 99")
    expect(errs({ ...spec(), edges: [{ from: "d#-11", to: "db" }] })).toEqual([])
    expect(errs({ ...spec(), edges: [{ from: "d#+11", to: "db" }] })).toEqual([])
  })
  test("apply and content steps", () => {
    const steps = (s: unknown[]) => errs(spec({ story: { steps: s } }))
    expect(steps([{ apply: "svc" }])[0].message).toContain("diff code node")
    expect(steps([{ apply: { id: "d", hunk: 3 } }])[0].hint).toContain("1–2")
    expect(steps([{ apply: { id: "d", cps: -1 } }])[0].path).toBe("story.steps[0].apply")
    expect(steps([{ type: "d" }])[0].message).toContain("diff code node")
    expect(steps([{ set: { id: "d", code: "x" } }])[0].message).toContain("diff code node")
    expect(steps([{ clear: "d" }])[0].message).toContain("diff code node")
    expect(steps([{ line: "d#-99" }])[0].message).toContain("no base line 99")
    expect(steps([{ line: { id: "d", hunk: 5 } }])[0].message).toContain("no hunk 5")
    const w = diag(spec({ story: { steps: [{ apply: { id: "d", hunk: 1 } }, { apply: { id: "d", hunk: 1 } }] } }))
    expect(w.some((d) => d.severity === "warning" && d.message.includes("already applied"))).toBe(true)
  })
})

describe("diff code nodes: layout and anchors", () => {
  const sc = layout(validate(spec()).spec!)
  const n = sc.nodes.find((x) => x.id === "d")!
  test("rows, gutter, size for the full diff", () => {
    const d = n.diff!
    expect(d.rows.map((r) => r.kind)).toEqual(["hunk", "context", "del", "add", "add", "add", "context", "hunk", "del", "add"])
    expect(d.hunks).toBe(2)
    expect(d.oldX).toBeLessThan(d.newX)
    expect(d.codeX).toBeGreaterThan(d.markX)
    expect(n.h).toBeGreaterThanOrEqual(d.top + d.rows.length * d.lh)
    expect(n.code!.versions[0].length).toBe(d.rows.length)
  })
  test("+N / -N anchors resolve to their row", () => {
    const b = boxOfRef(sc, "d#+12")!
    expect(b.y).toBe(n.y + n.diff!.top + 4 * n.diff!.lh)
    expect(boxOfRef(sc, "d#-11")!.y).toBe(n.y + n.diff!.top + 2 * n.diff!.lh)
    const e = sc.edges.find((x) => x.from === "d")!
    expect(e.fromAnchor).toBe("+12")
  })
  test("line steps: signed lines and hunks become display rows", () => {
    const s = layout(validate(spec({ story: { steps: [{ line: "d#+12" }, { line: { id: "d", hunk: 2 } }] } })).spec!)
    expect(s.timeline!.bars!.d.map((b) => [b.a, b.b])).toEqual([[5, 5], [9, 10]])
  })
})

describe("diff code nodes: apply", () => {
  const sc = layout(validate(spec({ story: { steps: [{ at: 1, apply: { id: "d", hunk: 1 } }, { apply: { id: "d", hunk: 2 } }] } })).spec!)
  const tl = sc.timeline!
  const n = sc.nodes.find((x) => x.id === "d")!
  test("timeline windows per hunk", () => {
    expect(tl.applies!.d.map((a) => a.hunks)).toEqual([[0], [1]])
    expect(tl.applies!.d[1].t0).toBeGreaterThanOrEqual(tl.applies!.d[0].t1 - 0.001)
  })
  test("storyState: base before, progress during, omitted after", () => {
    expect(storyState(sc, tl, 0.5).diff!.d).toEqual([0, 0])
    const a = tl.applies!.d[0]
    const mid = storyState(sc, tl, (a.t0 + a.t1) / 2).diff!.d
    expect(mid[0]).toBeCloseTo(0.5, 2)
    expect(mid[1]).toBe(0)
    expect(storyState(sc, tl, tl.duration).diff).toBeUndefined()
    expect(storyState(sc, tl, a.t0 + 0.01, { reduced: true }).diff!.d[0]).toBe(0)
    expect(storyState(sc, tl, a.t1, { reduced: true }).diff!.d[0]).toBe(1)
  })
  test("geometry: base hides added rows and slides rows up; applied = static", () => {
    const g0 = diffGeom(n.diff!, [0, 0])
    const g1 = diffGeom(n.diff!)
    const adds = n.diff!.rows.map((r, k) => (r.kind === "add" ? k : -1)).filter((k) => k >= 0)
    for (const k of adds) expect(g0[k].h).toBe(0)
    expect(g0[6].y).toBe(g1[6].y - 3 * n.diff!.lh)
    expect(g0[2].tint).toBe(0)
    expect(g1[2].tint).toBe(1)
    expect(g1.every((l) => l.chars === undefined && l.h === n.diff!.lh)).toBe(true)
    expect(diffGeom(n.diff!, [1, 1])).toEqual(g1)
    const typing = diffGeom(n.diff!, [0.7, 0])
    expect(typing[3].chars).toBeUndefined()
    expect(typing[4].chars).toBeGreaterThan(0)
  })
  test("render: static = diff; t=0 = base version; animated SVG has apply tracks", () => {
    const sp = validate(spec({ story: { steps: [{ at: 1, apply: { id: "d", hunk: 1 } }, { apply: { id: "d", hunk: 2 } }] } })).spec!
    const end = renderSvg(sp, { theme: "light", font: false })
    expect(end).toContain('class="si-diff-bg-add"')
    expect(end).toContain('class="si-diff-bg-del"')
    expect(end).toContain('class="si-diff-hunk"')
    expect(end).toContain("si-diff-mk-add")
    expect(end).toContain('class="si-diff-num"')
    expect(end).toContain("--si-diffAddBg:")
    const t0 = renderSvg(sp, { theme: "light", font: false, t: 0.5 })
    expect(t0).not.toContain("si-drow-add")
    const anim = renderAnimatedSvg(sp, { theme: "dark" })
    expect(anim).not.toMatch(/var\(--/)
    expect(anim).toMatch(/clipPath id="si-clip--diff-d-3"><rect[^>]*><animate attributeName="width"/)
    expect(anim).toMatch(/si-drow si-drow-context" transform="[^"]*"><animateTransform/)
  })
  test("no apply: the diff shows from the start", () => {
    const s = layout(validate(spec({ story: { steps: [{ at: 0.3, caption: "x" }] } })).spec!)
    expect(storyState(s, s.timeline, 0).diff).toBeUndefined()
  })
})
