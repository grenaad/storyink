import type { Tone } from "../theme/tones.ts"
import type { Accent } from "../theme/tokens.ts"
import type { ArrowMode, ChangeMeta, ChangeStat, CodeLang, Delta, DiagramType, Direction, EdgeStyle, Emphasis, FileRef, FrameKind, IconName, MessageKind, RowStatus } from "./spec.ts"

/**
 * Change-diagram badge ("NEW" / "CHANGED" / "REMOVED") and stat ("+38 −12"), relative to the
 * node box. `right` = inset from the right edge (the badge's x is `w − right − w_badge`), or
 * `cx` = centred (diamonds). `text` is empty for a stat without a badge.
 */
export interface SceneBadge {
  text: string
  w: number
  h: number
  y: number
  right?: number
  cx?: number
  stat?: ChangeStat & { w: number }
}


export interface Pt {
  x: number
  y: number
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export type Shape =
  | "panel"
  | "cylinder"
  | "queue"
  | "pill"
  | "diamond"
  | "slant"
  | "dot"
  | "bullseye"
  | "note"
  | "actor"
  | "external"
  | "bar"
  | "choice"
  /** panel & code nodes: header strip + body. */
  | "window"
  | "chip"

/** Syntax token classes (omitted = plain ink). */
export type TokKind = "kw" | "op" | "str" | "num" | "fn" | "def" | "type" | "param" | "com"
/** One code line: tokens with their start column. */
export type CodeLine = { t: string; c: number; k?: TokKind }[]

export interface SceneCode {
  lang: CodeLang
  /** [0] = spec code, then each story `set` on this node in step order. */
  versions: CodeLine[][]
  /** Relative to the node box; line k is centred at top + (k − 0.5)·lh. */
  x: number
  top: number
  lh: number
  /** Reserved lines / columns (≥ every version). */
  slots: number
  cols: number
}

export interface SceneRowVersion {
  lines: string[]
  /** Char offset (across the joined lines) where the muted detail starts. */
  split?: number
  tag?: string
}

export interface SceneRow {
  /** Authored id, else "row-<k>". */
  id: string
  /** Slot box relative to the node (x = text start). */
  y: number
  h: number
  x: number
  tagY?: number
  /** Baselines of the text lines. */
  lineY: number[]
  iconY?: number
  icon?: IconName
  status?: RowStatus
  muted?: boolean
  indent?: number
  statusX: number
  /** Centre of the first text line (anchor/port y). */
  anchorY: number
  versions: SceneRowVersion[]
}

export interface SceneNode extends Box {
  id: string
  kind: string
  shape: Shape
  accent: Accent
  /** Wrapped label lines. */
  label: string[]
  detail: string[]
  /** Uppercase tag (empty string for none). */
  tag: string
  /** Text layout: y of each label/detail baseline and the tag baseline, relative to the node box. */
  text: { tagY: number; labelY: number[]; detailY: number[]; cx: number; counterY?: number }
  /** Rolling counter slot (value = initial; the story drives it). */
  counter?: { id: string; value: number; label?: string; prefix?: string; suffix?: string }
  /** window: header strip. */
  header?: { h: number; title: string }
  rows?: SceneRow[]
  code?: SceneCode
  icon?: IconName
  muted?: boolean
  /** chip: sheets below the face; the face is h − stack·stackStep tall. */
  stack?: number
  /** Label versions (story `set` label); [0] = spec. */
  labels?: string[][]
  /** Plain nodes: detail versions (story `set` detail / tone); [0] = spec. The slot fits every version. */
  details?: { lines: string[]; tone?: Tone }[]
  /** Plain nodes: tag versions (story `set` tag, uppercase); [0] = spec ("" = none). */
  tags?: string[]
  /**
   * Plain nodes with a story `status`: the glyph slot at the start of the detail line (centre), and
   * the left edge of the (then left-aligned) detail text.
   */
  glyph?: { x: number; y: number; textX: number }
  delta?: Delta
  /** Act stories: the acts this element is on stage in (absent = every act). */
  acts?: string[]
  /** The kind's accent when the delta replaced it (the before look of a `change` step). */
  accent0?: Accent
  stat?: ChangeStat
  summary?: string
  files?: FileRef[]
  badge?: SceneBadge
  /** Diff code node: rows of the unified diff (the node's `code` mirrors them for bars / anchors). */
  diff?: SceneDiff
}

/** One diff row at its resting (fully applied) position; `y` = row top relative to the node. */
export interface SceneDiffRow {
  kind: "context" | "add" | "del" | "hunk" | "fold"
  old?: number
  new?: number
  text: string
  tokens: CodeLine
  marks?: [number, number][]
  /** 0-based hunk index. */
  hunk: number
  y: number
}

export interface SceneDiff {
  rows: SceneDiffRow[]
  /** Hunk count (story `apply` hunks are 1-based). */
  hunks: number
  lang: CodeLang
  file?: string
  /** Row height and the first row's top. */
  lh: number
  top: number
  /** Gutter: right edges of the old / new number columns, the rule, the +/− marker and code x. */
  oldX: number
  newX: number
  ruleX: number
  markX: number
  codeX: number
}

export interface SceneGroup extends Box {
  id: string
  label: string
  kind?: string
  depth: number
  composite: boolean
  /** Label only, no box. */
  bare?: boolean
  delta?: Delta
  /** Act stories: the acts this element is on stage in (absent = every act). */
  acts?: string[]
}

export interface Arrowhead {
  x: number
  y: number
  /** Direction of travel at the tip, radians. */
  angle: number
  form: "filled" | "open" | "cross"
}

export interface SceneLabel extends Box {
  id: string
  text: string
  /** Surface the label sits on, so its backing matches: page, group or composite. */
  surface?: "bg" | "group" | "composite"
}

export interface SceneEdge {
  id: string
  from: string
  to: string
  /** SVG path data with rounded corners. */
  d: string
  points: Pt[]
  /** Polyline length (for draw-on dash offsets). */
  length?: number
  style: EdgeStyle
  arrow: ArrowMode
  heads: Arrowhead[]
  label?: SceneLabel
  /** Label versions (pulses that `land` their label here); [0] = spec ("" = none). The slot fits the widest. */
  labels?: { text: string; tone?: Tone }[]
  message?: MessageKind
  /** Sequence number (autonumber). */
  seq?: number
  /** Row id / code line the edge leaves from / arrives at (from/to stay node ids). */
  fromAnchor?: string
  toAnchor?: string
  delta?: Delta
  /** Act stories: the acts this element is on stage in (absent = every act). */
  acts?: string[]
  emphasis?: Emphasis
  summary?: string
  files?: FileRef[]
}

export interface ScenePort extends Pt {
  id: string
  node: string
  edge: string
  end: "out" | "in"
  /** Hidden under an arrowhead (kept for Phase 2 animation). */
  covered: boolean
  anchor?: string
}

export interface SceneLifeline {
  id: string
  participant: string
  x: number
  y1: number
  y2: number
}

export interface SceneActivation extends Box {
  id: string
  participant: string
}

export interface SceneFrame extends Box {
  id: string
  kind: FrameKind
  label?: string
  tagW: number
  sections: { y: number; label?: string }[]
}

export interface Scene {
  type: DiagramType
  title: string
  subtitle?: string
  /** Resolved direction for graph types (after auto-pick). */
  direction?: Direction
  viewBox: Box
  groups: SceneGroup[]
  nodes: SceneNode[]
  edges: SceneEdge[]
  ports: ScenePort[]
  lifelines: SceneLifeline[]
  activations: SceneActivation[]
  frames: SceneFrame[]
  /** Sequence background bands (Mermaid rect). */
  bands: SceneBand[]
  /** Sequence participant boxes (Mermaid box). */
  boxes: SceneBox[]
  /** Change metadata (header line "base → head"). */
  change?: ChangeMeta
  /** Change legend band above the diagram (deltas present, in legend order). */
  legend?: SceneLegend
  /** Node annotations (one mono line above / below a node); only when the spec has them. */
  annotations?: SceneAnnotation[]
  /** Story toast slots (placed at layout time); only when the story has toasts. */
  toasts?: SceneToast[]
  /** Compiled storyboard, when the spec has a story. */
  timeline?: import("./story/types.ts").Timeline
  /** Embedded hunks (`--changes`), carried for the HTML viewer's drawer; only when the spec has them. */
  changes?: import("./spec.ts").EmbeddedChanges
}

/** A node annotation: text baseline at (x, y); the box (x, y0, w, h) is reserved by the layout. */
export interface SceneAnnotation {
  id: string
  on: string
  side: "top" | "bottom"
  x: number
  /** Baseline. */
  y: number
  /** Reserved box (every version fits). */
  box: Box
  /** [0] = spec, then each story `set` with text / tone, in step order. */
  versions: { text: string; tone?: Tone }[]
  acts?: string[]
}

/** A toast card slot: a story toast step (step index, k-th toast of the step). */
export interface SceneToast extends Box {
  id: string
  step: number
  k: number
  near: string
  title?: string
  text: string
  tone?: Tone
}

export interface SceneBand extends Box {
  id: string
  label?: string
}

export interface SceneBox extends Box {
  id: string
  label?: string
  participants: string[]
}

export interface SceneLegend {
  /** Left of the first item and its text baseline. */
  x: number
  y: number
  items: Delta[]
  /** Right-aligned change meta ("main → feat/batch"), with its right edge. */
  meta?: string
  metaX?: number
}
