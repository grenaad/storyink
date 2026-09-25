/** storyink diagram spec (JSON). See docs/spec.md and schema/storyink.schema.json. */

export const DIAGRAM_TYPES = ["architecture", "workflow", "sequence", "dataflow", "lifecycle"] as const
export type DiagramType = (typeof DIAGRAM_TYPES)[number]

export type Direction = "TB" | "LR"

export const GRAPH_NODE_KINDS = {
  architecture: ["service", "database", "store", "queue", "client", "user", "external", "cache", "function"],
  dataflow: ["service", "database", "store", "queue", "client", "user", "external", "cache", "function"],
  workflow: ["start", "end", "step", "decision", "io"],
  lifecycle: ["initial", "final", "state", "composite"],
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
  type: DiagramType
  title: string
  subtitle?: string
  /** Phase 2 storyboard. Accepted and ignored in Phase 1. */
  story?: unknown
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
}

export interface GraphGroup {
  id: string
  label?: string
  /** Free-form flavour: vpc, cluster, tier, region, zone, boundary... */
  kind?: string
  parent?: string
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
  autonumber?: boolean
}

export type Spec = GraphSpec | SequenceSpec

export const isSequence = (spec: Spec): spec is SequenceSpec => spec.type === "sequence"
