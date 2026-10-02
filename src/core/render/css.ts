import { delta as DL, fonts, geometry as G, type as T, v, ACCENTS, type Palette } from "../../theme/tokens.ts"

/** Rules for rich nodes (panel / code / chip, bare groups); only emitted for scenes that use them. */
export function richCss(): string {
  const tk = (k: string, c: Parameters<typeof v>[0]) => `.storyink .si-tk-${k}{fill:${v(c)};}`
  return `
.si-win{fill:${v("panel")};stroke:${v("line")};stroke-width:${G.panelStroke};}
.si-win-head{fill:${v("panelAlt")};stroke:none;}
.si-win-rule{stroke:${v("line")};stroke-width:1;}
.storyink .si-win-title{font-size:${T.header}px;letter-spacing:${T.tagTracking * 1.5}em;fill:${v("inkMuted")};}
.si-icon{fill:none;stroke:${v("inkMuted")};stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round;}
.storyink .si-row-tag{font-size:${T.tag}px;letter-spacing:${T.tagTracking}em;fill:${v("inkFaint")};}
.storyink .si-row-text{font-size:${T.row}px;fill:${v("ink")};white-space:pre;}
.storyink .si-row-detail{fill:${v("inkFaint")};}
.si-status path{fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;}
.si-status-running path{stroke:${v("inkMuted")};}
.si-status-done path{stroke:${v("inkMuted")};}
.si-status-error path{stroke:${v("statusError")};}
.storyink .si-code-line{font-size:${T.code}px;fill:${v("ink")};white-space:pre;}
${tk("kw", "codeKw")}${tk("op", "codeKw")}${tk("str", "codeStr")}${tk("num", "codeConst")}${tk("def", "codeConst")}${tk("type", "codeConst")}${tk("fn", "codeFn")}${tk("param", "codeParam")}${tk("com", "codeCom")}
.si-code-bar{fill:${v("codeBar")};}
.si-code-bar-edge{fill:${v("codeBarEdge")};}
.si-caret{fill:${v("ink")};}
.si-lit-rim{fill:none;stroke:${v("ink")};stroke-width:1;}
.si-stage svg.storyink{overflow:visible;}
.si-chip-sheet{fill:${v("panel")};stroke:${v("line")};stroke-width:1;}
.storyink .si-chip-label{font-size:${T.label}px;fill:${v("ink")};}
`.trim()
}

/** Diagram rules. Colours come only from the `--si-*` variables. `rich` adds the rich-node rules, `changes` the change-diagram rules. */
export function diagramCss(rich = false, changes = false): string {
  const css = rich ? `${baseCss()}\n${richCss()}` : baseCss()
  return changes ? `${css}\n${deltaCss()}` : css
}

/** Rules for change diagrams (delta / emphasis / stat / legend); only emitted for scenes that use them. */
export function deltaCss(): string {
  const D = [
    ["added", "deltaAdded"],
    ["modified", "deltaModified"],
    ["removed", "deltaRemoved"],
  ] as const
  const per = D.map(([d, k]) => {
    const fill = `${k}Fill` as const
    return [
      `.si-d-${d} .si-face,.si-d-${d} .si-win,.si-d-${d} .si-soft,.si-d-${d} .si-note,.si-d-${d} .si-ring{stroke:${v(k)};}`,
      `.si-d-${d} .si-dotfill{fill:${v(k)};}`,
      `.si-badge-${d}{fill:${v(fill)};stroke:${v(k)};stroke-width:1;}`,
      `.storyink .si-badge-text-${d}{fill:${v(k)};}`,
      `.si-edge.si-d-${d} .si-wire,.si-edge.si-d-${d} .si-hero-glow{stroke:${v(k)};}`,
      `.si-edge.si-d-${d} .si-arrow{fill:${v(k)};stroke:${v(k)};}`,
      `.si-edge.si-d-${d} .si-arrow-open{stroke:${v(k)};}`,
      `.si-port.si-d-${d}{fill:${v(k)};}`,
      `.storyink .si-lbl.si-d-${d} .si-edge-label,.storyink .si-grp.si-d-${d} .si-group-label,.storyink .si-grp.si-d-${d} .si-group-title,.storyink .si-group-badge-${d}{fill:${v(k)};}`,
      `.si-sw-${d}{fill:${v(fill)};stroke:${v(k)};stroke-width:1;}`,
    ].join("\n")
  }).join("\n")
  return `
${per}
.si-d-removed .si-face,.si-d-removed .si-win,.si-d-removed .si-soft,.si-d-removed .si-note,.si-grp.si-d-removed .si-group,.si-sw-removed{stroke-dasharray:5 3;}
.si-edge.si-d-removed .si-wire{stroke-dasharray:5 4;}
.si-life.si-d-removed{stroke:${v("deltaRemoved")};stroke-opacity:0.55;}
.si-strike{stroke:${v("deltaRemoved")};stroke-width:1.2;stroke-linecap:round;}
.storyink .si-badge-text{font-size:${DL.badgeFont}px;letter-spacing:${T.tagTracking}em;font-weight:700;}
.storyink .si-stat{font-size:${DL.statFont}px;font-variant-numeric:tabular-nums;}
.storyink .si-stat-add{fill:${v("deltaAdded")};}
.storyink .si-stat-del{fill:${v("deltaRemoved")};}
.si-edge.si-hero .si-wire{stroke-width:${DL.heroWidth};}
.si-edge.si-hero:not(.si-d-added):not(.si-d-modified):not(.si-d-removed) .si-wire,.si-hero-glow{stroke:${v("deltaHero")};}
.si-hero-glow{fill:none;stroke-width:${DL.heroGlow};stroke-opacity:${DL.heroGlowOpacity};stroke-linecap:round;stroke-linejoin:round;}
svg[data-storyink="sequence"] .si-edge.si-d-added .si-wire{stroke-width:${DL.addedMessageWidth};}
.si-sw-unchanged{fill:${v("panel")};stroke:${v("line")};stroke-width:1;}
.storyink .si-legend-text{font-size:${T.tag}px;letter-spacing:${T.tagTracking}em;fill:${v("inkMuted")};}
.storyink .si-legend-meta{font-size:${T.detail}px;fill:${v("inkMuted")};}
.si-d-added .si-ink-bar{fill:${v("deltaAdded")};}
.si-d-modified .si-ink-bar{fill:${v("deltaModified")};}
.si-d-removed .si-ink-bar{fill:${v("deltaRemoved")};}
.si-veil-shade{fill:${v("bg")};fill-opacity:0.68;}
.si-veil-rim{fill:none;stroke:${v("line")};stroke-width:1;stroke-opacity:0.7;}
.si-diff-bg-add{fill:${v("diffAddBg")};}
.si-diff-bg-del{fill:${v("diffDelBg")};}
.si-diff-mk-add{fill:${v("diffAddMark")};}
.si-diff-mk-del{fill:${v("diffDelMark")};}
.si-diff~.si-bar .si-code-bar{fill-opacity:0.55;}
.si-diff-rule{stroke:${v("lineSoft")};stroke-width:1;}
.si-diff-hunk-bg{fill:${v("panelAlt")};}
.storyink .si-diff-num{font-size:${T.detail}px;fill:${v("inkFaint")};font-variant-numeric:tabular-nums;}
.storyink .si-diff-hunk{font-size:${T.detail}px;fill:${v("inkFaint")};white-space:pre;}
.storyink .si-diff-fold{font-size:${T.detail}px;fill:${v("inkFaint")};font-style:italic;}
.storyink .si-diff-sign{font-size:${T.code}px;font-weight:700;}
.storyink .si-diff-sign-add{fill:${v("deltaAdded")};}
.storyink .si-diff-sign-del{fill:${v("deltaRemoved")};}
.si-diff-strike{stroke:${v("deltaRemoved")};stroke-width:1;stroke-opacity:0.65;}
`.trim()
}

function baseCss(): string {
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
.si-band{fill:${v("panelAlt")};fill-opacity:0.75;stroke:none;}
.si-group-composite{fill:${v("panelAlt")};stroke:${v("line")};stroke-width:1;}
.storyink .si-group-label{font-size:${T.groupLabel}px;letter-spacing:${T.tagTracking}em;fill:${v("inkFaint")};}
.storyink .si-group-title{font-size:${T.label - 1}px;fill:${v("inkMuted")};}
.si-group-rule{stroke:${v("groupLine")};stroke-width:1;}
.si-wire{fill:none;stroke:${v("wire")};stroke-width:${G.wireWidth};stroke-linecap:round;stroke-linejoin:round;}
.si-wire.si-dashed{stroke-dasharray:3 5;}
.si-wire.si-thick{stroke-width:${G.wireWidth * 2};stroke:${v("port")};}
.si-arrow{fill:${v("wire")};stroke:${v("wire")};stroke-width:1;stroke-linejoin:round;}
.si-arrow-open{fill:none;stroke:${v("wire")};stroke-width:${G.wireWidth};stroke-linecap:round;stroke-linejoin:round;}
.si-port{fill:${v("port")};}
.si-pill{fill:${v("bg")};stroke:none;}
.si-pill.si-on-group{fill:${v("group")};}
.si-pill.si-on-composite{fill:${v("panelAlt")};}
.storyink .si-edge-label{font-size:${T.edgeLabel}px;letter-spacing:0.02em;fill:${v("inkMuted")};}
.si-life{stroke:${v("line")};stroke-width:1;stroke-dasharray:3 4;}
.si-act{fill:${v("panelAlt")};stroke:${v("line")};stroke-width:1;}
.si-frame{fill:none;stroke:${v("line")};stroke-width:1;}
.si-frame-tag{fill:${v("panelAlt")};stroke:${v("line")};stroke-width:1;}
.storyink .si-frame-kind{font-size:${T.tag}px;letter-spacing:${T.tagTracking}em;fill:${v("inkMuted")};font-weight:700;}
.storyink .si-frame-label{font-size:${T.detail}px;fill:${v("inkMuted")};}
.si-frame-rule{stroke:${v("line")};stroke-width:1;stroke-dasharray:4 4;}
.si-seq{fill:${v("ink")};}
.si-pulse{fill:${v("pulse")};}
.si-halo{fill:${v("pulseBloom")};}
.si-ring-pulse{fill:none;stroke:${v("pulse")};}
.si-trail{fill:none;stroke:${v("pulse")};stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;}
.storyink .si-counter{font-size:${T.counter}px;font-variant-numeric:tabular-nums lining-nums;fill:${v("ink")};}
.storyink .si-counter-label{font-size:${T.tag}px;letter-spacing:${T.tagTracking}em;fill:${v("inkMuted")};}
.storyink .si-seq-text{font-size:8.5px;fill:${v("bg")};font-weight:700;}
`.trim()
}

export function fontFaceCss(b400: string, b700: string): string {
  return (
    `@font-face{font-family:"Commit Mono";font-style:normal;font-weight:400;font-display:block;src:url(data:font/woff2;base64,${b400}) format("woff2");}` +
    `@font-face{font-family:"Commit Mono";font-style:normal;font-weight:700;font-display:block;src:url(data:font/woff2;base64,${b700}) format("woff2");}`
  )
}

/** Viewer page rules (chrome, header, stage); narration rail / drawer rules only when used. */
export function viewerCss(ui: { narrate?: boolean; drawer?: boolean } = {}): string {
  return baseViewerCss() + (ui.narrate || ui.drawer ? `\n${sideCss()}` : "") + (ui.narrate ? `\n${railCss()}` : "") + (ui.drawer ? `\n${drawerCss()}` : "")
}

/**
 * Stage + one side column (narration rail or drawer). Narrow screens: a bottom sheet whose height
 * is clamped so the stage keeps at least 160 px.
 */
function sideCss(): string {
  return `
.si-main{flex:1;display:flex;min-height:0;}
.si-main>.si-stage{flex:1;min-width:0;min-height:160px;}
@media (max-width:760px){.si-main{flex-direction:column;}.si-main>.si-rail,.si-main>.si-drawer{width:auto;flex:0 1 auto;min-height:96px;max-height:min(50vh,max(96px,calc(100vh - 380px)));border-left:0;border-top:1px solid ${v("chromeLine")};}}
`.trim()
}

/** Narration rail: a right column beside the stage, a bottom sheet on narrow screens. */
function railCss(): string {
  return `
.si-rail{flex:none;width:340px;overflow:auto;padding:18px 24px 24px;border-left:1px solid ${v("chromeLine")};background:${v("bg")};font-size:13px;line-height:1.6;color:${v("ink")};}
.si-rail-top{display:flex;align-items:center;justify-content:space-between;margin:0 0 10px;}
.si-rail-n{font-size:${T.tag}px;letter-spacing:${T.tagTracking * 1.5}em;color:${v("inkFaint")};font-variant-numeric:tabular-nums;}
.si-rail-x,.si-drawer-x{appearance:none;border:1px solid transparent;background:none;color:${v("inkMuted")};font:inherit;font-size:16px;line-height:1;width:24px;height:24px;border-radius:3px;cursor:pointer;}
.si-rail-x:hover,.si-drawer-x:hover{color:${v("ink")};border-color:${v("chromeLine")};}
.si-rail-h{font-family:${fonts.serif};font-weight:500;font-size:19px;line-height:1.25;margin:0 0 10px;color:${v("title")};}
.si-rail-body{margin:0;white-space:pre-line;}
.si-cite{border-bottom:1px solid ${v("inkFaint")};cursor:default;outline:none;}
.si-cite:hover,.si-cite:focus-visible{background:color-mix(in srgb, ${v("ink")} 8%, transparent);border-bottom-color:${v("ink")};}
.si-cite-file{cursor:pointer;border-bottom-style:dashed;}
@media (max-width:760px){.si-rail{padding:12px 18px 16px;}.si-rail-h{font-size:16px;}}
@media print{.si-rail{display:none!important}}
`.trim()
}

/** Change drawer: fixed side panel with the element's change and its hunks (diff look, both themes). */
function drawerCss(): string {
  const tk = (k: string, c: Parameters<typeof v>[0]) => `.si-dk-${k}{color:${v(c)};}`
  return `
.si-drawer{flex:none;width:min(560px,48vw);min-height:0;display:flex;flex-direction:column;background:${v("bg")};color:${v("ink")};border-left:1px solid ${v("chromeLine")};font-size:12px;}
.si-drawer-head{position:relative;padding:18px 52px 12px 22px;border-bottom:1px solid ${v("chromeLine")};flex:none;}
.si-drawer-kind{margin:0 0 6px;font-size:${T.tag}px;letter-spacing:${T.tagTracking * 1.5}em;text-transform:uppercase;color:${v("inkFaint")};}
.si-drawer-x{position:absolute;right:14px;top:14px;}
.si-drawer-title{margin:0;font-family:${fonts.serif};font-weight:500;font-size:20px;line-height:1.25;color:${v("title")};overflow-wrap:anywhere;}
.si-drawer-meta{display:flex;gap:10px;align-items:center;margin:8px 0 0;}
.si-dbadge{font-size:${T.tag}px;letter-spacing:${T.tagTracking * 1.5}em;padding:2px 6px;border-radius:3px;}
.si-dbadge-added{color:${v("deltaAdded")};background:${v("deltaAddedFill")};}
.si-dbadge-modified{color:${v("deltaModified")};background:${v("deltaModifiedFill")};}
.si-dbadge-removed{color:${v("deltaRemoved")};background:${v("deltaRemovedFill")};}
.si-dbadge-unchanged{color:${v("inkMuted")};border:1px solid ${v("chromeLine")};}
.si-dstat{display:inline-flex;gap:6px;font-variant-numeric:tabular-nums;}
.si-dstat-add{color:${v("deltaAdded")};}
.si-dstat-del{color:${v("deltaRemoved")};}
.si-drawer-body{flex:1;overflow:auto;padding:14px 22px 28px;overscroll-behavior:contain;}
.si-drawer-summary{margin:0 0 14px;font-size:13px;line-height:1.55;}
.si-dfile{margin:0 0 18px;}
.si-dpath{display:flex;gap:6px;align-items:baseline;margin:0 0 6px;color:${v("ink")};overflow-wrap:anywhere;}
.si-dlines{color:${v("inkMuted")};}
.si-dstatus{margin-left:auto;font-size:${T.tag}px;letter-spacing:${T.tagTracking * 1.5}em;text-transform:uppercase;color:${v("inkFaint")};}
.si-dnote{margin:0 0 10px;color:${v("inkFaint")};}
.si-diff{border:1px solid ${v("chromeLine")};border-radius:4px;overflow-x:auto;font-size:11.5px;line-height:18px;background:${v("panel")};}
.si-drow{display:flex;min-width:max-content;white-space:pre;}
.si-dno{flex:none;width:38px;padding:0 6px;text-align:right;color:${v("inkFaint")};user-select:none;font-variant-numeric:tabular-nums;}
.si-dsign{flex:none;width:16px;text-align:center;color:${v("inkFaint")};user-select:none;}
.si-dtext{flex:1;padding-right:12px;}
.si-drow-add{background:color-mix(in srgb, ${v("deltaAdded")} 13%, transparent);}
.si-drow-add .si-dsign{color:${v("deltaAdded")};}
.si-drow-del{background:color-mix(in srgb, ${v("deltaRemoved")} 13%, transparent);}
.si-drow-del .si-dsign{color:${v("deltaRemoved")};}
.si-drow-add .si-dmark{background:color-mix(in srgb, ${v("deltaAdded")} 30%, transparent);border-radius:2px;}
.si-drow-del .si-dmark{background:color-mix(in srgb, ${v("deltaRemoved")} 30%, transparent);border-radius:2px;}
.si-drow-hunk,.si-drow-fold{color:${v("inkFaint")};background:color-mix(in srgb, ${v("ink")} 4%, transparent);padding:0 8px;}
.si-drow-fold{font-style:italic;}
${tk("kw", "codeKw")}${tk("op", "codeKw")}${tk("str", "codeStr")}${tk("num", "codeConst")}${tk("def", "codeConst")}${tk("type", "codeConst")}${tk("fn", "codeFn")}${tk("param", "codeParam")}${tk("com", "codeCom")}
@media print{.si-drawer{display:none!important}}
`.trim()
}

function baseViewerCss(): string {
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
.si-canvas{position:absolute;left:0;top:0;transform-origin:0 0;}
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
.si-figure{position:relative;transition:opacity .3s ease-out;}
.si-figure.si-settling{transition:opacity 1s ease-in-out;}
.si-captions{min-height:44px;margin:10px 0 0;font-size:13px;line-height:20px;color:${v("ink")};}
.si-caption{margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.si-word{display:inline-block;transform-origin:left center;white-space:pre;}
.si-gated{cursor:pointer;}
.si-gate{position:absolute;inset:0;margin:auto;width:48px;height:48px;border:0;padding:0;background:none;color:${v("playInk")};cursor:pointer;}
.si-gate:hover,.si-gated:hover .si-gate{color:${v("playInkHover")};}
.si-gate-play{position:absolute;inset:0;display:block;transition:transform .3s cubic-bezier(.3,1.4,.5,1);}
.si-gate:hover .si-gate-play,.si-gated:hover .si-gate-play{transform:scale(1.08);}
.si-gate-play svg{width:100%;height:100%;display:block;}
.si-gate-disc{position:absolute;left:50%;top:50%;width:240px;height:240px;margin:-120px 0 0 -120px;border-radius:50%;background:color-mix(in srgb, ${v("bg")} 35%, transparent);backdrop-filter:blur(7px);-webkit-mask:radial-gradient(closest-side,#000 35%,transparent);mask:radial-gradient(closest-side,#000 35%,transparent);pointer-events:none;}
.si-gate-ring{position:absolute;inset:0;border:2.4px solid color-mix(in srgb, ${v("pulse")} 7%, transparent);border-radius:14px;filter:blur(2.5px);animation:si-ring 7.5s linear infinite;pointer-events:none;opacity:0;}
.si-gate-ring-2{animation-delay:-3.75s;}
.si-gate-still .si-gate-play,.si-gate-still:hover .si-gate-play,.si-gated:hover .si-gate-still .si-gate-play{transition:none;transform:none;}
.si-nochrome .si-gate-still{display:none;}
.si-reduced .si-figure,.si-reduced .si-figure.si-settling{transition:none;}
.si-btn[aria-pressed="true"]{color:${v("ink")};border-color:${v("chromeLine")};}
@keyframes si-ring{0%{transform:scale(1.05);opacity:0}2%{opacity:.9}100%{transform:scale(5.5);opacity:0}}
.si-transport{position:absolute;left:16px;bottom:16px;display:flex;align-items:center;gap:2px;padding:5px 10px 5px 5px;border:1px solid ${v("chromeLine")};background:${v("chrome")};border-radius:4px;color:${v("control")};font-size:11px;}
.si-tbtn{appearance:none;border:0;background:none;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;color:inherit;cursor:pointer;border-radius:3px;transition:color .15s ease-out;}
.si-tbtn:hover,.si-tbtn:focus-visible{color:${v("controlHover")};outline:none;}
.si-ended .si-replay{color:${v("endedInk")};}
.si-scrub{position:relative;width:260px;height:28px;margin:0 10px 0 6px;cursor:pointer;touch-action:none;}
.si-scrub-track{position:absolute;left:0;right:0;top:13px;height:1px;background:${v("chromeLine")};}
.si-scrub-fill{position:absolute;left:0;top:13px;height:1px;background:${v("control")};}
.si-scrub-head{position:absolute;top:9px;width:9px;height:9px;margin-left:-4.5px;border-radius:50%;background:${v("controlHover")};}
.si-tick{position:absolute;top:10px;width:1px;height:7px;background:${v("control")};opacity:.6;}
.si-tick-stop{top:6px;height:15px;opacity:.9;}
.si-tick-label{position:absolute;bottom:17px;left:0;transform:translateX(-50%);font-size:9px;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;color:${v("inkFaint")};pointer-events:none;}
.si-time{font-variant-numeric:tabular-nums;min-width:86px;color:${v("inkMuted")};}
.si-nochrome .si-transport{display:none;}
.si-counters{position:absolute;left:0;top:0;pointer-events:none;}
.si-counter-live{position:absolute;font-family:${fonts.mono};font-size:${T.counter}px;line-height:1;color:${v("ink")};font-variant-numeric:tabular-nums lining-nums;white-space:pre;}
.si-live-counters .si-counter-value{fill-opacity:0;}
.si-beats{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:18px 20px;padding:14px 24px 24px;overflow:auto;flex:1;align-content:start;}
.si-sheet-mode{height:auto;min-height:0;overflow:visible;}
.si-beats-compact{gap:12px 14px;}
.si-beats-compact .si-beat-cap{font-size:11px;}
.si-beats-compact .si-beat-caption{font-size:12px;}
.si-sheet-mode .si-beats{overflow:visible;flex:none;}
.si-beat{margin:0;display:flex;flex-direction:column;border-top:1px solid ${v("chromeLine")};padding-top:8px;}
.si-beat-cap{display:flex;gap:8px;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:${v("inkMuted")};margin-bottom:6px;white-space:nowrap;overflow:hidden;}
.si-beat-n{color:${v("ink")};}
.si-beat-t{margin-left:auto;color:${v("inkFaint")};}
.si-beat svg{width:100%;height:auto;}
.si-beat-caption{margin:6px 0 0;min-height:16px;font-size:11px;color:${v("ink")};}
@media print{.si-transport,.si-tools,.si-gate{display:none!important}.si-figure{opacity:1!important;filter:none!important}}
.si-noscript .si-tools{display:none;}
.si-noscript .si-stage{overflow:auto;cursor:auto;}
.si-noscript .si-canvas{position:static;margin:0 auto;}
`.trim()
}
