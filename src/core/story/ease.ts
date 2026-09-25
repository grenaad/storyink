/**
 * Easing curves over scene time. Springs are closed-form functions of elapsed
 * time (never free-running), so any frame can be computed from `t` alone.
 *
 * Motion's `{ visualDuration: vd, bounce: 0 }` maps to ω = 2π / (1.2·vd) and,
 * critically damped, p(t) = 1 − (1 + ωt)·e^(−ωt) (STYLE.md §5).
 */

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

/** Bounce-free spring progress after `dt` seconds, for visual duration `vd`. */
export function spring(dt: number, vd: number): number {
  if (dt <= 0) return 0
  const w = (2 * Math.PI) / (1.2 * vd)
  const p = 1 - (1 + w * dt) * Math.exp(-w * dt)
  return p > 0.9995 ? 1 : p
}

/** Seconds until a bounce-free spring is within 0.1% of rest. */
export function springSettle(vd: number): number {
  const w = (2 * Math.PI) / (1.2 * vd)
  // Solve (1 + wt)e^(-wt) = 0.001 ≈ wt ≈ 9.23
  return 9.23 / w
}

export const react = (dt: number) => spring(dt, 0.3)
export const smooth = (dt: number) => spring(dt, 0.45)

export const smoothstep = (x: number) => {
  const t = clamp01(x)
  return t * t * (3 - 2 * t)
}
export const easeOutCubic = (x: number) => 1 - Math.pow(1 - clamp01(x), 3)
export const inOutCubic = (x: number) => {
  const t = clamp01(x)
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/** CSS-style cubic-bezier(x1, y1, x2, y2) evaluated at x. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const bx = (t: number) => 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3
  const by = (t: number) => 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3
  return (x: number) => {
    const X = clamp01(x)
    let lo = 0
    let hi = 1
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2
      if (bx(mid) < X) lo = mid
      else hi = mid
    }
    return by((lo + hi) / 2)
  }
}

/** Rewind curve, `tape = cubic-bezier(.65,0,.25,1)` (STYLE.md §5). */
export const tape = cubicBezier(0.65, 0, 0.25, 1)

export { clamp01 }
