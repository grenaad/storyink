/** Build: generate assets, bundle entries for Node >= 20, emit .d.ts. */
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const dist = path.join(root, "dist")
const sh = (cmd: string, args: string[]) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit" })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

sh("bun", ["scripts/gen.ts"])
fs.rmSync(dist, { recursive: true, force: true })

const external = ["react", "react-dom", "react-dom/*", "react/*", "motion", "motion/*", "@opencode/*"]
const lib = await Bun.build({
  entrypoints: ["src/index.ts", "src/core/index.ts", "src/node/index.ts"].map((p) => path.join(root, p)),
  outdir: dist,
  target: "node",
  format: "esm",
  external,
  root: path.join(root, "src"),
  naming: { entry: "[dir]/[name].[ext]", chunk: "chunks/[name]-[hash].[ext]" },
  splitting: true,
  define: { "process.env.NODE_ENV": '"production"' },
})
if (!lib.success) {
  for (const l of lib.logs) console.error(l)
  process.exit(1)
}

const cli = await Bun.build({
  entrypoints: [path.join(root, "src/cli.ts")],
  outdir: dist,
  target: "node",
  format: "esm",
  external,
  banner: "#!/usr/bin/env node",
  define: { "process.env.NODE_ENV": '"production"' },
})
if (!cli.success) {
  for (const l of cli.logs) console.error(l)
  process.exit(1)
}
fs.chmodSync(path.join(dist, "cli.js"), 0o755)

sh("bunx", ["tsc", "-p", "tsconfig.build.json"])

// Declarations: point relative imports at the emitted .js/.d.ts names.
const walk = (d: string): string[] =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]))
for (const f of walk(path.join(dist, "types")).filter((f) => f.endsWith(".d.ts"))) {
  const s = fs.readFileSync(f, "utf8")
  const t = s.replace(/(from\s+|import\()(["'])(\.{1,2}\/[^"']+?)\.tsx?\2/g, "$1$2$3.js$2")
  if (t !== s) fs.writeFileSync(f, t)
}

const list = (d: string): string[] =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? list(path.join(d, e.name)) : [path.join(d, e.name)]))
const files = list(dist)
const size = files.reduce((s, f) => s + fs.statSync(f).size, 0)
console.log(`build: ${files.length} files, ${(size / 1024).toFixed(1)} KiB in dist/`)
