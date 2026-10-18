import type { NativeDragDropPayload } from '@xsheet-remap/adapters'
import type { SheetHit } from '@xsheet-remap/core'
import { createInternalDragPreview } from './internalDrag'
import { createPointerDragGhost, type DragPreviewRect, type PointerDragGhost } from './pointerDragGhost'

type NativeFileDragFeedback = { hit: SheetHit | null; valid: boolean } | null
const eventName = 'xsheet-remap:native-file-drag-preview'
let ghost: PointerDragGhost | null = null
let paths: string[] = []

/** Native OLE drops do not send DOM dragover or paint a WebView drag image. */
export function updateNativeFileDragPreview(payload: NativeDragDropPayload, point: { x: number; y: number }, hit: SheetHit | null, valid: boolean): void {
  if (payload.type === 'drop' || payload.type === 'leave') { clearNativeFileDragPreview(); return }
  if (payload.paths?.length) {
    const changed = payload.paths.join('\u001f') !== paths.join('\u001f')
    paths = payload.paths
    if (changed) { ghost?.dispose(); ghost = null }
  }
  if (!ghost) {
    const preview = createInternalDragPreview({ primaryText: paths[0]?.split(/[/\\]/).pop() || '画像', itemCount: paths.length }, 'asset')
    preview.classList.add('nativeFileDragPreview')
    ghost = createPointerDragGhost(preview, point.x, point.y)
  }
  ghost.avoid(null)
  ghost.move(point.x, point.y)
  window.dispatchEvent(new CustomEvent<NativeFileDragFeedback>(eventName, { detail: { hit, valid } }))
}

export function avoidNativeFileDragPreview(rect: DragPreviewRect): void { ghost?.avoid(rect) }

export function clearNativeFileDragPreview(): void {
  ghost?.dispose(); ghost = null; paths = []
  window.dispatchEvent(new CustomEvent<NativeFileDragFeedback>(eventName, { detail: null }))
}

export function subscribeNativeFileDragPreview(listener: (feedback: NativeFileDragFeedback) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<NativeFileDragFeedback>).detail)
  window.addEventListener(eventName, handler)
  return () => window.removeEventListener(eventName, handler)
}
