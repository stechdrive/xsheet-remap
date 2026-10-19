import type { ClipCanvasSettings, ClipImportData } from '@xsheet-remap/core'
import type { ClipWriteOptions, ClipWriteResult } from './writer'
function request<T>(message: object, progress?: (message: string) => void, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    const dispose = () => { worker.terminate(); signal?.removeEventListener('abort', abort) }
    const abort = () => { dispose(); reject(new DOMException('キャンセルしました。', 'AbortError')) }
    if (signal?.aborted) { abort(); return }
    signal?.addEventListener('abort', abort, { once: true })
    worker.onmessage = event => {
      const data = event.data
      if (data.type === 'progress') progress?.(data.message)
      else { dispose(); if (data.type === 'error') reject(new Error(data.message)); else resolve(data.result as T) }
    }
    worker.onerror = event => { dispose(); reject(new Error(event.message || 'CLIP作成処理を開始できませんでした。')) }
    worker.postMessage(message)
  })
}
export function inspectClipFile(bytes: Uint8Array, signal?: AbortSignal): Promise<ClipCanvasSettings> { return request({ type: 'inspect', bytes }, undefined, signal) }
export function readClipFile(bytes: Uint8Array, fileName: string, signal?: AbortSignal): Promise<ClipImportData> { return request({ type: 'read', bytes, fileName }, undefined, signal) }
export async function previewClipLayer(source: Uint8Array | string, layerId: number, signal?: AbortSignal): Promise<import('./preview').ClipLayerPreview> {
  const reader = createClipPreviewSession(source, signal)
  try { return await reader.read(layerId) } finally { reader.dispose() }
}

/** One source/database per Quick Look request, including its fallback gallery. */
export function createClipPreviewSession(source: Uint8Array | string, signal?: AbortSignal) {
  type Preview = import('./preview').ClipLayerPreview
  let worker: Worker | undefined, nextId = 0, disposed = false
  const pending = new Map<number, { resolve: (value: Preview) => void; reject: (error: Error) => void }>()
  const dispose = (error: Error = new DOMException('キャンセルしました。', 'AbortError')) => {
    disposed = true
    worker?.terminate(); worker = undefined
    signal?.removeEventListener('abort', abort)
    for (const request of pending.values()) request.reject(error)
    pending.clear()
  }
  const abort = () => dispose()
  signal?.addEventListener('abort', abort, { once: true })
  return {
    dispose,
    read(layerId: number): Promise<Preview> {
      if (disposed || signal?.aborted) { dispose(); return Promise.reject(new DOMException('キャンセルしました。', 'AbortError')) }
      return new Promise((resolve, reject) => {
        const id = nextId++
        const first = !worker
        try {
          if (!worker) {
            worker = new Worker(new URL('./clip-preview.worker.ts', import.meta.url), { type: 'module' })
            worker.onmessage = event => {
              const data = event.data, request = pending.get(data.id)
              if (!request) return
              pending.delete(data.id)
              if (data.type === 'error') request.reject(new Error(data.message))
              else request.resolve(data.result as Preview)
            }
            worker.onerror = event => dispose(new Error(event.message || 'CLIPプレビューを開始できませんでした。'))
          }
          pending.set(id, { resolve, reject })
          // Borrowed source bytes must remain usable for save/export and Undo.
          worker.postMessage(first ? { id, source, layerId } : { id, layerId })
        } catch (error) { reject(error); dispose(error instanceof Error ? error : new Error(String(error))) }
      })
    },
  }
}
export function readClipAudioFile(bytes: Uint8Array, layerId: number, timelineId: string, signal?: AbortSignal): Promise<import('./audio').ClipAudioReadResult> { return request({ type: 'audio', bytes, layerId, timelineId }, undefined, signal) }
export function generateClipFile(options: ClipWriteOptions, progress?: (message: string) => void, signal?: AbortSignal): Promise<ClipWriteResult> { return request({ type: 'write', options }, progress, signal) }
