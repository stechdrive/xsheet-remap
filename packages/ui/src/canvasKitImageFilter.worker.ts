import { applySceneFilters, type SceneFilter } from './canvasKitScene'

self.onmessage = (event: MessageEvent<{ id: number; pixels: Uint8ClampedArray; filters: SceneFilter[] }>) => {
  const { id, pixels, filters } = event.data
  applySceneFilters(pixels, filters)
  self.postMessage({ id, pixels }, { transfer: [pixels.buffer] })
}
