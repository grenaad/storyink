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
