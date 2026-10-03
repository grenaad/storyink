/**
 * Page storytelling controllers (Phase 6): scrollytelling (`.sp-scrolly` blocks) and the slide
 * deck (present mode). Both drive figures only through their page API (`moveTo`, `cite`, …).
 */

type Target = { beat: number; t?: number } | { t: number }
interface FigApi {
  moveTo: (t: Target, o?: { animate?: boolean }) => Promise<void>
  beats: () => number[]
  setTime: (t: number | "end") => void
  cite?: (ref: string | null) => void
  openCite?: (ref: string) => boolean
}
export interface ScrollyData {
  fig: string
  steps: { beat: number; t: number }[]
}
export interface SlideData {
  id?: string
  title?: string
  layout?: string
  figs?: string[]
  scrolly?: string
  builds?: number
  build?: { fig: string; targets: { beat: number; t: number }[] }
}
export interface TellData {
  scrolly?: Record<string, ScrollyData>
  slides?: SlideData[]
}

const fig = (id: string | undefined): FigApi | undefined =>
  id ? ((window.__storyink as unknown as { figures?: Record<string, FigApi> })?.figures?.[id] as FigApi | undefined) : undefined
const hashParams = () => new URLSearchParams(location.hash.replace(/^#/, ""))
/** Move a figure to a target by beat (its own beat clock); `t` only when no beat is given. */
const go = (f: FigApi | undefined, target: { beat: number; t?: number } | undefined, animate: boolean) =>
  f && target ? f.moveTo(typeof target.beat === "number" ? { beat: target.beat } : { t: target.t ?? 0 }, { animate }) : Promise.resolve()
const START = { beat: -1 }

/** Trigger line for the active scrolly step (fraction of the viewport height from the top). */
export const SCROLLY_TRIGGER = 0.55

/**
 * The active step: the last step whose top has crossed the trigger line (−1 before the first).
 * Pure (tops are viewport-relative), so the same scroll position always gives the same step.
 */
export function activeStep(tops: number[], viewportH: number, trigger = SCROLLY_TRIGGER): number {
  const y = viewportH * trigger
  let k = -1
  tops.forEach((top, i) => {
    if (top <= y) k = i
  })
  return k
}

/** Scrollytelling: live pinned figures whose story follows the step crossing the trigger line. */
export function initScrolly(data: TellData): void {
  const blocks = [...document.querySelectorAll<HTMLElement>("[data-scrolly]")]
  if (!blocks.length) return
  const h = hashParams()
  if (h.get("static") === "1") return
  const pin = h.get("scrolly")
  const pinStep = Number(h.get("step"))
  const items = blocks.map((el) => {
    const id = el.dataset.scrolly!
    const d = data.scrolly?.[id]
    const figId = d?.fig ?? el.dataset.fig
    const steps = [...el.querySelectorAll<HTMLElement>(".sp-scrolly-step")]
    el.classList.add("sp-scrolly-live")
    // Cites: hover highlights the figure's element; a click opens a file (or element) in the drawer.
    el.addEventListener("mouseover", (e) => {
      const c = (e.target as Element).closest?.<HTMLElement>(".sp-cite[data-ref]")
      if (c) fig(figId)?.cite?.(c.dataset.ref!)
    })
    el.addEventListener("mouseout", (e) => {
      if ((e.target as Element).closest?.(".sp-cite[data-ref]")) fig(figId)?.cite?.(null)
    })
    el.addEventListener("click", (e) => {
      const c = (e.target as Element).closest?.<HTMLElement>(".sp-cite[data-ref]")
      if (c) fig(figId)?.openCite?.(c.dataset.ref!)
    })
    return { el, id, figId, steps, targets: d?.steps ?? [], active: -2 }
  })
  const set = (it: (typeof items)[number], k: number, animate: boolean) => {
    if (k === it.active) return
    it.active = k
    it.steps.forEach((s, i) => s.classList.toggle("is-active", i === k))
    void go(fig(it.figId), k < 0 ? START : it.targets[k], animate)
  }
  const update = (animate: boolean) => {
    if (document.documentElement.classList.contains("sp-presenting")) return
    for (const it of items) set(it, activeStep(it.steps.map((s) => s.getBoundingClientRect().top), innerHeight), animate)
  }
  // `#scrolly=<id>&step=<n>` (1-based): scroll the step to the trigger line, settled and paused.
  const target = pin ? items.find((it) => it.id === pin) : undefined
  if (target && pinStep >= 1 && target.steps[pinStep - 1]) {
    // The page scrolls inside a wrapper (not the window) in this mode: headless
    // `--screenshot` captures ignore a window scroll, an element's scroll they keep.
    const doc = document.getElementById("storyink-page")!
    const page = document.createElement("div")
    page.className = "sp-scroller"
    doc.parentNode!.insertBefore(page, doc)
    page.appendChild(doc)
    document.documentElement.classList.add("sp-scroll-inner")
    const s = target.steps[pinStep - 1]
    const y = s.getBoundingClientRect().top + page.scrollTop - innerHeight * SCROLLY_TRIGGER + 1
    page.scrollTop = Math.max(0, Math.round(y))
    page.addEventListener("scroll", () => update(true), { passive: true })
  }
  update(false)
  let raf = 0
  addEventListener(
    "scroll",
    () => {
      if (!raf) raf = requestAnimationFrame(() => ((raf = 0), update(true)))
    },
    { passive: true },
  )
  addEventListener("resize", () => update(false))
}

/** Slide deck (present mode). */
export function initDeck(data: TellData, onLint?: (issues: SlideIssue[]) => void): void {
  const page = document.getElementById("storyink-page")
  const slides = [...document.querySelectorAll<HTMLElement>(".sp-slide[data-slide]")].sort((a, b) => Number(a.dataset.slide) - Number(b.dataset.slide))
  if (!page || !slides.length) return
  const allowed = page.dataset.present !== "0"
  const root = document.documentElement
  const meta = (i: number): SlideData => {
    const list = data.slides ?? []
    // `slides` lists every slide (title slide first); tolerate a list without the title slide.
    return (list.length === slides.length ? list[i] : list.length === slides.length - 1 ? (i ? list[i - 1] : undefined) : list[i]) ?? {}
  }
  const titleOf = (i: number) => meta(i).title ?? slides[i].querySelector("h1,h2")?.textContent?.trim() ?? `Slide ${i + 1}`
  const builds = (i: number) => {
    const m = meta(i)
    return m.build?.targets?.length ?? Number(slides[i].dataset.builds ?? 0) ?? 0
  }
  let cur = 0
  let k = 0
  let on = false
  let overlay: HTMLElement | undefined

  // Chrome (viewer-rendered): progress, prev / next, counter, title; outline + help overlays.
  const deck = document.createElement("div")
  deck.className = "sp-deck"
  deck.innerHTML = `<div class="sp-deck-progress"></div><div class="sp-deck-bar"><button type="button" class="sp-deck-btn" data-deck="prev" aria-label="Previous">←</button><span class="sp-deck-count"></span><button type="button" class="sp-deck-btn" data-deck="next" aria-label="Next">→</button><span class="sp-deck-title"></span><button type="button" class="sp-deck-btn" data-deck="outline" aria-label="Outline (O)">O</button><button type="button" class="sp-deck-btn" data-deck="help" aria-label="Keys (?)">?</button><button type="button" class="sp-deck-btn" data-deck="exit" aria-label="Exit (Esc)">Esc</button></div>`
  document.body.appendChild(deck)
  const progress = deck.querySelector<HTMLElement>(".sp-deck-progress")!
  const count = deck.querySelector<HTMLElement>(".sp-deck-count")!
  const title = deck.querySelector<HTMLElement>(".sp-deck-title")!
  deck.addEventListener("click", (e) => {
    const a = (e.target as Element).closest<HTMLElement>("[data-deck]")?.dataset.deck
    if (a === "prev") prev()
    else if (a === "next") next()
    else if (a === "outline") toggleOverlay("outline")
    else if (a === "help") toggleOverlay("help")
    else if (a === "exit") exit()
  })

  const fit = () => {
    const s = Math.min(innerWidth / 1280, (innerHeight - 44) / 720)
    for (const el of slides) el.style.removeProperty("--sp-slide-scale")
    slides[cur].style.setProperty("--sp-slide-scale", String(Math.round(s * 1e4) / 1e4))
  }
  /** Scrolly steps on a scrolly slide mirror the build (step k − 1 active). */
  const markScrolly = (i: number, b: number) => {
    const sid = meta(i).scrolly
    const el = sid ? document.querySelector<HTMLElement>(`[data-scrolly="${CSS.escape(sid)}"]`) : slides[i].querySelector<HTMLElement>("[data-scrolly]")
    el?.querySelectorAll(".sp-scrolly-step").forEach((s, j) => s.classList.toggle("is-active", j === b - 1))
  }
  const buildTarget = (i: number, b: number) => {
    const m = meta(i)
    return b <= 0 ? START : m.build?.targets?.[b - 1]
  }
  const render = () => {
    slides.forEach((el, i) => el.classList.toggle("is-current", on && i === cur))
    count.textContent = `${cur + 1} / ${slides.length}`
    title.textContent = titleOf(cur)
    const n = builds(cur)
    progress.style.width = `${(((cur + (n ? k / (n + 1) : 0)) / Math.max(1, slides.length - 1)) * 100).toFixed(3)}%`
    fit()
  }
  /** Enter slide i with build b (settled): figures without builds show their final frame. */
  const show = (i: number, b: number, animate = false) => {
    cur = Math.max(0, Math.min(slides.length - 1, i))
    k = Math.max(0, Math.min(builds(cur), b))
    render()
    const m = meta(cur)
    const ids = m.figs ?? [...slides[cur].querySelectorAll<HTMLElement>("[data-si-fig]")].map((e) => e.dataset.siFig!)
    for (const id of ids) if (id !== m.build?.fig) fig(id)?.moveTo({ beat: Number.MAX_SAFE_INTEGER }, { animate: false })
    markScrolly(cur, k)
    void go(fig(m.build?.fig), buildTarget(cur, k), animate)
  }
  const next = () => {
    if (k < builds(cur)) {
      k++
      render()
      markScrolly(cur, k)
      void go(fig(meta(cur).build?.fig), buildTarget(cur, k), true)
    } else if (cur < slides.length - 1) show(cur + 1, 0)
  }
  const prev = () => {
    if (k > 0) {
      k--
      render()
      markScrolly(cur, k)
      void go(fig(meta(cur).build?.fig), buildTarget(cur, k), true)
    } else if (cur > 0) show(cur - 1, builds(cur - 1))
  }
  const toggleOverlay = (kind: "outline" | "help") => {
    const was = overlay?.dataset.kind
    overlay?.remove()
    overlay = undefined
    if (was === kind) return
    const o = document.createElement("div")
    o.className = "sp-deck-overlay"
    o.dataset.kind = kind
    o.setAttribute("role", "dialog")
    if (kind === "outline") {
      o.innerHTML = `<h2>Outline</h2><ol>${slides.map((_, i) => `<li${i === cur ? ' class="is-current"' : ""}><button type="button" data-goto="${i}"></button></li>`).join("")}</ol>`
      o.querySelectorAll<HTMLButtonElement>("[data-goto]").forEach((b) => (b.textContent = titleOf(Number(b.dataset.goto))))
      o.addEventListener("click", (e) => {
        const g = (e.target as Element).closest<HTMLElement>("[data-goto]")
        if (!g) return
        toggleOverlay("outline")
        show(Number(g.dataset.goto), 0)
      })
    } else {
      o.innerHTML = `<h2>Keys</h2><dl><dt>→ Space PgDn Enter</dt><dd>next build, then next slide</dd><dt>← PgUp Backspace</dt><dd>previous</dd><dt>Home / End</dt><dd>first / last slide</dd><dt>O</dt><dd>outline</dd><dt>?</dt><dd>this help</dd><dt>Esc</dt><dd>back to the article</dd><dt>P</dt><dd>present / stop presenting</dd></dl>`
      o.addEventListener("click", () => toggleOverlay("help"))
    }
    deck.appendChild(o)
    overlay = o
  }
  const present = (i = 0, b = 0) => {
    if (!allowed) return
    on = true
    root.classList.add("sp-presenting")
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    show(i, b)
    onLint?.(lintSlides())
  }
  const exit = () => {
    if (!on) return
    overlay?.remove()
    overlay = undefined
    on = false
    root.classList.remove("sp-presenting")
    slides.forEach((el) => el.classList.remove("is-current"))
    const sec = slides[cur].closest("section") ?? (cur === 0 ? page : slides[cur])
    sec.scrollIntoView({ block: "start" })
  }
  /** Slides whose content needs a scale under 0.7 to fit the 1280×720 frame. */
  const lintSlides = (): SlideIssue[] => {
    const out: SlideIssue[] = []
    const keep = cur
    slides.forEach((el, i) => {
      slides.forEach((s, j) => s.classList.toggle("is-current", j === i))
      el.style.removeProperty("--sp-content-scale")
      const need = Math.min(1, 1280 / Math.max(1, el.scrollWidth), 720 / Math.max(1, el.scrollHeight))
      el.style.setProperty("--sp-content-scale", String(Math.max(0.7, Math.round(need * 1000) / 1000)))
      if (need < 0.7) out.push({ kind: "slide-overflow", ids: [`slide ${i + 1}`], detail: `slide ${i + 1} (${titleOf(i)}): content ${el.scrollWidth}×${el.scrollHeight} needs scale ${need.toFixed(2)} < 0.7` })
    })
    slides.forEach((s, j) => s.classList.toggle("is-current", j === keep))
    return out
  }

  addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    if (!on) {
      if ((e.key === "p" || e.key === "P") && allowed && !(document.activeElement as Element | null)?.closest?.("[data-si-app]")) {
        e.preventDefault()
        present(slideAtScroll(), 0)
      }
      return
    }
    const key = e.key
    const handled = () => {
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    if (key === "Escape") {
      handled()
      if (overlay) toggleOverlay(overlay.dataset.kind as "outline" | "help")
      else exit()
    } else if (key === "ArrowRight" || key === " " || key === "PageDown" || key === "Enter") (handled(), next())
    else if (key === "ArrowLeft" || key === "PageUp" || key === "Backspace") (handled(), prev())
    else if (key === "Home") (handled(), show(0, 0))
    else if (key === "End") (handled(), show(slides.length - 1, 0))
    else if (key === "o" || key === "O") (handled(), toggleOverlay("outline"))
    else if (key === "?") (handled(), toggleOverlay("help"))
    else if (key === "p" || key === "P") (handled(), exit())
  }, true)
  addEventListener("resize", () => on && fit())
  document.querySelectorAll<HTMLElement>(".sp-present").forEach((b) => b.addEventListener("click", () => present(slideAtScroll(), 0)))
  /** The slide whose section is at the top of the article view (P / Present start there). */
  const slideAtScroll = () => {
    let k2 = 0
    slides.forEach((el, i) => {
      const r = (el.closest("section") ?? el).getBoundingClientRect()
      if (r.top <= innerHeight * 0.3) k2 = i
    })
    return scrollY < 40 ? 0 : k2
  }

  const h = hashParams()
  const want = h.get("present") === "1" || (page.dataset.layout === "slides" && h.get("present") !== "0")
  if (want && allowed) {
    const n = Math.max(1, Number(h.get("slide")) || 1)
    const b = Math.max(0, Number(h.get("build")) || 0)
    present(n - 1, b)
  }
  ;(window.__storyink as unknown as Record<string, unknown>).deck = {
    present: (i = 1, b = 0) => present(i - 1, b),
    exit,
    next,
    prev,
    state: () => ({ presenting: on, slide: cur + 1, build: k, slides: slides.length, builds: builds(cur) }),
  }
}

export interface SlideIssue {
  kind: "slide-overflow"
  ids: string[]
  detail: string
}
