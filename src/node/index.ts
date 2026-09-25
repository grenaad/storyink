/**
 * storyink/node: Node-only helpers (file I/O, headless-Chrome snapshots).
 */
import fs from "node:fs"
import path from "node:path"
import { detectMermaid, fromMermaid } from "../core/mermaid/index.ts"
import { renderHtml, renderSvg, type HtmlOptions } from "../core/render/index.tsx"
import type { Spec } from "../core/spec.ts"
import { validate, type Diagnostic } from "../core/validate.ts"
import type { ThemeName } from "../theme/tokens.ts"

export { findBrowser, browserVersion, type Browser } from "./chrome.ts"
export { snapshot, type SnapshotOptions, type SnapshotReceipt, type SnapshotResult, type Capture, type Gate } from "./snapshot.ts"

export interface LoadResult {
  ok: boolean
  spec?: Spec
  diagnostics: Diagnostic[]
  source: "json" | "mermaid"
}

/** Parse spec text: JSON, or Mermaid when it doesn't look like JSON. */
export function parseSource(text: string, hint?: string): LoadResult {
  const trimmed = text.trimStart()
  const isMermaid = hint ? /\.(mmd|mermaid)$/i.test(hint) : !trimmed.startsWith("{") && !!detectMermaid(text)
  if (isMermaid) {
    const r = fromMermaid(text)
    return { ok: r.ok, spec: r.spec, diagnostics: r.diagnostics, source: "mermaid" }
  }
  const v = validate(text)
  return { ok: v.ok, spec: v.spec, diagnostics: v.diagnostics, source: "json" }
}

/** Read a spec file (`.json`, `.mmd`, `.mermaid`). */
export function loadSpec(file: string): LoadResult {
  return parseSource(fs.readFileSync(file, "utf8"), file)
}

export interface WriteResult {
  ok: boolean
  diagnostics: Diagnostic[]
  html?: { path: string; bytes: number }
  svg?: { path: string; bytes: number }
}

/** Render a spec to HTML and/or SVG files. Invalid specs write nothing. */
export function writeDiagram(
  input: Spec | unknown,
  out: { html?: string; svg?: string; theme?: ThemeName; htmlOptions?: HtmlOptions },
): WriteResult {
  const v = validate(input)
  if (!v.ok || !v.spec) return { ok: false, diagnostics: v.diagnostics }
  const res: WriteResult = { ok: true, diagnostics: v.diagnostics }
  if (out.html) {
    const html = renderHtml(v.spec, { ...out.htmlOptions, ...(out.theme ? { theme: out.theme } : {}) })
    fs.mkdirSync(path.dirname(out.html), { recursive: true })
    fs.writeFileSync(out.html, html)
    res.html = { path: path.resolve(out.html), bytes: Buffer.byteLength(html) }
  }
  if (out.svg) {
    const svg = renderSvg(v.spec, out.theme ? { theme: out.theme } : {})
    fs.mkdirSync(path.dirname(out.svg), { recursive: true })
    fs.writeFileSync(out.svg, svg)
    res.svg = { path: path.resolve(out.svg), bytes: Buffer.byteLength(svg) }
  }
  return res
}
