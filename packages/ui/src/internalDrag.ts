import type { PointerEvent as ReactPointerEvent } from 'react'
import { createPointerDragGhost, type PointerDragGhost } from './pointerDragGhost'

export type InternalDragPayload =
  | { kind: 'asset'; assetIds: string[] }
  | { kind: 'registered-cell'; keyId: string; sourceSlotId?: string }
  | { kind: 'stack-guide'; labelId: string }

export type InternalDragPhase = 'start' | 'move' | 'drop' | 'cancel'
export type InternalDragDropValidity = 'valid' | 'invalid' | null

export interface InternalDragPreviewDescriptor {
  primaryText: string
  secondaryText?: string
  thumbnailUrl?: string
  itemCount?: number
}

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
let activeDocumentDragSessionId: string | null = null
let activeDocumentDragSource: { element: HTMLElement; previousInlineCursor: string } | null = null

export function subscribeInternalDrag(handler: InternalDragHandler): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<InternalDragDetail>).detail)
  window.addEventListener(INTERNAL_DRAG_EVENT, listener)
  return () => window.removeEventListener(INTERNAL_DRAG_EVENT, listener)
}

export function dispatchInternalDrag(detail: InternalDragDetail): void {
  window.dispatchEvent(new CustomEvent(INTERNAL_DRAG_EVENT, { detail }))
}

export function setInternalDragDropValidity(validity: InternalDragDropValidity): void {
  if (!document.body.classList.contains('internalPointerDragActive')) return
  if (validity) {
    document.body.dataset.internalDragValidity = validity
  } else {
    delete document.body.dataset.internalDragValidity
  }
  applyInternalDragSourceCursor(validity)
}

export function startInternalPointerDrag(
  event: ReactPointerEvent<HTMLElement>,
  input: {
    begin: () => InternalDragPayload | null
    createPreview: (payload: InternalDragPayload) => InternalDragPreviewDescriptor
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
  let lastX = startX
  let lastY = startY
  let cleaned = false

  function restoreSourceScroll() {
    if (!scrollLock) return
    scrollLock.element.scrollLeft = scrollLock.left
    scrollLock.element.scrollTop = scrollLock.top
  }

  function emit(phase: InternalDragPhase, clientX: number, clientY: number) {
    if (!payload) return
    dispatchInternalDrag({
      sessionId,
      phase,
      payload,
      clientX,
      clientY,
    })
  }

  function cleanup() {
    if (cleaned) return
    cleaned = true
    window.removeEventListener('pointermove', handleMove)
    window.removeEventListener('pointerup', handleStop)
    window.removeEventListener('pointercancel', handleCancel)
    window.removeEventListener('blur', handleWindowBlur)
    try {
      if (source.hasPointerCapture?.(pointerId)) source.releasePointerCapture?.(pointerId)
    } catch {
      // The capture may already have been released by WebView2 after cancellation.
    }
    restoreSourceScroll()
    dragGhost?.dispose()
    dragGhost = null
    source.classList.remove('internalPointerDragSource')
    delete source.dataset.internalDragSource
    if (activeDocumentDragSessionId === sessionId) {
      activeDocumentDragSessionId = null
      restoreInternalDragSourceCursor()
      document.body.classList.remove('internalPointerDragActive')
      delete document.body.dataset.internalDragKind
      delete document.body.dataset.internalDragValidity
    }
  }

  function finish(phase: 'drop' | 'cancel', clientX: number, clientY: number) {
    const finishedPayload = payload
    if (finishedPayload) emit(phase, clientX, clientY)
    cleanup()
    if (finishedPayload) input.onFinished?.(finishedPayload)
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
    dragGhost = createPointerDragGhost(createInternalDragPreview(input.createPreview(payload), payload.kind), pointerEvent.clientX, pointerEvent.clientY)
    source.classList.add('internalPointerDragSource')
    source.dataset.internalDragSource = 'true'
    activeDocumentDragSessionId = sessionId
    activeDocumentDragSource = { element: source, previousInlineCursor: source.style.cursor }
    document.body.classList.add('internalPointerDragActive')
    document.body.dataset.internalDragKind = payload.kind
    delete document.body.dataset.internalDragValidity
    applyInternalDragSourceCursor(null)
    input.onStarted?.(payload)
    emit('start', pointerEvent.clientX, pointerEvent.clientY)
    return true
  }

  function handleMove(pointerEvent: globalThis.PointerEvent) {
    if (pointerEvent.pointerId !== pointerId) return
    lastX = pointerEvent.clientX
    lastY = pointerEvent.clientY
    if (!ensureStarted(pointerEvent)) return
    pointerEvent.preventDefault()
    restoreSourceScroll()
    dragGhost?.move(pointerEvent.clientX, pointerEvent.clientY)
    emit('move', pointerEvent.clientX, pointerEvent.clientY)
  }

  function handleStop(pointerEvent: globalThis.PointerEvent) {
    if (pointerEvent.pointerId !== pointerId) return
    lastX = pointerEvent.clientX
    lastY = pointerEvent.clientY
    if (payload) pointerEvent.preventDefault()
    finish('drop', lastX, lastY)
  }

  function handleCancel(pointerEvent: globalThis.PointerEvent) {
    if (pointerEvent.pointerId !== pointerId) return
    lastX = pointerEvent.clientX
    lastY = pointerEvent.clientY
    finish('cancel', lastX, lastY)
  }

  function handleWindowBlur() {
    finish('cancel', lastX, lastY)
  }

  window.addEventListener('pointermove', handleMove)
  window.addEventListener('pointerup', handleStop)
  window.addEventListener('pointercancel', handleCancel)
  window.addEventListener('blur', handleWindowBlur)
  return true
}

export function createInternalDragPreview(descriptor: InternalDragPreviewDescriptor, kind: InternalDragPayload['kind']): HTMLElement {
  const shell = document.createElement('div')
  shell.className = 'internalDragPreviewShell'
  shell.dataset.internalDragPreviewKind = kind

  const preview = document.createElement('div')
  preview.className = 'internalDragPreview'
  if (descriptor.thumbnailUrl) {
    const image = document.createElement('img')
    image.className = 'internalDragPreviewThumbnail'
    image.src = descriptor.thumbnailUrl
    image.alt = ''
    image.draggable = false
    preview.append(image)
  }
  const text = document.createElement('span')
  text.className = 'internalDragPreviewText'
  const title = document.createElement('strong')
  title.textContent = descriptor.primaryText
  text.append(title)
  const secondaryParts = [descriptor.secondaryText]
  if ((descriptor.itemCount ?? 0) > 1) secondaryParts.push(`${descriptor.itemCount}件`)
  const secondaryText = secondaryParts.filter(Boolean).join(' · ')
  if (secondaryText) {
    const meta = document.createElement('span')
    meta.textContent = secondaryText
    text.append(meta)
  }
  preview.append(text)
  shell.append(preview)
  return shell
}

function applyInternalDragSourceCursor(validity: InternalDragDropValidity) {
  const source = activeDocumentDragSource?.element
  if (!source) return
  source.style.cursor = validity === 'valid' ? 'crosshair' : validity === 'invalid' ? 'not-allowed' : 'grabbing'
}

function restoreInternalDragSourceCursor() {
  if (!activeDocumentDragSource) return
  activeDocumentDragSource.element.style.cursor = activeDocumentDragSource.previousInlineCursor
  activeDocumentDragSource = null
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
