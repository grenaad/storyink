/** Pages (`type: "page"`): explainer documents with embedded storyink figures. Browser-safe. */
export * from "./types.ts"
export { validatePage, type PageValidationResult } from "./validate.ts"
export { renderPageHtml, layoutPage, pageFigures, type PageHtmlOptions } from "./render.tsx"
export { resolvePageChanges, type PageResolveOptions } from "./resolve.ts"
export { Prose, Inline, safeHref } from "./prose.tsx"
