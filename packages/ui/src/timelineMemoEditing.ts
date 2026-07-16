import {
  createSheetPages,
  getSheetViewLayout,
  logicalSheetDisplayDurationFrames,
  logicalSheetDisplayFrameStart,
  nextTimelineMemoId,
  resolveSheetTemplateGridLayout,
  type CutProject,
  type SheetHit,
  type SheetTemplate,
  type TimelineInkMemo,
  type TimelineMemoRole,
} from '@xsheet-remap/core'
import type { SheetRangeSelection } from './appTypes'
import { timedRangeLaneIdForHit } from './timedRangeCueEditing'

const MEMO_ROLES = new Set<TimelineMemoRole>(['action', 'cell', 'sound', 'camera'])

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
  return {
    memoId: nextTimelineMemoId(project.timelineMemos),
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
    order: project.timelineMemos.reduce((maximum, item) => Math.max(maximum, item.order), 0) + 1,
  }
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
  const region = template.regions.find(item => item.regionId === hit.regionId && item.grid?.role === hit.role)
  const layout = region ? resolveSheetTemplateGridLayout(template, region, {
    paperTracks: project.logicalSheet.paperTracks.map(track => track.paperTrack),
    durationFrames: page ? page.frameEnd - page.frameStart + 1 : displayDuration,
    frameOrigin,
    layoutOverrides: project.sheetView.layoutOverrides,
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
