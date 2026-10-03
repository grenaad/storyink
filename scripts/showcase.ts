/**
 * Showcase PNGs of the HTML-only features (narration rail, change drawer, pages, scrollytelling,
 * slides), light + dark, to docs/gallery/<example>.<view>.<theme>.png. Built on the CLI
 * (`storyink render` + `storyink snapshot`, deterministic frames), then cropped / downscaled to
 * ≤ 1600 px wide and palette-quantized with ffmpeg (copied as-is without ffmpeg).
 * Usage: bun run gallery:showcase [--only view,view]   (views: rail, drawer, page, page-diff, scrolly, slides, slide)
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

const root = path.resolve(import.meta.dir, "..")
const out = path.join(root, "docs/gallery")
const cli = path.join(root, "src/cli.ts")
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "storyink-showcase-"))
const THEMES = ["light", "dark"] as const
const CHANGES = path.join(root, "examples/changes/storyink-0.4.0.changes.json")
const oi = process.argv.indexOf("--only")
const only = oi > 0 ? new Set(process.argv[oi + 1].split(",")) : undefined

function run(args: string[]): unknown {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 })
  if (r.status !== 0) throw new Error(`storyink ${args.join(" ")} failed (${r.status}):\n${r.stderr}${r.stdout.slice(-2000)}`)
  return args.includes("--json") ? JSON.parse(r.stdout) : undefined
}
const render = (spec: string, html: string, changes?: string) => run(["render", spec, "-o", html, ...(changes ? ["--changes", changes] : [])])
type Receipt = { receipt: { captures: { theme: string; png: string }[]; sheet?: { png: string }; sheets?: { png: string }[] } }
const snap = (html: string, dir: string, flags: string[]) => run(["snapshot", html, "--theme", "light,dark", "-o", dir, "--json", ...flags]) as Receipt

/** Optional crop (CSS px of the 1× capture), downscale to ≤ 1600 px wide, 128-colour palette. */
function publish(src: string, name: string, crop?: { y: number; h: number }) {
  const dest = path.join(out, name)
  const vf = [crop ? `crop=iw:${crop.h}:0:${crop.y}` : "", "scale='min(1600,iw)':-2:flags=lanczos", "split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=none"].filter(Boolean).join(",")
  const q = spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-i", src, "-vf", vf, dest])
  if (q.status !== 0 || !fs.existsSync(dest)) fs.copyFileSync(src, dest)
  console.log(`${path.relative(root, dest)} ${(fs.statSync(dest).size / 1024).toFixed(0)} KiB`)
}
const byTheme = (r: Receipt, theme: string, match = "") => {
  const c = r.receipt.captures.find((x) => x.theme === theme && x.png.includes(match))
  if (!c) throw new Error(`no ${theme} capture matching "${match}"`)
  return c.png
}
const want = (v: string) => !only || only.has(v)

// 1. Narration rail mid-story: the PR walkthrough resolved against the real 0.4.0 diff, beat 2 of 7.
const pr = path.join(tmp, "storyink-0.4.0.pr.html")
if (want("rail") || want("drawer")) render("examples/changes/storyink-0.4.0.pr.json", pr, CHANGES)
if (want("rail")) {
  const r = snap(pr, path.join(tmp, "rail"), ["--rail", "--camera", "follow", "--at", "9", "--no-sheet"])
  for (const t of THEMES) publish(byTheme(r, t), `storyink-0.4.0.rail.${t}.png`)
}
// 2. Change drawer open on a node with real (embedded) hunks.
if (want("drawer")) {
  const r = snap(pr, path.join(tmp, "drawer"), ["--drawer", "panels", "--camera", "follow", "--at", "end", "--no-sheet"])
  for (const t of THEMES) publish(byTheme(r, t), `storyink-0.4.0.drawer.${t}.png`)
}
// 3. A page: full-page capture, cropped to the top (header, KPIs, figure) and to the file map + diffs.
if (want("page") || want("page-diff")) {
  const html = path.join(tmp, "pr-review.html")
  render("examples/pages/pr-review.page.json", html)
  const r = snap(html, path.join(tmp, "page"), ["--no-sheet"])
  for (const t of THEMES) {
    if (want("page")) publish(byTheme(r, t), `pr-review.page.${t}.png`, { y: 0, h: 1400 })
    if (want("page-diff")) publish(byTheme(r, t), `pr-review.page-diff.${t}.png`, { y: 1690, h: 1110 })
  }
}
// 4. Scrollytelling: one mid step of the sticky figure + step cards.
if (want("scrolly")) {
  const html = path.join(tmp, "payment-retry.scrolly.html")
  render("examples/pages/payment-retry.scrolly.page.json", html)
  const r = snap(html, path.join(tmp, "scrolly"), ["--scrolly", "retry", "--no-sheet"])
  for (const t of THEMES) publish(byTheme(r, t, ".s03"), `payment-retry.scrolly.step3.${t}.png`)
}
// 5. Slides: the contact sheet (entry state per slide) and one frame mid-build.
if (want("slides") || want("slide")) {
  const html = path.join(tmp, "pr-review.deck.html")
  render("examples/pages/pr-review.deck.page.json", html)
  if (want("slides"))
    for (const t of THEMES) {
      const r = run(["snapshot", html, "--theme", t, "--slides", "-o", path.join(tmp, `slides-${t}`), "--json"]) as Receipt
      const sheet = r.receipt.sheet?.png ?? r.receipt.sheets?.[0]?.png
      if (!sheet) throw new Error("no slides sheet")
      publish(sheet, `pr-review.deck.slides.${t}.png`)
    }
  if (want("slide")) {
    const r = snap(html, path.join(tmp, "builds"), ["--builds", "--no-sheet"])
    for (const t of THEMES) publish(byTheme(r, t, ".slide03.b4."), `pr-review.deck.slide3-build4.${t}.png`)
  }
}
fs.rmSync(tmp, { recursive: true, force: true })
