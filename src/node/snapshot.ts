import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import type { ThemeName } from "../theme/tokens.ts"
import type { Box } from "../core/scene.ts"
import { browserVersion, findBrowser, type Browser } from "./chrome.ts"
import { beatTimes } from "../core/story/state.ts"
import { recompilePace } from "../core/story/compile.ts"
import type { Scene } from "../core/scene.ts"

export interface SnapshotOptions {
  /** Themes to capture (default light, dark). */
  themes?: ThemeName[]
  /** Window width in CSS px (default derived from the viewBox, min 500). */
  width?: number
  /**
   * Contact sheet: true / "themes" (default) = themes side by side;
   * "beats" = one tile per story step plus the final frame (per theme); "acts" = one tile per
   * act at its settled end, side by side (act stories, per theme); false = none.
   */
  sheet?: boolean | "themes" | "beats" | "acts"
  /** Act stories: the `at` captures show the settled end of this act (`#act=<id>`) instead of a time. */
  act?: string
  /** Story times to capture: seconds or "end" (default ["end"]). */
  at?: (number | "end")[]
  /** Motion mode for the `at` captures: "reduced" captures stepped (settled-step) frames. Beat sheets are unaffected. */
  motion?: "full" | "reduced"
  /**
   * Camera for the `at` captures: "fit" (default) shows the whole diagram; "follow" shows the
   * follow camera's view (`#camera=follow`) in a 16:9 stage (width, default 1280). Beat sheets and
   * gates are unaffected.
   */
  camera?: "fit" | "follow"
  /** `at` captures: show the narration rail (`#rail=1`). */
  rail?: boolean
  /** `at` captures: open the change drawer on this element id or file path (`#drawer=`). */
  drawer?: string
  /**
   * Page HTML: run the single-diagram pipeline on this figure (`#fig=<id>&solo=1`). Without it a
   * page gets full-page captures per theme.
   */
  figure?: string
  /** Page HTML: one 1280×720 PNG per slide (entry state) per theme + a slides sheet (`#present=1&slide=n`). */
  slides?: boolean
  /** With `slides`: every build state too (`#build=k`). */
  builds?: boolean
  /** Page HTML: one viewport PNG per step of this scrolly block (or "all") + a sheet (`#scrolly=<id>&step=n`). */
  scrolly?: string
  /** Reading-hold pace for every capture (`#pace=`; default: the HTML's author pace). */
  pace?: number
  /** Output directory (default: next to the HTML file). */
  outDir?: string
  /** Device scale factor (default 1). */
  scale?: 1 | 2
  /** @deprecated use `at`. */
  t?: string
  browser?: Browser
  signal?: AbortSignal
  /** Per-process hard timeout (default 15 s). */
  timeoutMs?: number
  /** Virtual time budget in ms (default 3000). */
  budgetMs?: number
  /**
   * Compact preview for models / agents (never the full-res sheet):
   * "overview" (default when set) reflows beat sheets into more, smaller tiles so one image
   * fits; "full" keeps the normal sheet layout, split into at most 3 parts when tall.
   */
  preview?: { mode?: "overview" | "full"; maxSize?: number; maxBytes?: number; path?: string }
}

export interface Preview {
  path: string
  width: number
  height: number
  bytes: number
  /** What the image shows, e.g. "beats 1–12 of 12 (4 columns)". */
  shows: string
}

export interface Capture {
  theme: ThemeName | "sheet" | "beats" | "acts"
  /** Story time captured ("end" = final frame). */
  at?: number | "end"
  png: string
  sha256: string
  bytes: number
  width: number
  height: number
  ms: number
}

export interface Gate {
  name: string
  pass: boolean
  detail: string
}

export interface SnapshotReceipt {
  html: string
  browser: { path: string; version?: string; flavor: string; source: string }
  flags: string[]
  captures: Capture[]
  sheet?: Capture
  /** Beat sheets, one per theme. */
  beats?: Capture[]
  /** Act sheets (problem | fix), one per theme. */
  acts?: Capture[]
  /** Compact previews (JPEG, longest side ≤ maxSize) for inline image results. */
  previews?: Preview[]
  story?: { duration: number; steps: number }
  /** Page HTML (full-page captures): its figure ids and the captured page size. */
  page?: { figures: string[]; width: number; height: number }
  lint?: unknown
  gates: Gate[]
  ok: boolean
  createdAt: string
}

export interface SnapshotResult {
  /** 0 pass, 1 gate failure, 2 no browser. */
  code: 0 | 1 | 2
  receipt?: SnapshotReceipt
  receiptPath?: string
  error?: string
}

const HARD_TIMEOUT = 15_000

type SnapScene = { viewBox: Box; title: string; subtitle?: string; timeline?: { duration: number; steps: unknown[]; acts?: { id: string; label: string }[] } }

/** Page HTML (`type: "page"`): its figures' scenes, or undefined for a single-diagram page. */
/** Page HTML: the whole `#storyink-page-data` (slides / scrolly for storytelling captures). */
export function readPageData(html: string): { slides?: unknown[]; scrolly?: Record<string, unknown> } | undefined {
  const m = /<script type="application\/json" id="storyink-page-data">([\s\S]*?)<\/script>/.exec(html)
  return m ? JSON.parse(m[1]) : undefined
}

/** Width / height of a PNG file (IHDR). */
function pngSize(file: string): { w: number; h: number } {
  const b = fs.readFileSync(file)
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

export function readPageFigures(html: string): Record<string, { scene: SnapScene }> | undefined {
  const m = /<script type="application\/json" id="storyink-page-data">([\s\S]*?)<\/script>/.exec(html)
  return m ? (JSON.parse(m[1]).figures as Record<string, { scene: SnapScene }>) : undefined
}

function readScene(html: string, figure?: string): SnapScene {
  const figs = readPageFigures(html)
  if (figs) {
    const ids = Object.keys(figs)
    if (figure && !figs[figure]) throw new Error(`no figure "${figure}" in this page (figures: ${ids.join(", ") || "none"})`)
    const f = figs[figure ?? ids[0]]
    if (!f) throw new Error("page has no figures")
    return f.scene
  }
  if (figure) throw new Error("--figure needs a page HTML (type: page)")
  const m = /<script type="application\/json" id="storyink-data">([\s\S]*?)<\/script>/.exec(html)
  if (!m) throw new Error("not a storyink HTML file (no #storyink-data)")
  const data = JSON.parse(m[1])
  return data.scene
}

interface RunResult {
  ok: boolean
  stdout: string
  stderr: string
  ms: number
}

/**
 * Run one browser process. Resolves when it exits, when stderr reports the
 * screenshot was written (Chrome 153 never exits afterwards, so it is
 * SIGKILLed), when `until` matches stdout, or after the hard timeout.
 */
// Every live browser process; killed (whole process group) on exit or signals.
const live = new Set<ReturnType<typeof spawn>>()
function killTree(child: ReturnType<typeof spawn>) {
  try {
    if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL")
    else child.kill("SIGKILL")
  } catch {
    try {
      child.kill("SIGKILL")
    } catch {}
  }
}
let hooked = false
function hookExit() {
  if (hooked) return
  hooked = true
  process.on("exit", () => {
    for (const c of live) killTree(c)
  })
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
    process.once(sig, () => {
      for (const c of live) killTree(c)
      process.exit(128 + (sig === "SIGINT" ? 2 : sig === "SIGTERM" ? 15 : 1))
    })
}

/** Number of browser processes started by this module that are still running. */
export const liveBrowsers = (): number => live.size

function run(bin: string, args: string[], opts: { untilStdout?: RegExp; timeoutMs: number; signal?: AbortSignal }): Promise<RunResult> {
  hookExit()
  return new Promise((resolve) => {
    const t0 = performance.now()
    // Own process group so helpers (renderer, GPU) die with it.
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" })
    live.add(child)
    let stdout = ""
    let stderr = ""
    let done = false
    let written = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      clearTimeout(timer)
      opts.signal?.removeEventListener("abort", onAbort)
      killTree(child)
      live.delete(child)
      resolve({ ok, stdout, stderr, ms: Math.round(performance.now() - t0) })
    }
    const onAbort = () => finish(false)
    opts.signal?.addEventListener("abort", onAbort)
    const timer = setTimeout(() => finish(written), opts.timeoutMs)
    child.stdout.on("data", (d) => {
      stdout += d
      if (opts.untilStdout?.test(stdout)) finish(true)
    })
    child.stderr.on("data", (d) => {
      stderr += d
      if (/bytes written to file/.test(stderr)) {
        written = true
        finish(true)
      }
    })
    child.on("error", (e) => {
      stderr += String(e)
      finish(false)
    })
    child.on("exit", (code) => {
      live.delete(child)
      finish(code === 0 || written)
    })
  })
}

/** Tile PNGs left to right with ffmpeg's `tile` filter. Returns false when ffmpeg is unavailable or fails. */
export function ffmpegSheet(inputs: string[], out: string): boolean {
  const n = inputs.length
  const filter = `${inputs.map((_, i) => `[${i}:v]`).join("")}concat=n=${n}:v=1:a=0,tile=${n}x1`
  const ff = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs.flatMap((p) => ["-i", p]), "-filter_complex", filter, "-frames:v", "1", out])
  return ff.status === 0 && fs.existsSync(out) && fs.statSync(out).size > 0
}

const sha256 = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex")

/** Screenshot a storyink HTML page in each theme (plus a contact sheet), lint it, and write a receipt. */
export async function snapshot(htmlPath: string, opts: SnapshotOptions = {}): Promise<SnapshotResult> {
  const browser = opts.browser ?? findBrowser()
  if (!browser) return { code: 2, error: "no Chrome/Chromium found (set STORYINK_CHROME)" }
  const abs = path.resolve(htmlPath)
  const html = fs.readFileSync(abs, "utf8")
  const pageFigs = readPageFigures(html)
  const scene = readScene(html, opts.figure)
  const vb = scene.viewBox
  const themes = opts.themes?.length ? opts.themes : (["light", "dark"] as ThemeName[])
  const outDir = path.resolve(opts.outDir ?? path.dirname(abs))
  fs.mkdirSync(outDir, { recursive: true })
  const base = path.basename(abs).replace(/\.html?$/i, "") + (pageFigs && opts.figure ? `.${opts.figure.replace(/[^\w-]/g, "_")}` : "")
  /** `--figure`: every capture shows that figure alone, with the standalone chrome. */
  const solo = pageFigs && opts.figure ? `fig=${encodeURIComponent(opts.figure)}&solo=1&` : ""
  const scale = opts.scale ?? 1
  const timeoutMs = opts.timeoutMs ?? HARD_TIMEOUT
  // Pages hydrate several figures: a longer virtual-time budget before the capture.
  const budget = opts.budgetMs ?? (pageFigs && !opts.figure ? 6000 : 3000)
  // Viewer header (kind line, serif title, optional subtitle, caption slot for stories).
  // `pace`: pinned on every page (#pace=) and recompiled here for this module's own times.
  const pinPace = opts.pace !== undefined && Number.isFinite(opts.pace) && opts.pace >= 0 && opts.pace <= 10 ? opts.pace : undefined
  const tl = pinPace !== undefined ? recompilePace(scene as unknown as Scene, pinPace) : scene.timeline
  const headerH = (scene.subtitle ? 128 : 100) + (tl ? 54 : 0)
  const ats: (number | "end")[] = opts.at?.length ? opts.at : opts.t ? [opts.t === "end" ? "end" : Number(opts.t)] : ["end"]
  const actId = opts.act && tl?.acts?.some((a) => a.id === opts.act) ? opts.act : undefined
  if (opts.act && !actId) return { code: 1, error: `unknown act "${opts.act}"${tl?.acts ? ` (acts: ${tl.acts.map((a) => a.id).join(", ")})` : " (the story has no acts)"}` }
  const tq = (at: number | "end") => (tl ? (actId && at === "end" ? `&act=${encodeURIComponent(actId)}` : `&t=${at === "end" ? "end" : +at.toFixed(3)}`) : "")
  const mq = opts.motion ? `&motion=${opts.motion}` : ""
  const follow = opts.camera === "follow" && !!tl
  const cq = follow ? "&camera=follow" : ""
  // Narration rail / change drawer in the `at` captures (viewer chrome stays off otherwise).
  const dq = `${opts.rail ? "&rail=1" : ""}${opts.drawer ? `&drawer=${encodeURIComponent(opts.drawer)}` : ""}`
  /** Rail / drawer captures show the page viewport (stage + side column), 16:9 at the follow width. */
  const panes = !!(opts.rail || opts.drawer)
  const sheetMode = opts.sheet === false ? false : opts.sheet === "beats" ? "beats" : opts.sheet === "acts" ? (tl?.acts ? "acts" : false) : "themes"
  const W = Math.round(Math.max(500, opts.width ?? Math.min(1600, vb.w + 64)))
  const s = Math.min(1, (W - 64) / vb.w)
  const H = Math.round(headerH + vb.h * s + 64 + 8)
  const FW = Math.round(Math.max(500, opts.width ?? 1280))
  const url = (hash: string) => `${pathToFileURL(abs).href}#${solo}${hash}${pinPace !== undefined && tl ? `&pace=${pinPace}` : ""}`

  const baseFlags = [
    ...(browser.flavor === "chrome" ? ["--headless=new"] : []),
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    `--force-device-scale-factor=${scale}`,
    "--force-prefers-no-reduced-motion",
    "--disable-extensions",
    "--mute-audio",
    `--virtual-time-budget=${budget}`,
  ]
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "storyink-chrome-"))
  let n = 0
  const fresh = () => {
    const d = path.join(tmpRoot, `p${n++}`)
    fs.mkdirSync(d)
    return `--user-data-dir=${d}`
  }
  const shoot = async (hash: string, png: string, w: number, h: number) => {
    fs.rmSync(png, { force: true })
    const args = [...baseFlags, fresh(), `--window-size=${w},${h}`, `--screenshot=${png}`, url(hash)]
    let r = await run(browser.path, args, { timeoutMs, signal: opts.signal })
    if ((!fs.existsSync(png) || fs.statSync(png).size === 0) && !opts.signal?.aborted) {
      // Rare early exits of the headless shell: retry once with a fresh profile.
      const retry = [...baseFlags, fresh(), `--window-size=${w},${h}`, `--screenshot=${png}`, url(hash)]
      r = await run(browser.path, retry, { timeoutMs, signal: opts.signal })
    }
    if (!fs.existsSync(png) || fs.statSync(png).size === 0)
      throw new Error(`screenshot failed (${r.ms} ms): ${r.stderr.split("\n").filter((l) => l.trim()).slice(-3).join(" | ")}`)
    return r.ms
  }

  const gates: Gate[] = []
  const captures: Capture[] = []
  let sheetCap: Capture | undefined
  let beatCaps: Capture[] = []
  const actCaps: Capture[] = []
  let previews: Preview[] = []
  let beatCount: number | undefined

  /** Measure a sheet page's laid-out height in-page (data-content-height). */
  const measure = async (hash: string, w: number): Promise<number | undefined> => {
    const probe = await run(browser.path, [...baseFlags, fresh(), `--window-size=${w},900`, "--dump-dom", url(hash)], {
      timeoutMs,
      untilStdout: /<\/html>\s*$/,
      signal: opts.signal,
    })
    const m = /<html[^>]*data-content-height="(\d+)"/.exec(probe.stdout)
    return m ? Number(m[1]) : undefined
  }
  /** Capture `hash` at w×h CSS px, scaled so the longest side ≤ maxSize, as JPEG within maxBytes. */
  const shootSmall = async (hash: string, w: number, h: number, file: string, maxSize: number, maxBytes: number) => {
    // Page zoom (not device scale factor: Chrome clamps DSF at 0.5) so any size fits maxSize.
    let z = Math.min(1, maxSize / Math.max(w, h))
    let size = { width: 0, height: 0 }
    for (let attempt = 0; attempt < 4; attempt++) {
      fs.rmSync(file, { force: true })
      const pw = Math.max(1, Math.floor(w * z))
      const ph = Math.max(1, Math.floor(h * z))
      const args = [...baseFlags.filter((f) => !f.startsWith("--force-device-scale-factor")), "--force-device-scale-factor=1", fresh(), `--window-size=${pw},${ph}`, `--screenshot=${file}`, url(`${hash}&zoom=${z.toFixed(4)}`)]
      await run(browser.path, args, { timeoutMs, signal: opts.signal })
      if (!fs.existsSync(file)) break
      size = { width: pw, height: ph }
      if (fs.statSync(file).size <= maxBytes) break
      z *= 0.8
    }
    if (!fs.existsSync(file) || fs.statSync(file).size === 0) throw new Error(`preview capture failed: ${file}`)
    return { ...size, bytes: fs.statSync(file).size }
  }
  const makePreviews = async (): Promise<Preview[]> => {
    const p = opts.preview!
    const maxSize = Math.max(256, Math.min(4096, p.maxSize ?? 1024))
    const maxBytes = p.maxBytes ?? 300 * 1024
    const mode = p.mode ?? "overview"
    const theme = themes[0]
    const file0 = p.path ? path.resolve(p.path) : path.join(outDir, `${base}.preview.jpg`)
    fs.mkdirSync(path.dirname(file0), { recursive: true })
    const partFile = (k: number, n: number) => (n === 1 ? file0 : file0.replace(/(\.[a-z]+)?$/i, (ext) => `-${k + 1}${ext || ".jpg"}`))
    const out: Preview[] = []
    if (sheetMode === "beats" && tl) {
      const bw = 1440
      const total = tl.steps.length + 1
      const tileCount = beatCount ?? total
      if (mode === "overview") {
        // Reflow into more columns until the sheet is roughly landscape-to-square, in ONE image.
        let chosen = { cols: 3, h: 0 }
        for (const cols of [3, 4, 5, 6, 8]) {
          const h = (await measure(`theme=${theme}&chrome=0&sheet=beats&cols=${cols}`, bw)) ?? bw
          chosen = { cols, h }
          if (h / bw <= 1.25) break
        }
        const r = await shootSmall(`theme=${theme}&chrome=0&sheet=beats&cols=${chosen.cols}`, bw, chosen.h, partFile(0, 1), maxSize, maxBytes)
        out.push({ path: partFile(0, 1), ...r, shows: `all ${tileCount} beat tiles (${chosen.cols} columns), ${theme}` })
      } else {
        const h = (await measure(`theme=${theme}&chrome=0&sheet=beats`, bw)) ?? bw
        const parts = Math.min(3, Math.max(1, Math.ceil(h / bw / 1.6)))
        const per = Math.ceil(tileCount / parts)
        for (let k = 0; k < parts; k++) {
          const a = k * per
          const b = Math.min(tileCount - 1, a + per - 1)
          if (a > b) break
          const hash = `theme=${theme}&chrome=0&sheet=beats&range=${a}-${b}`
          const ph = (await measure(hash, bw)) ?? bw
          const n = parts
          const r = await shootSmall(hash, bw, ph, partFile(k, n), maxSize, maxBytes)
          out.push({ path: partFile(k, n), ...r, shows: `beat tiles ${a + 1}–${b + 1} of ${tileCount} (part ${k + 1}/${n}), ${theme}` })
        }
      }
    } else if (sheetMode === "acts" && tl?.acts) {
      const colW = Math.max(500, Math.min(1000, vb.w + 48))
      const sw = colW * tl.acts.length
      const sh = Math.round(headerH + 46 + (vb.h * (colW - 48)) / vb.w + 36)
      const r = await shootSmall(`theme=${theme}&chrome=0&sheet=acts`, sw, sh, partFile(0, 1), maxSize, maxBytes)
      out.push({ path: partFile(0, 1), ...r, shows: `${tl.acts.map((a) => a.label).join(" | ")}: each act's settled end, ${theme}` })
    } else if (sheetCap && sheetMode === "themes") {
      const colW = Math.max(500, Math.min(1000, vb.w + 48))
      const sw = colW * themes.length
      const sh = Math.round(headerH + 46 + (vb.h * (colW - 48)) / vb.w + 36)
      const r = await shootSmall(`sheet=${themes.join(",")}&chrome=0`, sw, sh, partFile(0, 1), maxSize, maxBytes)
      out.push({ path: partFile(0, 1), ...r, shows: `${themes.join(" | ")} side by side, final frame` })
    } else {
      const r = await shootSmall(`theme=${theme}&chrome=0${tq("end")}`, W, H, partFile(0, 1), maxSize, maxBytes)
      out.push({ path: partFile(0, 1), ...r, shows: `${theme}, final frame` })
    }
    return out
  }
  if (pageFigs && !opts.figure && (opts.slides || opts.scrolly)) return snapshotTell()
  if (pageFigs && !opts.figure) return snapshotPage()
  let lint: unknown
  try {
    for (const theme of themes)
      for (const at of ats) {
        const tag = `${at === "end" ? (actId ? `.act-${actId.replace(/[^\w-]/g, "_")}` : "") : `.t${+at.toFixed(2)}`}${opts.motion === "reduced" ? ".reduced" : ""}${follow ? ".follow" : ""}${opts.rail ? ".rail" : ""}${opts.drawer ? ".drawer" : ""}`
        const png = path.join(outDir, `${base}.${theme}${tag}.png`)
        const [cw, ch] = follow || panes ? [FW, Math.round(FW * 0.5625)] : [W, H]
        const ms = await shoot(`theme=${theme}&chrome=0${tq(at)}${mq}${cq}${dq}`, png, cw, ch)
        captures.push({ theme, at, png, sha256: sha256(png), bytes: fs.statSync(png).size, width: cw * scale, height: ch * scale, ms })
      }
    // Determinism gate: same t twice, same pixels (a mid-story frame when there is a story).
    const first = captures[0]
    const midT: number | "end" = tl ? (ats.find((a) => a !== "end") ?? +(tl.duration / 2).toFixed(3)) : "end"
    const a1 = path.join(tmpRoot, "same-1.png")
    const a2 = path.join(tmpRoot, "same-2.png")
    // With a rail / drawer: the same page configuration and size as the captures.
    const [GW, GH] = panes ? [FW, Math.round(FW * 0.5625)] : [W, H]
    const gq = panes ? `${mq}${cq}${dq}` : ""
    await shoot(`theme=${first.theme}&chrome=0${tq(midT)}${gq}`, a1, GW, GH)
    await shoot(`theme=${first.theme}&chrome=0${tq(midT)}${gq}`, a2, GW, GH)
    const same = sha256(a1) === sha256(a2)
    gates.push({ name: "deterministic", pass: same, detail: same ? `${first.theme} at t=${midT} captured twice: identical` : `${first.theme} at t=${midT} differs between runs` })
    if (follow) {
      // The follow camera is a pure function of t and the stage: every `at` frame re-captures identically.
      const diff: string[] = []
      for (const c of captures.filter((x) => x.theme === first.theme)) {
        const f2 = path.join(tmpRoot, `follow-${diff.length}-${String(c.at)}.png`)
        await shoot(`theme=${c.theme}&chrome=0${tq(c.at ?? "end")}${mq}${cq}${dq}`, f2, FW, Math.round(FW * 0.5625))
        if (sha256(f2) !== c.sha256) diff.push(String(c.at))
      }
      const at = captures.filter((x) => x.theme === first.theme).map((x) => x.at).join(",")
      gates.push({ name: "follow-deterministic", pass: !diff.length, detail: !diff.length ? `camera=follow at t=${at} captured twice: identical` : `camera=follow at t=${diff.join(",")} differs between runs` })
    }
    if (tl) {
      // End frame = static, and reduced motion = static.
      const stat = path.join(tmpRoot, "static.png")
      const end = path.join(tmpRoot, "end.png")
      const red = path.join(tmpRoot, "reduced.png")
      // Like with like: a rail / drawer request applies to all three (fit camera, capture size).
      const sq = panes ? dq : ""
      await shoot(`theme=${first.theme}&chrome=0&static=1${sq}`, stat, GW, GH)
      await shoot(`theme=${first.theme}&chrome=0&t=end${sq}`, end, GW, GH)
      await shoot(`theme=${first.theme}&chrome=0&motion=reduced${sq}`, red, GW, GH)
      const sStat = sha256(stat)
      gates.push({ name: "end=static", pass: sha256(end) === sStat, detail: sha256(end) === sStat ? "t=end matches the static diagram" : "t=end differs from the static diagram" })
      gates.push({ name: "reduced=static", pass: sha256(red) === sStat, detail: sha256(red) === sStat ? "reduced motion shows the static diagram" : "reduced motion differs from the static diagram" })
      // Reduced motion mid-story: a settled step, never a pulse in flight.
      const probes = tl.steps.map((st) => +((st as { t0: number; t1: number }).t0 / 2 + (st as { t1: number }).t1 / 2).toFixed(3)).filter((_, i, a) => i % Math.max(1, Math.ceil(a.length / 3)) === 0)
      let inFlight = 0
      for (const pt of probes) {
        const d = await run(browser.path, [...baseFlags, fresh(), `--window-size=${W},${H}`, "--dump-dom", url(`theme=${first.theme}&chrome=0&motion=reduced&t=${pt}`)], { timeoutMs, untilStdout: /<\/html>\s*$/, signal: opts.signal })
        if (/data-si="pulse:/.test(d.stdout)) inFlight++
      }
      gates.push({ name: "reduced=stepped", pass: inFlight === 0, detail: inFlight === 0 ? `reduced motion at t=${probes.join(",")}: settled steps, no pulse in flight` : `${inFlight} reduced frame(s) show a pulse in flight` })
    }
    const beats: Capture[] = []
    if (sheetMode === "beats" && tl) {
      const bw = 1440
      for (const theme of themes) {
        // Measure the laid-out sheet in-page, then capture at exactly that height.
        const probe = await run(browser.path, [...baseFlags, fresh(), `--window-size=${bw},900`, "--dump-dom", url(`theme=${theme}&chrome=0&sheet=beats`)], {
          timeoutMs,
          untilStdout: /<\/html>\s*$/,
          signal: opts.signal,
        })
        const mh = /<html[^>]*data-content-height="(\d+)"/.exec(probe.stdout)
        const bh = mh ? Number(mh[1]) : 1800
        const png = path.join(outDir, `${base}.beats.${theme}.png`)
        const ms = await shoot(`theme=${theme}&chrome=0&sheet=beats`, png, bw, bh)
        beats.push({ theme: "beats", png, sha256: sha256(png), bytes: fs.statSync(png).size, width: bw * scale, height: bh * scale, ms })
      }
    }
    beatCaps = beats
    if (sheetMode === "acts" && tl?.acts) {
      // One tile per act side by side (each tile as wide as a themes-sheet column).
      const n = tl.acts.length
      const colW = Math.max(500, Math.min(1000, vb.w + 48))
      const sw = colW * n
      const sh = Math.round(headerH + 46 + (vb.h * (colW - 48)) / vb.w + 36)
      for (const theme of themes) {
        const png = path.join(outDir, `${base}.acts.${theme}.png`)
        const ms = await shoot(`theme=${theme}&chrome=0&sheet=acts`, png, sw, sh)
        actCaps.push({ theme: "acts", png, sha256: sha256(png), bytes: fs.statSync(png).size, width: sw * scale, height: sh * scale, ms })
      }
    }
    if (tl) beatCount = beatTimes(tl as never).length

    if (sheetMode === "themes" && themes.length > 1) {
      const colW = Math.max(500, Math.min(1000, vb.w + 48))
      const sw = colW * themes.length
      const sh = Math.round(headerH + 46 + (vb.h * (colW - 48)) / vb.w + 36)
      const png = path.join(outDir, `${base}.sheet.png`)
      try {
        if (process.env.STORYINK_SHEET === "ffmpeg") throw new Error("forced ffmpeg sheet")
        const ms = await shoot(`sheet=${themes.join(",")}&chrome=0`, png, sw, sh)
        sheetCap = { theme: "sheet", png, sha256: sha256(png), bytes: fs.statSync(png).size, width: sw * scale, height: sh * scale, ms }
      } catch (e) {
        // Fallback: ffmpeg `tile` of the per-theme captures (all the same size).
        const ff = ffmpegSheet(captures.map((c) => c.png), png)
        if (ff) sheetCap = { theme: "sheet", png, sha256: sha256(png), bytes: fs.statSync(png).size, width: W * captures.length * scale, height: H * scale, ms: 0 }
        else gates.push({ name: "sheet", pass: false, detail: String((e as Error).message) })
      }
    }

    if (opts.preview) previews = await makePreviews()

    // Lint via --dump-dom.
    const dom = await run(browser.path, [...baseFlags, fresh(), `--window-size=${W},${H}`, "--dump-dom", url(`theme=${themes[0]}&chrome=0${tq("end")}`)], {
      timeoutMs,
      untilStdout: /<\/html>\s*$/,
      signal: opts.signal,
    })
    const lm = /<script type="application\/json" id="storyink-lint">([\s\S]*?)<\/script>/.exec(dom.stdout)
    const ready = /<html[^>]*data-ready="1"/.test(dom.stdout)
    gates.push({ name: "ready", pass: ready, detail: ready ? "hydrated, fonts ready" : "page never signalled ready" })
    if (lm) {
      lint = JSON.parse(lm[1])
      const l = lint as { ok: boolean; issues: unknown[] }
      gates.push({ name: "lint", pass: l.ok, detail: l.ok ? "no overflow or overlap" : `${l.issues.length} issue(s)` })
    } else gates.push({ name: "lint", pass: false, detail: "no lint output in DOM" })
  } catch (e) {
    gates.push({ name: "capture", pass: false, detail: (e as Error).message })
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  }

  const receipt: SnapshotReceipt = {
    html: abs,
    browser: { path: browser.path, version: browser.version ?? browserVersion(browser.path), flavor: browser.flavor, source: browser.source },
    flags: [...baseFlags, "--user-data-dir=<fresh tmp>", `--window-size=${W},${H}`],
    captures,
    ...(sheetCap ? { sheet: sheetCap } : {}),
    ...(beatCaps.length ? { beats: beatCaps } : {}),
    ...(actCaps.length ? { acts: actCaps } : {}),
    ...(previews.length ? { previews } : {}),
    ...(tl ? { story: { duration: tl.duration, steps: tl.steps.length } } : {}),
    ...(lint ? { lint } : {}),
    gates,
    ok: gates.every((g) => g.pass),
    createdAt: new Date().toISOString(),
  }
  const receiptPath = path.join(outDir, `${base}.receipt.json`)
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)
  return { code: receipt.ok ? 0 : 1, receipt, receiptPath }

  /**
   * Page HTML without `--figure`: one full-page PNG per theme (width default 1280, height measured
   * in-page), gates ready / lint (figures + page text) / deterministic, optional compact preview
   * (tall pages split into ≤ 3 parts). Figures are capped at a fixed height (`#figmax=`) so the
   * page lays out the same whatever the window height.
   */
  /**
   * Page storytelling captures: slides (`--slides`, `--builds`: 1280×720 frames per slide / build
   * state) and scrolly steps (`--scrolly <id|all>`: a 1280×800 viewport per step, settled), one set
   * per theme, plus a labelled contact sheet per set; gates ready / lint (incl. `slide-overflow`) /
   * deterministic; `--preview` is a compact JPEG of the first sheet.
   */
  async function snapshotTell(): Promise<SnapshotResult> {
    const data = readPageData(html) ?? {}
    const tgates: Gate[] = []
    const tcaps: Capture[] = []
    const sheets: Capture[] = []
    const tprev: Preview[] = []
    let tlint: unknown
    type Shot = { hash: string; label: string; tag: string; w: number; h: number }
    const shots: Shot[] = []
    if (opts.slides) {
      const list = (data.slides ?? []) as { title?: string; builds?: number; build?: { targets: unknown[] } }[]
      list.forEach((sl, i) => {
        const n = opts.builds ? (sl.build?.targets.length ?? sl.builds ?? 0) : 0
        for (let b = 0; b <= n; b++)
          shots.push({ hash: `present=1&slide=${i + 1}&build=${b}`, label: `${i + 1}${n ? `.${b}` : ""} ${sl.title ?? ""}`, tag: `slide${String(i + 1).padStart(2, "0")}${opts.builds && n ? `.b${b}` : ""}`, w: 1280, h: 764 })
      })
    }
    if (opts.scrolly) {
      const sc = (data.scrolly ?? {}) as Record<string, { steps: unknown[] }>
      const ids = opts.scrolly === "all" ? Object.keys(sc) : [opts.scrolly]
      for (const id of ids) {
        if (!sc[id]) {
          tgates.push({ name: "scrolly", pass: false, detail: `no scrolly "${id}" (have: ${Object.keys(sc).join(", ") || "none"})` })
          continue
        }
        sc[id].steps.forEach((_, i) => shots.push({ hash: `scrolly=${encodeURIComponent(id)}&step=${i + 1}`, label: `${id} · step ${i + 1}`, tag: `scrolly-${id.replace(/[^\w-]/g, "_")}.s${String(i + 1).padStart(2, "0")}`, w: 1280, h: 800 }))
      }
    }
    try {
      if (!shots.length) throw new Error(opts.slides ? "this page has no slides" : "no scrolly steps to capture")
      for (const theme of themes) {
        const mine: Capture[] = []
        for (const sh of shots) {
          const png = path.join(outDir, `${base}.${theme}.${sh.tag}.png`)
          const ms = await shoot(`theme=${theme}&${sh.hash}`, png, sh.w, sh.h)
          const c = { theme, png, sha256: sha256(png), bytes: fs.statSync(png).size, width: sh.w * scale, height: sh.h * scale, ms }
          tcaps.push(c)
          mine.push(c)
        }
        const kind = opts.slides ? "slides" : "scrolly"
        const sheet = path.join(outDir, `${base}.${kind}.${theme}.png`)
        const cols = Math.min(4, mine.length)
        const r = await sheetShot(mine.map((c, i) => ({ png: c.png, label: shots[i].label })), cols, 400, sheet)
        sheets.push({ theme: "sheet", png: sheet, sha256: sha256(sheet), bytes: fs.statSync(sheet).size, width: r.w * scale, height: r.h * scale, ms: r.ms })
      }
      // Determinism: a middle capture again.
      const mid = shots[Math.floor(shots.length / 2)]
      const c0 = tcaps[Math.floor(shots.length / 2)]
      const again = path.join(tmpRoot, "tell-again.png")
      await shoot(`theme=${themes[0]}&${mid.hash}`, again, mid.w, mid.h)
      let same = sha256(again) === c0.sha256
      // Scrolly frames scroll a sticky graphic: Chrome's raster of its 1 px border can differ
      // between processes; one re-capture separates that from a real (layout / state) difference.
      let retried = false
      if (!same && mid.hash.startsWith("scrolly=")) {
        retried = true
        await shoot(`theme=${themes[0]}&${mid.hash}`, again, mid.w, mid.h)
        same = sha256(again) === c0.sha256
      }
      tgates.push({ name: "deterministic", pass: same, detail: same ? `${mid.tag} captured twice: identical${retried ? " (after one re-capture)" : ""}` : `${mid.tag} differs between runs` })
      if (opts.preview && sheets[0]) {
        const p = opts.preview
        const maxSize = Math.max(256, Math.min(4096, p.maxSize ?? 1024))
        const file = p.path ? path.resolve(p.path) : path.join(outDir, `${base}.preview.jpg`)
        fs.mkdirSync(path.dirname(file), { recursive: true })
        const firstTheme = tcaps.filter((c) => c.theme === themes[0])
        const cols = Math.min(4, firstTheme.length)
        const rows = Math.ceil(firstTheme.length / cols)
        const ratio = shots[0].h / shots[0].w
        // Cell width so the sheet's longest side fits maxSize.
        const cw = Math.max(80, Math.floor(Math.min(maxSize / cols, maxSize / (rows * (ratio + 0.1))) - 12))
        const r = await sheetShot(firstTheme.map((c, i) => ({ png: c.png, label: shots[i].label })), cols, cw, file)
        tprev.push({ path: file, width: r.w, height: r.h, bytes: fs.statSync(file).size, shows: `${firstTheme.length} ${opts.slides ? "slide" : "scrolly"} frames (${cols} columns), ${themes[0]}` })
      }
      const dom = await run(browser!.path, [...baseFlags, fresh(), `--window-size=${shots[0].w},${shots[0].h}`, "--dump-dom", url(`theme=${themes[0]}&${shots[0].hash}`)], { timeoutMs, untilStdout: /<\/html>\s*$/, signal: opts.signal })
      const ready = /<html[^>]*data-ready="1"/.test(dom.stdout)
      tgates.push({ name: "ready", pass: ready, detail: ready ? "page hydrated, fonts ready" : "page never signalled ready" })
      const lm = /<script type="application\/json" id="storyink-lint">([\s\S]*?)<\/script>/.exec(dom.stdout)
      if (lm) {
        tlint = JSON.parse(lm[1])
        const l = tlint as { ok: boolean; figures?: Record<string, { issues: unknown[] }>; page?: { issues: unknown[] } }
        const n = Object.values(l.figures ?? {}).reduce((a, f) => a + (f.issues?.length ?? 0), 0) + (l.page?.issues.length ?? 0)
        tgates.push({ name: "lint", pass: l.ok, detail: l.ok ? `figures, page text${opts.slides ? " and slides" : ""}: no overflow or overlap` : `${n} issue(s)` })
      } else tgates.push({ name: "lint", pass: false, detail: "no lint output in DOM" })
    } catch (e) {
      tgates.push({ name: "capture", pass: false, detail: (e as Error).message })
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    }
    const rc: SnapshotReceipt = {
      html: abs,
      browser: { path: browser!.path, version: browser!.version ?? browserVersion(browser!.path), flavor: browser!.flavor, source: browser!.source },
      flags: [...baseFlags, "--user-data-dir=<fresh tmp>"],
      captures: tcaps,
      ...(sheets[0] ? { sheet: sheets[0] } : {}),
      ...(sheets.length > 1 ? { beats: sheets.slice(1) } : {}),
      ...(tprev.length ? { previews: tprev } : {}),
      page: { figures: Object.keys(pageFigs!), width: 1280, height: shots[0]?.h ?? 0 },
      ...(tlint ? { lint: tlint } : {}),
      gates: tgates,
      ok: tgates.every((g) => g.pass),
      createdAt: new Date().toISOString(),
    }
    const rp = path.join(outDir, `${base}.receipt.json`)
    fs.writeFileSync(rp, `${JSON.stringify(rc, null, 2)}\n`)
    return { code: rc.ok ? 0 : 1, receipt: rc, receiptPath: rp }
  }

  /** A labelled contact sheet of PNGs (a small local HTML page, screenshot at its exact size). */
  async function sheetShot(cells: { png: string; label: string }[], cols: number, cellW: number, out: string): Promise<{ w: number; h: number; ms: number }> {
    const first = cells[0]
    const dims = first ? pngSize(first.png) : { w: 16, h: 9 }
    const cellH = Math.round((cellW * dims.h) / dims.w)
    const gap = 12
    const labelH = 18
    const rows = Math.ceil(cells.length / cols)
    const w = cols * cellW + (cols + 1) * gap
    const h = rows * (cellH + labelH) + (rows + 1) * gap
    const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    const page = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#e7e5e0;font:11px ui-monospace,monospace;color:#3b3934}.g{display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:${gap}px;padding:${gap}px}.c img{display:block;width:${cellW}px;height:${cellH}px;border:1px solid #c9c5bc;box-sizing:border-box}.c p{margin:0;height:${labelH}px;line-height:${labelH}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}</style></head><body><div class="g">${cells.map((c) => `<div class="c"><p>${esc(c.label)}</p><img src="${pathToFileURL(c.png).href}"></div>`).join("")}</div></body></html>`
    const f = path.join(tmpRoot, `sheet-${n++}.html`)
    fs.writeFileSync(f, page)
    fs.rmSync(out, { force: true })
    const t0 = Date.now()
    await run(browser!.path, [...baseFlags.filter((x) => !x.startsWith("--force-device-scale-factor")), "--force-device-scale-factor=1", fresh(), `--window-size=${w},${h}`, `--screenshot=${out}`, pathToFileURL(f).href], { timeoutMs, signal: opts.signal })
    if (!fs.existsSync(out)) throw new Error(`sheet capture failed: ${out}`)
    return { w, h, ms: Date.now() - t0 }
  }

  async function snapshotPage(): Promise<SnapshotResult> {
    const PW = Math.round(Math.max(500, opts.width ?? 1280))
    // Figures at their final frame (deterministic, no gate), capped at a fixed height.
    const fq = `&static=1&figmax=${Math.round(0.9 * 900)}`
    const pgates: Gate[] = []
    const pcaps: Capture[] = []
    const pprev: Preview[] = []
    let plint: unknown
    let PH = 0
    try {
      for (const theme of themes) {
        const h = Math.min(16000, (await measure(`theme=${theme}${fq}`, PW)) ?? 2400)
        PH = PH || h
        const png = path.join(outDir, `${base}.${theme}.png`)
        const ms = await shoot(`theme=${theme}${fq}`, png, PW, h)
        pcaps.push({ theme, png, sha256: sha256(png), bytes: fs.statSync(png).size, width: PW * scale, height: h * scale, ms })
      }
      const first = pcaps[0]
      const again = path.join(tmpRoot, "page-again.png")
      await shoot(`theme=${first.theme}${fq}`, again, PW, first.height / scale)
      const same = sha256(again) === first.sha256
      pgates.push({ name: "deterministic", pass: same, detail: same ? `${first.theme} page captured twice: identical` : `${first.theme} page differs between runs` })
      if (opts.preview) {
        const p = opts.preview
        const maxSize = Math.max(256, Math.min(4096, p.maxSize ?? 1024))
        const maxBytes = p.maxBytes ?? 300 * 1024
        const file0 = p.path ? path.resolve(p.path) : path.join(outDir, `${base}.preview.jpg`)
        fs.mkdirSync(path.dirname(file0), { recursive: true })
        const n = Math.max(1, Math.min(3, Math.ceil(PH / (PW * 1.5))))
        const ph = Math.ceil(PH / n)
        for (let k = 0; k < n; k++) {
          const file = n === 1 ? file0 : file0.replace(/(\.[a-z]+)?$/i, (ext) => `-${k + 1}${ext || ".jpg"}`)
          const r = await shootSmall(`theme=${themes[0]}${fq}&scroll=${k * ph}`, PW, ph, file, maxSize, maxBytes)
          pprev.push({ path: file, ...r, shows: n === 1 ? `the whole page, ${themes[0]}` : `page part ${k + 1}/${n} (from y=${k * ph}), ${themes[0]}` })
        }
      }
      const dom = await run(browser!.path, [...baseFlags, fresh(), `--window-size=${PW},900`, "--dump-dom", url(`theme=${themes[0]}${fq}`)], { timeoutMs, untilStdout: /<\/html>\s*$/, signal: opts.signal })
      const ready = /<html[^>]*data-ready="1"/.test(dom.stdout)
      pgates.push({ name: "ready", pass: ready, detail: ready ? `${Object.keys(pageFigs!).length} figure(s) hydrated, fonts ready` : "page never signalled ready" })
      const lm = /<script type="application\/json" id="storyink-lint">([\s\S]*?)<\/script>/.exec(dom.stdout)
      if (lm) {
        plint = JSON.parse(lm[1])
        const l = plint as { ok: boolean; figures?: Record<string, { ok: boolean; issues: unknown[] }>; page?: { issues: unknown[] } }
        const n = Object.values(l.figures ?? {}).reduce((a, f) => a + (f.issues?.length ?? 0), 0) + (l.page?.issues.length ?? 0)
        pgates.push({ name: "lint", pass: l.ok, detail: l.ok ? "figures and page text: no overflow or overlap" : `${n} issue(s)` })
      } else pgates.push({ name: "lint", pass: false, detail: "no lint output in DOM" })
    } catch (e) {
      pgates.push({ name: "capture", pass: false, detail: (e as Error).message })
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    }
    const rc: SnapshotReceipt = {
      html: abs,
      browser: { path: browser!.path, version: browser!.version ?? browserVersion(browser!.path), flavor: browser!.flavor, source: browser!.source },
      flags: [...baseFlags, "--user-data-dir=<fresh tmp>", `--window-size=${PW},<page height>`],
      captures: pcaps,
      ...(pprev.length ? { previews: pprev } : {}),
      page: { figures: Object.keys(pageFigs!), width: PW, height: PH },
      ...(plint ? { lint: plint } : {}),
      gates: pgates,
      ok: pgates.every((g) => g.pass),
      createdAt: new Date().toISOString(),
    }
    const rp = path.join(outDir, `${base}.receipt.json`)
    fs.writeFileSync(rp, `${JSON.stringify(rc, null, 2)}\n`)
    return { code: rc.ok ? 0 : 1, receipt: rc, receiptPath: rp }
  }
}

/**
 * Screenshot any local HTML page (e.g. a page holding an animated SVG) at w×h CSS px.
 * `budgetMs` is Chrome's virtual time budget (wall-clock-free; SMIL advances with it).
 */
export async function screenshotPage(
  htmlPath: string,
  png: string,
  size: { width: number; height: number },
  opts: { browser?: Browser; budgetMs?: number; timeoutMs?: number; flags?: string[] } = {},
): Promise<{ ok: boolean; ms: number }> {
  const browser = opts.browser ?? findBrowser()
  if (!browser) return { ok: false, ms: 0 }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storyink-shot-"))
  try {
    fs.rmSync(png, { force: true })
    const args = [
      ...(browser.flavor === "chrome" ? ["--headless=new"] : []),
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--force-prefers-no-reduced-motion",
      ...(opts.budgetMs !== undefined ? [`--virtual-time-budget=${opts.budgetMs}`] : []),
      ...(opts.flags ?? []),
      `--user-data-dir=${dir}`,
      `--window-size=${size.width},${size.height}`,
      `--screenshot=${png}`,
      /^[a-z]+:/.test(htmlPath) ? htmlPath : pathToFileURL(path.resolve(htmlPath)).href,
    ]
    const r = await run(browser.path, args, { timeoutMs: opts.timeoutMs ?? HARD_TIMEOUT })
    return { ok: fs.existsSync(png) && fs.statSync(png).size > 0, ms: r.ms }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
