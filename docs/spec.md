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
  2 spaces), syntax-coloured by `lang`: `ts` (default), `js`, `json`, `text`.
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
it) and `rewind: "tape"` (default) or `"glitch"` (the loop / R replay reset effect in the HTML
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
| `set`      | swap content with a 0.25 s crossfade: `{ id, code? }` on a code node, `{ id, text?, detail?, tag? }` on a row, `{ id, label? }` on a panel, code or chip node (header / chip label). Set + `type` in the same step starts the new version empty and types it. |
| `clear`    | fade a code node's / row's content out (type again only after a `set`). |
| `line`     | active-line bar on a code node: `"code#2"`, `"code#2-4"`, `{ id, lines }`, or `{ id, off: true }`. |
| `status`   | `{ id: "node#row", to }` with `none` `running` (spinner + shimmer sweep over the text) `done` (check draws on) `error` (cross). |
| `dim` / `undim` | lower to a level (`"x"`, a list, or `{ ids, to }`; default 0.42) / back to 1. Nodes, groups, edges, rows. Independent of visibility: a dimmed thing that is hidden and shown again comes back dimmed. |
| `hide` / `show` | take a visible thing away / bring it back (fade). Unlike `reveal`, which marks something as *new* (absent until its step, with a rise), `hide`/`show` act on things already in the diagram and can repeat. |
| `wire` / `unwire` | draw an edge on at wire speed (hidden before the step) / retract it source end first; `"edge"` or `{ edge, duration }`. |
| `glow` / `unglow` | persistent glow on a node until `unglow` (a pulse's arrival glow is separate and brief). |
| `focus`    | an id the follow camera and the spotlight aim at for this step. |

Mistakes are diagnostics with a hint, never crashes: typing a cleared target, a line past the
program's last line, `undim` on something not dimmed, a status that doesn't change, and so on.

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
`window.__storyink = { ready, duration, steps: [{ id, label, t0, t1, stop? }], setTime(t), play(), pause(), replay(), step(dir, chapter?), stepAnimated(), state(), camera(), pace(), setPace(n) }`;
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
