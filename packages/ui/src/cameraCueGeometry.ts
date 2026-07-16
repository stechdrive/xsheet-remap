import type {
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
  manual: boolean
}

export function cameraCueSegmentsForPage(
  template: SheetTemplate,
  page: SheetPage,
  cue: TimedRangeCue,
  options: { paperTracks?: string[]; layoutOverrides?: SheetViewLayoutOverrides } = {},
): CameraCueSegment[] {
  return timedRangeCueSegmentsForPage(template, page, cue, 'camera', options)
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
  const values = graphemes(cue.label.trim())

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
    return horizontalLayout(cue.cueId, cue.label, rect, segment, pageSize, fontSizePx, true)
  }

  const verticalRequiredPx = values.length * fontSizePx * 1.02 + 6
  if (verticalRequiredPx <= segment.rect.h * pageSize.heightPx) {
    const glyphs = values.map((value, index) => ({
      value,
      xPx: (segment.rect.x + segment.rect.w / 2) * pageSize.widthPx,
      yPx: segment.rect.y * pageSize.heightPx + fontSizePx + 2 + index * fontSizePx * 1.02,
    }))
    return {
      cueId: cue.cueId,
      rect: segment.rect,
      regionRect: segment.regionRect,
      rowHeight: segment.rowHeight,
      orientation: 'vertical',
      fontSizePx,
      glyphs,
      manual: false,
    }
  }

  const preferredWidthPx = Math.min(segment.regionRect.w * pageSize.widthPx * 0.58, Math.max(54, Math.min(180, values.length * fontSizePx * 0.62 + 12)))
  const width = Math.max(segment.rect.w * 2, preferredWidthPx / pageSize.widthPx)
  const lineCapacity = Math.max(2, Math.floor((width * pageSize.widthPx - 10) / (fontSizePx * 0.62)))
  const lineCount = Math.max(1, Math.ceil(values.length / lineCapacity))
  const height = Math.max(segment.rowHeight * 2, (lineCount * fontSizePx * 1.25 + 8) / pageSize.heightPx)
  const anchorY = segment.rect.y + Math.max(0, anchorFrame - segment.frameStart) * segment.rowHeight
  const xCandidates = uniqueNumbers([
    segment.regionRect.x,
    segment.regionRect.x + segment.regionRect.w - width,
    segment.rect.x - width,
    segment.rect.x + segment.rect.w,
  ])
  const yCandidates = [0, -height, height, -height * 2, height * 2, -height * 3, height * 3]
  let fallback: NormalizedRect | null = null
  for (const yOffset of yCandidates) {
    for (const x of xCandidates) {
      const candidate = clampRectToRegion({ x, y: anchorY + yOffset, w: width, h: height }, segment.regionRect)
      fallback ??= candidate
      if (!obstacles.some(rect => intersects(rect, candidate))) {
        return horizontalLayout(cue.cueId, cue.label, candidate, segment, pageSize, fontSizePx, false)
      }
    }
  }
  return horizontalLayout(cue.cueId, cue.label, fallback ?? segment.rect, segment, pageSize, fontSizePx, false)
}

function horizontalLayout(
  cueId: string,
  value: string,
  rect: NormalizedRect,
  segment: CameraCueSegment,
  pageSize: { widthPx: number; heightPx: number },
  fontSizePx: number,
  manual: boolean,
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
    manual,
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

function intersects(left: NormalizedRect, right: NormalizedRect): boolean {
  const insetX = Math.min(left.w, right.w) * 0.08
  const insetY = Math.min(left.h, right.h) * 0.08
  return left.x + left.w - insetX > right.x
    && right.x + right.w - insetX > left.x
    && left.y + left.h - insetY > right.y
    && right.y + right.h - insetY > left.y
}

function uniqueNumbers(values: number[]): number[] {
  return values.filter((value, index) => values.findIndex(other => Math.abs(other - value) < 0.000001) === index)
}

function graphemes(value: string): string[] {
  if (!value) return []
  const Segmenter = typeof Intl !== 'undefined' ? Intl.Segmenter : undefined
  if (Segmenter) return [...new Segmenter('ja', { granularity: 'grapheme' }).segment(value)].map(item => item.segment)
  return Array.from(value)
}
