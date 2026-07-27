import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

export interface AnimationFramePointerUpdate {
  pointerId: number
  clientX: number
  clientY: number
}

export function useAnimationFramePointerUpdate(
  apply: (pointerId: number, clientX: number, clientY: number) => void,
) {
  const applyRef = useRef(apply)
  const frameRef = useRef<number | null>(null)
  const pendingRef = useRef<AnimationFramePointerUpdate | null>(null)

  useLayoutEffect(() => {
    applyRef.current = apply
  }, [apply])

  const cancel = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    pendingRef.current = null
  }, [])

  const flush = useCallback((update?: AnimationFramePointerUpdate) => {
    if (update) pendingRef.current = update
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    const pending = pendingRef.current
    pendingRef.current = null
    if (pending) applyRef.current(pending.pointerId, pending.clientX, pending.clientY)
  }, [])

  const schedule = useCallback((pointerId: number, clientX: number, clientY: number) => {
    pendingRef.current = { pointerId, clientX, clientY }
    if (frameRef.current !== null) return
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      const pending = pendingRef.current
      pendingRef.current = null
      if (pending) applyRef.current(pending.pointerId, pending.clientX, pending.clientY)
    })
  }, [])

  useEffect(() => cancel, [cancel])

  return { schedule, flush, cancel }
}
