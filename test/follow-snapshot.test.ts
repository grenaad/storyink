import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { cameraAt, stepAt, stepFocus, toScene, toScreen } from "../src/core/index.ts"
import { findBrowser } from "../src/node/chrome.ts"
import { snapshot, writeDiagram } from "../src/node/index.ts"
import { validate } from "../src/core/index.ts"

/** A real layout: OpenWick's architecture diagram (24 nodes, 42 steps), where 0.3.2's follow captures flaked. */
const spec = JSON.parse(fs.readFileSync(path.join(import.meta.dir, "fixtures/openwick-architecture.json"), "utf8"))
const browser = findBrowser()

describe("follow camera on a real layout", () => {
  test("cameraAt: whole pixels, 1/64 scales, focus on screen", () => {
    const s = toScene(spec)
    const tl = s.timeline!
    const vp = { w: 1280, h: 550 }
    for (const t of [2, 6, 15, 30]) {
      const c = cameraAt(s, tl, t, vp)
      expect(Number.isInteger(c.x) && Number.isInteger(c.y)).toBe(true)
      expect(Number.isInteger(c.k * 64)).toBe(true)
      const f = stepFocus(s, tl, stepAt(tl, t))
      if (f) {
        const b = toScreen(c, s.viewBox, f)
        expect(b.x >= -1 && b.y >= -1 && b.x + b.w <= vp.w + 1 && b.y + b.h <= vp.h + 1).toBe(true)
      }
    }
  })
  test.skipIf(!browser)(
    "snapshot --camera follow: follow-deterministic at t=2,6,15,30",
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storyink-follow-"))
      try {
        const html = path.join(dir, "arch.html")
        writeDiagram(validate(spec).spec!, { html })
        const r = await snapshot(html, { themes: ["light"], sheet: false, camera: "follow", at: [2, 6, 15, 30], outDir: dir })
        const g = r.receipt!.gates.find((x) => x.name === "follow-deterministic")!
        expect(g.detail).toContain("identical")
        expect(g.pass).toBe(true)
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    },
    120_000,
  )
})
