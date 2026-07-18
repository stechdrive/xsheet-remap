import { describe, expect, it } from 'vitest'
import { timingEventSymbolGeometry } from './TimingEventSymbol'

describe('timing event symbol geometry', () => {
  it('keeps null-cell strokes inside the template grid cell and scales with it', () => {
    const smallRect = { x: 0.2, y: 0.3, w: 0.02, h: 0.01 }
    const largeRect = { x: 0.2, y: 0.3, w: 0.04, h: 0.02 }
    const small = timingEventSymbolGeometry('blank', smallRect)
    const large = timingEventSymbolGeometry('blank', largeRect)

    expect(small.lines).toHaveLength(2)
    for (const line of small.lines) {
      expect(Math.min(line.x1, line.x2)).toBeGreaterThan(smallRect.x)
      expect(Math.max(line.x1, line.x2)).toBeLessThan(smallRect.x + smallRect.w)
      expect(Math.min(line.y1, line.y2)).toBeGreaterThan(smallRect.y)
      expect(Math.max(line.y1, line.y2)).toBeLessThan(smallRect.y + smallRect.h)
    }
    expect(large.radiusX).toBeCloseTo(small.radiusX * 2)
    expect(large.radiusY).toBeCloseTo(small.radiusY * 2)
  })

  it('uses the same cell-relative footprint for inbetween and reverse symbols', () => {
    const rect = { x: 0.1, y: 0.2, w: 0.03, h: 0.015 }
    const inbetween = timingEventSymbolGeometry('inbetween', rect)
    const reverse = timingEventSymbolGeometry('reverse', rect)

    expect(reverse.center).toEqual(inbetween.center)
    expect(reverse.radiusX).toBe(inbetween.radiusX)
    expect(reverse.radiusY).toBe(inbetween.radiusY)
  })
})
