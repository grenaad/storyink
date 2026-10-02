/** Which parts of a DiffSet a spec's elements reference. Pure and browser-safe. */
import type { DiffRef, FileRef, Spec } from "../spec.ts"
import type { Diagnostic } from "../validate.ts"
import { findFile, rangeOf, selectHunks, sideOf, toFileRef } from "./select.ts"
import type { DiffSet } from "./types.ts"

/** One file reference made by a spec element. */
export interface SpecRef {
  /** JSON path of the reference (`nodes[2].files[0]`, `nodes[3].diff`). */
  path: string
  /** JSON path of the element (`nodes[2]`). */
  element: string
  ref: FileRef
  /** The element is `delta: "removed"` (bare ranges are base-side). */
  removed: boolean
}

type Loose = { files?: unknown; diff?: unknown; delta?: unknown; kind?: unknown }

/** Every `files` entry and `diff: { file }` reference in a spec (graph nodes / edges, messages). */
export function specRefs(spec: Spec): SpecRef[] {
  const out: SpecRef[] = []
  const s = spec as unknown as Record<string, unknown>
  for (const key of ["nodes", "edges", "messages", "participants", "groups"]) {
    const list = s[key]
    if (!Array.isArray(list)) continue
    list.forEach((el: Loose, i) => {
      if (!el || typeof el !== "object") return
      const element = `${key}[${i}]`
      const removed = el.delta === "removed"
      if (Array.isArray(el.files))
        el.files.forEach((f, j) => {
          if (typeof f === "string" ? f : f && typeof f === "object" && typeof (f as FileRef).path === "string")
            out.push({ path: `${element}.files[${j}]`, element, ref: toFileRef(f as FileRef), removed })
        })
      const d = el.diff as DiffRef | undefined
      if (d && typeof d === "object" && typeof d.file === "string" && !Array.isArray(d.hunks))
        out.push({ path: `${element}.diff`, element, ref: { path: d.file, ...(d.lines !== undefined ? { lines: d.lines } : {}) }, removed })
    })
  }
  return out
}

export interface CoverageFile {
  path: string
  status: string
  hunks: number
  /** Indexes of hunks referenced by at least one element. */
  claimed: number[]
  /** Referenced at all (a whole-file ref claims every hunk). */
  referenced: boolean
}

export interface Coverage {
  files: CoverageFile[]
  claimed: { files: number; hunks: number }
  unclaimed: { files: string[]; hunks: { path: string; index: number; header: string }[] }
  diagnostics: Diagnostic[]
}

const list = (xs: string[], n = 8) => xs.slice(0, n).join(", ") + (xs.length > n ? `, … (+${xs.length - n})` : "")

/**
 * Coverage of a diff by a spec: claimed / unclaimed files and hunks, plus warnings for refs whose
 * path is not in the diff or whose range touches no hunk, and summaries of what nothing references.
 */
export function coverage(diffset: DiffSet, spec: Spec): Coverage {
  const diagnostics: Diagnostic[] = []
  const claimed = new Map<string, Set<number>>()
  for (const r of specRefs(spec)) {
    const f = findFile(diffset, r.ref.path)
    if (!f) {
      diagnostics.push({ severity: "warning", path: r.path, message: `"${r.ref.path}" is not in the diff`, hint: "use a repo-relative path from `storyink diff`, or regenerate the changes file" })
      continue
    }
    const set = claimed.get(f.path) ?? new Set<number>()
    claimed.set(f.path, set)
    if (!rangeOf(r.ref.lines)) {
      f.hunks.forEach((_, i) => set.add(i))
      continue
    }
    const hs = selectHunks(diffset, r.ref, sideOf(r.ref, r.removed))
    if (!hs.length) {
      const side = sideOf(r.ref, r.removed)
      diagnostics.push({
        severity: "warning",
        path: r.path,
        message: `lines ${JSON.stringify(r.ref.lines)} of "${r.ref.path}" touch no hunk (${side} side)`,
        hint: side === "head" ? 'head-side line numbers; use revision: "base" for removed code' : "base-side line numbers (removed element or revision: \"base\")",
      })
    }
    for (const h of hs) set.add(f.hunks.indexOf(h))
  }
  const files: CoverageFile[] = diffset.files.map((f) => {
    const set = claimed.get(f.path)
    return { path: f.path, status: f.status, hunks: f.hunks.length, claimed: set ? [...set].sort((a, b) => a - b) : [], referenced: !!set }
  })
  const unFiles = files.filter((f) => !f.referenced).map((f) => f.path)
  const unHunks = diffset.files.flatMap((f) => {
    const set = claimed.get(f.path)
    return set ? f.hunks.map((h, index) => ({ path: f.path, index, header: h.header })).filter((h) => !set.has(h.index)) : []
  })
  if (unFiles.length)
    diagnostics.push({ severity: "warning", path: "", message: `${unFiles.length} changed file${unFiles.length === 1 ? "" : "s"} not referenced by any element: ${list(unFiles)}`, hint: "add them to an element's `files`, or ignore if they are out of scope" })
  if (unHunks.length)
    diagnostics.push({ severity: "warning", path: "", message: `${unHunks.length} hunk${unHunks.length === 1 ? "" : "s"} in referenced files not covered by any range: ${list(unHunks.map((h) => `${h.path} ${h.header}`), 5)}` })
  return {
    files,
    claimed: { files: files.filter((f) => f.referenced).length, hunks: files.reduce((s, f) => s + f.claimed.length, 0) },
    unclaimed: { files: unFiles, hunks: unHunks },
    diagnostics,
  }
}
