/**
 * Render every example and Mermaid sample, snapshot light + dark, and write
 * docs/gallery/<name>.<theme>.png. Usage: bun run gallery [--width N]
 * (default width: derived from each diagram, 500..1600 px, so text stays at 1:1)
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { loadSpec, snapshot, writeDiagram } from "../src/node/index.ts"

const root = path.resolve(import.meta.dir, "..")
const out = path.join(root, "docs/gallery")
const argWidth = process.argv.indexOf("--width")
const width = argWidth > 0 ? Number(process.argv[argWidth + 1]) : undefined
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "storyink-gallery-"))
fs.mkdirSync(out, { recursive: true })

const ex = path.join(root, "examples")
const files = [
  ...fs.readdirSync(ex).filter((f) => f.endsWith(".json")).map((f) => path.join(ex, f)),
  ...fs.readdirSync(path.join(ex, "mermaid")).map((f) => path.join(ex, "mermaid", f)),
]
let failed = 0
for (const f of files) {
  const name = path.basename(f).replace(/\.(json|mmd)$/, "")
  const l = loadSpec(f)
  if (!l.ok || !l.spec) {
    console.error(`skip ${name}: invalid`)
    failed++
    continue
  }
  const html = path.join(tmp, `${name}.html`)
  writeDiagram(l.spec, { html })
  const r = await snapshot(html, { outDir: tmp, ...(width ? { width } : {}), sheet: false })
  if (r.code !== 0 || !r.receipt) {
    console.error(`snapshot ${name}: code ${r.code} ${r.error ?? JSON.stringify(r.receipt?.gates)}`)
    failed++
    continue
  }
  for (const c of r.receipt.captures) {
    const dest = path.join(out, `${name}.${c.theme}.png`)
    fs.copyFileSync(c.png, dest)
    console.log(`${dest} ${(fs.statSync(dest).size / 1024).toFixed(0)} KiB`)
  }
}
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(failed ? 1 : 0)
