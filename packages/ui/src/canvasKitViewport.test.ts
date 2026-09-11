import { describe, expect, it } from 'vitest'
import { containsPaperRect, planPaperViewport } from './canvasKitViewport'

describe('retained paper viewport', () => {
  it('reuses the same allocation across forward and reverse scrolling', () => {
    const first = planPaperViewport({ x: 0, y: 0, width: 900, height: 700 }, 1200, 4000, 1, 1, 2)
    for (const y of [16, 96, 300, 120, 0]) {
      expect(planPaperViewport({ x: 0, y, width: 900, height: 700 }, 1200, 4000, 1, 1, 2, first)).toBe(first)
    }
  })
  it('repositions at the viewport boundary while preserving backing dimensions', () => {
    const first = planPaperViewport({ x: 0, y: 0, width: 900, height: 700 }, 1200, 4000, 1, 1, 2)
    const visible = { x: 0, y: 1700, width: 900, height: 700 }
    const moved = planPaperViewport(visible, 1200, 4000, 1, 1, 2, first)
    expect(containsPaperRect(moved.rect, visible)).toBe(true)
    expect(moved).not.toBe(first)
    expect(moved.backingWidth).toBe(first.backingWidth)
    expect(moved.backingHeight).toBe(first.backingHeight)
  })
  it('bounds high DPI targets and recalculates when the rendering scale changes', () => {
    const visible = { x: 0, y: 0, width: 2700, height: 2000 }
    const plan = planPaperViewport(visible, 8000, 10000, 1, 1, 3)
    expect(plan.backingWidth * plan.backingHeight).toBeLessThanOrEqual(6_000_000)
    expect(containsPaperRect(plan.rect, visible)).toBe(true)
    expect(planPaperViewport(visible, 8000, 10000, 1.2, 1.2, 3, plan)).not.toBe(plan)
  })
  it('composes pinch previews from retained pixels, then restores native resolution at gesture end', () => {
    const first = planPaperViewport({ x: 0, y: 0, width: 800, height: 600 }, 1600, 4000, 1, 1, 2)
    const zoomed = { x: 60, y: 80, width: 800 / 1.5, height: 600 / 1.5 }
    expect(planPaperViewport(zoomed, 1600, 4000, 1.5, 1.5, 2, first, true)).toBe(first)
    const committed = planPaperViewport(zoomed, 1600, 4000, 1.5, 1.5, 2, first)
    expect(committed).not.toBe(first)
    expect(committed.scaleX).toBe(1.5)
    const exposed = { ...zoomed, y: 2600 }
    expect(containsPaperRect(planPaperViewport(exposed, 1600, 4000, 1.5, 1.5, 2, first, true).rect, exposed)).toBe(true)
  })
})
