import type { NormalizedRect } from '@xsheet-remap/core'
import type { PointerEvent as ReactPointerEvent } from 'react'

/** Live previews are local; only a successful pointer-up commits an authoring transaction. */
export function startTemplatePointerDrag(event: ReactPointerEvent<Element>,
  rectAt: (x: number, y: number) => NormalizedRect,
  preview: (rect: NormalizedRect | null) => void,
  commit: (rect: NormalizedRect) => void) {
  const { pointerId, currentTarget: target } = event
  let x = event.clientX, y = event.clientY, frame = 0, finished = false
  const updatePreview = () => { frame = 0; preview(rectAt(x, y)) }
  const move = (next: PointerEvent) => {
    if (next.pointerId !== pointerId) return
    x = next.clientX; y = next.clientY
    if (!frame) frame = window.requestAnimationFrame(updatePreview)
  }
  const finish = (save: boolean) => {
    if (finished) return
    finished = true
    if (frame) window.cancelAnimationFrame(frame)
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', cancelPointer)
    window.removeEventListener('keydown', key, true)
    window.removeEventListener('blur', cancel)
    target.removeEventListener('lostpointercapture', cancelPointer)
    if (save) commit(rectAt(x, y))
    preview(null)
    if (target.releasePointerCapture && (!target.hasPointerCapture || target.hasPointerCapture(pointerId))) target.releasePointerCapture(pointerId)
  }
  const cancel = () => finish(false)
  const cancelPointer = (next: Event) => { if ((next as PointerEvent).pointerId === pointerId) cancel() }
  const up = (next: PointerEvent) => {
    if (next.pointerId !== pointerId) return
    x = next.clientX; y = next.clientY
    finish(true)
  }
  const key = (next: KeyboardEvent) => {
    if (next.key !== 'Escape') return
    next.preventDefault(); next.stopImmediatePropagation(); cancel()
  }
  target.setPointerCapture?.(pointerId)
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', cancelPointer)
  window.addEventListener('keydown', key, true)
  window.addEventListener('blur', cancel)
  target.addEventListener('lostpointercapture', cancelPointer)
  updatePreview()
  return cancel
}
