import type {
  NormalizedPoint,
  NormalizedRect,
  SheetPage,
  SheetTemplate,
  SheetViewLayoutOverrides,
  TimedRangeCue,
} from '@xsheet-remap/core'
import { timedRangeCueSegmentsForPage, type TimedRangeCueSegment } from './timedRangeCueGeometry'
import { defaultTimingTextFontSizePx } from './sheetTextLayout'
import {
  SHEET_TEXT_FONT_FAMILY,
  sharedTextMeasurementProvider,
  splitTextGraphemes,
  type TextFontSpec,
} from './textMetrics'

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
  overflow: boolean
}

export interface CameraCuePageLayout {
  cue: TimedRangeCue
  segments: CameraCueSegment[]
  label: CameraCueLabelLayout | null
}

interface CameraCueLabelVariant {
  orientation: CameraCueLabelLayout['orientation']
  widthPx: number
  heightPx: number
  lines: string[]
  overflow: boolean
}

interface ScoredCameraCueLabelCandidate {
  rect: NormalizedRect
  variant: CameraCueLabelVariant
  score: number
}

const LABEL_HORIZONTAL_PADDING_PX = 8
const LABEL_VERTICAL_PADDING_PX = 4

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
  const fontSizePx = defaultTimingTextFontSizePx(template, 'cell')
  const protectedCrossings = cues.flatMap(cue => cameraCueProtectedCrossings(cue, cueSegments.get(cue.cueId) ?? [], pageSize, fontSizePx))
  const occupiedLabels: NormalizedRect[] = []
  return cues.map(cue => {
    const segments = cueSegments.get(cue.cueId) ?? []
    const label = cameraCueLabelLayoutForPage(
      template,
      page,
      cue,
      pageSize,
      segments,
      [...protectedCrossings, ...occupiedLabels],
    )
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
  const fontSizePx = defaultTimingTextFontSizePx(template, 'cell')
  const font: TextFontSpec = { family: SHEET_TEXT_FONT_FAMILY, sizePx: fontSizePx, weight: 850 }
  const label = cue.label.trim()
  const values = splitTextGraphemes(label)
  const preferredFrame = preferredCameraLabelFrame(template, cue, segments[0]!)
  const segment = segments.find(item => preferredFrame >= item.frameStart && preferredFrame <= item.frameEnd)
    ?? segments.find(item => item.startsCue)
    ?? segments[0]
  if (!segment) return null
  const anchorFrame = Math.max(segment.frameStart, Math.min(segment.frameEnd, preferredFrame))
  const anchor = {
    x: segment.rect.x + segment.rect.w / 2,
    y: segment.rect.y + (anchorFrame - segment.frameStart + 0.5) * segment.rowHeight,
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
    return horizontalLayout(cue.cueId, label, rect, segment, pageSize, font, true, anchor)
  }

  const variants = cameraCueLabelVariants(label, values, segment, pageSize, font)
  const protectedObstacles = [
    ...obstacles,
    ...cameraCueProtectedCrossings(cue, segments, pageSize, fontSizePx),
  ]
  let best: ScoredCameraCueLabelCandidate | null = null
  for (const variant of variants) {
    const width = Math.min(segment.regionRect.w, variant.widthPx / pageSize.widthPx)
    const height = Math.min(segment.regionRect.h, variant.heightPx / pageSize.heightPx)
    for (const candidate of labelCandidates(segment, anchor, width, height)) {
      const rect = clampRectToRegion(candidate, segment.regionRect)
      const area = Math.max(0.000000001, rect.w * rect.h)
      const protectedOverlap = protectedObstacles.reduce((total, obstacle) => total + intersectionArea(rect, obstacle), 0) / area
      const outsideCue = verticalOutsideRatio(rect, segment.rect)
      const xDistance = Math.abs(rect.x + rect.w / 2 - anchor.x) / Math.max(0.000001, segment.regionRect.w)
      const yDistance = Math.abs(rect.y + rect.h / 2 - anchor.y) / Math.max(0.000001, segment.regionRect.h)
      const verticalFitsCue = variant.orientation === 'vertical' && height <= segment.rect.h + 0.0000001
      const orientationPenalty = verticalFitsCue ? 0 : variant.orientation === 'horizontal' ? 2 : 4
      const score = (variant.overflow ? 1_000_000 : 0)
        + protectedOverlap * 100_000
        + outsideCue * 5_000
        + xDistance * 12
        + yDistance * 20
        + orientationPenalty
      if (!best || score < best.score) best = { rect, variant, score }
    }
  }
  if (!best) return null
  return best.variant.orientation === 'vertical'
    ? verticalLayout(cue.cueId, values, best.rect, segment, pageSize, font, anchor, best.variant.overflow)
    : horizontalLayout(cue.cueId, label, best.rect, segment, pageSize, font, false, anchor)
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
      const base = firstHalf ? progress * 0.5 : 0.5 + progress * 0.5
      const xRatio = reverse ? 1 - base : base
      const yRatio = (boundary - segmentStart) / Math.max(1, segmentEnd - segmentStart)
      return { x: segment.rect.x + segment.rect.w * xRatio, y: segment.rect.y + segment.rect.h * yRatio }
    })
  })
}

function cameraCueLabelVariants(
  label: string,
  values: string[],
  segment: CameraCueSegment,
  pageSize: { widthPx: number; heightPx: number },
  font: TextFontSpec,
): CameraCueLabelVariant[] {
  const regionWidthPx = segment.regionRect.w * pageSize.widthPx
  const regionHeightPx = segment.regionRect.h * pageSize.heightPx
  const laneWidthPx = segment.rect.w * pageSize.widthPx
  const lineHeightPx = font.sizePx * 1.12
  const verticalTextHeightPx = Math.max(font.sizePx, (values.length - 1) * lineHeightPx + font.sizePx)
  const widestGlyphPx = values.reduce((width, value) => Math.max(width, sharedTextMeasurementProvider.measure(value, font).widthPx), 0)
  const verticalWidthPx = Math.min(regionWidthPx, Math.max(laneWidthPx * 0.72, widestGlyphPx + LABEL_HORIZONTAL_PADDING_PX))
  const verticalHeightPx = Math.min(regionHeightPx, verticalTextHeightPx + LABEL_VERTICAL_PADDING_PX)
  const verticalOverflow = widestGlyphPx + LABEL_HORIZONTAL_PADDING_PX > regionWidthPx + 0.01
    || verticalTextHeightPx + LABEL_VERTICAL_PADDING_PX > regionHeightPx + 0.01
  const fullTextWidthPx = sharedTextMeasurementProvider.measure(label, font).widthPx + LABEL_HORIZONTAL_PADDING_PX
  const compactWidthPx = Math.min(regionWidthPx, Math.max(laneWidthPx * 2.25, Math.min(fullTextWidthPx, regionWidthPx * 0.66)))
  const widths = uniqueNumbers([compactWidthPx, regionWidthPx])
  return [
    {
      orientation: 'vertical',
      widthPx: verticalWidthPx,
      heightPx: verticalHeightPx,
      lines: values,
      overflow: verticalOverflow,
    },
    ...widths.map(widthPx => {
      const lines = wrapGraphemesByWidth(values, Math.max(1, widthPx - LABEL_HORIZONTAL_PADDING_PX), font)
      const textHeightPx = Math.max(font.sizePx, (lines.length - 1) * font.sizePx * 1.2 + font.sizePx)
      return {
        orientation: 'horizontal' as const,
        widthPx,
        heightPx: Math.min(regionHeightPx, Math.max(segment.rowHeight * pageSize.heightPx, textHeightPx + LABEL_VERTICAL_PADDING_PX)),
        lines,
        overflow: textHeightPx + LABEL_VERTICAL_PADDING_PX > regionHeightPx + 0.01
          || lines.some(line => sharedTextMeasurementProvider.measure(line, font).widthPx > widthPx - LABEL_HORIZONTAL_PADDING_PX + 0.01),
      }
    }),
  ]
}

function preferredCameraLabelFrame(template: SheetTemplate, cue: TimedRangeCue, segment: CameraCueSegment): number {
  const grid = template.regions.find(region => region.regionId === segment.regionId)?.grid
  const majorFrames = Math.max(1, grid?.majorLineEvery ?? 6)
  const pageBreakFrames = Math.max(majorFrames, grid?.pageBreakEvery ?? majorFrames * 4)
  const duration = Math.max(1, cue.frameEnd - cue.frameStart + 1)
  const progress = duration <= majorFrames
    ? 0.5
    : duration <= pageBreakFrames
      ? interpolate(0.5, 0.38, (duration - majorFrames) / Math.max(1, pageBreakFrames - majorFrames))
      : interpolate(0.38, 0.33, Math.min(1, (duration - pageBreakFrames) / pageBreakFrames))
  return cue.frameStart + (duration - 1) * progress
}

function cameraCueProtectedCrossings(
  cue: TimedRangeCue,
  segments: CameraCueSegment[],
  pageSize: { widthPx: number; heightPx: number },
  fontSizePx: number,
): NormalizedRect[] {
  if (cue.camera?.shape !== 'overlap') return []
  const pivotFrame = cue.camera.pivotFrame ?? Math.round((cue.frameStart + cue.frameEnd) / 2)
  return segments.flatMap(segment => {
    if (pivotFrame < segment.frameStart || pivotFrame > segment.frameEnd) return []
    const pivotY = segment.rect.y + (pivotFrame - segment.frameStart + 0.5) * segment.rowHeight
    const clearance = Math.max(segment.rowHeight * 1.5, (fontSizePx + 6) / pageSize.heightPx)
    return [{
      x: segment.rect.x,
      y: pivotY - clearance / 2,
      w: segment.rect.w,
      h: clearance,
    }]
  })
}

function labelCandidates(
  segment: CameraCueSegment,
  anchor: NormalizedPoint,
  width: number,
  height: number,
): NormalizedRect[] {
  const region = segment.regionRect
  const xStep = Math.max(0.000001, segment.rect.w / 2)
  const xValues = [segment.rect.x + segment.rect.w / 2 - width / 2]
  for (let x = region.x; x <= region.x + region.w - width + 0.0000001; x += xStep) xValues.push(x)
  xValues.push(region.x + region.w - width)

  const yValues = [anchor.y - height / 2, segment.rect.y, segment.rect.y + segment.rect.h - height]
  for (let frame = segment.frameStart; frame <= segment.frameEnd; frame += 1) {
    const centerY = segment.rect.y + (frame - segment.frameStart + 0.5) * segment.rowHeight
    yValues.push(centerY - height / 2)
  }
  return uniqueRects(xValues.flatMap(x => yValues.map(y => ({ x, y, w: width, h: height }))))
}

function verticalLayout(
  cueId: string,
  values: string[],
  rect: NormalizedRect,
  segment: CameraCueSegment,
  pageSize: { widthPx: number; heightPx: number },
  font: TextFontSpec,
  anchor: NormalizedPoint,
  overflow: boolean,
): CameraCueLabelLayout {
  const step = font.sizePx * 1.12
  const metrics = sharedTextMeasurementProvider.measure(values[0] ?? '', font)
  const contentHeight = Math.max(font.sizePx, (values.length - 1) * step + metrics.ascentPx + metrics.descentPx)
  const top = rect.y * pageSize.heightPx + Math.max(metrics.ascentPx, (rect.h * pageSize.heightPx - contentHeight) / 2 + metrics.ascentPx)
  return {
    cueId,
    rect,
    regionRect: segment.regionRect,
    rowHeight: segment.rowHeight,
    orientation: 'vertical',
    fontSizePx: font.sizePx,
    glyphs: values.map((value, index) => ({
      value,
      xPx: (rect.x + rect.w / 2) * pageSize.widthPx,
      yPx: top + index * step,
    })),
    connector: connectorForRect(anchor, rect),
    manual: false,
    overflow,
  }
}

function horizontalLayout(
  cueId: string,
  value: string,
  rect: NormalizedRect,
  segment: CameraCueSegment,
  pageSize: { widthPx: number; heightPx: number },
  font: TextFontSpec,
  manual: boolean,
  anchor: NormalizedPoint,
): CameraCueLabelLayout {
  const widthPx = rect.w * pageSize.widthPx
  const lines = wrapGraphemesByWidth(splitTextGraphemes(value), Math.max(1, widthPx - LABEL_HORIZONTAL_PADDING_PX), font)
  const lineHeight = font.sizePx * 1.2
  const metrics = sharedTextMeasurementProvider.measure(lines[0] ?? '', font)
  const contentHeight = Math.max(font.sizePx, (lines.length - 1) * lineHeight + metrics.ascentPx + metrics.descentPx)
  const topPx = rect.y * pageSize.heightPx + Math.max(metrics.ascentPx, (rect.h * pageSize.heightPx - contentHeight) / 2 + metrics.ascentPx)
  const overflow = contentHeight + LABEL_VERTICAL_PADDING_PX > rect.h * pageSize.heightPx + 0.01
    || lines.some(line => sharedTextMeasurementProvider.measure(line, font).widthPx > widthPx - LABEL_HORIZONTAL_PADDING_PX + 0.01)
  return {
    cueId,
    rect,
    regionRect: segment.regionRect,
    rowHeight: segment.rowHeight,
    orientation: 'horizontal',
    fontSizePx: font.sizePx,
    glyphs: lines.map((line, index) => ({
      value: line,
      xPx: (rect.x + rect.w / 2) * pageSize.widthPx,
      yPx: topPx + index * lineHeight,
    })),
    connector: connectorForRect(anchor, rect),
    manual,
    overflow,
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

function wrapGraphemesByWidth(values: string[], maxWidthPx: number, font: TextFontSpec): string[] {
  const lines: string[] = []
  let line = ''
  for (const value of values) {
    const candidate = `${line}${value}`
    if (line && sharedTextMeasurementProvider.measure(candidate, font).widthPx > maxWidthPx) {
      lines.push(line)
      line = value
    } else {
      line = candidate
    }
  }
  if (line || lines.length === 0) lines.push(line)
  return lines
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

function verticalOutsideRatio(rect: NormalizedRect, cueRect: NormalizedRect): number {
  const above = Math.max(0, cueRect.y - rect.y)
  const below = Math.max(0, rect.y + rect.h - (cueRect.y + cueRect.h))
  return (above + below) / Math.max(0.000001, rect.h)
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

function uniqueNumbers(values: number[]): number[] {
  return values.filter((value, index) => values.findIndex(other => Math.abs(other - value) < 0.01) === index)
}

function interpolate(start: number, end: number, progress: number): number {
  return start + (end - start) * Math.max(0, Math.min(1, progress))
}
