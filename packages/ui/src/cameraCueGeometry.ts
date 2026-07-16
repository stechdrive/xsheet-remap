import type {
  NormalizedPoint,
  NormalizedRect,
  SheetPage,
  SheetTemplate,
  SheetViewLayoutOverrides,
  TimedRangeCue,
} from '@xsheet-remap/core'
import { timedRangeCueSegmentsForPage, type TimedRangeCueSegment } from './timedRangeCueGeometry'

export type CameraCueSegment = TimedRangeCueSegment

export interface CameraCueLabelLayout {
  cueId: string
  rect: NormalizedRect
  regionRect: NormalizedRect
  rowHeight: number
  orientation: 'vertical' | 'horizontal'
  fontSizePx: number
  glyphs: Array<{ value: string; xPx: number; yPx: number }>
  connector?: { from: NormalizedPoint; to: NormalizedPoint }
  manual: boolean
}

export interface CameraCuePageLayout {
  cue: TimedRangeCue
  segments: CameraCueSegment[]
  label: CameraCueLabelLayout | null
}

export function cameraCueSegmentsForPage(
  template: SheetTemplate,
  page: SheetPage,
  cue: TimedRangeCue,
  options: { paperTracks?: string[]; layoutOverrides?: SheetViewLayoutOverrides } = {},
): CameraCueSegment[] {
  return timedRangeCueSegmentsForPage(template, page, cue, 'camera', options)
}

export function buildCameraCuePageLayouts(
  template: SheetTemplate,
  page: SheetPage,
  cues: TimedRangeCue[],
  pageSize: { widthPx: number; heightPx: number },
  options: { paperTracks?: string[]; layoutOverrides?: SheetViewLayoutOverrides } = {},
): CameraCuePageLayout[] {
  const cueSegments = new Map(cues.map(cue => [cue.cueId, cameraCueSegmentsForPage(template, page, cue, options)]))
  const shapeObstacles = cues.flatMap(cue => (cueSegments.get(cue.cueId) ?? []).map(segment => cameraCueShapeObstacle(cue, segment, pageSize)))
  const occupiedLabels: NormalizedRect[] = []
  return cues.map(cue => {
    const segments = cueSegments.get(cue.cueId) ?? []
    const label = cameraCueLabelLayoutForPage(template, page, cue, pageSize, segments, [...shapeObstacles, ...occupiedLabels])
    if (label) occupiedLabels.push(label.rect)
    return { cue, segments, label }
  })
}

export function cameraCueLabelLayoutForPage(
  template: SheetTemplate,
  page: SheetPage,
  cue: TimedRangeCue,
  pageSize: { widthPx: number; heightPx: number },
  segments: CameraCueSegment[],
  obstacles: NormalizedRect[] = [],
): CameraCueLabelLayout | null {
  if (cue.role !== 'camera' || !cue.label.trim() || segments.length === 0) return null
  const camera = cue.camera
  const anchorFrame = camera?.labelPlacement
    ? cue.frameStart + camera.labelPlacement.frameOffset
    : camera?.shape === 'overlap' && camera.pivotFrame !== undefined
      ? camera.pivotFrame
      : Math.round((cue.frameStart + cue.frameEnd) / 2)
  const segment = segments.find(item => anchorFrame >= item.frameStart && anchorFrame <= item.frameEnd)
    ?? segments.find(item => item.startsCue)
    ?? segments[0]
  if (!segment) return null
  const typography = template.regions.find(region => region.regionId === segment.regionId)?.grid?.typography
  const fontSizePx = Math.max(7, typography?.cellFontSizePx ?? 12)
  const label = cue.label.trim()
  const values = graphemes(label)
  const anchor = {
    x: segment.rect.x + segment.rect.w / 2,
    y: segment.rect.y + (Math.max(segment.frameStart, Math.min(segment.frameEnd, anchorFrame)) - segment.frameStart + 0.5) * segment.rowHeight,
  }

  if (camera?.labelPlacement) {
    const placement = camera.labelPlacement
    const boxFrameStart = cue.frameStart + placement.frameOffset
    if (boxFrameStart < segment.frameStart || boxFrameStart > segment.frameEnd) return null
    const y = segment.rect.y + (boxFrameStart - segment.frameStart) * segment.rowHeight
    const rect = clampRectToRegion({
      x: segment.regionRect.x + segment.regionRect.w * placement.xRatio,
      y,
      w: segment.regionRect.w * placement.widthRatio,
      h: segment.rowHeight * placement.heightFrames,
    }, segment.regionRect)
    return horizontalLayout(cue.cueId, label, rect, segment, pageSize, fontSizePx, true, anchor)
  }

  const verticalRect = {
    w: Math.min(segment.regionRect.w, Math.max((fontSizePx * 1.35 + 6) / pageSize.widthPx, segment.rect.w * 0.34)),
    h: Math.min(segment.regionRect.h, (values.length * fontSizePx * 1.02 + 6) / pageSize.heightPx),
  }
  const horizontalWidthPx = Math.min(segment.regionRect.w * pageSize.widthPx * 0.62, Math.max(54, Math.min(190, values.length * fontSizePx * 0.62 + 14)))
  const horizontalRect = {
    w: Math.min(segment.regionRect.w, Math.max(segment.rect.w * 1.5, horizontalWidthPx / pageSize.widthPx)),
    h: 0,
  }
  const lineCapacity = Math.max(2, Math.floor((horizontalRect.w * pageSize.widthPx - 10) / (fontSizePx * 0.62)))
  const lineCount = Math.max(1, Math.ceil(values.length / lineCapacity))
  horizontalRect.h = Math.min(segment.regionRect.h, Math.max(segment.rowHeight * 2, (lineCount * fontSizePx * 1.25 + 8) / pageSize.heightPx))

  const verticalCandidates = labelCandidates(segment, anchor, verticalRect.w, verticalRect.h, camera?.shape ?? 'range')
  const horizontalCandidates = labelCandidates(segment, anchor, horizontalRect.w, horizontalRect.h, camera?.shape ?? 'range')
  const candidates = [
    ...verticalCandidates.map(rect => ({ rect, orientation: 'vertical' as const })),
    ...horizontalCandidates.map(rect => ({ rect, orientation: 'horizontal' as const })),
  ]
  let best: { rect: NormalizedRect; orientation: 'vertical' | 'horizontal'; score: number } | null = null
  for (const candidate of candidates) {
    const rect = clampRectToRegion(candidate.rect, segment.regionRect)
    const overlap = obstacles.reduce((total, obstacle) => total + intersectionArea(rect, obstacle), 0)
    const distance = Math.abs(rect.x + rect.w / 2 - anchor.x) + Math.abs(rect.y + rect.h / 2 - anchor.y) * 0.35
    const score = overlap * 100_000 + distance
    if (!best || score < best.score) best = { ...candidate, rect, score }
    if (overlap < 0.0000001) break
  }
  if (!best) return null
  return best.orientation === 'vertical'
    ? verticalLayout(cue.cueId, values, best.rect, segment, pageSize, fontSizePx, anchor)
    : horizontalLayout(cue.cueId, label, best.rect, segment, pageSize, fontSizePx, false, anchor)
}

export function cameraCueShapeObstacle(
  cue: TimedRangeCue,
  segment: CameraCueSegment,
  pageSize: { widthPx: number; heightPx: number },
): NormalizedRect {
  if (cue.camera?.shape !== 'range') return segment.rect
  const clearance = Math.min(segment.rect.w, Math.max(8 / pageSize.widthPx, segment.rect.w * 0.18))
  return {
    x: segment.rect.x + (segment.rect.w - clearance) / 2,
    y: segment.rect.y,
    w: clearance,
    h: segment.rect.h,
  }
}

export function cameraFadePolygonForSegment(
  cue: TimedRangeCue,
  segment: CameraCueSegment,
  shape: 'fade-in' | 'fade-out',
): NormalizedPoint[] {
  const duration = Math.max(1, cue.frameEnd - cue.frameStart + 1)
  const topProgress = (segment.frameStart - cue.frameStart) / duration
  const bottomProgress = (segment.frameEnd + 1 - cue.frameStart) / duration
  const widthAt = (progress: number) => segment.rect.w * (shape === 'fade-in' ? progress : 1 - progress)
  const topWidth = widthAt(topProgress)
  const bottomWidth = widthAt(bottomProgress)
  const centerX = segment.rect.x + segment.rect.w / 2
  const top = segment.rect.y
  const bottom = segment.rect.y + segment.rect.h
  return [
    { x: centerX - topWidth / 2, y: top },
    { x: centerX + topWidth / 2, y: top },
    { x: centerX + bottomWidth / 2, y: bottom },
    { x: centerX - bottomWidth / 2, y: bottom },
  ]
}

export function cameraOverlapPathsForSegment(cue: TimedRangeCue, segment: CameraCueSegment): NormalizedPoint[][] {
  const startBoundary = cue.frameStart
  const endBoundary = cue.frameEnd + 1
  const pivotBoundary = Math.max(startBoundary, Math.min(endBoundary, (cue.camera?.pivotFrame ?? Math.round((cue.frameStart + cue.frameEnd) / 2)) + 0.5))
  const segmentStart = segment.frameStart
  const segmentEnd = segment.frameEnd + 1
  return [false, true].map(reverse => {
    const boundaries = [segmentStart, ...(pivotBoundary > segmentStart && pivotBoundary < segmentEnd ? [pivotBoundary] : []), segmentEnd]
    return boundaries.map(boundary => {
      const firstHalf = boundary <= pivotBoundary
      const denominator = Math.max(0.5, firstHalf ? pivotBoundary - startBoundary : endBoundary - pivotBoundary)
      const progress = Math.max(0, Math.min(1, firstHalf ? (boundary - startBoundary) / denominator : (boundary - pivotBoundary) / denominator))
      const base = firstHalf ? progress : 1 - progress
      const xRatio = reverse ? 1 - base : base
      const yRatio = (boundary - segmentStart) / Math.max(1, segmentEnd - segmentStart)
      return { x: segment.rect.x + segment.rect.w * xRatio, y: segment.rect.y + segment.rect.h * yRatio }
    })
  })
}

function labelCandidates(
  segment: CameraCueSegment,
  anchor: NormalizedPoint,
  width: number,
  height: number,
  shape: NonNullable<TimedRangeCue['camera']>['shape'],
): NormalizedRect[] {
  const centeredY = anchor.y - height / 2
  const xValues = shape === 'range'
    ? [segment.rect.x, segment.rect.x + segment.rect.w - width, segment.rect.x - width, segment.rect.x + segment.rect.w]
    : [segment.rect.x - width, segment.rect.x + segment.rect.w, segment.regionRect.x, segment.regionRect.x + segment.regionRect.w - width]
  const yValues = [centeredY, segment.rect.y - height, segment.rect.y + segment.rect.h, centeredY - height, centeredY + height]
  return uniqueRects(xValues.flatMap(x => yValues.map(y => ({ x, y, w: width, h: height }))))
}

function verticalLayout(
  cueId: string,
  values: string[],
  rect: NormalizedRect,
  segment: CameraCueSegment,
  pageSize: { widthPx: number; heightPx: number },
  fontSizePx: number,
  anchor: NormalizedPoint,
): CameraCueLabelLayout {
  const step = fontSizePx * 1.02
  const contentHeight = Math.max(fontSizePx, values.length * step)
  const top = rect.y * pageSize.heightPx + Math.max(fontSizePx, (rect.h * pageSize.heightPx - contentHeight) / 2 + fontSizePx)
  return {
    cueId,
    rect,
    regionRect: segment.regionRect,
    rowHeight: segment.rowHeight,
    orientation: 'vertical',
    fontSizePx,
    glyphs: values.map((value, index) => ({
      value,
      xPx: (rect.x + rect.w / 2) * pageSize.widthPx,
      yPx: top + index * step,
    })),
    connector: connectorForRect(anchor, rect),
    manual: false,
  }
}

function horizontalLayout(
  cueId: string,
  value: string,
  rect: NormalizedRect,
  segment: CameraCueSegment,
  pageSize: { widthPx: number; heightPx: number },
  fontSizePx: number,
  manual: boolean,
  anchor: NormalizedPoint,
): CameraCueLabelLayout {
  const widthPx = rect.w * pageSize.widthPx
  const capacity = Math.max(2, Math.floor((widthPx - 8) / (fontSizePx * 0.62)))
  const lines = wrapGraphemes(graphemes(value), capacity)
  const lineHeight = fontSizePx * 1.2
  const topPx = rect.y * pageSize.heightPx + Math.max(fontSizePx, (rect.h * pageSize.heightPx - lines.length * lineHeight) / 2 + fontSizePx)
  return {
    cueId,
    rect,
    regionRect: segment.regionRect,
    rowHeight: segment.rowHeight,
    orientation: 'horizontal',
    fontSizePx,
    glyphs: lines.map((line, index) => ({
      value: line,
      xPx: (rect.x + rect.w / 2) * pageSize.widthPx,
      yPx: topPx + index * lineHeight,
    })),
    connector: connectorForRect(anchor, rect),
    manual,
  }
}

function connectorForRect(anchor: NormalizedPoint, rect: NormalizedRect): CameraCueLabelLayout['connector'] {
  if (anchor.x >= rect.x && anchor.x <= rect.x + rect.w && anchor.y >= rect.y && anchor.y <= rect.y + rect.h) return undefined
  return {
    from: anchor,
    to: {
      x: Math.max(rect.x, Math.min(rect.x + rect.w, anchor.x)),
      y: Math.max(rect.y, Math.min(rect.y + rect.h, anchor.y)),
    },
  }
}

function wrapGraphemes(values: string[], capacity: number): string[] {
  const lines: string[] = []
  for (let index = 0; index < values.length; index += capacity) lines.push(values.slice(index, index + capacity).join(''))
  return lines.length > 0 ? lines : ['']
}

function clampRectToRegion(rect: NormalizedRect, region: NormalizedRect): NormalizedRect {
  const w = Math.min(region.w, Math.max(0.001, rect.w))
  const h = Math.min(region.h, Math.max(0.001, rect.h))
  return {
    x: Math.max(region.x, Math.min(region.x + region.w - w, rect.x)),
    y: Math.max(region.y, Math.min(region.y + region.h - h, rect.y)),
    w,
    h,
  }
}

function intersectionArea(left: NormalizedRect, right: NormalizedRect): number {
  const width = Math.max(0, Math.min(left.x + left.w, right.x + right.w) - Math.max(left.x, right.x))
  const height = Math.max(0, Math.min(left.y + left.h, right.y + right.h) - Math.max(left.y, right.y))
  return width * height
}

function uniqueRects(values: NormalizedRect[]): NormalizedRect[] {
  return values.filter((value, index) => values.findIndex(other => Math.abs(other.x - value.x) < 0.000001
    && Math.abs(other.y - value.y) < 0.000001
    && Math.abs(other.w - value.w) < 0.000001
    && Math.abs(other.h - value.h) < 0.000001) === index)
}

function graphemes(value: string): string[] {
  if (!value) return []
  const Segmenter = typeof Intl !== 'undefined' ? Intl.Segmenter : undefined
  if (Segmenter) return [...new Segmenter('ja', { granularity: 'grapheme' }).segment(value)].map(item => item.segment)
  return Array.from(value)
}
