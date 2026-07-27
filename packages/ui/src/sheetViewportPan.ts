import type { MutableRefObject, PointerEvent } from 'react'

export function beginSheetViewportPan(
  event: PointerEvent<HTMLElement> | PointerEvent<SVGSVGElement>,
  viewport: HTMLElement | null,
  {
    spacePanReady,
    panningRef,
    onBegin,
    onEnd,
  }: {
    spacePanReady: boolean
    panningRef: MutableRefObject<boolean>
    onBegin: () => void
    onEnd: () => void
  },
): boolean {
  const isMiddlePan = event.pointerType === 'mouse' && event.button === 1
  const isSpacePan = event.pointerType === 'mouse' && event.button === 0 && spacePanReady
  if (!viewport || (!isMiddlePan && !isSpacePan)) return false

  event.preventDefault()
  event.stopPropagation()
  const panViewport = viewport
  const pointerId = event.pointerId
  const startX = event.clientX
  const startY = event.clientY
  const startScrollLeft = panViewport.scrollLeft
  const startScrollTop = panViewport.scrollTop
  panningRef.current = true
  onBegin()

  function stopPan(nextEvent: globalThis.PointerEvent) {
    if (nextEvent.pointerId !== pointerId) return
    window.removeEventListener('pointermove', movePan)
    window.removeEventListener('pointerup', stopPan)
    window.removeEventListener('pointercancel', stopPan)
    panningRef.current = false
    onEnd()
  }

  function movePan(nextEvent: globalThis.PointerEvent) {
    if (nextEvent.pointerId !== pointerId) return
    nextEvent.preventDefault()
    panViewport.scrollLeft = startScrollLeft - (nextEvent.clientX - startX)
    panViewport.scrollTop = startScrollTop - (nextEvent.clientY - startY)
  }

  window.addEventListener('pointermove', movePan)
  window.addEventListener('pointerup', stopPan)
  window.addEventListener('pointercancel', stopPan)
  return true
}
