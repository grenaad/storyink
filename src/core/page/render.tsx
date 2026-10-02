/** Page HTML: one offline file (header, TOC, sections, embedded figures, page data, viewer bundle). */
import { renderToStaticMarkup } from "react-dom/server"
import type { ReactElement } from "react"
import { VERSION } from "../../generated/meta.ts"
import { VIEWER_JS } from "../../generated/viewer.ts"
import { ROLLING_CSS } from "../../generated/rolling.ts"
import { themeCss, type ThemeName } from "../../theme/tokens.ts"
import { layout } from "../layout/index.ts"
import type { Scene } from "../scene.ts"
import type { Spec } from "../spec.ts"
import { hasNarration } from "../story/narrate.ts"
import { diagramCss, viewerCss } from "../render/css.ts"
import { hasDrawer } from "../render/Drawer.tsx"
import { diffViewCss } from "../render/DiffView.tsx"
import { fontCss, isChangeScene, isRichScene, StoryinkError } from "../render/index.tsx"
import { Blocks, type RenderCtx } from "./blocks.tsx"
import { pageCss, pageThemeCss } from "./css.ts"
import { Inline, Prose, safeHref } from "./prose.tsx"
import { blockType, isPageSpec, type Block, type FigureBlock, type ValidPage } from "./types.ts"
import { validatePage } from "./validate.ts"

export interface PageHtmlOptions {
  /** Pin the initial theme (the toggle and `#theme=` still work). */
  theme?: ThemeName
  /** Include the interactive viewer bundle (default true). */
  viewer?: boolean
}

/** Every figure block of a page, in document order. */
export function pageFigures(page: { sections: { blocks: Block[] }[] }): FigureBlock[] {
  const out: FigureBlock[] = []
  const walk = (bs: Block[]) => {
    for (const b of bs ?? []) {
      const t = blockType(b)
      if (t === "figure") out.push((b as { figure: FigureBlock }).figure)
      else if (t === "details") walk((b as { details: { blocks: Block[] } }).details.blocks)
      else if (t === "columns") for (const c of (b as { columns: Block[][] }).columns) walk(c)
    }
  }
  for (const s of page.sections) walk(s.blocks)
  return out
}

/** Validate (unless already a validated page) and lay out every figure. Throws StoryinkError when invalid. */
export function layoutPage(input: unknown): { page: ValidPage; scenes: Map<string, Scene> } {
  const v = validatePage(input)
  if (!v.ok || !v.page)
    throw new StoryinkError(`invalid page: ${v.diagnostics.filter((d) => d.severity === "error").map((d) => `${d.path}: ${d.message}`).join("; ")}`, v.diagnostics)
  const scenes = new Map<string, Scene>()
  for (const f of pageFigures(v.page)) scenes.set(f.id!, layout(f.spec as Spec))
  return { page: v.page, scenes }
}

const escapeJson = (s: string) => s.replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029")
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

// Same as single pages: hash theme > stored theme > pinned theme > system.
const BOOT = `(function(){try{var d=document.documentElement,h=new URLSearchParams(location.hash.slice(1)),t=h.get("theme");if(t!=="light"&&t!=="dark"){t=null;try{t=localStorage.getItem("storyink-theme")}catch(e){}}if(t==="light"||t==="dark")d.dataset.theme=t;if(h.get("chrome")==="0")d.classList.add("si-nochrome-root");var z=parseFloat(h.get("zoom")||"");if(z>0&&z<1)d.style.zoom=String(z)}catch(e){}})();`

/**
 * Page chrome script: theme toggle (same key / semantics as the viewer), TOC scroll-spy, details
 * opened for print. Plain ES5; the page reads fine without it.
 */
const PAGE_JS = `(function(){var d=document.documentElement;d.classList.add("sp-js");var q=function(s){return Array.prototype.slice.call(document.querySelectorAll(s))};var b=document.querySelector(".sp-theme");if(b&&!b.hasAttribute("data-bound")){b.setAttribute("data-bound","");b.addEventListener("click",function(){var c=d.dataset.theme||(window.matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"),n=c==="dark"?"light":"dark";d.dataset.theme=n;try{localStorage.setItem("storyink-theme",n)}catch(e){}})}var ls=q(".sp-toc a[href^='#']"),ss=ls.map(function(l){return document.getElementById(decodeURIComponent(l.getAttribute("href").slice(1)))}),f=0;function u(){f=0;var y=innerHeight*0.25,k=0;for(var i=0;i<ss.length;i++)if(ss[i]&&ss[i].getBoundingClientRect().top<=y)k=i;if(innerHeight+scrollY>=document.documentElement.scrollHeight-2)k=ss.length-1;ls.forEach(function(l,i){if(i===k)l.setAttribute("aria-current","true");else l.removeAttribute("aria-current")})}if(ls.length){addEventListener("scroll",function(){if(!f)f=requestAnimationFrame(u)},{passive:true});addEventListener("resize",u);u()}var o=[];addEventListener("beforeprint",function(){o=q("details:not([open])");o.forEach(function(x){x.open=true})});addEventListener("afterprint",function(){o.forEach(function(x){x.open=false});o=[]})})();`

const ThemeIcon = () => (
  <>
    <svg className="sp-moon" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
    <svg className="sp-sun" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  </>
)

function PageView({ page, ctx, toc }: { page: ValidPage; ctx: RenderCtx; toc: boolean }): ReactElement {
  const ch = page.change
  const href = ch?.url ? safeHref(ch.url) : undefined
  return (
    <>
      <header className="sp-head">
        <p className="sp-eyebrow">{page.eyebrow ?? "Page"}</p>
        <button type="button" className="sp-theme" aria-label="Toggle light/dark" title="Toggle light/dark">
          <ThemeIcon />
        </button>
        <h1 className="sp-title">{page.title}</h1>
        {page.subtitle ? <p className="sp-sub">{page.subtitle}</p> : null}
        {ch && (ch.base || ch.head || ch.title || href) ? (
          <p className="sp-meta">
            {ch.base || ch.head ? (
              <span>
                <span className="sp-meta-ref">{ch.base ?? "base"}</span> <span className="sp-meta-arrow">{"\u2192"}</span> <span className="sp-meta-ref">{ch.head ?? "head"}</span>
              </span>
            ) : null}
            {ch.title ? <span>{ch.title}</span> : null}
            {href ? <a href={href}>{ch.url}</a> : null}
          </p>
        ) : null}
        {page.summary ? <Prose text={page.summary} className="sp-lead sp-prose" /> : null}
      </header>
      {toc ? (
        <nav className="sp-toc" aria-label="Contents">
          <p className="sp-toc-h">Contents</p>
          <ol>
            {page.sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>{s.title}</a>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <main className="sp-main">
        {page.sections.map((s) => (
          <section key={s.id} className="sp-sec" id={s.id}>
            <header className="sp-sec-head">
              {s.eyebrow ? <p className="sp-eyebrow">{s.eyebrow}</p> : null}
              <h2 className="sp-sec-title">
                <Inline text={s.title} />
              </h2>
            </header>
            <Blocks blocks={s.blocks} ctx={ctx} />
          </section>
        ))}
      </main>
    </>
  )
}

/**
 * Standalone offline page HTML (see docs/spec.md "Pages"). Head CSS is the union of what the
 * figures need (rich / change palettes and diagram rules, narration rail / drawer rules, rolling
 * counters) plus the page stylesheet; the page always carries the rich + delta palettes (tones,
 * code and diffs use them).
 */
export function renderPageHtml(input: unknown, opts: PageHtmlOptions = {}): string {
  if (!isPageSpec(input) && typeof input !== "string") throw new StoryinkError(`not a page spec (expected "type": "page")`, [{ severity: "error", path: "type", message: `expected "type": "page"` }])
  const { page, scenes } = layoutPage(input)
  const list = [...scenes.values()]
  const rich = list.some(isRichScene)
  const change = list.some(isChangeScene)
  const narrate = list.some(hasNarration)
  const drawer = narrate || list.some(hasDrawer)
  const counters = list.some((s) => s.timeline && Object.keys(s.timeline.counters).length)
  const toc = page.toc ?? page.sections.length >= 4
  const ctx: RenderCtx = { scenes, ...(page.changes ? { changes: page.changes } : {}) }
  const body = renderToStaticMarkup(<PageView page={page} ctx={ctx} toc={toc} />)
  const figures: Record<string, { scene: Scene }> = {}
  for (const [id, scene] of scenes) figures[id] = { scene }
  const data = escapeJson(JSON.stringify({ version: VERSION, figures, ...(page.changes ? { changes: page.changes } : {}) }))
  const viewer = opts.viewer === false ? "" : `<script id="storyink-viewer">${VIEWER_JS.replace(/<\/script/gi, "<\\/script")}</script>`
  const vcss = viewerCss({ narrate, drawer, page: true })
  return `<!doctype html>
<html lang="en" class="si-noscript si-page"${opts.theme ? ` data-theme="${opts.theme}"` : ""}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="storyink ${VERSION}">
<title>${escapeHtml(page.title)}</title>
<style id="storyink-font">${fontCss()}</style>
<style id="storyink-theme">${themeCss(":root", undefined, true, true)}
${pageThemeCss()}</style>
<style id="storyink-diagram-css">${diagramCss(rich, change)}</style>
<style id="storyink-viewer-css">${vcss}${counters ? ROLLING_CSS : ""}</style>
<style id="storyink-page-css">${diffViewCss()}
${pageCss()}</style>
<script>${BOOT}</script>
</head>
<body>
<div id="storyink-page"${toc ? ` class="sp-has-toc"` : ""}>${body}</div>
<script id="storyink-page-js">${PAGE_JS}</script>
<script type="application/json" id="storyink-page-data">${data}</script>
${viewer}
</body>
</html>
`
}
