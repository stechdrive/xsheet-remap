import type { NormalizedRect } from '@xsheet-remap/core'
import { clampTextFontSizePx } from './sheetTextLayout'
import { SHEET_TEXT_FONT_FAMILY, sharedTextMeasurementProvider, splitTextGraphemes, type TextMeasurementProvider } from './textMetrics'
import { layoutTimingReference, type TimingReferenceGeometry } from './timingReferenceLayout'

export type TimingCellTextLayout = { text: string; fullText: string; fontSizePx: number; overflow: boolean; clipRect: NormalizedRect
  reference?: TimingReferenceGeometry; textPosition?: { x: number; y: number }; baseline?: 'alphabetic'; outlineWidthPx?: number }

/** Display-only layout shared by SVG, CanvasKit and image/PSD export. */
export function layoutTimingCellText(
  text: string, requestedSize: number, minimumSize: number, rect: NormalizedRect,
  pageSize: { widthPx: number; heightPx: number }, measurement: TextMeasurementProvider = sharedTextMeasurementProvider,
  reference = false,
): TimingCellTextLayout {
  const requested = clampTextFontSizePx(requestedSize)
  const minimum = Math.min(requested, clampTextFontSizePx(minimumSize))
  const padding = Math.min(2, Math.max(0, rect.w * pageSize.widthPx / 10))
  const width = Math.max(0, rect.w * pageSize.widthPx - padding * 2)
  const measure = (value: string, sizePx: number) => measurement.measure(value, { family: SHEET_TEXT_FONT_FAMILY, sizePx, weight: 800 }).widthPx
  const initialWidth = measure(text, requested)
  const fontSizePx = initialWidth <= width ? requested : Math.max(minimum, Math.floor(requested * width / Math.max(1, initialWidth)))
  let visible = text
  const overflow = measure(text, fontSizePx) > width
  if (overflow) {
    const graphemes = splitTextGraphemes(text)
    let low = 0, high = graphemes.length
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (measure(`${graphemes.slice(0, mid).join('')}…`, fontSizePx) <= width) low = mid
      else high = mid - 1
    }
    visible = `${graphemes.slice(0, low).join('')}…`
  }
  // Keep vertical typography unchanged, including manually enlarged letters.
  // A column-width clip guarantees horizontal containment even with fallback fonts.
  const layout = { text: visible, fullText: text, fontSizePx, overflow,
    clipRect: { x: rect.x, y: 0, w: rect.w, h: 1 } }
  return reference ? layoutTimingReference(layout, minimum, rect, pageSize, measurement) : layout
}
