import type { CutProject, TimelineEvent, TimingKey, TimingReferenceMark } from './types'
import { keyInActiveProcess } from './process-timing'
import { sheetTimingRoleForEvent, sheetTimingRoleForKey, timingEventValueKind } from './project-shared'
import { timingReferenceAddress, timingReferenceMap } from './timing-reference'
import { collectActionDrawings } from './action-cell-drawings'
import { numberActionDrawings } from './action-cell-numbering'

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
  additionalFrames: number[]
  duplicateNumberFrames: number[]
  usesNumericOrder: boolean
}
export interface ActionCellTransferPlan {
  /** An immutable preview applies only to the project it was computed from. */
  source: CutProject
  columns: ActionCellTransferColumn[]
}

/** Preserve Toei-style drawing reuse, then number numeric originals in ascending
 * order with unambiguous intervening drawings. Enclosures belong to occurrences.
 */
export function buildActionCellTransferPlan(project: CutProject, tracks = project.logicalSheet.paperTracks.map(track => track.paperTrack)): ActionCellTransferPlan {
  const keys = new Map(project.logicalSheet.keys.map(key => [key.keyId, key]))
  const references = timingReferenceMap(project.logicalSheet.referenceMarks)
  const bound = new Set(project.bindings.map(binding => binding.keyId))
  const columns = [...new Set(tracks)].map((paperTrack): ActionCellTransferColumn => {
    const column: ActionCellTransferColumn = { paperTrack, status: 'empty', events: [], drawingCount: 0, openIntervals: [],
      additionalFrames: [], duplicateNumberFrames: [], usesNumericOrder: false }
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
    const drawings = collectActionDrawings(stream, keys)
    const { numbers, ...notes } = numberActionDrawings(drawings)
    return { ...column, ...notes, status: 'ready', drawingCount: numbers.size, openIntervals: drawings.openIntervals,
      events: drawings.occurrences.map(({ source, sourceLabel, drawingId }) => ({ source, sourceLabel,
        number: drawingId === null ? null : numbers.get(drawingId)!,
        ...(timingEventValueKind(source) === 'cell' ? { enclosure: references.get(timingReferenceAddress(source)) } : {}),
      })) }
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
