import { CODE_LANGS, type CodeLang } from "../spec.ts"

/** Accepted aliases for `lang` (normalized by validation). */
export const LANG_ALIASES: Readonly<Record<string, CodeLang>> = {
  python: "py",
  golang: "go",
  rs: "rust",
  yml: "yaml",
  bash: "sh",
  shell: "sh",
  zsh: "sh",
  typescript: "ts",
  tsx: "ts",
  javascript: "js",
  jsx: "js",
}

/** Map a lang alias to its CodeLang; other values pass through unchanged (validation reports them). */
export function normalizeLang(lang: unknown): unknown {
  if (typeof lang !== "string") return lang
  const l = lang.trim().toLowerCase()
  if ((CODE_LANGS as readonly string[]).includes(l)) return l
  return LANG_ALIASES[l] ?? lang
}

const EXT: Record<string, CodeLang> = {
  ts: "ts", tsx: "ts", mts: "ts", cts: "ts",
  js: "js", jsx: "js", mjs: "js", cjs: "js",
  json: "json", jsonc: "json",
  py: "py", pyi: "py",
  go: "go",
  rs: "rust",
  sql: "sql",
  yaml: "yaml", yml: "yaml",
  sh: "sh", bash: "sh", zsh: "sh",
}

/** Guess a code language from a file path ("text" when unknown). */
export function langForPath(path: string): CodeLang {
  const base = path.split("/").pop() ?? path
  const lower = base.toLowerCase()
  if (lower === "dockerfile" || lower === "makefile") return "text"
  if (lower === ".bashrc" || lower === ".zshrc" || lower === ".profile") return "sh"
  const dot = lower.lastIndexOf(".")
  if (dot < 0) return "text"
  return EXT[lower.slice(dot + 1)] ?? "text"
}
