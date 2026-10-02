import { describe, expect, test } from "bun:test"
import { capHunks, coverage, isMoreMarker, parseUnifiedDiff, resolveChanges, selectHunks, statFor, type DiffSet, type Spec } from "../src/core/index.ts"

// a.ts: hunk 1 around line 2 (base 2 → head 2-3), hunk 2 around line 20 (base 20 removed).
const DIFF = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,4 +1,5 @@ top
 one
-two
+TWO
+two b
 three
 four
@@ -18,5 +19,4 @@ bottom
 l18
 l19
-l20
 l21
 l22
diff --git a/src/b.py b/src/b.py
new file mode 100644
--- /dev/null
+++ b/src/b.py
@@ -0,0 +1,3 @@
+def f():
+    return 1
+
diff --git a/docs/c.md b/docs/c.md
--- a/docs/c.md
+++ b/docs/c.md
@@ -1 +1 @@
-x
+y
`

const ds: DiffSet = { ...parseUnifiedDiff(DIFF).diffset!, base: "main", head: "feat" }

describe("selectHunks / statFor", () => {
  test("whole file vs range (head side)", () => {
    expect(selectHunks(ds, "src/a.ts").length).toBe(2)
    expect(selectHunks(ds, { path: "src/a.ts", lines: [2, 3] }).map((h) => h.header)).toEqual(["@@ -1,4 +1,5 @@"])
    expect(selectHunks(ds, { path: "src/a.ts", lines: 21 }).map((h) => h.header)).toEqual(["@@ -18,5 +19,4 @@"])
    expect(selectHunks(ds, { path: "src/a.ts", lines: [10, 12] })).toEqual([])
    expect(selectHunks(ds, "nope.ts")).toEqual([])
  })

  test("base side uses old numbers", () => {
    expect(selectHunks(ds, { path: "src/a.ts", lines: 20, revision: "base" }).map((h) => h.oldStart)).toEqual([18])
    expect(selectHunks(ds, { path: "src/a.ts", lines: 5 }, "base")).toEqual([])
    expect(selectHunks(ds, { path: "src/a.ts", lines: 5 }, "head").length).toBe(1)
  })

  test("trimming to range ± context", () => {
    const [h] = selectHunks(ds, { path: "src/a.ts", lines: 2 }, "head", { context: 0 })
    // Head line 2 is the first added line; the removed line sits at the same head position.
    expect(h.lines.map((l) => l.kind)).toEqual(["del", "add"])
    expect(h).toMatchObject({ oldStart: 2, oldLines: 1, newStart: 2, newLines: 1, header: "@@ -2 +2 @@", section: "top" })
    const [w] = selectHunks(ds, { path: "src/a.ts", lines: 2 }, "head", { context: 1 })
    expect(w.lines.map((l) => l.text)).toEqual(["one", "two", "TWO", "two b"])
  })

  test("stat within refs, deduplicated", () => {
    expect(statFor(ds, ["src/a.ts"])).toEqual({ add: 2, del: 2 })
    expect(statFor(ds, [{ path: "src/a.ts", lines: [1, 5] }])).toEqual({ add: 2, del: 1 })
    expect(statFor(ds, [{ path: "src/a.ts", lines: 20, revision: "base" }])).toEqual({ add: 0, del: 1 })
    expect(statFor(ds, ["src/a.ts", { path: "src/a.ts", lines: 2 }, "src/b.py"])).toEqual({ add: 5, del: 2 })
    expect(statFor(ds, ["missing"])).toEqual({ add: 0, del: 0 })
  })

  test("capHunks adds a '… N more lines' marker", () => {
    const f = ds.files[0]
    const c = capHunks(f.hunks, 4)
    expect(c.more).toBe(7)
    const rows = c.hunks.flatMap((h) => h.lines)
    expect(rows.length).toBe(5)
    expect(isMoreMarker(rows[4])).toBe(true)
    expect(rows[4].text).toBe("… 7 more lines")
    expect(capHunks(f.hunks, 100).hunks).toBe(f.hunks)
  })
})

const spec = (): Spec =>
  ({
    type: "architecture",
    title: "t",
    nodes: [
      { id: "a", label: "A", delta: "modified", files: [{ path: "src/a.ts", lines: [2, 3] }] },
      { id: "gone", label: "Gone", delta: "removed", files: [{ path: "src/a.ts", lines: 20 }] },
      { id: "b", label: "B", delta: "added", files: ["src/b.py"], stat: { add: 99 } },
      { id: "x", label: "X", files: ["src/missing.ts", { path: "src/a.ts", lines: [100, 110] }] },
      { id: "code", kind: "code", diff: { file: "src/a.ts", lines: 2, context: 0 } },
      { id: "code2", kind: "code", lang: "js", diff: { file: "src/b.py" } },
      { id: "inline", kind: "code", diff: "@@ -1 +1 @@\n-a\n+b" },
    ],
    edges: [{ from: "a", to: "b", files: ["src/b.py"] }],
  }) as unknown as Spec

describe("coverage", () => {
  test("claimed / unclaimed and ref warnings", () => {
    const c = coverage(ds, spec())
    expect(c.claimed).toEqual({ files: 2, hunks: 3 })
    expect(c.unclaimed.files).toEqual(["docs/c.md"])
    expect(c.unclaimed.hunks).toEqual([])
    const msgs = c.diagnostics.map((d) => `${d.path}: ${d.message}`)
    expect(msgs).toContain('nodes[3].files[0]: "src/missing.ts" is not in the diff')
    expect(msgs.some((m) => m.startsWith("nodes[3].files[1]: lines [100,110]") && m.includes("touch no hunk"))).toBe(true)
    expect(msgs.some((m) => m.includes("1 changed file not referenced") && m.includes("docs/c.md"))).toBe(true)
    expect(c.diagnostics.every((d) => d.severity === "warning")).toBe(true)
  })

  test("unclaimed hunks in referenced files", () => {
    const s = { type: "architecture", title: "t", nodes: [{ id: "a", files: [{ path: "src/a.ts", lines: 2 }, "src/b.py", "docs/c.md"] }] } as unknown as Spec
    const c = coverage(ds, s)
    expect(c.unclaimed.hunks).toEqual([{ path: "src/a.ts", index: 1, header: "@@ -18,5 +19,4 @@" }])
    expect(c.diagnostics.some((d) => d.message.startsWith("1 hunk in referenced files"))).toBe(true)
  })

  test("sequence messages are covered", () => {
    const s = { type: "sequence", title: "t", participants: [{ id: "a" }, { id: "b" }], messages: [{ from: "a", to: "b", files: ["docs/c.md"] }] } as unknown as Spec
    expect(coverage(ds, s).files.find((f) => f.path === "docs/c.md")!.referenced).toBe(true)
  })
})

describe("resolveChanges", () => {
  test("fills stat, resolves diff nodes, embeds referenced hunks; input untouched", () => {
    const input = spec()
    const before = JSON.stringify(input)
    const { spec: out, diagnostics } = resolveChanges(input, ds)
    expect(JSON.stringify(input)).toBe(before)
    const n = (out as any).nodes
    expect(n[0].stat).toEqual({ add: 2, del: 1 })
    expect(n[1].stat).toEqual({ add: 0, del: 1 }) // removed: base-side line 20
    expect(n[2].stat).toEqual({ add: 99 }) // explicit stat wins
    expect(n[3].stat).toEqual({ add: 0, del: 0 })
    expect((out as any).edges[0].stat).toEqual({ add: 3, del: 0 })
    // diff nodes
    expect(n[4].lang).toBe("ts")
    expect(n[4].diff).toMatchObject({ file: "src/a.ts", lines: 2, context: 0 })
    expect(n[4].diff.hunks.map((h: any) => h.lines.map((l: any) => l.kind))).toEqual([["del", "add"]])
    expect(n[5].lang).toBe("js") // explicit lang wins
    expect(n[5].diff.hunks.length).toBe(1)
    expect(n[6].diff).toBe("@@ -1 +1 @@\n-a\n+b")
    // embedded changes: only referenced files / hunks
    const ch = (out as any).changes
    expect(ch.base).toBe("main")
    expect(ch.head).toBe("feat")
    expect(ch.files.map((f: any) => [f.path, f.hunks.length])).toEqual([
      ["src/a.ts", 2],
      ["src/b.py", 1],
    ])
    expect(diagnostics.some((d) => d.message.includes("docs/c.md"))).toBe(true)
  })

  test("embedding is capped per file with a marker and a warning", () => {
    const { spec: out, diagnostics } = resolveChanges(spec(), ds, { maxLinesPerFile: 3 })
    const a = (out as any).changes.files[0]
    const rows = a.hunks.flatMap((h: any) => h.lines)
    expect(rows.length).toBe(4)
    expect(isMoreMarker(rows[3])).toBe(true)
    expect(diagnostics.some((d) => d.path === "changes" && d.message.includes("capped at 3 lines"))).toBe(true)
  })

  test("no references: nothing embedded, spec otherwise equal", () => {
    const s = { type: "workflow", title: "t", nodes: [{ id: "a" }] } as unknown as Spec
    const r = resolveChanges(s, ds)
    expect(r.spec).toEqual(s)
    expect(r.spec).not.toBe(s)
  })

  test("diff node whose file is not in the diff stays unresolved with a warning", () => {
    const s = { type: "architecture", title: "t", nodes: [{ id: "c", kind: "code", diff: { file: "nope.ts" } }] } as unknown as Spec
    const r = resolveChanges(s, ds)
    expect((r.spec as any).nodes[0].diff).toEqual({ file: "nope.ts" })
    expect(r.diagnostics.some((d) => d.path === "nodes[0].diff")).toBe(true)
  })
})
