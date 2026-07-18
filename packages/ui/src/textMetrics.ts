export const SHEET_TEXT_FONT_FAMILY = '"LINE Seed JP", "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif'

export interface TextFontSpec {
  family: string
  sizePx: number
  weight?: number
  style?: 'normal' | 'italic' | 'oblique'
  letterSpacingPx?: number
}

export interface MeasuredTextMetrics {
  widthPx: number
  ascentPx: number
  descentPx: number
  exact: boolean
}

export interface TextMeasurementProvider {
  measure(text: string, font: TextFontSpec): MeasuredTextMetrics
}

type CanvasMeasurementContext = {
  font: string
  measureText(text: string): TextMetrics
}

const DEFAULT_CACHE_LIMIT = 2048

export function textFontDeclaration(font: TextFontSpec): string {
  const style = font.style ?? 'normal'
  const weight = normalizeFontWeight(font.weight)
  const sizePx = Math.max(1, font.sizePx)
  return `${style} ${weight} ${sizePx}px ${font.family}`
}

export function splitTextGraphemes(value: string, locale = 'ja'): string[] {
  if (!value) return []
  const Segmenter = typeof Intl !== 'undefined' ? Intl.Segmenter : undefined
  if (Segmenter) return [...new Segmenter(locale, { granularity: 'grapheme' }).segment(value)].map(item => item.segment)
  return Array.from(value)
}

export function createCanvasTextMeasurementProvider(
  resolveContext: () => CanvasMeasurementContext | null,
  cacheLimit = DEFAULT_CACHE_LIMIT,
): TextMeasurementProvider {
  const cache = new Map<string, MeasuredTextMetrics>()
  return {
    measure(text, font) {
      const normalizedFont = normalizeFont(font)
      const key = measurementCacheKey(text, normalizedFont)
      const cached = cache.get(key)
      if (cached) {
        cache.delete(key)
        cache.set(key, cached)
        return cached
      }
      const measured = measureWithCanvas(resolveContext(), text, normalizedFont)
        ?? estimateTextMetrics(text, normalizedFont)
      cache.set(key, measured)
      while (cache.size > Math.max(1, cacheLimit)) {
        const oldestKey = cache.keys().next().value as string | undefined
        if (oldestKey === undefined) break
        cache.delete(oldestKey)
      }
      return measured
    },
  }
}

let defaultMeasurementContext: CanvasMeasurementContext | null | undefined

export const sharedTextMeasurementProvider = createCanvasTextMeasurementProvider(resolveDefaultMeasurementContext)

export function wrapMultilineTextByWidth(
  value: string,
  maxWidthPx: number,
  font: TextFontSpec,
  measurement: TextMeasurementProvider = sharedTextMeasurementProvider,
): string[] {
  if (!value) return []
  const width = Math.max(1, maxWidthPx)
  return value.replace(/\r\n?/g, '\n').split('\n').flatMap(paragraph => {
    if (!paragraph) return ['']
    const lines: string[] = []
    let line = ''
    for (const grapheme of splitTextGraphemes(paragraph)) {
      const candidate = `${line}${grapheme}`
      if (line && measurement.measure(candidate, font).widthPx > width) {
        lines.push(line)
        line = grapheme
      } else {
        line = candidate
      }
    }
    lines.push(line)
    return lines
  })
}

function resolveDefaultMeasurementContext(): CanvasMeasurementContext | null {
  if (defaultMeasurementContext !== undefined) return defaultMeasurementContext
  try {
    if (typeof OffscreenCanvas === 'function') {
      defaultMeasurementContext = new OffscreenCanvas(1, 1).getContext('2d')
      return defaultMeasurementContext
    }
    const isJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)
    if (typeof document !== 'undefined' && !isJsdom) {
      defaultMeasurementContext = document.createElement('canvas').getContext('2d')
      return defaultMeasurementContext
    }
  } catch {
    // A conservative estimate below is preferable to coupling layout to canvas availability.
  }
  defaultMeasurementContext = null
  return defaultMeasurementContext
}

function measureWithCanvas(
  context: CanvasMeasurementContext | null,
  text: string,
  font: Required<TextFontSpec>,
): MeasuredTextMetrics | null {
  if (!context) return null
  context.font = textFontDeclaration(font)
  const metrics = context.measureText(text)
  const widthPx = metrics.width + Math.max(0, splitTextGraphemes(text).length - 1) * font.letterSpacingPx
  if (!Number.isFinite(widthPx) || widthPx < 0) return null
  const ascentPx = finiteOr(metrics.actualBoundingBoxAscent, font.sizePx * 0.8)
  const descentPx = finiteOr(metrics.actualBoundingBoxDescent, font.sizePx * 0.2)
  return { widthPx, ascentPx, descentPx, exact: true }
}

function estimateTextMetrics(text: string, font: Required<TextFontSpec>): MeasuredTextMetrics {
  const graphemes = splitTextGraphemes(text)
  const glyphWidth = graphemes.reduce((total, value) => total + estimatedGraphemeWidthPx(value, font.sizePx), 0)
  const letterSpacing = Math.max(0, graphemes.length - 1) * font.letterSpacingPx
  return {
    widthPx: glyphWidth + letterSpacing,
    ascentPx: font.sizePx * 0.82,
    descentPx: font.sizePx * 0.22,
    exact: false,
  }
}

function estimatedGraphemeWidthPx(value: string, fontSizePx: number): number {
  const codePoint = value.codePointAt(0) ?? 0
  if (codePoint > 0xff || value.length > 1) return fontSizePx
  if (/[ilI1|]/.test(value)) return fontSizePx * 0.38
  if (/[MW@%]/.test(value)) return fontSizePx * 0.92
  if (/[A-Z0-9]/.test(value)) return fontSizePx * 0.68
  if (/[a-z]/.test(value)) return fontSizePx * 0.58
  if (/\s/.test(value)) return fontSizePx * 0.34
  return fontSizePx * 0.62
}

function normalizeFont(font: TextFontSpec): Required<TextFontSpec> {
  return {
    family: font.family.trim() || 'sans-serif',
    sizePx: Math.max(1, font.sizePx),
    weight: normalizeFontWeight(font.weight),
    style: font.style ?? 'normal',
    letterSpacingPx: Math.max(0, font.letterSpacingPx ?? 0),
  }
}

function normalizeFontWeight(value: number | undefined): number {
  if (!Number.isFinite(value)) return 400
  return Math.max(1, Math.min(1000, Math.round(value!)))
}

function measurementCacheKey(text: string, font: Required<TextFontSpec>): string {
  return `${font.style}|${font.weight}|${font.sizePx.toFixed(3)}|${font.letterSpacingPx.toFixed(3)}|${font.family}|${text}`
}

function finiteOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, value!) : fallback
}
