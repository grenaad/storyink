import type { Scene } from "../scene.ts"
import type { Spec, Story, StoryStep } from "../spec.ts"

/**
 * Derive a story from structure.
 * - Graphs: breadth-first waves from the sources. Each wave pulses the edges
 *   that reach it (in parallel), then reveals the nodes they reach. Edges into
 *   a group enter its inner entry nodes; edges out of a group leave once all of
 *   its members are shown. Notes appear with the node they annotate.
 * - Sequences: one pulse per message, in order; activations, frames and notes
 *   follow the messages that cause them.
 */
export function autoStory(scene: Scene, spec: Spec): Story {
  if (scene.type === "sequence") {
    const steps: StoryStep[] = scene.edges.map((e, i) => ({
      at: i === 0 ? 0.3 : "+0.15",
      pulse: e.id,
      ...(frameStartsAt(scene, i) ? { stop: frameStartsAt(scene, i) } : {}),
    }))
    return { steps }
  }
  const parent = new Map<string, string | undefined>()
  if (spec.type !== "sequence") {
    for (const n of spec.nodes) parent.set(n.id, n.parent)
    for (const g of spec.groups ?? []) parent.set(g.id, g.parent)
  }
  const isGroup = new Set(scene.groups.map((g) => g.id))
  const notes = new Set(scene.nodes.filter((n) => n.kind === "note").map((n) => n.id))
  const leaves = scene.nodes.map((n) => n.id).filter((id) => !notes.has(id))
  const within = (id: string, g: string): boolean => {
    for (let p = parent.get(id); p; p = parent.get(p)) if (p === g) return true
    return false
  }
  const members = (g: string) => leaves.filter((id) => within(id, g))
  const edges = scene.edges.filter((e) => !notes.has(e.from) && !notes.has(e.to) && e.from !== e.to)
  const incomingInside = (id: string, g: string) => edges.some((e) => e.to === id && (within(e.from, g) || e.from === g))
  // Entry nodes of a group: members without an incoming edge from inside the group.
  const entries = (g: string) => members(g).filter((id) => !incomingInside(id, g) || edges.some((e) => e.to === id && !within(e.from, g)))
  const targetsOf = (to: string) => (isGroup.has(to) ? entries(to) : [to])
  const inbound = new Map<string, number>()
  for (const e of edges) for (const t of targetsOf(e.to)) inbound.set(t, (inbound.get(t) ?? 0) + 1)
  // A group's entry node reached from its group ("[*]" inside a composite) is not a source.
  const reachedViaGroup = new Set(scene.groups.flatMap((g) => (edges.some((e) => e.to === g.id) ? entries(g.id) : [])))

  const revealed = new Set<string>()
  const label = (id: string) => scene.nodes.find((n) => n.id === id)?.label.join(" ") || id
  const noteFor = (ids: string[]) => scene.edges.filter((e) => notes.has(e.from) && ids.includes(e.to)).map((e) => e.from)
  const sourceIsShown = (from: string) => (isGroup.has(from) ? members(from).every((m) => revealed.has(m)) : revealed.has(from))

  let frontier = leaves.filter((id) => !inbound.get(id) && !reachedViaGroup.has(id))
  if (!frontier.length && leaves.length) frontier = [leaves[0]]
  const steps: StoryStep[] = [{ at: 0.3, reveal: [...frontier, ...noteFor(frontier)], stop: "Start" }]
  frontier.forEach((id) => revealed.add(id))
  for (let guard = 0; revealed.size < leaves.length && guard <= leaves.length; guard++) {
    const ready = edges.filter((e) => sourceIsShown(e.from) && targetsOf(e.to).some((t) => !revealed.has(t)))
    let next = [...new Set(ready.flatMap((e) => targetsOf(e.to)).filter((t) => !revealed.has(t)))]
    if (!next.length) {
      next = leaves.filter((id) => !revealed.has(id)).slice(0, 1)
      steps.push({ at: "+0.3", reveal: [...next, ...noteFor(next)] })
    } else {
      const pulses = ready.slice(0, 8)
      const names = pulses.map((e) => `${label(e.from)} → ${label(isGroup.has(e.to) ? targetsOf(e.to)[0] : e.to)}`)
      steps.push({ at: "+0.3", pulse: pulses.map((e) => e.id), stop: undefined, ...(names.length === 1 ? {} : {}) })
      steps.push({ at: "+0", reveal: [...next, ...noteFor(next)], ...(next.length ? {} : {}) })
      void names
    }
    next.forEach((id) => revealed.add(id))
  }
  return { steps: steps.map((s) => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)) as StoryStep) }
}

function frameStartsAt(scene: Scene, i: number): string | undefined {
  const e = scene.edges[i]
  const f = scene.frames.find((fr) => {
    const first = scene.edges.find((x) => fr.y < x.points[0].y && x.points[0].y < fr.y + fr.h)
    return first === e
  })
  return f ? `${f.kind}${f.label ? ` ${f.label}` : ""}` : undefined
}
