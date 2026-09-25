/**
 * All design tokens live here. Everything visual (palette, type, geometry,
 * motion) is read from this module and exported to CSS variables, so a
 * finished style spec can be applied by editing values only.
 *
 * Status: PROVISIONAL. Values follow the known facts about the "OpenCode
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
  light: {
    bg: "#e8e5df",
    panel: "#eeebe6",
    panelAlt: "#e6e2dc",
    line: "#bdb7ad",
    lineSoft: "#d0cbc2",
    ink: "#3d3a35",
    inkMuted: "#6f695f",
    inkFaint: "#9a9388",
    wire: "#a39d92",
    port: "#8f897e",
    pill: "#e8e5df",
    group: "#e3dfd8",
    groupLine: "#c8c2b8",
    title: "#2f2c28",
    chrome: "#eeebe6",
    chromeLine: "#c8c2b8",
    rose: "#a47a70",
    roseFill: "#e2d4cf",
    blue: "#6d8aa4",
    blueFill: "#d5dbe0",
    gold: "#9c8a55",
    goldFill: "#e0d9c3",
    sage: "#7d9277",
    sageFill: "#d7ddd2",
    plain: "#8a8479",
    plainFill: "#d4cbbd",
  },
  dark: {
    bg: "#0d0c0b",
    panel: "#141312",
    panelAlt: "#191817",
    line: "#3a3733",
    lineSoft: "#262421",
    ink: "#d6d1c9",
    inkMuted: "#948d83",
    inkFaint: "#645e56",
    wire: "#55514b",
    port: "#77726a",
    pill: "#0d0c0b",
    group: "#111010",
    groupLine: "#2c2a27",
    title: "#e4dfd7",
    chrome: "#141312",
    chromeLine: "#2c2a27",
    rose: "#c49a8f",
    roseFill: "#503a35",
    blue: "#90abc2",
    blueFill: "#324652",
    gold: "#c2b07c",
    goldFill: "#4d452e",
    sage: "#9cb296",
    sageFill: "#34422f",
    plain: "#a39c91",
    plainFill: "#2e2b28",
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
  edgeLabel: 11,
  groupLabel: 10,
  lineHeight: 1.45,
  title: 30,
  subtitle: 15,
}

export const geometry = {
  elbowRadius: 18,
  cornerRadius: 12,
  portRadius: 3.5,
  stub: 14,
  panelRadius: 2,
  panelInset: 4,
  groupRadius: 3,
  groupPad: 22,
  groupLabelBand: 22,
  nodePadX: 16,
  nodePadY: 11,
  nodeMinWidth: 128,
  maxLabelChars: 26,
  wireWidth: 1.15,
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
