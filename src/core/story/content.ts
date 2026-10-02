/**
 * 0.4 content steps, compile side: type, set / clear, line, dim / undim, hide / show,
 * wire / unwire, status (targets only), focus. Absolute times, step order, scene-only input
 * (so `recompilePace` reproduces it from the embedded steps).
 */
import { geometry as G, story as S } from "../../theme/tokens.ts"
import type { Scene, SceneNode } from "../scene.ts"
import type { LevelRef, LineRef, RowStatus, SetRef, StatusRef, StoryStep, TypeRef, WireRef } from "../spec.ts"
import { boxOfRef, parseRef, signedLineOf } from "../anchor.ts"
import { addedChars, hunkRowsOf } from "../layout/diffnode.ts"
import { springSettle } from "./ease.ts"
import type { Timeline, TimelineTyping } from "./types.ts"

const REACT_SETTLE = springSettle(S.springs.react)
/** Crossfade of a set / clear (s). */
export const CROSSFADE = 0.25
/** Default typing speed (chars / s). */
export const CPS = 90
/** Word typing: lead after the tag (s) and per-word fade (s). */
export const WORD_LEAD = 0.1
export const WORD_FADE = S.springs.word
/** Check / cross draw-on (s); spinner period (s); shimmer sweep period (s). */
export const STATUS_DRAW = 0.32
export const SPIN_PERIOD = 0.8
export const SHIMMER_PERIOD = 1.6
/** Persistent glow rise / fall (s, spring visual durations: react and smooth). */
export const LIT_RISE = 0.3
export const LIT_FALL = 0.45
/** Caret stays this long after a char run (s). */
export const CARET_LINGER = 0.3

const asList = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x])

export type RefKind =
  | { kind: "edge"; id: string }
  | { kind: "node"; id: string; node: SceneNode }
  | { kind: "group"; id: string }
  | { kind: "row"; id: string; node: SceneNode; row: string }
  | { kind: "line"; id: string; node: SceneNode; line: number }
  | { kind: "unknown"; id: string }

/** Classify a reference: exact edge id first, then node / group, "a->b", rows and code lines. */
export function classify(scene: Scene, id: string, resolveEdge: (ref: string) => string | undefined): RefKind {
  if (scene.edges.some((e) => e.id === id)) return { kind: "edge", id }
  const n = scene.nodes.find((x) => x.id === id)
  if (n) return { kind: "node", id, node: n }
  if (scene.groups.some((g) => g.id === id)) return { kind: "group", id }
  if (/->/.test(id)) {
    const e = resolveEdge(id)
    if (e) return { kind: "edge", id: e }
  }
  const r = parseRef(id)
  const nd = r.anchor ? scene.nodes.find((x) => x.id === r.node) : undefined
  if (nd && r.anchor) {
    if (nd.rows?.some((x) => x.id === r.anchor)) return { kind: "row", id, node: nd, row: r.anchor }
    if (nd.code && /^[1-9][0-9]*$/.test(r.anchor)) return { kind: "line", id, node: nd, line: Number(r.anchor) }
    const signed = nd.code ? signedLineOf(nd, r.anchor) : undefined
    if (signed !== undefined) return { kind: "line", id, node: nd, line: signed }
  }
  return { kind: "unknown", id }
}

const what = (k: RefKind): string =>
  k.kind === "node" ? (k.node.code ? "a code node" : k.node.rows ? "a panel" : k.node.shape === "chip" ? "a chip" : "a node") : k.kind === "row" ? "a panel row" : k.kind === "line" ? "a code line" : `a ${k.kind}`

export interface ContentOut {
  typing: TimelineTyping[]
  versions: Record<string, { t: number; v: number }[]>
  bars: Record<string, { t: number; a: number; b: number; on: boolean }[]>
  levels: Record<string, { t: number; to: number }[]>
  vis: Record<string, { t: number; to: 0 | 1 }[]>
  wires: Record<string, { t0: number; t1: number; on: boolean }[]>
  status: Record<string, { t: number; to: RowStatus }[]>
  lit: Record<string, { t0: number; t1?: number }[]>
  applies: Record<string, { t0: number; t1: number; hunks: number[] }[]>
}

/** Mutable state across steps (step order). */
export class Content {
  readonly out: ContentOut = { typing: [], versions: {}, bars: {}, levels: {}, vis: {}, wires: {}, status: {}, lit: {}, applies: {} }
  /** Diff nodes: hunks applied so far. */
  private applied = new Map<string, Set<number>>()
  private st = new Map<string, RowStatus>()
  private lit = new Map<string, boolean>()
  private ver = new Map<string, number>()
  private count = new Map<string, number>()
  private typed = new Set<string>()
  private bar = new Map<string, { a: number; b: number; on: boolean }>()
  private lvl = new Map<string, number>()
  private shown = new Map<string, 0 | 1>()
  /** Edge drawn (true) or not, and the step that last drew it. */
  readonly drawn = new Map<string, boolean>()
  private drawnBy = new Map<string, number>()
  private unwired = new Set<string>()
  /** Edges governed by wire / unwire (excluded from implicit draw-on and pulse draws). */
  readonly managed = new Set<string>()
  /** Rows named by a reveal somewhere in the story (type / status before it reveals them). */
  private revealedRows = new Set<string>()

  constructor(
    private scene: Scene,
    steps: StoryStep[],
    private resolve: (ref: string) => string | undefined,
  ) {
    // Pre-scan: which wires start hidden (their first event draws them) and revealed rows.
    const first = new Map<string, boolean>()
    for (const st of steps) {
      if (!st || typeof st !== "object") continue
      for (const [key, on] of [["wire", true], ["unwire", false]] as const)
        for (const w of asList(st[key] as WireRef | WireRef[] | undefined)) {
          const ref = typeof w === "string" ? w : w?.edge
          const e = typeof ref === "string" ? this.resolve(ref) : undefined
          if (!e) continue
          this.managed.add(e)
          if (!first.has(e)) first.set(e, on)
        }
      for (const r of asList(st.reveal)) if (typeof r === "string" && r.includes("#")) this.revealedRows.add(r)
    }
    for (const e of scene.edges) this.drawn.set(e.id, !(first.get(e.id) === true))
  }

  private rest(key: string): number {
    const r = parseRef(key)
    const n = this.scene.nodes.find((x) => x.id === key)
    if (n) return n.muted ? G.muted : 1
    if (r.anchor) {
      const row = this.scene.nodes.find((x) => x.id === r.node)?.rows?.find((x) => x.id === r.anchor)
      if (row) return row.muted ? G.muted : 1
    }
    return 1
  }
  private level(key: string) {
    return this.lvl.get(key) ?? this.rest(key)
  }

  /** Version count for a target, matching the layout's scan (k-th `set` with that field = version k). */
  private next(key: string): number {
    const k = (this.count.get(key) ?? 0) + 1
    this.count.set(key, k)
    return k
  }
  private push<T>(rec: Record<string, T[]>, key: string, x: T) {
    ;(rec[key] ??= []).push(x)
  }

  /**
   * Apply step i's content primitives at t0. Returns end times (for the step's t1) and short
   * titles ("acts"). `appear` gets implied row reveals.
   */
  step(
    st: StoryStep,
    i: number,
    t0: number,
    p: string,
    appear: Record<string, number>,
    err: (path: string, message: string, hint?: string) => void,
    warn: (path: string, message: string, hint?: string) => void,
  ): { ends: number[]; acts: string[]; focus?: string | string[] } {
    // Content events sit on the step's published (ms-rounded) start, so step windows match exactly.
    t0 = Math.round(t0 * 1000) / 1000
    const sc = this.scene
    const ends: number[] = []
    const acts: string[] = []
    const kind = (id: string) => classify(sc, id, this.resolve)
    const at = (key: string, list: unknown, k: number) => `${p}.${key}${Array.isArray(list) ? `[${k}]` : ""}`
    const implyAppear = (row: string) => {
      if (appear[row] === undefined && this.revealedRows.has(row)) appear[row] = t0
    }

    // set / clear: new versions (crossfade).
    const sets = asList(st.set as SetRef | SetRef[] | undefined)
    const clears = asList(st.clear)
    const setIds = new Set<string>()
    sets.forEach((s, k) => {
      const pp = at("set", st.set, k)
      if (!s || typeof s !== "object" || typeof s.id !== "string") return
      const r = kind(s.id)
      const fields = (["code", "text", "detail", "tag", "label"] as const).filter((f) => s[f] !== undefined)
      if (!fields.length) return err(pp, `set "${s.id}" changes nothing`, `add "code", "text", "detail", "tag" or "label"`)
      setIds.add(s.id)
      if (s.code !== undefined) {
        if (r.kind === "node" && r.node.diff) err(pp, `"${s.id}" is a diff code node; set "code" does not apply to it`, `use "apply": "${s.id}" to play the change`)
        else if (r.kind === "node" && r.node.code) {
          const v = this.next(s.id)
          this.ver.set(s.id, v)
          this.push(this.out.versions, s.id, { t: t0, v })
          acts.push(`Set ${name(r.node)}`)
        } else err(pp, `set "code" needs a code node; "${s.id}" is ${r.kind === "unknown" ? "unknown" : what(r)}`)
      }
      if (s.text !== undefined || s.detail !== undefined || s.tag !== undefined) {
        const f = s.text !== undefined ? "text" : s.detail !== undefined ? "detail" : "tag"
        if (r.kind === "row") {
          const v = this.next(s.id)
          this.ver.set(s.id, v)
          this.push(this.out.versions, s.id, { t: t0, v })
          acts.push(`Set ${rowName(r)}`)
        } else {
          const rowEx = sc.nodes.find((n) => n.rows?.length)
          err(pp, `set "${f}" needs a panel row ("${rowEx ? `${rowEx.id}#${rowEx.rows![0].id}` : "panel#row"}")`, r.kind === "unknown" ? `unknown id "${s.id}"` : `"${s.id}" is ${what(r)}`)
        }
      }
      if (s.label !== undefined) {
        if (r.kind === "node" && (r.node.shape === "window" || r.node.shape === "chip")) {
          const key = `${s.id}@label`
          const v = this.next(key)
          this.ver.set(key, v)
          this.push(this.out.versions, key, { t: t0, v })
        } else err(pp, `set "label" needs a panel, code or chip node; "${s.id}" is ${r.kind === "unknown" ? "unknown" : what(r)}`)
      }
      ends.push(t0 + CROSSFADE)
    })
    clears.forEach((id, k) => {
      const pp = at("clear", st.clear, k)
      if (typeof id !== "string") return
      const r = kind(id)
      if (!((r.kind === "node" && r.node.code) || r.kind === "row"))
        return err(pp, r.kind === "unknown" ? `unknown id "${id}"` : `clear takes a code node or a panel row, got "${id}" (${what(r)})`)
      if (setIds.has(id)) return err(pp, `"${id}" is set and cleared in one step`, "use two steps")
      if (r.kind === "node" && r.node.diff) return err(pp, `"${id}" is a diff code node; clear does not apply to it`, `hide it with "hide", or dim it`)
      if ((this.ver.get(id) ?? 0) === -1) return warn(pp, `"${id}" is already cleared; clear has no effect`)
      this.ver.set(id, -1)
      this.push(this.out.versions, id, { t: t0, v: -1 })
      if (r.kind === "node" && r.node.code) {
        // The bar goes with the content.
        const b = this.bar.get(id)
        if (b?.on) this.lineOff(id, t0)
      }
      acts.push(`Clear ${r.kind === "row" ? rowName(r) : name((r as { node: SceneNode }).node)}`)
      ends.push(t0 + CROSSFADE)
    })

    // type: typewriter on the current version.
    asList(st.type as TypeRef | TypeRef[] | undefined).forEach((ref, k) => {
      const pp = at("type", st.type, k)
      const o = typeof ref === "string" ? { id: ref } : ref
      if (!o || typeof o.id !== "string") return
      const r = kind(o.id)
      const isCode = r.kind === "node" && !!r.node.code
      if (!isCode && r.kind !== "row") {
        const rowEx = sc.nodes.find((n) => n.rows?.length)
        return err(pp, `type takes a code node or a panel row ("${rowEx ? `${rowEx.id}#${rowEx.rows![0].id}` : "panel#row"}"), got "${o.id}"`, r.kind === "unknown" ? "unknown id" : `"${o.id}" is ${what(r)}`)
      }
      if (r.kind === "node" && r.node.diff) return err(pp, `"${o.id}" is a diff code node; type does not apply to it`, `"apply": { "id": "${o.id}", "cps": 60 } types the added lines`)
      const v = this.ver.get(o.id) ?? 0
      if (v < 0) return err(pp, `nothing to type: "${o.id}" was cleared`, `add "set": { "id": "${o.id}", ${isCode ? `"code"` : `"text"`}: … } to this step`)
      if (this.typed.has(`${o.id}|${v}`)) return warn(pp, `"${o.id}" is already typed`)
      this.typed.add(`${o.id}|${v}`)
      const by = o.by ?? (isCode ? "char" : "word")
      const lines = isCode ? codeText((r as { node: SceneNode }).node, v) : rowText(r as Extract<RefKind, { kind: "row" }>, v)
      const typing: TimelineTyping = { target: o.id, v, by, t0, t1: t0 }
      if (by === "char") {
        const cps = typeof o.cps === "number" && o.cps > 0 ? o.cps : CPS
        const total = lines.reduce((s, l, j) => s + l.n + (j > 0 ? 2 : 0), 0)
        const dur = typeof o.duration === "number" && o.duration > 0 ? o.duration : total / cps
        const per = total > 0 ? dur / total : 0
        let cur = t0
        typing.lines = lines.map((l, j) => {
          const a = cur + (j > 0 ? 2 * per : 0)
          const b = a + l.n * per
          cur = b
          return { t0: r4(a), t1: r4(b), n: l.n, indent: l.indent }
        })
        typing.t1 = r4(t0 + dur)
      } else {
        const n = lines.reduce((s, l) => s + l.words, 0)
        const hasTag = r.kind === "row" && !!r.node.rows!.find((x) => x.id === r.row)!.versions[v]?.tag
        const W = typeof o.duration === "number" && o.duration > 0 ? o.duration : Math.min(2.8, Math.max(0.3, 0.25 + 0.075 * n))
        const lead = hasTag ? WORD_LEAD : 0
        const fade = Math.min(WORD_FADE, W / 2)
        typing.words = { n, lead, fade, stagger: n > 1 ? r4((W - 1.5 * fade) / (n - 1)) : 0 }
        typing.t1 = r4(t0 + lead + W)
      }
      this.out.typing.push(typing)
      if (r.kind === "row") implyAppear(o.id)
      acts.push(`Type ${r.kind === "row" ? rowName(r) : name((r as { node: SceneNode }).node)}`)
      ends.push(typing.t1)
    })

    // line: the active-line bar on a code node, against its current version.
    asList(st.line as LineRef | LineRef[] | undefined).forEach((ref, k) => {
      const pp = at("line", st.line, k)
      const parsed = parseLine(ref)
      if (!parsed) return err(pp, `line takes a code node: "code#2-4"`, `or { "id": "code", "lines": [2, 4] } / { "id": "code", "off": true }`)
      const r = kind(parsed.id)
      if (!(r.kind === "node" && r.node.code)) return err(pp, `line takes a code node: "${parsed.id}#2-4"`, r.kind === "unknown" ? `unknown id "${parsed.id}"` : `"${parsed.id}" is ${what(r)}`)
      // Diff nodes: head / base line numbers and hunks map to display rows.
      if (parsed.signed || parsed.hunk !== undefined) {
        const d = r.node.diff
        if (!d) return err(pp, parsed.hunk !== undefined ? `"${parsed.id}" has no hunks (not a diff code node)` : `"${parsed.id}#${parsed.signed}" needs a diff code node`, `plain code lines are "${parsed.id}#3"`)
        if (parsed.hunk !== undefined) {
          const hr = hunkRowsOf(d, parsed.hunk)
          if (!hr) return err(pp, `"${parsed.id}" has no hunk ${parsed.hunk}`, `hunks: 1–${d.hunks}`)
          ;[parsed.a, parsed.b] = hr
        } else {
          const k = signedLineOf(r.node, parsed.signed!)
          if (k === undefined) return err(pp, `"${parsed.id}" shows no ${parsed.signed!.startsWith("+") ? "head" : "base"} line ${parsed.signed!.slice(1)}`, `shown: ${shownLines(r.node, parsed.signed![0] as "+" | "-")}`)
          parsed.a = parsed.b = k
        }
      }
      if (parsed.off) {
        if (!this.bar.get(parsed.id)?.on) {
          // A clear in this step already took the bar away.
          if (this.out.bars[parsed.id]?.some((e) => e.t === t0 && !e.on)) return
          return warn(pp, `no line is lit on "${parsed.id}"; off has no effect`)
        }
        this.lineOff(parsed.id, t0)
        ends.push(t0 + REACT_SETTLE)
        return
      }
      const { a, b } = parsed
      if (a === undefined || b === undefined) return err(pp, `line needs a line number: "${parsed.id}#2" or "${parsed.id}#2-4"`)
      if (b < a) return err(pp, `invalid line range "${parsed.id}#${a}-${b}"`, `write "${parsed.id}#${b}-${a}"`)
      const v = this.ver.get(parsed.id) ?? 0
      if (v < 0) return err(pp, `"${parsed.id}" is cleared here; nothing to highlight`, `set it before "line"`)
      const L = r.node.code!.versions[v]?.length ?? 0
      if (b > L) return err(pp, `line ${a === b ? a : `${a}-${b}`} is past the last line (${L}) of "${parsed.id}"`, v > 0 ? `the current program is version ${v} (from a "set")` : undefined)
      this.bar.set(parsed.id, { a, b, on: true })
      this.push(this.out.bars, parsed.id, { t: t0, a, b, on: true })
      acts.push(a === b ? `Line ${a}` : `Lines ${a}–${b}`)
      ends.push(t0 + REACT_SETTLE)
    })

    // apply: a diff code node goes from its base version to the diff (one hunk, or all left).
    asList(st.apply as ApplyRef | ApplyRef[] | undefined).forEach((ref, k) => {
      const pp = at("apply", st.apply, k)
      const o = typeof ref === "string" ? { id: ref } : ref
      if (!o || typeof o !== "object" || typeof o.id !== "string") return err(pp, `apply takes a diff code node id or { "id": ..., "hunk"?: n, "cps"?: n }`)
      const r = kind(o.id)
      if (!(r.kind === "node" && r.node.diff)) {
        const ex = sc.nodes.find((n) => n.diff)
        return err(pp, `apply takes a diff code node, got "${o.id}"`, r.kind === "unknown" ? `unknown id "${o.id}"` : `"${o.id}" is ${what(r)}${ex ? `; diff nodes: ${sc.nodes.filter((n) => n.diff).map((n) => n.id).join(", ")}` : `; give a code node a "diff"`}`)
      }
      const d = r.node.diff
      const done = this.applied.get(o.id) ?? new Set<number>()
      let hunks: number[]
      if (o.hunk !== undefined) {
        if (typeof o.hunk !== "number" || !Number.isInteger(o.hunk) || o.hunk < 1 || o.hunk > d.hunks) return err(`${pp}.hunk`, `"${o.id}" has no hunk ${JSON.stringify(o.hunk)}`, `hunks are numbered 1–${d.hunks}`)
        if (done.has(o.hunk - 1)) return warn(pp, `hunk ${o.hunk} of "${o.id}" is already applied; apply has no effect`)
        hunks = [o.hunk - 1]
      } else {
        hunks = Array.from({ length: d.hunks }, (_, h) => h).filter((h) => !done.has(h))
        if (!hunks.length) return warn(pp, `"${o.id}" is already applied; apply has no effect`)
      }
      for (const h of hunks) done.add(h)
      this.applied.set(o.id, done)
      const cps = typeof o.cps === "number" && o.cps > 0 ? o.cps : APPLY_CPS
      const typing = Math.min(4, Math.max(0.3, addedChars(d, hunks) / cps))
      const dur = r4(Math.max(0.9, typing / 0.6))
      this.push(this.out.applies, o.id, { t0, t1: r4(t0 + dur), hunks })
      acts.push(`Apply ${name(r.node)}${o.hunk !== undefined ? ` hunk ${o.hunk}` : ""}`)
      ends.push(t0 + dur)
    })

    // Levels: dim / undim (dim channel), hide / show (visibility channel).
    const targetKey = (id: string, pp: string, verb: string): string | undefined => {
      const r = kind(id)
      if (r.kind === "unknown" || r.kind === "line") {
        err(pp, `unknown id "${id}"`, `${verb} takes node, group, edge or row ids`)
        return undefined
      }
      return r.id
    }
    const dim = st.dim as LevelRef | undefined
    const dimIds = dim === undefined ? [] : typeof dim === "string" ? [dim] : Array.isArray(dim) ? dim : asList(dim.ids)
    const dimTo = dim && typeof dim === "object" && !Array.isArray(dim) && typeof dim.to === "number" ? dim.to : G.muted
    dimIds.forEach((id, k) => {
      const pp = typeof dim === "string" ? `${p}.dim` : Array.isArray(dim) ? `${p}.dim[${k}]` : `${p}.dim.ids[${k}]`
      const key = typeof id === "string" ? targetKey(id, pp, "dim") : undefined
      if (!key) return
      this.lvl.set(key, dimTo)
      this.push(this.out.levels, key, { t: t0, to: dimTo })
      ends.push(t0 + REACT_SETTLE)
    })
    asList(st.undim).forEach((id, k) => {
      const key = typeof id === "string" ? targetKey(id, at("undim", st.undim, k), "undim") : undefined
      if (!key) return
      if (this.level(key) >= 1) return warn(at("undim", st.undim, k), `"${id}" is not dimmed here; undim has no effect`)
      this.lvl.set(key, 1)
      this.push(this.out.levels, key, { t: t0, to: 1 })
      ends.push(t0 + REACT_SETTLE)
    })
    for (const [verb, to] of [["hide", 0], ["show", 1]] as const)
      asList(st[verb]).forEach((id, k) => {
        const pp = at(verb, st[verb], k)
        const key = typeof id === "string" ? targetKey(id, pp, verb) : undefined
        if (!key) return
        const cur = this.shown.get(key) ?? 1
        if (cur === to) return warn(pp, to ? `"${id}" is not hidden here; show has no effect` : `"${id}" is already hidden; hide has no effect`)
        this.shown.set(key, to)
        this.push(this.out.vis, key, { t: t0, to })
        ends.push(t0 + REACT_SETTLE)
      })

    // wire / unwire.
    for (const [verb, on] of [["wire", true], ["unwire", false]] as const)
      asList(st[verb] as WireRef | WireRef[] | undefined).forEach((w, k) => {
        const pp = at(verb, st[verb], k)
        const ref = typeof w === "string" ? w : w?.edge
        if (typeof ref !== "string") return
        const e = this.resolve(ref)
        if (!e) return // resolveEdge's message is reported by the caller's edge check
        const drawn = this.drawn.get(e) ?? true
        if (on && drawn) {
          const by = this.drawnBy.get(e)
          return warn(pp, `"${ref}" is already drawn${by !== undefined ? ` by step ${by + 1}` : ""}; wire has no effect`)
        }
        if (!on && !drawn) return warn(pp, `"${ref}" is not drawn here; unwire has no effect`)
        const edge = sc.edges.find((x) => x.id === e)!
        const L = edge.length ?? 0
        const dur = typeof w === "object" && typeof w.duration === "number" && w.duration > 0 ? w.duration : Math.min(1.2, Math.max(0.25, L / S.pulse.pxPerSecond))
        this.push(this.out.wires, e, { t0, t1: r4(t0 + dur), on })
        this.drawn.set(e, on)
        if (on) this.drawnBy.set(e, i)
        else this.unwired.add(e)
        acts.push(`${on ? "Wire" : "Unwire"} ${e}`)
        ends.push(t0 + dur)
      })

    // status: the row's right-edge glyph (spinner / check / cross); a status on a revealed-later row reveals it.
    asList(st.status as StatusRef | StatusRef[] | undefined).forEach((s, k) => {
      const pp = at("status", st.status, k)
      if (!s || typeof s !== "object" || typeof s.id !== "string") return
      const r = kind(s.id)
      if (r.kind !== "row") {
        const rowEx = sc.nodes.find((n) => n.rows?.length)
        return err(pp, `status takes a panel row ("${rowEx ? `${rowEx.id}#${rowEx.rows![0].id}` : "panel#row"}")`, r.kind === "unknown" ? `unknown id "${s.id}"` : `"${s.id}" is ${what(r)}`)
      }
      if (!["none", "running", "done", "error"].includes(s.to as string)) return err(pp, `unknown row status ${JSON.stringify(s.to)}`, `use one of: none, running, done, error`)
      implyAppear(s.id)
      if (this.status(s.id) === s.to) return warn(pp, `"${s.id}" is already ${s.to} here; status has no effect`)
      this.st.set(s.id, s.to)
      this.push(this.out.status, s.id, { t: t0, to: s.to })
      acts.push(`${rowName(r)} ${s.to === "none" ? "cleared" : s.to}`)
      ends.push(t0 + (s.to === "done" || s.to === "error" ? STATUS_DRAW : REACT_SETTLE))
    })

    // glow / unglow: persistent glow windows on nodes.
    for (const [verb, on] of [["glow", true], ["unglow", false]] as const)
      asList(st[verb]).forEach((id, k) => {
        const pp = at(verb, st[verb], k)
        if (typeof id !== "string") return
        const r = kind(id)
        if (r.kind !== "node") return err(pp, r.kind === "unknown" ? `unknown id "${id}"` : `${verb} takes node ids, got "${id}" (${what(r)})`, r.kind === "unknown" ? `${verb} takes node ids` : undefined)
        const lit = this.lit.get(id) ?? false
        if (on && lit) return warn(pp, `"${id}" already glows here; glow has no effect`)
        if (!on && !lit) return warn(pp, `"${id}" is not glowing here; unglow has no effect`)
        this.lit.set(id, on)
        if (on) this.push(this.out.lit, id, { t0 })
        else this.out.lit[id][this.out.lit[id].length - 1].t1 = t0
        ends.push(t0 + springSettle(on ? LIT_RISE : LIT_FALL))
      })

    let focus: string | string[] | undefined
    if (typeof st.focus === "string") {
      if (!boxOfRef(sc, st.focus) && !this.resolve(st.focus)) err(`${p}.focus`, `unknown id "${st.focus}"`, "focus takes node, group, edge, row or code line ids")
      else focus = st.focus
    } else if (Array.isArray(st.focus)) {
      const ok = st.focus.filter((id, k) => {
        if (typeof id === "string" && (boxOfRef(sc, id) || this.resolve(id))) return true
        err(`${p}.focus[${k}]`, `unknown id ${JSON.stringify(id)}`, "focus takes node, group, edge, row or code line ids")
        return false
      })
      if (ok.length) focus = ok.map((id) => (boxOfRef(sc, id) ? id : this.resolve(id)!))
    }
    return { ends, acts, focus }
  }

  /** Current status of a row (rest status before any step). */
  status(key: string): RowStatus {
    const s = this.st.get(key)
    if (s) return s
    const r = parseRef(key)
    return this.scene.nodes.find((x) => x.id === r.node)?.rows?.find((x) => x.id === r.anchor)?.status ?? "none"
  }
  /** Nodes still lit / rows still running at the end, and whether something ends hidden. */
  endState(): { lit: string[]; hidden: (key: string) => boolean } {
    return { lit: [...this.lit].filter(([, on]) => on).map(([id]) => id), hidden: (key) => (this.shown.get(key) ?? 1) === 0 }
  }

  private lineOff(id: string, t: number) {
    const b = this.bar.get(id)!
    this.bar.set(id, { ...b, on: false })
    this.push(this.out.bars, id, { t, a: b.a, b: b.b, on: false })
  }

  /** Wire state at this point of the story (for pulse warnings). */
  wireState(e: string): "drawn" | "unwired" | "undrawn" {
    if (this.drawn.get(e) ?? true) return "drawn"
    return this.unwired.has(e) ? "unwired" : "undrawn"
  }

  /** Timeline fields (only the non-empty ones). */
  fields(): Partial<Timeline> {
    const o = this.out
    const has = (x: object) => Object.keys(x).length > 0
    return {
      ...(o.typing.length ? { typing: o.typing } : {}),
      ...(has(o.versions) ? { versions: o.versions } : {}),
      ...(has(o.bars) ? { bars: o.bars } : {}),
      ...(has(o.levels) ? { levels: o.levels } : {}),
      ...(has(o.vis) ? { vis: o.vis } : {}),
      ...(has(o.wires) ? { wires: o.wires } : {}),
      ...(has(o.status) ? { status: o.status } : {}),
      ...(has(o.lit) ? { lit: o.lit } : {}),
      ...(has(o.applies) ? { applies: o.applies } : {}),
    }
  }
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4
/** Default typing speed of added lines during an `apply` (chars / s). */
export const APPLY_CPS = 60
type ApplyRef = string | { id: string; hunk?: number; cps?: number }
const shownLines = (n: SceneNode, side: "+" | "-"): string => {
  const ls = (n.diff?.rows ?? []).filter((r) => (side === "+" ? r.kind !== "del" && r.new !== undefined : r.kind !== "add" && r.old !== undefined)).map((r) => (side === "+" ? r.new! : r.old!))
  return ls.length ? `${side}${ls[0]}…${side}${ls[ls.length - 1]}` : "none"
}
const name = (n: SceneNode) => n.label.join(" ")
const rowName = (r: Extract<RefKind, { kind: "row" }>) => {
  const v = r.node.rows!.find((x) => x.id === r.row)!.versions[0]
  return (v.lines.join(" ") || v.tag || r.row).trim()
}

/** Typing units of a code version: per line the indentation (instant) and the typed chars. */
export function codeText(n: SceneNode, v: number): { n: number; indent: number; words: number }[] {
  return (n.code!.versions[v] ?? []).map((l) => {
    if (!l.length) return { n: 0, indent: 0, words: 0 }
    const indent = l[0].c
    const last = l[l.length - 1]
    const text = l.map((t) => t.t).join("")
    return { n: last.c + last.t.length - indent, indent, words: text.trim().split(/\s+/).filter(Boolean).length }
  })
}

/** Typing units of a row version (text lines; words across text + detail). */
export function rowText(r: { node: SceneNode; row: string }, v: number): { n: number; indent: number; words: number }[] {
  const ver = r.node.rows!.find((x) => x.id === r.row)!.versions[v]
  return (ver?.lines ?? []).map((l) => ({ n: l.length, indent: 0, words: l.trim().split(/\s+/).filter(Boolean).length }))
}

/** "code#2", "code#2-4", or { id, lines?, off? } → id and inclusive range. */
export function parseLine(ref: unknown): { id: string; a?: number; b?: number; off?: boolean; signed?: string; hunk?: number } | undefined {
  if (typeof ref === "string") {
    const sm = /^(.+)#([+-][1-9][0-9]*)$/.exec(ref)
    if (sm) return { id: sm[1], signed: sm[2] }
    const m = /^(.+)#([1-9][0-9]*)(?:-([1-9][0-9]*))?$/.exec(ref)
    if (!m) return /#/.test(ref) ? undefined : { id: ref }
    return { id: m[1], a: Number(m[2]), b: Number(m[3] ?? m[2]) }
  }
  if (!ref || typeof ref !== "object") return undefined
  const o = ref as LineRef & object
  if (typeof (o as { id?: unknown }).id !== "string") return undefined
  const obj = o as { id: string; lines?: number | [number, number]; off?: true; hunk?: unknown }
  if (obj.off) return { id: obj.id, off: true }
  if (obj.hunk !== undefined) return typeof obj.hunk === "number" && Number.isInteger(obj.hunk) && obj.hunk >= 1 ? { id: obj.id, hunk: obj.hunk } : undefined
  if (typeof obj.lines === "number") return { id: obj.id, a: obj.lines, b: obj.lines }
  if (Array.isArray(obj.lines) && obj.lines.length === 2) return { id: obj.id, a: obj.lines[0], b: obj.lines[1] }
  return { id: obj.id }
}
