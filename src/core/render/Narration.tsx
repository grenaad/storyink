/**
 * The viewer's narration rail (HTML only): the narrated step for the beat the header caption
 * shows ("02 / 06", heading, body with cite spans).
 */
import type { ReactElement } from "react"
import type { Scene } from "../scene.ts"
import type { NarrateCite } from "../spec.ts"
import { beatGroups } from "../story/state.ts"
import { citeSegments, resolveCite, type CiteTarget } from "../story/narrate.ts"
import type { Timeline } from "../story/types.ts"

/** Indices of the narrated steps. */
export const narratedSteps = (tl: Timeline): number[] => tl.steps.flatMap((s, i) => (s.narrate ? [i] : []))

/**
 * The narrated step to show for a beat (index into `narratedSteps`): the last narrated step at or
 * before the beat's last step; the first one before the story starts (gate, beat −1). −1 = none.
 */
export function railIndex(tl: Timeline, beat: number): number {
  const list = narratedSteps(tl)
  if (!list.length) return -1
  if (beat < 0) return 0
  const groups = beatGroups(tl)
  const g = groups[Math.min(beat, groups.length - 1)]
  const last = g ? g[g.length - 1] : tl.steps.length - 1
  let k = 0
  list.forEach((s, j) => {
    if (s <= last) k = j
  })
  return k
}

const pad2 = (n: number) => String(n).padStart(2, "0")

export interface RailProps {
  scene: Scene
  tl: Timeline
  /** Index into the narrated steps. */
  index: number
  onCite: (target: CiteTarget | undefined) => void
  onOpen: (target: CiteTarget) => void
  onHide: () => void
}

export function Rail({ scene, tl, index, onCite, onOpen, onHide }: RailProps): ReactElement | null {
  const list = narratedSteps(tl)
  const step = tl.steps[list[index]]
  if (!step?.narrate) return null
  const n = step.narrate
  const heading = n.heading ?? step.stop
  const cite = (c: NarrateCite, text: string, k: number) => {
    const target = resolveCite(scene, c.ref)
    const file = target?.kind === "file"
    return (
      <span
        key={k}
        className={`si-cite${file ? " si-cite-file" : ""}`}
        data-ref={c.ref}
        tabIndex={0}
        role={file ? "button" : undefined}
        title={c.ref}
        onMouseEnter={() => onCite(target)}
        onMouseLeave={() => onCite(undefined)}
        onFocus={() => onCite(target)}
        onBlur={() => onCite(undefined)}
        onClick={() => target && onOpen(target)}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && target) {
            e.preventDefault()
            onOpen(target)
          }
        }}
      >
        {text}
      </span>
    )
  }
  return (
    <aside className="si-rail" aria-label="Narration" aria-live="polite" data-no-pan data-step={step.id}>
      <div className="si-rail-top">
        <span className="si-rail-n">
          {pad2(index + 1)} / {pad2(list.length)}
        </span>
        <button type="button" className="si-rail-x" aria-label="Hide narration (N)" title="Hide narration (N)" onClick={onHide}>
          ×
        </button>
      </div>
      {heading ? <h2 className="si-rail-h">{heading}</h2> : null}
      <p className="si-rail-body">{citeSegments(n.body, n.cites).map((s, k) => (s.cite ? cite(s.cite, s.text, k) : <span key={k}>{s.text}</span>))}</p>
    </aside>
  )
}
