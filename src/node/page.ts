/** Node helpers for pages: read figure spec paths, apply `--changes`, validate and write. */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { resolvePageChanges } from "../core/page/resolve.ts"
import { renderPageHtml, type PageHtmlOptions } from "../core/page/render.tsx"
import { isPageSpec } from "../core/page/types.ts"
import { validatePage } from "../core/page/validate.ts"
import type { DiffSet } from "../core/diff/types.ts"
import type { Diagnostic } from "../core/validate.ts"
import { fromMermaid } from "../core/mermaid/index.ts"

type Obj = Record<string, unknown>
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x)

/** Is this text / value a page (`"type": "page"`)? */
export function looksLikePage(x: unknown): boolean {
  if (typeof x === "string") {
    try {
      return isPageSpec(JSON.parse(x))
    } catch {
      return false
    }
  }
  return isPageSpec(x)
}

/** A figure spec path: absolute, `file://` URL, `~/…` or relative to the page directory. */
function specFile(p: string, dir: string): string {
  if (/^file:\/\//i.test(p)) return fileURLToPath(p)
  if (p === "~" || p.startsWith("~/")) return path.join(os.homedir(), p.slice(1))
  return path.isAbsolute(p) ? path.normalize(p) : path.resolve(dir, p)
}

/**
 * Replace every figure `spec` path (string) with the parsed diagram spec (JSON, or Mermaid for
 * .mmd / .mermaid), relative to `dir`. Unreadable files become error diagnostics at the figure path.
 */
export function resolvePageFiles(input: unknown, dir: string): { page: unknown; diagnostics: Diagnostic[] } {
  const page = JSON.parse(JSON.stringify(input)) as unknown
  const diagnostics: Diagnostic[] = []
  if (!isObj(page) || !Array.isArray(page.sections)) return { page, diagnostics }
  const walk = (blocks: unknown, p: string) => {
    if (!Array.isArray(blocks)) return
    blocks.forEach((b, i) => {
      if (!isObj(b)) return
      const q = `${p}[${i}]`
      const holder = isObj(b.figure) ? { fig: b.figure, q: `${q}.figure` } : isObj(b.scrolly) && isObj(b.scrolly.figure) ? { fig: b.scrolly.figure, q: `${q}.scrolly.figure` } : undefined
      if (holder && typeof holder.fig.spec === "string") {
        const fig = holder.fig
        const fq = holder.q
        const rel = fig.spec as string
        const file = specFile(rel, dir)
        try {
          const text = fs.readFileSync(file, "utf8")
          if (/\.(mmd|mermaid)$/i.test(file)) {
            const r = fromMermaid(text)
            for (const d of r.diagnostics) diagnostics.push({ ...d, path: `${fq}.spec${d.path ? `.${d.path}` : ""}` })
            if (r.spec) fig.spec = r.spec
          } else {
            const spec = JSON.parse(text) as unknown
            if (isPageSpec(spec)) diagnostics.push({ severity: "error", path: `${fq}.spec`, message: `"${rel}" is a page; figures embed diagram specs`, hint: "link to the other page with a prose [link](other.html) instead" })
            else fig.spec = spec
          }
        } catch (e) {
          diagnostics.push({ severity: "error", path: `${fq}.spec`, message: `could not read figure spec "${rel}": ${(e as Error).message}`, hint: `paths are relative to the page file (${dir})` })
        }
      }
      if (isObj(b.details)) walk(b.details.blocks, `${q}.details.blocks`)
      if (Array.isArray(b.columns)) b.columns.forEach((c, j) => walk(c, `${q}.columns[${j}]`))
    })
  }
  page.sections.forEach((s, i) => isObj(s) && walk(s.blocks, `sections[${i}].blocks`))
  return { page, diagnostics }
}

export interface LoadPageResult {
  ok: boolean
  diagnostics: Diagnostic[]
  /** The resolved raw page (figure files read, changes applied), ready for renderPageHtml. */
  page?: unknown
}

/** Read figure files (relative to `dir`), apply a DiffSet, then validate. */
export function loadPage(input: unknown, dir: string, diffset?: DiffSet): LoadPageResult {
  let raw = input
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw)
    } catch (e) {
      return { ok: false, diagnostics: [{ severity: "error", path: "", message: `page is not valid JSON: ${(e as Error).message}` }] }
    }
  }
  const files = resolvePageFiles(raw, dir)
  const diags = [...files.diagnostics]
  let page = files.page
  if (diffset) {
    const r = resolvePageChanges(page, diffset)
    page = r.page
    diags.push(...r.diagnostics)
  }
  if (diags.some((d) => d.severity === "error")) return { ok: false, diagnostics: diags }
  const v = validatePage(page)
  return { ok: v.ok, diagnostics: [...diags, ...v.diagnostics], ...(v.ok ? { page } : {}) }
}

/** Render a loaded page to an HTML file. */
export function writePage(page: unknown, out: string, opts: PageHtmlOptions = {}): { path: string; bytes: number } {
  const html = renderPageHtml(page, opts)
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
  fs.writeFileSync(out, html)
  return { path: path.resolve(out), bytes: Buffer.byteLength(html) }
}
