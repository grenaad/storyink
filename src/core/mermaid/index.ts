import type { Spec } from "../spec.ts"
import { validate, type Diagnostic } from "../validate.ts"
import { parseFlowchart } from "./flowchart.ts"
import { parseSequence } from "./sequence.ts"
import { parseState } from "./state.ts"

export interface MermaidResult {
  ok: boolean
  spec?: Spec
  diagnostics: Diagnostic[]
}

export type MermaidFamily = "flowchart" | "sequence" | "state"

export function detectMermaid(src: string): MermaidFamily | undefined {
  const body = src.replace(/^\s*---[\s\S]*?\n---\s*\n/, "")
  for (const raw of body.split(/\r?\n/)) {
    const s = raw.replace(/%%.*$/, "").trim()
    if (!s) continue
    if (/^(flowchart|graph)\b/i.test(s)) return "flowchart"
    if (/^sequenceDiagram\b/.test(s)) return "sequence"
    if (/^stateDiagram(-v2)?\b/.test(s)) return "state"
    return undefined
  }
  return undefined
}

/** Convert Mermaid flowchart / sequenceDiagram / stateDiagram text into a storyink spec. Never throws. */
export function fromMermaid(src: string, opts: { title?: string; subtitle?: string } = {}): MermaidResult {
  const family = detectMermaid(src)
  if (!family)
    return {
      ok: false,
      diagnostics: [
        {
          severity: "error",
          path: "line 1",
          message: "unsupported or missing Mermaid diagram header",
          hint: "start with flowchart TD, graph LR, sequenceDiagram or stateDiagram-v2",
        },
      ],
    }
  let parsed: { spec: Spec; diagnostics: Diagnostic[] }
  try {
    parsed =
      family === "flowchart" ? parseFlowchart(src) : family === "sequence" ? parseSequence(src) : parseState(src)
  } catch (e) {
    return {
      ok: false,
      diagnostics: [{ severity: "error", path: "", message: `Mermaid parser failed: ${(e as Error).message}` }],
    }
  }
  if (opts.title) parsed.spec.title = opts.title
  if (opts.subtitle) parsed.spec.subtitle = opts.subtitle
  const checked = validate(parsed.spec)
  return {
    ok: checked.ok,
    spec: checked.spec ?? parsed.spec,
    diagnostics: [...parsed.diagnostics, ...checked.diagnostics],
  }
}

export { parseFlowchart, parseSequence, parseState }
