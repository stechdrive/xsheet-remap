import type { NormalizedRect, ResolvedSheetTemplateTextStyle } from '@xsheet-remap/core'
import { SHEET_TEXT_FONT_FAMILY, splitTextGraphemes, type TextFontSpec, type TextMeasurementProvider } from './textMetrics'

export type CutHeaderTextBlock = {
  text: string
  style: ResolvedSheetTemplateTextStyle
  group?: { labels: string[]; opening: string; closing: string; separator: string }
}

/** One layout owns the space occupied by the cut and its shared-cut list. */
export function layoutCutHeaderText(
  blocks: CutHeaderTextBlock[],
  rect: NormalizedRect,
  page: { widthPx: number; heightPx: number },
  measurement: TextMeasurementProvider,
) {
  const width = Math.max(0, rect.w * page.widthPx), height = Math.max(0, rect.h * page.heightPx)
  const measure = (block: CutHeaderTextBlock, scale: number) => {
    const style = block.style
    const size = style.shrinkToFit ? style.minFontSizePx + (style.fontSizePx - style.minFontSizePx) * scale : style.fontSizePx
    const font = { family: SHEET_TEXT_FONT_FAMILY, sizePx: size, weight: style.fontWeight }
    const padding = Math.min(style.paddingPx, width / 2, height / (blocks.length * 2))
    const availableWidth = Math.max(0, width - padding * 2)
    const lines = block.group ? wrapLabels(block.group, availableWidth, font, measurement) : block.text ? [block.text] : []
    // Use ink metrics and an alphabetic baseline in every renderer. Font size is
    // not a glyph bounding box, and SVG/CanvasKit disagree about hanging baselines.
    const metrics = lines.map(line => measurement.measure(line, font))
    const ascent = Math.max(0, ...metrics.map(metric => metric.ascentPx))
    const descent = Math.max(0, ...metrics.map(metric => metric.descentPx))
    const inkHeight = ascent + descent
    const lineHeight = Math.max(inkHeight, style.lineHeightPx * size / style.fontSizePx)
    const contentHeight = lines.length ? inkHeight + (lines.length - 1) * lineHeight : 0
    return { block, font, padding, availableWidth, lines, ascent, descent, inkHeight, lineHeight,
      height: contentHeight + padding * 2,
      tooWide: metrics.some(metric => metric.widthPx > availableWidth + 0.001) }
  }
  const evaluate = (scale: number) => blocks.map(block => measure(block, scale))
  const fits = (items: ReturnType<typeof evaluate>) => items.every(item => !item.tooWide)
    && items.reduce((sum, item) => sum + item.height, 0) <= height + 0.001
  let items = evaluate(1)
  if (!fits(items)) {
    items = evaluate(0)
    if (fits(items)) {
      let low = 0, high = 1
      for (let iteration = 0; iteration < 16; iteration++) {
        const middle = (low + high) / 2, candidate = evaluate(middle)
        if (fits(candidate)) { low = middle; items = candidate } else high = middle
      }
    }
  }
  const total = items.reduce((sum, item) => sum + item.height, 0)
  const align = blocks[0]?.style.verticalAlign
  let top = rect.y * page.heightPx + (align === 'top' ? 0 : align === 'bottom' ? Math.max(0, height - total) : Math.max(0, (height - total) / 2))
  const bottom = (rect.y + rect.h) * page.heightPx
  return items.map(item => {
    const allocatedHeight = Math.max(0, Math.min(item.height, bottom - top))
    const availableHeight = Math.max(0, allocatedHeight - item.padding * 2)
    const count = availableHeight + 0.001 < item.inkHeight ? 0
      : Math.min(item.lines.length, 1 + Math.floor((availableHeight - item.inkHeight + 0.001) / item.lineHeight))
    const lines = item.lines.slice(0, count).map((line, index) => ellipsize(
      line, item.availableWidth, item.font, measurement, index === count - 1 && count < item.lines.length,
    ))
    const style = item.block.style
    const layout = {
      lines, fontSizePx: item.font.sizePx, lineHeightPx: item.lineHeight,
      rect: { x: rect.x, y: top / page.heightPx, w: rect.w, h: allocatedHeight / page.heightPx },
      x: style.horizontalAlign === 'left' ? rect.x + item.padding / page.widthPx
        : style.horizontalAlign === 'right' ? rect.x + rect.w - item.padding / page.widthPx : rect.x + rect.w / 2,
      y: (top + item.padding + item.ascent) / page.heightPx,
      textAnchor: style.horizontalAlign === 'left' ? 'start' as const : style.horizontalAlign === 'right' ? 'end' as const : 'middle' as const,
      dominantBaseline: 'alphabetic' as const,
      fontWeight: style.fontWeight,
      overflow: count < item.lines.length || item.tooWide,
    }
    top += allocatedHeight
    return { ...layout, clipRect: layout.rect }
  })
}

function wrapLabels(group: NonNullable<CutHeaderTextBlock['group']>, width: number, font: TextFontSpec, measurement: TextMeasurementProvider): string[] {
  const lines: string[] = []
  let line = group.opening
  let labelsInLine = 0
  for (const [index, label] of group.labels.entries()) {
    const suffix = index === group.labels.length - 1 ? group.closing : ''
    const candidate = line + (labelsInLine ? group.separator : '') + label + suffix
    if (labelsInLine && measurement.measure(candidate, font).widthPx > width) {
      lines.push(line)
      line = label + suffix
      labelsInLine = 1
    } else { line = candidate; labelsInLine++ }
  }
  if (labelsInLine) lines.push(line)
  return lines
}

function ellipsize(text: string, width: number, font: TextFontSpec, measurement: TextMeasurementProvider, omitted: boolean): string {
  if (!omitted && measurement.measure(text, font).widthPx <= width + 0.001) return text
  if (measurement.measure('…', font).widthPx > width) return ''
  const characters = splitTextGraphemes(text)
  let low = 0, high = characters.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (measurement.measure(characters.slice(0, middle).join('') + '…', font).widthPx <= width) low = middle
    else high = middle - 1
  }
  return characters.slice(0, low).join('') + '…'
}
