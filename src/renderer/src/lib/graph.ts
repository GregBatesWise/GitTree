import type { CommitInfo } from '@shared/types'

export const LANE_COLORS = [
  '#e06c75',
  '#61afef',
  '#98c379',
  '#c678dd',
  '#e5c07b',
  '#56b6c2',
  '#d19a66',
  '#be5046',
  '#528bff',
  '#7f848e'
]

export interface GraphRow {
  /** Column index of the commit node. */
  col: number
  /** Palette index of the node's lane. */
  color: number
  /** Total number of lanes occupied around this row. */
  maxLane: number
  /** Top-half segments entering the node (merging children). */
  entries: { col: number; color: number }[]
  /** Bottom-half segments leaving the node toward its parents. */
  exits: { col: number; color: number }[]
  /** Full-height lines that pass straight through this row. */
  throughs: { col: number; color: number }[]
}

type Lane = { hash: string; color: number } | null

/**
 * Assigns lanes to a topologically ordered list of commits and produces the
 * drawing instructions for an SVG railroad graph (SourceTree-style).
 */
export function buildGraph(commits: Pick<CommitInfo, 'hash' | 'parents'>[]): GraphRow[] {
  const lanes: Lane[] = []
  let colorSeq = 0
  const nextColor = (): number => colorSeq++ % LANE_COLORS.length
  const firstFree = (): number => {
    const i = lanes.findIndex((l) => l === null)
    return i >= 0 ? i : lanes.length
  }

  const rows: GraphRow[] = []

  for (const c of commits) {
    const incoming = lanes.map((l) => (l ? l.color : null))
    const myLanes: number[] = []
    lanes.forEach((l, i) => {
      if (l && l.hash === c.hash) myLanes.push(i)
    })

    let col: number
    let color: number
    if (myLanes.length) {
      col = myLanes[0]
      color = (lanes[col] as { hash: string; color: number }).color
    } else {
      col = firstFree()
      color = nextColor()
      lanes[col] = { hash: c.hash, color }
    }
    while (incoming.length <= col) incoming.push(null)

    // Children merging into this commit (top-half segments).
    const entries = myLanes.map((i) => ({ col: i, color: incoming[i] ?? color }))

    // Free the merged lanes (all but the chosen node column).
    for (const i of myLanes) if (i !== col) lanes[i] = null

    // Route to parents (bottom-half segments).
    const exits: { col: number; color: number }[] = []
    if (c.parents.length === 0) {
      lanes[col] = null
    } else {
      lanes[col] = { hash: c.parents[0], color }
      exits.push({ col, color })
      for (let k = 1; k < c.parents.length; k++) {
        let pl = lanes.findIndex((l) => l && l.hash === c.parents[k])
        if (pl < 0) {
          pl = firstFree()
          lanes[pl] = { hash: c.parents[k], color: nextColor() }
        }
        exits.push({ col: pl, color: (lanes[pl] as { color: number }).color })
      }
    }

    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop()
    const outgoing = lanes.map((l) => (l ? l.color : null))

    const throughs: { col: number; color: number }[] = []
    const width = Math.max(incoming.length, outgoing.length)
    for (let i = 0; i < width; i++) {
      if (i === col) continue
      if (incoming[i] != null && outgoing[i] != null && !myLanes.includes(i)) {
        throughs.push({ col: i, color: incoming[i] as number })
      }
    }

    const maxLane = Math.max(width, col + 1)
    rows.push({ col, color, maxLane, entries, exits, throughs })
  }

  return rows
}
