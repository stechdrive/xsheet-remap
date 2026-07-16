import { describe, expect, it, vi } from 'vitest'
import { createCanvasTextMeasurementProvider, splitTextGraphemes, textFontDeclaration } from './textMetrics'

describe('shared text measurement', () => {
  it('measures with a resolved font and caches identical requests', () => {
    const measureText = vi.fn((text: string) => ({
      width: text.length * 10,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
    }) as TextMetrics)
    const context = { font: '', measureText }
    const provider = createCanvasTextMeasurementProvider(() => context)
    const font = { family: 'Test Font, sans-serif', sizePx: 12, weight: 850, letterSpacingPx: 1 }

    expect(provider.measure('AB', font)).toEqual({ widthPx: 21, ascentPx: 8, descentPx: 2, exact: true })
    expect(provider.measure('AB', font).widthPx).toBe(21)
    expect(measureText).toHaveBeenCalledTimes(1)
    expect(context.font).toBe('normal 850 12px Test Font, sans-serif')
  })

  it('uses conservative grapheme-aware metrics when canvas measurement is unavailable', () => {
    const provider = createCanvasTextMeasurementProvider(() => null)
    const metrics = provider.measure('作画A', { family: 'sans-serif', sizePx: 10, weight: 700 })

    expect(metrics.exact).toBe(false)
    expect(metrics.widthPx).toBeCloseTo(26.8)
    expect(splitTextGraphemes('👨‍👩‍👧‍👦A')).toEqual(['👨‍👩‍👧‍👦', 'A'])
  })

  it('builds a stable CSS canvas font declaration', () => {
    expect(textFontDeclaration({ family: 'sans-serif', sizePx: 14, weight: 700, style: 'italic' }))
      .toBe('italic 700 14px sans-serif')
  })
})
