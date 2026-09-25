import type { Activation, Band, Frame, FrameKind, Message, MessageKind, Note, Participant, ParticipantBox, SequenceSpec } from "../spec.ts"
import type { Diagnostic } from "../validate.ts"
import { cleanLabel } from "./flowchart.ts"

const ARROWS: [string, MessageKind][] = [
  ["-->>", "return"],
  ["->>", "sync"],
  ["--x", "return"],
  ["-x", "sync"],
  ["--)", "async"],
  ["-)", "async"],
  ["-->", "return"],
  ["->", "sync"],
]
const ARROW_RE = new RegExp(
  `^(.+?)\\s*(${ARROWS.map(([a]) => a.replace(/[-)>]/g, (c) => `\\${c}`)).join("|")})\\s*([+-]?)\\s*(.+?)\\s*:(.*)$`,
)

const COLOR_WORD = /^(rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-f]{3,8}|transparent|aqua|black|blue|fuchsia|gray|grey|green|lime|maroon|navy|olive|orange|purple|red|silver|teal|white|yellow|lightblue|lightgreen|lightgrey|lightyellow|pink|beige|ivory|lavender|wheat|khaki)(?=\s|$)\s*/i

function stripColor(s: string): string {
  return cleanLabel(s.trim().replace(COLOR_WORD, ""))
}

interface OpenFrame {
  kind: FrameKind | "rect" | "box"
  label?: string
  start: number
  sections: { label?: string; start: number }[]
}

export function parseSequence(src: string): { spec: SequenceSpec; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []
  const participants: Participant[] = []
  const byId = new Map<string, Participant>()
  const messages: Message[] = []
  const notes: Note[] = []
  const frames: Frame[] = []
  const activations: Activation[] = []
  const open = new Map<string, number[]>()
  const stack: OpenFrame[] = []
  const bands: Band[] = []
  const boxes: ParticipantBox[] = []
  let openBox: ParticipantBox | undefined
  // messages.length when the last block closed: a note right after `end` belongs outside it.
  let endedAt = -1
  let autonumber = false
  let title: string | undefined
  let line = 0
  const warn = (message: string, hint?: string) =>
    diagnostics.push({ severity: "warning", path: `line ${line}`, message, hint })

  const ensure = (id: string, label?: string, kind: Participant["kind"] = "participant") => {
    const key = id.trim()
    let p = byId.get(key)
    if (!p) {
      p = { id: key, label: label ?? key, kind }
      byId.set(key, p)
      participants.push(p)
    } else if (label) p.label = label
    if (openBox && !openBox.participants.includes(key) && !boxes.some((b) => b.participants.includes(key))) openBox.participants.push(key)
    return key
  }
  const activate = (id: string, start: number) => {
    const list = open.get(id) ?? []
    list.push(start)
    open.set(id, list)
  }
  const deactivate = (id: string, end: number) => {
    const list = open.get(id)
    const start = list?.pop()
    if (start === undefined) return warn(`deactivate "${id}" without a matching activate`)
    if (end >= start && end >= 0) activations.push({ participant: id, start, end })
  }

  let header = false
  for (const rawLine of src.split(/\r?\n/)) {
    line++
    const s = rawLine.replace(/%%.*$/, "").trim()
    if (!s) continue
    if (!header && /^sequenceDiagram\b/.test(s)) {
      header = true
      continue
    }
    let m: RegExpExecArray | null
    if ((m = /^(participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/.exec(s))) {
      let id = m[2]
      let kind: Participant["kind"] = m[1] === "actor" ? "actor" : "participant"
      const meta = /^(.+?)@\{(.*)\}$/.exec(id)
      if (meta) {
        id = meta[1]
        const t = /type\s*:\s*"?(\w+)"?/.exec(meta[2])?.[1]
        if (t === "database" || t === "queue") kind = t
        else if (t === "actor") kind = "actor"
      }
      ensure(id, m[3] ? cleanLabel(m[3]) : undefined, kind)
      continue
    }
    if ((m = /^create\s+(participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/.exec(s))) {
      ensure(m[2], m[3] ? cleanLabel(m[3]) : undefined, m[1] === "actor" ? "actor" : "participant")
      warn("\"create\" is drawn as a regular participant")
      continue
    }
    if (/^destroy\s/.test(s)) {
      warn("\"destroy\" is ignored")
      continue
    }
    if (/^autonumber\b/.test(s)) {
      autonumber = true
      continue
    }
    if ((m = /^title\s*:?\s*(.+)$/.exec(s))) {
      title = m[1].trim()
      continue
    }
    if ((m = /^(activate|deactivate)\s+(.+)$/.exec(s))) {
      const id = ensure(m[2])
      if (m[1] === "activate") activate(id, messages.length)
      else deactivate(id, messages.length - 1)
      continue
    }
    if ((m = /^note\s+(left of|right of|over)\s+([^:]+):(.*)$/i.exec(s))) {
      const where = m[1].toLowerCase()
      const ids = m[2].split(",").map((x) => ensure(x))
      const note: Note = { text: cleanLabel(m[3]) }
      if (where === "over") note.over = ids.slice(0, 2)
      else if (where === "left of") note.left = ids[0]
      else note.right = ids[0]
      if (messages.length) note.after = messages.length - 1
      if (endedAt === messages.length && messages.length) note.outside = true
      notes.push(note)
      continue
    }
    if ((m = /^box\b\s*(.*)$/.exec(s))) {
      const label = stripColor(m[1])
      openBox = { participants: [], ...(label ? { label } : {}) }
      stack.push({ kind: "box", start: messages.length, sections: [] })
      continue
    }
    if ((m = /^rect\b\s*(.*)$/.exec(s))) {
      if (m[1].trim()) warn("rect colour is ignored; storyink uses a theme band")
      stack.push({ kind: "rect", start: messages.length, sections: [] })
      continue
    }
    if ((m = /^(loop|alt|opt|par|critical|break)\b\s*(.*)$/.exec(s))) {
      const kind = m[1] as OpenFrame["kind"]
      stack.push({ kind, label: m[2] ? cleanLabel(m[2]) : undefined, start: messages.length, sections: [] })
      continue
    }
    if ((m = /^(else|and|option)\b\s*(.*)$/.exec(s))) {
      const top = stack[stack.length - 1]
      if (!top) warn(`"${m[1]}" outside of a block`)
      else top.sections.push({ label: m[2] ? cleanLabel(m[2]) : undefined, start: messages.length })
      continue
    }
    if (s === "end") {
      const top = stack.pop()
      if (!top) {
        warn("\"end\" without an open block")
        continue
      }
      if (top.kind === "box") {
        if (openBox?.participants.length) boxes.push(openBox)
        openBox = undefined
        continue
      }
      if (top.kind === "rect") {
        if (messages.length - 1 >= top.start) bands.push({ start: top.start, end: messages.length - 1 })
        continue
      }
      endedAt = messages.length
      const end = messages.length - 1
      if (end < top.start) {
        warn(`empty "${top.kind}" block is dropped`)
        continue
      }
      frames.push({
        kind: top.kind,
        ...(top.label ? { label: top.label } : {}),
        start: top.start,
        end,
        sections: top.sections.filter((x) => x.start > top.start && x.start <= end),
      })
      continue
    }
    if ((m = ARROW_RE.exec(s))) {
      const from = ensure(m[1])
      const op = m[2]
      const mod = m[3]
      const to = ensure(m[4])
      let kind = ARROWS.find(([a]) => a === op)![1]
      if (from === to) kind = "self"
      const index = messages.length
      messages.push({ from, to, label: cleanLabel(m[5]), kind })
      if (mod === "+") activate(to, index)
      if (mod === "-") deactivate(from, index)
      continue
    }
    if (!header) {
      header = true
      warn("missing \"sequenceDiagram\" header")
      continue
    }
    warn(`unrecognised line "${s}"`, "see docs/spec.md for supported Mermaid syntax")
  }
  if (stack.length) warn(`${stack.length} block(s) not closed with "end"`)
  for (const [id, starts] of open)
    for (const start of starts) if (messages.length - 1 >= start) activations.push({ participant: id, start, end: messages.length - 1 })

  return {
    spec: {
      type: "sequence",
      title: title ?? "Sequence",
      participants,
      messages,
      activations,
      notes,
      frames,
      bands,
      boxes,
      autonumber,
    },
    diagnostics,
  }
}
