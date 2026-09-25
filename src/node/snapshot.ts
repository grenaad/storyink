import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import type { ThemeName } from "../theme/tokens.ts"
import type { Box } from "../core/scene.ts"
import { browserVersion, findBrowser, type Browser } from "./chrome.ts"
import { beatTileMin } from "../core/story/state.ts"

export interface SnapshotOptions {
  /** Themes to capture (default light, dark). */
  themes?: ThemeName[]
  /** Window width in CSS px (default derived from the viewBox, min 500). */
  width?: number
  /**
   * Contact sheet: true / "themes" (default) = themes side by side;
   * "beats" = one tile per story step plus the final frame (per theme); false = none.
   */
  sheet?: boolean | "themes" | "beats"
  /** Story times to capture: seconds or "end" (default ["end"]). */
  at?: (number | "end")[]
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
}

export interface Capture {
  theme: ThemeName | "sheet" | "beats"
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
  story?: { duration: number; steps: number }
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

function readScene(html: string): { viewBox: Box; title: string; subtitle?: string; timeline?: { duration: number; steps: unknown[] } } {
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
  const scene = readScene(html)
  const vb = scene.viewBox
  const themes = opts.themes?.length ? opts.themes : (["light", "dark"] as ThemeName[])
  const outDir = path.resolve(opts.outDir ?? path.dirname(abs))
  fs.mkdirSync(outDir, { recursive: true })
  const base = path.basename(abs).replace(/\.html?$/i, "")
  const scale = opts.scale ?? 1
  const timeoutMs = opts.timeoutMs ?? HARD_TIMEOUT
  const budget = opts.budgetMs ?? 3000
  // Viewer header (kind line, serif title, optional subtitle, caption slot for stories).
  const tl = scene.timeline
  const headerH = (scene.subtitle ? 128 : 100) + (tl ? 54 : 0)
  const ats: (number | "end")[] = opts.at?.length ? opts.at : opts.t ? [opts.t === "end" ? "end" : Number(opts.t)] : ["end"]
  const tq = (at: number | "end") => (tl ? `&t=${at === "end" ? "end" : +at.toFixed(3)}` : "")
  const sheetMode = opts.sheet === false ? false : opts.sheet === "beats" ? "beats" : "themes"
  const W = Math.round(Math.max(500, opts.width ?? Math.min(1600, vb.w + 64)))
  const s = Math.min(1, (W - 64) / vb.w)
  const H = Math.round(headerH + vb.h * s + 64 + 8)
  const url = (hash: string) => `${pathToFileURL(abs).href}#${hash}`

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
    const r = await run(browser.path, args, { timeoutMs, signal: opts.signal })
    if (!fs.existsSync(png) || fs.statSync(png).size === 0)
      throw new Error(`screenshot failed (${r.ms} ms): ${r.stderr.split("\n").filter((l) => l.trim()).slice(-3).join(" | ")}`)
    return r.ms
  }

  const gates: Gate[] = []
  const captures: Capture[] = []
  let sheetCap: Capture | undefined
  let beatCaps: Capture[] = []
  let lint: unknown
  try {
    for (const theme of themes)
      for (const at of ats) {
        const tag = at === "end" ? "" : `.t${+at.toFixed(2)}`
        const png = path.join(outDir, `${base}.${theme}${tag}.png`)
        const ms = await shoot(`theme=${theme}&chrome=0${tq(at)}`, png, W, H)
        captures.push({ theme, at, png, sha256: sha256(png), bytes: fs.statSync(png).size, width: W * scale, height: H * scale, ms })
      }
    // Determinism gate: same t twice, same pixels (a mid-story frame when there is a story).
    const first = captures[0]
    const midT: number | "end" = tl ? (ats.find((a) => a !== "end") ?? +(tl.duration / 2).toFixed(3)) : "end"
    const a1 = path.join(tmpRoot, "same-1.png")
    const a2 = path.join(tmpRoot, "same-2.png")
    await shoot(`theme=${first.theme}&chrome=0${tq(midT)}`, a1, W, H)
    await shoot(`theme=${first.theme}&chrome=0${tq(midT)}`, a2, W, H)
    const same = sha256(a1) === sha256(a2)
    gates.push({ name: "deterministic", pass: same, detail: same ? `${first.theme} at t=${midT} captured twice: identical` : `${first.theme} at t=${midT} differs between runs` })
    if (tl) {
      // End frame = static, and reduced motion = static.
      const stat = path.join(tmpRoot, "static.png")
      const end = path.join(tmpRoot, "end.png")
      const red = path.join(tmpRoot, "reduced.png")
      await shoot(`theme=${first.theme}&chrome=0&static=1`, stat, W, H)
      await shoot(`theme=${first.theme}&chrome=0&t=end`, end, W, H)
      await shoot(`theme=${first.theme}&chrome=0&motion=reduced`, red, W, H)
      const sStat = sha256(stat)
      gates.push({ name: "end=static", pass: sha256(end) === sStat, detail: sha256(end) === sStat ? "t=end matches the static diagram" : "t=end differs from the static diagram" })
      gates.push({ name: "reduced=static", pass: sha256(red) === sStat, detail: sha256(red) === sStat ? "reduced motion shows the static diagram" : "reduced motion differs from the static diagram" })
    }
    const beats: Capture[] = []
    if (sheetMode === "beats" && tl) {
      const n = tl.steps.length + 1
      const bw = 1440
      const cols = Math.max(1, Math.floor((bw - 48 + 20) / (beatTileMin(vb.w) + 20)))
      const colW = (bw - 48 - (cols - 1) * 20) / cols
      const tileH = (colW * vb.h) / vb.w + 52
      const bh = Math.round(headerH + 14 + Math.ceil(n / cols) * (tileH + 18) + 24)
      for (const theme of themes) {
        const png = path.join(outDir, `${base}.beats.${theme}.png`)
        const ms = await shoot(`theme=${theme}&chrome=0&sheet=beats`, png, bw, bh)
        beats.push({ theme: "beats", png, sha256: sha256(png), bytes: fs.statSync(png).size, width: bw * scale, height: bh * scale, ms })
      }
    }
    beatCaps = beats

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
    ...(tl ? { story: { duration: tl.duration, steps: tl.steps.length } } : {}),
    ...(lint ? { lint } : {}),
    gates,
    ok: gates.every((g) => g.pass),
    createdAt: new Date().toISOString(),
  }
  const receiptPath = path.join(outDir, `${base}.receipt.json`)
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)
  return { code: receipt.ok ? 0 : 1, receipt, receiptPath }
}
