/**
 * Change diagrams (`delta` / `emphasis` / `stat` / `summary` / `files`, `change`, `style.legend`):
 * badge room on sized nodes, change fields on edges / groups, and the legend band. Nothing here
 * runs for specs without the change fields, so their layout stays byte-identical.
 */
import { delta as D, geometry as G, type as T } from "../../theme/tokens.ts"
import type { Scene, SceneBadge, SceneNode } from "../scene.ts"
import type { ChangeStat, Delta, FileRef, FileRefLike, Spec } from "../spec.ts"
import { isSequence } from "../spec.ts"
import { r2, snap, textWidth } from "./measure.ts"
import { withoutDeltaLook } from "../story/acts.ts"

export const BADGE_TEXT: Record<Delta, string> = { added: "NEW", modified: "CHANGED", removed: "REMOVED", unchanged: "" }
/** Legend order. */
export const LEGEND_ORDER: Delta[] = ["added", "modified", "removed", "unchanged"]

export const badgeW = (text: string): number => (text ? r2(textWidth(text, D.badgeFont, T.tagTracking) + 2 * D.badgePadX) : 0)

/** "+38 −12" parts (only those given). */
export function statParts(s: ChangeStat): { add?: string; del?: string } {
  return { ...(s.add !== undefined ? { add: `+${s.add}` } : {}), ...(s.del !== undefined ? { del: `\u2212${s.del}` } : {}) }
}
export function statWidth(s: ChangeStat): number {
  const p = statParts(s)
  const txt = [p.add, p.del].filter(Boolean).join(" ")
  return txt ? r2(textWidth(txt, D.statFont)) : 0
}

export function normFiles(files: FileRefLike[] | undefined): FileRef[] | undefined {
  if (!files?.length) return undefined
  return files.map((f) => (typeof f === "string" ? { path: f } : { ...f }))
}

interface ChangeFields {
  delta?: Delta
  stat?: ChangeStat
  summary?: string
  files?: FileRefLike[]
}

const TINY = new Set(["dot", "bullseye", "bar", "choice"])

/**
 * Copy change fields onto a sized node and make room for its badge / stat (before placement).
 * Corner shapes get a strip at the top (text moves down), windows use the header strip, chips
 * and pills a slot at the right, diamonds a centred row under the text. Tiny shapes: no badge.
 */
export function fitBadge(s: SceneNode, f: ChangeFields): void {
  if (f.delta) s.delta = f.delta
  if (f.delta && f.delta !== "unchanged" && s.accent !== { added: "sage", modified: "gold", removed: "rose" }[f.delta]) s.accent0 = s.accent
  if (f.delta === "added") s.accent = "sage"
  else if (f.delta === "modified") s.accent = "gold"
  else if (f.delta === "removed") s.accent = "rose"
  // Context keeps a neutral accent, so a rose / sage kind accent never reads as a delta.
  else if (f.delta === "unchanged") s.accent = "plain"
  if (f.stat) s.stat = { ...f.stat }
  if (f.summary) s.summary = f.summary
  const files = normFiles(f.files)
  if (files) s.files = files
  const text = f.delta ? BADGE_TEXT[f.delta] : ""
  const sw = f.stat ? statWidth(f.stat) : 0
  if ((!text && !sw) || TINY.has(s.shape)) return
  const bw = badgeW(text)
  const bh = D.badgeH
  const stat = sw ? { ...f.stat, w: sw } : undefined
  const slot = bw + (sw ? sw + (bw ? 5 : 0) : 0)
  const widen = (need: number, centre = true) => {
    if (s.w >= need) return
    const nw = snap(need, 4)
    if (centre) s.text.cx = r2(s.text.cx + (nw - s.w) / 2)
    s.w = nw
  }
  const shiftText = (dy: number) => {
    s.text.tagY = r2(s.text.tagY + dy)
    s.text.labelY = s.text.labelY.map((y) => r2(y + dy))
    s.text.detailY = s.text.detailY.map((y) => r2(y + dy))
    if (s.text.counterY !== undefined) s.text.counterY = r2(s.text.counterY + dy)
  }
  let badge: SceneBadge
  if (s.shape === "window") {
    const hh = s.header?.h ?? G.headerH
    const titles = (s.labels ?? [s.label]).map((l) => l.join(" ").toUpperCase())
    if (s.header) titles.push(s.header.title)
    const tw = Math.max(...titles.map((t) => textWidth(t, T.header, T.tagTracking))) + (s.icon ? G.iconW : 0)
    const right = 10
    widen(G.panelPadX + tw + 14 + slot + right, false)
    badge = { text, w: bw, h: bh, y: r2((hh - bh) / 2), right }
    for (const r of s.rows ?? []) r.statusX = s.w - G.panelPadX - 7
  } else if (s.shape === "chip") {
    const fh = s.stack ? s.h - s.stack * G.stackStep : s.h
    const lw = Math.max(...(s.labels ?? [s.label]).map((l) => textWidth(l.join(" "), T.label)))
    widen(s.text.cx + lw + 12 + slot + G.chipPadX, false)
    badge = { text, w: bw, h: bh, y: r2((fh - bh) / 2), right: G.chipPadX - 4 }
  } else if (s.shape === "pill") {
    const right = Math.round(s.h / 2) - 4
    const extra = slot + 8
    s.w = snap(s.w + extra, 4)
    s.text.cx = r2((s.w - extra - right + 6) / 2)
    badge = { text, w: bw, h: bh, y: r2((s.h - bh) / 2), right }
  } else if (s.shape === "diamond") {
    const row = bh + 6
    const lastText = Math.max(s.text.labelY[s.text.labelY.length - 1] ?? 0, s.text.detailY[s.text.detailY.length - 1] ?? 0)
    s.h = snap(s.h + 2 * row, 4)
    shiftText(row / 2 + 2)
    const y = r2(lastText + row / 2 + 2 + 6)
    // Inscribed half-width at the badge's centre line must hold the badge (+ stat) and a margin.
    const cy = y + bh / 2
    const frac = 1 - Math.abs(cy - s.h / 2) / (s.h / 2)
    widen((slot + 16) / Math.max(0.2, frac))
    badge = { text, w: bw, h: bh, y, cx: r2(s.w / 2 + (sw ? (sw + 5) / 2 : 0)) }
  } else {
    const y = s.shape === "cylinder" ? 16 : D.badgeInset
    const top = s.tag ? s.text.tagY - T.tag * 0.8 : (s.text.labelY[0] ?? s.h / 2) - T.label * 0.8
    const dy = Math.max(0, Math.ceil(y + bh + 3 - top))
    if (dy) {
      shiftText(dy)
      s.h = snap(s.h + dy, 2)
    }
    const right = s.shape === "note" ? 14 : D.badgeInset
    widen(2 * right + slot + 4)
    badge = { text, w: bw, h: bh, y, right }
  }
  if (stat) badge.stat = stat
  s.badge = badge
}

/** Does the spec use any change field (deltas, emphasis, stat, change meta)? */
export function specHasChanges(spec: Spec): boolean {
  if (spec.change) return true
  if (isSequence(spec)) return spec.participants.some((p) => p.delta) || spec.messages.some((m) => m.delta || m.emphasis || m.files || m.summary)
  return (
    spec.nodes.some((n) => n.delta || n.stat || n.files || n.summary) ||
    (spec.edges ?? []).some((e) => e.delta || e.emphasis || e.files || e.summary) ||
    (spec.groups ?? []).some((g) => g.delta)
  )
}

/**
 * After layout: change fields on edges / messages / groups, `change` meta, and the legend band
 * (the viewBox grows upward by `legendH`, wider if the legend needs it).
 */
export function applyChanges(scene: Scene, spec: Spec): void {
  spec = withoutDeltaLook(spec)
  if (!specHasChanges(spec)) return
  const src = isSequence(spec)
    ? spec.messages.map((m, k) => ({ id: m.id ?? `msg-${k}`, e: m }))
    : (spec.edges ?? []).map((e) => ({ id: e.id ?? `${e.from}->${e.to}`, e }))
  const byId = new Map(src.map((x) => [x.id, x.e]))
  for (const e of scene.edges) {
    const m = byId.get(e.id)
    if (!m) continue
    if (m.delta) e.delta = m.delta
    if (m.emphasis) e.emphasis = m.emphasis
    if (m.summary) e.summary = m.summary
    const files = normFiles(m.files)
    if (files) e.files = files
  }
  if (!isSequence(spec)) {
    const gd = new Map((spec.groups ?? []).map((g) => [g.id, g.delta]))
    for (const g of scene.groups) {
      const d = gd.get(g.id)
      if (d) g.delta = d
    }
  }
  if (spec.change) scene.change = { ...spec.change }
  const present = new Set<Delta>([...scene.nodes.map((n) => n.delta), ...scene.edges.map((e) => e.delta), ...scene.groups.map((g) => g.delta)].filter((d): d is Delta => !!d))
  const anyChange = [...present].some((d) => d !== "unchanged")
  const items = spec.style?.legend === false || !anyChange ? [] : LEGEND_ORDER.filter((d) => present.has(d))
  const c = spec.change
  const meta = c ? (c.base || c.head ? `${c.base ?? "base"} \u2192 ${c.head ?? "HEAD"}` : c.title) : undefined
  if (!items.length && !meta) return
  const vb = scene.viewBox
  const x = r2(vb.x + G.margin)
  const itemsW = legendWidth(items)
  const metaW = meta ? textWidth(meta, T.detail) : 0
  const need = G.margin * 2 + itemsW + (meta ? metaW + (items.length ? 24 : 0) : 0)
  if (need > vb.w) vb.w = r2(snap(need, 2))
  vb.y = r2(vb.y - D.legendH)
  vb.h = r2(vb.h + D.legendH)
  scene.legend = {
    x,
    y: r2(vb.y + D.legendH),
    items,
    ...(meta ? { meta, metaX: r2(vb.x + vb.w - G.margin) } : {}),
  }
}

/** Legend item: swatch (14) + gap (6) + word + spacing (16). */
export const LEGEND_SWATCH = 14
export const legendItemW = (d: Delta): number => LEGEND_SWATCH + 6 + textWidth(d.toUpperCase(), T.tag, T.tagTracking) + 16
export const legendWidth = (items: Delta[]): number => items.reduce((a, d) => a + legendItemW(d), 0)

/** Group label suffix (" · NEW"), tag type. */
export const groupBadgeText = (d: Delta): string => (BADGE_TEXT[d] ? ` \u00b7 ${BADGE_TEXT[d]}` : "")
export const groupBadgeW = (d: Delta): number => textWidth(groupBadgeText(d), T.groupLabel, T.tagTracking) + 8
