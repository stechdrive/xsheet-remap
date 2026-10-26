import type { TimelineEvent, TimingKey } from './types'
import { timingEventValueKind } from './project-shared'

export interface ActionDrawing {
  id: number
  kind: 'original' | 'inbetween' | 'fresh'
  key?: TimingKey
  firstFrame: number
}
export interface ActionDrawingOccurrence {
  source: TimelineEvent
  sourceLabel: string
  drawingId: number | null
}
export interface ActionDrawings {
  drawings: ActionDrawing[]
  occurrences: ActionDrawingOccurrence[]
  openIntervals: number[]
}

/** Drawing identity is independent of the eventual CELL number. Hollow slots
 * share only endpoints, count and position; filled ticks never share a drawing.
 */
export function collectActionDrawings(stream: TimelineEvent[], keys: ReadonlyMap<string, TimingKey>): ActionDrawings {
  const drawings: ActionDrawing[] = [], occurrences: ActionDrawingOccurrence[] = [], openIntervals: number[] = []
  const originals = new Map<string, number>(), intervals = new Map<string, Map<number, number>>()
  const create = (kind: ActionDrawing['kind'], source: TimelineEvent, key?: TimingKey) => {
    const id = drawings.length
    drawings.push({ id, kind, key, firstFrame: source.frame })
    return id
  }
  for (let index = 0; index < stream.length;) {
    const source = stream[index], kind = timingEventValueKind(source)
    if (kind === 'blank') { occurrences.push({ source, sourceLabel: '×', drawingId: null }); index++; continue }
    if (kind === 'cell') {
      const key = keys.get(source.keyId)!
      const drawingId = originals.get(source.keyId) ?? create('original', source, key)
      originals.set(source.keyId, drawingId)
      occurrences.push({ source, sourceLabel: key.displayLabel, drawingId })
      index++; continue
    }
    let end = index
    while (end < stream.length && ['inbetween', 'reverse'].includes(timingEventValueKind(stream[end]))) end++
    const left = index > 0 && timingEventValueKind(stream[index - 1]) === 'cell' ? stream[index - 1].keyId : null
    const right = end < stream.length && timingEventValueKind(stream[end]) === 'cell' ? stream[end].keyId : null
    const count = end - index, reversed = left !== null && right !== null && left > right
    const identity = JSON.stringify([reversed ? right : left, reversed ? left : right, count])
    const slots = intervals.get(identity) ?? new Map<number, number>()
    intervals.set(identity, slots)
    if (left === null || right === null) openIntervals.push(source.frame)
    for (let offset = 0; index + offset < end; offset++) {
      const source = stream[index + offset], hollow = timingEventValueKind(source) === 'inbetween'
      const position = reversed ? count - 1 - offset : offset
      const drawingId = hollow ? slots.get(position) ?? create('inbetween', source) : create('fresh', source)
      if (hollow) slots.set(position, drawingId)
      occurrences.push({ source, sourceLabel: hollow ? '○' : '●', drawingId })
    }
    index = end
  }
  return { drawings, occurrences, openIntervals }
}
