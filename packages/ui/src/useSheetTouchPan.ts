import { useEffect, useRef, type PointerEvent } from 'react'

export const SHEET_TOUCH_PAN_THRESHOLD_PX = 8

export interface SheetTouchTap {
  target: Element | null
  clientX: number
  clientY: number
}

interface SheetTouchPanSession {
  pointerId: number
  viewport: HTMLElement
  target: Element | null
  startX: number
  startY: number
  latestX: number
  latestY: number
  startScrollLeft: number
  startScrollTop: number
  moved: boolean
  suppressTap: boolean
  frameId: number | null
}

export function sheetTouchPanExceededThreshold(
  startX: number,
  startY: number,
  clientX: number,
  clientY: number,
  thresholdPx = SHEET_TOUCH_PAN_THRESHOLD_PX,
): boolean {
  return Math.hypot(clientX - startX, clientY - startY) >= thresholdPx
}

export function sheetTouchPanScrollPosition(
  startScrollLeft: number,
  startScrollTop: number,
  startX: number,
  startY: number,
  clientX: number,
  clientY: number,
): { scrollLeft: number; scrollTop: number } {
  return {
    scrollLeft: startScrollLeft - (clientX - startX),
    scrollTop: startScrollTop - (clientY - startY),
  }
}

export function isSheetTouchPanTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true
  return !target.closest([
    'button',
    'input',
    'select',
    'textarea',
    '[contenteditable="true"]',
    '.sheetContextMenu',
    '.timelineMemoTextEditor',
  ].join(','))
}

export function useSheetTouchPan({
  enabled,
  onTap,
  onBegin,
  onEnd,
}: {
  enabled: boolean
  onTap: (tap: SheetTouchTap) => void
  onBegin: () => void
  onEnd: () => void
}) {
  const sessionRef = useRef<SheetTouchPanSession | null>(null)
  const blockedPointerIdsRef = useRef(new Set<number>())
  const onTapRef = useRef(onTap)
  const onBeginRef = useRef(onBegin)
  const onEndRef = useRef(onEnd)

  useEffect(() => {
    onTapRef.current = onTap
    onBeginRef.current = onBegin
    onEndRef.current = onEnd
  }, [onTap, onBegin, onEnd])

  function cancelFrame(session: SheetTouchPanSession) {
    if (session.frameId === null) return
    window.cancelAnimationFrame(session.frameId)
    session.frameId = null
  }

  function applyScroll(session: SheetTouchPanSession) {
    cancelFrame(session)
    const next = sheetTouchPanScrollPosition(
      session.startScrollLeft,
      session.startScrollTop,
      session.startX,
      session.startY,
      session.latestX,
      session.latestY,
    )
    session.viewport.scrollLeft = next.scrollLeft
    session.viewport.scrollTop = next.scrollTop
  }

  function scheduleScroll(session: SheetTouchPanSession) {
    if (session.frameId !== null) return
    session.frameId = window.requestAnimationFrame(() => {
      if (sessionRef.current !== session) return
      applyScroll(session)
    })
  }

  function releasePointer(session: SheetTouchPanSession) {
    if (!session.viewport.hasPointerCapture?.(session.pointerId)) return
    try {
      session.viewport.releasePointerCapture(session.pointerId)
    } catch {
      // The browser can release implicit capture before React receives cancellation.
    }
  }

  function finish(pointerId: number, cancelled: boolean, clientX?: number, clientY?: number) {
    const session = sessionRef.current
    if (!session || session.pointerId !== pointerId) {
      blockedPointerIdsRef.current.delete(pointerId)
      return
    }
    if (clientX !== undefined) session.latestX = clientX
    if (clientY !== undefined) session.latestY = clientY
    if (session.moved) applyScroll(session)
    else cancelFrame(session)
    sessionRef.current = null
    releasePointer(session)
    if (session.moved) onEndRef.current()
    if (!cancelled && !session.moved && !session.suppressTap) {
      onTapRef.current({
        target: session.target,
        clientX: session.latestX,
        clientY: session.latestY,
      })
    }
  }

  useEffect(() => {
    function cancelActiveTouch() {
      const session = sessionRef.current
      if (!session) return
      if (session.frameId !== null) window.cancelAnimationFrame(session.frameId)
      sessionRef.current = null
      if (session.viewport.hasPointerCapture?.(session.pointerId)) {
        try {
          session.viewport.releasePointerCapture(session.pointerId)
        } catch {
          // The browser can release implicit capture before cancellation reaches the hook.
        }
      }
      if (session.moved) onEndRef.current()
      blockedPointerIdsRef.current.clear()
    }
    function handleVisibilityChange() {
      if (document.visibilityState !== 'visible') cancelActiveTouch()
    }
    window.addEventListener('blur', cancelActiveTouch)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('blur', cancelActiveTouch)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      cancelActiveTouch()
    }
  }, [])

  function stopTouchEvent(event: PointerEvent<HTMLElement>) {
    event.preventDefault()
    event.stopPropagation()
  }

  function handlePointerDownCapture(event: PointerEvent<HTMLElement>) {
    if (!enabled || event.pointerType !== 'touch' || event.button !== 0 || !isSheetTouchPanTarget(event.target)) return
    stopTouchEvent(event)
    const active = sessionRef.current
    if (active) {
      active.suppressTap = true
      blockedPointerIdsRef.current.add(event.pointerId)
      return
    }
    const viewport = event.currentTarget
    const target = event.target instanceof Element ? event.target : null
    const session: SheetTouchPanSession = {
      pointerId: event.pointerId,
      viewport,
      target,
      startX: event.clientX,
      startY: event.clientY,
      latestX: event.clientX,
      latestY: event.clientY,
      startScrollLeft: viewport.scrollLeft,
      startScrollTop: viewport.scrollTop,
      moved: false,
      suppressTap: false,
      frameId: null,
    }
    sessionRef.current = session
    try {
      viewport.setPointerCapture?.(event.pointerId)
    } catch {
      // Pointer capture is an optimization; implicit touch capture still preserves the stream.
    }
  }

  function handlePointerMoveCapture(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== 'touch') return
    if (blockedPointerIdsRef.current.has(event.pointerId)) {
      stopTouchEvent(event)
      return
    }
    const session = sessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    stopTouchEvent(event)
    session.latestX = event.clientX
    session.latestY = event.clientY
    if (!session.moved && sheetTouchPanExceededThreshold(
      session.startX,
      session.startY,
      event.clientX,
      event.clientY,
    )) {
      session.moved = true
      onBeginRef.current()
    }
    if (session.moved) scheduleScroll(session)
  }

  function handlePointerUpCapture(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== 'touch') return
    if (blockedPointerIdsRef.current.has(event.pointerId)) {
      stopTouchEvent(event)
      blockedPointerIdsRef.current.delete(event.pointerId)
      return
    }
    if (sessionRef.current?.pointerId !== event.pointerId) return
    stopTouchEvent(event)
    finish(event.pointerId, false, event.clientX, event.clientY)
  }

  function handlePointerCancelCapture(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== 'touch') return
    if (blockedPointerIdsRef.current.has(event.pointerId)) {
      blockedPointerIdsRef.current.delete(event.pointerId)
      return
    }
    finish(event.pointerId, true)
  }

  function handleLostPointerCapture(event: PointerEvent<HTMLElement>) {
    if (event.pointerType === 'touch') finish(event.pointerId, true)
  }

  return {
    handlePointerDownCapture,
    handlePointerMoveCapture,
    handlePointerUpCapture,
    handlePointerCancelCapture,
    handleLostPointerCapture,
  }
}
