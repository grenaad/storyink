import type { CodeLine, TokKind } from "../scene.ts"
import type { CodeLang } from "../spec.ts"
import { normalizeLang } from "../diff/lang.ts"

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
  lang = normalizeLang(lang) as CodeLang
  if (lang === "text") return lines.map((l) => (l ? [{ t: l, c: 0 }] : []))
  const other = OTHER[lang]
  if (other) {
    const rs = other(lines)
    return lines.map((_, i) => merge(rs.filter((r) => r.line === i)))
  }
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

// ---------------------------------------------------------------------------------------------
// Other languages (py, go, rust, sql, yaml, sh): one small configurable C-ish lexer plus YAML and
// shell lexers. Keywords, strings, numbers, comments, calls, declarations, PascalCase types.

interface LexConf {
  keywords: Set<string>
  literals: Set<string>
  types?: Set<string>
  /** Line comment prefixes. */
  line: string[]
  /** Block comment delimiters. */
  block?: [string, string]
  /** Single-line string quotes. */
  quotes: string[]
  /** Multi-line string delimiters (same open / close). */
  multi?: string[]
  /** Keywords whose next identifier is a declaration (`def`). */
  decl?: Set<string>
  /** Keywords whose next identifier is a type. */
  typeDecl?: Set<string>
  /** Case-insensitive keywords (SQL). */
  ci?: boolean
  ops: string[]
  /** Identifier pattern (default [A-Za-z_]\w*). */
  ident?: RegExp
}

const words = (s: string) => new Set(s.split(" "))

const CONF: Record<"py" | "go" | "rust" | "sql", LexConf> = {
  py: {
    keywords: words("and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case self"),
    literals: words("True False None"),
    types: words("int str float bool bytes list dict set tuple object"),
    line: ["#"],
    quotes: ['"', "'"],
    multi: ['"""', "'''"],
    decl: words("def"),
    typeDecl: words("class"),
    ops: ["**=", "//=", "->", ":=", "==", "!=", "<=", ">=", "**", "//", "+=", "-=", "*=", "/=", "%=", "=", "+", "-", "*", "/", "%", "<", ">", "&", "|", "^", "~", "@"],
  },
  go: {
    keywords: words("break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var"),
    literals: words("true false nil iota"),
    types: words("int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 uintptr float32 float64 complex64 complex128 string bool byte rune error any"),
    line: ["//"],
    block: ["/*", "*/"],
    quotes: ['"', "'"],
    multi: ["`"],
    decl: words("func"),
    typeDecl: words("type"),
    ops: ["<<=", ">>=", "&^=", "...", ":=", "==", "!=", "<=", ">=", "&&", "||", "<-", "<<", ">>", "&^", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "=", "+", "-", "*", "/", "%", "<", ">", "!", "&", "|", "^"],
  },
  rust: {
    keywords: words("as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while"),
    literals: words("true false None Some Ok Err"),
    types: words("i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str String Vec Option Result Box"),
    line: ["//"],
    block: ["/*", "*/"],
    quotes: ['"'],
    decl: words("fn let"),
    typeDecl: words("struct enum trait type impl"),
    ops: ["..=", "<<=", ">>=", "=>", "->", "::", "..", "==", "!=", "<=", ">=", "&&", "||", "<<", ">>", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "=", "+", "-", "*", "/", "%", "<", ">", "!", "&", "|", "^", "?"],
  },
  sql: {
    keywords: words("select from where and or not in is null as join left right inner outer full cross on group by order having limit offset insert into values update set delete create table index view drop alter add column primary key foreign references unique default distinct union all exists case when then else end with returning begin commit rollback transaction if like between asc desc over partition cascade constraint"),
    literals: words("true false null"),
    types: words("int integer bigint smallint text varchar char boolean bool date timestamp timestamptz numeric decimal real float serial bigserial uuid json jsonb"),
    line: ["--"],
    block: ["/*", "*/"],
    quotes: ["'"],
    ci: true,
    ops: ["<>", "!=", "<=", ">=", "||", "::", "=", "<", ">", "+", "-", "*", "/", "%"],
  },
}

function lexConf(conf: LexConf, lines: string[]): Raw[] {
  const out: Raw[] = []
  let open: string | undefined // inside a block comment ("*/") or multi-line string (its delimiter)
  let openKind: TokKind = "com"
  const identRe = conf.ident ?? /^[A-Za-z_][\w]*/
  lines.forEach((s, line) => {
    let i = 0
    const push = (t: string, k?: TokKind, extra?: Partial<Raw>) => {
      if (t) out.push({ t, c: i, line, ...(k ? { k } : {}), ...extra })
      i += t.length
    }
    while (i < s.length) {
      if (open) {
        const e = s.indexOf(open, i)
        push(e < 0 ? s.slice(i) : s.slice(i, e + open.length), openKind)
        if (e >= 0) open = undefined
        continue
      }
      const ch = s[i]
      const rest = s.slice(i)
      if (/\s/.test(ch)) {
        push(/^\s+/.exec(rest)![0], undefined, { ws: true })
        continue
      }
      if (conf.line.some((p) => rest.startsWith(p))) {
        push(rest, "com")
        continue
      }
      if (conf.block && rest.startsWith(conf.block[0])) {
        const e = s.indexOf(conf.block[1], i + conf.block[0].length)
        if (e < 0) {
          open = conf.block[1]
          openKind = "com"
          push(rest, "com")
        } else push(s.slice(i, e + conf.block[1].length), "com")
        continue
      }
      const m = conf.multi?.find((d) => rest.startsWith(d))
      if (m) {
        const e = s.indexOf(m, i + m.length)
        if (e < 0) {
          open = m
          openKind = "str"
          push(rest, "str")
        } else push(s.slice(i, e + m.length), "str")
        continue
      }
      // Python string prefixes (f"", r"", b"") and Rust raw / byte strings.
      const pre = /^([rRbBfFuU]{1,2})(?=["'])/.exec(rest)
      const q = conf.quotes.find((x) => rest.startsWith(x)) ?? (pre && conf.quotes.includes(rest[pre[0].length]) ? rest[pre[0].length] : undefined)
      if (q && (!pre || conf === CONF.py || conf === CONF.rust)) {
        const startQ = i + (conf.quotes.includes(ch) ? 0 : pre![0].length)
        // Rust lifetimes / char literals: 'a' is a string only when it closes quickly.
        let j = startQ + 1
        while (j < s.length && s[j] !== q) j += s[j] === "\\" && conf !== CONF.sql ? 2 : 1
        push(s.slice(i, Math.min(j + 1, s.length)), "str")
        continue
      }
      const num = /^(0[xXbBoO][\da-fA-F_]+|\d[\d_]*(\.\d+)?([eE][+-]?\d+)?\w*|\.\d+)/.exec(rest)
      if (num) {
        push(num[0], "num")
        continue
      }
      const id = identRe.exec(rest)
      if (id) {
        push(id[0], undefined, { ident: true })
        continue
      }
      const op = conf.ops.find((o) => rest.startsWith(o))
      if (op) {
        push(op, "op")
        continue
      }
      push(ch)
    }
  })
  classifyConf(conf, out)
  return out
}

function classifyConf(conf: LexConf, all: Raw[]): void {
  const sig = all.filter((r) => !r.ws && r.k !== "com")
  sig.forEach((r, i) => {
    if (!r.ident || r.k) return
    const w = conf.ci ? r.t.toLowerCase() : r.t
    const prev = sig[i - 1]
    const next = sig[i + 1]?.t
    const member = prev?.t === "." || prev?.t === "::"
    const pw = prev?.ident ? (conf.ci ? prev.t.toLowerCase() : prev.t) : undefined
    if (pw && conf.decl?.has(pw) && prev!.k === "kw" && !conf.keywords.has(w)) r.k = "def"
    else if (pw && conf.typeDecl?.has(pw) && prev!.k === "kw" && !conf.keywords.has(w)) r.k = "type"
    else if (!member && conf.keywords.has(w)) r.k = "kw"
    else if (conf.literals.has(w)) r.k = "num"
    else if (conf.types?.has(w) && next !== "(") r.k = "type"
    else if (next === "(" || (conf === CONF.rust && next === "!")) r.k = "fn"
    else if (!conf.ci && /^[A-Z]/.test(r.t) && /[a-z]/.test(r.t)) r.k = "type"
  })
}

function lexYaml(lines: string[]): Raw[] {
  const out: Raw[] = []
  lines.forEach((s, line) => {
    let i = 0
    const push = (t: string, k?: TokKind, ws = false) => {
      if (t) out.push({ t, c: i, line, ...(k ? { k } : {}), ...(ws ? { ws } : {}) })
      i += t.length
    }
    const lead = /^\s*/.exec(s)![0]
    push(lead, undefined, true)
    if (s.startsWith("---") || s.startsWith("...")) {
      push(s.slice(i), "kw")
      return
    }
    if (s.slice(i).startsWith("- ") || s.slice(i) === "-") push("-", "op")
    // key:
    const key = /^(\s*)("[^"]*"|'[^']*'|[^\s#:'"][^#:]*?)(\s*)(:)(?=\s|$)/.exec(s.slice(i))
    if (key) {
      push(key[1], undefined, true)
      push(key[2], "def")
      push(key[3], undefined, true)
      push(":", "op")
    }
    while (i < s.length) {
      const rest = s.slice(i)
      const ch = s[i]
      if (/\s/.test(ch)) {
        push(/^\s+/.exec(rest)![0], undefined, true)
        continue
      }
      if (ch === "#") {
        push(rest, "com")
        continue
      }
      if (ch === '"' || ch === "'") {
        let j = i + 1
        while (j < s.length && s[j] !== ch) j += s[j] === "\\" && ch === '"' ? 2 : 1
        push(s.slice(i, Math.min(j + 1, s.length)), "str")
        continue
      }
      if (ch === "&" || ch === "*" || ch === "!") {
        push(/^\S+/.exec(rest)![0], "type")
        continue
      }
      if (ch === "|" || ch === ">" || "[]{},".includes(ch)) {
        push(ch, ch === "|" || ch === ">" ? "op" : undefined)
        continue
      }
      const word = /^[^\s,\[\]{}#]+(?:[ \t]+[^\s,\[\]{}#]+)*/.exec(rest)![0]
      const k: TokKind = /^(-?\d[\d_.eE+-]*|0x[\da-fA-F]+|true|false|null|yes|no|on|off|~)$/i.test(word) ? "num" : "str"
      push(word, k)
    }
  })
  return out
}

const SH_KEYWORDS = words("if then else elif fi for while until do done case esac in function select return exit local export readonly declare set unset shift source time")

// Keywords after which a command follows.
const SH_CMD_KW = words("if then else elif do while until time")

function lexSh(lines: string[]): Raw[] {
  const out: Raw[] = []
  let heredoc: string | undefined
  lines.forEach((s, line) => {
    let i = 0
    let cmd = true // next word is in command position
    const push = (t: string, k?: TokKind, ws = false) => {
      if (t) out.push({ t, c: i, line, ...(k ? { k } : {}), ...(ws ? { ws } : {}) })
      i += t.length
    }
    if (heredoc !== undefined) {
      push(s, "str")
      if (s.trim() === heredoc) heredoc = undefined
      return
    }
    while (i < s.length) {
      const rest = s.slice(i)
      const ch = s[i]
      if (/\s/.test(ch)) {
        push(/^\s+/.exec(rest)![0], undefined, true)
        continue
      }
      if (ch === "#" && (i === 0 || /\s/.test(s[i - 1]))) {
        push(rest, "com")
        continue
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        let j = i + 1
        while (j < s.length && s[j] !== ch) j += s[j] === "\\" && ch !== "'" ? 2 : 1
        push(s.slice(i, Math.min(j + 1, s.length)), "str")
        cmd = false
        continue
      }
      const v = /^\$(\{[^}]*\}|\(\(?|[A-Za-z_]\w*|[0-9@#?*$!-])/.exec(rest)
      if (v) {
        push(v[0], "param")
        cmd = v[1] === "(" || v[1] === "(("
        continue
      }
      const hd = /^<<-?\s*['"]?(\w+)['"]?/.exec(rest)
      if (hd) {
        heredoc = hd[1]
        push(hd[0], "op")
        continue
      }
      const op = ["&&", "||", ";;", "|", ";", "&", ">>", ">", "<", "(", ")"].find((o) => rest.startsWith(o))
      if (op) {
        push(op, op === "(" || op === ")" ? undefined : "op")
        cmd = op !== ">" && op !== ">>" && op !== "<"
        continue
      }
      const asg = /^([A-Za-z_]\w*)(=)/.exec(rest)
      if (asg && cmd) {
        push(asg[1], "def")
        push("=", "op")
        const val = /^[^\s|&;<>()'"`$]+/.exec(s.slice(i))
        if (val) push(val[0])
        continue
      }
      if (ch === "{" || ch === "}") {
        push(ch)
        continue
      }
      const word = /^[^\s|&;<>()'"`$]+/.exec(rest)
      if (!word) {
        push(ch)
        continue
      }
      const w = word[0]
      if (cmd && SH_KEYWORDS.has(w)) {
        push(w, "kw")
        cmd = SH_CMD_KW.has(w)
        continue
      }
      else if (/^-?\d+$/.test(w)) push(w, "num")
      else if (cmd && /^[A-Za-z_][\w.-]*$/.test(w) && s.slice(i + w.length).trimStart().startsWith("()")) push(w, "def")
      else if (cmd) {
        push(w, "fn")
        cmd = false
        continue
      } else if (/^--?[\w-]/.test(w)) push(w, "op")
      else push(w)
      cmd = false
    }
  })
  return out
}

const OTHER: Partial<Record<CodeLang, (lines: string[]) => Raw[]>> = {
  py: (l) => lexConf(CONF.py, l),
  go: (l) => lexConf(CONF.go, l),
  rust: (l) => lexConf(CONF.rust, l),
  sql: (l) => lexConf(CONF.sql, l),
  yaml: lexYaml,
  sh: lexSh,
}
