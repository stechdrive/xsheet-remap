import { sharedTextMeasurementProvider, SHEET_TEXT_FONT_FAMILY, splitTextGraphemes, type TextMeasurementProvider } from './textMetrics'

/** Paper widths stay fixed. Use the same bounded label for screen, print and image export. */
export function columnLabelLayout(text: string, widthPx: number, sizePx: number, measurement: TextMeasurementProvider = sharedTextMeasurementProvider) {
  const available = Math.max(1, widthPx - Math.min(4, widthPx * .12))
  const font = { family: SHEET_TEXT_FONT_FAMILY, weight: 700, sizePx }
  const measure = (value: string) => measurement.measure(value, font).widthPx
  const fullWidth = measure(text)
  if (fullWidth > available) font.sizePx = Math.max(Math.min(sizePx, 5), sizePx * .55, sizePx * available / fullWidth)
  if (measure(text) <= available) return { text, fontSizePx: font.sizePx }
  if (measure('…') > available) font.sizePx *= available / measure('…')
  const graphemes = splitTextGraphemes(text)
  let low = 0, high = graphemes.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (measure(graphemes.slice(0, middle).join('') + '…') <= available) low = middle
    else high = middle - 1
  }
  return { text: graphemes.slice(0, low).join('') + '…', fontSizePx: font.sizePx }
}
