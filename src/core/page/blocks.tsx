/** Page blocks as SSR React. Figures embed `renderFigure(scene, { id }).html` untouched. */
import type { ReactElement, ReactNode } from "react"
import { findFile, langForPath, parseHunks, selectHunks, sideOf, type DiffFile, type DiffSet, type Hunk } from "../diff/index.ts"
import { tokenize } from "../layout/tokenize.ts"
import { renderFigure } from "../render/figure.tsx"
import { DiffView, RowCode } from "../render/DiffView.tsx"
import type { Scene } from "../scene.ts"
import { CODE_LANGS, type CodeLang, type Delta } from "../spec.ts"
import { Inline, Prose } from "./prose.tsx"
import type { ScrollyInfo } from "./slides.ts"
import { blockType, type ScrollyBlock, type Block, type Cell, type CodeBlock, type DiffBlock, type FigureBlock, type FilemapBlock, type MapFile, type PageChanges, type Tone } from "./types.ts"

export interface RenderCtx {
  scenes: Map<string, Scene>
  changes?: PageChanges
  /** Resolved scrolly steps by block id. */
  scrollies?: Map<string, ScrollyInfo>
}

const DIFF_MAX = 120
const FILEMAP_OPEN = 16
const STATUS_GLYPH: Record<string, string> = { added: "A", modified: "M", removed: "D", renamed: "R", copied: "C" }
const STATUS_TONE: Record<string, Tone> = { added: "good", modified: "warn", removed: "risk", renamed: "note", copied: "note" }
const DELTA_TONE: Record<Delta, Tone> = { added: "good", modified: "warn", removed: "risk", unchanged: "neutral" }
const DELTA_LABEL: Record<Delta, string> = { added: "new", modified: "changed", removed: "removed", unchanged: "unchanged" }
const SEV_TONE: Record<string, Tone> = { low: "neutral", medium: "warn", high: "risk", critical: "risk" }
const CONF_TONE: Record<string, Tone> = { sourced: "good", inferred: "warn", unknown: "neutral" }
const EV_TONE: Record<string, Tone> = { verified: "good", corrected: "warn", unsupported: "risk", unverifiable: "neutral" }

const tc = (t: Tone | undefined) => (t ? ` sp-tone-${t}` : "")
const MINUS = "\u2212"

/** Wide blocks break out of the prose measure. */
const WIDE = new Set(["figure", "kpis", "table", "cards", "filemap", "diff", "code", "risks", "decisions", "evidence", "timeline", "columns", "details"])

/** A `path#L12-20` / `path:12` ref as mono; anything else as inline prose. */
export function Ref({ text }: { text: string }): ReactElement {
  const m = /^([\w@.\-/]+\.[\w]+|[\w@.\-]+\/[\w@.\-/]*)(?:#L(\d+)(?:-L?(\d+))?|:(\d+)(?:-(\d+))?)?$/.exec(text.trim())
  if (!m) return <span className="sp-ref-text"><Inline text={text} /></span>
  const a = m[2] ?? m[4]
  const b = m[3] ?? m[5]
  return (
    <code className="sp-ref">
      {m[1]}
      {a ? <span className="sp-ref-l">:{a}{b ? `\u2013${b}` : ""}</span> : null}
    </code>
  )
}

const Chip = ({ tone, children }: { tone?: Tone; children: ReactNode }) => <span className={`sp-chip${tc(tone)}`}>{children}</span>

function cellOf(c: Cell): { text: string; tone?: Tone; badge?: boolean; code?: boolean } {
  return typeof c === "object" ? c : { text: String(c) }
}

const asDiffSet = (ch: PageChanges | undefined): DiffSet | undefined => (ch?.files?.length ? { version: 1, files: ch.files, stats: ch.stats ?? { files: ch.files.length, add: 0, del: 0 } } : undefined)
const langOf = (l: unknown, path: string | undefined): CodeLang => ((CODE_LANGS as readonly string[]).includes(l as string) ? (l as CodeLang) : path ? langForPath(path) : "text")

/**
 * Wide diagrams break out of the column by default (`wide` overrides): when the column width (not
 * the ~810 px figure height cap) limits the fit and node labels (11 px) would draw under ~9 px.
 */
const autoWide = (scene: Scene): boolean => {
  const kW = (1080 - 64) / (scene.viewBox.w + 64)
  const kH = (810 - 120) / (scene.viewBox.h + 64)
  return kW < kH && kW * 11 < 9
}

export function Figure({ f, ctx }: { f: FigureBlock; ctx: RenderCtx }): ReactElement {
  const id = f.id!
  const scene = ctx.scenes.get(id)!
  return (
    <figure className={`sp-b sp-wide sp-fig${f.wide ?? autoWide(scene) ? " sp-fig-wide" : ""}`} id={`fig-${id}`} data-fig={id}>
      <div className="sp-fig-root" data-si-fig={id} dangerouslySetInnerHTML={{ __html: renderFigure(scene, { id }).html }} />
      {f.claim ? (
        <figcaption className="sp-cap">
          <Inline text={f.claim} />
        </figcaption>
      ) : null}
    </figure>
  )
}

// ---- file map

interface Node {
  name: string
  files: MapFile[]
  dirs: Map<string, Node>
}
const sum = (fs: MapFile[]) => fs.reduce((s, f) => ({ add: s.add + (f.add ?? 0), del: s.del + (f.del ?? 0) }), { add: 0, del: 0 })
function allFiles(n: Node): MapFile[] {
  return [...n.files, ...[...n.dirs.values()].flatMap(allFiles)]
}
function tree(files: MapFile[]): Node {
  const root: Node = { name: "", files: [], dirs: new Map() }
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const parts = f.path.split("/")
    let n = root
    for (const p of parts.slice(0, -1)) {
      if (!n.dirs.has(p)) n.dirs.set(p, { name: p, files: [], dirs: new Map() })
      n = n.dirs.get(p)!
    }
    n.files.push(f)
  }
  // Collapse single-child directory chains ("src/core/").
  const squash = (n: Node): Node => {
    for (const [k, d] of [...n.dirs]) {
      let x = d
      while (!x.files.length && x.dirs.size === 1) {
        const [c] = x.dirs.values()
        x = { name: `${x.name}/${c.name}`, files: c.files, dirs: c.dirs }
      }
      n.dirs.set(k, squash(x))
    }
    return n
  }
  return squash(root)
}

function Counts({ add, del }: { add?: number; del?: number }): ReactElement {
  return (
    <span className="sp-fm-n">
      {add !== undefined ? <span className="sp-add">+{add}</span> : null}
      {add !== undefined && del !== undefined ? " " : null}
      {del !== undefined ? <span className="sp-del">{MINUS}{del}</span> : null}
    </span>
  )
}

function Bar({ add, del, max }: { add: number; del: number; max: number }): ReactElement {
  const w = (n: number) => `${max ? Math.max(n ? 2 : 0, Math.round((1000 * n) / max) / 10) : 0}%`
  return (
    <span className="sp-bar" aria-hidden="true">
      <i className="sp-bar-a" style={{ width: w(add) }} />
      <i className="sp-bar-d" style={{ width: w(del) }} />
    </span>
  )
}

function TreeView({ n, max, notes }: { n: Node; max: number; notes: Record<string, string> }): ReactElement {
  return (
    <ul className="sp-tree">
      {[...n.dirs.values()].map((d) => {
        const s = sum(allFiles(d))
        return (
          <li key={`d:${d.name}`} className="sp-fm-dir">
            <div className="sp-fm-row">
              <span className="sp-fm-name">{d.name}/</span>
              <Counts add={s.add || undefined} del={s.del || undefined} />
              <span />
            </div>
            <TreeView n={d} max={max} notes={notes} />
          </li>
        )
      })}
      {n.files.map((f) => (
        <li key={f.path} className={`sp-fm-file${tc(STATUS_TONE[f.status])}`}>
          <div className="sp-fm-row" title={`${f.status}: ${f.path}`}>
            <span className="sp-fm-st" aria-label={f.status}>{STATUS_GLYPH[f.status] ?? "?"}</span>
            <span className="sp-fm-name">
              {f.path.split("/").pop()}
              {(notes[f.path] ?? f.note) ? <span className="sp-fm-note"><Inline text={notes[f.path] ?? f.note!} /></span> : null}
            </span>
            <Counts add={f.add} del={f.del} />
            <Bar add={f.add ?? 0} del={f.del ?? 0} max={max} />
          </div>
        </li>
      ))}
    </ul>
  )
}

function Filemap({ fm, ctx }: { fm: FilemapBlock; ctx: RenderCtx }): ReactElement {
  const fromChanges = fm === "changes" || (typeof fm === "object" && "from" in fm)
  const notes = typeof fm === "object" && "notes" in fm && fm.notes ? fm.notes : {}
  const files: MapFile[] = fromChanges
    ? (ctx.changes?.files ?? []).map((f: DiffFile) => ({ path: f.path, status: f.status, add: f.add, del: f.del }))
    : (fm as { files: MapFile[] }).files
  if (!files.length) return <p className="sp-note">{fromChanges ? "No embedded changes (render with --changes)." : "No files."}</p>
  const s = sum(files)
  const max = Math.max(1, ...files.map((f) => (f.add ?? 0) + (f.del ?? 0)))
  const by = (st: string) => files.filter((f) => f.status === st).length
  const legend = (["added", "modified", "removed", "renamed"] as const).filter((st) => by(st))
  const body = <TreeView n={tree(files)} max={max} notes={notes} />
  return (
    <div className="sp-fm">
      <div className="sp-fm-head">
        <span>
          <b>{files.length}</b> file{files.length === 1 ? "" : "s"}
        </span>
        <Counts add={s.add} del={s.del || undefined} />
        <span className="sp-fm-legend">
          {legend.map((st) => (
            <span key={st} className={tc(STATUS_TONE[st]).trim()}>
              <span className="sp-fm-st">{STATUS_GLYPH[st]}</span> {by(st)} {st}
            </span>
          ))}
        </span>
      </div>
      {files.length > FILEMAP_OPEN ? (
        <>
          <p className="sp-fm-sub">Largest changes</p>
          <ul className="sp-tree sp-fm-top">
            {[...files]
              .sort((a, b) => (b.add ?? 0) + (b.del ?? 0) - ((a.add ?? 0) + (a.del ?? 0)) || (a.path < b.path ? -1 : 1))
              .slice(0, 8)
              .map((f) => (
                <li key={f.path} className={`sp-fm-file${tc(STATUS_TONE[f.status])}`}>
                  <div className="sp-fm-row" title={`${f.status}: ${f.path}`}>
                    <span className="sp-fm-st" aria-label={f.status}>{STATUS_GLYPH[f.status] ?? "?"}</span>
                    <span className="sp-fm-name">
                      {f.path}
                      {(notes[f.path] ?? f.note) ? <span className="sp-fm-note"><Inline text={notes[f.path] ?? f.note!} /></span> : null}
                    </span>
                    <Counts add={f.add} del={f.del} />
                    <Bar add={f.add ?? 0} del={f.del ?? 0} max={max} />
                  </div>
                </li>
              ))}
          </ul>
          <details>
            <summary>All {files.length} files by directory</summary>
            {body}
          </details>
        </>
      ) : (
        body
      )}
    </div>
  )
}

// ---- diff / code

function Diff({ d, ctx }: { d: DiffBlock; ctx: RenderCtx }): ReactElement {
  let hunks: Hunk[] = []
  let file: string | undefined = d.file
  let status: string | undefined
  let add: number | undefined
  let del: number | undefined
  let lang: CodeLang
  let missing: string | undefined
  if ("text" in d) {
    hunks = parseHunks(d.text)
    lang = langOf(d.lang, d.file)
    add = hunks.reduce((s, h) => s + h.lines.filter((l) => l.kind === "add").length, 0)
    del = hunks.reduce((s, h) => s + h.lines.filter((l) => l.kind === "del").length, 0)
  } else {
    const ds = asDiffSet(ctx.changes)
    const f = ds ? findFile(ds, d.file) : undefined
    lang = langOf(f?.lang, d.file)
    if (!f) missing = ds ? `${d.file} is not in the embedded diff.` : "No embedded changes (render with --changes)."
    else {
      file = f.path
      status = f.status
      add = f.add
      del = f.del
      const ref = { path: f.path, ...(d.lines !== undefined ? { lines: d.lines } : {}) }
      hunks = d.lines !== undefined ? selectHunks(ds!, ref, sideOf(ref, f.status === "removed"), { context: d.context ?? 3 }) : f.hunks
      if (!hunks.length) missing = `No hunks of ${f.path} in that range.`
    }
  }
  return (
    <div className="sp-diffb">
      {file ? (
        <p className="sp-diffb-head">
          <span>{file}</span>
          {"lines" in d && d.lines !== undefined ? <span className="sp-ref-l">:{typeof d.lines === "number" ? d.lines : `${d.lines[0]}\u2013${d.lines[1]}`}</span> : null}
          {status ? <span className={`sp-chip${tc(STATUS_TONE[status])}`}>{status}</span> : null}
          {add !== undefined || del !== undefined ? <Counts add={add} del={del} /> : null}
        </p>
      ) : null}
      {missing ? <p className="sp-note">{missing}</p> : <DiffView hunks={hunks} lang={lang} max={d.max ?? DIFF_MAX} headers={"text" in d ? "auto" : "always"} />}
    </div>
  )
}

function Code({ c }: { c: CodeBlock }): ReactElement {
  const lang = langOf(c.lang, c.file)
  const lines = tokenize(c.code, lang)
  const src = (Array.isArray(c.code) ? c.code.join("\n") : c.code).replace(/\t/g, "  ").split("\n")
  const start = c.start ?? 1
  return (
    <div className="sp-code">
      {c.file ? (
        <p className="sp-code-head">
          <span>{c.file}</span>
          {c.start ? <span className="sp-ref-l">:{c.start}</span> : null}
        </p>
      ) : null}
      <pre className="sp-code-body">
        {src.map((text, i) => (
          <span key={i} className="sp-code-line">
            <span className="sp-ln">{start + i}</span>
            <span className="sp-code-text">
              <RowCode row={{ kind: "context", text, tokens: lines[i] ?? [], hunk: 0 }} />
              {"\n"}
            </span>
          </span>
        ))}
      </pre>
    </div>
  )
}

const Refs = ({ refs }: { refs?: string[] }) =>
  refs?.length ? (
    <p className="sp-item-refs">
      {refs.map((r, i) => (
        <Ref key={i} text={r} />
      ))}
    </p>
  ) : null

/** Scrollytelling: the figure pinned beside prose step cards (live behaviour comes from the viewer). */
function Scrolly({ sc, ctx }: { sc: ScrollyBlock; ctx: RenderCtx }): ReactElement {
  const info = ctx.scrollies?.get(sc.id!)
  const fig = sc.figure.id!
  const side = sc.side ?? "right"
  return (
    <div className={`sp-b sp-wide sp-scrolly sp-scrolly-${side}`} id={sc.id} data-scrolly={sc.id} data-fig={fig}>
      <div className="sp-scrolly-graphic">
        <Figure f={sc.figure} ctx={ctx} />
      </div>
      <ol className="sp-scrolly-steps">
        {(info?.steps ?? []).map((st, i) => (
          <li key={i} className="sp-scrolly-step" data-step={i}>
            {st.title ? (
              <h4>
                <Inline text={st.title} />
              </h4>
            ) : null}
            <Prose text={st.body} {...(st.cites?.length ? { cites: st.cites } : {})} />
          </li>
        ))}
      </ol>
    </div>
  )
}

/** One block (wrapper carries the block class, width class and optional id). */
export function BlockView({ b, ctx }: { b: Block; ctx: RenderCtx }): ReactElement | null {
  const t = blockType(b)
  if (!t) return null
  const v = (b as Record<string, unknown>)[t] as never
  if (t === "figure") return <Figure f={v} ctx={ctx} />
  if (t === "break") return null
  if (t === "scrolly") return <Scrolly sc={v} ctx={ctx} />
  const cls = `sp-b sp-b-${t}${WIDE.has(t) ? " sp-wide" : ""}`
  const id = b.id ? { id: b.id } : {}
  return (
    <div className={cls} {...id}>
      {inner(t, v, ctx)}
    </div>
  )
}

export function Blocks({ blocks, ctx }: { blocks: Block[]; ctx: RenderCtx }): ReactElement {
  return (
    <>
      {blocks.map((b, i) => (
        <BlockView key={i} b={b} ctx={ctx} />
      ))}
    </>
  )
}

function inner(t: string, v: never, ctx: RenderCtx): ReactNode {
  switch (t) {
    case "prose":
      return <Prose text={v} />
    case "kpis":
      return (
        <div className="sp-kpis">
          {(v as { label: string; value: string | number; detail?: string; tone?: Tone }[]).map((k, i) => (
            <div key={i} className={`sp-kpi${tc(k.tone)}`}>
              <p className="sp-kpi-label">{k.label}</p>
              <p className="sp-kpi-value">{String(k.value)}</p>
              {k.detail ? <p className="sp-kpi-detail"><Inline text={k.detail} /></p> : null}
            </div>
          ))}
        </div>
      )
    case "table": {
      const tb = v as { columns: (string | { label: string; align?: string })[]; rows: Cell[][]; caption?: string }
      const cols = tb.columns.map((c) => (typeof c === "string" ? { label: c } : c))
      const al = (i: number) => (cols[i]?.align === "right" ? "sp-r" : cols[i]?.align === "center" ? "sp-c" : undefined)
      return (
        <>
          <div className="sp-table-wrap">
            <table className="sp-table">
              <thead>
                <tr>
                  {cols.map((c, i) => (
                    <th key={i} className={al(i)}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tb.rows.map((r, ri) => (
                  <tr key={ri}>
                    {r.map((raw, ci) => {
                      const c = cellOf(raw)
                      const cls = [al(ci), c.tone && !c.badge ? `sp-t${tc(c.tone)}` : ""].filter(Boolean).join(" ") || undefined
                      return (
                        <td key={ci} className={cls}>
                          {c.badge ? <Chip tone={c.tone}>{c.text}</Chip> : c.code ? <code>{c.text}</code> : typeof raw === "number" ? c.text : <Inline text={c.text} />}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {tb.caption ? <p className="sp-tcap"><Inline text={tb.caption} /></p> : null}
        </>
      )
    }
    case "cards":
      return (
        <div className="sp-cards">
          {(v as { title: string; body: string; tag?: string; tone?: Tone; delta?: Delta }[]).map((c, i) => (
            <div key={i} className={`sp-card${tc(c.tone ?? (c.delta ? DELTA_TONE[c.delta] : undefined))}`}>
              {c.tag || c.delta ? (
                <p className="sp-card-top">
                  <span className="sp-card-tag">{c.tag ?? ""}</span>
                  {c.delta ? <Chip tone={DELTA_TONE[c.delta]}>{DELTA_LABEL[c.delta]}</Chip> : null}
                </p>
              ) : null}
              <h3 className="sp-card-title"><Inline text={c.title} /></h3>
              <Prose text={c.body} />
            </div>
          ))}
        </div>
      )
    case "callout": {
      const c = v as { tone: Tone; title?: string; body: string }
      return (
        <aside className={`sp-callout${tc(c.tone)}`} role="note">
          {c.title ? <p className="sp-callout-title"><Inline text={c.title} /></p> : null}
          <Prose text={c.body} />
        </aside>
      )
    }
    case "filemap":
      return <Filemap fm={v} ctx={ctx} />
    case "diff":
      return <Diff d={v} ctx={ctx} />
    case "code":
      return <Code c={v} />
    case "risks":
      return (
        <ol className="sp-items sp-risks">
          {(v as { risk: string; severity: string; area?: string; mitigation?: string; refs?: string[] }[]).map((r, i) => (
            <li key={i} className={`sp-item sp-sev-${r.severity}`}>
              <div className="sp-item-k">
                <Chip tone={SEV_TONE[r.severity]}>{r.severity}</Chip>
                {r.area ? <p className="sp-item-area">{r.area}</p> : null}
              </div>
              <div className="sp-item-main">
                <p className="sp-item-title"><Inline text={r.risk} /></p>
                {r.mitigation ? <p className="sp-item-sub"><b>Mitigation</b><Inline text={r.mitigation} /></p> : null}
                <Refs refs={r.refs} />
              </div>
            </li>
          ))}
        </ol>
      )
    case "decisions":
      return (
        <ol className="sp-items sp-decisions">
          {(v as { decision: string; why?: string; confidence: string; refs?: string[] }[]).map((d, i) => (
            <li key={i} className="sp-item">
              <div className="sp-item-k">
                <Chip tone={CONF_TONE[d.confidence]}>{d.confidence}</Chip>
              </div>
              <div className="sp-item-main">
                <p className="sp-item-title"><Inline text={d.decision} /></p>
                {d.why ? <p className="sp-item-sub"><Inline text={d.why} /></p> : null}
                <Refs refs={d.refs} />
              </div>
            </li>
          ))}
        </ol>
      )
    case "evidence":
      return (
        <table className="sp-ev">
          <tbody>
            {(v as { claim: string; source: string; status?: string }[]).map((e, i) => (
              <tr key={i}>
                <td><Inline text={e.claim} /></td>
                <td className="sp-ev-src"><Ref text={e.source} /></td>
                <td className="sp-ev-st">{e.status ? <Chip tone={EV_TONE[e.status]}>{e.status}</Chip> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )
    case "timeline":
      return (
        <ol className="sp-tl">
          {(v as { when: string; title: string; body?: string; tone?: Tone }[]).map((e, i) => (
            <li key={i} className={`sp-tl-i${tc(e.tone)}`}>
              <span className="sp-tl-when">{e.when}</span>
              <div className="sp-tl-body">
                <p className="sp-tl-title"><Inline text={e.title} /></p>
                {e.body ? <Prose text={e.body} /> : null}
              </div>
            </li>
          ))}
        </ol>
      )
    case "checklist":
      return (
        <ul className="sp-check">
          {(v as { text: string; done?: boolean; note?: string }[]).map((c, i) => (
            <li key={i} className={c.done ? "sp-done" : undefined}>
              <span className="sp-box" role="img" aria-label={c.done ? "done" : "open"}>{c.done ? "\u2713" : ""}</span>
              <span>
                <span className="sp-check-t"><Inline text={c.text} /></span>
                {c.note ? <span className="sp-check-note"><Inline text={c.note} /></span> : null}
              </span>
            </li>
          ))}
        </ul>
      )
    case "details": {
      const d = v as { summary: string; blocks: Block[] }
      return (
        <details className="sp-details">
          <summary><Inline text={d.summary} /></summary>
          <div className="sp-details-body">
            <Blocks blocks={d.blocks} ctx={ctx} />
          </div>
        </details>
      )
    }
    case "columns": {
      const cols = v as Block[][]
      return (
        <div className="sp-cols" style={{ ["--sp-cols" as string]: String(cols.length) }}>
          {cols.map((col, i) => (
            <div key={i} className="sp-col">
              <Blocks blocks={col} ctx={ctx} />
            </div>
          ))}
        </div>
      )
    }
  }
  return null
}
