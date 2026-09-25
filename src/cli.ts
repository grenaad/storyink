import fs from "node:fs"
import path from "node:path"
import { fromMermaid } from "./core/mermaid/index.ts"
import { formatDiagnostic, type Diagnostic } from "./core/validate.ts"
import { VERSION } from "./generated/meta.ts"
import { readSkill, skillPath } from "./node/assets.ts"
import { loadSpec, parseSource, snapshot, writeDiagram } from "./node/index.ts"
import type { ThemeName } from "./theme/tokens.ts"

const COLOR = !!process.stdout.isTTY && !process.env.NO_COLOR
const ECOLOR = !!process.stderr.isTTY && !process.env.NO_COLOR
const paint = (on: boolean, code: string) => (s: string) => (on ? `\x1b[${code}m${s}\x1b[0m` : s)
const bold = paint(COLOR, "1")
const dim = paint(COLOR, "2")
const green = paint(COLOR, "32")
const red = paint(ECOLOR, "31")
const yellow = paint(ECOLOR, "33")
const cyan = paint(COLOR, "36")

const HELP = `${bold("storyink")} ${dim(VERSION)} - diagrams from JSON or Mermaid into standalone HTML and SVG

${bold("Usage")}
  storyink render <in.json|in.mmd|-> [-o out.html] [--svg out.svg] [--theme light|dark]
  storyink mermaid <in.mmd> [-o out.json]
  storyink validate <in> [--json]
  storyink snapshot <out.html> [--theme light,dark] [--width N] [--sheet|--no-sheet] [--scale 2] [-o dir] [--json]
  storyink skill            print the SKILL.md path and content
  storyink --help | --version

${bold("Exit codes")}
  0 ok   1 invalid input / failed gate   2 no browser (snapshot)

${bold("Examples")}
  storyink render examples/checkout.architecture.json -o out/checkout.html --svg out/checkout.svg
  cat flow.mmd | storyink render - -o flow.html
  storyink snapshot out/checkout.html -o out/shots
`

interface Args {
  _: string[]
  flags: Map<string, string | true>
}

function parseArgs(argv: string[]): Args {
  const _: string[] = []
  const flags = new Map<string, string | true>()
  const takes = new Set(["-o", "--out", "--svg", "--theme", "--width", "--scale", "--t"])
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "-" || !a.startsWith("-")) _.push(a)
    else if (a.includes("=")) {
      const [k, ...v] = a.split("=")
      flags.set(k, v.join("="))
    } else if (takes.has(a) && i + 1 < argv.length) flags.set(a, argv[++i])
    else flags.set(a, true)
  }
  return { _, flags }
}

const str = (a: Args, ...keys: string[]) => {
  for (const k of keys) {
    const v = a.flags.get(k)
    if (typeof v === "string") return v
  }
  return undefined
}

function printDiagnostics(diags: Diagnostic[]) {
  for (const d of diags) {
    const tag = d.severity === "error" ? red("error") : yellow("warn ")
    process.stderr.write(`${tag} ${d.path ? `${dim(d.path)} ` : ""}${d.message}${d.hint ? dim(` - ${d.hint}`) : ""}\n`)
  }
}

function readInput(file: string): { text: string; name?: string } {
  if (file === "-") return { text: fs.readFileSync(0, "utf8") }
  return { text: fs.readFileSync(file, "utf8"), name: file }
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} KiB`

function theme(a: Args): ThemeName | undefined {
  const t = str(a, "--theme")
  if (t === undefined) return undefined
  if (t !== "light" && t !== "dark") throw new Error(`--theme must be light or dark, got "${t}"`)
  return t
}

async function main(argv: string[]): Promise<number> {
  const a = parseArgs(argv)
  const cmd = a._[0]
  if (a.flags.has("--version") || a.flags.has("-v")) {
    console.log(VERSION)
    return 0
  }
  if (!cmd || a.flags.has("--help") || a.flags.has("-h") || cmd === "help") {
    process.stdout.write(HELP)
    return cmd || a.flags.has("--help") || a.flags.has("-h") ? 0 : 1
  }

  if (cmd === "render") {
    const file = a._[1]
    if (!file) throw new Error("render needs an input file (or - for stdin)")
    const input = readInput(file)
    const loaded = parseSource(input.text, input.name)
    printDiagnostics(loaded.diagnostics)
    if (!loaded.ok || !loaded.spec) return 1
    const svg = str(a, "--svg")
    let html = str(a, "-o", "--out")
    if (!html && !svg) html = input.name ? input.name.replace(/\.(json|mmd|mermaid)$/i, "") + ".html" : "diagram.html"
    const res = writeDiagram(loaded.spec, { html, svg, theme: theme(a) })
    if (res.html) console.log(`${green("wrote")} ${res.html.path} ${dim(kb(res.html.bytes))}`)
    if (res.svg) console.log(`${green("wrote")} ${res.svg.path} ${dim(kb(res.svg.bytes))}`)
    return res.ok ? 0 : 1
  }

  if (cmd === "mermaid") {
    const file = a._[1]
    if (!file) throw new Error("mermaid needs an input file (or - for stdin)")
    const r = fromMermaid(readInput(file).text)
    printDiagnostics(r.diagnostics)
    if (!r.spec) return 1
    const json = `${JSON.stringify({ $schema: "https://unpkg.com/storyink/schema/storyink.schema.json", ...r.spec }, null, 2)}\n`
    const out = str(a, "-o", "--out")
    if (out) {
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
      fs.writeFileSync(out, json)
      console.log(`${green("wrote")} ${path.resolve(out)}`)
    } else process.stdout.write(json)
    return r.ok ? 0 : 1
  }

  if (cmd === "validate") {
    const file = a._[1]
    if (!file) throw new Error("validate needs an input file")
    const loaded = file === "-" ? parseSource(fs.readFileSync(0, "utf8")) : loadSpec(file)
    if (a.flags.has("--json")) console.log(JSON.stringify({ ok: loaded.ok, source: loaded.source, diagnostics: loaded.diagnostics }, null, 2))
    else {
      printDiagnostics(loaded.diagnostics)
      if (loaded.ok) console.log(`${green("ok")} ${file} ${dim(`(${loaded.spec?.type}, ${loaded.source})`)}`)
      else process.stderr.write(red(`invalid: ${loaded.diagnostics.filter((d) => d.severity === "error").length} error(s)\n`))
    }
    return loaded.ok ? 0 : 1
  }

  if (cmd === "snapshot") {
    const file = a._[1]
    if (!file) throw new Error("snapshot needs an HTML file")
    const themes = (str(a, "--theme") ?? "light,dark").split(",").map((t) => t.trim()) as ThemeName[]
    for (const t of themes) if (t !== "light" && t !== "dark") throw new Error(`unknown theme "${t}"`)
    const width = str(a, "--width") ? Number(str(a, "--width")) : undefined
    const scale = str(a, "--scale") === "2" ? 2 : 1
    const r = await snapshot(file, {
      themes,
      ...(width ? { width } : {}),
      sheet: !a.flags.has("--no-sheet"),
      scale,
      ...(str(a, "-o", "--out") ? { outDir: str(a, "-o", "--out") } : {}),
      ...(str(a, "--t") ? { t: str(a, "--t") } : {}),
    })
    if (a.flags.has("--json")) {
      console.log(JSON.stringify({ code: r.code, receiptPath: r.receiptPath, error: r.error, receipt: r.receipt }, null, 2))
      return r.code
    }
    if (r.code === 2) {
      process.stderr.write(`${red("no browser")} ${r.error}\n`)
      return 2
    }
    const rc = r.receipt!
    console.log(`${dim("browser")} ${rc.browser.version ?? rc.browser.path}`)
    for (const c of rc.captures) console.log(`${green("png")} ${c.png} ${dim(`${c.width}×${c.height} ${kb(c.bytes)} ${c.ms}ms`)}`)
    if (rc.sheet) console.log(`${green("sheet")} ${rc.sheet.png}`)
    for (const g of rc.gates) console.log(`${g.pass ? green("pass") : red("FAIL")} ${bold(g.name)} ${dim(g.detail)}`)
    const issues = (rc.lint as { issues?: { kind: string; ids: string[]; detail: string }[] } | undefined)?.issues ?? []
    for (const i of issues) console.log(`  ${yellow(i.kind)} ${i.ids.join(" ")} ${dim(i.detail)}`)
    console.log(`${cyan("receipt")} ${r.receiptPath}`)
    return r.code
  }

  if (cmd === "skill") {
    console.log(`# ${skillPath()}\n`)
    process.stdout.write(readSkill())
    return 0
  }

  process.stderr.write(red(`unknown command "${cmd}"\n`))
  process.stdout.write(HELP)
  return 1
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    process.stderr.write(`${red("error")} ${(e as Error).message}\n`)
    process.exit(1)
  },
)

export { formatDiagnostic }
