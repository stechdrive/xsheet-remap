import {
  createSheetPages,
  getSheetViewLayout,
  isTimelineProjectingSheetTemplateGridRegion,
  logicalSheetDisplayDurationFrames,
  logicalSheetDisplayFrameStart,
  nextTimelineMemoId,
  projectSheetLayoutOptions,
  resolveSheetTemplateGridLayout,
  resolveSheetTemplateRegionCapabilities,
  type CutProject,
  type SheetHit,
  type SheetTemplate,
  type TimedRangeCue,
  type TimelineInkMemo,
  type TimelineMemoRole,
  timelineMemos,
} from '@xsheet-remap/core'
import type { SheetRangeSelection } from './appTypes'
import { timedRangeLaneIdForHit } from './timedRangeCueEditing'
import { timelineMemoAnchorCellForPage, timelineMemoSegmentsForPage } from './timelineMemoGeometry'

const MEMO_ROLES = new Set<TimelineMemoRole>(['action', 'cell', 'sound', 'camera'])

export function timelineMemoIdsFromElement(target: Element | null): string[] | undefined {
  const anchor = target?.closest<HTMLElement>('[data-timeline-memo-ids]')
  const anchorIds = (anchor?.dataset.timelineMemoIds ?? '').split(/\s+/).filter(Boolean)
  if (anchorIds.length > 0) return anchorIds
  const memoId = target?.closest<HTMLElement>('[data-timeline-memo-id]')?.dataset.timelineMemoId
  return memoId ? [memoId] : undefined
}

export function timedRangeCueForMemoContext(
  project: CutProject,
  template: SheetTemplate,
  hit: SheetHit | null,
  memoIds: readonly string[] | undefined,
): TimedRangeCue | undefined {
  if (!memoIds?.length || !hit || (hit.role !== 'sound' && hit.role !== 'camera')) return undefined
  const laneId = timedRangeLaneIdForHit(template, hit.role, hit)
  return laneId
    ? project.timedRangeCues.find(cue => cue.role === hit.role && cue.laneId === laneId && cue.frameStart <= hit.frame && cue.frameEnd >= hit.frame)
    : undefined
}

export function resolveTimelineMemoContextTargets(
  target: Element | null,
  project: CutProject,
  template: SheetTemplate,
  hit: SheetHit | null,
) {
  const timelineMemoIds = timelineMemoIdsFromElement(target)
  const coveredTimedCue = timedRangeCueForMemoContext(project, template, hit, timelineMemoIds)
  return {
    timelineMemoIds,
    soundCueId: target?.closest<HTMLElement>('[data-sound-cue-id]')?.dataset.soundCueId
      ?? (coveredTimedCue?.role === 'sound' ? coveredTimedCue.cueId : undefined),
    cameraCueId: target?.closest<HTMLElement>('[data-camera-cue-id]')?.dataset.cameraCueId
      ?? (coveredTimedCue?.role === 'camera' ? coveredTimedCue.cueId : undefined),
  }
}

export function createTimelineMemoForHit(
  project: CutProject,
  template: SheetTemplate,
  hit: SheetHit,
  range: SheetRangeSelection | null,
): TimelineInkMemo | null {
  if (!MEMO_ROLES.has(hit.role as TimelineMemoRole)) return null
  const role = hit.role as TimelineMemoRole
  const laneId = role === 'sound' || role === 'camera' ? timedRangeLaneIdForHit(template, role, hit) ?? undefined : undefined
  if ((role === 'action' || role === 'cell') && !hit.paperTrack) return null
  if ((role === 'sound' || role === 'camera') && !laneId) return null
  const matchingRange = range && range.role === role && range.frameStart <= hit.frame && range.frameEnd >= hit.frame
    && (hit.paperTrack ? range.paperTracks.includes(hit.paperTrack) : timedRangeLaneIdForHit(template, role as 'sound' | 'camera', range.anchorHit) === laneId)
      ? range
      : null
  const frameStart = matchingRange ? Math.min(matchingRange.frameStart, matchingRange.frameEnd) : hit.frame
  const selectedHeight = matchingRange ? Math.abs(matchingRange.frameEnd - matchingRange.frameStart) + 1 : null
  const dimensions = initialTimelineMemoDimensions(template, project, hit, selectedHeight)
  const memo: TimelineInkMemo = {
    kind: 'timeline',
    memoId: nextTimelineMemoId(timelineMemos(project)),
    anchor: {
      role,
      frame: frameStart,
      paperTrack: role === 'action' || role === 'cell' ? hit.paperTrack : undefined,
      laneId,
    },
    placement: {
      frameOffset: 0,
      crossOffsetUnits: 0,
      widthUnits: dimensions.widthUnits,
      heightFrames: dimensions.heightFrames,
    },
    strokes: [],
    texts: [],
    order: project.memos.reduce((maximum, item) => Math.max(maximum, item.order), 0) + 1,
  }
  return withInitialTimelineMemoPlacement(project, template, hit.pageId, memo, selectedHeight ?? 1)
}

export function createTimelineMemoForCue(
  project: CutProject,
  template: SheetTemplate,
  cue: TimedRangeCue,
): TimelineInkMemo | null {
  const hit = sheetHitForTimedRangeCue(project, template, cue)
  if (!hit) return null
  const memo = createTimelineMemoForHit(project, template, hit, null)
  if (!memo) return null
  const cueMemo: TimelineInkMemo = {
    ...memo,
    anchor: {
      ...memo.anchor,
      frame: cue.frameStart,
      laneId: cue.laneId,
      cueId: cue.cueId,
    },
    placement: {
      ...memo.placement,
      heightFrames: Math.max(memo.placement.heightFrames, cue.frameEnd - cue.frameStart + 1),
    },
  }
  return withInitialTimelineMemoPlacement(project, template, hit.pageId, cueMemo, cue.frameEnd - cue.frameStart + 1)
}

/**
 * Places a new bounded memo beside its source before considering an overlap.
 * The score is template geometry based, so paper/digital/custom sheets share
 * the same policy without storing screen pixels in the project.
 */
export function withInitialTimelineMemoPlacement(
  project: CutProject,
  template: SheetTemplate,
  pageId: string | undefined,
  memo: TimelineInkMemo,
  sourceHeightFrames: number,
): TimelineInkMemo {
  const displayDuration = logicalSheetDisplayDurationFrames(project.logicalSheet)
  const displayStart = logicalSheetDisplayFrameStart(project.logicalSheet)
  const pages = createSheetPages(template, displayDuration, displayStart)
  const page = pages.find(item => item.pageId === pageId)
    ?? pages.find(item => memo.anchor.frame >= item.frameStart && memo.anchor.frame <= item.frameEnd)
  if (!page) return memo
  const geometryOptions = projectSheetLayoutOptions(project, template)
  const anchorCell = timelineMemoAnchorCellForPage(template, page, memo, geometryOptions)
  if (!anchorCell) return memo
  const rowHeightX = anchorCell.rect.h * template.page.heightPx / template.page.widthPx
  const rowHeightY = anchorCell.rect.h
  const columnWidthUnits = anchorCell.rect.w / Math.max(Number.EPSILON, rowHeightX)
  const gapUnits = 0.45
  const gapFrames = 0.45
  const candidates = [
    { ...memo.placement, crossOffsetUnits: columnWidthUnits + gapUnits, frameOffset: 0 },
    { ...memo.placement, crossOffsetUnits: -memo.placement.widthUnits - gapUnits, frameOffset: 0 },
    { ...memo.placement, crossOffsetUnits: 0, frameOffset: Math.max(1, sourceHeightFrames) + gapFrames },
    { ...memo.placement, crossOffsetUnits: 0, frameOffset: -memo.placement.heightFrames - gapFrames },
    memo.placement,
  ]
  const sourceRect = {
    x: anchorCell.rect.x,
    y: anchorCell.rect.y,
    w: anchorCell.rect.w,
    h: Math.max(1, sourceHeightFrames) * rowHeightY,
  }
  const occupied = timelineMemos(project).flatMap(existing => timelineMemoSegmentsForPage(template, page, existing, geometryOptions).map(segment => segment.rect))
  const scored = candidates.map((placement, index) => {
    const rect = {
      x: anchorCell.rect.x + placement.crossOffsetUnits * rowHeightX,
      y: anchorCell.rect.y + placement.frameOffset * rowHeightY,
      w: placement.widthUnits * rowHeightX,
      h: placement.heightFrames * rowHeightY,
    }
    const overflow = Math.max(0, -rect.x) + Math.max(0, -rect.y)
      + Math.max(0, rect.x + rect.w - 1) + Math.max(0, rect.y + rect.h - 1)
    const sourceOverlap = normalizedRectIntersectionArea(rect, sourceRect)
    const occupiedOverlap = occupied.reduce((sum, item) => sum + normalizedRectIntersectionArea(rect, item), 0)
    return {
      placement,
      score: overflow * 100_000 + sourceOverlap * 1_000_000 + occupiedOverlap * 10_000 + index,
    }
  })
  scored.sort((left, right) => left.score - right.score)
  return { ...memo, placement: scored[0]?.placement ?? memo.placement }
}

function normalizedRectIntersectionArea(
  left: { x: number; y: number; w: number; h: number },
  right: { x: number; y: number; w: number; h: number },
): number {
  const width = Math.max(0, Math.min(left.x + left.w, right.x + right.w) - Math.max(left.x, right.x))
  const height = Math.max(0, Math.min(left.y + left.h, right.y + right.h) - Math.max(left.y, right.y))
  return width * height
}

function sheetHitForTimedRangeCue(project: CutProject, template: SheetTemplate, cue: TimedRangeCue): SheetHit | null {
  const displayDuration = logicalSheetDisplayDurationFrames(project.logicalSheet)
  const displayStart = logicalSheetDisplayFrameStart(project.logicalSheet)
  const pages = createSheetPages(template, displayDuration, displayStart)
  const page = pages.find(item => cue.frameStart >= item.frameStart && cue.frameStart <= item.frameEnd)
  if (!page) return null
  const viewLayout = getSheetViewLayout(template)
  const frameOrigin = viewLayout.frameAxis?.type === 'continuous' || viewLayout.frameAxis?.type === 'infinite'
    ? page.frameStart
    : template.defaults.frameOrigin
  for (const region of template.regions) {
    if (!isTimelineProjectingSheetTemplateGridRegion(region)
      || !resolveSheetTemplateRegionCapabilities(region).providesMemoTargets
      || region.grid.role !== cue.role) continue
    const layout = resolveSheetTemplateGridLayout(template, region, {
      ...projectSheetLayoutOptions(project, template),
      durationFrames: page.frameEnd - page.frameStart + 1,
      frameOrigin,
    })
    if (!layout) continue
    const regionStart = page.frameStart + layout.frames.frameStart - frameOrigin
    const regionEnd = regionStart + layout.frames.rowCount - 1
    if (cue.frameStart < regionStart || cue.frameStart > regionEnd) continue
    const columnIndex = layout.columns.findIndex(column => column.timelineLaneId === cue.laneId)
    const column = layout.columns[columnIndex]
    if (!column) continue
    const rowIndex = cue.frameStart - regionStart
    return {
      regionId: region.regionId,
      role: cue.role,
      frame: cue.frameStart,
      rowIndex,
      columnIndex,
      columnId: column.columnId,
      label: column.label,
      timelineLaneId: column.timelineLaneId,
      pageId: page.pageId,
      pageIndex: page.pageIndex,
      localFrame: layout.frames.frameStart + rowIndex,
    }
  }
  return null
}

function initialTimelineMemoDimensions(template: SheetTemplate, project: CutProject, hit: SheetHit, selectedHeight: number | null) {
  const displayDuration = logicalSheetDisplayDurationFrames(project.logicalSheet)
  const displayStart = logicalSheetDisplayFrameStart(project.logicalSheet)
  const pages = createSheetPages(template, displayDuration, displayStart)
  const page = pages.find(item => item.pageId === hit.pageId) ?? pages.find(item => hit.frame >= item.frameStart && hit.frame <= item.frameEnd)
  const viewLayout = getSheetViewLayout(template)
  const frameOrigin = page && (viewLayout.frameAxis?.type === 'continuous' || viewLayout.frameAxis?.type === 'infinite')
    ? page.frameStart
    : template.defaults.frameOrigin
  const region = template.regions.find(item =>
    item.regionId === hit.regionId
    && isTimelineProjectingSheetTemplateGridRegion(item)
    && resolveSheetTemplateRegionCapabilities(item).providesMemoTargets
    && item.grid.role === hit.role,
  )
  const layout = region ? resolveSheetTemplateGridLayout(template, region, {
    ...projectSheetLayoutOptions(project, template),
    durationFrames: page ? page.frameEnd - page.frameStart + 1 : displayDuration,
    frameOrigin,
  }) : null
  const rowHeightPx = Math.max(1, layout?.frames.rowHeightPx ?? template.page.heightPx / Math.max(1, template.defaults.durationFrames))
  const defaults = template.annotationDefaults?.timelineMemo
  const physicalWidthPx = defaults?.defaultWidthMm && template.page.dpi
    ? defaults.defaultWidthMm * template.page.dpi / 25.4
    : null
  const preferredWidthPx = physicalWidthPx ?? defaults?.defaultWidthPx ?? Math.min(300, Math.max(160, template.page.widthPx * 0.12))
  const maximumWidthPx = layout ? Math.max(rowHeightPx, layout.pageSize.widthPx - (layout.columns[hit.columnIndex]?.xPx ?? 0)) : template.page.widthPx
  return {
    widthUnits: Math.max(1, Math.min(preferredWidthPx, maximumWidthPx) / rowHeightPx),
    heightFrames: Math.max(1, selectedHeight ?? defaults?.singleFrameHeightFrames ?? 12),
  }
}
