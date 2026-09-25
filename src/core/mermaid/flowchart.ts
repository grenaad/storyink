import type { GraphEdge, GraphGroup, GraphNode, GraphSpec, EdgeStyle, ArrowMode } from "../spec.ts"
import type { Diagnostic } from "../validate.ts"

interface Shape {
  open: string
  close: string
  kind: GraphNode["kind"]
  tag?: string
  terminal?: boolean
}

// Longest openers first.
const SHAPES: Shape[] = [
  { open: "(((", close: ")))", kind: "end", terminal: true },
  { open: "([", close: "])", kind: "step", terminal: true },
  { open: "[[", close: "]]", kind: "step", tag: "subroutine" },
  { open: "[(", close: ")]", kind: "io", tag: "store" },
  { open: "((", close: "))", kind: "step", terminal: true },
  { open: "{{", close: "}}", kind: "step", tag: "prepare" },
  { open: "[/", close: "/]", kind: "io" },
  { open: "[\\", close: "\\]", kind: "io" },
  { open: "[/", close: "\\]", kind: "step", tag: "manual" },
  { open: "[\\", close: "/]", kind: "step", tag: "manual" },
  { open: ">", close: "]", kind: "io", tag: "signal" },
  { open: "[", close: "]", kind: "step" },
  { open: "(", close: ")", kind: "step" },
  { open: "{", close: "}", kind: "decision" },
]

interface Ctx {
  nodes: Map<string, GraphNode & { terminal?: boolean }>
  order: string[]
  edges: GraphEdge[]
  groups: GraphGroup[]
  stack: string[]
  diagnostics: Diagnostic[]
  line: number
}

const warn = (ctx: Ctx, message: string, hint?: string) =>
  ctx.diagnostics.push({ severity: "warning", path: `line ${ctx.line}`, message, hint })

function unquote(s: string): string {
  const t = s.trim()
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1)
  return t
}

/** Clean mermaid label markup: <br>, markdown backticks, entity codes. */
export function cleanLabel(s: string): string {
  return unquote(s)
    .replace(/^`|`$/g, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/#quot;/g, '"')
    .replace(/#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim()
}

const ID = /^[A-Za-z0-9_][\w]*/

function parseNodeRef(ctx: Ctx, s: string, i: number): { id: string; next: number } | undefined {
  while (s[i] === " ") i++
  const m = ID.exec(s.slice(i))
  if (!m) return undefined
  const id = m[0]
  i += id.length
  let label: string | undefined
  let shape: Shape | undefined
  for (const sh of SHAPES) {
    if (!s.startsWith(sh.open, i)) continue
    const start = i + sh.open.length
    // Quoted text may contain closers.
    let end: number
    if (s[start] === '"') {
      const q = s.indexOf('"', start + 1)
      end = q < 0 ? -1 : s.indexOf(sh.close, q + 1)
    } else end = s.indexOf(sh.close, start)
    if (end < 0) continue
    // Guard: "[" must not match a "[/" shape closer mismatch.
    label = cleanLabel(s.slice(start, end))
    shape = sh
    i = end + sh.close.length
    break
  }
  if (s.startsWith(":::", i)) {
    const cm = /^:::[\w-]+/.exec(s.slice(i))
    if (cm) {
      warn(ctx, `class shorthand "${cm[0]}" is ignored`, "storyink styles nodes by kind")
      i += cm[0].length
    }
  }
  const existing = ctx.nodes.get(id)
  if (!existing) {
    ctx.nodes.set(id, {
      id,
      label: label ?? id,
      kind: shape?.kind ?? "step",
      ...(shape?.tag ? { tag: shape.tag } : {}),
      ...(shape?.terminal ? { terminal: true } : {}),
      ...(ctx.stack.length ? { parent: ctx.stack[ctx.stack.length - 1] } : {}),
    })
    ctx.order.push(id)
  } else if (shape) {
    existing.label = label ?? existing.label
    existing.kind = shape.kind
    if (shape.tag) existing.tag = shape.tag
    if (shape.terminal) existing.terminal = true
  }
  return { id, next: i }
}

interface EdgeOp {
  style: EdgeStyle
  arrow: ArrowMode
  label?: string
  next: number
}

const TEXT_EDGE = /^\s*(<)?(--|==|-\.)\s+([^\s\-=.][^|]*?)\s+(-{2,}|={2,}|\.+-)(>|x|o)?/
const EDGE = /^\s*(<)?(?:(-{2,})(>|x|o)?|(={2,})(>|x|o)?|(-\.+-)(>|x|o)?|(~~~))/

function parseEdge(s: string, i: number): EdgeOp | undefined {
  const rest = s.slice(i)
  const t = TEXT_EDGE.exec(rest)
  if (t) {
    const style: EdgeStyle = t[2] === "==" ? "thick" : t[2] === "-." ? "dashed" : "solid"
    const head = !!t[5]
    return {
      style,
      arrow: t[1] && head ? "both" : head ? "end" : "none",
      label: cleanLabel(t[3]),
      next: i + t[0].length,
    }
  }
  const m = EDGE.exec(rest)
  if (!m) return undefined
  let style: EdgeStyle = "solid"
  let head: string | undefined
  if (m[2]) head = m[3]
  else if (m[4]) {
    style = "thick"
    head = m[5]
  } else if (m[6]) {
    style = "dashed"
    head = m[7]
  } else if (m[8]) style = "dashed"
  let next = i + m[0].length
  let label: string | undefined
  const pipe = /^\s*\|([^|]*)\|/.exec(s.slice(next))
  if (pipe) {
    label = cleanLabel(pipe[1])
    next += pipe[0].length
  }
  const hasHead = !!head
  return { style, arrow: m[1] && hasHead ? "both" : hasHead ? "end" : "none", label, next }
}

function parseStatement(ctx: Ctx, s: string) {
  let i = 0
  let prev: string[] | undefined
  let pending: EdgeOp | undefined
  while (i < s.length) {
    const group: string[] = []
    for (;;) {
      const ref = parseNodeRef(ctx, s, i)
      if (!ref) break
      group.push(ref.id)
      i = ref.next
      const amp = /^\s*&\s*/.exec(s.slice(i))
      if (!amp) break
      i += amp[0].length
    }
    if (!group.length) {
      warn(ctx, `could not parse "${s.slice(i).trim()}"`, "check node ids and edge syntax")
      return
    }
    if (prev && pending)
      for (const a of prev)
        for (const b of group)
          ctx.edges.push({
            from: a,
            to: b,
            ...(pending.label ? { label: pending.label } : {}),
            style: pending.style,
            arrow: pending.arrow,
          })
    prev = group
    while (s[i] === " ") i++
    if (i >= s.length) return
    const op = parseEdge(s, i)
    if (!op) {
      warn(ctx, `unexpected "${s.slice(i).trim()}"`, "expected an edge like --> or ---")
      return
    }
    pending = op
    i = op.next
  }
}

export function parseFlowchart(src: string): { spec: GraphSpec; diagnostics: Diagnostic[] } {
  const ctx: Ctx = { nodes: new Map(), order: [], edges: [], groups: [], stack: [], diagnostics: [], line: 0 }
  let direction: "TB" | "BT" | "LR" | "RL" = "TB"
  let title: string | undefined
  const lines = src.split(/\r?\n/)
  let header = false
  let subgraphCount = 0
  for (let li = 0; li < lines.length; li++) {
    ctx.line = li + 1
    const raw = lines[li].replace(/%%.*$/, "").trim()
    if (!raw) continue
    if (!header && raw === "---") {
      // Front matter: pick up title.
      for (li++; li < lines.length && lines[li].trim() !== "---"; li++) {
        const tm = /^\s*title:\s*(.+)$/.exec(lines[li])
        if (tm) title = unquote(tm[1])
      }
      continue
    }
    for (const stmt0 of raw.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
      const stmt = stmt0.trim()
      if (!stmt) continue
      const hm = /^(flowchart|graph)\b\s*(\w+)?/i.exec(stmt)
      if (!header && hm) {
        header = true
        const d = (hm[2] ?? "TB").toUpperCase()
        direction = d === "LR" || d === "RL" || d === "BT" ? d : "TB"
        continue
      }
      if (/^(classDef|class|style|linkStyle|click)\b/.test(stmt)) {
        warn(ctx, `"${stmt.split(/\s/)[0]}" is ignored`, "storyink applies its own theme")
        continue
      }
      if (/^title\s/.test(stmt)) {
        title = stmt.slice(6).trim()
        continue
      }
      const dm = /^direction\s+(\w+)/.exec(stmt)
      if (dm) {
        const d = dm[1].toUpperCase()
        const g = ctx.groups.find((x) => x.id === ctx.stack[ctx.stack.length - 1])
        const nd = d === "TD" ? "TB" : d
        if (g && (nd === "TB" || nd === "BT" || nd === "LR" || nd === "RL")) g.direction = nd
        else warn(ctx, `direction "${dm[1]}" ignored here`, "use it inside a subgraph, or in the header")
        continue
      }
      const sg = /^subgraph\b\s*(.*)$/.exec(stmt)
      if (sg) {
        const body = sg[1].trim()
        let id: string
        let label: string
        const bm = /^([\w-]+)\s*\[(.*)\]$/.exec(body)
        if (bm) {
          id = bm[1]
          label = cleanLabel(bm[2])
        } else if (/^"/.test(body) || /\s/.test(body)) {
          label = cleanLabel(body)
          id = `subgraph_${++subgraphCount}`
        } else {
          id = body || `subgraph_${++subgraphCount}`
          label = body || id
        }
        ctx.groups.push({ id, label, ...(ctx.stack.length ? { parent: ctx.stack[ctx.stack.length - 1] } : {}) })
        ctx.stack.push(id)
        continue
      }
      if (stmt === "end") {
        if (!ctx.stack.pop()) warn(ctx, `"end" without "subgraph"`)
        continue
      }
      if (!header) {
        header = true
        warn(ctx, "missing \"flowchart\" header; assuming flowchart TB")
      }
      parseStatement(ctx, stmt)
    }
  }
  if (ctx.stack.length) warn(ctx, `${ctx.stack.length} subgraph(s) not closed with "end"`)

  // Terminal shapes become start/end by connectivity.
  const incoming = new Set(ctx.edges.map((e) => e.to))
  const outgoing = new Set(ctx.edges.map((e) => e.from))
  const groupIds = new Set(ctx.groups.map((g) => g.id))
  const nodes: GraphNode[] = []
  for (const id of ctx.order) {
    if (groupIds.has(id)) continue // edge endpoint naming a subgraph
    const { terminal, ...n } = ctx.nodes.get(id)!
    if (terminal) {
      if (!incoming.has(id)) n.kind = "start"
      else if (!outgoing.has(id)) n.kind = "end"
    }
    nodes.push(n)
  }
  return {
    spec: {
      type: "workflow",
      title: title ?? "Flowchart",
      direction,
      nodes,
      edges: ctx.edges,
      groups: ctx.groups,
    },
    diagnostics: ctx.diagnostics,
  }
}
