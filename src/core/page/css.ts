/** Page stylesheet (`#storyink-page-css`). Tones reuse the delta palette; both themes via variables. */
import { fonts, page as P, pagePalettes, type ThemeName, type as T, v } from "../../theme/tokens.ts"

const vars = (t: ThemeName) =>
  Object.entries(pagePalettes[t])
    .map(([k, x]) => `--sp-${k}:${x};`)
    .join("")

/** `--sp-*` page palette for both themes (same selector scheme as themeCss). */
export function pageThemeCss(fixed?: ThemeName): string {
  if (fixed) return `:root{${vars(fixed)}}`
  return [
    `:root{${vars("light")}}`,
    `@media (prefers-color-scheme: dark){:root{${vars("dark")}}}`,
    `:root[data-theme="light"],:root [data-theme="light"]{${vars("light")}}`,
    `:root[data-theme="dark"],:root [data-theme="dark"]{${vars("dark")}}`,
  ].join("\n")
}

const TONE: Record<string, [string, string]> = {
  neutral: [v("inkMuted"), v("panelAlt")],
  note: ["var(--sp-note)", "var(--sp-noteFill)"],
  good: [v("deltaAdded"), v("deltaAddedFill")],
  warn: [v("deltaModified"), v("deltaModifiedFill")],
  risk: [v("deltaRemoved"), v("deltaRemovedFill")],
}

export function pageCss(): string {
  const serif = fonts.serif
  const mono = fonts.mono
  const tag = `font-family:${mono};font-size:${T.tag}px;letter-spacing:${T.tagTracking * 1.5}em;text-transform:uppercase;`
  const tones = Object.entries(TONE)
    .map(([k, [ink, fill]]) => `.sp-tone-${k}{--sp-ink:${ink};--sp-fill:${fill};}`)
    .join("\n")
  return `
html.si-page,html.si-page body{height:auto;}
html.si-page{scroll-padding-top:24px;}
.si-page body{font-family:${serif};font-size:${P.body}px;line-height:1.6;color:${v("ink")};background:${v("bg")};}
#storyink-page{--sp-ink:${v("inkMuted")};--sp-fill:${v("panelAlt")};max-width:${P.wide + 80}px;margin:0 auto;padding:0 40px 120px;display:grid;grid-template-columns:minmax(0,1fr);grid-template-areas:"head" "toc" "main";}
.sp-head{grid-area:head;position:relative;padding:64px 0 36px;border-bottom:1px solid ${v("line")};margin-bottom:12px;}
.sp-toc{grid-area:toc;}
.sp-main{grid-area:main;min-width:0;}
@media (min-width:${P.tocMin}px){
#storyink-page.sp-has-toc{max-width:${P.wide + P.tocW + 56 + 80}px;grid-template-columns:${P.tocW}px minmax(0,1fr);column-gap:56px;grid-template-areas:"toc head" "toc main";}
.sp-has-toc .sp-toc{position:sticky;top:0;align-self:start;max-height:100vh;overflow:auto;padding:68px 0 24px;}
.sp-has-toc .sp-toc ol{display:block;}
.sp-has-toc .sp-toc li{display:block;margin:0;}
.sp-has-toc .sp-toc a{display:block;padding:5px 0 5px 12px;border-left:1px solid ${v("lineSoft")};}
.sp-has-toc .sp-toc a[aria-current="true"]{border-left-color:${v("ink")};color:${v("title")};}
}
.sp-toc-h{${tag}color:${v("inkFaint")};margin:0 0 10px;}
.sp-toc ol{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:4px 18px;}
.sp-toc li{margin:0;}
#storyink-page .sp-toc a{font-family:${mono};font-size:12px;line-height:1.4;color:${v("inkMuted")};text-decoration:none;}
#storyink-page .sp-toc a:hover{color:${v("title")};}
.sp-toc-top{padding:18px 0 4px;}
.sp-eyebrow{${tag}color:${v("inkFaint")};margin:0 0 14px;}
.sp-title{font-family:${serif};font-weight:500;font-size:${P.h1}px;line-height:1.12;letter-spacing:-0.015em;margin:0;color:${v("title")};max-width:24em;text-wrap:balance;}
.sp-sub{font-style:italic;font-size:${P.lead - 1}px;line-height:1.45;color:${v("inkMuted")};margin:12px 0 0;max-width:${P.measure}ch;}
.sp-meta{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:baseline;margin:18px 0 0;font-family:${mono};font-size:12px;color:${v("inkMuted")};}
.sp-meta-ref{color:${v("ink")};}
.sp-meta-arrow{color:${v("inkFaint")};}
.sp-meta a{color:var(--sp-link);}
.sp-lead{margin:26px 0 0;font-size:${P.lead}px;line-height:1.55;max-width:${P.measure}ch;color:${v("ink")};}
.sp-lead p{margin:0 0 .7em;}
.sp-lead p:last-child{margin-bottom:0;}
.sp-theme{position:absolute;right:0;top:56px;appearance:none;border:1px solid ${v("chromeLine")};background:${v("chrome")};color:${v("inkMuted")};width:30px;height:30px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;}
.sp-theme:hover{color:${v("ink")};}
.sp-theme .sp-sun{display:none;}
:root[data-theme="dark"] .sp-theme .sp-sun{display:block;}
:root[data-theme="dark"] .sp-theme .sp-moon{display:none;}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .sp-theme .sp-sun{display:block;}:root:not([data-theme="light"]) .sp-theme .sp-moon{display:none;}}
.si-noscript:not(.sp-js) .sp-theme{display:none;}
.sp-sec{padding:44px 0 8px;}
.sp-sec+.sp-sec{border-top:1px solid ${v("lineSoft")};}
.sp-sec-head{margin:0 0 20px;}
.sp-sec-head .sp-eyebrow{margin-bottom:8px;}
.sp-sec-title{font-family:${serif};font-weight:500;font-size:${P.h2}px;line-height:1.2;margin:0;color:${v("title")};letter-spacing:-0.01em;}
.sp-b{margin:0 0 26px;max-width:${P.measure}ch;}
.sp-b.sp-wide{max-width:none;}
.sp-prose p{margin:0 0 .85em;}
.sp-prose>:last-child{margin-bottom:0;}
.sp-prose h3{font-family:${serif};font-weight:600;font-size:${P.h3}px;line-height:1.3;margin:1.4em 0 .4em;color:${v("title")};}
.sp-prose h4{${tag}color:${v("inkMuted")};margin:1.6em 0 .5em;}
.sp-prose ul,.sp-prose ol{margin:0 0 .85em;padding-left:1.3em;}
.sp-prose li{margin:.2em 0;}
.sp-prose li::marker{color:${v("inkFaint")};}
.sp-prose blockquote{margin:0 0 .85em;padding:2px 0 2px 18px;border-left:2px solid ${v("line")};color:${v("inkMuted")};font-style:italic;}
#storyink-page code{font-family:${mono};font-size:.8em;padding:.08em .32em;border-radius:3px;background:${v("panelAlt")};border:1px solid ${v("lineSoft")};color:${v("ink")};}
#storyink-page a{color:var(--sp-link);text-decoration-thickness:1px;text-underline-offset:2px;}
#storyink-page strong{font-weight:650;color:${v("title")};}
.sp-ref{white-space:nowrap;}
#storyink-page code.sp-ref{background:none;border:0;padding:0;font-size:12px;color:${v("inkMuted")};}
.sp-ref-l{color:${v("inkFaint")};}
.sp-mono{font-family:${mono};}
.sp-chip{${tag}display:inline-block;white-space:nowrap;padding:2px 7px;border-radius:3px;color:var(--sp-ink);background:var(--sp-fill);line-height:1.5;}
${tones}
.sp-fig{margin:0 0 30px;max-width:none;}
.sp-fig-root{position:relative;border:1px solid ${v("lineSoft")};background:${v("bg")};border-radius:2px;overflow:hidden;}
.sp-fig-root>svg.storyink{display:block;max-width:100%;height:auto;margin:0 auto;}
.sp-fig-wide{--sp-bw:max(100%,min(1480px,calc(100vw - 48px)));width:var(--sp-bw);margin-left:calc((100% - var(--sp-bw)) / 2);}
@media (min-width:${P.tocMin}px){.sp-has-toc .sp-fig-wide{width:max(100%,min(1480px,calc(100% + max(0px,(100vw - ${P.wide + P.tocW + 56 + 80}px) / 2) + 16px)));margin-left:0;}}
@media (max-width:820px){.sp-fig-wide{width:auto;margin-left:0;}}
.sp-cap{margin:12px 0 0;max-width:${P.measure}ch;font-size:15px;line-height:1.5;color:${v("inkMuted")};}
.sp-cap::before{content:"";display:inline-block;width:18px;height:1px;background:${v("inkFaint")};vertical-align:middle;margin-right:10px;}
.sp-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;background:${v("lineSoft")};border:1px solid ${v("lineSoft")};}
.sp-kpi{background:var(--sp-raised);padding:16px 18px 15px;position:relative;}
.sp-kpi::before{content:"";position:absolute;left:0;right:0;top:0;height:2px;background:var(--sp-ink);opacity:.85;}
.sp-kpi.sp-tone-neutral::before,.sp-kpi:not([class*="sp-tone"])::before{display:none;}
.sp-kpi-label{${tag}color:${v("inkFaint")};margin:0;}
.sp-kpi-value{font-family:${serif};font-size:32px;line-height:1.1;margin:8px 0 0;color:${v("title")};font-variant-numeric:lining-nums tabular-nums;}
.sp-kpi.sp-tone-good .sp-kpi-value,.sp-kpi.sp-tone-warn .sp-kpi-value,.sp-kpi.sp-tone-risk .sp-kpi-value,.sp-kpi.sp-tone-note .sp-kpi-value{color:var(--sp-ink);}
.sp-kpi-detail{font-family:${mono};font-size:11.5px;line-height:1.45;color:${v("inkMuted")};margin:6px 0 0;}
.sp-table-wrap{overflow-x:auto;border-top:1px solid ${v("line")};border-bottom:1px solid ${v("line")};}
.sp-table{width:100%;border-collapse:collapse;font-family:${mono};font-size:12.5px;line-height:1.5;}
.sp-table th{${tag}font-weight:400;color:${v("inkFaint")};text-align:left;padding:10px 14px 8px;border-bottom:1px solid ${v("line")};white-space:nowrap;}
.sp-table td{padding:9px 14px;border-top:1px solid ${v("lineSoft")};vertical-align:top;color:${v("ink")};}
.sp-table tr:first-child td{border-top:0;}
.sp-table .sp-r{text-align:right;font-variant-numeric:tabular-nums;}
.sp-table .sp-c{text-align:center;}
.sp-table td.sp-t{color:var(--sp-ink);}
.sp-table td>code{font-size:11.5px;}
.sp-tcap{font-size:14px;line-height:1.5;color:${v("inkMuted")};margin:10px 0 0;}
.sp-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px;}
.sp-card{background:var(--sp-raised);border:1px solid ${v("lineSoft")};padding:16px 18px 16px;position:relative;}
.sp-card[class*="sp-tone-"]{border-top:2px solid var(--sp-ink);}
.sp-card.sp-tone-neutral{border-top:1px solid ${v("lineSoft")};}
.sp-card-top{display:flex;gap:8px;align-items:center;justify-content:space-between;margin:0 0 8px;min-height:18px;}
.sp-card-tag{${tag}color:${v("inkFaint")};}
.sp-card-title{font-family:${serif};font-weight:600;font-size:17px;line-height:1.3;margin:0 0 6px;color:${v("title")};}
.sp-card .sp-prose{font-size:15px;line-height:1.5;color:${v("ink")};}
.sp-callout{border-left:3px solid var(--sp-ink);background:color-mix(in srgb, var(--sp-fill) 70%, transparent);padding:16px 22px 16px 20px;}
.sp-callout-title{${tag}color:var(--sp-ink);margin:0 0 6px;}
.sp-callout .sp-prose{font-size:${P.body}px;}
.sp-fm{font-family:${mono};font-size:12.5px;line-height:1.5;border-top:1px solid ${v("line")};border-bottom:1px solid ${v("line")};}
.sp-fm-head{display:flex;gap:14px;align-items:baseline;padding:10px 4px 9px;border-bottom:1px solid ${v("lineSoft")};color:${v("inkMuted")};}
.sp-fm-head b{font-weight:400;color:${v("ink")};}
.sp-fm-legend{margin-left:auto;display:flex;gap:12px;}
.sp-fm-sub{${tag}color:${v("inkFaint")};margin:0;padding:12px 4px 2px;}
.sp-fm-top{border-bottom:1px solid ${v("lineSoft")};}
.sp-fm details>summary{cursor:pointer;padding:8px 4px;color:${v("inkMuted")};list-style:none;}
.sp-fm details>summary::-webkit-details-marker{display:none;}
.sp-fm details>summary::before{content:"\\25B8";display:inline-block;width:14px;color:${v("inkFaint")};}
.sp-fm details[open]>summary::before{content:"\\25BE";}
.sp-tree{list-style:none;margin:0;padding:4px 0 8px;}
.sp-tree .sp-tree{padding:0 0 0 18px;border-left:1px solid ${v("lineSoft")};margin-left:6px;}
.sp-fm-row{display:grid;grid-template-columns:18px minmax(0,1fr) auto 96px;gap:10px;align-items:baseline;padding:3px 4px;}
.sp-fm-row:hover{background:color-mix(in srgb, ${v("ink")} 4%, transparent);}
.sp-fm-dir>.sp-fm-row{color:${v("inkMuted")};grid-template-columns:minmax(0,1fr) auto 96px;}
.sp-fm-dir>.sp-fm-row .sp-fm-name{color:${v("inkMuted")};}
.sp-fm-st{color:var(--sp-ink);font-weight:700;text-align:center;}
.sp-fm-name{color:${v("ink")};overflow-wrap:anywhere;}
.sp-fm-note{display:block;font-family:${serif};font-size:14px;line-height:1.4;color:${v("inkMuted")};margin:1px 0 3px;}
.sp-fm-n{white-space:nowrap;font-variant-numeric:tabular-nums;text-align:right;}
.sp-add{color:${v("deltaAdded")};}
.sp-del{color:${v("deltaRemoved")};}
.sp-bar{display:flex;height:6px;align-self:center;background:color-mix(in srgb, ${v("ink")} 6%, transparent);}
.sp-bar i{display:block;height:100%;}
.sp-bar .sp-bar-a{background:${v("deltaAdded")};}
.sp-bar .sp-bar-d{background:${v("deltaRemoved")};}
.sp-diffb-head,.sp-code-head{display:flex;gap:10px;align-items:baseline;font-family:${mono};font-size:12px;margin:0 0 6px;color:${v("ink")};}
.sp-diffb-head .sp-fm-n{margin-left:auto;}
.sp-diffb .si-diff{background:var(--sp-sunken);font-size:12px;line-height:19px;}
.sp-note{font-family:${mono};font-size:12px;color:${v("inkFaint")};margin:0;}
.sp-code-body{margin:0;border:1px solid ${v("chromeLine")};border-radius:4px;background:var(--sp-sunken);overflow-x:auto;font-family:${mono};font-size:12px;line-height:19px;padding:8px 0;}
.sp-code-line{display:flex;min-width:max-content;white-space:pre;}
.sp-ln{flex:none;width:44px;padding:0 12px 0 0;text-align:right;color:${v("inkFaint")};user-select:none;font-variant-numeric:tabular-nums;}
.sp-code-text{padding-right:16px;}
.sp-items{list-style:none;margin:0;padding:0;border-top:1px solid ${v("line")};}
.sp-item{display:grid;grid-template-columns:104px minmax(0,1fr);gap:4px 18px;padding:14px 0 14px;border-bottom:1px solid ${v("lineSoft")};}
.sp-item-k{padding-top:3px;}
.sp-item-main{min-width:0;}
.sp-item-title{margin:0;font-size:${P.body}px;line-height:1.45;color:${v("title")};}
.sp-item-sub{margin:4px 0 0;font-size:15px;line-height:1.5;color:${v("inkMuted")};}
.sp-item-sub b{font-family:${mono};font-weight:400;font-size:${T.tag}px;letter-spacing:${T.tagTracking * 1.5}em;text-transform:uppercase;color:${v("inkFaint")};margin-right:8px;}
.sp-item-refs{display:flex;flex-wrap:wrap;gap:2px 14px;margin:6px 0 0;}
.sp-item-area{${tag}color:${v("inkFaint")};margin:6px 0 0;}
.sp-sev-critical .sp-chip{color:${v("bg")};background:${v("deltaRemoved")};}
.sp-ev{width:100%;border-collapse:collapse;}
.sp-ev td{padding:11px 14px 11px 0;border-bottom:1px solid ${v("lineSoft")};vertical-align:top;font-size:15px;line-height:1.5;}
.sp-ev tr:first-child td{border-top:1px solid ${v("line")};}
.sp-ev td.sp-ev-src{width:34%;}
.sp-ev td.sp-ev-st{width:1%;white-space:nowrap;text-align:right;padding-right:0;}
.sp-tl{list-style:none;margin:0;padding:0 0 0 2px;}
.sp-tl-i{position:relative;display:grid;grid-template-columns:132px minmax(0,1fr);gap:18px;padding:0 0 20px;}
.sp-tl-i::before{content:"";position:absolute;left:144px;top:12px;bottom:-6px;width:1px;background:${v("lineSoft")};}
.sp-tl-i:last-child::before{display:none;}
.sp-tl-when{font-family:${mono};font-size:12px;line-height:1.5;color:${v("inkMuted")};text-align:right;padding-top:3px;padding-right:10px;}
.sp-tl-body{position:relative;padding-left:18px;}
.sp-tl-body::before{content:"";position:absolute;left:-10px;top:8px;width:9px;height:9px;border-radius:50%;background:${v("bg")};border:1.5px solid var(--sp-ink);}
.sp-tl-i[class*="sp-tone-"] .sp-tl-body::before{background:var(--sp-ink);}
.sp-tl-i.sp-tone-neutral .sp-tl-body::before{background:${v("bg")};}
.sp-tl-title{margin:0;font-weight:600;color:${v("title")};line-height:1.4;}
.sp-tl-body .sp-prose{font-size:15px;line-height:1.5;color:${v("inkMuted")};margin-top:3px;}
.sp-check{list-style:none;margin:0;padding:0;}
.sp-check li{display:grid;grid-template-columns:22px minmax(0,1fr);gap:10px;padding:7px 0;border-bottom:1px solid ${v("lineSoft")};}
.sp-check li:first-child{border-top:1px solid ${v("line")};}
.sp-box{width:15px;height:15px;margin-top:5px;border:1.5px solid ${v("inkFaint")};border-radius:2px;display:inline-flex;align-items:center;justify-content:center;font-family:${mono};font-size:11px;line-height:1;color:${v("bg")};}
.sp-done .sp-box{background:${v("deltaAdded")};border-color:${v("deltaAdded")};}
.sp-done .sp-check-t{color:${v("inkMuted")};}
.sp-check-note{display:block;font-size:14px;color:${v("inkMuted")};line-height:1.45;margin-top:2px;}
.sp-details{border-top:1px solid ${v("line")};border-bottom:1px solid ${v("line")};}
.sp-details>summary{cursor:pointer;padding:12px 0;font-family:${mono};font-size:13px;color:${v("ink")};list-style:none;}
.sp-details>summary::-webkit-details-marker{display:none;}
.sp-details>summary::before{content:"+";display:inline-block;width:20px;color:${v("inkFaint")};}
.sp-details[open]>summary::before{content:"\\2212";}
.sp-details-body{padding:6px 0 4px;}
.sp-cols{display:grid;grid-template-columns:repeat(var(--sp-cols,2),minmax(0,1fr));gap:28px;align-items:start;}
.sp-cols>.sp-col>.sp-b{max-width:none;}
.sp-cols>.sp-col>.sp-b:last-child{margin-bottom:0;}
@media (max-width:820px){
#storyink-page{padding:0 20px 80px;}
.sp-head{padding:40px 0 28px;}
.sp-theme{top:34px;}
.sp-title{font-size:30px;padding-right:40px;}
.sp-lead{font-size:18px;}
.sp-cols{grid-template-columns:minmax(0,1fr);}
.sp-item{grid-template-columns:minmax(0,1fr);}
.sp-tl-i{grid-template-columns:minmax(0,1fr);gap:2px;padding-left:18px;}
.sp-tl-i::before{left:4px;}
.sp-tl-when{text-align:left;padding:0;}
.sp-tl-body{padding-left:0;}
.sp-tl-body::before{left:-18px;top:-17px;}
.sp-fm-row{grid-template-columns:18px minmax(0,1fr) auto;}
.sp-fm-row .sp-bar{display:none;}
.sp-ev td.sp-ev-src{width:auto;}
.sp-table td,.sp-table th{min-width:9ch;}
}
@media print{
.sp-theme,.sp-toc{display:none!important;}
#storyink-page{display:block;max-width:none;padding:0;}
.si-page body{background:#fff;}
.sp-fig,.sp-kpis,.sp-callout,.sp-card,.sp-item,.sp-tl-i,tr{break-inside:avoid;}
.sp-sec-head{break-after:avoid;}
.sp-details-body,.sp-fm details>*{display:block!important;}
}
`.trim()
}
