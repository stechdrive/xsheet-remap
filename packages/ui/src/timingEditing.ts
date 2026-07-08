import {
  clearEvent,
  createKey,
  isNullCellKeyId,
  logicalSheetDisplayDurationFrames,
  logicalSheetDisplayFrameEnd,
  logicalSheetDisplayFrameStart,
  logicalSheetOfficialFrameEnd,
  logicalSheetWorkRange,
  NULL_CELL_DISPLAY_LABEL,
  NULL_CELL_KEY_ID,
  setEvent,
  sheetTimingRoleForEvent,
  sheetTimingRoleForKey,
  timingHitForFrame,
  updateLogicalSheetSettings,
  type CutProject,
  type SheetHit,
  type SheetTemplate,
  type SheetTimingRole,
} from '@xsheet-remap/core'
import type { SheetRangeSelection, TimingClipboard } from './appTypes'
import { compareNaturalFileNameText } from './naturalSort'
import { rangeSelectionFromHits, sheetRoleForHit } from './sheetInteraction'

export type TimingPasteTarget = {
  role: 'action' | 'cell'
  paperTrack: string
  paperTracks?: string[]
  paperTrackOrder?: string[]
  frameStart: number
  frameEnd: number
  hit?: SheetHit
}

export type TimelineFrameEditScope = 'track' | 'tracks' | 'cut'
export type TimelineInsertDurationPolicy = 'preserve' | 'extend'
export type TimelineDeleteDurationPolicy = 'preserve' | 'shrink'

export type TimelineInsertFramesInput = {
  scope: TimelineFrameEditScope
  role: SheetTimingRole
  paperTrack: string
  paperTracks?: string[]
  atFrame: number
  frameCount: number
  durationPolicy: TimelineInsertDurationPolicy
}

export type TimelineDeleteFramesInput = {
  scope: TimelineFrameEditScope
  role: SheetTimingRole
  paperTrack: string
  paperTracks?: string[]
  frameStart: number
  frameCount: number
  durationPolicy: TimelineDeleteDurationPolicy
}

export function isPointEventRangeForUi(range: SheetRangeSelection | null): range is SheetRangeSelection & { role: SheetTimingRole; paperTrack: string } {
  return Boolean(range && (range.role === 'action' || range.role === 'cell') && rangePaperTracks(range).length > 0)
}

export function rangePaperTracks(range: SheetRangeSelection | null): string[] {
  if (!range) return []
  return range.paperTracks.length > 0 ? range.paperTracks : range.paperTrack ? [range.paperTrack] : []
}

export function canPasteTimingClipboardMode(
  clipboard: TimingClipboard | null,
  selectedHit: SheetHit | null,
  rangeSelection: SheetRangeSelection | null,
  mode: 'overwrite' | 'insert' | 'repeat-range' | 'repeat-to-end',
  paperTrackOrder?: string[],
): boolean {
  const baseTarget = timingPasteTarget(selectedHit, rangeSelection)
  const target = baseTarget ? { ...baseTarget, paperTrackOrder } : null
  if (!clipboard || !target || clipboard.role !== target.role) return false
  if (mode === 'repeat-range') return isPointEventRangeForUi(rangeSelection)
  if (destinationPaperTracksForClipboard(target, clipboard).length < clipboard.sourcePaperTracks.length) return false
  return true
}

export function rangeContainsHit(range: SheetRangeSelection | null, hit: SheetHit | null): boolean {
  if (!hit?.paperTrack || !isPointEventRangeForUi(range)) return false
  return range.role === sheetRoleForHit(hit)
    && rangePaperTracks(range).includes(hit.paperTrack)
    && hit.frame >= range.frameStart
    && hit.frame <= range.frameEnd
}

export function sameSheetHitCell(a: SheetHit | null, b: SheetHit | null): boolean {
  return Boolean(a?.paperTrack && b?.paperTrack
    && a.paperTrack === b.paperTrack
    && a.frame === b.frame
    && sheetRoleForHit(a) === sheetRoleForHit(b))
}

export function timingPasteTarget(
  selectedHit: SheetHit | null,
  rangeSelection: SheetRangeSelection | null,
): TimingPasteTarget | null {
  if (isPointEventRangeForUi(rangeSelection)) {
    return {
      role: rangeSelection.role,
      paperTrack: rangeSelection.paperTrack,
      paperTracks: rangePaperTracks(rangeSelection),
      frameStart: rangeSelection.frameStart,
      frameEnd: rangeSelection.frameEnd,
    }
  }
  if (selectedHit?.paperTrack && (selectedHit.role === 'action' || selectedHit.role === 'cell')) {
    return {
      role: sheetRoleForHit(selectedHit),
      paperTrack: selectedHit.paperTrack,
      paperTracks: [selectedHit.paperTrack],
      frameStart: selectedHit.frame,
      frameEnd: selectedHit.frame,
      hit: selectedHit,
    }
  }
  return null
}

export function buildTimingClipboard(project: CutProject, range: SheetRangeSelection & { role: 'action' | 'cell'; paperTrack: string }, mode: TimingClipboard['mode']): TimingClipboard {
  const sourcePaperTracks = rangePaperTracks(range)
  const eventByTrackAndFrame = new Map(project.logicalSheet.events
    .filter(event =>
      sourcePaperTracks.includes(event.paperTrack)
      && sheetTimingRoleForEvent(event) === range.role
      && event.frame >= range.frameStart
      && event.frame <= range.frameEnd,
    )
    .map(event => [`${event.paperTrack}\u0000${event.frame}`, event]))
  const keyById = new Map(project.logicalSheet.keys.map(key => [key.keyId, key]))
  const items: TimingClipboard['items'] = []
  for (let paperTrackOffset = 0; paperTrackOffset < sourcePaperTracks.length; paperTrackOffset += 1) {
    const paperTrack = sourcePaperTracks[paperTrackOffset]
    for (let frame = range.frameStart; frame <= range.frameEnd; frame += 1) {
      const event = eventByTrackAndFrame.get(`${paperTrack}\u0000${frame}`)
      if (!event) {
        items.push({ paperTrackOffset, offsetFrames: frame - range.frameStart, kind: 'empty' })
        continue
      }
      if (isNullCellKeyId(event.keyId)) {
        items.push({ paperTrackOffset, offsetFrames: frame - range.frameStart, kind: 'null', keyId: NULL_CELL_KEY_ID, displayLabel: NULL_CELL_DISPLAY_LABEL, fontSizePx: event.fontSizePx })
        continue
      }
      const key = keyById.get(event.keyId)
      items.push({
        paperTrackOffset,
        offsetFrames: frame - range.frameStart,
        kind: key ? 'key' : 'empty',
        keyId: key?.keyId,
        displayLabel: key?.displayLabel,
        fontSizePx: event.fontSizePx,
      })
    }
  }
  return {
    role: range.role,
    sourcePaperTracks,
    sourcePaperTrack: range.paperTrack,
    sourceFrameStart: range.frameStart,
    sourceFrameEnd: range.frameEnd,
    spanFrames: range.frameEnd - range.frameStart + 1,
    mode,
    items,
  }
}

export function clearTimingRange(project: CutProject, range: SheetRangeSelection & { role: 'action' | 'cell'; paperTrack: string }): CutProject {
  let next = project
  for (const paperTrack of rangePaperTracks(range)) {
    for (let frame = range.frameStart; frame <= range.frameEnd; frame += 1) {
      next = clearEvent(next, paperTrack, frame, range.role)
    }
  }
  return next
}

export function rippleDeleteTimingRange(project: CutProject, range: SheetRangeSelection & { role: 'action' | 'cell'; paperTrack: string }): CutProject {
  return deleteTimelineFrames(project, {
    scope: 'tracks',
    role: range.role,
    paperTrack: range.paperTrack,
    paperTracks: rangePaperTracks(range),
    frameStart: range.frameStart,
    frameCount: range.frameEnd - range.frameStart + 1,
    durationPolicy: 'preserve',
  })
}

export function insertTimelineFrames(project: CutProject, input: TimelineInsertFramesInput): CutProject {
  const frameCount = normalizedFrameCount(input.frameCount)
  const atFrame = Math.round(input.atFrame)
  const shifted = shiftTimelineEvents(project, input.scope, input.role, input.paperTrack, input.paperTracks, atFrame, frameCount)
  const resized = input.durationPolicy === 'extend'
    ? updateLogicalSheetSettings(shifted, { durationFrames: Math.max(1, Math.round(shifted.logicalSheet.durationFrames) + frameCount) })
    : shifted
  return ensurePostRollCoversEvents(resized)
}

export function deleteTimelineFrames(project: CutProject, input: TimelineDeleteFramesInput): CutProject {
  const frameCount = normalizedFrameCount(input.frameCount)
  const frameStart = Math.round(input.frameStart)
  const frameEnd = frameStart + frameCount - 1
  const deleted = {
    ...project,
    logicalSheet: {
      ...project.logicalSheet,
      events: project.logicalSheet.events
        .flatMap(event => {
          if (!timelineEventMatchesScope(event, input.scope, input.role, input.paperTrack, input.paperTracks)) return [event]
          if (event.frame >= frameStart && event.frame <= frameEnd) return []
          if (event.frame > frameEnd) return [{ ...event, frame: event.frame - frameCount }]
          return [event]
        })
        .sort(compareTimelineEventsForUi),
    },
  }
  const officialDeleteCount = input.durationPolicy === 'shrink'
    ? officialRangeOverlapFrames(project, frameStart, frameEnd)
    : 0
  const resized = officialDeleteCount > 0
    ? updateLogicalSheetSettings(deleted, { durationFrames: Math.max(1, Math.round(deleted.logicalSheet.durationFrames) - officialDeleteCount) })
    : deleted
  return ensurePostRollCoversEvents(resized)
}

export function pasteTimingClipboardToProject(
  project: CutProject,
  clipboard: TimingClipboard,
  target: TimingPasteTarget,
  mode: 'overwrite' | 'insert' | 'repeat-range' | 'repeat-to-end',
): CutProject {
  const displayEnd = logicalSheetDisplayFrameEnd(project.logicalSheet)
  const destinationPaperTracks = destinationPaperTracksForClipboard(target, clipboard)
  if (destinationPaperTracks.length < clipboard.sourcePaperTracks.length) return project
  const repeatEnd = mode === 'repeat-to-end'
    ? displayEnd
    : mode === 'repeat-range'
      ? target.frameEnd
      : mode === 'overwrite' && target.frameEnd > target.frameStart ? target.frameEnd : target.frameStart + clipboard.spanFrames - 1
  let next = mode === 'insert'
    ? shiftTimingTracks(project, target.role, destinationPaperTracks, target.frameStart, clipboard.spanFrames)
    : clearTimingFrames(project, target.role, destinationPaperTracks, target.frameStart, repeatEnd)
  const bases = mode === 'repeat-range' || mode === 'repeat-to-end'
    ? rangeBases(target.frameStart, repeatEnd, clipboard.spanFrames)
    : [target.frameStart]
  for (const baseFrame of bases) {
    for (const item of clipboard.items) {
      const frame = baseFrame + item.offsetFrames
      if (frame > repeatEnd) continue
      const targetPaperTrack = destinationPaperTracks[item.paperTrackOffset]
      if (!targetPaperTrack) continue
      next = setTimingClipboardItem(next, target.role, targetPaperTrack, frame, item)
    }
  }
  return ensurePostRollCoversEvents(next)
}

export function pasteResultRange(
  template: SheetTemplate,
  project: CutProject,
  target: TimingPasteTarget,
  clipboard: TimingClipboard,
  mode: 'overwrite' | 'insert' | 'repeat-range' | 'repeat-to-end',
): SheetRangeSelection | null {
  const displayEnd = logicalSheetDisplayFrameEnd(project.logicalSheet)
  const displayStart = logicalSheetDisplayFrameStart(project.logicalSheet)
  const displayDuration = logicalSheetDisplayDurationFrames(project.logicalSheet)
  const frameEnd = mode === 'repeat-to-end'
    ? displayEnd
    : mode === 'repeat-range'
      ? target.frameEnd
      : Math.min(displayEnd, target.frameStart + clipboard.spanFrames - 1)
  const destinationPaperTracks = destinationPaperTracksForClipboard(target, clipboard)
  const firstPaperTrack = destinationPaperTracks[0] ?? target.paperTrack
  const lastPaperTrack = destinationPaperTracks[Math.max(0, clipboard.sourcePaperTracks.length - 1)] ?? firstPaperTrack
  const startHit = timingHitForFrame(template, target.role, firstPaperTrack, target.frameStart, displayDuration, displayStart, target.paperTrackOrder)
  const endHit = timingHitForFrame(template, target.role, lastPaperTrack, frameEnd, displayDuration, displayStart, target.paperTrackOrder)
  return startHit && endHit ? rangeSelectionFromHits(template, startHit, endHit, destinationPaperTracks) : null
}

export function ensurePostRollCoversFrame(project: CutProject, frame: number): CutProject {
  const officialEnd = logicalSheetOfficialFrameEnd(project.logicalSheet)
  if (frame <= officialEnd) return project
  const workRange = logicalSheetWorkRange(project.logicalSheet)
  const postRollFrames = Math.max(workRange.postRollFrames, frame - officialEnd)
  if (postRollFrames === workRange.postRollFrames && workRange.showPostRoll) return project
  return updateLogicalSheetSettings(project, {
    workRange: {
      ...workRange,
      postRollFrames,
      showPostRoll: true,
    },
  })
}

function clearTimingFrames(project: CutProject, role: SheetTimingRole, paperTracks: string[], frameStart: number, frameEnd: number): CutProject {
  let next = project
  for (const paperTrack of paperTracks) {
    for (let frame = frameStart; frame <= frameEnd; frame += 1) {
      next = clearEvent(next, paperTrack, frame, role)
    }
  }
  return next
}

function shiftTimingTracks(project: CutProject, role: SheetTimingRole, paperTracks: string[], fromFrame: number, deltaFrames: number): CutProject {
  return ensurePostRollCoversEvents(shiftTimelineEvents(project, 'tracks', role, paperTracks[0] ?? '', paperTracks, fromFrame, deltaFrames))
}

function rangeBases(frameStart: number, frameEnd: number, spanFrames: number): number[] {
  const bases: number[] = []
  for (let frame = frameStart; frame <= frameEnd; frame += Math.max(1, spanFrames)) bases.push(frame)
  return bases
}

function setTimingClipboardItem(
  project: CutProject,
  targetRole: SheetTimingRole,
  targetPaperTrack: string,
  frame: number,
  item: TimingClipboard['items'][number],
): CutProject {
  if (item.kind === 'empty') return clearEvent(project, targetPaperTrack, frame, targetRole)
  if (item.kind === 'null') return setEvent(project, targetPaperTrack, frame, NULL_CELL_KEY_ID, targetRole, { fontSizePx: item.fontSizePx })
  const displayLabel = item.displayLabel?.trim()
  if (!displayLabel) return clearEvent(project, targetPaperTrack, frame, targetRole)
  const sourceKey = item.keyId ? project.logicalSheet.keys.find(key => key.keyId === item.keyId) : undefined
  const reusableSourceKey = sourceKey
    && sourceKey.paperTrack === targetPaperTrack
    && sheetTimingRoleForKey(sourceKey) === targetRole
  if (reusableSourceKey) return setEvent(project, targetPaperTrack, frame, sourceKey.keyId, targetRole, { fontSizePx: item.fontSizePx })
  const existingKey = project.logicalSheet.keys.find(key =>
    key.paperTrack === targetPaperTrack
    && sheetTimingRoleForKey(key) === targetRole
    && key.displayLabel === displayLabel,
  )
  if (existingKey) return setEvent(project, targetPaperTrack, frame, existingKey.keyId, targetRole, { fontSizePx: item.fontSizePx })
  const created = createKey(project, targetPaperTrack, displayLabel, 'manual', displayLabel, targetRole)
  return setEvent(created.project, targetPaperTrack, frame, created.key.keyId, targetRole, { fontSizePx: item.fontSizePx })
}

function ensurePostRollCoversEvents(project: CutProject): CutProject {
  const officialEnd = logicalSheetOfficialFrameEnd(project.logicalSheet)
  const maxFrame = Math.max(officialEnd, ...project.logicalSheet.events.map(event => event.frame))
  return ensurePostRollCoversFrame(project, maxFrame)
}

function normalizedFrameCount(value: number): number {
  return Math.max(1, Math.round(value))
}

function shiftTimelineEvents(
  project: CutProject,
  scope: TimelineFrameEditScope,
  role: SheetTimingRole,
  paperTrack: string,
  paperTracks: string[] | undefined,
  fromFrame: number,
  deltaFrames: number,
): CutProject {
  return {
    ...project,
    logicalSheet: {
      ...project.logicalSheet,
      events: project.logicalSheet.events
        .map(event => {
          if (!timelineEventMatchesScope(event, scope, role, paperTrack, paperTracks) || event.frame < fromFrame) return [event]
          return [{ ...event, frame: event.frame + deltaFrames }]
        })
        .flat()
        .sort(compareTimelineEventsForUi),
    },
  }
}

function timelineEventMatchesScope(
  event: { paperTrack: string; sheetRole?: SheetTimingRole },
  scope: TimelineFrameEditScope,
  role: SheetTimingRole,
  paperTrack: string,
  paperTracks?: string[],
): boolean {
  if (scope === 'cut') return true
  if (scope === 'tracks') return (paperTracks ?? [paperTrack]).includes(event.paperTrack) && sheetTimingRoleForEvent(event) === role
  return event.paperTrack === paperTrack && sheetTimingRoleForEvent(event) === role
}

function destinationPaperTracksForClipboard(target: TimingPasteTarget, clipboard: TimingClipboard): string[] {
  const width = Math.max(1, clipboard.sourcePaperTracks.length)
  const directTargets = target.paperTracks?.length ? target.paperTracks : [target.paperTrack]
  if (directTargets.length >= width) return directTargets.slice(0, width)
  const order = target.paperTrackOrder ?? []
  const startIndex = order.indexOf(target.paperTrack)
  if (startIndex >= 0) return order.slice(startIndex, startIndex + width)
  return directTargets
}

function officialRangeOverlapFrames(project: CutProject, frameStart: number, frameEnd: number): number {
  const officialStart = project.logicalSheet.frameOrigin
  const officialEnd = logicalSheetOfficialFrameEnd(project.logicalSheet)
  const overlapStart = Math.max(officialStart, frameStart)
  const overlapEnd = Math.min(officialEnd, frameEnd)
  return Math.max(0, overlapEnd - overlapStart + 1)
}

function compareTimelineEventsForUi(a: { paperTrack: string; frame: number; sheetRole?: SheetTimingRole; eventId: string }, b: { paperTrack: string; frame: number; sheetRole?: SheetTimingRole; eventId: string }): number {
  return sheetTimingRoleSortValue(sheetTimingRoleForEvent(a)) - sheetTimingRoleSortValue(sheetTimingRoleForEvent(b))
    || compareNaturalFileNameText(a.paperTrack, b.paperTrack)
    || a.frame - b.frame
    || a.eventId.localeCompare(b.eventId, 'ja')
}

function sheetTimingRoleSortValue(role: SheetTimingRole): number {
  if (role === 'action') return 0
  if (role === 'cell') return 1
  if (role === 'sound') return 2
  if (role === 'camera') return 3
  return 4
}
