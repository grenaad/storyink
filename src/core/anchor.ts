import type { Box, Pt, Scene, SceneNode } from "./scene.ts"

/**
 * Anchor references: `<nodeId>#<rowId>` (a panel row) or `<nodeId>#<n>` (1-based code line).
 * Ids never contain `#`, so the first `#` splits. Duplicate-edge ids (`a->b#2`) are resolved
 * as edges before any anchor parsing (exact id first).
 */
export interface Ref {
  node: string
  anchor?: string
}

export function parseRef(ref: string): Ref {
  const i = ref.indexOf("#")
  if (i <= 0 || i === ref.length - 1) return { node: ref }
  return { node: ref.slice(0, i), anchor: ref.slice(i + 1) }
}

export const joinRef = (node: string, anchor?: string): string => (anchor ? `${node}#${anchor}` : node)

/** A code-line anchor ("3") → 3; a row anchor → undefined. */
export const lineOf = (anchor: string): number | undefined => (/^[1-9][0-9]*$/.test(anchor) ? Number(anchor) : undefined)

/** y of an anchor relative to its node's top (row: first text line centre; code line: its centre). */
export function anchorOffsetY(n: Pick<SceneNode, "rows" | "code">, anchor: string): number | undefined {
  const k = lineOf(anchor)
  if (k !== undefined) {
    const c = n.code
    if (!c || k > c.slots) return undefined
    return c.top + (k - 0.5) * c.lh
  }
  const row = n.rows?.find((r) => r.id === anchor)
  return row?.anchorY
}

/** The absolute anchor point on the given side of a node. */
export function anchorPoint(n: SceneNode, anchor: string, side: "left" | "right"): Pt | undefined {
  const y = anchorOffsetY(n, anchor)
  if (y === undefined) return undefined
  return { x: side === "left" ? n.x : n.x + n.w, y: n.y + y }
}

/** Bounding box of a node, group, edge, panel row or code line reference (undefined = unknown). */
export function boxOfRef(scene: Scene, ref: string): Box | undefined {
  const g = scene.groups.find((x) => x.id === ref)
  if (g) return { x: g.x, y: g.y, w: g.w, h: g.h }
  const e = scene.edges.find((x) => x.id === ref)
  if (e) {
    const xs = e.points.map((p) => p.x)
    const ys = e.points.map((p) => p.y)
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
  }
  const { node, anchor } = parseRef(ref)
  const n = scene.nodes.find((x) => x.id === node)
  if (!n) return undefined
  if (!anchor) return { x: n.x, y: n.y, w: n.w, h: n.h }
  const k = lineOf(anchor)
  if (k !== undefined && n.code) {
    if (k > n.code.slots) return undefined
    return { x: n.x, y: n.y + n.code.top + (k - 1) * n.code.lh, w: n.w, h: n.code.lh }
  }
  const row = n.rows?.find((r) => r.id === anchor)
  return row ? { x: n.x, y: n.y + row.y, w: n.w, h: row.h } : undefined
}
