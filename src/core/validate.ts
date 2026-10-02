import {
  ARROWS,
  CODE_LANGS,
  DELTAS,
  DIAGRAM_TYPES,
  EMPHASES,
  ICONS,
  ROW_STATUSES,
  EDGE_STYLES,
  FRAME_KINDS,
  GRAPH_NODE_KINDS,
  MESSAGE_KINDS,
  PARTICIPANT_KINDS,
  type ChangeMeta,
  type ChangeStat,
  type FileRef,
  type FileRefLike,
  type GraphEdge,
  type GraphNode,
  type GraphSpec,
  type MessageRef,
  type StoryStep,
  type SequenceSpec,
  type Spec,
} from "./spec.ts"
import { normalizeLang } from "./diff/lang.ts"
import { layoutGraph } from "./layout/graph.ts"
import { layoutSequence } from "./layout/sequence.ts"
import { compileStory } from "./story/compile.ts"
import { lineOf, parseRef } from "./anchor.ts"
import { codeVersions } from "./layout/panels.ts"
import { hunksOfNode, rowsOfNode } from "./layout/diffnode.ts"
import { applyChanges } from "./layout/delta.ts"
import { parseHunks } from "./diff/parse.ts"

export type Severity = "error" | "warning"

export interface Diagnostic {
  severity: Severity
  /** JSON path, e.g. `nodes[2].kind`. */
  path: string
  message: string
  hint?: string
}

export interface ValidationResult {
  ok: boolean
  diagnostics: Diagnostic[]
  /** Normalised spec (defaults filled in) when `ok`. */
  spec?: Spec
}

type Obj = Record<string, unknown>
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x)
const ID_RE = /^[A-Za-z0-9_][A-Za-z0-9_.:\-]*$/

function closest(word: string, options: readonly string[]): string | undefined {
  let best: string | undefined
  let bestD = Infinity
  for (const o of options) {
    const d = lev(word.toLowerCase(), o.toLowerCase())
    if (d < bestD) {
      bestD = d
      best = o
    }
  }
  return bestD <= Math.max(2, Math.floor(word.length / 3)) ? best : undefined
}

function lev(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array<number>(n).fill(0)])
  for (let j = 1; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[m][n]
}

class Collector {
  diagnostics: Diagnostic[] = []
  error(path: string, message: string, hint?: string) {
    this.diagnostics.push({ severity: "error", path, message, hint })
  }
  warn(path: string, message: string, hint?: string) {
    this.diagnostics.push({ severity: "warning", path, message, hint })
  }
  get failed() {
    return this.diagnostics.some((d) => d.severity === "error")
  }
}

function str(c: Collector, o: Obj, key: string, path: string, required: boolean): string | undefined {
  const value = o[key]
  if (value === undefined || value === null) {
    if (required) c.error(`${path}${path ? "." : ""}${key}`, `missing required field "${key}"`, `add "${key}": "..."`)
    return undefined
  }
  if (typeof value !== "string") {
    c.error(`${path}${path ? "." : ""}${key}`, `"${key}" must be a string, got ${typeof value}`)
    return undefined
  }
  if (required && !value.trim()) c.error(`${path}${path ? "." : ""}${key}`, `"${key}" must not be empty`)
  return value
}

function oneOf<T extends string>(
  c: Collector,
  value: unknown,
  options: readonly T[],
  path: string,
  what: string,
): T | undefined {
  if (value === undefined) return undefined
  if (typeof value === "string" && (options as readonly string[]).includes(value)) return value as T
  const guess = typeof value === "string" ? closest(value, options) : undefined
  c.error(
    path,
    `unknown ${what} ${JSON.stringify(value)}`,
    guess ? `did you mean "${guess}"? (one of: ${options.join(", ")})` : `use one of: ${options.join(", ")}`,
  )
  return undefined
}

function arr(c: Collector, o: Obj, key: string, required: boolean): unknown[] {
  const value = o[key]
  if (value === undefined) {
    if (required) c.error(key, `missing required array "${key}"`, `add "${key}": [ ... ]`)
    return []
  }
  if (!Array.isArray(value)) {
    c.error(key, `"${key}" must be an array`)
    return []
  }
  return value
}

const COMMON_KEYS = new Set(["$schema", "type", "title", "subtitle", "direction", "story", "style", "change", "changes"])

function unknownKeys(c: Collector, o: Obj, allowed: Set<string>, path: string) {
  for (const k of Object.keys(o))
    if (!allowed.has(k)) {
      const guess = closest(k, [...allowed])
      c.warn(path ? `${path}.${k}` : k, `unknown field "${k}" is ignored`, guess ? `did you mean "${guess}"?` : undefined)
    }
}

/** Validate a spec value (parsed JSON or a JSON string). Never throws. */
export function validate(input: unknown): ValidationResult {
  const c = new Collector()
  let value = input
  if (typeof input === "string") {
    try {
      value = JSON.parse(input)
    } catch (e) {
      c.error("", `spec is not valid JSON: ${(e as Error).message}`, "check for trailing commas and unquoted keys")
      return { ok: false, diagnostics: c.diagnostics }
    }
  }
  if (!isObj(value)) {
    c.error("", "spec must be a JSON object", `start with { "type": "architecture", "title": "...", ... }`)
    return { ok: false, diagnostics: c.diagnostics }
  }
  if (value.type === "page") {
    c.error("type", `"page" is a page spec, not a diagram`, "validate it with validatePage() (storyink validate / storyink render handle both)")
    return { ok: false, diagnostics: c.diagnostics }
  }
  const type = oneOf(c, value.type, DIAGRAM_TYPES, "type", "diagram type")
  if (value.type === undefined) c.error("type", `missing required field "type"`, `use one of: ${DIAGRAM_TYPES.join(", ")}`)
  const title = str(c, value, "title", "", true)
  const subtitle = str(c, value, "subtitle", "", false)
  if (value.$schema !== undefined && typeof value.$schema !== "string") c.error("$schema", `"$schema" must be a string`)
  if (!type) return { ok: false, diagnostics: c.diagnostics }

  let style: { arrowheads?: boolean; legend?: boolean } | undefined
  if (value.style !== undefined) {
    if (!isObj(value.style)) c.error("style", `"style" must be an object`, `e.g. "style": { "arrowheads": true }`)
    else {
      unknownKeys(c, value.style, new Set(["arrowheads", "legend"]), "style")
      if (value.style.legend !== undefined && typeof value.style.legend !== "boolean") c.error("style.legend", `"legend" must be true or false`)
      else if (typeof value.style.legend === "boolean") style = { ...style, legend: value.style.legend }
      if (value.style.arrowheads !== undefined && typeof value.style.arrowheads !== "boolean")
        c.error("style.arrowheads", `"arrowheads" must be true or false`)
      else if (typeof value.style.arrowheads === "boolean") style = { arrowheads: value.style.arrowheads, ...style }
      if (type === "sequence" && value.style.arrowheads === false)
        c.warn("style.arrowheads", "sequence diagrams always draw arrowheads")
    }
  }
  const base = {
    ...(typeof value.$schema === "string" ? { $schema: value.$schema } : {}),
    ...(style ? { style } : {}),
    title: title ?? "",
    ...(subtitle ? { subtitle } : {}),
  }
  const spec = type === "sequence" ? validateSequence(c, value, base) : validateGraph(c, value, type, base)
  const change = changeMetaOf(c, value.change)
  if (change) spec.change = change
  // `changes` (embedded hunks, written by resolveChanges) is carried as is; later phases read it.
  if (isObj(value.changes)) spec.changes = value.changes as unknown as Spec["changes"]
  checkChangeConsistency(c, spec)
  if (value.story !== undefined) {
    const st = validateStoryShape(c, value.story)
    if (st !== undefined) spec.story = st
  }
  if (!c.failed && spec.story !== undefined) {
    // Resolve ids and timing against the real layout.
    try {
      const scene = type === "sequence" ? layoutSequence(spec as SequenceSpec) : layoutGraph(spec as GraphSpec)
      applyChanges(scene, spec)
      c.diagnostics.push(...compileStory(scene, spec).diagnostics)
    } catch (e) {
      c.error("story", `story could not be compiled: ${(e as Error).message}`)
    }
  }
  const ok = !c.failed
  return ok ? { ok, diagnostics: c.diagnostics, spec } : { ok, diagnostics: c.diagnostics }
}

const STEP_KEYS = new Set([
  "id", "at", "reveal", "pulse", "highlight", "caption", "counter", "stop", "hold",
  // 0.4 content steps
  "type", "line", "status", "dim", "undim", "hide", "show", "set", "clear", "wire", "unwire", "glow", "unglow", "focus",
  // diff code nodes
  "apply",
  // change diagrams
  "change",
  // narration rail
  "narrate",
])

/** Narrate shape: heading / body strings, cites `{ text, ref }` whose text occurs in the body, in order. */
function validateNarrate(c: Collector, v: unknown, p: string): void {
  if (!isObj(v)) {
    c.error(p, `"narrate" must be { "heading"?: string, "body": string, "cites"?: [{ "text", "ref" }] }`)
    return
  }
  for (const k of Object.keys(v)) if (!["heading", "body", "cites"].includes(k)) c.warn(`${p}.${k}`, `unknown key "${k}"`, `narrate keys: heading, body, cites`)
  if (v.heading !== undefined && typeof v.heading !== "string") c.error(`${p}.heading`, `"heading" must be a string`)
  if (typeof v.body !== "string" || !v.body.trim()) {
    c.error(`${p}.body`, `"narrate" needs a non-empty "body" string`)
    return
  }
  if (v.cites === undefined) return
  if (!Array.isArray(v.cites)) {
    c.error(`${p}.cites`, `"cites" must be a list of { "text", "ref" }`)
    return
  }
  let from = 0
  v.cites.forEach((x, k) => {
    const q = `${p}.cites[${k}]`
    if (!isObj(x) || typeof x.text !== "string" || !x.text || typeof x.ref !== "string" || !x.ref.trim()) {
      c.error(q, `a cite must be { "text": "words in the body", "ref": "element id or file path" }`)
      return
    }
    const at = (v.body as string).indexOf(x.text, from)
    if (at < 0) {
      const anywhere = (v.body as string).includes(x.text)
      c.error(`${q}.text`, anywhere ? `cite "${x.text}" is out of order` : `cite "${x.text}" does not occur in the body`, anywhere ? "list cites in the order their text appears in the body" : "a cite's text must be copied exactly from the body")
      return
    }
    from = at + x.text.length
  })
}

function validateStoryShape(c: Collector, raw: unknown): Spec["story"] | undefined {
  if (raw === "auto") return "auto"
  if (raw === "changes") return { steps: "changes" }
  if (!isObj(raw)) {
    c.error("story", `"story" must be an object or "auto"`, `{ "steps": [ { "reveal": ["api"] } ] } or "auto"`)
    return undefined
  }
  unknownKeys(c, raw, new Set(["autoplay", "camera", "end", "motion", "pace", "steps", "spotlight", "rewind"]), "story")
  if (raw.spotlight !== undefined && typeof raw.spotlight !== "boolean" && raw.spotlight !== "veil") c.error("story.spotlight", `"spotlight" must be true, false or "veil"`, `"veil" dims everything outside the step's focus`)
  const rewind = oneOf(c, raw.rewind, ["tape", "glitch"] as const, "story.rewind", "story rewind")
  const motion = oneOf(c, raw.motion, ["full", "reduced", "system"] as const, "story.motion", "story motion")
  const camera = oneOf(c, raw.camera, ["follow", "fit"] as const, "story.camera", "story camera")
  const paceOk = raw.pace === undefined || (typeof raw.pace === "number" && Number.isFinite(raw.pace) && raw.pace >= 0 && raw.pace <= 10)
  if (!paceOk) c.error("story.pace", `"pace" must be a number from 0 to 10`, `1 = default reading holds, 0 = none, 1.5 = slower`)
  const opts = {
    ...(raw.autoplay === true ? { autoplay: true } : {}),
    ...(motion ? { motion } : {}),
    ...(camera ? { camera } : {}),
    ...(paceOk && typeof raw.pace === "number" ? { pace: raw.pace } : {}),
    ...(raw.spotlight === true ? { spotlight: true } : raw.spotlight === "veil" ? { spotlight: "veil" as const } : {}),
    ...(rewind ? { rewind } : {}),
  }
  if (raw.autoplay !== undefined && typeof raw.autoplay !== "boolean") c.error("story.autoplay", `"autoplay" must be true or false`)
  const end = oneOf(c, raw.end, ["hold", "loop"] as const, "story.end", "story end")
  if (raw.steps === "changes") {
    const e0 = oneOf(c, raw.end, ["hold", "loop"] as const, "story.end", "story end")
    return { ...opts, ...(e0 ? { end: e0 } : {}), steps: "changes" }
  }
  if (raw.steps === "auto") {
    const e0 = oneOf(c, raw.end, ["hold", "loop"] as const, "story.end", "story end")
    return { ...opts, ...(e0 ? { end: e0 } : {}), steps: "auto" }
  }
  if (!Array.isArray(raw.steps)) {
    c.error("story.steps", `"steps" must be an array, "auto" or "changes"`)
    return undefined
  }
  const steps: StoryStep[] = []
  raw.steps.forEach((s0, i) => {
    const p = `story.steps[${i}]`
    if (!isObj(s0)) return c.error(p, "step must be an object", `{ "at": "+0.3", "pulse": "a->b" }`)
    unknownKeys(c, s0, STEP_KEYS, p)
    if (s0.at !== undefined && typeof s0.at !== "number" && typeof s0.at !== "string") c.error(`${p}.at`, `"at" must be seconds or "+x"`)
    if (typeof s0.at === "number" && (s0.at < 0 || !Number.isFinite(s0.at))) c.error(`${p}.at`, `"at" must be >= 0`)
    const strList = (v: unknown, key: string) => {
      if (v === undefined) return
      const list = Array.isArray(v) ? v : [v]
      if (!list.every((x) => typeof x === "string")) c.error(`${p}.${key}`, `"${key}" must be an id or a list of ids`)
    }
    strList(s0.reveal, "reveal")
    if (s0.highlight !== undefined && !(isObj(s0.highlight) && Array.isArray(s0.highlight.ids))) strList(s0.highlight, "highlight")
    if (s0.caption !== undefined && typeof s0.caption !== "string") c.error(`${p}.caption`, `"caption" must be a string`)
    if (s0.stop !== undefined && typeof s0.stop !== "string") c.error(`${p}.stop`, `"stop" must be a string (chapter label)`)
    if (s0.hold !== undefined && !(typeof s0.hold === "number" && Number.isFinite(s0.hold) && s0.hold >= 0 && s0.hold <= 60)) c.error(`${p}.hold`, `"hold" must be seconds from 0 to 60`)
    if (s0.counter !== undefined) {
      const list = Array.isArray(s0.counter) ? s0.counter : [s0.counter]
      if (!list.every((x) => isObj(x) && typeof x.id === "string" && typeof x.to === "number")) c.error(`${p}.counter`, `"counter" must be { "id": "...", "to": number }`)
    }
    for (const k of ["undim", "hide", "show", "clear", "glow", "unglow"]) strList(s0[k], k)
    if (s0.focus !== undefined && typeof s0.focus !== "string" && !(Array.isArray(s0.focus) && s0.focus.length && s0.focus.every((x) => typeof x === "string"))) c.error(`${p}.focus`, `"focus" must be an id or a list of ids`)
    strList(s0.change, "change")
    if (s0.narrate !== undefined) validateNarrate(c, s0.narrate, `${p}.narrate`)
    const objList = (key: string, ok: (x: unknown) => boolean, msg: string) => {
      const v = s0[key]
      if (v === undefined) return
      const list = Array.isArray(v) ? v : [v]
      if (!list.every(ok)) c.error(`${p}.${key}`, msg)
    }
    const idOrObj = (req: string) => (x: unknown) => typeof x === "string" || (isObj(x) && typeof x[req] === "string")
    objList("type", idOrObj("id"), `"type" must be a code node / panel row id, or { "id": ..., "cps"?: n }`)
    objList("line", idOrObj("id"), `"line" must be "code#2", "code#2-4" or { "id": ..., "lines"?: .., "off"?: true }`)
    objList("status", (x) => isObj(x) && typeof x.id === "string" && typeof x.to === "string" && (ROW_STATUSES as readonly string[]).includes(x.to), `"status" must be { "id": "panel#row", "to": "running" | "done" | "error" | "none" }`)
    objList("set", (x) => isObj(x) && typeof x.id === "string" && Object.keys(x).length >= 2, `"set" must be { "id": ..., "code" | "text" | "detail" | "tag" | "label": ... }`)
    objList(
      "set",
      (x) =>
        !isObj(x) ||
        ((x.code === undefined || typeof x.code === "string" || (Array.isArray(x.code) && x.code.every((l) => typeof l === "string"))) &&
          ["text", "detail", "tag", "label"].every((k) => x[k] === undefined || typeof x[k] === "string")),
      `"set" values must be strings ("code" may be a list of lines)`,
    )
    objList("wire", idOrObj("edge"), `"wire" must be an edge id or { "edge": ..., "duration"?: s }`)
    objList("unwire", idOrObj("edge"), `"unwire" must be an edge id or { "edge": ..., "duration"?: s }`)
    objList(
      "apply",
      (x) => typeof x === "string" || (isObj(x) && typeof x.id === "string" && Object.keys(x).every((k) => k === "id" || k === "hunk" || k === "cps") && (x.cps === undefined || (typeof x.cps === "number" && x.cps > 0))),
      `"apply" must be a diff code node id or { "id": ..., "hunk"?: n, "cps"?: n }`,
    )
    if (s0.dim !== undefined && !(isObj(s0.dim) && Array.isArray(s0.dim.ids))) strList(s0.dim, "dim")
    if (isObj(s0.dim) && s0.dim.to !== undefined && !(typeof s0.dim.to === "number" && s0.dim.to >= 0.05 && s0.dim.to <= 1)) c.error(`${p}.dim.to`, `"to" must be a level from 0.05 to 1`)
    if (s0.pulse !== undefined) {
      const list = Array.isArray(s0.pulse) ? s0.pulse : [s0.pulse]
      if (!list.every((x) => typeof x === "string" || (isObj(x) && (typeof x.edge === "string" || Array.isArray(x.route)))))
        c.error(`${p}.pulse`, `"pulse" must be an edge id, "from->to", or { "edge" | "route" }`)
    }
    steps.push(s0 as StoryStep)
  })
  return { ...opts, ...(end ? { end } : {}), steps }
}

function validateGraph(
  c: Collector,
  o: Obj,
  type: GraphSpec["type"],
  base: { title: string; subtitle?: string },
): GraphSpec {
  unknownKeys(c, o, new Set([...COMMON_KEYS, "nodes", "edges", "groups"]), "")
  const dirOf = (v: unknown, path: string): GraphSpec["direction"] => {
    if (v === undefined) return undefined
    const d = typeof v === "string" ? v.toUpperCase() : v
    const map: Record<string, "TB" | "BT" | "LR" | "RL"> = { TB: "TB", TD: "TB", BT: "BT", LR: "LR", RL: "RL" }
    if (typeof d === "string" && map[d]) return map[d]
    c.error(path, `unknown direction ${JSON.stringify(v)}`, `use "TB", "LR", "BT" or "RL" (or omit to auto-pick)`)
    return undefined
  }
  const direction = dirOf(o.direction, "direction")
  const kinds = GRAPH_NODE_KINDS[type] as readonly string[]
  const defaultKind = type === "workflow" ? "step" : type === "lifecycle" ? "state" : "service"
  const ids = new Map<string, string>()
  const claim = (id: string, path: string) => {
    const prev = ids.get(id)
    if (prev) c.error(path, `duplicate id "${id}" (already used at ${prev})`, "ids must be unique across nodes and groups")
    else ids.set(id, path)
  }

  const groups: GraphSpec["groups"] = []
  arr(c, o, "groups", false).forEach((g, i) => {
    const p = `groups[${i}]`
    if (!isObj(g)) return c.error(p, "group must be an object", `{ "id": "vpc", "label": "VPC" }`)
    unknownKeys(c, g, new Set(["id", "label", "kind", "parent", "direction", "bare", "delta"]), p)
    const gDelta = oneOf(c, g.delta, DELTAS, `${p}.delta`, "delta")
    if (g.bare !== undefined && typeof g.bare !== "boolean") c.error(`${p}.bare`, `"bare" must be true or false`)
    const id = str(c, g, "id", p, true)
    if (!id) return
    if (!ID_RE.test(id)) c.error(`${p}.id`, `invalid id "${id}"`, "use letters, digits, _ . : -")
    claim(id, p)
    groups.push({
      id,
      label: str(c, g, "label", p, false) ?? id,
      ...(typeof g.kind === "string" ? { kind: g.kind } : {}),
      ...(typeof g.parent === "string" ? { parent: g.parent } : {}),
      ...(g.direction !== undefined && dirOf(g.direction, `${p}.direction`) ? { direction: dirOf(g.direction, `${p}.direction`) } : {}),
      ...(g.bare === true ? { bare: true } : {}),
      ...(gDelta ? { delta: gDelta } : {}),
    })
  })

  const nodes: GraphSpec["nodes"] = []
  const rawNodes = arr(c, o, "nodes", true)
  if (Array.isArray(o.nodes) && rawNodes.length === 0) c.error("nodes", "diagram has no nodes", "add at least one node")
  rawNodes.forEach((n, i) => {
    const p = `nodes[${i}]`
    if (!isObj(n)) return c.error(p, "node must be an object", `{ "id": "api", "label": "API" }`)
    unknownKeys(c, n, new Set(["id", "label", "kind", "detail", "tag", "parent", "group", "direction", "counter", ...RICH_NODE_KEYS, ...CHANGE_NODE_KEYS]), p)
    const id = str(c, n, "id", p, true)
    if (!id) return
    if (!ID_RE.test(id)) c.error(`${p}.id`, `invalid id "${id}"`, "use letters, digits, _ . : -")
    claim(id, p)
    const kind = n.kind === undefined ? defaultKind : oneOf(c, n.kind, kinds, `${p}.kind`, `${type} node kind`)
    const parent = typeof n.parent === "string" ? n.parent : typeof n.group === "string" ? n.group : undefined
    nodes.push({
      id,
      label: str(c, n, "label", p, false) ?? id,
      kind: (kind ?? defaultKind) as GraphSpec["nodes"][number]["kind"],
      ...(typeof n.detail === "string" && n.detail ? { detail: n.detail } : {}),
      ...(typeof n.tag === "string" ? { tag: n.tag } : {}),
      ...(parent ? { parent } : {}),
      ...(n.direction !== undefined && dirOf(n.direction, `${p}.direction`) ? { direction: dirOf(n.direction, `${p}.direction`) } : {}),
      ...(counterOf(c, n.counter, `${p}.counter`) ?? {}),
      ...richOf(c, n, kind ?? defaultKind, p, id),
      ...changeOf(c, n, p, "node", kind ?? defaultKind),
    })
  })
  const counterIds = new Set<string>()
  nodes.forEach((n, i) => {
    if (!n.counter) return
    if (counterIds.has(n.counter.id)) c.error(`nodes[${i}].counter.id`, `duplicate counter id "${n.counter.id}"`)
    counterIds.add(n.counter.id)
  })

  // Parents: groups, or composite nodes in lifecycle diagrams.
  const containers = new Set(groups.map((g) => g.id))
  for (const n of nodes) if (n.kind === "composite") containers.add(n.id)
  const parentOf = new Map<string, string>()
  groups.forEach((g, i) => {
    if (!g.parent) return
    if (!containers.has(g.parent))
      c.error(`groups[${i}].parent`, `unknown parent "${g.parent}"`, hintId(g.parent, [...containers]))
    else parentOf.set(g.id, g.parent)
  })
  nodes.forEach((n, i) => {
    if (!n.parent) return
    if (!containers.has(n.parent)) {
      const isNode = nodes.some((m) => m.id === n.parent)
      c.error(
        `nodes[${i}].parent`,
        isNode ? `parent "${n.parent}" is a node, not a group` : `unknown parent "${n.parent}"`,
        isNode ? (type === "lifecycle" ? `set "kind": "composite" on "${n.parent}"` : "declare it in \"groups\"") : hintId(n.parent, [...containers]),
      )
    } else if (n.parent === n.id) c.error(`nodes[${i}].parent`, `node "${n.id}" cannot contain itself`)
    else parentOf.set(n.id, n.parent)
  })
  for (const start of parentOf.keys()) {
    const seen = new Set<string>([start])
    let cur = parentOf.get(start)
    while (cur) {
      if (seen.has(cur)) {
        c.error("groups", `nesting cycle through "${start}"`, "a group cannot (indirectly) contain itself")
        break
      }
      seen.add(cur)
      cur = parentOf.get(cur)
    }
  }

  const known = new Set([...nodes.map((n) => n.id), ...groups.map((g) => g.id)])
  const edges: NonNullable<GraphSpec["edges"]> = []
  const edgeIds = new Set<string>()
  arr(c, o, "edges", false).forEach((e, i) => {
    const p = `edges[${i}]`
    if (!isObj(e)) return c.error(p, "edge must be an object", `{ "from": "a", "to": "b" }`)
    unknownKeys(c, e, new Set(["id", "from", "to", "label", "style", "arrow", ...CHANGE_EDGE_KEYS]), p)
    const ech = changeOf(c, e, p, "edge")
    const from = str(c, e, "from", p, true)
    const to = str(c, e, "to", p, true)
    for (const [end, ref] of [["from", from], ["to", to]] as const) {
      if (!ref) continue
      const r = parseRef(ref)
      if (!known.has(r.node)) c.error(`${p}.${end}`, `unknown node "${r.node}"`, hintId(r.node, [...known]))
      else if (r.anchor) checkAnchor(c, `${p}.${end}`, ref, r.node, r.anchor, nodes, { ...o, nodes } as unknown as GraphSpec)
    }
    const style = oneOf(c, e.style, EDGE_STYLES, `${p}.style`, "edge style")
    const arrow = oneOf(c, e.arrow, ARROWS, `${p}.arrow`, "arrow mode")
    let id = str(c, e, "id", p, false)
    if (id !== undefined && edgeIds.has(id)) c.error(`${p}.id`, `duplicate edge id "${id}"`)
    if (id === undefined) {
      id = `${from}->${to}`
      for (let k = 2; edgeIds.has(id); k++) id = `${from}->${to}#${k}`
    }
    edgeIds.add(id)
    if (!from || !to) return
    edges.push({
      id,
      from,
      to,
      ...(typeof e.label === "string" && e.label ? { label: e.label } : {}),
      style: style ?? "solid",
      arrow: arrow ?? "end",
      ...ech,
    })
  })

  return {
    type,
    ...base,
    ...(direction ? { direction } : {}),
    nodes,
    edges,
    groups,
  }
}

const RICH_NODE_KEYS = ["icon", "rows", "code", "lang", "size", "muted", "stack"]
const ROW_KEYS = new Set(["id", "tag", "icon", "text", "detail", "status", "indent", "muted"])
const ROW_ID_RE = /^[A-Za-z_][A-Za-z0-9_.:\-]*$/
// Emoji / wide (East Asian) characters break the 0.6 em monospace measurement.
const WIDE_RE = /[\p{Extended_Pictographic}\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/u
const ICON_HINTS: Record<string, string> = { "🔧": "wrench", "🛠": "wrench", "🔌": "plug", "📄": "file", "📁": "file", "💻": "terminal", "🔍": "search", "🔎": "search", "🌐": "globe", "⚡": "bolt", "👤": "user", "✨": "spark" }

function wideCheck(c: Collector, path: string, text: string) {
  const m = WIDE_RE.exec(text)
  if (!m) return
  const icon = ICON_HINTS[m[0]]
  c.warn(path, `"${m[0]}" is not monospace${icon ? `; use "icon": "${icon}"` : ""}`, icon ? undefined : `icons: ${ICONS.join(", ")}`)
}

/** Rich-node fields (0.4): icon, rows, code, lang, size, muted, stack. */
function richOf(c: Collector, n: Obj, kind: string, p: string, id: string): Partial<GraphSpec["nodes"][number]> {
  const out: Partial<GraphSpec["nodes"][number]> = {}
  const icon = oneOf(c, n.icon, ICONS, `${p}.icon`, "icon")
  if (icon) out.icon = icon
  if (n.muted !== undefined) {
    if (typeof n.muted !== "boolean") c.error(`${p}.muted`, `"muted" must be true or false`)
    else if (n.muted) out.muted = true
  }
  if (n.stack !== undefined) {
    if (n.stack !== 1 && n.stack !== 2 && n.stack !== 3) c.error(`${p}.stack`, `"stack" must be 1, 2 or 3`)
    else out.stack = n.stack
  }
  if (n.lang !== undefined) {
    const lang = oneOf(c, normalizeLang(n.lang), CODE_LANGS, `${p}.lang`, "code language")
    if (lang) out.lang = lang
  }
  if (n.size !== undefined) {
    const s = n.size
    const okN = (v: unknown, lo: number, hi: number) => v === undefined || (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi)
    if (!isObj(s) || !okN(s.cols, 8, 160) || !okN(s.lines, 1, 60) || Object.keys(s).some((k) => k !== "cols" && k !== "lines"))
      c.error(`${p}.size`, `"size" must be { "cols": 8–160, "lines": 1–60 }`)
    else out.size = { ...(typeof s.cols === "number" ? { cols: s.cols } : {}), ...(typeof s.lines === "number" ? { lines: s.lines } : {}) }
  }
  if (n.code !== undefined) {
    if (kind !== "code") c.warn(`${p}.code`, `"code" is only drawn on "code" nodes`, `set "kind": "code"`)
    if (typeof n.code !== "string" && !(Array.isArray(n.code) && n.code.every((l) => typeof l === "string")))
      c.error(`${p}.code`, `"code" must be a string or a list of lines`)
    else {
      out.code = n.code as string | string[]
      const lines = (Array.isArray(n.code) ? n.code : n.code.split("\n")) as string[]
      if (lines.some((l) => l.includes("\t"))) c.warn(`${p}.code`, "tabs are shown as 2 spaces")
      lines.forEach((l, k) => {
        const len = Array.from(l.replace(/\t/g, "  ")).length
        if (len > 120) c.warn(`${p}.code`, `code line ${k + 1} is ${len} characters; the panel grows to fit`)
        wideCheck(c, `${p}.code`, l)
      })
    }
  }
  if (n.rows !== undefined) {
    if (kind !== "panel") c.warn(`${p}.rows`, `"rows" is only drawn on "panel" nodes`, `set "kind": "panel"`)
    if (!Array.isArray(n.rows)) c.error(`${p}.rows`, `"rows" must be an array`)
    else {
      const seen = new Set<string>()
      const rows: NonNullable<GraphSpec["nodes"][number]["rows"]> = []
      n.rows.forEach((r, j) => {
        const rp = `${p}.rows[${j}]`
        if (!isObj(r)) return c.error(rp, "row must be an object", `{ "text": "..." }`)
        unknownKeys(c, r, ROW_KEYS, rp)
        if (typeof r.text !== "string" && typeof r.tag !== "string") c.error(rp, `row needs "text" (or "tag")`)
        for (const k of ["text", "detail", "tag"]) if (r[k] !== undefined && typeof r[k] !== "string") c.error(`${rp}.${k}`, `"${k}" must be a string`)
        if (r.id !== undefined) {
          if (typeof r.id !== "string" || !ROW_ID_RE.test(r.id))
            c.error(`${rp}.id`, `invalid row id ${JSON.stringify(r.id)}`, `row ids start with a letter or _; "node#12" means code line 12`)
          else if (seen.has(r.id)) c.error(`${rp}.id`, `duplicate row id "${r.id}" in "${id}"`)
          else seen.add(r.id)
        }
        const ricon = oneOf(c, r.icon, ICONS, `${rp}.icon`, "icon")
        const status = oneOf(c, r.status, ROW_STATUSES, `${rp}.status`, "row status")
        if (r.indent !== undefined && !(typeof r.indent === "number" && Number.isInteger(r.indent) && r.indent >= 0 && r.indent <= 4))
          c.error(`${rp}.indent`, `"indent" must be an integer from 0 to 4`)
        if (r.muted !== undefined && typeof r.muted !== "boolean") c.error(`${rp}.muted`, `"muted" must be true or false`)
        for (const k of ["text", "detail", "tag"]) if (typeof r[k] === "string") wideCheck(c, `${rp}.${k}`, r[k] as string)
        rows.push({
          ...(typeof r.id === "string" ? { id: r.id } : {}),
          ...(typeof r.tag === "string" ? { tag: r.tag } : {}),
          ...(ricon ? { icon: ricon } : {}),
          ...(typeof r.text === "string" ? { text: r.text } : {}),
          ...(typeof r.detail === "string" ? { detail: r.detail } : {}),
          ...(status ? { status } : {}),
          ...(typeof r.indent === "number" && r.indent > 0 ? { indent: r.indent } : {}),
          ...(r.muted === true ? { muted: true } : {}),
        })
      })
      out.rows = rows
    }
  }
  return out
}

/** An edge anchor must name a panel row or an in-range code line. */
function checkAnchor(c: Collector, path: string, ref: string, node: string, anchor: string, nodes: GraphSpec["nodes"], spec: GraphSpec) {
  const n = nodes.find((x) => x.id === node)
  if (!n || (n.kind !== "panel" && n.kind !== "code")) return c.error(path, `"${ref}": anchors work on panel rows and code lines only`, n ? `"${node}" is a ${n.kind ?? "node"}` : `"${node}" is a group`)
  const k = lineOf(anchor)
  if (n.kind === "code" && n.diff !== undefined) {
    const rows = hunksOfNode(n) ? rowsOfNode(n) : undefined
    if (!rows) return
    const m = /^([+-])([1-9][0-9]*)$/.exec(anchor)
    if (m) {
      const line = Number(m[2])
      const side = m[1] === "+" ? "head" : "base"
      const hit = rows.some((r) => (m[1] === "+" ? r.new === line && r.kind !== "del" : r.old === line && r.kind !== "add"))
      const shown = rows.filter((r) => (m[1] === "+" ? r.kind !== "del" : r.kind !== "add")).map((r) => (m[1] === "+" ? r.new : r.old)).filter((x): x is number => x !== undefined)
      if (!hit) c.error(path, `"${ref}": "${node}" shows no ${side} line ${line}`, shown.length ? `${side} lines shown: ${shown[0]}–${shown[shown.length - 1]}` : `the diff shows no ${side} lines`)
      return
    }
    if (k === undefined) return c.error(path, `"${ref}": diff anchors are "${node}#+14" (head line), "${node}#-13" (base line) or a display row "${node}#3"`)
    if (k > rows.length) c.error(path, `"${ref}": "${node}" shows ${rows.length} rows`)
    return
  }
  if (n.kind === "code") {
    if (k === undefined && /^[+-][1-9][0-9]*$/.test(anchor)) return c.error(path, `"${ref}": head / base line anchors need a diff code node`, `give "${node}" a "diff" (or use a display line "${node}#1")`)
    if (k === undefined) return c.error(path, `"${ref}": code anchors are line numbers ("${node}#1")`)
    const lines = Math.max(n.size?.lines ?? 0, ...codeVersions(spec, n).map((v) => v.length))
    if (k > lines) c.error(path, `"${ref}": "${node}" has ${lines} lines`, `reserve more with "size": { "lines": ${k} }`)
    return
  }
  const ids = (n.rows ?? []).map((r) => r.id).filter((x): x is string => !!x)
  if (!ids.includes(anchor)) c.error(path, `unknown row "${anchor}" in "${node}"`, ids.length ? `rows: ${ids.slice(0, 8).join(", ")}${ids.length > 8 ? ", ..." : ""}` : "give the row an \"id\"")
}

function counterOf(c: Collector, v: unknown, path: string): { counter: NonNullable<GraphSpec["nodes"][number]["counter"]> } | undefined {
  if (v === undefined) return undefined
  if (!isObj(v) || typeof v.id !== "string" || !v.id) {
    c.error(path, `"counter" needs an "id"`, `{ "id": "hits", "value": 0, "label": "hits" }`)
    return undefined
  }
  unknownKeys(c, v, new Set(["id", "value", "label", "prefix", "suffix"]), path)
  if (v.value !== undefined && (typeof v.value !== "number" || !Number.isFinite(v.value))) c.error(`${path}.value`, `"value" must be a number`)
  const str = (k: string) => (typeof v[k] === "string" ? { [k]: v[k] as string } : {})
  return { counter: { id: v.id, value: typeof v.value === "number" ? v.value : 0, ...str("label"), ...str("prefix"), ...str("suffix") } }
}

function hintId(id: string, known: string[]): string {
  const g = closest(id, known)
  return g ? `did you mean "${g}"?` : `declare "${id}" first, or use one of: ${known.slice(0, 8).join(", ")}${known.length > 8 ? ", ..." : ""}`
}

function validateSequence(c: Collector, o: Obj, base: { title: string; subtitle?: string }): SequenceSpec {
  unknownKeys(c, o, new Set([...COMMON_KEYS, "participants", "messages", "activations", "notes", "frames", "bands", "boxes", "autonumber"]), "")
  if (o.direction !== undefined) c.warn("direction", "sequence diagrams ignore \"direction\"")
  const ids = new Set<string>()
  const participants: SequenceSpec["participants"] = []
  arr(c, o, "participants", true).forEach((p0, i) => {
    const p = `participants[${i}]`
    if (!isObj(p0)) return c.error(p, "participant must be an object", `{ "id": "api", "label": "API" }`)
    unknownKeys(c, p0, new Set(["id", "label", "kind", "delta"]), p)
    const pDelta = oneOf(c, p0.delta, DELTAS, `${p}.delta`, "delta")
    const id = str(c, p0, "id", p, true)
    if (!id) return
    if (ids.has(id)) c.error(`${p}.id`, `duplicate participant "${id}"`)
    ids.add(id)
    const kind = oneOf(c, p0.kind, PARTICIPANT_KINDS, `${p}.kind`, "participant kind")
    participants.push({ id, label: str(c, p0, "label", p, false) ?? id, kind: kind ?? "participant", ...(pDelta ? { delta: pDelta } : {}) })
  })
  if (Array.isArray(o.participants) && participants.length === 0 && o.participants.length === 0)
    c.error("participants", "sequence has no participants", "add at least one participant")
  const known = [...ids]
  const pref = (v: unknown, path: string): string | undefined => {
    if (typeof v !== "string") {
      c.error(path, "participant reference must be a string")
      return undefined
    }
    if (!ids.has(v)) c.error(path, `unknown participant "${v}"`, hintId(v, known))
    return v
  }

  const messages: SequenceSpec["messages"] = []
  const msgIds = new Map<string, number>()
  arr(c, o, "messages", true).forEach((m, i) => {
    const p = `messages[${i}]`
    if (!isObj(m)) {
      c.error(p, "message must be an object", `{ "from": "a", "to": "b", "label": "GET /" }`)
      messages.push({ from: "", to: "", kind: "sync" })
      return
    }
    unknownKeys(c, m, new Set(["id", "from", "to", "label", "kind", ...CHANGE_EDGE_KEYS]), p)
    const mch = changeOf(c, m, p, "message")
    const from = pref(m.from, `${p}.from`) ?? ""
    const to = pref(m.to, `${p}.to`) ?? ""
    let kind = oneOf(c, m.kind, MESSAGE_KINDS, `${p}.kind`, "message kind") ?? "sync"
    if (from && from === to) kind = "self"
    const id = typeof m.id === "string" ? m.id : undefined
    if (id) {
      if (msgIds.has(id)) c.error(`${p}.id`, `duplicate message id "${id}"`)
      msgIds.set(id, i)
    }
    messages.push({
      ...(id ? { id } : {}),
      from,
      to,
      ...(typeof m.label === "string" ? { label: m.label } : {}),
      kind,
      ...mch,
    })
  })

  const ref = (v: unknown, path: string, allowEnd = false): number | undefined => {
    if (typeof v === "number" && Number.isInteger(v)) {
      if (v < 0 || v > messages.length - (allowEnd ? 0 : 1)) {
        c.error(path, `message index ${v} is out of range (0..${messages.length - 1})`)
        return undefined
      }
      return v
    }
    if (typeof v === "string") {
      const idx = msgIds.get(v)
      if (idx === undefined) c.error(path, `unknown message id "${v}"`, hintId(v, [...msgIds.keys()]))
      return idx
    }
    c.error(path, "message reference must be an index or message id")
    return undefined
  }

  const activations: NonNullable<SequenceSpec["activations"]> = []
  arr(c, o, "activations", false).forEach((a, i) => {
    const p = `activations[${i}]`
    if (!isObj(a)) return c.error(p, "activation must be an object")
    const participant = pref(a.participant, `${p}.participant`)
    const start = ref(a.start, `${p}.start`)
    const end = ref(a.end, `${p}.end`)
    if (start !== undefined && end !== undefined && end < start)
      c.error(p, `activation ends (${end}) before it starts (${start})`, "swap start and end")
    if (participant && start !== undefined && end !== undefined) activations.push({ participant, start, end })
  })

  const notes: NonNullable<SequenceSpec["notes"]> = []
  arr(c, o, "notes", false).forEach((n, i) => {
    const p = `notes[${i}]`
    if (!isObj(n)) return c.error(p, "note must be an object")
    const text = str(c, n, "text", p, true)
    const note: NonNullable<SequenceSpec["notes"]>[number] = { text: text ?? "" }
    if (Array.isArray(n.over)) {
      if (n.over.length < 1 || n.over.length > 2) c.error(`${p}.over`, "\"over\" takes one or two participants")
      note.over = n.over.map((x, j) => pref(x, `${p}.over[${j}]`) ?? "")
    } else if (n.left !== undefined) note.left = pref(n.left, `${p}.left`)
    else if (n.right !== undefined) note.right = pref(n.right, `${p}.right`)
    else c.error(p, "note needs a position", `add "over": ["a"], "left": "a" or "right": "a"`)
    if (n.after !== undefined) {
      const r = ref(n.after, `${p}.after`)
      if (r !== undefined) note.after = r
    }
    if (n.outside === true) note.outside = true
    notes.push(note)
  })

  const frames: NonNullable<SequenceSpec["frames"]> = []
  arr(c, o, "frames", false).forEach((f, i) => {
    const p = `frames[${i}]`
    if (!isObj(f)) return c.error(p, "frame must be an object")
    const kind = oneOf(c, f.kind, FRAME_KINDS, `${p}.kind`, "frame kind")
    if (f.kind === undefined) c.error(`${p}.kind`, "missing frame kind", `use one of: ${FRAME_KINDS.join(", ")}`)
    const start = ref(f.start, `${p}.start`)
    const end = ref(f.end, `${p}.end`)
    if (start !== undefined && end !== undefined && end < start) c.error(p, "frame ends before it starts")
    const sections: NonNullable<NonNullable<SequenceSpec["frames"]>[number]["sections"]> = []
    if (Array.isArray(f.sections))
      f.sections.forEach((s, j) => {
        if (!isObj(s)) return c.error(`${p}.sections[${j}]`, "section must be an object")
        const ss = ref(s.start, `${p}.sections[${j}].start`)
        if (ss !== undefined && start !== undefined && end !== undefined && (ss <= start || ss > end))
          c.error(`${p}.sections[${j}].start`, "section must start inside its frame, after the first message")
        if (ss !== undefined) sections.push({ start: ss, ...(typeof s.label === "string" ? { label: s.label } : {}) })
      })
    if (kind && start !== undefined && end !== undefined)
      frames.push({ kind, start, end, ...(typeof f.label === "string" ? { label: f.label } : {}), sections })
  })
  // Frames must nest properly.
  for (let a = 0; a < frames.length; a++)
    for (let b = a + 1; b < frames.length; b++) {
      const A = frames[a]
      const B = frames[b]
      const overlap = A.start <= B.end && B.start <= A.end
      const nested = (A.start <= B.start && B.end <= A.end) || (B.start <= A.start && A.end <= B.end)
      if (overlap && !nested)
        c.error(`frames[${b}]`, `frame overlaps frames[${a}] without nesting`, "frames must be disjoint or fully nested")
    }

  const bands: NonNullable<SequenceSpec["bands"]> = []
  arr(c, o, "bands", false).forEach((b, i) => {
    const p = `bands[${i}]`
    if (!isObj(b)) return c.error(p, "band must be an object", `{ "start": 0, "end": 2 }`)
    const start = ref(b.start, `${p}.start`)
    const end = ref(b.end, `${p}.end`)
    if (start !== undefined && end !== undefined && end < start) c.error(p, "band ends before it starts")
    if (start !== undefined && end !== undefined) bands.push({ start, end, ...(typeof b.label === "string" ? { label: b.label } : {}) })
  })
  const boxes: NonNullable<SequenceSpec["boxes"]> = []
  const order = participants.map((x) => x.id)
  arr(c, o, "boxes", false).forEach((b, i) => {
    const p = `boxes[${i}]`
    if (!isObj(b) || !Array.isArray(b.participants)) return c.error(p, "box needs a participants array", `{ "label": "Backend", "participants": ["api", "db"] }`)
    const ids = b.participants.map((x, j) => pref(x, `${p}.participants[${j}]`)).filter((x): x is string => !!x)
    const idx = ids.map((x) => order.indexOf(x)).filter((x) => x >= 0).sort((a, b2) => a - b2)
    if (idx.length && idx[idx.length - 1] - idx[0] !== idx.length - 1)
      c.error(`${p}.participants`, "box participants must be adjacent in the participants list", "reorder participants so the box members are next to each other")
    if (ids.length) boxes.push({ participants: ids, ...(typeof b.label === "string" ? { label: b.label } : {}) })
  })

  const resolve = (r: MessageRef) => r as number
  return {
    type: "sequence",
    ...base,
    participants,
    messages,
    activations: activations.map((a) => ({ ...a, start: resolve(a.start), end: resolve(a.end) })),
    notes,
    frames,
    bands,
    boxes,
    autonumber: o.autonumber === true,
  }
}

export function formatDiagnostic(d: Diagnostic): string {
  return `${d.severity}${d.path ? ` at ${d.path}` : ""}: ${d.message}${d.hint ? ` (hint: ${d.hint})` : ""}`
}

// ---------------------------------------------------------------------------
// Change diagrams: delta / emphasis / files / stat / summary, `change` meta, consistency.

const CHANGE_NODE_KEYS = ["delta", "files", "stat", "summary", "diff"]
const CHANGE_EDGE_KEYS = ["delta", "emphasis", "files", "summary"]
const FILE_REF_KEYS = new Set(["path", "lines", "revision"])

const posInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1

function fileRefsOf(c: Collector, v: unknown, path: string): FileRefLike[] | undefined {
  if (v === undefined) return undefined
  const list = Array.isArray(v) ? v : typeof v === "string" || isObj(v) ? [v] : undefined
  if (!list) {
    c.error(path, `"files" must be a list of paths or { "path", "lines"?, "revision"? }`, `"files": ["src/api.ts", { "path": "src/db.ts", "lines": [10, 24] }]`)
    return undefined
  }
  if (!Array.isArray(v)) c.warn(path, `"files" should be a list`, `wrap it in [ ... ]`)
  const out: FileRefLike[] = []
  list.forEach((f, i) => {
    const p = Array.isArray(v) ? `${path}[${i}]` : path
    if (typeof f === "string") {
      if (!f.trim()) return c.error(p, "file path must not be empty")
      out.push(f)
      return
    }
    if (!isObj(f)) return c.error(p, `file must be a path or { "path": ..., "lines"?: ... }`)
    unknownKeys(c, f, FILE_REF_KEYS, p)
    if (typeof f.path !== "string" || !f.path.trim()) return c.error(`${p}.path`, `"path" must be a non-empty string`, `"path": "src/api.ts"`)
    const ref: FileRef = { path: f.path }
    if (f.lines !== undefined) {
      if (posInt(f.lines)) ref.lines = f.lines
      else if (Array.isArray(f.lines) && f.lines.length === 2 && posInt(f.lines[0]) && posInt(f.lines[1])) {
        if (f.lines[0] > f.lines[1]) c.error(`${p}.lines`, `line range ${f.lines[0]}–${f.lines[1]} is reversed`, `use [${f.lines[1]}, ${f.lines[0]}]`)
        else ref.lines = [f.lines[0], f.lines[1]]
      } else c.error(`${p}.lines`, `"lines" must be a line number ≥ 1 or [first, last]`, `"lines": 12 or "lines": [12, 30] (1-based, inclusive)`)
    }
    const rev = oneOf(c, f.revision, ["head", "base"] as const, `${p}.revision`, "revision")
    if (rev) ref.revision = rev
    out.push(ref)
  })
  return out.length ? out : undefined
}

function statOf(c: Collector, v: unknown, path: string): ChangeStat | undefined {
  if (v === undefined) return undefined
  if (!isObj(v)) {
    c.error(path, `"stat" must be { "add"?: n, "del"?: n }`, `"stat": { "add": 38, "del": 12 }`)
    return undefined
  }
  unknownKeys(c, v, new Set(["add", "del"]), path)
  const out: ChangeStat = {}
  for (const k of ["add", "del"] as const) {
    const x = v[k]
    if (x === undefined) continue
    if (typeof x !== "number" || !Number.isInteger(x)) c.error(`${path}.${k}`, `"${k}" must be a whole number of lines`)
    else if (x < 0) c.error(`${path}.${k}`, `"${k}" must not be negative`, `count lines, e.g. "${k}": ${-x}`)
    else out[k] = x
  }
  return Object.keys(out).length ? out : undefined
}

/** Change fields of a node / edge / message (validated, normalised). */
type ChangeOut = Pick<GraphNode, "delta" | "files" | "stat" | "summary" | "diff"> & Pick<GraphEdge, "emphasis">
function changeOf(c: Collector, o: Obj, p: string, what: "node" | "edge" | "message", kind?: string): ChangeOut {
  const out: ChangeOut = {}
  const d = oneOf(c, o.delta, DELTAS, `${p}.delta`, "delta")
  if (d) out.delta = d
  if (what !== "node") {
    const em = oneOf(c, o.emphasis, EMPHASES, `${p}.emphasis`, "emphasis")
    if (em) out.emphasis = em
  }
  const files = fileRefsOf(c, o.files, `${p}.files`)
  if (files) out.files = files
  if (o.summary !== undefined) {
    if (typeof o.summary !== "string") c.error(`${p}.summary`, `"summary" must be a string`)
    else if (o.summary.trim()) {
      out.summary = o.summary
      if (o.summary.length > 200) c.warn(`${p}.summary`, `"summary" is ${o.summary.length} characters`, "keep it to one line: what changed and why")
    }
  }
  if (what === "node") {
    const st = statOf(c, o.stat, `${p}.stat`)
    if (st) out.stat = st
    // `diff` (code nodes) is resolved and validated by the diff phases; carried as is here.
    const d = diffOf(c, o.diff, `${p}.diff`, kind)
    if (d !== undefined) out.diff = d
    if (d !== undefined && o.code !== undefined) c.warn(`${p}.code`, `"code" is ignored on a diff node: the base version comes from the hunks`, `drop "code", or drop "diff" to show plain code`)
  }
  return out
}

function changeMetaOf(c: Collector, v: unknown): ChangeMeta | undefined {
  if (v === undefined) return undefined
  if (!isObj(v)) {
    c.error("change", `"change" must be an object`, `"change": { "base": "main", "head": "feat/batch" }`)
    return undefined
  }
  unknownKeys(c, v, new Set(["base", "head", "title", "url"]), "change")
  const out: ChangeMeta = {}
  for (const k of ["base", "head", "title", "url"] as const) {
    if (v[k] === undefined) continue
    if (typeof v[k] !== "string") c.error(`change.${k}`, `"${k}" must be a string`)
    else if ((v[k] as string).trim()) out[k] = v[k] as string
  }
  return Object.keys(out).length ? out : undefined
}

/** Removed endpoints, hero budget, legend with nothing to show. */
function checkChangeConsistency(c: Collector, spec: Spec): void {
  const seq = spec.type === "sequence"
  const removed = new Set<string>()
  const ends: { path: string; from: string; to: string; delta?: string; emphasis?: string }[] = []
  let anyDelta = false
  if (seq) {
    const s = spec as SequenceSpec
    for (const p of s.participants) {
      if (p.delta) anyDelta = true
      if (p.delta === "removed") removed.add(p.id)
    }
    s.messages.forEach((m, i) => ends.push({ path: `messages[${i}]`, from: m.from, to: m.to, delta: m.delta, emphasis: m.emphasis }))
  } else {
    const g = spec as GraphSpec
    for (const n of g.nodes) {
      if (n.delta) anyDelta = true
      if (n.delta === "removed") removed.add(n.id)
    }
    for (const gr of g.groups ?? []) if (gr.delta) anyDelta = true
    ;(g.edges ?? []).forEach((e, i) => ends.push({ path: `edges[${i}]`, from: parseRef(e.from).node, to: parseRef(e.to).node, delta: e.delta, emphasis: e.emphasis }))
  }
  const what = seq ? "message" : "edge"
  const ofWhat = seq ? "participant" : "node"
  let heroes = 0
  for (const e of ends) {
    if (e.delta) anyDelta = true
    const gone = [e.from, e.to].filter((x) => removed.has(x))
    if (gone.length && e.delta !== "removed") {
      const list = gone.map((x) => `"${x}"`).join(" and ")
      if (e.delta === "added") c.error(`${e.path}.delta`, `an added ${what} cannot connect to removed ${ofWhat} ${list}`, `connect it to the ${ofWhat} that replaces ${list}, or mark the ${what} "removed"`)
      else c.warn(e.path, `${what} touches removed ${ofWhat} ${list} but is not removed`, `set "delta": "removed" on the ${what}`)
    }
    if (e.emphasis === "hero" && ++heroes === 3) c.warn(`${e.path}.emphasis`, `more than 2 hero ${what}s`, "keep hero emphasis for the one or two paths the change is about")
  }
  if (spec.style?.legend === true && !anyDelta) c.warn("style.legend", "the legend has nothing to show", `add "delta" to the elements the change touches`)
}

// ---------------------------------------------------------------------------
// Diff code nodes: `diff` = unified hunk text, or { file, lines?, context?, max? } resolved by
// --changes into { file, hunks }.

const DIFF_KEYS = new Set(["file", "lines", "context", "max", "hunks"])

function diffOf(c: Collector, v: unknown, p: string, kind?: string): GraphNode["diff"] | undefined {
  if (v === undefined) return undefined
  if (kind !== undefined && kind !== "code") {
    c.error(p, `"diff" is only drawn on "code" nodes`, `set "kind": "code"`)
    return undefined
  }
  if (typeof v === "string" || (Array.isArray(v) && v.every((x) => typeof x === "string"))) {
    const text = Array.isArray(v) ? v.join("\n") : v
    const hunks = parseHunks(text)
    if (!hunks.some((h) => h.lines.length)) {
      c.error(p, `"diff" has no diff lines`, `unified hunk text: "@@ -12,3 +12,4 @@\\n context\\n-old\\n+new"`)
      return undefined
    }
    return text
  }
  if (!isObj(v)) {
    c.error(p, `"diff" must be unified hunk text or { "file", "lines"?, "context"?, "max"? }`)
    return undefined
  }
  unknownKeys(c, v, DIFF_KEYS, p)
  const intIn = (k: string, lo: number, hi: number) => {
    const x = v[k]
    if (x === undefined) return true
    if (typeof x === "number" && Number.isInteger(x) && x >= lo && x <= hi) return true
    c.error(`${p}.${k}`, `"${k}" must be a whole number from ${lo} to ${hi}`)
    return false
  }
  let ok = intIn("context", 0, 20) && intIn("max", 4, 200)
  if (v.file !== undefined && (typeof v.file !== "string" || !v.file.trim())) {
    c.error(`${p}.file`, `"file" must be a non-empty path`)
    ok = false
  }
  if (v.lines !== undefined) {
    const L = v.lines
    const good = posInt(L) || (Array.isArray(L) && L.length === 2 && posInt(L[0]) && posInt(L[1]) && L[0] <= L[1])
    if (!good) {
      c.error(`${p}.lines`, `"lines" must be a line number ≥ 1 or [first, last]`, `"lines": [40, 62] (head side, 1-based, inclusive)`)
      ok = false
    }
  }
  if (v.hunks !== undefined) {
    const hs = v.hunks
    const good = Array.isArray(hs) && hs.every((h) => isObj(h) && Array.isArray(h.lines) && typeof h.oldStart === "number" && typeof h.newStart === "number" && (h.lines as unknown[]).every((l) => isObj(l) && (l.kind === "context" || l.kind === "add" || l.kind === "del") && typeof l.text === "string"))
    if (!good) {
      c.error(`${p}.hunks`, `"hunks" must be parsed hunks ({ header, oldStart, newStart, lines: [{ kind, text, old?, new? }] })`, "let --changes / resolveChanges write them")
      ok = false
    }
  } else if (ok) {
    c.error(
      p,
      typeof v.file === "string" ? `"diff": { "file": "${v.file}" } needs the diff: render with --changes changes.json (storyink_render "changes")` : `"diff" needs "file" (resolved with --changes) or unified hunk text`,
      typeof v.file === "string" ? `run "storyink diff -o changes.json" first, or inline the hunk text as "diff": "@@ … @@\\n-old\\n+new"` : undefined,
    )
    ok = false
  }
  return ok ? (v as unknown as GraphNode["diff"]) : undefined
}
