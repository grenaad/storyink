import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { renderToStaticMarkup } from "react-dom/server"
import { createElement } from "react"
import { isPageSpec, renderPageHtml, resolvePageChanges, validatePage, renderHtml, validate } from "../src/core/index.ts"
import { Prose, safeHref } from "../src/core/page/prose.tsx"
import { loadPage } from "../src/node/page.ts"
import { diffSetFrom } from "../src/node/git.ts"

const ex = path.join(import.meta.dir, "..", "examples")
const arch = { type: "architecture", title: "A", nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ from: "a", to: "b" }] }
const page = (blocks: unknown[], extra: object = {}) => ({ type: "page", title: "T", sections: [{ title: "S", blocks }], ...extra })
/** The document without the viewer bundle (it is the same script as single pages). */
const own = (h: string) => h.slice(0, h.indexOf(`<script id="storyink-viewer">`))
const errs = (v: { diagnostics: { severity: string; path: string; message: string; hint?: string }[] }) => v.diagnostics.filter((d) => d.severity === "error")

const HUNK = "@@ -1,3 +1,3 @@ fn\n const a = 1\n-const b = 2\n+const b = 3\n const c = 4"

const ALL_BLOCKS = [
  { prose: "Para with **bold**, *em*, `code` and [a link](https://x.dev).\n\n- one\n- two\n\n1. first\n2. second\n\n### Heading\n\n> quote" },
  { figure: { spec: arch, claim: "A talks to **B**." } },
  { kpis: [{ label: "Files", value: 3, detail: "d", tone: "good" }] },
  { table: { columns: ["A", { label: "B", align: "right" }], rows: [["x", 1], [{ text: "y", tone: "risk", badge: true }, { text: "z", code: true }]], caption: "cap" } },
  { cards: [{ title: "C", body: "b", tag: "t", delta: "added" }] },
  { callout: { tone: "warn", title: "W", body: "careful" } },
  { filemap: { files: [{ path: "src/a.ts", status: "modified", add: 3, del: 1, note: "n" }, { path: "src/b/c.ts", status: "added", add: 5 }] } },
  { diff: { text: HUNK, file: "src/a.ts" } },
  { code: { code: ["const x = 1", "return x"], lang: "ts", file: "a.ts", start: 10 } },
  { risks: [{ risk: "r", severity: "high", area: "db", mitigation: "m", refs: ["src/a.ts#L12-20"] }] },
  { decisions: [{ decision: "d", why: "w", confidence: "sourced", refs: ["src/a.ts:3"] }] },
  { evidence: [{ claim: "c", source: "src/a.ts#L1", status: "verified" }] },
  { timeline: [{ when: "W1", title: "t", body: "b", tone: "note" }] },
  { checklist: [{ text: "x", done: true, note: "n" }, { text: "y" }] },
  { details: { summary: "More", blocks: [{ prose: "hidden" }] } },
  { columns: [[{ prose: "left" }], [{ prose: "right" }]] },
]

describe("page validation", () => {
  test("isPageSpec", () => {
    expect(isPageSpec(page([]))).toBe(true)
    expect(isPageSpec(arch)).toBe(false)
  })

  test("every block type validates and ids are filled", () => {
    const v = validatePage(page(ALL_BLOCKS))
    expect(errs(v)).toEqual([])
    expect(v.page?.sections[0].id).toBe("s")
    const fig = v.page!.sections[0].blocks[1] as { figure: { id: string } }
    expect(fig.figure.id).toBe("fig-1")
  })

  test("figure diagnostics are prefixed with the figure path", () => {
    const bad = { ...arch, nodes: [{ id: "a", kind: "nope" }] }
    const v = validatePage({ type: "page", title: "T", sections: [{ title: "x", blocks: [{ prose: "a" }] }, { title: "y", blocks: [{ prose: "b" }, { figure: { spec: bad } }] }] })
    expect(v.ok).toBe(false)
    expect(errs(v).some((d) => d.path === "sections[1].blocks[1].figure.spec.nodes[0].kind")).toBe(true)
  })

  test("unknown block keys and multiple type keys are errors", () => {
    expect(errs(validatePage(page([{ prose: "a", extra: 1 }]))).map((d) => d.path)).toContain("sections[0].blocks[0].extra")
    expect(errs(validatePage(page([{ prose: "a", callout: { tone: "note", body: "b" } }]))).length).toBe(1)
    expect(errs(validatePage(page([{ prse: "a" }])))[0].hint).toContain("prose")
    expect(errs(validatePage(page([{}]))).length).toBe(1)
  })

  test("enums, unique ids, unresolved paths", () => {
    expect(errs(validatePage(page([{ callout: { tone: "loud", body: "b" } }])))[0].path).toBe("sections[0].blocks[0].callout.tone")
    expect(errs(validatePage(page([{ risks: [{ risk: "r", severity: "hgh" }] }])))[0].hint).toContain("high")
    expect(errs(validatePage(page([{ decisions: [{ decision: "d", confidence: "sure" }] }]))).length).toBe(1)
    expect(errs(validatePage(page([{ evidence: [{ claim: "c", source: "s", status: "ok" }] }]))).length).toBe(1)
    expect(errs(validatePage(page([{ figure: { spec: arch, id: "x" } }, { figure: { spec: arch, id: "x" } }])))[0].message).toContain("duplicate figure id")
    const dup = validatePage({ type: "page", title: "T", sections: [{ id: "a", title: "A", blocks: [] }, { id: "a", title: "B", blocks: [] }] })
    expect(errs(dup)[0].message).toContain("duplicate section id")
    const p = errs(validatePage(page([{ figure: { spec: "x.json" } }])))[0]
    expect(p.path).toBe("sections[0].blocks[0].figure.spec")
    expect(p.hint).toContain("CLI")
    expect(errs(validatePage(page([{ columns: [[{ prose: "a" }]] }]))).length).toBe(1)
  })

  test("never throws on junk", () => {
    for (const x of [null, 1, "{", "[]", { type: "page" }, { type: "page", title: "t", sections: [1, { blocks: 2 }] }]) {
      const v = validatePage(x)
      expect(v.ok).toBe(false)
    }
  })

  test("diagram validate() points at pages", () => {
    const v = validate(page([]))
    expect(v.ok).toBe(false)
    expect(v.diagnostics[0].hint).toContain("validatePage")
  })

  test("filemap / diff from changes warn without --changes", () => {
    const v = validatePage(page([{ filemap: "changes" }, { diff: { file: "a.ts", lines: [1, 2] } }]))
    expect(v.ok).toBe(true)
    expect(v.diagnostics.some((d) => d.path === "changes" && d.severity === "warning")).toBe(true)
  })
})

describe("prose", () => {
  const html = (s: string) => renderToStaticMarkup(createElement(Prose, { text: s }))
  test("escapes HTML and never emits raw markup", () => {
    const out = html(`<script>alert(1)</script> <img src=x onerror=alert(1)> **<b>x</b>**`)
    expect(out).not.toContain("<script")
    expect(out).not.toContain("<img")
    expect(out).toContain("&lt;script&gt;")
    expect(out).toContain("<strong>&lt;b&gt;x&lt;/b&gt;</strong>")
  })
  test("unsafe link schemes render as text", () => {
    for (const u of ["javascript:alert(1)", "JaVaScRiPt:x", "data:text/html,x", "vbscript:x", "//evil.dev/x"]) {
      expect(safeHref(u)).toBeUndefined()
      expect(html(`[go](${u})`)).not.toContain("href")
    }
    expect(safeHref("https://x.dev/a?b=1#c")).toBe("https://x.dev/a?b=1#c")
    expect(safeHref("#risks")).toBe("#risks")
    expect(safeHref("other.html")).toBe("other.html")
    expect(html(`[a "b"](https://x.dev)`)).toContain(`href="https://x.dev"`)
  })
  test("block subset", () => {
    const out = html("a\nb\n\n- x\n- y\n\n3. p\n4. q\n\n#### H\n\n> q")
    expect(out).toContain("<p>a b</p>")
    expect(out).toContain("<ul><li>x</li><li>y</li></ul>")
    expect(out).toContain(`<ol start="3">`)
    expect(out).toContain("<h4>H</h4>")
    expect(out).toContain("<blockquote>")
    expect(html("`**not bold**` \\*lit\\*")).toContain("<code>**not bold**</code> *lit*")
  })
})

describe("page HTML", () => {
  const html = renderPageHtml(page(ALL_BLOCKS, { eyebrow: "Review", subtitle: "sub", summary: "Lead **x**", change: { base: "main", head: "feat", url: "javascript:alert(1)" } }))

  test("contract markup", () => {
    expect(html.startsWith("<!doctype html>\n<html lang=\"en\" class=\"si-noscript si-page\">")).toBe(true)
    for (const id of ["storyink-font", "storyink-theme", "storyink-diagram-css", "storyink-viewer-css", "storyink-page-css"]) expect(html).toContain(`<style id="${id}">`)
    // Phase 6: slide wrappers (display: contents in the article) and data-layout / data-present.
    expect(html).toContain(`<div id="storyink-page" data-layout="article" data-present="1"><div class="sp-slide sp-slide-title" data-slide="0" data-slide-layout="title"><header class="sp-head">`)
    expect(html).toContain(`<button type="button" class="sp-present" aria-label="Present"`)
    expect(html).toContain(`<main class="sp-main">`)
    expect(html).toContain(`<section class="sp-sec" id="s"><div class="sp-slide" data-slide="1" data-slide-layout="split" data-builds="0" data-fig-shape="tall">`)
    expect(html).toMatch(/<figure class="sp-b sp-wide sp-fig" id="fig-fig-1" data-fig="fig-1"><div class="sp-fig-root" data-si-fig="fig-1">/)
    expect(html).toContain(`<figcaption class="sp-cap">A talks to <strong>B</strong>.</figcaption>`)
    expect(html).toContain(`<script id="storyink-viewer">`)
    const data = JSON.parse(/<script type="application\/json" id="storyink-page-data">(.*?)<\/script>/s.exec(html)![1])
    expect(Object.keys(data.figures)).toEqual(["fig-1"])
    expect(data.figures["fig-1"].scene.title).toBe("A")
    expect(typeof data.version).toBe("string")
    expect(own(html)).not.toContain("javascript:")
  })

  test("every block renders", () => {
    for (const cls of ["sp-prose", "sp-kpis", "sp-table", "sp-cards", "sp-callout", "sp-fm", "si-diff", "sp-code-body", "sp-risks", "sp-decisions", "sp-ev", "sp-tl", "sp-check", "sp-details", "sp-cols"]) expect(html).toContain(cls)
    expect(html).toContain(`<code class="sp-ref">src/a.ts<span class="sp-ref-l">:12–20</span></code>`)
  })

  test("deterministic and offline", () => {
    const again = renderPageHtml(page(ALL_BLOCKS, { eyebrow: "Review", subtitle: "sub", summary: "Lead **x**", change: { base: "main", head: "feat", url: "javascript:alert(1)" } }))
    expect(again).toBe(html)
    // Links are fine; nothing is fetched: no src= / <link> / css url() to the network.
    expect(own(html)).not.toMatch(/src="(https?:)?\/\//)
    expect(own(html)).not.toMatch(/<link\b/)
    expect(own(html)).not.toMatch(/url\((["']?)(https?:)?\/\//)
  })

  test("TOC: auto at 4 sections, explicit override", () => {
    const secs = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `S${i}`, blocks: [{ prose: "x" }] }))
    expect(renderPageHtml({ type: "page", title: "t", sections: secs(3) })).not.toContain(`class="sp-toc"`)
    expect(renderPageHtml({ type: "page", title: "t", sections: secs(4) })).toContain(`class="sp-toc"`)
    expect(renderPageHtml({ type: "page", title: "t", toc: false, sections: secs(5) })).not.toContain(`class="sp-toc"`)
  })

  test("invalid pages throw StoryinkError with diagnostics", () => {
    expect(() => renderPageHtml(page([{ nope: 1 }]))).toThrow(/invalid page/)
  })

  test("single-diagram output is unchanged by pages", () => {
    const h = renderHtml(arch)
    expect(h).toContain(`<html lang="en" class="si-noscript">`)
    expect(own(h)).not.toContain(`class="sp-`)
    expect(own(h)).not.toContain("storyink-page")
    expect(h).toContain(`id="storyink-data"`)
  })
})

describe("pages with files and changes", () => {
  const ds = diffSetFrom(fs.readFileSync(path.join(ex, "changes", "storyink-0.4.0.changes.json"), "utf8"), "x.json")

  test("resolvePageChanges: figures resolved, page-level hunks bounded, pure", () => {
    const input = page([{ figure: { spec: { ...arch, nodes: [{ id: "a", files: ["src/theme/tokens.ts"] }, { id: "b" }] } } }, { filemap: "changes" }, { diff: { file: "src/theme/tokens.ts", lines: [167, 170] } }, { diff: { file: "nope.ts" } }])
    const before = JSON.stringify(input)
    const r = resolvePageChanges(input, ds)
    expect(JSON.stringify(input)).toBe(before)
    const p = r.page as { changes: { files: { path: string; hunks: unknown[] }[] }; sections: { blocks: { figure?: { spec: { nodes: { stat?: unknown }[] } } }[] }[] }
    expect(p.changes.files.length).toBe(50)
    expect(p.changes.files.filter((f) => f.hunks.length).map((f) => f.path)).toEqual(["src/theme/tokens.ts"])
    expect(p.sections[0].blocks[0].figure!.spec.nodes[0].stat).toBeDefined()
    expect(r.diagnostics.some((d) => d.path === "sections[0].blocks[3].diff.file")).toBe(true)
    const html = renderPageHtml(r.page)
    expect(html).toContain("RichPalette")
    expect(html).toContain("Largest changes")
  })

  test("loadPage resolves figure paths relative to the page file", () => {
    const r = loadPage(fs.readFileSync(path.join(ex, "pages", "pr-review.page.json"), "utf8"), path.join(ex, "pages"))
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([])
    expect(r.ok).toBe(true)
    const missing = loadPage(page([{ figure: { spec: "missing.json" } }]), ex)
    expect(missing.ok).toBe(false)
    expect(missing.diagnostics[0].path).toBe("sections[0].blocks[0].figure.spec")
  })

  test("loadPage resolves absolute and file:// figure / scrolly spec paths", () => {
    const abs = path.resolve(ex, "changes", "payment-retry.architecture.json")
    const blocks = [{ figure: { spec: abs } }, { scrolly: { figure: { spec: abs }, steps: "auto" } }, { figure: { spec: `file://${abs}` } }]
    const r = loadPage(page(blocks), "/nonexistent-dir")
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([])
    expect(r.ok).toBe(true)
    const secs = (r.page as { sections: { blocks: { figure?: { spec: unknown }; scrolly?: { figure: { spec: unknown } } }[] }[] }).sections
    expect(typeof secs[0].blocks[0].figure!.spec).toBe("object")
    expect(typeof secs[0].blocks[1].scrolly!.figure.spec).toBe("object")
    expect(typeof secs[0].blocks[2].figure!.spec).toBe("object")
  })

  test("example pages validate", () => {
    for (const f of fs.readdirSync(path.join(ex, "pages")).filter((x) => x.endsWith(".page.json"))) {
      const changes = f.startsWith("storyink-0.4.0") ? ds : undefined
      const r = loadPage(fs.readFileSync(path.join(ex, "pages", f), "utf8"), path.join(ex, "pages"), changes)
      expect(`${f}: ${r.diagnostics.filter((d) => d.severity === "error").map((d) => `${d.path} ${d.message}`).join("; ")}`).toBe(`${f}: `)
    }
  })
})
