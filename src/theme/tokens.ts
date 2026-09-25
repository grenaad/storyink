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
  /** Storyboard (STYLE.md §1, §4, §6). */
  pulse: string
  pulseBloom: string
  pulseBloomEdge: string
  glow: string
  glowCrest: string
  flash: string
  portActive: string
  playInk: string
  playInkHover: string
  control: string
  controlHover: string
  endedInk: string
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
    pulse: "#2b2925",
    pulseBloom: "#3d3a34",
    pulseBloomEdge: "#8a857c",
    glow: "#a39d91",
    glowCrest: "#2b2925",
    flash: "#141311",
    portActive: "#141311",
    playInk: "#a39e94",
    playInkHover: "#5e5b54",
    control: "#8f8a81",
    controlHover: "#26251f",
    endedInk: "#6f6a61",
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
    pulse: "#ddd8d0",
    pulseBloom: "#e8e4dc",
    pulseBloomEdge: "#9a948c",
    glow: "#8c8882",
    glowCrest: "#ece9e4",
    flash: "#f3dfc6",
    portActive: "#f0f0f0",
    playInk: "#5e5b54",
    playInkHover: "#a8a49b",
    control: "#737373",
    controlHover: "#d4cec4",
    endedInk: "#9a9488",
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
  counter: 15,
  detail: 11,
  tag: 10,
  tagTracking: 0.08,
  edgeLabel: 11,
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
  groupPad: 18,
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
  layerGap: 56,
  nodeGap: 28,
  groupGap: 24,
  margin: 32,
}

/** Storyboard timing (STYLE.md §5). All in seconds of scene time. */
export const story = {
  beats: { react: 0.3, step: 0.8, settle: 1.2, read: 1 },
  springs: { react: 0.3, smooth: 0.45, word: 0.16 },
  pulse: { gather: 0.34, flight: 0.9, flightMin: 0.45, flightMax: 1.6, pxPerSecond: 520, ring: 0.72, cooling: 1.1, dot: 4, halo: 18 },
  glow: { duration: 1.2, alpha: 0.28, minGap: 1 / 3 },
  flash: { decay: 1.6 },
  reveal: { rise: 6, opacityDelay: 0.075 },
  dimSuperseded: 0.52,
  endHold: 1.5,
  endedDim: 0.75,
  gateDim: 0.55,
  rewind: { hold: 0.15, duration: 1.25, empty: 0.4, blur: 1.1 },
  read: { base: 0.25, perWord: 0.075, min: 1, max: 3 },
  warnTotal: 60,
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
