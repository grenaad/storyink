/** Resolve a spec against a DiffSet (`--changes`). Pure: the input spec is not mutated. */
import type { DiffRef, EmbeddedChanges, FileRef, Spec } from "../spec.ts"
import type { Diagnostic } from "../validate.ts"
import { coverage, specRefs } from "./coverage.ts"
import { langForPath } from "./lang.ts"
import { capHunks, findFile, rangeOf, selectHunks, sideOf, statFor, toFileRef } from "./select.ts"
import type { DiffFile, DiffSet, Hunk } from "./types.ts"

export interface ResolveOptions {
  /** Max diff lines embedded per file in `changes` (default 400; a "… N more lines" row marks the cut). */
  maxLinesPerFile?: number
  /** Context lines kept around a `diff: { file, lines }` range (default 3; the node's `context` wins). */
  context?: number
}

export interface ResolveResult {
  spec: Spec
  diagnostics: Diagnostic[]
}

export const EMBED_MAX_LINES = 400

type El = Record<string, unknown>

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** Refs of a removed element without a revision read base-side numbers. */
const sided = (ref: FileRef, removed: boolean): FileRef => (removed && !ref.revision ? { ...ref, revision: "base" } : ref)

/**
 * Resolve a spec against a parsed diff:
 * - fill `stat` on nodes / edges / messages that have `files` but no `stat`;
 * - resolve code nodes' `diff: { file, lines?, context?, max? }` to `{ file, hunks, … }` (and set
 *   `lang` from the path when the node has none);
 * - embed `changes: { base, head, files }` with only the hunks the elements reference (capped per file);
 * - return coverage warnings.
 */
export function resolveChanges(input: Spec, diffset: DiffSet, opts: ResolveOptions = {}): ResolveResult {
  const spec = clone(input)
  const cov = coverage(diffset, spec)
  const diagnostics: Diagnostic[] = [...cov.diagnostics]
  const s = spec as unknown as Record<string, unknown>

  for (const key of ["nodes", "edges", "messages"]) {
    const list = s[key]
    if (!Array.isArray(list)) continue
    for (const el of list as El[]) {
      if (!el || typeof el !== "object") continue
      const removed = el.delta === "removed"
      // stat
      if (Array.isArray(el.files) && el.stat === undefined) {
        const refs = (el.files as unknown[])
          .filter((f) => typeof f === "string" || (f && typeof f === "object" && typeof (f as FileRef).path === "string"))
          .map((f) => sided(toFileRef(f as FileRef), removed))
          .filter((r) => findFile(diffset, r.path))
        if (refs.length) el.stat = statFor(diffset, refs)
      }
      // diff code nodes
      const d = el.diff as DiffRef | undefined
      if (key === "nodes" && d && typeof d === "object" && typeof d.file === "string" && !Array.isArray(d.hunks)) {
        const f = findFile(diffset, d.file)
        if (!f) continue // coverage already warned
        const ref = sided({ path: f.path, ...(d.lines !== undefined ? { lines: d.lines } : {}) }, removed)
        const ctx = typeof d.context === "number" ? d.context : (opts.context ?? 3)
        const hunks = rangeOf(ref.lines) ? selectHunks(diffset, ref, sideOf(ref), { context: ctx }) : f.hunks
        el.diff = { ...d, file: f.path, hunks: clone(hunks) }
        if (el.lang === undefined) el.lang = f.lang ?? langForPath(f.path)
      }
    }
  }

  // Embedded hunks: every hunk any element references (whole hunks), capped per file.
  const max = opts.maxLinesPerFile ?? EMBED_MAX_LINES
  const picked = new Map<string, Set<Hunk>>()
  for (const r of specRefs(input)) {
    const f = findFile(diffset, r.ref.path)
    if (!f) continue
    const set = picked.get(f.path) ?? new Set<Hunk>()
    picked.set(f.path, set)
    for (const h of selectHunks(diffset, r.ref, sideOf(r.ref, r.removed))) set.add(h)
  }
  const files: DiffFile[] = []
  for (const f of diffset.files) {
    const set = picked.get(f.path)
    if (!set) continue
    const capped = capHunks(
      f.hunks.filter((h) => set.has(h)),
      max,
    )
    files.push({
      path: f.path,
      ...(f.oldPath ? { oldPath: f.oldPath } : {}),
      status: f.status,
      ...(f.binary ? { binary: true as const } : {}),
      add: f.add,
      del: f.del,
      hunks: clone(capped.hunks),
      ...(f.lang ? { lang: f.lang } : {}),
    })
    if (capped.more) diagnostics.push({ severity: "warning", path: "changes", message: `embedded hunks of "${f.path}" capped at ${max} lines (${capped.more} more not embedded)` })
  }
  if (files.length) {
    const changes: EmbeddedChanges = { ...(diffset.base ? { base: diffset.base } : {}), ...(diffset.head ? { head: diffset.head } : {}), files }
    s.changes = changes
  }
  return { spec, diagnostics }
}
