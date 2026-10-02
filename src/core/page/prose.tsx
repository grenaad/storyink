/**
 * A safe Markdown subset → React elements. Block: paragraphs, `-` / `*` and `1.` lists, `###` /
 * `####` headings, `>` quotes. Inline: `**bold**`, `*italic*`, `` `code` ``, `[text](url)` (http(s),
 * mailto, `#anchor` or relative only). No raw HTML: every character is text (React escapes it).
 */
import type { ReactNode } from "react"

/** Is a link target safe to emit (no `javascript:` / `data:` / other schemes)? */
export function safeHref(url: string): string | undefined {
  const u = url.trim()
  if (!u || /[\s<>"'`]/.test(u)) return undefined
  if (/^(https?:\/\/|mailto:)/i.test(u)) return u
  if (u.startsWith("#")) return u
  // Relative: no scheme before the first / ? #.
  const head = u.split(/[/?#]/)[0]
  if (head.includes(":") || u.startsWith("//")) return undefined
  return u
}

/** Inline spans. */
export function inline(text: string, key = "i"): ReactNode[] {
  const out: ReactNode[] = []
  let buf = ""
  let n = 0
  const flush = () => {
    if (buf) out.push(buf)
    buf = ""
  }
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === "\\" && i + 1 < text.length && /[\\`*_[\]()#>\-.!]/.test(text[i + 1])) {
      buf += text[i + 1]
      i += 2
      continue
    }
    if (ch === "`") {
      const j = text.indexOf("`", i + 1)
      if (j > i) {
        flush()
        out.push(<code key={`${key}${n++}`}>{text.slice(i + 1, j)}</code>)
        i = j + 1
        continue
      }
    }
    if (ch === "*" && text[i + 1] === "*") {
      const j = text.indexOf("**", i + 2)
      if (j > i + 2) {
        flush()
        out.push(<strong key={`${key}${n++}`}>{inline(text.slice(i + 2, j), `${key}${n}.`)}</strong>)
        i = j + 2
        continue
      }
    }
    if (ch === "*" && text[i + 1] !== " " && text[i + 1] !== "*") {
      const j = text.indexOf("*", i + 1)
      if (j > i + 1 && text[j - 1] !== " ") {
        flush()
        out.push(<em key={`${key}${n++}`}>{inline(text.slice(i + 1, j), `${key}${n}.`)}</em>)
        i = j + 1
        continue
      }
    }
    if (ch === "[") {
      const m = /^\[([^\]\n]+)\]\(([^()\s]*)\)/.exec(text.slice(i))
      if (m) {
        flush()
        const href = safeHref(m[2])
        const kids = inline(m[1], `${key}${n}.`)
        out.push(href ? <a key={`${key}${n++}`} href={href}>{kids}</a> : <span key={`${key}${n++}`}>{kids}</span>)
        i += m[0].length
        continue
      }
    }
    buf += ch
    i++
  }
  flush()
  return out
}

type Blk = { k: "p" | "h3" | "h4" | "quote"; text: string } | { k: "ul" | "ol"; items: string[]; start: number }

function parse(src: string): Blk[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n")
  const out: Blk[] = []
  let para: string[] = []
  let quote: string[] = []
  let list: { k: "ul" | "ol"; items: string[]; start: number } | undefined
  const end = () => {
    if (para.length) out.push({ k: "p", text: para.join(" ") })
    if (quote.length) out.push({ k: "quote", text: quote.join("\n") })
    if (list) out.push(list)
    para = []
    quote = []
    list = undefined
  }
  for (const raw of lines) {
    const line = raw.trimEnd()
    const t = line.trim()
    if (!t) {
      end()
      continue
    }
    const h = /^(#{3,4})\s+(.*)$/.exec(t)
    if (h) {
      end()
      out.push({ k: h[1].length === 3 ? "h3" : "h4", text: h[2] })
      continue
    }
    const q = /^>\s?(.*)$/.exec(t)
    if (q) {
      if (!quote.length) end()
      quote.push(q[1])
      continue
    }
    const ul = /^[-*]\s+(.*)$/.exec(t)
    const ol = /^(\d{1,4})[.)]\s+(.*)$/.exec(t)
    if (ul || ol) {
      const k = ul ? "ul" : "ol"
      if (!list || list.k !== k) {
        end()
        list = { k, items: [], start: ol ? Number(ol[1]) : 1 }
      }
      list.items.push(ul ? ul[1] : ol![2])
      continue
    }
    if (list && /^\s{2,}/.test(raw)) {
      list.items[list.items.length - 1] += ` ${t}`
      continue
    }
    if (list || quote.length) end()
    para.push(t)
  }
  end()
  return out
}

/** Block prose (paragraphs, lists, headings, quotes). */
export function Prose({ text, className }: { text: string; className?: string }): ReactNode {
  const blocks = parse(text)
  return (
    <div className={className ?? "sp-prose"}>
      {blocks.map((b, i) => {
        const k = `b${i}`
        if (b.k === "p") return <p key={k}>{inline(b.text, `${k}.`)}</p>
        if (b.k === "h3") return <h3 key={k}>{inline(b.text, `${k}.`)}</h3>
        if (b.k === "h4") return <h4 key={k}>{inline(b.text, `${k}.`)}</h4>
        if (b.k === "quote")
          return (
            <blockquote key={k}>
              {b.text.split(/\n{1,}/).map((l, j) => (
                <p key={j}>{inline(l, `${k}.${j}.`)}</p>
              ))}
            </blockquote>
          )
        const l = b as Extract<Blk, { items: string[] }>
        const items = l.items.map((it, j) => <li key={j}>{inline(it, `${k}.${j}.`)}</li>)
        return l.k === "ul" ? <ul key={k}>{items}</ul> : <ol key={k} {...(l.start !== 1 ? { start: l.start } : {})}>{items}</ol>
      })}
    </div>
  )
}

/** Inline prose (captions, titles in lists): no block structure. */
export function Inline({ text }: { text: string }): ReactNode {
  return <>{inline(text.replace(/\s*\n\s*/g, " "))}</>
}
