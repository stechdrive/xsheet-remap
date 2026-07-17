import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SheetTransformHandle } from './SheetTransformHandle'

describe('SheetTransformHandle', () => {
  it('keeps a compact resize glyph inside a fixed screen-space hit area', () => {
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
    expect(hit?.getAttribute('width')).toBe(String(16 / 800))
    expect(hit?.getAttribute('height')).toBe(String(16 / 600))
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
