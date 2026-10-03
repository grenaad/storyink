/**
 * Write the SMIL-animated SVGs of the story examples to docs/gallery/<name>.animated.<theme>.svg.
 * Usage: bun run gallery:animated [--font system|embed] [--only name,name]   (default embed: the gallery shows the exact look)
 * `--only` writes just those examples (e.g. new ones) and leaves the other gallery files untouched.
 */
import fs from "node:fs"
import path from "node:path"
import { loadSpec, parseSource, diffSetFrom, writeAnimatedSvg, type LoadResult } from "../src/node/index.ts"
import { resolveChanges } from "../src/core/diff/resolve.ts"
import type { Spec } from "../src/core/spec.ts"

const root = path.resolve(import.meta.dir, "..")
const out = path.join(root, "docs/gallery")
const fi = process.argv.indexOf("--font")
const font = fi > 0 ? (process.argv[fi + 1] as "system" | "embed") : "embed"
export const ANIMATED = [
  ["checkout.architecture", "examples/checkout.architecture.json"],
  ["oauth.sequence", "examples/oauth.sequence.json"],
  ["order.state", "examples/mermaid/order.state.mmd"],
  ["checkout-recovery.architecture", "examples/checkout-recovery.architecture.json"],
  ["code-mode.architecture", "examples/code-mode.architecture.json"],
  ["failover.dataflow", "examples/failover.dataflow.json"],
  ["retry-helper.architecture", "examples/retry-helper.architecture.json"],
  ["agent-session.architecture", "examples/agent-session.architecture.json"],
  ["batch-email.dataflow", "examples/changes/batch-email.dataflow.json"],
  ["batch-email.changes.dataflow", "examples/changes/batch-email.changes.dataflow.json"],
  ["auth-session-to-jwt.sequence", "examples/changes/auth-session-to-jwt.sequence.json"],
  ["payment-retry.architecture", "examples/changes/payment-retry.architecture.json"],
  ["etl-dedupe.dataflow", "examples/changes/etl-dedupe.dataflow.json"],
  ["cache-layer.architecture", "examples/changes/cache-layer.architecture.json"],
  ["rate-limit-plugin.architecture", "examples/changes/rate-limit-plugin.architecture.json"],
  ["storyink-core.architecture", "examples/changes/storyink-core.architecture.json", "examples/changes/storyink-0.4.0.changes.json"],
] as const

/** Load a spec; with `changes`, resolve stat / diff nodes from that diff first, like `storyink render --changes`. */
export function loadWithChanges(file: string, changes?: string): LoadResult {
  if (!changes) return loadSpec(file)
  const ds = diffSetFrom(fs.readFileSync(changes, "utf8"), changes)
  const r = resolveChanges(JSON.parse(fs.readFileSync(file, "utf8")) as Spec, ds)
  return parseSource(JSON.stringify(r.spec), file)
}
const oi = process.argv.indexOf("--only")
const only = oi > 0 ? new Set(process.argv[oi + 1].split(",")) : undefined
if (import.meta.main)
  for (const [name, file, changes] of ANIMATED.filter(([n]) => !only || only.has(n)) as readonly (readonly [string, string, string?])[]) {
    const l = loadWithChanges(path.join(root, file), changes && path.join(root, changes))
    if (!l.spec) throw new Error(`invalid ${file}`)
    if (l.spec.story === undefined) l.spec.story = "auto"
    const r = writeAnimatedSvg(l.spec, path.join(out, `${name}.animated.svg`), { theme: "both", font })
    for (const f of r.files) console.log(`${path.relative(root, f.path)} ${(f.bytes / 1024).toFixed(1)} KiB`)
  }
