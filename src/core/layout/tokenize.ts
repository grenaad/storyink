import type { CodeLine, TokKind } from "../scene.ts"
import type { CodeLang } from "../spec.ts"

/**
 * A small, deterministic syntax colourer for code nodes (not a parser). TS/JS: keywords,
 * operators, strings / templates, numbers and literals, calls, declarations, PascalCase types,
 * arrow / function parameters and comments; block comments and templates carry across lines.
 * JSON: keys, strings, literals. Text: plain.
 */

const KEYWORDS = new Set(
  "abstract as async await break case catch class const continue debugger default delete do else enum export extends finally for from function if implements import in instanceof interface let new of package private protected public readonly return static super switch this throw try type typeof var void while with yield satisfies declare namespace module keyof infer is".split(" "),
)
const LITERALS = new Set(["true", "false", "null", "undefined", "NaN", "Infinity"])
const BUILTIN_TYPES = new Set(["string", "number", "boolean", "bigint", "symbol", "object", "any", "unknown", "never"])
const OPS = ["===", "!==", "**=", "...", "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "**", "++", "--", "+=", "-=", "*=", "/=", "%=", "=", "+", "-", "*", "/", "%", "<", ">", "!", "?", "&", "|", "^", "~"]
// Punctuation that stays plain ink.
const PUNCT = new Set(["{", "}", "(", ")", "[", "]", ",", ";", ".", ":", "?."])

type Raw = { t: string; c: number; line: number; k?: TokKind; ident?: boolean; ws?: boolean }

/** Expand tabs (2 spaces) and split a code value into lines. */
export function codeLines(code: string | string[]): string[] {
  const lines = Array.isArray(code) ? code.flatMap((l) => String(l).split("\n")) : String(code ?? "").split("\n")
  return lines.map((l) => l.replace(/\r$/, "").replace(/\t/g, "  "))
}

/** Tokenize a program into coloured lines (tokens carry their start column). */
export function tokenize(code: string | string[], lang: CodeLang = "ts"): CodeLine[] {
  const lines = codeLines(code)
  if (lang === "text") return lines.map((l) => (l ? [{ t: l, c: 0 }] : []))
  const raw = lang === "json" ? lexJson(lines) : lexTs(lines)
  if (lang !== "json") classifyTs(raw)
  return lines.map((_, i) => merge(raw.filter((r) => r.line === i)))
}

/** Adjacent tokens of the same kind merge (fewer tspans); whitespace is plain ink. */
function merge(rs: Raw[]): CodeLine {
  const out: CodeLine = []
  for (const r of rs) {
    if (r.ws && !out.length) continue // leading indentation is carried by the column
    const k = r.ws ? undefined : r.k
    const last = out[out.length - 1]
    if (last && last.k === k) last.t += r.t
    else out.push(k ? { t: r.t, c: r.c, k } : { t: r.t, c: r.c })
  }
  const last = out[out.length - 1]
  if (last && !last.k) {
    last.t = last.t.replace(/\s+$/, "")
    if (!last.t) out.pop()
  }
  return out
}

function lexTs(lines: string[]): Raw[] {
  const out: Raw[] = []
  let block = false // inside /* */
  // Template nesting: each entry = brace depth at which the `${` opened.
  const tpl: number[] = []
  let inTpl = false
  let depth = 0
  lines.forEach((s, line) => {
    let i = 0
    const push = (t: string, k?: TokKind, extra?: Partial<Raw>) => {
      if (t) out.push({ t, c: i, line, ...(k ? { k } : {}), ...extra })
      i += t.length
    }
    while (i < s.length) {
      if (block) {
        const e = s.indexOf("*/", i)
        push(e < 0 ? s.slice(i) : s.slice(i, e + 2), "com")
        if (e >= 0) block = false
        continue
      }
      if (inTpl) {
        let j = i
        while (j < s.length && s[j] !== "`" && !(s[j] === "$" && s[j + 1] === "{")) j += s[j] === "\\" ? 2 : 1
        j = Math.min(j, s.length)
        push(s.slice(i, j), "str")
        if (s[i] === "`") {
          push("`", "str")
          inTpl = false
        } else if (s[i] === "$") {
          push("${", "kw")
          tpl.push(depth)
          inTpl = false
        }
        continue
      }
      const ch = s[i]
      const rest = s.slice(i)
      if (/\s/.test(ch)) {
        push(/^\s+/.exec(rest)![0], undefined, { ws: true })
        continue
      }
      if (rest.startsWith("//")) {
        push(rest, "com")
        continue
      }
      if (rest.startsWith("/*")) {
        block = true
        push("/*", "com")
        continue
      }
      if (ch === '"' || ch === "'") {
        let j = i + 1
        while (j < s.length && s[j] !== ch) j += s[j] === "\\" ? 2 : 1
        push(s.slice(i, Math.min(j + 1, s.length)), "str")
        continue
      }
      if (ch === "`") {
        push("`", "str")
        inTpl = true
        continue
      }
      const num = /^(0[xXbBoO][\da-fA-F_]+n?|\d[\d_]*(\.\d+)?([eE][+-]?\d+)?n?|\.\d+)/.exec(rest)
      if (num) {
        push(num[0], "num")
        continue
      }
      const id = /^[A-Za-z_$][\w$]*/.exec(rest)
      if (id) {
        push(id[0], undefined, { ident: true })
        continue
      }
      if (ch === "{") depth++
      if (ch === "}") {
        if (tpl.length && tpl[tpl.length - 1] === depth) {
          tpl.pop()
          push("}", "kw")
          inTpl = true
          continue
        }
        depth--
      }
      const op = OPS.find((o) => rest.startsWith(o) && !PUNCT.has(o))
      if (op && !(op === "?" && rest.startsWith("?."))) {
        push(op, "op")
        continue
      }
      push(rest.startsWith("?.") ? "?." : ch)
    }
  })
  return out
}

function classifyTs(all: Raw[]): void {
  const sig = all.filter((r) => !r.ws && r.k !== "com")
  const at = (i: number) => sig[i]?.t
  // Matching brackets.
  const match = new Map<number, number>()
  const stack: number[] = []
  sig.forEach((r, i) => {
    if (r.k) return
    if (r.t === "(" || r.t === "[" || r.t === "{") stack.push(i)
    else if (r.t === ")" || r.t === "]" || r.t === "}") {
      const o = stack.pop()
      if (o !== undefined) {
        match.set(o, i)
        match.set(i, o)
      }
    }
  })
  const params = new Set<number>()
  const defs = new Set<number>()
  // Idents in a bracket group that are bindings (not keys before ":" renames' left side, not types after ":").
  const bindings = (a: number, b: number, into: Set<number>) => {
    let d = 0
    for (let j = a + 1; j < b; j++) {
      const r = sig[j]
      if (!r.k && (r.t === "(" || r.t === "[" || r.t === "{")) d++
      if (!r.k && (r.t === ")" || r.t === "]" || r.t === "}")) d--
      if (!r.ident) continue
      const prev = at(j - 1)
      const next = at(j + 1)
      if (prev === ":" || prev === "=" || prev === ".") {
        // type annotation / default value / member: skip, but a rename target `{ a: b }` inside a
        // destructuring object is a binding.
        if (prev === ":" && d > 0 && sig[j - 3] && (at(j - 3) === "{" || at(j - 3) === ",")) into.add(j)
        continue
      }
      if (next === ":" && d > 0) continue // destructuring key with rename
      if (next === "(") continue
      into.add(j)
    }
  }
  sig.forEach((r, i) => {
    // Arrow parameters.
    if (r.t === "=>" && r.k === "op") {
      const p = i - 1
      if (sig[p]?.ident) params.add(p)
      else if (at(p) === ")" && match.has(p)) bindings(match.get(p)!, p, params)
    }
    if (!r.ident) return
    // function name(params)
    if (r.t === "function") {
      let n = i + 1
      if (at(n) === "*") n++
      if (sig[n]?.ident && at(n + 1) === "(") {
        const o = n + 1
        if (match.has(o)) bindings(o, match.get(o)!, params)
      } else if (at(n) === "(" && match.has(n)) bindings(n, match.get(n)!, params)
    }
    // const / let / var bindings, including destructuring.
    if (r.t === "const" || r.t === "let" || r.t === "var") {
      const n = i + 1
      if (sig[n]?.ident) defs.add(n)
      else if ((at(n) === "{" || at(n) === "[") && match.has(n)) bindings(n, match.get(n)!, defs)
    }
    if (r.t === "class" || r.t === "interface" || r.t === "type" || r.t === "enum") {
      if (sig[i + 1]?.ident) sig[i + 1].k = "type"
    }
  })
  sig.forEach((r, i) => {
    if (!r.ident || r.k) return
    const prev = at(i - 1)
    const next = at(i + 1)
    if (params.has(i)) r.k = "param"
    else if (defs.has(i)) r.k = "def"
    else if (prev !== "." && prev !== "?." && next !== ":" && KEYWORDS.has(r.t)) r.k = "kw"
    else if (LITERALS.has(r.t)) r.k = "num"
    else if (/^[A-Z]/.test(r.t) && /[a-z]/.test(r.t)) r.k = "type"
    else if (next === "(") r.k = "fn"
    else if (BUILTIN_TYPES.has(r.t) && prev === ":") r.k = "type"
  })
}

function lexJson(lines: string[]): Raw[] {
  const out: Raw[] = []
  lines.forEach((s, line) => {
    let i = 0
    const push = (t: string, k?: TokKind, ws = false) => {
      if (t) out.push({ t, c: i, line, ...(k ? { k } : {}), ...(ws ? { ws } : {}) })
      i += t.length
    }
    while (i < s.length) {
      const rest = s.slice(i)
      const ch = s[i]
      if (/\s/.test(ch)) {
        push(/^\s+/.exec(rest)![0], undefined, true)
        continue
      }
      if (ch === '"') {
        let j = i + 1
        while (j < s.length && s[j] !== '"') j += s[j] === "\\" ? 2 : 1
        const t = s.slice(i, Math.min(j + 1, s.length))
        const key = /^\s*:/.test(s.slice(i + t.length))
        push(t, key ? "def" : "str")
        continue
      }
      const lit = /^(-?\d[\d.eE+-]*|true|false|null)/.exec(rest)
      if (lit) {
        push(lit[0], "num")
        continue
      }
      push(ch)
    }
  })
  return out
}
