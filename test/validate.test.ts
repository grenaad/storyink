import { describe, expect, test } from "bun:test"
import { validate } from "../src/core/validate.ts"

const ok = { type: "architecture", title: "T", nodes: [{ id: "a" }, { id: "b", kind: "database" }], edges: [{ from: "a", to: "b" }] }

describe("validate", () => {
  test("accepts a minimal spec and fills defaults", () => {
    const r = validate(ok)
    expect(r.ok).toBe(true)
    const s = r.spec as any
    expect(s.direction).toBeUndefined() // auto-picked at layout time
    expect(s.nodes[0]).toMatchObject({ id: "a", label: "a", kind: "service" })
    expect(s.edges[0].id).toBe("a->b")
  })

  test("never throws on garbage", () => {
    for (const bad of [null, 42, "not json", "[]", [], { type: 3 }, { type: "sequence" }, { type: "workflow", title: "x", nodes: "no" }]) {
      const r = validate(bad)
      expect(r.ok).toBe(false)
      expect(r.diagnostics.length).toBeGreaterThan(0)
    }
  })

  test("reports unknown ids, duplicates, kinds with paths and hints", () => {
    const r = validate({
      type: "workflow",
      title: "x",
      nodes: [{ id: "a", kind: "stpe" }, { id: "a" }, { id: "c", parent: "nope" }],
      edges: [{ from: "a", to: "zz" }],
    })
    expect(r.ok).toBe(false)
    const by = (p: string) => r.diagnostics.find((d) => d.path === p)
    expect(by("nodes[0].kind")?.hint).toContain('"step"')
    expect(by("nodes[1]")?.message).toContain("duplicate")
    expect(by("nodes[2].parent")?.message).toContain("unknown parent")
    expect(by("edges[0].to")?.message).toContain('unknown node "zz"')
  })

  test("detects nesting cycles", () => {
    const r = validate({ type: "architecture", title: "x", groups: [{ id: "g1", parent: "g2" }, { id: "g2", parent: "g1" }], nodes: [{ id: "a", parent: "g1" }] })
    expect(r.diagnostics.some((d) => d.message.includes("nesting cycle"))).toBe(true)
  })

  test("style.arrowheads is validated", () => {
    expect((validate({ ...ok, style: { arrowheads: true } }).spec as any).style).toEqual({ arrowheads: true })
    const bad = validate({ ...ok, style: { arrowheads: "yes" } })
    expect(bad.ok).toBe(false)
    expect(bad.diagnostics[0].path).toBe("style.arrowheads")
  })

  test("directions: BT/RL accepted, unknown rejected", () => {
    expect((validate({ ...ok, direction: "rl" }).spec as any).direction).toBe("RL")
    expect(validate({ ...ok, direction: "up" }).ok).toBe(false)
  })

  test("sequence boxes must be adjacent", () => {
    const r = validate({ type: "sequence", title: "s", participants: [{ id: "a" }, { id: "b" }, { id: "c" }], messages: [{ from: "a", to: "b" }], boxes: [{ participants: ["a", "c"] }] })
    expect(r.ok).toBe(false)
  })

  test("story shape is validated", () => {
    const r = validate({ ...ok, story: { beats: [] } })
    expect(r.ok).toBe(false)
    expect(r.diagnostics.some((d) => d.path === "story.steps")).toBe(true)
    expect(validate({ ...ok, story: "auto" }).ok).toBe(true)
  })

  test("sequence refs and frames", () => {
    const r = validate({
      type: "sequence",
      title: "s",
      participants: [{ id: "a" }, { id: "b" }],
      messages: [{ id: "m0", from: "a", to: "b" }, { from: "b", to: "a", kind: "return" }, { from: "a", to: "a" }],
      frames: [{ kind: "loop", start: "m0", end: 1 }, { kind: "opt", start: 1, end: 2 }],
      activations: [{ participant: "b", start: 0, end: 5 }],
    })
    expect(r.ok).toBe(false)
    expect(r.diagnostics.some((d) => d.message.includes("without nesting"))).toBe(true)
    expect(r.diagnostics.some((d) => d.path === "activations[0].end")).toBe(true)
  })
})
