import { hydrateRoot } from "react-dom/client"
import { paletteCss, palettes, type ThemeName } from "../theme/tokens.ts"
import type { Scene } from "../core/scene.ts"
import { App, type ViewerHooks } from "../core/render/App.tsx"
import { lintDom } from "./lint.ts"

interface Data {
  version: string
  scene: Scene
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

const data = JSON.parse(document.getElementById("storyink-data")!.textContent!) as Data
const scene = data.scene

let resolveReady!: () => void
const whenReady = new Promise<void>((r) => (resolveReady = r))
window.__storyink = {
  ready: false,
  whenReady,
  duration: 0,
  // Phase 1 has no timeline; accepted for the page contract.
  setTime: () => {},
  version: data.version,
}

function exportSvgText(theme: ThemeName): string {
  const live = document.querySelector<SVGSVGElement>(".si-stage svg.storyink, svg.storyink")!
  const svg = live.cloneNode(true) as SVGSVGElement
  const font = document.getElementById("storyink-font")?.textContent ?? ""
  const rules = document.getElementById("storyink-diagram-css")?.textContent ?? ""
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style")
  style.textContent = `${font}\nsvg.storyink{${paletteCss(theme)}}\n${rules}`
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

const hooks: ViewerHooks = {
  exportSvg(theme) {
    download(new Blob([exportSvgText(theme)], { type: "image/svg+xml" }), `${slug(scene.title)}-${theme}.svg`)
  },
  async exportPng(theme) {
    await document.fonts.ready
    const text = exportSvgText(theme)
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
    canvas.toBlob((b) => b && download(b, `${slug(scene.title)}-${theme}@2x.png`), "image/png")
  },
  onReady(sheet) {
    void document.fonts.ready.then(() => {
      setTimeout(() => {
        let lint: unknown
        try {
          lint = lintDom(document, scene, sheet)
        } catch (e) {
          lint = { ok: false, issues: [{ kind: "error", ids: [], detail: String(e) }], checked: {} }
        }
        let el = document.getElementById("storyink-lint")
        if (!el) {
          el = document.createElement("script")
          el.setAttribute("type", "application/json")
          el.id = "storyink-lint"
          document.body.appendChild(el)
        }
        el.textContent = JSON.stringify(lint)
        window.__storyink!.lint = lint
        window.__storyink!.ready = true
        document.documentElement.dataset.ready = "1"
        resolveReady()
      }, 0)
    })
  },
}

document.documentElement.classList.remove("si-noscript")
hydrateRoot(document.getElementById("storyink-root")!, <App scene={scene} hooks={hooks} />)
