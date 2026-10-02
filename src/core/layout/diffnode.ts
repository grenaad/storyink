/**
 * Diff code nodes (`kind: "code"` with `diff`): sizing, the per-frame row geometry used by the
 * static / HTML renderer and the animated SVG (story `apply`), and line lookups for anchors.
 */
import { geometry as G, type as T } from "../../theme/tokens.ts"
import type { SceneDiff, SceneDiffRow, SceneNode } from "../scene.ts"
import type { CodeLang, DiffRef, GraphNode, GraphSpec } from "../spec.ts"
import { parseHunks } from "../diff/parse.ts"
import { diffRows } from "../diff/rows.ts"
import { langForPath } from "../diff/lang.ts"
import type { Hunk } from "../diff/types.ts"
import { inOutCubic } from "../story/ease.ts"
import { r2, snap, textWidth } from "./measure.ts"

/** Default fold: rows after this many diff lines become "… N more lines". */
export const DIFF_MAX = 24
/** Diff row height (a little denser than plain code). */
export const DIFF_LH = 20
/** Columns shown before a long line is cut with "…" (a larger size.cols widens it). */
export const DIFF_COLS = 72
const ADV_CODE = T.code * 0.6
const NUM_FONT = T.detail
const ADV_NUM = NUM_FONT * 0.6

/** The node's hunks (string → parseHunks, resolved `{ hunks }`), or undefined (unresolved / none). */
export function hunksOfNode(n: Pick<GraphNode, "diff">): Hunk[] | undefined {
  const d = n.diff
  if (d === undefined) return undefined
  if (typeof d === "string") return parseHunks(d)
  return Array.isArray(d.hunks) ? d.hunks : undefined
}

export function diffLangOf(n: Pick<GraphNode, "diff" | "lang">): CodeLang {
  if (n.lang) return n.lang
  const f = typeof n.diff === "object" ? (n.diff as DiffRef).file : undefined
  const l = f ? langForPath(f) : "ts"
  return l
}

/** The rows a diff node shows (folded at `max`, default 24). */
export function rowsOfNode(n: Pick<GraphNode, "diff" | "lang">): ReturnType<typeof diffRows> {
  const hunks = hunksOfNode(n) ?? []
  const max = typeof n.diff === "object" && typeof n.diff.max === "number" ? n.diff.max : DIFF_MAX
  return diffRows(hunks, diffLangOf(n), { max })
}

const titleW = (title: string, icon: boolean) => textWidth(title, T.header, T.tagTracking) + (icon ? G.iconW : 0)

/** Size a diff code node: header strip, gutter (old | new numbers), marker column, code. */
export function sizeDiff(_spec: GraphSpec, n: GraphNode): SceneNode {
  const lang = diffLangOf(n)
  const raw = rowsOfNode(n)
  const top = G.headerH + G.panelPadY
  const nums = raw.flatMap((r) => [r.old ?? 0, r.new ?? 0])
  const digits = Math.max(2, ...nums.map((x) => String(x).length))
  const oldX = r2(12 + digits * ADV_NUM)
  const newX = r2(oldX + 8 + digits * ADV_NUM)
  const ruleX = r2(newX + 8)
  const markX = r2(ruleX + 8)
  const codeX = r2(markX + 12)
  // Long lines are cut at DIFF_COLS (or size.cols) with "…", so one long line can't widen the node.
  const cap = Math.max(DIFF_COLS, n.size?.cols ?? 0)
  const rows: SceneDiffRow[] = raw.map((r, k) => ({ ...cut(r, r.kind === "hunk" ? Math.round(cap * 1.15) : cap), y: top + k * DIFF_LH }))
  const cols = Math.max(n.size?.cols ?? 0, ...rows.filter((r) => r.kind !== "hunk").map((r) => Array.from(r.text).length))
  const hunkW = Math.max(0, ...rows.filter((r) => r.kind === "hunk").map((r) => textWidth(r.text, NUM_FONT)))
  const title = (n.label ?? n.id).toUpperCase()
  const w = snap(Math.max(G.nodeMinWidth, codeX + cols * ADV_CODE + 16, markX + hunkW + 16, titleW(title, !!n.icon) + 2 * G.panelPadX), 4)
  const slots = Math.max(1, rows.length, n.size?.lines ?? 0)
  const h = snap(top + slots * DIFF_LH + G.panelPadY, 2)
  const file = typeof n.diff === "object" ? n.diff.file : undefined
  const diff: SceneDiff = { rows, hunks: Math.max(0, ...rows.map((r) => r.hunk + 1)), lang, ...(file ? { file } : {}), lh: DIFF_LH, top, oldX, newX, ruleX, markX, codeX }
  return {
    id: n.id,
    kind: "code",
    shape: "window",
    accent: "plain",
    label: [n.label ?? n.id],
    detail: [],
    tag: "",
    x: 0,
    y: 0,
    w,
    h,
    text: { tagY: 0, labelY: [], detailY: [], cx: w / 2 },
    header: { h: G.headerH, title },
    ...(n.icon ? { icon: n.icon } : {}),
    ...(n.muted ? { muted: true } : {}),
    // Mirror for bars, anchors and `line` steps (display rows, 1-based).
    code: { lang, versions: [rows.map((r) => r.tokens)], x: codeX, top, lh: DIFF_LH, slots, cols },
    diff,
  }
}

/** Cut a row to `cap` columns ("…" in the last one); marks are clipped. */
function cut<R extends { text: string; tokens: SceneDiffRow["tokens"]; marks?: [number, number][] }>(r: R, cap: number): R {
  const chars = Array.from(r.text)
  if (chars.length <= cap) return r
  const end = cap - 1
  const tokens = r.tokens
    .filter((t) => t.c < end)
    .map((t) => (t.c + Array.from(t.t).length > end ? { ...t, t: Array.from(t.t).slice(0, end - t.c).join("") } : t))
  tokens.push({ t: "\u2026", c: end })
  const marks = r.marks?.filter(([a]) => a < end).map(([a, b]): [number, number] => [a, Math.min(b, end)])
  return { ...r, text: `${chars.slice(0, end).join("")}\u2026`, tokens, ...(marks ? { marks } : {}) }
}

/** Display rows (1-based, inclusive) of hunk `h` (1-based). */
export function hunkRowsOf(d: Pick<SceneDiff, "rows">, h: number): [number, number] | undefined {
  const ks = d.rows.map((r, k) => (r.hunk === h - 1 && r.kind !== "hunk" ? k + 1 : 0)).filter(Boolean)
  return ks.length ? [ks[0], ks[ks.length - 1]] : undefined
}

/** Per-row look at one moment. */
export interface DiffRowLook {
  y: number
  /** Visible height (added rows open from 0). */
  h: number
  /** Diff colouring: tint / marks / marker / strike strength (0 = plain code). */
  tint: number
  /** Gutter numbers and hunk header opacity. */
  num: number
  /** Added rows being typed: visible chars (undefined = whole). */
  chars?: number
}

/** Apply phases on a hunk's progress u ∈ [0, 1]. */
export const APPLY_PHASE = { mark: [0, 0.25], open: [0.2, 0.4], type: [0.4, 1] } as const
const ph = (u: number, [a, b]: readonly [number, number]) => inOutCubic((u - a) / (b - a))

/**
 * Row geometry for per-hunk apply progress `us` (omitted / 1 = the static diff; 0 = the base
 * version: no added rows, plain code, no gutter numbers). Rows below an opening row slide down.
 */
export function diffGeom(d: SceneDiff, us?: number[]): DiffRowLook[] {
  const u = (h: number) => (us ? (us[h] ?? 1) : 1)
  // Typing windows per hunk: chars before each added row.
  const before = new Map<SceneDiffRow, number>()
  const total = new Map<number, number>()
  for (const r of d.rows)
    if (r.kind === "add") {
      const t = total.get(r.hunk) ?? 0
      before.set(r, t)
      total.set(r.hunk, t + Math.max(1, r.text.trimEnd().length))
    }
  let y = d.top
  return d.rows.map((r) => {
    const p = u(r.hunk)
    const mark = p >= 1 ? 1 : ph(p, APPLY_PHASE.mark)
    const open = p >= 1 ? 1 : ph(p, APPLY_PHASE.open)
    let look: DiffRowLook
    if (r.kind === "add") {
      let chars: number | undefined
      if (p < 1) {
        const typed = Math.max(0, Math.min(1, (p - APPLY_PHASE.type[0]) / (APPLY_PHASE.type[1] - APPLY_PHASE.type[0]))) * (total.get(r.hunk) ?? 0)
        const len = r.text.trimEnd().length
        const c = Math.max(0, Math.min(len, Math.floor(typed - (before.get(r) ?? 0))))
        if (c < len) chars = c
      }
      look = { y, h: r2(d.lh * open), tint: open, num: open, ...(chars !== undefined ? { chars } : {}) }
    } else if (r.kind === "fold") look = { y, h: d.lh, tint: 0, num: 1 }
    else look = { y, h: d.lh, tint: r.kind === "del" ? mark : 0, num: mark }
    y = r2(y + look.h)
    return look
  })
}

/** Typed characters of the added rows of the given hunks (apply duration). */
export function addedChars(d: SceneDiff, hunks: number[]): number {
  return d.rows.filter((r) => r.kind === "add" && hunks.includes(r.hunk)).reduce((s, r) => s + Math.max(1, r.text.trimEnd().length), 0)
}
