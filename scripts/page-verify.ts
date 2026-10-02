/**
 * Page-mode viewer checks in headless Chrome over CDP (real mouse / key input), on a page with
 * several embedded figures (the page contract harness, or `renderPageHtml` when available):
 *  - every figure hydrates; `__storyink.page`, `figures`, ready; no console errors; no duplicate ids;
 *  - keys act only on the focused figure; Space scrolls the page when no figure has focus;
 *  - `#fig=a&t=…` seeks only figure a; TOC anchor clicks don't refit figures;
 *  - wheel over a figure scrolls the page (no zoom); expand + Esc; drawer opens from a figure;
 *  - `#fig=<id>&solo=1` shows only that figure with the single-diagram contract.
 * Usage: bun scripts/page-verify.ts
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { toScene, resolveChanges } from "../src/core/index.ts"
import { loadSpec } from "../src/node/index.ts"
import { killAll, session } from "./cdp.ts"
import { pageHarness } from "./page-harness.ts"

setTimeout(() => {
  console.error("FAIL page-verify: deadline (6 min) exceeded")
  killAll()
  process.exit(1)
}, 6 * 60_000).unref()

const root = path.resolve(import.meta.dir, "..")
const D = fs.mkdtempSync(path.join(os.tmpdir(), "storyink-page-"))
const html = path.join(D, "page.html")
const spec = (f: string) => loadSpec(path.join(root, f)).spec
const pr = resolveChanges(spec("examples/changes/storyink-0.4.0.pr.json") as never, JSON.parse(fs.readFileSync(path.join(root, "examples/changes/storyink-0.4.0.changes.json"), "utf8"))).spec
fs.writeFileSync(
  html,
  pageHarness([
    { id: "a", scene: toScene(spec("examples/checkout.architecture.json")) },
    { id: "b", scene: toScene(pr) },
  ]),
)
const url = `file://${html}`
let fail = 0
const check = (ok: boolean, msg: string) => {
  if (!ok) fail++
  console.log(`${ok ? "pass" : "FAIL"} ${msg}`)
}
const s = await session([], { width: 1280, height: 900 })
await s.send("Runtime.enable", {})
const errors: string[] = []
s.on("Runtime.exceptionThrown", (m: { exceptionDetails?: { text?: string } }) => errors.push(m.exceptionDetails?.text ?? "exception"))
s.on("Runtime.consoleAPICalled", (m: { type: string; args: { value?: unknown }[] }) => {
  if (m.type === "error") errors.push(String(m.args?.[0]?.value ?? "console.error"))
})
const st = async (id: string) => JSON.parse(await s.ev(`JSON.stringify(window.__storyink.figures[${JSON.stringify(id)}].state())`)) as { t: number; mode: string }
const camOf = (id: string) => s.ev(`getComputedStyle(document.querySelector('[data-si-app="${id}"] .si-canvas')).transform`) as Promise<string>
const scrollY = () => s.ev(`Math.round(scrollY)`) as Promise<number>

await s.go(url)
await s.ev(`localStorage.clear()`)
await s.ev("location.reload()")
await Bun.sleep(1800)
const info = JSON.parse(await s.ev(`JSON.stringify({ready: window.__storyink.ready, page: window.__storyink.page, figs: Object.keys(window.__storyink.figures), ds: document.documentElement.dataset.ready, apps: document.querySelectorAll(".si-embedded").length, lintOk: window.__storyink.lint?.ok})`))
check(info.ready && info.page && info.ds === "1" && info.apps === 2 && info.figs.join() === "a,b", `figures hydrate, page contract (${JSON.stringify(info)})`)
const dup = await s.ev(`(()=>{const c={};for(const e of document.querySelectorAll("[id]"))c[e.id]=(c[e.id]||0)+1;return Object.entries(c).filter(([,n])=>n>1).map(([k])=>k).join(",")})()`)
check(dup === "", `no duplicate DOM ids (${dup || "none"})`)
// Space with no figure focused scrolls the page.
await s.ev(`document.activeElement?.blur(); scrollTo(0,0)`)
await s.key(" ", "Space")
await Bun.sleep(400)
const y1 = await scrollY()
check(y1 > 50 && (await st("a")).mode === "gate" && (await st("b")).mode === "gate", `Space with no figure focused scrolls the page (scrollY ${y1}), figures stay at the gate`)
// Focus figure a (click its stage), then keys act on a only.
await s.ev(`document.querySelector('[data-si-app="a"]').scrollIntoView({block:"center"})`)
await Bun.sleep(300)
const ca = await s.center(`[data-si-app="a"] .si-stage`)
await s.click({ x: ca!.x, y: ca!.y - 60 })
await Bun.sleep(400)
const focusA = await s.ev(`document.querySelector('[data-si-app="a"]').contains(document.activeElement)`)
const yA = await scrollY()
await s.key(" ", "Space")
await Bun.sleep(400)
const a1 = await st("a")
const b1 = await st("b")
check(!!focusA && a1.mode !== "gate" && b1.mode === "gate" && (await scrollY()) === yA, `focused figure a reacts to Space (a ${a1.mode}, b ${b1.mode}), page doesn't scroll`)
await s.ev(`window.__storyink.figures.a.pause()`)
// Wheel over a figure scrolls the page, no zoom.
await Bun.sleep(1200)
const c0 = await camOf("a")
const yW = await scrollY()
await s.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: ca!.x, y: ca!.y - 60, deltaX: 0, deltaY: 300 })
await Bun.sleep(500)
const c1 = await camOf("a")
const yW1 = await scrollY()
check(c1 === c0 && yW1 > yW, `wheel over a figure scrolls the page, no zoom (scroll ${yW} → ${yW1}, ${c0 === c1 ? "same camera" : `${c0} → ${c1}`})`)
// Hash: #fig=b&t=… seeks only b; TOC anchor clicks don't refit.
const ta = (await st("a")).t
await s.ev(`location.hash = "fig=b&t=9"`)
await Bun.sleep(700)
const b2 = await st("b")
check(Math.abs(b2.t - 9) < 0.05 && Math.abs((await st("a")).t - ta) < 0.05, `#fig=b&t=9 seeks only b (b t=${b2.t.toFixed(2)}, a t=${(await st("a")).t.toFixed(2)})`)
const camA = await camOf("a")
const camB = await camOf("b")
await s.click(`.sp-toc a[href="#sec-2"]`)
await Bun.sleep(700)
check((await camOf("a")) === camA && (await camOf("b")) === camB && Math.abs((await st("b")).t - 9) < 0.05, "TOC anchor click: no refit, no seek")
// Expand + Esc.
await s.ev(`document.querySelector('[data-si-app="b"]').scrollIntoView({block:"center"})`)
await Bun.sleep(300)
await s.click(`[data-si-app="b"] .si-tools button[aria-label="Expand"]`)
await Bun.sleep(700)
const ex = JSON.parse(await s.ev(`(()=>{const r=document.querySelector('[data-si-app="b"]').getBoundingClientRect();return JSON.stringify({w:r.width,h:r.height,cls:document.querySelector('[data-si-app="b"]').classList.contains("si-expanded")})})()`))
check(ex.cls && ex.w >= 1270 && ex.h >= 890, `Expand fills the viewport (${ex.w}×${ex.h})`)
await s.key("Escape")
await Bun.sleep(500)
check(!(await s.ev(`document.querySelector('[data-si-app="b"]').classList.contains("si-expanded")`)), "Esc returns to the page")
// Drawer from a figure (click a changed node at the end frame).
await s.ev(`window.__storyink.figures.b.setTime("end")`)
await Bun.sleep(500)
await s.ev(`document.querySelector('[data-si-app="b"]').scrollIntoView({block:"center"})`)
await Bun.sleep(400)
const nb = await s.center(`[data-si-app="b"] .si-stage [data-si="node:panels"]`)
await s.click(nb!)
await Bun.sleep(500)
const dr = await s.ev(`document.querySelector(".si-drawer-layer .si-drawer")?.dataset.drawer ?? null`)
check(dr === "panels", `drawer opens from a figure as a page overlay (${dr})`)
await s.key("Escape")
await Bun.sleep(300)
check(!(await s.ev(`!!document.querySelector(".si-drawer-layer")`)), "Esc closes the drawer")
const dup2 = await s.ev(`(()=>{const c={};for(const e of document.querySelectorAll("[id]"))c[e.id]=(c[e.id]||0)+1;return Object.entries(c).filter(([,n])=>n>1).map(([k])=>k).join(",")})()`)
check(dup2 === "", `no duplicate DOM ids after playing (${dup2 || "none"})`)
// Solo.
await s.go(url + "#fig=b&solo=1&t=end")
await s.ev("location.reload()")
await Bun.sleep(1600)
const solo = JSON.parse(await s.ev(`JSON.stringify({ready: window.__storyink.ready, dur: window.__storyink.duration, solo: window.__storyink.solo, page: getComputedStyle(document.getElementById("storyink-page")).display, apps: document.querySelectorAll("#storyink-root .si-app").length, head: !!document.querySelector(".si-head")})`))
check(solo.ready && solo.dur > 0 && solo.solo === "b" && solo.page === "none" && solo.apps === 1 && solo.head, `#fig=b&solo=1: only figure b, standalone contract (${JSON.stringify(solo)})`)
check(errors.length === 0, `no console errors (${errors.slice(0, 3).join(" | ") || "none"})`)
s.close()
fs.rmSync(D, { recursive: true, force: true })
process.exit(fail ? 1 : 0)
