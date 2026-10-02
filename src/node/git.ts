/** `git diff` → DiffSet (Node only). */
import { execFileSync } from "node:child_process"
import { parseUnifiedDiff } from "../core/diff/parse.ts"
import type { DiffSet } from "../core/diff/types.ts"

export interface GitDiffOptions {
  /** Repository directory (default: process.cwd()). */
  cwd?: string
  /** `a..b`, `a...b` (from the merge base), or one revision (vs the working tree). */
  range?: string
  base?: string
  head?: string
  /** Staged changes (`--cached`) vs `base` (default HEAD). */
  staged?: boolean
  /** Limit to these git pathspecs (e.g. `src`, `:!docs/gallery`). */
  paths?: string[]
  /** Unified diff text to parse instead of running git. */
  patch?: string
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] })
}

function tryGit(cwd: string, args: string[]): string | undefined {
  try {
    return git(cwd, args).trim()
  } catch {
    return undefined
  }
}

/** The default branch: origin/HEAD, else main, else master. */
export function defaultBranch(cwd: string): string | undefined {
  const sym = tryGit(cwd, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"])
  if (sym) return sym
  for (const b of ["main", "master", "origin/main", "origin/master"]) if (tryGit(cwd, ["rev-parse", "--verify", "--quiet", `${b}^{commit}`])) return b
  return undefined
}

const DIFF = ["-c", "core.quotePath=true", "diff", "--no-color", "--no-ext-diff", "--find-renames", "--unified=3", "--src-prefix=a/", "--dst-prefix=b/"]

/**
 * Run `git diff` and parse it. Default: working tree vs the merge base with the default branch.
 * Labels: `base` / `head` are the given refs (head "working tree" / "index" when uncommitted);
 * `title` is the head commit's subject when the head is a commit.
 */
export function gitDiff(opts: GitDiffOptions = {}): DiffSet {
  const cwd = opts.cwd ?? process.cwd()
  let text: string
  let base = opts.base
  let head = opts.head
  let headCommit: string | undefined
  if (opts.patch !== undefined) text = opts.patch
  else {
    const args = [...DIFF]
    if (opts.staged) args.push("--cached")
    if (opts.range) {
      const m = /^(.*?)(\.\.\.?)(.*)$/.exec(opts.range)
      if (m) {
        const a = m[1] || "HEAD"
        const b = m[3] || "HEAD"
        base = a
        head = b
        headCommit = b
        if (m[2] === "...") {
          const mb = tryGit(cwd, ["merge-base", a, b])
          if (!mb) throw new Error(`no merge base between ${a} and ${b}`)
          args.push(mb, b)
        } else args.push(a, b)
      } else {
        base = opts.range
        args.push(opts.range)
      }
    } else if (base) {
      args.push(base)
      if (head) {
        args.push(head)
        headCommit = head
      }
    } else if (opts.staged) {
      base = "HEAD"
    } else {
      const branch = defaultBranch(cwd)
      if (!branch) throw new Error("no main/master branch found; pass a range (storyink diff main..HEAD) or a base")
      const mb = tryGit(cwd, ["merge-base", branch, "HEAD"])
      if (!mb) throw new Error(`no merge base between ${branch} and HEAD`)
      base = branch
      args.push(mb)
    }
    if (!head) head = opts.staged ? "index" : "working tree"
    if (opts.paths?.length) args.push("--", ...opts.paths)
    try {
      text = git(cwd, args)
    } catch (e) {
      const err = e as { stderr?: string; message: string }
      throw new Error(`git diff failed: ${(err.stderr || err.message).trim()}`)
    }
  }
  const r = parseUnifiedDiff(text)
  if (!r.ok || !r.diffset) throw new Error(r.diagnostics.map((d) => d.message).join("; ") || "could not parse the diff")
  const ds = r.diffset
  const title = headCommit && opts.patch === undefined ? tryGit(cwd, ["log", "-1", "--format=%s", headCommit]) : undefined
  return { version: 1, ...(base ? { base } : {}), ...(head ? { head } : {}), ...(title ? { title } : {}), files: ds.files, stats: ds.stats }
}

/** A DiffSet from JSON text (`storyink diff -o changes.json`) or unified diff text. */
export function diffSetFrom(text: string, name?: string): DiffSet {
  const t = text.replace(/^\uFEFF/, "")
  const isDiff = name ? /\.(diff|patch)$/i.test(name) : !t.trimStart().startsWith("{")
  if (isDiff) {
    const r = parseUnifiedDiff(t)
    if (!r.ok || !r.diffset) throw new Error(`${name ?? "diff"}: ${r.diagnostics.map((d) => d.message).join("; ")}`)
    return r.diffset
  }
  let v: unknown
  try {
    v = JSON.parse(t)
  } catch (e) {
    throw new Error(`${name ?? "changes"}: invalid JSON (${(e as Error).message})`)
  }
  return asDiffSet(v, name)
}

/** Check a DiffSet-shaped object (`version: 1`, `files[]`); fills `stats` when missing. */
export function asDiffSet(v: unknown, name = "changes"): DiffSet {
  const o = v as DiffSet
  if (!o || typeof o !== "object" || !Array.isArray(o.files)) throw new Error(`${name}: not a changes file (expected { version: 1, files: [...] } from storyink diff)`)
  if (o.version !== 1) throw new Error(`${name}: unsupported changes version ${JSON.stringify(o.version)} (expected 1)`)
  return o.stats ? o : { ...o, stats: { files: o.files.length, add: o.files.reduce((s, f) => s + (f.add ?? 0), 0), del: o.files.reduce((s, f) => s + (f.del ?? 0), 0) } }
}

/** Compact summary lines: one per file (status, +/-, path) and, optionally, hunk headers. */
export function diffSummary(ds: DiffSet, opts: { hunks?: boolean } = {}): string[] {
  const head = `${ds.base ?? "?"} → ${ds.head ?? "?"}${ds.title ? `  ${ds.title}` : ""}`
  const out = [head, `${ds.stats.files} file${ds.stats.files === 1 ? "" : "s"}, +${ds.stats.add} −${ds.stats.del}`]
  for (const f of ds.files) {
    out.push(`${f.status.padEnd(8)} +${f.add} −${f.del}  ${f.oldPath ? `${f.oldPath} → ` : ""}${f.path}${f.binary ? " (binary)" : ""}`)
    if (opts.hunks) for (const h of f.hunks) out.push(`    ${h.header}${h.section ? ` ${h.section}` : ""}`)
  }
  return out
}

/** Pretty JSON for a DiffSet with one diff line per text line (readable, ~half the size of indent 2). */
export function diffSetJson(ds: DiffSet): string {
  const rows: string[] = []
  const json = JSON.stringify(
    ds,
    (k, v) => {
      if (k === "lines" && Array.isArray(v)) return v.map((l) => (rows.push(JSON.stringify(l)), `\u0000${rows.length - 1}\u0000`))
      return v
    },
    2,
  )
  return `${json.replace(/"\\u0000(\d+)\\u0000"/g, (_, i) => rows[Number(i)])}\n`
}
