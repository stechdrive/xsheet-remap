import {
  resolveSheetTemplateGridLayout,
  sheetGridCellRect,
  type NormalizedRect,
  type SheetPage,
  type SheetTemplate,
  type SheetTemplateLayoutResolveOptions,
  type SheetViewLayoutOverrides,
  type TimedRangeCue,
  type TimedRangeRole,
} from '@xsheet-remap/core'

export interface TimedRangeCueSegment {
  cueId: string
  regionId: string
  laneId: string
  columnIndex: number
  frameStart: number
  frameEnd: number
  rect: NormalizedRect
  regionRect: NormalizedRect
  rowHeight: number
  startsCue: boolean
  endsCue: boolean
}

export function timedRangeCueSegmentsForPage(
  template: SheetTemplate,
  page: SheetPage,
  cue: TimedRangeCue,
  role: TimedRangeRole,
  options: { paperTracks?: string[]; timelineLanes?: SheetTemplateLayoutResolveOptions['timelineLanes']; layoutOverrides?: SheetViewLayoutOverrides } = {},
): TimedRangeCueSegment[] {
  if (cue.role !== role || cue.frameEnd < page.frameStart || cue.frameStart > page.frameEnd) return []
  const localCueStart = cue.frameStart - page.frameStart + template.defaults.frameOrigin
  const localCueEnd = cue.frameEnd - page.frameStart + template.defaults.frameOrigin
  const segments: TimedRangeCueSegment[] = []
  for (const region of template.regions) {
    if (region.type !== 'exposure-grid' || region.grid?.role !== role) continue
    const layout = resolveSheetTemplateGridLayout(template, region, {
      paperTracks: options.paperTracks,
      timelineLanes: options.timelineLanes,
      durationFrames: page.frameEnd - page.frameStart + 1,
      frameOrigin: template.defaults.frameOrigin,
      layoutOverrides: options.layoutOverrides,
    })
    if (!layout) continue
    const columnIndex = layout.columns.findIndex(column => column.timelineLaneId === cue.laneId)
    if (columnIndex < 0) continue
    const localStart = Math.max(localCueStart, layout.frames.frameStart)
    const localEnd = Math.min(localCueEnd, layout.frames.frameEnd)
    if (localEnd < localStart) continue
    const rowIndex = localStart - layout.frames.frameStart
    const firstRect = sheetGridCellRect(layout, columnIndex, rowIndex)
    if (!firstRect) continue
    const globalStart = page.frameStart + (localStart - template.defaults.frameOrigin)
    const globalEnd = page.frameStart + (localEnd - template.defaults.frameOrigin)
    segments.push({
      cueId: cue.cueId,
      regionId: region.regionId,
      laneId: cue.laneId,
      columnIndex,
      frameStart: globalStart,
      frameEnd: globalEnd,
      rect: { ...firstRect, h: layout.frames.rowHeight * (localEnd - localStart + 1) },
      regionRect: layout.rect,
      rowHeight: layout.frames.rowHeight,
      startsCue: globalStart === cue.frameStart,
      endsCue: globalEnd === cue.frameEnd,
    })
  }
  return segments
}
