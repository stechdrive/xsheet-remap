import { describe, expect, it } from 'vitest'
import { resolveMultilineFormTextLayout } from './formTextLayout'

const pageSize = { widthPx: 100, heightPx: 100 }
const rect = { x: 0, y: 0, w: 0.5, h: 0.5 }
const style = {
  fontSizePx: 16,
  minFontSizePx: 8,
  lineHeightPx: 20,
  paddingPx: 0,
  fontWeight: 400,
  horizontalAlign: 'left',
  verticalAlign: 'top',
  shrinkToFit: true,
  overflowX: 'clip',
  overflowY: 'clip',
} as const

describe('resolveMultilineFormTextLayout', () => {
  it('keeps the preferred template size while the text fits', () => {
    const layout = resolveMultilineFormTextLayout('メモ', rect, pageSize, style)

    expect(layout).toMatchObject({ fontSizePx: 16, lineHeightPx: 20, overflow: false })
    expect(layout.lines).toEqual(['メモ'])
  })

  it('shrinks wrapped text in both axes down to the largest fitting size', () => {
    const layout = resolveMultilineFormTextLayout('メ'.repeat(25), rect, pageSize, style)

    expect(layout.fontSizePx).toBeGreaterThanOrEqual(8)
    expect(layout.fontSizePx).toBeLessThan(16)
    expect(layout.overflow).toBe(false)
    expect(layout.contentHeightPx).toBeLessThanOrEqual(layout.availableHeightPx + 0.01)
  })

  it('reports overflow when the minimum template size still cannot fit', () => {
    const layout = resolveMultilineFormTextLayout('メ'.repeat(500), rect, pageSize, style)

    expect(layout.fontSizePx).toBe(8)
    expect(layout.overflow).toBe(true)
  })

  it('does not resize a field whose template disables shrink-to-fit', () => {
    const layout = resolveMultilineFormTextLayout('メ'.repeat(25), rect, pageSize, {
      ...style,
      shrinkToFit: false,
    })

    expect(layout.fontSizePx).toBe(16)
    expect(layout.overflow).toBe(true)
  })
})
