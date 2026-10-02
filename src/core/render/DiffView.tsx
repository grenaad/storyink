/**
 * Shared HTML diff view: hunks as a table of rows (line numbers, sign, syntax-coloured text,
 * intra-line marks). Used by the viewer's change drawer and by page `diff` blocks.
 */
import type { ReactElement } from "react"
import { diffRows, type DiffRow, type DiffRowsOptions, type Hunk } from "../diff/index.ts"
import type { CodeLang } from "../spec.ts"
import { fonts, type as T, v } from "../../theme/tokens.ts"

/** Row text as spans: syntax token classes, intra-line marks. */
export function RowCode({ row }: { row: DiffRow }): ReactElement {
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

/** Rows as the `.si-diff` table (renders nothing for no rows). */
export function DiffRowsView({ rows }: { rows: DiffRow[] }): ReactElement | null {
  if (!rows.length) return null
  return (
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
  )
}

/** Hunks as an HTML diff (`max` folds with a "… N more lines" row). */
export function DiffView({ hunks, lang, max, headers = "always" }: { hunks: Hunk[]; lang: CodeLang; max?: number; headers?: DiffRowsOptions["headers"] }): ReactElement | null {
  if (!hunks.length) return null
  return <DiffRowsView rows={diffRows(hunks, lang, { headers, ...(max !== undefined ? { max } : {}) })} />
}

/**
 * CSS of the diff view (both themes via palette variables; needs the rich + delta palettes). The
 * drawer's stylesheet (viewerCss) carries the same rules; pages emit these when no figure has a drawer.
 */
export function diffViewCss(): string {
  const tk = (k: string, c: Parameters<typeof v>[0]) => `.si-dk-${k}{color:${v(c)};}`
  return `
.si-diff{border:1px solid ${v("chromeLine")};border-radius:4px;overflow-x:auto;font-size:11.5px;line-height:18px;background:${v("panel")};font-family:${fonts.mono};}
.si-drow{display:flex;min-width:max-content;white-space:pre;}
.si-dno{flex:none;width:38px;padding:0 6px;text-align:right;color:${v("inkFaint")};user-select:none;font-variant-numeric:tabular-nums;}
.si-dsign{flex:none;width:16px;text-align:center;color:${v("inkFaint")};user-select:none;}
.si-dtext{flex:1;padding-right:12px;}
.si-drow-add{background:color-mix(in srgb, ${v("deltaAdded")} 13%, transparent);}
.si-drow-add .si-dsign{color:${v("deltaAdded")};}
.si-drow-del{background:color-mix(in srgb, ${v("deltaRemoved")} 13%, transparent);}
.si-drow-del .si-dsign{color:${v("deltaRemoved")};}
.si-drow-add .si-dmark{background:color-mix(in srgb, ${v("deltaAdded")} 30%, transparent);border-radius:2px;}
.si-drow-del .si-dmark{background:color-mix(in srgb, ${v("deltaRemoved")} 30%, transparent);border-radius:2px;}
.si-drow-hunk,.si-drow-fold{color:${v("inkFaint")};background:color-mix(in srgb, ${v("ink")} 4%, transparent);padding:0 8px;}
.si-drow-fold{font-style:italic;}
.si-dstatus{font-size:${T.tag}px;letter-spacing:${T.tagTracking * 1.5}em;text-transform:uppercase;color:${v("inkFaint")};}
${tk("kw", "codeKw")}${tk("op", "codeKw")}${tk("str", "codeStr")}${tk("num", "codeConst")}${tk("def", "codeConst")}${tk("type", "codeConst")}${tk("fn", "codeFn")}${tk("param", "codeParam")}${tk("com", "codeCom")}
`.trim()
}
