import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { langForPath, normalizeLang, parseHunks, parseUnifiedDiff, unquotePath } from "../src/core/diff/index.ts"

const parse = (t: string) => {
  const r = parseUnifiedDiff(t)
  expect(r.ok).toBe(true)
  return r.diffset!
}

const MOD = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,4 +1,5 @@ export function f() {
 one
-two
+TWO
+two and a half
 three
 four
@@ -10,2 +11,2 @@
 ten
--- not a header, a removed line starting with "-- "
+++ not a header either
`

describe("parseUnifiedDiff", () => {
  test("modified file: hunks, numbers, sections, stats", () => {
    const ds = parse(MOD)
    expect(ds.stats).toEqual({ files: 1, add: 3, del: 2 })
    const [f] = ds.files
    expect(f).toMatchObject({ path: "src/a.ts", status: "modified", add: 3, del: 2, lang: "ts" })
    expect(f.oldPath).toBeUndefined()
    expect(f.hunks[0]).toMatchObject({ header: "@@ -1,4 +1,5 @@", section: "export function f() {", oldStart: 1, oldLines: 4, newStart: 1, newLines: 5 })
    expect(f.hunks[0].lines.map((l) => [l.kind, l.old, l.new])).toEqual([
      ["context", 1, 1],
      ["del", 2, undefined],
      ["add", undefined, 2],
      ["add", undefined, 3],
      ["context", 3, 4],
      ["context", 4, 5],
    ])
    // Lines that look like ---/+++ inside a hunk are content (counts drive the parse).
    expect(f.hunks[1].lines.map((l) => l.kind)).toEqual(["context", "del", "add"])
    expect(f.hunks[1].lines[1].text).toBe('-- not a header, a removed line starting with "-- "')
  })

  test("renames (with and without edits) and copies", () => {
    const ds = parse(`diff --git a/old/name.py b/new/name.py
similarity index 100%
rename from old/name.py
rename to new/name.py
diff --git a/x.go b/y.go
similarity index 80%
rename from x.go
rename to y.go
index 1..2 100644
--- a/x.go
+++ b/y.go
@@ -1 +1 @@
-a
+b
diff --git a/c.rs b/d.rs
similarity index 90%
copy from c.rs
copy to d.rs
`)
    expect(ds.files.map((f) => [f.status, f.oldPath, f.path, f.lang])).toEqual([
      ["renamed", "old/name.py", "new/name.py", "py"],
      ["renamed", "x.go", "y.go", "go"],
      ["copied", "c.rs", "d.rs", "rust"],
    ])
    expect(ds.files[1].hunks[0]).toMatchObject({ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1 })
  })

  test("new and deleted files; base-side path for removals", () => {
    const ds = parse(`diff --git a/n.sql b/n.sql
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/n.sql
@@ -0,0 +1,2 @@
+select 1;
+select 2;
diff --git a/gone.yml b/gone.yml
deleted file mode 100644
index 1111111..0000000
--- a/gone.yml
+++ /dev/null
@@ -1 +0,0 @@
-a: 1
`)
    expect(ds.files.map((f) => [f.status, f.path, f.add, f.del])).toEqual([
      ["added", "n.sql", 2, 0],
      ["removed", "gone.yml", 0, 1],
    ])
    expect(ds.files[1].hunks[0].lines[0]).toEqual({ kind: "del", text: "a: 1", old: 1 })
  })

  test("binary files, empty new files, mode changes", () => {
    const ds = parse(`diff --git a/img.png b/img.png
new file mode 100644
index 0000000..1111111
Binary files /dev/null and b/img.png differ
diff --git a/old.bin b/old.bin
index 1..2 100644
Binary files a/old.bin and b/old.bin differ
diff --git a/empty.txt b/empty.txt
new file mode 100644
index 0000000..e69de29
diff --git a/run.sh b/run.sh
old mode 100644
new mode 100755
`)
    expect(ds.files.map((f) => [f.status, f.path, f.binary ?? false, f.hunks.length])).toEqual([
      ["added", "img.png", true, 0],
      ["modified", "old.bin", true, 0],
      ["added", "empty.txt", false, 0],
      ["modified", "run.sh", false, 0],
    ])
    expect("binary" in ds.files[2]).toBe(false)
  })

  test("no newline at end of file", () => {
    const ds = parse(`diff --git a/t.txt b/t.txt
--- a/t.txt
+++ b/t.txt
@@ -1,2 +1,2 @@
 a
-b
\\ No newline at end of file
+b
`)
    const ls = ds.files[0].hunks[0].lines
    expect(ls[1]).toEqual({ kind: "del", text: "b", old: 2, noNewline: true })
    expect(ls[2].noNewline).toBeUndefined()
  })

  test("quoted paths (octal escapes, spaces) and unquoted paths with spaces", () => {
    const ds = parse(`diff --git "a/caf\\303\\251 menu.md" "b/caf\\303\\251 menu.md"
--- "a/caf\\303\\251 menu.md"
+++ "b/caf\\303\\251 menu.md"
@@ -1 +1 @@
-x
+y
diff --git a/my file.txt b/my file.txt
--- a/my file.txt
+++ b/my file.txt
@@ -1 +1 @@
-x
+y
`)
    expect(ds.files.map((f) => f.path)).toEqual(["café menu.md", "my file.txt"])
    expect(unquotePath('"a\\tb\\"c"')).toBe('a\tb"c')
  })

  test("CRLF input", () => {
    const ds = parse(MOD.replace(/\n/g, "\r\n"))
    expect(ds.stats).toEqual({ files: 1, add: 3, del: 2 })
    expect(ds.files[0].hunks[0].lines[0].text).toBe("one")
  })

  test("plain ---/+++ diffs (diff -u) with timestamps, several files", () => {
    const ds = parse(`--- a.txt\t2024-01-01 00:00:00.000000000 +0000
+++ a.txt\t2024-01-02 00:00:00.000000000 +0000
@@ -1 +1,2 @@
 keep
+more
--- /dev/null
+++ b/new.py
@@ -0,0 +1 @@
+print(1)
`)
    expect(ds.files.map((f) => [f.path, f.status, f.add, f.del])).toEqual([
      ["a.txt", "modified", 1, 0],
      ["new.py", "added", 1, 0],
    ])
  })

  test("preamble (commit message) is skipped; empty input is an empty diff; junk is an error", () => {
    const ds = parse(`commit abc\nAuthor: x\n\n    msg\n\n${MOD}`)
    expect(ds.files.length).toBe(1)
    expect(parse("").files).toEqual([])
    const bad = parseUnifiedDiff("hello world")
    expect(bad.ok).toBe(false)
    expect(bad.diagnostics[0].severity).toBe("error")
  })

  test("truncated hunk warns, keeps what it has", () => {
    const r = parseUnifiedDiff("--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n a\n")
    expect(r.ok).toBe(true)
    expect(r.diagnostics.some((d) => /truncated/.test(d.message))).toBe(true)
    expect(r.diffset!.files[0].hunks[0].lines.length).toBe(1)
  })

  test("the real git diff of this repo parses with numstat-equal stats", () => {
    const proc = Bun.spawnSync(["git", "diff", "--no-color", "--find-renames", "--numstat", "b526d50~1", "b526d50", "--", "src/core"], { cwd: path.join(import.meta.dir, "..") })
    if (proc.exitCode !== 0) return // shallow clone: skip
    const text = Bun.spawnSync(["git", "diff", "--no-color", "--find-renames", "b526d50~1", "b526d50", "--", "src/core"], { cwd: path.join(import.meta.dir, "..") }).stdout.toString()
    const ds = parse(text)
    const rows = proc.stdout.toString().trim().split("\n").map((l) => l.split("\t"))
    expect(ds.files.length).toBe(rows.length)
    for (const [a, d, p] of rows) expect(ds.files.find((f) => f.path === p)).toMatchObject({ add: Number(a), del: Number(d) })
  })
})

describe("parseHunks", () => {
  test("@@ blocks (counts recomputed)", () => {
    const hs = parseHunks(["@@ -10,9 +10,9 @@ fn x", " a", "-b", "+c", "+d", "@@ -40 +41 @@", "-z"])
    expect(hs.length).toBe(2)
    expect(hs[0]).toMatchObject({ header: "@@ -10,9 +10,9 @@", section: "fn x", oldStart: 10, oldLines: 2, newStart: 10, newLines: 3 })
    expect(hs[0].lines.map((l) => [l.kind, l.old, l.new])).toEqual([
      ["context", 10, 10],
      ["del", 11, undefined],
      ["add", undefined, 11],
      ["add", undefined, 12],
    ])
    expect(hs[1].lines).toEqual([{ kind: "del", text: "z", old: 40 }])
  })

  test("snippet without a header is one hunk numbered from 1; file headers skipped", () => {
    const hs = parseHunks("--- a/x.ts\n+++ b/x.ts\n const a = 1\n-const b = 2\n+const b = 3\nunmarked\n")
    expect(hs.length).toBe(1)
    expect(hs[0]).toMatchObject({ header: "@@ -1,3 +1,3 @@", oldStart: 1, newStart: 1, oldLines: 3, newLines: 3 })
    expect(hs[0].lines[3]).toEqual({ kind: "context", text: "unmarked", old: 3, new: 3 })
  })
})

describe("languages", () => {
  test("langForPath", () => {
    expect(["a.ts", "a.tsx", "a.mjs", "b.json", "c.py", "d.go", "e.rs", "f.sql", "g.yml", "h.yaml", "i.sh", "j.bash", "README.md", "Makefile", "x"].map(langForPath)).toEqual([
      "ts", "ts", "js", "json", "py", "go", "rust", "sql", "yaml", "yaml", "sh", "sh", "text", "text", "text",
    ])
  })
  test("normalizeLang", () => {
    expect(["python", "golang", "rs", "yml", "bash", "shell", "zsh", "typescript", "tsx", "javascript", "jsx", "TS", "ts", "cobol", 3].map(normalizeLang)).toEqual([
      "py", "go", "rust", "yaml", "sh", "sh", "sh", "ts", "ts", "js", "js", "ts", "ts", "cobol", 3,
    ])
  })
})

describe("storyink diff (CLI)", () => {
  const cli = path.join(import.meta.dir, "..", "src", "cli.ts")
  test("--patch file -o changes.json, --json, and render --changes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storyink-diff-"))
    fs.writeFileSync(path.join(dir, "x.diff"), MOD)
    const r = Bun.spawnSync(["bun", cli, "diff", "--patch", "x.diff", "-o", "changes.json"], { cwd: dir, env: { ...process.env, NO_COLOR: "1" } })
    expect(r.exitCode).toBe(0)
    const out = r.stdout.toString()
    expect(out).toContain("1 file, +3 −2")
    expect(out).toContain("modified +3 −2  src/a.ts")
    const ds = JSON.parse(fs.readFileSync(path.join(dir, "changes.json"), "utf8"))
    expect(ds).toMatchObject({ version: 1, stats: { files: 1, add: 3, del: 2 } })
    const j = Bun.spawnSync(["bun", cli, "diff", "--patch", "-", "--json"], { cwd: dir, stdin: Buffer.from(MOD) })
    expect(JSON.parse(j.stdout.toString()).files[0].path).toBe("src/a.ts")
    fs.writeFileSync(
      path.join(dir, "s.json"),
      JSON.stringify({ type: "architecture", title: "t", nodes: [{ id: "a", label: "A", files: ["src/a.ts"] }, { id: "b", label: "B", files: ["src/missing.ts"] }], edges: [{ from: "a", to: "b" }] }),
    )
    for (const changes of ["changes.json", "x.diff"]) {
      const rr = Bun.spawnSync(["bun", cli, "render", "s.json", "-o", "s.html", "--changes", changes], { cwd: dir, env: { ...process.env, NO_COLOR: "1" } })
      expect(rr.exitCode).toBe(0)
      expect(rr.stderr.toString()).toContain('"src/missing.ts" is not in the diff')
      expect(fs.existsSync(path.join(dir, "s.html"))).toBe(true)
    }
  })
})
