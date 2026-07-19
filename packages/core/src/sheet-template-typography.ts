import type {
  SheetTemplate,
  SheetTemplateLength,
  SheetTemplateLengthUnit,
  SheetTemplatePageSize,
  SheetTemplateTextStyle,
} from './sheet-template-schema'

const CSS_REFERENCE_DPI = 96
const PAPER_REFERENCE_DPI = 150
const DIGITAL_REFERENCE_WIDTH_PX = 1920

export interface SheetTemplateTextStyleDefaults {
  fontSizePx?: number
  minFontSizePx?: number
  lineHeightRatio?: number
  paddingPx?: number
  fontWeight?: number
}

export interface ResolvedSheetTemplateTextStyle {
  fontSizePx: number
  minFontSizePx: number
  lineHeightPx: number
  paddingPx: number
  fontWeight: number
  horizontalAlign: 'left' | 'center' | 'right'
  verticalAlign: 'top' | 'middle' | 'bottom'
  shrinkToFit: boolean
  overflowX: 'clip' | 'visible'
  overflowY: 'clip' | 'visible'
}

export function sheetTemplateDesignDpi(template: SheetTemplate): number {
  const declared = template.page.dpi
  if (isFinitePositive(declared)) return declared
  const placement = template.defaultUnderlay?.placement
  const placementValues = [placement?.ppiX, placement?.ppiY].filter(isFinitePositive)
  if (placementValues.length > 0) return average(placementValues)
  const image = template.defaultUnderlay?.imageRef
  const imageValues = [image?.ppiX, image?.ppiY].filter(isFinitePositive)
  if (imageValues.length > 0) return average(imageValues)
  return CSS_REFERENCE_DPI
}

export function sheetTemplateLengthForReferencePx(
  template: SheetTemplate,
  referencePx: number,
  kind: 'font' | 'spacing' = 'font',
): SheetTemplateLength {
  const safePx = Math.max(0, finiteOr(referencePx, 0))
  if (template.page.isPhysical) {
    return kind === 'spacing'
      ? { value: safePx * 25.4 / PAPER_REFERENCE_DPI, unit: 'mm' }
      : { value: safePx * 72 / PAPER_REFERENCE_DPI, unit: 'pt' }
  }
  return {
    value: safePx * Math.max(1, template.page.widthPx) / DIGITAL_REFERENCE_WIDTH_PX,
    unit: 'px',
  }
}

export function convertSheetTemplateLength(
  template: SheetTemplate,
  length: SheetTemplateLength,
  unit: SheetTemplateLengthUnit,
): SheetTemplateLength {
  const basePx = lengthToBaseTemplatePx(template, length)
  const dpi = sheetTemplateDesignDpi(template)
  if (unit === 'pt') return { value: basePx * 72 / dpi, unit }
  if (unit === 'mm') return { value: basePx * 25.4 / dpi, unit }
  return { value: basePx, unit }
}

export function resolveSheetTemplateLengthPx(
  template: SheetTemplate,
  pageSize: Pick<SheetTemplatePageSize, 'widthPx' | 'heightPx'>,
  length: SheetTemplateLength,
): number {
  return lengthToBaseTemplatePx(template, length) * templateOutputScale(template, pageSize)
}

export function resolveSheetTemplateTextStyle(
  template: SheetTemplate,
  pageSize: Pick<SheetTemplatePageSize, 'widthPx' | 'heightPx'>,
  style: SheetTemplateTextStyle = {},
  defaults: SheetTemplateTextStyleDefaults = {},
): ResolvedSheetTemplateTextStyle {
  const outputScale = templateOutputScale(template, pageSize)
  const preferredFallbackPx = defaultReferencePxInTemplate(template, defaults.fontSizePx ?? 13) * outputScale
  const minimumFallbackPx = defaultReferencePxInTemplate(template, defaults.minFontSizePx ?? 7) * outputScale
  const paddingFallbackPx = defaultReferencePxInTemplate(template, defaults.paddingPx ?? 2) * outputScale
  const fontSizePx = Math.max(1, resolveMetricPx(template, pageSize, style.fontSize, style.fontSizePx, preferredFallbackPx))
  const minFontSizePx = Math.min(
    fontSizePx,
    Math.max(1, resolveMetricPx(template, pageSize, style.minFontSize, style.minFontSizePx, minimumFallbackPx)),
  )
  const lineHeightFallbackPx = fontSizePx * Math.max(1, defaults.lineHeightRatio ?? 1.15)
  const lineHeightPx = Math.max(
    fontSizePx,
    resolveMetricPx(template, pageSize, style.lineHeight, style.lineHeightPx, lineHeightFallbackPx),
  )
  const paddingPx = Math.max(0, resolveMetricPx(template, pageSize, style.padding, style.paddingPx, paddingFallbackPx))
  return {
    fontSizePx,
    minFontSizePx,
    lineHeightPx,
    paddingPx,
    fontWeight: clampWeight(style.fontWeight ?? defaults.fontWeight ?? 400),
    horizontalAlign: style.horizontalAlign ?? 'center',
    verticalAlign: style.verticalAlign ?? 'middle',
    shrinkToFit: style.shrinkToFit !== false,
    overflowX: style.overflowX ?? 'clip',
    overflowY: style.overflowY ?? 'clip',
  }
}

function resolveMetricPx(
  template: SheetTemplate,
  pageSize: Pick<SheetTemplatePageSize, 'widthPx' | 'heightPx'>,
  metric: SheetTemplateLength | undefined,
  legacyPx: number | undefined,
  fallbackPx: number,
): number {
  if (metric && isFinitePositive(metric.value)) return resolveSheetTemplateLengthPx(template, pageSize, metric)
  if (isFiniteNonNegative(legacyPx)) return legacyPx * templateOutputScale(template, pageSize)
  return fallbackPx
}

function lengthToBaseTemplatePx(template: SheetTemplate, length: SheetTemplateLength): number {
  const value = Math.max(0, finiteOr(length.value, 0))
  if (length.unit === 'pt') return value * sheetTemplateDesignDpi(template) / 72
  if (length.unit === 'mm') return value * sheetTemplateDesignDpi(template) / 25.4
  return value
}

function templateOutputScale(
  template: SheetTemplate,
  pageSize: Pick<SheetTemplatePageSize, 'widthPx' | 'heightPx'>,
): number {
  const baseWidth = Math.max(1, template.page.widthPx)
  const outputWidth = Math.max(1, finiteOr(pageSize.widthPx, baseWidth))
  return outputWidth / baseWidth
}

function defaultReferencePxInTemplate(template: SheetTemplate, referencePx: number): number {
  const safe = Math.max(0, finiteOr(referencePx, 0))
  if (template.page.isPhysical) return safe * sheetTemplateDesignDpi(template) / PAPER_REFERENCE_DPI
  return safe * Math.max(1, template.page.widthPx) / DIGITAL_REFERENCE_WIDTH_PX
}

function clampWeight(value: number): number {
  return Math.max(100, Math.min(900, Math.round(finiteOr(value, 400))))
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function isFinitePositive(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isFiniteNonNegative(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
