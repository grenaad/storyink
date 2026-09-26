// Minimal CDP driver: wall-clock screenshots of a page (or an element) at several moments.
import { spawn } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { findBrowser } from "../src/node/index.ts"

/**
 * Every Chrome this module starts. Each runs in its own process group (detached) and is killed:
 * by `close()` / `finally`; on process exit, SIGINT, SIGTERM, SIGHUP and uncaught errors; and by a
 * detached watchdog shell if this process dies uncatchably (SIGKILL, tool timeout) or after
 * `MAX_LIFETIME_S`, so no headless Chrome outlives a verify run.
 */
const live = new Map<number, string>()
const MAX_LIFETIME_S = 20 * 60
function killGroup(pid: number) {
  try {
    process.kill(-pid, "SIGKILL")
  } catch {}
  const dir = live.get(pid)
  live.delete(pid)
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
}
export function killAll() {
  for (const pid of [...live.keys()]) killGroup(pid)
}
let hooked = false
function hookExit() {
  if (hooked) return
  hooked = true
  process.on("exit", killAll)
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
    process.on(sig, () => {
      killAll()
      process.exit(130)
    })
  process.on("uncaughtException", (e) => {
    killAll()
    console.error(e)
    process.exit(1)
  })
  process.on("unhandledRejection", (e) => {
    killAll()
    console.error(e)
    process.exit(1)
  })
}
/** Start headless Chrome in its own process group, registered for cleanup, with a watchdog. */
export function launch(args: string[]) {
  hookExit()
  const b = findBrowser()
  if (!b) throw new Error("no Chrome/Chromium found (set STORYINK_CHROME)")
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cdp-"))
  const port = 9300 + Math.floor(Math.random() * 500)
  const child = spawn(b.path, [...(b.flavor === "chrome" ? ["--headless=new"] : []), `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, "--hide-scrollbars", "--force-device-scale-factor=1", ...args, "about:blank"], { stdio: "ignore", detached: true })
  const pid = child.pid!
  live.set(pid, dir)
  child.on("exit", () => live.delete(pid))
  child.unref()
  // Watchdog: outlives us only to kill Chrome's group once we are gone (or after the cap).
  const wd = spawn("/bin/sh", ["-c", `i=0; while kill -0 ${process.pid} 2>/dev/null && kill -0 ${pid} 2>/dev/null && [ $i -lt ${MAX_LIFETIME_S} ]; do sleep 1; i=$((i+1)); done; kill -9 -${pid} 2>/dev/null; rm -rf "${dir}"`], { stdio: "ignore", detached: true })
  wd.unref()
  return { pid, port, dir, kill: () => killGroup(pid) }
}
/** One CDP call; rejects after 30 s so a dead Chrome fails the run instead of hanging it. */
function rpc(ws: WebSocket, pending: Map<number, (v: any) => void>, i: number, method: string, params: any) {
  return new Promise<any>((r, j) => {
    const timer = setTimeout(() => {
      pending.delete(i)
      j(new Error(`CDP ${method} timed out`))
    }, 30_000)
    pending.set(i, (v) => {
      clearTimeout(timer)
      r(v)
    })
    ws.send(JSON.stringify({ id: i, method, params }))
  })
}
async function connect(port: number) {
  let list: any
  for (let i = 0; i < 50; i++) {
    try {
      list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      if (list.length) break
    } catch {}
    await Bun.sleep(100)
  }
  const page = list?.find((x: any) => x.type === "page")
  if (!page) throw new Error(`Chrome on port ${port} never exposed a page`)
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => {
    ws.onopen = r
    ws.onerror = j
  })
  return ws
}
export async function wallShots(url: string, opts: { width: number; height: number; selector?: string; waits: number[]; out: string; reducedMotion?: boolean; scrollTo?: string }) {
  const c = launch([...(opts.reducedMotion ? [] : ["--force-prefers-no-reduced-motion"]), `--window-size=${opts.width},${opts.height}`])
  try {
    const ws = await connect(c.port)
    let id = 0
    const pending = new Map<number, (v: any) => void>()
    ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id) } }
    const send = (method: string, params: any = {}) => rpc(ws, pending, ++id, method, params)
    await send("Page.enable")
    await send("Emulation.setDeviceMetricsOverride", { width: opts.width, height: opts.height, deviceScaleFactor: 1, mobile: false })
    await send("Page.navigate", { url })
    const t0 = Date.now()
    await Bun.sleep(1500)
    if (opts.scrollTo) await send("Runtime.evaluate", { expression: `(()=>{const e=document.querySelector(${JSON.stringify(opts.scrollTo)});if(e)e.scrollIntoView({block:"start"});})()` })
    const info: any[] = []
    for (const [k, w] of opts.waits.entries()) {
      const wait = w * 1000 - (Date.now() - t0)
      if (wait > 0) await Bun.sleep(wait)
      let clip: any
      if (opts.selector) {
        const r = await send("Runtime.evaluate", { expression: `(()=>{const e=document.querySelector(${JSON.stringify(opts.selector)});if(!e)return null;const b=e.getBoundingClientRect();return JSON.stringify({x:b.x+scrollX,y:b.y+scrollY,width:b.width,height:b.height,src:e.currentSrc||e.src||""})})()`, returnByValue: true })
        const v = r.result?.result?.value
        if (v) { const o = JSON.parse(v); info.push(o); clip = { x: o.x, y: o.y, width: Math.max(1, o.width), height: Math.max(1, o.height), scale: 1 } }
      }
      const shot = await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip, captureBeyondViewport: true } : {}) })
      const file = `${opts.out}.${k}.png`
      fs.writeFileSync(file, Buffer.from(shot.result.data, "base64"))
    }
    ws.close()
    return info
  } finally {
    c.kill()
  }
}
export async function session(flags: string[], size = { width: 1600, height: 900 }) {
  const c = launch([...flags, `--window-size=${size.width},${size.height}`])
  let ws: WebSocket
  try {
    ws = await connect(c.port)
  } catch (e) {
    c.kill()
    throw e
  }
  let id = 0
  const pending = new Map<number, (v: any) => void>()
  ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id) } }
  const send = (method: string, params: any = {}) => rpc(ws, pending, ++id, method, params)
  await send("Page.enable")
  await send("Emulation.setDeviceMetricsOverride", { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: false })
  const ev = async (expr: string) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value
  return {
    send, ev,
    async go(url: string) { await send("Page.navigate", { url }); await Bun.sleep(1200) },
    async shot(file: string) { const s = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(file, Buffer.from(s.result.data, "base64")) },
    /** On-screen centre of the first element matching `selector` (null if absent or zero-size). */
    async center(selector: string): Promise<{ x: number; y: number } | null> {
      const v = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const b=e.getBoundingClientRect();if(!b.width||!b.height)return null;return JSON.stringify({x:b.x+b.width/2,y:b.y+b.height/2})})()`)
      return v ? JSON.parse(v) : null
    },
    /** Real mouse input (Input.dispatchMouseEvent), not element.click(). */
    async mouse(type: "mouseMoved" | "mousePressed" | "mouseReleased", x: number, y: number, buttons = type === "mouseReleased" ? 0 : type === "mousePressed" ? 1 : 0) {
      await send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" && !buttons ? "none" : "left", buttons, clickCount: type === "mouseMoved" ? 0 : 1 })
    },
    /** Move, press and release at an element's centre (or at a point). */
    async click(target: string | { x: number; y: number }) {
      const p = typeof target === "string" ? await this.center(target) : target
      if (!p) throw new Error(`click: no element ${String(target)}`)
      await this.mouse("mouseMoved", p.x, p.y)
      await this.mouse("mousePressed", p.x, p.y)
      await this.mouse("mouseReleased", p.x, p.y)
      return p
    },
    /** Press at `a`, move in steps to `b`, release. */
    async drag(a: { x: number; y: number }, b: { x: number; y: number }, steps = 8) {
      await this.mouse("mouseMoved", a.x, a.y)
      await this.mouse("mousePressed", a.x, a.y)
      for (let i = 1; i <= steps; i++) await this.mouse("mouseMoved", a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps, 1)
      await this.mouse("mouseReleased", b.x, b.y)
    },
    /** Real key press (Input.dispatchKeyEvent). `shift` sets the Shift modifier. */
    async key(k: string, code = k, shift = false) {
      const vk: Record<string, number> = { ArrowLeft: 37, ArrowRight: 39, " ": 32 }
      for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: k, code, modifiers: shift ? 8 : 0, ...(vk[k] ? { windowsVirtualKeyCode: vk[k] } : {}), ...(k.length === 1 ? { text: type === "keyDown" ? k : undefined } : {}) })
    },
    close() {
      try {
        ws.close()
      } catch {}
      c.kill()
    },
  }
}
