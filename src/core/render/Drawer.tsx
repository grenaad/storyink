/**
 * The viewer's change drawer (HTML only): what an element changed, with its file refs and, when
 * the spec embeds `changes` (`render --changes`), the hunks each ref selects as an HTML diff.
 */
import type { ReactElement } from "react"
import { diffRows, findFile, langForPath, selectHunks, sideOf, type DiffRow, type DiffSet } from "../diff/index.ts"
import type { CodeLang, ChangeStat, Delta, FileRef } from "../spec.ts"
import type { Scene } from "../scene.ts"
import { CODE_LANGS } from "../spec.ts"

export interface DrawerInfo {
  id: string
  kind: "node" | "edge" | "group"
  label: string
  delta?: Delta
  stat?: ChangeStat
  summary?: string
  files: FileRef[]
}

/** What the drawer opens on: an element, or a file (a narration cite). */
export type DrawerTarget = { id: string } | { file: FileRef }

const BADGE: Record<Delta, string> = { added: "NEW", modified: "CHANGED", removed: "REMOVED", unchanged: "UNCHANGED" }

const has = (x: { delta?: Delta; summary?: string; files?: FileRef[] }) => !!(x.summary || x.files?.length || (x.delta && x.delta !== "unchanged"))

/** Drawer content of an element id (node / edge / group), undefined when it has nothing to show. */
export function drawerInfo(scene: Scene, id: string): DrawerInfo | undefined {
  const n = scene.nodes.find((x) => x.id === id)
  if (n) return has(n) ? { id, kind: "node", label: n.label.join(" ") || n.header?.title || id, ...pick(n), files: n.files ?? [] } : undefined
  const e = scene.edges.find((x) => x.id === id)
  if (e) {
    if (!has(e)) return undefined
    const name = (nid: string) => scene.nodes.find((x) => x.id === nid)?.label.join(" ") || nid
    return { id, kind: "edge", label: e.label?.text || `${name(e.from)} \u2192 ${name(e.to)}`, ...pick(e), files: e.files ?? [] }
  }
  const g = scene.groups.find((x) => x.id === id)
  if (g && g.delta && g.delta !== "unchanged") return { id, kind: "group", label: g.label || id, delta: g.delta, files: [] }
  return undefined
}

const pick = (x: { delta?: Delta; stat?: ChangeStat; summary?: string }) => ({
  ...(x.delta ? { delta: x.delta } : {}),
  ...(x.stat ? { stat: x.stat } : {}),
  ...(x.summary ? { summary: x.summary } : {}),
})

/** Ids of every element with drawer content (for the pointer affordance). */
export function drawerIds(scene: Scene): { node: string[]; edge: string[]; group: string[] } {
  return {
    node: scene.nodes.filter(has).map((n) => n.id),
    edge: scene.edges.filter(has).map((e) => e.id),
    group: scene.groups.filter((g) => g.delta && g.delta !== "unchanged").map((g) => g.id),
  }
}

/** Does the scene give the viewer anything to put in a drawer? */
export const hasDrawer = (scene: Scene): boolean => {
  const d = drawerIds(scene)
  return d.node.length + d.edge.length + d.group.length > 0
}

/** The drawer element for a clicked `data-si` key (rows / code / labels map to their owner). */
export function drawerIdForSi(scene: Scene, si: string): string | undefined {
  const c = si.indexOf(":")
  if (c < 0) return undefined
  const kind = si.slice(0, c)
  const rest = si.slice(c + 1)
  if (kind === "node" || kind === "code" || kind === "badge" || kind === "lit" || kind === "group" || kind === "edge") return rest
  if (kind === "row") return rest.slice(0, rest.indexOf("#") < 0 ? undefined : rest.indexOf("#"))
  if (kind === "label") return scene.edges.find((e) => e.label?.id === rest)?.id
  return undefined
}

const asDiffSet = (scene: Scene): DiffSet | undefined =>
  scene.changes?.files?.length ? { version: 1, files: scene.changes.files, stats: { files: scene.changes.files.length, add: 0, del: 0 } } : undefined

const langOf = (l: string | undefined, path: string): CodeLang => ((CODE_LANGS as readonly string[]).includes(l ?? "") ? (l as CodeLang) : langForPath(path))

export const fmtLines = (r: FileRef): string => (r.lines === undefined ? "" : typeof r.lines === "number" ? `#L${r.lines}` : `#L${r.lines[0]}-${r.lines[1]}`)

/** Row text as spans: syntax token classes, intra-line marks. */
function RowCode({ row }: { row: DiffRow }): ReactElement {
  const text = row.text
  const cuts = new Set<number>([0, text.length])
  for (const t of row.tokens) {
    cuts.add(t.c)
    cuts.add(Math.min(text.length, t.c + t.t.length))
  }
  for (const [a, b] of row.marks ?? []) {
    cuts.add(Math.max(0, Math.min(text.length, a)))
    cuts.add(Math.max(0, Math.min(text.length, b)))
  }
  const xs = [...cuts].sort((a, b) => a - b)
  const out: ReactElement[] = []
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i]
    const b = xs[i + 1]
    if (b <= a) continue
    const tok = row.tokens.find((t) => t.c <= a && a < t.c + t.t.length)
    const mark = (row.marks ?? []).some(([m0, m1]) => m0 <= a && a < m1)
    const cls = [tok?.k ? `si-dk-${tok.k}` : "", mark ? "si-dmark" : ""].filter(Boolean).join(" ")
    out.push(cls ? <span key={a} className={cls}>{text.slice(a, b)}</span> : <span key={a}>{text.slice(a, b)}</span>)
  }
  return <>{out}</>
}

/** One file ref: path (+ range) and, with embedded changes, its hunks as a diff table. */
export function FileDiff({ scene, fileRef, removed }: { scene: Scene; fileRef: FileRef; removed?: boolean }): ReactElement {
  const ds = asDiffSet(scene)
  const f = ds ? findFile(ds, fileRef.path) : undefined
  const hunks = ds && f ? selectHunks(ds, fileRef, sideOf(fileRef, removed)) : []
  const rows = hunks.length ? diffRows(hunks, langOf(f?.lang, fileRef.path), { headers: "always" }) : []
  return (
    <section className="si-dfile">
      <p className="si-dpath">
        <span>{fileRef.path}</span>
        {fmtLines(fileRef) ? <span className="si-dlines">{fmtLines(fileRef)}</span> : null}
        {f ? <span className={`si-dstatus si-dstatus-${f.status}`}>{f.status}</span> : null}
      </p>
      {rows.length ? (
        <div className="si-diff" role="table">
          {rows.map((r, i) =>
            r.kind === "hunk" || r.kind === "fold" ? (
              <div key={i} className={`si-drow si-drow-${r.kind}`} role="row">
                <span className="si-dtext">{r.text}</span>
              </div>
            ) : (
              <div key={i} className={`si-drow si-drow-${r.kind}`} role="row">
                <span className="si-dno">{r.old ?? ""}</span>
                <span className="si-dno">{r.new ?? ""}</span>
                <span className="si-dsign">{r.kind === "add" ? "+" : r.kind === "del" ? "\u2212" : " "}</span>
                <span className="si-dtext">
                  <RowCode row={r} />
                </span>
              </div>
            ),
          )}
        </div>
      ) : ds && !f ? (
        <p className="si-dnote">Not in the embedded diff.</p>
      ) : null}
    </section>
  )
}

/** The side drawer. */
export function Drawer({ scene, target, onClose }: { scene: Scene; target: DrawerTarget; onClose: () => void }): ReactElement | null {
  const info = "id" in target ? drawerInfo(scene, target.id) : undefined
  if ("id" in target && !info) return null
  const title = info ? info.label : (target as { file: FileRef }).file.path
  return (
    <aside className="si-drawer" role="dialog" aria-label={`Details: ${title}`} data-no-pan data-drawer={info ? info.id : `file:${(target as { file: FileRef }).file.path}`}>
      <header className="si-drawer-head">
        <p className="si-drawer-kind">{info ? info.kind : "file"}</p>
        <button type="button" className="si-drawer-x" aria-label="Close (Esc)" title="Close (Esc)" onClick={onClose}>
          ×
        </button>
        <h2 className="si-drawer-title">{title}</h2>
        {info && (info.delta || info.stat) ? (
          <p className="si-drawer-meta">
            {info.delta ? <span className={`si-dbadge si-dbadge-${info.delta}`}>{BADGE[info.delta]}</span> : null}
            {info.stat ? (
              <span className="si-dstat">
                {info.stat.add !== undefined ? <span className="si-dstat-add">+{info.stat.add}</span> : null}
                {info.stat.del !== undefined ? <span className="si-dstat-del">{"\u2212"}{info.stat.del}</span> : null}
              </span>
            ) : null}
          </p>
        ) : null}
      </header>
      <div className="si-drawer-body">
        {info?.summary ? <p className="si-drawer-summary">{info.summary}</p> : null}
        {info ? info.files.map((r, i) => <FileDiff key={i} scene={scene} fileRef={r} removed={info.delta === "removed"} />) : <FileDiff scene={scene} fileRef={(target as { file: FileRef }).file} />}
        {info && !info.files.length && !info.summary ? <p className="si-dnote">No files attached.</p> : null}
      </div>
    </aside>
  )
}
