// Minimal CDP driver: wall-clock screenshots of a page (or an element) at several moments.
import { spawn } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { findBrowser } from "../src/node/index.ts"
export async function wallShots(url: string, opts: { width: number; height: number; selector?: string; waits: number[]; out: string; reducedMotion?: boolean; scrollTo?: string }) {
  const b = findBrowser()!
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cdp-"))
  const port = 9300 + Math.floor(Math.random() * 500)
  const child = spawn(b.path, [...(b.flavor === "chrome" ? ["--headless=new"] : []), `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, "--hide-scrollbars", "--force-device-scale-factor=1", ...(opts.reducedMotion ? [] : ["--force-prefers-no-reduced-motion"]), `--window-size=${opts.width},${opts.height}`, "about:blank"], { stdio: "ignore", detached: true })
  try {
    let list: any
    for (let i = 0; i < 50; i++) {
      try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (list.length) break } catch {}
      await Bun.sleep(100)
    }
    const page = list.find((x: any) => x.type === "page")
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((r) => (ws.onopen = r))
    let id = 0
    const pending = new Map<number, (v: any) => void>()
    ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id) } }
    const send = (method: string, params: any = {}) => new Promise<any>((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
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
    try { process.kill(-child.pid!, "SIGKILL") } catch {}
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
export async function session(flags: string[], size = { width: 1600, height: 900 }) {
  const b = findBrowser()!
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cdp-"))
  const port = 9300 + Math.floor(Math.random() * 500)
  const child = spawn(b.path, [...(b.flavor === "chrome" ? ["--headless=new"] : []), `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, "--hide-scrollbars", "--force-device-scale-factor=1", ...flags, `--window-size=${size.width},${size.height}`, "about:blank"], { stdio: "ignore", detached: true })
  let list: any
  for (let i = 0; i < 50; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (list.length) break } catch {} ; await Bun.sleep(100) }
  const ws = new WebSocket(list.find((x: any) => x.type === "page").webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let id = 0
  const pending = new Map<number, (v: any) => void>()
  ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id) } }
  const send = (method: string, params: any = {}) => new Promise<any>((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
  await send("Page.enable")
  await send("Emulation.setDeviceMetricsOverride", { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: false })
  const ev = async (expr: string) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value
  return {
    send, ev,
    async go(url: string) { await send("Page.navigate", { url }); await Bun.sleep(1200) },
    async shot(file: string) { const s = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(file, Buffer.from(s.result.data, "base64")) },
    async key(k: string, code = k) { for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: k, code, ...(k.length === 1 ? { text: type === "keyDown" ? k : undefined } : {}) }) },
    close() { ws.close(); try { process.kill(-child.pid!, "SIGKILL") } catch {}; fs.rmSync(dir, { recursive: true, force: true }) },
  }
}
