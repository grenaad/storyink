import fs from "node:fs"
import path from "node:path"
import type { Plugin } from "@opencode/plugin"
import { fromMermaid } from "./core/mermaid/index.ts"
import { formatDiagnostic, type Diagnostic } from "./core/validate.ts"
import { readSkill, skillPath } from "./node/assets.ts"
import { parseSource, snapshot, writeDiagram } from "./node/index.ts"
import type { ThemeName } from "./theme/tokens.ts"

export const PLUGIN_ID = "storyink"

const NAMESPACE_DESCRIPTION =
  "Render architecture, workflow, sequence, data-flow and lifecycle diagrams from a JSON spec or Mermaid into standalone HTML + SVG, validate specs, and snapshot renders to PNG so you can look at them. Load the storyink skill for the spec format and the render -> look -> fix loop."

const SKILL_DESCRIPTION =
  "Create polished architecture, workflow, sequence, data-flow and lifecycle diagrams as standalone HTML/SVG with storyink, then snapshot and visually check them. Use when asked to draw, visualise or diagram a system, flow, API sequence, pipeline or state machine, or to convert Mermaid."

type Json = Record<string, unknown>

function summarize(diags: Diagnostic[]): string {
  return diags.map((d) => `- ${formatDiagnostic(d)}`).join("\n")
}

/** Resolve `p` against the tool's working directory. */
function resolver(base: string) {
  return (p: string) => (path.isAbsolute(p) ? p : path.resolve(base, p))
}

function specFrom(input: { spec?: unknown; mermaid?: string }) {
  if (typeof input.mermaid === "string" && input.mermaid.trim()) {
    const r = fromMermaid(input.mermaid)
    return { ok: r.ok, spec: r.spec, diagnostics: r.diagnostics }
  }
  if (typeof input.spec === "string") return parseSource(input.spec)
  if (input.spec && typeof input.spec === "object") {
    const r = parseSource(JSON.stringify(input.spec))
    return r
  }
  return {
    ok: false,
    diagnostics: [{ severity: "error" as const, path: "", message: "provide `spec` (object or JSON string) or `mermaid` text" }],
  }
}

const THEME = { type: "string", enum: ["light", "dark"] } as const

/** OpenCode v2 plugin: storyink tools and the bundled skill. */
const plugin = {
  id: PLUGIN_ID,
  async setup(ctx) {
    const base = ctx.location?.directory ?? process.cwd()
    const abs = resolver(base)

    await ctx.tool.transform((editor) => {
      editor.namespace({ name: "storyink", description: NAMESPACE_DESCRIPTION })

      editor.add({
        name: "render",
        description:
          "Render a storyink spec (object or JSON string) or Mermaid text to a standalone HTML file (and optionally SVG). Returns written paths, sizes and diagnostics. Invalid specs write nothing and return actionable diagnostics.",
        input: {
          type: "object",
          properties: {
            spec: { description: "storyink spec object, or a JSON string", type: ["object", "string"] },
            mermaid: { type: "string", description: "Mermaid flowchart / sequenceDiagram / stateDiagram-v2 text (alternative to spec)" },
            output: { type: "string", description: "Output .html path (relative to the project directory)" },
            svg: { type: "string", description: "Optional output .svg path" },
            theme: { ...THEME, description: "Pin the theme; default follows the viewer's system preference" },
          },
          required: ["output"],
          additionalProperties: false,
        },
        options: { namespace: "storyink" },
        execute: async (input, context) => {
          const i = input as { spec?: unknown; mermaid?: string; output: string; svg?: string; theme?: ThemeName }
          if (context.signal.aborted) throw new Error("aborted")
          const s = specFrom(i)
          if (!s.ok || !s.spec)
            return {
              content: `storyink: spec is invalid, nothing written.\n${summarize(s.diagnostics)}`,
              metadata: { ok: false, diagnostics: s.diagnostics },
            }
          const res = writeDiagram(s.spec, { html: abs(i.output), ...(i.svg ? { svg: abs(i.svg) } : {}), ...(i.theme ? { theme: i.theme } : {}) })
          const out: Json = { ok: res.ok, html: res.html, svg: res.svg, diagnostics: s.diagnostics }
          const lines = [
            `storyink: rendered ${s.spec.type} "${s.spec.title}"`,
            res.html ? `- html: ${res.html.path} (${(res.html.bytes / 1024).toFixed(1)} KiB)` : "",
            res.svg ? `- svg: ${res.svg.path} (${(res.svg.bytes / 1024).toFixed(1)} KiB)` : "",
            s.diagnostics.length ? `warnings:\n${summarize(s.diagnostics)}` : "",
            "Next: run storyink_snapshot on the html and look at the sheet image before describing it.",
          ].filter(Boolean)
          return { content: lines.join("\n"), metadata: out }
        },
      })

      editor.add({
        name: "from_mermaid",
        description: "Convert Mermaid (flowchart/graph, sequenceDiagram, stateDiagram-v2) to a storyink JSON spec. Optionally write it to a file. Returns the spec and conversion warnings.",
        input: {
          type: "object",
          properties: {
            mermaid: { type: "string", description: "Mermaid source text" },
            output: { type: "string", description: "Optional .json output path" },
          },
          required: ["mermaid"],
          additionalProperties: false,
        },
        options: { namespace: "storyink" },
        execute: async (input) => {
          const i = input as { mermaid: string; output?: string }
          const r = fromMermaid(i.mermaid)
          let written: string | undefined
          if (r.spec && i.output) {
            written = abs(i.output)
            fs.mkdirSync(path.dirname(written), { recursive: true })
            fs.writeFileSync(written, `${JSON.stringify(r.spec, null, 2)}\n`)
          }
          return {
            content: [
              `storyink: ${r.ok ? "converted" : "conversion has errors"}${written ? ` -> ${written}` : ""}`,
              r.diagnostics.length ? summarize(r.diagnostics) : "",
              r.spec ? `\`\`\`json\n${JSON.stringify(r.spec, null, 2)}\n\`\`\`` : "",
            ]
              .filter(Boolean)
              .join("\n"),
            metadata: { ok: r.ok, path: written, diagnostics: r.diagnostics },
          }
        },
      })

      editor.add({
        name: "validate",
        description: "Validate a storyink spec (object/JSON string) or Mermaid text. Returns structured diagnostics with JSON paths and fix hints.",
        input: {
          type: "object",
          properties: {
            spec: { description: "storyink spec object, or a JSON string", type: ["object", "string"] },
            mermaid: { type: "string" },
            path: { type: "string", description: "Or a .json/.mmd file to validate" },
          },
          additionalProperties: false,
        },
        options: { namespace: "storyink" },
        execute: async (input) => {
          const i = input as { spec?: unknown; mermaid?: string; path?: string }
          const s = i.path ? parseSource(fs.readFileSync(abs(i.path), "utf8"), i.path) : specFrom(i)
          return {
            content: s.ok
              ? `storyink: valid${s.diagnostics.length ? ` with warnings\n${summarize(s.diagnostics)}` : ""}`
              : `storyink: invalid\n${summarize(s.diagnostics)}`,
            metadata: { ok: s.ok, diagnostics: s.diagnostics },
          }
        },
      })

      editor.add({
        name: "snapshot",
        description:
          "Screenshot a storyink HTML file in light and dark with headless Chrome, lint label overflow/overlap, and return PNG paths, a receipt, and the side-by-side contact sheet image so you can see the render. Look at the image before describing or delivering the diagram.",
        input: {
          type: "object",
          properties: {
            html: { type: "string", description: "Path to a storyink .html file" },
            themes: { type: "array", items: THEME, description: "Default [light, dark]" },
            width: { type: "number", description: "Window width in CSS px (min 500)" },
            outDir: { type: "string", description: "Directory for PNGs and receipt (default: next to the html)" },
          },
          required: ["html"],
          additionalProperties: false,
        },
        options: { namespace: "storyink" },
        execute: async (input, context) => {
          const i = input as { html: string; themes?: ThemeName[]; width?: number; outDir?: string }
          const r = await snapshot(abs(i.html), {
            ...(i.themes ? { themes: i.themes } : {}),
            ...(i.width ? { width: i.width } : {}),
            ...(i.outDir ? { outDir: abs(i.outDir) } : {}),
            signal: context.signal,
          })
          if (r.code === 2 || !r.receipt) return { content: `storyink: ${r.error ?? "snapshot failed"}`, metadata: { code: r.code } }
          const rc = r.receipt
          const lint = rc.lint as { ok?: boolean; issues?: { kind: string; ids: string[]; detail: string }[] } | undefined
          const text = [
            `storyink snapshot: ${rc.ok ? "all gates pass" : "gate failure"}`,
            ...rc.captures.map((c) => `- ${c.theme}: ${c.png}`),
            rc.sheet ? `- sheet: ${rc.sheet.png}` : "",
            ...rc.gates.map((g) => `- gate ${g.name}: ${g.pass ? "pass" : "FAIL"} (${g.detail})`),
            ...(lint?.issues ?? []).map((x) => `  - lint ${x.kind}: ${x.ids.join(", ")} ${x.detail}`),
            `- receipt: ${r.receiptPath}`,
          ].filter(Boolean)
          const image = rc.sheet?.png ?? rc.captures[0]?.png
          return {
            content: [
              { type: "text" as const, text: text.join("\n") },
              ...(image ? [{ type: "file" as const, uri: `data:image/png;base64,${fs.readFileSync(image).toString("base64")}`, mime: "image/png", name: path.basename(image) }] : []),
            ],
            metadata: { code: r.code, receipt: r.receiptPath },
          }
        },
      })
    })

    const content = readSkill()
    const location = skillPath()
    await ctx.skill.transform((editor) => {
      // User definitions win.
      if (editor.get("storyink")) return
      editor.add({
        id: "storyink",
        name: "storyink",
        description: SKILL_DESCRIPTION,
        path: location,
        content,
      } as never)
    })
  },
} satisfies Plugin.Plugin

export default plugin
