/**
 * Page-level lint (pages): page blocks (`.sp-*`) whose text is clipped horizontally (content
 * wider than a box that hides overflow). Cheap: one pass over the page's block elements.
 */
export interface PageTextReport {
  ok: boolean
  issues: { kind: "page-text-overflow"; ids: string[]; detail: string }[]
  checked: number
}

export function lintPageText(doc: Document): PageTextReport {
  const page = doc.getElementById("storyink-page")
  const issues: PageTextReport["issues"] = []
  let checked = 0
  if (!page) return { ok: true, issues, checked }
  for (const el of page.querySelectorAll<HTMLElement>("[class*='sp-']")) {
    if (el.closest("[data-si-fig]")) continue
    checked++
    const ox = getComputedStyle(el).overflowX
    if ((ox === "hidden" || ox === "clip") && el.scrollWidth > el.clientWidth + 1) {
      const cls = [...el.classList].find((c) => c.startsWith("sp-")) ?? el.tagName.toLowerCase()
      issues.push({ kind: "page-text-overflow", ids: [el.id || cls], detail: `${cls}: content ${el.scrollWidth}px wider than ${el.clientWidth}px` })
    }
  }
  return { ok: issues.length === 0, issues, checked }
}
