# storyink

Architecture, workflow, sequence, data-flow and lifecycle diagrams from a small JSON spec (or
Mermaid) into **one offline HTML file** (a React + Motion viewer over server-rendered SVG) and a
**static SVG**. Warm ink-on-paper style with Commit Mono labels, light and dark themes.

One package, four ways to use it: library, CLI, OpenCode plugin, and a skill for other agents.

```sh
npx storyink render examples/checkout.architecture.json -o checkout.html --svg checkout.svg
```

The HTML has no external requests. It includes pan/zoom (wheel at the cursor, drag, `+`/`-`/`0`,
fit on load), a theme toggle that follows `prefers-color-scheme` and is saved in `localStorage`,
SVG export, and 2× PNG export. It also works without JavaScript.

## 1. Library

```ts
import { validate, fromMermaid, renderHtml, renderSvg, layout } from "storyink/core" // browser-safe
import { writeDiagram, snapshot, findBrowser } from "storyink/node" // Node only

const v = validate(spec) // { ok, diagnostics: [{ severity, path, message, hint }], spec }
const html = renderHtml(v.spec!) // standalone page
const svg = renderSvg(v.spec!, { theme: "dark" }) // omit theme to follow prefers-color-scheme
const scene = layout(v.spec!) // absolute geometry with stable ids (nodes, groups, edges, ports, labels)
const m = fromMermaid("flowchart LR\n a --> b") // { ok, spec, diagnostics }
```

`storyink/core` has no Node APIs. The viewer bundle and the font are compiled in as string
modules, so it works with bundlers and in the browser. `storyink` (the root export) re-exports
both and has the OpenCode plugin as its default export. Runs on Node ≥ 20 and Bun.

## 2. CLI

```
storyink render <in.json|in.mmd|-> [-o out.html] [--svg out.svg] [--theme light|dark]
storyink mermaid <in.mmd> [-o out.json]
storyink validate <in> [--json]
storyink snapshot <out.html> [--theme light,dark] [--width N] [--no-sheet] [--scale 2] [-o dir] [--json]
storyink skill
```

`snapshot` finds a browser in this order: `$STORYINK_CHROME`, then the newest Playwright
`chrome-headless-shell`, then system Chrome (`--headless=new`). It writes one PNG per theme and
a light|dark contact sheet, reads the in-page lint through `--dump-dom`, and writes a receipt
JSON containing the browser, flags, sha256 of each image, lint results and gates. Exit codes:
0 pass, 1 gate failed, 2 no browser.

## 3. OpenCode plugin

From npm (once published), pinned or not:

```jsonc
// opencode.json (global ~/.config/opencode/ or project .opencode/)
{ "plugins": ["storyink"] }            // or "storyink@0.1.0"
```

From a local checkout, for development: build first, then point `plugins` at the **directory**
(OpenCode v2 accepts directories here, not single files):

```sh
cd ~/projects/storyink && bun install && bun run build
```

```jsonc
// <project>/.opencode/opencode.json
{ "plugins": ["/absolute/path/to/storyink"] }
```

OpenCode resolves a local plugin directory as `<dir>/server` and then `<dir>/index`. It does not
read `package.json` `main`, which is why the repo ships a root `server.js` that re-exports
`dist/index.js`. npm packages resolve `storyink/server` and then `storyink`, and both are exported.
Rebuild after changes, then restart the server (or touch the config) to reload.

This adds the tools `storyink_render`, `storyink_from_mermaid`, `storyink_validate` and
`storyink_snapshot`. `storyink_snapshot` returns the contact sheet as an image, so the model can
see its own render. The plugin also adds the `storyink` skill (`skill/SKILL.md`), which covers
choosing a diagram type, writing the spec, and the render → look → fix loop. If you already have
a skill with the id `storyink`, yours is kept. Relative paths resolve against the project
directory.

## 4. Other agents

Use the CLI, and install the skill from the package:

```sh
npx storyink skill        # prints the SKILL.md path and its content
```

An MCP server is planned.

## Gallery

`bun run gallery` renders every example and Mermaid sample and writes one light and one dark PNG per
example to `docs/gallery/`.

| | |
| --- | --- |
| ![Checkout platform](docs/gallery/checkout.architecture.light.png) | ![Agent run lifecycle](docs/gallery/agent-run.lifecycle.dark.png) |
| ![Release pipeline](docs/gallery/release.workflow.light.png) | ![OAuth sequence](docs/gallery/oauth.sequence.dark.png) |
| ![Analytics pipeline](docs/gallery/analytics.dataflow.dark.png) | ![Order state machine (Mermaid)](docs/gallery/order.state.light.png) |

## Spec

See [docs/spec.md](docs/spec.md) and [schema/storyink.schema.json](schema/storyink.schema.json).
Graph edges have no arrowheads by default, matching Kit's style. Set `"style": { "arrowheads": true }`
to draw them. If you leave out `direction`, the layout picks TB or LR, whichever gets the aspect
ratio closer to 16:10.
Examples of each type are in [examples/](examples), and Mermaid samples are in
[examples/mermaid/](examples/mermaid).

## Develop

```sh
bun install
bun test          # generates src/generated/* first
bun run typecheck
bun run build     # dist/ (ESM for node, .d.ts, CLI with a node shebang)
bun run gallery   # docs/gallery/*.png (needs Chrome / Playwright headless shell)
```

All design tokens (palette, type, geometry, motion) live in `src/theme/tokens.ts` and are
exported as CSS variables.

## License

MIT © 2026 grenaad. The bundled font and libraries are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
