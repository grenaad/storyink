import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { layout, renderPageHtml, validate, validatePage } from "../src/core/index.ts"
import { autoSteps, beatTargets, resolveAt } from "../src/core/page/targets.ts"
import { inferLayout } from "../src/core/page/slides.ts"
import { beatGroups, steppedSchedule } from "../src/core/story/state.ts"
import { loadPage } from "../src/node/page.ts"

const ex = path.join(import.meta.dir, "..", "examples")
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(ex, f), "utf8"))
const retry = read("changes/payment-retry.architecture.json")
const pr = read("changes/storyink-0.4.0.pr.json")
const tlOf = (spec: unknown) => layout(validate(spec).spec!).timeline!
const plain = (x: object) => ({ ...x, story: { steps: [{ pulse: "a->b", caption: "go" }] } })
const arch = { type: "architecture", title: "A", nodes: [{ id: "a" }, { id: "b" }], edges: [{ from: "a", to: "b" }] } as never
const page = (blocks: unknown[], extra: object = {}) => ({ type: "page", title: "T", sections: [{ title: "S", blocks }], ...extra })
const errs = (v: { diagnostics: { severity: string; path: string; message: string }[] }) => v.diagnostics.filter((d) => d.severity === "error")
const data = (h: string) => JSON.parse(/<script type="application\/json" id="storyink-page-data">(.*?)<\/script>/s.exec(h)![1])

describe("targets", () => {
  const tl = tlOf(retry)
  const groups = beatGroups(tl)
  const sched = steppedSchedule(tl)

  test("beatTargets are the settled stops", () => {
    const t = beatTargets(tl)
    expect(t.length).toBe(groups.length)
    t.forEach((x, k) => expect(x).toEqual({ beat: k, t: Math.round(sched[k].t * 1e4) / 1e4 }))
  })

  test("at: start, end, beat number, stop label, step id", () => {
    expect(resolveAt(tl, "start")).toEqual({ beat: -1, t: 0 })
    expect(resolveAt(tl, "end")).toEqual({ beat: groups.length - 1, t: Math.round(tl.duration * 1e4) / 1e4 })
    expect(resolveAt(tl, 2)).toEqual(beatTargets(tl)[1])
    expect(resolveAt(tl, "2")).toEqual(beatTargets(tl)[1])
    const k = groups.findIndex((g) => g.some((i) => tl.steps[i].stop === "Change"))
    expect(resolveAt(tl, "Change")).toEqual(beatTargets(tl)[k])
    expect(resolveAt(tl, tl.steps[groups[k][0]].id)).toEqual(beatTargets(tl)[k])
    expect(resolveAt(tl, 99)).toBeUndefined()
    expect(resolveAt(tl, "nope")).toBeUndefined()
  })

  test("auto steps: narrated steps first, else chapter stops", () => {
    const n = autoSteps(tlOf(pr))!
    expect(n.length).toBe(7)
    expect(n[0].title).toBeTruthy()
    expect(n.every((s) => s.body.length > 0)).toBe(true)
    const s = autoSteps(tl)!
    expect(s.map((x) => x.at)).toEqual(["Before", "Change", "Worker"])
    expect(s[1].body).toContain("soft decline")
    expect(autoSteps(tlOf(plain(arch)))).toBeUndefined()
  })
})

describe("validation", () => {
  test("scrolly: unresolved at, cite order, decreasing targets, no story", () => {
    const sc = (steps: unknown, spec: unknown = retry) => validatePage(page([{ scrolly: { figure: { spec }, steps } }]))
    const bad = errs(sc([{ at: "Nope", body: "x" }]))
    expect(bad[0].path).toBe("sections[0].blocks[0].scrolly.steps[0].at")
    expect(bad[0].message).toContain("matches no story step")
    expect(errs(sc([{ at: 1, body: "a b", cites: [{ text: "b", ref: "payments" }, { text: "a", ref: "payments" }] }]))[0].message).toContain("out of order")
    expect(errs(sc([{ at: 1, body: "a", cites: [{ text: "a", ref: "zzz" }] }]))[0].message).toContain("matches no element")
    const back = sc([{ at: "Worker", body: "w" }, { at: "Before", body: "b" }])
    expect(back.ok).toBe(true)
    expect(back.diagnostics.some((d) => d.severity === "warning" && d.message.includes("backwards"))).toBe(true)
    expect(errs(sc("auto", arch))[0].message).toContain("needs a story")
    expect(errs(sc("auto", plain(arch)))[0].message).toContain('"auto" needs')
    expect(sc("auto").ok).toBe(true)
  })

  test("break / scrolly only at section level; enums", () => {
    expect(errs(validatePage(page([{ details: { summary: "s", blocks: [{ break: true }] } }])))[0].message).toContain("directly in a section")
    expect(errs(validatePage(page([{ break: { layout: "wide" } }])))[0].path).toBe("sections[0].blocks[0].break.layout")
    expect(errs(validatePage(page([], { layout: "deck" })))[0].path).toBe("layout")
    expect(errs(validatePage({ type: "page", title: "T", sections: [{ title: "S", slide: { layout: "huge" }, blocks: [] }] }))[0].path).toBe("sections[0].slide.layout")
    expect(validatePage(page([{ figure: { spec: arch, builds: false } }, { break: true }, { prose: "x" }], { layout: "slides", present: true })).ok).toBe(true)
  })
})

describe("markup", () => {
  const deck = page(
    [{ prose: "intro" }, { figure: { id: "f", spec: retry } }, { break: { title: "More" } }, { scrolly: { id: "sc", figure: { id: "g", spec: retry }, steps: [{ at: "Before", title: "One", body: "Payments charge", cites: [{ text: "Payments", ref: "payments" }] }, { at: "end", body: "done" }] } }],
    { layout: "slides" },
  )
  const html = renderPageHtml(deck)

  test("slide wrappers, layouts, builds, present button", () => {
    expect(html).toContain(`<div id="storyink-page" data-layout="slides" data-present="1">`)
    expect(html).toContain(`<div class="sp-slide sp-slide-title" data-slide="0" data-slide-layout="title"><header class="sp-head">`)
    const beats = beatTargets(tlOf(retry)).length
    expect(html).toContain(`<div class="sp-slide" data-slide="1" data-slide-layout="split" data-builds="${beats}" data-fig-shape="tall">`)
    expect(html).toContain(`<div class="sp-slide" data-slide="2" data-slide-layout="split" data-builds="2" data-fig-shape="tall"><h2 class="sp-sec-title sp-cont">More</h2>`)
    expect(html).toContain(`class="sp-present" aria-label="Present"`)
    const d = data(html)
    expect(d.slides.map((s: { id: string; builds: number }) => [s.id, s.builds])).toEqual([["title", 0], ["s", beats], ["s-2", 2]])
    // The viewer indexes data.slides by data-slide: the title slide must stay at index 0.
    expect(d.slides.length).toBe((html.match(/class="sp-slide[^"]*" data-slide="/g) ?? []).length)
    expect(d.slides[0].layout).toBe("title")
    expect(d.slides[1].build.fig).toBe("f")
    expect(d.slides[2].scrolly).toBe("sc")
    expect(d.slides[2].figs).toEqual(["g"])
  })

  test("scrolly markup and data", () => {
    expect(html).toContain(`<div class="sp-b sp-wide sp-scrolly sp-scrolly-right" id="sc" data-scrolly="sc" data-fig="g"><div class="sp-scrolly-graphic"><figure class="sp-b sp-wide sp-fig`)
    expect(html).toContain(`<div class="sp-fig-root" data-si-fig="g">`)
    expect(html).toContain(`<li class="sp-scrolly-step" data-step="0"><h4>One</h4><div class="sp-prose"><p><span class="sp-cite" data-ref="payments" tabindex="0">Payments</span> charge</p></div></li>`)
    const d = data(html)
    expect(d.scrolly.sc.fig).toBe("g")
    expect(d.scrolly.sc.steps).toEqual([resolveAt(tlOf(retry), "Before"), resolveAt(tlOf(retry), "end")])
  })

  test("present: false, article default, determinism", () => {
    const h = renderPageHtml(page([{ prose: "x" }], { present: false }))
    expect(h).toContain(`data-layout="article" data-present="0"`)
    expect(h).not.toContain(`class="sp-present"`)
    expect(renderPageHtml(deck)).toBe(html)
  })

  test("layout inference", () => {
    expect(inferLayout([{ figure: { spec: arch } }])).toBe("full")
    expect(inferLayout([{ figure: { spec: arch } }, { prose: "x" }])).toBe("split")
    expect(inferLayout([{ prose: "short" }, { kpis: [] }])).toBe("center")
    expect(inferLayout([{ prose: "x".repeat(400) }])).toBe("flow")
    expect(inferLayout([{ prose: "a" }, { prose: "b" }, { prose: "c" }])).toBe("flow")
  })
})

describe("examples", () => {
  test("phase 6 example pages load and render", () => {
    const ds = fs.readFileSync(path.join(ex, "changes", "storyink-0.4.0.changes.json"), "utf8")
    for (const f of ["payment-retry.scrolly.page.json", "pr-review.deck.page.json", "storyink-0.4.0.scrolly.page.json"]) {
      const changes = f.startsWith("storyink") ? (JSON.parse(ds) as never) : undefined
      const r = loadPage(fs.readFileSync(path.join(ex, "pages", f), "utf8"), path.join(ex, "pages"), changes)
      expect(`${f}: ${errs(r).map((d) => `${d.path} ${d.message}`).join("; ")}`).toBe(`${f}: `)
      expect(renderPageHtml(r.page)).toContain("data-scrolly=")
    }
  })
})
