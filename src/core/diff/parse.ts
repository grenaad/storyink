/** Unified diff parser (git and plain `---`/`+++` diffs). Pure and browser-safe. */
import type { Diagnostic } from "../validate.ts"
import { langForPath } from "./lang.ts"
import type { DiffFile, DiffLine, DiffSet, FileStatus, Hunk } from "./types.ts"

export interface ParseDiffResult {
  ok: boolean
  diffset?: DiffSet
  diagnostics: Diagnostic[]
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/

/** Undo git's C-style quoting (`"a/caf\303\251.txt"`). Unquoted input is returned as is. */
export function unquotePath(p: string): string {
  if (!(p.length >= 2 && p.startsWith('"') && p.endsWith('"'))) return p
  const body = p.slice(1, -1)
  const bytes: number[] = []
  const esc: Record<string, number> = { n: 10, t: 9, r: 13, b: 8, f: 12, v: 11, a: 7, '"': 34, "\\": 92 }
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === "\\" && i + 1 < body.length) {
      const oct = /^[0-7]{3}/.exec(body.slice(i + 1))
      if (oct) {
        bytes.push(parseInt(oct[0], 8))
        i += 3
        continue
      }
      const e = esc[body[i + 1]]
      if (e !== undefined) {
        bytes.push(e)
        i++
        continue
      }
    }
    for (const b of new TextEncoder().encode(ch)) bytes.push(b)
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

/** A path token from `---`/`+++`/rename lines: unquote, drop a trailing tab+timestamp, strip a/ b/. */
function cleanPath(raw: string, strip: boolean): string | null {
  let p = raw.trim()
  if (!p.startsWith('"')) {
    const tab = p.indexOf("\t")
    if (tab >= 0) p = p.slice(0, tab)
    p = p.trimEnd()
  }
  p = unquotePath(p)
  if (p === "/dev/null") return null
  if (strip && /^[abciwo]\//.test(p)) p = p.slice(2)
  return p
}

/** Split `diff --git a/x b/y` operands (quoted or not). */
function gitHeaderPaths(rest: string): [string, string] | undefined {
  const quoted = /^("(?:[^"\\]|\\.)*"|\S+) ("(?:[^"\\]|\\.)*"|\S+)$/.exec(rest)
  if (quoted && (quoted[1].startsWith('"') || quoted[2].startsWith('"') || !rest.slice(quoted[1].length + 1).includes(" ")))
    return [cleanPath(quoted[1], true) ?? "", cleanPath(quoted[2], true) ?? ""]
  // Unquoted paths with spaces: "a/x y b/x y" (same path both sides when not renamed).
  const half = (rest.length - 1) / 2
  if (Number.isInteger(half) && rest[half] === " ") {
    const a = rest.slice(0, half)
    const b = rest.slice(half + 1)
    if (a.slice(2) === b.slice(2)) return [cleanPath(a, true) ?? "", cleanPath(b, true) ?? ""]
  }
  const m = / b\//.exec(rest)
  if (m) return [cleanPath(rest.slice(0, m.index), true) ?? "", cleanPath(rest.slice(m.index + 1), true) ?? ""]
  return undefined
}

function hunkHeader(oldStart: number, oldLines: number, newStart: number, newLines: number): string {
  const r = (s: number, n: number) => (n === 1 ? `${s}` : `${s},${n}`)
  return `@@ -${r(oldStart, oldLines)} +${r(newStart, newLines)} @@`
}

interface Building {
  file: DiffFile
  oldPath?: string | null
  newPath?: string | null
  explicit?: FileStatus
}

/** Parse a unified diff (`git diff` output or a plain `diff -u`). Never throws. */
export function parseUnifiedDiff(text: string): ParseDiffResult {
  const diagnostics: Diagnostic[] = []
  if (typeof text !== "string") return { ok: false, diagnostics: [{ severity: "error", path: "", message: "diff text must be a string" }] }
  const lines = text.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l))
  if (lines.length && lines[lines.length - 1] === "") lines.pop()
  const files: DiffFile[] = []
  let cur: Building | undefined
  let hunk: Hunk | undefined
  let remOld = 0
  let remNew = 0
  let oldN = 0
  let newN = 0
  let lastLine: DiffLine | undefined

  const finish = () => {
    if (!cur) return
    const f = cur.file
    const oldP = cur.oldPath
    const newP = cur.newPath
    let status: FileStatus = cur.explicit ?? "modified"
    if (!cur.explicit) {
      if (oldP === null && newP) status = "added"
      else if (newP === null && oldP) status = "removed"
      else if (oldP && newP && oldP !== newP) status = "renamed"
    }
    f.status = status
    if (status === "removed") f.path = oldP || f.path
    else f.path = newP || f.path || oldP || ""
    if ((status === "renamed" || status === "copied") && oldP && oldP !== f.path) f.oldPath = oldP
    else delete f.oldPath
    f.lang = langForPath(f.path)
    files.push(f)
    cur = undefined
    hunk = undefined
  }
  const start = () => {
    finish()
    cur = { file: { path: "", status: "modified", add: 0, del: 0, hunks: [] } }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Inside a hunk: consume by counts.
    if (hunk && (remOld > 0 || remNew > 0)) {
      const m = line[0]
      if (m === "\\") {
        if (lastLine) lastLine.noNewline = true
        continue
      }
      if (m === "+" && remNew > 0) {
        lastLine = { kind: "add", text: line.slice(1), new: newN++ }
        hunk.lines.push(lastLine)
        cur!.file.add++
        remNew--
        continue
      }
      if (m === "-" && remOld > 0) {
        lastLine = { kind: "del", text: line.slice(1), old: oldN++ }
        hunk.lines.push(lastLine)
        cur!.file.del++
        remOld--
        continue
      }
      if ((m === " " || line === "") && remOld > 0 && remNew > 0) {
        lastLine = { kind: "context", text: line.slice(1), old: oldN++, new: newN++ }
        hunk.lines.push(lastLine)
        remOld--
        remNew--
        continue
      }
      diagnostics.push({ severity: "warning", path: `line ${i + 1}`, message: `hunk ended early (${remOld} old / ${remNew} new lines missing)` })
      remOld = remNew = 0
    }
    if (line.startsWith("\\") && lastLine) {
      lastLine.noNewline = true
      continue
    }
    if (line.startsWith("diff --git ")) {
      start()
      const ps = gitHeaderPaths(line.slice("diff --git ".length))
      if (ps) {
        cur!.oldPath = ps[0]
        cur!.newPath = ps[1]
        cur!.file.path = ps[1]
      } else diagnostics.push({ severity: "warning", path: `line ${i + 1}`, message: "could not read the paths of a diff --git header" })
      lastLine = undefined
      continue
    }
    const hm = HUNK_RE.exec(line)
    if (hm) {
      if (!cur) {
        start()
        diagnostics.push({ severity: "warning", path: `line ${i + 1}`, message: "hunk without a file header" })
      }
      const oldStart = Number(hm[1])
      const oldLines = hm[2] === undefined ? 1 : Number(hm[2])
      const newStart = Number(hm[3])
      const newLines = hm[4] === undefined ? 1 : Number(hm[4])
      hunk = { header: line.slice(0, line.indexOf("@@", 2) + 2), ...(hm[5] ? { section: hm[5] } : {}), oldStart, oldLines, newStart, newLines, lines: [] }
      cur!.file.hunks.push(hunk)
      remOld = oldLines
      remNew = newLines
      oldN = oldStart
      newN = newStart
      lastLine = undefined
      continue
    }
    if (line.startsWith("--- ") && lines[i + 1]?.startsWith("+++ ")) {
      // Plain diffs start a file here; git diffs already have one open (unless it has hunks).
      if (!cur || cur.file.hunks.length || cur.file.binary) start()
      cur!.oldPath = cleanPath(line.slice(4), true)
      cur!.newPath = cleanPath(lines[i + 1].slice(4), true)
      i++
      hunk = undefined
      continue
    }
    if (!cur) continue // preamble (commit message, `index` lines of other tools, …)
    if (line.startsWith("new file mode")) {
      cur.explicit = "added"
      cur.oldPath = null
    } else if (line.startsWith("deleted file mode")) {
      cur.explicit = "removed"
      cur.newPath = null
    } else if (line.startsWith("rename from ")) {
      cur.explicit = "renamed"
      cur.oldPath = cleanPath(line.slice(12), false)
    } else if (line.startsWith("rename to ")) {
      cur.explicit = "renamed"
      cur.newPath = cleanPath(line.slice(10), false)
    } else if (line.startsWith("copy from ")) {
      cur.explicit = "copied"
      cur.oldPath = cleanPath(line.slice(10), false)
    } else if (line.startsWith("copy to ")) {
      cur.explicit = "copied"
      cur.newPath = cleanPath(line.slice(8), false)
    } else if (/^Binary files .* differ$/.test(line) || line === "GIT binary patch") {
      cur.file.binary = true
      const m = /^Binary files (.*) and (.*) differ$/.exec(line)
      if (m) {
        const a = cleanPath(m[1], true)
        const b = cleanPath(m[2], true)
        if (a === null) cur.oldPath = null
        if (b === null) cur.newPath = null
      }
    }
    // index, similarity, old/new mode, dissimilarity, binary patch payload: ignored.
  }
  if (hunk && (remOld > 0 || remNew > 0)) diagnostics.push({ severity: "warning", path: "", message: `last hunk is truncated (${remOld} old / ${remNew} new lines missing)` })
  finish()
  for (const f of files) {
    if (!f.binary) delete f.binary
  }
  if (!files.length && text.trim() && !/^(diff |--- |@@ )/m.test(text))
    diagnostics.push({ severity: "error", path: "", message: "no diff found in the input", hint: "pass `git diff` output or a unified diff (---/+++ and @@ hunks)" })
  const ok = !diagnostics.some((d) => d.severity === "error")
  const stats = { files: files.length, add: files.reduce((s, f) => s + f.add, 0), del: files.reduce((s, f) => s + f.del, 0) }
  return { ok, ...(ok ? { diffset: { version: 1 as const, files, stats } } : {}), diagnostics }
}

/**
 * Parse a bare hunk snippet (`@@ … @@` blocks, markers ` `/`+`/`-`). A snippet with no `@@`
 * header is one hunk numbered from 1. Counts are recomputed from the lines (hand-written snippets
 * often miscount). File headers (`diff --git`, `---`, `+++`, `index`) are skipped.
 */
export function parseHunks(text: string | string[]): Hunk[] {
  const src = Array.isArray(text) ? text.flatMap((l) => String(l).split("\n")) : String(text ?? "").split("\n")
  const lines = src.map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l))
  while (lines.length && lines[lines.length - 1] === "") lines.pop()
  const hunks: Hunk[] = []
  let h: Hunk | undefined
  let oldN = 1
  let newN = 1
  let last: DiffLine | undefined
  const close = () => {
    if (!h) return
    h.oldLines = h.lines.filter((l) => l.kind !== "add").length
    h.newLines = h.lines.filter((l) => l.kind !== "del").length
    hunks.push(h)
    h = undefined
  }
  for (const line of lines) {
    const hm = HUNK_RE.exec(line)
    if (hm) {
      close()
      oldN = Number(hm[1])
      newN = Number(hm[3])
      h = { header: line.slice(0, line.indexOf("@@", 2) + 2), ...(hm[5] ? { section: hm[5] } : {}), oldStart: oldN, oldLines: 0, newStart: newN, newLines: 0, lines: [] }
      continue
    }
    if (!h) {
      if (/^(diff --git |index |--- |\+\+\+ |new file mode|deleted file mode|similarity index|rename (from|to) )/.test(line)) continue
      h = { header: "", oldStart: 1, oldLines: 0, newStart: 1, newLines: 0, lines: [] }
      oldN = newN = 1
    }
    if (line.startsWith("\\")) {
      if (last) last.noNewline = true
      continue
    }
    const m = line[0]
    if (m === "+") last = { kind: "add", text: line.slice(1), new: newN++ }
    else if (m === "-") last = { kind: "del", text: line.slice(1), old: oldN++ }
    else last = { kind: "context", text: m === " " ? line.slice(1) : line, old: oldN++, new: newN++ }
    h.lines.push(last)
  }
  close()
  for (const x of hunks) if (!x.header) x.header = hunkHeader(x.oldStart, x.oldLines, x.newStart, x.newLines)
  return hunks
}

export { hunkHeader }
