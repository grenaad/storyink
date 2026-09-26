/**
 * storyink/node: Node-only helpers (file I/O, headless-Chrome snapshots).
 */
import fs from "node:fs"
import path from "node:path"
import { detectMermaid, fromMermaid } from "../core/mermaid/index.ts"
import { renderHtml, renderSvg, type HtmlOptions } from "../core/render/index.tsx"
import { animatedSvg, type AnimatedSvgOptions } from "../core/render/smil.tsx"
import type { Spec } from "../core/spec.ts"
import { validate, type Diagnostic } from "../core/validate.ts"
import type { ThemeName } from "../theme/tokens.ts"

export { findBrowser, browserVersion, type Browser } from "./chrome.ts"
export { snapshot, screenshotPage, type SnapshotOptions, type SnapshotReceipt, type SnapshotResult, type Capture, type Gate } from "./snapshot.ts"

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

/**
 * Set the story's playback motion (`story.motion`). `"story": "auto"` becomes
 * `{ "steps": "auto", "motion": m }`. Returns false when the spec has no story.
 */
export function setStoryMotion(spec: Spec, motion: "full" | "reduced" | "system"): boolean {
  if (spec.story === undefined) return false
  spec.story = spec.story === "auto" ? { steps: "auto", motion } : { ...spec.story, motion }
  return true
}

export interface AnimatedWriteResult {
  ok: boolean
  diagnostics: Diagnostic[]
  files: { path: string; theme: ThemeName; bytes: number }[]
  /** The spec had no story; the auto story was used. */
  autoStory: boolean
  /** README snippet (`<picture>` for both themes, `<img>` for one). */
  snippet?: string
}

/** `<picture>` that serves the dark file under a dark `prefers-color-scheme`, light otherwise. */
export function pictureSnippet(light: string, dark: string, alt: string): string {
  const a = alt.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")
  return `<picture>\n  <source media="(prefers-color-scheme: dark)" srcset="${dark}">\n  <img alt="${a}" src="${light}">\n</picture>`
}

/**
 * Write SMIL-animated SVG(s). `theme: "both"` writes `<out>.light.svg` and `<out>.dark.svg`
 * (from `out` minus its .svg extension) and returns the `<picture>` snippet.
 */
export function writeAnimatedSvg(
  input: Spec | unknown,
  out: string,
  opts: Omit<AnimatedSvgOptions, "theme"> & { theme?: ThemeName | "both"; snippetBase?: string } = {},
): AnimatedWriteResult {
  const v = validate(input)
  if (!v.ok || !v.spec) return { ok: false, diagnostics: v.diagnostics, files: [], autoStory: false }
  const themes: ThemeName[] = opts.theme === "both" ? ["light", "dark"] : [opts.theme ?? "light"]
  const stem = out.replace(/\.svg$/i, "")
  const files: AnimatedWriteResult["files"] = []
  let autoStory = false
  for (const theme of themes) {
    const file = opts.theme === "both" ? `${stem}.${theme}.svg` : out
    const r = animatedSvg(v.spec, { ...opts, theme })
    autoStory = r.autoStory
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
    fs.writeFileSync(file, r.svg)
    files.push({ path: path.resolve(file), theme, bytes: r.bytes })
  }
  const rel = (f: string) => (opts.snippetBase ? path.relative(opts.snippetBase, f) : path.basename(f))
  const snippet =
    files.length === 2 ? pictureSnippet(rel(files[0].path), rel(files[1].path), v.spec.title) : `<img alt="${v.spec.title.replace(/"/g, "&quot;")}" src="${rel(files[0].path)}">`
  return { ok: true, diagnostics: v.diagnostics, files, autoStory, snippet }
}
