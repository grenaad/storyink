/**
 * HUD metrics (`story.hud`): big mono "label: value" numbers pinned to the stage (HTML viewer
 * overlay, not affected by pan / zoom), and a compact line under beat / act sheet tiles. Values
 * come from `frame.counters`, visibility from `el` / `vis`, colour from the item's tone and its
 * tone layers (`frame.tone`, crossfading).
 */
import type { ReactElement } from "react"
import type { Tone } from "../../theme/tones.ts"
import type { Frame, Timeline, TimelineHud } from "../story/types.ts"

const fmt = (h: TimelineHud) => `${h.prefix ?? ""}${h.value}${h.suffix ?? ""}`

/** Colour layers of a HUD value: the item's own tone under its story tone layers. */
function layers(h: TimelineHud, fr: Frame | undefined): { tone?: Tone; o: number }[] {
  const tl = fr?.tone?.[h.id] ?? {}
  const ups = Object.entries(tl).filter(([, o]) => (o ?? 0) > 0.001) as [Tone, number][]
  const sum = ups.reduce((a, [, o]) => a + o, 0)
  const out: { tone?: Tone; o: number }[] = []
  if (sum < 0.999) out.push({ ...(h.tone ? { tone: h.tone } : {}), o: 1 - sum })
  for (const [tone, o] of ups) out.push({ tone, o })
  return out
}

function Value({ h, fr }: { h: TimelineHud; fr?: Frame }) {
  const text = fr?.counters[h.id] ?? fmt(h)
  return (
    <span className="si-hud-value">
      {layers(h, fr).map((l, k) => (
        <span key={k} className={`si-hud-layer${l.tone ? ` si-t-${l.tone}` : ""}`} style={l.o < 0.999 ? { opacity: +l.o.toFixed(3) } : undefined}>
          {text}
        </span>
      ))}
    </span>
  )
}

const shown = (h: TimelineHud, fr?: Frame) => (fr?.el[h.id]?.o ?? 1) * (fr?.vis?.[h.id] ?? 1)

/** Stage overlay: top-right items (below the act chip when there is one) and bottom-left items. */
export function Hud({ tl, frame, below }: { tl: Timeline; frame?: Frame; below: boolean }): ReactElement | null {
  const items = tl.hud ?? []
  if (!items.length) return null
  const at = (where: TimelineHud["at"]) => items.filter((h) => h.at === where)
  return (
    <>
      {(["top-right", "bottom-left"] as const).map((where) =>
        at(where).length ? (
          <div key={where} className={`si-hud si-hud-${where}${where === "top-right" && below ? " si-hud-below" : ""}`} aria-live="polite">
            {at(where).map((h) => {
              const o = shown(h, frame)
              return (
                <div key={h.id} className="si-hud-item" data-hud={h.id} style={o < 0.999 ? { opacity: +Math.max(0, o).toFixed(3) } : undefined} {...(o < 0.5 ? { "aria-hidden": true } : {})}>
                  <span className="si-hud-label">{h.label}:</span>
                  <Value h={h} fr={frame} />
                </div>
              )
            })}
          </div>
        ) : null,
      )}
    </>
  )
}

/** Compact "label: value · …" line for sheet tiles (beat sheets, act sheets). */
export function HudLine({ tl, frame }: { tl: Timeline; frame: Frame }): ReactElement | null {
  const items = (tl.hud ?? []).filter((h) => shown(h, frame) > 0.5)
  if (!items.length) return null
  return (
    <span className="si-hud-line">
      {items.map((h) => (
        <span key={h.id} className="si-hud-line-item">
          {h.label}: <Value h={h} fr={frame} />
        </span>
      ))}
    </span>
  )
}

/** Viewer rules for the HUD (only emitted for stories that have one). */
export function hudCss(v: (k: string) => string, mono: string, toneKeys: [Tone, string][]): string {
  const tones = toneKeys.map(([t, k]) => `.si-hud-layer.si-t-${t}{color:${v(k)};}`).join("\n")
  return `.si-hud{position:absolute;display:flex;flex-direction:column;gap:2px;pointer-events:none;z-index:2;font-family:${mono};transform:translateZ(0);}
.si-hud-top-right{top:12px;right:18px;align-items:flex-end;}
.si-hud-top-right.si-hud-below{top:48px;}
.si-hud-bottom-left{left:18px;bottom:64px;align-items:flex-start;}
.si-hud-item{display:flex;align-items:baseline;gap:8px;white-space:nowrap;}
.si-hud-label{font-size:13px;color:${v("inkMuted")};}
.si-hud-value{display:inline-grid;font-size:24px;font-weight:700;color:${v("ink")};font-variant-numeric:tabular-nums;}
.si-hud-layer{grid-area:1/1;text-align:right;}
.si-hud-line{display:inline-flex;gap:12px;margin-left:10px;font-family:${mono};font-size:11px;color:${v("inkMuted")};}
.si-hud-line .si-hud-value{font-size:12px;}
${tones}`
}
