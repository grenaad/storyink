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

describe("tokenize (other languages)", () => {
  test("py: def / class / keywords / literals / strings / comments / triple quotes", () => {
    expect(show(tokenize(["def load(path: str) -> list:", '    """doc', '    end"""', "    return open(path)  # hi", "class Foo(Base):", '  x = f"a{b}" if True else None'], "py"))).toEqual([
      "[kw:def] [def:load](path: [type:str]) [op:->] [type:list]:",
      '    [str:"""doc]',
      '[str:    end"""]',
      "    [kw:return] [fn:open](path)  [com:# hi]",
      "[kw:class] [type:Foo]([type:Base]):",
      '  x [op:=] [str:f"a{b}"] [kw:if] [num:True] [kw:else] [num:None]',
    ])
  })

  test("go: func / types / raw strings / comments", () => {
    expect(show(tokenize(["func (c *Cache) Get(key string) (int, error) {", "  v, ok := c.m[key] // c", "  return fmt.Sprintf(`x`), nil", "}"], "go"))).toEqual([
      "[kw:func] (c [op:*][type:Cache]) [fn:Get](key [type:string]) ([type:int], [type:error]) {",
      "  v, ok [op::=] c.m[key] [com:// c]",
      "  [kw:return] fmt.[fn:Sprintf]([str:`x`]), [num:nil]",
      "}",
    ])
  })

  test("rust: fn / let / macros / suffixed numbers", () => {
    const k = kinds(tokenize(["pub fn get(x: &str) -> Option<u32> {", "  let mut n = 0u32;", '  println!("{}", n);', "  Some(n)", "}"], "rust"))
    expect(k.get("get")).toBe("def")
    expect(k.get("println")).toBe("fn")
    expect(k.get("0u32")).toBe("num")
    expect(k.get("Option")).toBe("type")
    expect(k.get("mut")).toBe("kw")
  })

  test("sql: case-insensitive keywords, -- comments, strings", () => {
    expect(show(tokenize(["SELECT id, count(*) AS n FROM users", "WHERE name = 'x' -- c"], "sql"))).toEqual([
      "[kw:SELECT] id, [fn:count]([op:*]) [kw:AS] n [kw:FROM] users",
      "[kw:WHERE] name [op:=] [str:'x'] [com:-- c]",
    ])
  })

  test("yaml: keys, scalars, lists, anchors, comments", () => {
    expect(show(tokenize(["---", "name: ci # c", "on:", "  - run: \"echo hi\"", "    n: 3", "a: &x yes"], "yaml"))).toEqual([
      "[kw:---]",
      "[def:name][op::] [str:ci] [com:# c]",
      "[def:on][op::]",
      '  [op:-] [def:run][op::] [str:"echo hi"]',
      "    [def:n][op::] [num:3]",
      "[def:a][op::] [type:&x] [num:yes]",
    ])
  })

  test("sh: commands, flags, vars, assignments, keywords, heredocs", () => {
    expect(show(tokenize(["set -e", 'FOO=bar ./x.sh --flag "$HOME" | grep -v x && echo ${FOO}', "if [ -f a ]; then", "  cat <<EOF", "text $x", "EOF", "fi"], "sh"))).toEqual([
      "[kw:set] [op:-e]",
      '[def:FOO][op:=]bar [fn:./x.sh] [op:--flag] [str:"$HOME"] [op:|] [fn:grep] [op:-v] x [op:&&] [fn:echo] [param:${FOO}]',
      "[kw:if] [fn:[] [op:-f] a ][op:;] [kw:then]",
      "  [fn:cat] [op:<<EOF]",
      "[str:text $x]",
      "[str:EOF]",
      "[kw:fi]",
    ])
  })

  test("aliases map to the same lexer; columns are exact", () => {
    for (const [alias, lang] of [["python", "py"], ["golang", "go"], ["rs", "rust"], ["yml", "yaml"], ["bash", "sh"], ["zsh", "sh"], ["tsx", "ts"], ["javascript", "js"]] as const)
      expect(tokenize(["x = 1 # c"], alias as never)).toEqual(tokenize(["x = 1 # c"], lang))
    for (const lang of ["py", "go", "rust", "sql", "yaml", "sh"] as const) {
      const src = "  foo(1, 'a') # x -- y // z"
      const [l] = tokenize([src], lang)
      for (const t of l) expect(src.slice(t.c, t.c + t.t.length)).toBe(t.t)
    }
  })
})

describe("lang validation", () => {
  test("aliases are accepted and normalized; unknown langs error", async () => {
    const { validate } = await import("../src/core/validate.ts")
    const v = validate({ type: "architecture", title: "t", nodes: [{ id: "a", kind: "code", lang: "python", code: "x = 1" }] })
    expect(v.ok).toBe(true)
    expect((v.spec as any).nodes[0].lang).toBe("py")
    const bad = validate({ type: "architecture", title: "t", nodes: [{ id: "a", kind: "code", lang: "cobol", code: "x" }] })
    expect(bad.ok).toBe(false)
  })
})
