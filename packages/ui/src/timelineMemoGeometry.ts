import {
  getSheetViewLayout,
  resolveSheetTemplateGridLayout,
  sheetGridCellRect,
  type NormalizedPoint,
  type NormalizedRect,
  type SheetPage,
  type SheetTemplate,
  type SheetViewLayoutOverrides,
  type TimelineInkMemo,
  type TimelineMemoPoint,
} from '@xsheet-remap/core'
import { sheetCellCornerMarkerHitRect, sheetCellCornerMarkerRect } from './sheetCellCornerMarker'

export interface TimelineMemoSegment {
  memoId: string
  regionId: string
  pageId: string
  rect: NormalizedRect
  rowHeightX: number
  rowHeightY: number
  memoYStart: number
  memoYEnd: number
  startsMemo: boolean
  endsMemo: boolean
}

export interface TimelineMemoAnchorCell {
  memoId: string
  regionId: string
  pageId: string
  rect: NormalizedRect
}

export interface TimelineMemoDisplaySurface {
  widthPx: number
  heightPx: number
}

export function timelineMemoAnchorCellForPage(
  template: SheetTemplate,
  page: SheetPage,
  memo: TimelineInkMemo,
  options: { paperTracks?: string[]; layoutOverrides?: SheetViewLayoutOverrides } = {},
): TimelineMemoAnchorCell | null {
  if (memo.anchor.frame < page.frameStart || memo.anchor.frame > page.frameEnd) return null
  const frameOrigin = timelineMemoFrameOriginForPage(template, page)
  for (const region of template.regions) {
    if (region.type !== 'exposure-grid' || region.grid?.role !== memo.anchor.role) continue
    const layout = resolveSheetTemplateGridLayout(template, region, {
      paperTracks: options.paperTracks,
      durationFrames: page.frameEnd - page.frameStart + 1,
      frameOrigin,
      layoutOverrides: options.layoutOverrides,
    })
    if (!layout) continue
    const columnIndex = layout.columns.findIndex(item => memo.anchor.paperTrack
      ? item.paperTrack === memo.anchor.paperTrack
      : item.timelineLaneId === memo.anchor.laneId)
    if (columnIndex < 0) continue
    const regionStart = page.frameStart + layout.frames.frameStart - frameOrigin
    const rowIndex = memo.anchor.frame - regionStart
    if (rowIndex < 0 || rowIndex >= layout.frames.rowCount) continue
    const rect = sheetGridCellRect(layout, columnIndex, rowIndex)
    if (!rect) continue
    return {
      memoId: memo.memoId,
      regionId: region.regionId,
      pageId: page.pageId,
      rect,
    }
  }
  return null
}

export function timelineMemoAnchorMarkerRect(
  cellRect: NormalizedRect,
  surface: TimelineMemoDisplaySurface,
): NormalizedRect {
  return sheetCellCornerMarkerRect(cellRect, surface, 'top-left')
}

export function timelineMemoAnchorHitRect(
  cellRect: NormalizedRect,
  surface: TimelineMemoDisplaySurface,
): NormalizedRect {
  return sheetCellCornerMarkerHitRect(cellRect, surface, 'top-left')
}

export function timelineMemoAnchorConnectorPoints(
  markerRect: NormalizedRect,
  memoRect: NormalizedRect,
  surface: TimelineMemoDisplaySurface,
): string | null {
  const from = {
    x: markerRect.x + markerRect.w / 2,
    y: markerRect.y + markerRect.h / 2,
  }
  const to = {
    x: clamp(from.x, memoRect.x, memoRect.x + memoRect.w),
    y: clamp(from.y, memoRect.y, memoRect.y + memoRect.h),
  }
  const dxPx = (to.x - from.x) * Math.max(1, surface.widthPx)
  const dyPx = (to.y - from.y) * Math.max(1, surface.heightPx)
  const lengthPx = Math.hypot(dxPx, dyPx)
  if (lengthPx < 1) return null
  const halfWidthPx = 0.75
  const offsetX = (-dyPx / lengthPx) * halfWidthPx / Math.max(1, surface.widthPx)
  const offsetY = (dxPx / lengthPx) * halfWidthPx / Math.max(1, surface.heightPx)
  return [
    `${from.x + offsetX},${from.y + offsetY}`,
    `${to.x + offsetX},${to.y + offsetY}`,
    `${to.x - offsetX},${to.y - offsetY}`,
    `${from.x - offsetX},${from.y - offsetY}`,
  ].join(' ')
}

export function timelineMemoSegmentsForPage(
  template: SheetTemplate,
  page: SheetPage,
  memo: TimelineInkMemo,
  options: { paperTracks?: string[]; layoutOverrides?: SheetViewLayoutOverrides } = {},
): TimelineMemoSegment[] {
  const memoTop = memo.anchor.frame + memo.placement.frameOffset
  const memoBottom = memoTop + memo.placement.heightFrames
  const frameOrigin = timelineMemoFrameOriginForPage(template, page)
  const segments: TimelineMemoSegment[] = []
  for (const region of template.regions) {
    if (region.type !== 'exposure-grid' || region.grid?.role !== memo.anchor.role) continue
    const layout = resolveSheetTemplateGridLayout(template, region, {
      paperTracks: options.paperTracks,
      durationFrames: page.frameEnd - page.frameStart + 1,
      frameOrigin,
      layoutOverrides: options.layoutOverrides,
    })
    if (!layout) continue
    const column = layout.columns.find(item => memo.anchor.paperTrack
      ? item.paperTrack === memo.anchor.paperTrack
      : item.timelineLaneId === memo.anchor.laneId)
    if (!column) continue
    const regionStart = page.frameStart + layout.frames.frameStart - frameOrigin
    const regionEnd = regionStart + layout.frames.rowCount
    const segmentStart = Math.max(memoTop, regionStart)
    const segmentEnd = Math.min(memoBottom, regionEnd)
    if (segmentEnd <= segmentStart) continue
    const rowHeightX = layout.frames.rowHeightPx / layout.pageSize.widthPx
    const rowHeightY = layout.frames.rowHeight
    segments.push({
      memoId: memo.memoId,
      regionId: region.regionId,
      pageId: page.pageId,
      rect: {
        x: column.x + memo.placement.crossOffsetUnits * rowHeightX,
        y: layout.rect.y + (segmentStart - regionStart) * rowHeightY,
        w: memo.placement.widthUnits * rowHeightX,
        h: (segmentEnd - segmentStart) * rowHeightY,
      },
      rowHeightX,
      rowHeightY,
      memoYStart: segmentStart - memoTop,
      memoYEnd: segmentEnd - memoTop,
      startsMemo: segmentStart === memoTop,
      endsMemo: segmentEnd === memoBottom,
    })
  }
  return segments
}

function timelineMemoFrameOriginForPage(template: SheetTemplate, page: SheetPage): number {
  const layout = getSheetViewLayout(template)
  return layout.frameAxis?.type === 'continuous' || layout.frameAxis?.type === 'infinite'
    ? page.frameStart
    : template.defaults.frameOrigin
}

export function timelineMemoPointFromPagePoint(segment: TimelineMemoSegment, point: NormalizedPoint): TimelineMemoPoint {
  return {
    x: clamp((point.x - segment.rect.x) / Math.max(Number.EPSILON, segment.rowHeightX), 0, segment.rect.w / segment.rowHeightX),
    y: clamp(segment.memoYStart + (point.y - segment.rect.y) / Math.max(Number.EPSILON, segment.rowHeightY), segment.memoYStart, segment.memoYEnd),
  }
}

export function timelineMemoPointToPagePoint(segment: TimelineMemoSegment, point: TimelineMemoPoint): NormalizedPoint {
  return {
    x: segment.rect.x + point.x * segment.rowHeightX,
    y: segment.rect.y + (point.y - segment.memoYStart) * segment.rowHeightY,
  }
}

export function timelineMemoStrokePointsForSegment(segment: TimelineMemoSegment, points: readonly TimelineMemoPoint[]): TimelineMemoPoint[] {
  if (points.length < 2) return points.filter(point => point.y >= segment.memoYStart && point.y <= segment.memoYEnd)
  const clipped: TimelineMemoPoint[] = []
  for (let index = 1; index < points.length; index += 1) {
    const pair = clipLineToYBand(points[index - 1]!, points[index]!, segment.memoYStart, segment.memoYEnd)
    if (!pair) continue
    if (!samePoint(clipped.at(-1), pair[0])) clipped.push(pair[0])
    clipped.push(pair[1])
  }
  return clipped
}

export function timelineMemoStrokePath(segment: TimelineMemoSegment, points: readonly TimelineMemoPoint[]): string {
  const clipped = timelineMemoStrokePointsForSegment(segment, points)
  if (clipped.length === 0) return ''
  return clipped.map((point, index) => {
    const rendered = timelineMemoPointToPagePoint(segment, point)
    return `${index === 0 ? 'M' : 'L'} ${rendered.x} ${rendered.y}`
  }).join(' ')
}

export function normalizedPointInRect(point: NormalizedPoint, rect: NormalizedRect): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h
}

function clipLineToYBand(a: TimelineMemoPoint, b: TimelineMemoPoint, minY: number, maxY: number): [TimelineMemoPoint, TimelineMemoPoint] | null {
  let t0 = 0
  let t1 = 1
  const dy = b.y - a.y
  if (dy === 0) return a.y >= minY && a.y <= maxY ? [a, b] : null
  const enter = (minY - a.y) / dy
  const leave = (maxY - a.y) / dy
  t0 = Math.max(t0, Math.min(enter, leave))
  t1 = Math.min(t1, Math.max(enter, leave))
  if (t0 > t1) return null
  return [interpolate(a, b, t0), interpolate(a, b, t1)]
}

function interpolate(a: TimelineMemoPoint, b: TimelineMemoPoint, ratio: number): TimelineMemoPoint {
  return {
    x: a.x + (b.x - a.x) * ratio,
    y: a.y + (b.y - a.y) * ratio,
    pressure: (a.pressure ?? 1) + ((b.pressure ?? 1) - (a.pressure ?? 1)) * ratio,
  }
}

function samePoint(a: TimelineMemoPoint | undefined, b: TimelineMemoPoint): boolean {
  return Boolean(a && Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
