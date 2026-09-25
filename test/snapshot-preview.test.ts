import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import plugin, { snapshotResult } from "../src/plugin.ts"
import { findBrowser } from "../src/node/chrome.ts"
import { largeSpec } from "./fixtures/large.ts"

/** Width/height of a JPEG (SOFn) or PNG (IHDR). */
export function imageSize(buf: Buffer): { w: number; h: number } {
  if (buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
  let i = 2
  while (i < buf.length) {
    if (buf[i] !== 0xff) throw new Error("bad jpeg")
    const marker = buf[i + 1]
    const len = buf.readUInt16BE(i + 2)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }
    i += 2 + len
  }
  throw new Error("no SOF")
}

const fakeReceipt = (n: number) => ({
  html: "/x.html",
  browser: { path: "/chrome", flavor: "headless-shell", source: "env" },
  flags: [],
  captures: [{ theme: "light", at: "end", png: "/x.light.png", sha256: "", bytes: 1, width: 1440, height: 900, ms: 1 }],
  beats: [{ theme: "beats", png: "/x.beats.light.png", sha256: "", bytes: 1, width: 1440, height: 6000, ms: 1 }],
  previews: Array.from({ length: n }, (_, k) => ({ path: "", width: 1024, height: 800, bytes: 1000, shows: `part ${k + 1}` })),
  gates: [{ name: "deterministic", pass: true, detail: "ok" }],
  ok: true,
  createdAt: "",
})

describe("snapshot tool result shape", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storyink-prev-"))
  const jpg = path.join(dir, "p.jpg")
  fs.writeFileSync(jpg, Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
  const rc = (n: number) => {
    const r = fakeReceipt(n) as never as import("../src/node/index.ts").SnapshotReceipt
    for (const p of r.previews!) p.path = jpg
    return r
  }
  test("one image by default, full-res paths in text only", () => {
    const res = snapshotResult(rc(3), "/r.json", 0, "overview")
    const files = res.content.filter((c) => c.type === "file")
    expect(files.length).toBe(1)
    expect((files[0] as { mime: string }).mime).toBe("image/jpeg")
    const text = (res.content[0] as { text: string }).text
    expect(text).toContain("/x.beats.light.png (1440×6000)")
    expect(text).toContain("Full-resolution PNGs")
  })
  test("full: at most 3 parts; none: no image", () => {
    expect(snapshotResult(rc(5), "/r.json", 0, "full").content.filter((c) => c.type === "file").length).toBe(3)
    const none = snapshotResult(rc(1), "/r.json", 0, "none")
    expect(none.content.filter((c) => c.type === "file").length).toBe(0)
    expect((none.content[0] as { text: string }).text).toContain('image: "none"')
  })
})

const browser = findBrowser()
describe.skipIf(!browser)("regression: large many-beat story through the plugin tool", () => {
  test(
    "returns one ≤1024 px, ≤300 KB image; full-res files stay on disk",
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storyink-large-"))
      const tools: any[] = []
      await plugin.setup({
        location: { directory: dir },
        tool: { transform: async (cb: any) => cb({ namespace() {}, add: (t: any) => tools.push(t), list: () => tools, get() {}, update() {}, remove() {} }) },
        skill: { transform: async (cb: any) => cb({ list: () => [], get: () => undefined, add() {}, update() {}, remove() {} }) },
      } as never)
      const ctx = { signal: new AbortController().signal, progress: async () => {}, sessionID: "s", agent: "a", messageID: "m", id: "c" }
      const render = tools.find((t) => t.name === "render")
      const snap = tools.find((t) => t.name === "snapshot")
      const r = await render.execute({ spec: largeSpec(), output: "large.html" }, ctx)
      expect(r.metadata.ok).toBe(true)
      const res = await snap.execute({ html: "large.html", sheet: "beats", themes: ["light"] }, ctx)
      const files = res.content.filter((c: any) => c.type === "file")
      expect(files.length).toBe(1)
      const buf = Buffer.from(files[0].uri.split(",")[1], "base64")
      const { w, h } = imageSize(buf)
      expect(Math.max(w, h)).toBeLessThanOrEqual(1024)
      expect(buf.length).toBeLessThanOrEqual(300 * 1024)
      const text = res.content[0].text as string
      const full = [...text.matchAll(/(\/\S+\.png) \(/g)].map((m) => m[1])
      expect(full.length).toBeGreaterThan(0)
      for (const f of full) expect(fs.existsSync(f)).toBe(true)
      const beats = full.find((f) => f.includes(".beats."))!
      const fb = imageSize(fs.readFileSync(beats))
      console.log(`full beats ${fb.w}×${fb.h} ${(fs.statSync(beats).size / 1024).toFixed(0)} KiB → preview ${w}×${h} ${(buf.length / 1024).toFixed(0)} KiB`)
      const none = await snap.execute({ html: "large.html", sheet: "beats", themes: ["light"], image: "none" }, ctx)
      expect(none.content.filter((c: any) => c.type === "file").length).toBe(0)
      if (process.env.STORYINK_KEEP) fs.cpSync(dir, process.env.STORYINK_KEEP, { recursive: true })
    },
    { timeout: 240_000 },
  )
})
