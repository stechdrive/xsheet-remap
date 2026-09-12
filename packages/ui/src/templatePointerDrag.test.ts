import type { PointerEvent as ReactPointerEvent } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startTemplatePointerDrag } from './templatePointerDrag'

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren() })
function setup() {
  const target = document.createElement('button'); document.body.append(target)
  target.setPointerCapture = vi.fn(); target.releasePointerCapture = vi.fn()
  let queued: FrameRequestCallback | undefined
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { queued = callback; return 17 })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => { queued = undefined })
  const preview = vi.fn(), commit = vi.fn()
  const cancel = startTemplatePointerDrag({ currentTarget: target, pointerId: 9, clientX: 10, clientY: 20 } as unknown as ReactPointerEvent<Element>,
    (x, y) => ({ x, y, w: 5, h: 8 }), preview, commit)
  const send = (type: string, x: number, y: number, id = 9, receiver: EventTarget = window) => receiver.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: id }))
  return { target, preview, commit, cancel, send, frame: () => { const callback = queued; queued = undefined; callback?.(16) } }
}
describe('template drag transactions and preview work', () => {
  it('coalesces a burst into one live preview and commits the final pointer-up coordinates once', () => {
    const s = setup()
    try {
      for (let i = 0; i < 50; i++) s.send('pointermove', i, i + 1)
      expect(s.preview).toHaveBeenCalledTimes(1)
      expect(s.commit).not.toHaveBeenCalled()
      s.frame()
      expect(s.preview).toHaveBeenLastCalledWith({ x: 49, y: 50, w: 5, h: 8 })
      expect(s.preview).toHaveBeenCalledTimes(2)
      s.send('pointermove', 70, 80); s.send('pointerup', 90, 100); s.frame(); s.send('pointerup', 110, 120)
      expect(s.commit).toHaveBeenCalledExactlyOnceWith({ x: 90, y: 100, w: 5, h: 8 })
      expect(s.preview).toHaveBeenLastCalledWith(null)
    } finally { s.cancel() }
  })
  it.each(['pointercancel', 'lostpointercapture', 'blur', 'Escape', 'unmount'])('cancels %s without storing a draft or leaving listeners active', reason => {
    const s = setup()
    try {
      s.send('pointermove', 30, 40)
      if (reason === 'Escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      else if (reason === 'unmount') s.cancel()
      else if (reason === 'blur') window.dispatchEvent(new Event('blur'))
      else s.send(reason, 30, 40, 9, reason === 'lostpointercapture' ? s.target : window)
      const calls = s.preview.mock.calls.length
      s.frame(); s.send('pointermove', 100, 100); s.send('pointerup', 100, 100)
      expect(s.commit).not.toHaveBeenCalled()
      expect(s.preview).toHaveBeenLastCalledWith(null)
      expect(s.preview).toHaveBeenCalledTimes(calls)
      expect(s.target.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(9)
    } finally { s.cancel() }
  })
  it('ignores an unrelated pointer and its cancellation', () => {
    const s = setup()
    try {
      s.send('pointermove', 70, 80, 10); s.send('pointercancel', 70, 80, 10); s.send('pointerup', 70, 80, 10); s.frame()
      expect(s.preview).toHaveBeenCalledTimes(1); expect(s.commit).not.toHaveBeenCalled()
      s.send('pointerup', 30, 40)
      expect(s.commit).toHaveBeenCalledExactlyOnceWith({ x: 30, y: 40, w: 5, h: 8 })
    } finally { s.cancel() }
  })
})
