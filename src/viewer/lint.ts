import type { Box, Scene } from "../core/scene.ts"

export interface LintIssue {
  kind: "text-overflow" | "label-overflow" | "label-node" | "label-label" | "node-node"
  ids: string[]
  detail: string
}

export interface LintReport {
  ok: boolean
  issues: LintIssue[]
  checked: { nodes: number; labels: number; texts: number }
}

const TOL = 1

function inter(a: Box, b: Box, pad = 0): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) - pad
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) - pad
  return w > 0 && h > 0 ? w * h : 0
}

const parseBox = (s: string | null): Box | undefined => {
  if (!s) return undefined
  const [x, y, w, h] = s.split(",").map(Number)
  return { x, y, w, h }
}

/** Measure real glyph boxes with getBBox and report overflow / overlap. */
export function lintDom(doc: Document, scene: Scene, sheet: boolean): LintReport {
  const root = doc.querySelector<SVGSVGElement>(sheet ? ".si-sheet svg.storyink" : ".si-stage svg.storyink") ?? doc.querySelector("svg.storyink")
  const issues: LintIssue[] = []
  let texts = 0
  if (!root) return { ok: false, issues: [{ kind: "text-overflow", ids: [], detail: "no diagram found" }], checked: { nodes: 0, labels: 0, texts: 0 } }
  const nodeEls = [...root.querySelectorAll<SVGGElement>("g.si-node")]
  const nodeBoxes: { id: string; box: Box }[] = []
  for (const g of nodeEls) {
    const id = g.dataset.si!.slice(5)
    const box = parseBox(g.getAttribute("data-box"))!
    nodeBoxes.push({ id, box })
    const node = scene.nodes.find((n) => n.id === id)
    for (const t of g.querySelectorAll<SVGTextElement>("text")) {
      texts++
      const b = t.getBBox()
      if (!b.width) continue
      let limitL = 2
      let limitR = box.w - 2
      if (node?.shape === "diamond") {
        // Inscribed width at the text's vertical position.
        const cy = b.y + b.height / 2
        const frac = 1 - Math.abs(cy - box.h / 2) / (box.h / 2)
        const half = (box.w / 2) * frac
        limitL = box.w / 2 - half + 4
        limitR = box.w / 2 + half - 4
      }
      if (b.x < limitL - TOL || b.x + b.width > limitR + TOL || b.y < -TOL || b.y + b.height > box.h + TOL)
        issues.push({ kind: "text-overflow", ids: [id], detail: `"${t.textContent}" (${b.width.toFixed(1)}px) exceeds its box` })
    }
  }
  const labelEls = [...root.querySelectorAll<SVGGElement>("g.si-lbl")]
  const labelBoxes: { id: string; box: Box }[] = []
  for (const g of labelEls) {
    const id = g.dataset.si!.slice(6)
    const box = parseBox(g.getAttribute("data-box"))!
    labelBoxes.push({ id, box })
    const t = g.querySelector("text")
    if (t) {
      texts++
      const b = t.getBBox()
      if (b.x < box.x - TOL || b.x + b.width > box.x + box.w + TOL)
        issues.push({ kind: "label-overflow", ids: [id], detail: `label "${t.textContent}" overflows its pill` })
    }
  }
  for (const l of labelBoxes)
    for (const n of nodeBoxes)
      if (inter(l.box, n.box, 1) > 0) issues.push({ kind: "label-node", ids: [l.id, n.id], detail: "edge label overlaps a node" })
  for (let i = 0; i < labelBoxes.length; i++)
    for (let j = i + 1; j < labelBoxes.length; j++)
      if (inter(labelBoxes[i].box, labelBoxes[j].box, 1) > 0)
        issues.push({ kind: "label-label", ids: [labelBoxes[i].id, labelBoxes[j].id], detail: "edge labels overlap" })
  for (let i = 0; i < nodeBoxes.length; i++)
    for (let j = i + 1; j < nodeBoxes.length; j++)
      if (inter(nodeBoxes[i].box, nodeBoxes[j].box) > 0)
        issues.push({ kind: "node-node", ids: [nodeBoxes[i].id, nodeBoxes[j].id], detail: "nodes overlap" })
  return { ok: issues.length === 0, issues, checked: { nodes: nodeBoxes.length, labels: labelBoxes.length, texts } }
}
