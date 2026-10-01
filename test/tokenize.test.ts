import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { tokenize } from "../src/core/layout/tokenize.ts"
import type { CodeLine } from "../src/core/scene.ts"

const next = path.join(import.meta.dir, "..", "examples")
const golden = path.join(import.meta.dir, "fixtures", "tokenize")

/** Every program of an example: the code node's spec code, then each story `set` code. */
function programs(file: string): string[][] {
  const s = JSON.parse(fs.readFileSync(path.join(next, file), "utf8"))
  const code = s.nodes.find((n: { kind?: string }) => n.kind === "code")
  const sets = s.story.steps.filter((x: { set?: { code?: unknown } }) => x.set?.code).map((x: { set: { code: string[] } }) => x.set.code)
  return [code.code, ...sets]
}

/** Compact golden form: one string per line, `[kind:text]` for coloured tokens. */
const show = (lines: CodeLine[]) => lines.map((l) => " ".repeat(l[0]?.c ?? 0) + l.map((t) => (t.k ? `[${t.k}:${t.t}]` : t.t)).join(""))
const kinds = (lines: CodeLine[]) => new Map(lines.flat().filter((t) => t.k).map((t) => [t.t, t.k]))

describe("tokenize (TS lexer goldens)", () => {
  for (const f of ["code-mode.architecture.json", "retry-helper.architecture.json"])
    test(f, () => {
      const got = programs(f).map((p) => show(tokenize(p, "ts")))
      const file = path.join(golden, f.replace(/\.json$/, ".tokens.json"))
      if (process.env.STORYINK_WRITE_GOLDENS) fs.writeFileSync(file, `${JSON.stringify(got, null, 2)}\n`)
      expect(got).toEqual(JSON.parse(fs.readFileSync(file, "utf8")))
    })

  test("code-mode program 2 colours match the reference frames", () => {
    const k = kinds(tokenize(programs("code-mode.architecture.json")[1], "ts"))
    for (const d of ["issues", "filed"]) expect(k.get(d)).toBe("def")
    for (const fn of ["list_issues", "map", "all", "save_issue"]) expect(k.get(fn)).toBe("fn")
    expect(k.get("Promise")).toBe("type")
    for (const p of ["title", "issue"]) expect(k.get(p)).toBe("param")
    for (const o of ["=", "=>"]) expect(k.get(o)).toBe("op")
    for (const w of ["const", "await", "return"]) expect(k.get(w)).toBe("kw")
    expect(k.get('"anomalyco"')).toBe("str")
  })

  test("columns are exact; leading indentation is carried by the column", () => {
    const [l] = tokenize(["  foo(1)"], "ts")
    expect(l[0]).toEqual({ t: "foo", c: 2, k: "fn" })
    expect(l.map((t) => t.c + t.t.length).pop()).toBe(8)
  })

  test("block comments and templates carry across lines", () => {
    const t = tokenize(["/* a", "b */ x", "`one", "${y} two`"], "ts")
    expect(t[1][0]).toEqual({ t: "b */", c: 0, k: "com" })
    expect(t[2][0].k).toBe("str")
    expect(t[3].map((x) => x.k)).toEqual(["kw", undefined, "kw", "str"])
  })

  test("json keys vs values; text is plain", () => {
    expect(show(tokenize(['{ "a": "b", "n": 1 }'], "json"))).toEqual(['{ [def:"a"]: [str:"b"], [def:"n"]: [num:1] }'])
    expect(tokenize(["const x = 1"], "text")).toEqual([[{ t: "const x = 1", c: 0 }]])
  })
})
