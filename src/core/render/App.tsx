import { animate, domAnimation, LazyMotion, m, useMotionValue } from "motion/react"
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react"
import { createPortal, flushSync } from "react-dom"
import type { Frame, Timeline } from "../story/types.ts"
import { BeatSheet, Captions, Gate, Transport, useStory } from "./Story.tsx"
import { motion as M, palettes, cssVar, type Palette, type ThemeName } from "../../theme/tokens.ts"
import type { Scene } from "../scene.ts"
import { Diagram } from "./Diagram.tsx"
import { CAMERA, cameraAt, cameraAtEnd, fitCamera, followStep, readableScale, stepAt, stepFocus, type Camera, type Viewport } from "../story/camera.ts"
import { beatStops, steppedTime } from "../story/state.ts"
import { recompilePace } from "../story/compile.ts"
import { hasNarration, looksLikePath, parseFileRef, resolveCite, type CiteTarget } from "../story/narrate.ts"
import { Drawer, drawerIdForSi, drawerIds, drawerInfo, hasDrawer, type DrawerTarget } from "./Drawer.tsx"
import { Rail, railIndex } from "./Narration.tsx"

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
  onFrame?: (frame: Frame, playing: boolean, tl?: Timeline) => void
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
  /** `#pace=<n>`: reading-hold pace (0 = none). */
  pace?: number
  /** `#camera=follow|fit`: follow the story (also places a `#t=` frame) or keep the whole diagram in view. */
  camera?: "follow" | "fit"
  /** `#drawer=<id>`: open the change drawer on an element (or a file path) on load. */
  drawer?: string
  /** `#rail=0|1`: hide / show the narration rail (`rail=1` also shows it under `#chrome=0`). */
  rail?: boolean
  /** Pages: `#fig=<id>` scopes the other params to that figure; `#solo=1` shows only it. */
  fig?: string
  solo?: boolean
}

/**
 * A page figure's view of the hash: `theme` always (page-wide); everything else only when
 * `#fig=<id>` names this figure. Other hashes (TOC anchors…) parse to the defaults.
 */
export function figureHash(hash: string, id: string): HashParams {
  const all = parseHash(hash)
  const { fig, solo: _solo, ...rest } = all
  // Page-wide: `theme`, and `static=1` (every figure at its final frame; snapshots, print).
  if (fig !== id) return { chrome: true, ...(all.theme ? { theme: all.theme } : {}), ...(all.still ? { still: true } : {}) }
  return rest
}

/** Embedded (page figure) mode. */
export interface Embedded {
  /** Figure id (unique in the page). */
  id: string
}

/** DOM id prefix for a page figure's SVG defs (and the viewer's own filters). */
export const figurePrefix = (id: string): string => `f-${id.replace(/[^\w-]/g, "_")}-`

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
    ...(p.get("pace") !== null && p.get("pace") !== "" && paceOk(Number(p.get("pace"))) ? { pace: Number(p.get("pace")) } : {}),
    ...(Number(p.get("cols")) >= 1 ? { cols: Math.min(12, Math.floor(Number(p.get("cols")))) } : {}),
    ...(/^\d+-\d+$/.test(p.get("range") ?? "") ? { range: p.get("range")!.split("-").map(Number) as [number, number] } : {}),
    ...(p.get("drawer") ? { drawer: p.get("drawer")! } : {}),
    ...(p.get("rail") === "1" || p.get("rail") === "0" ? { rail: p.get("rail") === "1" } : {}),
    ...(p.get("fig") ? { fig: p.get("fig")! } : {}),
    ...(p.get("solo") === "1" ? { solo: true } : {}),
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

/** The reader's narration-rail toggle (`"on"` | `"off"`; default on). */
export const RAIL_KEY = "storyink-rail"

/** A drawer target for an id from the hash / page contract: an element with drawer content, else a file path. */
export function drawerTarget(scene: Scene, id: string): DrawerTarget | undefined {
  if (drawerInfo(scene, id)) return { id }
  if (looksLikePath(id)) return { file: parseFileRef(id) }
  return undefined
}

/** Attribute selector for a `data-si` key (ids may hold quotes / backslashes). */
const siSel = (key: string) => `[data-si="${key.replace(/["\\]/g, "\\$&")}"]`

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

export const PACE_KEY = "storyink-pace"
/** The viewer's Pauses presets (reading-hold pace). */
export const PACE_PRESETS: { pace: number; label: string }[] = [
  { pace: 0, label: "None" },
  { pace: 0.3, label: "Short" },
  { pace: 0.6, label: "Normal" },
  { pace: 1, label: "Long" },
  { pace: 1.5, label: "Longer" },
]
const paceOk = (n: number) => Number.isFinite(n) && n >= 0 && n <= 10

/**
 * Reading-hold pace. Precedence: `#pace=` hash, then the reader's stored choice
 * (`localStorage["storyink-pace"]`), then the author's `story.pace` (as compiled), then 0.6.
 */
export function resolvePace(o: { hash?: number; stored?: string | null; author?: number }): number {
  if (o.hash !== undefined && paceOk(o.hash)) return o.hash
  const s = o.stored != null && o.stored !== "" ? Number(o.stored) : NaN
  if (paceOk(s)) return s
  return o.author !== undefined && paceOk(o.author) ? o.author : 0.6
}

/** A preset's label for a pace ("Normal"), or the number ("0.8×"). */
export const paceLabel = (p: number) => PACE_PRESETS.find((x) => Math.abs(x.pace - p) < 1e-9)?.label ?? `${+p.toFixed(2)}×`

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
export function App({ scene, hooks, embedded }: AppProps & { hooks?: ViewerHooks; embedded?: Embedded }): ReactElement {
  /** Embedded figure: root element (focus scope), expanded state, drawer layer. */
  const root = useRef<HTMLDivElement>(null)
  const layer = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded
  const pfx = embedded ? figurePrefix(embedded.id) : ""
  /** Keys act on this viewer: always standalone; in a page only when the figure has focus. */
  const owns = () => {
    if (!embedded) return true
    const a = document.activeElement
    return !!a && (!!root.current?.contains(a) || !!layer.current?.contains(a))
  }
  const ownsRef = useRef(owns)
  ownsRef.current = owns
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
  /** Narration rail / change drawer (HTML only; only when the scene has narration / drawer content). */
  const narrated = useMemo(() => hasNarration(scene), [scene])
  const drawable = useMemo(() => hasDrawer(scene) || narrated, [scene, narrated])
  const [storedRail, setStoredRail] = useState<string | null>(null)
  const [drawer, setDrawer] = useState<DrawerTarget | undefined>(undefined)
  const [hot, setHot] = useState<CiteTarget | undefined>(undefined)
  const [storedPace, setStoredPace] = useState<string | null>(null)
  /** The author's pace (as compiled into the HTML) and the one in effect. */
  const authorPace = scene.timeline?.pace ?? 0.6
  const pace = resolvePace({ hash: hash.pace, stored: storedPace, author: authorPace })
  // Server markup uses the embedded timeline; after hydration a different pace recompiles it in
  // the browser (same function as the build, so the same numbers as `render --pace`).
  const tl = useMemo(() => (hydrated && scene.timeline ? recompilePace(scene, pace) : scene.timeline), [scene, hydrated, pace])
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
  /** Story time of the last settled `moveTo` (the camera derives from it until the reader moves). */
  const settledAt = useRef<number | null>(null)

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
      // Page figures keep the diagram clear of the transport / toolbar strip.
      const c = fitCamera(vb, { w: el.clientWidth, h: el.clientHeight - (embedded && hash.chrome && !expandedRef.current ? 56 : 0) })
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
    [vb, k, x, y, hash.chrome],
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
    const read = () => (embedded ? figureHash(location.hash, embedded.id) : parseHash(location.hash))
    const h = read()
    let last = JSON.stringify(h)
    setHash(h)
    if (typeof matchMedia === "function") setSysReduced(matchMedia("(prefers-reduced-motion: reduce)").matches)
    try {
      setStoredMotion(localStorage.getItem(MOTION_KEY))
      setStoredFollow(localStorage.getItem(FOLLOW_KEY))
      setStoredPace(localStorage.getItem(PACE_KEY))
      setStoredRail(localStorage.getItem(RAIL_KEY))
    } catch {}
    if (h.drawer) setDrawer(drawerTarget(scene, h.drawer))
    setHydrated(true)
    let stored: ThemeName | undefined
    try {
      const s = localStorage.getItem(THEME_KEY)
      if (s === "light" || s === "dark") stored = s
    } catch {}
    // A page owns the theme (its header toggle); figures only follow it.
    const initial = embedded ? (document.documentElement.dataset.theme as ThemeName | undefined) : h.theme ?? stored ?? (document.documentElement.dataset.theme as ThemeName | undefined)
    setTheme(initial ?? systemTheme())
    if (initial && !embedded) applyTheme(initial, false)
    let mo: MutationObserver | undefined
    if (embedded && typeof MutationObserver !== "undefined") {
      mo = new MutationObserver(() => setTheme((document.documentElement.dataset.theme as ThemeName | undefined) ?? systemTheme()))
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] })
    }
    const onHash = () => {
      const nh = read()
      // Figures ignore hash changes that don't change their view (TOC anchors): no refit.
      const sig = JSON.stringify(nh)
      if (embedded && sig === last) return
      last = sig
      setHash(nh)
      if (nh.drawer) setDrawer(drawerTarget(scene, nh.drawer))
    }
    addEventListener("hashchange", onHash)
    return () => {
      removeEventListener("hashchange", onHash)
      mo?.disconnect()
    }
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
    // Page figures: the same API under `__storyink.figures[id]`.
    const api: Record<string, unknown> = embedded
      ? (((w.__storyink.figures ??= {}) as Record<string, Record<string, unknown>>)[embedded.id] ??= {})
      : w.__storyink
    api.duration = tl?.duration ?? 0
    api.steps = tl ? tl.steps.map((st) => ({ id: st.id, label: st.label, t0: st.t0, t1: st.t1, ...(st.stop ? { stop: st.stop } : {}), ...(st.narrate ? { narrate: st.narrate } : {}) })) : []
    /** Change drawer: open on an element id (or a file path), close, and the open target. */
    api.openDrawer = (id: string) => drawerRef.current.open(String(id))
    api.closeDrawer = () => drawerRef.current.close()
    api.drawer = () => drawerRef.current.get()
    api.setTime = (x: number | "end") => storyRef.current?.seek(x === "end" ? (tl?.duration ?? 0) : Number(x))
    api.play = () => storyRef.current?.play()
    api.pause = () => storyRef.current?.pause()
    api.replay = () => storyRef.current?.replay()
    /** Animated step move (as → / ←); resolves when it ends. `stepAnimated()` is the running move or null. */
    api.step = (dir: number, chapter?: boolean) => {
      armed.current = true
      return storyRef.current?.step(dir < 0 ? -1 : 1, !!chapter) ?? Promise.resolve()
    }
    api.stepAnimated = () => storyRef.current?.moving() ?? null
    api.state = () => ({ t: storyRef.current?.now() ?? 0, mode: storyRef.current?.modeNow() ?? "static" })
    api.camera = () => cameraRef.current()
    api.pace = () => paceRef.current
    api.setPace = (n: number) => setPaceRef.current(Number(n))
    /** Beats: each beat's settled stop time (`beats()[k]` = after beat k + 1). */
    api.beats = () => (tl ? storyBeats(tl) : [])
    /** Move to a beat (−1 = start, ≥ count = end) or a time: animated (→ / ← look) or settled. */
    api.moveTo = (target: MoveTarget, o?: { animate?: boolean }) => {
      if (!tl) return Promise.resolve()
      armed.current = true
      const t = moveTime(tl, target)
      // A settled move (hash / entry states, snapshots): the camera is a pure function of t
      // (`cameraAt`, the same as `#camera=follow&t=`), whatever the order of resize / render.
      settledAt.current = o?.animate === false || reduced ? t : null
      const p = storyRef.current?.goto(t, o?.animate !== false) ?? Promise.resolve()
      if (settledAt.current !== null) placeRef.current()
      return p
    }
    /** Pages: highlight a cite's element (`ref` or null), and open a cite (file → drawer). */
    api.cite = (ref: string | null) => citeRef.current.hover(ref)
    api.openCite = (ref: string) => citeRef.current.open(ref)
  }, [tl])

  /** Initial / resize placement: `#camera=follow` + `#t=` shows the followed view; engaged follow re-follows; else fit. */
  const place = () => {
    const vp = viewport()
    if (!vp) return
    // After a settled `moveTo`: the follow camera at that time (pure), else fit.
    if (tl && settledAt.current !== null && storyRef.current && !hash.beats && !hash.sheet?.length) {
      const t = storyRef.current.now()
      if (follow && vp.w > 0 && vp.h > 0) {
        moveTo(cameraAt(scene, tl, t, vp, userK.current), false)
        engaged.current = !cameraAtEnd(tl, t)
      } else fit(false)
      return
    }
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
  if (mode === "playing") {
    armed.current = true
    settledAt.current = null
  }
  useEffect(() => {
    if (!tl || !story || !follow || !armed.current || hash.beats || hash.sheet?.length) return
    if (mode === "gate" || mode === "rewinding") return
    const vp = viewport()
    if (!vp) return
    const anim = !reduced
    if (settledAt.current !== null) {
      placeRef.current()
      return
    }
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
    if (story && hooks?.onFrame) hooks.onFrame(story.frame, story.mode === "playing" && !reduced, tl)
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
      // In a page the wheel scrolls the page; zoom needs Ctrl / ⌘ (or pinch) unless expanded.
      if (embedded && !expandedRef.current && !ev.ctrlKey && !ev.metaKey) return
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
      // A click (no drag) on an element with drawer content opens its drawer.
      else clickRef.current(ev.target as Element | null)
    }
    const key = (ev: KeyboardEvent) => {
      if (ev.target instanceof HTMLInputElement || ev.metaKey || ev.ctrlKey || ev.altKey) return
      // Pages: only the focused figure reacts (Space / arrows scroll the page otherwise).
      if (!ownsRef.current()) return
      // A presenting page (slides) owns the keyboard.
      if (embedded && document.documentElement.classList.contains("sp-presenting")) return
      const st = storyRef.current
      if (ev.key === "Escape" && drawerRef.current.get()) {
        drawerRef.current.close()
        return
      }
      if (ev.key === "Escape" && expandedRef.current) {
        setExpanded(false)
        return
      }
      if (ev.target instanceof Element && ev.target.closest(".si-cite") && (ev.key === "Enter" || ev.key === " ")) return
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
      else if (st && (ev.key === "[" || ev.key === "]")) stepPaceRef.current(ev.key === "]" ? 1 : -1)
      else if (st && (ev.key === "r" || ev.key === "R")) st.replay()
      else if (st && (ev.key === "m" || ev.key === "M")) toggleMotionRef.current()
      else if (ev.key === "n" || ev.key === "N") toggleRailRef.current()
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

  /** Set the reader's pace (stored; the hash follows an explicit choice, like Motion). */
  const setPace = (n: number) => {
    if (!Number.isFinite(n) || n < 0 || n > 10) return
    const v = String(+n.toFixed(3))
    setStoredPace(v)
    try {
      localStorage.setItem(PACE_KEY, v)
    } catch {}
    if (hash.pace !== undefined) {
      const p = new URLSearchParams(location.hash.replace(/^#/, ""))
      p.set("pace", v)
      history.replaceState(null, "", `#${p.toString()}`)
      setHash((h) => ({ ...h, pace: Number(v) }))
    }
  }
  /** `[` / `]`: the previous / next preset (from an off-preset value, the nearest one that way). */
  const stepPace = (dir: 1 | -1) => {
    const list = PACE_PRESETS.map((x) => x.pace)
    const next = dir > 0 ? list.find((x) => x > pace + 1e-9) : [...list].reverse().find((x) => x < pace - 1e-9)
    if (next !== undefined) setPace(next)
  }
  /** Toolbar click: cycle up through the presets, wrapping to None. */
  const cyclePace = () => {
    const list = PACE_PRESETS.map((x) => x.pace)
    setPace(list.find((x) => x > pace + 1e-9) ?? list[0])
  }
  const stepPaceRef = useRef(stepPace)
  stepPaceRef.current = stepPace
  const setPaceRef = useRef(setPace)
  setPaceRef.current = setPace
  const paceRef = useRef(pace)
  paceRef.current = pace
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

  /** Rail + drawer are viewer chrome: off in sheets, `#static=1` and `#chrome=0` (unless the hash asks). */
  // Client-only (never in the SSR markup): the stage size is final in the hydration commit, so
  // captures never race a rail / drawer appearing or disappearing. `#static=1` keeps them off
  // unless the hash asks explicitly (`#rail=1` / `#drawer=`), so snapshot gates compare like with like.
  const uiOk = hydrated && !hash.beats && !sheet0(hash) && (!hash.still || hash.rail === true || hash.drawer !== undefined)
  const railOn = hash.rail ?? (storedRail !== "off")
  const showRail = narrated && !!tl && uiOk && railOn && (hash.chrome || hash.rail === true)
  const drawerOk = drawable && uiOk && (hash.chrome || hash.drawer !== undefined)
  const toggleRail = () => {
    if (!narrated) return
    const next = railOn ? "off" : "on"
    setStoredRail(next)
    try {
      localStorage.setItem(RAIL_KEY, next)
    } catch {}
    if (hash.rail !== undefined) setHash((h) => ({ ...h, rail: next === "on" }))
  }
  const toggleRailRef = useRef(toggleRail)
  toggleRailRef.current = toggleRail
  const drawerRef = useRef({ open: (_id: string) => false as boolean, close: () => {}, get: () => undefined as DrawerTarget | undefined })
  drawerRef.current = {
    open: (id: string) => {
      const t = drawable ? drawerTarget(scene, id) : undefined
      if (t) setDrawer(t)
      return !!t
    },
    close: () => setDrawer(undefined),
    get: () => drawer,
  }
  const clickRef = useRef((_t: Element | null) => {})
  clickRef.current = (target: Element | null) => {
    if (!drawerOk || !target || storyRef.current?.modeNow() === "gate" || target.closest?.(NO_PAN)) return
    for (let g = target.closest?.("[data-si]"); g; g = g.parentElement?.closest("[data-si]") ?? null) {
      const id = drawerIdForSi(scene, g.getAttribute("data-si") ?? "")
      if (id && drawerInfo(scene, id)) {
        setDrawer({ id })
        return
      }
    }
  }
  const citeRef = useRef({ hover: (_r: string | null) => {}, open: (_r: string) => false as boolean })
  citeRef.current = {
    hover: (ref) => setHot(ref ? resolveCite(scene, ref) : undefined),
    open: (ref) => {
      const c = resolveCite(scene, ref)
      if (!c || !drawable) return false
      onCiteOpen(c)
      return true
    },
  }
  const onCiteOpen = (c: CiteTarget) => {
    setHot(undefined)
    if (c.kind === "file") setDrawer({ file: c.ref })
    else if (drawerInfo(scene, c.id)) setDrawer({ id: c.id })
  }
  /** Page figures scope their viewer-only rules to their own root. */
  const scope = embedded ? `.si-app[data-si-app="${embedded.id.replace(/["\\]/g, "\\$&")}"] ` : ""
  /** Viewer-only rules: pointer + hover on elements with a drawer, the hovered cite's element. */
  const affordCss = useMemo(() => {
    if (!hydrated || !drawerOk) return ""
    const d = drawerIds(scene)
    const keys = [...d.node.map((i) => `node:${i}`), ...d.edge.map((i) => `edge:${i}`), ...scene.edges.filter((e) => e.label && d.edge.includes(e.id)).map((e) => `label:${e.label!.id}`), ...d.group.map((i) => `group:${i}`)]
    if (!keys.length) return ""
    const sel = (suffix: string) => keys.map((k) => `${scope}.si-stage ${siSel(k)}${suffix}`).join(",")
    return `${sel("")}{cursor:pointer;}${sel(":hover")}{filter:drop-shadow(0 0 3px var(--si-inkFaint));}`
  }, [hydrated, drawerOk, scene, scope])
  const hotCss = hot?.kind === "element" ? `${hot.si.map((k) => `${scope}.si-stage ${siSel(k)}`).join(",")}{filter:drop-shadow(0 0 4px var(--si-ink)) drop-shadow(0 0 1px var(--si-ink));}` : ""
  // The rail shows what the header caption shows: the full-motion gate (t = 0) is step 1; the
  // reduced-motion gate shows the final frame, so the last narrated step.
  const railIdx = showRail && tl && story ? railIndex(tl, story.beat) : -1

  /**
   * Page figures before hydration and at `#static=1`: the diagram is fitted by CSS (no camera
   * transform), so the server markup and a static capture lay out the same with or without
   * JavaScript and whatever the hydration timing.
   */
  const fluid = !!embedded && !expanded && (!hydrated || !!hash.still)
  /** Page figures (not expanded): the compact toolbar (no pauses / frame / export buttons). */
  const compact = !!embedded && !expanded
  useEffect(() => {
    if (!embedded) return
    document.documentElement.classList.toggle("si-fig-expanded", expanded)
    if (!expanded) return
    root.current?.focus({ preventScroll: true })
    return () => document.documentElement.classList.remove("si-fig-expanded")
  }, [expanded])

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
    <div
      className={`si-app${embedded ? ` si-embedded${expanded ? " si-expanded" : ""}` : ""}${hash.chrome ? "" : " si-nochrome"}${reduced ? " si-reduced" : ""}${hash.beats && tl ? " si-sheet-mode" : ""}`}
      {...(embedded
        ? {
            ref: root,
            tabIndex: 0,
            "data-si-app": embedded.id,
            "aria-label": `${TYPE_LABEL[scene.type]}: ${scene.title}`,
            // Clicking a figure focuses it (keys then act on it), without scrolling the page.
            onPointerDown: () => {
              if (!root.current?.contains(document.activeElement)) root.current?.focus({ preventScroll: true })
            },
          }
        : {})}
    >
      {embedded ? (
        tl ? (
          <div className="si-fig-caps">
            <Captions frame={hash.beats ? undefined : liveFrame} />
          </div>
        ) : null
      ) : (
      <header className="si-head">
        <p className="si-kind">{TYPE_LABEL[scene.type]}</p>
        <h1 className="si-title">{scene.title}</h1>
        {scene.subtitle ? <p className="si-subtitle">{scene.subtitle}</p> : null}
        {tl ? <Captions frame={hash.beats ? undefined : liveFrame} /> : null}
      </header>
      )}
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
        <StageWrap
          on={(narrated && !!tl) || drawable}
          side={
            // One side column: the open drawer replaces the rail (the stage re-fits either way).
            drawer && drawerOk && !embedded ? (
              <Drawer scene={scene} target={drawer} onClose={() => setDrawer(undefined)} />
            ) : railIdx >= 0 && tl ? (
              <Rail scene={scene} tl={tl} index={railIdx} onCite={setHot} onOpen={onCiteOpen} onHide={toggleRail} />
            ) : null
          }
        >
        <div className={`si-stage${story?.mode === "gate" ? " si-gated" : ""}`} ref={stage} {...(embedded && !expanded ? { style: figureStageStyle(vb, hash.chrome) } : {})} onClick={(e) => {
            // A click on the diagram surface starts the story; clicks on controls (toolbar, transport) don't.
            if (story?.mode === "gate" && !(e.target as Element).closest?.(NO_PAN)) story.ungate()
          }}>
          <m.div
            className={fluid ? "si-canvas si-canvas-fluid" : "si-canvas"}
            style={fluid ? { bottom: hash.chrome ? FIG_CHROME : 0 } : { x, y, scale: k, originX: 0, originY: 0, ...(hydrated && hash.camera === "follow" && hash.t !== undefined ? { visibility: "hidden" as const } : {}) }}
          >
            {story && story.glitch > 0 ? <GlitchFilter t={story.t} amount={story.glitch} id={`${pfx}si-glitch`} /> : null}
            <div
              className="si-figure"
              style={
                story && story.glitch > 0
                  ? { opacity: story.dim, filter: `url(#${pfx}si-glitch) blur(${+(0.3 * story.blur).toFixed(2)}px)` }
                  : story && (story.dim < 1 || story.blur > 0)
                  ? { opacity: story.dim, ...(story.blur > 0 ? { filter: `blur(${story.blur}px)` } : {}) }
                  : undefined
              }
            >
              <Diagram scene={scene} frame={liveFrame} {...(pfx ? { idPrefix: pfx } : {})} />
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
            {embedded ? null : (
              <>
                <Btn label="Toggle theme" title="Toggle light/dark" onClick={toggleTheme}>
                  {resolved === "dark" ? <Sun /> : <Moon />}
                </Btn>
                <span className="si-sep" />
              </>
            )}
            {tl ? (
              <>
                <Btn
                  label={reduced ? "Motion: reduced" : "Motion: full"}
                  title={reduced ? "Reduced motion: plays step by step. Click for full motion (M)" : "Full motion. Click to play step by step (M)"}
                  pressed={reduced}
                  still={reduced}
                  onClick={toggleMotion}
                />
                {compact ? null : <Btn
                  label={`Pauses: ${paceLabel(pace)}`}
                  title={`Reading pauses after each step: ${paceLabel(pace)}${Math.abs(pace - authorPace) < 1e-9 ? " (default)" : ""}. Click or [ / ] to change`}
                  onClick={cyclePace}
                />}
                <Btn
                  label="Follow"
                  title={follow ? "Camera follows the story. Click to keep the view still (F)" : "Camera stays still. Click to follow the story (F)"}
                  pressed={follow}
                  onClick={toggleFollow}
                />
                <span className="si-sep" />
              </>
            ) : null}
            {tl && !compact ? (
              <Btn label={exportCurrent ? "Frame: now" : "Frame: end"} title="Export the final frame or the frame on screen" onClick={() => setExportCurrent((v) => !v)} />
            ) : null}
            {compact ? null : (
              <>
                <Btn label="SVG" title="Export SVG" onClick={() => exportWith(() => hooks?.exportSvg(resolved))} />
                <Btn label="PNG" title="Export PNG (2×)" onClick={() => exportWith(() => hooks?.exportPng(resolved))} />
              </>
            )}
            {narrated && tl ? (
              <>
                <span className="si-sep" />
                <Btn label="Narration" title={railOn ? "Hide the narration rail (N)" : "Show the narration rail (N)"} pressed={railOn} onClick={toggleRail} />
              </>
            ) : null}
            {embedded ? (
              <>
                <span className="si-sep" />
                <Btn label={expanded ? "Close" : "Expand"} title={expanded ? "Back to the page (Esc)" : "Fill the window (Esc returns)"} pressed={expanded} onClick={() => setExpanded((v) => !v)} />
              </>
            ) : null}
          </div>
        </div>
        </StageWrap>
      )}
      {affordCss || hotCss ? <style>{affordCss + hotCss}</style> : null}
      {embedded && hydrated && drawer && drawerOk
        ? createPortal(
            // Page figures: the drawer is a page-level overlay (one per page at a time is the reader's call).
            <div className="si-drawer-layer" ref={layer} data-for={embedded.id}>
              <Drawer scene={scene} target={drawer} onClose={() => setDrawer(undefined)} />
            </div>,
            document.body,
          )
        : null}
    </div>
    </LazyMotion>
  )
}

const sheet0 = (h: HashParams) => !!h.sheet?.length

/** A `moveTo` target: a beat (0-based; −1 = start; ≥ the beat count = end) or a story time. */
export type MoveTarget = { beat: number } | { t: number }

/** The story's beats as their settled stop times (stepped schedule, without the final frame). */
export const storyBeats = (tl: Timeline): number[] => beatStops(tl).slice(0, -1)

/** The story time a `moveTo` target names. */
export function moveTime(tl: Timeline, target: MoveTarget): number {
  if ("t" in target) return Math.max(0, Math.min(tl.duration, Number(target.t) || 0))
  const b = storyBeats(tl)
  const k = Math.floor(Number(target.beat))
  if (!(k >= 0)) return 0
  return k < b.length ? b[k] : tl.duration
}

/** Page figure toolbar / transport strip (px) and fit padding (diagram px, as `fitCamera`). */
const FIG_CHROME = 56
const FIG_PAD = 32

/**
 * Page figure stage size: full column width; height = the diagram's aspect (with fit padding) at
 * that width plus the toolbar strip, so a fit fills the width; at least 260 px; at most the
 * height of a 1.25× fit (the largest fit scale) and `--si-fig-max` (90vh; snapshots pin it). Pure
 * CSS: the same before and after hydration.
 */
export function figureStageStyle(vb: { w: number; h: number }, chrome: boolean): Record<string, string> {
  const extra = chrome ? FIG_CHROME : 0
  const w = vb.w + 2 * FIG_PAD
  const h = vb.h + 2 * FIG_PAD
  // Full column width (the figure's container width, `cqw`); height from the aspect, up to the
  // largest fit scale (1.25, as `fitCamera`) and the viewport cap.
  // Rounded to whole px: a fractional stage height rasterizes differently between captures.
  return { height: `round(down, min(${+((100 * h) / w).toFixed(3)}cqw + ${extra}px, ${Math.round(h * 1.25 + extra)}px, var(--si-fig-max, 90vh)), 1px)` }
}

/** Narrated scenes: the stage and the narration rail side by side (bottom sheet when narrow). */
function StageWrap({ on, side: rail, children }: { on: boolean; side: ReactNode; children: ReactNode }): ReactElement {
  if (!on) return <>{children}</>
  return (
    <div className="si-main">
      {children}
      {rail}
    </div>
  )
}

/**
 * Glitch rewind (HTML only): horizontal band displacement. Noise → only the extremes of R
 * displace (bands), G pinned at 0.5 (no vertical shift); strength follows the rewind speed.
 */
function GlitchFilter({ t, amount, id = "si-glitch" }: { t: number; amount: number; id?: string }) {
  return (
    <svg className="si-glitch-defs" width="0" height="0" aria-hidden="true" style={{ position: "absolute" }}>
      <filter id={id} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.0008 0.09" numOctaves={1} seed={Math.round(t * 24)} result="n" />
        {/* Contrast first (noise sits near 0.5), then only the extremes displace: bands. */}
        <feComponentTransfer in="n" result="c">
          <feFuncR type="linear" slope={4} intercept={-1.5} />
        </feComponentTransfer>
        <feComponentTransfer in="c" result="b">
          <feFuncR type="discrete" tableValues="0 .5 .5 .5 1" />
        </feComponentTransfer>
        <feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 0 0 0 0.5  0 0 1 0 0  0 0 0 1 0" result="m" />
        <feDisplacementMap in="SourceGraphic" in2="m" scale={+(16 * amount).toFixed(2)} xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  )
}
