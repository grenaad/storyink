/**
 * Story showcase (tones, acts, overlays): renders the `examples/stories` specs to
 * `examples/stories/out/` (git-ignored) and writes `index.html` linking / embedding everything:
 * standalone HTML, static end-state SVG, animated SVG (light + dark), beat sheets and act sheets
 * (light + dark) and a few deterministic captures (mid-flight, toasts piling up, typed
 * annotation, rewind, morph, follow camera, reduced motion, final HUD). Offline; file:// links.
 * Usage: bun run gallery:stories [--only name,name] [--docs]   (names: request-colours, secret-broker, payment-retry)
 * `--docs` also copies a small, durable selection (each example's `docs` list, light + dark) to
 * `docs/gallery/` as `<name>.story.*` for the README; nothing else in docs/gallery is touched.
 */
import fs from "node:fs"
import path from "node:path"
import { validate } from "../src/core/validate.ts"
import { layout } from "../src/core/layout/index.ts"
import { renderHtml, renderSvg } from "../src/core/render/index.tsx"
import { renderAnimatedSvg } from "../src/core/render/smil.tsx"
import { snapshot, type SnapshotOptions } from "../src/node/snapshot.ts"
import type { Scene } from "../src/core/scene.ts"
import type { Spec } from "../src/core/spec.ts"
import type { Timeline } from "../src/core/story/types.ts"

const root = path.resolve(import.meta.dir, "..")
const src = path.join(root, "examples/stories")
const out = path.join(src, "out")
const oi = process.argv.indexOf("--only")
const only = oi > 0 ? new Set(process.argv[oi + 1].split(",")) : undefined
const docs = process.argv.includes("--docs")
const gallery = path.join(root, "docs/gallery")

type Shot = { file: string; caption: string; theme: "light" | "dark" }
interface Example {
  name: string
  spec: string
  title: string
  blurb: string
  /** Extra captures: story time (or "end"), camera, motion, caption. */
  /** Durable README assets with `--docs`: a file in out/ (`{theme}` = light | dark) → docs/gallery/<to>.{theme}.<ext>. */
  docs?: { from: string; to: string }[]
  shots: (sc: Scene, tl: Timeline) => { at: number | "end"; caption: string; camera?: "follow"; motion?: "reduced"; themes?: ("light" | "dark")[] }[]
}

const toastT0 = (tl: Timeline, id: string) => tl.toasts?.[id]?.t0 ?? 0
const typing = (tl: Timeline, id: string) => (tl.typing ?? []).find((r) => r.target === id)
const r2 = (x: number) => Math.round(x * 100) / 100
/** A moment a labelled pulse of step i is mid-flight (55 % of its flight). */
const midFlight = (tl: Timeline, step: number, k = 0) => {
  const p = tl.pulses.find((x) => x.id === `pulse-${step}-${k}`)
  return p ? r2(p.tf0 + 0.55 * (p.tf1 - p.tf0)) : 0
}

const EXAMPLES: Example[] = [
  {
    name: "request-colours",
    spec: "request-colours.dataflow.json",
    title: "Request colours (Phase A: tones)",
    docs: [
      { from: "request-colours.shots/02.{theme}.png", to: "request-colours.story.pulse" },
      { from: "request-colours.anim.{theme}.svg", to: "request-colours.story.animated" },
    ],
    blurb: "Colour carries meaning: a blue request with a payload label, a gold hand-off that tints its target, a rose error branch with a contagion sweep, a sage response that stains its wires and lands its label on the edge; node detail / status changes; one emphasised caption.",
    shots: (_sc, tl) => [
      { at: midFlight(tl, 0), caption: "Mid-flight: blue request with its payload label" },
      { at: midFlight(tl, 1), caption: "Mid-flight: the gold charge, its label following the dot" },
      { at: "end", caption: "End state: toned nodes, stained wires, landed edge label", motion: "reduced", themes: ["light"] },
    ],
  },
  {
    name: "secret-broker",
    spec: "secret-broker.architecture.json",
    title: "Who sees the secret? (acts + overlays)",
    docs: [
      { from: "secret-broker.sheets/secret-broker.acts.{theme}.png", to: "secret-broker.story.acts" },
      { from: "secret-broker.shots/01.{theme}.png", to: "secret-broker.story.toasts" },
      { from: "secret-broker.anim.{theme}.svg", to: "secret-broker.story.animated" },
    ],
    blurb: "Problem → rewind → fix on one stage. Act 1: four escalating approval toasts pile up near the CLI while the prompts HUD counts 1 → 4; the contagion turns toasts, wires and nodes rose; the leaked key types into the agent's chat annotation. Rewind. Act 2: the broker slides into the gap, a single “approved once ✓” toast, the same annotation slot now holds a sage reference, prompts reads 0; processes get the secret, the agent only a reference.",
    shots: (_sc, tl) => {
      const ty = typing(tl, "chat")
      const a = tl.acts?.[1]
      return [
        { at: r2(toastT0(tl, "p4") + 0.8), caption: "Toasts piling up near the CLI · prompts: 4" },
        { at: r2(toastT0(tl, "p4") + 4.2), caption: "Contagion: the toasts, wire and agent turn rose" },
        ...(ty ? [{ at: r2(ty.t0 + 0.6 * (ty.t1 - ty.t0)), caption: "The leaked key types into the chat annotation (mid-typing)" }] : []),
        ...(a?.rewind ? [{ at: r2((a.rewind.t0 + a.rewind.t1) / 2), caption: "Rewind: act 1 plays backwards (chip “◀◀ rewind”)" }] : []),
        ...(a?.morph ? [{ at: r2((a.morph.t0 + a.morph.t1) / 2), caption: "Morph: the wire retracts, the broker appears in its gap" }] : []),
        { at: r2(toastT0(tl, "once") + 0.7), caption: "Act 2: a single “approved once ✓” toast (expires by itself)", camera: "follow" },
        { at: "end", caption: "End: sage reference in the same annotation slot · prompts: 0" },
        { at: r2(toastT0(tl, "p4") + 0.8), caption: "Reduced motion: the same beat, settled (no flights)", motion: "reduced", themes: ["light"] },
      ]
    },
  },
  {
    name: "payment-retry",
    spec: "payment-retry.acts.architecture.json",
    title: "A soft decline should not lose the order (change as acts)",
    docs: [{ from: "payment-retry.sheets/payment-retry.acts.{theme}.png", to: "payment-retry.story.acts" }],
    blurb: "A code change told as two acts with `delta` membership (removed → today, added → the fix). Today: a soft-decline toast, the order is cancelled, the log annotation types the loss, “lost orders” goes to 1 and a failure toast tells the customer. Rewind. With a retry queue: a “retry scheduled” toast, the retry succeeds, “order confirmed ✓”, the log line turns sage and lost orders reads 0.",
    shots: (_sc, tl) => {
      const a = tl.acts?.[1]
      return [
        { at: r2(toastT0(tl, "toast-2-1") + 0.8), caption: "Soft decline toast near the payments API" },
        { at: r2(toastT0(tl, "failed") + 1.2), caption: "Order lost: log annotation typed, lost orders: 1, failure toast" },
        ...(a?.rewind ? [{ at: r2((a.rewind.t0 + a.rewind.t1) / 2), caption: "Rewind back to the start" }] : []),
        { at: r2(toastT0(tl, "toast-7-1") + 0.8), caption: "Retry scheduled toast near the queue", camera: "follow" as const },
        { at: "end", caption: "End: order paid on retry · lost orders: 0" },
      ]
    },
  },
]

const want = (e: Example) => !only || only.has(e.name)
fs.mkdirSync(out, { recursive: true })
// Fresh outputs for the examples rebuilt (other files in out/ are left alone).
for (const e of EXAMPLES.filter(want)) for (const f of fs.readdirSync(out)) if (f.startsWith(`${e.name}.`) || f === e.name) fs.rmSync(path.join(out, f), { recursive: true, force: true })

const cards: string[] = []
for (const e of EXAMPLES) {
  const rel = (f: string) => encodeURI(f)
  if (!want(e)) {
    // Keep the card for examples not rebuilt (their files are already in out/).
    if (fs.existsSync(path.join(out, `${e.name}.card.html`))) cards.push(fs.readFileSync(path.join(out, `${e.name}.card.html`), "utf8"))
    continue
  }
  const raw = JSON.parse(fs.readFileSync(path.join(src, e.spec), "utf8"))
  const v = validate(raw)
  for (const d of v.diagnostics) console.log(`  ${e.name}: ${d.severity} ${d.path}: ${d.message}`)
  if (!v.ok || !v.spec) throw new Error(`${e.spec} is invalid`)
  const sc = layout(v.spec as Spec)
  const tl = sc.timeline!
  const html = path.join(out, `${e.name}.html`)
  fs.writeFileSync(html, renderHtml(sc))
  fs.writeFileSync(path.join(out, `${e.name}.svg`), renderSvg(sc, { theme: "light" }))
  for (const theme of ["light", "dark"] as const) fs.writeFileSync(path.join(out, `${e.name}.anim.${theme}.svg`), renderAnimatedSvg(sc, { theme }))
  console.log(`${e.name}: ${tl.duration.toFixed(1)} s, ${tl.steps.length} steps${tl.acts ? `, ${tl.acts.length} acts` : ""}`)

  const snap = async (dir: string, opts: SnapshotOptions) => {
    const r = await snapshot(html, { outDir: path.join(out, dir), ...opts })
    if (!r.receipt) throw new Error(`snapshot ${e.name} failed: ${r.error}`)
    return r.receipt
  }
  const sheets: Shot[] = []
  const beats = await snap(`${e.name}.sheets`, { themes: ["light", "dark"], sheet: "beats", at: ["end"] })
  for (const c of beats.beats ?? []) sheets.push({ file: path.relative(out, c.png), caption: "Beat sheet", theme: c.png.includes("dark") ? "dark" : "light" })
  if (tl.acts) {
    const acts = await snap(`${e.name}.sheets`, { themes: ["light", "dark"], sheet: "acts", at: ["end"] })
    for (const c of acts.acts ?? []) sheets.push({ file: path.relative(out, c.png), caption: "Act sheet (problem | fix)", theme: c.png.includes("dark") ? "dark" : "light" })
  }
  const shots: Shot[] = []
  let k = 0
  for (const s of e.shots(sc, tl)) {
    const dir = `${e.name}.shots/${String(++k).padStart(2, "0")}`
    const themes = s.themes ?? ["light", "dark"]
    const r = await snap(dir, { themes, sheet: false, at: [s.at], ...(s.camera ? { camera: s.camera } : {}), ...(s.motion ? { motion: s.motion } : {}) })
    for (const c of r.captures) {
      const name = `${e.name}.shots/${String(k).padStart(2, "0")}.${c.theme}.png`
      fs.renameSync(c.png, path.join(out, name))
      shots.push({ file: name, caption: `${s.caption} (${s.at === "end" ? "end" : `t = ${s.at}s`}${s.camera ? ", follow camera" : ""}${s.motion ? ", reduced motion" : ""})`, theme: c.theme as "light" | "dark" })
    }
    fs.rmSync(path.join(out, dir), { recursive: true, force: true })
  }

  const img = (s: Shot) => `<figure class="${s.theme}"><a href="${rel(s.file)}"><img loading="lazy" src="${rel(s.file)}" alt="${esc(s.caption)}"></a><figcaption>${esc(s.caption)} · ${s.theme}</figcaption></figure>`
  const card = `<section id="${e.name}">
<h2>${esc(e.title)}</h2>
<p>${esc(e.blurb)}</p>
<p class="links"><a href="${rel(`${e.name}.html`)}">Interactive HTML</a> · <a href="${rel(`${e.name}.html`)}#theme=dark">dark</a> · <a href="${rel(`${e.name}.html`)}#motion=reduced">reduced motion</a>${tl.acts ? tl.acts.map((a) => ` · <a href="${rel(`${e.name}.html`)}#act=${a.id}">#act=${a.id}</a>`).join("") : ""} · <a href="${rel(`${e.name}.svg`)}">static SVG (end state)</a> · <a href="${rel(`${e.name}.anim.light.svg`)}">animated SVG light</a> · <a href="${rel(`${e.name}.anim.dark.svg`)}">dark</a></p>
<div class="anim"><figure class="light"><img src="${rel(`${e.name}.anim.light.svg`)}" alt="${esc(e.title)} (animated, light)"><figcaption>Animated SVG (SMIL) · light</figcaption></figure><figure class="dark"><img src="${rel(`${e.name}.anim.dark.svg`)}" alt="${esc(e.title)} (animated, dark)"><figcaption>Animated SVG (SMIL) · dark</figcaption></figure></div>
<h3>Captures</h3>
<div class="grid">${shots.map(img).join("\n")}</div>
<h3>Sheets</h3>
<div class="grid sheets">${sheets.map(img).join("\n")}</div>
</section>`
  fs.writeFileSync(path.join(out, `${e.name}.card.html`), card)
  if (docs)
    for (const d of e.docs ?? [])
      for (const theme of ["light", "dark"] as const) {
        const from = path.join(out, d.from.replace("{theme}", theme))
        const to = path.join(gallery, `${d.to}.${theme}${path.extname(from)}`)
        fs.copyFileSync(from, to)
        console.log(`  ${path.relative(root, to)} (${Math.round(fs.statSync(to).size / 1024)} KiB)`)
      }
  cards.push(card)
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

const index = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>storyink · story showcase (tones, acts, overlays)</title>
<style>
body{margin:0;padding:32px 40px 80px;background:#efeee9;color:#26241f;font:15px/1.5 ui-monospace,"SF Mono",Menlo,monospace;}
h1{font:500 30px/1.2 Georgia,serif;margin:0 0 6px;}h2{font:500 22px/1.25 Georgia,serif;margin:48px 0 6px;}h3{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#77736a;margin:22px 0 8px;}
p{max-width:980px;margin:6px 0;}a{color:#3b5f8a;}.links{font-size:13px;}
nav a{margin-right:14px;}section{border-top:1px solid #d3d0c8;margin-top:28px;}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:18px;}.grid.sheets{grid-template-columns:repeat(auto-fill,minmax(620px,1fr));}
.anim{display:grid;grid-template-columns:1fr 1fr;gap:18px;}
figure{margin:0;padding:8px;border:1px solid #d3d0c8;border-radius:6px;background:#f7f6f2;}figure.dark{background:#141413;border-color:#2b2a27;}
figure img{display:block;width:100%;height:auto;}figcaption{font-size:12px;color:#77736a;margin-top:6px;}figure.dark figcaption{color:#9a958b;}
</style></head><body>
<h1>storyink · story showcase</h1>
<p>Tones (colour carries meaning), acts (problem → rewind → fix) and overlays (node annotations, toasts, HUD metrics). Generated by <code>bun run gallery:stories</code>; everything is local (file://), nothing online. Open an HTML link to play a story (Space / → / ←, Shift+→ chapters).</p>
<nav>${EXAMPLES.map((e) => `<a href="#${e.name}">${esc(e.name)}</a>`).join("")}</nav>
${cards.join("\n")}
</body></html>
`
fs.writeFileSync(path.join(out, "index.html"), index)
console.log(`wrote ${path.relative(root, path.join(out, "index.html"))}`)
