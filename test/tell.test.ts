import { describe, expect, test } from "bun:test"
import { toScene } from "../src/core/index.ts"
import { moveTime, storyBeats } from "../src/core/render/App.tsx"
import { beatStops } from "../src/core/story/state.ts"
import { activeStep, SCROLLY_TRIGGER } from "../src/viewer/tell.ts"
import { loadSpec } from "../src/node/index.ts"

const tl = toScene(loadSpec("examples/checkout.architecture.json").spec).timeline!

describe("moveTo targets", () => {
  test("beats are the settled stops, without the final frame", () => {
    const b = storyBeats(tl)
    expect(b).toEqual(beatStops(tl).slice(0, -1))
    expect(b.length).toBeGreaterThan(2)
    expect([...b].sort((x, y) => x - y)).toEqual(b)
  })
  test("beat −1 = start, beat k = its stop, past the last = end, t clamps", () => {
    const b = storyBeats(tl)
    expect(moveTime(tl, { beat: -1 })).toBe(0)
    expect(moveTime(tl, { beat: 0 })).toBe(b[0])
    expect(moveTime(tl, { beat: b.length - 1 })).toBe(b[b.length - 1])
    expect(moveTime(tl, { beat: b.length })).toBe(tl.duration)
    expect(moveTime(tl, { beat: Number.NaN })).toBe(0)
    expect(moveTime(tl, { t: 3.5 })).toBe(3.5)
    expect(moveTime(tl, { t: -2 })).toBe(0)
    expect(moveTime(tl, { t: 1e9 })).toBe(tl.duration)
  })
})

describe("scrolly trigger line", () => {
  test("the active step is the last whose top crossed the trigger line", () => {
    const h = 800
    const y = h * SCROLLY_TRIGGER
    expect(activeStep([y + 1, y + 600], h)).toBe(-1)
    expect(activeStep([y, y + 600], h)).toBe(0)
    expect(activeStep([-900, y - 1, y + 1], h)).toBe(1)
    expect(activeStep([-1800, -900, 0], h)).toBe(2)
  })
})
