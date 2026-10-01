/**
 * Backward-compatibility goldens: every pre-0.4 example and fixture must lay out and
 * render byte-identically. `bun test/compat.ts --write` regenerates the goldens (only
 * do that from a known-good baseline).
 */
import fs from "node:fs"
import path from "node:path"
import { layout } from "../src/core/layout/index.ts"
import { renderSvg } from "../src/core/render/index.tsx"
import { renderAnimatedSvg } from "../src/core/render/smil.tsx"
import { loadSpec } from "../src/node/index.ts"
import type { Spec } from "../src/core/spec.ts"

const root = path.join(import.meta.dir, "..")
export const COMPAT_DIR = path.join(import.meta.dir, "fixtures", "compat")

/** The frozen pre-0.4 inputs (top-level examples, mermaid examples, openwick fixture). */
export const COMPAT_INPUTS = [
  "examples/agent-run.lifecycle.json",
  "examples/analytics.dataflow.json",
  "examples/checkout.architecture.json",
  "examples/oauth.sequence.json",
  "examples/release.workflow.json",
  "examples/mermaid/cache.sequence.mmd",
  "examples/mermaid/incident.flowchart.mmd",
  "examples/mermaid/order.state.mmd",
  "test/fixtures/openwick-architecture.json",
]

export function compatOutputs(input: string): Record<string, string> {
  const l = loadSpec(path.join(root, input))
  if (!l.spec) throw new Error(`${input}: invalid`)
  const spec: Spec = l.spec
  const name = path.basename(input).replace(/\.(json|mmd)$/, "")
  return {
    [`${name}.layout.json`]: JSON.stringify(layout(spec)),
    [`${name}.static.light.svg`]: renderSvg(spec, { theme: "light", font: false }),
    [`${name}.animated.light.svg`]: renderAnimatedSvg(spec, { theme: "light" }),
  }
}

if (import.meta.main && process.argv.includes("--write")) {
  fs.mkdirSync(COMPAT_DIR, { recursive: true })
  for (const f of COMPAT_INPUTS) for (const [k, v] of Object.entries(compatOutputs(f))) fs.writeFileSync(path.join(COMPAT_DIR, k), v)
  console.log(`wrote ${fs.readdirSync(COMPAT_DIR).length} goldens to ${COMPAT_DIR}`)
}
