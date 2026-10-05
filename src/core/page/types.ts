/** Page specs (`type: "page"`): an explainer document of prose, data blocks and embedded diagrams. */
import type { DiffFile } from "../diff/types.ts"
import type { ChangeMeta, CodeLang, Delta, Spec } from "../spec.ts"

import type { Tone } from "../../theme/tones.ts"
export { TONES, type Tone } from "../../theme/tones.ts"
export const CALLOUT_TONES = ["note", "good", "warn", "risk"] as const
export type CalloutTone = (typeof CALLOUT_TONES)[number]
export const SEVERITIES = ["low", "medium", "high", "critical"] as const
export type Severity = (typeof SEVERITIES)[number]
export const CONFIDENCES = ["sourced", "inferred", "unknown"] as const
export type Confidence = (typeof CONFIDENCES)[number]
export const EVIDENCE_STATUSES = ["verified", "corrected", "unsupported", "unverifiable"] as const
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number]
export const FILE_STATUSES = ["added", "modified", "removed", "renamed", "copied"] as const
export const ALIGNS = ["left", "right", "center"] as const

/** Every block type key, in docs order. */
export const BLOCK_TYPES = ["prose", "figure", "kpis", "table", "cards", "callout", "filemap", "diff", "code", "risks", "decisions", "evidence", "timeline", "checklist", "details", "columns", "break", "scrolly"] as const
/** Slide content layouts (`auto` is inferred from the slide's blocks). */
export const SLIDE_LAYOUTS = ["auto", "center", "split", "full", "flow"] as const
export type SlideLayout = (typeof SLIDE_LAYOUTS)[number]
export const PAGE_LAYOUTS = ["article", "slides"] as const
export type BlockType = (typeof BLOCK_TYPES)[number]

export interface FigureBlock {
  /** A diagram spec; a string is a file path (resolved by the CLI / plugin before core). */
  spec: Spec | string
  /** Caption stating the figure's point (inline prose). */
  claim?: string
  /** Unique figure id (default fig-1, fig-2 … in page order). */
  id?: string
  /** Break out to the full content width. */
  wide?: boolean
  /** In slides, step through the figure's story beats (default true). */
  builds?: boolean
}
/** A scrolly step: `at` = story step id, chapter stop label, 1-based beat number, "start" or "end". */
export interface ScrollyStep {
  at: string | number
  title?: string
  body: string
  cites?: { text: string; ref: string }[]
}
export interface ScrollyBlock {
  /** Block id (default scrolly-1, scrolly-2 …). */
  id?: string
  figure: FigureBlock
  steps: "auto" | ScrollyStep[]
  /** Where the pinned figure sits (default "right"). */
  side?: "left" | "right"
}
export type BreakBlock = true | { title?: string; layout?: SlideLayout }
export interface Kpi {
  label: string
  value: string | number
  detail?: string
  tone?: Tone
}
export type Column = string | { label: string; align?: (typeof ALIGNS)[number] }
export type Cell = string | number | { text: string; tone?: Tone; badge?: boolean; code?: boolean }
export interface TableBlock {
  columns: Column[]
  rows: Cell[][]
  caption?: string
}
export interface Card {
  title: string
  body: string
  tag?: string
  tone?: Tone
  delta?: Delta
}
export interface CalloutBlock {
  tone: CalloutTone
  title?: string
  body: string
}
export interface MapFile {
  path: string
  status: (typeof FILE_STATUSES)[number]
  add?: number
  del?: number
  note?: string
}
export type FilemapBlock = "changes" | { files: MapFile[] } | { from: "changes"; notes?: Record<string, string> }
export type DiffBlock = { file: string; lines?: number | [number, number]; context?: number; max?: number } | { text: string; file?: string; lang?: CodeLang; max?: number }
export interface CodeBlock {
  code: string | string[]
  lang?: CodeLang
  file?: string
  start?: number
}
export interface RiskItem {
  risk: string
  severity: Severity
  area?: string
  mitigation?: string
  refs?: string[]
}
export interface DecisionItem {
  decision: string
  why?: string
  confidence: Confidence
  refs?: string[]
}
export interface EvidenceItem {
  claim: string
  source: string
  status?: EvidenceStatus
}
export interface TimelineItem {
  when: string
  title: string
  body?: string
  tone?: Tone
}
export interface ChecklistItem {
  text: string
  done?: boolean
  note?: string
}
export interface DetailsBlock {
  summary: string
  blocks: Block[]
}

/** A block: exactly one type key, plus an optional anchor `id`. */
export type Block = { id?: string } & (
  | { prose: string }
  | { figure: FigureBlock }
  | { kpis: Kpi[] }
  | { table: TableBlock }
  | { cards: Card[] }
  | { callout: CalloutBlock }
  | { filemap: FilemapBlock }
  | { diff: DiffBlock }
  | { code: CodeBlock }
  | { risks: RiskItem[] }
  | { decisions: DecisionItem[] }
  | { evidence: EvidenceItem[] }
  | { timeline: TimelineItem[] }
  | { checklist: ChecklistItem[] }
  | { details: DetailsBlock }
  | { columns: Block[][] }
  | { break: BreakBlock }
  | { scrolly: ScrollyBlock }
)

export interface Section {
  /** Anchor id (default: slug of the title, or section-N). */
  id?: string
  title: string
  eyebrow?: string
  /** Slide hint (present mode). */
  slide?: { layout?: SlideLayout }
  blocks: Block[]
}

/** Page-level embedded diff (written by resolvePageChanges / `--changes`). */
export interface PageChanges {
  base?: string
  head?: string
  title?: string
  stats?: { files: number; add: number; del: number }
  files: DiffFile[]
}

export interface PageSpec {
  $schema?: string
  type: "page"
  title: string
  eyebrow?: string
  subtitle?: string
  summary?: string
  change?: ChangeMeta
  /** Table of contents; default: shown when there are ≥ 4 sections. */
  toc?: boolean
  /** "article" (default) or "slides" (opens presenting; `#present=0` forces the article). */
  layout?: (typeof PAGE_LAYOUTS)[number]
  /** Allow presenting (Present button, P, `#present=1`); default true. */
  present?: boolean
  sections: Section[]
  changes?: PageChanges
}

/** A validated page: figure specs are validated diagram specs and every figure / section has an id. */
export interface ValidPage extends PageSpec {
  sections: (Section & { id: string })[]
}

export const isPageSpec = (x: unknown): x is PageSpec => typeof x === "object" && x !== null && !Array.isArray(x) && (x as { type?: unknown }).type === "page"

/** The single block type key of a block (undefined when malformed). */
export function blockType(b: unknown): BlockType | undefined {
  if (typeof b !== "object" || b === null) return undefined
  return BLOCK_TYPES.find((k) => k in (b as object))
}
