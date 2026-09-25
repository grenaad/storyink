import type { GraphEdge, GraphNode, GraphSpec } from "../spec.ts"
import type { Diagnostic } from "../validate.ts"
import { cleanLabel } from "./flowchart.ts"

export function parseState(src: string): { spec: GraphSpec; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []
  const nodes = new Map<string, GraphNode>()
  const edges: GraphEdge[] = []
  const stack: string[] = []
  let direction: "TB" | "BT" | "LR" | "RL" = "TB"
  let title: string | undefined
  let line = 0
  let note: { target: string; lines: string[] } | undefined
  let noteCount = 0
  const addNote = (target: string, text: string) => {
    const id = `note_${++noteCount}`
    const t = ensure(target)
    nodes.set(id, { id, label: text, kind: "note", ...(nodes.get(t)?.parent ? { parent: nodes.get(t)!.parent } : {}) })
    edges.push({ from: id, to: t, style: "dashed", arrow: "none" })
  }
  const warn = (message: string, hint?: string) =>
    diagnostics.push({ severity: "warning", path: `line ${line}`, message, hint })
  const scope = () => stack[stack.length - 1]

  const ensure = (id: string, label?: string): string => {
    let n = nodes.get(id)
    if (!n) {
      n = { id, label: label ?? id, kind: "state", ...(scope() ? { parent: scope() } : {}) }
      nodes.set(id, n)
    } else if (label) n.label = label
    return id
  }
  const pseudo = (role: "start" | "end"): string => {
    const sc = scope()
    const id = `${sc ?? "root"}__${role}`
    if (!nodes.has(id))
      nodes.set(id, { id, label: role === "start" ? "start" : "end", kind: role === "start" ? "initial" : "final", ...(sc ? { parent: sc } : {}) })
    return id
  }
  const ref = (token: string, role: "start" | "end") => (token === "[*]" ? pseudo(role) : ensure(token))

  let header = false
  for (const raw of src.split(/\r?\n/)) {
    line++
    const s = raw.replace(/%%.*$/, "").trim()
    if (!s) continue
    if (note) {
      if (/^end\s+note$/i.test(s)) {
        addNote(note.target, note.lines.join(" "))
        note = undefined
      } else note.lines.push(cleanLabel(s))
      continue
    }
    if (!header && /^stateDiagram(-v2)?\b/.test(s)) {
      header = true
      continue
    }
    let m: RegExpExecArray | null
    if ((m = /^direction\s+(TB|TD|BT|LR|RL)$/i.exec(s))) {
      {
        const d = m[1].toUpperCase()
        const nd = (d === "TD" ? "TB" : d) as "TB" | "BT" | "LR" | "RL"
        if (!stack.length) direction = nd
        else nodes.get(stack[stack.length - 1])!.direction = nd
      }
      continue
    }
    if ((m = /^title\s*:?\s*(.+)$/.exec(s))) {
      title = m[1]
      continue
    }
    if ((m = /^state\s+"([^"]*)"\s+as\s+([\w.-]+)\s*(\{)?$/.exec(s))) {
      ensure(m[2], cleanLabel(m[1]))
      if (m[3]) {
        nodes.get(m[2])!.kind = "composite"
        stack.push(m[2])
      }
      continue
    }
    if ((m = /^state\s+([\w.-]+)\s*(<<\w+>>)?\s*(\{)?$/.exec(s))) {
      ensure(m[1])
      const pseudoKind = m[2]?.slice(2, -2).toLowerCase()
      if (pseudoKind === "fork" || pseudoKind === "join" || pseudoKind === "choice") nodes.get(m[1])!.kind = pseudoKind
      else if (m[2]) warn(`${m[2]} pseudo-state "${m[1]}" is drawn as a plain state`)
      if (m[3]) {
        nodes.get(m[1])!.kind = "composite"
        stack.push(m[1])
      }
      continue
    }
    if (s === "}") {
      if (!stack.pop()) warn("unbalanced \"}\"")
      continue
    }
    if (s === "--") {
      warn("concurrent regions (--) are drawn as one region")
      continue
    }
    if ((m = /^note\s+(?:left|right)\s+of\s+([\w.-]+)\s*(?::\s*(.*))?$/i.exec(s))) {
      if (m[2] !== undefined) addNote(m[1], cleanLabel(m[2]))
      else note = { target: m[1], lines: [] }
      continue
    }
    if (/^note\s/i.test(s)) {
      warn("unsupported note form is ignored", "use: note right of State : text")
      continue
    }
    if (/^(classDef|class|style)\b/.test(s)) {
      warn(`"${s.split(/\s/)[0]}" is ignored`)
      continue
    }
    if ((m = /^(\[\*\]|[\w.-]+)\s*-->\s*(\[\*\]|[\w.-]+)\s*(?::(.*))?$/.exec(s))) {
      const from = ref(m[1], "start")
      const to = ref(m[2], "end")
      edges.push({ from, to, ...(m[3]?.trim() ? { label: cleanLabel(m[3]) } : {}) })
      continue
    }
    if ((m = /^([\w.-]+)\s*:\s*(.+)$/.exec(s))) {
      const id = ensure(m[1])
      const n = nodes.get(id)!
      if (n.label === id) n.label = cleanLabel(m[2])
      else n.detail = cleanLabel(m[2])
      continue
    }
    if ((m = /^([\w.-]+)$/.exec(s))) {
      ensure(m[1])
      continue
    }
    if (!header) {
      header = true
      warn("missing \"stateDiagram-v2\" header")
    }
    warn(`unrecognised line "${s}"`, "see docs/spec.md for supported Mermaid syntax")
  }
  if (stack.length) warn(`${stack.length} composite state(s) not closed with "}"`)
  if (note) warn("note not closed with \"end note\"")
  return {
    spec: { type: "lifecycle", title: title ?? "State machine", direction, nodes: [...nodes.values()], edges, groups: [] },
    diagnostics,
  }
}
