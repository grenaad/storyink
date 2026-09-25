# Changelog

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
