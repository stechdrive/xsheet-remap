import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPointerDragGhost } from './pointerDragGhost'

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
