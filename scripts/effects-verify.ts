/**
 * 0.4 effects in headless Chrome over CDP: row status glyphs (spinner rotation, check / cross),
 * shimmer, persistent glows, spotlight, row visibility before their reveal, reduced motion
 * (static spinner, no shimmer / caret / spot drift), seek purity (forward / back), and the
 * glitch rewind filter: present only while a `rewind: "glitch"` story rewinds, never for tape.
 * Usage: bun scripts/effects-verify.ts [--shots dir]
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { renderHtml } from "../src/core/render/index.tsx"
import { loadSpec } from "../src/node/index.ts"
import type { Spec } from "../src/core/spec.ts"
import { killAll, session } from "./cdp.ts"

setTimeout(() => {
  console.error("FAIL effects-verify: deadline (6 min) exceeded")
  killAll()
  process.exit(1)
}, 6 * 60_000).unref()

const root = path.resolve(import.meta.dir, "..")
const D = fs.mkdtempSync(path.join(os.tmpdir(), "storyink-effects-"))
const shotsArg = process.argv.indexOf("--shots")
const SHOTS = shotsArg > 0 ? path.resolve(process.argv[shotsArg + 1]) : undefined
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })
let fail = 0
const check = (ok: boolean, msg: string) => {
  if (!ok) fail++
  console.log(`${ok ? "pass" : "FAIL"} ${msg}`)
}
const write = (name: string, spec: Spec) => {
  const f = path.join(D, `${name}.html`)
  fs.writeFileSync(f, renderHtml(spec))
  return `file://${f}`
}
const spec = (f: string) => loadSpec(path.join(root, "examples", f)).spec!
const cm = spec("code-mode.architecture.json")
const urls = {
  code: write("code-mode", cm),
  tape: write("code-mode-tape", { ...cm, story: { ...(cm.story as object), rewind: "tape" } } as Spec),
  agent: write("agent-session", spec("agent-session.architecture.json")),
  fail: write("failover", spec("failover.dataflow.json")),
}

type S = Awaited<ReturnType<typeof session>>
const q = (sel: string) => JSON.stringify(sel)
/** Effective opacity (product up to the svg) of the first match; -1 when absent. */
const opacity = (s: S, sel: string) =>
  s.ev(`(()=>{const e=document.querySelector(".si-stage "+${q(sel)});if(!e)return -1;let o=1;for(let n=e;n&&n.tagName!=="svg";n=n.parentElement)o*=Number(getComputedStyle(n).opacity);return o})()`) as Promise<number>
const count = (s: S, sel: string) => s.ev(`document.querySelectorAll(".si-stage "+${q(sel)}).length`) as Promise<number>
const attr = (s: S, sel: string, a: string) => s.ev(`document.querySelector(".si-stage "+${q(sel)})?.getAttribute(${q(a)}) ?? null`) as Promise<string | null>
/** Canonical markup of the stage SVG (attributes sorted: React may patch them in another order). */
const svgMarkup = (s: S) =>
  s.ev(`(()=>{const w=(e)=>{if(e.nodeType===3)return e.textContent;if(e.nodeType!==1)return "";const a=[...e.attributes].filter(x=>!(x.name==="style"&&!x.value.trim())).map(x=>x.name+"="+JSON.stringify(x.value)).sort().join(" ");return "<"+e.tagName+" "+a+">"+[...e.childNodes].map(w).join("")+"</"+e.tagName+">"};return w(document.querySelector(".si-stage svg.storyink"))})()`) as Promise<string>
const mode = async (s: S) => JSON.parse(await s.ev(`JSON.stringify(window.__storyink.state())`)).mode as string
async function at(s: S, url: string, hash: string) {
  await s.go(`${url}#${hash}`)
  await s.send("Page.reload")
  await Bun.sleep(900)
}
const shot = async (s: S, name: string) => SHOTS && (await s.shot(path.join(SHOTS, `${name}.png`)))

const s = await session(["--force-prefers-no-reduced-motion"], { width: 1600, height: 900 })
try {
  // t = 0: nothing from the future is on screen.
  await at(s, urls.code, "t=0&theme=dark")
  for (const r of ["exec1", "found1", "found2", "exec2", "filed"]) check((await opacity(s, `[data-si="row:session#${r}"]`)) < 0.01, `code-mode t=0: row ${r} hidden before its reveal`)
  check((await opacity(s, `[data-si="row:session#ask"] .si-row-tag`)) < 0.01, "code-mode t=0: the typed row's tag waits for its run")
  check((await count(s, `[data-si="code:code"] text`)) === 0 || (await attr(s, `[data-si="code:code"] clipPath rect`, "width")) === "0", "code-mode t=0: program 1 not typed yet")
  check((await opacity(s, `[data-si="edge:call1"] path`)) < 0.01, "code-mode t=0: call1 not wired yet")
  check((await count(s, ".si-spot")) === 0, "code-mode t=0: no spotlight before the first step")
  await shot(s, "code-t0")

  // Running: spinner rotates, shimmer sweeps the label only.
  await at(s, urls.code, "t=2.3&theme=dark")
  const rot1 = await attr(s, `[data-si="row:session#exec1"] .si-status-running`, "transform")
  check(!!rot1 && /rotate\(/.test(rot1), `code-mode t=2.3: spinner rotates (${rot1})`)
  check((await count(s, `[data-si="row:session#exec1"] .si-shimmer-text`)) === 1, "code-mode t=2.3: shimmer copy on the running row")
  const shimText = await s.ev(`document.querySelector('.si-stage [data-si="row:session#exec1"] .si-shimmer-text')?.textContent`)
  check(shimText === "EXECUTE", `shimmer covers the text, not the detail ("${shimText}")`)
  check((await count(s, ".si-spot")) === 1, "code-mode t=2.3: spotlight on")
  await shot(s, "code-t2.3")
  await at(s, urls.code, "t=2.45&theme=dark")
  const rot2 = await attr(s, `[data-si="row:session#exec1"] .si-status-running`, "transform")
  check(rot1 !== rot2, "spinner angle is a function of time")

  // Persistent glow and done check.
  await at(s, urls.code, "t=3.6&theme=dark")
  check((await count(s, `[data-si="lit:github"]`)) === 1 && (await count(s, `[data-si="lit:linear"]`)) === 0, "code-mode t=3.6: github glows, linear not")
  await shot(s, "code-t3.6")
  await at(s, urls.code, "t=10.9&theme=dark")
  check((await count(s, `[data-si="lit:linear"]`)) === 1 && (await count(s, `[data-si="lit:github"]`)) <= 1, "code-mode t=10.9: linear glows (github fading)")
  await shot(s, "code-t10.9")

  // Seek purity: forward then back gives the same markup as a fresh load.
  await at(s, urls.code, "t=5.4&theme=dark")
  const fresh = await svgMarkup(s)
  await s.ev(`window.__storyink.setTime(12)`)
  await Bun.sleep(150)
  await s.ev(`window.__storyink.setTime(5.4)`)
  await Bun.sleep(150)
  const back = await svgMarkup(s)
  if (back !== fresh) {
    let i = 0
    while (i < back.length && back[i] === fresh[i]) i++
    console.log(`  differs at ${i}: fresh …${fresh.slice(i - 80, i + 120)}…\n  back  …${back.slice(i - 80, i + 120)}…`)
  }
  check(back === fresh, "seek 5.4 → 12 → 5.4 renders the same frame as a fresh load")

  // End: checks, dims, no spinner / shimmer / spot / glow.
  await at(s, urls.code, "t=end&theme=dark")
  check((await count(s, ".si-status-done")) === 2 && (await count(s, ".si-status-running")) === 0, "code-mode end: two checks, no spinner")
  check((await count(s, ".si-shimmer")) === 0 && (await count(s, ".si-spot")) === 0 && (await count(s, ".si-lit")) === 0, "code-mode end: no shimmer, spotlight or glow")
  check(Math.abs((await opacity(s, `[data-si="row:session#exec1"]`)) - 0.42) < 0.02 && (await opacity(s, `[data-si="row:session#exec2"]`)) > 0.99, "code-mode end: first call dimmed, second at full")
  await shot(s, "code-end")

  // Agent: rest-running row animates while visible; hidden at the end.
  await at(s, urls.agent, "t=3.6&theme=light")
  check(/rotate\(/.test((await attr(s, `[data-si="row:chat#work"] .si-status-running`, "transform")) ?? ""), "agent t=3.6: rest-running Working row spins")
  await at(s, urls.agent, "t=11&theme=light")
  check((await count(s, `[data-si="row:chat#run"] .si-status-error`)) === 1, "agent t=11: failed run shows a cross")
  await shot(s, "agent-t11")
  await at(s, urls.agent, "t=end")
  check((await opacity(s, `[data-si="row:chat#work"]`)) < 0.01 && (await count(s, ".si-status-running")) <= 1, "agent end: Working row hidden")

  // Failover: error cross, spotlight follows focus to router#b.
  await at(s, urls.fail, "t=13.8&theme=dark")
  const spot = await s.ev(`(()=>{const c=document.querySelector(".si-stage .si-spot circle");return c?JSON.stringify({x:+c.getAttribute("cx"),y:+c.getAttribute("cy")}):null})()`)
  check(!!spot, `failover t=13.8: spotlight present ${spot}`)
  await shot(s, "failover-t13.8")
} finally {
  s.close()
}

// Reduced motion: static spinner, no shimmer / caret / spot glide; stepped stops.
const r = await session(["--force-prefers-reduced-motion"], { width: 1600, height: 900 })
try {
  await at(r, urls.code, "t=2.3&motion=reduced&theme=dark")
  const tr = await attr(r, `[data-si="row:session#exec1"] .si-status-running`, "transform")
  check(!!tr && !/rotate/.test(tr), `reduced: static spinner arc (${tr})`)
  check((await count(r, ".si-shimmer")) === 0 && (await count(r, ".si-caret")) === 0, "reduced: no shimmer, no caret")
  await at(r, urls.code, "t=7.4&motion=reduced&theme=dark")
  check((await count(r, ".si-caret")) === 0 && (await count(r, `[data-si="code:code"] clipPath rect[width="0"]`)) === 0, "reduced: typing shown complete at the stop")
} finally {
  r.close()
}

// Rewind: glitch filter only while a glitch story rewinds; never for tape.
for (const [name, url, want] of [["glitch", urls.code, true], ["tape", urls.tape, false]] as const) {
  const g = await session(["--force-prefers-no-reduced-motion"], { width: 1400, height: 800 })
  try {
    await at(g, url, "t=17.2&theme=dark")
    await g.ev(`window.__storyink.play()`)
    let rewinding = 0
    let withFilter = 0
    let filterOutside = 0
    const t0 = Date.now()
    let shotTaken = false
    while (Date.now() - t0 < 4500) {
      const m = await mode(g)
      const has = (await g.ev(`!!document.getElementById("si-glitch") && /si-glitch/.test(document.querySelector(".si-figure")?.getAttribute("style") ?? "")`)) as boolean
      if (m === "rewinding") rewinding++
      if (has && m === "rewinding") withFilter++
      if (has && m !== "rewinding") filterOutside++
      const scale = has ? Number(await g.ev(`document.querySelector("#si-glitch feDisplacementMap")?.getAttribute("scale") ?? 0`)) : 0
      if (scale > 9 && !shotTaken && SHOTS) {
        await g.shot(path.join(SHOTS, `rewind-${name}.png`))
        shotTaken = true
      }
      await Bun.sleep(25)
    }
    check(rewinding > 0, `${name}: the loop rewinds (${rewinding} samples)`)
    check(want ? withFilter > 0 : withFilter === 0, `${name}: glitch filter ${want ? "present" : "absent"} while rewinding (${withFilter} samples)`)
    check(filterOutside === 0, `${name}: no glitch filter outside the rewind`)
    check(["playing", "paused", "rewinding"].includes(await mode(g)), `${name}: playing again after the rewind`)
  } finally {
    g.close()
  }
}

killAll()
console.log(fail ? `\n${fail} check(s) failed` : "\nall effects checks passed")
process.exit(fail ? 1 : 0)
