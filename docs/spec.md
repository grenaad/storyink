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
| `direction` | `LR` or `TB` (`TD` accepted)                                      | graph types; default LR for architecture/dataflow, TB otherwise |
| `story`     | any                                                               | reserved for Phase 2 storyboards; warned and ignored |
| `$schema`   | string                                                            | ignored by the renderer                         |

## Graph types (architecture, dataflow, workflow, lifecycle)

- `nodes[]`: `{ id, label?, kind?, detail?, tag?, parent? }`
  - `id`: letters, digits, `_ . : -`; unique across nodes and groups.
  - `label` defaults to `id`; wraps at 26 characters. `detail` is a muted second line.
  - `tag`: small uppercase tag above the label; architecture/dataflow default it to the kind; `""` hides it.
  - `parent`: a group id, or (lifecycle) a node of kind `composite`. `group` is an alias.
- `edges[]`: `{ id?, from, to, label?, style?, arrow? }`. `from`/`to` may name nodes or groups.
  `style`: `solid` (default) `dashed` `thick`. `arrow`: `end` (default) `none` `both`.
  Default id is `"from->to"` (`#2`, `#3` for duplicates).
- `groups[]`: `{ id, label?, kind?, parent? }` nested containers (VPC, cluster, tier...). `kind`
  is shown after the label.

| type                    | kinds → shape / accent |
| ----------------------- | ---------------------- |
| architecture, dataflow  | `service` panel/blue, `function` panel/rose, `database` `store` cylinder/gold, `cache` panel/sage, `queue` panel with ticks/rose, `client` panel/plain, `user` actor glyph, `external` dashed panel |
| workflow                | `start` pill/sage, `end` pill/rose, `step` panel/blue, `decision` diamond/gold, `io` parallelogram/sage |
| lifecycle               | `initial` dot, `final` bullseye, `state` panel, `composite` container |

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
  that message (and after any frame closing there); omitted = before the first message.
- `frames[]`: `alt opt loop par critical break`; frames must be disjoint or fully nested;
  `sections` start strictly inside the frame (else / and).

## Mermaid import

| family | supported | ignored with a warning |
| ------ | --------- | ---------------------- |
| `flowchart` / `graph` → workflow | TD/TB/LR/RL/BT (RL→LR, BT→TB); shapes `[] () ([]) [[]] [()] (()) ((())) {} {{}} >] [/ /] [\ \] [/ \]`; edges `--> --- -.-> -.- ==> === --x --o <-->`, `-- text -->`, `-. text .->`, `== text ==>`, `-->|text|`; chaining; `&`; `subgraph id [title] … end` (nested); `%%`; front-matter `title` | `classDef class style linkStyle click`, `:::class`, per-subgraph `direction` |
| `sequenceDiagram` | `participant`/`actor … as …`, `@{type: database}`; `->> -->> -> --> -x --x -) --)`; `Note left of/right of/over a,b`; `loop alt/else opt par/and critical/option break … end`; `activate`/`deactivate`, `+`/`-`; `autonumber`; `title` | `rect`, `box`, `create`, `destroy` |
| `stateDiagram` / `stateDiagram-v2` → lifecycle | `[*]` (per scope), `a --> b : label`, `state "x" as y`, `y : description`, composite `state X { }` (nested), `direction` | `<<choice>>`/`<<fork>>` (plain state), `--` regions, notes, `classDef` |

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
