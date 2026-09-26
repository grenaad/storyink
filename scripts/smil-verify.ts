/**
 * Verify animated SVGs in headless Chrome:
 *  1. frame parity: SMIL paused at t (setCurrentTime) vs the static render of storyState(t)
 *     (the frame function the HTML viewer draws), PSNR via ffmpeg, over step boundaries and mid-steps;
 *  2. <img> mode animates: an <img src=x.svg> page screenshotted at two wall-clock moments differs;
 *     also with prefers-reduced-motion: reduce;
 *  3. embedded font renders in <img> mode (embed vs system final frames differ).
 * Usage: bun scripts/smil-verify.ts [--quick] [--out dir]
 */
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { animatedHeaderHeight, animatedSvg, renderSvg, toScene } from "../src/core/index.ts"
import { loadSpec, screenshotPage } from "../src/node/index.ts"
import { ANIMATED } from "./animated-gallery.ts"
import { wallShots } from "./cdp.ts"

const root = path.resolve(import.meta.dir, "..")
const oi = process.argv.indexOf("--out")
const D = oi > 0 ? path.resolve(process.argv[oi + 1]) : fs.mkdtempSync(path.join(os.tmpdir(), "storyink-smil-"))
fs.mkdirSync(D, { recursive: true })
const quick = process.argv.includes("--quick")
// Mid-story frames: ≥ 35 dB (sub-pixel keyframe interpolation). Final frame: ≥ 60 dB (identical or ±1 level AA noise).
const THRESHOLD = 35
const END_THRESHOLD = 60
const sha = (f: string) => createHash("sha256").update(fs.readFileSync(f)).digest("hex")
const psnr = (a: string, b: string): number => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-i", a, "-i", b, "-lavfi", "psnr", "-f", "null", "-"], { encoding: "utf8" })
  const m = /average:(\S+)/.exec(r.stderr)
  return m ? (m[1] === "inf" ? Infinity : Number(m[1])) : NaN
}
const strip = (s: string) => s.replace(/^<\?xml[^>]*>\n/, "")
let fail = 0
const report: string[] = []

for (const [name, file] of ANIMATED) {
  const l = loadSpec(path.join(root, file))
  const spec = { ...l.spec!, story: l.spec!.story ?? ("auto" as const) }
  const scene = toScene(spec)
  const tl = scene.timeline!
  const vb = scene.viewBox
  const hh = animatedHeaderHeight(scene)
  let ts = [0.2, ...tl.steps.flatMap((s) => [s.t0 + 0.05, (s.t0 + s.t1) / 2, s.t1]), tl.duration]
  if (quick) ts = ts.filter((_, i) => i % 4 === 0).concat(tl.duration)
  for (const theme of ["light", "dark"] as const) {
    const svg = strip(animatedSvg(spec, { theme, font: "embed" }).svg)
    const vals: [number, number][] = []
    for (const t of ts) {
      const tag = `${name}.${theme}.t${t.toFixed(2)}`
      const box = (inner: string, js = "") => `<!doctype html><body style="margin:0"><div style="width:${vb.w}px;height:${vb.h}px;overflow:hidden">${inner}</div>${js}</body>`
      fs.writeFileSync(`${D}/${tag}.smil.html`, box(`<div style="margin-top:-${hh}px">${svg}</div>`, `<script>var s=document.querySelector("svg");s.pauseAnimations();s.setCurrentTime(${t});</script>`))
      fs.writeFileSync(`${D}/${tag}.ref.html`, box(strip(renderSvg(spec, { theme, t }))))
      await screenshotPage(`${D}/${tag}.smil.html`, `${D}/${tag}.smil.png`, { width: vb.w, height: vb.h }, { budgetMs: 300 })
      await screenshotPage(`${D}/${tag}.ref.html`, `${D}/${tag}.ref.png`, { width: vb.w, height: vb.h }, { budgetMs: 300 })
      vals.push([t, psnr(`${D}/${tag}.smil.png`, `${D}/${tag}.ref.png`)])
    }
    const min = Math.min(...vals.map((v) => v[1]))
    const end = vals[vals.length - 1][1]
    const ok = min >= THRESHOLD && end >= END_THRESHOLD
    if (!ok) fail++
    const med = [...vals.map((v) => v[1])].sort((a, b) => a - b)[Math.floor(vals.length / 2)]
    report.push(`parity ${name} ${theme}: ${vals.length} frames, min ${min.toFixed(1)} dB, median ${med.toFixed(1)} dB, t=end ${end === Infinity ? "identical" : `${end.toFixed(1)} dB`} ${ok ? "PASS" : "FAIL"}`)
    report.push(`  ${vals.map(([t, v]) => `${t.toFixed(2)}:${v === Infinity ? "inf" : v.toFixed(1)}`).join(" ")}`)
    console.log(report.slice(-2).join("\n"))
  }
}

// <img> mode: wall-clock animation, reduced motion, embedded font.
const [name, file] = ANIMATED[0]
const spec = { ...loadSpec(path.join(root, file)).spec! }
for (const [theme, font] of [["light", "embed"], ["dark", "system"]] as const) {
  fs.writeFileSync(`${D}/x.${theme}.${font}.svg`, animatedSvg(spec, { theme, font }).svg)
  fs.writeFileSync(`${D}/img.${theme}.${font}.html`, `<!doctype html><body style="margin:0;background:#888"><img id="i" src="x.${theme}.${font}.svg"></body>`)
  for (const reduced of [false, true]) {
    const out = `${D}/img.${theme}.${font}${reduced ? ".reduced" : ""}`
    await wallShots(`file://${D}/img.${theme}.${font}.html`, { width: 1600, height: 900, selector: "#i", waits: [2.5, 6], out, reducedMotion: reduced })
    const moved = sha(`${out}.0.png`) !== sha(`${out}.1.png`)
    if (!moved && !reduced) fail++
    report.push(`img ${theme}/${font}${reduced ? " (prefers-reduced-motion: reduce)" : ""}: ${moved ? "animates (frames at 2.5 s and 6 s differ)" : "STATIC"}`)
    console.log(report[report.length - 1])
  }
}
// Font: once-mode final frames with embed vs system must differ (Commit Mono is not a system font here).
for (const font of ["embed", "system"] as const) {
  fs.writeFileSync(`${D}/f.${font}.svg`, animatedSvg(spec, { theme: "light", font, once: true }).svg)
  fs.writeFileSync(`${D}/f.${font}.html`, `<!doctype html><body style="margin:0"><img id="i" src="f.${font}.svg"></body>`)
  await screenshotPage(`${D}/f.${font}.html`, `${D}/f.${font}.png`, { width: 1600, height: 900 }, { budgetMs: 30000 })
}
const fontOk = sha(`${D}/f.embed.png`) !== sha(`${D}/f.system.png`)
report.push(`font: embedded Commit Mono ${fontOk ? "renders in <img> (differs from the system-mono frame)" : "NOT distinguishable from system mono"}`)
console.log(report[report.length - 1])
fs.writeFileSync(`${D}/report.txt`, `${report.join("\n")}\n`)
console.log(`report ${D}/report.txt`)
process.exit(fail ? 1 : 0)
