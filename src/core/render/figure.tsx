import { renderToString } from "react-dom/server"
import type { Scene } from "../scene.ts"
import { App } from "./App.tsx"

/**
 * Integration point between pages (src/core/page) and the viewer: the markup that goes inside a
 * page figure's `.sp-fig-root[data-si-fig=<id>]`. The page renderer calls this once per figure and
 * never looks inside the result.
 *
 * The embedded interactive viewer, server-rendered (`renderToString`, so the page's viewer bundle
 * hydrates it in place): captions, an aspect-sized stage with the final frame, the compact toolbar,
 * transport and gate. Its SVG defs carry the figure's id prefix (`figurePrefix(id)`), so several
 * figures share one document without id collisions. Without JavaScript it is the static final frame.
 */
export interface FigureMarkup {
  html: string
}

export function renderFigure(scene: Scene, opts: { id: string }): FigureMarkup {
  return { html: renderToString(<App scene={scene} embedded={{ id: opts.id }} />) }
}
