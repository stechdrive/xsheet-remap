import type { PointerEvent as ReactPointerEvent } from 'react'
import { createPointerDragGhost, type PointerDragGhost } from './pointerDragGhost'

export type InternalDragPayload =
  | { kind: 'asset'; assetIds: string[] }
  | { kind: 'registered-cell'; keyId: string }
  | { kind: 'stack-guide'; labelId: string }

export type InternalDragPhase = 'start' | 'move' | 'drop' | 'cancel'

export interface InternalDragDetail {
  sessionId: string
  phase: InternalDragPhase
  payload: InternalDragPayload
  clientX: number
  clientY: number
}

export type InternalDragHandler = (detail: InternalDragDetail) => void

const INTERNAL_DRAG_EVENT = 'xsheet-remap:internal-drag'
const INTERNAL_DRAG_THRESHOLD_PX = 4
let nextInternalDragSession = 1

export function subscribeInternalDrag(handler: InternalDragHandler): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<InternalDragDetail>).detail)
  window.addEventListener(INTERNAL_DRAG_EVENT, listener)
  return () => window.removeEventListener(INTERNAL_DRAG_EVENT, listener)
}

export function dispatchInternalDrag(detail: InternalDragDetail): void {
  window.dispatchEvent(new CustomEvent(INTERNAL_DRAG_EVENT, { detail }))
}

export function startInternalPointerDrag(
  event: ReactPointerEvent<HTMLElement>,
  input: {
    begin: () => InternalDragPayload | null
    createDragGhost: () => HTMLElement
    onStarted?: (payload: InternalDragPayload) => void
    onFinished?: (payload: InternalDragPayload) => void
    sourceScrollElement?: HTMLElement | null
    interactiveTargetSelector?: string
  },
): boolean {
  const interactiveSelector = input.interactiveTargetSelector ?? 'button,input,select,textarea,a,[role="button"],[contenteditable="true"]'
  const target = event.target instanceof Element ? event.target : null
  if (event.button !== 0 || target?.closest(interactiveSelector)) return false

  const source = event.currentTarget
  const pointerId = event.pointerId
  const startX = event.clientX
  const startY = event.clientY
  const scrollLock = input.sourceScrollElement
    ? { element: input.sourceScrollElement, left: input.sourceScrollElement.scrollLeft, top: input.sourceScrollElement.scrollTop }
    : null
  const sessionId = `internal-drag-${nextInternalDragSession++}`
  let payload: InternalDragPayload | null = null
  let dragGhost: PointerDragGhost | null = null

  function restoreSourceScroll() {
    if (!scrollLock) return
    scrollLock.element.scrollLeft = scrollLock.left
    scrollLock.element.scrollTop = scrollLock.top
  }

  function emit(phase: InternalDragPhase, pointerEvent: globalThis.PointerEvent) {
    if (!payload) return
    dispatchInternalDrag({
      sessionId,
      phase,
      payload,
      clientX: pointerEvent.clientX,
      clientY: pointerEvent.clientY,
    })
  }

  function cleanup() {
    window.removeEventListener('pointermove', handleMove)
    window.removeEventListener('pointerup', handleStop)
    window.removeEventListener('pointercancel', handleCancel)
    try {
      if (source.hasPointerCapture?.(pointerId)) source.releasePointerCapture?.(pointerId)
    } catch {
      // The capture may already have been released by WebView2 after cancellation.
    }
    restoreSourceScroll()
    dragGhost?.dispose()
    dragGhost = null
  }

  function ensureStarted(pointerEvent: globalThis.PointerEvent): boolean {
    if (payload) return true
    const moved = Math.abs(pointerEvent.clientX - startX) >= INTERNAL_DRAG_THRESHOLD_PX
      || Math.abs(pointerEvent.clientY - startY) >= INTERNAL_DRAG_THRESHOLD_PX
    if (!moved) return false
    payload = normalizeInternalDragPayload(input.begin())
    if (!payload) {
      cleanup()
      return false
    }
    try {
      source.setPointerCapture?.(pointerId)
    } catch {
      // Synthetic events and some embedded browser builds do not expose capture.
    }
    restoreSourceScroll()
    dragGhost = createPointerDragGhost(input.createDragGhost(), pointerEvent.clientX, pointerEvent.clientY)
    input.onStarted?.(payload)
    emit('start', pointerEvent)
    return true
  }

  function handleMove(pointerEvent: globalThis.PointerEvent) {
    if (pointerEvent.pointerId !== pointerId || !ensureStarted(pointerEvent)) return
    pointerEvent.preventDefault()
    restoreSourceScroll()
    dragGhost?.move(pointerEvent.clientX, pointerEvent.clientY)
    emit('move', pointerEvent)
  }

  function handleStop(pointerEvent: globalThis.PointerEvent) {
    if (pointerEvent.pointerId !== pointerId) return
    if (payload) {
      pointerEvent.preventDefault()
      emit('drop', pointerEvent)
    }
    const finishedPayload = payload
    cleanup()
    if (finishedPayload) input.onFinished?.(finishedPayload)
  }

  function handleCancel(pointerEvent: globalThis.PointerEvent) {
    if (pointerEvent.pointerId !== pointerId) return
    if (payload) emit('cancel', pointerEvent)
    const finishedPayload = payload
    cleanup()
    if (finishedPayload) input.onFinished?.(finishedPayload)
  }

  window.addEventListener('pointermove', handleMove)
  window.addEventListener('pointerup', handleStop)
  window.addEventListener('pointercancel', handleCancel)
  return true
}

export function createInternalDragCardImage(label: string, subLabel: string, source?: HTMLElement): HTMLElement {
  const shell = document.createElement('div')
  shell.className = 'registeredCellDragImageShell'

  if (source) {
    const card = source.cloneNode(true) as HTMLElement
    card.classList.add('registeredCellDragCardClone')
    card.removeAttribute('tabindex')
    card.querySelectorAll<HTMLElement>('button, input, textarea, select').forEach(control => {
      control.setAttribute('tabindex', '-1')
      control.setAttribute('aria-hidden', 'true')
    })
    shell.append(card)
    return shell
  }

  const preview = document.createElement('div')
  preview.className = 'registeredCellDragImagePreview'
  const title = document.createElement('strong')
  title.textContent = label
  preview.append(title)
  if (subLabel) {
    const meta = document.createElement('span')
    meta.textContent = subLabel
    preview.append(meta)
  }
  shell.append(preview)
  return shell
}

function normalizeInternalDragPayload(payload: InternalDragPayload | null): InternalDragPayload | null {
  if (!payload) return null
  if (payload.kind === 'asset') {
    const assetIds = [...new Set(payload.assetIds.filter(Boolean))]
    return assetIds.length > 0 ? { kind: 'asset', assetIds } : null
  }
  if (payload.kind === 'registered-cell') return payload.keyId ? payload : null
  return payload.labelId ? payload : null
}
