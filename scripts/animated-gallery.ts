/**
 * Write the SMIL-animated SVGs of the story examples to docs/gallery/<name>.animated.<theme>.svg.
 * Usage: bun run gallery:animated [--font system|embed]   (default embed: the gallery shows the exact look)
 */
import fs from "node:fs"
import path from "node:path"
import { loadSpec, writeAnimatedSvg } from "../src/node/index.ts"

const root = path.resolve(import.meta.dir, "..")
const out = path.join(root, "docs/gallery")
const fi = process.argv.indexOf("--font")
const font = fi > 0 ? (process.argv[fi + 1] as "system" | "embed") : "embed"
export const ANIMATED = [
  ["checkout.architecture", "examples/checkout.architecture.json"],
  ["oauth.sequence", "examples/oauth.sequence.json"],
  ["order.state", "examples/mermaid/order.state.mmd"],
] as const
if (import.meta.main)
  for (const [name, file] of ANIMATED) {
    const l = loadSpec(path.join(root, file))
    if (!l.spec) throw new Error(`invalid ${file}`)
    if (l.spec.story === undefined) l.spec.story = "auto"
    const r = writeAnimatedSvg(l.spec, path.join(out, `${name}.animated.svg`), { theme: "both", font })
    for (const f of r.files) console.log(`${path.relative(root, f.path)} ${(f.bytes / 1024).toFixed(1)} KiB`)
  }
