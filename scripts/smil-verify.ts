/**
 * Verify animated SVGs in headless Chrome:
 *  1. frame parity: SMIL paused at t (setCurrentTime) vs the static render of storyState(t)
 *     (the frame function the HTML viewer draws), PSNR via ffmpeg, over step boundaries and mid-steps;
 *  2. <img> mode animates: an <img src=x.svg> page screenshotted at two wall-clock moments differs;
 *     also with prefers-reduced-motion: reduce;
 *  3. embedded font renders in <img> mode (embed vs system final frames differ).
 *  4. (--rich) the 0.4 rich examples (checkout-recovery, code-mode, failover, retry-helper, agent-session), both themes: parity over steps and mid-steps, <img>
 *     animation, loop return (an <img> one cycle later shows the start again, future rows hidden),
 *     and (--browsers) <img> animation in Firefox / Safari via WebDriver when available.
 * Usage: bun scripts/smil-verify.ts [--quick] [--out dir] [--rich [--only-rich] [--only name,…]] [--browsers]
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
/** Screenshot with one retry: the headless shell occasionally exits without writing the PNG. */
const shot = async (html: string, png: string, size: { width: number; height: number }) => {
  for (let i = 0; i < 2; i++) {
    fs.rmSync(png, { force: true })
    await screenshotPage(html, png, size, { budgetMs: 300 })
    if (fs.existsSync(png) && fs.statSync(png).size > 0) return
  }
}
const psnr = (a: string, b: string): number => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-i", a, "-i", b, "-lavfi", "psnr", "-f", "null", "-"], { encoding: "utf8" })
  const m = /average:(\S+)/.exec(r.stderr)
  return m ? (m[1] === "inf" ? Infinity : Number(m[1])) : NaN
}
const strip = (s: string) => s.replace(/^<\?xml[^>]*>\n/, "")
let fail = 0
const report: string[] = []

const RICH_ALL = [
  ["checkout-recovery.architecture", "examples/checkout-recovery.architecture.json"],
  ["code-mode.architecture", "examples/code-mode.architecture.json"],
  ["failover.dataflow", "examples/failover.dataflow.json"],
  ["retry-helper.architecture", "examples/retry-helper.architecture.json"],
  ["agent-session.architecture", "examples/agent-session.architecture.json"],
] as const
// --only name,name limits the rich set (e.g. one new example).
const oni = process.argv.indexOf("--only")
const onlyNames = oni > 0 ? new Set(process.argv[oni + 1].split(",")) : undefined
const RICH = RICH_ALL.filter(([n]) => !onlyNames || onlyNames.has(n))
const onlyRich = process.argv.includes("--only-rich")
const withRich = onlyRich || process.argv.includes("--rich")
// ANIMATED includes the 0.4 rich examples (RICH); --only-rich limits parity to them.
const SETS = onlyRich ? RICH : ANIMATED
for (const [name, file] of SETS) {
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
      await shot(`${D}/${tag}.smil.html`, `${D}/${tag}.smil.png`, { width: vb.w, height: vb.h })
      await shot(`${D}/${tag}.ref.html`, `${D}/${tag}.ref.png`, { width: vb.w, height: vb.h })
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

// Rich: <img> animates, and loops back to the start (future rows hidden again).
if (withRich) {
  for (const [name0, file] of RICH)
  for (const theme of ["dark", "light"] as const) {
    const name = `${name0}.${theme}`
    const spec = loadSpec(path.join(root, file)).spec!
    const info = animatedSvg(spec, { theme, font: "embed" })
    fs.writeFileSync(`${D}/${name}.img.svg`, info.svg)
    fs.writeFileSync(`${D}/${name}.img.html`, `<!doctype html><body style="margin:0;background:${theme === "dark" ? "#000" : "#fff"}"><img id="i" src="${name}.img.svg"></body>`)
    // Inline references at t = 0.2 and t = 0.2 + one cycle (the loop return), header included.
    const ref = (t: number, tag: string) => {
      fs.writeFileSync(`${D}/${name}.${tag}.html`, `<!doctype html><body style="margin:0;background:${theme === "dark" ? "#000" : "#fff"}">${strip(info.svg).replace("<svg ", '<svg id="s" ')}<script>var s=document.getElementById("s");s.pauseAnimations();s.setCurrentTime(${t});</script></body>`)
    }
    ref(0.2, "ref0")
    const scene = toScene(spec)
    const size = { width: scene.viewBox.w, height: scene.viewBox.h + animatedHeaderHeight(scene) }
    await shot(`${D}/${name}.ref0.html`, `${D}/${name}.ref0.png`, size)
    // Deterministic loop return: the inline document clock one cycle later shows the t = 0.2 frame.
    ref(info.cycle + 0.2, "refloop")
    await shot(`${D}/${name}.refloop.html`, `${D}/${name}.refloop.png`, size)
    const pd = psnr(`${D}/${name}.refloop.png`, `${D}/${name}.ref0.png`)
    // Wall clock (<img>, no script): shots during the first second, mid-story, and just after the first loop.
    const waits = [0.25, 8, info.cycle + 0.3]
    const out = `${D}/${name}.img`
    await wallShots(`file://${D}/${name}.img.html`, { width: Math.ceil(size.width), height: Math.ceil(size.height), selector: "#i", waits, out })
    const moved = sha(`${out}.0.png`) !== sha(`${out}.1.png`)
    const pl = psnr(`${out}.2.png`, `${D}/${name}.ref0.png`)
    // The <img> clock starts at image load, not at navigation, so the wall-clock shot lands somewhere
    // in the first ~0.8 s of the second cycle (the stories start moving at 0.3 s). Match it against
    // inline frames over that window and report the best one and its offset (not a relaxed threshold).
    let best = { t: 0.2, p: pl }
    if (pl < END_THRESHOLD)
      for (const t of [0, 0.1, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) {
        ref(t, `refw${t}`)
        await shot(`${D}/${name}.refw${t}.html`, `${D}/${name}.refw${t}.png`, size)
        const p = psnr(`${out}.2.png`, `${D}/${name}.refw${t}.png`)
        if (p > best.p) best = { t, p }
      }
    const fmt = (v: number) => (v === Infinity ? "identical" : `${v.toFixed(1)} dB`)
    const ok = moved && pd >= END_THRESHOLD && best.p >= THRESHOLD
    if (!ok) fail++
    report.push(`img ${name}: ${moved ? "animates" : "STATIC"}; inline t=cycle+0.2 vs t=0.2 ${fmt(pd)}; <img> after one loop (${info.cycle.toFixed(1)} s) vs t=0.2 ${fmt(pl)}${best.t !== 0.2 ? `, best match t=${best.t} ${fmt(best.p)}` : ""} ${ok ? "PASS" : "FAIL"} (${(info.bytes / 1024).toFixed(1)} KiB embed)`)
    console.log(report[report.length - 1])
  }
  if (process.argv.includes("--browsers")) await otherBrowsers()
}
if (onlyRich) {
  fs.writeFileSync(`${D}/report.txt`, `${report.join("\n")}\n`)
  console.log(`report ${D}/report.txt`)
  process.exit(fail ? 1 : 0)
}

/** <img> animation in Firefox (geckodriver) and Safari (safaridriver) when available: two shots differ. */
async function otherBrowsers() {
  const page = `file://${D}/code-mode.architecture.dark.img.html`
  for (const [b, bin, port, caps] of [
    ["firefox", "geckodriver", 4455, { browserName: "firefox", "moz:firefoxOptions": { args: ["-headless"] } }],
    ["safari", "safaridriver", 4456, { browserName: "safari" }],
  ] as const) {
    const which = spawnSync("which", [bin], { encoding: "utf8" }).stdout.trim()
    if (!which) {
      report.push(`img ${b}: NOT TESTED (${bin} not found)`)
      console.log(report[report.length - 1])
      continue
    }
    const proc = Bun.spawn([which, "--port", String(port)], { stdout: "ignore", stderr: "ignore" })
    try {
      await Bun.sleep(1500)
      const api = `http://127.0.0.1:${port}`
      const res = await fetch(`${api}/session`, { method: "POST", body: JSON.stringify({ capabilities: { alwaysMatch: caps } }), headers: { "content-type": "application/json" } }).then((r) => r.json() as Promise<any>)
      const sid = res.value?.sessionId
      if (!sid) {
        report.push(`img ${b}: NOT TESTED (${String(res.value?.message ?? "no session").split("\n")[0]})`)
        console.log(report[report.length - 1])
        continue
      }
      const cmd = (p: string, body?: unknown) => fetch(`${api}/session/${sid}${p}`, { method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined, headers: { "content-type": "application/json" } }).then((r) => r.json() as Promise<any>)
      await cmd("/window/rect", { width: 1400, height: 800 })
      await cmd("/url", { url: page })
      const shots: string[] = []
      for (const w of [1.5, 6]) {
        await Bun.sleep(w === 1.5 ? 1500 : 4500)
        shots.push((await cmd("/screenshot")).value)
      }
      fs.writeFileSync(`${D}/img.${b}.0.png`, Buffer.from(shots[0], "base64"))
      fs.writeFileSync(`${D}/img.${b}.1.png`, Buffer.from(shots[1], "base64"))
      const moved = shots[0] !== shots[1]
      if (!moved) fail++
      report.push(`img ${b}: ${moved ? "animates (shots at 1.5 s and 6 s differ)" : "STATIC"}`)
      console.log(report[report.length - 1])
      await fetch(`${api}/session/${sid}`, { method: "DELETE" })
    } catch (e) {
      report.push(`img ${b}: NOT TESTED (${(e as Error).message})`)
      console.log(report[report.length - 1])
    } finally {
      proc.kill()
    }
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
