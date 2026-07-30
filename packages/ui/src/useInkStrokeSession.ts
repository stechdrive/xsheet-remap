import {
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react'

export interface InkStrokeSession {
  pointerId: number
}

export interface InkPointerPoint {
  pointerId: number
  clientX: number
  clientY: number
  pressure: number
  timeStamp: number
}

export interface InkStrokeFinish extends InkPointerPoint {
  cancelled: boolean
}

export type InkPointerInputMode = 'pointermove' | 'pointerrawupdate'

type InkPointerCapabilities = {
  supportsRawUpdates: boolean
}

type ActiveCapture = {
  pointerId: number
  element: Element
}

function pointerPoint(
  event: globalThis.PointerEvent,
  sample: globalThis.PointerEvent,
): InkPointerPoint {
  return {
    pointerId: event.pointerId,
    clientX: sample.clientX,
    clientY: sample.clientY,
    pressure: sample.pressure,
    timeStamp: sample.timeStamp,
  }
}

export function actualInkPointsFromEvent(
  event: globalThis.PointerEvent,
): InkPointerPoint[] {
  if (typeof event.getCoalescedEvents === 'function') {
    try {
      const coalesced = event.getCoalescedEvents()
      if (coalesced.length > 0) {
        return coalesced.map(sample => pointerPoint(event, sample))
      }
    } catch {
      // Some embedded engines expose the method without a usable implementation.
    }
  }
  return [pointerPoint(event, event)]
}

export function predictedInkPointsFromEvent(
  event: globalThis.PointerEvent,
): InkPointerPoint[] {
  if (
    event.type !== 'pointermove'
    || event.pointerType !== 'pen'
    || typeof event.getPredictedEvents !== 'function'
  ) return []
  try {
    return event.getPredictedEvents().map(sample => pointerPoint(event, sample))
  } catch {
    return []
  }
}

export function resolveInkPointerInputMode(
  event: Pick<globalThis.PointerEvent, 'getPredictedEvents' | 'pointerType'>,
  capabilities: InkPointerCapabilities = {
    supportsRawUpdates: typeof window !== 'undefined' && 'onpointerrawupdate' in window,
  },
): InkPointerInputMode {
  const supportsPrediction = typeof event.getPredictedEvents === 'function'
  return event.pointerType === 'pen' && !supportsPrediction && capabilities.supportsRawUpdates
    ? 'pointerrawupdate'
    : 'pointermove'
}

export function useInkStrokeSession<TSession extends InkStrokeSession>({
  onActualPoints,
  onPredictedPoints,
  onPointerEvent,
  onActiveChange,
  onFinish,
}: {
  onActualPoints: (session: TSession, points: readonly InkPointerPoint[]) => TSession
  onPredictedPoints?: (session: TSession, points: readonly InkPointerPoint[]) => void
  onPointerEvent?: (event: globalThis.PointerEvent) => void
  onActiveChange?: (active: boolean) => void
  onFinish: (session: TSession, finish: InkStrokeFinish) => void
}) {
  const activeRef = useRef<TSession | null>(null)
  const captureRef = useRef<ActiveCapture | null>(null)
  const inputModeRef = useRef<InkPointerInputMode>('pointermove')
  const activePointerTypeRef = useRef('')
  const lastActualPointRef = useRef<InkPointerPoint | null>(null)
  const moveListenerRef = useRef<{
    type: InkPointerInputMode
    listener: EventListener
  } | null>(null)
  const optionsRef = useRef({
    onActualPoints,
    onPredictedPoints,
    onPointerEvent,
    onActiveChange,
    onFinish,
  })
  const updateEventRef = useRef<(event: globalThis.PointerEvent, final?: boolean) => void>(() => undefined)
  const finishRef = useRef<(
    pointerId: number,
    cancelled?: boolean,
    clientX?: number,
    clientY?: number,
  ) => void>(() => undefined)

  function detachMoveListener() {
    const registered = moveListenerRef.current
    if (!registered) return
    window.removeEventListener(registered.type, registered.listener, true)
    moveListenerRef.current = null
  }

  function attachMoveListener(mode: InkPointerInputMode) {
    detachMoveListener()
    const listener = ((event: globalThis.PointerEvent) => {
      const current = activeRef.current
      if (!current || current.pointerId !== event.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      updateEventRef.current(event)
      if (event.buttons === 0) {
        finishRef.current(event.pointerId, false, event.clientX, event.clientY)
      }
    }) as EventListener
    window.addEventListener(mode, listener, { capture: true, passive: false })
    moveListenerRef.current = { type: mode, listener }
  }

  function releaseCapture(pointerId: number) {
    const capture = captureRef.current
    if (!capture || capture.pointerId !== pointerId) return
    captureRef.current = null
    try {
      if (capture.element.hasPointerCapture?.(pointerId)) capture.element.releasePointerCapture?.(pointerId)
    } catch {
      // The target may have been replaced or detached while the stroke was active.
    }
  }

  useLayoutEffect(() => {
    optionsRef.current = {
      onActualPoints,
      onPredictedPoints,
      onPointerEvent,
      onActiveChange,
      onFinish,
    }
    updateEventRef.current = (event, final = false) => {
      const current = activeRef.current
      if (!current || current.pointerId !== event.pointerId) return
      optionsRef.current.onPointerEvent?.(event)
      const actualPoints = actualInkPointsFromEvent(event).filter(point => {
        const previous = lastActualPointRef.current
        if (!previous) return true
        if (point.timeStamp < previous.timeStamp) return false
        return point.timeStamp !== previous.timeStamp
          || point.clientX !== previous.clientX
          || point.clientY !== previous.clientY
          || point.pressure !== previous.pressure
      })
      let next = current
      if (actualPoints.length > 0) {
        lastActualPointRef.current = actualPoints[actualPoints.length - 1]!
        next = optionsRef.current.onActualPoints(current, actualPoints)
        activeRef.current = next
      }
      optionsRef.current.onPredictedPoints?.(
        next,
        final ? [] : predictedInkPointsFromEvent(event),
      )
    }
    finishRef.current = (pointerId, cancelled = false, clientX, clientY) => {
      const current = activeRef.current
      if (!current || current.pointerId !== pointerId) return
      activeRef.current = null
      activePointerTypeRef.current = ''
      lastActualPointRef.current = null
      detachMoveListener()
      releaseCapture(pointerId)
      optionsRef.current.onActiveChange?.(false)
      optionsRef.current.onPredictedPoints?.(current, [])
      optionsRef.current.onFinish(current, {
        pointerId,
        clientX: clientX ?? Number.NaN,
        clientY: clientY ?? Number.NaN,
        pressure: 0,
        timeStamp: Number.NaN,
        cancelled,
      })
    }
  })

  useEffect(() => {
    const cancelFromKeyboard = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const current = activeRef.current
      if (current) finishRef.current(current.pointerId, true)
    }
    const cancelOnBlur = () => {
      const current = activeRef.current
      if (current) finishRef.current(current.pointerId, true)
    }
    const finishFromPointer = (event: globalThis.PointerEvent) => {
      const current = activeRef.current
      if (!current || current.pointerId !== event.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      updateEventRef.current(event, true)
      finishRef.current(event.pointerId, false, event.clientX, event.clientY)
    }
    const cancelFromPointer = (event: globalThis.PointerEvent) => {
      const current = activeRef.current
      if (!current || current.pointerId !== event.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      finishRef.current(event.pointerId, true, event.clientX, event.clientY)
    }
    const cancelStaleInteraction = (event: globalThis.PointerEvent) => {
      const current = activeRef.current
      if (!current || event.pointerId === current.pointerId) return
      if (activePointerTypeRef.current === 'pen' && event.pointerType === 'touch') return
      finishRef.current(current.pointerId, true)
    }
    const cancelWhenHidden = () => {
      const current = activeRef.current
      if (document.hidden && current) finishRef.current(current.pointerId, true)
    }

    window.addEventListener('keydown', cancelFromKeyboard, true)
    window.addEventListener('blur', cancelOnBlur)
    window.addEventListener('pointerup', finishFromPointer, { capture: true, passive: false })
    window.addEventListener('pointercancel', cancelFromPointer, { capture: true, passive: false })
    window.addEventListener('pointerdown', cancelStaleInteraction, true)
    document.addEventListener('visibilitychange', cancelWhenHidden)
    return () => {
      detachMoveListener()
      window.removeEventListener('keydown', cancelFromKeyboard, true)
      window.removeEventListener('blur', cancelOnBlur)
      window.removeEventListener('pointerup', finishFromPointer, true)
      window.removeEventListener('pointercancel', cancelFromPointer, true)
      window.removeEventListener('pointerdown', cancelStaleInteraction, true)
      document.removeEventListener('visibilitychange', cancelWhenHidden)
      const current = activeRef.current
      if (!current) return
      activeRef.current = null
      releaseCapture(current.pointerId)
      optionsRef.current.onActiveChange?.(false)
    }
  }, [])

  function begin(
    session: TSession,
    captureElement: Element | null | undefined,
    event: globalThis.PointerEvent,
  ): InkPointerInputMode {
    const current = activeRef.current
    if (current) finishRef.current(current.pointerId, true)
    const inputMode = resolveInkPointerInputMode(event)
    inputModeRef.current = inputMode
    lastActualPointRef.current = pointerPoint(event, event)
    activeRef.current = session
    activePointerTypeRef.current = event.pointerType
    attachMoveListener(inputMode)
    if (captureElement) {
      captureRef.current = { pointerId: session.pointerId, element: captureElement }
      try {
        captureElement.setPointerCapture?.(session.pointerId)
      } catch {
        // Global lifecycle listeners keep the session valid without pointer capture.
      }
    }
    optionsRef.current.onActiveChange?.(true)
    return inputMode
  }

  function cancel() {
    const current = activeRef.current
    if (current) finishRef.current(current.pointerId, true)
  }

  return {
    activeRef,
    inputModeRef,
    begin,
    cancel,
  }
}
