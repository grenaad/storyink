/**
 * Viewer checks in headless Chrome over CDP (wall clock):
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
let s = await session(["--force-prefers-no-reduced-motion"])
await s.go(url)
await s.ev(`localStorage.clear()`)
await s.go(url)
await s.ev(`document.querySelector(".si-gate").click()`)
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
