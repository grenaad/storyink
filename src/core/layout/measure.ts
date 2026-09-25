import { fonts } from "../../theme/tokens.ts"

/** Exact width of monospace (Commit Mono) text: advance × character count. */
export function textWidth(s: string, size: number, tracking = 0): number {
  const n = Array.from(s).length
  return n * size * (fonts.monoAdvance + tracking)
}

/** Greedy word wrap to at most `max` characters per line. Long words are hard-split. */
export function wrap(s: string, max: number): string[] {
  const words = s.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ""
  for (let w of words) {
    while (Array.from(w).length > max) {
      if (cur) {
        lines.push(cur)
        cur = ""
      }
      const chars = Array.from(w)
      lines.push(chars.slice(0, max).join(""))
      w = chars.slice(max).join("")
    }
    if (!cur) cur = w
    else if (Array.from(cur).length + 1 + Array.from(w).length <= max) cur += ` ${w}`
    else {
      lines.push(cur)
      cur = w
    }
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : [""]
}

/** Round up to a multiple of `q` to keep geometry on a tidy grid. */
export const snap = (n: number, q = 2): number => Math.ceil(n / q) * q
export const r2 = (n: number): number => Math.round(n * 100) / 100
