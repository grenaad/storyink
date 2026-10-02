---
name: storyink
description: Create polished architecture, workflow, sequence, data-flow and lifecycle diagrams as standalone HTML/SVG with storyink, then snapshot and visually check them. Use when asked to draw, visualise or diagram a system, flow, API sequence, pipeline or state machine, or to convert Mermaid.
---

# storyink

Diagrams from a small JSON spec (or Mermaid) into one offline HTML file (pan/zoom viewer,
light/dark, SVG/PNG export) plus a static SVG. Warm ink-on-paper style, Commit Mono labels.

## 1. Pick the type

| Draw...                                   | `type`         | Units                                   |
| ----------------------------------------- | -------------- | --------------------------------------- |
| services, stores, infra, trust boundaries | `architecture` | nodes, edges, groups (VPC/cluster/tier) |
| data moving through stages                | `dataflow`     | same as architecture                    |
| a process with steps and decisions        | `workflow`     | start / step / decision / io / end      |
| calls between parties over time           | `sequence`     | participants, messages, frames, notes   |
| states and transitions                    | `lifecycle`    | initial / state / composite / final     |

Node kinds: architecture/dataflow `service database store queue client user external cache function`;
workflow `start end step decision io`; lifecycle `initial final state composite choice fork
join`; any graph may add `note` nodes. Architecture/dataflow/workflow also have **rich nodes**:
`panel` (a window of rows: chat, tool calls, logs), `code` (a syntax-coloured program) and `chip`
(small tile, e.g. a server); see section 2b.

## 2. Write the spec (or convert Mermaid)

```json
{
  "type": "architecture", "title": "Checkout", "subtitle": "optional", "direction": "LR",
  "groups": [{ "id": "vpc", "label": "VPC", "kind": "network" }],
  "nodes": [
    { "id": "web", "label": "Web", "kind": "client" },
    { "id": "api", "label": "API", "kind": "service", "parent": "vpc", "detail": "Go" },
    { "id": "db", "label": "Orders DB", "kind": "database", "parent": "vpc" }
  ],
  "edges": [{ "from": "web", "to": "api", "label": "HTTPS" }, { "from": "api", "to": "db", "style": "dashed" }]
}
```

- `direction`: omit it to auto-pick TB/LR (aspect closest to 16:10), or pin `TB` `LR` `BT` `RL`.
- Graph edges have no arrowheads (Kit style); add `"style": { "arrowheads": true }` if direction
  must be explicit.
- Edges: `label`, `style` solid|dashed|thick, `arrow` end|none|both. Edges may target a group.
- Lifecycle composites: a node with `"kind": "composite"`; children set `"parent"` to it.
- Sequence: `participants` (kind participant|actor|service|database|queue|external), ordered
  `messages` (kind sync|async|return|self), `activations` / `frames` (alt opt loop par critical
  break, with `sections` for else/and) / `notes` referencing messages by index or `id`;
  `autonumber: true`.
- Keep labels short (<= 26 chars wrap). Put technology in `detail`, not the label.
- `story` is optional: add it only for an animated diagram (section 6).

### 2b. Rich nodes and anchors (agent sessions, code, tool servers)

```json
"nodes": [
  { "id": "session", "kind": "panel", "label": "Session", "size": { "cols": 32, "lines": 6 },
    "rows": [
      { "id": "ask", "tag": "You", "text": "File GitHub bugs in Linear." },
      { "id": "exec", "icon": "wrench", "text": "EXECUTE", "detail": "{ code }", "status": "done" }
    ] },
  { "id": "code", "kind": "code", "label": "Code mode", "lang": "ts", "code": ["return tools.github.list_issues()"] },
  { "id": "github", "kind": "chip", "label": "github", "icon": "plug", "parent": "servers" }
],
"groups": [{ "id": "servers", "label": "MCP servers", "bare": true }],
"edges": [{ "from": "session#exec", "to": "code#1" }, { "from": "code", "to": "github" }]
```

- Rows: `id` (starts with a letter), `tag`, `icon`, `text`, `detail` (muted), `status`
  none|running|done|error, `indent` 0–4, `muted`. Icons: wrench plug file terminal search globe
  bolt user spark. `lang`: ts js json py go rust sql yaml sh text.
- `size: { cols, lines }` reserves space so later `set`/typing never resizes the window.
- Anchors: `node#rowId` / `node#3` (1-based code line) attach wires at that row/line and target
  story steps. `muted: true` dims a node at rest; chip `stack: 1..3` draws extra sheets;
  `bare: true` groups are just a column heading.
- Copy from the examples: `examples/code-mode.architecture.json`,
  `retry-helper.architecture.json`, `agent-session.architecture.json`, `failover.dataflow.json`.

Mermaid in: `flowchart`/`graph`, `sequenceDiagram`, `stateDiagram-v2`. Convert with the
`storyink_from_mermaid` tool (or `storyink mermaid in.mmd -o spec.json`), then refine the JSON:
add `kind`, `detail`, `groups`, a real `title`/`subtitle`.

## 3. Render

- OpenCode: `storyink_render` with `spec` (or `mermaid`), `output: "diagrams/x.html"`,
  optional `svg`. Invalid specs write nothing and return path + message + hint for each error.
- Elsewhere: `npx storyink render spec.json -o x.html --svg x.svg` (`storyink validate spec.json`
  first if unsure). Exit code 1 means invalid input.

### Code changes

Use deltas when the diagram explains a change (PR review, migration, refactor), not for a plain
system map. On each element the change touches set `"delta": "added" | "modified" | "removed"`;
keep the untouched neighbours a reader needs for orientation as `"unchanged"` context instead of
dropping them (don't draw the whole system). Keep removed parts visible (they ghost and strike
through) so reviewers see what went away. `stat` gives `+N −M`, `summary` one line of why.
Mark at most 1–2 edges `"emphasis": "hero"`: the path the change is about (more is a warning);
`"muted"` pushes side traffic back. Add `"change": { "base", "head" }` for the header line. An
`added` edge can't touch a `removed` node (error); an edge to a removed node is itself `removed`.
In a story, pulse the old path, `dim` the removed parts, `reveal` / `wire` the new ones, then
pulse the hero edge. Look at both themes: badges must not crowd labels.

Diff code nodes show the actual change next to the box it changes: a `code` node with `"diff"`
(inline hunk text, or `{ "file", "lines": [a, b] }` resolved by `changes`), attached to its
service with a dashed `"arrow": "none"` edge. Keep each diff short (a tight `lines` range,
`"max": 12`–`24`, one function); one or two diff nodes per diagram. Wire from the changed line
(`"from": "pay#+14"`, head line; `#-13` = base line) to the store or queue it now hits. In the
story, `apply` the diff in the beat where its service changes (`{ "id", "hunk": n }` for one hunk
per beat), then `line: "pay#+14"` to point at the key line. Don't `type` / `set` diff nodes.

To play a change: `"story": "changes"` (tool `story: "changes"`) derives it from the deltas
(write a one-line `summary` on each changed element: it becomes the caption and the narration);
or hand-write steps with `"change": [ids]` (the before look until then; don't also `reveal` an
added element you `change`). Add `"spotlight": "veil"` and `"focus": [ids]` to keep attention on
the part that changes. Check the beat sheet: each beat should show one change.

To diagram a change (PR, branch, working tree): run `storyink_diff` (CLI `storyink diff`; default
working tree vs the merge base with main; or `range: "main...HEAD"`) with `output:
"changes.json"`; it returns per-file status, +/− and hunk headers. Put the paths on elements as
`files` (`"src/x.ts"` or `{ "path": "src/x.ts", "lines": [40, 62] }`, head-side numbers; base-side
for removed elements), and give a `code` node `"diff": { "file": "src/x.ts", "lines": [40, 62] }`
to show the real hunk. Render with `changes: "changes.json"` (CLI `--changes`): `stat` is filled
and warnings name changed files nothing references and ranges that miss every hunk.

PR walkthroughs: give story steps `"narrate": { "heading", "body", "cites": [{ "text", "ref" }] }`
(HTML rail; the heading doubles as the caption elsewhere). Rules: each step is one change; the
headline change first, the overview last; reveal / focus 2–3 elements per step; keep consecutive
steps on the same area of the diagram; write plainly (what changed and why, 1–3 sentences); cite
the elements you mention and the files that prove it (`"ref": "src/x.ts#L40-62"`; cite `text` is
copied exactly from the body, in order). Give changed elements `summary` + `files` and render with
`changes`: clicking a box opens a drawer with its real hunks. Check with
`storyink_snapshot` `at` + `rail: true` (and `drawer: "<id>"`).

## 4. Render -> look -> fix (required, max 3 passes)

1. Snapshot both themes: `storyink_snapshot` with `html: "diagrams/x.html"`
   (CLI: `storyink snapshot x.html -o shots`). It returns per-theme PNGs, a light|dark contact
   sheet, lint results and a receipt.
2. Look at the sheet image. Never describe a frame you have not seen.
3. Check:
   - [ ] no overlapping nodes, labels or wires through boxes
   - [ ] no clipped or overflowing labels (lint must be clean)
   - [ ] readable contrast in light and dark
   - [ ] legible at 640 px wide (too wide? switch to `TB`, split, or shorten labels)
   - [ ] balanced layout; groups tell the story; nothing orphaned
4. Fix the spec (labels, `detail`, grouping, `direction`, edge order), re-render, re-snapshot.
   Stop after three passes and report what is left.

## 6. Storyboard (opt-in)

Only when the user asks for an animated / story diagram. Add `"story"` to the spec (or
`story: "auto"` on `storyink_render`, `--story auto` on the CLI):

```json
"story": { "steps": [
  { "at": 0.3, "reveal": ["web"], "caption": "A shopper presses Pay", "stop": "Request" },
  { "at": "+0.2", "pulse": "web->api" },
  { "reveal": ["api"], "highlight": ["api"] },
  { "at": "+0.2", "pulse": { "route": ["api->db", "db->cache"] }, "counter": { "id": "hits", "to": 3 } }
] }
```

`at`: seconds or `"+x"` after the previous step ends. Reveal the target in the step *after* its
pulse (`"+0"`) so nothing appears before its cause. Counters live on nodes:
`"counter": { "id": "hits", "label": "hits" }`. One visible change per step; captions short.

Loop: render, then `storyink_snapshot` with `sheet: "beats"` (CLI `--sheet beats`), plus a few
`at` frames. Look at the beats sheet in both themes and check:
- [ ] no overlaps or clipped labels on any beat
- [ ] legible in both themes
- [ ] nothing appears before its cause
- [ ] each beat changes one visible thing
- [ ] no half-drawn tile once a step has settled
- [ ] the last frame is the static diagram (gates `end=static`, `reduced=static`, `reduced=stepped` pass)
- Stories animate by default even if the reader's OS reduces motion; set `"motion": "system"` in
  `story` (or `motion` on `storyink_render`) to honour it, `"reduced"` to always step.
- Reduced-motion viewers get stepped playback (settled steps, no motion); check with
  `motion: "reduced"` + `at` frames if the steps must read well on their own.
- Playback pauses after each beat for reading (≈ 0.6 × (1 s + 0.3 s/word) of its caption by
  default). Tune with `"pace"` in `story` (or `pace` on `storyink_render`; default 0.6, 0 = none,
  1 = longer) or `"hold": s` on a step; an absolute `at` is only a minimum start. Readers can change
  it in the viewer (Pauses, `[` / `]`); snapshots use the author pace unless `pace` is given. `at` frames shift accordingly: use
  `__storyink.steps` or beat sheets rather than hard-coded times.
- On large diagrams the viewer's camera follows the story (readable zoom, pans step to step, fit
  at the end). To see what a reader sees mid-story, snapshot with `camera: "follow"` + `at`;
  `"camera": "fit"` in `story` (or `camera` on `storyink_render`) turns it off.

**Content steps** (rich nodes): `type` (code types by char, default 90/s, `cps`; rows by word),
`set` (crossfade to new code/text; with `type` in the same step it types the new version),
`clear`, `line` (`"code#2-4"`, `{ "id": "code", "off": true }`), `status` (`{ "id": "node#row",
"to": "running" }`: spinner + shimmer; `done`/`error` draw a check/cross), `dim`/`undim`
(independent of visibility), `hide`/`show` (take away / bring back something already there;
`reveal` is for things that are *new*), `wire`/`unwire`, `glow`/`unglow` (persistent), `focus`.
Pulses take `"reverse": true` and `"delay": s`. Story options: `"spotlight": true`,
`"rewind": "glitch"` (HTML only). `pace` changes only the holds between beats, never typing
speed. Finish with spinners `done` and glows `unglow`ed: the final frame is the static diagram
(the compiler warns otherwise).

Max 3 passes. Stills can't show smoothness or real-time pacing: say so when reporting.

**Animated SVG** for READMEs, PR comments and docs, where only an `<img>` is allowed (no script):
`storyink_render` with `animatedSvg: "both"` (CLI `--animated-svg x.svg --theme both`) writes
`x.light.svg` + `x.dark.svg` (SMIL, loops; `once: true` plays once). Paste the returned snippet:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="x.dark.svg">
  <img alt="…" src="x.light.svg">
</picture>
```

Default font is the system mono (small); `font: "embed"` for the exact look (+~127 KB). No story
in the spec → auto story. Rich content (typing, status, spotlight…) animates in the SVG too
(checked in Chrome; Firefox plays it; Safari untested); the glitch rewind and the follow camera are
HTML-only. On GitHub, a changed diagram needs a new file name (camo caches by URL).

## Images and context

- `storyink_snapshot` returns **one compact preview** (JPEG, ≤ 1024 px, a few hundred KB at most)
  by default. Prefer it; `image: "full"` (≤ 3 parts) only when needed, `image: "none"` for gates only.
- Full-res PNGs stay on disk and are listed in the text. **Don't re-read them**: they are huge
  and every image stays in your context for the rest of the session.
- For detail, snapshot single frames with `at` (e.g. `at: [2.5]`) instead of zooming into sheets.
- Keep image reads few: one preview per render pass, at most 3 passes.
- Outside OpenCode: `storyink snapshot x.html --sheet beats --preview x.preview.jpg` and read the
  preview only.

## 5. Report

State what you delivered: HTML and SVG paths (and sizes), the sheet PNG you looked at, lint
status, and any known compromises. Tell the user the HTML works offline: pan/zoom, `0` fit,
`+`/`-`, theme toggle, SVG/PNG export; `#theme=dark`, `#chrome=0`, `#sheet=light,dark`.
