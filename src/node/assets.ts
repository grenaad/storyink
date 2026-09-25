import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/** Package root: walk up from this module (works from src/ and from bundled dist/). */
export function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 6; i++) {
    const pkg = path.join(dir, "package.json")
    if (fs.existsSync(pkg)) {
      try {
        if (JSON.parse(fs.readFileSync(pkg, "utf8")).name === "storyink") return dir
      } catch {}
    }
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error("storyink package root not found")
}

export const skillPath = (): string => path.join(packageRoot(), "skill", "SKILL.md")
export const schemaPath = (): string => path.join(packageRoot(), "schema", "storyink.schema.json")
export const readSkill = (): string => fs.readFileSync(skillPath(), "utf8")
