import { projectTimingHitForFrame } from './sheet-layers-hit-geometry'
import {
  applyCutTimelineFrameEdit,
  clearEvent,
  mapTimingReferenceFrames,
  setTimingReferenceRange,
  timingReferenceAddress,
  logicalSheetDisplayFrameEnd,
  logicalSheetDisplayFrameStart,
  logicalSheetOfficialFrameEnd,
  logicalSheetWorkRange,
  sheetTimingRoleForEvent,
  timingEventValueKind,
  updateLogicalSheetSettings,
  type CutProject,
  type SheetHit,
  type SheetTemplate,
  type SheetTimingRole,
} from '@xsheet-remap/core'
import type { SheetRangeSelection, TimingClipboard, TimingPasteContent, TimingPasteMode } from './appTypes'
import { createTimingClipboardWriter, timingClipboardBindingSnapshots } from './timingClipboardContent'
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

export type TimingRangeMoveResult = {
  project: CutProject
  status: 'moved' | 'same-target' | 'invalid-target' | 'empty-source'
  collisionCount: number
  destinationPaperTracks: string[]
  destinationFrameStart: number
  destinationFrameEnd: number
}

export type TimingRangeMoveSource = {
  range: SheetRangeSelection & { role: SheetTimingRole; paperTrack: string }
  sourceHit: SheetHit
  paperTrackOrder: string[]
  clipboard: TimingClipboard
  items: TimingClipboard['items']
  occupiedDestinations: ReadonlySet<string>
  displayFrameStart: number
  displayFrameEnd: number
}

export type TimingRangeMovePlan = {
  status: TimingRangeMoveResult['status']
  reason?: 'outside-sheet' | 'different-role' | 'outside-tracks' | 'outside-frames' | 'empty-source'
  // An empty track retains its offset when part of the proposed range is outside the sheet.
  destinationPaperTracks: string[]
  destinationFrameStart: number
  destinationFrameEnd: number
  frameDelta: number
  trackDelta: number
  collisionCells: Array<{ paperTrack: string; frame: number }>
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
  mode: TimingPasteMode,
  paperTrackOrder?: string[],
): boolean {
  const baseTarget = timingPasteTarget(selectedHit, rangeSelection)
  const target = baseTarget ? { ...baseTarget, paperTrackOrder } : null
  if (!clipboard || !target) return false
  if (mode === 'repeat-range' && !isPointEventRangeForUi(rangeSelection)) return false
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
      hit: rangeSelection.anchorHit,
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
  const slotById = new Map(project.cspTrackSlots.map(slot => [slot.slotId, slot]))
  const references = new Set(project.logicalSheet.referenceMarks?.map(timingReferenceAddress))
  const items: TimingClipboard['items'] = []
  for (let paperTrackOffset = 0; paperTrackOffset < sourcePaperTracks.length; paperTrackOffset += 1) {
    const paperTrack = sourcePaperTracks[paperTrackOffset]
    for (let frame = range.frameStart; frame <= range.frameEnd; frame += 1) {
      const event = eventByTrackAndFrame.get(`${paperTrack}\u0000${frame}`)
      const reference = references.has(timingReferenceAddress({ paperTrack, frame, sheetRole: range.role })) || undefined
      if (!event) {
        items.push({ paperTrackOffset, offsetFrames: frame - range.frameStart, kind: 'empty', reference })
        continue
      }
      const eventKind = timingEventValueKind(event)
      if (eventKind !== 'cell') {
        items.push({ paperTrackOffset, offsetFrames: frame - range.frameStart, kind: eventKind, fontSizePx: event.fontSizePx, source: event.source })
        continue
      }
      const key = keyById.get(event.keyId)
      items.push({
        paperTrackOffset,
        offsetFrames: frame - range.frameStart,
        kind: key ? 'key' : 'empty',
        reference,
        keyId: key?.keyId,
        displayLabel: key?.displayLabel,
        paperToken: key?.paperToken,
        createdFrom: key?.createdFrom,
        bindings: key ? timingClipboardBindingSnapshots(project, key.keyId, slotById) : undefined,
        fontSizePx: event.fontSizePx,
        source: event.source,
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

// Snapshot the source and occupied cells once per drag. Pointer updates only plan
// addresses; they never clear/write events or create a project/history entry.
export function prepareTimingRangeMove(
  project: CutProject,
  range: SheetRangeSelection,
  sourceHit: SheetHit,
  paperTrackOrder: string[],
): TimingRangeMoveSource | null {
  if (!isPointEventRangeForUi(range) || !rangeContainsHit(range, sourceHit)) return null
  const sourcePaperTracks = rangePaperTracks(range)
  if (sourcePaperTracks.some(track => !paperTrackOrder.includes(track))) return null
  const clipboard = buildTimingClipboard(project, range, 'cut')
  const occupiedDestinations = new Set([...project.logicalSheet.events, ...(project.logicalSheet.referenceMarks ?? [])]
    .filter(event => sheetTimingRoleForEvent(event) === range.role
      && !(sourcePaperTracks.includes(event.paperTrack) && event.frame >= range.frameStart && event.frame <= range.frameEnd))
    .map(event => timingCellSignature(event.paperTrack, event.frame)))
  return {
    range, sourceHit, paperTrackOrder, clipboard,
    items: clipboard.items.filter(item => item.kind !== 'empty' || item.reference),
    occupiedDestinations,
    displayFrameStart: logicalSheetDisplayFrameStart(project.logicalSheet),
    displayFrameEnd: logicalSheetDisplayFrameEnd(project.logicalSheet),
  }
}

export function planTimingRangeMove(source: TimingRangeMoveSource, targetHit: SheetHit | null): TimingRangeMovePlan {
  const { range, sourceHit, paperTrackOrder } = source
  const plan: TimingRangeMovePlan = {
    status: 'invalid-target',
    destinationPaperTracks: [],
    destinationFrameStart: range.frameStart,
    destinationFrameEnd: range.frameEnd,
    frameDelta: 0,
    trackDelta: 0,
    collisionCells: [],
  }
  if (!targetHit) return { ...plan, reason: 'outside-sheet' }
  if (targetHit.role !== range.role) return { ...plan, reason: 'different-role' }
  if (!targetHit.paperTrack) return { ...plan, reason: 'outside-tracks' }
  const sourceTrackIndex = paperTrackOrder.indexOf(sourceHit.paperTrack!)
  const targetTrackIndex = paperTrackOrder.indexOf(targetHit.paperTrack)
  if (targetTrackIndex < 0) return { ...plan, reason: 'outside-tracks' }
  const trackDelta = targetTrackIndex - sourceTrackIndex
  const frameDelta = targetHit.frame - sourceHit.frame
  plan.trackDelta = trackDelta
  plan.frameDelta = frameDelta
  plan.destinationPaperTracks = rangePaperTracks(range).map(track => paperTrackOrder[paperTrackOrder.indexOf(track) + trackDelta] ?? '')
  plan.destinationFrameStart += frameDelta
  plan.destinationFrameEnd += frameDelta
  if (plan.destinationPaperTracks.some(track => !track)) return { ...plan, reason: 'outside-tracks' }
  if (plan.destinationFrameStart < source.displayFrameStart || plan.destinationFrameEnd > source.displayFrameEnd) {
    return { ...plan, reason: 'outside-frames' }
  }
  if (frameDelta === 0 && trackDelta === 0) {
    return { ...plan, status: 'same-target' }
  }
  if (source.items.length === 0) return { ...plan, status: 'empty-source', reason: 'empty-source' }
  for (const item of source.items) {
    const paperTrack = plan.destinationPaperTracks[item.paperTrackOffset]
    const frame = plan.destinationFrameStart + item.offsetFrames
    if (source.occupiedDestinations.has(timingCellSignature(paperTrack, frame))) plan.collisionCells.push({ paperTrack, frame })
  }
  return { ...plan, status: 'moved' }
}

export function moveTimingEventsInRange(
  project: CutProject,
  range: SheetRangeSelection,
  sourceHit: SheetHit,
  targetHit: SheetHit,
  paperTrackOrder: string[],
): TimingRangeMoveResult {
  const source = prepareTimingRangeMove(project, range, sourceHit, paperTrackOrder)
  const plan = source && planTimingRangeMove(source, targetHit)
  if (!source || !plan || plan.status === 'invalid-target') return {
    project, status: 'invalid-target', collisionCount: 0, destinationPaperTracks: [],
    destinationFrameStart: range.frameStart, destinationFrameEnd: range.frameEnd,
  }
  const result: TimingRangeMoveResult = {
    project, status: plan.status, collisionCount: plan.collisionCells.length,
    destinationPaperTracks: plan.destinationPaperTracks,
    destinationFrameStart: plan.destinationFrameStart, destinationFrameEnd: plan.destinationFrameEnd,
  }
  if (plan.status !== 'moved') return result
  let next = clearTimingRange(project, source.range)
  const writeItem = createTimingClipboardWriter(source.clipboard, source.range.role, 'auto')
  for (const item of source.items) {
    next = writeItem(next, plan.destinationPaperTracks[item.paperTrackOffset], plan.destinationFrameStart + item.offsetFrames, item)
  }
  return { ...result, project: next }
}

export function timingRangeSelectionForMoveResult(
  template: SheetTemplate,
  project: CutProject,
  role: 'action' | 'cell',
  result: TimingRangeMoveResult,
  paperTrackOrder: string[],
): SheetRangeSelection | null {
  if (result.status !== 'moved') return null
  const firstPaperTrack = result.destinationPaperTracks[0]
  const lastPaperTrack = result.destinationPaperTracks.at(-1)
  if (!firstPaperTrack || !lastPaperTrack) return null
  const startHit = projectTimingHitForFrame(template, project, role, firstPaperTrack, result.destinationFrameStart)
  const endHit = projectTimingHitForFrame(template, project, role, lastPaperTrack, result.destinationFrameEnd)
  return startHit && endHit ? rangeSelectionFromHits(template, startHit, endHit, paperTrackOrder) : null
}

export function clearTimingRange(project: CutProject, range: SheetRangeSelection & { role: 'action' | 'cell'; paperTrack: string }): CutProject {
  let next = setTimingReferenceRange(project, { ...range, paperTracks: rangePaperTracks(range) }, false)
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
  if (input.scope === 'cut') return applyCutTimelineFrameEdit(project, { kind: 'insert', atFrame, frameCount })
  const shifted = shiftTimelineEvents(project, input.scope, input.role, input.paperTrack, input.paperTracks, atFrame, frameCount)
  const resized = input.durationPolicy === 'extend'
    ? updateLogicalSheetSettings(shifted, { durationFrames: Math.max(1, Math.round(shifted.logicalSheet.durationFrames) + frameCount) })
    : shifted
  return ensurePostRollCoversEvents(resized)
}

export function deleteTimelineFrames(project: CutProject, input: TimelineDeleteFramesInput): CutProject {
  const frameCount = normalizedFrameCount(input.frameCount)
  const frameStart = Math.round(input.frameStart)
  if (input.scope === 'cut') return applyCutTimelineFrameEdit(project, { kind: 'delete', frameStart, frameCount })
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
      referenceMarks: mapTimingReferenceFrames(project.logicalSheet.referenceMarks, mark => {
        if (!timelineEventMatchesScope(mark, input.scope, input.role, input.paperTrack, input.paperTracks)) return mark.frame
        return mark.frame < frameStart ? mark.frame : mark.frame <= frameEnd ? null : mark.frame - frameCount
      }),
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
  mode: TimingPasteMode,
  content: TimingPasteContent = 'auto',
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
  const writeItem = createTimingClipboardWriter(clipboard, target.role, content)
  for (const baseFrame of bases) {
    for (const item of clipboard.items) {
      const frame = baseFrame + item.offsetFrames
      if (frame > repeatEnd) continue
      const targetPaperTrack = destinationPaperTracks[item.paperTrackOffset]
      if (!targetPaperTrack) continue
      next = writeItem(next, targetPaperTrack, frame, item)
    }
  }
  return ensurePostRollCoversEvents(next)
}

export function pasteResultRange(
  template: SheetTemplate,
  project: CutProject,
  target: TimingPasteTarget,
  clipboard: TimingClipboard,
  mode: TimingPasteMode,
): SheetRangeSelection | null {
  const displayEnd = logicalSheetDisplayFrameEnd(project.logicalSheet)
  const frameEnd = mode === 'repeat-to-end'
    ? displayEnd
    : mode === 'repeat-range'
      ? target.frameEnd
      : Math.min(displayEnd, target.frameStart + clipboard.spanFrames - 1)
  const destinationPaperTracks = destinationPaperTracksForClipboard(target, clipboard)
  const firstPaperTrack = destinationPaperTracks[0] ?? target.paperTrack
  const lastPaperTrack = destinationPaperTracks[Math.max(0, clipboard.sourcePaperTracks.length - 1)] ?? firstPaperTrack
  const startHit = projectTimingHitForFrame(template, project, target.role, firstPaperTrack, target.frameStart)
  const endHit = projectTimingHitForFrame(template, project, target.role, lastPaperTrack, frameEnd)
  return startHit && endHit ? rangeSelectionFromHits(template, startHit, endHit, destinationPaperTracks) : null
}

export function ensurePostRollCoversFrame(project: CutProject, frame: number): CutProject {
  const officialEnd = logicalSheetOfficialFrameEnd(project.logicalSheet)
  if (frame <= officialEnd) return project
  const workRange = logicalSheetWorkRange(project.logicalSheet)
  const postRollFrames = Math.max(workRange.postRollFrames, frame - officialEnd)
  if (postRollFrames === workRange.postRollFrames) return project
  return updateLogicalSheetSettings(project, {
    workRange: {
      ...workRange,
      postRollFrames,
      showPostRoll: true,
    },
  })
}

function clearTimingFrames(project: CutProject, role: SheetTimingRole, paperTracks: string[], frameStart: number, frameEnd: number): CutProject {
  let next = setTimingReferenceRange(project, { role, paperTracks, frameStart, frameEnd }, false)
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

function timingCellSignature(paperTrack: string, frame: number): string {
  return `${paperTrack}\u0000${frame}`
}

function ensurePostRollCoversEvents(project: CutProject): CutProject {
  const officialEnd = logicalSheetOfficialFrameEnd(project.logicalSheet)
  const maxFrame = Math.max(officialEnd, ...project.logicalSheet.events.map(event => event.frame), ...(project.logicalSheet.referenceMarks ?? []).map(mark => mark.frame))
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
      referenceMarks: mapTimingReferenceFrames(project.logicalSheet.referenceMarks, mark =>
        timelineEventMatchesScope(mark, scope, role, paperTrack, paperTracks) && mark.frame >= fromFrame ? mark.frame + deltaFrames : mark.frame),
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
