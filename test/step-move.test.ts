import { describe, expect, test } from "bun:test"
import { STEP_MOVE, stepBoundary, stepMoveSpeed, stepMoveTarget } from "../src/core/index.ts"

const marks = [0.3, 1.2, 2.5, 4, 6] // step starts + duration
const D = 6

describe("step moves", () => {
  test("target boundaries", () => {
    expect(stepBoundary(marks, 1.8, 1, D)).toBe(2.5)
    expect(stepBoundary(marks, 1.8, -1, D)).toBe(1.2)
    // At a boundary: the next / previous one, never itself.
    expect(stepBoundary(marks, 2.5, 1, D)).toBe(4)
    expect(stepBoundary(marks, 2.5, -1, D)).toBe(1.2)
    // Past the ends.
    expect(stepBoundary(marks, 6, 1, D)).toBe(6)
    expect(stepBoundary(marks, 0.1, -1, D)).toBe(0)
  })
  test("repeated presses extend the target in the same direction", () => {
    let cur = { dir: 1 as const, target: stepMoveTarget(marks, 1.8, 1, D) }
    expect(cur.target).toBe(2.5)
    cur = { dir: 1, target: stepMoveTarget(marks, 1.9, 1, D, cur) }
    expect(cur.target).toBe(4)
    cur = { dir: 1, target: stepMoveTarget(marks, 2.0, 1, D, cur) }
    expect(cur.target).toBe(6)
    const back = { dir: -1 as const, target: stepMoveTarget(marks, 3.9, -1, D) }
    expect(back.target).toBe(2.5)
    expect(stepMoveTarget(marks, 3.5, -1, D, back)).toBe(1.2)
  })
  test("the opposite direction reverses toward the adjacent boundary", () => {
    // Moving forward from 1.8 to 4 (extended), now at 2.7: ← heads for 2.5, not 1.2.
    expect(stepMoveTarget(marks, 2.7, -1, D, { dir: 1, target: 4 })).toBe(2.5)
    expect(stepMoveTarget(marks, 2.7, 1, D, { dir: -1, target: 1.2 })).toBe(4)
  })
  test("speeds: forward 1×, backward 2× with a short ease that always arrives", () => {
    expect(stepMoveSpeed(1, 0, 0.01)).toBe(1)
    expect(stepMoveSpeed(-1, 1, 1)).toBe(STEP_MOVE.back)
    expect(stepMoveSpeed(-1, 0, 1)).toBeCloseTo(STEP_MOVE.back * STEP_MOVE.minSpeed)
    expect(stepMoveSpeed(-1, STEP_MOVE.ease / 2, 1)).toBeCloseTo(STEP_MOVE.back / 2)
    expect(stepMoveSpeed(-1, 1, 0)).toBeGreaterThan(0)
    // Simulate a rewind of 1.5 story seconds at 60 fps: lands in about 1.5/2 s plus the ease.
    let t = 3
    let el = 0
    while (t > 1.5 + 1e-6 && el < 5) {
      t = Math.max(1.5, t - stepMoveSpeed(-1, el, t - 1.5) / 60)
      el += 1 / 60
    }
    expect(el).toBeGreaterThan(0.75)
    expect(el).toBeLessThan(1.0)
  })
})
