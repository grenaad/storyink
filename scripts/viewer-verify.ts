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
import { beatChapters, beatGroups, beatStops, fitCamera, readableScale, stepFocus, toScene, toScreen, validate } from "../src/core/index.ts"
import { loadSpec, writeDiagram } from "../src/node/index.ts"
import { largeSpec } from "../test/fixtures/large.ts"
import { killAll, session } from "./cdp.ts"

// Chrome is always killed: cdp.ts hooks exit / signals / uncaught errors and runs a watchdog.
// A hard deadline turns a hang into a failure (and a clean exit).
setTimeout(() => {
  console.error("FAIL viewer-verify: deadline (15 min) exceeded")
  killAll()
  process.exit(1)
}, 15 * 60_000).unref()

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
// ── Follow camera on a large architecture diagram (25 nodes in 5 groups) ──
const largeHtml = path.join(D, "large.html")
const largeScene = toScene(largeSpec())
writeDiagram(validate(largeSpec()).spec!, { html: largeHtml })
const lurl = `file://${largeHtml}`
type Cam = { k: number; x: number; y: number; goal: { k: number; x: number; y: number }; step: number; engaged: boolean; suspended: number | null; userK: number | null; follow: boolean; viewport: { w: number; h: number; bottom: number } }
const camera = async (s: S) => JSON.parse(await s.ev(`JSON.stringify(window.__storyink.camera())`)) as Cam
const onScreen = (c: { k: number; x: number; y: number }, vp: Cam["viewport"], step: number) => {
  const f = stepFocus(largeScene, largeScene.timeline!, step)
  if (!f) return true
  const b = toScreen(c, largeScene.viewBox, f)
  return b.x >= -1 && b.y >= -1 && b.x + b.w <= vp.w + 1 && b.y + b.h <= vp.h - vp.bottom + 1
}
async function followChecks(s: S) {
  const tag = "[follow]"
  await s.go(lurl)
  await s.ev(`localStorage.clear()`)
  await s.ev("location.reload()")
  await Bun.sleep(1400)
  const c0 = await camera(s)
  const fit = fitCamera(largeScene.viewBox, c0.viewport)
  check(c0.follow && Math.abs(c0.k - fit.k) < 1e-3, `${tag} loads at fit (k=${c0.k.toFixed(3)}), Follow on by default`)
  // Play from the transport button (not the gate).
  await s.click(PP)
  await Bun.sleep(1500)
  const c1 = await camera(s)
  const readable = readableScale(largeScene.viewBox, c1.viewport)
  check((await state(s)).mode === "playing" && Math.abs(c1.k - readable) < 0.01, `${tag} transport Play zooms to the readable scale (k=${c1.k.toFixed(3)}, labels ${(c1.k * 11).toFixed(1)} px)`)
  // Sample the whole play: goals distinct, the active step always on screen once settled.
  const goals = new Set<string>()
  let bad = 0
  let settledSamples = 0
  let lastStep = -1
  let since = Date.now()
  let dragged = false
  let dragStep = -1
  let dragGoal = ""
  let heldDuringDrag = true
  let resumed = false
  while ((await state(s)).mode === "playing") {
    const c = await camera(s)
    if (c.step !== lastStep) {
      lastStep = c.step
      since = Date.now()
    }
    goals.add(`${c.goal.x},${c.goal.y},${c.goal.k}`)
    if (!dragged && c.step >= 6) {
      // Drag the diagram mid-play: follow suspends for this step.
      dragged = true
      dragStep = c.step
      const st = await s.ev(`(()=>{const r=document.querySelector(".si-stage").getBoundingClientRect();return JSON.stringify({x:r.x+r.width*0.3,y:r.y+r.height*0.4})})()`).then(JSON.parse)
      await s.drag(st, { x: st.x, y: st.y + 260 })
      const cd = await camera(s)
      dragGoal = `${cd.goal.x},${cd.goal.y}`
      check(cd.suspended === dragStep, `${tag} drag during play suspends follow at step ${dragStep} (suspended=${cd.suspended})`)
      since = Date.now()
      continue
    }
    if (dragged && !resumed) {
      if (c.step === dragStep && `${c.goal.x},${c.goal.y}` !== dragGoal) heldDuringDrag = false
      if (c.step !== dragStep && `${c.goal.x},${c.goal.y}` !== dragGoal) resumed = true
    } else if (Date.now() - since > 900 && c.step > 0 && c.engaged) {
      settledSamples++
      if (!onScreen(c, c.viewport, c.step)) { bad++; if (process.env.DEBUG) console.log("off", c.step, JSON.stringify(c), JSON.stringify(stepFocus(largeScene, largeScene.timeline!, c.step))) }
    }
    await Bun.sleep(150)
  }
  check(goals.size >= 4, `${tag} camera moved between ${goals.size} regions while playing`)
  check(settledSamples >= 5 && bad === 0, `${tag} active step on screen once the camera settles (${settledSamples} samples, ${bad} off)`)
  check(dragged && heldDuringDrag, `${tag} camera held where the reader dragged it for the rest of step ${dragStep}`)
  check(resumed, `${tag} follow resumed on a later out-of-view step`)
  await Bun.sleep(1200)
  const ce = await camera(s)
  check(Math.abs(ce.k - fit.k) < 0.005 && Math.abs(ce.x - fit.x) < 1 && Math.abs(ce.y - fit.y) < 1, `${tag} end eases back to fit (k=${ce.k.toFixed(3)})`)
  // Seek by scrubber click (reader seek): the camera goes to that step's focus.
  const bar = JSON.parse(await s.ev(`JSON.stringify(document.querySelector(".si-scrub").getBoundingClientRect())`))
  await s.click({ x: bar.x + bar.width * 0.62, y: bar.y + bar.height / 2 })
  await Bun.sleep(1300)
  const cs = await camera(s)
  check(cs.k > fit.k * 1.3 && onScreen(cs, cs.viewport, cs.step), `${tag} scrubber seek follows to step ${cs.step} (k=${cs.k.toFixed(3)})`)
  // Follow toggle: click, persisted across reload, F key flips it back.
  const fSel = `.si-tools button[aria-label="Follow"]`
  await s.click(fSel)
  await Bun.sleep(200)
  const off = (await attr(s, fSel, "aria-pressed")) === "false" && (await s.ev(`localStorage.getItem("storyink-follow")`)) === "off"
  await s.ev("location.reload()")
  await Bun.sleep(1400)
  const offAfter = (await attr(s, fSel, "aria-pressed")) === "false"
  await s.click(".si-gate")
  await Bun.sleep(2000)
  const still = await camera(s)
  const noFollow = Math.abs(still.k - fit.k) < 1e-3
  await s.key("f", "KeyF")
  await Bun.sleep(200)
  const onAgain = (await attr(s, fSel, "aria-pressed")) === "true" && (await s.ev(`localStorage.getItem("storyink-follow")`)) === "on"
  check(off && offAfter && noFollow && onAgain, `${tag} Follow toggle: click off (${off}), persists over reload (${offAfter}), stays at fit when off (${noFollow}), F turns it on (${onAgain})`)
  // Reduced motion: the camera jumps (no easing between steps).
  await s.ev(`localStorage.clear()`)
  await s.go(lurl + "#motion=reduced")
  await s.ev("location.reload()")
  await Bun.sleep(1400)
  await s.click(".si-gate")
  let n = 0
  let eased = 0
  const seen = new Set<number>()
  const t0 = Date.now()
  // Until the camera has jumped a few times (or 25 s), so a slow machine still sees steps advance.
  while (Date.now() - t0 < 25000 && seen.size < 3) {
    const c = await camera(s)
    n++
    seen.add(c.goal.y)
    if (Math.abs(c.x - c.goal.x) > 0.5 || Math.abs(c.y - c.goal.y) > 0.5 || Math.abs(c.k - c.goal.k) > 1e-3) eased++
    await Bun.sleep(60)
  }
  check(eased === 0 && seen.size >= 2, `${tag} reduced: camera jumps between ${seen.size} positions (${eased}/${n} samples mid-move)`)
  await s.ev(`localStorage.clear()`)
}

// ── Animated step moves by real keyboard (→ / ←, Shift for chapters) ──
type Step = { t0: number; t1: number; stop?: string }
async function sampleUntilStill(s: S, ms = 6000) {
  const out: { w: number; t: number; mode: string }[] = []
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const st = await state(s)
    out.push({ w: Date.now() - t0, ...st })
    if (out.length > 3 && st.mode !== "playing") break
    await Bun.sleep(25)
  }
  return out
}
/** |Δt| / Δwall over the middle half of a sampled move (skips the ease). */
const midRate = (xs: { w: number; t: number }[]) => {
  const inner = xs.slice(Math.floor(xs.length * 0.25), Math.ceil(xs.length * 0.75))
  return inner.length > 1 ? Math.abs(inner[0].t - inner.at(-1)!.t) / ((inner.at(-1)!.w - inner[0].w) / 1000) : 0
}
async function stepChecks(s: S) {
  const tag = "[keys]"
  await s.go(url + "#motion=full")
  await s.ev(`localStorage.clear()`)
  await s.ev("location.reload()")
  await Bun.sleep(1400)
  // Moves land on settled beats (core `beatStops`); B[k] is beat k's stop, the last is the end.
  const ckTl = toScene(loadSpec(path.join(root, "examples/checkout.architecture.json")).spec).timeline!
  const B = beatStops(ckTl)
  const dur = Number(await s.ev(`window.__storyink.duration`))
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-3
  const mid = (B[1] + B[2]) / 2
  await s.ev(`window.__storyink.setTime(${mid})`)
  await Bun.sleep(200)
  await s.key("ArrowRight")
  const f = await sampleUntilStill(s)
  const fEnd = f.at(-1)!
  const fMid = f.filter((x) => x.t > mid + 0.02 && x.t < B[2] - 0.02)
  const mono = f.every((x, i) => i === 0 || x.t >= f[i - 1].t - 1e-9)
  check(fMid.length >= 5 && mono && fEnd.mode === "paused" && near(fEnd.t, B[2]), `${tag} → animates ${mid.toFixed(2)} → ${fEnd.t.toFixed(3)} (next beat stop ${B[2]}) through ${fMid.length} intermediate times, then pauses`)
  // ← from mid-step: backwards at ~2× to the previous boundary.
  const mid2 = (B[3] + B[4]) / 2
  await s.ev(`window.__storyink.setTime(${mid2})`)
  await Bun.sleep(200)
  await s.key("ArrowLeft")
  const b = await sampleUntilStill(s)
  const bEnd = b.at(-1)!
  const bMid = b.filter((x) => x.t < mid2 - 0.02 && x.t > B[3] + 0.02)
  const dec = b.every((x, i) => i === 0 || x.t <= b[i - 1].t + 1e-9)
  const rate = midRate(bMid)
  // A short move is mostly ease; the 2× cruise is measured on the long Shift+← rewind below.
  check(bMid.length >= 4 && dec && bEnd.mode === "paused" && near(bEnd.t, B[3]) && rate > 1.2 && rate < 2.4, `${tag} ← rewinds ${mid2.toFixed(2)} → ${bEnd.t.toFixed(3)} (previous beat stop ${B[3]}) at ${rate.toFixed(2)}× through ${bMid.length} intermediate times`)
  // Repeated → extends the target.
  await s.ev(`window.__storyink.setTime(${B[0] + 0.05})`)
  await Bun.sleep(200)
  await s.key("ArrowRight")
  await Bun.sleep(150)
  await s.key("ArrowRight")
  const tgt = JSON.parse(await s.ev(`JSON.stringify(window.__storyink.stepAnimated())`))
  const r = (await sampleUntilStill(s, 9000)).at(-1)!
  check(tgt?.target === B[2] && near(r.t, B[2]) && r.mode === "paused", `${tag} →→ extends to the boundary after next (${r.t.toFixed(3)} = ${B[2]})`)
  // Opposite key mid-move reverses toward the adjacent boundary.
  await s.ev(`window.__storyink.setTime(${B[2]})`)
  await Bun.sleep(200)
  await s.key("ArrowRight")
  await Bun.sleep(350)
  await s.key("ArrowLeft")
  const o = (await sampleUntilStill(s)).at(-1)!
  check(near(o.t, B[2]) && o.mode === "paused", `${tag} → then ← reverses back to ${o.t.toFixed(3)} (adjacent beat stop ${B[2]})`)
  // Space pauses a move.
  await s.ev(`window.__storyink.setTime(${B[1]})`)
  await Bun.sleep(200)
  await s.key("ArrowRight")
  await Bun.sleep(250)
  await s.key(" ", "Space")
  await Bun.sleep(150)
  const sp = await state(s)
  await Bun.sleep(300)
  const sp2 = await state(s)
  check(sp.mode === "paused" && sp.t > B[1] + 0.05 && sp.t < B[2] - 0.02 && sp2.t === sp.t, `${tag} space pauses a move mid-way (t=${sp.t.toFixed(2)})`)
  // Shift+→ / Shift+← go by chapter.
  const chapters = [0, ...beatChapters(ckTl)]
  await s.ev(`window.__storyink.setTime(${B[0] + 0.1})`)
  await Bun.sleep(200)
  const c0 = (await state(s)).t
  const nextCh = chapters.find((x) => x > c0 + 0.02)!
  await s.key("ArrowRight", "ArrowRight", true)
  const sc = (await sampleUntilStill(s, 15000)).at(-1)!
  await s.key("ArrowLeft", "ArrowLeft", true)
  const prevCh = [...chapters].reverse().find((x) => x < sc.t - 0.02)!
  const sbs = await sampleUntilStill(s, 15000)
  const sb = sbs.at(-1)!
  const cruise = midRate(sbs.filter((x) => x.mode === "playing"))
  check(cruise > 1.8 && cruise < 2.2, `${tag} ← cruises at ${cruise.toFixed(2)}× story speed (${(sc.t - prevCh).toFixed(2)} s rewind)`)
  check(near(sc.t, nextCh) && near(sb.t, prevCh), `${tag} Shift+→ plays to chapter ${nextCh} (${sc.t.toFixed(3)}), Shift+← rewinds to ${prevCh} (${sb.t.toFixed(3)})`)
  // Page API: __storyink.step(dir) animates the same way and resolves when the move ends.
  await s.ev(`window.__storyink.setTime(${B[3] + 0.05})`)
  await Bun.sleep(200)
  const api = JSON.parse(await s.ev(`window.__storyink.step(1).then(()=>JSON.stringify({...window.__storyink.state(), moving: window.__storyink.stepAnimated()}))`))
  check(near(api.t, B[4]) && api.mode === "paused" && api.moving === null, `${tag} __storyink.step(1) resolves paused at ${api.t.toFixed(3)} (beat stop ${B[4]})`)
  // Reduced motion: → jumps between settled steps.
  await s.go(url + "#motion=reduced")
  await s.ev("location.reload()")
  await Bun.sleep(1400)
  await s.ev(`window.__storyink.setTime(0)`)
  await Bun.sleep(200)
  const r0 = (await state(s)).t
  await s.key("ArrowRight")
  const rs = await sampleUntilStill(s, 800)
  const distinct = new Set(rs.map((x) => x.t.toFixed(4)))
  check(distinct.size === 1 && rs[0].t > r0 && rs.every((x) => x.mode === "paused"), `${tag} reduced: → jumps ${r0.toFixed(2)} → ${rs[0].t.toFixed(3)} (no intermediate times)`)
}
// ── → lands on a settled beat: the pulse's target box is visible (OpenWick architecture) ──
const owSpec = JSON.parse(fs.readFileSync(path.join(root, "test/fixtures/openwick-architecture.json"), "utf8"))
const owScene = toScene(owSpec)
const owHtml = path.join(D, "openwick.html")
writeDiagram(validate(owSpec).spec!, { html: owHtml })
async function beatChecks(s: S) {
  const tag = "[keys beats]"
  await s.go(`file://${owHtml}#motion=full&camera=fit`)
  await s.ev(`localStorage.clear()`)
  await s.ev("location.reload()")
  await Bun.sleep(1500)
  const tl = owScene.timeline!
  const B = beatStops(tl)
  const G = beatGroups(tl)
  // Beats whose pulse arrives at a box.
  const cases = G.map((g, k) => ({ k, targets: tl.pulses.filter((p) => g.some((i) => p.id.startsWith(`pulse-${i}-`)) && p.target && owScene.nodes.some((n) => n.id === p.target)).map((p) => p.target!) })).filter((x) => x.targets.length && x.k > 0).slice(0, 8)
  const vis = (id: string) => `(()=>{const n=document.querySelector('.si-stage [data-si="node:${id}"]');if(!n)return -1;let o=1;for(let e=n;e&&!e.classList?.contains('si-stage');e=e.parentElement)o*=Number(getComputedStyle(e).opacity);return o})()`
  let bad: string[] = []
  for (const c of cases) {
    await s.ev(`window.__storyink.setTime(${B[c.k - 1]})`)
    await Bun.sleep(150)
    await s.key("ArrowRight")
    const end = (await sampleUntilStill(s, 8000)).at(-1)!
    await Bun.sleep(120)
    // A dot in flight (the arrival ring and cooling trail may still fade out after it lands).
    const pulses = Number(await s.ev(`document.querySelectorAll('.si-stage [data-si^="pulse:"] circle.si-pulse').length`))
    const ops = await Promise.all(c.targets.map((id) => s.ev(vis(id)).then(Number)))
    if (Math.abs(end.t - B[c.k]) > 1e-3 || end.mode !== "paused" || pulses || ops.some((o) => o < 0.999)) bad.push(`beat ${c.k}: t=${end.t.toFixed(3)} (stop ${B[c.k]}), ${pulses} pulses, ${c.targets.map((id, i) => `${id}=${ops[i].toFixed(2)}`).join(" ")}`)
  }
  check(cases.length >= 5 && !bad.length, `${tag} → from ${cases.length} beat stops lands on the next settled beat with the dot's target box visible, no pulse in flight${bad.length ? `: ${bad.join("; ")}` : ""}`)
}
// ── Reading holds in continuous play; no hover tooltip on the diagram ──
async function holdChecks(s: S) {
  const tag = "[holds]"
  await s.go(url + "#motion=full")
  await s.ev(`localStorage.clear()`)
  await s.ev("location.reload()")
  await Bun.sleep(1400)
  // Hover with the real mouse at several points of the diagram: nothing under the cursor has a
  // title attribute, and the stage holds no SVG <title> (the browser's tooltip sources).
  const r = JSON.parse(await s.ev(`JSON.stringify(document.querySelector(".si-stage svg.storyink").getBoundingClientRect())`))
  let titled = 0
  for (const [fx, fy] of [[0.2, 0.3], [0.5, 0.5], [0.8, 0.6], [0.35, 0.8]]) {
    const x = r.x + r.width * fx
    const y = r.y + r.height * fy
    await s.mouse("mouseMoved", x, y)
    await Bun.sleep(150)
    titled += Number(await s.ev(`(()=>{let n=0;for(let e=document.elementFromPoint(${x},${y});e;e=e.parentElement)if(e.hasAttribute&&e.hasAttribute("title"))n++;return n})()`))
  }
  const titles = Number(await s.ev(`document.querySelectorAll(".si-stage svg title, .si-canvas [title], .si-canvas title").length`))
  check(titled === 0 && titles === 0, `${tag} hovering the diagram (real mouse, 4 points): ${titled} title attributes under the cursor, ${titles} SVG <title>s in the stage`)
  // Continuous play: during each beat's reading hold the diagram doesn't change.
  const ckTl = toScene(loadSpec(path.join(root, "examples/checkout.architecture.json")).spec).timeline!
  const G = beatGroups(ckTl)
  const windows = G.slice(1).map((g, k) => {
    const next = ckTl.steps[g[0]].t0
    const hold = ckTl.steps[G[k].at(-1)!].hold!
    return { k, a: next - hold, b: next, hold }
  })
  await s.mouse("mouseMoved", 5, 5)
  await s.click(".si-gate")
  const fp = `(()=>{const h=document.querySelector(".si-stage svg.storyink").outerHTML;let x=0;for(let i=0;i<h.length;i++)x=(x*31+h.charCodeAt(i))|0;return JSON.stringify({t:window.__storyink.state().t,m:window.__storyink.state().mode,x})})()`
  const seen = new Map<number, { t: number; x: number }[]>()
  const t0 = Date.now()
  while (Date.now() - t0 < 40000) {
    const v = JSON.parse(await s.ev(fp)) as { t: number; m: string; x: number }
    if (v.m === "ended") break
    for (const w of windows) if (v.t > w.a + 0.05 && v.t < w.b - 0.05) (seen.get(w.k) ?? seen.set(w.k, []).get(w.k)!).push({ t: v.t, x: v.x })
    await Bun.sleep(40)
  }
  const bad = [...seen.entries()].filter(([, xs]) => new Set(xs.map((q) => q.x)).size > 1).map(([k]) => k)
  const covered = [...seen.values()].filter((xs) => xs.length >= 5).length
  const minHold = Math.min(...windows.map((w) => w.hold))
  check(covered >= windows.length - 1 && !bad.length, `${tag} continuous play holds still for each beat's reading hold (${covered}/${windows.length} holds sampled, ≥ ${minHold.toFixed(2)} s each${bad.length ? `; changed during hold ${bad.join(",")}` : ""})`)
}
// ── Pauses (reading-hold pace) in the viewer ──
async function paceChecks(s: S) {
  const tag = "[pauses]"
  const ckSpec = loadSpec(path.join(root, "examples/checkout.architecture.json")).spec!
  const tlAt = (p: number) => toScene({ ...ckSpec, story: { ...(ckSpec.story as object), pace: p } } as never).timeline!
  await s.go(url + "#motion=full")
  await s.ev(`localStorage.clear()`)
  await s.ev("location.reload()")
  await Bun.sleep(1400)
  const sel = `.si-tools button[aria-label^="Pauses"]`
  const info = async () => JSON.parse(await s.ev(`JSON.stringify({pace: window.__storyink.pace(), dur: window.__storyink.duration, steps: window.__storyink.steps.map(x=>x.t0), label: document.querySelector('${sel}')?.getAttribute("aria-label"), ticks: [...document.querySelectorAll(".si-tick")].map(e=>e.style.left)})`)) as { pace: number; dur: number; steps: number[]; label: string; ticks: string[] }
  const a = await info()
  check(a.pace === 0.6 && a.label === "Pauses: Normal" && Math.abs(a.dur - tlAt(0.6).duration) < 1e-6, `${tag} default: ${a.label}, pace ${a.pace}, duration ${a.dur.toFixed(1)} s`)
  await s.click(sel)
  await Bun.sleep(300)
  const b = await info()
  check(b.pace === 1 && b.label === "Pauses: Long" && Math.abs(b.dur - tlAt(1).duration) < 1e-6 && b.dur > a.dur && b.ticks.join() !== a.ticks.join() && b.steps.join() !== a.steps.join(), `${tag} click → ${b.label}: duration ${a.dur.toFixed(1)} → ${b.dur.toFixed(1)} s (= render --pace 1), ticks and steps moved`)
  await s.key("[", "BracketLeft")
  await s.key("[", "BracketLeft")
  await Bun.sleep(300)
  const c = await info()
  check(c.pace === 0.3 && c.label === "Pauses: Short" && c.dur < a.dur, `${tag} [ [ → ${c.label}: duration ${c.dur.toFixed(1)} s`)
  // Holds: the gap before beat 2 grows with the pace.
  const g1 = (tl: ReturnType<typeof tlAt>) => tl.steps[beatGroups(tl)[1][0]].t0
  check(c.steps[beatGroups(tlAt(0.3))[1][0]] < b.steps[beatGroups(tlAt(1))[1][0]] && Math.abs(c.steps[beatGroups(tlAt(0.3))[1][0]] - g1(tlAt(0.3))) < 1e-6, `${tag} beat 2 starts at ${g1(tlAt(0.3)).toFixed(2)} s (Short) vs ${g1(tlAt(1)).toFixed(2)} s (Long): holds shorter / longer`)
  // Change pace while playing: same beat, still playing.
  await s.key("]", "BracketRight")
  await Bun.sleep(300)
  await s.click(".si-gate")
  await Bun.sleep(4200)
  const beatAt = (tl: ReturnType<typeof tlAt>, t: number) => {
    const g = beatGroups(tl)
    let k = -1
    for (let i = 0; i < g.length; i++) if (tl.steps[g[i][0]].t0 <= t + 1e-9) k = i
    return k
  }
  const before = await state(s)
  await s.key("]", "BracketRight")
  await s.key("]", "BracketRight")
  const after = await state(s)
  await Bun.sleep(400)
  const later = await state(s)
  const kb = beatAt(tlAt(0.6), before.t)
  const ka = beatAt(tlAt(1.5), after.t)
  check(before.mode === "playing" && kb === ka && later.mode === "playing" && later.t > after.t && (await s.ev(`window.__storyink.pace()`)) === 1.5, `${tag} Normal → Longer mid-play keeps beat ${kb + 1} (t ${before.t.toFixed(2)} → ${after.t.toFixed(2)}) and keeps playing`)
  // Persisted; #pace= wins.
  await s.ev("location.reload()")
  await Bun.sleep(1400)
  const d = await info()
  await s.go(url + "#motion=full&pace=0")
  await s.ev("location.reload()")
  await Bun.sleep(1400)
  const e = await info()
  check(d.pace === 1.5 && d.label === "Pauses: Longer" && e.pace === 0 && e.label === "Pauses: None" && Math.abs(e.dur - tlAt(0).duration) < 1e-6, `${tag} stored Longer survives reload; #pace=0 overrides (None, ${e.dur.toFixed(1)} s = authored timing)`)
  // Page API.
  await s.ev(`window.__storyink.setPace(0.6)`)
  await Bun.sleep(300)
  const f = await info()
  check(f.pace === 0.6 && Math.abs(f.dur - tlAt(0.6).duration) < 1e-6, `${tag} __storyink.setPace(0.6) → pace ${f.pace}, duration ${f.dur.toFixed(1)} s`)
  await s.ev(`localStorage.clear()`)
}
async function stepFollowChecks(s: S) {
  const tag = "[keys follow]"
  await s.go(lurl)
  await s.ev(`localStorage.clear()`)
  await s.ev("location.reload()")
  await Bun.sleep(1400)
  await s.ev(`window.__storyink.setTime(${largeScene.timeline!.steps[3].t0 + 0.05})`)
  await Bun.sleep(200)
  let bad = 0
  let n = 0
  const ys = new Set<number>()
  for (const [key, times] of [["ArrowRight", 9], ["ArrowLeft", 5]] as const)
    for (let i = 0; i < times; i++) {
      await s.key(key)
      await sampleUntilStill(s, 5000)
      await Bun.sleep(900)
      const c = await camera(s)
      n++
      ys.add(c.goal.y)
      if (!c.engaged || !onScreen(c, c.viewport, c.step)) bad++
    }
  check(bad === 0 && ys.size >= 3, `${tag} camera follows step moves forward and back: ${n} moves, ${ys.size} positions, ${bad} with the step off screen`)
}

let s = await session(["--force-prefers-no-reduced-motion"], { width: 1280, height: 800 })
await followChecks(s)
await stepFollowChecks(s)
s.close()
s = await session(["--force-prefers-no-reduced-motion"])
await beatChecks(s)
await paceChecks(s)
await holdChecks(s)
await stepChecks(s)
s.close()
s = await session(["--force-prefers-no-reduced-motion"])
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
// Until the first pulse flies (after beat 0 and its reading hold), at most 10 s.
for (let i = 0; i < 250 && !flight; i++) {
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
