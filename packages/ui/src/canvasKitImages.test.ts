import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CanvasKit, Image as SkImage } from 'canvaskit-wasm'
import { CanvasKitImages } from './canvasKitImages'
import { applySceneFilters, type CanvasKitScene, type SceneFilter } from './canvasKitScene'
import { canvasContextPrototype } from './canvas-context.test-support'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('paper image source lifetime', () => {
  it('decodes once across correction changes and releases obsolete native images', async () => {
    const fetch = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }))
    vi.stubGlobal('fetch', fetch)
    const bitmap = vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() }))
    vi.stubGlobal('createImageBitmap', bitmap)
    vi.spyOn(canvasContextPrototype(), 'getContext').mockReturnValue({ drawImage: vi.fn(),
      getImageData: () => ({ width: 1, height: 1, data: new Uint8ClampedArray([100, 160, 220, 128]) }),
    } as unknown as CanvasRenderingContext2D)
    const produced: Array<{ pixels: Uint8ClampedArray; delete: ReturnType<typeof vi.fn> }> = []
    const kit = { ColorType: { RGBA_8888: 0 }, AlphaType: { Unpremul: 0 }, ColorSpace: { SRGB: 0 },
      MakeImage: (_info: unknown, pixels: Uint8ClampedArray) => {
        const image = { pixels: new Uint8ClampedArray(pixels), delete: vi.fn(), width: () => 1, height: () => 1 }
        produced.push(image); return image as unknown as SkImage
      },
    } as unknown as CanvasKit
    const cache = new CanvasKitImages(kit)
    const scene = (filters: SceneFilter[]): CanvasKitScene => ({ width: 1, height: 1, nodes: [{ children: [], matrix: [1, 0, 0, 1, 0, 0], opacity: 1, blend: 'normal', clips: [],
      paint: { fill: 'none', stroke: 'none', fillOpacity: 1, strokeOpacity: 1, strokeWidth: 0, dash: [], dashOffset: 0, cap: 'butt', join: 'miter', miter: 4, nonScaling: false, evenOdd: false }, image: {
      url: 'blob:paper', rect: { x: 0, y: 0, width: 1, height: 1 }, pixelated: false, filters,
    } }] })
    const filters: SceneFilter[] = [{ red: [0, .5], green: [0, 1], blue: [1, 0] }]
    await cache.ensure(scene(filters))
    const expected = new Uint8ClampedArray([100, 160, 220, 128]); applySceneFilters(expected, filters)
    expect(produced[0]!.pixels).toEqual(expected)
    await cache.ensure(scene([{ red: [1, 0] }]))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(bitmap).toHaveBeenCalledTimes(1)
    expect(produced[0]!.delete).toHaveBeenCalledOnce()
    expect(cache.sourceBytes).toBe(8)
    cache.dispose()
    expect(cache.imageBytes).toBe(0)
    expect(cache.sourceBytes).toBe(0)
    expect(produced[1]!.delete).toHaveBeenCalledOnce()
  })
})
