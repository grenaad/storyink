import { animate, domAnimation, LazyMotion, m, useMotionValue } from "motion/react"
import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react"
import { flushSync } from "react-dom"
import type { Frame } from "../story/types.ts"
import { BeatSheet, Captions, Gate, Transport, useStory } from "./Story.tsx"
import { motion as M, palettes, cssVar, type Palette, type ThemeName } from "../../theme/tokens.ts"
import type { Scene } from "../scene.ts"
import { Diagram } from "./Diagram.tsx"
import { CAMERA, cameraAt, cameraAtEnd, fitCamera, followStep, readableScale, stepAt, stepFocus, type Camera, type Viewport } from "../story/camera.ts"
import { steppedTime } from "../story/state.ts"

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
  /** Beat sheet layout: fixed column count and a tile range (for compact previews). */
  cols?: number
  range?: [number, number]
  /** `#camera=follow|fit`: follow the story (also places a `#t=` frame) or keep the whole diagram in view. */
  camera?: "follow" | "fit"
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
    ...(p.get("camera") === "follow" || p.get("camera") === "fit" ? { camera: p.get("camera") as "follow" | "fit" } : {}),
    ...(Number(p.get("cols")) >= 1 ? { cols: Math.min(12, Math.floor(Number(p.get("cols")))) } : {}),
    ...(/^\d+-\d+$/.test(p.get("range") ?? "") ? { range: p.get("range")!.split("-").map(Number) as [number, number] } : {}),
  }
}

/**
 * Effective motion mode. Precedence: `#motion=` hash, then the reader's stored toolbar choice
 * (`localStorage["storyink-motion"]`), then the author's `story.motion` (default "full"). The OS
 * `prefers-reduced-motion` is consulted only when the author chose "system".
 */
export function resolveMotion(o: { hash?: "full" | "reduced"; stored?: string | null; author?: "full" | "reduced" | "system"; system: boolean }): "full" | "reduced" {
  if (o.hash) return o.hash
  if (o.stored === "full" || o.stored === "reduced") return o.stored
  const author = o.author ?? "full"
  if (author !== "system") return author
  return o.system ? "reduced" : "full"
}

export const MOTION_KEY = "storyink-motion"

export const FOLLOW_KEY = "storyink-follow"

/**
 * Whether the camera follows the story. Precedence: `#camera=` hash, then the reader's stored
 * toolbar choice (`localStorage["storyink-follow"]` = "on" | "off"), then the author's
 * `story.camera` (default "follow").
 */
export function resolveFollow(o: { hash?: "follow" | "fit"; stored?: string | null; author?: "follow" | "fit" }): boolean {
  if (o.hash) return o.hash === "follow"
  if (o.stored === "on" || o.stored === "off") return o.stored === "on"
  return (o.author ?? "follow") === "follow"
}

/** Pointerdown targets that never start a pan (controls inside the stage). */
export const NO_PAN = "button, input, select, textarea, a, [role=slider], .si-tools, .si-transport, .si-gate, [data-no-pan]"

function Btn({ label, title, onClick, children, pressed, still }: { label: string; title: string; onClick: () => void; children?: ReactNode; pressed?: boolean; still?: boolean }) {
  return (
    <m.button
      type="button"
      className="si-btn"
      aria-label={label}
      title={title}
      onClick={onClick}
      {...(pressed !== undefined ? { "aria-pressed": pressed } : {})}
      {...(still ? {} : { whileHover: M.hover, whileTap: M.press })}
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
  /** Called when a manual pan starts (the follow camera suspends on it). */
  const onPanStart = useRef<() => void>(() => {})
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const k = useMotionValue(1)
  const [hash, setHash] = useState<HashParams>({ chrome: true })
  const [theme, setTheme] = useState<ThemeName | undefined>(undefined)
  const [hydrated, setHydrated] = useState(false)
  const [sysReduced, setSysReduced] = useState(false)
  const [storedMotion, setStoredMotion] = useState<string | null>(null)
  const [override, setOverride] = useState<Frame | undefined>(undefined)
  const [exportCurrent, setExportCurrent] = useState(false)
  const vb = scene.viewBox
  const tl = scene.timeline
  const reduced = resolveMotion({ hash: hash.motion, stored: storedMotion, author: tl?.motion, system: sysReduced }) === "reduced"
  const story = useStory(scene, tl, {
    ...(hash.t !== undefined ? { t: hash.t } : {}),
    ...(hash.autoplay !== undefined ? { autoplay: hash.autoplay } : {}),
    reduced,
    still: !hydrated || !!hash.still || !!hash.beats || !!hash.sheet?.length,
    stage,
  })

  const [storedFollow, setStoredFollow] = useState<string | null>(null)
  const follow = resolveFollow({ hash: hash.camera, stored: storedFollow, author: tl?.camera })
  /** The camera the viewer is heading to (animations ease the motion values towards it). */
  const goal = useRef<Camera>({ k: 1, x: 0, y: 0 })
  /** The reader's own zoom (wheel, −/+, Fit): follow keeps it and pans. */
  const userK = useRef<number | undefined>(undefined)
  /** Step during which the reader panned: follow waits for the next out-of-view step. */
  const suspended = useRef<number | null>(null)
  /** The camera is off fit because of follow (so the end eases back and resizes re-follow). */
  const engaged = useRef(false)
  /** Follow reacts to playback and to the reader's seeks, never to a `#t=` load or setTime(). */
  const armed = useRef(false)

  const viewport = useCallback((): Viewport | undefined => {
    const el = stage.current
    if (!el) return undefined
    return { w: el.clientWidth, h: el.clientHeight, bottom: hash.chrome ? 56 : 0 }
  }, [hash.chrome])

  const moveTo = useCallback(
    (c: Camera, anim: boolean) => {
      goal.current = c
      if (anim) {
        animate(k, c.k, CAMERA.spring)
        animate(x, c.x, CAMERA.spring)
        animate(y, c.y, CAMERA.spring)
      } else {
        k.stop()
        x.stop()
        y.stop()
        k.set(c.k)
        x.set(c.x)
        y.set(c.y)
      }
    },
    [k, x, y],
  )

  const fit = useCallback(
    (anim: boolean) => {
      const el = stage.current
      if (!el) return
      // Snap to whole pixels / 1/64 scale steps so repeated captures rasterize identically.
      const c = fitCamera(vb, { w: el.clientWidth, h: el.clientHeight })
      engaged.current = false
      goal.current = c
      if (anim) {
        animate(k, c.k, M.spring)
        animate(x, c.x, M.spring)
        animate(y, c.y, M.spring)
      } else {
        k.set(c.k)
        x.set(c.x)
        y.set(c.y)
      }
    },
    [vb, k, x, y],
  )

  const zoomAt = useCallback(
    (factor: number, cx?: number, cy?: number, anim = false) => {
      const el = stage.current
      if (!el) return
      const px = cx ?? el.clientWidth / 2
      const py = cy ?? el.clientHeight / 2
      // From the goal, so quick repeated clicks compound instead of reading a mid-spring value.
      const g = anim ? goal.current : { k: k.get(), x: x.get(), y: y.get() }
      const k1 = Math.max(0.1, Math.min(8, g.k * factor))
      const c = { k: k1, x: px - ((px - g.x) * k1) / g.k, y: py - ((py - g.y) * k1) / g.k }
      userK.current = k1
      goal.current = c
      if (anim) {
        animate(k, c.k, M.spring)
        animate(x, c.x, M.spring)
        animate(y, c.y, M.spring)
      } else {
        k.set(c.k)
        x.set(c.x)
        y.set(c.y)
      }
    },
    [k, x, y],
  )

  // Hash + theme bootstrap (after hydration so server and client markup match).
  useEffect(() => {
    const h = parseHash(location.hash)
    setHash(h)
    if (typeof matchMedia === "function") setSysReduced(matchMedia("(prefers-reduced-motion: reduce)").matches)
    try {
      setStoredMotion(localStorage.getItem(MOTION_KEY))
      setStoredFollow(localStorage.getItem(FOLLOW_KEY))
    } catch {}
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
    if (!hash.sheet?.length && !hash.beats) place()
    hooks?.onReady(!!hash.sheet?.length || !!hash.beats)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    /** Animated step move (as → / ←); resolves when it ends. `stepAnimated()` is the running move or null. */
    w.__storyink.step = (dir: number, chapter?: boolean) => {
      armed.current = true
      return storyRef.current?.step(dir < 0 ? -1 : 1, !!chapter) ?? Promise.resolve()
    }
    w.__storyink.stepAnimated = () => storyRef.current?.moving() ?? null
    w.__storyink.state = () => ({ t: storyRef.current?.now() ?? 0, mode: storyRef.current?.modeNow() ?? "static" })
    w.__storyink.camera = () => cameraRef.current()
  }, [tl])

  /** Initial / resize placement: `#camera=follow` + `#t=` shows the followed view; engaged follow re-follows; else fit. */
  const place = () => {
    const vp = viewport()
    if (!vp) return
    if (tl && hash.camera === "follow" && hash.t !== undefined && !armed.current) {
      const t0 = hash.t === "end" ? tl.duration : Number(hash.t) || 0
      const t = reduced ? steppedTime(tl, t0) : t0
      moveTo(cameraAt(scene, tl, t, vp), false)
      // Chrome's raster of the canvas depends on whether a frame was painted at the fit transform
      // before this one (frame timing, differs per run), so `#camera=follow&t=` captures flaked.
      // The canvas stays hidden until the followed camera has painted: one paint path, same pixels.
      const cv = stage.current?.querySelector<HTMLElement>(".si-canvas")
      if (cv && cv.style.visibility !== "visible") requestAnimationFrame(() => requestAnimationFrame(() => (cv.style.visibility = "visible")))
      engaged.current = !cameraAtEnd(tl, t)
      return
    }
    const st = storyRef.current
    if (tl && st && follow && engaged.current) {
      moveTo(followStep(goal.current, vb, vp, stepFocus(scene, tl, stepAt(tl, st.t)), userK.current ?? readableScale(vb, vp)), false)
      return
    }
    fit(false)
  }
  const placeRef = useRef(place)
  placeRef.current = place

  // The follow camera: one decision per step change (and on play / seek / end), never per frame.
  const stepIdx = tl && story ? stepAt(tl, story.t) : 0
  const atEnd = tl && story ? cameraAtEnd(tl, story.t) : false
  const mode = story?.mode
  if (mode === "playing") armed.current = true
  useEffect(() => {
    if (!tl || !story || !follow || !armed.current || hash.beats || hash.sheet?.length) return
    if (mode === "gate" || mode === "rewinding") return
    const vp = viewport()
    if (!vp) return
    const anim = !reduced
    if (atEnd) {
      // Ended or in the final hold: ease back out so the whole diagram is seen once.
      if (engaged.current) {
        moveTo(fitCamera(vb, vp), anim)
        engaged.current = false
      }
      return
    }
    if (suspended.current === stepIdx) return
    suspended.current = null
    const next = followStep(goal.current, vb, vp, stepFocus(scene, tl, stepIdx), userK.current ?? readableScale(vb, vp))
    if (next !== goal.current) {
      moveTo(next, anim)
      engaged.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIdx, atEnd, mode, follow, reduced])

  // A manual pan suspends follow for the current step.
  onPanStart.current = () => {
    k.stop()
    x.stop()
    y.stop()
    if (story && tl) suspended.current = stepAt(tl, story.t)
  }

  const liveFrame = override ?? story?.frame
  useEffect(() => {
    // Reduced motion: counters jump to exact values (no rolling reels).
    if (story && hooks?.onFrame) hooks.onFrame(story.frame, story.mode === "playing" && !reduced)
  }, [story?.frame, story?.mode, hooks, reduced])

  useEffect(() => {
    const onResize = () => placeRef.current()
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
      k.stop()
      x.stop()
      y.stop()
      zoomAt(Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015)), ev.clientX - r.left, ev.clientY - r.top)
    }
    let drag: { id: number; sx: number; sy: number; ox: number; oy: number; moved: boolean } | undefined
    const down = (ev: PointerEvent) => {
      if (ev.button !== 0) return
      // This native listener runs before React's root listener, so a React stopPropagation on the
      // controls is too late: capturing here would swallow their click. Pan only from the surface.
      if ((ev.target as Element | null)?.closest?.(NO_PAN)) return
      drag = { id: ev.pointerId, sx: ev.clientX, sy: ev.clientY, ox: x.get(), oy: y.get(), moved: false }
    }
    const move = (ev: PointerEvent) => {
      if (!drag || drag.id !== ev.pointerId) return
      // Capture only once the pointer really moves, so a plain click on the surface stays a click.
      if (!drag.moved) {
        if (Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) < 3) return
        drag.moved = true
        try {
          el.setPointerCapture(ev.pointerId)
        } catch {}
        el.classList.add("si-dragging")
        onPanStart.current()
      }
      x.set(drag.ox + ev.clientX - drag.sx)
      y.set(drag.oy + ev.clientY - drag.sy)
      goal.current = { k: k.get(), x: x.get(), y: y.get() }
    }
    const up = (ev: PointerEvent) => {
      if (!drag || drag.id !== ev.pointerId) return
      const moved = drag.moved
      drag = undefined
      if (moved) el.classList.remove("si-dragging")
    }
    const key = (ev: KeyboardEvent) => {
      if (ev.target instanceof HTMLInputElement || ev.metaKey || ev.ctrlKey || ev.altKey) return
      const st = storyRef.current
      if (st && (ev.key === " " || ev.code === "Space")) {
        ev.preventDefault()
        if (st.mode === "gate") st.ungate()
        else st.toggle()
      } else if (st && ev.key === "ArrowRight") {
        armed.current = true
        st.step(1, ev.shiftKey)
      } else if (st && ev.key === "ArrowLeft") {
        armed.current = true
        st.step(-1, ev.shiftKey)
      } else if (st && (ev.key === "f" || ev.key === "F")) toggleFollowRef.current()
      else if (st && (ev.key === "r" || ev.key === "R")) st.replay()
      else if (st && (ev.key === "m" || ev.key === "M")) toggleMotionRef.current()
      else if (ev.key === "0") fitClickRef.current()
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
  }, [fit, zoomAt, x, y, k])

  const toggleMotion = () => {
    const next = reduced ? "full" : "reduced"
    setStoredMotion(next)
    try {
      localStorage.setItem(MOTION_KEY, next)
    } catch {}
    // The hash wins over the stored choice, so keep it in step with an explicit click.
    if (hash.motion) {
      const p = new URLSearchParams(location.hash.replace(/^#/, ""))
      p.set("motion", next)
      history.replaceState(null, "", `#${p.toString()}`)
      setHash((h) => ({ ...h, motion: next }))
    }
  }
  const toggleMotionRef = useRef(toggleMotion)
  toggleMotionRef.current = toggleMotion

  const toggleFollow = () => {
    const next = follow ? "off" : "on"
    setStoredFollow(next)
    try {
      localStorage.setItem(FOLLOW_KEY, next)
    } catch {}
    if (hash.camera) {
      const p = new URLSearchParams(location.hash.replace(/^#/, ""))
      p.set("camera", next === "on" ? "follow" : "fit")
      history.replaceState(null, "", `#${p.toString()}`)
      setHash((h) => ({ ...h, camera: next === "on" ? "follow" : "fit" }))
    }
  }
  const toggleFollowRef = useRef(toggleFollow)
  toggleFollowRef.current = toggleFollow
  /** Fit is a manual zoom: follow then keeps the fit scale and only pans if needed. */
  const fitClick = () => {
    fit(true)
    userK.current = goal.current.k
  }
  const fitClickRef = useRef(fitClick)
  fitClickRef.current = fitClick
  const cameraRef = useRef<() => Record<string, unknown>>(() => ({}))
  cameraRef.current = () => ({
    mode: follow ? "follow" : "fit",
    follow,
    k: k.get(),
    x: x.get(),
    y: y.get(),
    goal: goal.current,
    step: stepIdx,
    engaged: engaged.current,
    suspended: suspended.current,
    userK: userK.current ?? null,
    viewport: viewport() ?? null,
  })
  /** The transport's scrubber is a reader seek: follow reacts to it. */
  const transport = story ? { ...story, seek: (t: number) => ((armed.current = true), story.seek(t)) } : undefined

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
    <div className={`si-app${hash.chrome ? "" : " si-nochrome"}${reduced ? " si-reduced" : ""}${hash.beats && tl ? " si-sheet-mode" : ""}`}>
      <header className="si-head">
        <p className="si-kind">{TYPE_LABEL[scene.type]}</p>
        <h1 className="si-title">{scene.title}</h1>
        {scene.subtitle ? <p className="si-subtitle">{scene.subtitle}</p> : null}
        {tl ? <Captions frame={hash.beats ? undefined : liveFrame} /> : null}
      </header>
      {hash.beats && tl ? (
        <BeatSheet scene={scene} tl={tl} {...(hash.cols ? { cols: hash.cols } : {})} {...(hash.range ? { range: hash.range } : {})} />
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
          <m.div className="si-canvas" style={{ x, y, scale: k, originX: 0, originY: 0, ...(hydrated && hash.camera === "follow" && hash.t !== undefined ? { visibility: "hidden" as const } : {}) }}>
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
          {story?.mode === "gate" ? <Gate onPlay={story.ungate} still={reduced} /> : null}
          {transport && tl ? <Transport c={transport} tl={tl} /> : null}
          <div className="si-tools" onPointerDown={(e) => e.stopPropagation()}>
            <Btn label="−" title="Zoom out (-)" onClick={() => zoomAt(0.8, undefined, undefined, true)} />
            <Btn label="+" title="Zoom in (+)" onClick={() => zoomAt(1.25, undefined, undefined, true)} />
            <Btn label="Fit" title="Fit to view (0)" onClick={fitClick} />
            <span className="si-sep" />
            <Btn label="Toggle theme" title="Toggle light/dark" onClick={toggleTheme}>
              {resolved === "dark" ? <Sun /> : <Moon />}
            </Btn>
            <span className="si-sep" />
            {tl ? (
              <>
                <Btn
                  label={reduced ? "Motion: reduced" : "Motion: full"}
                  title={reduced ? "Reduced motion: plays step by step. Click for full motion (M)" : "Full motion. Click to play step by step (M)"}
                  pressed={reduced}
                  still={reduced}
                  onClick={toggleMotion}
                />
                <Btn
                  label="Follow"
                  title={follow ? "Camera follows the story. Click to keep the view still (F)" : "Camera stays still. Click to follow the story (F)"}
                  pressed={follow}
                  onClick={toggleFollow}
                />
                <span className="si-sep" />
              </>
            ) : null}
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
