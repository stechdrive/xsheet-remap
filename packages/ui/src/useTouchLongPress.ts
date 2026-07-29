import { useEffect, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'

export const TOUCH_EDIT_LONG_PRESS_MS = 420
export const TOUCH_EDIT_MOVE_TOLERANCE_PX = 8

export interface TouchLongPressActivation {
  pointerId: number
  clientX: number
  clientY: number
  target: HTMLElement
}

interface PendingTouchLongPress {
  pointerId: number
  startX: number
  startY: number
  clientX: number
  clientY: number
  target: HTMLElement
  timerId: number
  activate: (activation: TouchLongPressActivation) => void
}

export function useTouchLongPress({
  delayMs = TOUCH_EDIT_LONG_PRESS_MS,
  moveTolerancePx = TOUCH_EDIT_MOVE_TOLERANCE_PX,
}: {
  delayMs?: number
  moveTolerancePx?: number
} = {}) {
  const pendingRef = useRef<PendingTouchLongPress | null>(null)
  const cleanupRef = useRef<() => void>(() => undefined)

  function removeListeners() {
    window.removeEventListener('pointermove', handlePointerMove, true)
    window.removeEventListener('pointerup', handlePointerEnd, true)
    window.removeEventListener('pointercancel', handlePointerEnd, true)
    window.removeEventListener('blur', cancel)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  }

  function cancel() {
    const pending = pendingRef.current
    if (!pending) return
    pendingRef.current = null
    window.clearTimeout(pending.timerId)
    removeListeners()
  }
  useLayoutEffect(() => {
    cleanupRef.current = cancel
  })

  function handlePointerMove(event: globalThis.PointerEvent) {
    const pending = pendingRef.current
    if (!pending || event.pointerId !== pending.pointerId) return
    pending.clientX = event.clientX
    pending.clientY = event.clientY
    if (Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY) >= moveTolerancePx) cancel()
  }

  function handlePointerEnd(event: globalThis.PointerEvent) {
    const pending = pendingRef.current
    if (!pending || event.pointerId !== pending.pointerId) return
    cancel()
  }

  function handleVisibilityChange() {
    if (document.visibilityState !== 'visible') cancel()
  }

  function begin(
    event: ReactPointerEvent<HTMLElement>,
    activate: (activation: TouchLongPressActivation) => void,
  ): boolean {
    if (event.pointerType !== 'touch' || event.button !== 0) return false
    cancel()
    const target = event.currentTarget
    const pending: PendingTouchLongPress = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY,
      target,
      timerId: 0,
      activate,
    }
    pending.timerId = window.setTimeout(() => {
      if (pendingRef.current !== pending) return
      pendingRef.current = null
      removeListeners()
      pending.activate({
        pointerId: pending.pointerId,
        clientX: pending.clientX,
        clientY: pending.clientY,
        target: pending.target,
      })
    }, delayMs)
    pendingRef.current = pending
    window.addEventListener('pointermove', handlePointerMove, true)
    window.addEventListener('pointerup', handlePointerEnd, true)
    window.addEventListener('pointercancel', handlePointerEnd, true)
    window.addEventListener('blur', cancel)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return true
  }

  useEffect(() => () => cleanupRef.current(), [])

  return {
    begin,
    cancel,
    pending: () => pendingRef.current !== null,
  }
}
