import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import { CAMERA, cameraAt, deadZoneRect, fitCamera, fitIsReadable, followStep, inView, parseHash, readableScale, stepAt, stepFocus, toScene, toScreen, type Box, type Viewport } from "../src/core/index.ts"
import { largeSpec } from "./fixtures/large.ts"
import { validate } from "../src/core/index.ts"
import { resolveFollow } from "../src/core/render/App.tsx"

const example = (f: string) => toScene(JSON.parse(fs.readFileSync(`examples/${f}`, "utf8")))
const large = toScene(largeSpec())
const wide = toScene(largeSpec("LR"))
const contains = (outer: Box, inner: Box, e = 1) => inner.x >= outer.x - e && inner.y >= outer.y - e && inner.x + inner.w <= outer.x + outer.w + e && inner.y + inner.h <= outer.y + outer.h + e
const screen = (vp: Viewport): Box => ({ x: 0, y: 0, w: vp.w, h: vp.h - (vp.bottom ?? 0) })

describe("stepFocus", () => {
  test("covers what each step animates", () => {
    const tl = large.timeline!
    // Step 0 reveals the five edge-tier nodes.
    const f0 = stepFocus(large, tl, 0)!
    for (const id of ["n0", "n1", "n2", "n3", "n4"]) {
      const n = large.nodes.find((x) => x.id === id)!
      expect(contains(f0, n)).toBe(true)
    }
    // Pulse steps cover their route and the target node, padded.
    tl.steps.slice(1).forEach((_, j) => {
      const i = j + 1
      const f = stepFocus(large, tl, i)!
      const p = tl.pulses.find((x) => x.id.startsWith(`pulse-${i}-`))!
      for (const pt of p.points) expect(contains(f, { x: pt.x, y: pt.y, w: 0, h: 0 })).toBe(true)
      const target = large.nodes.find((n) => n.id === p.target)!
      expect(contains(f, target)).toBe(true)
      // Local: much smaller than the diagram.
      expect(f.w * f.h).toBeLessThan(large.viewBox.w * large.viewBox.h * 0.25)
    })
  })
  test("every example step with diagram events has a focus inside the padded viewBox", () => {
    for (const f of ["checkout.architecture.json", "oauth.sequence.json", "release.workflow.json", "analytics.dataflow.json", "agent-run.lifecycle.json"]) {
      const s = example(f)
      const tl = s.timeline
      if (!tl) continue
      const vb = s.viewBox
      let some = 0
      tl.steps.forEach((_, i) => {
        const b = stepFocus(s, tl, i)
        if (!b) return
        some++
        expect(contains({ x: vb.x - CAMERA.focusPad, y: vb.y - CAMERA.focusPad, w: vb.w + 2 * CAMERA.focusPad, h: vb.h + 2 * CAMERA.focusPad }, b)).toBe(true)
      })
      expect(some).toBeGreaterThan(0)
    }
  })
  test("out of range → undefined", () => {
    expect(stepFocus(large, large.timeline!, 999)).toBeUndefined()
  })
})

describe("readable scale", () => {
  test("small diagrams stay at fit; big ones zoom to ~12.5 px labels", () => {
    const s = example("checkout.architecture.json")
    const vp = { w: 1700, h: 900, bottom: 56 }
    expect(fitIsReadable(s.viewBox, vp)).toBe(true)
    expect(readableScale(s.viewBox, vp)).toBe(fitCamera(s.viewBox, vp).k)
    const vp2 = { w: 1280, h: 720, bottom: 56 }
    expect(fitIsReadable(large.viewBox, vp2)).toBe(false)
    const k = readableScale(large.viewBox, vp2)
    expect(k * CAMERA.label).toBeGreaterThanOrEqual(12)
    expect(k * CAMERA.label).toBeLessThanOrEqual(13)
    expect(k).toBeLessThanOrEqual(CAMERA.maxK)
  })
  test("tiny viewport: capped", () => {
    expect(readableScale({ x: 0, y: 0, w: 20000, h: 20000 }, { w: 300, h: 300 })).toBeLessThanOrEqual(CAMERA.maxK)
  })
})

describe("dead zone", () => {
  const vb = { x: 0, y: 0, w: 2000, h: 2000 }
  const vp = { w: 1000, h: 800 }
  const cam = { k: 1, x: 0, y: 0 }
  test("inside the inner 80 %: no move", () => {
    const f = { x: 400, y: 300, w: 200, h: 200 }
    expect(inView(cam, vb, vp, f)).toBe(true)
    expect(followStep(cam, vb, vp, f)).toBe(cam)
  })
  test("leaving it: centre on the focus at the same scale", () => {
    const f = { x: 950, y: 300, w: 100, h: 100 }
    expect(inView(cam, vb, vp, f)).toBe(false)
    const c = followStep(cam, vb, vp, f)
    expect(c.k).toBe(1)
    const s = toScreen(c, vb, f)
    expect(Math.abs(s.x + s.w / 2 - 500)).toBeLessThan(1)
    expect(inView(c, vb, vp, f)).toBe(true)
  })
  test("focus larger than the zone: zoom out just enough", () => {
    const f = { x: 0, y: 0, w: 1500, h: 400 }
    const c = followStep({ k: 1, x: 0, y: 0 }, vb, vp, f)
    // Just enough: the zone-fit scale, snapped down to a 1/64 step.
    expect(c.k).toBeLessThanOrEqual(deadZoneRect(vp).w / 1500)
    expect(c.k).toBeGreaterThan(deadZoneRect(vp).w / 1500 - 1 / 64)
    // At the diagram edge the clamp wins over centring; the focus stays fully on screen.
    expect(contains(screen(vp), toScreen(c, vb, f))).toBe(true)
    const mid = followStep({ k: 1, x: 0, y: 0 }, vb, vp, { x: 250, y: 800, w: 1500, h: 400 })
    expect(inView(mid, vb, vp, { x: 250, y: 800, w: 1500, h: 400 })).toBe(true)
  })
  test("clamped: never pans past the diagram edge into empty page", () => {
    const c = followStep({ k: 1, x: -900, y: -900 }, vb, vp, { x: 0, y: 0, w: 60, h: 60 })
    expect(c.x).toBeLessThanOrEqual(CAMERA.edge)
    expect(c.y).toBeLessThanOrEqual(CAMERA.edge)
  })
})

describe("cameraAt (the pure follow camera)", () => {
  for (const [name, s, vp] of [["TB", large, { w: 1280, h: 720, bottom: 56 }], ["LR", wide, { w: 900, h: 560, bottom: 56 }]] as const) {
    test(`${name}: at several t the followed viewport contains the step's focus`, () => {
      const tl = s.timeline!
      const k = readableScale(s.viewBox, vp)
      const seen = new Set<string>()
      for (let i = 0; i < tl.steps.length; i++) {
        const t = (tl.steps[i].t0 + tl.steps[i].t1) / 2
        const cam = cameraAt(s, tl, t, vp)
        expect(stepAt(tl, t)).toBe(i)
        const f = stepFocus(s, tl, i)
        if (f) expect(contains(screen(vp), toScreen(cam, s.viewBox, f), 2)).toBe(true)
        // Keeps the readable zoom unless a focus is too big for the zone.
        expect(cam.k).toBeLessThanOrEqual(k + 1e-9)
        seen.add(`${cam.x},${cam.y}`)
      }
      // The camera travels: several distinct regions over the story.
      expect(seen.size).toBeGreaterThanOrEqual(3)
      // The end is fit.
      expect(cameraAt(s, tl, tl.duration, vp)).toEqual(fitCamera(s.viewBox, vp))
      // Deterministic.
      expect(cameraAt(s, tl, 3.3, vp)).toEqual(cameraAt(s, tl, 3.3, vp))
    })
  }
  test("readable fit: the camera stays at fit throughout", () => {
    const s = example("checkout.architecture.json")
    const tl = s.timeline!
    const vp = { w: 1700, h: 900, bottom: 56 }
    const fit = fitCamera(s.viewBox, vp)
    for (const st of tl.steps) expect(cameraAt(s, tl, st.t0 + 0.1, vp).k).toBe(fit.k)
  })
  test("#camera= hash", () => {
    expect(parseHash("#camera=follow").camera).toBe("follow")
    expect(parseHash("#camera=fit").camera).toBe("fit")
    expect(parseHash("#camera=nope").camera).toBeUndefined()
  })
})

describe("story.camera", () => {
  test("validated and compiled onto the timeline", () => {
    const spec = { ...largeSpec(), story: { ...largeSpec().story, camera: "fit" } }
    expect(toScene(spec).timeline!.camera).toBe("fit")
    expect(toScene(largeSpec()).timeline!.camera).toBeUndefined()
    const bad = validate({ ...largeSpec(), story: { ...largeSpec().story, camera: "zoom" } })
    expect(bad.ok).toBe(false)
    expect(bad.diagnostics.some((d) => d.path === "story.camera")).toBe(true)
  })
  test("resolveFollow precedence: hash > stored > author", () => {
    expect(resolveFollow({})).toBe(true)
    expect(resolveFollow({ author: "fit" })).toBe(false)
    expect(resolveFollow({ author: "fit", stored: "on" })).toBe(true)
    expect(resolveFollow({ stored: "on", hash: "fit" })).toBe(false)
  })
})
