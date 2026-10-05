import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"

/**
 * A minimal JSON Schema (2020-12 subset) checker covering exactly the keywords the storyink
 * schema uses, so the schema can be tested without a runtime dependency.
 */
type S = Record<string, unknown>
const root = JSON.parse(fs.readFileSync(path.join(import.meta.dir, "..", "schema", "storyink.schema.json"), "utf8")) as S

function typeOk(t: string, v: unknown): boolean {
  if (t === "object") return typeof v === "object" && v !== null && !Array.isArray(v)
  if (t === "array") return Array.isArray(v)
  if (t === "integer") return Number.isInteger(v)
  if (t === "number") return typeof v === "number"
  if (t === "string") return typeof v === "string"
  if (t === "boolean") return typeof v === "boolean"
  if (t === "null") return v === null
  return false
}

export function check(s: S, v: unknown, at = "$"): string[] {
  const errs: string[] = []
  if (s.$ref === "#") errs.push(...check(root, v, at))
  else if (s.$ref) {
    const key = (s.$ref as string).replace("#/$defs/", "")
    errs.push(...check((root.$defs as Record<string, S>)[key], v, at))
  }
  if (s.type && !typeOk(s.type as string, v)) return [...errs, `${at}: not ${s.type}`]
  if (s.enum && !(s.enum as unknown[]).includes(v)) errs.push(`${at}: ${JSON.stringify(v)} not in enum`)
  if ("const" in s && s.const !== v) errs.push(`${at}: not const ${JSON.stringify(s.const)}`)
  if (typeof v === "string") {
    if (s.pattern && !new RegExp(s.pattern as string, "u").test(v)) errs.push(`${at}: ${JSON.stringify(v)} !~ ${s.pattern}`)
    if (typeof s.minLength === "number" && v.length < s.minLength) errs.push(`${at}: too short`)
  }
  if (typeof v === "number") {
    if (typeof s.minimum === "number" && v < s.minimum) errs.push(`${at}: < minimum`)
    if (typeof s.maximum === "number" && v > s.maximum) errs.push(`${at}: > maximum`)
    if (typeof s.exclusiveMinimum === "number" && v <= s.exclusiveMinimum) errs.push(`${at}: <= exclusiveMinimum`)
  }
  if (Array.isArray(v)) {
    if (typeof s.minItems === "number" && v.length < s.minItems) errs.push(`${at}: too few items`)
    if (typeof s.maxItems === "number" && v.length > s.maxItems) errs.push(`${at}: too many items`)
    if (s.items) v.forEach((x, i) => errs.push(...check(s.items as S, x, `${at}[${i}]`)))
  }
  if (typeOk("object", v)) {
    const o = v as Record<string, unknown>
    for (const r of (s.required as string[]) ?? []) if (!(r in o)) errs.push(`${at}: missing ${r}`)
    if (typeof s.minProperties === "number" && Object.keys(o).length < s.minProperties) errs.push(`${at}: too few properties`)
    const props = (s.properties as Record<string, S>) ?? {}
    for (const [k, x] of Object.entries(o)) {
      if (props[k]) errs.push(...check(props[k], x, `${at}.${k}`))
      else if (s.additionalProperties === false) errs.push(`${at}: unknown property ${k}`)
    }
  }
  if (s.allOf) for (const x of s.allOf as S[]) errs.push(...check(x, v, at))
  if (s.anyOf && !(s.anyOf as S[]).some((x) => !check(x, v, at).length)) errs.push(`${at}: matches no anyOf`)
  if (s.oneOf) {
    const n = (s.oneOf as S[]).filter((x) => !check(x, v, at).length).length
    if (n !== 1) errs.push(`${at}: matches ${n} of oneOf`)
  }
  if (s.if) {
    const ok = !check(s.if as S, v, at).length
    if (ok && s.then) errs.push(...check(s.then as S, v, at))
    if (!ok && s.else) errs.push(...check(s.else as S, v, at))
  }
  return errs
}

const ex = path.join(import.meta.dir, "..", "examples")
const files = [
  ...fs.readdirSync(ex).filter((f) => f.endsWith(".json")).map((f) => path.join(ex, f)),
  ...fs.readdirSync(path.join(ex, "changes")).filter((f) => f.endsWith(".json") && !f.endsWith(".changes.json")).map((f) => path.join(ex, "changes", f)),
  ...fs.readdirSync(path.join(ex, "stories")).filter((f) => f.endsWith(".json")).map((f) => path.join(ex, "stories", f)),
  path.join(import.meta.dir, "fixtures", "openwick-architecture.json"),
  ...fs.readdirSync(path.join(ex, "pages")).filter((f) => f.endsWith(".page.json")).map((f) => path.join(ex, "pages", f)),
]

describe("JSON schema", () => {
  for (const f of files)
    test(path.relative(ex, f), () => {
      expect(check(root, JSON.parse(fs.readFileSync(f, "utf8")))).toEqual([])
    })

  test("rejects bad rich-node values", () => {
    const base = { type: "architecture", title: "x" }
    const bad = (nodes: unknown[], extra: object = {}) => check(root, { ...base, nodes, ...extra }).length > 0
    expect(bad([{ id: "a", kind: "panel", rows: [{ detail: "no text" }] }])).toBe(true)
    expect(bad([{ id: "a", kind: "panel", rows: [{ id: "12", text: "t" }] }])).toBe(true)
    expect(bad([{ id: "a", kind: "chip", icon: "plugg" }])).toBe(true)
    expect(bad([{ id: "a", kind: "chip", stack: 4 }])).toBe(true)
    expect(bad([{ id: "a", kind: "code", lang: "cobol" }])).toBe(true)
    expect(bad([{ id: "a", kind: "code", size: { cols: 4 } }])).toBe(true)
    expect(bad([{ id: "a", kind: "code", code: ["x"] }], { story: { steps: [{ line: "a#4-" }] } })).toBe(true)
    expect(bad([{ id: "a", kind: "code", code: ["x"] }], { story: { steps: [{ set: { id: "a" } }] } })).toBe(true)
    expect(bad([{ id: "a", kind: "code", code: ["x"] }], { story: { steps: [{ line: "a#1-2", set: { id: "a", code: "y" }, type: { id: "a", cps: 90 } }] } })).toBe(false)
  })

  test("change fields: accepts valid, rejects bad values", () => {
    const base = { type: "architecture", title: "x" }
    const bad = (v: object) => check(root, { ...base, ...v }).length > 0
    expect(bad({ nodes: [{ id: "a", delta: "added", stat: { add: 1, del: 0 }, summary: "s", files: ["a.ts", { path: "b.ts", lines: [1, 2], revision: "base" }] }], edges: [{ from: "a", to: "a", delta: "removed", emphasis: "hero" }], groups: [{ id: "g", delta: "modified" }], change: { base: "main", head: "x" }, style: { legend: false } })).toBe(false)
    expect(bad({ nodes: [{ id: "a", delta: "new" }] })).toBe(true)
    expect(bad({ nodes: [{ id: "a", stat: { add: -1 } }] })).toBe(true)
    expect(bad({ nodes: [{ id: "a", files: [{ path: "a.ts", lines: 0 }] }] })).toBe(true)
    expect(bad({ nodes: [{ id: "a" }], edges: [{ from: "a", to: "a", emphasis: "loud" }] })).toBe(true)
    expect(bad({ nodes: [{ id: "a" }], change: { branch: "x" } })).toBe(true)
    expect(check(root, { type: "sequence", title: "s", participants: [{ id: "a", delta: "removed" }], messages: [{ from: "a", to: "a", delta: "added", emphasis: "muted", files: ["x"] }] })).toEqual([])
  })

  test("tones: pulse options, tone steps, toned glow, set tone", () => {
    const spec = (steps: unknown[]) => ({ type: "dataflow", title: "t", nodes: [{ id: "a" }, { id: "b" }], edges: [{ from: "a", to: "b" }], story: { steps } })
    const ok = (steps: unknown[]) => check(root, spec(steps)).length === 0
    expect(ok([{ pulse: { edge: "a->b", tone: "note", label: "GET /", land: "edge", tint: true, stain: true } }])).toBe(true)
    expect(ok([{ tone: { ids: ["a", "a->b"], to: "risk", stagger: 0.1 } }, { tone: [{ ids: "a", to: null }] }])).toBe(true)
    expect(ok([{ glow: { ids: "a", tone: "warn" } }, { set: { id: "a", detail: "x", tone: "good" } }, { set: { id: "a", tone: null } }])).toBe(true)
    expect(ok([{ pulse: { edge: "a->b", tone: "blue" } }])).toBe(false)
    expect(ok([{ pulse: { edge: "a->b", land: "node" } }])).toBe(false)
    expect(ok([{ tone: { ids: "a" } }])).toBe(false)
    expect(ok([{ tone: { ids: "a", to: "risky" } }])).toBe(false)
  })

  test("pages: accepts blocks, rejects bad block shapes", () => {
    const page = (blocks: unknown[]) => ({ type: "page", title: "p", sections: [{ title: "s", blocks }] })
    const ok = (blocks: unknown[]) => check(root, page(blocks)).length === 0
    expect(ok([{ prose: "x" }, { figure: { spec: "a.json", claim: "c" } }, { figure: { spec: { type: "architecture", title: "t", nodes: [{ id: "a" }] } } }])).toBe(true)
    expect(ok([{ kpis: [{ label: "a", value: 1, tone: "good" }] }, { callout: { tone: "risk", body: "b" } }, { filemap: "changes" }, { diff: { file: "a.ts", lines: [1, 2] } }])).toBe(true)
    expect(ok([{ columns: [[{ prose: "a" }], [{ details: { summary: "s", blocks: [{ checklist: [{ text: "t", done: true }] }] } }]] }])).toBe(true)
    expect(ok([{ prose: "x", callout: { tone: "note", body: "b" } }])).toBe(false)
    expect(ok([{ prose: "x", extra: 1 }])).toBe(false)
    expect(ok([{ callout: { tone: "loud", body: "b" } }])).toBe(false)
    expect(ok([{ risks: [{ risk: "r", severity: "huge" }] }])).toBe(false)
    expect(ok([{ figure: { spec: { type: "architecture", title: "t", nodes: [{ id: "a", kind: "nope" }] } } }])).toBe(false)
    expect(ok([{ columns: [[{ prose: "a" }]] }])).toBe(false)
    expect(check(root, { type: "page", title: "p" }).length).toBeGreaterThan(0)
  })
})
