import type { NormalizedRect } from '@xsheet-remap/core'
import type { TimingCellTextLayout } from './timingCellTextLayout'
import { SHEET_TEXT_FONT_FAMILY, type TextMeasurementProvider } from './textMetrics'

export type TimingReferenceGeometry = { points: number[]; ellipse?: { cx: number; cy: number; rx: number; ry: number }; strokeWidthPx: number }

/** Widen around the displayed text, keeping its size and clamping the stroke to the cell. */
export function layoutTimingCircle(base: TimingCellTextLayout, rect: NormalizedRect, page: { widthPx: number; heightPx: number }, measurement: TextMeasurementProvider): TimingCellTextLayout {
  const w = Math.max(0, rect.w * page.widthPx), h = Math.max(0, rect.h * page.heightPx), short = Math.min(w, h)
  const strokeWidthPx = Math.min(1.5, short * .045)
  const outlineWidthPx = Math.min(2.5, Math.max(.8, base.fontSizePx * .14))
  const margin = Math.max(short * .03, strokeWidthPx / 2)
  const ry = Math.max(0, short / 2 - margin), maxRx = Math.max(0, w / 2 - margin)
  const metrics = measurement.measure(base.text, { family: SHEET_TEXT_FONT_FAMILY, sizePx: base.fontSizePx, weight: 800 })
  // Account for the sloping sides of an ellipse. Cap growth when enlarged text
  // is taller than the cell; the existing halo still protects the letters.
  const textHalfHeight = (metrics.ascentPx + metrics.descentPx + outlineWidthPx) / 2
  const verticalRatio = Math.min(.85, textHalfHeight / Math.max(1, ry))
  const textRadius = base.text.trim() ? (metrics.widthPx / 2 + outlineWidthPx / 2 + strokeWidthPx) / Math.sqrt(1 - verticalRatio ** 2) : 0
  const rx = Math.min(maxRx, Math.max(ry, textRadius))
  return { ...base, outlineWidthPx,
    reference: { points: [], strokeWidthPx, ellipse: {
      cx: (rect.x + rect.w / 2) * page.widthPx, cy: (rect.y + rect.h / 2) * page.heightPx, rx, ry,
    } } }
}

/** Fit the enclosure around readable text, allowing its sides behind the text halo. */
export function layoutTimingReference(
  base: TimingCellTextLayout, minimumSize: number, rect: NormalizedRect,
  page: { widthPx: number; heightPx: number }, measurement: TextMeasurementProvider,
): TimingCellTextLayout {
  const x = rect.x * page.widthPx, y = rect.y * page.heightPx
  const w = rect.w * page.widthPx, h = rect.h * page.heightPx, short = Math.min(w, h)
  const margin = short * .08, strokeWidthPx = Math.min(1.5, short * .045)
  const cx = x + w / 2
  const emptyHeight = short * .58
  if (!base.text.trim()) return { ...base, clipRect: rect, reference: {
    strokeWidthPx,
    points: trianglePoints(cx, y + (h - emptyHeight) / 2, emptyHeight * 1.1547, emptyHeight),
  } }

  // At most a 20% reduction from the ordinary fitted label. Never force the
  // template's six-pixel minimum merely to keep the letters off the sloping sides.
  const floor = Math.min(base.fontSizePx, Math.max(minimumSize, 12, Math.round(base.fontSizePx * .8)))
  const make = (fontSizePx: number) => {
    const metrics = measurement.measure(base.text, { family: SHEET_TEXT_FONT_FAMILY, sizePx: fontSizePx, weight: 800 })
    const halo = Math.min(2.5, Math.max(.8, fontSizePx * .14))
    const th = metrics.ascentPx + metrics.descentPx
    const height = Math.min(h - 2 * margin, Math.max(short * .68, th * 1.8 + halo))
    const width = Math.min(w - 2 * margin, height * 2.8, Math.max(height * 1.1547, metrics.widthPx * 1.65 + halo * 2))
    const top = y + (h - height) / 2
    const baseline = Math.min(y + h - halo / 2 - strokeWidthPx, top + height - halo / 2 - strokeWidthPx) - metrics.descentPx
    const textTop = baseline - metrics.ascentPx
    const insideWidth = width * Math.max(0, textTop - top - halo / 2) / Math.max(1, height)
    return { fontSizePx, halo, width, height, top, baseline, fits: metrics.widthPx + halo <= insideWidth }
  }
  let fitted = make(floor)
  for (let size = base.fontSizePx; size >= floor; size--) {
    const candidate = make(size)
    if (candidate.fits) { fitted = candidate; break }
  }
  return { ...base, fontSizePx: fitted.fontSizePx, clipRect: rect,
    textPosition: { x: cx / page.widthPx, y: fitted.baseline / page.heightPx }, baseline: 'alphabetic', outlineWidthPx: fitted.halo,
    reference: { strokeWidthPx, points: trianglePoints(cx, fitted.top, fitted.width, fitted.height) },
  }
}

function trianglePoints(cx: number, top: number, width: number, height: number): number[] {
  return [cx, top, cx + width / 2, top + height, cx - width / 2, top + height]
}
