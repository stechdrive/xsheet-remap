import type { SqlJsStatic } from 'sql.js'
import { openDocument, type DocumentSession, type LayerView } from 'celcodec/document'
import { writeContainerLimits } from 'celcodec/read'
import type { ClipCanvasSettings } from '@xsheet-remap/core'

// Keep the application's editable-file budget independent of material/render budgets.
export const sessionOptions = { limits: writeContainerLimits, maxRows: 1_000_000, maxDepth: 100, maxCanvasPixels: 100_000_000 }
export function openClipSession(SQL: SqlJsStatic, bytes: Uint8Array, ownership: 'copy' | 'borrow' = 'copy') {
  return openDocument(SQL, bytes, { ...sessionOptions, ownership })
}
export function flattenLayers(layers: readonly LayerView[]): LayerView[] {
  return layers.flatMap(layer => [layer, ...flattenLayers(layer.children)])
}
export function canvasSettings(session: DocumentSession): ClipCanvasSettings {
  const { width, height, dpi, animationFrame } = session.document.canvas
  const frame = animationFrame.pixels
  return { width, height, dpi, basisWidth: frame?.width ?? width, basisHeight: frame?.height ?? height,
    offsetX: frame?.offsetX ?? 0, offsetY: frame?.offsetY ?? 0 }
}
