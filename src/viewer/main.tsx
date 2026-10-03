import type { ReactElement } from "react"
import { createRoot, hydrateRoot } from "react-dom/client"
import { paletteCss, palettes, type ThemeName } from "../theme/tokens.ts"
import type { Scene } from "../core/scene.ts"
import { App, parseHash, type ViewerHooks } from "../core/render/App.tsx"
import { lintDom } from "./lint.ts"
import { createCounterOverlay } from "./counters.ts"
import { lintPageText } from "./page-lint.ts"
import { initDeck, initScrolly, type SlideIssue, type TellData } from "./tell.ts"

interface Data {
  version: string
  scene: Scene
}

/** `#storyink-page-data`: a page's figures (`type: "page"`). */
interface PageData extends TellData {
  version: string
  figures: Record<string, { scene: Scene }>
}

declare global {
  interface Window {
    __storyink?: {
      ready: boolean
      whenReady: Promise<void>
      duration: number
      setTime: (t: number | "end") => void
      lint?: unknown
      version: string
    }
  }
}

/** Self-contained SVG of the diagram on screen inside `root` (a page figure, or the document). */
function exportSvgText(theme: ThemeName, root: ParentNode): string {
  const live = root.querySelector<SVGSVGElement>(".si-stage svg.storyink, svg.storyink")!
  const svg = live.cloneNode(true) as SVGSVGElement
  svg.querySelectorAll(".si-counter-value").forEach((el) => el.removeAttribute("fill-opacity"))
  const font = document.getElementById("storyink-font")?.textContent ?? ""
  const rules = document.getElementById("storyink-diagram-css")?.textContent ?? ""
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style")
  style.textContent = `${font}\nsvg.storyink{${paletteCss(theme, true)}}\n${rules}`
  svg.insertBefore(style, svg.firstChild?.nextSibling ?? null)
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg")
  svg.removeAttribute("data-copy")
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "diagram"
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Last export (for automated tests via window.__storyink.lastExport). */
let lastExport: { kind: string; bytes: number; text?: string } | undefined

/** Viewer hooks for one diagram: exports, counters and lint scoped to `root`. */
function makeHooks(scene: Scene, root: ParentNode, onLint: (lint: unknown, sheet: boolean) => void): ViewerHooks {
  const counters = createCounterOverlay(scene, root)
  return {
    exportSvg(theme) {
      const text = exportSvgText(theme, root)
      lastExport = { kind: "svg", bytes: text.length, text }
      download(new Blob([text], { type: "image/svg+xml" }), `${slug(scene.title)}-${theme}.svg`)
    },
    async exportPng(theme) {
      // Serialize first: the chosen frame (final or current) is only on screen synchronously.
      const text = exportSvgText(theme, root)
      await document.fonts.ready
      const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }))
      const img = new Image()
      img.decoding = "sync"
      await new Promise<void>((res, rej) => {
        img.onload = () => res()
        img.onerror = () => rej(new Error("svg image failed to load"))
        img.src = url
      })
      const scale = 2
      const canvas = document.createElement("canvas")
      canvas.width = Math.ceil(scene.viewBox.w * scale)
      canvas.height = Math.ceil(scene.viewBox.h * scale)
      const ctx = canvas.getContext("2d")!
      ctx.fillStyle = palettes[theme].bg
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      canvas.toBlob((b) => {
        if (!b) return
        lastExport = { kind: "png", bytes: b.size }
        download(b, `${slug(scene.title)}-${theme}@2x.png`)
      }, "image/png")
    },
    onFrame(frame, playing, tl) {
      counters.update(frame, playing, tl)
    },
    onReady(sheet) {
      void document.fonts.ready.then(() => {
        setTimeout(() => {
          let lint: unknown
          try {
            lint = lintDom(root, scene, sheet)
          } catch (e) {
            lint = { ok: false, issues: [{ kind: "error", ids: [], detail: String(e) }], checked: {} }
          }
          onLint(lint, sheet)
        }, 0)
      })
    },
  }
}

function writeLint(lint: unknown) {
  let el = document.getElementById("storyink-lint")
  if (!el) {
    el = document.createElement("script")
    el.setAttribute("type", "application/json")
    el.id = "storyink-lint"
    document.body.appendChild(el)
  }
  el.textContent = JSON.stringify(lint)
}

let resolveReady!: () => void
const whenReady = new Promise<void>((r) => (resolveReady = r))
const markReady = () => {
  window.__storyink!.ready = true
  document.documentElement.dataset.ready = "1"
  resolveReady()
}

/** The single-diagram contract (standalone pages and `#fig=<id>&solo=1`). */
function single(scene: Scene, version: string, mount: (app: ReactElement) => void, extra: Record<string, unknown> = {}, root: ParentNode = document) {
  window.__storyink = {
    ready: false,
    whenReady,
    duration: 0,
    // Phase 1 has no timeline; accepted for the page contract.
    setTime: () => {},
    version,
    ...extra,
    get lastExport() {
      return lastExport
    },
  } as never
  const hooks = makeHooks(scene, root, (lint) => {
    writeLint(lint)
    window.__storyink!.lint = lint
    // Sheets report their laid-out height so snapshots can size the window exactly.
    const app = root.querySelector<HTMLElement>(".si-app")
    if (app) document.documentElement.dataset.contentHeight = String(Math.ceil(app.getBoundingClientRect().height))
    markReady()
  })
  mount(<App scene={scene} hooks={hooks} />)
}

/** Page mode: every `[data-si-fig]` root hydrates an embedded viewer; ready once all are. */
const parseHashRaw = () => new URLSearchParams(location.hash.replace(/^#/, ""))

function page(data: PageData) {
  const h = parseHash(location.hash)
  // `#figmax=<px>`: figure stage max height (snapshots pin it; default 78vh).
  const fm = Number(parseHashRaw().get("figmax"))
  if (fm > 0) document.documentElement.style.setProperty("--si-fig-max", `${Math.round(fm)}px`)
  // Snapshots: `#scroll=<px>` shifts the page up so a window shows a part of a tall page.
  const sc = Number(parseHashRaw().get("scroll"))
  const pg = document.getElementById("storyink-page")
  if (sc > 0 && pg) pg.style.marginTop = `-${Math.round(sc)}px`
  if (h.solo && h.fig && data.figures[h.fig]) {
    // Only that figure, full viewport, standalone chrome (every single-diagram feature works).
    document.documentElement.classList.add("si-solo")
    const host = document.createElement("div")
    host.id = "storyink-root"
    document.body.appendChild(host)
    single(data.figures[h.fig].scene, data.version, (app) => createRoot(host).render(app), { page: true, solo: h.fig }, host)
    return
  }
  const figures: Record<string, unknown> = {}
  const lints: Record<string, unknown> = {}
  window.__storyink = {
    ready: false,
    whenReady,
    version: data.version,
    page: true,
    figures,
    get lastExport() {
      return lastExport
    },
  } as never
  const roots = [...document.querySelectorAll<HTMLElement>("[data-si-fig]")]
  const pending = new Set(roots.map((r) => r.dataset.siFig!))
  let told = false
  let slideIssues: SlideIssue[] = []
  const finish = () => {
    // Storytelling controllers start once every figure's API exists (hash states applied here,
    // before ready, so snapshots see settled scrolly steps / slides / builds).
    if (!told) {
      told = true
      try {
        initScrolly(data)
        initDeck(data, (issues) => (slideIssues = issues))
      } catch (e) {
        slideIssues = [{ kind: "slide-overflow", ids: [], detail: `deck: ${String(e)}` }]
      }
    }
    let text: unknown
    try {
      text = lintPageText(document)
    } catch (e) {
      text = { ok: false, issues: [{ kind: "error", ids: [], detail: String(e) }] }
    }
    const figs = Object.values(lints) as { ok?: boolean }[]
    const t = text as { ok: boolean; issues: unknown[] }
    if (slideIssues.length) text = { ...t, ok: false, issues: [...t.issues, ...slideIssues] }
    const lint = { ok: t.ok && !slideIssues.length && figs.every((l) => l.ok !== false), figures: lints, page: text }
    writeLint(lint)
    ;(window.__storyink as unknown as Record<string, unknown>).lint = lint
    document.documentElement.dataset.contentHeight = String(Math.ceil(document.documentElement.scrollHeight))
    if (!window.__storyink!.ready) markReady()
  }
  for (const el of roots) {
    const id = el.dataset.siFig!
    const fig = data.figures[id]
    if (!fig) {
      pending.delete(id)
      continue
    }
    const hooks = makeHooks(fig.scene, el, (lint) => {
      lints[id] = lint
      pending.delete(id)
      if (!pending.size) finish()
    })
    hydrateRoot(el, <App scene={fig.scene} hooks={hooks} embedded={{ id }} />)
  }
  if (!pending.size) void document.fonts.ready.then(finish)
}

document.documentElement.classList.remove("si-noscript")
const pageData = document.getElementById("storyink-page-data")
if (pageData) page(JSON.parse(pageData.textContent!) as PageData)
else {
  const data = JSON.parse(document.getElementById("storyink-data")!.textContent!) as Data
  single(data.scene, data.version, (app) => hydrateRoot(document.getElementById("storyink-root")!, app))
}
