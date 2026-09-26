import { animate, useMotionValue, useMotionValueEvent, type AnimationPlaybackControls } from "motion/react"
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react"
import { story as S } from "../../theme/tokens.ts"
import type { Scene } from "../scene.ts"
import { beatCaption, beatTileMin, beatTimes, steppedSchedule, steppedStop, steppedTime, storyState } from "../story/state.ts"
import type { Frame, Timeline } from "../story/types.ts"
import { Diagram } from "./Diagram.tsx"

export type Mode = "gate" | "playing" | "paused" | "ended" | "rewinding"

export interface StoryControls {
  t: number
  frame: Frame
  mode: Mode
  /** Content dim (gate .55, settled end .75). */
  dim: number
  blur: number
  reduced: boolean
  play: () => void
  pause: () => void
  toggle: () => void
  seek: (t: number) => void
  replay: () => void
  step: (dir: 1 | -1, chapters?: boolean) => void
  ungate: () => void
  /** Render synchronously at another time (for exporting a specific frame). */
  frameAt: (t: number) => Frame
}

export interface StoryOptions {
  /** Initial seek from the hash (#t=). */
  t?: string
  autoplay?: boolean
  reduced: boolean
  /** Static: the SSR final frame, runtime disabled. */
  still: boolean
  stage: React.RefObject<HTMLDivElement | null>
}

const TAPE: [number, number, number, number] = [0.65, 0, 0.25, 1]

/**
 * The story runtime. One Motion value is the clock; everything else is
 * `storyState(scene, timeline, clock)`. Only the clock driver touches wall time.
 */
export function useStory(scene: Scene, tl: Timeline | undefined, opts: StoryOptions): StoryControls | undefined {
  const duration = tl?.duration ?? 0
  const clock = useMotionValue(duration)
  const [t, setT] = useState(duration)
  const [mode, setMode] = useState<Mode>("ended")
  const [settled, setSettled] = useState(false)
  const [blur, setBlur] = useState(0)
  const ctl = useRef<AnimationPlaybackControls | undefined>(undefined)
  const resumeOnReturn = useRef(false)
  const started = useRef(false)
  const modeRef = useRef<Mode>("ended")
  modeRef.current = mode
  useMotionValueEvent(clock, "change", (v) => setT(v))

  const stop = () => {
    ctl.current?.stop()
    ctl.current = undefined
  }
  const pause = useCallback(() => {
    stop()
    setBlur(0)
    setMode((m) => (m === "gate" ? m : "paused"))
  }, [])
  const seek = useCallback(
    (x: number) => {
      stop()
      setBlur(0)
      const v = Math.max(0, Math.min(duration, x))
      // Reduced motion: quantised to the settled state of the step in effect.
      clock.set(opts.reduced && tl ? steppedTime(tl, v) : v)
      setMode(x >= duration ? "ended" : "paused")
      setSettled(false)
    },
    [clock, duration, opts.reduced, tl],
  )
  const play = useCallback(() => {
    if (!tl) return
    if (opts.reduced) {
      // Reduced motion ("Play steps"): jump to each step's settled state, hold for its
      // reading time, advance. No pulses, tweens or draw-on in between.
      stop()
      setBlur(0)
      setSettled(false)
      const sched = steppedSchedule(tl)
      const now = clock.get()
      let k = now >= duration - 1e-3 ? 0 : Math.max(0, steppedStop(tl, now))
      let timer: ReturnType<typeof setTimeout> | undefined
      let stopped = false
      started.current = true
      const show = () => {
        if (stopped) return
        const s0 = sched[k]
        clock.set(s0.t)
        if (k >= sched.length - 1) {
          ctl.current = undefined
          if (tl.loop) {
            k = 0
            timer = setTimeout(show, S.beats.read * 1000)
            return
          }
          setMode("ended")
          return
        }
        timer = setTimeout(() => {
          k++
          show()
        }, s0.hold * 1000)
      }
      setMode("playing")
      ctl.current = {
        stop: () => {
          stopped = true
          clearTimeout(timer)
        },
      } as AnimationPlaybackControls
      show()
      return
    }
    stop()
    setSettled(false)
    const from = clock.get() >= duration - 1e-3 ? 0 : clock.get()
    clock.set(from)
    setMode("playing")
    started.current = true
    // The clock driver: the only place that reads wall time.
    let raf = 0
    let last = performance.now()
    let stopped = false
    const tick = (now: number) => {
      if (stopped) return
      const v = Math.min(duration, clock.get() + (now - last) / 1000)
      last = now
      clock.set(v)
      if (v >= duration) {
        ctl.current = undefined
        if (tl.loop) replayRef.current()
        else setMode("ended")
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame((now) => {
      last = now
      tick(now)
    })
    ctl.current = {
      stop: () => {
        stopped = true
        cancelAnimationFrame(raf)
      },
    } as AnimationPlaybackControls
  }, [tl, clock, duration, opts.reduced, seek])
  const replay = useCallback(() => {
    if (!tl) return
    stop()
    setSettled(false)
    const t0 = clock.get()
    if (opts.reduced) {
      // Restart from step 1, no tape rewind.
      clock.set(0)
      return play()
    }
    if (t0 <= 0.01) return play()
    // Tape rewind: hold, rewind on `tape`, a short empty beat, then play (STYLE.md §5).
    const { hold, duration: rd, empty } = S.rewind
    const total = hold + rd + empty
    setMode("rewinding")
    ctl.current = animate(clock, [t0, t0, 0, 0], {
      duration: total,
      times: [0, hold / total, (hold + rd) / total, 1],
      ease: ["linear", TAPE, "linear"],
      onUpdate: () => {
        const v = Math.abs(clock.getVelocity())
        const norm = t0 > 0 ? (v * rd) / t0 : 0
        setBlur(+(S.rewind.blur * Math.min(1, norm / 2.75)).toFixed(2))
      },
      onComplete: () => {
        setBlur(0)
        ctl.current = undefined
        playRef.current()
      },
    })
  }, [tl, clock, opts.reduced, play])
  const playRef = useRef(play)
  playRef.current = play
  const replayRef = useRef(replay)
  replayRef.current = replay

  const toggle = useCallback(() => {
    if (modeRef.current === "playing" || modeRef.current === "rewinding") pause()
    else if (modeRef.current === "ended") replay()
    else play()
  }, [pause, play, replay])

  // Reduced motion steps between settled step states instead of step starts.
  const marks = useMemo(() => (tl ? (opts.reduced ? steppedSchedule(tl).map((x) => x.t) : [...tl.steps.map((s) => s.t0), duration]) : []), [tl, duration, opts.reduced])
  const chapters = useMemo(() => {
    if (!tl) return []
    if (!opts.reduced) return [0, ...tl.steps.filter((s) => s.stop).map((s) => s.t0), duration]
    const sched = steppedSchedule(tl)
    return [sched[0].t, ...tl.steps.flatMap((s, i) => (s.stop ? [sched[i].t] : [])), duration]
  }, [tl, duration, opts.reduced])
  const step = useCallback(
    (dir: 1 | -1, useChapters = false) => {
      const list = useChapters && chapters.length > 2 ? chapters : marks
      const now = clock.get()
      const target = dir > 0 ? list.find((x) => x > now + 0.02) ?? duration : [...list].reverse().find((x) => x < now - 0.02) ?? 0
      seek(target)
    },
    [marks, chapters, clock, duration, seek],
  )
  const ungate = useCallback(() => {
    if (modeRef.current !== "gate") return
    clock.set(0)
    play()
  }, [clock, play])

  // Initial state from the hash, after hydration (SSR rendered the final frame).
  useEffect(() => {
    if (!tl || opts.still) return
    if (opts.t !== undefined) {
      seek(opts.t === "end" ? duration : Number(opts.t) || 0)
      return
    }
    if (opts.reduced) {
      // Final frame with a static play affordance; autoplay is ignored.
      clock.set(duration)
      setMode("gate")
      return
    }
    if (opts.autoplay ?? tl.autoplay) {
      clock.set(0)
      setMode("paused")
      // Play when scrolled into view (once).
      const el = opts.stage.current
      if (!el || typeof IntersectionObserver === "undefined") return play()
      const io = new IntersectionObserver((es) => {
        if (es.some((e) => e.isIntersecting) && !started.current) {
          io.disconnect()
          playRef.current()
        }
      })
      io.observe(el)
      return () => io.disconnect()
    }
    clock.set(0)
    setMode("gate")
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tl, opts.still, opts.t, opts.autoplay])

  // Switching motion mode mid-playback continues from the current step in the new mode.
  const firstReduced = useRef(true)
  useEffect(() => {
    if (firstReduced.current) {
      firstReduced.current = false
      return
    }
    if (!tl || opts.still) return
    if (modeRef.current === "playing" || modeRef.current === "rewinding") {
      if (opts.reduced) clock.set(steppedTime(tl, clock.get()))
      playRef.current()
    } else if (opts.reduced && modeRef.current === "paused") clock.set(steppedTime(tl, clock.get()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.reduced])

  // Pause off-screen or in a hidden tab; resume only if it was playing.
  useEffect(() => {
    if (!tl || opts.still) return
    const el = opts.stage.current
    const away = () => {
      if (modeRef.current === "playing") {
        resumeOnReturn.current = true
        stop()
        setMode("paused")
      }
    }
    const back = () => {
      if (resumeOnReturn.current) {
        resumeOnReturn.current = false
        playRef.current()
      }
    }
    const onVis = () => (document.hidden ? away() : back())
    document.addEventListener("visibilitychange", onVis)
    let io: IntersectionObserver | undefined
    if (el && typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver((es) => (es.some((e) => e.isIntersecting) ? back() : away()))
      io.observe(el)
    }
    const onPrint = () => seek(duration)
    addEventListener("beforeprint", onPrint)
    return () => {
      document.removeEventListener("visibilitychange", onVis)
      io?.disconnect()
      removeEventListener("beforeprint", onPrint)
    }
  }, [tl, opts.still, opts.stage, seek, duration])

  // Ended → settled (content dims after `read`).
  useEffect(() => {
    if (mode !== "ended" || !started.current) return
    const id = setTimeout(() => setSettled(true), S.beats.read * 1000)
    return () => clearTimeout(id)
  }, [mode])

  const frame = useMemo(() => storyState(scene, tl, t, { reduced: opts.reduced, stepped: opts.reduced }), [scene, tl, t, opts.reduced])
  const frameAt = useCallback((x: number) => storyState(scene, tl, x, { reduced: opts.reduced, stepped: opts.reduced }), [scene, tl, opts.reduced])
  if (!tl) return undefined
  const dim = mode === "gate" ? (opts.reduced ? 1 : S.gateDim) : mode === "ended" && settled ? S.endedDim : 1
  return { t, frame, mode, dim, blur, reduced: opts.reduced, play, pause, toggle, seek, replay, step, ungate, frameAt }
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}.${Math.floor((s % 1) * 10)}`

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="3 2 19 20" aria-hidden="true">
      <path d="M6 4 20 12 6 20Z" fill="currentColor" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  )
}
function PauseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3.5" y="2.5" width="3" height="11" fill="currentColor" />
      <rect x="9.5" y="2.5" width="3" height="11" fill="currentColor" />
    </svg>
  )
}
function ReplayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 5.5A5.2 5.2 0 1 1 2.8 9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M3 2.2v3.6h3.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** The click-to-play gate (STYLE.md §6): dimmed t = 0 frame, centred play triangle, idle rings. */
export function Gate({ onPlay, still = false }: { onPlay: () => void; still?: boolean }): ReactElement {
  return (
    <button
      type="button"
      className={`si-gate${still ? " si-gate-still" : ""}`}
      aria-label="Play animation"
      onClick={(e) => {
        e.stopPropagation()
        onPlay()
      }}
    >
      <span className="si-gate-disc" />
      {still ? null : (
        <>
          <span className="si-gate-ring" />
          <span className="si-gate-ring si-gate-ring-2" />
        </>
      )}
      <span className="si-gate-play">
        <svg viewBox="3 2 19 20" aria-hidden="true">
          <path d="M6 4 20 12 6 20Z" fill="currentColor" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
        </svg>
      </span>
    </button>
  )
}

/** Play/pause, replay, scrubber with step and chapter ticks. */
export function Transport({ c, tl }: { c: StoryControls; tl: Timeline }): ReactElement {
  const bar = useRef<HTMLDivElement>(null)
  const scrubAt = (clientX: number) => {
    const el = bar.current
    if (!el) return
    const r = el.getBoundingClientRect()
    c.seek(((clientX - r.left) / r.width) * tl.duration)
  }
  const playing = c.mode === "playing" || c.mode === "rewinding"
  const pct = (x: number) => `${((x / tl.duration) * 100).toFixed(3)}%`
  return (
    <div className={`si-transport${c.mode === "ended" ? " si-ended" : ""}`} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      {c.mode !== "ended" ? (
        <button type="button" className="si-tbtn" aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause (space)" : "Play (space)"} onClick={c.toggle}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
      ) : null}
      <button type="button" className="si-tbtn si-replay" aria-label="Replay" title="Replay (R)" onClick={c.replay}>
        <ReplayIcon />
      </button>
      <div
        className="si-scrub"
        ref={bar}
        role="slider"
        aria-label="Scene time"
        aria-valuemin={0}
        aria-valuemax={+tl.duration.toFixed(2)}
        aria-valuenow={+c.t.toFixed(2)}
        tabIndex={0}
        onPointerDown={(e) => {
          ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
          scrubAt(e.clientX)
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) scrubAt(e.clientX)
        }}
      >
        <div className="si-scrub-track" />
        <div className="si-scrub-fill" style={{ width: pct(c.t) }} />
        {tl.steps.map((s) => (
          <span key={s.id} className={`si-tick${s.stop ? " si-tick-stop" : ""}`} style={{ left: pct(s.t0) }} title={s.label}>
            {s.stop ? <span className="si-tick-label">{s.stop}</span> : null}
          </span>
        ))}
        <div className="si-scrub-head" style={{ left: pct(c.t) }} />
      </div>
      <span className="si-time">
        {fmt(c.t)} / {fmt(tl.duration)}
      </span>
    </div>
  )
}

/** Caption slot: current line (words stagger in) and the superseded line dimmed. */
export function Captions({ frame }: { frame?: Frame }): ReactElement {
  return (
    <div className="si-captions" aria-live="polite">
      {(frame?.captions ?? []).map((c, i) => (
        <p key={`${c.text}-${i}`} className="si-caption" style={c.o < 1 ? { opacity: c.o } : undefined}>
          {c.text.split(/\s+/).map((w, k) => {
            const p = c.words[k] ?? 1
            return (
              <span key={k} className="si-word" style={p < 1 ? { opacity: p, transform: `scale(${(0.95 + 0.05 * p).toFixed(3)})` } : undefined}>
                {w}{" "}
              </span>
            )
          })}
        </p>
      ))}
    </div>
  )
}

/** `#sheet=beats`: one labelled tile per step plus the final frame. */
export function BeatSheet({ scene, tl, cols, range }: { scene: Scene; tl: Timeline; cols?: number; range?: [number, number] }): ReactElement {
  const all = beatTimes(tl)
  const [r0, r1] = range ?? [0, all.length - 1]
  const beats = all.slice(r0, r1 + 1)
  return (
    <div
      className={`si-beats${cols && cols >= 4 ? " si-beats-compact" : ""}`}
      style={{ gridTemplateColumns: cols ? `repeat(${cols}, minmax(0, 1fr))` : `repeat(auto-fill, minmax(${beatTileMin(scene.viewBox.w)}px, 1fr))` }}
    >
      {beats.map((b, j) => {
        const i = j + r0
        const fr = storyState(scene, tl, b.t)
        const cap = beatCaption(tl, fr, b)
        return (
          <figure key={b.id} className="si-beat">
            <figcaption className="si-beat-cap">
              <span className="si-beat-n">{b.id !== "end" ? String(i + 1).padStart(2, "0") : "END"}</span> {b.label}
              <span className="si-beat-t">{b.t.toFixed(2)}s</span>
            </figcaption>
            <Diagram scene={scene} frame={fr} copy={`beat${i}`} />
            <p className="si-beat-caption">{cap ?? " "}</p>
          </figure>
        )
      })}
    </div>
  )
}
