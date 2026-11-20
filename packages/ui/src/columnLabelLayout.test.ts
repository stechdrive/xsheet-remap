import { expect, it } from 'vitest'
import { columnLabelLayout, paperTrackLabelLayout } from './columnLabelLayout'
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

it('keeps short cell names horizontal and clips vertical overflow at whole graphemes within the available band', () => {
  expect(paperTrackLabelLayout('A', 30, 12, 50, 20, 84, 'bottom', metrics)).toEqual({ text: 'A', fontSizePx: 12 })
  const name = '口パク確認用ーか\u3099👨‍👩‍👧‍👧'
  const label = paperTrackLabelLayout(name, 36, 12, 50, 20, 84, 'bottom', metrics)
  expect(label.glyphs!.map(g => g.value).join('')).toBe(name)
  expect(label.glyphs![0].xPx).toBeGreaterThan(label.glyphs!.at(-1)!.xPx)
  const long = name.repeat(40)
  const clipped = paperTrackLabelLayout(long, 24, 12, 50, 20, 84, 'bottom', metrics)
  expect(clipped.text).toBe(long)
  expect(clipped.glyphs!.map(g => g.value)).toEqual(splitTextGraphemes(long).slice(0, clipped.glyphs!.length))
  expect(clipped.glyphs!.every(g => g.xPx >= 38 && g.xPx <= 62 && g.yPx > 20 && g.yPx <= 84)).toBe(true)
})
