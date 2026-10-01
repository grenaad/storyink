/** storyink diagram spec (JSON). See docs/spec.md and schema/storyink.schema.json. */

export const DIAGRAM_TYPES = ["architecture", "workflow", "sequence", "dataflow", "lifecycle"] as const
export type DiagramType = (typeof DIAGRAM_TYPES)[number]

/** TB top-to-bottom, BT bottom-to-top, LR left-to-right, RL right-to-left. */
export type Direction = "TB" | "BT" | "LR" | "RL"
export const DIRECTIONS = ["TB", "BT", "LR", "RL"] as const

export const GRAPH_NODE_KINDS = {
  architecture: ["service", "database", "store", "queue", "client", "user", "external", "cache", "function", "note", "panel", "code", "chip"],
  dataflow: ["service", "database", "store", "queue", "client", "user", "external", "cache", "function", "note", "panel", "code", "chip"],
  workflow: ["start", "end", "step", "decision", "io", "note", "panel", "code", "chip"],
  lifecycle: ["initial", "final", "state", "composite", "choice", "fork", "join", "note"],
} as const

export type ArchitectureKind = (typeof GRAPH_NODE_KINDS)["architecture"][number]
export type WorkflowKind = (typeof GRAPH_NODE_KINDS)["workflow"][number]
export type LifecycleKind = (typeof GRAPH_NODE_KINDS)["lifecycle"][number]
export type NodeKind = ArchitectureKind | WorkflowKind | LifecycleKind

export const PARTICIPANT_KINDS = ["participant", "actor", "service", "database", "queue", "external"] as const
export type ParticipantKind = (typeof PARTICIPANT_KINDS)[number]

export const MESSAGE_KINDS = ["sync", "async", "return", "self"] as const
export type MessageKind = (typeof MESSAGE_KINDS)[number]

export const FRAME_KINDS = ["alt", "opt", "loop", "par", "critical", "break"] as const
export type FrameKind = (typeof FRAME_KINDS)[number]

export const EDGE_STYLES = ["solid", "dashed", "thick"] as const
export type EdgeStyle = (typeof EDGE_STYLES)[number]

export const ARROWS = ["end", "none", "both"] as const
export type ArrowMode = (typeof ARROWS)[number]

interface Common {
  $schema?: string
  style?: StyleOptions
  type: DiagramType
  title: string
  subtitle?: string
  /** Storyboard: a hand-written story, or "auto" to derive one from graph / message order. */
  story?: Story | "auto"
}

export const ICONS = ["wrench", "plug", "file", "terminal", "search", "globe", "bolt", "user", "spark"] as const
export type IconName = (typeof ICONS)[number]
export const ROW_STATUSES = ["none", "running", "done", "error"] as const
export type RowStatus = (typeof ROW_STATUSES)[number]
/** Code languages for syntax colouring ("js" uses the TypeScript lexer). */
export const CODE_LANGS = ["ts", "js", "json", "text"] as const
export type CodeLang = (typeof CODE_LANGS)[number]

/** One body row of a `panel` node. Anchor + story target: "<node>#<id>". */
export interface PanelRow {
  /** Starts with a letter or _ (digits-only refs are code lines: "code#3"). */
  id?: string
  /** Small uppercase line above the text ("YOU"). */
  tag?: string
  icon?: IconName
  /** Main text; wraps at the panel's size.cols (default 40). */
  text?: string
  /** Muted text after `text` on the same line ("{ code }"). */
  detail?: string
  /** Rest status in the right-edge slot (default none). */
  status?: RowStatus
  /** 0..4 levels, 2 columns each. */
  indent?: number
  /** Dimmed at rest (story `undim` lifts it). */
  muted?: boolean
}

/** Reserved body space for panel/code nodes; content swaps and typing never resize. */
export interface ContentSize {
  cols?: number
  lines?: number
}

export interface GraphNode {
  id: string
  label?: string
  kind?: NodeKind
  /** Muted second line, e.g. technology or responsibility. */
  detail?: string
  /** Small uppercase tag above the label. Defaults to the kind. */
  tag?: string
  /** Containing group id (or composite state id in lifecycle diagrams). */
  parent?: string
  /** Composite states only: direction of their inner layout (best-effort). */
  direction?: Direction
  /** A rolling counter shown on the node (driven by story `counter` steps). */
  counter?: NodeCounter
  /** chip: glyph before the label; panel/code: glyph before the header title. */
  icon?: IconName
  /** panel only: body rows. */
  rows?: PanelRow[]
  /** code only: source (a string is split on newlines; tabs become 2 spaces). */
  code?: string | string[]
  /** code only (default "ts"). */
  lang?: CodeLang
  /** panel/code: reserved body size. */
  size?: ContentSize
  /** Dimmed/disabled at rest (0.42); story `undim` lifts it. */
  muted?: boolean
  /** chip: 1..3 sheets peeking below ("more items"). */
  stack?: number
}

export interface NodeCounter {
  id: string
  /** Initial value (default 0). The static/final frame shows the last story value. */
  value?: number
  label?: string
  /** Text before/after the number, e.g. "$" or " req/s". */
  prefix?: string
  suffix?: string
}

/** A pulse reference: an edge / message id, a unique "from->to", or a multi-hop route. */
export type PulseRef =
  | string
  | {
      edge?: string
      route?: string[]
      duration?: number
      /** Travel backwards (return pulses). */
      reverse?: boolean
      /** Start this many seconds after the step. */
      delay?: number
    }
/** Typewriter target: a code node or a panel row ("node#row"). */
export type TypeRef = string | { id: string; by?: "char" | "word"; cps?: number; duration?: number }
/** Active-line bar: "code#2", "code#2-4", or an object (`off: true` hides it). */
export type LineRef = string | { id: string; lines?: number | [number, number]; off?: true }
export interface StatusRef {
  id: string
  to: RowStatus
}
export type LevelRef = string | string[] | { ids: string[]; to?: number }
export interface SetRef {
  id: string
  code?: string | string[]
  text?: string
  detail?: string
  tag?: string
  label?: string
}
export type WireRef = string | { edge: string; duration?: number }

export interface StoryStep {
  id?: string
  /** Seconds (absolute), or "+x" = x seconds after the previous step ends. Default "+0". */
  at?: number | string
  reveal?: string | string[]
  /** One pulse, or several in parallel. */
  pulse?: PulseRef | PulseRef[]
  highlight?: string | string[] | { ids: string[]; for?: number }
  caption?: string
  counter?: { id: string; to: number } | { id: string; to: number }[]
  /** Chapter marker label (scrubber tick, ←/→). */
  stop?: string
  /**
   * Reading hold (seconds) after the beat this step ends, overriding the computed one (not scaled
   * by `pace`). 0 = go straight on.
   */
  hold?: number
  /** Typewriter: a code node, or a panel row. */
  type?: TypeRef | TypeRef[]
  /** Active-line bar on a code node. */
  line?: LineRef | LineRef[]
  /** Row status: spinner / check / cross. */
  status?: StatusRef | StatusRef[]
  /** Dim nodes, groups, edges or rows (default level 0.42). */
  dim?: LevelRef
  undim?: string | string[]
  hide?: string | string[]
  /** Inverse of hide (not a reveal). */
  show?: string | string[]
  /** Swap content (crossfade), or start empty when also typed. */
  set?: SetRef | SetRef[]
  /** Fade a code node's / row's content out. */
  clear?: string | string[]
  /** Draw an edge on at wire speed (hidden before). */
  wire?: WireRef | WireRef[]
  /** Retract an edge (source end first). */
  unwire?: WireRef | WireRef[]
  /** Persistent glow on / off (nodes). */
  glow?: string | string[]
  unglow?: string | string[]
  /** Camera focus + spotlight target override. */
  focus?: string
}

export interface Story {
  /** false (default): click-to-play gate. true: play when scrolled into view. */
  autoplay?: boolean
  /** "hold" (default) the final frame, or "loop". */
  end?: "hold" | "loop"
  /**
   * Playback motion (default "full"): "full" always animates, "reduced" always plays step by
   * step, "system" follows the reader's `prefers-reduced-motion`. The reader's toolbar choice
   * and `#motion=` still win.
   */
  motion?: StoryMotion
  /**
   * Viewer camera while playing (default "follow"): "follow" zooms to a readable scale when the
   * fit view is too small and pans to each step; "fit" keeps the whole diagram in view. The
   * reader's Follow toggle and `#camera=` still win.
   */
  camera?: StoryCamera
  /**
   * Multiplier on the reading holds inserted after each beat (default 0.6; 0 = the pre-0.3.5
   * timing, 1 = the 0.3.5 holds, 1.5 = slower). Readers can change it in the viewer (Pauses). Holds only fill the gap between a beat settling and the next starting.
   */
  pace?: number
  /** Steps, or "auto" to derive them (like `"story": "auto"`, with the options above). */
  steps: StoryStep[] | "auto"
  /** A soft light that follows the action. */
  spotlight?: boolean
  /** Loop reset effect in the HTML viewer. */
  rewind?: "tape" | "glitch"
}

export type StoryMotion = "full" | "reduced" | "system"
export type StoryCamera = "follow" | "fit"
export const STORY_MOTIONS = ["full", "reduced", "system"] as const

export interface GraphGroup {
  id: string
  label?: string
  /** Free-form flavour: vpc, cluster, tier, region, zone, boundary... */
  kind?: string
  parent?: string
  /** Lay out this group's members in their own direction (best-effort). */
  direction?: Direction
  /** Label only, no box (a column heading). */
  bare?: boolean
}

/** Diagram-level presentation options. */
export interface StyleOptions {
  /** Draw arrowheads on graph edges (default false: Kit style, ports at both ends). Sequences always have heads. */
  arrowheads?: boolean
}

export interface GraphEdge {
  id?: string
  from: string
  to: string
  label?: string
  style?: EdgeStyle
  arrow?: ArrowMode
}

export interface GraphSpec extends Common {
  type: "architecture" | "workflow" | "dataflow" | "lifecycle"
  /** Omit to auto-pick TB or LR by aspect ratio (closest to 16:10). */
  direction?: Direction
  nodes: GraphNode[]
  edges?: GraphEdge[]
  groups?: GraphGroup[]
}

/** A message reference: 0-based index into `messages`, or a message id. */
export type MessageRef = number | string

export interface Participant {
  id: string
  label?: string
  kind?: ParticipantKind
}

export interface Message {
  id?: string
  from: string
  to: string
  label?: string
  kind?: MessageKind
}

export interface Activation {
  participant: string
  start: MessageRef
  end: MessageRef
}

export interface Note {
  text: string
  /** One participant (left/right) or one or two (over). */
  over?: string[]
  left?: string
  right?: string
  /** Place after this message; omit to place before the first message. */
  after?: MessageRef
  /**
   * By default a note stays inside the innermost frame that contains its anchor
   * message. `outside: true` draws it after every frame that closes at the anchor.
   */
  outside?: boolean
}

/** A background band behind a range of messages (Mermaid `rect`). */
export interface Band {
  start: MessageRef
  end: MessageRef
  label?: string
}

/** A labelled group of adjacent participants (Mermaid `box`). */
export interface ParticipantBox {
  label?: string
  participants: string[]
}

export interface FrameSection {
  label?: string
  start: MessageRef
}

export interface Frame {
  kind: FrameKind
  label?: string
  start: MessageRef
  end: MessageRef
  /** Additional sections (alt/else, par/and). */
  sections?: FrameSection[]
}

export interface SequenceSpec extends Common {
  type: "sequence"
  participants: Participant[]
  messages: Message[]
  activations?: Activation[]
  notes?: Note[]
  frames?: Frame[]
  bands?: Band[]
  boxes?: ParticipantBox[]
  autonumber?: boolean
}

export type Spec = GraphSpec | SequenceSpec

export const isSequence = (spec: Spec): spec is SequenceSpec => spec.type === "sequence"
