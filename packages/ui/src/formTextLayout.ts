import type { NormalizedRect, ResolvedSheetTemplateTextStyle } from '@xsheet-remap/core'
import {
  SHEET_TEXT_FONT_FAMILY,
  sharedTextMeasurementProvider,
  wrapMultilineTextByWidth,
  type TextFontSpec,
  type TextMeasurementProvider,
} from './textMetrics'

export type MultilineFormTextLayout = {
  fontSizePx: number
  lineHeightPx: number
  paddingPx: number
  lines: string[]
  overflow: boolean
  availableWidthPx: number
  availableHeightPx: number
  contentWidthPx: number
  contentHeightPx: number
}

export function resolveMultilineFormTextLayout(
  text: string,
  rect: NormalizedRect,
  pageSize: { widthPx: number; heightPx: number },
  style: ResolvedSheetTemplateTextStyle,
  measurement: TextMeasurementProvider = sharedTextMeasurementProvider,
): MultilineFormTextLayout {
  const preferredFontSizePx = Math.max(1, style.fontSizePx)
  const minimumFontSizePx = Math.min(preferredFontSizePx, Math.max(1, style.minFontSizePx))
  const paddingPx = Math.max(0, style.paddingPx)
  const availableWidthPx = Math.max(1, rect.w * pageSize.widthPx - paddingPx * 2)
  const availableHeightPx = Math.max(1, rect.h * pageSize.heightPx - paddingPx * 2)
  const preferredLineHeightPx = Math.max(preferredFontSizePx, style.lineHeightPx)
  const fontWeight = style.fontWeight

  const evaluate = (fontSizePx: number): MultilineFormTextLayout => {
    const lineHeightPx = Math.max(fontSizePx, preferredLineHeightPx * (fontSizePx / preferredFontSizePx))
    const font: TextFontSpec = {
      family: SHEET_TEXT_FONT_FAMILY,
      sizePx: fontSizePx,
      weight: fontWeight,
    }
    const lines = text
      ? wrapMultilineTextByWidth(text, availableWidthPx, font, measurement)
      : []
    const contentWidthPx = lines.reduce(
      (width, line) => Math.max(width, measurement.measure(line, font).widthPx),
      0,
    )
    const contentHeightPx = lines.length === 0
      ? 0
      : fontSizePx + (lines.length - 1) * lineHeightPx
    return {
      fontSizePx,
      lineHeightPx,
      paddingPx,
      lines,
      overflow: contentWidthPx > availableWidthPx + 0.01 || contentHeightPx > availableHeightPx + 0.01,
      availableWidthPx,
      availableHeightPx,
      contentWidthPx,
      contentHeightPx,
    }
  }

  const preferred = evaluate(preferredFontSizePx)
  if (!preferred.overflow || style.shrinkToFit === false) return preferred

  const minimum = evaluate(minimumFontSizePx)
  if (minimum.overflow || minimumFontSizePx === preferredFontSizePx) return minimum

  let fittingSizePx = minimumFontSizePx
  let overflowingSizePx = preferredFontSizePx
  let fittingLayout = minimum
  for (let iteration = 0; iteration < 14; iteration += 1) {
    const candidateSizePx = (fittingSizePx + overflowingSizePx) / 2
    const candidate = evaluate(candidateSizePx)
    if (candidate.overflow) {
      overflowingSizePx = candidateSizePx
    } else {
      fittingSizePx = candidateSizePx
      fittingLayout = candidate
    }
  }
  return {
    ...fittingLayout,
    fontSizePx: Math.round(fittingLayout.fontSizePx * 1000) / 1000,
    lineHeightPx: Math.round(fittingLayout.lineHeightPx * 1000) / 1000,
  }
}
