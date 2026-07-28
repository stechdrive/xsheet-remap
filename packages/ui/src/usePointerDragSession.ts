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
}

export interface PointerDragFinish extends PointerDragPoint {
  cancelled: boolean
}

export type PointerDragPreviewMode = 'immediate' | 'animation-frame'

export function usePointerDragSession<TSession extends PointerDragSession>({
  onUpdate,
  onFinish,
  previewMode = 'immediate',
}: {
  onUpdate: (session: TSession, point: PointerDragPoint) => TSession
  onFinish: (session: TSession, finish: PointerDragFinish) => void
  previewMode?: PointerDragPreviewMode
}) {
  const [active, setActiveState] = useState<TSession | null>(null)
  const activeRef = useRef<TSession | null>(null)
  const captureRef = useRef<{ pointerId: number; element: Element } | null>(null)
  const previewFrameRef = useRef<number | null>(null)
  const optionsRef = useRef({ onUpdate, onFinish, previewMode })
  const updateRef = useRef<(pointerId: number, clientX: number, clientY: number, pressure?: number) => void>(() => undefined)
  const finishRef = useRef<(pointerId: number, cancelled?: boolean, clientX?: number, clientY?: number) => void>(() => undefined)

  function cancelPreviewFrame() {
    if (previewFrameRef.current === null) return
    window.cancelAnimationFrame(previewFrameRef.current)
    previewFrameRef.current = null
  }

  function publishPreview(next: TSession) {
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
    optionsRef.current = { onUpdate, onFinish, previewMode }
    updateRef.current = (pointerId, clientX, clientY, pressure = 0) => {
      const current = activeRef.current
      if (!current || current.pointerId !== pointerId) return
      const next = optionsRef.current.onUpdate(current, { pointerId, clientX, clientY, pressure })
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
        cancelled,
      })
    }
  })

  useGlobalPointerDragLifecycle({ active: active !== null, activeRef, updateRef, finishRef })

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
