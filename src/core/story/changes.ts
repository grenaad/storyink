/**
 * Change stories: the `change` step (compiled into reveal / wire / unwire / apply / highlight plus
 * delta-look windows) and `story: "changes"` (a walkthrough derived from the deltas).
 */
import { story as S } from "../../theme/tokens.ts"
import type { Scene, SceneEdge, SceneNode } from "../scene.ts"
import type { Delta, FileRef, Narrate, Spec, Story, StoryStep } from "../spec.ts"

export type ChangeKind = "node" | "edge" | "group"
export interface ChangeOp {
  id: string
  kind: ChangeKind
  delta: "added" | "modified" | "removed"
}

const asList = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x])
const WORD: Record<string, string> = { added: "added", modified: "changed", removed: "removed" }

/** Windows of a change op from its step start (`wire` = the edge's retract duration). */
export function changeWindow(op: ChangeOp, t0: number, wire = 0.6): { t0: number; t1: number } {
  const r = (x: number) => Math.round(x * 1e4) / 1e4
  if (op.kind === "edge" && op.delta === "removed") return { t0: r(t0 + wire * 0.6), t1: r(t0 + wire + 0.35) }
  if (op.delta === "modified") return { t0: r(t0 + 0.15), t1: r(t0 + 0.75) }
  return { t0: r(t0), t1: r(t0 + 0.6) }
}

/** Retract duration of an edge (as `unwire`). */
export const wireDuration = (e: SceneEdge): number => Math.min(1.2, Math.max(0.25, (e.length ?? 0) / S.pulse.pxPerSecond))

/**
 * Expand `change` into primitive steps. Added nodes / groups reveal, added edges wire on, removed
 * edges unwire (then ghost), diff code nodes apply, modified nodes flash (highlight). `ops[i]` are
 * step i's delta-look windows (removed / modified only).
 */
export function expandChanges(
  scene: Scene,
  steps: StoryStep[],
  resolveEdge: (ref: string) => string | undefined,
  warn: (path: string, message: string, hint?: string) => void,
  err: (path: string, message: string, hint?: string) => void,
): { steps: StoryStep[]; ops: ChangeOp[][] } {
  const ops: ChangeOp[][] = steps.map(() => [])
  if (!steps.some((s) => s && typeof s === "object" && s.change !== undefined)) return { steps, ops }
  const revealed = new Set<string>()
  for (const s of steps) for (const r of asList(s?.reveal)) if (typeof r === "string") revealed.add(r)
  const seen = new Map<string, number>()
  const out = steps.map((st, i) => {
    if (!st || typeof st !== "object" || st.change === undefined) return st
    const p = `story.steps[${i}].change`
    const add = { reveal: asList(st.reveal) as string[], wire: asList(st.wire) as unknown[], unwire: asList(st.unwire) as unknown[], apply: asList(st.apply) as unknown[], highlight: [] as string[] }
    const list = asList(st.change)
    list.forEach((ref, k) => {
      const pp = Array.isArray(st.change) ? `${p}[${k}]` : p
      if (typeof ref !== "string") return err(pp, `"change" takes element ids`)
      const node = scene.nodes.find((n) => n.id === ref)
      const group = scene.groups.find((g) => g.id === ref)
      const eid = node || group ? undefined : resolveEdge(ref)
      const edge = eid ? scene.edges.find((e) => e.id === eid) : undefined
      const el: { delta?: Delta } | undefined = node ?? group ?? edge
      if (!el) return err(pp, `unknown id "${ref}"`, "change takes node, group, edge or message ids")
      const id = node?.id ?? group?.id ?? edge!.id
      if (!el.delta || el.delta === "unchanged")
        return warn(pp, `"${ref}" has no delta${el.delta ? ` ("unchanged")` : ""}; change has no effect`, `set "delta": "added" | "modified" | "removed" on it`)
      if (seen.has(id)) return warn(pp, `"${ref}" is already changed by step ${seen.get(id)! + 1}; change has no effect`)
      seen.set(id, i)
      const d = el.delta as ChangeOp["delta"]
      if (d === "added" && revealed.has(id)) warn(pp, `"${ref}" is both revealed and changed`, `pick one: "change" reveals an added element`)
      const kind: ChangeKind = node ? "node" : group ? "group" : "edge"
      if (node?.diff) {
        if (!add.apply.some((a) => a === id || (a && typeof a === "object" && (a as { id?: string }).id === id))) add.apply.push(id)
      }
      if (d === "added") {
        if (kind === "edge") {
          if (!add.wire.some((w) => w === id || w === ref)) add.wire.push(id)
        } else if (!add.reveal.includes(id)) add.reveal.push(id)
        return
      }
      if (kind === "edge" && d === "removed" && !add.unwire.some((w) => w === id || w === ref)) add.unwire.push(id)
      if (kind === "node" && d === "modified") add.highlight.push(id)
      ops[i].push({ id, kind, delta: d })
    })
    const hl = st.highlight === undefined ? [] : typeof st.highlight === "string" ? [st.highlight] : Array.isArray(st.highlight) ? st.highlight : st.highlight.ids
    const highlight = [...new Set([...hl, ...add.highlight])]
    const next: StoryStep = { ...st }
    if (add.reveal.length) next.reveal = add.reveal
    if (add.wire.length) next.wire = add.wire as StoryStep["wire"]
    if (add.unwire.length) next.unwire = add.unwire as StoryStep["unwire"]
    if (add.apply.length) next.apply = add.apply as StoryStep["apply"]
    if (highlight.length) next.highlight = st.highlight && typeof st.highlight === "object" && !Array.isArray(st.highlight) ? { ...st.highlight, ids: highlight } : highlight
    return next
  })
  return { steps: out, ops }
}

// ---------------------------------------------------------------------------
// story: "changes"

const label = (n: { label: string[] } | undefined, id: string) => n?.label.join(" ").trim() || id
const fileOf = (x: { files?: FileRef[] }): FileRef | undefined => x.files?.[0]
const fileRef = (f: FileRef): string => (f.lines === undefined ? f.path : Array.isArray(f.lines) ? `${f.path}#L${f.lines[0]}-${f.lines[1]}` : `${f.path}#L${f.lines}`)

/** Narration for an element with a summary: heading = label + delta word; cites = it and its first file. */
function narrateFor(id: string, name: string, delta: string, summary: string | undefined, file: FileRef | undefined): Narrate | undefined {
  if (!summary) return undefined
  let body = summary.includes(name) ? summary : `${name}: ${summary}`
  const cites: Narrate["cites"] = [{ text: name, ref: id }]
  if (file) {
    body = `${body.replace(/\s+$/, "")}${/[.!?]$/.test(body.trim()) ? "" : "."} See ${file.path}.`
    cites.push({ text: file.path, ref: fileRef(file) })
  }
  return { heading: `${name} ${WORD[delta]}`, body, cites }
}

const changed = (d?: Delta): d is "added" | "modified" | "removed" => d === "added" || d === "modified" || d === "removed"

/** Closing summary: "3 added · 2 changed · 1 removed". */
function tally(ds: (Delta | undefined)[]): string {
  const n = (d: Delta) => ds.filter((x) => x === d).length
  return [n("added") && `${n("added")} added`, n("modified") && `${n("modified")} changed`, n("removed") && `${n("removed")} removed`].filter(Boolean).join(" · ") || "No changes"
}

/**
 * Derive a change walkthrough: an opening beat on the before state, then one beat per changed
 * node in data-flow order (breadth-first from the sources) with its changed edges and attached
 * diff node, hero pulses after their beat, and a closing overview. Sequences: message order.
 */
export function changesStory(scene: Scene, spec: Spec): Story {
  const title = spec.change?.title ?? spec.title
  const steps: StoryStep[] = [{ at: 0.3, caption: title, stop: "Before" }]
  const opts = typeof spec.story === "object" ? spec.story : undefined
  void opts
  const heroes = scene.edges.filter((e) => e.emphasis === "hero" && e.delta !== "removed")
  const heroPulse = (e: SceneEdge): StoryStep => ({ pulse: [e.id, { edge: e.id, delay: 0.35 }, { edge: e.id, delay: 0.7 }], caption: e.summary ?? `${label(scene.nodes.find((n) => n.id === e.from), e.from)} → ${label(scene.nodes.find((n) => n.id === e.to), e.to)}${e.label ? `: ${e.label.text.replace(/^\d+\.\s*/, "")}` : ""}` })
  const pulsed = new Set<string>()
  const all: (Delta | undefined)[] = []

  if (scene.type === "sequence") {
    const parts = new Map(scene.nodes.map((n) => [n.id, n]))
    const done = new Set<string>()
    scene.edges.forEach((m) => {
      const ps = [m.from, m.to].filter((p) => changed(parts.get(p)?.delta) && !done.has(p))
      if (!changed(m.delta) && !ps.length) return
      ps.forEach((p) => done.add(p))
      const ids = [...ps, ...(changed(m.delta) ? [m.id] : [])]
      // Named after the message when it changed, else after the participant it brings in.
      const p0 = changed(m.delta) ? undefined : parts.get(ps[0])!
      const name = p0 ? label(p0, p0.id) : m.label?.text?.replace(/^\d+\.\s*/, "") || m.id
      const d = changed(m.delta) ? m.delta : p0!.delta as "added" | "modified" | "removed"
      const summary = p0 ? p0.summary : m.summary
      const nar = narrateFor(p0?.id ?? m.id, name, d, summary, p0 ? fileOf(p0) : fileOf(m))
      steps.push({
        change: ids,
        focus: ids,
        caption: summary ?? `${name}: ${WORD[d]}`,
        stop: truncate(name, 28),
        ...(nar ? { narrate: nar } : {}),
      })
      if (m.emphasis === "hero" && m.delta !== "removed") {
        steps.push(heroPulse(m))
        pulsed.add(m.id)
      }
    })
    for (const p of scene.nodes) if (changed(p.delta) && !done.has(p.id)) steps.push({ change: p.id, focus: p.id, caption: `${label(p, p.id)}: ${WORD[p.delta!]}`, stop: label(p, p.id) })
    all.push(...(scene.edges.some((e) => changed(e.delta)) ? scene.edges.map((e) => e.delta) : scene.nodes.map((n) => n.delta)))
  } else {
    const nodes = new Map(scene.nodes.map((n) => [n.id, n]))
    const isDiff = (id: string) => !!nodes.get(id)?.diff
    // Attached diff nodes: diff code nodes connected by an edge to a non-diff node (first wins).
    const owner = new Map<string, string>()
    for (const e of scene.edges)
      for (const [a, b] of [[e.from, e.to], [e.to, e.from]] as const)
        if (isDiff(b) && nodes.has(a) && !isDiff(a) && !owner.has(b)) owner.set(b, a)
    const order = flowOrder(scene)
    const pos = new Map(order.map((id, k) => [id, k]))
    // Beats: changed non-attached nodes, plus owners of changed diff nodes.
    const beatNodes = order.filter((id) => {
      const n = nodes.get(id)!
      if (owner.has(id)) return false
      return changed(n.delta) || [...owner].some(([dn, o]) => o === id && changed(nodes.get(dn)!.delta))
    })
    const beatOf = new Map<string, number>()
    beatNodes.forEach((id, k) => beatOf.set(id, k))
    for (const [dn, o] of owner) if (beatOf.has(o)) beatOf.set(dn, beatOf.get(o)!)
    // Changed edges join the later beat among their endpoints; else the beat after their source.
    const edgeBeat = new Map<string, number>()
    const loose: SceneEdge[] = []
    for (const e of scene.edges) {
      if (!changed(e.delta)) continue
      const bs = [e.from, e.to].map((x) => beatOf.get(x)).filter((x): x is number => x !== undefined)
      if (bs.length) edgeBeat.set(e.id, Math.max(...bs))
      else loose.push(e)
    }
    const beats: { node?: string; edges: string[]; at: number }[] = beatNodes.map((id) => ({ node: id, edges: [], at: pos.get(id)! }))
    for (const [e, b] of edgeBeat) beats[b].edges.push(e)
    for (const e of loose) beats.push({ edges: [e.id], at: (pos.get(e.from) ?? order.length) + 0.5 })
    beats.sort((a, b) => a.at - b.at)
    for (const b of beats) {
      const n = b.node ? nodes.get(b.node)! : undefined
      const diffs = n ? [...owner].filter(([, o]) => o === n.id).map(([dn]) => dn) : []
      const ids = [...(n && changed(n.delta) ? [n.id] : []), ...diffs.filter((d) => changed(nodes.get(d)!.delta)), ...b.edges]
      const unchangedDiffs = diffs.filter((d) => !changed(nodes.get(d)!.delta))
      const e0 = !n ? scene.edges.find((e) => e.id === b.edges[0])! : undefined
      const name = n ? label(n, n.id) : e0!.label?.text ?? `${label(nodes.get(e0!.from), e0!.from)} → ${label(nodes.get(e0!.to), e0!.to)}`
      const d = n ? (changed(n.delta) ? n.delta : (nodes.get(diffs[0])!.delta as "added" | "modified" | "removed")) : (e0!.delta as "added" | "modified" | "removed")
      const summary = n?.summary ?? diffs.map((x) => nodes.get(x)!.summary).find(Boolean) ?? e0?.summary
      const nar = narrateFor(n?.id ?? e0!.id, name, d, summary, n ? fileOf(n) ?? diffs.map((x) => fileOf(nodes.get(x)!)).find(Boolean) : fileOf(e0!))
      steps.push({
        change: ids,
        ...(unchangedDiffs.length ? { apply: unchangedDiffs } : {}),
        focus: n ? [n.id, ...diffs] : ids,
        caption: summary ?? `${name}: ${WORD[d]}`,
        stop: truncate(name, 28),
        ...(nar ? { narrate: nar } : {}),
      })
      for (const h of heroes) if (!pulsed.has(h.id) && (ids.includes(h.id) || b.edges.includes(h.id))) {
        steps.push(heroPulse(h))
        pulsed.add(h.id)
      }
    }
    // The overview counts parts (nodes); edges only when no node changed.
    const parts = scene.nodes.filter((x) => !owner.has(x.id) && x.kind !== "note").map((x) => x.delta)
    all.push(...(parts.some(changed) ? parts : scene.edges.map((e) => e.delta)))
  }
  // Hero edges no beat touched (unchanged heroes): pulse them before the overview.
  for (const h of heroes) if (!pulsed.has(h.id)) steps.push(heroPulse(h))
  steps.push({ caption: tally(all), stop: "After", focus: scene.nodes.map((n) => n.id) })
  return { steps }
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** Node ids in data-flow order: breadth-first from the sources (no incoming edge), then the rest. */
function flowOrder(scene: Scene): string[] {
  const ids = scene.nodes.filter((n) => n.kind !== "note").map((n) => n.id)
  const out: string[] = []
  const seen = new Set<string>()
  const inbound = new Set(scene.edges.filter((e) => e.from !== e.to).map((e) => e.to))
  let frontier = ids.filter((id) => !inbound.has(id))
  while (out.length < ids.length) {
    if (!frontier.length) frontier = [ids.find((id) => !seen.has(id))!]
    const next: string[] = []
    for (const id of frontier) {
      if (seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
    for (const id of frontier)
      for (const e of scene.edges) if (e.from === id && !seen.has(e.to) && ids.includes(e.to) && !next.includes(e.to)) next.push(e.to)
    frontier = next
  }
  return out
}

export type { SceneNode }

/** `--story changes` / tool `story: "changes"`: the change walkthrough, keeping the story's options. */
export function changesStoryOf(story: Spec["story"]): Story {
  if (story && typeof story === "object") {
    const { steps: _s, ...opts } = story
    return { ...opts, steps: "changes" }
  }
  return { steps: "changes" }
}
