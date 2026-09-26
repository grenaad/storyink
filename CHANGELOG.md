# Changelog

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
