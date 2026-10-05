/**
 * Static scans of the authored story that the layout needs, so nothing resizes mid-story: plain
 * node text versions (`set` label / detail / tag / tone, `status`) and edge labels landed by
 * pulses (`land: "edge"`). The compiler counts versions in the same order (k-th `set` with a field
 * = version k; k-th landing pulse on an edge = label version k).
 */
import type { GraphEdge, GraphNode, GraphSpec, PulseRef, SetRef, StatusRef, StoryStep } from "../spec.ts"
import { parseRef } from "../anchor.ts"
import { isTone, type Tone } from "../../theme/tones.ts"

const asList = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x])

/** Authored steps (auto / changes stories derive theirs and use none of these fields). */
export function authoredSteps(spec: GraphSpec): StoryStep[] {
  const st = spec.story
  if (!st || st === "auto" || !Array.isArray(st.steps)) return []
  return st.steps.filter((s) => s && typeof s === "object")
}

/** Does a `set` start a new detail version (detail text or a detail tone)? */
export const setsDetail = (s: SetRef): boolean => s.detail !== undefined || s.tone !== undefined

export interface NodeTextVersions {
  labels: string[]
  details: { text: string; tone?: Tone }[]
  tags: string[]
  /** The story gives the node a status glyph. */
  status: boolean
}

/** Text versions of a plain node ([0] = spec); undefined when the story changes none of them. */
export function nodeTextVersions(spec: GraphSpec, n: GraphNode): NodeTextVersions | undefined {
  const steps = authoredSteps(spec)
  const labels = [n.label ?? n.id]
  const details: NodeTextVersions["details"] = [{ text: n.detail ?? "" }]
  const tags = [n.tag ?? ""]
  let status = false
  for (const st of steps) {
    for (const s of asList(st.set as SetRef | SetRef[] | undefined)) {
      if (!s || typeof s !== "object" || s.id !== n.id) continue
      if (typeof s.label === "string") labels.push(s.label)
      if (typeof s.tag === "string") tags.push(s.tag)
      if (setsDetail(s)) {
        const prev = details[details.length - 1]
        const text = typeof s.detail === "string" ? s.detail : prev.text
        // A new detail text is untoned unless the set gives a tone; a tone-only set keeps the text.
        const tone = s.tone !== undefined ? (isTone(s.tone) ? s.tone : undefined) : s.detail !== undefined ? undefined : prev.tone
        details.push({ text, ...(tone ? { tone } : {}) })
      }
    }
    for (const s of asList(st.status as StatusRef | StatusRef[] | undefined)) if (s && typeof s === "object" && s.id === n.id) status = true
  }
  if (labels.length === 1 && details.length === 1 && tags.length === 1 && !status) return undefined
  return { labels, details, tags, status }
}

/** The scene id of a graph edge. */
export const edgeIdOf = (e: GraphEdge): string => e.id ?? `${parseRef(e.from).node}->${parseRef(e.to).node}`
const ends = (e: GraphEdge) => [parseRef(e.from).node, parseRef(e.to).node]

/** Resolve an edge reference against spec edges: exact id, else a unique "from->to". */
export function resolveSpecEdge(edges: GraphEdge[], ref: string): string | undefined {
  const m = /^(.+?)->(.+)$/.exec(ref)
  const hit = (e: GraphEdge) => !!m && ends(e)[0] === m[1] && ends(e)[1] === m[2]
  const dup = edges.filter(hit).length
  if (edges.some((e) => edgeIdOf(e) === ref) && dup <= 1) return ref
  if (m) {
    const hits = edges.filter(hit)
    if (hits.length === 1) return edgeIdOf(hits[0])
  }
  return undefined
}

/** The edge a pulse arrives through (last hop; first for a reverse pulse), as written. */
export function arrivalRef(p: PulseRef): string | undefined {
  if (typeof p === "string") return p
  const refs = p.route ?? (p.edge ? [p.edge] : [])
  return p.reverse ? refs[0] : refs[refs.length - 1]
}

/** Clip a pulse label to `max` chars ("…"). */
export const PULSE_LABEL_MAX = 32
export const clipLabel = (s: string): string => (s.length > PULSE_LABEL_MAX ? `${s.slice(0, PULSE_LABEL_MAX - 1)}…` : s)

/** Edge id → labels landed on it by pulses (`land: "edge"`), in story order. */
export function landedLabels(spec: GraphSpec): Map<string, { text: string; tone?: Tone }[]> {
  const out = new Map<string, { text: string; tone?: Tone }[]>()
  const edges = spec.edges ?? []
  for (const st of authoredSteps(spec))
    for (const p of asList(st.pulse as PulseRef | PulseRef[] | undefined)) {
      if (!p || typeof p !== "object" || p.land !== "edge" || typeof p.label !== "string" || !p.label) continue
      const ref = arrivalRef(p)
      const id = ref ? resolveSpecEdge(edges, ref) : undefined
      if (!id) continue
      const list = out.get(id) ?? []
      list.push({ text: clipLabel(p.label), ...(isTone(p.tone) ? { tone: p.tone } : {}) })
      out.set(id, list)
    }
  return out
}

/** Edge id → the widest pulse payload label travelling it (layer gaps make room for it). */
export function pulseLabelsByEdge(spec: GraphSpec): Map<string, string> {
  const out = new Map<string, string>()
  const edges = spec.edges ?? []
  for (const st of authoredSteps(spec))
    for (const p of asList(st.pulse as PulseRef | PulseRef[] | undefined)) {
      if (!p || typeof p !== "object" || typeof p.label !== "string" || !p.label) continue
      const text = clipLabel(p.label)
      for (const ref of p.route ?? (p.edge ? [p.edge] : [])) {
        const id = typeof ref === "string" ? resolveSpecEdge(edges, ref) : undefined
        if (id && text.length > (out.get(id)?.length ?? 0)) out.set(id, text)
      }
    }
  return out
}
