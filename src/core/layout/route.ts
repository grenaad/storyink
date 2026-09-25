import type { Box, Pt } from "../scene.ts"
import { dedupe } from "./paths.ts"

/** 0 right, 1 down, 2 left, 3 up. */
export type Dir = 0 | 1 | 2 | 3
export const DX = [1, 0, -1, 0]
export const DY = [0, 1, 0, -1]

export interface RouteRequest {
  /** Port on the source boundary. */
  from: Pt
  /** Direction leaving the source. */
  fromDir: Dir
  /** Port on the target boundary. */
  to: Pt
  /** Direction of travel entering the target. */
  toDir: Dir
}

export interface RouterOptions {
  margin: number
  stub: number
  bend: number
}

class Heap {
  private k: number[] = []
  private v: number[] = []
  get size() {
    return this.k.length
  }
  push(key: number, value: number) {
    const k = this.k
    const v = this.v
    let i = k.length
    k.push(key)
    v.push(value)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (k[p] <= key) break
      k[i] = k[p]
      v[i] = v[p]
      i = p
    }
    k[i] = key
    v[i] = value
  }
  pop(): number {
    const k = this.k
    const v = this.v
    const top = v[0]
    const lk = k.pop()!
    const lv = v.pop()!
    if (k.length) {
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        if (l >= k.length) break
        const r = l + 1
        const c = r < k.length && k[r] < k[l] ? r : l
        if (k[c] >= lk) break
        k[i] = k[c]
        v[i] = v[c]
        i = c
      }
      k[i] = lk
      v[i] = lv
    }
    return top
  }
}

const key = (n: number) => Math.round(n * 100) / 100

function uniqSorted(values: number[]): number[] {
  const s = [...new Set(values.map(key))].sort((a, b) => a - b)
  return s
}

/**
 * Orthogonal router on a sparse visibility grid built from obstacle
 * boundaries (inflated by `margin`) and channel midlines. Dijkstra over
 * (point, heading) minimises length + bend penalty + reuse of earlier wires.
 * Deterministic for a given input order.
 */
export class Router {
  private obstacles: Box[]
  private baseX: number[]
  private baseY: number[]
  private usedH = new Map<number, [number, number][]>()
  private usedV = new Map<number, [number, number][]>()

  constructor(
    obstacles: Box[],
    private opts: RouterOptions,
  ) {
    const m = opts.margin
    this.obstacles = obstacles.map((b) => ({ x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m }))
    const xs: number[] = []
    const ys: number[] = []
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const b of this.obstacles) {
      xs.push(b.x, b.x + b.w)
      ys.push(b.y, b.y + b.h)
      minX = Math.min(minX, b.x)
      minY = Math.min(minY, b.y)
      maxX = Math.max(maxX, b.x + b.w)
      maxY = Math.max(maxY, b.y + b.h)
    }
    if (Number.isFinite(minX)) {
      xs.push(minX - 2 * m, maxX + 2 * m)
      ys.push(minY - 2 * m, maxY + 2 * m)
    }
    const withMid = (v: number[]) => {
      const s = uniqSorted(v)
      const out = [...s]
      for (let i = 0; i + 1 < s.length; i++) out.push((s[i] + s[i + 1]) / 2)
      return out
    }
    this.baseX = withMid(xs)
    this.baseY = withMid(ys)
  }

  private inside(x: number, y: number): boolean {
    for (const b of this.obstacles)
      if (x > b.x + 0.01 && x < b.x + b.w - 0.01 && y > b.y + 0.01 && y < b.y + b.h - 0.01) return true
    return false
  }

  private overlap(horizontal: boolean, line: number, a: number, b: number): number {
    const list = (horizontal ? this.usedH : this.usedV).get(key(line))
    if (!list) return 0
    let o = 0
    for (const [s, e] of list) o += Math.max(0, Math.min(b, e) - Math.max(a, s))
    return o
  }

  private record(points: Pt[]) {
    for (let i = 0; i + 1 < points.length; i++) {
      const p = points[i]
      const q = points[i + 1]
      if (Math.abs(p.y - q.y) < 0.01) {
        const k = key(p.y)
        const l = this.usedH.get(k) ?? []
        l.push([Math.min(p.x, q.x), Math.max(p.x, q.x)])
        this.usedH.set(k, l)
      } else if (Math.abs(p.x - q.x) < 0.01) {
        const k = key(p.x)
        const l = this.usedV.get(k) ?? []
        l.push([Math.min(p.y, q.y), Math.max(p.y, q.y)])
        this.usedV.set(k, l)
      }
    }
  }

  route(req: RouteRequest): Pt[] {
    const { stub, bend } = this.opts
    const S = { x: req.from.x + DX[req.fromDir] * stub, y: req.from.y + DY[req.fromDir] * stub }
    const T = { x: req.to.x - DX[req.toDir] * stub, y: req.to.y - DY[req.toDir] * stub }
    const xs = uniqSorted([...this.baseX, S.x, T.x])
    const ys = uniqSorted([...this.baseY, S.y, T.y])
    const nx = xs.length
    const ny = ys.length
    const sx = xs.indexOf(key(S.x))
    const sy = ys.indexOf(key(S.y))
    const tx = xs.indexOf(key(T.x))
    const ty = ys.indexOf(key(T.y))
    const blocked = new Uint8Array(nx * ny)
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (this.inside(xs[i], ys[j])) blocked[j * nx + i] = 1
    blocked[sy * nx + sx] = 0
    blocked[ty * nx + tx] = 0

    const N = nx * ny * 4
    const dist = new Float64Array(N).fill(Infinity)
    const prev = new Int32Array(N).fill(-1)
    const heap = new Heap()
    const start = (sy * nx + sx) * 4 + req.fromDir
    dist[start] = 0
    heap.push(0, start)
    let goal = -1
    while (heap.size) {
      const s = heap.pop()
      const d = dist[s]
      const cell = s >> 2
      const dir = s & 3
      const i = cell % nx
      const j = (cell - i) / nx
      if (i === tx && j === ty) {
        if (dir === req.toDir) {
          goal = s
          break
        }
        // turning into the target direction at T
        if ((dir + 2) % 4 !== req.toDir) {
          const g = cell * 4 + req.toDir
          if (d + bend < dist[g]) {
            dist[g] = d + bend
            prev[g] = s
            heap.push(d + bend, g)
          }
        }
        continue
      }
      for (let nd = 0 as Dir; nd < 4; nd = (nd + 1) as Dir) {
        if ((dir + 2) % 4 === nd) continue
        const ni = i + DX[nd]
        const nj = j + DY[nd]
        if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue
        const ncell = nj * nx + ni
        if (blocked[ncell]) continue
        const x0 = xs[i]
        const y0 = ys[j]
        const x1 = xs[ni]
        const y1 = ys[nj]
        if (this.inside((x0 + x1) / 2, (y0 + y1) / 2)) continue
        const len = Math.abs(x1 - x0) + Math.abs(y1 - y0)
        const horizontal = nd === 0 || nd === 2
        const ov = horizontal
          ? this.overlap(true, y0, Math.min(x0, x1), Math.max(x0, x1))
          : this.overlap(false, x0, Math.min(y0, y1), Math.max(y0, y1))
        const cost = d + len + (nd !== dir ? bend : 0) + ov * 1.5
        const ns = ncell * 4 + nd
        if (cost < dist[ns] - 1e-9) {
          dist[ns] = cost
          prev[ns] = s
          heap.push(cost, ns)
        }
      }
    }
    let pts: Pt[]
    if (goal < 0) {
      pts = [req.from, S, { x: S.x, y: T.y }, T, req.to]
    } else {
      const cells: Pt[] = []
      for (let s = goal; s >= 0; s = prev[s]) {
        const cell = s >> 2
        const i = cell % nx
        const j = (cell - i) / nx
        cells.push({ x: xs[i], y: ys[j] })
      }
      cells.reverse()
      pts = dedupe([req.from, ...cells, req.to])
    }
    this.record(pts)
    return pts
  }
}
