import type { Accent } from "../theme/tokens.ts"
import type { ArrowMode, CodeLang, DiagramType, Direction, EdgeStyle, FrameKind, IconName, MessageKind, RowStatus } from "./spec.ts"

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
}

export interface SceneGroup extends Box {
  id: string
  label: string
  kind?: string
  depth: number
  composite: boolean
  /** Label only, no box. */
  bare?: boolean
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
  message?: MessageKind
  /** Sequence number (autonumber). */
  seq?: number
  /** Row id / code line the edge leaves from / arrives at (from/to stay node ids). */
  fromAnchor?: string
  toAnchor?: string
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
  /** Compiled storyboard, when the spec has a story. */
  timeline?: import("./story/types.ts").Timeline
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
