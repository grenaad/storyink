import {
  ARROWS,
  DIAGRAM_TYPES,
  EDGE_STYLES,
  FRAME_KINDS,
  GRAPH_NODE_KINDS,
  MESSAGE_KINDS,
  PARTICIPANT_KINDS,
  type GraphSpec,
  type MessageRef,
  type SequenceSpec,
  type Spec,
} from "./spec.ts"

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

const COMMON_KEYS = new Set(["$schema", "type", "title", "subtitle", "direction", "story", "style"])

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
  const type = oneOf(c, value.type, DIAGRAM_TYPES, "type", "diagram type")
  if (value.type === undefined) c.error("type", `missing required field "type"`, `use one of: ${DIAGRAM_TYPES.join(", ")}`)
  const title = str(c, value, "title", "", true)
  const subtitle = str(c, value, "subtitle", "", false)
  if (value.$schema !== undefined && typeof value.$schema !== "string") c.error("$schema", `"$schema" must be a string`)
  if (value.story !== undefined)
    c.warn("story", "\"story\" is reserved for Phase 2 storyboards and is ignored", "remove it or keep it for later")
  if (!type) return { ok: false, diagnostics: c.diagnostics }

  let style: { arrowheads?: boolean } | undefined
  if (value.style !== undefined) {
    if (!isObj(value.style)) c.error("style", `"style" must be an object`, `e.g. "style": { "arrowheads": true }`)
    else {
      unknownKeys(c, value.style, new Set(["arrowheads"]), "style")
      if (value.style.arrowheads !== undefined && typeof value.style.arrowheads !== "boolean")
        c.error("style.arrowheads", `"arrowheads" must be true or false`)
      else if (typeof value.style.arrowheads === "boolean") style = { arrowheads: value.style.arrowheads }
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
  const ok = !c.failed
  return ok ? { ok, diagnostics: c.diagnostics, spec } : { ok, diagnostics: c.diagnostics }
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
    unknownKeys(c, g, new Set(["id", "label", "kind", "parent", "direction"]), p)
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
    })
  })

  const nodes: GraphSpec["nodes"] = []
  const rawNodes = arr(c, o, "nodes", true)
  if (Array.isArray(o.nodes) && rawNodes.length === 0) c.error("nodes", "diagram has no nodes", "add at least one node")
  rawNodes.forEach((n, i) => {
    const p = `nodes[${i}]`
    if (!isObj(n)) return c.error(p, "node must be an object", `{ "id": "api", "label": "API" }`)
    unknownKeys(c, n, new Set(["id", "label", "kind", "detail", "tag", "parent", "group", "direction"]), p)
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
    })
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
    unknownKeys(c, e, new Set(["id", "from", "to", "label", "style", "arrow"]), p)
    const from = str(c, e, "from", p, true)
    const to = str(c, e, "to", p, true)
    if (from && !known.has(from)) c.error(`${p}.from`, `unknown node "${from}"`, hintId(from, [...known]))
    if (to && !known.has(to)) c.error(`${p}.to`, `unknown node "${to}"`, hintId(to, [...known]))
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
    unknownKeys(c, p0, new Set(["id", "label", "kind"]), p)
    const id = str(c, p0, "id", p, true)
    if (!id) return
    if (ids.has(id)) c.error(`${p}.id`, `duplicate participant "${id}"`)
    ids.add(id)
    const kind = oneOf(c, p0.kind, PARTICIPANT_KINDS, `${p}.kind`, "participant kind")
    participants.push({ id, label: str(c, p0, "label", p, false) ?? id, kind: kind ?? "participant" })
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
    unknownKeys(c, m, new Set(["id", "from", "to", "label", "kind"]), p)
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
