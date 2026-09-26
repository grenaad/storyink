/**
 * Viewer checks in headless Chrome over CDP (wall clock):
 *  - every control by real mouse input (Input.dispatchMouseEvent) in full and reduced motion:
 *    gate, play/pause, replay, scrubber click + drag, −/+/Fit, theme, Motion, Frame, SVG/PNG export,
 *    plus a still click (inert) and a drag (pans) on the diagram surface;
 *  - live counter reels: never visible while their node is hidden (reel opacity ≤ node opacity),
 *    always inside their node's box; across full play from the gate, reduced → full mid-play,
 *    reload with the stored choice, resize and theme toggle;
 *  - OS prefers-reduced-motion with the author default (full): animated gate and real playback;
 *  - #motion=reduced: stepped playback with no pulse in flight.
 * Usage: bun scripts/viewer-verify.ts
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { loadSpec, writeDiagram } from "../src/node/index.ts"
import { session } from "./cdp.ts"

const root = path.resolve(import.meta.dir, "..")
const D = fs.mkdtempSync(path.join(os.tmpdir(), "storyink-viewer-"))
const html = path.join(D, "checkout.html")
writeDiagram(loadSpec(path.join(root, "examples/checkout.architecture.json")).spec, { html })
const url = `file://${html}`
const reelQ = `(()=>{const out=[];for(const r of document.querySelectorAll(".si-counter-live")){const id=r.dataset.node;const n=document.querySelector('.si-stage [data-si="node:'+id+'"]');const a=r.getBoundingClientRect(),b=n.getBoundingClientRect();const cs=getComputedStyle(r);const ro=cs.display==="none"?0:Number(cs.opacity);let no=1;for(let e=n;e&&e.tagName!=="svg";e=e.parentElement)no*=Number(getComputedStyle(e).opacity);const inside=a.left>=b.left-2&&a.right<=b.right+2&&a.top>=b.top-2&&a.bottom<=b.bottom+2;out.push({id,ro,no,inside})}return JSON.stringify(out)})()`
let fail = 0
async function watch(s: Awaited<ReturnType<typeof session>>, name: string, ms: number) {
  const t0 = Date.now()
  let n = 0
  let bad = 0
  let shown = 0
  while (Date.now() - t0 < ms) {
    for (const r of JSON.parse(await s.ev(reelQ)) as { ro: number; no: number; inside: boolean }[]) {
      n++
      if (r.ro > 0.01) shown++
      if (r.ro > r.no + 0.02 || (r.ro > 0.01 && !r.inside)) bad++
    }
    await Bun.sleep(40)
  }
  if (bad || !n) fail++
  console.log(`${bad || !n ? "FAIL" : "pass"} reels ${name}: ${n} samples, ${shown} visible, ${bad} visible-while-hidden or off-node`)
}
type S = Awaited<ReturnType<typeof session>>
const check = (ok: boolean, msg: string) => {
  if (!ok) fail++
  console.log(`${ok ? "pass" : "FAIL"} ${msg}`)
}
const state = async (s: S) => JSON.parse(await s.ev(`JSON.stringify(window.__storyink.state())`)) as { t: number; mode: string }
const cam = async (s: S) => JSON.parse(await s.ev(`(()=>{const m=new DOMMatrix(getComputedStyle(document.querySelector(".si-canvas")).transform);return JSON.stringify({k:m.a,x:m.e,y:m.f})})()`)) as { k: number; x: number; y: number }
const attr = (s: S, sel: string, a: string) => s.ev(`document.querySelector(${JSON.stringify(sel)})?.getAttribute(${JSON.stringify(a)}) ?? null`)
const PP = `.si-transport .si-tbtn:not(.si-replay)`
/** Every control, driven by real mouse input (Input.dispatchMouseEvent), in one motion mode. */
async function controls(s: S, motion: "full" | "reduced") {
  const tag = `[mouse ${motion}]`
  await s.go(url + `#motion=${motion}`)
  await s.ev(`localStorage.clear()`)
  await s.ev("location.reload()")
  await Bun.sleep(1400)
  const dur = Number(await s.ev(`window.__storyink.duration`))
  check((await state(s)).mode === "gate", `${tag} starts at the gate`)
  await s.click(".si-gate")
  await Bun.sleep(500)
  check((await state(s)).mode === "playing", `${tag} gate click plays`)
  await s.click(PP)
  await Bun.sleep(250)
  const p1 = await state(s)
  check(p1.mode === "paused", `${tag} transport click pauses while playing (${p1.mode})`)
  await s.click(PP)
  await Bun.sleep(400)
  check((await state(s)).mode === "playing", `${tag} transport click plays while paused`)
  await s.click(PP)
  // Scrubber: click at 50 %, then drag 20 % → 70 %.
  const bar = JSON.parse(await s.ev(`JSON.stringify(document.querySelector(".si-scrub").getBoundingClientRect())`))
  const at = (f: number) => ({ x: bar.x + bar.width * f, y: bar.y + bar.height / 2 })
  await s.click(at(0.5))
  await Bun.sleep(200)
  const sc = await state(s)
  const tol = motion === "reduced" ? dur * 0.25 : dur * 0.03
  check(sc.mode === "paused" && Math.abs(sc.t - dur * 0.5) < tol, `${tag} scrubber click seeks (t=${sc.t.toFixed(2)} of ${dur.toFixed(2)})`)
  await s.drag(at(0.2), at(0.7))
  await Bun.sleep(200)
  const sd = await state(s)
  check(Math.abs(sd.t - dur * 0.7) < tol, `${tag} scrubber drag seeks (t=${sd.t.toFixed(2)})`)
  // Ended: the play button gives way to replay.
  await s.click(at(0.999))
  await Bun.sleep(200)
  await s.ev(`window.__storyink.setTime("end")`)
  await Bun.sleep(200)
  check((await state(s)).mode === "ended" && !(await s.center(PP)), `${tag} ended hides play/pause`)
  await s.click(".si-replay")
  await Bun.sleep(300)
  const rp = await state(s)
  check(rp.mode === "rewinding" || rp.mode === "playing", `${tag} replay click restarts (${rp.mode})`)
  await s.click(PP)
  await Bun.sleep(200)
  // A still click on the surface changes nothing; a drag on the surface pans.
  const c0 = await cam(s)
  const st0 = await state(s)
  const surf = await s.ev(`(()=>{const r=document.querySelector(".si-stage").getBoundingClientRect();return JSON.stringify({x:r.x+r.width*0.5,y:r.y+r.height*0.35})})()`).then(JSON.parse)
  await s.click(surf)
  await Bun.sleep(200)
  const c1 = await cam(s)
  const st1 = await state(s)
  check(Math.abs(c1.x - c0.x) < 0.5 && st1.mode === st0.mode && !(await s.ev(`document.querySelector(".si-stage").classList.contains("si-dragging")`)), `${tag} still click on the surface is inert`)
  await s.drag(surf, { x: surf.x + 120, y: surf.y + 40 })
  await Bun.sleep(100)
  const c2 = await cam(s)
  check(Math.abs(c2.x - c1.x - 120) < 2 && Math.abs(c2.y - c1.y - 40) < 2, `${tag} surface drag pans (dx=${(c2.x - c1.x).toFixed(1)})`)
  // Toolbar.
  await s.click(`.si-tools button[aria-label="Fit"]`)
  await Bun.sleep(900)
  const fitK = (await cam(s)).k
  await s.click(`.si-tools button[aria-label="+"]`)
  await Bun.sleep(900)
  const kPlus = (await cam(s)).k
  await s.click(`.si-tools button[aria-label="−"]`)
  await Bun.sleep(900)
  await s.click(`.si-tools button[aria-label="−"]`)
  await Bun.sleep(900)
  const kMinus = (await cam(s)).k
  await s.click(`.si-tools button[aria-label="Fit"]`)
  await Bun.sleep(900)
  const kFit = (await cam(s)).k
  check(kPlus > fitK * 1.2 && kMinus < kPlus * 0.7 && Math.abs(kFit - fitK) < 0.01, `${tag} −/+/Fit zoom (${fitK.toFixed(3)} → + ${kPlus.toFixed(3)} → −− ${kMinus.toFixed(3)} → Fit ${kFit.toFixed(3)})`)
  const th0 = await s.ev(`document.documentElement.dataset.theme ?? ""`)
  await s.click(`.si-tools button[aria-label="Toggle theme"]`)
  await Bun.sleep(300)
  const th1 = await s.ev(`document.documentElement.dataset.theme ?? ""`)
  check(!!th1 && th1 !== th0, `${tag} theme click (${th0 || "system"} → ${th1})`)
  await s.click(`.si-tools button[aria-label="Toggle theme"]`)
  const fr0 = await s.ev(`[...document.querySelectorAll(".si-tools button")].find(b=>b.textContent.startsWith("Frame"))?.textContent`)
  const frameSel = `.si-tools button[aria-label^="Frame"]`
  await s.click(frameSel)
  await Bun.sleep(200)
  const fr1 = await attr(s, frameSel, "aria-label")
  check(fr0 === "Frame: end" && fr1 === "Frame: now", `${tag} Frame toggle (${fr0} → ${fr1})`)
  await s.click(frameSel)
  await s.click(`.si-tools button[aria-label="SVG"]`)
  await Bun.sleep(300)
  check((await s.ev(`window.__storyink.lastExport?.kind`)) === "svg", `${tag} SVG export click`)
  await s.click(`.si-tools button[aria-label="PNG"]`)
  await Bun.sleep(1200)
  check((await s.ev(`window.__storyink.lastExport?.kind`)) === "png", `${tag} PNG export click`)
  const mSel = `.si-tools button[aria-label^="Motion"]`
  const m0 = await attr(s, mSel, "aria-pressed")
  await s.click(mSel)
  await Bun.sleep(300)
  const m1 = await attr(s, mSel, "aria-pressed")
  check(m0 === String(motion === "reduced") && m1 === String(motion !== "reduced"), `${tag} Motion click (${m0} → ${m1})`)
  await s.ev(`localStorage.clear()`)
}
let s = await session(["--force-prefers-no-reduced-motion"])
// Download clicks from export must not open dialogs in headless Chrome.
await s.send("Browser.setDownloadBehavior", { behavior: "deny" })
await controls(s, "full")
await controls(s, "reduced")
await s.go(url.replace(/#.*/, "") + "#")
await s.ev(`localStorage.clear()`)
await s.ev("location.reload()")
await Bun.sleep(1400)
await s.click(".si-gate")
await watch(s, "full play from the gate", 12000)
s.close()
s = await session(["--force-prefers-reduced-motion"])
// OS reduced + author default "full": the animated gate, then real animation.
await s.go(url)
await s.ev(`localStorage.clear()`)
await s.go(url)
const gate = JSON.parse(await s.ev(`JSON.stringify({t: window.__storyink.state().t, rings: document.querySelectorAll(".si-gate-ring").length, label: document.querySelector("button[aria-pressed]")?.getAttribute("aria-label")})`))
await s.ev(`document.querySelector(".si-gate").click()`)
let flight = 0
for (let i = 0; i < 80; i++) {
  flight = Math.max(flight, Number(await s.ev(`document.querySelectorAll('.si-stage [data-si^="pulse:"]').length`)))
  await Bun.sleep(40)
}
const okFull = gate.rings === 2 && gate.t === 0 && gate.label === "Motion: full" && flight > 0
if (!okFull) fail++
console.log(`${okFull ? "pass" : "FAIL"} OS reduced + default full: gate t=${gate.t} rings=${gate.rings} "${gate.label}", pulses in flight during play (max ${flight})`)
// Explicit #motion=reduced: stepped playback.
await s.go(url + "#motion=reduced")
await s.ev("location.reload()")
await Bun.sleep(1200)
let pulses = 0
await s.ev(`document.querySelector(".si-gate").click()`)
for (let i = 0; i < 60; i++) {
  pulses += Number(await s.ev(`document.querySelectorAll('.si-stage [data-si^="pulse:"]').length`))
  await Bun.sleep(50)
}
if (pulses) fail++
console.log(`${pulses ? "FAIL" : "pass"} reduced: stepped playback, ${pulses} pulse samples in flight over 3 s`)
await s.ev(`document.querySelector('button[aria-pressed]').click()`)
await watch(s, "reduced → full mid-play", 4000)
await s.go(url.replace(/#.*/, "") + "#")
await s.ev(`document.querySelector(".si-gate").click()`)
await watch(s, "reload (stored full), play", 3000)
await s.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false })
await s.ev(`document.querySelector('button[aria-label="Toggle theme"]').click()`)
await watch(s, "after resize + theme toggle", 7000)
s.close()
fs.rmSync(D, { recursive: true, force: true })
process.exit(fail ? 1 : 0)
