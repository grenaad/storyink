import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export interface Browser {
  path: string
  /** "headless-shell" runs headless natively; "chrome" needs --headless=new. */
  flavor: "headless-shell" | "chrome"
  source: "env" | "playwright" | "system"
  version?: string
}

function newestPlaywrightShell(): string | undefined {
  const caches = [
    path.join(os.homedir(), "Library/Caches/ms-playwright"),
    path.join(os.homedir(), ".cache/ms-playwright"),
    process.env.PLAYWRIGHT_BROWSERS_PATH ?? "",
  ].filter(Boolean)
  const found: { rev: number; file: string }[] = []
  for (const dir of caches) {
    let entries: string[] = []
    try {
      entries = fs.readdirSync(dir)
    } catch {
      continue
    }
    for (const e of entries) {
      const m = /^chromium_headless_shell-(\d+)$/.exec(e)
      if (!m) continue
      const base = path.join(dir, e)
      let subs: string[] = []
      try {
        subs = fs.readdirSync(base).filter((s) => s.startsWith("chrome-headless-shell-"))
      } catch {}
      for (const s of subs) {
        const bin = path.join(base, s, process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell")
        if (fs.existsSync(bin)) found.push({ rev: Number(m[1]), file: bin })
      }
    }
  }
  found.sort((a, b) => b.rev - a.rev)
  return found[0]?.file
}

const SYSTEM = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
]

export function browserVersion(bin: string): string | undefined {
  try {
    return execFileSync(bin, ["--version"], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim()
  } catch {
    return undefined
  }
}

/** Discovery order: $STORYINK_CHROME, newest Playwright headless shell, system Chrome. */
export function findBrowser(env: NodeJS.ProcessEnv = process.env): Browser | undefined {
  const fromEnv = env.STORYINK_CHROME
  if (fromEnv && fs.existsSync(fromEnv))
    return { path: fromEnv, flavor: /headless[-_]shell/.test(fromEnv) ? "headless-shell" : "chrome", source: "env" }
  const pw = newestPlaywrightShell()
  if (pw) return { path: pw, flavor: "headless-shell", source: "playwright" }
  for (const p of SYSTEM) if (fs.existsSync(p)) return { path: p, flavor: "chrome", source: "system" }
  return undefined
}
