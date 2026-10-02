/** Parsed unified diffs (`storyink diff`, `--changes`). Pure data; see src/core/diff. */

export type FileStatus = "added" | "modified" | "removed" | "renamed" | "copied"

export interface DiffLine {
  kind: "context" | "add" | "del"
  /** Line text without the leading marker. */
  text: string
  /** Base-side (old) line number: context and del lines. */
  old?: number
  /** Head-side (new) line number: context and add lines. */
  new?: number
  /** `\ No newline at end of file` followed this line. */
  noNewline?: true
}

export interface Hunk {
  /** The full `@@ -a,b +c,d @@` header line (without the section text). */
  header: string
  /** Text after the closing `@@` (usually the enclosing function). */
  section?: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

export interface DiffFile {
  /** Head-side path (base-side path for removed files). */
  path: string
  /** Base-side path when renamed or copied. */
  oldPath?: string
  status: FileStatus
  binary?: true
  add: number
  del: number
  hunks: Hunk[]
  /** Code language guessed from the path (a CodeLang, or "text"). */
  lang?: string
}

export interface DiffSet {
  version: 1
  base?: string
  head?: string
  title?: string
  files: DiffFile[]
  stats: { files: number; add: number; del: number }
}
