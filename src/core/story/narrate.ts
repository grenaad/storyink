/**
 * Step narration (`narrate`): fallback captions, cite segmentation and cite-ref resolution.
 * Pure and browser-safe (shared by the compiler and the HTML viewer's narration rail).
 */
import type { Scene } from "../scene.ts"
import type { FileRef, Narrate, NarrateCite } from "../spec.ts"

/** First sentence of a body (up to `. ` / `! ` / `? ` or the end), whitespace collapsed. */
export function firstSentence(body: string): string {
  const s = body.trim().replace(/\s+/g, " ")
  const m = /^(.+?[.!?])(\s|$)/.exec(s)
  return (m ? m[1] : s).trim()
}

/**
 * The caption a narrated step falls back to when it has none (animated SVG, header captions,
 * beat tiles): the heading, else the body's first sentence.
 */
export function narrateCaption(n: Narrate): string {
  return n.heading?.trim() || firstSentence(n.body)
}

/** Text a narrated beat's reading hold is computed from (heading + body). */
export const narrateReading = (n: Narrate): string => `${n.heading ?? ""} ${n.body}`.trim()

/** Body split into plain runs and cite runs (cites matched in order, as validated). */
export function citeSegments(body: string, cites: NarrateCite[] = []): { text: string; cite?: NarrateCite }[] {
  const out: { text: string; cite?: NarrateCite }[] = []
  let from = 0
  for (const c of cites) {
    if (!c.text) continue
    const at = body.indexOf(c.text, from)
    if (at < 0) continue
    if (at > from) out.push({ text: body.slice(from, at) })
    out.push({ text: c.text, cite: c })
    from = at + c.text.length
  }
  if (from < body.length) out.push({ text: body.slice(from) })
  return out
}

/** A cite target: diagram elements (their `data-si` keys) or a file location. */
export type CiteTarget = { kind: "element"; id: string; si: string[] } | { kind: "file"; ref: FileRef }

/** `path`, `path#L12`, `path#L12-20` → FileRef. */
export function parseFileRef(ref: string): FileRef {
  const m = /^(.*?)#L(\d+)(?:-L?(\d+))?$/.exec(ref)
  if (!m) return { path: ref }
  const a = Number(m[2])
  const b = m[3] !== undefined ? Number(m[3]) : undefined
  return { path: m[1], lines: b !== undefined && b !== a ? [Math.min(a, b), Math.max(a, b)] : a }
}

/** Does a ref look like a file path (has a slash, an extension or a `#L` line suffix)? */
export const looksLikePath = (ref: string): boolean => /^[^\s#]+(#L\d+(-L?\d+)?)?$/.test(ref) && (/\//.test(ref) || /\.[A-Za-z0-9]+(#|$)/.test(ref) || /#L\d/.test(ref))

/**
 * Resolve a cite ref against a scene: a node / group / edge id, a unique `from->to`, `node#row`
 * (a panel row or code line), else a file path when it looks like one. Undefined = unresolved.
 */
export function resolveCite(scene: Scene, ref: string): CiteTarget | undefined {
  if (scene.nodes.some((n) => n.id === ref)) return { kind: "element", id: ref, si: [`node:${ref}`] }
  if (scene.groups.some((g) => g.id === ref)) return { kind: "element", id: ref, si: [`group:${ref}`] }
  if (scene.edges.some((e) => e.id === ref)) return { kind: "element", id: ref, si: [`edge:${ref}`] }
  const arrow = /^(.+?)->(.+)$/.exec(ref)
  if (arrow) {
    const hits = scene.edges.filter((e) => e.from === arrow[1] && e.to === arrow[2])
    if (hits.length === 1) return { kind: "element", id: hits[0].id, si: [`edge:${hits[0].id}`] }
  }
  const hash = ref.indexOf("#")
  if (hash > 0 && !/#L\d/.test(ref)) {
    const node = scene.nodes.find((n) => n.id === ref.slice(0, hash))
    if (node) return { kind: "element", id: node.id, si: [`row:${ref}`, `node:${node.id}`] }
  }
  if (looksLikePath(ref)) return { kind: "file", ref: parseFileRef(ref) }
  return undefined
}

/** Does any step of the timeline carry narration? */
export const hasNarration = (scene: Scene): boolean => !!scene.timeline?.steps.some((s) => s.narrate)
