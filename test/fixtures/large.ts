/** ~25 nodes in 5 stacked tiers, ~20 story steps: the tall, many-beat shape that hung real sessions. */
export function largeSpec(direction: "TB" | "LR" = "TB") {
  const tiers = ["edge", "api", "svc", "data", "ops"]
  const groups = tiers.map((id) => ({ id, label: `${id.toUpperCase()} tier` }))
  const nodes = Array.from({ length: 25 }, (_, i) => ({
    id: `n${i}`,
    label: `Component ${i + 1}`,
    kind: ["service", "database", "queue", "cache", "function"][i % 5],
    parent: tiers[Math.floor(i / 5)],
    detail: `module ${i}`,
  }))
  const edges: { from: string; to: string }[] = []
  for (let t = 0; t < 4; t++)
    for (let j = 0; j < 5; j++) {
      edges.push({ from: `n${t * 5 + j}`, to: `n${(t + 1) * 5 + j}` })
      if (j % 2 === 0) edges.push({ from: `n${t * 5 + j}`, to: `n${(t + 1) * 5 + ((j + 1) % 5)}` })
    }
  const steps: Record<string, unknown>[] = [{ at: 0.3, reveal: ["n0", "n1", "n2", "n3", "n4"], caption: "Requests arrive at the edge" }]
  for (let k = 0; k < 19; k++) {
    const t = Math.floor(k / 5)
    const j = k % 5
    steps.push({ at: "+0.3", pulse: `n${t * 5 + j}->n${(t + 1) * 5 + j}`, ...(k % 3 === 0 ? { caption: `Tier ${t + 1} hands work to tier ${t + 2}` } : {}) })
  }
  return { type: "architecture", title: "Large system", subtitle: "Regression fixture", direction, groups, nodes, edges, story: { steps } }
}

