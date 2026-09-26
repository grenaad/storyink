# Changelog

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
