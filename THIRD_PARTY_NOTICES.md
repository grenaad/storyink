# Third-party notices

## Commit Mono (embedded in every HTML/SVG output)

Commit Mono v1.143 by Eigil Nikolajsen, <https://github.com/eigilnikolajsen/commit-mono>.
Licensed under the SIL Open Font License 1.1; full text in [`fonts/OFL.txt`](fonts/OFL.txt).
`fonts/CommitMono-400.woff2` and `CommitMono-700.woff2` are unmodified format conversions
(OTF → WOFF2 with fontTools) of `CommitMono-400-Regular.otf` / `CommitMono-700-Regular.otf`
from the official release zip. The font is embedded as base64 `@font-face`; it is not sold
by itself.

## React, React DOM, scheduler (bundled into the HTML viewer)

MIT License. Copyright (c) Meta Platforms, Inc. and affiliates. <https://github.com/facebook/react>

## Motion (motion, framer-motion, motion-dom, motion-utils; bundled into the HTML viewer)

MIT License. Copyright (c) 2024 Motion B.V.; Copyright (c) 2018 Framer B.V. <https://github.com/motiondivision/motion>

The viewer bundle inlined into each HTML file starts with a comment banner that carries
these notices and the MIT permission text.

## archify (design reference)

The spec's overall shape (one JSON document per diagram with `type`, `nodes`/`edges`/`groups`,
sequence `participants`/`messages`) was informed by the MIT-licensed archify skill's schemas.
No archify code was copied; storyink's schema, validator and renderer are independent.

## Visual design

The look is an independent reimplementation inspired by Kit Langton's "OpenCode Reloaded"
post (<https://anoma.ly/notes/opencode-reloaded/>). No code, fonts or figure content from that
site are included. Serif headings use system fonts ("Iowan Old Style", Charter, Georgia).

## Mermaid syntax

storyink parses a subset of Mermaid syntax with its own hand-written parsers; no Mermaid
or merman code is included.
