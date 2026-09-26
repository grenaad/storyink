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
join`; any graph may add `note` nodes.

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
- `story` is reserved (ignored for now).

Mermaid in: `flowchart`/`graph`, `sequenceDiagram`, `stateDiagram-v2`. Convert with the
`storyink_from_mermaid` tool (or `storyink mermaid in.mmd -o spec.json`), then refine the JSON:
add `kind`, `detail`, `groups`, a real `title`/`subtitle`.

## 3. Render

- OpenCode: `storyink_render` with `spec` (or `mermaid`), `output: "diagrams/x.html"`,
  optional `svg`. Invalid specs write nothing and return path + message + hint for each error.
- Elsewhere: `npx storyink render spec.json -o x.html --svg x.svg` (`storyink validate spec.json`
  first if unsure). Exit code 1 means invalid input.

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
- [ ] the last frame is the static diagram (gates `end=static`, `reduced=static` pass)

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
in the spec → auto story. On GitHub, a changed diagram needs a new file name (camo caches by URL).

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
