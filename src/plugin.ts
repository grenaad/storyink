import fs from "node:fs"
import path from "node:path"
import type { Plugin } from "@opencode/plugin"
import { fromMermaid } from "./core/mermaid/index.ts"
import { formatDiagnostic, type Diagnostic } from "./core/validate.ts"
import { readSkill, skillPath } from "./node/assets.ts"
import { parseSource, snapshot, writeDiagram, type SnapshotReceipt } from "./node/index.ts"
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

/**
 * Build the snapshot tool result: gate summary, full-res paths (on disk only) and the
 * compact preview image(s). Never inlines full-resolution sheets.
 */
export function snapshotResult(rc: SnapshotReceipt, receiptPath: string | undefined, code: number, image: "overview" | "full" | "none") {
  const lint = rc.lint as { ok?: boolean; issues?: { kind: string; ids: string[]; detail: string }[] } | undefined
  const previews = image === "none" ? [] : (rc.previews ?? []).slice(0, image === "full" ? 3 : 1)
  const text = [
    `storyink snapshot: ${rc.ok ? "all gates pass" : "gate failure"}`,
    ...rc.gates.map((g) => `- gate ${g.name}: ${g.pass ? "pass" : "FAIL"} (${g.detail})`),
    ...(lint?.issues ?? []).map((x) => `  - lint ${x.kind}: ${x.ids.join(", ")} ${x.detail}`),
    "Full-resolution PNGs (on disk; open only if you must, they are large):",
    ...rc.captures.map((c) => `- ${c.theme}${c.at !== undefined && c.at !== "end" ? ` t=${c.at}` : ""}: ${c.png} (${c.width}×${c.height})`),
    rc.sheet ? `- sheet: ${rc.sheet.png} (${rc.sheet.width}×${rc.sheet.height})` : "",
    ...(rc.beats ?? []).map((b) => `- beats: ${b.png} (${b.width}×${b.height})`),
    previews.length
      ? `Inline preview${previews.length > 1 ? `s (${previews.length} parts)` : ""}: ${previews.map((p) => `${p.path} (${p.width}×${p.height}, ${(p.bytes / 1024).toFixed(0)} KiB; ${p.shows})`).join("; ")}`
      : "No inline image (image: \"none\").",
    `- receipt: ${receiptPath}`,
  ].filter(Boolean)
  return {
    content: [
      { type: "text" as const, text: text.join("\n") },
      ...previews.map((p) => ({
        type: "file" as const,
        uri: `data:${p.path.endsWith(".png") ? "image/png" : "image/jpeg"};base64,${fs.readFileSync(p.path).toString("base64")}`,
        mime: p.path.endsWith(".png") ? "image/png" : "image/jpeg",
        name: path.basename(p.path),
      })),
    ],
    metadata: { code, receipt: receiptPath, previews: previews.map((p) => p.path) },
  }
}

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
            story: { type: "string", enum: ["auto"], description: "Add an auto-generated storyboard (only when the user asked for an animated diagram)" },
          },
          required: ["output"],
          additionalProperties: false,
        },
        options: { namespace: "storyink" },
        execute: async (input, context) => {
          const i = input as { spec?: unknown; mermaid?: string; output: string; svg?: string; theme?: ThemeName; story?: "auto" }
          if (context.signal.aborted) throw new Error("aborted")
          const s = specFrom(i)
          if (s.ok && s.spec && i.story === "auto" && s.spec.story === undefined) s.spec.story = "auto"
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
          "Screenshot a storyink HTML file in light and dark with headless Chrome, lint label overflow/overlap, and return full-res PNG paths, a receipt, and ONE compact preview image (JPEG, longest side ≤ maxImageSize, default 1024) so you can see the render. Look at the preview before describing the diagram; don't re-read the full-res sheets; use `at` for detail frames.",
        input: {
          type: "object",
          properties: {
            html: { type: "string", description: "Path to a storyink .html file" },
            themes: { type: "array", items: THEME, description: "Default [light, dark]" },
            width: { type: "number", description: "Window width in CSS px (min 500)" },
            outDir: { type: "string", description: "Directory for PNGs and receipt (default: next to the html)" },
            at: { type: "array", items: { type: ["number", "string"] }, description: 'Story times to capture, seconds or "end" (default ["end"])' },
            sheet: { type: "string", enum: ["themes", "beats", "none"], description: 'Contact sheet: "themes" (light|dark, default) or "beats" (one tile per story step)' },
            image: {
              type: "string",
              enum: ["overview", "full", "none"],
              description: 'Inline image: "overview" (default: one compact image; beat sheets reflow into more columns), "full" (normal sheet layout, split into ≤ 3 downscaled parts when tall), "none" (paths only)',
            },
            maxImageSize: { type: "number", description: "Longest side of the returned image in px (default 1024, 256–2048)" },
          },
          required: ["html"],
          additionalProperties: false,
        },
        options: { namespace: "storyink" },
        execute: async (input, context) => {
          const i = input as {
            html: string
            themes?: ThemeName[]
            width?: number
            outDir?: string
            at?: (number | string)[]
            sheet?: "themes" | "beats" | "none"
            image?: "overview" | "full" | "none"
            maxImageSize?: number
          }
          const image = i.image ?? "overview"
          const r = await snapshot(abs(i.html), {
            ...(image !== "none" ? { preview: { mode: image, maxSize: Math.max(256, Math.min(2048, i.maxImageSize ?? 1024)) } } : {}),
            ...(i.at ? { at: i.at.map((x) => (x === "end" ? ("end" as const) : Number(x))) } : {}),
            sheet: i.sheet === "none" ? false : i.sheet === "beats" ? "beats" : true,
            ...(i.themes ? { themes: i.themes } : {}),
            ...(i.width ? { width: i.width } : {}),
            ...(i.outDir ? { outDir: abs(i.outDir) } : {}),
            signal: context.signal,
          })
          if (r.code === 2 || !r.receipt) return { content: `storyink: ${r.error ?? "snapshot failed"}`, metadata: { code: r.code } }
          return snapshotResult(r.receipt, r.receiptPath, r.code, image)
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
