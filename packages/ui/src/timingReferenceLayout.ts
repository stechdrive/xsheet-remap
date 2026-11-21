import type { NormalizedRect, TimingEnclosure } from '@xsheet-remap/core'
import type { TimingCellTextLayout } from './timingCellTextLayout'
import { SHEET_TEXT_FONT_FAMILY, type TextMeasurementProvider } from './textMetrics'

export type TimingReferenceGeometry = { points: number[]; ellipse?: { cx: number; cy: number; rx: number; ry: number }; strokeWidthPx: number }

const equilateralWidthRatio = 2 / Math.sqrt(3)

/** Size the mark around the ordinary fitted label, keeping its position and column clip. */
export function layoutTimingEnclosure(
  base: TimingCellTextLayout, shape: TimingEnclosure, rect: NormalizedRect,
  page: { widthPx: number; heightPx: number }, measurement: TextMeasurementProvider,
): TimingCellTextLayout {
  const w = Math.max(0, rect.w * page.widthPx), h = Math.max(0, rect.h * page.heightPx)
  const short = Math.min(w, h), strokeWidthPx = Math.min(1.5, short * .045)
  const cx = (rect.x + rect.w / 2) * page.widthPx, cy = (rect.y + rect.h / 2) * page.heightPx
  const hasLabel = Boolean(base.text.trim())
  if (shape === 'triangle' && !hasLabel) {
    const height = short * .58
    return { ...base, reference: { strokeWidthPx, points: trianglePoints(cx, cy, height * equilateralWidthRatio, height) } }
  }

  const outlineWidthPx = Math.min(2.5, Math.max(.8, base.fontSizePx * .14))
  const margin = Math.max(short * .03, strokeWidthPx / 2)
  const maxWidth = w - 2 * margin
  const metrics = measurement.measure(base.text, { family: SHEET_TEXT_FONT_FAMILY, sizePx: base.fontSizePx, weight: 800 })
  const textWidth = metrics.widthPx + outlineWidthPx + 2 * strokeWidthPx
  const textHeight = metrics.ascentPx + metrics.descentPx + outlineWidthPx

  if (shape === 'circle') {
    const ry = short / 2 - margin
    const verticalRatio = Math.min(.85, textHeight / 2 / Math.max(1, ry))
    const textRadius = hasLabel ? textWidth / 2 / Math.sqrt(1 - verticalRatio ** 2) : 0
    const rx = Math.min(maxWidth / 2, Math.max(ry, textRadius))
    return { ...base, outlineWidthPx, reference: { points: [], strokeWidthPx, ellipse: { cx, cy, rx, ry } } }
  }

  const height = Math.min(h - 2 * margin, maxWidth / equilateralWidthRatio)
  // The sides widen linearly from the apex. When a row is too short to clear
  // the whole label, keep a distinct triangle and let the text halo cover the crossings.
  const fractionAtTextTop = Math.max(1 / 3, (1 - textHeight / Math.max(1, height)) / 2)
  const width = Math.min(maxWidth, height * 2.8, Math.max(height * equilateralWidthRatio, textWidth / fractionAtTextTop))
  return { ...base, outlineWidthPx, reference: { strokeWidthPx, points: trianglePoints(cx, cy, width, height) } }
}

function trianglePoints(cx: number, cy: number, width: number, height: number): number[] {
  const bottom = cy + height / 2
  return [cx, cy - height / 2, cx + width / 2, bottom, cx - width / 2, bottom]
}
