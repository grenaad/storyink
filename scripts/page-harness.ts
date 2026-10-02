/**
 * A minimal page HTML following the Phase 5 page contract, built from `renderFigure` outputs (for
 * viewer tests / verification before / independently of `renderPageHtml`).
 */
import { fontCss, isChangeScene, isRichScene } from "../src/core/render/index.tsx"
import { diagramCss, viewerCss } from "../src/core/render/css.ts"
import { renderFigure } from "../src/core/render/figure.tsx"
import { hasNarration } from "../src/core/story/narrate.ts"
import { hasDrawer } from "../src/core/render/Drawer.tsx"
import { themeCss } from "../src/theme/tokens.ts"
import { VIEWER_JS } from "../src/generated/viewer.ts"
import { VERSION } from "../src/generated/meta.ts"
import { ROLLING_CSS } from "../src/generated/rolling.ts"
import type { Scene } from "../src/core/scene.ts"

const BOOT = `(function(){try{var d=document.documentElement,h=new URLSearchParams(location.hash.slice(1)),t=h.get("theme");if(t!=="light"&&t!=="dark"){t=null;try{t=localStorage.getItem("storyink-theme")}catch(e){}}if(t==="light"||t==="dark")d.dataset.theme=t;if(h.get("chrome")==="0")d.classList.add("si-nochrome-root");var z=parseFloat(h.get("zoom")||"");if(z>0&&z<1)d.style.zoom=String(z)}catch(e){}})();`
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
const filler = (n: number) => Array.from({ length: n }, (_, i) => `<p class="sp-prose">Paragraph ${i + 1}: some prose between figures so the page scrolls.</p>`).join("")

export function pageHarness(figs: { id: string; scene: Scene; claim?: string }[], title = "Harness page"): string {
  const rich = figs.some((f) => isRichScene(f.scene))
  const ch = figs.some((f) => isChangeScene(f.scene))
  const narrate = figs.some((f) => hasNarration(f.scene))
  const drawer = figs.some((f) => hasNarration(f.scene) || hasDrawer(f.scene))
  const counters = figs.some((f) => f.scene.timeline && Object.keys(f.scene.timeline.counters).length)
  const data = JSON.stringify({ version: VERSION, figures: Object.fromEntries(figs.map((f) => [f.id, { scene: f.scene }])) }).replace(/</g, "\\u003c")
  const sections = figs
    .map(
      (f, i) => `<section class="sp-sec" id="sec-${i + 1}"><h2>Section ${i + 1}</h2>${filler(6)}
<figure class="sp-fig" id="fig-${f.id}" data-fig="${f.id}"><div class="sp-fig-root" data-si-fig="${f.id}">${renderFigure(f.scene, { id: f.id }).html}</div><figcaption class="sp-cap">${esc(f.claim ?? f.scene.title)}</figcaption></figure>${filler(6)}</section>`,
    )
    .join("\n")
  return `<!doctype html>
<html lang="en" class="si-noscript si-page">
<head>
<meta charset="utf-8"><title>${esc(title)}</title>
<style id="storyink-font">${fontCss()}</style>
<style id="storyink-theme">${themeCss(":root", undefined, rich || drawer, ch || drawer)}</style>
<style id="storyink-diagram-css">${diagramCss(rich, ch)}</style>
<style id="storyink-viewer-css">${viewerCss({ narrate, drawer, page: true })}${counters ? ROLLING_CSS : ""}</style>
<style id="storyink-page-css">body{overflow:auto;height:auto}.sp-main{max-width:1100px;margin:0 auto;padding:24px}.sp-fig{margin:24px 0}.sp-cap{margin-top:8px;font-size:13px}</style>
<script>${BOOT}</script>
</head>
<body>
<div id="storyink-page">
<header class="sp-head"><h1>${esc(title)}</h1></header>
<nav class="sp-toc">${figs.map((_, i) => `<a href="#sec-${i + 1}">Section ${i + 1}</a>`).join(" ")}</nav>
<main class="sp-main">
${sections}
</main>
</div>
<script type="application/json" id="storyink-page-data">${data}</script>
<script id="storyink-viewer">${VIEWER_JS.replace(/<\/script/gi, "<\\/script")}</script>
</body></html>
`
}
