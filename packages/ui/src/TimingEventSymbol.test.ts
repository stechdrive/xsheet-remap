import { describe, expect, it } from 'vitest'
import { timingEventSymbolGeometry } from './TimingEventSymbol'

describe('timing event symbol geometry', () => {
  const pageSize = { widthPx: 1000, heightPx: 2000 }
  it('keeps null-cell strokes inside the template grid cell and scales with it', () => {
    const smallRect = { x: 0.2, y: 0.3, w: 0.02, h: 0.01 }
    const largeRect = { x: 0.2, y: 0.3, w: 0.04, h: 0.02 }
    const small = timingEventSymbolGeometry('blank', smallRect, pageSize)
    const large = timingEventSymbolGeometry('blank', largeRect, pageSize)

    expect(small.lines).toHaveLength(2)
    for (const line of small.lines) {
      expect(Math.min(line.x1, line.x2)).toBeGreaterThan(smallRect.x * pageSize.widthPx)
      expect(Math.max(line.x1, line.x2)).toBeLessThan((smallRect.x + smallRect.w) * pageSize.widthPx)
      expect(Math.min(line.y1, line.y2)).toBeGreaterThan(smallRect.y * pageSize.heightPx)
      expect(Math.max(line.y1, line.y2)).toBeLessThan((smallRect.y + smallRect.h) * pageSize.heightPx)
    }
    expect(large.radiusX).toBeCloseTo(small.radiusX * 2)
    expect(large.radiusY).toBeCloseTo(small.radiusY * 2)
  })

  it('uses the same cell-relative footprint for inbetween and reverse symbols', () => {
    const rect = { x: 0.1, y: 0.2, w: 0.03, h: 0.015 }
    const inbetween = timingEventSymbolGeometry('inbetween', rect, pageSize)
    const reverse = timingEventSymbolGeometry('reverse', rect, pageSize)

    expect(reverse.center).toEqual(inbetween.center)
    expect(reverse.radiusX).toBe(inbetween.radiusX)
    expect(reverse.radiusY).toBe(inbetween.radiusY)
  })
  for (const [widthPx, heightPx] of [[1200, 2400], [4000, 1000], [2480, 3508]]) {
    for (const [w, h] of [[90, 20], [20, 90], [35, 35]]) {
      it(`keeps a small round symbol in a ${w}x${h} cell on ${widthPx}x${heightPx}`, () => {
        const rect = { x: .2, y: .3, w: w / widthPx, h: h / heightPx }
        for (const kind of ['inbetween', 'reverse'] as const) {
          const g = timingEventSymbolGeometry(kind, rect, { widthPx, heightPx })
          expect(g.radiusX).toBe(g.radiusY)
          expect(g.radiusX * 2 + g.strokeWidth).toBeCloseTo(Math.min(w, h) * .45)
          expect(g.center.x).toBeCloseTo(.2 * widthPx + w / 2)
          expect(g.center.y).toBeCloseTo(.3 * heightPx + h / 2)
        }
      })
    }
  }
})
