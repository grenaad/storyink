import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import plugin from "../src/index.ts"

function mockCtx(dir: string, existingSkill = false) {
  const tools: any[] = []
  const namespaces: any[] = []
  const skills: any[] = existingSkill ? [{ id: "storyink", name: "mine" }] : []
  const ctx = {
    location: { directory: dir },
    tool: {
      transform: async (cb: (e: any) => void) => {
        cb({ namespace: (n: any) => namespaces.push(n), add: (t: any) => tools.push(t), list: () => tools, get: () => undefined, update() {}, remove() {} })
        return { dispose: async () => {} }
      },
    },
    skill: {
      transform: async (cb: (e: any) => void) => {
        cb({ list: () => skills, get: (id: string) => skills.find((s) => s.id === id), add: (s: any) => skills.push(s), update() {}, remove() {} })
        return { dispose: async () => {} }
      },
    },
  }
  return { ctx, tools, namespaces, skills }
}

const context = () => ({ signal: new AbortController().signal, progress: async () => {}, sessionID: "s", agent: "a", messageID: "m", id: "c" })

describe("plugin package shape (OpenCode loader)", () => {
  const root = path.join(import.meta.dir, "..")
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
  test("local directory entry: <dir>/server resolves", () => {
    // OpenCode resolves `<dir>/server` then `<dir>/index` for local directories; package.json main is ignored.
    expect(fs.existsSync(path.join(root, "server.js"))).toBe(true)
    expect(fs.readFileSync(path.join(root, "server.js"), "utf8")).toContain("./dist/index.js")
  })
  test("package entry: exports ./server and . point at the plugin", () => {
    expect(pkg.exports["./server"].import).toBe("./dist/index.js")
    expect(pkg.exports["."].import).toBe("./dist/index.js")
    expect(pkg.files).toContain("server.js")
  })
  test("default export shape", () => {
    expect(typeof plugin.id).toBe("string")
    expect(typeof plugin.setup).toBe("function")
  })
})

describe("plugin", () => {
  test("registers namespace, tools and skill", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storyink-plugin-"))
    const m = mockCtx(dir)
    expect(plugin.id).toBe("storyink")
    await plugin.setup(m.ctx as any)
    expect(m.namespaces[0].name).toBe("storyink")
    expect(m.tools.map((t) => t.name).sort()).toEqual(["from_mermaid", "render", "snapshot", "validate"])
    for (const t of m.tools) {
      expect(t.options.namespace).toBe("storyink")
      expect(t.input.type).toBe("object")
    }
    const skill = m.skills.find((s) => s.id === "storyink")
    expect(path.isAbsolute(skill.path)).toBe(true)
    expect(skill.content).toContain("storyink")
  })

  test("user skill definitions win", async () => {
    const m = mockCtx(os.tmpdir(), true)
    await plugin.setup(m.ctx as any)
    expect(m.skills.length).toBe(1)
    expect(m.skills[0].name).toBe("mine")
  })

  test("render writes files relative to the location directory", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storyink-plugin-"))
    const m = mockCtx(dir)
    await plugin.setup(m.ctx as any)
    const render = m.tools.find((t) => t.name === "render")
    const res = await render.execute({ mermaid: "flowchart LR\n A[One] --> B[Two]", output: "out/d.html", svg: "out/d.svg" }, context())
    expect(res.metadata.ok).toBe(true)
    expect(fs.existsSync(path.join(dir, "out/d.html"))).toBe(true)
    expect(fs.statSync(path.join(dir, "out/d.svg")).size).toBeGreaterThan(1000)
    const bad = await render.execute({ spec: { type: "workflow", title: "x", nodes: [{ id: "a", kind: "nope" }] }, output: "bad.html" }, context())
    expect(bad.metadata.ok).toBe(false)
    expect(fs.existsSync(path.join(dir, "bad.html"))).toBe(false)
    const validateTool = m.tools.find((t) => t.name === "validate")
    const v = await validateTool.execute({ spec: '{"type":"sequence"}' }, context())
    expect(v.metadata.ok).toBe(false)
  })
})
