/**
 * Narration rail + change drawer checks in headless Chrome over CDP (real mouse / key input):
 *  - the rail shows the first narrated step at the gate and follows → / ← like the header caption;
 *  - N hides / shows the rail (stored), the toolbar toggle mirrors it;
 *  - a click on an element with drawer content opens the drawer, a drag on it pans instead;
 *  - the drawer scrolls with the wheel (not swallowed by the stage zoom); Esc closes it;
 *  - `#drawer=<id>` opens on load, `__storyink.openDrawer` / `closeDrawer` / `drawer()`;
 *  - a file cite opens the drawer on that file.
 * Usage: bun scripts/narrate-verify.ts
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { loadSpec, writeDiagram } from "../src/node/index.ts"
import { resolveChanges } from "../src/core/index.ts"
import { killAll, session } from "./cdp.ts"

setTimeout(() => {
  console.error("FAIL narrate-verify: deadline (5 min) exceeded")
  killAll()
  process.exit(1)
}, 5 * 60_000).unref()

const root = path.resolve(import.meta.dir, "..")
const D = fs.mkdtempSync(path.join(os.tmpdir(), "storyink-narrate-"))
const html = path.join(D, "pr.html")
const spec = loadSpec(path.join(root, "examples/changes/storyink-0.4.0.pr.json")).spec
const diff = JSON.parse(fs.readFileSync(path.join(root, "examples/changes/storyink-0.4.0.changes.json"), "utf8"))
writeDiagram(resolveChanges(spec as never, diff).spec, { html })
const url = `file://${html}`
let fail = 0
const check = (ok: boolean, msg: string) => {
  if (!ok) fail++
  console.log(`${ok ? "pass" : "FAIL"} ${msg}`)
}
const s = await session([], { width: 1500, height: 900 })
const railN = () => s.ev(`document.querySelector(".si-rail-n")?.textContent ?? null`) as Promise<string | null>
const railH = () => s.ev(`document.querySelector(".si-rail-h")?.textContent ?? null`) as Promise<string | null>
const caption = () => s.ev(`[...document.querySelectorAll(".si-caption")].map(c=>c.textContent.trim()).pop() ?? ""`) as Promise<string>
const drawer = () => s.ev(`document.querySelector(".si-drawer")?.dataset.drawer ?? null`) as Promise<string | null>

await s.go(url + "#motion=full")
await s.ev(`localStorage.clear()`)
await s.ev("location.reload()")
await Bun.sleep(1400)
check((await railN()) === "01 / 07", `full-motion gate: rail shows the first narrated step (${await railN()})`)
await s.go(url + "#motion=reduced")
await s.ev("location.reload()")
await Bun.sleep(1400)
check((await railN()) === "07 / 07", `reduced gate (final frame): rail shows the last narrated step (${await railN()})`)
const steps = JSON.parse(await s.ev(`JSON.stringify(window.__storyink.steps.map(x=>!!x.narrate))`)) as boolean[]
check(steps.length === 7 && steps.every(Boolean), `__storyink.steps carry narrate (${steps.filter(Boolean).length}/${steps.length})`)
// Reduced motion: → jumps step by step; the rail heading tracks the header caption.
await s.ev(`window.__storyink.setTime(0)`)
let agree = 0
for (let i = 0; i < 4; i++) {
  await s.key("ArrowRight")
  await Bun.sleep(350)
  const [h, c] = [await railH(), await caption()]
  if (h && c && (c === h || c.startsWith(h))) agree++
}
check(agree === 4, `→ moves: rail heading = header caption (${agree}/4), now ${await railN()}`)
await s.key("ArrowLeft")
await Bun.sleep(350)
check((await railH()) === (await caption()), `← move: rail follows (${await railN()})`)
// Full motion: animated → moves (the caption pin) keep the rail on the caption's beat.
await s.go(url + "#motion=full")
await s.ev("location.reload()")
await Bun.sleep(1400)
await s.ev(`window.__storyink.setTime(0)`)
let agreeFull = 0
for (let i = 0; i < 3; i++) {
  await s.ev(`window.__storyink.step(1)`)
  await Bun.sleep(150)
  const [h, c] = [await railH(), await caption()]
  if (h && c && (c === h || c.startsWith(h))) agreeFull++
}
check(agreeFull === 3, `full-motion → moves: rail heading = header caption (${agreeFull}/3), now ${await railN()}`)
await s.go(url + "#motion=reduced")
await s.ev("location.reload()")
await Bun.sleep(1400)
// N toggles the rail.
await s.key("n", "KeyN")
await Bun.sleep(200)
const hidden = (await s.ev(`!document.querySelector(".si-rail") && localStorage.getItem("storyink-rail")==="off"`)) as boolean
await s.key("n", "KeyN")
await Bun.sleep(200)
check(hidden && (await railN()) !== null, "N hides and shows the rail (stored)")
// Click opens, drag does not.
await s.ev(`window.__storyink.setTime("end")`)
await Bun.sleep(500)
const box = await s.center(`.si-stage [data-si="node:panels"]`)
if (!box) throw new Error("no panels node")
await s.drag(box, { x: box.x + 80, y: box.y + 30 })
await Bun.sleep(300)
check((await drawer()) === null, "drag on an element pans, no drawer")
await s.click((await s.center(`.si-stage [data-si="node:panels"]`))!)
await Bun.sleep(400)
check((await drawer()) === "panels", `click on an element opens its drawer (${await drawer()})`)
const rows = Number(await s.ev(`document.querySelectorAll(".si-drawer .si-drow-add").length`))
check(rows > 10, `drawer shows embedded hunks (${rows} added rows)`)
const k0 = await s.ev(`getComputedStyle(document.querySelector(".si-canvas")).transform`)
const db = await s.center(".si-drawer-body")
await s.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: db!.x, y: db!.y, deltaX: 0, deltaY: 400 })
await Bun.sleep(400)
const scrolled = Number(await s.ev(`document.querySelector(".si-drawer-body").scrollTop`))
const k1 = await s.ev(`getComputedStyle(document.querySelector(".si-canvas")).transform`)
check(scrolled > 0 && k0 === k1, `wheel scrolls the drawer (scrollTop ${scrolled}), no zoom`)
await s.key("Escape")
await Bun.sleep(200)
check((await drawer()) === null, "Esc closes the drawer")
await s.key("ArrowLeft")
await Bun.sleep(350)
check((await state()).t < Number(await s.ev("window.__storyink.duration")), "shortcuts still work after the drawer")
// Page contract.
check((await s.ev(`window.__storyink.openDrawer("compile")`)) === true, "openDrawer(id) → true")
await Bun.sleep(200)
check((await drawer()) === "compile" && JSON.stringify(await s.ev(`JSON.stringify(window.__storyink.drawer())`)).includes("compile"), "drawer() reports the open target")
await s.ev(`window.__storyink.closeDrawer()`)
await Bun.sleep(200)
check((await drawer()) === null, "closeDrawer()")
// A file cite opens the drawer on the file.
await s.ev(`window.__storyink.setTime(0)`)
await Bun.sleep(300)
await s.click(`.si-cite-file`)
await Bun.sleep(300)
check(((await drawer()) ?? "").startsWith("file:src/core/spec.ts"), `file cite opens the drawer on the file (${await drawer()})`)
// Hash.
await s.go(url + "#drawer=cstate&t=end")
await s.ev("location.reload()")
await Bun.sleep(1400)
check((await drawer()) === "cstate", "#drawer=<id> opens on load")
await s.go(url + "#chrome=0&t=end")
await s.ev("location.reload()")
await Bun.sleep(1400)
check((await railN()) === null, "#chrome=0 hides the rail")
s.close()
fs.rmSync(D, { recursive: true, force: true })
process.exit(fail ? 1 : 0)

async function state() {
  return JSON.parse(await s.ev(`JSON.stringify(window.__storyink.state())`)) as { t: number; mode: string }
}
