import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type PointerEvent,
  type RefObject,
} from 'react'
import { clampSheetZoom } from './sheetInteraction'
import {
  applySheetPinchPreview,
  captureSheetViewportZoomAnchor,
  clearSheetPinchPreview,
  settleSheetViewportZoomAnchor,
  sheetPinchPreview,
  sheetTouchTargetIntent,
  sheetTouchPairMetrics,
  sheetTouchPanExceededThreshold,
  sheetTouchPanScrollPosition,
  type PendingSheetZoomCommit,
  type SheetTouchPoint,
  type SheetTouchTap,
  type SheetViewportZoomAnchor,
} from './sheetTouchNavigation'

interface SheetTouchPinchSession {
  pointerIds: readonly [number, number]
  startDistance: number
  baseZoom: number
  startScrollLeft: number
  startScrollTop: number
  anchorContentX: number
  anchorContentY: number
  anchor: SheetViewportZoomAnchor
  latestZoom: number
  latestLocalX: number
  latestLocalY: number
}

interface SheetTouchNavigationSession {
  phase: 'tap' | 'pan' | 'pinch'
  primaryPointerId: number
  viewport: HTMLElement
  pageStack: HTMLElement
  target: Element | null
  startX: number
  startY: number
  latestX: number
  latestY: number
  startScrollLeft: number
  startScrollTop: number
  suppressTap: boolean
  interactionStarted: boolean
  pointers: Map<number, SheetTouchPoint>
  pinch: SheetTouchPinchSession | null
  frameId: number | null
}

export function useSheetTouchNavigation({
  enabled,
  zoom,
  setZoom,
  viewportRef,
  pageStackRef,
  onTap,
  onBegin,
  onEnd,
}: {
  enabled: boolean
  zoom: number
  setZoom: (value: number) => void
  viewportRef: RefObject<HTMLElement | null>
  pageStackRef: RefObject<HTMLElement | null>
  onTap: (tap: SheetTouchTap) => void
  onBegin: () => void
  onEnd: () => void
}) {
  const sessionRef = useRef<SheetTouchNavigationSession | null>(null)
  const blockedPointerIdsRef = useRef(new Set<number>())
  const directPointerIdsRef = useRef(new Set<number>())
  const activePenPointerIdsRef = useRef(new Set<number>())
  const pendingZoomCommitRef = useRef<PendingSheetZoomCommit | null>(null)
  const zoomRef = useRef(zoom)
  const setZoomRef = useRef(setZoom)
  const onTapRef = useRef(onTap)
  const onBeginRef = useRef(onBegin)
  const onEndRef = useRef(onEnd)
  const cancelActiveTouchRef = useRef<(options: {
    revertPinch: boolean
    blockPointers: boolean
  }) => void>(() => undefined)
  const cancelForPenRef = useRef<() => void>(() => undefined)

  useLayoutEffect(() => {
    zoomRef.current = zoom
    setZoomRef.current = setZoom
    onTapRef.current = onTap
    onBeginRef.current = onBegin
    onEndRef.current = onEnd

    const pending = pendingZoomCommitRef.current
    if (!pending || Math.abs(pending.targetZoom - zoom) > 0.000_001) return
    const viewport = viewportRef.current
    const pageStack = pageStackRef.current
    if (viewport && pageStack) {
      clearSheetPinchPreview(pageStack)
      settleSheetViewportZoomAnchor(viewport, pageStack, pending)
    }
    pendingZoomCommitRef.current = null
  }, [onBegin, onEnd, onTap, pageStackRef, setZoom, viewportRef, zoom])

  function cancelFrame(session: SheetTouchNavigationSession) {
    if (session.frameId === null) return
    window.cancelAnimationFrame(session.frameId)
    session.frameId = null
  }

  function capturePointer(viewport: HTMLElement, pointerId: number) {
    try {
      viewport.setPointerCapture?.(pointerId)
    } catch {
      // Implicit touch capture still keeps the pointer stream usable.
    }
  }

  function releasePointer(viewport: HTMLElement, pointerId: number) {
    if (!viewport.hasPointerCapture?.(pointerId)) return
    try {
      viewport.releasePointerCapture(pointerId)
    } catch {
      // Capture can already be released before cancellation reaches React.
    }
  }

  function beginInteraction(session: SheetTouchNavigationSession) {
    if (session.interactionStarted) return
    session.interactionStarted = true
    onBeginRef.current()
  }

  function applyPan(session: SheetTouchNavigationSession) {
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

  function pinchPoints(session: SheetTouchNavigationSession) {
    const pinch = session.pinch
    if (!pinch) return null
    const first = session.pointers.get(pinch.pointerIds[0])
    const second = session.pointers.get(pinch.pointerIds[1])
    return first && second ? { first, second } : null
  }

  function applyPinch(session: SheetTouchNavigationSession) {
    cancelFrame(session)
    const pinch = session.pinch
    const points = pinchPoints(session)
    if (!pinch || !points) return
    const viewportRect = session.viewport.getBoundingClientRect()
    const preview = sheetPinchPreview({
      baseZoom: pinch.baseZoom,
      startDistance: pinch.startDistance,
      anchorContentX: pinch.anchorContentX,
      anchorContentY: pinch.anchorContentY,
      viewportLeft: viewportRect.left,
      viewportTop: viewportRect.top,
      first: points.first,
      second: points.second,
    })
    pinch.latestZoom = preview.zoom
    pinch.latestLocalX = preview.centroidClientX - viewportRect.left
    pinch.latestLocalY = preview.centroidClientY - viewportRect.top
    applySheetPinchPreview(session.pageStack, preview.scale)
    session.viewport.scrollLeft = preview.scrollLeft
    session.viewport.scrollTop = preview.scrollTop
  }

  function scheduleUpdate(session: SheetTouchNavigationSession) {
    if (session.frameId !== null) return
    session.frameId = window.requestAnimationFrame(() => {
      if (sessionRef.current !== session) return
      if (session.phase === 'pinch') applyPinch(session)
      else if (session.phase === 'pan') applyPan(session)
    })
  }

  function transitionToPinch(session: SheetTouchNavigationSession) {
    const pointerIds = Array.from(session.pointers.keys())
    if (pointerIds.length < 2) return
    if (session.phase === 'pan') applyPan(session)
    else cancelFrame(session)
    beginInteraction(session)
    const first = session.pointers.get(pointerIds[0]!)
    const second = session.pointers.get(pointerIds[1]!)
    if (!first || !second) return
    const metrics = sheetTouchPairMetrics(first, second)
    const viewportRect = session.viewport.getBoundingClientRect()
    const localX = metrics.clientX - viewportRect.left
    const localY = metrics.clientY - viewportRect.top
    session.phase = 'pinch'
    session.suppressTap = true
    session.pinch = {
      pointerIds: [first.pointerId, second.pointerId],
      startDistance: Math.max(1, metrics.distance),
      baseZoom: zoomRef.current,
      startScrollLeft: session.viewport.scrollLeft,
      startScrollTop: session.viewport.scrollTop,
      anchorContentX: session.viewport.scrollLeft + localX,
      anchorContentY: session.viewport.scrollTop + localY,
      anchor: captureSheetViewportZoomAnchor(
        session.viewport,
        session.pageStack,
        metrics.clientX,
        metrics.clientY,
        zoomRef.current,
      ),
      latestZoom: zoomRef.current,
      latestLocalX: localX,
      latestLocalY: localY,
    }
  }

  function blockRemainingPointers(session: SheetTouchNavigationSession, finishedPointerId?: number) {
    for (const pointerId of session.pointers.keys()) {
      if (pointerId !== finishedPointerId) blockedPointerIdsRef.current.add(pointerId)
    }
  }

  function finishTapOrPan(
    session: SheetTouchNavigationSession,
    pointerId: number,
    cancelled: boolean,
  ) {
    if (session.phase === 'pan') applyPan(session)
    else cancelFrame(session)
    sessionRef.current = null
    releasePointer(session.viewport, pointerId)
    if (session.interactionStarted) onEndRef.current()
    if (!cancelled && session.phase === 'tap' && !session.suppressTap) {
      onTapRef.current({
        target: session.target,
        clientX: session.latestX,
        clientY: session.latestY,
      })
    }
  }

  function finishPinch(
    session: SheetTouchNavigationSession,
    pointerId: number,
    cancelled: boolean,
  ) {
    applyPinch(session)
    const pinch = session.pinch
    sessionRef.current = null
    blockRemainingPointers(session, pointerId)
    releasePointer(session.viewport, pointerId)
    if (pinch) {
      if (cancelled) {
        clearSheetPinchPreview(session.pageStack)
        session.viewport.scrollLeft = pinch.startScrollLeft
        session.viewport.scrollTop = pinch.startScrollTop
      } else if (Math.abs(pinch.latestZoom - pinch.baseZoom) <= 0.000_001) {
        clearSheetPinchPreview(session.pageStack)
      } else {
        pendingZoomCommitRef.current = {
          targetZoom: pinch.latestZoom,
          anchor: pinch.anchor,
          localX: pinch.latestLocalX,
          localY: pinch.latestLocalY,
        }
        setZoomRef.current(pinch.latestZoom)
      }
    }
    if (session.interactionStarted) onEndRef.current()
  }

  function cancelActiveTouch({
    revertPinch,
    blockPointers,
  }: {
    revertPinch: boolean
    blockPointers: boolean
  }) {
    const session = sessionRef.current
    if (!session) return
    cancelFrame(session)
    if (session.phase === 'pan') applyPan(session)
    if (session.phase === 'pinch') {
      clearSheetPinchPreview(session.pageStack)
      if (revertPinch && session.pinch) {
        session.viewport.scrollLeft = session.pinch.startScrollLeft
        session.viewport.scrollTop = session.pinch.startScrollTop
      }
    }
    sessionRef.current = null
    if (blockPointers) blockRemainingPointers(session)
    else {
      for (const pointerId of session.pointers.keys()) releasePointer(session.viewport, pointerId)
    }
    if (session.interactionStarted) onEndRef.current()
  }

  useLayoutEffect(() => {
    cancelActiveTouchRef.current = cancelActiveTouch
    cancelForPenRef.current = () => cancelActiveTouch({
      revertPinch: true,
      blockPointers: true,
    })
  })

  useEffect(() => {
    function trackPointerDown(event: globalThis.PointerEvent) {
      if (event.pointerType !== 'pen') return
      cancelForPenRef.current()
      activePenPointerIdsRef.current.add(event.pointerId)
    }
    function trackPointerEnd(event: globalThis.PointerEvent) {
      if (event.pointerType === 'pen') activePenPointerIdsRef.current.delete(event.pointerId)
    }
    function cleanupDirectTouch(event: globalThis.PointerEvent) {
      if (event.pointerType !== 'touch') return
      directPointerIdsRef.current.delete(event.pointerId)
      blockedPointerIdsRef.current.delete(event.pointerId)
    }
    function cancelAllInput() {
      cancelActiveTouchRef.current({ revertPinch: true, blockPointers: false })
      blockedPointerIdsRef.current.clear()
      directPointerIdsRef.current.clear()
      activePenPointerIdsRef.current.clear()
      pendingZoomCommitRef.current = null
      const pageStack = pageStackRef.current
      if (pageStack) clearSheetPinchPreview(pageStack)
    }
    function handleVisibilityChange() {
      if (document.visibilityState !== 'visible') cancelAllInput()
    }
    window.addEventListener('pointerdown', trackPointerDown, true)
    window.addEventListener('pointerup', trackPointerEnd, true)
    window.addEventListener('pointercancel', trackPointerEnd, true)
    window.addEventListener('pointerup', cleanupDirectTouch)
    window.addEventListener('pointercancel', cleanupDirectTouch)
    window.addEventListener('blur', cancelAllInput)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('pointerdown', trackPointerDown, true)
      window.removeEventListener('pointerup', trackPointerEnd, true)
      window.removeEventListener('pointercancel', trackPointerEnd, true)
      window.removeEventListener('pointerup', cleanupDirectTouch)
      window.removeEventListener('pointercancel', cleanupDirectTouch)
      window.removeEventListener('blur', cancelAllInput)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      cancelAllInput()
    }
  }, [pageStackRef])

  useEffect(() => {
    if (!enabled) cancelActiveTouchRef.current({ revertPinch: true, blockPointers: false })
  }, [enabled])

  function stopTouchEvent(event: PointerEvent<HTMLElement>) {
    event.preventDefault()
    event.stopPropagation()
  }

  function handlePointerDownCapture(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== 'touch' || event.button !== 0 || !enabled) return
    const viewport = event.currentTarget
    const pageStack = pageStackRef.current
    const active = sessionRef.current
    const targetIntent = sheetTouchTargetIntent(event.target)
    const shouldBlock = activePenPointerIdsRef.current.size > 0
      || blockedPointerIdsRef.current.size > 0
      || directPointerIdsRef.current.size > 0
    if (!active && !shouldBlock) {
      if (!pageStack || targetIntent === 'native-control') return
      if (targetIntent === 'direct') {
        directPointerIdsRef.current.add(event.pointerId)
        return
      }
    }
    stopTouchEvent(event)
    capturePointer(viewport, event.pointerId)
    if (shouldBlock) {
      blockedPointerIdsRef.current.add(event.pointerId)
      return
    }
    if (active) {
      if (active.pointers.size >= 2) {
        blockedPointerIdsRef.current.add(event.pointerId)
        return
      }
      active.pointers.set(event.pointerId, {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
      })
      active.suppressTap = true
      transitionToPinch(active)
      return
    }
    const target = event.target instanceof Element ? event.target : null
    const session: SheetTouchNavigationSession = {
      phase: 'tap',
      primaryPointerId: event.pointerId,
      viewport,
      pageStack: pageStack!,
      target,
      startX: event.clientX,
      startY: event.clientY,
      latestX: event.clientX,
      latestY: event.clientY,
      startScrollLeft: viewport.scrollLeft,
      startScrollTop: viewport.scrollTop,
      suppressTap: false,
      interactionStarted: false,
      pointers: new Map([[
        event.pointerId,
        {
          pointerId: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
        },
      ]]),
      pinch: null,
      frameId: null,
    }
    sessionRef.current = session
  }

  function handlePointerMoveCapture(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== 'touch') return
    if (directPointerIdsRef.current.has(event.pointerId)) return
    if (blockedPointerIdsRef.current.has(event.pointerId)) {
      stopTouchEvent(event)
      return
    }
    const session = sessionRef.current
    const point = session?.pointers.get(event.pointerId)
    if (!session || !point) return
    stopTouchEvent(event)
    point.clientX = event.clientX
    point.clientY = event.clientY
    if (event.pointerId === session.primaryPointerId) {
      session.latestX = event.clientX
      session.latestY = event.clientY
    }
    if (session.phase === 'tap' && sheetTouchPanExceededThreshold(
      session.startX,
      session.startY,
      event.clientX,
      event.clientY,
    )) {
      session.phase = 'pan'
      beginInteraction(session)
    }
    if (session.phase === 'pan' || session.phase === 'pinch') scheduleUpdate(session)
  }

  function handlePointerUpCapture(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== 'touch') return
    if (directPointerIdsRef.current.delete(event.pointerId)) return
    if (blockedPointerIdsRef.current.has(event.pointerId)) {
      stopTouchEvent(event)
      blockedPointerIdsRef.current.delete(event.pointerId)
      releasePointer(event.currentTarget, event.pointerId)
      return
    }
    const session = sessionRef.current
    const point = session?.pointers.get(event.pointerId)
    if (!session || !point) return
    stopTouchEvent(event)
    point.clientX = event.clientX
    point.clientY = event.clientY
    if (event.pointerId === session.primaryPointerId) {
      session.latestX = event.clientX
      session.latestY = event.clientY
    }
    if (session.phase === 'pinch') finishPinch(session, event.pointerId, false)
    else finishTapOrPan(session, event.pointerId, false)
  }

  function handlePointerCancelCapture(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== 'touch') return
    if (directPointerIdsRef.current.delete(event.pointerId)) return
    if (blockedPointerIdsRef.current.has(event.pointerId)) {
      blockedPointerIdsRef.current.delete(event.pointerId)
      releasePointer(event.currentTarget, event.pointerId)
      return
    }
    const session = sessionRef.current
    if (!session?.pointers.has(event.pointerId)) return
    if (session.phase === 'pinch') finishPinch(session, event.pointerId, true)
    else finishTapOrPan(session, event.pointerId, true)
  }

  function handleLostPointerCapture(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== 'touch') return
    if (directPointerIdsRef.current.delete(event.pointerId)) return
    if (blockedPointerIdsRef.current.has(event.pointerId)) {
      blockedPointerIdsRef.current.delete(event.pointerId)
      return
    }
    const session = sessionRef.current
    if (!session?.pointers.has(event.pointerId)) return
    if (session.phase === 'pinch') finishPinch(session, event.pointerId, true)
    else finishTapOrPan(session, event.pointerId, true)
  }

  const commitZoomAtClientPoint = useCallback((nextZoom: number, clientX: number, clientY: number) => {
    const viewport = viewportRef.current
    const pageStack = pageStackRef.current
    const targetZoom = clampSheetZoom(nextZoom)
    if (!viewport || !pageStack || Math.abs(targetZoom - zoomRef.current) <= 0.000_001) return
    const viewportRect = viewport.getBoundingClientRect()
    pendingZoomCommitRef.current = {
      targetZoom,
      anchor: captureSheetViewportZoomAnchor(viewport, pageStack, clientX, clientY, zoomRef.current),
      localX: clientX - viewportRect.left,
      localY: clientY - viewportRect.top,
    }
    setZoomRef.current(targetZoom)
  }, [pageStackRef, viewportRef])

  return {
    handlePointerDownCapture,
    handlePointerMoveCapture,
    handlePointerUpCapture,
    handlePointerCancelCapture,
    handleLostPointerCapture,
    commitZoomAtClientPoint,
  }
}
