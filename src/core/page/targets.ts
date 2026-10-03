/**
 * Story targets for scrollytelling and slide builds: pure, resolved from a figure's compiled
 * timeline with the viewer's beat model (`beatGroups` / `steppedSchedule`), so a target names the
 * same settled state → / ← land on.
 */
import type { NarrateCite } from "../spec.ts"
import type { Timeline } from "../story/types.ts"
import { beatGroups, captionForBeat, steppedSchedule } from "../story/state.ts"

/** A story position: `beat` 0-based (-1 = before the first beat), `t` its settled time. */
export interface Target {
  beat: number
  t: number
}

/** A scrolly step after `"auto"` expansion (`at` as written or generated). */
export interface ResolvedStep {
  at: string | number
  title?: string
  body: string
  cites?: NarrateCite[]
}

const r4 = (t: number) => Math.round(t * 1e4) / 1e4

/** Every beat's settled stop, in order (the slide build sequence of a story figure). */
export function beatTargets(tl: Timeline): Target[] {
  const sched = steppedSchedule(tl)
  return beatGroups(tl).map((_, k) => ({ beat: k, t: r4(sched[k].t) }))
}

/**
 * Resolve a scrolly `at`: a story step `id`, a chapter `stop` label, a 1-based beat number (or
 * its digits), `"start"` (before the first beat: t 0) or `"end"` (the last beat at the story's
 * duration). Undefined when nothing matches.
 */
export function resolveAt(tl: Timeline, at: string | number): Target | undefined {
  const groups = beatGroups(tl)
  const stops = beatTargets(tl)
  if (at === "start") return { beat: -1, t: 0 }
  if (at === "end") return { beat: groups.length - 1, t: r4(tl.duration) }
  const n = typeof at === "number" ? at : /^\d+$/.test(at) ? Number(at) : undefined
  if (n !== undefined) return Number.isInteger(n) && n >= 1 && n <= groups.length ? stops[n - 1] : undefined
  const byStep = tl.steps.findIndex((s) => s.id === at)
  const byStop = byStep < 0 ? tl.steps.findIndex((s) => s.stop === at) : byStep
  if (byStop < 0) return undefined
  const k = groups.findIndex((g) => g.includes(byStop))
  return k < 0 ? undefined : stops[k]
}

/**
 * `steps: "auto"`: one step per narrated story step (title = heading or stop, body, cites); else
 * one per chapter (`stop`) with the beat's caption as body. Undefined when the story has neither.
 */
export function autoSteps(tl: Timeline): ResolvedStep[] | undefined {
  const narrated = tl.steps.filter((s) => s.narrate)
  if (narrated.length)
    return narrated.map((s) => {
      const title = s.narrate!.heading ?? s.stop
      return { at: s.id, ...(title ? { title } : {}), body: s.narrate!.body, ...(s.narrate!.cites?.length ? { cites: s.narrate!.cites } : {}) }
    })
  const groups = beatGroups(tl)
  const out: ResolvedStep[] = []
  groups.forEach((g, k) => {
    const stop = g.map((i) => tl.steps[i].stop).find((x) => x)
    if (!stop) return
    const c = captionForBeat(tl, k)
    out.push({ at: stop, title: stop, body: c >= 0 ? tl.captions[c].text : "" })
  })
  return out.length ? out : undefined
}
