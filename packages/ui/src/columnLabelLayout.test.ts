import { expect, it } from 'vitest'
import { columnLabelLayout } from './columnLabelLayout'
import { splitTextGraphemes, type TextMeasurementProvider } from './textMetrics'

const metrics: TextMeasurementProvider = { measure: (text, font) => ({ widthPx: splitTextGraphemes(text).length * font.sizePx, ascentPx: font.sizePx * .8, descentPx: font.sizePx * .2, exact: true }) }
it('keeps short labels, shrinks longer ones, then ellipsizes without splitting graphemes or disappearing', () => {
  expect(columnLabelLayout('01', 30, 10, metrics)).toEqual({ text: '01', fontSizePx: 10 })
  expect(columnLabelLayout('ABCD', 30, 10, metrics)).toEqual({ text: 'ABCD', fontSizePx: 6.6 })
  for (const text of ['とても長いアニメーションフォルダー', 'か\u3099'.repeat(20), '👨‍👩‍👧‍👧'.repeat(20)]) {
    const result = columnLabelLayout(text, 30, 10, metrics)
    expect(result.text.endsWith('…')).toBe(true)
    expect(metrics.measure(result.text, { family: '', sizePx: result.fontSizePx }).widthPx).toBeLessThanOrEqual(26.4)
    expect(splitTextGraphemes(text).slice(0, splitTextGraphemes(result.text).length - 1).join('') + '…').toBe(result.text)
  }
  expect(columnLabelLayout('Long', 2, 10, metrics).text).toBe('…')
})
