import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SheetTransformHandle } from './SheetTransformHandle'

describe('SheetTransformHandle', () => {
  it('keeps a compact resize glyph inside a fixed screen-space hit area centered on the corner', () => {
    const { container } = render(
      <svg viewBox="0 0 1 1">
        <SheetTransformHandle
          rect={{ x: 0.2, y: 0.3, w: 0.4, h: 0.5 }}
          surface={{ widthPx: 800, heightPx: 600 }}
          kind="resize"
          label="大きさを変更"
          onPointerDown={vi.fn()}
        />
      </svg>,
    )
    const hit = container.querySelector('.sheetTransformHandleHitArea')
    const visual = container.querySelector('.sheetTransformHandleResizeVisual')
    const x = Number(hit?.getAttribute('x'))
    const y = Number(hit?.getAttribute('y'))
    const width = Number(hit?.getAttribute('width'))
    const height = Number(hit?.getAttribute('height'))
    expect(width).toBe(24 / 800)
    expect(height).toBe(24 / 600)
    expect(x).toBeCloseTo(0.6 - width / 2)
    expect(y).toBeCloseTo(0.8 - height / 2)
    expect(x).toBeLessThan(0.6)
    expect(x + width).toBeGreaterThan(0.6)
    expect(y).toBeLessThan(0.8)
    expect(y + height).toBeGreaterThan(0.8)
    expect(visual?.tagName.toLowerCase()).toBe('path')
    expect(container.querySelector('.sheetTransformHandle.resize')).toBeTruthy()
  })

  it('uses the same primitive for a move grip', () => {
    const { container } = render(
      <svg viewBox="0 0 1 1">
        <SheetTransformHandle
          rect={{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }}
          surface={{ widthPx: 1000, heightPx: 1000 }}
          kind="move"
          label="移動"
          onPointerDown={vi.fn()}
        />
      </svg>,
    )
    expect(container.querySelector('.sheetTransformHandleMoveVisual')).toBeTruthy()
    expect(container.querySelectorAll('.sheetTransformHandleMoveGrip')).toHaveLength(3)
  })
})
