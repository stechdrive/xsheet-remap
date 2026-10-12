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
export function generateClipFile(options: ClipWriteOptions, progress?: (message: string) => void, signal?: AbortSignal): Promise<ClipWriteResult> { return request({ type: 'write', options }, progress, signal) }
