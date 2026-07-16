import {
  type NormalizedRect,
  type SheetPage,
  type SheetTemplate,
  type SheetViewLayoutOverrides,
  type TimedRangeCue,
} from '@xsheet-remap/core'
import { timedRangeCueSegmentsForPage, type TimedRangeCueSegment } from './timedRangeCueGeometry'

export type SoundCueSegment = TimedRangeCueSegment

export interface SoundCueTextGlyph {
  value: string
  xPx: number
  yPx: number
}

export interface SoundCueTextLayout {
  labelOrientation: 'horizontal' | 'vertical'
  labelFontSizePx: number
  textFontSizePx: number
  labelGlyphs: SoundCueTextGlyph[]
  textGlyphs: SoundCueTextGlyph[]
  overflowLabel: boolean
  truncatedText: boolean
}

export function soundCueSegmentsForPage(
  template: SheetTemplate,
  page: SheetPage,
  cue: TimedRangeCue,
  options: { paperTracks?: string[]; layoutOverrides?: SheetViewLayoutOverrides } = {},
): SoundCueSegment[] {
  return timedRangeCueSegmentsForPage(template, page, cue, 'sound', options)
}

export function buildSoundCueTextLayout(
  rect: NormalizedRect,
  pageSize: { widthPx: number; heightPx: number },
  label: string,
  text: string,
  typography: { fontSizePx?: number; minFontSizePx?: number } = {},
): SoundCueTextLayout {
  const leftPx = rect.x * pageSize.widthPx
  const topPx = rect.y * pageSize.heightPx
  const widthPx = Math.max(1, rect.w * pageSize.widthPx)
  const heightPx = Math.max(1, rect.h * pageSize.heightPx)
  const baseFontSizePx = Math.max(6, typography.fontSizePx ?? 14)
  const minFontSizePx = Math.max(5, Math.min(baseFontSizePx, typography.minFontSizePx ?? 6))
  const horizontalLabelWidth = graphemes(label).length * baseFontSizePx * 0.62
  const labelOrientation = horizontalLabelWidth <= Math.max(0, widthPx - 4) ? 'horizontal' : 'vertical'
  const labelFontSizePx = Math.max(minFontSizePx, Math.min(baseFontSizePx, widthPx * 0.72))
  const labelValues = graphemes(label)
  const labelGlyphs: SoundCueTextGlyph[] = []
  let contentTopPx = topPx + 2
  let overflowLabel = false

  if (labelValues.length > 0 && labelOrientation === 'horizontal') {
    labelGlyphs.push({ value: label, xPx: leftPx + widthPx / 2, yPx: topPx + labelFontSizePx })
    contentTopPx = topPx + labelFontSizePx * 1.35
  } else if (labelValues.length > 0) {
    const stepPx = labelFontSizePx * 1.02
    labelValues.forEach((value, index) => {
      labelGlyphs.push({ value, xPx: leftPx + widthPx / 2, yPx: topPx + labelFontSizePx + index * stepPx })
    })
    contentTopPx = topPx + labelValues.length * stepPx + 2
    overflowLabel = contentTopPx > topPx + heightPx
  }

  const textValues = graphemes(text.replace(/\r?\n/g, ''))
  const textGlyphs: SoundCueTextGlyph[] = []
  const availableHeightPx = Math.max(0, topPx + heightPx - contentTopPx - 2)
  const capacity = Math.max(0, Math.floor(availableHeightPx / minFontSizePx))
  const shownText = compactMiddle(textValues, capacity)
  const truncatedText = shownText.length !== textValues.length || shownText.some(value => value === '…')
  const textFontSizePx = shownText.length > 0
    ? Math.max(minFontSizePx, Math.min(baseFontSizePx * 0.9, availableHeightPx / shownText.length))
    : minFontSizePx
  if (shownText.length > 0 && availableHeightPx >= minFontSizePx) {
    const stepPx = shownText.length === 1
      ? 0
      : Math.max(textFontSizePx, (availableHeightPx - textFontSizePx) / (shownText.length - 1))
    shownText.forEach((value, index) => {
      textGlyphs.push({ value, xPx: leftPx + widthPx / 2, yPx: contentTopPx + textFontSizePx + index * stepPx })
    })
  }
  return {
    labelOrientation,
    labelFontSizePx,
    textFontSizePx,
    labelGlyphs,
    textGlyphs,
    overflowLabel,
    truncatedText,
  }
}

function compactMiddle(values: string[], capacity: number): string[] {
  if (capacity <= 0) return []
  if (values.length <= capacity) return values
  if (capacity === 1) return ['…']
  if (capacity === 2) return [values[0]!, '…']
  const headCount = Math.ceil((capacity - 1) / 2)
  const tailCount = Math.floor((capacity - 1) / 2)
  return [...values.slice(0, headCount), '…', ...values.slice(values.length - tailCount)]
}

function graphemes(value: string): string[] {
  if (!value) return []
  const Segmenter = typeof Intl !== 'undefined' ? Intl.Segmenter : undefined
  if (Segmenter) return [...new Segmenter('ja', { granularity: 'grapheme' }).segment(value)].map(item => item.segment)
  return Array.from(value)
}
