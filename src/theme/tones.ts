/**
 * Tones: one vocabulary for "what this is" colours, shared by pages (`sp-tone-*`) and diagrams
 * (story `tone`, toned pulses / glows, caption emphasis). One source of truth for which palette
 * colour each tone uses; diagrams derive a tint (the tone mixed into the node face) from it.
 */
import { deltaPalettes, palettes, pagePalettes, type ThemeName } from "./tokens.ts"

export const TONES = ["neutral", "note", "good", "warn", "risk"] as const
export type Tone = (typeof TONES)[number]

/**
 * Where each tone's ink and fill come from: the base palette (`--si-*`), the delta palette
 * (`--si-delta*`) or the page palette (`--sp-*`). Pages use ink + fill; diagrams use the ink and
 * a derived tint.
 */
export const TONE_SOURCE: Record<Tone, { ink: [Src, string]; fill: [Src, string] }> = {
  neutral: { ink: ["base", "inkMuted"], fill: ["base", "panelAlt"] },
  note: { ink: ["page", "note"], fill: ["page", "noteFill"] },
  good: { ink: ["delta", "deltaAdded"], fill: ["delta", "deltaAddedFill"] },
  warn: { ink: ["delta", "deltaModified"], fill: ["delta", "deltaModifiedFill"] },
  risk: { ink: ["delta", "deltaRemoved"], fill: ["delta", "deltaRemovedFill"] },
}
type Src = "base" | "delta" | "page"

/** CSS reference for a tone source (`var(--si-k)` / `var(--sp-k)`). */
export const toneRef = ([src, k]: [Src, string]): string => (src === "page" ? `var(--sp-${k})` : `var(--si-${k})`)

const lit = (theme: ThemeName, [src, k]: [Src, string]): string =>
  ((src === "base" ? palettes[theme] : src === "delta" ? deltaPalettes[theme] : pagePalettes[theme]) as unknown as Record<string, string>)[k]

/** Share of the tone ink mixed into the node face for a toned node's fill. */
export const TINT = { light: 0.16, dark: 0.2 } as const

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))
const mix = (a: string, b: string, w: number) =>
  `#${hex(a)
    .map((x, i) => Math.round(x * (1 - w) + hex(b)[i] * w).toString(16).padStart(2, "0"))
    .join("")}`

/** The tone ink (literal colour) in a theme. */
export const toneInk = (theme: ThemeName, tone: Tone): string => lit(theme, TONE_SOURCE[tone].ink)
/** The tone tint: the ink mixed into the node face (literal colour). */
export const toneTint = (theme: ThemeName, tone: Tone): string => mix(palettes[theme].panel, toneInk(theme, tone), TINT[theme])

/** Diagram palette keys of a tone (`--si-toneNote`, `--si-toneNoteTint`). */
export const toneKey = (tone: Tone): `tone${string}` => `tone${tone[0].toUpperCase()}${tone.slice(1)}`

export interface TonePalette {
  [key: string]: string
}

/** Diagram tone palette (ink + tint per tone); emitted only for scenes that use tones. */
export function tonePalette(theme: ThemeName): TonePalette {
  const out: TonePalette = {}
  for (const t of TONES) {
    out[toneKey(t)] = toneInk(theme, t)
    out[`${toneKey(t)}Tint`] = toneTint(theme, t)
  }
  return out
}

export const isTone = (x: unknown): x is Tone => typeof x === "string" && (TONES as readonly string[]).includes(x)
