import { useEffect, type RefObject } from 'react'

type PointerDragInteraction = { pointerId: number } | null

export function useGlobalPointerDragLifecycle<TInteraction extends PointerDragInteraction>({
  activeRef,
  updateRef,
  finishRef,
}: {
  activeRef: RefObject<TInteraction>
  updateRef: RefObject<(pointerId: number, clientX: number, clientY: number, pressure?: number) => void>
  finishRef: RefObject<(pointerId: number, cancelled?: boolean, clientX?: number, clientY?: number) => void>
}) {
  useEffect(() => {
    const cancelFromKeyboard = (event: KeyboardEvent) => {
      const current = activeRef.current
      if (event.key !== 'Escape' || !current) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      finishRef.current(current.pointerId, true)
    }
    const cancelOnBlur = () => {
      const current = activeRef.current
      if (current) finishRef.current(current.pointerId, true)
    }
    const updateFromPointer = (event: globalThis.PointerEvent) => {
      const current = activeRef.current
      if (!current || current.pointerId !== event.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      if (event.buttons === 0) {
        updateRef.current(event.pointerId, event.clientX, event.clientY, event.pressure)
        finishRef.current(event.pointerId, false, event.clientX, event.clientY)
        return
      }
      updateRef.current(event.pointerId, event.clientX, event.clientY, event.pressure)
    }
    const finishFromPointer = (event: globalThis.PointerEvent) => {
      const current = activeRef.current
      if (!current || current.pointerId !== event.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      updateRef.current(event.pointerId, event.clientX, event.clientY, event.pressure)
      finishRef.current(event.pointerId, false, event.clientX, event.clientY)
    }
    const cancelFromPointer = (event: globalThis.PointerEvent) => {
      const current = activeRef.current
      if (!current || current.pointerId !== event.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      finishRef.current(event.pointerId, true, event.clientX, event.clientY)
    }
    const cancelStaleInteraction = () => {
      const current = activeRef.current
      if (current) finishRef.current(current.pointerId, true)
    }
    const cancelWhenHidden = () => {
      const current = activeRef.current
      if (document.hidden && current) finishRef.current(current.pointerId, true)
    }

    window.addEventListener('keydown', cancelFromKeyboard, true)
    window.addEventListener('blur', cancelOnBlur)
    window.addEventListener('pointermove', updateFromPointer, { capture: true, passive: false })
    window.addEventListener('pointerup', finishFromPointer, { capture: true, passive: false })
    window.addEventListener('pointercancel', cancelFromPointer, { capture: true, passive: false })
    window.addEventListener('pointerdown', cancelStaleInteraction, true)
    document.addEventListener('visibilitychange', cancelWhenHidden)
    return () => {
      window.removeEventListener('keydown', cancelFromKeyboard, true)
      window.removeEventListener('blur', cancelOnBlur)
      window.removeEventListener('pointermove', updateFromPointer, true)
      window.removeEventListener('pointerup', finishFromPointer, true)
      window.removeEventListener('pointercancel', cancelFromPointer, true)
      window.removeEventListener('pointerdown', cancelStaleInteraction, true)
      document.removeEventListener('visibilitychange', cancelWhenHidden)
    }
  }, [activeRef, finishRef, updateRef])
}
