/** Diff ingestion: parse unified diffs, select hunks by FileRef, resolve specs (`--changes`). */
export type * from "./types.ts"
export { parseUnifiedDiff, parseHunks, unquotePath, hunkHeader, type ParseDiffResult } from "./parse.ts"
export { selectHunks, statFor, findFile, toFileRef, rangeOf, sideOf, capHunks, moreMarker, isMoreMarker, type Side, type SelectOptions } from "./select.ts"
export { langForPath, normalizeLang, LANG_ALIASES } from "./lang.ts"
export { coverage, specRefs, type Coverage, type CoverageFile, type SpecRef } from "./coverage.ts"
export { resolveChanges, EMBED_MAX_LINES, type ResolveOptions, type ResolveResult } from "./resolve.ts"
export { diffRows, intraMarks, showHunkHeaders, type DiffRow, type DiffRowsOptions } from "./rows.ts"
