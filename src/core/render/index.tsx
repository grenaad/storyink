import { renderToStaticMarkup, renderToString } from "react-dom/server"
import { COMMIT_MONO_400, COMMIT_MONO_700 } from "../../generated/font.ts"
import { VERSION } from "../../generated/meta.ts"
import { VIEWER_JS } from "../../generated/viewer.ts"
import { themeCss, type ThemeName } from "../../theme/tokens.ts"
import { layout } from "../layout/index.ts"
import type { Scene } from "../scene.ts"
import type { Spec } from "../spec.ts"
import { validate, type Diagnostic } from "../validate.ts"
import { App } from "./App.tsx"
import { diagramCss, fontFaceCss, viewerCss } from "./css.ts"
import { Diagram } from "./Diagram.tsx"
import { storyState } from "../story/state.ts"
import { ROLLING_CSS } from "../../generated/rolling.ts"

export class StoryinkError extends Error {
  constructor(
    message: string,
    readonly diagnostics: Diagnostic[],
  ) {
    super(message)
    this.name = "StoryinkError"
  }
}

/** Validate (if needed) and lay out a spec. Throws StoryinkError with diagnostics on invalid input. */
export function toScene(input: Spec | Scene | unknown): Scene {
  if (isScene(input)) return input
  const v = validate(input)
  if (!v.ok || !v.spec)
    throw new StoryinkError(
      `invalid spec: ${v.diagnostics.filter((d) => d.severity === "error").map((d) => `${d.path}: ${d.message}`).join("; ")}`,
      v.diagnostics,
    )
  return layout(v.spec)
}

function isScene(x: unknown): x is Scene {
  return typeof x === "object" && x !== null && "viewBox" in x && "nodes" in x && "edges" in x && "ports" in x
}

export const fontCss = (): string => fontFaceCss(COMMIT_MONO_400, COMMIT_MONO_700)

export interface SvgOptions {
  /** Fixed theme; omit to follow `prefers-color-scheme`. */
  theme?: ThemeName
  /** Embed Commit Mono (default true). */
  font?: boolean
  /** Story time to render (seconds or "end", default "end" = the static diagram). */
  t?: number | "end"
}

/** Static, self-contained SVG (React SSR). */
export function renderSvg(spec: Spec | Scene | unknown, opts: SvgOptions = {}): string {
  const scene = toScene(spec)
  const style = [opts.font === false ? "" : fontCss(), themeCss("svg.storyink", opts.theme), diagramCss()].filter(Boolean).join("\n")
  const tl = scene.timeline
  const t = !tl || opts.t === undefined || opts.t === "end" ? (tl?.duration ?? 0) : opts.t
  const markup = renderToStaticMarkup(<Diagram scene={scene} style={style} frame={storyState(scene, tl, t)} />)
  return `<?xml version="1.0" encoding="UTF-8"?>\n${markup}\n`
}

export interface HtmlOptions {
  /** Pin the initial theme (the viewer toggle and `#theme=` still work). */
  theme?: ThemeName
  /** Include the interactive viewer bundle (default true). */
  viewer?: boolean
}

const escapeJson = (s: string) => s.replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029")
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

// Runs before paint: hash theme > stored theme > pinned theme > system.
const BOOT = `(function(){try{var d=document.documentElement,h=new URLSearchParams(location.hash.slice(1)),t=h.get("theme");if(t!=="light"&&t!=="dark"){t=null;try{t=localStorage.getItem("storyink-theme")}catch(e){}}if(t==="light"||t==="dark")d.dataset.theme=t;if(h.get("chrome")==="0")d.classList.add("si-nochrome-root");var z=parseFloat(h.get("zoom")||"");if(z>0&&z<1)d.style.zoom=String(z)}catch(e){}})();`

/** Standalone offline HTML: header, SSR diagram, viewer bundle, embedded font and data. */
export function renderHtml(spec: Spec | Scene | unknown, opts: HtmlOptions = {}): string {
  const scene = toScene(spec)
  const body = renderToString(<App scene={scene} />)
  const data = escapeJson(JSON.stringify({ version: VERSION, scene }))
  const viewer = opts.viewer === false ? "" : `<script id="storyink-viewer">${VIEWER_JS.replace(/<\/script/gi, "<\\/script")}</script>`
  return `<!doctype html>
<html lang="en" class="si-noscript"${opts.theme ? ` data-theme="${opts.theme}"` : ""}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="storyink ${VERSION}">
<title>${escapeHtml(scene.title)}</title>
<style id="storyink-font">${fontCss()}</style>
<style id="storyink-theme">${themeCss(":root")}</style>
<style id="storyink-diagram-css">${diagramCss()}</style>
<style id="storyink-viewer-css">${viewerCss()}${scene.timeline && Object.keys(scene.timeline.counters).length ? ROLLING_CSS : ""}</style>
<script>${BOOT}</script>
</head>
<body>
<div id="storyink-root">${body}</div>
<script type="application/json" id="storyink-data">${data}</script>
${viewer}
</body>
</html>
`
}
