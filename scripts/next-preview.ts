/**
 * Preview the 0.4 examples (code-mode, retry-helper, agent-session, failover): static SVG (light + dark, with and
 * without the story), standalone HTML, and PNG snapshots with the lint gate. Writes outside the
 * repo (never docs/gallery). Usage: bun scripts/next-preview.ts [outDir] [--no-png]
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { loadSpec, snapshot } from "../src/node/index.ts"
import { renderHtml, renderSvg } from "../src/core/render/index.tsx"
import { animatedSvg } from "../src/core/index.ts"
import { formatDiagnostic } from "../src/core/validate.ts"
import type { Spec } from "../src/core/spec.ts"

const root = path.join(import.meta.dir, "..")
const args = process.argv.slice(2)
const png = !args.includes("--no-png")
const tmp = process.env.TMPDIR ?? os.tmpdir()
const out = path.resolve(args.find((a) => !a.startsWith("--")) ?? path.join(tmp, "opencode", "storyink-next"))
fs.mkdirSync(out, { recursive: true })
const dir = path.join(root, "examples")
let failed = false
const names: string[] = []

// The 0.4 examples only (not the pre-0.4 ones or their compat baselines).
const NEXT = ["agent-session.architecture.json", "code-mode.architecture.json", "failover.dataflow.json", "retry-helper.architecture.json"]
for (const f of NEXT) {
  const name = f.replace(/\.json$/, "")
  names.push(name)
  const l = loadSpec(path.join(dir, f))
  for (const d of l.diagnostics) console.log(`  ${name}: ${formatDiagnostic(d)}`)
  if (!l.spec) {
    failed = true
    continue
  }
  const still: Spec = { ...l.spec }
  delete still.story
  const files: string[] = []
  const write = (file: string, text: string) => {
    fs.writeFileSync(path.join(out, file), text)
    files.push(file)
  }
  for (const theme of ["light", "dark"] as const) {
    write(`${name}.${theme}.svg`, renderSvg(l.spec, { theme }))
    write(`${name}.still.${theme}.svg`, renderSvg(still, { theme }))
    write(`${name}.animated.${theme}.svg`, animatedSvg(l.spec, { theme, font: "embed" }).svg)
  }
  write(`${name}.html`, renderHtml(l.spec))
  write(`${name}.still.html`, renderHtml(still))
  console.log(`${name}: ${files.join(", ")}`)
  if (!png) continue
  // Mid-story captures for inspection (typing, line bars, swapped content).
  const MID: Record<string, number[]> = {
    "code-mode.architecture": [0, 1.0, 2.3, 3.0, 3.6, 5.4, 6.2, 7.5, 9.2, 10.9, 13.6, 14.4],
    "retry-helper.architecture": [0.9, 4.3, 9.0, 16.0, 18.0],
    "agent-session.architecture": [1.0, 3.6, 6.2, 11.0, 13.6, 21.0],
    "failover.dataflow": [5.0, 9.0, 11.2, 13.8, 16.6],
  }
  for (const [html, at] of [[`${name}.html`, undefined], [`${name}.still.html`, undefined], ...(MID[name] ? [[`${name}.html`, MID[name]] as const] : [])] as const) {
    const r = await snapshot(path.join(out, html), { outDir: out, themes: ["light", "dark"], sheet: false, scale: 2, ...(at ? { at: [...at] } : {}) })
    if (r.code === 2) {
      console.log(`  ${html}: ${r.error}`)
      continue
    }
    for (const c of r.receipt?.captures ?? []) console.log(`  ${path.basename(c.png)} ${c.width}×${c.height}`)
    for (const g of r.receipt?.gates ?? []) {
      if (!g.pass) failed = true
      console.log(`  ${g.pass ? "pass" : "FAIL"} ${g.name}: ${g.detail}`)
    }
  }
}
// A simple gallery: the HTML viewers (iframes + links) and the animated SVGs as <img> on both themes.
const card = (n: string) => `<section><h2>${n}</h2>
<p><a href="${n}.html">${n}.html</a> · <a href="${n}.still.html">still</a> · <a href="${n}.animated.light.svg">animated light</a> · <a href="${n}.animated.dark.svg">animated dark</a></p>
<iframe src="${n}.html" loading="lazy"></iframe>
<div class="pair"><figure class="light"><img src="${n}.animated.light.svg" alt="${n} animated (light)"><figcaption>animated SVG · light</figcaption></figure><figure class="dark"><img src="${n}.animated.dark.svg" alt="${n} animated (dark)"><figcaption>animated SVG · dark</figcaption></figure></div>
</section>`
fs.writeFileSync(
  path.join(out, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>storyink 0.4 preview</title>
<style>body{font:14px system-ui,sans-serif;margin:24px;background:#f4f4f4;color:#111}section{margin:0 0 48px}iframe{width:100%;height:640px;border:1px solid #ccc;background:#fff}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}figure{margin:0;padding:12px}figure img{width:100%;height:auto}.light{background:#fff}.dark{background:#0b0b0b;color:#ccc}figcaption{font-size:12px;opacity:.7;margin-top:6px}</style>
<h1>storyink 0.4 preview</h1>
${names.map(card).join("\n")}
`,
)
console.log(`\n→ ${out}`)
if (failed) process.exit(1)
