/**
 * Acts (problem → rewind → fix): one stage, several scenarios. Membership of nodes / groups /
 * edges per act, the delta look switched off in act stories, and coexistence (routing, lint).
 * Browser-safe.
 */
import type { Scene } from "../scene.ts"
import type { GraphSpec, Spec, StoryAct } from "../spec.ts"
import { parseRef } from "../anchor.ts"
import { closest } from "../suggest.ts"
import type { TimelineAct } from "./types.ts"

/** Rewind window length bounds (s) and the share of the previous act it takes. */
export const REWIND = { share: 0.25, min: 0.6, max: 1.5 } as const
/** Cut: the dip (s). */
export const CUT = 0.4
/** Morph stages (s): wires retract, leaving boxes fade, entering boxes reveal, entering wires draw. */
export const MORPH = { retract: 0.5, fade: 0.35, reveal: 0.53, wire: 0.6 } as const
/** Act chip crossfade (s). */
export const CHIP_FADE = 0.25
/** Chip text during a rewind. */
export const REWIND_CHIP = "\u25c0\u25c0 rewind"
/** A time no event reaches: steps of an act a rewind undid happen "never" in later acts' state. */
export const NEVER = 1e6

/** The story's acts when it has any (graph diagrams; ids and labels as given). */
export function specActs(spec: Spec): StoryAct[] | undefined {
  const st = spec.story
  if (!st || typeof st !== "object" || !Array.isArray(st.acts) || !st.acts.length) return undefined
  if (spec.type === "sequence") return undefined
  const acts = st.acts.filter((a): a is StoryAct => !!a && typeof a === "object" && typeof a.id === "string")
  return acts.length ? acts : undefined
}

/**
 * Acts each element is on stage in (only elements not in every act): `in`, else `delta`
 * (removed → the first act, added → every act but the first). An edge is also limited to the
 * acts both its ends are in.
 */
export function membership(spec: GraphSpec, acts: StoryAct[]): Map<string, string[]> {
  const all = acts.map((a) => a.id)
  const known = new Set(all)
  const own = (x: { in?: string[]; delta?: string }): string[] => {
    if (Array.isArray(x.in)) return all.filter((id) => x.in!.includes(id) && known.has(id))
    if (x.delta === "removed") return all.slice(0, 1)
    if (x.delta === "added") return all.slice(1)
    return all
  }
  const out = new Map<string, string[]>()
  const of = new Map<string, string[]>()
  for (const g of spec.groups ?? []) of.set(g.id, own(g))
  for (const n of spec.nodes) of.set(n.id, own(n))
  for (const [id, a] of of) if (a.length < all.length) out.set(id, a)
  for (const e of spec.edges ?? []) {
    const id = e.id ?? `${e.from}->${e.to}`
    const ends = [of.get(parseRef(e.from).node) ?? all, of.get(parseRef(e.to).node) ?? all]
    const a = own(e).filter((x) => ends.every((l) => l.includes(x)))
    if (a.length < all.length) out.set(id, a)
  }
  return out
}

/** Act stories show no delta look (ghosts, badges, colours, legend): `delta` only decides membership. */
export function withoutDeltaLook<T extends Spec>(spec: T): T {
  if (!specActs(spec) || spec.type === "sequence") return spec
  const g = spec as GraphSpec
  const strip = <X extends { delta?: unknown }>(x: X): X => {
    if (x.delta === undefined) return x
    const { delta: _d, ...rest } = x
    return rest as X
  }
  return { ...g, nodes: g.nodes.map(strip), edges: (g.edges ?? []).map(strip), groups: (g.groups ?? []).map(strip) } as T
}

/** Do two scene elements (node / group / edge ids, or edge-label ids) share an act? Always true without acts. */
export function coexist(scene: Scene, a: string, b: string): boolean {
  const of = (id: string): string[] | undefined =>
    scene.nodes.find((x) => x.id === id)?.acts ?? scene.groups.find((x) => x.id === id)?.acts ?? scene.edges.find((x) => x.id === id || `${x.id}:label` === id)?.acts
  const x = of(a)
  const y = of(b)
  if (!x || !y) return true
  return x.some((k) => y.includes(k))
}

/** Is element `id` on stage in act `act` (scene membership)? */
export function presentIn(scene: Scene, id: string, act: string): boolean {
  const el = scene.nodes.find((x) => x.id === id) ?? scene.groups.find((x) => x.id === id) ?? scene.edges.find((x) => x.id === id)
  return !el?.acts || el.acts.includes(act)
}

type Report = (path: string, message: string, hint?: string) => void

/** Which act each step belongs to, where each act starts and how it enters. */
export interface ActPlan {
  acts: StoryAct[]
  /** Act index per step. */
  of: number[]
  /** Entry step per act (act 0: step 0); undefined = the act never starts. */
  entry: (number | undefined)[]
  enter: ("rewind" | "cut" | "continue")[]
}

const ENTERS = ["rewind", "cut", "continue"] as const

/**
 * Resolve `act` / `enter` step fields: acts start in declared order, each once; the first act
 * starts at step 0 unless a step names it there; steps belong to the act most recently started.
 */
export function actPlan(steps: { act?: unknown; enter?: unknown; change?: unknown }[], acts: StoryAct[], err: Report, warn: Report): ActPlan {
  const ids = acts.map((a) => a.id)
  const entry: (number | undefined)[] = acts.map((_, k) => (k === 0 ? 0 : undefined))
  const enter: ActPlan["enter"] = acts.map(() => "rewind")
  const of: number[] = []
  let cur = 0
  steps.forEach((st, i) => {
    const p = `story.steps[${i}]`
    if (st?.act !== undefined) {
      const k = typeof st.act === "string" ? ids.indexOf(st.act) : -1
      if (k < 0) {
        const g = typeof st.act === "string" ? closest(st.act, ids) : undefined
        err(`${p}.act`, `unknown act ${JSON.stringify(st.act)}`, g ? `did you mean "${g}"? (acts: ${ids.join(", ")})` : `acts: ${ids.join(", ")}`)
      } else if (k === 0) {
        if (i !== 0) err(`${p}.act`, `act "${ids[0]}" is the first act; it starts at step 0`, `name it on the first step, or drop "act" here`)
      } else if (entry[k] !== undefined) err(`${p}.act`, `act "${ids[k]}" already started at step ${entry[k]! + 1}`, "each act starts once")
      else if (k !== cur + 1) err(`${p}.act`, `act "${ids[k]}" starts out of order`, `acts start in declared order: next is "${ids[cur + 1] ?? ids[cur]}"`)
      else {
        entry[k] = i
        cur = k
        if (st.enter !== undefined) {
          if (!(ENTERS as readonly unknown[]).includes(st.enter)) {
            const g = typeof st.enter === "string" ? closest(st.enter, ENTERS) : undefined
            err(`${p}.enter`, `unknown enter ${JSON.stringify(st.enter)}`, g ? `did you mean "${g}"? (one of: ${ENTERS.join(", ")})` : `use one of: ${ENTERS.join(", ")}`)
          } else enter[k] = st.enter as ActPlan["enter"][number]
        }
      }
    }
    if (st?.enter !== undefined && (st.act === undefined || st.act === ids[0])) warn(`${p}.enter`, `"enter" only applies to a step that starts a later act; ignored`, `add "act": "<id>" to this step`)
    if (st?.change !== undefined) warn(`${p}.change`, `"change" steps in an act story: the act morph already adds and removes elements`, `drop "change"; give the elements "in": [acts] or a "delta"`)
    of.push(cur)
  })
  acts.forEach((a, k) => {
    if (k === 0) {
      if ((entry[1] ?? steps.length) === 0) warn("story.acts[0]", `act "${a.id}" has no steps`, "add steps before the next act starts")
    } else if (entry[k] === undefined) warn(`story.acts[${k}]`, `act "${a.id}" never starts`, `add "act": "${a.id}" to the step that starts it`)
  })
  return { acts, of, entry, enter }
}

/** An act transition as compiled: rewind / cut window [W0, R], morph stages, then the act's body from M. */
export interface ActWindow {
  k: number
  how: "rewind" | "cut" | "continue"
  /** The previous act's body start and end (the span a rewind plays backwards). */
  B: number
  E: number
  W0: number
  R: number
  M: number
  retract?: [number, number]
  /** Edges not drawn in the state this act starts from (a rewind / cut undid their `wire`): nothing to retract. */
  undrawn?: Set<string>
  fade?: number
  reveal?: number
  wire?: [number, number]
}

type Out = { vis: Record<string, { t: number; to: 0 | 1 }[]>; wires: Record<string, { t0: number; t1: number; on: boolean }[]> }

const r4 = (x: number) => Math.round(x * 1e4) / 1e4
/** Not yet set, or set only by an undone act ("never"). */
export const unset = (t: number | undefined): boolean => t === undefined || t >= NEVER

/**
 * The morph of each act transition (static: from scene membership and the steps' reveals) and
 * its events: wires leaving retract, boxes leaving fade, boxes entering reveal, wires entering
 * draw on once both ends show. Elements a step of the act reveals are left to that step.
 */
export function actMorphs(scene: Scene, ap: ActPlan, steps: { reveal?: unknown }[]) {
  const ids = ap.acts.map((a) => a.id)
  const pres = (el: { acts?: string[] }, k: number) => !el.acts || el.acts.includes(ids[k])
  // Annotations come and go with their acts (they default to their node's).
  const boxes = [...scene.groups, ...scene.nodes, ...(scene.annotations ?? [])].filter((x) => x.acts)
  const edges = scene.edges.filter((e) => e.acts)
  const revealed: Set<string>[] = ids.map(() => new Set())
  steps.forEach((st, i) => {
    const r = st?.reveal
    for (const id of Array.isArray(r) ? r : r === undefined ? [] : [r]) if (typeof id === "string") revealed[ap.of[i]]?.add(id)
  })
  const leaving = <T extends { acts?: string[] }>(xs: T[], k: number) => xs.filter((x) => pres(x, k - 1) && !pres(x, k))
  const entering = <T extends { acts?: string[] }>(xs: T[], k: number) => xs.filter((x) => !pres(x, k - 1) && pres(x, k))
  const lateEdge = (e: Scene["edges"][number], k: number) => revealed[k].has(e.from) || revealed[k].has(e.to)
  const changed = ids.map((_, k) => (k === 0 ? [] : [...leaving(boxes, k), ...entering(boxes, k), ...leaving(edges, k), ...entering(edges, k)].map((x) => x.id)))

  function window(k: number, W0: number, R: number): Omit<ActWindow, "k" | "how" | "B" | "E"> {
    let ta = R
    const w: Omit<ActWindow, "k" | "how" | "B" | "E"> = { W0, R, M: R }
    if (leaving(edges, k).length) {
      w.retract = [ta, ta + MORPH.retract]
      ta += MORPH.retract
    }
    if (leaving(boxes, k).length) {
      w.fade = ta
      ta += MORPH.fade
    }
    if (entering(boxes, k).some((b) => !revealed[k].has(b.id))) {
      w.reveal = ta
      ta += MORPH.reveal
    }
    if (entering(edges, k).some((e) => !lateEdge(e, k))) {
      w.wire = [ta, ta + MORPH.wire]
      ta += MORPH.wire
    }
    w.M = ta
    return w
  }

  function emit(wins: ActWindow[], appear: Record<string, number>, out: Out): void {
    const push = <T>(rec: Record<string, T[]>, id: string, x: T) => (rec[id] ??= []).push(x)
    for (const b of boxes) {
      let seen = pres(b, 0)
      for (const w of wins) {
        if (pres(b, w.k - 1) && !pres(b, w.k)) push(out.vis, b.id, { t: r4(w.fade ?? w.R), to: 0 })
        else if (!pres(b, w.k - 1) && pres(b, w.k) && !revealed[w.k].has(b.id)) {
          if (!seen) {
            if (unset(appear[b.id])) appear[b.id] = r4(w.reveal ?? w.M)
          } else push(out.vis, b.id, { t: r4(w.reveal ?? w.M), to: 1 })
        }
        if (pres(b, w.k)) seen = true
      }
      if (!seen && appear[b.id] === undefined) appear[b.id] = NEVER
    }
    const FADE = 0.45
    for (const e of edges) {
      const ev: { t0: number; t1: number; on: boolean }[] = []
      const endAt = (lo: number, hi: number): number | undefined => {
        const ts = [appear[e.from], appear[e.to]].filter((t): t is number => t !== undefined && t >= lo - 1e-6 && (t < hi || t >= NEVER))
        return ts.length ? Math.max(...ts) + 0.15 : undefined
      }
      if (pres(e, 0)) {
        const t = endAt(0, wins[0]?.W0 ?? Infinity)
        if (t !== undefined) ev.push({ t0: r4(t), t1: r4(t + FADE), on: true })
      }
      wins.forEach((w, j) => {
        if (pres(e, w.k - 1) && !pres(e, w.k)) {
          if (w.undrawn?.has(e.id)) return
          const [a, b] = w.retract ?? [w.R, w.R + MORPH.retract]
          ev.push({ t0: r4(a), t1: r4(b), on: false })
        } else if (!pres(e, w.k - 1) && pres(e, w.k)) {
          const late = endAt(w.R, wins[j + 1]?.W0 ?? Infinity)
          const t = Math.max(w.wire?.[0] ?? w.M, late ?? 0)
          ev.push({ t0: r4(t), t1: r4(t + MORPH.wire), on: true })
        }
      })
      if (!ev.length && !pres(e, 0)) ev.push({ t0: NEVER, t1: NEVER + 1, on: true })
      if (!ev.length) continue
      const list = [...(out.wires[e.id] ?? []), ...ev].sort((a, b) => a.t0 - b.t0)
      out.wires[e.id] = list
    }
    for (const id of Object.keys(out.vis)) out.vis[id] = [...out.vis[id]].sort((a, b) => a.t - b.t)
  }
  /**
   * Is `id` a box that re-enters in act k (on stage in an earlier act, off in act k − 1)? A step
   * of act k that reveals it shows it again on the visibility channel (its first `appear` stays
   * with the earlier act).
   */
  const reenters = (id: string, k: number): boolean => {
    const b = boxes.find((x) => x.id === id)
    if (!b || k < 1 || pres(b, k - 1) || !pres(b, k)) return false
    for (let j = 0; j < k - 1; j++) if (pres(b, j)) return true
    return false
  }
  return { window, emit, changed, reenters }
}

/** `timeline.acts` from the plan and the compiled windows (acts that start). */
export function timelineActs(ap: ActPlan, wins: ActWindow[], duration: number): TimelineAct[] {
  const r3 = (x: number) => Math.round(x * 1000) / 1000
  const a0 = ap.acts[0]
  const head: TimelineAct = { id: a0.id, label: a0.label, ...(a0.tone ? { tone: a0.tone } : {}), t0: 0, t1: r3(wins[0]?.W0 ?? duration), body: 0 }
  return [
    head,
    ...wins.map((w, j): TimelineAct => {
      const a = ap.acts[w.k]
      const win = { t0: r3(w.W0), t1: r3(w.R), from0: r3(w.B), from1: r3(w.E) }
      return {
        id: a.id,
        label: a.label,
        ...(a.tone ? { tone: a.tone } : {}),
        t0: r3(w.W0),
        t1: r3(wins[j + 1]?.W0 ?? duration),
        body: r3(w.M),
        enter: w.how,
        ...(w.how === "rewind" ? { rewind: win } : w.how === "cut" ? { cut: win } : {}),
        ...(w.M > w.R + 1e-9 ? { morph: { t0: r3(w.R), t1: r3(w.M) } } : {}),
      }
    }),
  ]
}
