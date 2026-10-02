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
  /** Flood-glow alpha multiplier and blend (light: warm light on paper via screen). */
  glowGain: string
  glowBlend: string
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
    // Light theme: warm light on paper (a screen-blended warm tint), not an ink darkening.
    glow: "#f3d9b6",
    glowCrest: "#fffaf0",
    glowGain: "3",
    glowBlend: "screen",
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
    glowGain: "1",
    glowBlend: "normal",
    flash: "#f3dfc6",
    portActive: "#f0f0f0",
    playInk: "#5e5b54",
    playInkHover: "#a8a49b",
    control: "#737373",
    controlHover: "#d4cec4",
    endedInk: "#9a9488",
  },
}

/**
 * Palette additions for rich nodes (panel / code / chip). Kept apart from `Palette` and only
 * emitted when a scene uses them, so pre-0.4 diagrams render byte-identically.
 * Code colours: GitHub dark / GitHub light.
 */
export interface RichPalette {
  codeKw: string
  codeStr: string
  codeConst: string
  codeFn: string
  codeParam: string
  codeCom: string
  /** Active-line bar and its 2px leading edge. */
  codeBar: string
  codeBarEdge: string
  /** Running-row shimmer highlight. */
  shimmer: string
  /** Row status glyphs. */
  statusDone: string
  statusError: string
}

export const richPalettes: Record<ThemeName, RichPalette> = {
  light: {
    codeKw: "#d73a49",
    codeStr: "#032f62",
    codeConst: "#005cc5",
    codeFn: "#6f42c1",
    codeParam: "#e36209",
    codeCom: "#6a737d",
    codeBar: "#dcdad4",
    codeBarEdge: "#8a857c",
    shimmer: "#141311",
    statusDone: "#5f7a4f",
    statusError: "#b0574a",
  },
  dark: {
    codeKw: "#f97583",
    codeStr: "#9ecbff",
    codeConst: "#79b8ff",
    codeFn: "#b392f0",
    codeParam: "#ffab70",
    codeCom: "#6a737d",
    codeBar: "#1b1b1a",
    codeBarEdge: "#6e6b65",
    shimmer: "#ffffff",
    statusDone: "#9aaf8c",
    statusError: "#e1887a",
  },
}

/**
 * Palette additions for change diagrams (`delta` / `emphasis` / `stat`): sage = added,
 * gold = modified, rose = removed. Only emitted when a scene uses them (byte-identical otherwise).
 * `<delta>` is the ink (badge text, accents, wires), `<delta>Fill` the badge face.
 */
export interface DeltaPalette {
  deltaAdded: string
  deltaAddedFill: string
  deltaModified: string
  deltaModifiedFill: string
  deltaRemoved: string
  deltaRemovedFill: string
  /** Hero edge stroke when the edge has no delta of its own. */
  deltaHero: string
  /** Diff code nodes: added / removed row tints and their intra-line marks (opaque, on the panel face). */
  diffAddBg: string
  diffAddMark: string
  diffDelBg: string
  diffDelMark: string
}

export const deltaPalettes: Record<ThemeName, DeltaPalette> = {
  light: {
    deltaAdded: "#55703f",
    deltaAddedFill: "#d6dccb",
    deltaModified: "#8a7426",
    deltaModifiedFill: "#e2dbc0",
    deltaRemoved: "#a65a4b",
    deltaRemovedFill: "#e4d3cc",
    deltaHero: "#3d3a34",
    diffAddBg: "#d6dece",
    diffAddMark: "#bccdac",
    diffDelBg: "#ead6d0",
    diffDelMark: "#dfb8ad",
  },
  dark: {
    deltaAdded: "#9fb98e",
    deltaAddedFill: "#1d2619",
    deltaModified: "#e2d29f",
    deltaModifiedFill: "#2b2717",
    deltaRemoved: "#e3a597",
    deltaRemovedFill: "#2f1d19",
    deltaHero: "#d8d4cc",
    diffAddBg: "#16211a",
    diffAddMark: "#26392a",
    diffDelBg: "#261614",
    diffDelMark: "#43241f",
  },
}

/**
 * Page additions (`type: "page"`): the note / context tone (the delta palette carries good = sage,
 * warn = gold, risk = rose) and page surfaces. Emitted only by page HTML as `--sp-*` variables.
 */
export interface PagePalette {
  note: string
  noteFill: string
  /** Raised surface (cards, KPI tiles, callouts). */
  raised: string
  /** Figure / table / code surface. */
  sunken: string
  /** Link ink. */
  link: string
}

export const pagePalettes: Record<ThemeName, PagePalette> = {
  light: { note: "#4a6a86", noteFill: "#d7dcdf", raised: "#eeede9", sunken: "#e4e3df", link: "#3f5f7c" },
  dark: { note: "#aec8df", noteFill: "#18202a", raised: "#10100f", sunken: "#0c0c0b", link: "#aec8df" },
}

/** Page layout and type (px unless noted). */
export const page = {
  /** Prose measure (ch of the serif body). */
  measure: 68,
  /** Content column max width (figures / tables / diffs break out to it). */
  wide: 1080,
  /** TOC column width and the viewport it appears at. */
  tocW: 196,
  tocMin: 1180,
  body: 17,
  lead: 20,
  h1: 40,
  h2: 26,
  h3: 19,
}

/** Change-diagram geometry and levels. */
export const delta = {
  /** Removed elements: ghost level. */
  ghost: 0.55,
  /** Unchanged elements: receded context level. */
  context: 0.82,
  /** `emphasis: "muted"` edges / messages. */
  mutedEdge: 0.35,
  /** Hero edge stroke and its soft glow underlay. */
  heroWidth: 2.2,
  heroGlow: 8,
  heroGlowOpacity: 0.16,
  /** Added sequence messages draw a little heavier. */
  addedMessageWidth: 1.6,
  /** Badge pill: font size, height, horizontal padding, inset from the node edge. */
  badgeFont: 9,
  badgeH: 14,
  badgePadX: 5,
  badgeInset: 6,
  /** `stat` text ("+38 −12"). */
  statFont: 10,
  /** Legend band above the diagram. */
  legendH: 26,
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
  /** Rich nodes: panel rows, code, header strip title. */
  row: 13,
  code: 13,
  header: 10,
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
  // Rich nodes (panel / code / chip).
  headerH: 36,
  panelPadX: 16,
  panelPadY: 14,
  rowLH: 20,
  /** Gap between top-level rows; an indented row sits `rowGapChild` under its parent, siblings touch. */
  rowGap: 12,
  rowGapChild: 4,
  tagH: 20,
  iconW: 18,
  statusW: 22,
  codeLH: 22,
  codePadX: 18,
  chipH: 44,
  chipMinW: 120,
  chipPadX: 14,
  stackStep: 5,
  rowCols: 40,
  /** Rest opacity of muted / dimmed elements. */
  muted: 0.42,
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
  /**
   * Reading hold after each beat in continuous play (and each stepped stop): time to read what the
   * beat did before the next one starts. ~200 wpm plus a second to look; bare beats get `bare`.
   * Scaled by `story.pace`.
   */
  hold: { base: 1, perWord: 0.3, min: 1.5, max: 6, bare: 0.8, pace: 0.6 },
  /** Warn when the authored story (without reading holds) runs longer than this. */
  warnTotal: 60,
}

export const motion = {
  spring: { type: "spring", visualDuration: 0.3, bounce: 0 } as const,
  press: { scale: 0.94 },
  hover: { scale: 1.04 },
}

/** CSS custom property name for a palette key. */
export const cssVar = (key: keyof Palette | keyof RichPalette | keyof DeltaPalette): string => `--si-${key}`
/** `var(--si-key)` reference. */
export const v = (key: keyof Palette | keyof RichPalette | keyof DeltaPalette): string => `var(${cssVar(key)})`

/** Custom properties for a theme; `rich` adds the rich-node palette, `changes` the delta palette. */
export function paletteCss(theme: ThemeName, rich = false, changes = false): string {
  const p: Record<string, string> = { ...palettes[theme], ...(rich ? richPalettes[theme] : {}), ...(changes ? deltaPalettes[theme] : {}) }
  return Object.keys(p).map((k) => `${cssVar(k as keyof Palette)}:${p[k]};`).join("")
}

/**
 * CSS for both themes. `scope` is the selector that carries the variables.
 * With `fixed`, only that theme is emitted (no media query).
 */
export function themeCss(scope: string, fixed?: ThemeName, rich = false, changes = false): string {
  if (fixed) return `${scope}{${paletteCss(fixed, rich, changes)}color-scheme:${fixed};}`
  // Custom properties inherit, so the nearest `[data-theme]` ancestor wins.
  return [
    `${scope}{${paletteCss("light", rich, changes)}color-scheme:light;}`,
    `@media (prefers-color-scheme: dark){${scope}{${paletteCss("dark", rich, changes)}color-scheme:dark;}}`,
    `${scope}[data-theme="light"],${scope} [data-theme="light"]{${paletteCss("light", rich, changes)}color-scheme:light;}`,
    `${scope}[data-theme="dark"],${scope} [data-theme="dark"]{${paletteCss("dark", rich, changes)}color-scheme:dark;}`,
  ].join("\n")
}
