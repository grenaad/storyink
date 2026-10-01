import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { COMPAT_DIR, COMPAT_INPUTS, compatOutputs } from "./compat.ts"

describe("compat goldens (pre-0.4 output is byte-identical)", () => {
  for (const f of COMPAT_INPUTS)
    test(f, () => {
      for (const [k, v] of Object.entries(compatOutputs(f))) {
        const want = fs.readFileSync(path.join(COMPAT_DIR, k), "utf8")
        if (v !== want) expect(`${k}: ${v}`).toBe(`${k}: ${want}`)
      }
    })
})
