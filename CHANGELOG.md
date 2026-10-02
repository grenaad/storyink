# Changelog

## Unreleased

- **Change stories**: story step `change` (before look until the step: removed = plain, added =
  absent, modified = plain; then removed edges retract and ghost, removed nodes strike and fade,
  added ones reveal / draw on, modified ones flash and turn gold, diff nodes apply; badges, strikes
  and legend items follow); `story: "changes"` / `{ steps: "changes" }` / `--story changes` /
  tool `story: "changes"` derive the walkthrough (data-flow order, edges and attached diff nodes
  per beat, hero pulse trains, overview, `narrate` from `summary`); `focus` takes a list (union
  box); `spotlight: "veil"` (soft rounded cutout around the step's focus, gliding, gone at the
  end; HTML and animated SVG). Animated SVG: diff rows settle exactly (tighter keyframe tolerance).
- **Narration rail and change drawer** (HTML viewer): story step `narrate: { heading?, body,
  cites? }` (cites link body text to element ids, `node#row` or `path#L12-20`; validated in order,
  refs must resolve). A narrated step without a caption captions with its heading (or the body's
  first sentence) at compile time, so the animated SVG and beat tiles agree; narrated beats hold
  for their body. The viewer shows a rail ("02 / 06", heading, body with cites) that tracks the
  header caption's beat through playback, the scrubber, → / ← and the gate; side column on wide
  screens, bottom sheet below 760 px; toolbar toggle and `N`. Clicking (not dragging) an element
  with `summary` / `files` / a delta opens a drawer with its badge, stat, summary and file refs,
  and with `--changes` the selected hunks as an HTML diff (gutter, tints, syntax colours,
  intra-line marks); Esc / × close it. `#drawer=<id|path>`, `#rail=0|1`,
  `__storyink.openDrawer(id)` / `closeDrawer()` / `drawer()`, `steps[i].narrate`. The scene carries
  embedded `changes` for the drawer. `storyink snapshot --rail --drawer <id>` (tool params `rail`,
  `drawer`; captures the 16:9 page viewport, gates compare the same configuration). The drawer
  takes the rail's column while open. `scripts/narrate-verify.ts` (`bun run verify:narrate`). Example:
  `examples/changes/storyink-0.4.0.pr.json` (commit b526d50). Specs without these fields render
  byte-identically.
- **Diff code nodes**: `code` nodes take `diff` (unified hunk text, `{ file, lines?, context?,
  max? }` resolved by `--changes`, or resolved `{ file, hunks }`): gutter with old | new numbers,
  `+` / `−` markers, sage / rose row tints (`diffAddBg` / `diffDelBg` tokens) with stronger
  intra-line marks (token-level LCS), muted `@@` hunk headers with their section, per-language
  syntax colours, a `… N more lines` fold (`max`, default 24) and long lines cut at 72 columns.
  Anchors `node#+14` (head line) / `node#-13` (base line); `line` takes them and `{ id, hunk }`.
  Story step `apply` (`"id"` or `{ id, hunk?, cps? }`): the node shows the base version until
  then, removed rows tint and strike, added rows open (rows below slide) and type in, gutter
  numbers fade in; HTML and animated SVG. Validation for diff shapes (an unresolved `{ file }`
  without `--changes` is an error with a hint), anchors, `apply` and set / clear / type on diff
  nodes. `diffRows(hunks, lang, { max?, headers? })` row model in `storyink/core`. Animated SVG:
  wired dashed edges and the labels of wired edges now fade with their draw (as in the HTML).
  Change scenes: `unchanged` nodes use the neutral accent. Examples: `payment-retry`,
  `etl-dedupe` (Python + SQL), `storyink-core` (rendered with `--changes`).
- **Change diagrams**: `delta` (`added` / `modified` / `removed` / `unchanged`) on nodes, groups,
  edges, participants and messages; `emphasis` (`hero` / `muted`) on edges and messages; `stat`
  (`+38 −12`), `summary` and `files` (paths or `{ path, lines, revision }`); root `change`
  (`base → head` shown above the diagram) and `style.legend`. Added = sage + `NEW` badge,
  modified = gold + `CHANGED`, removed = rose dashed ghost with a struck label + `REMOVED`,
  unchanged = receded context; hero edges are thicker with a soft glow. Layout reserves badge room
  (header strip, top strip, right slot or a centred row by shape) and a legend band listing the
  deltas present. Static SVG, HTML and animated SVG (change scenes use the union SMIL mode; removed
  edges draw on by opacity so they keep their dash); composes with story levels and rich nodes.
  Validation with JSON paths and hints (enums, file refs, negative stats, added edges to removed
  nodes, more than 2 hero edges). New palette `deltaPalettes` and `delta` geometry tokens, emitted
  only when a scene uses them: specs without the new fields render byte-identically. Examples in
  `examples/changes/` (`batch-email` ported from PR Lens, `auth-session-to-jwt` sequence,
  `rate-limit-plugin` with panel / code / chip deltas).
- **Diff ingestion**: `storyink diff [<range>|<base> [<head>]] [--staged] [--patch file|-] [-o
  changes.json] [--json] [-- <pathspec>…]` parses `git diff` (default: working tree vs the merge
  base with main/master) into a `DiffSet` and prints a per-file summary; `render --changes
  <changes.json|.diff|.patch>` resolves the spec first. Core (browser-safe): `parseUnifiedDiff`,
  `parseHunks`, `selectHunks`, `statFor`, `langForPath`, `normalizeLang`, `coverage`,
  `resolveChanges` (fills `stat` from `files`, resolves `diff: { file, lines }` code nodes,
  embeds the referenced hunks as `changes`, capped at 400 lines per file, and warns about
  uncovered files / hunks and refs that miss the diff). Node: `gitDiff`, `diffSetFrom`.
  Plugin: `storyink_diff` tool and `changes` on `storyink_render`.
- **Code languages**: `py`, `go`, `rust`, `sql`, `yaml`, `sh` lexers; `lang` aliases (`python`,
  `golang`, `rs`, `yml`, `bash`/`shell`/`zsh`, `typescript`/`tsx`, `javascript`/`jsx`) are
  accepted and normalized. TS / JS / JSON colouring is unchanged.

## 0.4.0

- **Rich nodes** (architecture, dataflow, workflow): `panel` (window with rows: `tag`, `icon`,
  `text`, `detail`, `status`, `indent`, `muted`), `code` (syntax-coloured program, `lang`
  ts|js|json|text) and `chip` (icon + label, `stack` 1..3); `size: { cols, lines }` reserves body
  space; `icon` set (wrench plug file terminal search globe bolt user spark); `muted` nodes; bare
  groups (`bare: true`, heading only).
- **Anchors**: edges and story targets may name a panel row (`node#row`) or a code line
  (`node#3`); wires attach at that row/line.
- **Content steps**: `type` (char typing with caret for code, `cps` / `duration`; word typing for
  rows), `set` / `clear` (crossfade), `line` (active-line bar), `status` (spinner + shimmer, check,
  cross), `dim` / `undim` (levels, independent of `hide` / `show`), `wire` / `unwire`, `glow` /
  `unglow`, `focus`. Pulses gain `reverse` and `delay`. Story options `spotlight` and
  `rewind: "glitch"` (HTML only). Typing speed is not scaled by `pace`. Warnings when the end state
  still shows a spinner or a glow.
- **Animated SVG** covers the new content (typing clips, caret, crossfades, line bar, status,
  shimmer, levels, wire/unwire, glows, spotlight) with the final frame still the static diagram.
  Checked in headless Chrome (frame parity, `<img>` playback, loop return); Firefox plays it;
  Safari untested.
- Four examples: `code-mode.architecture`, `retry-helper.architecture`,
  `agent-session.architecture`, `failover.dataflow`; animated SVGs in `docs/gallery/`.
- Fix: with reading holds (pace > 0), a step with an absolute `at` inside a beat stayed at its
  authored time while its beat was pushed later, so it ran out of order and → / ← could stop with
  pulses mid-wire. It now keeps its authored offset from the previous step.
- Docs: `story` is no longer described as reserved; `#t=` documented as a seek.

## 0.3.6

- **Default `story.pace` is 0.6** (was 1): shorter reading holds after each beat. `pace: 1` gives
  the 0.3.5 holds, `pace: 0` the pre-0.3.5 timing. Applies to the viewer, `render` (and
  `--pace`), the plugin and animated SVGs (built with their pace). Durations: OpenWick
  architecture 176 s → 135 s, data flow 95 s → 78 s, checkout 30 s → 26 s, OAuth 57 s → 47 s.
- **Pauses in the viewer**, changeable after the build: a toolbar button (`Pauses: Normal`)
  cycles None (0) · Short (0.3) · Normal (0.6) · Long (1.0) · Longer (1.5); `[` / `]` step down /
  up; the choice is remembered (`localStorage["storyink-pace"]`); `#pace=<n>` wins. The HTML
  embeds a small `timeline.source` and the viewer recompiles the timeline in the browser with the
  same compiler (`recompilePace`, byte-identical to `render --pace`). The reader keeps their place
  (same beat, same progress; `mapStoryTime`) and playback continues; duration, ticks, → / ← stops,
  stepped holds and the follow camera follow the new timeline. Page contract: `pace()`,
  `setPace(n)`. Viewer bundle +16.5 KiB (388.5 → 405.0 KiB).
- `storyink snapshot --pace N` (tool `storyink_snapshot` `pace`) pins the pace for every capture;
  by default snapshots use the author pace.
- **→ / ← no longer wait for the text.** Step moves animate the graph only: → plays to the end
  of the next beat's graph motion (pulses arrived, reveals and draw-ons done; not caption typing,
  glows, trail cooling, rings or the reading hold; `beatMotionEnds`) and pauses; pressed during a
  reading hold (or right after a stop) it starts the next beat at once. ← rewinds the graph at 2×
  to the previous beat's motion end. The beat's caption shows whole and instantly as the move
  starts (← shows the target beat's) and stays at the stop (`storyState(…, { captionBeat })`).
  Continuous play, stepped playback, the scrubber and the default `storyState` are unchanged.
- Stepped (reduced-motion) stops last at least 0.8 s (the bare-beat hold).
- Fix: clicking a toolbar button while the play gate showed also started the story.

## 0.3.5

- **Fix: the diagram showed a hover tooltip** (the diagram title) wherever the cursor rested. The
  SVG carried a `<title>`, which browsers show as a tooltip. It's gone from the viewer, static
  `.svg` exports and the animated SVG; the accessible name stays as `role="img"` +
  `aria-label` on the root. Toolbar and transport hints are unchanged.
- **Reading holds.** Continuous playback now pauses after each beat so the reader can read it:
  1 s + 0.3 s per word of the beat's caption, clamped to 1.5–6 s, or 0.8 s without a caption,
  counted from when the beat is visually still (nothing changes during it; the caption stays up).
  The animation speed is unchanged. Compiled into the timeline, so the viewer, scrubber, beat
  sheets, snapshots and the animated SVG agree. Stepped (reduced-motion) playback holds each stop
  for the same number; → / ← still stop at the settled beat without waiting.
  - `story.pace` (multiplier, default 1; `0` = the 0.3.4 timing) and a per-step `hold` (seconds,
    for the beat it ends); `render --pace`, tool `storyink_render` `pace`; core `readingHold`,
    `compileStoryAuthored`.
  - An absolute `at` is now a *minimum* start; relative `"+x"` steps shift.
  - Stories run longer: OpenWick architecture 55 s → 176 s, data flow 29 s → 95 s, checkout
    13 s → 30 s, OAuth 17 s → 57 s. The 60 s length warning counts the authored timing only.

## 0.3.4

- **Fix: → stopped before the next box was visible.** Step moves targeted the next step *start*,
  and stories split a pulse and the reveal it causes into consecutive steps, so → stopped as the
  dot arrived, before its target box appeared. → / ← now land on the next / previous **beat stop**:
  a pulse and the reveal of its target are one beat, and the stop is where they (and the caption)
  have settled. One definition, `beatGroups`, now drives step moves, stepped (reduced-motion)
  playback, scrubber ticks and beat tiles. A reveal step that has its own caption now joins the
  pulse whose target it reveals.
  - Captions finish typing within their step (the last word no longer settles after the step ends).
  - Step end times round up to the millisecond, so a stop is never a fraction of a millisecond
    before its dot lands.
- **Fix: sharp light-grey corners during animation.** The pulse trail and dot followed the route's
  corner points (straight segments with sharp corners) instead of the rounded wire. Routes now use
  `flattenPath(edge.d)`, the drawn curve sampled in core, in the HTML viewer and the SMIL animated
  SVG. The draw-on dash length is the rounded wire's length, and multi-hop routes no longer cut the
  corner of the next wire.
- Core: `beatGroups`, `beatStops`, `beatChapters`, `beatTicks`, `flattenPath`.
- `verify:viewer`: → from OpenWick beat stops ends with the dot's target box visible. Chrome is
  always killed (exit, signals, uncaught errors, plus a watchdog if the runner is SIGKILLed; a
  20 min cap), CDP calls time out after 30 s, and the run has a 15 min deadline.

## 0.3.3

- **Fix: `snapshot --camera follow` wasn't deterministic on real diagrams** (`follow-deterministic`
  failed on OpenWick's 24- and 18-node architecture/data-flow diagrams). The DOM, camera and
  transform were identical across runs; what varied was Chrome's paint history. Some runs painted a
  frame at the fit transform before the followed camera was placed, which changed the canvas
  raster (anti-aliasing of some node boxes and text). With `#camera=follow&t=` the canvas now stays
  hidden until the followed camera has painted. `follow-deterministic` now re-captures every
  `at` frame, not only the first.
- **Arrow keys animate step moves.** → plays forward to the next step boundary and pauses (while
  playing: advance one step); ← rewinds backwards at 2× to the previous boundary with a short
  bounce-free ease. Shift goes by chapter, repeated presses extend the target, and the opposite key
  reverses. Space pauses a move, the follow camera follows it (backwards too), and reduced motion
  still jumps.
  - `window.__storyink.step(dir, chapter?)` animates the same way and returns a Promise;
    `stepAnimated()` is the running move. `state()` reads the clock/mode without render lag.
  - Core: `stepBoundary`, `stepMoveTarget`, `stepMoveSpeed`, `STEP_MOVE`.
- `verify:viewer` drives → / ← / Shift / Space with real key events (CDP `Input.dispatchKeyEvent`).

## 0.3.2

- **Fix: clicking the transport's play/pause did nothing** (space worked). The stage's native
  `pointerdown` listener, which starts a pan, ran before React's root listener, so the controls'
  React `stopPropagation` came too late: the stage captured the pointer and the button's `click`
  never fired. Pans now start only on the diagram surface (not on buttons, the scrubber, the
  toolbar, the transport, the gate or `[data-no-pan]`) and capture the pointer only after 3 px of
  movement, so a still click on the surface stays a click. Quick repeated −/+ clicks now compound.
- **Follow camera.** While a story plays on a large diagram, the viewer zooms to a readable scale
  (labels ≈ 12.4 px, when fit would render them below 10 px) and pans to each step, moving only
  when the step's focus leaves the inner 80 % of the view (bounce-free spring, 0.75 s), then eases
  back to fit at the end. Manual zoom is kept (follow pans); a drag suspends follow until the next
  out-of-view step; reduced motion jumps; scrubbing and ←/→ move the camera too.
  - Toolbar **Follow** toggle (`aria-pressed`, `F`), saved in `localStorage["storyink-follow"]`.
  - `story.camera: "follow" | "fit"` (default follow), `render --camera`, tool `storyink_render`
    `camera`; `#camera=follow|fit`; `window.__storyink.camera()`.
  - Core: `stepFocus`, `cameraAt` (pure: t + stage + scale → camera), `followStep`,
    `readableScale`, `fitCamera`, `inView`, `stepAt`, `CAMERA`.
  - `storyink snapshot --camera follow --at …` (tool `camera`) captures the followed view in a
    16:9 stage, with a `follow-deterministic` gate. Default snapshots and beat sheets stay at fit.
- `bun run verify:viewer` drives every control with real mouse input (CDP
  `Input.dispatchMouseEvent`) in full and reduced motion, and checks the follow camera on a
  25-node diagram (readable zoom, pans, drag suspend/resume, end at fit, toggle persistence,
  reduced jumps).
- Not in the animated SVG (SMIL): a follow camera there would need an animated `viewBox`; a
  possible follow-up.

## 0.3.1

- **Fix: Play did nothing under reduced motion.** With Reduce Motion on (OS or `#motion=reduced`),
  Play now walks the story step by step ("Play steps"): each step's settled state at once (reveals,
  landed pulses, counters, the whole caption), held for its reading time (caption read time or
  1.5 s), then the next, ending on the final frame. No pulses, trails, glows or tweens. Pause, ←/→,
  Shift+←/→, R (restart from step 1, no rewind) and the scrubber work on settled steps. The page
  loads on the final frame with a static play button; `autoplay` is ignored.
- **`story.motion`: `"full"` (default) | `"reduced"` | `"system"`.** Full motion is the default and
  **ignores the reader's OS reduced-motion setting**; `"system"` restores the 0.3.0 behaviour
  (follow `prefers-reduced-motion`), `"reduced"` always steps. Auto stories:
  `{ "steps": "auto", "motion": … }`, `render --motion …`, tool `storyink_render` `motion`.
  Precedence: `#motion=` > the reader's toolbar choice > `story.motion` > OS (only for `"system"`).
- Viewer toolbar: **Motion: full / reduced** toggle (`aria-pressed`, shortcut `M`), saved in
  `localStorage`; `#motion=` still wins. Switching mid-playback continues from the current step.
- Core: `steppedSchedule`, `steppedTime`, `steppedIndex`, `steppedStop`, `STEP_BEAT` and
  `storyState(…, { stepped: true })`.
- Snapshot: `--motion reduced` (tool `motion`) captures stepped `at` frames; new gate `reduced=stepped`.
- Fix: live counter reels were placed at the node-local position (top-left of the diagram) and
  shown before their node was revealed; they now sit on their node and follow its reveal.
  `bun run verify:viewer` checks this in headless Chrome (full play, reduced → full, reload,
  resize, theme toggle) along with stepped playback.

## 0.3.0

- **Animated SVG (SMIL):** the story plays inside a plain `<img>`, so in GitHub READMEs and PR
  comments (camo), docs and chat previews, where no script runs.
  - `renderAnimatedSvg(spec, { theme, once, font, hold, reset, fps })` / `animatedSvg()` in
    `storyink/core`; `writeAnimatedSvg()` and `pictureSnippet()` in `storyink/node`.
  - CLI: `storyink render x.json --animated-svg x.svg [--theme light|dark|both] [--once] [--font system|embed]`;
    `both` writes `.light.svg` + `.dark.svg` and prints the `<picture>` snippet. Specs without a
    story use the auto story (with a warning).
  - Plugin: `storyink_render` takes `animatedSvg: true | "both"`, `animatedSvgPath`, `once`, `font`.
  - Built by sampling `storyState(t)` (the viewer's frame function) and compressing each track
    to SMIL keyframes; one shared cycle (story, 3 s hold, 0.4 s reset) or `once` (freeze).
    Base values are the final frame. Theme-pinned, no custom properties, deterministic.
  - `bun run gallery:animated`, `bun run verify:smil` (frame parity PSNR, `<img>` playback, font).
- `Frame` pulse trail segments carry `k`, `s0`, `s1`; captions carry their index `i`.
- `screenshotPage()` in `storyink/node`: screenshot any local page.

## 0.2.1

- **Fix:** `storyink_snapshot` no longer inlines the full-resolution contact sheet. Tall beat
  sheets (1440 px wide, thousands of px tall) could stall the next model request and bloat
  session context. It now returns **one compact JPEG preview**, with its longest side at most
  1024 px and a 300 KB budget. Beat sheets are reflowed into 3–8 columns so they fit in one
  image.
  - New tool options: `image: "overview" | "full" | "none"` (default `overview`; `full` returns
    at most 3 parts) and `maxImageSize` (default 1024).
  - Full-resolution PNGs stay on disk and are listed in the text result.
- CLI: `storyink snapshot … --preview out.jpg [--preview-size 1024]` writes the same preview.
- Snapshot receipts include `previews` (path, size, bytes, what the image shows).
- The beat-sheet page accepts `#cols=N`, `#range=a-b` and `#zoom=z`.
- SKILL.md: guidance on keeping image reads few and on using `at` frames for detail.

## 0.2.0

- Storyboard mode: `story` steps and `"story": "auto"`, the pure `storyState(t)`, the viewer
  transport and counters. Snapshot gets `--at`, `--sheet beats` and the static gates.
- Fixes: captions belong to their own step, humanised beat titles, warm light-theme glow,
  beat sheets sized to their content.

## 0.1.0

- First release: spec, validation, Mermaid import, layout, SSR/viewer, CLI, OpenCode plugin.
