import { applySceneFilters, type SceneFilter } from './canvasKitScene'

let worker: Worker | null = null
let sequence = 0
let idle: ReturnType<typeof setTimeout> | undefined
const pending = new Map<number, { resolve: (pixels: Uint8ClampedArray) => void; reject: (error: Error) => void }>()

/** Transfer large pixel transforms off the input thread; small images avoid IPC. */
export async function filterPaperImage(source: Uint8ClampedArray, filters: SceneFilter[]): Promise<Uint8ClampedArray> {
  const pixels = new Uint8ClampedArray(source)
  if (pixels.byteLength < 512 * 1024 || typeof Worker === 'undefined') { applySceneFilters(pixels, filters); return pixels }
  if (!worker) {
    worker = new Worker(new URL('./canvasKitImageFilter.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<{ id: number; pixels: Uint8ClampedArray }>) => {
      pending.get(event.data.id)?.resolve(event.data.pixels); pending.delete(event.data.id)
      if (pending.size === 0) idle = setTimeout(() => { worker?.terminate(); worker = null }, 30_000)
    }
    worker.onerror = event => {
      for (const request of pending.values()) request.reject(new Error(event.message || 'Paper image filter worker failed'))
      pending.clear(); worker?.terminate(); worker = null
    }
  }
  clearTimeout(idle)
  const id = ++sequence
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    worker!.postMessage({ id, pixels, filters }, [pixels.buffer])
  })
}
