/**
 * Page CSS for scrollytelling (`.sp-scrolly`, static and live) and present-mode slide CONTENT
 * layouts (`html.sp-presenting .sp-slide.is-current[data-slide-layout=…]`). The deck chrome
 * (progress, counter, buttons, outline) is the viewer's (viewerCss).
 */
import { fonts, page as P, type as T, v } from "../../theme/tokens.ts"

/** Slide content box: the viewer owns the 1280×720 frame (position, size, centring, `--sp-slide-scale`); this only lays content out inside it. */
export const SLIDE = { w: 1280, h: 720, padX: 76, padY: 56 }

export function scrollyCss(): string {
  const tag = `font-family:${fonts.mono};font-size:${T.tag}px;letter-spacing:${T.tagTracking * 1.5}em;text-transform:uppercase;`
  return `
.sp-slide{display:contents;}
.sp-present{position:absolute;right:40px;top:56px;appearance:none;border:1px solid ${v("chromeLine")};background:${v("chrome")};color:${v("inkMuted")};height:30px;padding:0 10px;border-radius:4px;display:inline-flex;gap:7px;align-items:center;cursor:pointer;${tag}}
.sp-present:hover{color:${v("ink")};}
.si-noscript .sp-present{display:none;}
.sp-scrolly{--sp-bw:max(100%,min(1240px,calc(100vw - 48px)));width:var(--sp-bw);margin-left:calc((100% - var(--sp-bw)) / 2);max-width:none;display:grid;grid-template-columns:minmax(0,2fr) minmax(0,3fr);grid-template-areas:"steps graphic";gap:0 48px;align-items:start;}
.sp-scrolly-left{grid-template-columns:minmax(0,3fr) minmax(0,2fr);grid-template-areas:"graphic steps";}
@media (min-width:${P.tocMin}px){.sp-has-toc .sp-scrolly{width:100%;margin-left:0;}}
.sp-scrolly-graphic{grid-area:graphic;min-width:0;}
.sp-scrolly-graphic>.sp-fig{width:auto;margin:0;}
.sp-scrolly-steps{grid-area:steps;list-style:none;margin:0;padding:0;counter-reset:sp-step;min-width:0;}
.sp-scrolly-step{position:relative;margin:0 0 16px;padding:14px 18px 14px 20px;border:1px solid ${v("lineSoft")};border-left:2px solid ${v("line")};background:var(--sp-raised);font-size:16px;line-height:1.55;counter-increment:sp-step;transition:opacity .35s ease-out,border-color .35s ease-out;}
.sp-scrolly-step::before{content:counter(sp-step,decimal-leading-zero);display:block;${tag}color:${v("inkFaint")};margin:0 0 6px;}
.sp-scrolly-step h4{font-family:${fonts.serif};font-weight:600;font-size:18px;line-height:1.3;margin:0 0 6px;color:${v("title")};}
.sp-scrolly-step .sp-prose p{margin:0 0 .6em;}
.sp-cite{border-bottom:1px dashed ${v("inkFaint")};cursor:default;outline:none;}
.sp-cite:hover,.sp-cite:focus-visible{background:color-mix(in srgb, ${v("ink")} 8%, transparent);border-bottom-color:${v("ink")};}
.sp-scrolly-live .sp-scrolly-graphic{position:sticky;top:max(16px,calc(50vh - min(39vh,360px)));align-self:start;}
.sp-scrolly-live .sp-scrolly-graphic .si-embedded{--si-fig-max:min(78vh,720px);}
.sp-scrolly-live .sp-scrolly-steps{padding:46vh 0 34vh;}
.sp-scrolly-live .sp-scrolly-step{margin:0 0 62vh;opacity:.34;}
.sp-scrolly-live .sp-scrolly-step:last-child{margin-bottom:0;}
.sp-scrolly-live .sp-scrolly-step.is-active{opacity:1;border-left-color:${v("deltaModified")};}
.sp-scrolly-live .sp-cap{display:none;}
@media (max-width:820px){
.sp-scrolly,.sp-scrolly-left{width:auto;margin-left:0;grid-template-columns:minmax(0,1fr);grid-template-areas:"graphic" "steps";gap:16px;}
.sp-scrolly-live .sp-scrolly-graphic{top:0;z-index:0;background:${v("bg")};padding-top:8px;}
.sp-scrolly-live .sp-scrolly-graphic .si-embedded{--si-fig-max:46vh;}
.sp-scrolly-live .sp-scrolly-steps{position:relative;z-index:1;padding:20vh 0 30vh;}
.sp-scrolly-live .sp-scrolly-step{margin-bottom:56vh;opacity:.6;box-shadow:0 1px 0 ${v("lineSoft")};}
}
@media print{.sp-scrolly,.sp-scrolly-left{width:auto;margin-left:0;grid-template-columns:minmax(0,1fr);grid-template-areas:"graphic" "steps";}.sp-scrolly-graphic{position:static!important;}.sp-scrolly-steps{padding:12px 0 0!important;}.sp-scrolly-step{margin:0 0 10px!important;opacity:1!important;break-inside:avoid;}.sp-present{display:none!important;}}
`.trim()
}

/** Present-mode content layouts (the viewer adds `html.sp-presenting` and `.is-current`). */
export function slidesCss(): string {
  const S = SLIDE
  const cur = "html.sp-presenting .sp-slide.is-current"
  const L = (l: string) => `${cur}[data-slide-layout="${l}"]`
  const tag = `font-family:${fonts.mono};font-size:12px;letter-spacing:${T.tagTracking * 1.5}em;text-transform:uppercase;`
  return `
html.sp-presenting,html.sp-presenting body{overflow:hidden;height:100%;}
html.sp-presenting #storyink-page{display:block;max-width:none;margin:0;padding:0;}
html.sp-presenting #storyink-page>:not(.sp-slide):not(.sp-main){display:none!important;}
html.sp-presenting .sp-main,html.sp-presenting .sp-sec{display:contents;}
html.sp-presenting .sp-slide:not(.is-current){display:none!important;}
${cur}{padding:${S.padY}px ${S.padX}px;display:flex;flex-direction:column;gap:22px;font-size:22px;line-height:1.5;}
${cur}>*{zoom:var(--sp-content-scale,1);}
${cur} .sp-b{max-width:none;margin:0;}
${cur} .sp-sec-head{margin:0;flex:none;}
${cur} .sp-sec-head .sp-eyebrow{${tag}margin:0 0 10px;}
${cur} .sp-sec-title{font-size:44px;line-height:1.12;letter-spacing:-0.015em;}
${cur} .sp-cont{flex:none;}
${cur} .sp-prose{font-size:24px;line-height:1.5;}
${cur} .sp-prose p{margin:0 0 .6em;}
${cur} .sp-fig-wide,${cur} .sp-scrolly{width:auto;margin-left:0;}
${cur} .sp-fig{display:flex;flex-direction:column;min-height:0;}
${cur} .sp-fig-root{flex:1 1 auto;min-height:0;}
${cur} .sp-fig-root .si-embedded{height:100%;--si-fig-max:100%;}
${cur} .sp-fig-root .si-embedded>.si-main,${cur} .sp-fig-root .si-embedded>.si-stage,${cur} .sp-fig-root .si-embedded .si-main>.si-stage{flex:1 1 auto;min-height:0;}
${cur} .sp-fig-root .si-embedded .si-stage{aspect-ratio:auto!important;height:auto;}
${cur} .sp-cap{font-size:18px;margin-top:10px;max-width:none;flex:none;}
${cur} .sp-kpi-value{font-size:44px;white-space:nowrap;}
${cur} .sp-kpi-label{font-size:12px;}
${cur} .sp-kpi-detail{font-size:15px;}
${cur} .sp-kpi{padding:22px 24px;}
${cur} .sp-table{font-size:16px;}
${cur} .sp-item-title{font-size:21px;}
${cur} .sp-item-sub{font-size:17px;}
${cur} .sp-callout{padding:22px 28px;}
${cur} .sp-callout-title{font-size:13px;}
${cur} .si-diff{font-size:14px;line-height:21px;}
${cur} .sp-check li{font-size:21px;}
${cur} .sp-tl-title{font-size:21px;}
${L("title")}{justify-content:center;padding:${S.padY + 20}px ${S.padX + 24}px;}
${L("title")} .sp-head{position:static;padding:0;margin:0;border:0;}
${L("title")} .sp-theme,${L("title")} .sp-present{display:none;}
${L("title")} .sp-eyebrow{${tag}margin-bottom:22px;}
${L("title")} .sp-title{font-size:68px;line-height:1.06;max-width:16em;}
${L("title")} .sp-sub{font-size:28px;margin-top:20px;max-width:40em;}
${L("title")} .sp-meta{font-size:15px;margin-top:26px;}
${L("title")} .sp-lead{font-size:24px;margin-top:34px;max-width:46em;}
${L("center")}{justify-content:center;align-items:center;text-align:center;padding:${S.padY + 24}px ${S.padX + 80}px;}
${L("center")} .sp-sec-title{font-size:56px;}
${L("center")} .sp-prose{font-size:30px;line-height:1.45;}
${L("center")} .sp-b{width:100%;}
${L("center")} .sp-callout{text-align:left;}
${L("center")} .sp-kpis{text-align:left;}
${L("split")}{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,3fr);grid-auto-rows:min-content;grid-auto-flow:row dense;align-content:start;column-gap:44px;row-gap:20px;}
${L("split")}>.sp-sec-head,${L("split")}>.sp-cont{grid-column:1 / -1;}
${L("split")}>.sp-b{grid-column:1;}
${L("split")}>.sp-fig{grid-column:2;grid-row:2 / span 8;height:${S.h - 2 * S.padY - 90}px;}
${L("split")} .sp-prose{font-size:21px;}
${L("split")}[data-fig-shape="tall"]{grid-template-columns:minmax(0,1fr) minmax(0,2fr);}
${L("split")}[data-fig-shape="tall"]>.sp-sec-head,${L("split")}[data-fig-shape="tall"]>.sp-cont{grid-column:1;}
${L("split")}[data-fig-shape="tall"]>.sp-fig{grid-row:1 / span 9;height:${S.h - 2 * S.padY}px;}
${L("split")}>.sp-scrolly{grid-column:1 / -1;grid-row:2;height:${S.h - 2 * S.padY - 90}px;grid-template-rows:minmax(0,1fr);}
${cur} .sp-scrolly-graphic{height:100%;position:static;}
${cur} .sp-scrolly-graphic>.sp-fig{height:100%;}
${cur} .sp-scrolly-steps{padding:0;align-self:center;}
${cur} .sp-scrolly-step{margin:0;opacity:1;font-size:21px;display:none;border-left-color:${v("deltaModified")};}
${cur} .sp-scrolly-step.is-active,${cur} .sp-scrolly:not(:has(.is-active)) .sp-scrolly-step:first-child{display:block;}
${cur} .sp-scrolly-step h4{font-size:26px;}
${cur} .sp-scrolly-step::before{display:none;}
${L("full")}{gap:14px;}
${L("full")} .sp-sec-title{font-size:32px;}
${L("full")}>.sp-fig{flex:1 1 auto;}
${L("full")}[data-fig-shape="tall"]{display:grid;grid-template-columns:minmax(0,320px) minmax(0,1fr);grid-template-rows:auto minmax(0,1fr);column-gap:44px;row-gap:18px;}
${L("full")}[data-fig-shape="tall"]>.sp-sec-head,${L("full")}[data-fig-shape="tall"]>.sp-cont{grid-column:1;grid-row:1;align-self:end;}
${L("full")}[data-fig-shape="tall"]>.sp-fig{display:contents;}
${L("full")}[data-fig-shape="tall"]>.sp-fig>.sp-fig-root{grid-column:2;grid-row:1 / span 2;min-height:0;}
${L("full")}[data-fig-shape="tall"]>.sp-fig>.sp-cap{grid-column:1;grid-row:2;align-self:start;margin:0;}
${L("flow")}{font-size:19px;gap:18px;}
${L("flow")} .sp-sec-title{font-size:38px;}
${L("flow")} .sp-prose{font-size:20px;}
${L("flow")}>.sp-fig{flex:1 1 auto;}
${L("flow")} .si-diff,${L("flow")} .sp-code-body{font-size:12.5px;line-height:18px;}
${L("flow")} .sp-diffb-head{margin-bottom:4px;}
${cur} .sp-b-columns:has(.sp-fig){flex:1 1 auto;min-height:0;}
${cur} .sp-b-columns:has(.sp-fig)>.sp-cols{height:100%;align-items:stretch;}
${cur} .sp-col{display:flex;flex-direction:column;min-height:0;gap:16px;}
${cur} .sp-col>.sp-fig{flex:1 1 auto;}
`.trim()
}
