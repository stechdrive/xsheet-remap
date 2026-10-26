import type { ActionDrawings } from './action-cell-drawings'

/** Compare arbitrarily large positive integer labels without floating-point
 * rounding. Normalization is only for ordering: distinct source keys stay distinct.
 */
function naturalNumber(label: string): string | undefined {
  const digits = label.trim().replace(/[０-９]/g, digit => String(digit.charCodeAt(0) - 0xff10))
  if (!/^\d+$/.test(digits)) return undefined
  return digits.replace(/^0+/, '') || undefined
}
const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

/** Choose a uniquely determined path, preferring reusable drawings over fresh
 * alternatives. Complementary hollow slots may establish a path even when every
 * occurrence contains a fresh tick. Competing lengths/positions are not guessed.
 */
function uniquePath(paths: number[][], fresh: Set<number>): number[] | undefined {
  const reusable = paths.filter(path => path.every(id => !fresh.has(id)))
  const candidates = reusable.length ? reusable : paths
  const length = candidates[0].length
  if (candidates.some(path => path.length !== length)) return undefined
  const result: number[] = []
  for (let position = 0; position < length; position++) {
    const choices = new Set(candidates.map(path => path[position]))
    const reusableChoices = [...choices].filter(id => !fresh.has(id))
    const preferred = reusableChoices.length ? reusableChoices : [...choices]
    if (preferred.length !== 1) return undefined
    result.push(preferred[0])
  }
  return new Set(result).size === result.length ? result : undefined
}

export function numberActionDrawings({ drawings, occurrences }: ActionDrawings) {
  const anchors = drawings.flatMap(drawing => {
    const value = drawing.key ? naturalNumber(drawing.key.displayLabel) : undefined
    return value ? [{ drawing, value }] : []
  }).sort((a, b) => a.value.length - b.value.length || compareText(a.value, b.value)
    || compareText(a.drawing.key!.displayLabel, b.drawing.key!.displayLabel) || a.drawing.id - b.drawing.id)
  const numbers = new Map<number, number>()
  const append = (id: number) => { if (!numbers.has(id)) numbers.set(id, numbers.size + 1) }
  const additionalFrames: number[] = [], duplicateNumberFrames: number[] = []
  if (!anchors.length) {
    drawings.forEach(drawing => append(drawing.id))
    return { numbers, additionalFrames, duplicateNumberFrames, usesNumericOrder: false }
  }
  const ranks = new Map(anchors.map((anchor, index) => [anchor.drawing.id, index]))
  const duplicates = new Set<number>()
  for (let index = 1; index < anchors.length; index++) if (anchors[index].value === anchors[index - 1].value) {
    duplicates.add(anchors[index - 1].drawing.id); duplicates.add(anchors[index].drawing.id)
  }
  for (const id of duplicates) duplicateNumberFrames.push(drawings[id].firstFrame)

  // Each span lies between consecutive numeric occurrences. A blank breaks the
  // relationship. Playback direction is normalized to increasing anchor order.
  const paths = new Map<number, number[][]>()
  const positions = new Map<number, Set<number>>()
  let start: number | undefined
  for (let end = 0; end < occurrences.length; end++) {
    const id = occurrences[end].drawingId
    if (id === null) { start = undefined; continue }
    const rank = ranks.get(id)
    if (rank === undefined) continue
    if (start !== undefined && end > start + 1) {
      const leftId = occurrences[start].drawingId!, leftRank = ranks.get(leftId)!
      if (Math.abs(leftRank - rank) === 1 && !duplicates.has(leftId) && !duplicates.has(id)) {
        const lower = Math.min(leftRank, rank)
        const path = occurrences.slice(start + 1, end).map(item => item.drawingId!)
          .filter((id, index, ids) => index === 0 || id !== ids[index - 1])
        if (leftRank > rank) path.reverse()
        const alternatives = paths.get(lower) ?? []
        alternatives.push(path); paths.set(lower, alternatives)
        for (const drawingId of path) {
          const owners = positions.get(drawingId) ?? new Set<number>()
          owners.add(lower); positions.set(drawingId, owners)
        }
      }
    }
    start = end
  }
  const fresh = new Set(drawings.filter(drawing => drawing.kind === 'fresh').map(drawing => drawing.id))
  for (const [index, anchor] of anchors.entries()) {
    append(anchor.drawing.id)
    const alternatives = paths.get(index)
    if (!alternatives) continue
    const path = uniquePath(alternatives, fresh)
    // A named drawing cannot occupy two different numeric gaps. Reject the
    // whole inferred path instead of silently moving/duplicating that drawing.
    if (path && path.every(id => positions.get(id)!.size === 1)) path.forEach(append)
  }
  // Unanchored/ambiguous drawings remain distinct. First appearance is only a
  // tie-break for this remainder, never the order of the numeric originals.
  for (const drawing of drawings) if (!numbers.has(drawing.id)) {
    additionalFrames.push(drawing.firstFrame)
    append(drawing.id)
  }
  return { numbers, additionalFrames, duplicateNumberFrames: duplicateNumberFrames.sort((a, b) => a - b), usesNumericOrder: true }
}
