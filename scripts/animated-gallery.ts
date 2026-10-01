/**
 * Write the SMIL-animated SVGs of the story examples to docs/gallery/<name>.animated.<theme>.svg.
 * Usage: bun run gallery:animated [--font system|embed] [--only name,name]   (default embed: the gallery shows the exact look)
 * `--only` writes just those examples (e.g. new ones) and leaves the other gallery files untouched.
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
  ["code-mode.architecture", "examples/code-mode.architecture.json"],
  ["failover.dataflow", "examples/failover.dataflow.json"],
  ["retry-helper.architecture", "examples/retry-helper.architecture.json"],
  ["agent-session.architecture", "examples/agent-session.architecture.json"],
] as const
const oi = process.argv.indexOf("--only")
const only = oi > 0 ? new Set(process.argv[oi + 1].split(",")) : undefined
if (import.meta.main)
  for (const [name, file] of ANIMATED.filter(([n]) => !only || only.has(n))) {
    const l = loadSpec(path.join(root, file))
    if (!l.spec) throw new Error(`invalid ${file}`)
    if (l.spec.story === undefined) l.spec.story = "auto"
    const r = writeAnimatedSvg(l.spec, path.join(out, `${name}.animated.svg`), { theme: "both", font })
    for (const f of r.files) console.log(`${path.relative(root, f.path)} ${(f.bytes / 1024).toFixed(1)} KiB`)
  }
