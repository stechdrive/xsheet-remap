import type { NormalizedRect, PaperTrack, SheetTemplate } from '@xsheet-remap/core'
import { STANDARD_A3_GRID_HEADER_TOP_OFFSET } from './sheetConstants'
import { templateGridHeaderFontSizePx } from './templateEditorGeometry'

const DEFAULT_BASE_OFFSET_PX = 28
const DEFAULT_LANE_PITCH_PX = 20
const DEFAULT_LABEL_HEIGHT_PX = 14
const DEFAULT_LABEL_MIN_WIDTH_PX = 22
const DEFAULT_LABEL_MAX_WIDTH_PX = 76
const DEFAULT_LABEL_FONT_SIZE_PX = 10.5
const DEFAULT_LABEL_MIN_FONT_SIZE_PX = 7
const DEFAULT_PAGE_MARGIN_PX = 6
const DEFAULT_POLE_GAP_PX = 2
const DEFAULT_TEXT_PADDING_PX = 3
const DEFAULT_CONNECTOR_STROKE_PX = 4
const DEFAULT_ESTIMATED_CHAR_WIDTH_PX = 6
const DEFAULT_RADIUS_PX = 2

export const SHEET_AUXILIARY_LABEL_FONT_FAMILY = '"LINE Seed JP", "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif'
export const SHEET_AUXILIARY_LABEL_FONT_WEIGHT = 700

export type AuxiliaryLabelVariant = 'stack-guide' | 'overlay-track'

export interface AuxiliaryLabelMetrics {
  baseOffsetPx: number
  lanePitchPx: number
  labelHeightPx: number
  minWidthPx: number
  maxWidthPx: number
  fontSizePx: number
  minFontSizePx: number
  fontFamily: string
  fontWeight: number
  shrinkToFit: boolean
  pageMarginPx: number
  poleGapPx: number
  textPaddingPx: number
  connectorStrokePx: number
  estimatedCharWidthPx: number
  radiusPx: number
}

export interface AuxiliaryLabelTextLayout {
  displayText: string
  fullText: string
  fontSizePx: number
  textWidthPx: number
  labelWidthPx: number
  truncated: boolean
}

export interface OverlayAuxiliaryLabelGeometry {
  stemX: number
  labelX: number
  labelY: number
  labelAttachX: number
  labelTextX: number
  labelBottomY: number
  labelWidth: number
  labelHeight: number
  displayText: string
  fullText: string
  truncated: boolean
  fontSizePx: number
  fontFamily: string
  fontWeight: number
  pageSize: { widthPx: number; heightPx: number }
  radiusX: number
  radiusY: number
}

let measurementContext: OffscreenCanvasRenderingContext2D | null | undefined
const measuredTextCache = new Map<string, number>()

export function auxiliaryLabelMetrics(template: SheetTemplate, variant: AuxiliaryLabelVariant): AuxiliaryLabelMetrics {
  const style = template.style?.bgBookLabel
  const targetFontSizePx = templateGridHeaderFontSizePx(template)
  const rawFontSizePx = ptToTemplatePx(template, style?.fontSizePt, DEFAULT_LABEL_FONT_SIZE_PX)
  const fontSizePx = Math.max(rawFontSizePx, targetFontSizePx)
  const rawMinFontSizePx = ptToTemplatePx(template, style?.minFontSizePt, DEFAULT_LABEL_MIN_FONT_SIZE_PX)
  const minFontSizePx = Math.min(fontSizePx, Math.max(5, rawMinFontSizePx))
  const baseTextPaddingPx = Math.max(mmToTemplatePx(template, style?.textPaddingMm, DEFAULT_TEXT_PADDING_PX), fontSizePx * 0.22)
  const textPaddingPx = variant === 'overlay-track' ? Math.max(2, baseTextPaddingPx * 0.72) : baseTextPaddingPx
  const baseLabelHeightPx = Math.max(mmToTemplatePx(template, style?.labelHeightMm, DEFAULT_LABEL_HEIGHT_PX), fontSizePx + 4)
  const labelHeightPx = variant === 'overlay-track' ? Math.max(11, fontSizePx + 3) : baseLabelHeightPx
  const baseMinWidthPx = Math.max(mmToTemplatePx(template, style?.minWidthMm, DEFAULT_LABEL_MIN_WIDTH_PX), fontSizePx + baseTextPaddingPx * 2)
  const minWidthPx = variant === 'overlay-track'
    ? Math.max(13, fontSizePx * 0.72 + textPaddingPx * 2)
    : baseMinWidthPx
  const configuredMaxWidthPx = mmToTemplatePx(template, style?.maxWidthMm, DEFAULT_LABEL_MAX_WIDTH_PX)
  const maxWidthPx = style?.maxWidthMm !== undefined
    ? Math.max(configuredMaxWidthPx, minWidthPx)
    : Math.max(configuredMaxWidthPx, minWidthPx, fontSizePx * 8)
  const baseEstimatedCharWidthPx = Math.max(mmToTemplatePx(template, style?.estimatedCharWidthMm, DEFAULT_ESTIMATED_CHAR_WIDTH_PX), fontSizePx * 0.56)
  const estimatedCharWidthPx = variant === 'overlay-track'
    ? Math.max(baseEstimatedCharWidthPx * 0.9, fontSizePx * 0.54)
    : baseEstimatedCharWidthPx
  return {
    baseOffsetPx: mmToTemplatePx(template, style?.baseOffsetMm, DEFAULT_BASE_OFFSET_PX),
    lanePitchPx: Math.max(mmToTemplatePx(template, style?.lanePitchMm, DEFAULT_LANE_PITCH_PX), labelHeightPx + 3),
    labelHeightPx,
    minWidthPx,
    maxWidthPx,
    fontSizePx,
    minFontSizePx,
    fontFamily: style?.fontFamily?.trim() || SHEET_AUXILIARY_LABEL_FONT_FAMILY,
    fontWeight: normalizeFontWeight(style?.fontWeight),
    shrinkToFit: style?.shrinkToFit !== false,
    pageMarginPx: mmToTemplatePx(template, style?.pageMarginMm, DEFAULT_PAGE_MARGIN_PX),
    poleGapPx: mmToTemplatePx(template, style?.poleGapMm, DEFAULT_POLE_GAP_PX),
    textPaddingPx,
    connectorStrokePx: mmToTemplatePx(template, style?.connectorStrokeMm, DEFAULT_CONNECTOR_STROKE_PX),
    estimatedCharWidthPx,
    radiusPx: variant === 'overlay-track'
      ? Math.max(1.5, mmToTemplatePx(template, style?.radiusMm, DEFAULT_RADIUS_PX) * 0.8)
      : mmToTemplatePx(template, style?.radiusMm, DEFAULT_RADIUS_PX),
  }
}

export function auxiliaryLabelTextLayout(
  text: string,
  metrics: AuxiliaryLabelMetrics,
  extraWidthPx = 0,
): AuxiliaryLabelTextLayout {
  const fullText = text.trim() || text
  const availableTextWidthPx = Math.max(1, metrics.maxWidthPx - metrics.textPaddingPx * 2 - extraWidthPx)
  let fontSizePx = metrics.fontSizePx
  let textWidthPx = measureAuxiliaryLabelTextPx(fullText, metrics, fontSizePx)
  if (metrics.shrinkToFit && textWidthPx > availableTextWidthPx) {
    fontSizePx = Math.max(metrics.minFontSizePx, fontSizePx * (availableTextWidthPx / textWidthPx))
    textWidthPx = measureAuxiliaryLabelTextPx(fullText, metrics, fontSizePx)
  }
  const displayText = textWidthPx <= availableTextWidthPx
    ? fullText
    : ellipsizeAuxiliaryLabel(fullText, availableTextWidthPx, metrics, fontSizePx)
  const displayWidthPx = displayText === fullText
    ? textWidthPx
    : measureAuxiliaryLabelTextPx(displayText, metrics, fontSizePx)
  return {
    displayText,
    fullText,
    fontSizePx,
    textWidthPx: displayWidthPx,
    labelWidthPx: Math.min(
      metrics.maxWidthPx,
      Math.max(metrics.minWidthPx, displayWidthPx + metrics.textPaddingPx * 2 + extraWidthPx),
    ),
    truncated: displayText !== fullText,
  }
}

export function auxiliaryLabelBottomPx(template: SheetTemplate, lane: number, maxLane: number): number {
  const metrics = auxiliaryLabelMetrics(template, 'stack-guide')
  return metrics.baseOffsetPx + Math.min(lane, maxLane) * metrics.lanePitchPx
}

export function auxiliaryLabelHeaderReachPx(template: SheetTemplate, rect: NormalizedRect, pageHeightPx: number): number {
  const headerTopOffsetPx = STANDARD_A3_GRID_HEADER_TOP_OFFSET * template.page.heightPx
  return Math.max(12, Math.min(rect.y * pageHeightPx, headerTopOffsetPx))
}

export function overlayAuxiliaryLabelGeometry(
  template: SheetTemplate,
  rect: NormalizedRect,
  pageSize: { widthPx: number; heightPx: number },
  track: Pick<PaperTrack, 'label'>,
  column: { rect: NormalizedRect },
  lane: number,
  maxLane: number,
): OverlayAuxiliaryLabelGeometry {
  const metrics = auxiliaryLabelMetrics(template, 'overlay-track')
  const textLayout = auxiliaryLabelTextLayout(track.label, metrics)
  const labelWidth = textLayout.labelWidthPx / pageSize.widthPx
  const labelHeight = metrics.labelHeightPx / pageSize.heightPx
  const textPadding = metrics.textPaddingPx / pageSize.widthPx
  const pageMargin = metrics.pageMarginPx / pageSize.widthPx
  const poleGap = metrics.poleGapPx / pageSize.widthPx
  const labelBottomOffset = (
    auxiliaryLabelHeaderReachPx(template, rect, pageSize.heightPx)
    + auxiliaryLabelBottomPx(template, lane, maxLane)
  ) / pageSize.heightPx
  const stemX = column.rect.x
  const labelBottomY = rect.y - labelBottomOffset
  const labelY = labelBottomY - labelHeight
  const desiredLabelX = stemX + poleGap
  const labelX = clampNumber(desiredLabelX, pageMargin, 1 - pageMargin - labelWidth)
  const labelAttachX = labelX >= stemX ? labelX : labelX + labelWidth
  return {
    stemX,
    labelX,
    labelY,
    labelAttachX,
    labelTextX: labelX + textPadding,
    labelBottomY,
    labelWidth,
    labelHeight,
    displayText: textLayout.displayText,
    fullText: textLayout.fullText,
    truncated: textLayout.truncated,
    fontSizePx: textLayout.fontSizePx,
    fontFamily: metrics.fontFamily,
    fontWeight: metrics.fontWeight,
    pageSize,
    radiusX: metrics.radiusPx / pageSize.widthPx,
    radiusY: metrics.radiusPx / pageSize.heightPx,
  }
}

export function auxiliaryLabelRangePx(label: Pick<OverlayAuxiliaryLabelGeometry, 'labelX' | 'labelWidth'>, pageWidthPx: number) {
  return {
    leftPx: label.labelX * pageWidthPx,
    rightPx: (label.labelX + label.labelWidth) * pageWidthPx,
  }
}

export function auxiliaryLabelRangesOverlap(
  a: { leftPx: number; rightPx: number },
  b: { leftPx: number; rightPx: number },
  marginPx = 4,
): boolean {
  return a.leftPx < b.rightPx + marginPx && b.leftPx < a.rightPx + marginPx
}

export function overlayAuxiliaryLabelBandKey(template: SheetTemplate, region: SheetTemplate['regions'][number]): string {
  return String(region.grid?.frameStart ?? template.defaults.frameOrigin)
}

export function estimatedLabelTextWidthPx(
  text: string,
  metrics: Pick<AuxiliaryLabelMetrics, 'fontSizePx' | 'estimatedCharWidthPx'>,
): number {
  return estimatedLabelTextWidthAtSizePx(text, metrics, metrics.fontSizePx)
}

function measureAuxiliaryLabelTextPx(text: string, metrics: AuxiliaryLabelMetrics, fontSizePx: number): number {
  const context = resolveMeasurementContext()
  if (!context) return estimatedLabelTextWidthAtSizePx(text, metrics, fontSizePx)
  const cacheKey = `${metrics.fontWeight}|${fontSizePx.toFixed(3)}|${metrics.fontFamily}|${text}`
  const cached = measuredTextCache.get(cacheKey)
  if (cached !== undefined) return cached
  context.font = `${metrics.fontWeight} ${fontSizePx}px ${metrics.fontFamily}`
  const width = context.measureText(text).width
  if (!Number.isFinite(width) || width <= 0) return estimatedLabelTextWidthAtSizePx(text, metrics, fontSizePx)
  measuredTextCache.set(cacheKey, width)
  return width
}

function resolveMeasurementContext(): OffscreenCanvasRenderingContext2D | null {
  if (measurementContext !== undefined) return measurementContext
  try {
    measurementContext = typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(1, 1).getContext('2d')
      : null
  } catch {
    measurementContext = null
  }
  return measurementContext
}

function ellipsizeAuxiliaryLabel(text: string, maxWidthPx: number, metrics: AuxiliaryLabelMetrics, fontSizePx: number): string {
  const ellipsis = '…'
  if (measureAuxiliaryLabelTextPx(ellipsis, metrics, fontSizePx) > maxWidthPx) return ''
  const characters = Array.from(text)
  while (characters.length > 0) {
    const candidate = `${characters.join('')}${ellipsis}`
    if (measureAuxiliaryLabelTextPx(candidate, metrics, fontSizePx) <= maxWidthPx) return candidate
    characters.pop()
  }
  return ellipsis
}

function estimatedLabelTextWidthAtSizePx(
  text: string,
  metrics: Pick<AuxiliaryLabelMetrics, 'fontSizePx' | 'estimatedCharWidthPx'>,
  fontSizePx: number,
): number {
  const scale = fontSizePx / Math.max(1, metrics.fontSizePx)
  return Array.from(text).reduce((width, char) => width + estimatedLabelCharWidthPx(char, metrics, fontSizePx, scale), 0)
}

function estimatedLabelCharWidthPx(
  char: string,
  metrics: Pick<AuxiliaryLabelMetrics, 'estimatedCharWidthPx'>,
  fontSizePx: number,
  scale: number,
): number {
  if ((char.codePointAt(0) ?? 0) > 0xff) return fontSizePx
  if (/[ilI1|]/.test(char)) return fontSizePx * 0.38
  if (/[MW@%]/.test(char)) return fontSizePx * 0.92
  if (/[A-Z0-9]/.test(char)) return fontSizePx * 0.68
  if (/[a-z]/.test(char)) return fontSizePx * 0.58
  if (/\s/.test(char)) return fontSizePx * 0.34
  return Math.max(metrics.estimatedCharWidthPx * scale, fontSizePx * 0.62)
}

function stackGuideTemplateDpi(template: SheetTemplate): number | undefined {
  return template.style?.bgBookLabel?.designDpi ?? template.page.dpi
}

function mmToTemplatePx(template: SheetTemplate, mm: number | undefined, fallbackPx: number): number {
  const dpi = stackGuideTemplateDpi(template)
  return mm !== undefined && dpi ? (mm * dpi) / 25.4 : fallbackPx
}

function ptToTemplatePx(template: SheetTemplate, pt: number | undefined, fallbackPx: number): number {
  const dpi = stackGuideTemplateDpi(template)
  return pt !== undefined && dpi ? (pt * dpi) / 72 : fallbackPx
}

function normalizeFontWeight(value: number | undefined): number {
  if (!Number.isFinite(value)) return SHEET_AUXILIARY_LABEL_FONT_WEIGHT
  return Math.max(100, Math.min(900, Math.round(value! / 100) * 100))
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
