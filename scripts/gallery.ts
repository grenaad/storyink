/**
 * Render every example and Mermaid sample, snapshot light + dark, and write
 * docs/gallery/<name>.<theme>.png. Usage: bun run gallery [--width N]
 * (default width: derived from each diagram, 500..1600 px, so text stays at 1:1)
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { loadSpec, snapshot, writeDiagram } from "../src/node/index.ts"

/** Shrink committed PNGs with a 48-colour palette (lossless-looking for these flat figures). Needs ffmpeg; skipped otherwise. */
function publish(src: string, dest: string) {
  const q = spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-i", src, "-vf", "split[a][b];[a]palettegen=max_colors=48[p];[b][p]paletteuse=dither=none", dest])
  if (q.status !== 0 || !fs.existsSync(dest)) fs.copyFileSync(src, dest)
}

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
  // The Mermaid state sample doubles as the `story: "auto"` showcase.
  if (name === "order.state" && l.spec.story === undefined) l.spec.story = "auto"
  const html = path.join(tmp, `${name}.html`)
  writeDiagram(l.spec, { html })
  const story = l.spec.story !== undefined
  const r = await snapshot(html, { outDir: tmp, ...(width ? { width } : {}), sheet: story ? "beats" : false })
  if (r.code !== 0 || !r.receipt) {
    console.error(`snapshot ${name}: code ${r.code} ${r.error ?? JSON.stringify(r.receipt?.gates)}`)
    failed++
    continue
  }
  for (const b of r.receipt.beats ?? []) {
    const theme = b.png.includes(".beats.dark.") ? "dark" : "light"
    const dest = path.join(out, `${name}.beats.${theme}.png`)
    publish(b.png, dest)
    console.log(`${dest} ${(fs.statSync(dest).size / 1024).toFixed(0)} KiB`)
  }
  for (const c of r.receipt.captures) {
    const dest = path.join(out, `${name}.${c.theme}.png`)
    publish(c.png, dest)
    console.log(`${dest} ${(fs.statSync(dest).size / 1024).toFixed(0)} KiB`)
  }
}
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(failed ? 1 : 0)
