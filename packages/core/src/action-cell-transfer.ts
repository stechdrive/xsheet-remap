import type { CutProject, TimelineEvent, TimingKey, TimingReferenceMark } from './types'
import { keyInActiveProcess } from './process-timing'
import { sheetTimingRoleForEvent, sheetTimingRoleForKey, timingEventValueKind } from './project-shared'
import { timingReferenceAddress, timingReferenceMap } from './timing-reference'

export interface ActionCellTransferEvent {
  source: TimelineEvent
  sourceLabel: string
  number: number | null
  enclosure?: 'triangle' | 'circle'
}
export interface ActionCellTransferColumn {
  paperTrack: string
  status: 'ready' | 'empty' | 'occupied' | 'bound' | 'invalid'
  reason?: string
  events: ActionCellTransferEvent[]
  drawingCount: number
  openIntervals: number[]
}
export interface ActionCellTransferPlan {
  /** An immutable preview applies only to the project it was computed from. */
  source: CutProject
  columns: ActionCellTransferColumn[]
}

/** Toei-style numbering, local to each column of the current cut and process.
 * Holds never allocate. A filled tick always allocates and never replaces the
 * reusable hollow-tick slot. Enclosures belong to occurrences, not identities.
 */
export function buildActionCellTransferPlan(project: CutProject, tracks = project.logicalSheet.paperTracks.map(track => track.paperTrack)): ActionCellTransferPlan {
  const keys = new Map(project.logicalSheet.keys.map(key => [key.keyId, key]))
  const references = timingReferenceMap(project.logicalSheet.referenceMarks)
  const bound = new Set(project.bindings.map(binding => binding.keyId))
  const columns = [...new Set(tracks)].map((paperTrack): ActionCellTransferColumn => {
    const column: ActionCellTransferColumn = { paperTrack, status: 'empty', events: [], drawingCount: 0, openIntervals: [] }
    const stream = project.logicalSheet.events.filter(event => event.paperTrack === paperTrack && sheetTimingRoleForEvent(event) === 'action').sort((a, b) => a.frame - b.frame)
    if (!stream.length) return column
    if (!project.logicalSheet.paperTracks.some(track => track.paperTrack === paperTrack)
      || stream.some((event, index) => !Number.isSafeInteger(event.frame) || index > 0 && event.frame === stream[index - 1].frame
        || timingEventValueKind(event) === 'cell' && (!keys.has(event.keyId) || !keyInActiveProcess(project, keys.get(event.keyId)!)
          || keys.get(event.keyId)!.paperTrack !== paperTrack || sheetTimingRoleForKey(keys.get(event.keyId)!) !== 'action'))) {
      return { ...column, status: 'invalid', reason: 'ACTIONのセル対応またはコマ位置が不正です。' }
    }
    if (project.logicalSheet.keys.some(key => key.paperTrack === paperTrack && sheetTimingRoleForKey(key) === 'cell' && keyInActiveProcess(project, key) && bound.has(key.keyId))) {
      return { ...column, status: 'bound', reason: 'CELLに素材の登録があります。' }
    }
    if (project.logicalSheet.events.some(event => event.paperTrack === paperTrack && sheetTimingRoleForEvent(event) === 'cell')
      || project.logicalSheet.referenceMarks?.some(mark => mark.paperTrack === paperTrack && mark.sheetRole === 'cell')) {
      return { ...column, status: 'occupied', reason: 'CELLに記入があります。' }
    }
    column.status = 'ready'
    const originals = new Map<string, number>(), intervals = new Map<string, Map<number, number>>()
    const allocate = () => ++column.drawingCount
    for (let index = 0; index < stream.length;) {
      const event = stream[index], kind = timingEventValueKind(event)
      if (kind === 'blank') { column.events.push({ source: event, sourceLabel: '×', number: null }); index++; continue }
      if (kind === 'cell') {
        let number = originals.get(event.keyId)
        if (number === undefined) { number = allocate(); originals.set(event.keyId, number) }
        column.events.push({ source: event, sourceLabel: keys.get(event.keyId)!.displayLabel, number, enclosure: references.get(timingReferenceAddress(event)) })
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
      if (left === null || right === null) column.openIntervals.push(event.frame)
      for (let offset = 0; index + offset < end; offset++) {
        const source = stream[index + offset], hollow = timingEventValueKind(source) === 'inbetween'
        const position = reversed ? count - 1 - offset : offset
        const number = hollow ? slots.get(position) ?? allocate() : allocate()
        if (hollow) slots.set(position, number)
        column.events.push({ source, sourceLabel: hollow ? '○' : '●', number })
      }
      index = end
    }
    return column
  })
  return { source: project, columns }
}

/** No registration, image/name matching, or mutation of ACTION/other processes. */
export function applyActionCellTransferPlan(project: CutProject, plan: ActionCellTransferPlan): CutProject {
  if (plan.source !== project) throw new Error('シートが変更されました。転記のプレビューを開き直してください。')
  const columns = plan.columns.filter(column => column.status === 'ready')
  if (!columns.length) return project
  const keys: TimingKey[] = [...project.logicalSheet.keys], events = [...project.logicalSheet.events]
  const marks: TimingReferenceMark[] = [...project.logicalSheet.referenceMarks ?? []]
  const nextKeyId = idAllocator('cell_key', keys.map(key => key.keyId)), nextEventId = idAllocator('cell_event', events.map(event => event.eventId))
  for (const column of columns) {
    const numbered = new Map<number, string>()
    for (const item of column.events) {
      let keyId = item.source.keyId
      if (item.number !== null) {
        keyId = numbered.get(item.number) ?? ''
        if (!keyId) {
          keyId = nextKeyId(); numbered.set(item.number, keyId)
          keys.push({ keyId, paperTrack: column.paperTrack, sheetRole: 'cell', displayLabel: String(item.number), createdFrom: 'manual', requiresExplicitBinding: true,
            ...(project.logicalSheet.processTimings ? { processId: project.logicalSheet.processTimings.activeProcessId } : {}) })
        }
      }
      const eventId = nextEventId()
      events.push({ eventId, paperTrack: column.paperTrack, sheetRole: 'cell', frame: item.source.frame, keyId,
        valueKind: item.number === null ? 'blank' : 'cell', fontSizePx: item.source.fontSizePx, source: 'manual' })
      if (item.enclosure) marks.push({ paperTrack: column.paperTrack, sheetRole: 'cell', frame: item.source.frame,
        ...(item.enclosure === 'circle' ? { shape: 'circle' } : {}) })
    }
    const occupied = new Set(column.events.map(item => item.source.frame))
    for (const mark of project.logicalSheet.referenceMarks ?? []) if (mark.sheetRole === 'action' && mark.paperTrack === column.paperTrack && !occupied.has(mark.frame)) marks.push({ ...mark, sheetRole: 'cell' })
  }
  return { ...project, logicalSheet: { ...project.logicalSheet, keys, events, referenceMarks: marks } }
}

function idAllocator(prefix: string, ids: string[]): () => string {
  const used = new Set(ids)
  let index = ids.length
  return () => {
    let id: string
    do { id = `${prefix}_${String(++index).padStart(4, '0')}` } while (used.has(id))
    used.add(id)
    return id
  }
}
