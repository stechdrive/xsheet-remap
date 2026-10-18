import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultProject } from '@xsheet-remap/core'
import { ProcessSettingsDialog } from './ProcessSettingsDialog'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function setup() {
  const apply = vi.fn()
  const view = render(<ProcessSettingsDialog project={createDefaultProject()} onApply={apply} onClose={vi.fn()} />)
  const handles = screen.getAllByRole('button', { name: /をドラッグして/ })
  for (const handle of handles) {
    handle.setPointerCapture = vi.fn(); handle.hasPointerCapture = () => false
  }
  const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-process-layer-row-index]'))
  rows.forEach((row, index) => vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ top: 100 + index * 40, bottom: 140 + index * 40, height: 40 } as DOMRect))
  const names = () => Array.from(document.querySelectorAll<HTMLInputElement>('[data-process-layer-row-index] input:first-of-type')).map(input => input.value)
  const before = names()
  fireEvent.pointerDown(handles[0], { button: 0, pointerId: 1, clientX: 100, clientY: 110 })
  fireEvent.pointerMove(handles[0], { pointerId: 1, clientX: 100, clientY: 700 })
  expect(document.querySelector('.pointerDragGhost')?.textContent).toContain(before[0])
  return { ...view, apply, handle: handles[0], before, names }
}

describe('process order drag feedback', () => {
  it.each(['Escape', 'pointercancel', 'lostpointercapture', 'blur'])('removes its ghost and preserves order on %s', cancellation => {
    const { apply, handle, before, names } = setup()
    if (cancellation === 'Escape') fireEvent.keyDown(window, { key: 'Escape' })
    else if (cancellation === 'blur') fireEvent.blur(window)
    else fireEvent(handle, new PointerEvent(cancellation, { pointerId: 1, bubbles: true }))
    fireEvent.pointerUp(handle, { pointerId: 1 })
    expect(document.querySelector('.pointerDragGhost')).toBeNull()
    expect(names()).toEqual(before)
    expect(apply).not.toHaveBeenCalled()
  })

  it('previews the source name, changes only the draft order on drop and cleans up on close', () => {
    const { apply, handle, before, names, unmount } = setup()
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 700 })
    expect(names()).toEqual([...before.slice(1), before[0]])
    expect(document.querySelector('.pointerDragGhost')).toBeNull()
    expect(apply).not.toHaveBeenCalled()
    fireEvent.pointerDown(handle, { button: 0, pointerId: 2, clientX: 100, clientY: 110 })
    unmount()
    expect(document.querySelector('.pointerDragGhost')).toBeNull()
  })
})
