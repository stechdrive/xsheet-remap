// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { timingHitForFrame, standardA3SheetTemplate } from '@xsheet-remap/core'
import { avoidNativeFileDragPreview, clearNativeFileDragPreview, subscribeNativeFileDragPreview, updateNativeFileDragPreview } from './nativeFileDragPreview'

afterEach(() => { clearNativeFileDragPreview(); vi.restoreAllMocks(); vi.useRealTimers() })

it('retains native filenames on pathless moves, protects the destination and clears feedback on cancel/drop', () => {
  vi.useFakeTimers()
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => window.setTimeout(() => callback(0), 16))
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => window.clearTimeout(id))
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 160, height: 55 } as DOMRect)
  const changed = vi.fn(), unsubscribe = subscribeNativeFileDragPreview(changed)
  const hit = timingHitForFrame(standardA3SheetTemplate, 'cell', 'A', 11)!
  const point = { x: 90, y: 100 }
  updateNativeFileDragPreview({ type: 'enter', paths: ['C:\\fixtures\\001.png', 'C:\\fixtures\\002.png'] }, point, hit, true)
  const ghost = document.querySelector<HTMLElement>('.nativeFileDragPreview')!
  expect(ghost.textContent).toBe('001.png2件')
  updateNativeFileDragPreview({ type: 'over' }, point, hit, true)
  expect(document.querySelector('.nativeFileDragPreview')).toBe(ghost)
  avoidNativeFileDragPreview({ left: 70, top: 80, right: 210, bottom: 150 })
  vi.runAllTimers()
  expect(ghost.style.transform).toBe('translate3d(218px, 158px, 0)')
  expect(changed).toHaveBeenLastCalledWith({ hit, valid: true })
  for (const type of ['leave', 'drop'] as const) {
    updateNativeFileDragPreview({ type }, point, hit, true)
    expect(document.querySelector('.nativeFileDragPreview')).toBeNull()
    expect(changed).toHaveBeenLastCalledWith(null)
    updateNativeFileDragPreview({ type: 'enter', paths: ['new.png'] }, point, null, false)
    expect(document.querySelector('.nativeFileDragPreview')?.textContent).toBe('new.png')
    expect(changed).toHaveBeenLastCalledWith({ hit: null, valid: false })
  }
  unsubscribe()
})
