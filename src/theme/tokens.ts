/**
 * All design tokens live here. Everything visual (palette, type, geometry,
 * motion) is read from this module and exported to CSS variables, so a
 * finished style spec can be applied by editing values only.
 *
 * Status: aligned with kit-style/STYLE.md (palette §1, type §2, geometry §3, wires §4).
 * Earlier status: PROVISIONAL. Values follow the known facts about the "OpenCode
 * Reloaded" look (warm ink-on-paper, muted step inks, double-rule panels,
 * thin wires with small port dots, bounce-free springs). They are a
 * reimplementation; nothing is copied from the original site.
 */

export type ThemeName = "light" | "dark"

export const ACCENTS = ["rose", "blue", "gold", "sage", "plain"] as const
export type Accent = (typeof ACCENTS)[number]

export interface Palette {
  /** Page background. */
  bg: string
  /** Panel (node) face. */
  panel: string
  /** Header band / inset face. */
  panelAlt: string
  /** Hairline for panels. */
  line: string
  /** Inner rule of double-rule panels. */
  lineSoft: string
  /** Primary ink (labels). */
  ink: string
  /** Secondary ink (details, captions). */
  inkMuted: string
  /** Tertiary ink (tags, faint marks). */
  inkFaint: string
  /** Wire stroke. */
  wire: string
  /** Port dot fill. */
  port: string
  /** Edge-label pill face. */
  pill: string
  /** Group container face and rule. */
  group: string
  groupLine: string
  /** Title ink. */
  title: string
  /** Toolbar chrome. */
  chrome: string
  chromeLine: string
  /** Accents: `<name>` is the ink, `<name>Fill` a soft face. */
  rose: string
  roseFill: string
  blue: string
  blueFill: string
  gold: string
  goldFill: string
  sage: string
  sageFill: string
  plain: string
  plainFill: string
}

export const palettes: Record<ThemeName, Palette> = {
  // Values from kit-style/STYLE.md §1 (bg, panelHeader, panelBorder, rule, text, label, faint, wire, port, accents).
  light: {
    bg: "#e8e7e3",
    panel: "#e6e5e1",
    panelAlt: "#ecebe7",
    line: "#b7b5ad",
    lineSoft: "#cfcdc6",
    ink: "#3d3a34",
    inkMuted: "#6b675f",
    inkFaint: "#a39d91",
    wire: "#a9a79f",
    port: "#a39d91",
    pill: "#e8e7e3",
    group: "#e3e2de",
    groupLine: "#cfcdc6",
    title: "#1c1a17",
    chrome: "#ecebe7",
    chromeLine: "#cfcdc6",
    rose: "#c98f81",
    roseFill: "#d9d3c7",
    blue: "#7fa2bf",
    blueFill: "#d9d3c7",
    gold: "#bfa95a",
    goldFill: "#d9d3c7",
    sage: "#5f7a4f",
    sageFill: "#d9d3c7",
    plain: "#8a857c",
    plainFill: "#d9d3c7",
  },
  dark: {
    bg: "#080807",
    panel: "#0b0b0a",
    panelAlt: "#131313",
    line: "#383838",
    lineSoft: "#292929",
    ink: "#cccccc",
    inkMuted: "#aaaaaa",
    inkFaint: "#6e6b65",
    wire: "#444444",
    port: "#5a5a5a",
    pill: "#080807",
    group: "#0d0d0c",
    groupLine: "#292929",
    title: "#e7e5e4",
    chrome: "#131313",
    chromeLine: "#292929",
    rose: "#e1b8ad",
    roseFill: "#35332f",
    blue: "#aec8df",
    blueFill: "#35332f",
    gold: "#e2d29f",
    goldFill: "#35332f",
    sage: "#9aaf8c",
    sageFill: "#35332f",
    plain: "#858585",
    plainFill: "#35332f",
  },
}

/** Base step inks from the source look (reference values). */
export const stepInks = {
  light: ["#b88f85", "#819eb8", "#b8a571"],
  dark: ["#503a35", "#324652", "#4d452e"],
  paper: ["#d4cbbd", "#c8c2b8"],
} as const

export const fonts = {
  mono: `"Commit Mono", ui-monospace, "SF Mono", Menlo, monospace`,
  serif: `"Iowan Old Style", "Charter", "Georgia", serif`,
  /** Commit Mono advance width: 600 units per 1000 em. */
  monoAdvance: 0.6,
}

export const type = {
  label: 13,
  detail: 11,
  tag: 9.5,
  tagTracking: 0.08,
  edgeLabel: 10,
  groupLabel: 10,
  lineHeight: 1.45,
  title: 30,
  subtitle: 15,
}

export const geometry = {
  // STYLE.md §4: use 12 for every bend.
  elbowRadius: 12,
  cornerRadius: 12,
  portRadius: 3.5,
  stub: 14,
  // STYLE.md §3: corners 0 everywhere.
  panelRadius: 0,
  panelInset: 4,
  groupRadius: 0,
  groupPad: 22,
  groupLabelBand: 22,
  nodePadX: 16,
  nodePadY: 11,
  nodeMinWidth: 128,
  maxLabelChars: 26,
  wireWidth: 1,
  /** STYLE.md §4: graphs show direction by pulses (Phase 2), not arrowheads. Sequences keep heads. */
  graphArrowheads: false,
  panelStroke: 1,
  arrowSize: 6,
  pillPadX: 6,
  pillPadY: 3,
  layerGap: 64,
  nodeGap: 36,
  groupGap: 28,
  margin: 32,
}

export const motion = {
  spring: { type: "spring", visualDuration: 0.3, bounce: 0 } as const,
  press: { scale: 0.94 },
  hover: { scale: 1.04 },
}

/** CSS custom property name for a palette key. */
export const cssVar = (key: keyof Palette): string => `--si-${key}`
/** `var(--si-key)` reference. */
export const v = (key: keyof Palette): string => `var(${cssVar(key)})`

export function paletteCss(theme: ThemeName): string {
  const p = palettes[theme]
  return (Object.keys(p) as (keyof Palette)[]).map((k) => `${cssVar(k)}:${p[k]};`).join("")
}

/**
 * CSS for both themes. `scope` is the selector that carries the variables.
 * With `fixed`, only that theme is emitted (no media query).
 */
export function themeCss(scope: string, fixed?: ThemeName): string {
  if (fixed) return `${scope}{${paletteCss(fixed)}color-scheme:${fixed};}`
  // Custom properties inherit, so the nearest `[data-theme]` ancestor wins.
  return [
    `${scope}{${paletteCss("light")}color-scheme:light;}`,
    `@media (prefers-color-scheme: dark){${scope}{${paletteCss("dark")}color-scheme:dark;}}`,
    `${scope}[data-theme="light"],${scope} [data-theme="light"]{${paletteCss("light")}color-scheme:light;}`,
    `${scope}[data-theme="dark"],${scope} [data-theme="dark"]{${paletteCss("dark")}color-scheme:dark;}`,
  ].join("\n")
}
