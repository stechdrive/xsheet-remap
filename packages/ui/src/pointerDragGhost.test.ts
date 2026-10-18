import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPointerDragGhost, positionDragPreview } from './pointerDragGhost'

const originalRequestAnimationFrame = window.requestAnimationFrame
const originalCancelAnimationFrame = window.cancelAnimationFrame

afterEach(() => {
  window.requestAnimationFrame = originalRequestAnimationFrame
  window.cancelAnimationFrame = originalCancelAnimationFrame
  document.querySelectorAll('.pointerDragGhost').forEach(element => element.remove())
  vi.restoreAllMocks()
})

function installImmediateAnimationFrame() {
  window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    callback(0)
    return 1
  }
  window.cancelAnimationFrame = () => undefined
}

function fixedRect(width: number, height: number): DOMRect {
  return {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
  }
}

describe('createPointerDragGhost', () => {
  it.each([
    { x: 100, y: 400 }, { x: 1420, y: 400 }, { x: 700, y: 8 }, { x: 700, y: 985 },
    { x: 1430, y: 990 }, { x: 8, y: 990 },
  ])('keeps an enlarged target cell and pointer readable at $x,$y', pointer => {
    const size = { width: 156, height: 36 }
    const target = { left: pointer.x - 45, right: pointer.x + 45, top: pointer.y - 32, bottom: pointer.y + 32 }
    const position = positionDragPreview(pointer, size, { width: 1440, height: 1000 }, target)!
    expect(position).not.toBeNull()
    expect(position.x).toBeGreaterThanOrEqual(8)
    expect(position.y).toBeGreaterThanOrEqual(8)
    expect(position.x + size.width).toBeLessThanOrEqual(1432)
    expect(position.y + size.height).toBeLessThanOrEqual(992)
    expect(position.x + size.width <= target.left - 8 || position.x >= target.right + 8
      || position.y + size.height <= target.top - 8 || position.y >= target.bottom + 8).toBe(true)
  })

  it('does not clamp a large status card back over the pointer near the bottom right', () => {
    const position = positionDragPreview({ x: 320, y: 250 }, { width: 300, height: 96 }, { width: 360, height: 300 })!
    expect(position.y + 96).toBeLessThanOrEqual(234)
    expect(position.x).toBeGreaterThanOrEqual(8)
  })

  it('prioritizes the target when there is no room for a floating preview', () => {
    expect(positionDragPreview({ x: 100, y: 80 }, { width: 180, height: 120 }, { width: 200, height: 160 })).toBeNull()
  })

  it('keeps the ghost clear of the pointer for precise drop targeting', () => {
    installImmediateAnimationFrame()
    const element = document.createElement('div')
    element.getBoundingClientRect = () => fixedRect(114, 92)

    const ghost = createPointerDragGhost(element, 120, 80)

    expect(element.classList.contains('pointerDragGhost')).toBe(true)
    expect(element.style.transform).toBe('translate3d(140px, 96px, 0)')

    ghost.dispose()
    expect(document.querySelector('.pointerDragGhost')).toBeNull()
  })

  it('keeps the ghost near the pointer when it flips at the viewport edge', () => {
    installImmediateAnimationFrame()
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(240)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(180)
    const element = document.createElement('div')
    element.getBoundingClientRect = () => fixedRect(114, 92)

    const ghost = createPointerDragGhost(element, 230, 170)

    expect(element.style.transform).toBe('translate3d(96px, 62px, 0)')
    ghost.dispose()
  })
})
