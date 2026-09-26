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
