import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useGlobalPointerDragLifecycle } from './useGlobalPointerDragLifecycle'

export interface PointerDragSession {
  pointerId: number
}

export interface PointerDragPoint {
  pointerId: number
  clientX: number
  clientY: number
  pressure: number
  timeStamp: number
}

export interface PointerDragFinish extends PointerDragPoint {
  cancelled: boolean
}

export type PointerDragPreviewMode = 'immediate' | 'animation-frame' | 'none'
export type PointerDragSampleMode = 'latest' | 'coalesced'

export function usePointerDragSession<TSession extends PointerDragSession>({
  onUpdate,
  onUpdateBatch,
  onPointerEvent,
  onFinish,
  previewMode = 'immediate',
  sampleMode = 'latest',
  preferRawUpdates = false,
}: {
  onUpdate?: (session: TSession, point: PointerDragPoint) => TSession
  onUpdateBatch?: (session: TSession, points: readonly PointerDragPoint[]) => TSession
  onPointerEvent?: (event: globalThis.PointerEvent) => void
  onFinish: (session: TSession, finish: PointerDragFinish) => void
  previewMode?: PointerDragPreviewMode
  sampleMode?: PointerDragSampleMode
  preferRawUpdates?: boolean
}) {
  const [active, setActiveState] = useState<TSession | null>(null)
  const activeRef = useRef<TSession | null>(null)
  const captureRef = useRef<{ pointerId: number; element: Element } | null>(null)
  const previewFrameRef = useRef<number | null>(null)
  const lastSampleRef = useRef<PointerDragPoint | null>(null)
  const optionsRef = useRef({
    onUpdate,
    onUpdateBatch,
    onPointerEvent,
    onFinish,
    previewMode,
    sampleMode,
  })
  const updateEventRef = useRef<(event: globalThis.PointerEvent) => void>(() => undefined)
  const finishRef = useRef<(pointerId: number, cancelled?: boolean, clientX?: number, clientY?: number) => void>(() => undefined)

  function cancelPreviewFrame() {
    if (previewFrameRef.current === null) return
    window.cancelAnimationFrame(previewFrameRef.current)
    previewFrameRef.current = null
  }

  function publishPreview(next: TSession) {
    if (optionsRef.current.previewMode === 'none') return
    if (optionsRef.current.previewMode === 'immediate') {
      setActiveState(next)
      return
    }
    if (previewFrameRef.current !== null) return
    previewFrameRef.current = window.requestAnimationFrame(() => {
      previewFrameRef.current = null
      setActiveState(activeRef.current)
    })
  }

  function releaseCapture(pointerId: number) {
    const capture = captureRef.current
    if (!capture || capture.pointerId !== pointerId) return
    captureRef.current = null
    try {
      if (capture.element.hasPointerCapture?.(pointerId)) capture.element.releasePointerCapture?.(pointerId)
    } catch {
      // React may have replaced the original drag target before the session ends.
    }
  }

  useLayoutEffect(() => {
    optionsRef.current = {
      onUpdate,
      onUpdateBatch,
      onPointerEvent,
      onFinish,
      previewMode,
      sampleMode,
    }
    updateEventRef.current = event => {
      const current = activeRef.current
      if (!current || current.pointerId !== event.pointerId) return
      optionsRef.current.onPointerEvent?.(event)
      const samples = pointerDragPointsFromEvent(event, optionsRef.current.sampleMode)
        .filter(point => {
          const previous = lastSampleRef.current
          if (!previous) return true
          if (point.timeStamp < previous.timeStamp) return false
          return point.timeStamp !== previous.timeStamp
            || point.clientX !== previous.clientX
            || point.clientY !== previous.clientY
            || point.pressure !== previous.pressure
        })
      if (samples.length === 0) return
      lastSampleRef.current = samples[samples.length - 1]!
      let next = current
      if (optionsRef.current.onUpdateBatch) {
        next = optionsRef.current.onUpdateBatch(current, samples)
      } else if (optionsRef.current.onUpdate) {
        for (const point of samples) next = optionsRef.current.onUpdate(next, point)
      }
      activeRef.current = next
      publishPreview(next)
    }
    finishRef.current = (pointerId, cancelled = false, clientX, clientY) => {
      const current = activeRef.current
      if (!current || current.pointerId !== pointerId) return
      activeRef.current = null
      cancelPreviewFrame()
      releaseCapture(pointerId)
      setActiveState(null)
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

  useGlobalPointerDragLifecycle({
    active: active !== null,
    activeRef,
    updateEventRef,
    finishRef,
    preferRawUpdates,
  })

  useEffect(() => () => {
    cancelPreviewFrame()
    const current = activeRef.current
    if (!current) return
    activeRef.current = null
    releaseCapture(current.pointerId)
  }, [])

  function begin(session: TSession, captureElement?: Element | null) {
    const current = activeRef.current
    if (current) finishRef.current(current.pointerId, true)
    cancelPreviewFrame()
    lastSampleRef.current = null
    activeRef.current = session
    setActiveState(session)
    if (!captureElement) return
    captureRef.current = { pointerId: session.pointerId, element: captureElement }
    try {
      captureElement.setPointerCapture?.(session.pointerId)
    } catch {
      // Global listeners keep the session valid when pointer capture is unavailable.
    }
  }

  function cancel() {
    const current = activeRef.current
    if (current) finishRef.current(current.pointerId, true)
  }

  return {
    active,
    activeRef,
    begin,
    cancel,
  }
}

export function pointerDragPointsFromEvent(
  event: globalThis.PointerEvent,
  sampleMode: PointerDragSampleMode,
): PointerDragPoint[] {
  let events: readonly globalThis.PointerEvent[] = [event]
  if (sampleMode === 'coalesced' && typeof event.getCoalescedEvents === 'function') {
    const coalesced = event.getCoalescedEvents()
    if (coalesced.length > 0) {
      const last = coalesced[coalesced.length - 1]
      events = last
        && last.clientX === event.clientX
        && last.clientY === event.clientY
        && last.timeStamp === event.timeStamp
        ? coalesced
        : [...coalesced, event]
    }
  }
  return events.map(sample => ({
    pointerId: event.pointerId,
    clientX: sample.clientX,
    clientY: sample.clientY,
    pressure: sample.pressure,
    timeStamp: sample.timeStamp,
  }))
}
