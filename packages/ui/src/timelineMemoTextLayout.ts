import type { TimelineMemoText } from '@xsheet-remap/core'
import { timelineMemoPointToPagePoint, type TimelineMemoSegment } from './timelineMemoGeometry'
import {
  SHEET_TEXT_FONT_FAMILY,
  sharedTextMeasurementProvider,
  wrapMultilineTextByWidth,
  type TextMeasurementProvider,
} from './textMetrics'

export const TIMELINE_MEMO_TEXT_FONT_WEIGHT = 700
export const TIMELINE_MEMO_TEXT_LINE_HEIGHT_RATIO = 1.25

export type TimelineMemoTextLayout = {
  xPx: number
  yPx: number
  fontSizePx: number
  lineHeightPx: number
  maxWidthPx: number
  lines: string[]
}

export function buildTimelineMemoTextLayout(
  segment: TimelineMemoSegment,
  text: TimelineMemoText,
  fontSizeUnits: number,
  pageSize: { widthPx: number; heightPx: number },
  measurement: TextMeasurementProvider = sharedTextMeasurementProvider,
): TimelineMemoTextLayout {
  const widthPx = Math.max(1, pageSize.widthPx)
  const heightPx = Math.max(1, pageSize.heightPx)
  const point = timelineMemoPointToPagePoint(segment, text)
  const fontSizePx = Math.max(1, fontSizeUnits * segment.rowHeightY * heightPx)
  const maxWidthPx = Math.max(1, (segment.rect.x + segment.rect.w - point.x) * widthPx)
  const lines = wrapMultilineTextByWidth(text.text, maxWidthPx + 1e-6, {
    family: SHEET_TEXT_FONT_FAMILY,
    sizePx: fontSizePx,
    weight: TIMELINE_MEMO_TEXT_FONT_WEIGHT,
  }, measurement)
  return {
    xPx: point.x * widthPx,
    yPx: point.y * heightPx,
    fontSizePx,
    lineHeightPx: fontSizePx * TIMELINE_MEMO_TEXT_LINE_HEIGHT_RATIO,
    maxWidthPx,
    lines,
  }
}
