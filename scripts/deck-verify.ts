/**
 * Scrollytelling + slide deck checks in headless Chrome over CDP (real keys / scrolling, settled
 * assertions only — never frame timing):
 *  - scrolly: live class, the step at the trigger line is active, the figure settles on its target
 *    going forward and back, `#scrolly=<id>&step=<n>`, reduced motion jumps, cite hover;
 *  - deck: `#present=1`, keys through slides and builds (figure at the build target), Home / End,
 *    outline + help + Esc, Esc exits to the article, P re-enters, `#slide=&build=`, figure keys
 *    disabled while presenting; no console errors; no duplicate ids.
 * Pages: examples/pages/*.scrolly.page.json + pr-review.deck.page.json when they exist, else a
 * scrolly page built here and pr-review.page.json presented.
 * Usage: bun scripts/deck-verify.ts
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { killAll, session } from "./cdp.ts"

setTimeout(() => {
  console.error("FAIL deck-verify: deadline (8 min) exceeded")
  killAll()
  process.exit(1)
}, 8 * 60_000).unref()

const root = path.resolve(import.meta.dir, "..")
const D = fs.mkdtempSync(path.join(os.tmpdir(), "storyink-deck-"))
const cli = path.join(root, "dist/cli.js")
const render = (spec: string, out: string, extra: string[] = []) => {
  const r = spawnSync("node", [cli, "render", spec, "-o", out, ...extra], { cwd: path.dirname(spec), encoding: "utf8" })
  if (!fs.existsSync(out)) throw new Error(`render failed: ${spec}\n${r.stderr}${r.stdout}`)
}
const ex = (f: string) => path.join(root, "examples/pages", f)
const changes = path.join(root, "examples/changes/storyink-0.4.0.changes.json")

// Scrolly page: the real example when present, else a page built here (inline figure specs).
const scHtml = path.join(D, "scrolly.html")
if (fs.existsSync(ex("storyink-0.4.0.scrolly.page.json")) && fs.existsSync(ex("payment-retry.scrolly.page.json"))) {
  render(ex("storyink-0.4.0.scrolly.page.json"), scHtml, ["--changes", changes])
  const pay = path.join(D, "pay.html")
  render(ex("payment-retry.scrolly.page.json"), pay)
} else {
  const spec = (f: string) => JSON.parse(fs.readFileSync(path.join(root, f), "utf8"))
  const page = {
    type: "page",
    title: "Scrolly harness",
    summary: "A scrolly test page.",
    sections: [
      { id: "intro", title: "Intro", blocks: [{ prose: "Some intro text." }] },
      { id: "walk", title: "Walkthrough", blocks: [{ scrolly: { id: "s1", figure: { id: "pr", spec: spec("examples/changes/storyink-0.4.0.pr.json") }, steps: "auto" } }] },
      {
        id: "pay",
        title: "Payments",
        blocks: [
          {
            scrolly: {
              id: "s2",
              side: "left",
              figure: { id: "pay", spec: spec("examples/changes/payment-retry.architecture.json") },
              steps: [
                { at: "start", body: "Before anything." },
                { at: 2, title: "Two", body: "The second beat." },
                { at: "end", body: "The end." },
              ],
            },
          },
        ],
      },
      { id: "outro", title: "Outro", blocks: [{ prose: "Done." }] },
    ],
  }
  const f = path.join(D, "sc.page.json")
  fs.writeFileSync(f, JSON.stringify(page))
  render(f, scHtml, ["--changes", changes])
}
const deckHtml = path.join(D, "deck.html")
if (fs.existsSync(ex("pr-review.deck.page.json"))) render(ex("pr-review.deck.page.json"), deckHtml)
else render(ex("pr-review.page.json"), deckHtml)

let fail = 0
const check = (ok: boolean, msg: string) => {
  if (!ok) fail++
  console.log(`${ok ? "pass" : "FAIL"} ${msg}`)
}
const s = await session([], { width: 1280, height: 900 })
await s.send("Runtime.enable", {})
const errors: string[] = []
s.on("Runtime.exceptionThrown", (m: { exceptionDetails?: { text?: string; exception?: { description?: string } } }) => errors.push(m.exceptionDetails?.exception?.description ?? m.exceptionDetails?.text ?? "exception"))
s.on("Runtime.consoleAPICalled", (m: { type: string; args: { value?: unknown }[] }) => {
  if (m.type === "error") errors.push(String(m.args?.[0]?.value ?? "console.error"))
})
const J = async <T>(expr: string): Promise<T> => JSON.parse(await s.ev(`JSON.stringify(${expr})`)) as T
const dupIds = () => s.ev(`(()=>{const c={};for(const e of document.querySelectorAll("[id]"))c[e.id]=(c[e.id]||0)+1;return Object.entries(c).filter(([,n])=>n>1).map(([k])=>k).join(",")})()`) as Promise<string>
/** Wait until a figure is not playing (settled), then return its state. */
const settle = async (fig: string, ms = 20000) => {
  const t0 = Date.now()
  let st = { t: 0, mode: "" }
  while (Date.now() - t0 < ms) {
    st = await J<{ t: number; mode: string }>(`window.__storyink.figures[${JSON.stringify(fig)}].state()`)
    if (st.mode !== "playing" && st.mode !== "rewinding") break
    await Bun.sleep(80)
  }
  await Bun.sleep(120)
  return J<{ t: number; mode: string }>(`window.__storyink.figures[${JSON.stringify(fig)}].state()`)
}
/** The time a target names, via the figure's own beats (as moveTo resolves it). */
const targetT = (fig: string, beat: number) =>
  J<number>(`(()=>{const f=window.__storyink.figures[${JSON.stringify(fig)}];const b=f.beats();const d=f.duration;return ${beat}<0?0:${beat}<b.length?b[${beat}]:Math.max(0,d-1e-3)})()`)

// ---------- Scrolly ----------
await s.go(`file://${scHtml}`)
await s.ev(`localStorage.clear()`)
await s.ev("location.reload()")
await Bun.sleep(1800)
const blocks = await J<{ id: string; fig: string; steps: number }[]>(`[...document.querySelectorAll("[data-scrolly]")].map(b=>({id:b.dataset.scrolly,fig:(window.__storyink && JSON.parse(document.getElementById("storyink-page-data").textContent).scrolly[b.dataset.scrolly].fig),steps:b.querySelectorAll(".sp-scrolly-step").length}))`)
check(blocks.length >= 1 && (await s.ev(`document.querySelectorAll(".sp-scrolly-live").length`)) === blocks.length, `scrolly blocks go live (${blocks.map((b) => `${b.id}:${b.steps}`).join(", ")})`)
const sc = blocks[0]
const tgt = await J<{ beat: number; t: number }[]>(`JSON.parse(document.getElementById("storyink-page-data").textContent).scrolly[${JSON.stringify(sc.id)}].steps`)
const toStep = async (id: string, i: number) => {
  // Put step i just past the trigger line (55 %).
  await s.ev(`(()=>{const st=document.querySelectorAll('[data-scrolly="${id}"] .sp-scrolly-step')[${i}];scrollTo(0,Math.round(st.getBoundingClientRect().top+scrollY-innerHeight*0.55+4))})()`)
}
const activeOf = (id: string) => s.ev(`[...document.querySelectorAll('[data-scrolly="${id}"] .sp-scrolly-step')].findIndex(x=>x.classList.contains("is-active"))`) as Promise<number>
let fwd = 0
const seq = [0, 1, 2, Math.min(3, sc.steps - 1)]
for (const i of seq) {
  await toStep(sc.id, i)
  const st = await settle(sc.fig)
  const want = await targetT(sc.fig, tgt[i].beat)
  if ((await activeOf(sc.id)) === i && Math.abs(st.t - want) < 0.02) fwd++
  else console.log(`  step ${i}: active ${await activeOf(sc.id)}, t ${st.t.toFixed(3)} want ${want.toFixed(3)} (${st.mode})`)
}
check(fwd === seq.length, `scrolling forward: active step at the trigger line, figure settles on its target (${fwd}/${seq.length})`)
await toStep(sc.id, 1)
const back = await settle(sc.fig)
const wantBack = await targetT(sc.fig, tgt[1].beat)
check((await activeOf(sc.id)) === 1 && Math.abs(back.t - wantBack) < 0.02, `scrolling back rewinds to step 2's target (t ${back.t.toFixed(3)} / ${wantBack.toFixed(3)})`)
const cite = await s.ev(`!!document.querySelector('[data-scrolly="${sc.id}"] .sp-cite[data-ref]')`)
if (cite) {
  await s.ev(`document.querySelector('[data-scrolly="${sc.id}"] .sp-cite[data-ref]').scrollIntoView({block:"center"})`)
  await Bun.sleep(300)
  const c = await s.center(`[data-scrolly="${sc.id}"] .sp-cite[data-ref]`)
  await s.mouse("mouseMoved", c!.x, c!.y)
  await Bun.sleep(300)
  check(!!(await s.ev(`[...document.querySelectorAll('[data-si-app] style')].some(x=>x.textContent.includes("drop-shadow(0 0 4px"))`)), "cite hover highlights the figure element")
  await s.mouse("mouseMoved", 5, 5)
}
// Hash: the last block's step 2, settled and paused.
const last = blocks[blocks.length - 1]
const lastT = await J<{ beat: number }[]>(`JSON.parse(document.getElementById("storyink-page-data").textContent).scrolly[${JSON.stringify(last.id)}].steps`)
await s.go(`file://${scHtml}#scrolly=${last.id}&step=2`)
await s.ev("location.reload()")
await Bun.sleep(1800)
const hs = await settle(last.fig)
check((await activeOf(last.id)) === 1 && hs.mode === "paused" && Math.abs(hs.t - (await targetT(last.fig, lastT[1].beat))) < 0.02, `#scrolly=${last.id}&step=2: step 2 active, settled (t ${hs.t.toFixed(3)}, ${hs.mode})`)
// Reduced motion: a step change jumps (settled immediately).
await s.ev(`localStorage.setItem("storyink-motion","reduced")`)
await s.go(`file://${scHtml}`)
await s.ev("location.reload()")
await Bun.sleep(1800)
await toStep(sc.id, 2)
await Bun.sleep(250)
const rs = await J<{ t: number; mode: string }>(`window.__storyink.figures[${JSON.stringify(sc.fig)}].state()`)
check(rs.mode !== "playing" && Math.abs(rs.t - (await targetT(sc.fig, tgt[2].beat))) < 0.02, `reduced motion: a step jumps to its settled target (t ${rs.t.toFixed(3)})`)
await s.ev(`localStorage.clear()`)
check((await dupIds()) === "", "scrolly page: no duplicate ids")

// ---------- Deck ----------
await s.go(`file://${deckHtml}#present=1`)
await s.ev("location.reload()")
await Bun.sleep(1800)
const deck = () => J<{ presenting: boolean; slide: number; build: number; slides: number; builds: number }>(`window.__storyink.deck.state()`)
const d0 = await deck()
check(d0.presenting && d0.slide === 1 && (await s.ev(`document.documentElement.classList.contains("sp-presenting")`)) && (await s.ev(`document.querySelector(".sp-deck-count").textContent`)) === `1 / ${d0.slides}`, `#present=1: presenting, slide 1 of ${d0.slides}`)
const vis = await s.ev(`(()=>{const c=document.querySelector(".sp-slide.is-current");const r=c.getBoundingClientRect();return r.width>600&&r.left>=0&&r.right<=innerWidth+1&&document.querySelectorAll(".sp-slide.is-current").length===1})()`)
check(!!vis, "one current slide, fitted in the viewport")
const slidesData = await J<{ builds: number; build?: { fig: string; targets: { beat: number }[] } }[]>(`JSON.parse(document.getElementById("storyink-page-data").textContent).slides`)
const bi = slidesData.findIndex((x) => x.build && x.build.targets.length >= 2)
check(bi > 0, `a slide with builds (slide ${bi + 1}, ${slidesData[bi]?.build?.targets.length} builds)`)
for (let i = 1; i < bi + 1; i++) {
  await s.key("ArrowRight")
  await Bun.sleep(150)
}
const bf = slidesData[bi].build!.fig
const e0 = await deck()
const st0 = await settle(bf)
check(e0.slide === bi + 1 && e0.build === 0 && st0.t < 0.05, `→ enters slide ${bi + 1} at its start state (t ${st0.t.toFixed(3)})`)
await s.key(" ", "Space")
const st1 = await settle(bf)
const w1 = await targetT(bf, slidesData[bi].build!.targets[0].beat)
check((await deck()).build === 1 && Math.abs(st1.t - w1) < 0.02, `Space plays build 1 (t ${st1.t.toFixed(3)} / ${w1.toFixed(3)})`)
await s.key("PageDown", "PageDown")
const st2 = await settle(bf)
const w2 = await targetT(bf, slidesData[bi].build!.targets[1].beat)
check((await deck()).build === 2 && Math.abs(st2.t - w2) < 0.02, `PgDn plays build 2 (t ${st2.t.toFixed(3)} / ${w2.toFixed(3)})`)
await s.key("ArrowLeft")
const st3 = await settle(bf)
check((await deck()).build === 1 && Math.abs(st3.t - w1) < 0.02, `← rewinds to build 1 (t ${st3.t.toFixed(3)})`)
await s.key("ArrowLeft")
await settle(bf)
await s.key("ArrowLeft")
await Bun.sleep(200)
const pv = await deck()
check(pv.slide === bi && pv.build === pv.builds, `← from a slide's entry goes to the previous slide's end state (slide ${pv.slide}, build ${pv.build}/${pv.builds})`)
await s.key("End")
await Bun.sleep(200)
check((await deck()).slide === d0.slides, "End: last slide")
await s.key("Home")
await Bun.sleep(200)
check((await deck()).slide === 1, "Home: first slide")
await s.key("o", "KeyO")
await Bun.sleep(200)
const items = Number(await s.ev(`document.querySelectorAll(".sp-deck-overlay [data-goto]").length`))
await s.click(`.sp-deck-overlay [data-goto="2"]`)
await Bun.sleep(300)
check(items === d0.slides && (await deck()).slide === 3 && !(await s.ev(`!!document.querySelector(".sp-deck-overlay")`)), `O outline lists ${items} slides, click jumps to slide 3`)
await s.key("?", "Slash", true)
await Bun.sleep(150)
const help = await s.ev(`document.querySelector(".sp-deck-overlay")?.dataset.kind ?? null`)
await s.key("Escape")
await Bun.sleep(150)
check(help === "help" && !(await s.ev(`!!document.querySelector(".sp-deck-overlay")`)) && (await deck()).presenting, "? help, Esc closes it (still presenting)")
await s.key("Escape")
await Bun.sleep(400)
const ex1 = await J<{ on: boolean; y: number }>(`({on: document.documentElement.classList.contains("sp-presenting"), y: Math.round(scrollY)})`)
check(!ex1.on && ex1.y > 100, `Esc exits to the article at the slide's section (scrollY ${ex1.y})`)
await s.ev(`document.activeElement?.blur()`)
await s.key("p", "KeyP")
await Bun.sleep(300)
check((await deck()).presenting, "P presents again")
await s.key("p", "KeyP")
await Bun.sleep(300)
check(!(await deck()).presenting, "P stops presenting")
// Hash: a settled build state.
await s.go(`file://${deckHtml}#present=1&slide=${bi + 1}&build=2`)
await s.ev("location.reload()")
await Bun.sleep(1800)
const hb = await settle(bf)
const hd = await deck()
check(hd.slide === bi + 1 && hd.build === 2 && hb.mode === "paused" && Math.abs(hb.t - w2) < 0.02, `#slide=${bi + 1}&build=2: settled build state (t ${hb.t.toFixed(3)}, ${hb.mode})`)
// Figure keys are disabled while presenting (the deck owns Space / arrows).
await s.click(`.sp-slide.is-current [data-si-app]`)
await Bun.sleep(200)
const tBefore = (await J<{ t: number }>(`window.__storyink.figures[${JSON.stringify(bf)}].state()`)).t
await s.key(" ", "Space")
await Bun.sleep(150)
check((await deck()).build === 3 || (await deck()).slide === bi + 2, `Space with a figure focused advances the deck (build ${(await deck()).build}, t was ${tBefore.toFixed(2)})`)
check((await dupIds()) === "", "deck page: no duplicate ids")
check(errors.length === 0, `no console errors (${errors.slice(0, 3).join(" | ") || "none"})`)
s.close()
fs.rmSync(D, { recursive: true, force: true })
process.exit(fail ? 1 : 0)
