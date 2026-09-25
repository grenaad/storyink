import { fonts, geometry as G, type as T, v, ACCENTS, type Palette } from "../../theme/tokens.ts"

/** Diagram rules. Colours come only from the `--si-*` variables. */
export function diagramCss(): string {
  const accentRules = ACCENTS.map(
    (a) =>
      `.si-a-${a}{--si-accent:${v(a as keyof Palette)};--si-accentFill:${v(`${a}Fill` as keyof Palette)};}`,
  ).join("")
  return `
.storyink{font-family:${fonts.mono};font-variant-ligatures:none;font-feature-settings:"calt" 0;}
.storyink text{font-family:${fonts.mono};fill:${v("ink")};}
.si-bg{fill:${v("bg")};}
${accentRules}
.si-face{fill:${v("panel")};stroke:${v("line")};stroke-width:${G.panelStroke};}
.si-inset{fill:none;stroke:${v("lineSoft")};stroke-width:1;}
.si-ink-bar{fill:var(--si-accent);}
.si-soft{fill:var(--si-accentFill);stroke:var(--si-accent);stroke-width:1;}
.si-dash{stroke-dasharray:4 3;}
.si-glyph{fill:none;stroke:var(--si-accent);stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round;}
.si-dotfill{fill:${v("ink")};}
.si-ring{fill:none;stroke:${v("ink")};stroke-width:1.4;}
.si-note{fill:${v("goldFill")};stroke:${v("gold")};stroke-width:1;}
.si-note-fold{fill:none;stroke:${v("gold")};stroke-width:1;}
.storyink .si-label{font-size:${T.label}px;fill:${v("ink")};}
.storyink .si-detail{font-size:${T.detail}px;fill:${v("inkMuted")};}
.storyink .si-tag{font-size:${T.tag}px;letter-spacing:${T.tagTracking}em;fill:var(--si-accent);}
.storyink .si-pill-label{font-size:${T.label - 1}px;}
.si-group{fill:${v("group")};stroke:${v("groupLine")};stroke-width:1;}
.si-group-composite{fill:${v("panelAlt")};stroke:${v("line")};stroke-width:1;}
.storyink .si-group-label{font-size:${T.groupLabel}px;letter-spacing:${T.tagTracking}em;fill:${v("inkFaint")};}
.storyink .si-group-title{font-size:${T.label - 1}px;fill:${v("inkMuted")};}
.si-group-rule{stroke:${v("groupLine")};stroke-width:1;}
.si-wire{fill:none;stroke:${v("wire")};stroke-width:${G.wireWidth};stroke-linecap:round;stroke-linejoin:round;}
.si-wire.si-dashed{stroke-dasharray:5 4;}
.si-wire.si-thick{stroke-width:${G.wireWidth * 2};stroke:${v("port")};}
.si-arrow{fill:${v("wire")};stroke:${v("wire")};stroke-width:1;stroke-linejoin:round;}
.si-arrow-open{fill:none;stroke:${v("wire")};stroke-width:${G.wireWidth};stroke-linecap:round;stroke-linejoin:round;}
.si-port{fill:${v("port")};}
.si-pill{fill:${v("pill")};stroke:${v("lineSoft")};stroke-width:1;}
.storyink .si-edge-label{font-size:${T.edgeLabel}px;fill:${v("inkMuted")};}
.si-life{stroke:${v("line")};stroke-width:1;stroke-dasharray:3 4;}
.si-act{fill:${v("panelAlt")};stroke:${v("line")};stroke-width:1;}
.si-frame{fill:none;stroke:${v("line")};stroke-width:1;}
.si-frame-tag{fill:${v("panelAlt")};stroke:${v("line")};stroke-width:1;}
.storyink .si-frame-kind{font-size:${T.tag}px;letter-spacing:${T.tagTracking}em;fill:${v("inkMuted")};font-weight:700;}
.storyink .si-frame-label{font-size:${T.detail}px;fill:${v("inkMuted")};}
.si-frame-rule{stroke:${v("line")};stroke-width:1;stroke-dasharray:4 4;}
.si-seq{fill:${v("ink")};}
.storyink .si-seq-text{font-size:8.5px;fill:${v("bg")};font-weight:700;}
`.trim()
}

export function fontFaceCss(b400: string, b700: string): string {
  return (
    `@font-face{font-family:"Commit Mono";font-style:normal;font-weight:400;font-display:block;src:url(data:font/woff2;base64,${b400}) format("woff2");}` +
    `@font-face{font-family:"Commit Mono";font-style:normal;font-weight:700;font-display:block;src:url(data:font/woff2;base64,${b700}) format("woff2");}`
  )
}

/** Viewer page rules (chrome, header, stage). */
export function viewerCss(): string {
  return `
*{box-sizing:border-box;}
html,body{margin:0;height:100%;}
body{background:${v("bg")};color:${v("ink")};font-family:${fonts.mono};-webkit-font-smoothing:antialiased;}
.si-app{display:flex;flex-direction:column;height:100vh;overflow:hidden;}
.si-head{padding:26px 32px 10px;flex:none;}
.si-title{font-family:${fonts.serif};font-weight:500;font-size:${T.title}px;line-height:1.15;margin:0;color:${v("title")};letter-spacing:-0.01em;}
.si-subtitle{font-family:${fonts.serif};font-style:italic;font-size:${T.subtitle}px;line-height:1.4;margin:6px 0 0;color:${v("inkMuted")};}
.si-kind{font-size:${T.tag}px;letter-spacing:${T.tagTracking * 1.5}em;text-transform:uppercase;color:${v("inkFaint")};margin:0 0 8px;}
.si-stage{position:relative;flex:1;overflow:hidden;cursor:grab;touch-action:none;}
.si-stage.si-dragging{cursor:grabbing;}
.si-canvas{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform;}
.si-canvas svg{display:block;}
.si-tools{position:absolute;right:16px;bottom:16px;display:flex;gap:6px;padding:5px;border:1px solid ${v("chromeLine")};background:${v("chrome")};border-radius:4px;}
.si-btn{appearance:none;border:1px solid transparent;background:transparent;color:${v("inkMuted")};font:inherit;font-size:11px;letter-spacing:0.04em;height:26px;min-width:26px;padding:0 8px;border-radius:3px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;}
.si-btn:hover{color:${v("ink")};border-color:${v("chromeLine")};}
.si-btn:focus-visible{outline:1px solid ${v("inkMuted")};outline-offset:1px;}
.si-sep{width:1px;background:${v("chromeLine")};margin:3px 2px;}
.si-sheet{display:grid;grid-template-columns:1fr 1fr;gap:0;flex:1;min-height:0;}
.si-sheet>div{padding:18px 24px 24px;background:${v("bg")};color:${v("ink")};display:flex;flex-direction:column;min-width:0;}
.si-sheet .si-sheet-cap{font-size:${T.tag}px;letter-spacing:${T.tagTracking * 1.5}em;text-transform:uppercase;color:${v("inkFaint")};margin:0 0 10px;}
.si-sheet svg{width:100%;height:auto;max-height:100%;}
.si-nochrome .si-tools{display:none;}
.si-noscript .si-tools{display:none;}
.si-noscript .si-stage{overflow:auto;cursor:auto;}
.si-noscript .si-canvas{position:static;margin:0 auto;}
`.trim()
}
