import { animate, domAnimation, LazyMotion, m, useMotionValue } from "motion/react"
import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react"
import { flushSync } from "react-dom"
import type { Frame } from "../story/types.ts"
import { BeatSheet, Captions, Gate, Transport, useStory } from "./Story.tsx"
import { motion as M, palettes, cssVar, type Palette, type ThemeName } from "../../theme/tokens.ts"
import type { Scene } from "../scene.ts"
import { Diagram } from "./Diagram.tsx"

export interface AppProps {
  scene: Scene
}

const TYPE_LABEL: Record<Scene["type"], string> = {
  architecture: "Architecture",
  workflow: "Workflow",
  sequence: "Sequence",
  dataflow: "Data flow",
  lifecycle: "Lifecycle",
}

export interface ViewerHooks {
  exportSvg: (theme: ThemeName) => void
  exportPng: (theme: ThemeName) => void
  onReady: (sheet: boolean) => void
  /** Called after every story frame renders (live counters overlay). */
  onFrame?: (frame: Frame, playing: boolean) => void
}

/** Parsed `location.hash` contract. */
export interface HashParams {
  theme?: ThemeName
  chrome: boolean
  t?: string
  sheet?: ThemeName[]
  /** `#sheet=beats`: one tile per story step. */
  beats?: boolean
  autoplay?: boolean
  motion?: "full" | "reduced"
  /** `#static=1`: the SSR final frame with the story runtime disabled. */
  still?: boolean
}

export function parseHash(hash: string): HashParams {
  const p = new URLSearchParams(hash.replace(/^#/, ""))
  const theme = p.get("theme")
  const sheet = p.get("sheet")
  const autoplay = p.get("autoplay")
  const motion = p.get("motion")
  return {
    ...(theme === "light" || theme === "dark" ? { theme } : {}),
    chrome: p.get("chrome") !== "0",
    ...(p.get("t") ? { t: p.get("t")! } : {}),
    ...(sheet === "beats"
      ? { beats: true }
      : sheet
        ? { sheet: sheet.split(",").filter((x): x is ThemeName => x === "light" || x === "dark") }
        : {}),
    ...(autoplay === "1" || autoplay === "0" ? { autoplay: autoplay === "1" } : {}),
    ...(motion === "full" || motion === "reduced" ? { motion } : {}),
    ...(p.get("static") === "1" ? { still: true } : {}),
  }
}

function Btn({ label, title, onClick, children }: { label: string; title: string; onClick: () => void; children?: ReactNode }) {
  return (
    <m.button
      type="button"
      className="si-btn"
      aria-label={label}
      title={title}
      onClick={onClick}
      whileHover={M.hover}
      whileTap={M.press}
      transition={M.spring}
    >
      {children ?? label}
    </m.button>
  )
}

function Sun() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function Moon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

const THEME_KEY = "storyink-theme"

function systemTheme(): ThemeName {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

/** Crossfade the palette variables with a bounce-free spring, then pin the theme. */
function applyTheme(next: ThemeName, animated: boolean) {
  const root = document.documentElement
  if (!animated) {
    root.dataset.theme = next
    return
  }
  const from = getComputedStyle(root)
  const target = palettes[next]
  const keys = Object.keys(target) as (keyof Palette)[]
  const start: Record<string, string> = {}
  for (const k of keys) start[cssVar(k)] = from.getPropertyValue(cssVar(k)).trim()
  for (const k of keys) root.style.setProperty(cssVar(k), start[cssVar(k)])
  root.dataset.theme = next
  const values: Record<string, string> = {}
  for (const k of keys) values[cssVar(k)] = target[k]
  const controls = animate(root, values as never, M.spring as never)
  const clear = () => {
    for (const k of keys) root.style.removeProperty(cssVar(k))
  }
  Promise.resolve(controls.finished ?? controls).then(clear, clear)
}

/** Viewer shell. Server-rendered with defaults, then hydrated; hash state applies after hydration. */
export function App({ scene, hooks }: AppProps & { hooks?: ViewerHooks }): ReactElement {
  const stage = useRef<HTMLDivElement>(null)
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const k = useMotionValue(1)
  const [hash, setHash] = useState<HashParams>({ chrome: true })
  const [theme, setTheme] = useState<ThemeName | undefined>(undefined)
  const [hydrated, setHydrated] = useState(false)
  const [sysReduced, setSysReduced] = useState(false)
  const [override, setOverride] = useState<Frame | undefined>(undefined)
  const [exportCurrent, setExportCurrent] = useState(false)
  const vb = scene.viewBox
  const tl = scene.timeline
  const reduced = hash.motion === "reduced" || (hash.motion !== "full" && sysReduced)
  const story = useStory(scene, tl, {
    ...(hash.t !== undefined ? { t: hash.t } : {}),
    ...(hash.autoplay !== undefined ? { autoplay: hash.autoplay } : {}),
    reduced,
    still: !hydrated || !!hash.still || !!hash.beats || !!hash.sheet?.length,
    stage,
  })

  const fit = useCallback(
    (anim: boolean) => {
      const el = stage.current
      if (!el) return
      const sw = el.clientWidth
      const sh = el.clientHeight
      const pad = 32
      // Snap to whole pixels / 1/64 scale steps so repeated captures rasterize identically.
      const s = Math.floor(Math.max(0.1, Math.min((sw - 2 * pad) / vb.w, (sh - 2 * pad) / vb.h, 1.25)) * 64) / 64
      const tx = Math.round((sw - vb.w * s) / 2)
      const ty = Math.round(Math.max(pad / 2, (sh - vb.h * s) / 2))
      if (anim) {
        animate(k, s, M.spring)
        animate(x, tx, M.spring)
        animate(y, ty, M.spring)
      } else {
        k.set(s)
        x.set(tx)
        y.set(ty)
      }
    },
    [vb.w, vb.h, k, x, y],
  )

  const zoomAt = useCallback(
    (factor: number, cx?: number, cy?: number, anim = false) => {
      const el = stage.current
      if (!el) return
      const px = cx ?? el.clientWidth / 2
      const py = cy ?? el.clientHeight / 2
      const k0 = k.get()
      const k1 = Math.max(0.1, Math.min(8, k0 * factor))
      const nx = px - ((px - x.get()) * k1) / k0
      const ny = py - ((py - y.get()) * k1) / k0
      if (anim) {
        animate(k, k1, M.spring)
        animate(x, nx, M.spring)
        animate(y, ny, M.spring)
      } else {
        k.set(k1)
        x.set(nx)
        y.set(ny)
      }
    },
    [k, x, y],
  )

  // Hash + theme bootstrap (after hydration so server and client markup match).
  useEffect(() => {
    const h = parseHash(location.hash)
    setHash(h)
    if (typeof matchMedia === "function") setSysReduced(matchMedia("(prefers-reduced-motion: reduce)").matches)
    setHydrated(true)
    let stored: ThemeName | undefined
    try {
      const s = localStorage.getItem(THEME_KEY)
      if (s === "light" || s === "dark") stored = s
    } catch {}
    const initial = h.theme ?? stored ?? (document.documentElement.dataset.theme as ThemeName | undefined)
    setTheme(initial ?? systemTheme())
    if (initial) applyTheme(initial, false)
    const onHash = () => setHash(parseHash(location.hash))
    addEventListener("hashchange", onHash)
    return () => removeEventListener("hashchange", onHash)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    if (!hash.sheet?.length && !hash.beats) fit(false)
    hooks?.onReady(!!hash.sheet?.length || !!hash.beats)
  }, [hash, fit, hooks, hydrated])

  // Page contract: setTime / duration / steps / play / pause.
  const storyRef = useRef(story)
  storyRef.current = story
  useEffect(() => {
    const w = window as unknown as { __storyink?: Record<string, unknown> }
    if (!w.__storyink) return
    w.__storyink.duration = tl?.duration ?? 0
    w.__storyink.steps = tl ? tl.steps.map((st) => ({ id: st.id, label: st.label, t0: st.t0, t1: st.t1, ...(st.stop ? { stop: st.stop } : {}) })) : []
    w.__storyink.setTime = (x: number | "end") => storyRef.current?.seek(x === "end" ? (tl?.duration ?? 0) : Number(x))
    w.__storyink.play = () => storyRef.current?.play()
    w.__storyink.pause = () => storyRef.current?.pause()
    w.__storyink.replay = () => storyRef.current?.replay()
    w.__storyink.state = () => ({ t: storyRef.current?.t ?? 0, mode: storyRef.current?.mode ?? "static" })
  }, [tl])

  const liveFrame = override ?? story?.frame
  useEffect(() => {
    if (story && hooks?.onFrame) hooks.onFrame(story.frame, story.mode === "playing")
  }, [story?.frame, story?.mode, hooks])

  useEffect(() => {
    const onResize = () => fit(false)
    addEventListener("resize", onResize)
    // The header height can change once webfonts load; refit so every capture uses the same scale.
    let ro: ResizeObserver | undefined
    if (typeof ResizeObserver !== "undefined" && stage.current) {
      ro = new ResizeObserver(onResize)
      ro.observe(stage.current)
    }
    document.fonts?.ready.then(onResize)
    return () => {
      removeEventListener("resize", onResize)
      ro?.disconnect()
    }
  }, [fit])

  // Wheel zoom at cursor, drag to pan, keyboard.
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault()
      const r = el.getBoundingClientRect()
      zoomAt(Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015)), ev.clientX - r.left, ev.clientY - r.top)
    }
    let drag: { id: number; sx: number; sy: number; ox: number; oy: number } | undefined
    const down = (ev: PointerEvent) => {
      if (ev.button !== 0) return
      drag = { id: ev.pointerId, sx: ev.clientX, sy: ev.clientY, ox: x.get(), oy: y.get() }
      el.setPointerCapture(ev.pointerId)
      el.classList.add("si-dragging")
    }
    const move = (ev: PointerEvent) => {
      if (!drag || drag.id !== ev.pointerId) return
      x.set(drag.ox + ev.clientX - drag.sx)
      y.set(drag.oy + ev.clientY - drag.sy)
    }
    const up = (ev: PointerEvent) => {
      if (!drag || drag.id !== ev.pointerId) return
      drag = undefined
      el.classList.remove("si-dragging")
    }
    const key = (ev: KeyboardEvent) => {
      if (ev.target instanceof HTMLInputElement || ev.metaKey || ev.ctrlKey || ev.altKey) return
      const st = storyRef.current
      if (st && (ev.key === " " || ev.code === "Space")) {
        ev.preventDefault()
        if (st.mode === "gate") st.ungate()
        else st.toggle()
      } else if (st && ev.key === "ArrowRight") st.step(1, ev.shiftKey)
      else if (st && ev.key === "ArrowLeft") st.step(-1, ev.shiftKey)
      else if (st && (ev.key === "r" || ev.key === "R")) st.replay()
      else if (ev.key === "0") fit(true)
      else if (ev.key === "+" || ev.key === "=") zoomAt(1.25, undefined, undefined, true)
      else if (ev.key === "-" || ev.key === "_") zoomAt(0.8, undefined, undefined, true)
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    el.addEventListener("pointerdown", down)
    el.addEventListener("pointermove", move)
    el.addEventListener("pointerup", up)
    el.addEventListener("pointercancel", up)
    addEventListener("keydown", key)
    return () => {
      el.removeEventListener("wheel", onWheel)
      el.removeEventListener("pointerdown", down)
      el.removeEventListener("pointermove", move)
      el.removeEventListener("pointerup", up)
      el.removeEventListener("pointercancel", up)
      removeEventListener("keydown", key)
    }
  }, [fit, zoomAt, x, y])

  const toggleTheme = () => {
    const next: ThemeName = (theme ?? systemTheme()) === "dark" ? "light" : "dark"
    setTheme(next)
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {}
    applyTheme(next, true)
  }
  const resolved = theme ?? "light"
  const sheet = hash.sheet?.length ? hash.sheet : undefined
  /** Export either the final frame (default) or the frame on screen. */
  const exportWith = (fn: () => void) => {
    if (!story || exportCurrent) return fn()
    flushSync(() => setOverride(story.frameAt(tl!.duration)))
    try {
      fn()
    } finally {
      flushSync(() => setOverride(undefined))
    }
  }

  return (
    <LazyMotion features={domAnimation} strict>
    <div className={`si-app${hash.chrome ? "" : " si-nochrome"}`}>
      <header className="si-head">
        <p className="si-kind">{TYPE_LABEL[scene.type]}</p>
        <h1 className="si-title">{scene.title}</h1>
        {scene.subtitle ? <p className="si-subtitle">{scene.subtitle}</p> : null}
        {tl ? <Captions frame={hash.beats ? undefined : liveFrame} /> : null}
      </header>
      {hash.beats && tl ? (
        <BeatSheet scene={scene} tl={tl} />
      ) : sheet ? (
        <div className="si-sheet" style={{ gridTemplateColumns: `repeat(${sheet.length}, 1fr)` }}>
          {sheet.map((t) => (
            <div key={t} data-theme={t}>
              <p className="si-sheet-cap">{t}</p>
              <Diagram scene={scene} copy={t} frame={story?.frameAt(tl!.duration)} />
            </div>
          ))}
        </div>
      ) : (
        <div className={`si-stage${story?.mode === "gate" ? " si-gated" : ""}`} ref={stage} onClick={() => story?.mode === "gate" && story.ungate()}>
          <m.div className="si-canvas" style={{ x, y, scale: k, originX: 0, originY: 0 }}>
            <div
              className="si-figure"
              style={
                story && (story.dim < 1 || story.blur > 0)
                  ? { opacity: story.dim, ...(story.blur > 0 ? { filter: `blur(${story.blur}px)` } : {}) }
                  : undefined
              }
            >
              <Diagram scene={scene} frame={liveFrame} />
              <div className="si-counters" />
            </div>
          </m.div>
          {story?.mode === "gate" ? <Gate onPlay={story.ungate} /> : null}
          {story && tl ? <Transport c={story} tl={tl} /> : null}
          <div className="si-tools" onPointerDown={(e) => e.stopPropagation()}>
            <Btn label="−" title="Zoom out (-)" onClick={() => zoomAt(0.8, undefined, undefined, true)} />
            <Btn label="+" title="Zoom in (+)" onClick={() => zoomAt(1.25, undefined, undefined, true)} />
            <Btn label="Fit" title="Fit to view (0)" onClick={() => fit(true)} />
            <span className="si-sep" />
            <Btn label="Toggle theme" title="Toggle light/dark" onClick={toggleTheme}>
              {resolved === "dark" ? <Sun /> : <Moon />}
            </Btn>
            <span className="si-sep" />
            {tl ? (
              <Btn label={exportCurrent ? "Frame: now" : "Frame: end"} title="Export the final frame or the frame on screen" onClick={() => setExportCurrent((v) => !v)} />
            ) : null}
            <Btn label="SVG" title="Export SVG" onClick={() => exportWith(() => hooks?.exportSvg(resolved))} />
            <Btn label="PNG" title="Export PNG (2×)" onClick={() => exportWith(() => hooks?.exportPng(resolved))} />
          </div>
        </div>
      )}
    </div>
    </LazyMotion>
  )
}
