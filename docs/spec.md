# storyink spec

One JSON document per diagram. JSON Schema: [`schema/storyink.schema.json`](../schema/storyink.schema.json)
(set `"$schema"` to it for editor completion). `storyink validate` / `validate()` give precise
errors (JSON path, message, fix hint) and never throw.

## Common fields

| field       | type                                                              | notes                                           |
| ----------- | ----------------------------------------------------------------- | ----------------------------------------------- |
| `type`      | `architecture` `workflow` `sequence` `dataflow` `lifecycle`        | required                                        |
| `title`     | string                                                            | required; serif page heading                    |
| `subtitle`  | string                                                            | optional italic line                            |
| `direction` | `TB` (`TD`), `BT`, `LR`, `RL`                                     | graph types; **omit to auto-pick** (see below)  |
| `style`     | `{ "arrowheads": boolean }`                                       | graph arrowheads, default `false` (see below)   |
| `story`     | any                                                               | reserved for Phase 2 storyboards; warned and ignored |
| `$schema`   | string                                                            | ignored by the renderer                         |

### Auto direction

When a graph spec has no `direction`, storyink lays it out both top-to-bottom and
left-to-right and keeps the one whose viewBox aspect ratio `w/h` is closest to 16:10
(smallest `|ln(ratio / 1.6)|`; TB wins ties within 0.05). The chosen direction is reported as
`scene.direction`. Set `direction` to pin it. `BT` and `RL` are real reversals of `TB` / `LR`.

### Arrowheads

Following the Kit style, graph edges have **no arrowheads**: every wire has a 3.5 px port at both
ends and direction reads from the layout (Phase 2 adds travelling pulses). To draw heads, set
`"style": { "arrowheads": true }`; then each edge's `arrow` (`end`, `both`, `none`) applies and
the port under a head is hidden. Sequence diagrams always draw arrowheads.

## Graph types (architecture, dataflow, workflow, lifecycle)

- `nodes[]`: `{ id, label?, kind?, detail?, tag?, parent? }`
  - `id`: letters, digits, `_ . : -`; unique across nodes and groups.
  - `label` defaults to `id`; wraps at 26 characters. `detail` is a muted second line.
  - `tag`: small uppercase tag above the label; architecture/dataflow default it to the kind; `""` hides it.
  - `parent`: a group id, or (lifecycle) a node of kind `composite`. `group` is an alias.
- `edges[]`: `{ id?, from, to, label?, style?, arrow? }`. `from`/`to` may name nodes or groups.
  `style`: `solid` (default) `dashed` `thick`. `arrow`: `end` (default) `none` `both`.
  Default id is `"from->to"` (`#2`, `#3` for duplicates).
- `groups[]`: `{ id, label?, kind?, parent?, direction? }` nested containers (VPC, cluster,
  tier...). `kind` is shown after the label. `direction` lays out that group's members in their
  own direction (best-effort; composite lifecycle nodes accept `direction` too).

| type                    | kinds → shape / accent |
| ----------------------- | ---------------------- |
| all graph types         | `note`: a sticky note (connect it with a dashed `arrow: "none"` edge) |
| architecture, dataflow  | `service` panel/blue, `function` panel/rose, `database` `store` cylinder/gold, `cache` panel/sage, `queue` panel with ticks/rose, `client` panel/plain, `user` actor glyph, `external` dashed panel |
| workflow                | `start` pill/sage, `end` pill/rose, `step` panel/blue, `decision` diamond/gold, `io` parallelogram/sage |
| lifecycle               | `initial` dot, `final` bullseye, `state` panel, `composite` container, `choice` small diamond, `fork` / `join` bar across the flow |

## Sequence

```json
{
  "type": "sequence", "title": "Login", "autonumber": true,
  "participants": [{ "id": "u", "label": "User", "kind": "actor" }, { "id": "api" }],
  "messages": [
    { "id": "req", "from": "u", "to": "api", "label": "POST /login" },
    { "from": "api", "to": "api", "label": "hash", "kind": "self" },
    { "from": "api", "to": "u", "label": "200", "kind": "return" }
  ],
  "activations": [{ "participant": "api", "start": "req", "end": 2 }],
  "notes": [{ "text": "bcrypt, cost 12", "right": "api", "after": 1 }],
  "frames": [{ "kind": "alt", "label": "valid", "start": 1, "end": 2, "sections": [{ "label": "else", "start": 2 }] }]
}
```

- `participants[].kind`: `participant` `actor` `service` `database` `queue` `external`.
- `messages[].kind`: `sync` (solid, filled head), `async` (open head), `return` (dashed), `self`
  (auto when `from === to`).
- Message references (`start`, `end`, `after`) are 0-based indices or message `id`s.
- `notes[]`: one of `over: [a]` / `over: [a, b]`, `left: a`, `right: a`; `after` places the note after
  that message, **inside** the innermost frame containing it; `outside: true` places it after every
  frame that closes at that message; omitted `after` = before the first message.
- `bands[]`: `{ start, end, label? }` background band behind a message range (Mermaid `rect`).
- `boxes[]`: `{ label?, participants: [...] }` group of adjacent participants (Mermaid `box`).
- `frames[]`: `alt opt loop par critical break`; frames must be disjoint or fully nested;
  `sections` start strictly inside the frame (else / and).

## Mermaid import

| family | supported | ignored with a warning |
| ------ | --------- | ---------------------- |
| `flowchart` / `graph` → workflow | TD/TB/BT/LR/RL (real reversals); shapes `[] () ([]) [[]] [()] (()) ((())) {} {{}} >] [/ /] [\ \] [/ \]`; edges `--> --- -.-> -.- ==> === --x --o <-->`, `-- text -->`, `-. text .->`, `== text ==>`, `-->|text|`; chaining; `&`; `subgraph id [title] … end` (nested) with per-subgraph `direction` (best-effort); `%%`; front-matter `title` | `classDef class style linkStyle click`, `:::class` |
| `sequenceDiagram` | `participant`/`actor … as …`, `@{type: database}`; `->> -->> -> --> -x --x -) --)`; `Note left of/right of/over a,b` (a note right after `end` is placed outside that block); `loop alt/else opt par/and critical/option break … end`; `rect … end` → background band; `box [colour] Label … end` → participant group; `activate`/`deactivate`, `+`/`-`; `autonumber`; `title` | `rect`/`box` colours (theme colours are used), `create`, `destroy` |
| `stateDiagram` / `stateDiagram-v2` → lifecycle | `[*]` (per scope), `a --> b : label`, `state "x" as y`, `y : description`, composite `state X { }` (nested) with inner `direction` (best-effort), `direction`; `<<choice>>` small diamond, `<<fork>>`/`<<join>>` bars; `note left/right of X : text` and multi-line `note … end note` (a note node joined by a dashed line) | `--` concurrent regions (drawn as one region), `classDef`/`class`/`style`, other `<<…>>` stereotypes (plain state) |

Terminal shapes (`([ ])`, `(( ))`) become `start` when they have no incoming edges and `end`
when they have no outgoing edges. Unknown lines produce warnings, never crashes.

## Page contract (HTML)

- Hash: `#theme=light|dark`, `#chrome=0` (hide toolbar), `#t=<s|end>` (accepted, no-op in Phase 1),
  `#sheet=light,dark` (both themes side by side).
- `window.__storyink = { ready, whenReady, setTime(t), duration: 0, lint, version }`;
  `document.documentElement.dataset.ready = "1"` once hydrated and fonts are ready.
- `<script type="application/json" id="storyink-data">` holds `{ version, scene }`.
- `<script type="application/json" id="storyink-lint">` holds the in-browser lint report
  (`text-overflow`, `label-overflow`, `label-node`, `label-label`, `node-node`).

## Storyboard (`story`, opt-in)

A spec may carry `"story": { ... }` or `"story": "auto"`. The HTML then plays the diagram as
a sequence of beats; the SVG, the no-JS page, exports (by default), `#t=end`, reduced motion on load and
print all show the **final frame, which is exactly the static diagram**.

```jsonc
"story": {
  "autoplay": false,   // default: click-to-play gate; true = play when scrolled into view
  "end": "hold",       // "hold" (default) or "loop"
  "steps": [
    { "at": 0, "reveal": ["web"], "caption": "A shopper presses Pay", "stop": "Request" },
    { "at": "+0.2", "pulse": "web->gateway" },
    { "reveal": ["gateway"], "highlight": ["cache"] },
    { "at": "+0.2", "pulse": ["gateway->orders", "gateway->cache"] },
    { "pulse": { "route": ["orders->events", "events->receipts"] } },
    { "at": "+0.2", "counter": { "id": "orders", "to": 128 } }
  ]
}
```

| step field  | meaning |
| ----------- | ------- |
| `at`        | seconds (absolute, must not go backwards) or `"+x"` = x s after the previous step **ends**; default `"+0"` |
| `reveal`    | ids that appear here (fade + 6 px rise). Nodes, groups, edges, notes (`note-<i>`), frames (`frame-<i>`). Ids never revealed are visible from the start (context). Wires into hidden nodes draw on once both ends are shown. |
| `pulse`     | an edge / message id, a unique `"from->to"` (ambiguous pairs are an error), a list (parallel) or `{ "route": [...] }` (multi-hop, one ease over the whole route) or `{ "edge", "duration" }`. The wire draws on under the dot; the target glows on arrival. |
| `highlight` | ids or `{ "ids": [...], "for": 1.5 }`: flood glow + text flash |
| `caption`   | a line under the title; words fade in; the previous line dims to 0.52 |
| `counter`   | `{ "id", "to" }` (or a list): rolls a node counter (`nodes[].counter = { id, value, label, prefix, suffix }`) |
| `stop`      | chapter label: a tall scrubber tick, a beat-sheet title and a `Shift+←/→` stop |

A step **ends** when its reveals settle (react spring, 0.53 s), its pulses arrive (gather 0.34 s
+ flight 0.45–1.6 s by path length), or its caption's reading time (0.25 s + 0.075 s/word, 1–3 s)
elapses, whichever is last. After the last event the story holds 1.5 s. Glows are spaced ≥ 1/3 s
(≤ 3 flashes/s). Stories over 60 s warn.

`"story": "auto"` (or `--story auto` / tool `story: "auto"`) derives the steps: graphs reveal the
sources, then pulse breadth-first waves and reveal what they reach (edges into a group enter its
entry states, notes appear with their target); sequences pulse every message in order, with
activations, frames and notes following their messages.

### Reduced motion: "Play steps"

When motion is reduced, the viewer doesn't animate; it **steps**. The page loads on the final frame
with a static play button (no idle rings; `autoplay` is ignored). Play shows each step's
**settled** state at once (reveals shown, its pulses landed and wires drawn, counters at their new
value, the caption whole), holds it for its reading time (the caption's read time, otherwise
1.5 s), then advances, and ends on the final frame. There are no pulses in flight, trails, rings,
glows, flashes or tweens. Pause, ←/→ (Shift: chapters) and the scrubber move between settled steps
(`#t=` is quantised to the step in effect); R restarts from step 1 without the tape rewind.
Core: `steppedSchedule(timeline)`, `steppedTime(timeline, t)` and
`storyState(scene, timeline, t, { stepped: true })`.

Motion mode precedence: `#motion=full|reduced` > the viewer's **Motion** toolbar toggle (saved in
`localStorage["storyink-motion"]`, shortcut `M`) > the OS `prefers-reduced-motion`. Switching
mid-playback continues from the current step in the new mode. `storyink snapshot --motion reduced
--at …` captures stepped frames; the `reduced=stepped` gate checks that reduced frames mid-story
show no pulse in flight.

**Page contract:** `#t=<seconds|end>` seeks (paused), `#autoplay=0|1`, `#motion=full|reduced`,
`#static=1` (runtime off, final frame), `#sheet=beats` (one tile per step + final frame).
`window.__storyink = { ready, duration, steps: [{ id, label, t0, t1, stop? }], setTime(t), play(), pause(), replay(), state() }`.
Keys: space play/pause, ←/→ previous/next step (Shift: chapter), R replay.

## Animated SVG

`storyink render x.json --animated-svg x.svg [--theme light|dark|both] [--once] [--font system|embed]`,
`renderAnimatedSvg(spec, { theme, once, font, hold, reset, fps })` (`storyink/core`), or
`storyink_render` with `animatedSvg: true | "both"`. One self-contained SVG per theme whose story
plays with **SMIL**, so it animates inside a plain `<img>`: GitHub READMEs, PR comments (camo),
docs sites, chat previews.

How it's built: the story is sampled at 60 fps through the same `storyState(t)` the HTML viewer
uses (no second animation model). Each element attribute becomes a track (opacity, rise
`translate`, `stroke-dashoffset`, activation `height`, pulse `cx`/`cy`/`r`, trail dash window,
glow radius and opacity, label flash `fill`), compressed with Douglas–Peucker to the points linear
interpolation needs (tolerance 0.01 opacity, 0.3 px), and written as `<animate>` /
`<animateTransform>` with `keyTimes`/`values`. Every animation shares one `dur` and `begin="0s"`.
Captions are `<text>` lines in a header under the title (opacity × word reveal). Counters are one
`<text>` per value shown, switched with discrete `visibility` (SMIL can't change text).

- **Loop** (default): story → hold (final frame for 3 s after the last event) → 0.4 s tween back to
  the first frame → repeat. `once`: plays once, `fill="freeze"` on the final frame.
- **Fallback:** base attribute values are the final frame; no SMIL = the static diagram.
- **Self-contained:** no script, `foreignObject`, external `href`/`url()`, CSS custom properties,
  `@import` or media queries; colours are literal (theme-pinned). The output is deterministic.
- **Fonts:** `system` (default) uses `ui-monospace, SF Mono, Menlo, monospace` (Commit Mono if
  installed); `embed` adds Commit Mono as data-URI `@font-face` (+~127 KB), which Chrome renders
  in `<img>` mode. Default is `system`: files are 2–2.5× smaller, and the fallbacks share Commit
  Mono's 0.6 em advance, so the layout holds; use `embed` when the exact look matters.

| example (story)          | light, system | light, embed | dark, system | dark, embed |
| ------------------------ | ------------- | ------------ | ------------ | ----------- |
| checkout.architecture    | 84 KB         | 209 KB       | 84 KB        | 208 KB      |
| oauth.sequence           | 113 KB        | 237 KB       | 113 KB       | 237 KB      |
| order.state (auto story) | 141 KB        | 266 KB       | 141 KB       | 265 KB      |

**Limits:** no transport (play/pause, scrubbing), no click-to-play gate, no tape-rewind blur; it
always loops (or plays once) from load. No reduced-motion variant: SVG-as-image can't see the page,
and Chrome plays SMIL in `<img>` even with `prefers-reduced-motion: reduce`; use the static SVG
where motion must not start by itself. Captions show whole-line fades (no per-word stagger); counters
switch values at 30 fps rather than rolling digits, and the counter value doesn't flash. The theme
never follows the viewer: use the `<picture>` snippet. GitHub's camo caches by URL: rename the file
when the diagram changes.

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="x.dark.svg">
  <img alt="…" src="x.light.svg">
</picture>
```
