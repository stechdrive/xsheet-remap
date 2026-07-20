import {
  type NormalizedRect,
  type SheetPage,
  type SheetTemplate,
  type SheetTemplateLayoutResolveOptions,
  type SheetViewLayoutOverrides,
  type TimedRangeCue,
} from '@xsheet-remap/core'
import { timedRangeCueSegmentsForPage, type TimedRangeCueSegment } from './timedRangeCueGeometry'
import {
  SHEET_TEXT_FONT_FAMILY,
  sharedTextMeasurementProvider,
  splitTextGraphemes,
  type TextMeasurementProvider,
} from './textMetrics'

export type SoundCueSegment = TimedRangeCueSegment

export interface SoundCueTextGlyph {
  value: string
  xPx: number
  yPx: number
}

export interface SoundCueTextBounds {
  xPx: number
  yPx: number
  widthPx: number
  heightPx: number
}

export interface SoundCueTextLayoutOptions {
  fontSizePx?: number
  minFontSizePx?: number
  regionRect?: NormalizedRect
  occupiedRects?: NormalizedRect[]
  occupiedLabelBoundsPx?: SoundCueTextBounds[]
  fontFamily?: string
  labelFontWeight?: number
  textMeasurement?: TextMeasurementProvider
}

export interface SoundCueTextLayout {
  labelOrientation: 'horizontal' | 'vertical'
  labelPlacement: 'outside' | 'inside'
  labelFontSizePx: number
  textFontSizePx: number
  labelGlyphs: SoundCueTextGlyph[]
  textGlyphs: SoundCueTextGlyph[]
  labelBoundsPx?: SoundCueTextBounds
  overflowLabel: boolean
  truncatedText: boolean
}

export function soundCueSegmentsForPage(
  template: SheetTemplate,
  page: SheetPage,
  cue: TimedRangeCue,
  options: { paperTracks?: string[]; timelineLanes?: SheetTemplateLayoutResolveOptions['timelineLanes']; layoutOverrides?: SheetViewLayoutOverrides } = {},
): SoundCueSegment[] {
  return timedRangeCueSegmentsForPage(template, page, cue, 'sound', options)
}

export function buildSoundCueTextLayout(
  rect: NormalizedRect,
  pageSize: { widthPx: number; heightPx: number },
  label: string,
  text: string,
  options: SoundCueTextLayoutOptions = {},
): SoundCueTextLayout {
  const leftPx = rect.x * pageSize.widthPx
  const topPx = rect.y * pageSize.heightPx
  const widthPx = Math.max(1, rect.w * pageSize.widthPx)
  const heightPx = Math.max(1, rect.h * pageSize.heightPx)
  const baseFontSizePx = Math.max(6, options.fontSizePx ?? 14)
  const minFontSizePx = Math.max(5, Math.min(baseFontSizePx, options.minFontSizePx ?? 6))
  const textMeasurement = options.textMeasurement ?? sharedTextMeasurementProvider
  const fontFamily = options.fontFamily ?? SHEET_TEXT_FONT_FAMILY
  const labelFontWeight = options.labelFontWeight ?? 850
  const horizontalLabelWidth = textMeasurement.measure(label, {
    family: fontFamily,
    sizePx: baseFontSizePx,
    weight: labelFontWeight,
  }).widthPx
  const insideLabelOrientation = horizontalLabelWidth <= Math.max(0, widthPx - 4) ? 'horizontal' : 'vertical'
  let labelOrientation: SoundCueTextLayout['labelOrientation'] = insideLabelOrientation
  let labelPlacement: SoundCueTextLayout['labelPlacement'] = 'inside'
  let labelFontSizePx = Math.max(minFontSizePx, Math.min(baseFontSizePx, widthPx * 0.72))
  const labelValues = splitTextGraphemes(label)
  const labelGlyphs: SoundCueTextGlyph[] = []
  let contentTopPx = topPx + 2
  let overflowLabel = false
  let labelBoundsPx: SoundCueTextBounds | undefined

  if (labelValues.length > 0 && options.regionRect) {
    const regionBounds = normalizedRectToTextBounds(options.regionRect, pageSize)
    const occupiedBounds = [
      ...(options.occupiedRects ?? []).map(item => normalizedRectToTextBounds(item, pageSize)),
      ...(options.occupiedLabelBoundsPx ?? []),
    ]
    const outsideGapPx = 2
    const horizontalHeightPx = baseFontSizePx * 1.2 + 2
    const horizontalWidthPx = horizontalLabelWidth + 4
    if (horizontalWidthPx <= regionBounds.widthPx) {
      const minCenterX = regionBounds.xPx + horizontalWidthPx / 2
      const maxCenterX = regionBounds.xPx + regionBounds.widthPx - horizontalWidthPx / 2
      const centerX = clamp(leftPx + widthPx / 2, minCenterX, maxCenterX)
      const candidate = {
        xPx: centerX - horizontalWidthPx / 2,
        yPx: topPx - outsideGapPx - horizontalHeightPx,
        widthPx: horizontalWidthPx,
        heightPx: horizontalHeightPx,
      }
      if (fitsHorizontallyWithin(candidate, regionBounds) && !intersectsAny(candidate, occupiedBounds)) {
        labelOrientation = 'horizontal'
        labelPlacement = 'outside'
        labelFontSizePx = baseFontSizePx
        labelBoundsPx = candidate
        labelGlyphs.push({ value: label, xPx: centerX, yPx: topPx - outsideGapPx - 2 })
      }
    }
    if (labelPlacement === 'inside') {
      const verticalFontSizePx = Math.max(minFontSizePx, Math.min(baseFontSizePx, widthPx * 0.72))
      const verticalStepPx = verticalFontSizePx * 1.02
      const verticalHeightPx = verticalFontSizePx + Math.max(0, labelValues.length - 1) * verticalStepPx + 2
      const verticalWidthPx = verticalFontSizePx + 4
      const centerX = clamp(
        leftPx + widthPx / 2,
        regionBounds.xPx + verticalWidthPx / 2,
        regionBounds.xPx + regionBounds.widthPx - verticalWidthPx / 2,
      )
      const candidate = {
        xPx: centerX - verticalWidthPx / 2,
        yPx: topPx - outsideGapPx - verticalHeightPx,
        widthPx: verticalWidthPx,
        heightPx: verticalHeightPx,
      }
      if (fitsHorizontallyWithin(candidate, regionBounds) && !intersectsAny(candidate, occupiedBounds)) {
        labelOrientation = 'vertical'
        labelPlacement = 'outside'
        labelFontSizePx = verticalFontSizePx
        labelBoundsPx = candidate
        labelValues.forEach((value, index) => {
          labelGlyphs.push({ value, xPx: centerX, yPx: candidate.yPx + verticalFontSizePx + index * verticalStepPx })
        })
      }
    }
  }

  if (labelPlacement === 'inside') {
    if (labelValues.length > 0 && labelOrientation === 'horizontal') {
      labelGlyphs.push({ value: label, xPx: leftPx + widthPx / 2, yPx: topPx + labelFontSizePx })
      contentTopPx = topPx + labelFontSizePx * 1.35
    } else if (labelValues.length > 0) {
      const stepPx = labelFontSizePx * 1.02
      labelValues.forEach((value, index) => {
        labelGlyphs.push({ value, xPx: leftPx + widthPx / 2, yPx: topPx + labelFontSizePx + index * stepPx })
      })
      contentTopPx = topPx + labelValues.length * stepPx + 2
    }
    overflowLabel = contentTopPx > topPx + heightPx
  }

  const textValues = splitTextGraphemes(text.replace(/\r?\n/g, ''))
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
    labelPlacement,
    labelFontSizePx,
    textFontSizePx,
    labelGlyphs,
    textGlyphs,
    ...(labelBoundsPx ? { labelBoundsPx } : {}),
    overflowLabel,
    truncatedText,
  }
}

function normalizedRectToTextBounds(
  rect: NormalizedRect,
  pageSize: { widthPx: number; heightPx: number },
): SoundCueTextBounds {
  return {
    xPx: rect.x * pageSize.widthPx,
    yPx: rect.y * pageSize.heightPx,
    widthPx: rect.w * pageSize.widthPx,
    heightPx: rect.h * pageSize.heightPx,
  }
}

function fitsHorizontallyWithin(inner: SoundCueTextBounds, outer: SoundCueTextBounds): boolean {
  return inner.xPx >= outer.xPx
    && inner.xPx + inner.widthPx <= outer.xPx + outer.widthPx
}

function intersectsAny(candidate: SoundCueTextBounds, obstacles: SoundCueTextBounds[]): boolean {
  const gapPx = 1
  return obstacles.some(obstacle => (
    candidate.xPx < obstacle.xPx + obstacle.widthPx + gapPx
    && candidate.xPx + candidate.widthPx + gapPx > obstacle.xPx
    && candidate.yPx < obstacle.yPx + obstacle.heightPx + gapPx
    && candidate.yPx + candidate.heightPx + gapPx > obstacle.yPx
  ))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
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
