import { useEffect, useRef, type KeyboardEvent } from 'react'

export function useFloatingEditorBoundary<T extends HTMLElement>(onCancel: () => void) {
  const rootRef = useRef<T | null>(null)

  useEffect(() => {
    function dismissFromOutsidePointer(event: PointerEvent) {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return
      onCancel()
    }
    document.addEventListener('pointerdown', dismissFromOutsidePointer, true)
    return () => document.removeEventListener('pointerdown', dismissFromOutsidePointer, true)
  }, [onCancel])

  function handleKeyDown(event: KeyboardEvent<T>) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    completeWithSheetFocus(onCancel)
  }

  function completeWithSheetFocus(action: () => void) {
    const viewport = rootRef.current?.closest<HTMLElement>('.sheetViewport') ?? null
    action()
    window.requestAnimationFrame(() => viewport?.focus({ preventScroll: true }))
  }

  return { rootRef, handleKeyDown, completeWithSheetFocus }
}
