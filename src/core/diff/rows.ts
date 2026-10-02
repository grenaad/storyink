/**
 * Diff rows: a renderer-agnostic row model for showing hunks (code nodes, the viewer drawer).
 * Pure and deterministic. Syntax tokens come from the code-node tokenizer, run per side as one
 * stream per hunk (base = context + del, head = context + add) so block comments / templates that
 * span lines colour correctly; intra-line marks come from a token-level LCS between paired
 * del / add runs.
 */
import type { CodeLine } from "../scene.ts"
import type { CodeLang } from "../spec.ts"
import { codeLines, tokenize } from "../layout/tokenize.ts"
import { capHunks, isMoreMarker } from "./select.ts"
import type { Hunk } from "./types.ts"

export interface DiffRow {
  kind: "context" | "add" | "del" | "hunk" | "fold"
  /** Base-side line number (context, del). */
  old?: number
  /** Head-side line number (context, add). */
  new?: number
  /** Row text (tabs as 2 spaces). hunk: "@@ … @@ section"; fold: "… N more lines". */
  text: string
  /** Syntax tokens (columns into `text`); [] for hunk / fold rows. */
  tokens: CodeLine
  /** Intra-line changed column ranges [start, end) on paired del / add rows. */
  marks?: [number, number][]
  /** 0-based hunk index. */
  hunk: number
}

export interface DiffRowsOptions {
  /** Fold after this many diff lines with a "… N more lines" row (capHunks). Default: no cap. */
  max?: number
  /**
   * Hunk header rows: "auto" (default) shows them unless the diff is a single snippet numbered
   * from line 1 with no section text (a hand-written snippet), "always", or "never".
   */
  headers?: "auto" | "always" | "never"
}

/** Does this hunk list get "@@" header rows? */
export function showHunkHeaders(hunks: Hunk[], headers: DiffRowsOptions["headers"] = "auto"): boolean {
  if (headers !== "auto") return headers === "always"
  return !(hunks.length === 1 && hunks[0].oldStart <= 1 && hunks[0].newStart <= 1 && !hunks[0].section)
}

const expand = (s: string) => codeLines(s)[0] ?? ""

/** Rows for a hunk list. */
export function diffRows(hunks: Hunk[], lang: CodeLang, opts: DiffRowsOptions = {}): DiffRow[] {
  const src = opts.max !== undefined ? capHunks(hunks, opts.max).hunks : hunks
  const headers = showHunkHeaders(src, opts.headers)
  const rows: DiffRow[] = []
  src.forEach((h, hi) => {
    if (headers) rows.push({ kind: "hunk", text: `${h.header}${h.section ? ` ${h.section}` : ""}`, tokens: [], hunk: hi })
    const lines = h.lines.filter((l) => !isMoreMarker(l))
    const base = lines.filter((l) => l.kind !== "add")
    const head = lines.filter((l) => l.kind !== "del")
    const bt = tokenize(base.map((l) => l.text), lang)
    const ht = tokenize(head.map((l) => l.text), lang)
    const bi = new Map(base.map((l, i) => [l, i]))
    const hi2 = new Map(head.map((l, i) => [l, i]))
    const out: DiffRow[] = []
    for (const l of h.lines) {
      if (isMoreMarker(l)) {
        out.push({ kind: "fold", text: l.text, tokens: [], hunk: hi })
        continue
      }
      const tokens = l.kind === "del" ? bt[bi.get(l)!] : ht[hi2.get(l)!]
      out.push({
        kind: l.kind,
        ...(l.old !== undefined ? { old: l.old } : {}),
        ...(l.new !== undefined ? { new: l.new } : {}),
        text: expand(l.text),
        tokens: tokens ?? [],
        hunk: hi,
      })
    }
    markRuns(out)
    rows.push(...out)
  })
  return rows
}

/** Pair each del run with the add run right after it (k-th with k-th) and mark the changed spans. */
function markRuns(rows: DiffRow[]): void {
  let i = 0
  while (i < rows.length) {
    if (rows[i].kind !== "del") {
      i++
      continue
    }
    let j = i
    while (j < rows.length && rows[j].kind === "del") j++
    let k = j
    while (k < rows.length && rows[k].kind === "add") k++
    const dels = rows.slice(i, j)
    const adds = rows.slice(j, k)
    for (let p = 0; p < Math.min(dels.length, adds.length); p++) {
      const m = intraMarks(dels[p].text, adds[p].text)
      if (m) {
        if (m.a.length) dels[p].marks = m.a
        if (m.b.length) adds[p].marks = m.b
      }
    }
    i = k
  }
}

type Tok = { t: string; c: number }
const words = (s: string): Tok[] => [...s.matchAll(/\w+|\s+|[^\w\s]/g)].map((m) => ({ t: m[0], c: m.index! }))

/**
 * Changed column ranges between two lines (token-level LCS). Undefined when the lines share too
 * little for marks to help (under 40% of non-space characters in common).
 */
export function intraMarks(a: string, b: string): { a: [number, number][]; b: [number, number][] } | undefined {
  const A = words(a)
  const B = words(b)
  const n = A.length
  const m = B.length
  if (!n || !m || n * m > 40000) return undefined
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) L[i][j] = A[i].t === B[j].t ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const keepA = new Array<boolean>(n).fill(false)
  const keepB = new Array<boolean>(m).fill(false)
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (A[i].t === B[j].t) {
      keepA[i++] = true
      keepB[j++] = true
    } else if (L[i + 1][j] >= L[i][j + 1]) i++
    else j++
  }
  const solid = (s: string) => s.replace(/\s+/g, "").length
  const common = A.filter((_, i) => keepA[i]).reduce((s, x) => s + solid(x.t), 0)
  if (common < 0.4 * Math.max(solid(a), solid(b))) return undefined
  return { a: ranges(A, keepA), b: ranges(B, keepB) }
}

/** Unkept tokens → merged [start, end) ranges, trimmed of surrounding whitespace. */
function ranges(T: Tok[], keep: boolean[]): [number, number][] {
  const out: [number, number][] = []
  let cur: [number, number] | undefined
  T.forEach((x, i) => {
    if (keep[i]) {
      if (cur) out.push(cur)
      cur = undefined
      return
    }
    if (cur) cur[1] = x.c + x.t.length
    else cur = [x.c, x.c + x.t.length]
  })
  if (cur) out.push(cur)
  const trimmed: [number, number][] = []
  for (const [s0, e0] of out) {
    const text = T.map((x) => x.t).join("")
    let s = s0
    let e = e0
    while (s < e && /\s/.test(text[s])) s++
    while (e > s && /\s/.test(text[e - 1])) e--
    if (e > s) trimmed.push([s, e])
  }
  return trimmed
}
