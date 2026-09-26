import { createRollingNumber, type RollingNumberController } from "@kitlangton/rolling-number"
import type { Scene } from "../core/scene.ts"
import { counterValue } from "../core/story/state.ts"
import type { Frame } from "../core/story/types.ts"

/**
 * Live counters. While the story plays, each SVG counter is covered by a
 * @kitlangton/rolling-number reel that rolls to the target of the latest
 * counter step (its own interruptible 500 ms roll: Kit's feel). Whenever the
 * clock is paused, seeked, scrubbed, exported or snapshotted, the reels are
 * hidden and the SVG text shows the exact clock value from `storyState`, so
 * any `t` renders deterministically.
 */
export function createCounterOverlay(scene: Scene) {
  const tl = scene.timeline
  const ids = tl ? Object.keys(tl.counters) : []
  let mounted = false
  let live = false
  const reels = new Map<string, { ctl: RollingNumberController; el: HTMLElement; target: number; node: string }>()

  const mount = () => {
    if (mounted || !tl || !ids.length) return
    const fig = document.querySelector<HTMLElement>(".si-stage .si-figure")
    const host = fig?.querySelector<HTMLElement>(".si-counters")
    const svg = fig?.querySelector<SVGSVGElement>("svg.storyink")
    if (!fig || !host || !svg) return
    mounted = true
    const vb = scene.viewBox
    for (const id of ids) {
      const ts = svg.querySelector<SVGTSpanElement>(`.si-counter-value[data-counter="${CSS.escape(id)}"]`)
      if (!ts) continue
      const b = ts.getBBox()
      const c = tl.counters[id]
      const el = document.createElement("span")
      el.className = "si-counter-live"
      // getBBox is in the node group's local space: add the node's position.
      const n = scene.nodes.find((x) => x.id === c.node)
      el.style.left = `${(n?.x ?? 0) + b.x - vb.x}px`
      el.style.top = `${(n?.y ?? 0) + b.y - vb.y + 1}px`
      el.style.display = "none"
      const pre = document.createElement("span")
      pre.textContent = c.prefix ?? ""
      const num = document.createElement("span")
      const suf = document.createElement("span")
      suf.textContent = c.suffix ?? ""
      el.append(pre, num, suf)
      host.append(el)
      const ctl = createRollingNumber(num, {
        value: c.start,
        locales: "en-US",
        format: { minimumFractionDigits: c.decimals, maximumFractionDigits: c.decimals },
        duration: 500,
        pauseOffscreen: false,
      } as never)
      reels.set(id, { ctl, el, target: c.start, node: c.node })
    }
  }

  return {
    update(frame: Frame, playing: boolean) {
      if (!tl || !ids.length) return
      mount()
      const fig = document.querySelector<HTMLElement>(".si-stage .si-figure")
      if (playing !== live) {
        live = playing
        fig?.classList.toggle("si-live-counters", live)
        for (const [id, r] of reels) {
          r.el.style.display = live ? "" : "none"
          if (live) {
            // Resume from the exact clock value without a roll.
            const v = counterValue(tl.counters[id], frame.t)
            r.target = v
            r.ctl.update({ value: +v.toFixed(tl.counters[id].decimals), animated: false } as never)
            r.ctl.finish()
            r.ctl.update({ animated: true } as never)
          }
        }
      }
      if (!live) return
      for (const [id, r] of reels) {
        // Follow the node's reveal (opacity and rise).
        const v = frame.el[r.node]
        r.el.style.opacity = v && v.o < 1 ? String(v.o) : ""
        r.el.style.transform = v?.dy ? `translateY(${v.dy}px)` : ""
        const c = tl.counters[id]
        let target = c.start
        for (const e of c.events) if (frame.t >= e.t) target = e.to
        if (target !== r.target) {
          r.target = target
          r.ctl.update({ value: target })
        }
      }
    },
  }
}
