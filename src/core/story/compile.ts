import { story as S } from "../../theme/tokens.ts"
import type { Pt, Scene } from "../scene.ts"
import type { PulseRef, Spec, Story, StoryStep } from "../spec.ts"
import type { Diagnostic } from "../validate.ts"
import { autoStory } from "./auto.ts"
import { springSettle } from "./ease.ts"
import type { Timeline, TimelineDraw, TimelineGlow, TimelinePulse } from "./types.ts"

const REACT_SETTLE = springSettle(S.springs.react)

export const readTime = (text: string): number => {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  return Math.min(S.read.max, Math.max(S.read.min, S.read.base + S.read.perWord * words))
}

const asList = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x])

export function polyLength(points: Pt[]): number {
  let L = 0
  for (let i = 1; i < points.length; i++) L += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  return L
}

/** Resolve an edge / message reference: exact id, else a unique "from->to". */
export function resolveEdge(scene: Scene, ref: string): { id?: string; error?: string; hint?: string } {
  const m = /^(.+?)->(.+)$/.exec(ref)
  const dup = m ? scene.edges.filter((e) => e.from === m[1] && e.to === m[2]).length : 0
  if (scene.edges.some((e) => e.id === ref) && dup <= 1) return { id: ref }
  if (m) {
    const hits = scene.edges.filter((e) => e.from === m[1] && e.to === m[2])
    if (hits.length === 1) return { id: hits[0].id }
    if (hits.length > 1)
      return { error: `"${ref}" is ambiguous (${hits.length} edges)`, hint: `use an edge id: ${hits.map((h) => h.id).join(", ")}` }
  }
  const near = scene.edges.slice(0, 6).map((e) => e.id)
  return { error: `unknown edge "${ref}"`, hint: `edges: ${near.join(", ")}${scene.edges.length > 6 ? ", ..." : ""}` }
}

export interface CompileResult {
  timeline?: Timeline
  diagnostics: Diagnostic[]
}

/** Compile `spec.story` against a laid-out scene into absolute times. Never throws. */
export function compileStory(scene: Scene, spec: Spec): CompileResult {
  const diagnostics: Diagnostic[] = []
  const err = (path: string, message: string, hint?: string) => diagnostics.push({ severity: "error", path, message, hint })
  const warn = (path: string, message: string, hint?: string) => diagnostics.push({ severity: "warning", path, message, hint })
  if (spec.story === undefined) return { diagnostics }
  const story: Story = spec.story === "auto" ? autoStory(scene, spec) : spec.story
  const seq = scene.type === "sequence"

  const nodeIds = new Set(scene.nodes.map((n) => n.id))
  const groupIds = new Set(scene.groups.map((g) => g.id))
  const frameIds = new Set(scene.frames.map((f) => f.id))
  const actIds = new Set(scene.activations.map((a) => a.id))
  const edgeById = new Map(scene.edges.map((e) => [e.id, e]))
  const counterDefs = new Map<string, { node: string; value: number; prefix?: string; suffix?: string }>()
  for (const n of scene.nodes) if (n.counter) counterDefs.set(n.counter.id, { node: n.id, value: n.counter.value, prefix: n.counter.prefix, suffix: n.counter.suffix })

  const appear: Record<string, number> = {}
  const edgeReveal: Record<string, number> = {}
  const flights: Record<string, TimelineDraw> = {}
  const pulses: TimelinePulse[] = []
  let glows: TimelineGlow[] = []
  const captions: { text: string; t0: number; t1: number }[] = []
  const counters: Timeline["counters"] = {}
  const steps: Timeline["steps"] = []

  const nodeBox = (id: string) => scene.nodes.find((n) => n.id === id) ?? scene.groups.find((g) => g.id === id)

  let prevEnd = 0
  let prevT0 = 0
  story.steps.forEach((step: StoryStep, i) => {
    const p = `story.steps[${i}]`
    let t0: number
    if (step.at === undefined) t0 = i === 0 ? 0 : prevEnd
    else if (typeof step.at === "number") {
      t0 = step.at
      if (t0 < prevT0 - 1e-9) err(`${p}.at`, `at ${t0}s goes backwards (previous step starts at ${+prevT0.toFixed(3)}s)`, `use "+${Math.max(0, +(t0 - prevEnd).toFixed(2))}" or a later time`)
    } else {
      const m = /^\+\s*(\d+(?:\.\d+)?)$/.exec(step.at.trim())
      if (!m) {
        err(`${p}.at`, `invalid at ${JSON.stringify(step.at)}`, `use seconds (2.5) or "+0.3" (after the previous step)`)
        t0 = prevEnd
      } else t0 = prevEnd + Number(m[1])
    }
    const ends = [t0]

    // Reveal.
    for (const id of asList(step.reveal)) {
      if (edgeById.has(id) || /->/.test(id)) {
        const r = resolveEdge(scene, id)
        if (!r.id) err(`${p}.reveal`, r.error!, r.hint)
        else if (edgeReveal[r.id] === undefined) edgeReveal[r.id] = t0
      } else if (nodeIds.has(id) || groupIds.has(id) || frameIds.has(id) || actIds.has(id)) {
        if (appear[id] === undefined) appear[id] = t0
      } else err(`${p}.reveal`, `unknown id "${id}"`, "reveal takes node, group, edge, note or frame ids")
      ends.push(t0 + REACT_SETTLE)
    }

    // Pulses.
    asList(step.pulse as PulseRef | PulseRef[]).forEach((ref, k) => {
      const pp = `${p}.pulse${Array.isArray(step.pulse) ? `[${k}]` : ""}`
      const refs = typeof ref === "string" ? [ref] : ref.route ?? (ref.edge ? [ref.edge] : [])
      if (!refs.length) return err(pp, "pulse needs an edge or a route", `{ "edge": "a->b" } or { "route": ["a->b", "b->c"] }`)
      const ids: string[] = []
      for (const r0 of refs) {
        const r = resolveEdge(scene, r0)
        if (!r.id) err(pp, r.error!, r.hint)
        else ids.push(r.id)
      }
      if (ids.length !== refs.length) return
      for (let j = 1; j < ids.length; j++)
        if (edgeById.get(ids[j - 1])!.to !== edgeById.get(ids[j])!.from)
          warn(pp, `route breaks between "${ids[j - 1]}" and "${ids[j]}"`, "each hop should start where the previous one ends")
      const points: Pt[] = []
      const spans: TimelinePulse["spans"] = []
      let L = 0
      for (const id of ids) {
        const pts = edgeById.get(id)!.points
        const len = polyLength(pts)
        spans.push({ edge: id, s0: L, s1: L + len })
        L += len
        points.push(...(points.length ? pts.slice(1) : pts))
      }
      const flight = typeof ref === "object" && ref.duration ? ref.duration : Math.min(S.pulse.flightMax, Math.max(S.pulse.flightMin, L / S.pulse.pxPerSecond))
      const tf0 = t0 + S.pulse.gather
      const tf1 = tf0 + flight
      const last = edgeById.get(ids[ids.length - 1])!
      const pid = `pulse-${i}-${k}`
      pulses.push({ id: pid, edges: ids, points, spans, length: L, t0, tf0, tf1, target: seq ? undefined : last.to })
      for (const sp of spans)
        if (!flights[sp.edge]) flights[sp.edge] = { mode: "flight", pulse: pid, t0: tf0 + (sp.s0 / L) * flight, t1: tf0 + (sp.s1 / L) * flight, s0: sp.s0, s1: sp.s1 }
      if (!seq && nodeBox(last.to)) {
        const end = points[points.length - 1]
        glows.push({ node: last.to, t: tf1, dur: S.glow.duration, cx: end.x, cy: end.y })
      }
      ends.push(tf1)
    })

    // Highlights.
    const hl = step.highlight
    const hlIds = hl === undefined ? [] : typeof hl === "string" ? [hl] : Array.isArray(hl) ? hl : hl.ids
    const hlFor = hl && typeof hl === "object" && !Array.isArray(hl) && typeof hl.for === "number" ? hl.for : S.glow.duration
    for (const id of hlIds) {
      const b = nodeBox(id)
      if (!b) {
        err(`${p}.highlight`, `unknown id "${id}"`, "highlight takes node or group ids")
        continue
      }
      glows.push({ node: id, t: t0, dur: Math.max(0.4, hlFor), cx: b.x + b.w / 2, cy: b.y + b.h / 2 })
      ends.push(t0 + REACT_SETTLE)
    }

    // Caption.
    if (typeof step.caption === "string" && step.caption.trim()) {
      captions.push({ text: step.caption.trim(), t0, t1: 0 })
      ends.push(t0 + readTime(step.caption))
    }

    // Counters.
    for (const c of asList(step.counter)) {
      const def = counterDefs.get(c.id)
      if (!def) {
        err(`${p}.counter`, `unknown counter "${c.id}"`, counterDefs.size ? `counters: ${[...counterDefs.keys()].join(", ")}` : `declare it on a node: "counter": { "id": "${c.id}" }`)
        continue
      }
      if (typeof c.to !== "number" || !Number.isFinite(c.to)) {
        err(`${p}.counter`, `counter "${c.id}" needs a numeric "to"`)
        continue
      }
      const entry = (counters[c.id] ??= { node: def.node, start: def.value, events: [], prefix: def.prefix, suffix: def.suffix, decimals: 0 })
      entry.events.push({ t: t0, to: c.to })
      ends.push(t0 + REACT_SETTLE)
    }

    const t1 = Math.max(...ends)
    const label = step.stop ?? step.caption ?? summarize(step, scene)
    steps.push({ id: step.id ?? `step-${i + 1}`, label, t0, t1, ...(step.stop ? { stop: step.stop } : {}), ...(step.caption ? { caption: step.caption } : {}) })
    prevEnd = t1
    prevT0 = t0
  })
  for (const c of Object.values(counters)) {
    const all = [c.start, ...c.events.map((e) => e.to)]
    c.decimals = Math.max(...all.map((v) => (Number.isInteger(v) ? 0 : Math.min(3, String(v).split(".")[1]?.length ?? 0))))
  }

  // ≤ 3 flashes per second: glows that start within 1/3 s of the previous (distinct) start are delayed.
  glows = glows.sort((a, b) => a.t - b.t || a.node.localeCompare(b.node))
  let lastStart = -Infinity
  for (const g of glows) {
    if (g.t > lastStart + 1e-6 && g.t < lastStart + S.glow.minGap) g.t = lastStart + S.glow.minGap
    if (g.t > lastStart + 1e-6) lastStart = g.t
  }
  // One glow per node at a time: drop overlapping duplicates.
  glows = glows.filter((g, k) => !glows.slice(0, k).some((h) => h.node === g.node && Math.abs(h.t - g.t) < 1e-6))

  // Groups revealed implicitly with their first child when all children are hidden.
  const childrenOf = (gid: string): string[] => [
    ...scene.nodes.filter((n) => parentOf(spec, n.id) === gid).map((n) => n.id),
    ...scene.groups.filter((g) => parentOf(spec, g.id) === gid).map((g) => g.id),
  ]
  const groupAppear = (gid: string): number | undefined => {
    if (appear[gid] !== undefined) return appear[gid]
    const kids = childrenOf(gid)
    if (!kids.length) return undefined
    const times = kids.map((k) => (groupIds.has(k) ? groupAppear(k) : appear[k]))
    if (times.some((x) => x === undefined)) return undefined
    return Math.min(...(times as number[]))
  }
  for (const g of scene.groups) {
    const t = groupAppear(g.id)
    if (t !== undefined) appear[g.id] = t
  }

  // Which wires start hidden, and how they draw on.
  const draw: Record<string, TimelineDraw> = {}
  const FADE = 0.45
  for (const e of scene.edges) {
    const fa = appear[e.from]
    const ta = appear[e.to]
    const hidden = seq ? flights[e.id] !== undefined || edgeReveal[e.id] !== undefined : fa !== undefined || ta !== undefined || edgeReveal[e.id] !== undefined
    if (!hidden) continue
    if (flights[e.id]) draw[e.id] = flights[e.id]
    else if (edgeReveal[e.id] !== undefined) draw[e.id] = { mode: "fade", t0: edgeReveal[e.id], t1: edgeReveal[e.id] + FADE }
    else {
      const t = Math.max(fa ?? 0, ta ?? 0) + 0.15
      draw[e.id] = { mode: "fade", t0: t, t1: t + FADE }
    }
    if (!seq && flights[e.id]) {
      // Nothing appears before its cause: a pulse cannot leave a node that is not there yet.
      if (fa !== undefined && fa > flights[e.id].t0 + 1e-6) warn("story", `pulse on "${e.id}" starts before "${e.from}" is revealed`)
    }
  }
  if (seq) {
    // Activations / frames / notes follow the messages that cause them.
    scene.activations.forEach((a) => {
      if (appear[a.id] !== undefined) return
      const m = /-(\d+)-(\d+)$/.exec(a.id)
      const start = m ? scene.edges[Number(m[1])] : undefined
      if (start && draw[start.id]) appear[a.id] = draw[start.id].t1
    })
    scene.frames.forEach((f) => {
      if (appear[f.id] !== undefined) return
      const first = scene.edges.find((e) => f.y < e.points[0].y && e.points[0].y < f.y + f.h)
      if (first && draw[first.id]) appear[f.id] = Math.max(0, draw[first.id].t0 - S.pulse.gather - 0.1)
    })
    for (const n of scene.nodes) {
      if (n.kind !== "note" || appear[n.id] !== undefined) continue
      const before = scene.edges.filter((e) => e.points[0].y < n.y).pop()
      if (before && draw[before.id]) appear[n.id] = draw[before.id].t1 + 0.1
    }
  }

  // Timeline extent: everything settles, then the end hold.
  const events = [
    ...steps.map((s) => s.t1),
    ...pulses.map((p) => p.tf1 + S.pulse.ring),
    ...glows.map((g) => g.t + g.dur),
    ...Object.values(draw).map((d) => d.t1 + REACT_SETTLE),
    ...Object.values(appear).map((t) => t + REACT_SETTLE),
    ...Object.values(counters).flatMap((c) => c.events.map((e) => e.t + REACT_SETTLE)),
    0,
  ]
  const lastEvent = Math.max(...events)
  const duration = lastEvent + S.endHold
  captions.forEach((c, k) => (c.t1 = k + 1 < captions.length ? captions[k + 1].t0 : duration - 0.5))
  if (duration > S.warnTotal) warn("story", `story runs ${duration.toFixed(1)}s (over ${S.warnTotal}s)`, "shorten gaps or split the story")
  if (!story.steps.length) warn("story.steps", "story has no steps")

  const r3 = (x: number) => Math.round(x * 1000) / 1000
  const timeline: Timeline = {
    duration: r3(duration),
    lastEvent: r3(lastEvent),
    autoplay: story.autoplay === true,
    loop: story.end === "loop",
    steps: steps.map((s) => ({ ...s, t0: r3(s.t0), t1: r3(s.t1) })),
    appear,
    draw,
    pulses,
    glows,
    captions,
    counters,
  }
  return { timeline, diagnostics }
}

function parentOf(spec: Spec, id: string): string | undefined {
  if (spec.type === "sequence") return undefined
  return spec.nodes.find((n) => n.id === id)?.parent ?? spec.groups?.find((g) => g.id === id)?.parent
}

function summarize(step: StoryStep, scene: Scene): string {
  const name = (id: string) =>
    scene.nodes.find((n) => n.id === id)?.label.join(" ") || scene.groups.find((g) => g.id === id)?.label || id
  const edgeName = (ref: string) => {
    const r = resolveEdge(scene, ref)
    const e = r.id ? scene.edges.find((x) => x.id === r.id) : undefined
    if (!e) return ref
    if (scene.type === "sequence") return e.label?.text.replace(/^\d+\.\s*/, "") || `${name(e.from)} → ${name(e.to)}`
    return `${name(e.from)} → ${name(e.to)}`
  }
  const parts: string[] = []
  const shown = asList(step.reveal).filter((id) => scene.nodes.find((n) => n.id === id)?.kind !== "note" && !/__(start|end)$/.test(id))
  if (shown.length) parts.push(shown.map(name).join(", "))
  if (step.pulse) {
    const ps = asList(step.pulse as PulseRef | PulseRef[]).map((p) => (typeof p === "string" ? edgeName(p) : p.route ? p.route.map(edgeName).join(" · ") : edgeName(p.edge ?? "")))
    parts.push(ps.length > 2 ? `${ps.slice(0, 2).join(", ")} +${ps.length - 2}` : ps.join(", "))
  }
  if (step.highlight) parts.push("highlight")
  if (step.counter) parts.push("count")
  return parts.join(" · ") || (asList(step.reveal).length ? "start" : "step")
}
