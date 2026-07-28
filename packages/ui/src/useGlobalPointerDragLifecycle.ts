import { useLayoutEffect, type RefObject } from 'react'

type PointerDragInteraction = { pointerId: number } | null

export function useGlobalPointerDragLifecycle<TInteraction extends PointerDragInteraction>({
  active,
  activeRef,
  updateRef,
  updateEventRef,
  finishRef,
  preferRawUpdates = false,
}: {
  active: boolean
  activeRef: RefObject<TInteraction>
  updateRef?: RefObject<(pointerId: number, clientX: number, clientY: number, pressure?: number) => void>
  updateEventRef?: RefObject<(event: globalThis.PointerEvent) => void>
  finishRef: RefObject<(pointerId: number, cancelled?: boolean, clientX?: number, clientY?: number) => void>
  preferRawUpdates?: boolean
}) {
  useLayoutEffect(() => {
    if (!active) return
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
      const update = () => {
        if (updateEventRef) updateEventRef.current(event)
        else updateRef?.current(event.pointerId, event.clientX, event.clientY, event.pressure)
      }
      if (event.buttons === 0) {
        update()
        finishRef.current(event.pointerId, false, event.clientX, event.clientY)
        return
      }
      update()
    }
    const finishFromPointer = (event: globalThis.PointerEvent) => {
      const current = activeRef.current
      if (!current || current.pointerId !== event.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      if (updateEventRef) updateEventRef.current(event)
      else updateRef?.current(event.pointerId, event.clientX, event.clientY, event.pressure)
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
    if (preferRawUpdates && 'onpointerrawupdate' in window) {
      window.addEventListener('pointerrawupdate', updateFromPointer as EventListener, { capture: true, passive: false })
    }
    window.addEventListener('pointerup', finishFromPointer, { capture: true, passive: false })
    window.addEventListener('pointercancel', cancelFromPointer, { capture: true, passive: false })
    window.addEventListener('pointerdown', cancelStaleInteraction, true)
    document.addEventListener('visibilitychange', cancelWhenHidden)
    return () => {
      window.removeEventListener('keydown', cancelFromKeyboard, true)
      window.removeEventListener('blur', cancelOnBlur)
      window.removeEventListener('pointermove', updateFromPointer, true)
      if (preferRawUpdates && 'onpointerrawupdate' in window) {
        window.removeEventListener('pointerrawupdate', updateFromPointer as EventListener, true)
      }
      window.removeEventListener('pointerup', finishFromPointer, true)
      window.removeEventListener('pointercancel', cancelFromPointer, true)
      window.removeEventListener('pointerdown', cancelStaleInteraction, true)
      document.removeEventListener('visibilitychange', cancelWhenHidden)
    }
  }, [active, activeRef, finishRef, preferRawUpdates, updateEventRef, updateRef])
}
