// Ported from csp-paperback 2809271; MIT, Copyright (c) 2025 stechdrive.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VectorSurface } from './vector-surface'
import { cropPixels } from './pixels'

afterEach(() => vi.unstubAllGlobals())

describe('sparse vector compositing surface', () => {
  it('matches dense float compositing, including erasure, faint color and partial edge tiles', () => {
    const width = 259, height = 271, dense = new Float32Array(width * height * 4)
    const surface = new VectorSurface(width, height)
    for (let stroke = 0; stroke < 8; stroke++) {
      const color = [stroke * 30, 80, 255 - stroke * 20], erase = stroke === 3 || stroke === 7
      for (let y = stroke * 7; y < height; y += 3) for (let x = stroke * 11; x < width; x += 2) {
        const alpha = ((x + y + stroke) % 23) / 23, at = (y * width + x) * 4
        surface.blend(x, y, alpha, color, erase)
        for (let c = 0; c < 4; c++) dense[at + c] = (erase ? 0 : (c === 3 ? 1 : color[c]) * alpha) + dense[at + c] * (1 - alpha)
      }
    }
    const rgba = new Uint8ClampedArray(dense.length)
    for (let i = 0; i < rgba.length; i += 4) {
      if (dense[i + 3] > 0) for (let c = 0; c < 3; c++) rgba[i + c] = dense[i + c] / dense[i + 3]
      rgba[i + 3] = Math.min(255, Math.floor(dense[i + 3] * 256))
    }
    expect(surface.finish()).toEqual(cropPixels({ width, height, left: 0, top: 0, rgba }))
  })

  it('keeps sub-byte alpha color inside visible bounds but returns a transparent placeholder if all alpha rounds to zero', () => {
    const faint = new VectorSurface(300, 300)
    faint.blend(0, 0, 0.0001, [255, 0, 0], false)
    expect([...faint.finish().rgba]).toEqual([0, 0, 0, 0])
    const visible = new VectorSurface(300, 300)
    visible.blend(127, 128, .5, [0, 0, 0], false)
    visible.blend(128, 128, .0001, [255, 0, 0], false)
    visible.blend(129, 128, .5, [0, 0, 0], false)
    const image = visible.finish()
    expect(image).toMatchObject({ width: 3, height: 1, left: 127, top: 128 })
    expect([...image.rgba]).toEqual([0, 0, 0, 128, 255, 0, 0, 0, 0, 0, 0, 128])
  })

  it('avoids untouched tiles and releases compositing buffers when finished', () => {
    const allocations: number[] = []
    vi.stubGlobal('Float32Array', new Proxy(Float32Array, { construct(target, args) {
      const array = Reflect.construct(target, args) as Float32Array
      allocations.push(array.byteLength); return array
    } }))
    const surface = new VectorSurface(4096, 4096)
    surface.blend(2000, 2000, 1, [0, 0, 0], true)
    expect(allocations).toEqual([])
    surface.blend(255, 255, 1, [255, 0, 0], false)
    surface.blend(256, 255, .5, [0, 0, 255], false)
    expect(allocations.reduce((a, b) => a + b, 0)).toBe(2 * 128 * 128 * 16)
    expect(surface.finish()).toMatchObject({ left: 255, top: 255, width: 2, height: 1 })
    expect(surface.finish()).toMatchObject({ left: 0, top: 0, width: 1, height: 1, rgba: new Uint8ClampedArray(4) })
  })
})
