/**
 * Slides and scrolly data for a validated page (pure): a title slide, one slide per section, a new
 * slide at every `break`; each slide's resolved layout, figures and build sequence.
 */
import type { Scene } from "../scene.ts"
import { autoSteps, beatTargets, resolveAt, type ResolvedStep, type Target } from "./targets.ts"
import { blockType, type Block, type BreakBlock, type FigureBlock, type ScrollyBlock, type ValidPage } from "./types.ts"

export type ResolvedLayout = "title" | "center" | "split" | "full" | "flow"

export interface SlideInfo {
  /** Section id, then `<id>-2`, `<id>-3` … for continuation slides; "title" for the title slide. */
  id: string
  title: string
  layout: ResolvedLayout
  figs: string[]
  scrolly?: string
  builds: number
  build?: { fig: string; targets: Target[] }
  /** Index of the section (-1 = title slide), blocks shown, continuation slide. */
  section: number
  blocks: Block[]
  cont: boolean
}

export interface ScrollyInfo {
  id: string
  fig: string
  steps: ResolvedStep[]
  targets: Target[]
}

/** A scrolly block's steps (auto expanded) and their targets; steps that don't resolve are dropped. */
export function scrollyInfo(sc: ScrollyBlock, scene: Scene | undefined): ScrollyInfo {
  const tl = scene?.timeline
  const raw = !tl ? [] : sc.steps === "auto" ? (autoSteps(tl) ?? []) : (sc.steps as ResolvedStep[])
  const steps: ResolvedStep[] = []
  const targets: Target[] = []
  for (const st of raw) {
    const t = tl ? resolveAt(tl, st.at) : undefined
    if (!t) continue
    steps.push(st)
    targets.push(t)
  }
  return { id: sc.id!, fig: sc.figure.id!, steps, targets }
}

const SHORT = 320

/** Layout inferred from a slide's blocks (see docs/spec.md "Slides"). */
export function inferLayout(blocks: Block[]): Exclude<ResolvedLayout, "title"> {
  const types = blocks.map(blockType)
  const figs = types.filter((t) => t === "figure").length
  const scr = types.includes("scrolly")
  if (figs === 1 && types.length === 1) return "full"
  if (figs || scr) return "split"
  const short = (b: Block) => {
    const t = blockType(b)
    if (t === "prose") return ((b as { prose: string }).prose ?? "").length <= SHORT
    if (t === "callout") return ((b as { callout: { body: string } }).callout.body ?? "").length <= SHORT
    return t === "kpis"
  }
  if (blocks.length <= 2 && blocks.every(short)) return "center"
  return "flow"
}

function figuresIn(blocks: Block[]): FigureBlock[] {
  const out: FigureBlock[] = []
  const walk = (bs: Block[]) => {
    for (const b of bs) {
      const t = blockType(b)
      if (t === "figure") out.push((b as { figure: FigureBlock }).figure)
      else if (t === "scrolly") out.push((b as { scrolly: ScrollyBlock }).scrolly.figure)
      else if (t === "details") walk((b as { details: { blocks: Block[] } }).details.blocks)
      else if (t === "columns") for (const c of (b as { columns: Block[][] }).columns) walk(c)
    }
  }
  walk(blocks)
  return out
}

/** Every slide of the page, in order (slide 0 = the title slide). */
export function pageSlides(page: ValidPage, scenes: Map<string, Scene>, scrollies: Map<string, ScrollyInfo>): SlideInfo[] {
  const out: SlideInfo[] = [{ id: "title", title: page.title, layout: "title", figs: [], builds: 0, section: -1, blocks: [], cont: false }]
  page.sections.forEach((s, si) => {
    const chunks: { blocks: Block[]; brk?: BreakBlock }[] = [{ blocks: [] }]
    for (const b of s.blocks) {
      if (blockType(b) === "break") chunks.push({ blocks: [], brk: (b as { break: BreakBlock }).break })
      else chunks[chunks.length - 1].blocks.push(b)
    }
    chunks.forEach((ch, k) => {
      const hint = k === 0 ? s.slide?.layout : typeof ch.brk === "object" ? ch.brk.layout : undefined
      const layout = hint && hint !== "auto" ? hint : inferLayout(ch.blocks)
      const title = k > 0 && typeof ch.brk === "object" && ch.brk.title ? ch.brk.title : s.title
      const figs = figuresIn(ch.blocks).map((f) => f.id!)
      const slide: SlideInfo = { id: k ? `${s.id}-${k + 1}` : s.id, title, layout, figs, builds: 0, section: si, blocks: ch.blocks, cont: k > 0 }
      // Build source: the first scrolly or story figure (builds ≠ false), in block order.
      for (const b of ch.blocks) {
        const t = blockType(b)
        if (t === "scrolly") {
          const info = scrollies.get((b as { scrolly: ScrollyBlock }).scrolly.id!)
          if (info) {
            slide.scrolly = info.id
            slide.builds = info.targets.length
            slide.build = { fig: info.fig, targets: info.targets }
            break
          }
        }
        const fs = t === "figure" ? [(b as { figure: FigureBlock }).figure] : t === "columns" ? figuresIn([b]) : []
        const f = fs.find((x) => x.builds !== false && scenes.get(x.id!)?.timeline)
        if (f) {
          const targets = beatTargets(scenes.get(f.id!)!.timeline!)
          if (targets.length) {
            slide.builds = targets.length
            slide.build = { fig: f.id!, targets }
            break
          }
        }
      }
      out.push(slide)
    })
  })
  return out
}
