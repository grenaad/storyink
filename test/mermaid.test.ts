import { describe, expect, test } from "bun:test"
import { fromMermaid } from "../src/core/mermaid/index.ts"

describe("mermaid flowchart", () => {
  test("shapes, edges, chaining, &, subgraphs, comments", () => {
    const r = fromMermaid(`%% c
graph LR
  A([Start]) --> B{Ok?} -->|yes| C[Do] ==> D[(DB)]
  B -- no --> E[/In/] -.-> F((End))
  G[[Sub]] --- H{{Prep}} & I>Flag]
  subgraph S1 [Stage one]
    C
    J(round)
  end
  classDef x fill:#f00
  click A call`)
    expect(r.ok).toBe(true)
    const s = r.spec as any
    expect(s.direction).toBe("LR")
    const kind = (id: string) => s.nodes.find((n: any) => n.id === id).kind
    expect(kind("A")).toBe("start")
    expect(kind("B")).toBe("decision")
    expect(kind("D")).toBe("io")
    expect(kind("E")).toBe("io")
    expect(kind("F")).toBe("end")
    expect(s.edges.find((e: any) => e.from === "B" && e.to === "C").label).toBe("yes")
    expect(s.edges.find((e: any) => e.from === "B" && e.to === "E").label).toBe("no")
    expect(s.edges.find((e: any) => e.from === "C").style).toBe("thick")
    expect(s.edges.find((e: any) => e.from === "E").style).toBe("dashed")
    expect(s.edges.filter((e: any) => e.from === "G").length).toBe(2)
    expect(s.groups[0]).toMatchObject({ id: "S1", label: "Stage one" })
    expect(s.nodes.find((n: any) => n.id === "J").parent).toBe("S1")
    expect(r.diagnostics.filter((d) => d.severity === "warning").length).toBe(2)
  })

  test("unknown lines warn, never throw", () => {
    const r = fromMermaid("flowchart TD\n  A --> B\n  ??? what\n")
    expect(r.ok).toBe(true)
    expect(r.diagnostics.some((d) => d.severity === "warning")).toBe(true)
  })

  test("unsupported header is an error", () => {
    expect(fromMermaid("pie title x").ok).toBe(false)
  })
})

describe("mermaid sequence", () => {
  test("participants, arrows, blocks, activations, notes", () => {
    const r = fromMermaid(`sequenceDiagram
  autonumber
  actor U as User
  participant A as API
  U->>+A: call
  A-->>-U: done
  A-)U: event
  A-xU: lost
  loop every 5s
    U->>A: poll
  end
  alt ok
    A-->>U: 200
  else fail
    A-->>U: 500
  end
  par one
    U->>A: x
  and two
    U->>A: y
  end
  Note right of A: cached
  activate A
  A->>A: self
  deactivate A`)
    expect(r.ok).toBe(true)
    const s = r.spec as any
    expect(s.autonumber).toBe(true)
    expect(s.participants.map((p: any) => p.kind)).toEqual(["actor", "participant"])
    expect(s.messages[1].kind).toBe("return")
    expect(s.messages[2].kind).toBe("async")
    expect(s.messages.at(-1).kind).toBe("self")
    expect(s.frames.map((f: any) => f.kind)).toEqual(["loop", "alt", "par"])
    expect(s.frames[1].sections[0].label).toBe("fail")
    expect(s.activations.length).toBe(2)
    expect(s.notes[0].right).toBe("A")
  })
})

describe("mermaid additions", () => {
  test("flowchart RL/BT and subgraph direction", () => {
    expect((fromMermaid("flowchart RL\n a --> b").spec as any).direction).toBe("RL")
    expect((fromMermaid("graph BT\n a --> b").spec as any).direction).toBe("BT")
    const r = fromMermaid("flowchart TD\n subgraph S\n direction LR\n a --> b\n end")
    expect((r.spec as any).groups[0].direction).toBe("LR")
    expect(r.diagnostics.length).toBe(0)
  })

  test("sequence rect -> band, box -> participant group, note placement", () => {
    const r = fromMermaid(`sequenceDiagram
  box rgb(1,2,3) Backend
    participant A
    participant B
  end
  participant C
  loop poll
    A->>B: x
    rect rgb(0,0,0)
      B->>C: y
    end
    Note over B: inside
  end
  Note over A: after`)
    expect(r.ok).toBe(true)
    const s = r.spec as any
    expect(s.boxes).toEqual([{ participants: ["A", "B"], label: "Backend" }])
    expect(s.bands).toEqual([{ start: 1, end: 1 }])
    expect(s.notes[0].outside).toBeUndefined()
    expect(s.notes[1].outside).toBe(true)
  })

  test("state fork/join/choice and notes", () => {
    const r = fromMermaid(`stateDiagram-v2
  state f <<fork>>
  state j <<join>>
  state c <<choice>>
  [*] --> f
  f --> A
  f --> B
  A --> j
  B --> j
  j --> c
  c --> [*]
  note right of A : one line
  note left of B
    two
    lines
  end note`)
    expect(r.ok).toBe(true)
    const s = r.spec as any
    const kind = (id: string) => s.nodes.find((n: any) => n.id === id).kind
    expect([kind("f"), kind("j"), kind("c")]).toEqual(["fork", "join", "choice"])
    const notes = s.nodes.filter((n: any) => n.kind === "note")
    expect(notes.map((n: any) => n.label)).toEqual(["one line", "two lines"])
    expect(s.edges.filter((e: any) => e.from.startsWith("note_")).every((e: any) => e.arrow === "none")).toBe(true)
  })
})

describe("mermaid state", () => {
  test("[*], labels, aliases, composites, direction", () => {
    const r = fromMermaid(`stateDiagram-v2
  direction LR
  state "Waiting for payment" as W
  [*] --> W
  W --> P : paid
  state P {
    [*] --> Pick
    Pick --> Pack
  }
  P --> [*]`)
    expect(r.ok).toBe(true)
    const s = r.spec as any
    expect(s.type).toBe("lifecycle")
    expect(s.direction).toBe("LR")
    expect(s.nodes.find((n: any) => n.id === "W").label).toBe("Waiting for payment")
    expect(s.nodes.find((n: any) => n.id === "P").kind).toBe("composite")
    expect(s.nodes.find((n: any) => n.id === "P__start")).toMatchObject({ kind: "initial", parent: "P" })
    expect(s.edges.find((e: any) => e.from === "W").label).toBe("paid")
  })
})
