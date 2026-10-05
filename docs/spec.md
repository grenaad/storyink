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
| `story`     | object or `"auto"`                                                | storyboard; see [Storyboard](#storyboard-story-opt-in) |
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
| architecture, dataflow, workflow | `panel` window with rows, `code` window with a program, `chip` small labelled tile (see Rich nodes) |

### Rich nodes (`panel`, `code`, `chip`)

Not available in lifecycle or sequence diagrams. Examples:
[code-mode](../examples/code-mode.architecture.json),
[retry-helper](../examples/retry-helper.architecture.json),
[agent-session](../examples/agent-session.architecture.json),
[failover](../examples/failover.dataflow.json).

```json
{
  "type": "architecture", "title": "Code mode", "direction": "LR",
  "groups": [{ "id": "servers", "label": "MCP servers", "bare": true }],
  "nodes": [
    { "id": "session", "kind": "panel", "label": "Session", "size": { "cols": 32, "lines": 6 },
      "rows": [
        { "id": "ask", "tag": "You", "text": "File GitHub bugs in Linear." },
        { "id": "exec", "icon": "wrench", "text": "EXECUTE", "detail": "{ code }", "status": "done" },
        { "id": "found", "text": "tools.github.list_issues", "indent": 1, "muted": true }
      ] },
    { "id": "code", "kind": "code", "label": "Code mode", "lang": "ts",
      "code": ["const issues = await tools.github.list_issues()", "return issues.length"] },
    { "id": "github", "kind": "chip", "label": "github", "icon": "plug", "parent": "servers" },
    { "id": "sentry", "kind": "chip", "label": "sentry", "icon": "plug", "parent": "servers", "muted": true, "stack": 2 }
  ],
  "edges": [
    { "id": "call", "from": "session#exec", "to": "code#1" },
    { "id": "gh", "from": "code", "to": "github" },
    { "from": "code", "to": "sentry" }
  ]
}
```

- **`panel`**: a window (header = `label`, optional `icon`) with `rows[]`:
  `{ id?, tag?, icon?, text?, detail?, status?, indent?, muted? }`. `tag` is a small uppercase
  line above the text, `detail` muted text after it, `status` the rest glyph in the right slot
  (`none` `running` `done` `error`), `indent` 0–4 (2 columns each), `muted` dims the row at rest.
  Row ids start with a letter or `_`. Text wraps at `size.cols` (default 40).
- **`code`**: a window showing `code` (string split on newlines, or an array of lines; tabs become
  2 spaces), syntax-coloured by `lang`: `ts` (default), `js`, `json`, `py`, `go`, `rust`, `sql`, `yaml`, `sh`, `text`
  (aliases `python`, `golang`, `rs`, `yml`, `bash`/`shell`/`zsh`, `typescript`/`tsx`,
  `javascript`/`jsx` are accepted and normalized).
- **`size`** (`panel`, `code`): `{ cols?, lines? }` reserves body space. The box is also sized to fit
  every version a story `set`s, so content swaps and typing never resize the node.
- **`chip`**: a small tile with `icon` + `label`; `stack: 1..3` draws sheets peeking below it
  ("more of these").
- **`icon`**: `wrench` `plug` `file` `terminal` `search` `globe` `bolt` `user` `spark`.
- **`muted: true`** (any graph node): drawn at 0.42 at rest; a story `undim` lifts it.
- **Bare groups**: `groups[].bare: true` draws only the label (a column heading), no box.
- **Anchors**: an edge end (and most story targets) may name a panel row `node#rowId` or a 1-based
  code line `node#3`; the wire then attaches at that row or line's height. The first `#` splits;
  exact edge ids such as `a->b#2` are matched first.

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

- Hash: `#theme=light|dark`, `#chrome=0` (hide toolbar), `#t=<s|end>` (seek, paused; on a spec
  without a story it is accepted and has no effect), `#sheet=light,dark` (both themes side by side).
  The storyboard adds more (see the page contract under [Storyboard](#storyboard-story-opt-in)).
- `window.__storyink = { ready, whenReady, setTime(t), duration: 0, lint, version }`;
  `document.documentElement.dataset.ready = "1"` once hydrated and fonts are ready.
- `<script type="application/json" id="storyink-data">` holds `{ version, scene }`.
- `<script type="application/json" id="storyink-lint">` holds the in-browser lint report
  (`text-overflow`, `label-overflow`, `label-node`, `label-label`, `node-node`).

## Storyboard (`story`, opt-in)

A spec may carry `"story": { ... }` or `"story": "auto"`. The HTML then plays the diagram as
a sequence of beats; the SVG, the no-JS page, exports (by default), `#t=end`, reduced motion on load and
print all show the **final frame, which is exactly the static diagram**. With content steps the
final frame is the story's end state, not necessarily the spec as written: a `set` shows the last
version, a `clear` / `hide` / `unwire` leaves the target empty / hidden / undrawn, `dim` levels
stay. The compiler warns when the end state still shows a spinner (`running`) or a persistent
`glow`.

```jsonc
"story": {
  "autoplay": false,   // default: click-to-play gate; true = play when scrolled into view
  "end": "hold",       // "hold" (default) or "loop"
  "motion": "full",    // "full" (default), "reduced" or "system"; see Reduced motion below
  "pace": 0.6,         // reading holds after each beat × pace (default 0.6; 0 = none, 1.5 = slower)
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
| `at`        | seconds (absolute, must not go backwards) or `"+x"` = x s after the previous step **ends**; default `"+0"`. With reading holds an absolute `at` is a **minimum**: a step that starts a beat never starts before the previous beat's hold ends |
| `reveal`    | ids that appear here (fade + 6 px rise). Nodes, groups, edges, notes (`note-<i>`), frames (`frame-<i>`). Ids never revealed are visible from the start (context). Wires into hidden nodes draw on once both ends are shown. |
| `pulse`     | an edge / message id, a unique `"from->to"` (ambiguous pairs are an error), a list (parallel) or `{ "route": [...] }` (multi-hop, one ease over the whole route) or `{ "edge", "duration" }`. The wire draws on under the dot; the target glows on arrival. |
| `highlight` | ids or `{ "ids": [...], "for": 1.5 }`: flood glow + text flash |
| `caption`   | a line under the title; words fade in; the previous line dims to 0.52 |
| `counter`   | `{ "id", "to" }` (or a list): rolls a node counter (`nodes[].counter = { id, value, label, prefix, suffix }`) |
| `stop`      | chapter label: a tall scrubber tick, a beat-sheet title and a `Shift+←/→` stop |
| `hold`      | seconds: the reading hold after the beat this step ends, overriding the computed one (not scaled by `pace`; `0` = go straight on) |
| `id`        | step id (beat sheets, `__storyink.steps`) |

Story options beside `steps`: `spotlight: true` (a soft light follows the action; `focus` steers
it), `spotlight: "veil"` (dims everything outside the step's focus box, see
[Change stories](#change-stories)) and `rewind: "tape"` (default) or `"glitch"` (the loop / R replay reset effect in the HTML
viewer). A pulse may also be `{ "edge", "reverse": true }` (travels to → from) and take
`"delay": s` (starts that long after its step; a list of delayed pulses staggers).

#### Content steps (rich nodes, rows, lines, edges)

```json
"story": {
  "pace": 0, "spotlight": true, "rewind": "glitch",
  "steps": [
    { "at": 0.5, "type": "session#ask", "stop": "Ask" },
    { "reveal": "session#exec", "status": { "id": "session#exec", "to": "running" } },
    { "wire": { "edge": "call", "duration": 0.45 } },
    { "type": { "id": "code", "cps": 160 } },
    { "line": "code#1", "pulse": { "edge": "gh", "duration": 0.3 }, "glow": "github" },
    { "pulse": { "edge": "gh", "reverse": true }, "unglow": "github", "line": { "id": "code", "off": true } },
    { "status": { "id": "session#exec", "to": "done" }, "dim": "session#ask" },
    { "set": { "id": "code", "code": ["return 42"] }, "type": "code" }
  ]
}
```

| step field | meaning |
| ---------- | ------- |
| `type`     | typewriter on a `code` node or a panel row `node#row`: id or `{ id, by?, cps?, duration? }`. Code types by `char` (default 90 chars/s, `cps` overrides, `duration` fixes the total; a caret follows); rows type by `word` (words fade in, 0.3–2.8 s). Typing speed is **not** scaled by `pace` (pace only sets the reading holds between beats); a beat's stop waits for its typing. Typing a row also reveals it. |
| `set`      | swap content with a 0.25 s crossfade: `{ id, code? }` on a code node, `{ id, text?, detail?, tag? }` on a row, `{ id, label? }` on a panel, code or chip node (header / chip label), `{ id, label?, detail?, tag?, tone? }` on a plain graph node (see [Tones](#tones-colour-carries-meaning)). Set + `type` in the same step starts the new version empty and types it. |
| `clear`    | fade a code node's / row's content out (type again only after a `set`). |
| `line`     | active-line bar on a code node: `"code#2"`, `"code#2-4"`, `{ id, lines }`, or `{ id, off: true }`. |
| `status`   | `{ id: "node#row", to }` with `none` `running` (spinner + shimmer sweep over the text) `done` (check draws on) `error` (cross). Also `{ id: "<plain node>", to }`: the glyph at the start of the node's detail line. |
| `dim` / `undim` | lower to a level (`"x"`, a list, or `{ ids, to }`; default 0.42) / back to 1. Nodes, groups, edges, rows. Independent of visibility: a dimmed thing that is hidden and shown again comes back dimmed. |
| `hide` / `show` | take a visible thing away / bring it back (fade). Unlike `reveal`, which marks something as *new* (absent until its step, with a rise), `hide`/`show` act on things already in the diagram and can repeat. |
| `wire` / `unwire` | draw an edge on at wire speed (hidden before the step) / retract it source end first; `"edge"` or `{ edge, duration }`. |
| `glow` / `unglow` | persistent glow on a node until `unglow` (a pulse's arrival glow is separate and brief). `{ "ids", "tone" }` glows in a tone's colour; a glow in another tone takes over from the current one. |
| `tone`     | colour elements by what they are: `{ ids, to, stagger? }` or a list (see [Tones](#tones-colour-carries-meaning)). |
| `focus`    | an id, or a list of ids (their union box), the follow camera, the spotlight and the veil aim at for this step. |
| `change`   | change diagrams: apply these elements' delta look with motion (see [Change stories](#change-stories)). |

Mistakes are diagnostics with a hint, never crashes: typing a cleared target, a line past the
program's last line, `undim` on something not dimmed, a status that doesn't change, and so on.

#### Tones (colour carries meaning)

Colour says what the data is. Five **tones**, the same names and colours as page tones:
`note` (blue: a request, data in flight) · `warn` (gold: pending, processing) · `risk` (rose: a
failure, a leak) · `good` (sage: approved, done) · `neutral` (ink). Diagrams use the tone's ink
and a **tint** (the ink mixed into the node face, ~16 % light / 20 % dark), in both themes'
house style.

```jsonc
"steps": [
  { "caption": "A *request* leaves the browser",
    "pulse": { "route": ["client->gateway", "gateway->orders"], "tone": "note", "label": "POST /orders" } },
  { "status": { "id": "orders", "to": "running" },
    "set": { "id": "orders", "detail": "charging card…", "tone": "warn" },
    "pulse": { "edge": "orders->payments", "tone": "warn", "label": "charge $42.00", "tint": true } },
  { "tone": { "ids": ["payments", "orders->payments", "orders->alerts"], "to": "risk", "stagger": 0.15 } },
  { "pulse": { "route": ["client->gateway", "gateway->orders"], "reverse": true, "tone": "good",
               "label": "201 Created", "stain": true, "land": "edge" } }
]
```

**Pulse options** (object form; all optional; `edge`, `route`, lists, `reverse`, `delay` as before):

| field   | meaning |
| ------- | ------- |
| `tone`  | dot, halo, trail, arrival ring and arrival glow in the tone (absent: the usual pulse ink). |
| `label` | payload text riding with the dot: mono, 10 px, horizontal, above a horizontal wire and right of a vertical one (it glides around corners), in the tone (muted ink without one). Placement follows the **label track** (below): it appears at departure parked clear of the source box, follows the dot, parks clear of the destination box and stays fully visible until the dot touches it, then fades out over 0.2 s. Over 32 chars it is clipped with "…" (warning). Layer gaps widen to give labelled wires room. Sequence messages take `tone` and `label` too. A labelled pulse flies slower so the label can be read in flight (see **Labelled pulse timing** below). |
| `land: "edge"` | with a `label`: on arrival the label becomes the arriving edge's label (crossfading with any label it had; part of the end state). The layout reserves the label slot for the widest version. |
| `tint: true` | with a `tone`: on arrival the target node takes the tone (a tone event at the arrival time). |
| `stain: true` | with a `tone`: each wire of the route keeps the tone from the moment the dot leaves it, until a later stain or `tone` changes it. |

**Label track.** Per hop the label has a window of arc lengths where its footprint clears both end
boxes: half its width + 8 px on a horizontal run, a text line (12 px) + 8 px on a vertical one,
judged by the wire's direction over the hop's first / last 40 px. The label sits at the dot's
position clamped into the current hop's window: held at the source side (fading in over 0.15 s
from departure) until the dot catches up, then moving with the dot, then held at the destination
side while the dot arrives; at full opacity through contact; fading out over 0.2 s after arrival
(with `land: "edge"` that fade overlaps the edge label's crossfade in). Between hops (the dot
crossing an intermediate node, at least 24 px of travel) the label fades out at the old hop's end
and back in on the next hop, never drawn across the node. A hop too short for the label's window
pins it at the hop's midpoint, where it may touch a box. Playback, snapshots and the animated SVG
share this one rule. Reduced motion has no flights and so no labels.

**Labelled pulse timing.** Unlabelled pulses keep their flight: route length / 520 px/s, clamped
to 0.45–1.6 s, eased with `inOutCubic`. A pulse with a `label` instead *cruises* (speed ramps up
over the first 20 % of the flight, holds, ramps down over the last 20 %) and gets a reading
budget of **0.6 s + 0.05 s per shown character** (after clipping to 32). The flight is that budget
divided by the share of the flight in which the label moves with the dot (inside a hop's label-track
window, not held and not mid-handoff), clamped to **1.2–3.2 s** and never faster
than the unlabelled flight. Short wires therefore slow most; long wires barely change; a wire too
short for the label to ever follow the dot uses 1.2 s (the label is held, still readable). An explicit `duration` always wins. The flight is part of
the compiled timeline, so playback, step moves, rewinds, snapshots and the animated SVG share it;
`pace` still scales only the reading holds between beats, not flights.

**`tone` step field**: `{ "ids": id | [ids], "to": tone | null, "stagger"?: s }` or a list.
Targets: graph nodes (every kind, panels / code / chips too), groups and edges (`"a->b"` works).
A toned node gets a tinted face, a stroke, ink bar, tag and detail line in the tone; its label
stays ink. A toned edge: wire, heads, ports and label. A group: border and label. `to: null`
clears back to the rest look. Changes crossfade over 0.35 s (the old tone's layer out, the new
one in); `stagger` delays each id after the first in list order (a contagion sweep). Tones
persist into the final frame. Sequence diagrams: an error (tone the pulses instead).

**`set` and `status` on plain graph nodes.** `set: { id, label?, detail?, tag?, tone? }` crossfades
(0.25 s) each field on its own. `tone` colours only the detail line (it wins over the node's tone
for that line); a `set` with only a `tone` keeps the text, a new `detail` without a `tone` is
untoned. `status: { id: "<node>", to }` draws the row glyphs (spinner / check / cross) at the
start of the detail line; a node the story gives a status has its detail line left-aligned after a
reserved glyph slot. Boxes are sized for every version the story sets (and the detail line exists
if any version has one), so nothing resizes mid-story. Panels / code / chips keep their own `set`
fields (rows, code, label); `detail` / `tag` / `tone` on them are errors.

**Toned glow.** `glow: { "ids": [...], "tone": "warn" }`: a persistent glow in the tone's ink with a
toned rim; string / list forms are unchanged.

**Caption emphasis.** `*phrase*` in a `caption` draws that phrase in the accent colour (`note`;
an act's tone once acts exist); `\*` is a literal asterisk, an unpaired `*` stays as is. Beat
tiles, scrubber labels, `__storyink.steps` and narration fallbacks show the text without the
asterisks.

Diagnostics: unknown tones and ids get a did-you-mean; `tint` / `stain` without a `tone` and
`land` without a `label` warn; a clipped label warns; a `tone` that changes nothing warns; a plain
node still `running` at the end warns; unknown pulse fields warn with a did-you-mean.

**Under the hood** (all pure functions of time, so the viewer, snapshots, beat sheets, the follow
camera and the animated SVG agree): `timeline.tones[id] = [{ t, to }]` (tone steps, tints and
stains, time-sorted) → `frame.tone[id][tone]` layer opacities (`toneFrame`); pulses carry `tone` /
`label` → `frame.pulses[].tone` / `.label`; landed labels are label versions `"<edge>@elabel"` and
plain-node text versions `"<node>@label|@detail|@tag"` in `timeline.versions`; node statuses in
`timeline.status["<node>"]`; toned glows are `lit` windows with a `tone` → `frame.litTone`;
caption emphasis is `captions[].em` (char ranges of the plain text). The renderer draws one layer
per element and tone the story uses (`si-tone si-t-<tone>`), whose opacity is the only animated
property in the SMIL output. Specs without tones render byte-identically (no tone CSS / palette).

A step **ends** when its reveals settle (react spring, 0.53 s), its pulses arrive (gather 0.34 s
+ flight 0.45–1.6 s by path length), or its caption's reading time (0.25 s + 0.075 s/word, 1–3 s)
elapses, whichever is last. After the last event the story holds 1.5 s. Glows are spaced ≥ 1/3 s
(≤ 3 flashes/s). Stories whose authored timing (without reading holds) runs over 60 s warn.

**Reading holds.** In continuous play the story pauses after each **beat** (see Beats) so the
reader can take in what it did, without slowing the animation itself:
- the hold is `1 s + 0.3 s per word` of the beat's caption (its last), clamped to 1.5–6 s, or
  0.8 s for a beat without a caption; × `story.pace` (default **0.6**); a step's `hold` overrides it
  for the beat it ends. Core: `readingHold(caption)`.
- It starts once the beat is visually still (its step ends, arrival rings, cooling trails, glows
  and label flashes, implicit reveals, counter rolls) and nothing on the diagram changes during
  it; the beat's caption stays up through it.
- The compiler inserts it (so `storyState(t)`, the viewer, the scrubber and ticks, beat sheets,
  snapshots and the animated SVG all agree): a beat's first step starts no earlier than the
  previous beat's still point + hold. Relative `"+x"` steps shift; an absolute `at` is a
  minimum; a step whose own timing already leaves that room adds nothing. `pace: 0` is the
  authored (pre-0.3.5) timing, `pace: 1` the 0.3.5 holds.
- No hold after the last beat (the 1.5 s end hold stays). Stepped (reduced-motion) playback holds
  each stop for the same number. → / ← step moves stop at the settled beat and don't wait: the
  reader sets the pace there. The compiled hold is on the beat's last step (`timeline.steps[i].hold`).
  `storyink render --pace N`, tool `storyink_render` `pace`.
- **Readers change it in the viewer.** The toolbar's **Pauses** button shows the pace in effect
  (`Pauses: Normal`; the tooltip marks the author's value as the default) and cycles through the
  presets **None (0) · Short (0.3) · Normal (0.6) · Long (1.0) · Longer (1.5)** on click; `[` / `]`
  step down / up. The HTML embeds `timeline.source` (node / group parents and the story with auto
  steps expanded, a few KB) and `timeline.pace`; the viewer recompiles the timeline in the browser
  with the same `compileStory` (`recompilePace(scene, pace)`, identical to `render --pace`). The
  playback position moves to the same beat with the same progress through it
  (`mapStoryTime(from, to, t)`: the part of a beat before its hold keeps its offset, the rest maps
  proportionally) and playback carries on; the duration, scrubber ticks, → / ← stops, stepped
  holds and the follow camera use the new timeline.
- **Precedence:** `#pace=<n>` > the reader's choice (`localStorage["storyink-pace"]`) > the
  author's `story.pace` > 0.6. `storyink snapshot --pace N` (tool `storyink_snapshot` `pace`) pins
  it for every capture; by default snapshots use the HTML's author pace, so gates stay deterministic.
- The **animated SVG** has no script, so no Pauses control: it plays with the pace it was built with.

`"story": "auto"` (or `--story auto` / tool `story: "auto"`) derives the steps: graphs reveal the
sources, then pulse breadth-first waves and reveal what they reach (edges into a group enter its
entry states, notes appear with their target); sequences pulse every message in order, with
activations, frames and notes following their messages.

### Acts: problem → rewind → fix (`story.acts`)

One stage, several scenarios. The first act shows the problem; a **rewind** plays it backwards to
its start, the topology changes in place (wires retract, a node appears in the gap, new wires draw)
and the same request is replayed through the fix. Graph diagrams only (a sequence with `acts` is an
error).

```jsonc
"story": {
  "acts": [ { "id": "before", "label": "raw CLI", "tone": "risk" },
            { "id": "after",  "label": "with broker", "tone": "good" } ],
  "steps": [ /* act 1 starts at step 0 */ …,
             { "act": "after", "enter": "rewind", "caption": "Same request, with a broker" }, … ]
}
```

- **`acts`**: 2–6 `{ id, label, tone? }` with unique ids. `label` is the act chip's text; `tone`
  colours the chip's dot and the caption `*emphasis*` of that act's steps.
- **`act`** (step field) starts that act: acts start in declared order, each once; the first act
  starts at step 0 unless a step names it there. Steps belong to the act most recently started.
  The entry step is a chapter (its `stop` defaults to the act label).
- **`enter`** (acts after the first): `"rewind"` (default) · `"cut"` · `"continue"`.
- **Membership**: any node, group or edge may say **`in: [actIds]`**. Without `in`, an element with
  `delta: "removed"` is in the first act only, `delta: "added"` in every act but the first, anything
  else in every act. An edge is also limited to the acts both its ends are in. In act stories the
  delta *look* is off (no ghosts, badges, delta colours or legend; tones carry the meaning); `delta`
  still feeds summaries, the drawer and narration. Membership composes with `reveal`, `hide` /
  `show` and `wire` (those act within the acts where the element exists).
- **Layout**: node and group positions come from one layout of every act, so nothing moves between
  acts. Each edge is **routed against only the boxes that coexist with it** (on stage in one of
  its acts): a first-act wire `agent → cli` runs straight through the slot of an after-only node
  placed between them. Browser lint ignores pairs that never share an act. Specs without acts
  route exactly as before.
- **Transitions** (compiled into the timeline, so the viewer, snapshots, beat sheets, the follow
  camera and the animated SVG agree):
  - `rewind`: after the previous act's last beat settles (and its reading hold), a window of
    `clamp((actEnd − actStart) / 4, 0.6, 1.5)` s plays the previous act **backwards** to its start
    (eased): the frame at time t is the story state at the mapped earlier time, so pulses fly back
    and tones, text and statuses revert. Captions are hidden in the window. The HTML viewer adds
    the glitch and blur of the R rewind; the animated SVG plays the plain reverse.
  - `cut`: a 0.4 s dip (the diagram fades out and back in) to the previous act's start.
  - `continue`: no reset.
  - Then the **morph**: leaving wires retract (0.5 s), leaving nodes / groups fade (0.35 s),
    entering ones reveal (fade + rise, 0.53 s), entering wires draw on (0.6 s) once both ends show;
    empty stages are skipped. Elements a step of the new act reveals are left to that step. The
    entry step's own events and caption follow; the rewind + morph are its beat (camera focus: the
    leaving and entering elements).
  - After a rewind or cut the act starts from the previous act's **start state**: the steps of
    the undone act no longer count (its tones, statuses, text versions, counters, reveals and
    wires are gone), while `continue` keeps everything.
- **Act chip**: "● label" (dot in the act tone, mono) pinned to the HTML stage's top-right corner
  (not affected by pan / zoom), "◀◀ rewind" (muted) during a rewind, 0.25 s crossfade; in the
  animated SVG right-aligned in the header row.
- **Exports**: `#act=<id>` seeks (paused) to the act's settled end; `#sheet=acts` shows one tile
  per act side by side (the problem | fix diptych). `storyink snapshot --act <id>` and
  `--sheet acts` (tool `storyink_snapshot` `act`, `sheet: "acts"`); `storyink render --svg out.svg
  --act <id>` writes that act's settled end as the static SVG.
- **Timeline**: `timeline.acts = [{ id, label, tone?, t0, t1, body, enter?, rewind?: { t0, t1,
  from0, from1 }, cut?: {…}, morph?: { t0, t1 }, state? }]` (`state`: the act's persistent
  channels, with undone steps moved to "never"); frames carry `act: { k, id, chip, rewind?, dip? }`.
- **Diagnostics**: unknown act ids in `in` / `act` / `enter` (did-you-mean), acts out of order or
  started twice, an edge never on stage (error), an act that never starts or has no steps, `enter`
  on a step that starts no later act, and `change` steps in act stories (warnings).

### Annotations (`annotations`)

A single mono line (tag-sized) attached to a node, left-aligned with its left edge, just above
(`side: "top"`, default) or below its box. Graph diagrams.

```jsonc
"annotations": [ { "id": "chat", "on": "agent", "text": "chat ▸ sk-live-7Hq2…", "tone": "risk" } ]
```

- `{ id, on: nodeId, side?: "top" | "bottom", text, tone?, in?: [acts] }`. Ids share the node
  namespace. Muted ink without a tone.
- **Room**: the layout reserves the line's band around the node (both sides, so centres stay
  aligned) and wide enough for every version, so it never overlaps nodes, groups or edge labels
  (labels avoid it); wires still attach to the node face. Nothing resizes mid-story.
- **Story**: `reveal`, `hide` / `show`, `tone`, `type` (`{ id, by?: "char" | "word", cps? }`; char
  by default, 28 chars/s, with a caret), `set` (`{ id, text?, tone? }`; a new text is untoned unless
  the set gives a tone; 0.25 s crossfade) and `clear` take annotation ids. An annotation whose
  first appearance is a `type` is hidden until then (typing starts empty).
- **Acts**: an annotation follows its node's acts unless it says `in`; it comes and goes with the
  morph. After a rewind its text is back to the act's start (a typed line is empty again), so a
  later act can `set` the same slot to the opposite tone — the before / after in one place.
- It goes with its node (reveal, hide / show).

### Toasts (`toast`, `dismiss`)

Small floating cards near a node: the title in ink, the text in its tone, a tone stripe.

```jsonc
{ "toast": { "id": "p1", "near": "cli", "title": "Allow access?", "text": "vault CLI wants 1 secret", "tone": "warn" } }
{ "toast": { "near": "broker", "title": "approved once ✓", "text": "no more prompts", "tone": "good", "for": 2.8 } }
{ "dismiss": "all" }
```

- `toast`: `{ id?, near: nodeId, title?, text, tone?, for?: s }` or a list. The default id is
  `toast-<step>-<k>` (1-based). `for` fades it by itself after that many seconds; otherwise it stays
  until a `dismiss` names it (ids, or `"all"` up at that moment).
- **Placement** is deterministic and done by the layout over the story's toast steps in order
  (visibility simulated by step order and dismissals; a `for` toast counts as up until dismissed
  or its act ends, so slots never collide): candidate slots above the anchor first (centred, then
  shifted left / right by card width + gap, then a row higher), then below; never over nodes,
  groups (other than the anchor's), edge labels, annotations or toasts up at the same time. The
  viewBox grows to fit them, so the fit and follow cameras include them. Slots are stored on the
  scene (`scene.toasts`).
- **Motion**: appear = fade + 4 px rise + scale 0.96 → 1 (0.3 s); dismiss / expiry = fade
  (0.25 s). Reduced motion shows them settled.
- `tone` steps take toast ids (a contagion sweep turns them rose too); `hide` / `show` too.
- **Acts**: a toast belongs to the act it appears in; a rewind plays it backwards and the next act
  starts without it (after a rewind / cut). A toast still up when its act ends or at the end of the
  story is a **warning** (the static diagram would show it).
- Timeline `toasts: { [id]: { t0, t1? } }`; frames carry `toasts: { [id]: { o, dy, s } }`.

### HUD metrics (`story.hud`)

Big mono `label: value` numbers on the stage — the metric that drops between the problem and the
fix ("prompts: 4" → "prompts: 0").

```jsonc
"story": { "hud": [ { "id": "prompts", "label": "prompts", "value": 0 } ], "steps": [ …,
  { "counter": { "id": "prompts", "to": 1 } }, …, { "tone": { "ids": "prompts", "to": "good" } } ] }
```

- `{ id, label, value?: number (default 0), tone?, prefix?, suffix?, at?: "top-right" |
  "bottom-left" }`. Ids share the element namespace.
- Driven by the existing **`counter`** step (`{ id: hudId, to }`; rolling value like node
  counters). `tone`, `reveal`, `hide` / `show` take HUD ids (a revealed HUD is hidden until its
  step). A rewind reverses it like anything else; after it the value is back to the act's start.
- **Where**: the HTML viewer pins it to the stage (not affected by pan / zoom), top-right below the
  act chip (or bottom-left); beat / act sheet tiles show it in their caption line; the animated
  SVG gives it a header row of its own. The static SVG (no header) does not show it.
- Timeline `hud: [{ id, label, value, tone?, prefix?, suffix?, at }]`; values in `counters[id]`.

### Motion mode (`story.motion`)

The author picks how the story plays; **the default `"full"` animates even when the reader's OS
asks for reduced motion** (`prefers-reduced-motion: reduce` is ignored).
- `"full"` (default): always the animated gate, autoplay if set, full playback.
- `"reduced"`: always stepped playback (below).
- `"system"`: follow the reader's `prefers-reduced-motion` (the 0.3.0 behaviour). Use this to
  honour the OS setting.

`"story": "auto"` uses the default; to set it on an auto story write
`"story": { "steps": "auto", "motion": "system" }` (or `storyink render --motion system`, tool
`storyink_render` `motion`). Readers can always switch with the toolbar's **Motion** toggle (`M`).

### Beats

A **beat** is one or more consecutive steps that read as a single change: `beatGroups(timeline)`.
A step joins the next when the next starts at the same time, or is chained straight on (`"+0"`,
within 50 ms of this step's end) and, without starting a chapter (`stop`), either adds no caption of
its own or reveals the box this step's pulse arrives at. So a pulse and the reveal of its target
are always one beat. A beat's **stop** is its last step's settled time: its reveals at full
opacity, its dots landed, counters at their value, its caption fully typed (`beatStops`). Beats
drive step moves (→ / ←), stepped (reduced-motion) playback, the scrubber's ticks (`beatTicks`)
and beat tiles (which may merge further to fit 12 tiles). Chapters (Shift+→ / ←) are the stops of
beats holding a `stop` (`beatChapters`).

### Reduced motion: "Play steps"

When motion is reduced, the viewer doesn't animate; it **steps**. The page loads on the final frame
with a static play button (no idle rings; `autoplay` is ignored). Play shows each beat's
**settled** state at once (reveals shown, its pulses landed and wires drawn, counters at their new
value, the caption whole), holds it for its reading time (the caption's read time, otherwise
1.5 s), then advances, and ends on the final frame. There are no pulses in flight, trails, rings,
glows, flashes or tweens. Pause, ←/→ (Shift: chapters) and the scrubber move between settled beats
(`#t=` is quantised to the beat in effect); R restarts from step 1 without the tape rewind.
Core: `steppedSchedule(timeline)`, `steppedTime(timeline, t)` and
`storyState(scene, timeline, t, { stepped: true })`.

Motion mode precedence: `#motion=full|reduced` > the reader's **Motion** toolbar toggle (saved in
`localStorage["storyink-motion"]`, shortcut `M`) > the author's `story.motion` (default `"full"`) >
the OS `prefers-reduced-motion`, consulted only when the author chose `"system"`. Switching
mid-playback continues from the current step in the new mode. `storyink snapshot --motion reduced
--at …` captures stepped frames; the `reduced=stepped` gate checks that reduced frames mid-story
show no pulse in flight.

### Follow camera (`story.camera`)

Large diagrams fit the window at a scale where the 11 px labels are unreadable. While the story
plays, the viewer's camera **follows** it (`story.camera: "follow"`, the default; `"fit"` keeps
the whole diagram in view):
- **Focus per step.** `stepFocus(scene, timeline, i)` (core) is the padded (24 px) bounding box of
  everything step i animates: reveals (including groups, activations and notes revealed with
  them), pulse routes, faded-in wires, highlights and arrival glows, counter nodes.
- **On Play.** If fit renders labels below 10 px, the camera zooms to the **readable scale**
  (labels ≈ 12.4 px on screen: 12.5/11 snapped down to a 1/64 step, capped at 2×) on the current
  step's focus. If fit is readable it stays at fit and only pans when needed.
- **While playing** it keeps the step's focus inside a **dead zone**, the inner 80 % of the stage
  (above the transport bar), moving only when the focus leaves it. A move centres the focus with
  a bounce-free spring (`visualDuration` 0.75 s), keeps the zoom and never pans past the
  diagram's edge (24 px margin). A focus larger than the dead zone zooms out just enough; the next
  smaller focus zooms back.
- **Reader input.** A manual zoom (wheel, −/+, Fit) becomes the follow scale: follow then only
  pans. A drag during playback suspends follow for the current step; it resumes on the next step
  whose focus is out of view.
- **The end.** Once every event has settled (final hold, ended) it eases back to fit.
- **Reduced motion** (stepped playback): the camera jumps, no easing.
- **Seeking** with the scrubber or ←/→ moves the camera to that step (animated in full motion,
  jumped in reduced). `#t=` loads and `setTime()` don't move it.
- **Follow toggle** in the toolbar (`aria-pressed`, shortcut `F`), saved in
  `localStorage["storyink-follow"]` (`on`/`off`). Precedence: `#camera=` > the toggle >
  `story.camera`. Set it on auto stories with `{ "steps": "auto", "camera": "fit" }`,
  `storyink render --camera fit` or tool `storyink_render` `camera`.

Determinism: the followed view is a pure function of (t, stage size, base scale):
`cameraAt(scene, timeline, t, viewport, k?)` plays the dead-zone moves forward from fit through
steps 0…i (the same moves the live viewer makes when nobody touches it). `#camera=follow&t=…`
places that camera on load; `storyink snapshot --camera follow --at …` (tool `camera`) captures it
in a 16:9 stage (`--width`, default 1280×720) with a `follow-deterministic` gate. Everything else
(snapshots without `--camera`, beat sheets, `#t=` alone, gates) stays at fit. Other core helpers:
`fitCamera`, `readableScale`, `followStep`, `inView`, `stepAt`, `CAMERA` (parameters). The
animated SVG (SMIL) has no follow camera.

**Page contract:** `#t=<seconds|end>` seeks (paused), `#autoplay=0|1`, `#motion=full|reduced`,
`#camera=follow|fit` (with `#t=`, `follow` shows the followed view),
`#static=1` (runtime off, final frame), `#sheet=beats` (one tile per step + final frame).
`window.__storyink = { ready, duration, steps: [{ id, label, t0, t1, stop?, narrate? }], setTime(t), play(), pause(), replay(), step(dir, chapter?), stepAnimated(), state(), camera(), pace(), setPace(n) }`;
`duration` and `steps` follow the timeline in effect (the reader's pace); `pace()` / `setPace(n)`
read and set it (`setPace` is the reader's choice, stored like the toolbar's);
`step(1 | -1, chapter?)` is the animated step move below and returns a Promise that resolves when
the move ends (or is interrupted); `stepAnimated()` is the running move `{ dir, target }` or null.
`state()` reads the clock and mode directly (no render lag).
`camera()` returns `{ mode, follow, k, x, y, goal, step, engaged, suspended, userK, viewport }`
(a diagram point p is drawn at `x + (p.x − viewBox.x)·k`).
Keys: space play/pause, →/← step moves (Shift: by chapter), R replay, M motion, F follow,
[ / ] pauses shorter / longer, 0 fit, +/− zoom. `#pace=<n>` sets the reading-hold pace.

**Step moves (→ / ←).** In full motion the arrows animate **the graph only**; the text never
makes the reader wait:
- **→** plays forward at normal speed to the **end of the next beat's graph motion**
  (`beatMotionEnds`): its pulses have arrived and its reveals, wire draw-ons (implicit ones too)
  and counter rolls have reached their end state. Not its caption typing or reading time, glows,
  label flashes, cooling trails or arrival rings: the stop frame may still show those fading.
  Then it pauses. While playing (or paused mid-hold), → skips straight to the next beat: the rest
  of a reading hold, or any authored gap after a beat's motion, is skipped (`skipGap`,
  `beatMotionStarts`). **Shift+→** does the same to the next chapter (`beatMotionChapters`).
- **←** rewinds the graph: time runs **backwards at 2×** (pulses fly back) to the previous beat's
  motion end, skipping the gaps between beats, with a short bounce-free ease (0.12 s, never
  below 0.3×). No blur (the blur stays with R's tape rewind). **Shift+←** goes to the previous
  chapter.
- **Captions show at once.** From the moment a move starts, the beat's caption is shown whole
  (no word typing, no fade): the beat being animated on →, the target beat on ←; it stays while
  paused at the stop. This is a render option, `storyState(…, { captionBeat: k })`
  (`captionForBeat`: the beat's last caption, else the line still on screen when it starts);
  the default `storyState` (continuous play, snapshots, the animated SVG) is unchanged and types
  captions. Play, a seek or R types captions again.
- **Repeated presses** in the direction of a running move extend its target to the following
  beat; the opposite key reverses toward the boundary adjacent to the current time.
- **Space** pauses a move; the scrubber still seeks directly; R is the tape-rewind replay.
- The follow camera follows moves like playback, backwards too.
- **Reduced motion** keeps instant jumps between settled beats (`beatStops`, `beatChapters`) and
  its stepped holds.
- The scrubber ticks and `__storyink.steps` keep beat / step starts.
Core: `beatMotionEnds`, `beatMotionStarts`, `beatMotionChapters`, `beatIndexAt`, `captionForBeat`,
`skipGap`, `stepBoundary`, `stepMoveTarget`, `stepMoveSpeed`, `STEP_MOVE`.

**Wire geometry.** Everything animated along a wire (the pulse dot, its trail, the flight draw-on
spans, the SMIL trail route) uses `flattenPath(edge.d)`, a dense polyline of the drawn rounded
wire (quadratic corners sampled to < 0.1 px), never the route's corner points. Multi-hop routes
keep each hop's start, so the dot crosses the node straight between hops. `edge.length` is the
rounded wire's length.

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
| code-mode.architecture   | 117 KiB       | 241 KiB      | 117 KiB      | 241 KiB     |
| failover.dataflow        | 51 KiB        | 175 KiB      | 51 KiB       | 175 KiB     |
| retry-helper.architecture| 32 KiB        | 156 KiB      | 32 KiB       | 156 KiB     |
| agent-session.architecture| 38 KiB       | 162 KiB      | 38 KiB       | 162 KiB     |

**Rich nodes and content steps in SMIL.** Typing (a clip width per line plus a caret), word
reveals, `set`/`clear` crossfades, the line bar, row status (spinner, check / cross draw-on,
shimmer sweep), `dim`/`hide`/`show`, `wire`/`unwire`, persistent glows and the spotlight are all
encoded as tracks; things that exist only mid-story (old versions, the caret, spinner, shimmer, the
spot) are extra elements hidden in the final frame, so the no-SMIL fallback is still the static
diagram. Verified in headless Chrome against the HTML viewer's frames (PSNR ≥ 38 dB mid-story,
final frame identical or ≥ 82 dB, both themes, inline and `<img>`, loop return). Firefox: `<img>`
playback seen animating, no frame-parity check. **Safari: untested.** The `rewind: "glitch"` effect
is HTML-only (the SVG keeps its 0.4 s reset tween); no follow camera. With `font: "system"` the
code and row text use the reader's monospace; token x positions are explicit, so columns hold,
but glyphs differ from Commit Mono, so use `embed` for the exact look.

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

## Change diagrams

Show a code change where the data flows (after [pr-lens](https://github.com/coldteadotai/pr-lens)):
mark what each element's change did and storyink colours it, in static SVG, HTML and animated SVG,
in both themes. All fields are optional; a spec without them renders byte-identically.

| field                      | on                                              | meaning |
| -------------------------- | ----------------------------------------------- | ------- |
| `delta`                    | nodes, groups, edges, participants, messages    | `added` · `modified` · `removed` · `unchanged` |
| `emphasis`                 | edges, messages                                 | `hero` (thicker + soft glow; keep to 1–2) · `muted` (0.35) |
| `stat`                     | nodes                                           | `{ "add": 38, "del": 12 }`, shown as `+38 −12`; filled from `--changes` when absent |
| `summary`                  | nodes, edges, messages                          | one line: what changed and why (auto captions, drawer) |
| `files`                    | nodes, edges, messages                          | `"src/x.ts"` or `{ "path", "lines"?: n \| [a, b], "revision"?: "head" \| "base" }` (1-based, inclusive; head side, base side for removed elements) |
| `change` (root)            | spec                                            | `{ "base", "head", "title"?, "url"? }`: `base → head` (else `title`) shown above the diagram |
| `style.legend` (root)      | spec                                            | default: a legend when any element has a delta other than `unchanged`; `false` hides it |

Encoding (tokens `deltaAdded` / `deltaModified` / `deltaRemoved` + `…Fill`, `deltaHero`, and the
`delta` geometry block in `src/theme/tokens.ts`):

- **added**: sage outline and accent, a `NEW` badge in the node's top-right corner.
- **modified**: gold outline and accent, `CHANGED` badge.
- **removed**: a ghost: rose dashed outline, 0.55 opacity, label struck through, `REMOVED` badge.
  Removed edges are rose, dashed and faded, their label struck.
- **unchanged**: context, receded to 0.82, no badge.
- `stat` sits left of the badge (`+N` sage, `−M` rose). Badge room is reserved by the layout
  (corner shapes get a strip above the text, windows use the header strip, chips and pills a slot
  on the right, diamonds a row under the text); tiny shapes (dots, bars, choice) get colour only.
- **Groups**: the label is tinted and gets ` · NEW` / ` · CHANGED` / ` · REMOVED`; boxes are not
  flooded (a removed group's rule is dashed).
- **Sequence**: participants carry the badge on their head box, a removed participant's lifeline
  is rose; messages are tinted, added ones a little heavier, removed ones dashed with a struck label.
- **Legend**: a row above the diagram listing only the deltas present, with the `change` meta on the
  right. The viewBox grows by 26 px for it.

Delta looks are static and compose with everything else: story levels multiply (a `dim`med removed
node is 0.42 × 0.55), `reveal` / `wire` / `hide` / `highlight` / `pulse` work as usual, and rich
nodes (`panel`, `code`, `chip`) take the outline, badge and strike. The animated SVG renders them
identically (change scenes use the same union mode as rich scenes).

Validation: unknown `delta` / `emphasis` values (with did-you-mean), empty file paths, line numbers
< 1 or reversed ranges, and negative or fractional `stat` counts are errors; an `added` edge or
message touching a `removed` node / participant is an error; any other edge touching a removed
endpoint without being `removed` itself is a warning, as are more than 2 hero edges and
`style.legend: true` with nothing to show.

```json
{
  "type": "dataflow",
  "title": "Batch sending",
  "change": { "base": "main", "head": "feat/batch" },
  "nodes": [
    { "id": "queue", "kind": "database", "delta": "modified", "stat": { "add": 21, "del": 4 } },
    { "id": "loop", "label": "processBroadcast", "kind": "function", "delta": "removed" },
    { "id": "bulk", "label": "sendBroadcastBulk", "kind": "function", "delta": "added",
      "files": [{ "path": "functions/src/sendBroadcastBulk.ts", "lines": [1, 142] }] },
    { "id": "postmark", "kind": "external", "delta": "unchanged" }
  ],
  "edges": [
    { "from": "queue", "to": "loop", "delta": "removed" },
    { "from": "queue", "to": "bulk", "delta": "added" },
    { "from": "bulk", "to": "postmark", "label": "500 msgs/call", "delta": "added", "emphasis": "hero" }
  ]
}
```

Examples: [`examples/changes/`](../examples/changes/) (`batch-email.dataflow.json`,
`auth-session-to-jwt.sequence.json`, `rate-limit-plugin.architecture.json`).

## Change stories

A story can play a change instead of showing it all at once.

**`change` step** (`"change": "id"` or a list). Elements whose delta a step `change`s show their
**before** look until that step, then move to their **after** (delta) look:

| delta | before | the `change` step |
| ----- | ------ | ----------------- |
| `added` node / group | absent | reveals it (sage accent, `NEW` badge) |
| `added` edge / message | absent | draws it on (like `wire`) |
| `removed` node | plain (kind accent, full strength) | rose dashed face, badge and strike fade in, the node fades to the 0.55 ghost |
| `removed` edge / message | a plain wire | retracts (like `unwire`), then the rose dashed ghost fades in and stays; its label strikes |
| `modified` node / edge | plain | a flash (highlight), then the gold face / wire and `CHANGED` badge fade in |
| diff code node | the base version | `apply` (and its badge) |

Elements with a delta that no step `change`s are in their after look from the start; the final
frame is the static diagram. Legend items whose every element is changed by a step appear with the
first of them. HTML and animated SVG alike (the after look is a layer over the neutral one whose
opacity the SMIL animates). Diagnostics: `change` on an element with no delta (or `unchanged`)
and changing it twice are warnings; `reveal` + `change` of the same added element is a warning
(pick one).

**`story: "changes"`** (or `{ "steps": "changes", ...options }`, CLI `--story changes`, tool
`storyink_render` `story: "changes"`) derives the walkthrough:

1. an opening beat on the before state, captioned with `change.title` (else the title);
2. one beat per changed node in data-flow order (breadth-first from the sources): the node, its
   changed edges (an edge joins the later of its endpoints' beats; edges between unchanged nodes
   get their own beat after their source) and its attached diff node (a diff code node connected
   to it by an edge, applied in the same beat). Each beat: `change` (+ `apply`), `focus` on the
   node and its diff, caption = the element's `summary` or "<label>: added | changed | removed",
   `stop` = the label, and `narrate` when there is a summary (heading "<label> <delta>", body = the
   summary, cites = the element and its first file ref) so the narration rail works;
3. a pulse train along each hero edge after its beat (only edges that exist after the change);
4. a closing overview beat ("3 added · 2 changed · 1 removed", focus on everything).

Sequences: one beat per changed message in order (with the changed participants it brings in).

**Veil** (`"spotlight": "veil"`): the page colour over everything outside a soft rounded cutout
around the step's focus box (step `focus`, else what the step animates), with a thin rim; the
cutout glides between steps and the veil is gone in the final frame. Drawn inside the SVG (mask +
Gaussian-blurred cutout), so HTML, snapshots and the animated SVG share it (SMIL animates the
cutout rect and the veil opacity).

## Diff code nodes

A `code` node with `diff` shows a unified diff instead of plain code: a gutter with old | new line
numbers, a `+` / `−` marker column, sage rows for added lines and rose struck rows for removed
ones (stronger tint on the changed words of paired −/+ lines, from a token-level LCS), muted
`@@ … @@ section` hunk headers, syntax colours per `lang` (ts, js, json, py, go, rust, sql,
yaml, sh, text; default from the file extension, else ts) and a `… N more lines` fold row.

| `diff` value | meaning |
| ------------ | ------- |
| `"@@ -12,3 +12,4 @@\n ctx\n-old\n+new"` | unified hunk text (a snippet with no `@@` header is one hunk numbered from 1; its header row is hidden) |
| `{ "file": "src/x.ts", "lines"?: [a, b], "context"?: 3, "max"?: 24 }` | the hunks of that file range from `--changes` (CLI `render --changes`, tool `storyink_render` `changes`); without them validation fails with a hint |
| `{ "file"?: "src/x.ts", "hunks": [...] }` | resolved hunks (what `--changes` writes) |

`max` (4–200, default 24) folds after that many diff lines; long lines are cut at 72 columns
with `…` (a larger `size.cols` widens the node); `size.lines` reserves rows. The box is sized for
the diff (the largest state) and never resizes. `code` next to `diff` is ignored (warning). The
node is a window like any code node, so `delta`, badges and story levels apply.

**Anchors.** `node#3` stays the 1-based display row. Diff nodes add `node#+14` (head line 14) and
`node#-13` (base line 13); edges can leave from the changed line (`"from": "pay#+14"`). Lines
that the diff does not show are errors.

**`line`** accepts `"pay#+14"`, `"pay#-13"` and `{ "id": "pay", "hunk": 2 }` (all rows of hunk 2).
`set` / `clear` / `type` do not apply to diff nodes (error with a hint to use `apply`).

**Story `apply`.** `"apply": "pay"`, `{ "id": "pay", "hunk": 1, "cps": 60 }` or a list. Before the
apply the node shows the **base** version: context and removed lines as plain code, no tints,
no added rows, no gutter numbers. During it (per hunk): removed rows tint rose and strike, the
gutter numbers and hunk header fade in (first quarter), added rows open (rows below slide down)
and type in with a sage tint (`cps`, default 60 chars/s; duration = typing / 0.6, at least
0.9 s). After it: the static diff. Hunks no step applies show the diff from the start; applying a
hunk twice is a warning. `apply` without `hunk` applies all remaining hunks. HTML and animated
SVG alike (the SVG animates row translate, tint / gutter opacity, the open height and the typing
clip; reduced motion snaps at the end of the apply). Anchored wires and the line bar sit at the
diff's (final) row positions.

```json
{ "id": "pay", "kind": "code", "label": "payments/charge.ts",
  "diff": "@@ -12,3 +12,6 @@ export async function charge(order)\n   const res = await stripe.charge(order)\n-  if (!res.paid) throw new PaymentError(res)\n+  if (!res.paid) {\n+    await retries.enqueue(order.id)\n+  }" }
```

`diffRows(hunks, lang, { max?, headers? })` (in `storyink/core`) is the renderer-agnostic row
model behind it: `{ kind: "context" | "add" | "del" | "hunk" | "fold", old?, new?, text, tokens,
marks?, hunk }[]`.

Examples: `examples/changes/payment-retry.architecture.json`, `etl-dedupe.dataflow.json` (Python
and SQL, hunks applied one at a time), `storyink-core.architecture.json` (render with
`--changes examples/changes/storyink-0.4.0.changes.json`).

## Diffs and `--changes`

storyink can read a unified diff so change diagrams point at real code. Nothing reads git at view
time: everything needed is embedded in the spec when you render.

**Parsing** (`parseUnifiedDiff(text) → { ok, diffset?, diagnostics }`, `storyink/core`): git
format (`diff --git`, `rename from/to`, `copy from/to`, `new/deleted file mode`, mode changes,
`Binary files … differ`, `\ No newline at end of file`, C-quoted paths, `/dev/null`), plain
`diff -u` output (`---`/`+++` without a git header, timestamps dropped), CRLF. Hunk bodies are
read by their `@@` counts, so content lines that look like `--- x` are content. A preamble (commit
message) is skipped. A `DiffSet` is `{ version: 1, base?, head?, title?, files, stats }`; each
file has `path` (base path for removed files), `oldPath` (renames / copies), `status`
(`added | modified | removed | renamed | copied`), `binary?`, `add`, `del`, `lang` (from the
path) and `hunks` (`header`, `section`, `oldStart/oldLines/newStart/newLines`, `lines` of
`{ kind: context|add|del, text, old?, new?, noNewline? }`). `parseHunks(text)` reads a bare hunk
snippet (`@@` blocks; with no header, one hunk numbered from 1; counts are recomputed).

**CLI**

```
storyink diff [<range>|<base> [<head>]] [--staged] [--patch file|-] [-o changes.json] [--json] [-- <pathspec>…]
storyink render spec.json -o out.html --changes changes.json   # or a .diff / .patch file
```

`diff` runs `git diff --no-color --find-renames --unified=3` (no args: the working tree vs the
merge base with `origin/HEAD` / `main` / `master`; `a..b`; `a...b` from the merge base; one
revision vs the working tree; `--staged` = the index vs `HEAD`), or parses `--patch`. It prints a
compact summary (status, +/−, path per file) and with `-o` writes the DiffSet JSON. `base` /
`head` are the refs given (`working tree` / `index` when uncommitted); `title` is the head
commit's subject. Untracked files are not included (`git add -N` them). Library:
`gitDiff({ cwd, range?, base?, head?, staged?, paths?, patch? })` in `storyink/node`.

**Referencing code**: elements carry `files` (`"src/x.ts"` or
`{ "path", "lines"?: n | [a, b], "revision"?: "head" | "base" }`). Line numbers are head-side;
base-side for `delta: "removed"` elements or `revision: "base"`. A `code` node may carry
`"diff": { "file", "lines"?, "context"?, "max"? }`.

**Resolving** (`resolveChanges(spec, diffset) → { spec, diagnostics }`, pure; the input is not
mutated; `--changes` and the plugin's `changes` run it before validation):

- fills `stat: { add, del }` on nodes / edges / messages that have `files` but no `stat` (lines
  inside the refs' ranges, each diff line counted once);
- resolves `diff: { file, lines? }` code nodes to `{ file, hunks, … }`: hunks intersecting the
  range, trimmed to the range ± `context` (default 3); the whole file without `lines`; `lang`
  defaults from the path;
- embeds `changes: { base, head, files }` with only the hunks any element references (whole hunks,
  at most 400 lines per file; a cut ends with a `… N more lines` context row that has no line
  numbers);
- returns coverage warnings (`coverage(diffset, spec)`): refs whose path is not in the diff,
  ranges that touch no hunk, changed files no element references, and unreferenced hunks in
  referenced files.

Helpers: `selectHunks(diffset, ref, side?, { context? })`, `statFor(diffset, refs)`,
`langForPath(path)`, `normalizeLang(lang)`, `capHunks(hunks, max)`.

## Narration and drawer

HTML viewer only (the static and animated SVG have neither).

**Step `narrate`**: `{ "heading"?: string, "body": string, "cites"?: [{ "text", "ref" }] }`.
`heading` defaults to the step's `stop`. Each cite's `text` must occur in the body, in order
(validation error otherwise, with the JSON path); `ref` is an element id (node / edge / group, or a
unique `from->to`), `node#row`, or a file `path`, `path#L12`, `path#L12-20` (a ref that is neither an
element nor path-like is an error).

```json
{ "reveal": "cache", "stop": "Cache",
  "narrate": { "heading": "Reads hit the cache first",
    "body": "The API now asks the cache before Postgres. See src/cache.ts for the TTL.",
    "cites": [{ "text": "the cache", "ref": "cache" }, { "text": "src/cache.ts", "ref": "src/cache.ts#L10-24" }] } }
```

- **Fallback caption**: a narrated step without `caption` captions with its heading, else the body's
  first sentence. This happens at compile time, so the header caption, beat tiles, snapshots and
  the animated SVG all show it. A narrated beat's reading hold is computed from the heading + body
  (capped like any hold), not from the short fallback caption.
- **Narration rail**: present when any step has `narrate`. Shows "02 / 06" (narrated steps only),
  the heading and the body with cite spans. It tracks the beat the header caption belongs to: the
  last narrated step up to that beat's last step (→ / ← moves pin it like the caption; the
  full-motion gate shows the first narrated step, the reduced-motion gate, which shows the final
  frame, the last). The rail and drawer render client-side only (not in the SSR markup), so the
  stage size is final when the viewer signals ready. Hovering / focusing a cite outlines its element on the diagram;
  clicking a file cite opens the drawer on that file (an element cite opens the element's drawer
  when it has one). Wide screens: a right column beside the stage (the camera re-fits to the
  smaller stage); below 760 px: a bottom sheet, its height clamped so the stage keeps 160 px. Toolbar "Narration" toggle and key `N` (stored in
  `localStorage["storyink-rail"]`).
- **Drawer**: clicking (not dragging) a node, edge, edge label, message or group that has
  `summary`, `files` or a delta other than `unchanged` opens a side drawer: kind, label, delta
  badge, stat, summary, then each file ref (path + range). With embedded `changes` (`render
  --changes`) each ref shows the hunks it selects (`selectHunks`; removed elements read the base
  side) as a diff: old | new gutter, `+` / `−`, sage / rose rows, syntax colours, intra-line marks,
  `@@` headers and fold rows (`diffRows`). Without embedded hunks it lists the paths. The drawer
  takes the side column (it replaces the rail while open; the rail returns on close; bottom sheet
  when narrow). One drawer at a time; × or Esc closes it; it scrolls on its own (the stage wheel zoom does not reach it).
  Elements with drawer content get a pointer cursor and a soft hover shadow.
- Rail and drawer are off in sheets (`#sheet=`), `#static=1` and `#chrome=0`, except that
  `#rail=1` and `#drawer=<id>` turn them on explicitly (snapshots: `storyink snapshot --at … --rail
  --drawer <id|path>`, tool params `rail` / `drawer`). `#rail=0` hides the rail. With `#static=1`
  only the explicit hash turns them on.
- Snapshots with `--rail` / `--drawer` capture the page viewport (stage + side column) at 16:9 of
  the follow width (`--width`, default 1280 → 1280×720), with the fit camera unless `--camera
  follow`; their determinism, `end=static` and `reduced=static` gates capture with the same rail /
  drawer configuration and size. Plain captures are unchanged.
- Page contract: `#drawer=<id|path>` opens on load (does not write the hash on open / close);
  `__storyink.openDrawer(id)` (returns false when the id has nothing to show),
  `closeDrawer()`, `drawer()` (the open target `{ id }` | `{ file }` or undefined);
  `steps[i].narrate`.
- The scene JSON carries `changes` only when the spec embeds it; the rail / drawer CSS (and the code
  + delta palette the drawer uses) is only emitted when used: other specs render byte-identically.

## Pages

A page (`"type": "page"`) is a single-file, offline explainer document: a summary, then sections of
prose, data blocks and embedded diagrams ("figures"), rendered deterministically from JSON. Use it
for PR / diff reviews, plan reviews, project recaps and explainers. Examples:
[`examples/pages/`](../examples/pages/).

```jsonc
{
  "type": "page",
  "title": "PR #142: Batch email sending",
  "eyebrow": "Diff review",          // small uppercase line above the title (default "Page")
  "subtitle": "…",                   // italic line under the title
  "summary": "Lead paragraph …",     // prose (see below), shown large in the header
  "change": { "base": "main", "head": "feat/batch", "title": "…", "url": "https://…" },
  "toc": true,                       // default: a contents sidebar when there are ≥ 4 sections
  "layout": "article",               // or "slides": opens presenting (see Slides)
  "present": true,                   // false: no Present button / P / #present=1
  "sections": [
    { "id": "what", "title": "What changed", "eyebrow": "…", "blocks": [ { "prose": "…" } ] }
  ]
}
```

Section `id` defaults to the title's slug (unique). A **block** is an object with exactly one type
key, plus an optional anchor `id`; an unknown key or two type keys in one block is an error.

| Block | Shape | Renders |
| --- | --- | --- |
| `prose` | string | Markdown subset (below) |
| `figure` | `{ spec, claim?, id?, wide?, builds? }` | an embedded diagram; `spec` is a diagram spec object or a file path (relative to the page file, or absolute); `claim` is the caption (inline prose); `id` defaults to `fig-1`, `fig-2` … |
| `kpis` | `[{ label, value, detail?, tone? }]` | a row of number tiles |
| `table` | `{ columns: (string \| { label, align? })[], rows: Cell[][], caption? }` | a table; Cell = string \| number \| `{ text, tone?, badge?, code? }` |
| `cards` | `[{ title, body, tag?, tone?, delta? }]` | a card grid (`delta` adds a NEW / CHANGED / REMOVED chip) |
| `callout` | `{ tone: note\|good\|warn\|risk, title?, body }` | a toned aside |
| `filemap` | `"changes"` \| `{ from: "changes", notes? }` \| `{ files: [{ path, status, add?, del?, note? }] }` | a directory tree with status letters, +/− and bars; over 16 files it shows the 8 largest and collapses the tree |
| `diff` | `{ file, lines?, context?, max? }` (from `--changes`) \| `{ text, file?, lang?, max? }` | the drawer's HTML diff view (gutter, tints, syntax colours, intra-line marks); folds after `max` rows (default 120) |
| `code` | `{ code, lang?, file?, start? }` | syntax-coloured code with line numbers |
| `risks` | `[{ risk, severity: low\|medium\|high\|critical, area?, mitigation?, refs? }]` | a risk list |
| `decisions` | `[{ decision, why?, confidence: sourced\|inferred\|unknown, refs? }]` | a decision log (a `sourced` decision without refs warns) |
| `evidence` | `[{ claim, source, status?: verified\|corrected\|unsupported\|unverifiable }]` | claim / source / status rows |
| `timeline` | `[{ when, title, body?, tone? }]` | a vertical timeline |
| `checklist` | `[{ text, done?, note? }]` | a checklist |
| `details` | `{ summary, blocks }` | a native `<details>` (collapsed; opened for print) |
| `columns` | `Block[][]` (2–3) | side-by-side columns (before / after); stacked on narrow screens |
| `scrolly` | `{ id?, figure, steps: "auto" \| [{ at, title?, body, cites? }], side? }` | scrollytelling (see below) |
| `break` | `true` \| `{ title?, layout? }` | a new slide (nothing in the article) |

Tones (`tone`) are semantic and match the change palette: `good` = sage, `warn` = gold, `risk` =
rose, `note` = blue, `neutral` = ink. `refs` / `source` strings that look like file refs
(`src/x.ts#L12-20`, `src/x.ts:12`) render as mono refs.

**Prose** is a safe Markdown subset: paragraphs, `-` / `*` and `1.` lists, `###` / `####`
headings, `>` quotes, `**bold**`, `*italic*`, `` `code` ``, `[text](url)` (http(s), mailto,
`#anchor` or a relative path; anything else renders as plain text), `\` escapes. There is no raw
HTML: every character is escaped.

**Validation** (`validatePage`, `storyink validate page.json`): JSON paths and hints as for
diagrams; each figure spec goes through the diagram `validate()` and its diagnostics are prefixed
with the figure's path (`sections[1].blocks[0].figure.spec.nodes[3].kind`). Section, figure and
block ids are unique. Warnings: long prose, more than 6 KPIs, more than 4 figures, `filemap` /
`diff` from changes without `--changes`. The diagram `validate()` given a page returns an error
pointing at `validatePage`.

**Changes** (`render page.json --changes changes.json`, `resolvePageChanges(page, diffset)`): every
figure spec is resolved with `resolveChanges` (stat, diff nodes, embedded hunks for its drawer;
diagnostics prefixed with the figure path); the page embeds `changes` with every file's status and
counts (when a `filemap` reads them) and the whole hunks `diff: { file, lines? }` blocks select,
capped at 400 lines per file. `lines` + `context` (default 3) trim at render time.

**HTML**: one file, like single diagrams: font, theme (both palettes, plus the rich + delta
palettes and the `--sp-*` page palette), diagram CSS (union of what the figures need), viewer CSS
(narration rail / drawer rules when any figure uses them, rolling counters when any has counters),
`#storyink-page-css`, the BOOT script; then

```html
<html class="si-noscript si-page">…
<div id="storyink-page" class="sp-has-toc?">
  <header class="sp-head">eyebrow, title, subtitle, change meta, summary, theme toggle</header>
  <nav class="sp-toc">…</nav>
  <main class="sp-main">
    <section class="sp-sec" id="<section id>">…blocks…
      <figure class="sp-b sp-wide sp-fig[ sp-fig-wide]" id="fig-<figId>" data-fig="<figId>">
        <div class="sp-fig-root" data-si-fig="<figId>">…renderFigure(scene, { id })…</div>
        <figcaption class="sp-cap">claim</figcaption>
      </figure>
    </section>
  </main>
</div>
<script id="storyink-page-js">theme toggle, TOC scroll-spy, details open for print</script>
<script type="application/json" id="storyink-page-data">{"version","figures":{"<figId>":{"scene"}},"changes"?}</script>
<script id="storyink-viewer">…</script>
```

The page reads without JavaScript (figures at their final frame, native `<details>`, the TOC as a
list). The theme toggle uses the viewer's `localStorage["storyink-theme"]` and
`documentElement.dataset.theme`. Print hides the chrome and opens every `<details>`.

**CLI / plugin**: `storyink render page.json -o page.html [--theme light|dark] [--changes …]`
detects pages; figure `spec` paths (JSON, or `.mmd` Mermaid) resolve relative to the page file (absolute, `file://` and `~/` paths work too).
`--svg` / `--animated-svg` are errors for a page (render a figure's own spec for its SVG);
`--story` / `--motion` / `--camera` / `--pace` are ignored with a warning (set them in each
figure's spec). `storyink validate page.json` validates the page and every figure. The plugin's
`storyink_render` and `storyink_validate` accept a page as `spec` (object or JSON; figure paths
resolve against the project directory) or `path` (resolved against the page file's directory).
Core API: `isPageSpec`, `validatePage`, `renderPageHtml(page, { theme?, viewer? })`,
`resolvePageChanges`, `layoutPage`, `pageFigures`; Node: `loadPage(input, dir, diffset?)`,
`writePage`.

### Scrollytelling

A `scrolly` block pins a figure beside prose step cards; scrolling to a card moves the figure's
story to that card's beat (forward plays, backward rewinds).

```jsonc
{ "scrolly": {
    "id": "retry",                         // default scrolly-1, scrolly-2 …
    "side": "right",                       // where the figure sits (default right)
    "figure": { "spec": "flow.json", "claim": "…" },   // a figure block; its spec needs a story
    "steps": [
      { "at": "Change", "title": "Soft declines wait", "body": "Now the order stays `pending` on the queue.",
        "cites": [{ "text": "queue", "ref": "retries" }] }
    ] } }                                  // or "steps": "auto"
```

- `at`: a story step `id`, a chapter `stop` label, a 1-based beat number, `"start"` (before the
  first beat) or `"end"`. It resolves at render time against the figure's compiled story with the
  viewer's beat model: target `{ beat, t }` = the beat (0-based, -1 = start) holding that step and
  its settled stop time (the state → lands on); `"end"` = the story's duration.
- `"auto"`: one step per narrated story step (title = `narrate.heading` or the step's `stop`,
  body = `narrate.body`, its cites); without narration, one step per chapter `stop` with the beat's
  caption as body. An error when the story has neither. So `story: "changes"` or a narrated figure
  becomes a scrolly for free.
- `cites` follow the `narrate` rules (text occurs in the body, in order; ref = element id,
  `node#row` or a file path). Steps whose targets go backwards warn.
- `body` is prose. Keep a step to one change and 1–3 sentences.
- Without JavaScript, in print and with `#static=1` the steps are listed beside the figure at its
  final frame. Live, the viewer pins the figure (sticky, vertically centred), spaces the steps
  (one active at a time, `.is-active`; others dimmed) and drives the figure. On narrow screens the
  figure sits above the steps.
- Only directly in a section's `blocks` (not inside `details` / `columns`).

### Slides

Any page can be presented as 16:9 slides from the same DOM (`Present` button, `P`, `#present=1`);
`"layout": "slides"` opens presenting (`#present=0` forces the article); `"present": false`
disables it. Slides: a title slide (the header), one per section, and a new one at every
`{ "break": true }` / `{ "break": { "title"?, "layout"? } }` (renders nothing in the article; a
continuation slide's title defaults to the section's). A section's `"slide": { "layout" }` hint and
a break's `layout` pick the content layout:

| layout | for | default when |
| --- | --- | --- |
| `title` | the title slide | slide 0 |
| `full` | one figure filling the slide (a tall figure: title + caption in a left column, figure full height) | the slide is only a figure (± claim) |
| `split` | text left (~40 %), figure right (~60 %; a tall figure takes the full slide height and ~2/3 of the width) | a figure or scrolly with other blocks |
| `center` | a statement, KPIs, a callout, centred and large | no figure and ≤ 2 short blocks |
| `flow` | everything else, top to bottom | otherwise |

**Builds**: → steps through a slide's builds before the next slide: the beats of the slide's first
story figure (unless that figure has `"builds": false`), or its scrolly's steps. Keep one focal
point per slide; long slides that still overflow the frame at the minimum content scale are
reported by the snapshot lint (`slide-overflow`).

Markup (for the viewer and snapshots): each slide is a `.sp-slide[data-slide][data-slide-layout]
[data-builds][data-fig-shape]` wrapper (`display: contents` in the article; `data-fig-shape` is
`tall` or `wide` from the build / first figure's aspect, absent without a figure), the title slide wraps the header
(`.sp-slide-title`), `#storyink-page[data-layout][data-present]`, and the page data gains
`scrolly: { id: { fig, steps: [{ beat, t }] } }` and `slides: [{ id, title, layout, figs, scrolly?,
builds, build?: { fig, targets: [{ beat, t }] } }]`. Present-mode content layouts are CSS on
`html.sp-presenting .sp-slide.is-current[data-slide-layout=…]`; the frame itself (fixed 1280×720
box, centring, `--sp-slide-scale`) is the viewer's, and dense slides shrink their content by the
viewer-measured `--sp-content-scale` (≥ 0.7).

## Pages: viewer & page contract

A page (`type: "page"`) embeds each figure as the interactive viewer (`renderFigure(scene, { id })`
in `src/core/render/figure.tsx`, server-rendered so it reads without JavaScript at the final frame).

- **Embedded figure**: no title header (the page owns it); the caption line above the stage; the
  stage spans the column and its height follows the diagram's aspect at that width (plus the
  toolbar strip), at least 260 px, at most a 1.25× fit and 90vh (snapshots pin `#figmax=`); before
  hydration and at `#static=1` the diagram is fitted by CSS (no camera transform), so the server
  markup and static captures lay out the same with or without JavaScript. Diagrams whose labels
  would draw under ~9 px at the column width (when width, not height, limits the fit) break out of
  the column (`sp-fig-wide`, unless the figure sets `wide`). Narrow screens: the drawer is a bottom
  sheet; toolbar separators collapse when a control is hidden; compact toolbar (−, +, Fit,
  Motion, Follow, Narration, Expand; no theme button: the page header toggles the theme for every
  figure); transport and gate; pan by drag; the wheel scrolls the page, Ctrl / ⌘ + wheel (or a
  pinch) zooms. The narration rail sits beside the stage when the figure is ≥ 860 px wide, else
  below it. The drawer opens as a page-level overlay. **Expand** fills the window (full toolbar);
  Esc or the button returns; the stage re-fits.
- **Keys**: act only on the figure that has focus (each figure root is focusable; clicking it
  focuses it). With no figure focused, Space / arrows scroll the page as usual. Esc closes the
  drawer, then leaves Expand.
- **Hash**: `#theme=` and `#static=1` are page-wide; `#fig=<id>` scopes `t`, `camera`, `motion`,
  `pace`, `drawer`, `rail`, `autoplay`, `static` to that figure (e.g. `#fig=fig-2&t=9`). Hash
  changes that don't change a figure's view (TOC anchors) leave it alone (no refit).
  `#fig=<id>&solo=1` shows only that figure, full window, with the standalone chrome and the
  single-diagram `__storyink` contract (plus `page: true`, `solo: id`); reload to leave it.
- **Page contract**: `window.__storyink = { ready, whenReady, version, page: true, figures: { [id]:
  { duration, steps, setTime, play, pause, replay, step, stepAnimated, state, camera, pace,
  setPace, openDrawer, closeDrawer, drawer } }, lint }`; `lint = { ok, figures: { [id]: report },
  page: { ok, issues } }` (page issues: `.sp-*` blocks whose text is clipped);
  `documentElement.dataset.ready = "1"` once every figure hydrated and fonts are ready. Toggles
  stored in localStorage (motion, follow, pace, rail) are shared page-wide.
- **SVG ids**: each figure's SVG defs carry the prefix `f-<id>-` (`Diagram` prop / `renderSvg`
  option `idPrefix`, default empty), so figures never collide.
- **Snapshot**: `storyink snapshot page.html` captures the full page per theme (width `--width`,
  default 1280; height measured; figures at their final frame via `#static=1` and a fixed figure
  height via `#figmax=`; 6 s virtual-time budget), with gates `ready`, `lint` (figures + page text) and `deterministic`;
  `--preview` gives a compact JPEG, split into up to 3 parts for tall pages (`#scroll=<px>`).
  `--figure <id>` (plugin `figure`) runs the single-diagram pipeline on that figure through
  `#fig=<id>&solo=1`: beat sheets, `--at`, `--rail`, `--drawer`, `--camera follow` and every gate.

## Scrollytelling and slides: viewer

**Figure API** (`__storyink.figures[id]`, and the standalone / solo contract): `beats()` → each
beat's settled stop time; `moveTo(target, { animate? })` → Promise, where `target` is `{ beat }`
(0-based; −1 = start, past the last beat = end) or `{ t }`. Animated moves play forward like →
(2.5× when crossing two or more beats) and rewind like ← (2×); reduced motion or `animate: false`
jumps to the settled state, with the follow camera placed as a pure function of that time (as for
`#camera=follow&t=`). The end lands just before `duration` (paused, not the dimmed "ended" look).

**Scrolly** (page mode, not `#static=1`): the viewer adds `sp-scrolly-live` to each `[data-scrolly]`
block; the active step is the last `.sp-scrolly-step` whose top has crossed a trigger line at 55 % of
the viewport (from scroll position only); it gets `.is-active` and the figure `moveTo`s its target
(page data `scrolly[id].steps`, by beat). Inside scrolly the figure's transport, gate and rail are
hidden (zoom, Fit, Expand stay). Hovering a `.sp-cite[data-ref]` highlights the element; clicking a
file cite opens the drawer. `#scrolly=<id>&step=<n>` (1-based) scrolls step n to the trigger line,
settled and paused (the page then scrolls inside a wrapper, so headless captures keep the offset).

**Deck** (present mode): `P`, the header's Present button, `#present=1`, or `layout: "slides"`
(unless `#present=0`). `html.sp-presenting`; only `.sp-slide.is-current` shows, as a 1280×720 frame
centred above a 44 px bar and scaled to fit (`--sp-slide-scale`); figures refit. Builds come from
page data `slides[i].build` (`fig` + `targets`): entering a slide forward puts the build figure at
the start, backward at its last build; other figures on the slide show their final frame; a scrolly
slide also marks step k as active. Keys: → / Space / PgDn / Enter next build → next slide;
← / PgUp / Backspace previous; Home / End; O outline (click to jump); ? help; Esc closes an overlay,
else returns to the article scrolled to the slide's section; P toggles. Figure keys are off while
presenting. Chrome: progress bar, `n / N`, prev / next, slide title, O / ? / Esc buttons. Hash:
`#present=1|0`, `#slide=<n>` (1 = title slide), `#build=<k>` (0 = entry; settled, paused).
`__storyink.deck = { present(n?, k?), exit(), next(), prev(), state() }`. Lint (while presenting):
`slide-overflow` for slides whose content needs a scale under 0.7 to fit the frame (the viewer
also sets `--sp-content-scale` on each slide, clamped to ≥ 0.7, for the slide CSS to use).

**Snapshot**: `storyink snapshot page.html --slides` → one 1280×720 frame per slide (entry state)
per theme (`<base>.<theme>.slideNN.png`) plus a labelled sheet (`<base>.slides.<theme>.png`);
`--builds` adds every build state (`slideNN.bK`); `--scrolly <id|all>` → one 1280×800 viewport per
scrolly step (`scrolly-<id>.sNN`) plus a sheet. Gates `ready`, `lint` (incl. `slide-overflow`),
`deterministic` (a middle frame re-captured; scrolly frames get one re-capture for Chrome's
sticky-layer raster). `--preview` is a compact JPEG of the first sheet. Plugin `storyink_snapshot`:
`slides`, `builds`, `scrolly`.
