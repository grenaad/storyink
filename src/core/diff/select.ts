/** Select hunks / lines of a DiffSet by FileRef ranges. Pure and browser-safe. */
import type { ChangeStat, FileRef, FileRefLike } from "../spec.ts"
import { hunkHeader } from "./parse.ts"
import type { DiffFile, DiffLine, DiffSet, Hunk } from "./types.ts"

export type Side = "head" | "base"

/** A bare path becomes `{ path }`. */
export function toFileRef(ref: FileRefLike): FileRef {
  return typeof ref === "string" ? { path: ref } : ref
}

const norm = (p: string) => p.replace(/^\.\//, "").replace(/^\/+/, "")

/** The diff file for a path (head path, or base path of a rename / copy / removal). */
export function findFile(diffset: DiffSet, path: string): DiffFile | undefined {
  const p = norm(path)
  return diffset.files.find((f) => f.path === p) ?? diffset.files.find((f) => f.oldPath === p)
}

/** `lines` as an inclusive [a, b] pair (undefined = whole file). */
export function rangeOf(lines: FileRef["lines"]): [number, number] | undefined {
  if (lines === undefined) return undefined
  if (typeof lines === "number") return [lines, lines]
  return [Math.min(lines[0], lines[1]), Math.max(lines[0], lines[1])]
}

/** Per-line positions on both sides (removed lines sit at the head cursor, added at the base cursor). */
function positions(h: Hunk): { o: number; n: number }[] {
  let o = h.oldLines === 0 ? h.oldStart + 1 : h.oldStart
  let n = h.newLines === 0 ? h.newStart + 1 : h.newStart
  return h.lines.map((l) => {
    const at = { o: l.old ?? o, n: l.new ?? n }
    if (l.old !== undefined) o = l.old + 1
    if (l.new !== undefined) n = l.new + 1
    return at
  })
}

/** Inclusive span of a hunk on one side. */
function span(h: Hunk, side: Side): [number, number] {
  const s = side === "head" ? h.newStart : h.oldStart
  const c = side === "head" ? h.newLines : h.oldLines
  return c === 0 ? [s, s + 1] : [s, s + c - 1]
}

const hits = (a: [number, number], b: [number, number]) => a[0] <= b[1] && b[0] <= a[1]

/** Trim a hunk to lines whose side position is within [a, b]; recomputes starts / counts / header. */
function trim(h: Hunk, side: Side, [a, b]: [number, number]): Hunk | undefined {
  const pos = positions(h)
  const keep = h.lines.map((_, i) => i).filter((i) => {
    const p = side === "head" ? pos[i].n : pos[i].o
    return p >= a && p <= b
  })
  if (!keep.length) return undefined
  const lines = keep.map((i) => h.lines[i])
  if (lines.length === h.lines.length) return h
  const oldLines = lines.filter((l) => l.kind !== "add").length
  const newLines = lines.filter((l) => l.kind !== "del").length
  const first = pos[keep[0]]
  const oldStart = oldLines === 0 ? first.o - 1 : first.o
  const newStart = newLines === 0 ? first.n - 1 : first.n
  return { header: hunkHeader(oldStart, oldLines, newStart, newLines), ...(h.section ? { section: h.section } : {}), oldStart, oldLines, newStart, newLines, lines }
}

export interface SelectOptions {
  /** Trim intersecting hunks to the range ± this many lines (default: keep whole hunks). */
  context?: number
}

/** The side a ref's line numbers refer to. */
export function sideOf(ref: FileRef, removed = false): Side {
  return ref.revision === "base" || (removed && ref.revision !== "head") ? "base" : "head"
}

/**
 * Hunks of `ref.path` intersecting `ref.lines` (head side uses new numbers, base side old). Without
 * lines: every hunk. With `context`, hunks are trimmed to the range ± context.
 */
export function selectHunks(diffset: DiffSet, ref: FileRefLike, side?: Side, opts: SelectOptions = {}): Hunk[] {
  const r = toFileRef(ref)
  const f = findFile(diffset, r.path)
  if (!f) return []
  const range = rangeOf(r.lines)
  if (!range) return f.hunks
  const s = side ?? sideOf(r)
  const out: Hunk[] = []
  for (const h of f.hunks) {
    if (!hits(span(h, s), range)) continue
    if (opts.context === undefined) out.push(h)
    else {
      const t = trim(h, s, [range[0] - opts.context, range[1] + opts.context])
      if (t) out.push(t)
    }
  }
  return out
}

/** Added / deleted lines within the refs (each diff line counted once). */
export function statFor(diffset: DiffSet, refs: FileRefLike[], side?: Side): Required<ChangeStat> {
  const seen = new Set<string>()
  let add = 0
  let del = 0
  for (const ref of refs) {
    const r = toFileRef(ref)
    const f = findFile(diffset, r.path)
    if (!f) continue
    const range = rangeOf(r.lines)
    const s = side ?? sideOf(r)
    f.hunks.forEach((h, hi) => {
      const pos = positions(h)
      h.lines.forEach((l, li) => {
        if (l.kind === "context") return
        if (range) {
          const p = s === "head" ? pos[li].n : pos[li].o
          if (p < range[0] || p > range[1]) return
        }
        const key = `${f.path}\0${hi}\0${li}`
        if (seen.has(key)) return
        seen.add(key)
        if (l.kind === "add") add++
        else del++
      })
    })
  }
  return { add, del }
}

/** A "… N more lines" marker row: a context line with no line numbers. */
export function moreMarker(n: number): DiffLine {
  return { kind: "context", text: `… ${n} more line${n === 1 ? "" : "s"}` }
}

/** True for a marker row made by `moreMarker` / `capHunks`. */
export function isMoreMarker(l: DiffLine): boolean {
  return l.kind === "context" && l.old === undefined && l.new === undefined && /^… \d+ more lines?$/.test(l.text)
}

/**
 * Keep at most `max` diff lines across hunks; the last kept hunk ends with a "… N more lines"
 * marker (N counts the dropped lines, including later hunks). Counts / headers are left as parsed.
 */
export function capHunks(hunks: Hunk[], max: number): { hunks: Hunk[]; more: number } {
  const total = hunks.reduce((s, h) => s + h.lines.length, 0)
  if (total <= max) return { hunks, more: 0 }
  const out: Hunk[] = []
  let left = Math.max(0, max)
  for (const h of hunks) {
    if (left <= 0) break
    if (h.lines.length <= left) {
      out.push(h)
      left -= h.lines.length
    } else {
      out.push({ ...h, lines: h.lines.slice(0, left) })
      left = 0
    }
  }
  const more = total - out.reduce((s, h) => s + h.lines.length, 0)
  if (!out.length) out.push({ ...hunks[0], lines: [] })
  const last = out[out.length - 1]
  out[out.length - 1] = { ...last, lines: [...last.lines, moreMarker(more)] }
  return { hunks: out, more }
}
