import { sharedTextMeasurementProvider, SHEET_TEXT_FONT_FAMILY, splitTextGraphemes, type TextMeasurementProvider } from './textMetrics'
import { layoutVerticalText, type VerticalTextGlyph } from './verticalTextLayout'

export const maxVerticalLabelRows = 8

export interface PaperTrackLabelLayout { text: string; fontSizePx: number; glyphs?: VerticalTextGlyph[] }

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

/** Japanese columns read top to bottom, then right to left. Keep the full name for interaction. */
export function paperTrackLabelLayout(text: string, width: number, size: number, centerX: number, top: number, bottom: number,
  align: 'top' | 'bottom', measurement: TextMeasurementProvider = sharedTextMeasurementProvider): PaperTrackLabelLayout {
  const available = Math.max(1, width - Math.min(4, width * .12))
  if (!text || measurement.measure(text, { family: SHEET_TEXT_FONT_FAMILY, weight: 700, sizePx: size }).widthPx <= available)
    return { text, fontSizePx: size }
  const height = Math.max(0, bottom - top)
  if (height < 1) return { text, fontSizePx: size, glyphs: [] }
  const fontSizePx = Math.min(size, available, height)
  const values = splitTextGraphemes(text)
  const capacity = (s: number) => ({
    rows: Math.min(maxVerticalLabelRows, Math.max(1, Math.floor(height / s))),
    columns: Math.min(3, Math.max(1, 1 + Math.floor((available - s) / (s * 1.25)))),
  })
  const atSize = capacity(fontSizePx)
  const fitted = values.length <= atSize.rows * atSize.columns ? fontSizePx : fontSizePx * .8
  const { rows, columns } = capacity(fitted)
  const visible = values.slice(0, rows * columns)
  const usedWidth = fitted + (Math.ceil(visible.length / rows) - 1) * fitted * 1.25
  const y = align === 'bottom' ? bottom - Math.min(rows, visible.length) * fitted : top
  const { glyphs } = layoutVerticalText(visible.join(''), fitted, centerX - usedWidth / 2, y, rows * fitted + .001, usedWidth)
  return { text, fontSizePx: fitted, glyphs }
}

export function paperTrackHeaderLabel(text: string, column: { xPx: number; widthPx: number }, fontSize: number,
  header: { title: { x: number; y: number; w: number; h: number }; columns: { y: number; h: number } },
  page: { widthPx: number; heightPx: number }, title: string, titleSize: number, regions: Iterable<{ x: number; y: number; w: number; h: number }>) {
  const titleWidth = sharedTextMeasurementProvider.measure(title, { family: SHEET_TEXT_FONT_FAMILY, weight: 700, sizePx: titleSize }).widthPx
  const titleX = (header.title.x + header.title.w / 2) * page.widthPx
  const belowTitle = title && column.xPx < titleX + titleWidth / 2 + 2 && column.xPx + column.widthPx > titleX - titleWidth / 2 - 2
  const titleTop = header.title.y * page.heightPx
  let top = 0
  if (belowTitle) top = titleTop + header.title.h * page.heightPx / 2 + titleSize * .6
  else for (const rect of regions) {
    const bottom = (rect.y + rect.h) * page.heightPx
    if (bottom <= titleTop + .01 && rect.x * page.widthPx < column.xPx + column.widthPx && (rect.x + rect.w) * page.widthPx > column.xPx)
      top = Math.max(top, bottom + 2)
  }
  const bottom = (header.columns.y + header.columns.h) * page.heightPx - 2
  return paperTrackLabelLayout(text, column.widthPx, fontSize, column.xPx + column.widthPx / 2, top + 1, bottom, 'bottom')
}
