import { describe, expect, test } from "bun:test"
import { diffRows, intraMarks, moreMarker, parseHunks, type Hunk } from "../src/core/index.ts"

const H = parseHunks(`@@ -10,6 +10,7 @@ function pay()
 const a = 1
-const total = price * qty
+const total = price * qty + tax
+// note
 /* start
 end */
-return x
@@ -40,2 +41,2 @@
-\tlet n = 1
+\tlet n = 2`)

describe("diffRows", () => {
  test("rows, numbers, hunk headers with section", () => {
    const rows = diffRows(H, "ts")
    expect(rows.map((r) => r.kind)).toEqual(["hunk", "context", "del", "add", "add", "context", "context", "del", "hunk", "del", "add"])
    expect(rows[0].text).toBe("@@ -10,6 +10,7 @@ function pay()")
    expect(rows[0].tokens).toEqual([])
    expect(rows[2]).toMatchObject({ old: 11, hunk: 0 })
    expect(rows[2].new).toBeUndefined()
    expect(rows[3]).toMatchObject({ new: 11 })
    expect(rows[5]).toMatchObject({ old: 12, new: 13 })
    expect(rows[9]).toMatchObject({ hunk: 1, old: 40, text: "  let n = 1" })
  })

  test("tokens per side as streams: block comments span lines", () => {
    const rows = diffRows(H, "ts")
    expect(rows[6].tokens).toEqual([{ t: "end */", c: 0, k: "com" }])
    expect(rows[2].tokens[0]).toEqual({ t: "const", c: 0, k: "kw" })
  })

  test("intra-line marks on paired del / add rows", () => {
    const rows = diffRows(H, "ts")
    expect(rows[2].marks).toBeUndefined()
    expect(rows[3].marks).toEqual([[26, 31]])
    expect(rows[4].marks).toBeUndefined()
    expect(rows[9].marks).toEqual([[10, 11]])
    expect(rows[10].marks).toEqual([[10, 11]])
    expect(intraMarks("abc def", "xyz uvw")).toBeUndefined()
  })

  test("headers: a bare snippet numbered from 1 has none (auto)", () => {
    const s = parseHunks("-a\n+b")
    expect(diffRows(s, "ts").map((r) => r.kind)).toEqual(["del", "add"])
    expect(diffRows(s, "ts", { headers: "always" })[0].kind).toBe("hunk")
    expect(diffRows(H, "ts", { headers: "never" }).some((r) => r.kind === "hunk")).toBe(false)
  })

  test("fold: max caps with a marker row; embedded markers become fold rows", () => {
    const rows = diffRows(H, "ts", { max: 4 })
    const last = rows[rows.length - 1]
    expect(last).toMatchObject({ kind: "fold", text: "… 5 more lines", tokens: [] })
    const h: Hunk = { ...H[0], lines: [...H[0].lines.slice(0, 2), moreMarker(3)] }
    expect(diffRows([h], "ts").map((r) => r.kind)).toEqual(["hunk", "context", "del", "fold"])
  })

  test("deterministic and language-aware", () => {
    expect(JSON.stringify(diffRows(H, "ts"))).toBe(JSON.stringify(diffRows(H, "ts")))
    const py = diffRows(parseHunks("@@ -1,1 +1,1 @@\n-def f(): pass\n+def f(x): return x"), "py")
    expect(py[1].tokens.some((t) => t.k === "kw")).toBe(true)
  })
})
