import { geometry as G, type as T } from "../../theme/tokens.ts"
import type { Arrowhead, Box, Pt, Scene, SceneEdge, SceneGroup, SceneLabel, SceneNode, ScenePort } from "../scene.ts"
import type { Direction, GraphSpec } from "../spec.ts"
import { r2, snap, textWidth } from "./measure.ts"
import { sizeNode } from "./nodes.ts"
import { wirePath } from "./paths.ts"
import { type Dir, Router } from "./route.ts"

interface Member {
  id: string
  w: number
  h: number
  group: boolean
}

interface LevelEdge {
  from: string
  to: string
  labelW: number
  labelH: number
}

/** Centre positions relative to the level's top-left, plus the level size. */
interface LevelLayout {
  pos: Map<string, Pt>
  w: number
  h: number
}

const EPS = 0.5

/** Pool-adjacent-violators: minimise Σ(q-d)² with q non-decreasing. */
function isotonic(d: number[], wts: number[]): number[] {
  const vals: number[] = []
  const ws: number[] = []
  const cnt: number[] = []
  for (let i = 0; i < d.length; i++) {
    vals.push(d[i])
    ws.push(wts[i])
    cnt.push(1)
    while (vals.length > 1 && vals[vals.length - 2] > vals[vals.length - 1]) {
      const w = ws[ws.length - 2] + ws[ws.length - 1]
      const v = (vals[vals.length - 2] * ws[ws.length - 2] + vals[vals.length - 1] * ws[ws.length - 1]) / w
      const c = cnt[cnt.length - 2] + cnt[cnt.length - 1]
      vals.splice(-2, 2, v)
      ws.splice(-2, 2, w)
      cnt.splice(-2, 2, c)
    }
  }
  const out: number[] = []
  vals.forEach((v, i) => {
    for (let k = 0; k < cnt[i]; k++) out.push(v)
  })
  return out
}

/**
 * Layered layout of one containment level. Members are atomic boxes (nodes
 * or already laid-out groups). Main axis = layers (y for TB, x for LR).
 */
function layoutLevel(members: Member[], edges: LevelEdge[], dir: "TB" | "LR"): LevelLayout {
  const main = (m: { w: number; h: number }) => (dir === "TB" ? m.h : m.w)
  const cross = (m: { w: number; h: number }) => (dir === "TB" ? m.w : m.h)
  const ids = members.map((m) => m.id)
  const index = new Map(ids.map((id, i) => [id, i]))
  const n = ids.length
  if (n === 0) return { pos: new Map(), w: 0, h: 0 }

  // 1. Cycle removal: DFS in declaration order, reverse back edges.
  const out: number[][] = ids.map(() => [])
  const dag: [number, number, LevelEdge][] = []
  for (const e of edges) {
    const a = index.get(e.from)!
    const b = index.get(e.to)!
    if (a === b) continue
    out[a].push(dag.length)
    dag.push([a, b, e])
  }
  const state = new Uint8Array(n)
  const reversed = new Set<number>()
  const visit = (u: number) => {
    state[u] = 1
    for (const ei of out[u]) {
      const v = dag[ei][1]
      if (state[v] === 1) reversed.add(ei)
      else if (state[v] === 0) visit(v)
    }
    state[u] = 2
  }
  // Start from true sources first so cycles break at the "return" edge.
  const indeg = new Array(n).fill(0)
  for (const [, b] of dag) indeg[b]++
  for (let i = 0; i < n; i++) if (indeg[i] === 0 && !state[i]) visit(i)
  for (let i = 0; i < n; i++) if (!state[i]) visit(i)
  const fwd: [number, number, LevelEdge][] = dag.map(([a, b, e], i) => (reversed.has(i) ? [b, a, e] : [a, b, e]))

  // 2. Longest-path layering, then pull sources down next to their successors.
  const layer = new Array(n).fill(0)
  const preds: number[][] = ids.map(() => [])
  const succs: number[][] = ids.map(() => [])
  for (const [a, b] of fwd) {
    preds[b].push(a)
    succs[a].push(b)
  }
  const topo: number[] = []
  const indeg2 = preds.map((p) => p.length)
  const queue = ids.map((_, i) => i).filter((i) => indeg2[i] === 0)
  while (queue.length) {
    const u = queue.shift()!
    topo.push(u)
    for (const v of succs[u]) if (--indeg2[v] === 0) queue.push(v)
  }
  for (const u of topo) for (const v of succs[u]) layer[v] = Math.max(layer[v], layer[u] + 1)
  for (let pass = 0; pass < 2; pass++)
    for (const u of [...topo].reverse())
      if (preds[u].length === 0 && succs[u].length) layer[u] = Math.min(...succs[u].map((v) => layer[v])) - 1
  const minL = Math.min(...layer)
  for (let i = 0; i < n; i++) layer[i] -= minL
  const L = Math.max(...layer) + 1

  // 3. Dummy nodes for long edges (virtual, thin) to reserve channels.
  interface V {
    member?: number
    cross: number
    main: number
    weight: number
  }
  const verts: V[] = members.map((m, i) => ({ member: i, cross: cross(m), main: main(m), weight: 1 }))
  const vlayer = [...layer]
  const vedges: [number, number][] = []
  for (const [a, b] of fwd) {
    let prev = a
    for (let l = layer[a] + 1; l < layer[b]; l++) {
      const d = verts.length
      verts.push({ cross: 8, main: 0, weight: 0.5 })
      vlayer.push(l)
      vedges.push([prev, d])
      prev = d
    }
    vedges.push([prev, b])
  }
  const up: number[][] = verts.map(() => [])
  const down: number[][] = verts.map(() => [])
  for (const [a, b] of vedges) {
    down[a].push(b)
    up[b].push(a)
  }
  let layers: number[][] = Array.from({ length: L }, () => [])
  // Initial order: DFS order from sources keeps related nodes together.
  const seen = new Uint8Array(verts.length)
  const dfs = (u: number) => {
    if (seen[u]) return
    seen[u] = 1
    layers[vlayer[u]].push(u)
    for (const v of down[u]) dfs(v)
  }
  for (let i = 0; i < n; i++) if (up[i].length === 0) dfs(i)
  for (let i = 0; i < verts.length; i++) dfs(i)

  // 4. Barycenter crossing reduction.
  const posIn = new Map<number, number>()
  const reindex = (ls: number[][]) => ls.forEach((l) => l.forEach((v, i) => posIn.set(v, i)))
  const crossings = (ls: number[][]) => {
    reindex(ls)
    let c = 0
    for (let l = 0; l + 1 < ls.length; l++) {
      const es: [number, number][] = []
      for (const u of ls[l]) for (const v of down[u]) es.push([posIn.get(u)!, posIn.get(v)!])
      for (let i = 0; i < es.length; i++)
        for (let j = i + 1; j < es.length; j++)
          if ((es[i][0] - es[j][0]) * (es[i][1] - es[j][1]) < 0) c++
    }
    return c
  }
  let best = layers.map((l) => [...l])
  let bestC = crossings(best)
  for (let iter = 0; iter < 12 && bestC > 0; iter++) {
    const downward = iter % 2 === 0
    reindex(layers)
    const order = downward ? [...Array(L).keys()].slice(1) : [...Array(L).keys()].reverse().slice(1)
    for (const l of order) {
      const nb = downward ? up : down
      const bary = new Map<number, number>()
      layers[l].forEach((v, i) => {
        const ns = nb[v]
        bary.set(v, ns.length ? ns.reduce((s, u) => s + posIn.get(u)!, 0) / ns.length : i)
      })
      layers[l] = [...layers[l]].sort((a, b) => bary.get(a)! - bary.get(b)! || posIn.get(a)! - posIn.get(b)!)
      layers[l].forEach((v, i) => posIn.set(v, i))
    }
    const c = crossings(layers)
    if (c < bestC) {
      bestC = c
      best = layers.map((x) => [...x])
    }
  }
  layers = best

  // 5. Main-axis layer positions; gaps grow to fit edge labels.
  const layerMain = layers.map((l) => Math.max(0, ...l.map((v) => verts[v].main)))
  const gaps = new Array(Math.max(0, L - 1)).fill(G.layerGap)
  for (const [a, b, e] of fwd) {
    if (!e.labelW) continue
    const g = Math.min(layer[a], layer[b])
    if (g >= gaps.length) continue
    const need = dir === "LR" ? e.labelW + 2 * G.stub + 40 : e.labelH + 2 * G.stub + 44
    gaps[g] = Math.max(gaps[g], need)
  }
  const layerStart: number[] = []
  let acc = 0
  for (let l = 0; l < L; l++) {
    layerStart.push(acc)
    acc += layerMain[l] + (gaps[l] ?? 0)
  }
  const totalMain = acc

  // 6. Cross-axis coordinates: packed, then pulled to neighbour means under
  //    minimum-separation constraints (isotonic regression).
  const sep = (a: V, b: V) => {
    const g = a.member === undefined || b.member === undefined ? (a.member === undefined && b.member === undefined ? 8 : 18) : G.nodeGap
    const extra = (a.member !== undefined && members[a.member].group) || (b.member !== undefined && members[b.member].group) ? G.groupGap - G.nodeGap + G.nodeGap : 0
    return (a.cross + b.cross) / 2 + Math.max(g, extra)
  }
  const cpos = new Float64Array(verts.length)
  for (const l of layers) {
    let x = 0
    l.forEach((v, i) => {
      if (i > 0) x += sep(verts[l[i - 1]], verts[v])
      cpos[v] = x
    })
    const mid = x / 2
    for (const v of l) cpos[v] -= mid
  }
  const real = (v: number) => verts[v].member !== undefined
  const place = (l: number[], desired: number[], weights?: number[]) => {
    const off: number[] = [0]
    for (let i = 1; i < l.length; i++) off.push(off[i - 1] + sep(verts[l[i - 1]], verts[l[i]]))
    const q = isotonic(
      desired.map((d, i) => d - off[i]),
      weights ?? l.map((v) => verts[v].weight),
    )
    l.forEach((v, i) => (cpos[v] = q[i] + off[i]))
  }
  const median = (vals: number[]) => {
    const s2 = [...vals].sort((a, b) => a - b)
    const m = s2.length
    return m % 2 ? s2[(m - 1) / 2] : (s2[m / 2 - 1] + s2[m / 2]) / 2
  }
  // Prefer real neighbours; long-edge dummies only count when nothing else does.
  const pick = (ns: number[]) => {
    const r = ns.filter(real)
    return r.length ? r : ns
  }
  for (let iter = 0; iter < 16; iter++) {
    const mode = iter % 3 // 0 down, 1 up, 2 both
    const order = mode === 1 ? [...Array(L).keys()].reverse() : [...Array(L).keys()]
    for (const l of order) {
      const desired = layers[l].map((v) => {
        const ns = pick(mode === 0 ? up[v] : mode === 1 ? down[v] : [...up[v], ...down[v]])
        if (!ns.length) return cpos[v]
        return median(ns.map((u) => cpos[u]))
      })
      place(layers[l], desired)
    }
  }
  // Straighten chains: a node whose only real predecessor has it as its only
  // real successor (or vice versa) snaps onto that neighbour's axis.
  const chainPartner = (v: number, dirUp: boolean): number | undefined => {
    const ns = (dirUp ? up[v] : down[v]).filter(real)
    if (ns.length !== 1) return undefined
    const u = ns[0]
    const back = (dirUp ? down[u] : up[u]).filter(real)
    return back.length === 1 ? u : undefined
  }
  for (let pass = 0; pass < 4; pass++) {
    const downward = pass % 2 === 0
    const order = downward ? [...Array(L).keys()] : [...Array(L).keys()].reverse()
    for (const l of order) {
      const lay = layers[l]
      const weights = lay.map((v) => (real(v) && chainPartner(v, downward) !== undefined ? 20 : verts[v].weight))
      const desired = lay.map((v) => {
        const u = real(v) ? chainPartner(v, downward) : undefined
        if (u !== undefined) return cpos[u]
        const ns = pick([...up[v], ...down[v]])
        return ns.length ? median(ns.map((x) => cpos[x])) : cpos[v]
      })
      place(lay, desired, weights)
    }
  }
  // Exact snap where separation allows (the regression leaves sub-pixel drift).
  for (const l of [...Array(L).keys()]) {
    const lay = layers[l]
    lay.forEach((v, i) => {
      if (!real(v)) return
      const u = chainPartner(v, true) ?? chainPartner(v, false)
      if (u === undefined) return
      const t = cpos[u]
      const okL = i === 0 || t - cpos[lay[i - 1]] >= sep(verts[lay[i - 1]], verts[v]) - 0.01
      const okR = i === lay.length - 1 || cpos[lay[i + 1]] - t >= sep(verts[v], verts[lay[i + 1]]) - 0.01
      if (okL && okR) cpos[v] = t
    })
  }

  // Normalise to a top-left origin.
  let minC = Infinity
  let maxC = -Infinity
  for (const l of layers)
    for (const v of l) {
      minC = Math.min(minC, cpos[v] - verts[v].cross / 2)
      maxC = Math.max(maxC, cpos[v] + verts[v].cross / 2)
    }
  const pos = new Map<string, Pt>()
  for (let i = 0; i < n; i++) {
    const c = cpos[i] - minC
    const m = layerStart[layer[i]] + layerMain[layer[i]] / 2
    pos.set(ids[i], dir === "TB" ? { x: c, y: m } : { x: m, y: c })
  }
  const crossExtent = maxC - minC
  return dir === "TB" ? { pos, w: crossExtent, h: totalMain } : { pos, w: totalMain, h: crossExtent }
}

/** Counter slot sizing: the widest value the story will show. */
function counterSlot(spec: GraphSpec, c: NonNullable<GraphSpec["nodes"][number]["counter"]>) {
  const values = [c.value ?? 0]
  if (spec.story && spec.story !== "auto" && spec.story.steps !== "auto")
    for (const st of spec.story.steps) for (const x of Array.isArray(st.counter) ? st.counter : st.counter ? [st.counter] : []) if (x.id === c.id && typeof x.to === "number") values.push(x.to)
  const dec = Math.max(...values.map((v) => (Number.isInteger(v) ? 0 : Math.min(3, String(v).split(".")[1]?.length ?? 0))))
  const fmt = (v: number) => `${c.prefix ?? ""}${v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })}${c.suffix ?? ""}`
  const widest = values.map(fmt).sort((a, b) => b.length - a.length)[0]
  return { id: c.id, value: c.value ?? 0, label: c.label, prefix: c.prefix, suffix: c.suffix, widest }
}

/** Target aspect ratio (w/h) for auto direction. */
export const AUTO_ASPECT = 1.6

/**
 * Lay out a graph spec. With no `direction`, both TB and LR are laid out and
 * the one whose viewBox aspect ratio is closest to 16:10 wins (log distance).
 */
export function layoutGraph(spec: GraphSpec): Scene {
  if (spec.direction) return layoutGraphDir(spec, spec.direction)
  const tb = layoutGraphDir(spec, "TB")
  const lr = layoutGraphDir(spec, "LR")
  const score = (sc: Scene) => Math.abs(Math.log(sc.viewBox.w / sc.viewBox.h / AUTO_ASPECT))
  return score(lr) < score(tb) - 0.05 ? lr : tb
}

type Base = "TB" | "LR"
const baseOf = (d: Direction): Base => (d === "TB" || d === "BT" ? "TB" : "LR")
const isReversed = (d: Direction) => d === "BT" || d === "RL"

function layoutGraphDir(spec: GraphSpec, direction: Direction): Scene {
  const dir = baseOf(direction)
  const tags = spec.type === "architecture" || spec.type === "dataflow"
  const groupsById = new Map((spec.groups ?? []).map((g) => [g.id, g]))
  // Composite lifecycle states behave as groups.
  const composites = new Set(spec.nodes.filter((n) => n.kind === "composite").map((n) => n.id))
  const parent = new Map<string, string | undefined>()
  for (const g of spec.groups ?? []) parent.set(g.id, g.parent)
  for (const n of spec.nodes) parent.set(n.id, n.parent)
  const containerIds = [...groupsById.keys(), ...composites]
  const isContainer = (id: string) => groupsById.has(id) || composites.has(id)
  const children = new Map<string | undefined, string[]>()
  const order = [...containerIds.filter((id) => groupsById.has(id)), ...spec.nodes.map((n) => n.id)]
  for (const id of order) {
    const p = parent.get(id)
    const list = children.get(p) ?? []
    list.push(id)
    children.set(p, list)
  }
  const sized = new Map<string, SceneNode>()
  for (const n of spec.nodes)
    if (!composites.has(n.id))
      sized.set(
        n.id,
        sizeNode({ id: n.id, kind: n.kind ?? "service", label: n.label ?? n.id, detail: n.detail, tag: n.tag, ...(n.counter ? { counter: counterSlot(spec, n.counter) } : {}) }, { tags }),
      )

  const chain = (id: string): string[] => {
    const out: string[] = []
    for (let cur: string | undefined = id; cur !== undefined; cur = parent.get(cur)) out.push(cur)
    return out
  }
  const edges = spec.edges ?? []
  const labelSize = (s?: string) =>
    s ? { w: textWidth(s, T.edgeLabel) + 2 * G.pillPadX, h: T.edgeLabel + 2 * G.pillPadY + 4 } : { w: 0, h: 0 }

  const levelOf = new Map<string, LevelLayout>()
  const groupSize = new Map<string, { w: number; h: number }>()
  const groupLabelOf = (id: string) => groupsById.get(id)?.label ?? spec.nodes.find((n) => n.id === id)?.label ?? id

  const levelDir = new Map<string, Direction>()
  const solve = (container: string | undefined, inherited: Direction = direction): { w: number; h: number } => {
    const kids = children.get(container) ?? []
    const own: Direction =
      (container && (groupsById.get(container)?.direction ?? spec.nodes.find((n) => n.id === container)?.direction)) || inherited
    levelDir.set(container ?? "", own)
    const members: Member[] = kids.map((id) => {
      if (isContainer(id)) {
        const s = solve(id, own)
        return { id, w: s.w, h: s.h, group: true }
      }
      const s = sized.get(id)!
      // Fork/join bars run across the flow.
      if (s.shape === "bar" && baseOf(own) === "LR" && s.w > s.h) [s.w, s.h] = [s.h, s.w]
      return { id, w: s.w, h: s.h, group: false }
    })
    const kidSet = new Set(kids)
    const lifted: LevelEdge[] = []
    for (const e of edges) {
      const a = chain(e.from).find((x) => kidSet.has(x))
      const b = chain(e.to).find((x) => kidSet.has(x))
      if (!a || !b || a === b) continue
      // Only lift when the common container is exactly this one.
      const ls = labelSize(e.label)
      lifted.push({ from: a, to: b, labelW: ls.w, labelH: ls.h })
    }
    const lay = layoutLevel(members, lifted, baseOf(own))
    levelOf.set(container ?? "", lay)
    if (container === undefined) return { w: lay.w, h: lay.h }
    const labelW = textWidth(groupLabelOf(container).toUpperCase(), T.groupLabel, T.tagTracking) + 2 * G.groupPad
    const size = {
      w: snap(Math.max(lay.w + 2 * G.groupPad, labelW, 120), 2),
      h: snap(Math.max(lay.h, kids.length ? 0 : 40) + 2 * G.groupPad + G.groupLabelBand - 6, 2),
    }
    groupSize.set(container, size)
    return size
  }
  const root = solve(undefined)

  // Absolute placement.
  const groups: SceneGroup[] = []
  const placeLevel = (container: string | undefined, ox: number, oy: number, innerW: number, depth: number) => {
    const lay = levelOf.get(container ?? "")!
    const dx = (innerW - lay.w) / 2
    const ld = levelDir.get(container ?? "") ?? direction
    for (const id of children.get(container) ?? []) {
      const c0 = lay.pos.get(id)!
      // BT / RL: mirror the main axis within this level.
      const c = ld === "BT" ? { x: c0.x, y: lay.h - c0.y } : ld === "RL" ? { x: lay.w - c0.x, y: c0.y } : c0
      if (isContainer(id)) {
        const s = groupSize.get(id)!
        const x = ox + dx + c.x - s.w / 2
        const y = oy + c.y - s.h / 2
        groups.push({
          id,
          label: groupLabelOf(id),
          kind: groupsById.get(id)?.kind,
          depth,
          composite: composites.has(id),
          x: r2(x),
          y: r2(y),
          w: s.w,
          h: s.h,
        })
        placeLevel(id, x + G.groupPad, y + G.groupPad + G.groupLabelBand - 6, s.w - 2 * G.groupPad, depth + 1)
      } else {
        const node = sized.get(id)!
        node.x = r2(ox + dx + c.x - node.w / 2)
        node.y = r2(oy + c.y - node.h / 2)
      }
    }
  }
  const M = G.margin
  placeLevel(undefined, M, M, root.w, 0)
  const nodes = [...sized.values()]
  const boxes = new Map<string, Box>([...nodes.map((n) => [n.id, n] as const), ...groups.map((g) => [g.id, g] as const)])

  const arrowheads = spec.style?.arrowheads ?? G.graphArrowheads
  const routed = routeEdges(spec, direction, boxes, nodes, groups, labelSize, arrowheads)

  // viewBox: content bounds plus margin.
  let maxX = M + root.w
  let maxY = M + root.h
  let minX = 0
  let minY = 0
  for (const e of routed.edges) {
    for (const p of e.points) {
      maxX = Math.max(maxX, p.x + M / 2)
      maxY = Math.max(maxY, p.y + M / 2)
      minX = Math.min(minX, p.x - M / 2)
      minY = Math.min(minY, p.y - M / 2)
    }
    if (e.label) {
      maxX = Math.max(maxX, e.label.x + e.label.w + 8)
      maxY = Math.max(maxY, e.label.y + e.label.h + 8)
      minX = Math.min(minX, e.label.x - 8)
      minY = Math.min(minY, e.label.y - 8)
    }
  }
  return {
    type: spec.type,
    title: spec.title,
    ...(spec.subtitle ? { subtitle: spec.subtitle } : {}),
    direction,
    viewBox: { x: r2(minX), y: r2(minY), w: r2(snap(maxX + M - minX)), h: r2(snap(maxY + M - minY)) },
    groups: groups.sort((a, b) => a.depth - b.depth),
    nodes,
    edges: routed.edges,
    ports: routed.ports,
    lifelines: [],
    activations: [],
    frames: [],
    bands: [],
    boxes: [],
  }
}

type Side = "top" | "right" | "bottom" | "left"
const SIDE_DIR: Record<Side, Dir> = { right: 0, bottom: 1, left: 2, top: 3 }
const OPP: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" }

function routeEdges(
  spec: GraphSpec,
  direction: Direction,
  boxes: Map<string, Box>,
  nodes: SceneNode[],
  groups: SceneGroup[],
  labelSize: (s?: string) => { w: number; h: number },
  arrowheads: boolean,
): { edges: SceneEdge[]; ports: ScenePort[] } {
  const dir = baseOf(direction)
  const rev = isReversed(direction)
  const edges = spec.edges ?? []
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const fwdSide: Side = direction === "TB" ? "bottom" : direction === "BT" ? "top" : direction === "LR" ? "right" : "left"
  const backSide: Side = dir === "TB" ? "right" : "bottom"
  // Main-axis extents measured in flow order (reversed layouts flip the sign).
  const mainLo = (b: Box) => (dir === "TB" ? (rev ? -(b.y + b.h) : b.y) : rev ? -(b.x + b.w) : b.x)
  const mainHi = (b: Box) => (dir === "TB" ? (rev ? -b.y : b.y + b.h) : rev ? -b.x : b.x + b.w)
  const crossC = (b: Box) => (dir === "TB" ? b.x + b.w / 2 : b.y + b.h / 2)
  const mainC = (b: Box) => (dir === "TB" ? b.y + b.h / 2 : b.x + b.w / 2)

  interface Plan {
    i: number
    a: Box
    b: Box
    sa: Side
    sb: Side
    self: boolean
  }
  const plans: Plan[] = edges.map((e, i) => {
    const a = boxes.get(e.from)!
    const b = boxes.get(e.to)!
    if (e.from === e.to) return { i, a, b, sa: backSide, sb: backSide, self: true }
    // Edge between a group and its own descendant: enter from the inside edge.
    let sa: Side
    let sb: Side
    if (mainLo(b) >= mainHi(a) - EPS) {
      sa = fwdSide
      sb = OPP[fwdSide]
    } else if (mainHi(b) <= mainLo(a) + EPS) {
      sa = backSide
      sb = backSide
    } else {
      // Same band: connect the facing cross-axis sides.
      const toward = crossC(b) > crossC(a)
      if (dir === "TB") {
        sa = toward ? "right" : "left"
        sb = OPP[sa]
      } else {
        sa = toward ? "bottom" : "top"
        sb = OPP[sa]
      }
    }
    const na = nodeById.get(e.from)
    // Decisions branch sideways from their vertices when the target is off-axis.
    if (na?.shape === "diamond" && sa === fwdSide) {
      const off = crossC(b) - crossC(a)
      if (Math.abs(off) > a.w / 5 && dir === "TB") sa = off > 0 ? "right" : "left"
      if (Math.abs(off) > a.h / 5 && dir === "LR") sa = off > 0 ? "bottom" : "top"
    }
    return { i, a, b, sa, sb, self: false }
  })

  // Distribute ports along each side, ordered by the far end's position.
  interface Slot {
    plan: Plan
    end: "a" | "b"
  }
  const slots = new Map<string, Slot[]>()
  for (const p of plans) {
    const e = edges[p.i]
    for (const [end, id, side] of [
      ["a", e.from, p.sa],
      ["b", e.to, p.sb],
    ] as const) {
      const k = `${id}|${side}`
      const l = slots.get(k) ?? []
      l.push({ plan: p, end })
      slots.set(k, l)
    }
  }
  const portAt = new Map<string, Pt>()
  for (const [k, list] of slots) {
    const [id, side] = k.split("|") as [string, Side]
    const box = boxes.get(id)!
    const node = nodeById.get(id)
    const horizontalSide = side === "top" || side === "bottom"
    const far = (s: Slot) => {
      const other = s.end === "a" ? s.plan.b : s.plan.a
      return horizontalSide ? other.x + other.w / 2 : other.y + other.h / 2
    }
    list.sort((x, y) => far(x) - far(y) || x.plan.i - y.plan.i)
    const single = !node || node.shape === "diamond" || node.shape === "dot" || node.shape === "bullseye" || node.shape === "choice"
    const n = list.length
    list.forEach((s, k2) => {
      const t = single && node ? 0.5 : (k2 + 1) / (n + 1)
      let inset = 0
      if (node?.shape === "pill" && horizontalSide) inset = box.h / 2
      const span = (horizontalSide ? box.w : box.h) - 2 * inset
      const along = (horizontalSide ? box.x : box.y) + inset + span * t
      let pt: Pt
      if (side === "top") pt = { x: along, y: box.y }
      else if (side === "bottom") pt = { x: along, y: box.y + box.h }
      else if (side === "left") pt = { x: box.x, y: along }
      else pt = { x: box.x + box.w, y: along }
      if (node?.shape === "slant" && !horizontalSide) pt.x += side === "left" ? 6 : -6
      if (node?.shape === "cylinder" && side === "top") pt.y += 4
      portAt.set(`${s.plan.i}|${s.end}`, { x: r2(pt.x), y: r2(pt.y) })
    })
  }

  // Obstacles: every leaf node.
  // Straighten near-miss pairs: if the two ports of a forward edge differ by
  // a few px, slide one onto the other's line so the wire needs no jog.
  const portsOn = new Map<string, Pt[]>()
  for (const [k, list] of slots) portsOn.set(k, list.map((s) => portAt.get(`${s.plan.i}|${s.end}`)!))
  for (const p of plans) {
    if (p.self) continue
    const e = edges[p.i]
    const pa = portAt.get(`${p.i}|a`)!
    const pb = portAt.get(`${p.i}|b`)!
    const horiz = p.sa === "left" || p.sa === "right"
    if ((p.sb === "left" || p.sb === "right") !== horiz) continue
    const ca = horiz ? pa.y : pa.x
    const cb = horiz ? pb.y : pb.x
    const d = Math.abs(ca - cb)
    if (d < 0.5 || d > 18) continue
    const tryMove = (pt: Pt, id: string, side: Side, to: number) => {
      const box = boxes.get(id)!
      const node = nodeById.get(id)
      if (node && (node.shape === "diamond" || node.shape === "dot" || node.shape === "bullseye" || node.shape === "pill" || node.shape === "choice")) return false
      const lo = (horiz ? box.y : box.x) + 8
      const hi = (horiz ? box.y + box.h : box.x + box.w) - 8
      if (to < lo || to > hi) return false
      const sib = portsOn.get(`${id}|${side}`) ?? []
      if (sib.some((q) => q !== pt && Math.abs((horiz ? q.y : q.x) - to) < 10)) return false
      if (horiz) pt.y = r2(to)
      else pt.x = r2(to)
      return true
    }
    if (!tryMove(pb, e.to, p.sb, ca)) tryMove(pa, e.from, p.sa, cb)
  }

  const obstacles = nodes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }))
  const router = new Router(obstacles, { margin: 8, stub: G.stub, bend: 28 })
  router.avoid(
    groups.map((g) => [
      { x: g.x, y: g.y },
      { x: g.x + g.w, y: g.y },
      { x: g.x + g.w, y: g.y + g.h },
      { x: g.x, y: g.y + g.h },
      { x: g.x, y: g.y },
    ]),
  )
  const out: SceneEdge[] = []
  const ports: ScenePort[] = []
  const placedLabels: Box[] = []
  // Route short edges first so long ones detour around them.
  const orderIdx = [...plans].sort((p, q) => {
    const lp = Math.abs(mainC(p.b) - mainC(p.a)) + Math.abs(crossC(p.b) - crossC(p.a))
    const lq = Math.abs(mainC(q.b) - mainC(q.a)) + Math.abs(crossC(q.b) - crossC(q.a))
    return lp - lq || p.i - q.i
  })
  const result = new Array<SceneEdge>(edges.length)
  const rails: { at: number; lo: number; hi: number }[] = []
  for (const p of orderIdx) {
    const e = edges[p.i]
    const id = e.id ?? `${e.from}->${e.to}`
    const from = portAt.get(`${p.i}|a`)!
    const to = portAt.get(`${p.i}|b`)!
    let points: Pt[]
    if (p.self) {
      const b = p.a
      const s = 22
      points =
        dir === "TB"
          ? [
              { x: b.x + b.w, y: b.y + b.h * 0.35 },
              { x: b.x + b.w + s, y: b.y + b.h * 0.35 },
              { x: b.x + b.w + s, y: b.y + b.h * 0.7 },
              { x: b.x + b.w, y: b.y + b.h * 0.7 },
            ]
          : [
              { x: b.x + b.w * 0.35, y: b.y + b.h },
              { x: b.x + b.w * 0.35, y: b.y + b.h + s },
              { x: b.x + b.w * 0.7, y: b.y + b.h + s },
              { x: b.x + b.w * 0.7, y: b.y + b.h },
            ]
    } else {
      // A container endpoint that encloses the other end is not an obstacle concern;
      // the router only avoids leaf nodes.
      if (p.sa === backSide && p.sb === backSide) {
        // Return loop: a tidy rail 24 px outside everything it passes.
        const horiz = dir === "TB" // rail is vertical (x) in TB, horizontal (y) in LR
        const lo = horiz ? Math.min(from.y, to.y) : Math.min(from.x, to.x)
        const hi = horiz ? Math.max(from.y, to.y) : Math.max(from.x, to.x)
        let rail = horiz ? Math.max(from.x, to.x) : Math.max(from.y, to.y)
        for (const n of nodes) {
          const nlo = horiz ? n.y : n.x
          const nhi = horiz ? n.y + n.h : n.x + n.w
          if (nhi >= lo - 1 && nlo <= hi + 1) rail = Math.max(rail, horiz ? n.x + n.w : n.y + n.h)
        }
        rail += 24
        for (const r of rails) if (r.hi >= lo && r.lo <= hi && Math.abs(r.at - rail) < 10) rail = r.at + 12
        const cand = horiz
          ? [from, { x: rail, y: from.y }, { x: rail, y: to.y }, to]
          : [from, { x: from.x, y: rail }, { x: to.x, y: rail }, to]
        // Only use the rail when its legs don't cut through other nodes.
        const hits = nodes.some(
          (n) =>
            n.id !== e.from &&
            n.id !== e.to &&
            cand.slice(1).some((b, k) => segHitsBox(cand[k], b, { x: n.x - 4, y: n.y - 4, w: n.w + 8, h: n.h + 8 })),
        )
        if (!hits) {
          rails.push({ at: rail, lo, hi })
          points = cand
          router.avoid([points])
        } else points = router.route({ from, fromDir: SIDE_DIR[p.sa], to, toDir: ((SIDE_DIR[p.sb] + 2) % 4) as Dir })
      } else points = router.route({ from, fromDir: SIDE_DIR[p.sa], to, toDir: ((SIDE_DIR[p.sb] + 2) % 4) as Dir })
    }
    const heads: Arrowhead[] = []
    const arrow = e.arrow ?? "end"
    const headAt = (tip: Pt, prev: Pt): Arrowhead => ({
      x: tip.x,
      y: tip.y,
      angle: r2(Math.atan2(tip.y - prev.y, tip.x - prev.x)),
      form: "filled",
    })
    if (arrowheads && (arrow === "end" || arrow === "both")) heads.push(headAt(points[points.length - 1], points[points.length - 2]))
    if (arrowheads && arrow === "both") heads.push(headAt(points[0], points[1]))
    const edge: SceneEdge = {
      id,
      from: e.from,
      to: e.to,
      d: wirePath(points, G.elbowRadius, G.cornerRadius),
      points: points.map((q) => ({ x: r2(q.x), y: r2(q.y) })),
      style: e.style ?? "solid",
      arrow,
      heads,
    }
    result[p.i] = edge
    ports.push(
      { id: `${id}:out`, node: e.from, edge: id, end: "out", covered: arrowheads && arrow === "both", ...from },
      { id: `${id}:in`, node: e.to, edge: id, end: "in", covered: arrowheads && arrow !== "none", ...to },
    )
  }
  // Labels after all wires exist, so they can avoid nodes, other labels, wires and group rules.
  const segsOf = (pts: Pt[]) => pts.slice(1).map((b, k) => [pts[k], b] as const)
  const groupRules: (readonly [Pt, Pt])[] = []
  for (const g of groups) {
    const a = { x: g.x, y: g.y }
    const b = { x: g.x + g.w, y: g.y }
    const c = { x: g.x + g.w, y: g.y + g.h }
    const d = { x: g.x, y: g.y + g.h }
    groupRules.push([a, b], [b, c], [c, d], [d, a])
  }
  const groupTitles = groups.map((g) => ({ x: g.x, y: g.y, w: Math.min(g.w, 260), h: 24 }))
  plans.forEach((p) => {
    const e = edges[p.i]
    if (!e.label) return
    const edge = result[p.i]
    const others = result.filter((o) => o !== edge).flatMap((o) => segsOf(o.points))
    const lbl = placeLabel(`${edge.id}:label`, e.label, edge.points, labelSize(e.label), obstacles, placedLabels, others, groupRules, groupTitles)
    const cx = lbl.x + lbl.w / 2
    const cy = lbl.y + lbl.h / 2
    const inside = groups.filter((g) => cx > g.x && cx < g.x + g.w && cy > g.y && cy < g.y + g.h).sort((a, b) => b.depth - a.depth)[0]
    lbl.surface = inside ? (inside.composite ? "composite" : "group") : "bg"
    edge.label = lbl
  })
  out.push(...result)
  void groups
  return { edges: out, ports }
}

function overlaps(a: Box, b: Box, pad = 0): boolean {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad
}

function segHitsBox(a: Pt, b: Pt, box: Box): boolean {
  const x1 = Math.min(a.x, b.x)
  const x2 = Math.max(a.x, b.x)
  const y1 = Math.min(a.y, b.y)
  const y2 = Math.max(a.y, b.y)
  return x1 < box.x + box.w && x2 > box.x && y1 < box.y + box.h && y2 > box.y
}

function placeLabel(
  id: string,
  text: string,
  points: Pt[],
  size: { w: number; h: number },
  obstacles: Box[],
  placed: Box[],
  wires: (readonly [Pt, Pt])[],
  rules: (readonly [Pt, Pt])[],
  titles: Box[],
): SceneLabel {
  const segs: { a: Pt; b: Pt; len: number }[] = []
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]
    const b = points[i + 1]
    segs.push({ a, b, len: Math.hypot(b.x - a.x, b.y - a.y) })
  }
  // Candidates: along each segment, longest first; prefer the middle.
  const cands: Pt[] = []
  const bySize = [...segs].filter((s) => s.len > 4).sort((x, y) => y.len - x.len)
  for (const s of bySize)
    for (const t of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8])
      cands.push({ x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t })
  // Own bends: a label must not sit on a corner of its own wire.
  const own = points.slice(1).map((b, k) => [points[k], b] as const)
  let best: Box | undefined
  let bestScore = Infinity
  cands.forEach((c, k) => {
    const box = { x: c.x - size.w / 2, y: c.y - size.h / 2, w: size.w, h: size.h }
    let score = k * 0.01
    for (const o of obstacles) if (overlaps(box, o, 2)) score += 10
    for (const o of placed) if (overlaps(box, o, 3)) score += 6
    for (const [a, b] of wires) if (segHitsBox(a, b, box)) score += 2
    for (const [a, b] of rules) if (segHitsBox(a, b, box)) score += 1.5
    for (const t of titles) if (overlaps(box, t, 0)) score += 1.5
    const hits = own.filter(([a, b]) => segHitsBox(a, b, box)).length
    if (hits > 1) score += 0.8 * (hits - 1)
    if (score < bestScore) {
      bestScore = score
      best = box
    }
  })
  const b = best!
  const box = { x: r2(b.x), y: r2(b.y), w: r2(size.w), h: r2(size.h) }
  placed.push(box)
  return { id, text, ...box }
}
