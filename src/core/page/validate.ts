/** Page validation: JSON-path diagnostics with hints; never throws. Figure specs use the diagram `validate()`. */
import { validate, type Diagnostic } from "../validate.ts"
import { CODE_LANGS, DELTAS } from "../spec.ts"
import {
  ALIGNS,
  BLOCK_TYPES,
  CALLOUT_TONES,
  CONFIDENCES,
  EVIDENCE_STATUSES,
  FILE_STATUSES,
  SEVERITIES,
  TONES,
  type Block,
  type PageSpec,
  type ValidPage,
} from "./types.ts"

export interface PageValidationResult {
  ok: boolean
  diagnostics: Diagnostic[]
  /** Normalised page (ids filled, figure specs validated) when `ok`. */
  page?: ValidPage
}

type Obj = Record<string, unknown>
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x)
const ID_RE = /^[A-Za-z][A-Za-z0-9_\-]*$/
const PAGE_KEYS = ["$schema", "type", "title", "eyebrow", "subtitle", "summary", "change", "toc", "sections", "changes"]
const SECTION_KEYS = ["id", "title", "eyebrow", "blocks"]
const PROSE_WARN = 4000

const join = (path: string, key: string | number) => (typeof key === "number" ? `${path}[${key}]` : path ? `${path}.${key}` : key)

function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}
function closest(word: string, options: readonly string[]): string | undefined {
  let best: string | undefined
  let bd = Infinity
  for (const o of options) {
    const d = lev(word.toLowerCase(), o.toLowerCase())
    if (d < bd) [best, bd] = [o, d]
  }
  return bd <= Math.max(2, Math.floor(word.length / 3)) ? best : undefined
}

export const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)

class C {
  d: Diagnostic[] = []
  error(path: string, message: string, hint?: string) {
    this.d.push({ severity: "error", path, message, ...(hint ? { hint } : {}) })
  }
  warn(path: string, message: string, hint?: string) {
    this.d.push({ severity: "warning", path, message, ...(hint ? { hint } : {}) })
  }
  /** Fields of `o` outside `allowed`: warnings (ignored), with a did-you-mean. */
  keys(o: Obj, allowed: readonly string[], path: string) {
    for (const k of Object.keys(o))
      if (!allowed.includes(k)) {
        const g = closest(k, allowed)
        this.warn(join(path, k), `unknown field "${k}" is ignored`, g ? `did you mean "${g}"?` : `allowed: ${allowed.join(", ")}`)
      }
  }
  str(o: Obj, key: string, path: string, required = false): void {
    const v = o[key]
    if (v === undefined) {
      if (required) this.error(join(path, key), `missing required field "${key}"`, `add "${key}": "…"`)
      return
    }
    if (typeof v !== "string") this.error(join(path, key), `"${key}" must be a string, got ${Array.isArray(v) ? "array" : typeof v}`)
    else if (required && !v.trim()) this.error(join(path, key), `"${key}" must not be empty`)
    else if (v.length > PROSE_WARN) this.warn(join(path, key), `"${key}" is ${v.length} characters long`, "split long prose into sections, or move detail into a `details` block")
  }
  bool(o: Obj, key: string, path: string) {
    if (o[key] !== undefined && typeof o[key] !== "boolean") this.error(join(path, key), `"${key}" must be true or false`)
  }
  num(o: Obj, key: string, path: string, min = 0) {
    const v = o[key]
    if (v !== undefined && (typeof v !== "number" || !Number.isInteger(v) || v < min)) this.error(join(path, key), `"${key}" must be an integer ≥ ${min}`)
  }
  oneOf(o: Obj, key: string, options: readonly string[], path: string, required = false) {
    const v = o[key]
    if (v === undefined) {
      if (required) this.error(join(path, key), `missing required field "${key}"`, `use one of: ${options.join(", ")}`)
      return
    }
    if (typeof v === "string" && options.includes(v)) return
    const g = typeof v === "string" ? closest(v, options) : undefined
    this.error(join(path, key), `unknown ${key} ${JSON.stringify(v)}`, g ? `did you mean "${g}"? (one of: ${options.join(", ")})` : `use one of: ${options.join(", ")}`)
  }
  refs(o: Obj, key: string, path: string) {
    const v = o[key]
    if (v === undefined) return
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) this.error(join(path, key), `"${key}" must be a list of strings`, `"${key}": ["src/x.ts#L12-20"]`)
  }
  /** A non-empty array of objects; returns the objects with their paths. */
  list(v: unknown, path: string, what: string, example: string): [Obj, string][] {
    if (!Array.isArray(v)) {
      this.error(path, `${what} must be a list`, example)
      return []
    }
    if (!v.length) this.warn(path, `${what} is empty`)
    const out: [Obj, string][] = []
    v.forEach((x, i) => {
      if (isObj(x)) out.push([x, join(path, i)])
      else this.error(join(path, i), `${what} items must be objects`, example)
    })
    return out
  }
}

interface Ctx {
  c: C
  figIds: Map<string, string>
  blockIds: Map<string, string>
  figN: number
  usesChanges: boolean
}

function figureOf(x: Ctx, v: unknown, path: string): unknown {
  const { c } = x
  if (!isObj(v)) {
    c.error(path, `"figure" must be an object`, `"figure": { "spec": "diagram.json", "claim": "…" }`)
    return v
  }
  c.keys(v, ["spec", "claim", "id", "wide"], path)
  c.str(v, "claim", path)
  c.bool(v, "wide", path)
  x.figN++
  let id = `fig-${x.figN}`
  if (v.id !== undefined) {
    if (typeof v.id !== "string" || !ID_RE.test(v.id)) c.error(join(path, "id"), `figure id must match ${ID_RE.source}`, `e.g. "id": "overview"`)
    else id = v.id
  }
  const prev = x.figIds.get(id)
  if (prev) c.error(join(path, "id"), `duplicate figure id "${id}" (also at ${prev})`, "give each figure a unique id")
  else x.figIds.set(id, path)
  const sp = join(path, "spec")
  let spec: unknown = v.spec
  if (spec === undefined) c.error(sp, `missing required field "spec"`, `a diagram spec object, or a path like "diagram.json" (resolved by the CLI)`)
  else if (typeof spec === "string")
    c.error(sp, `figure spec path "${spec}" was not resolved`, "paths are read by the CLI / plugin (relative to the page file); in core, pass the diagram spec object")
  else {
    const r = validate(spec)
    for (const d of r.diagnostics) c.d.push({ ...d, path: d.path ? `${sp}.${d.path}` : sp })
    if (r.spec) spec = r.spec
  }
  return { ...v, id, spec }
}

function blocks(x: Ctx, v: unknown, path: string): Block[] {
  const { c } = x
  if (!Array.isArray(v)) {
    c.error(path, `"blocks" must be a list of blocks`, `"blocks": [{ "prose": "…" }]`)
    return []
  }
  return v.map((b, i) => block(x, b, join(path, i)))
}

function block(x: Ctx, b: unknown, path: string): Block {
  const { c } = x
  if (!isObj(b)) {
    c.error(path, "a block must be an object with one type key", `e.g. { "prose": "…" } (types: ${BLOCK_TYPES.join(", ")})`)
    return b as Block
  }
  const types = Object.keys(b).filter((k) => (BLOCK_TYPES as readonly string[]).includes(k))
  for (const k of Object.keys(b))
    if (k !== "id" && !(BLOCK_TYPES as readonly string[]).includes(k)) {
      const g = closest(k, BLOCK_TYPES)
      c.error(join(path, k), `unknown block key "${k}"`, g ? `did you mean "${g}"? (types: ${BLOCK_TYPES.join(", ")})` : `types: ${BLOCK_TYPES.join(", ")}`)
    }
  if (b.id !== undefined) {
    if (typeof b.id !== "string" || !ID_RE.test(b.id)) c.error(join(path, "id"), `block id must match ${ID_RE.source}`)
    else if (x.blockIds.has(b.id)) c.error(join(path, "id"), `duplicate id "${b.id}" (also at ${x.blockIds.get(b.id)})`)
    else x.blockIds.set(b.id, path)
  }
  if (types.length !== 1) {
    if (types.length === 0) c.error(path, "block has no type key", `use one of: ${BLOCK_TYPES.join(", ")}`)
    else c.error(path, `block has ${types.length} type keys (${types.join(", ")})`, "split it into one block per type")
    return b as Block
  }
  const t = types[0]
  const p = join(path, t)
  const v = b[t]
  const ex = (s: string) => `e.g. "${t}": ${s}`
  switch (t) {
    case "prose":
      if (typeof v !== "string") c.error(p, `"prose" must be a string (a Markdown subset)`)
      else if (v.length > PROSE_WARN) c.warn(p, `prose block is ${v.length} characters long`, "split it, or move detail into `details`")
      break
    case "figure":
      return { ...b, figure: figureOf(x, v, p) } as Block
    case "kpis":
      for (const [o, q] of c.list(v, p, "kpis", ex(`[{ "label": "Files", "value": 12 }]`))) {
        c.keys(o, ["label", "value", "detail", "tone"], q)
        c.str(o, "label", q, true)
        if (typeof o.value !== "string" && typeof o.value !== "number") c.error(join(q, "value"), `"value" must be a string or number`)
        c.str(o, "detail", q)
        c.oneOf(o, "tone", TONES, q)
      }
      if (Array.isArray(v) && v.length > 6) c.warn(p, `${v.length} KPIs; more than 6 is hard to scan`, "keep the 3–5 numbers that carry the story")
      break
    case "table": {
      if (!isObj(v)) {
        c.error(p, `"table" must be an object`, ex(`{ "columns": ["A", "B"], "rows": [["1", "2"]] }`))
        break
      }
      c.keys(v, ["columns", "rows", "caption"], p)
      c.str(v, "caption", p)
      const cols = Array.isArray(v.columns) ? v.columns : []
      if (!Array.isArray(v.columns)) c.error(join(p, "columns"), `"columns" must be a list`)
      cols.forEach((col, i) => {
        const q = join(join(p, "columns"), i)
        if (typeof col === "string") return
        if (!isObj(col)) return c.error(q, "a column is a string or { label, align? }")
        c.keys(col, ["label", "align"], q)
        c.str(col, "label", q, true)
        c.oneOf(col, "align", ALIGNS, q)
      })
      if (!Array.isArray(v.rows)) c.error(join(p, "rows"), `"rows" must be a list of rows (lists of cells)`)
      else
        v.rows.forEach((row, ri) => {
          const q = join(join(p, "rows"), ri)
          if (!Array.isArray(row)) return c.error(q, "a row must be a list of cells")
          if (cols.length && row.length !== cols.length) c.warn(q, `row has ${row.length} cells for ${cols.length} columns`)
          row.forEach((cell, ci) => {
            const cq = join(q, ci)
            if (typeof cell === "string" || typeof cell === "number") return
            if (!isObj(cell)) return c.error(cq, "a cell is a string, a number or { text, tone?, badge?, code? }")
            c.keys(cell, ["text", "tone", "badge", "code"], cq)
            c.str(cell, "text", cq, true)
            c.oneOf(cell, "tone", TONES, cq)
            c.bool(cell, "badge", cq)
            c.bool(cell, "code", cq)
          })
        })
      break
    }
    case "cards":
      for (const [o, q] of c.list(v, p, "cards", ex(`[{ "title": "…", "body": "…" }]`))) {
        c.keys(o, ["title", "body", "tag", "tone", "delta"], q)
        c.str(o, "title", q, true)
        c.str(o, "body", q, true)
        c.str(o, "tag", q)
        c.oneOf(o, "tone", TONES, q)
        c.oneOf(o, "delta", DELTAS, q)
      }
      break
    case "callout":
      if (!isObj(v)) {
        c.error(p, `"callout" must be an object`, ex(`{ "tone": "warn", "body": "…" }`))
        break
      }
      c.keys(v, ["tone", "title", "body"], p)
      c.oneOf(v, "tone", CALLOUT_TONES, p, true)
      c.str(v, "title", p)
      c.str(v, "body", p, true)
      break
    case "filemap":
      if (v === "changes") x.usesChanges = true
      else if (isObj(v) && v.from !== undefined) {
        c.keys(v, ["from", "notes"], p)
        if (v.from !== "changes") c.error(join(p, "from"), `"from" must be "changes"`)
        if (v.notes !== undefined && (!isObj(v.notes) || Object.values(v.notes).some((n) => typeof n !== "string"))) c.error(join(p, "notes"), `"notes" must map paths to strings`)
        x.usesChanges = true
      } else if (isObj(v)) {
        c.keys(v, ["files"], p)
        for (const [o, q] of c.list(v.files, join(p, "files"), "files", `"files": [{ "path": "src/a.ts", "status": "modified", "add": 3, "del": 1 }]`)) {
          c.keys(o, ["path", "status", "add", "del", "note"], q)
          c.str(o, "path", q, true)
          c.oneOf(o, "status", FILE_STATUSES, q, true)
          c.num(o, "add", q)
          c.num(o, "del", q)
          c.str(o, "note", q)
        }
      } else c.error(p, `"filemap" must be "changes", { "files": [...] } or { "from": "changes", "notes"? }`)
      break
    case "diff":
      if (!isObj(v)) {
        c.error(p, `"diff" must be an object`, ex(`{ "file": "src/a.ts", "lines": [10, 30] } or { "text": "@@ -1 +1 @@\\n-a\\n+b" }`))
        break
      }
      if (v.text !== undefined) {
        c.keys(v, ["text", "file", "lang", "max"], p)
        c.str(v, "text", p, true)
        c.str(v, "file", p)
        c.oneOf(v, "lang", CODE_LANGS, p)
      } else {
        c.keys(v, ["file", "lines", "context", "max"], p)
        c.str(v, "file", p, true)
        const l = v.lines
        const pi = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 1
        if (l !== undefined && !pi(l) && !(Array.isArray(l) && l.length === 2 && pi(l[0]) && pi(l[1]))) c.error(join(p, "lines"), `"lines" must be a line number or [from, to]`, `"lines": [10, 30]`)
        c.num(v, "context", p)
        x.usesChanges = true
      }
      c.num(v, "max", p, 1)
      break
    case "code":
      if (!isObj(v)) {
        c.error(p, `"code" must be an object`, ex(`{ "code": ["const a = 1"], "lang": "ts" }`))
        break
      }
      c.keys(v, ["code", "lang", "file", "start"], p)
      if (typeof v.code !== "string" && !(Array.isArray(v.code) && v.code.every((l) => typeof l === "string"))) c.error(join(p, "code"), `"code" must be a string or a list of lines`)
      c.oneOf(v, "lang", CODE_LANGS, p)
      c.str(v, "file", p)
      c.num(v, "start", p, 1)
      break
    case "risks":
      for (const [o, q] of c.list(v, p, "risks", ex(`[{ "risk": "…", "severity": "medium" }]`))) {
        c.keys(o, ["risk", "severity", "area", "mitigation", "refs"], q)
        c.str(o, "risk", q, true)
        c.oneOf(o, "severity", SEVERITIES, q, true)
        c.str(o, "area", q)
        c.str(o, "mitigation", q)
        c.refs(o, "refs", q)
      }
      break
    case "decisions":
      for (const [o, q] of c.list(v, p, "decisions", ex(`[{ "decision": "…", "confidence": "sourced" }]`))) {
        c.keys(o, ["decision", "why", "confidence", "refs"], q)
        c.str(o, "decision", q, true)
        c.str(o, "why", q)
        c.oneOf(o, "confidence", CONFIDENCES, q, true)
        c.refs(o, "refs", q)
        if (o.confidence === "sourced" && !(Array.isArray(o.refs) && o.refs.length)) c.warn(join(q, "refs"), `a "sourced" decision has no refs`, "cite the file:line, doc or PR it comes from, or mark it inferred")
      }
      break
    case "evidence":
      for (const [o, q] of c.list(v, p, "evidence", ex(`[{ "claim": "…", "source": "src/x.ts#L12" }]`))) {
        c.keys(o, ["claim", "source", "status"], q)
        c.str(o, "claim", q, true)
        c.str(o, "source", q, true)
        c.oneOf(o, "status", EVIDENCE_STATUSES, q)
      }
      break
    case "timeline":
      for (const [o, q] of c.list(v, p, "timeline", ex(`[{ "when": "Week 1", "title": "…" }]`))) {
        c.keys(o, ["when", "title", "body", "tone"], q)
        c.str(o, "when", q, true)
        c.str(o, "title", q, true)
        c.str(o, "body", q)
        c.oneOf(o, "tone", TONES, q)
      }
      break
    case "checklist":
      for (const [o, q] of c.list(v, p, "checklist", ex(`[{ "text": "…", "done": true }]`))) {
        c.keys(o, ["text", "done", "note"], q)
        c.str(o, "text", q, true)
        c.bool(o, "done", q)
        c.str(o, "note", q)
      }
      break
    case "details":
      if (!isObj(v)) {
        c.error(p, `"details" must be an object`, ex(`{ "summary": "…", "blocks": [ … ] }`))
        break
      }
      c.keys(v, ["summary", "blocks"], p)
      c.str(v, "summary", p, true)
      return { ...b, details: { ...v, blocks: blocks(x, v.blocks, join(p, "blocks")) } } as Block
    case "columns":
      if (!Array.isArray(v) || v.some((col) => !Array.isArray(col))) {
        c.error(p, `"columns" must be a list of 2–3 block lists`, ex(`[[{ "figure": … }], [{ "figure": … }]]`))
        break
      }
      if (v.length < 2 || v.length > 3) c.error(p, `"columns" takes 2 or 3 columns, got ${v.length}`)
      return { ...b, columns: v.map((col, i) => blocks(x, col, join(p, i))) } as Block
  }
  return b as Block
}

/** Validate a page (parsed JSON or a JSON string). Never throws. */
export function validatePage(input: unknown): PageValidationResult {
  const c = new C()
  let value = input
  if (typeof input === "string") {
    try {
      value = JSON.parse(input)
    } catch (e) {
      c.error("", `page is not valid JSON: ${(e as Error).message}`)
      return { ok: false, diagnostics: c.d }
    }
  }
  if (!isObj(value)) {
    c.error("", "page must be a JSON object", `start with { "type": "page", "title": "…", "sections": [ … ] }`)
    return { ok: false, diagnostics: c.d }
  }
  if (value.type !== "page") c.error("type", `a page has "type": "page", got ${JSON.stringify(value.type)}`, "diagram specs are validated with validate()")
  c.keys(value, PAGE_KEYS, "")
  c.str(value, "title", "", true)
  for (const k of ["eyebrow", "subtitle", "summary", "$schema"]) c.str(value, k, "")
  c.bool(value, "toc", "")
  if (value.change !== undefined) {
    if (!isObj(value.change)) c.error("change", `"change" must be an object`, `"change": { "base": "main", "head": "feat/x" }`)
    else {
      c.keys(value.change, ["base", "head", "title", "url"], "change")
      for (const k of ["base", "head", "title", "url"]) c.str(value.change, k, "change")
    }
  }
  if (value.changes !== undefined && !(isObj(value.changes) && Array.isArray(value.changes.files)))
    c.error("changes", `"changes" must be { files: [...] } (written by --changes; don't hand-write it)`)
  const x: Ctx = { c, figIds: new Map(), blockIds: new Map(), figN: 0, usesChanges: false }
  const secIds = new Map<string, string>()
  let sections: ValidPage["sections"] = []
  if (!Array.isArray(value.sections)) c.error("sections", `missing required list "sections"`, `"sections": [{ "title": "What changed", "blocks": [ … ] }]`)
  else {
    if (!value.sections.length) c.warn("sections", "page has no sections")
    sections = value.sections.map((s, i) => {
      const p = join("sections", i)
      if (!isObj(s)) {
        c.error(p, "a section must be an object", `{ "title": "…", "blocks": [ … ] }`)
        return { id: `section-${i + 1}`, title: "", blocks: [] }
      }
      c.keys(s, SECTION_KEYS, p)
      c.str(s, "title", p, true)
      c.str(s, "eyebrow", p)
      let id = (typeof s.title === "string" && slug(s.title)) || `section-${i + 1}`
      if (s.id !== undefined) {
        if (typeof s.id !== "string" || !ID_RE.test(s.id)) c.error(join(p, "id"), `section id must match ${ID_RE.source}`, `e.g. "id": "risks"`)
        else id = s.id
      } else if (!/^[a-z]/.test(id)) id = `section-${id}`
      if (secIds.has(id)) {
        if (s.id !== undefined) c.error(join(p, "id"), `duplicate section id "${id}" (also at ${secIds.get(id)})`)
        else id = `${id}-${i + 1}`
      }
      secIds.set(id, p)
      if (s.blocks === undefined) c.error(join(p, "blocks"), `missing required list "blocks"`, `"blocks": [{ "prose": "…" }]`)
      return { ...(s as object), id, blocks: s.blocks === undefined ? [] : blocks(x, s.blocks, join(p, "blocks")) } as ValidPage["sections"][number]
    })
  }
  for (const [id, p] of x.blockIds) if (secIds.has(id) || x.figIds.has(id)) c.error(`${p}.id`, `id "${id}" is also a section or figure id`)
  if (x.usesChanges && !isObj(value.changes)) c.warn("changes", "filemap / diff blocks read the embedded diff, but the page has none", "render with --changes changes.json (storyink diff -o changes.json)")
  if (x.figIds.size > 4) c.warn("sections", `${x.figIds.size} figures; pages read best with 1–3`, "one figure per claim; move the rest to their own pages")
  const ok = !c.d.some((d) => d.severity === "error")
  return { ok, diagnostics: c.d, ...(ok ? { page: { ...(value as unknown as PageSpec), sections } as ValidPage } : {}) }
}
