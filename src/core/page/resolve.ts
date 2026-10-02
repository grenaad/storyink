/** Resolve a page against a DiffSet (`--changes`). Pure: the input page is not mutated. */
import { resolveChanges, EMBED_MAX_LINES } from "../diff/resolve.ts"
import { capHunks, findFile, selectHunks, sideOf } from "../diff/select.ts"
import type { DiffFile, DiffSet, Hunk } from "../diff/types.ts"
import type { Spec } from "../spec.ts"
import type { Diagnostic } from "../validate.ts"
import type { PageChanges } from "./types.ts"

export interface PageResolveOptions {
  /** Max diff lines embedded per file at the page level (default 400). */
  maxLinesPerFile?: number
}

type Obj = Record<string, unknown>
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x)
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/**
 * - runs `resolveChanges` on every figure spec object (diagnostics prefixed with the figure path);
 * - embeds `changes` at the page level: every file's metadata when a `filemap` reads the changes,
 *   and the whole hunks `diff: { file, lines? }` blocks select (capped per file).
 */
export function resolvePageChanges(input: unknown, diffset: DiffSet, opts: PageResolveOptions = {}): { page: unknown; diagnostics: Diagnostic[] } {
  const page = clone(input)
  const diagnostics: Diagnostic[] = []
  if (!isObj(page) || !Array.isArray(page.sections)) return { page, diagnostics }
  let allMeta = false
  const picked = new Map<string, Set<Hunk>>()
  const walk = (blocks: unknown, path: string) => {
    if (!Array.isArray(blocks)) return
    blocks.forEach((b, i) => {
      if (!isObj(b)) return
      const p = `${path}[${i}]`
      const fig = b.figure
      if (isObj(fig) && isObj(fig.spec)) {
        const r = resolveChanges(fig.spec as unknown as Spec, diffset)
        fig.spec = r.spec
        for (const d of r.diagnostics) diagnostics.push({ ...d, path: d.path ? `${p}.figure.spec.${d.path}` : `${p}.figure.spec` })
      }
      if (b.filemap === "changes" || (isObj(b.filemap) && b.filemap.from === "changes")) allMeta = true
      const d = b.diff
      if (isObj(d) && typeof d.file === "string" && d.text === undefined) {
        const f = findFile(diffset, d.file)
        if (!f) diagnostics.push({ severity: "warning", path: `${p}.diff.file`, message: `"${d.file}" is not in the diff`, hint: "check the path against storyink diff output" })
        else {
          const set = picked.get(f.path) ?? new Set<Hunk>()
          picked.set(f.path, set)
          const ref = { path: f.path, ...(d.lines !== undefined ? { lines: d.lines as number | [number, number] } : {}) }
          const hs = selectHunks(diffset, ref, sideOf(ref, f.status === "removed"))
          if (!hs.length) diagnostics.push({ severity: "warning", path: `${p}.diff.lines`, message: `no hunk of "${f.path}" intersects lines ${JSON.stringify(d.lines)}` })
          for (const h of hs) set.add(h)
        }
      }
      if (isObj(b.details)) walk(b.details.blocks, `${p}.details.blocks`)
      if (Array.isArray(b.columns)) b.columns.forEach((c, j) => walk(c, `${p}.columns[${j}]`))
    })
  }
  ;(page.sections as unknown[]).forEach((s, i) => isObj(s) && walk(s.blocks, `sections[${i}].blocks`))
  const max = opts.maxLinesPerFile ?? EMBED_MAX_LINES
  const files: DiffFile[] = []
  for (const f of diffset.files) {
    const set = picked.get(f.path)
    if (!set && !allMeta) continue
    const capped = set ? capHunks(f.hunks.filter((h) => set.has(h)), max) : { hunks: [], more: 0 }
    if (capped.more) diagnostics.push({ severity: "warning", path: "changes", message: `embedded hunks of "${f.path}" capped at ${max} lines (${capped.more} more not embedded)` })
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
  }
  if (files.length) {
    const changes: PageChanges = {
      ...(diffset.base ? { base: diffset.base } : {}),
      ...(diffset.head ? { head: diffset.head } : {}),
      ...(diffset.title ? { title: diffset.title } : {}),
      stats: diffset.stats,
      files,
    }
    page.changes = changes
  }
  return { page, diagnostics }
}
