import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import init, { type CanvasKit } from 'canvaskit-wasm'

export type Raster = { width: number; height: number; data: Uint8Array; layout: 'rgba' | 'rgb-planar' }
export type PixelRect = { x: number; y: number; width: number; height: number }
export type GlyphTarget = { xPx: number; yPx: number; size: number; color: string }

let kit: Promise<CanvasKit> | undefined
// Decode test artifacts once in the test process, never through browser IPC.
export async function readRaster(bytes: Uint8Array): Promise<Raster> {
  const require = createRequire(import.meta.url)
  if (!kit) {
    const options = { locateFile: () => require.resolve('canvaskit-wasm/bin/canvaskit.wasm'),
      wasmBinary: readFileSync(require.resolve('canvaskit-wasm/bin/canvaskit.wasm')) }
    kit = init(options)
  }
  const canvasKit = await kit
  const image = canvasKit.MakeImageFromEncoded(bytes)
  if (!image) throw new Error('Cannot decode image artifact')
  try {
    const width = image.width(), height = image.height()
    const data = image.readPixels(0, 0, { width, height, alphaType: canvasKit.AlphaType.Unpremul,
      colorType: canvasKit.ColorType.RGBA_8888, colorSpace: canvasKit.ColorSpace.SRGB })
    if (!(data instanceof Uint8Array)) throw new Error('Cannot read image pixels')
    return { width, height, data, layout: 'rgba' }
  } finally { image.delete() }
}

export const readPng = readRaster

export function psdRaster(image: { width: number; height: number; planes: Uint8Array }): Raster {
  return { width: image.width, height: image.height, data: image.planes, layout: 'rgb-planar' }
}

export function channel(image: Raster, x: number, y: number, c: number): number {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) throw new Error('Pixel outside artifact')
  const i = Math.floor(y) * image.width + Math.floor(x)
  return image.layout === 'rgba' ? image.data[i * 4 + c] : c === 3 ? 255 : image.data[i + c * image.width * image.height]
}

export function pinkPixelCount(image: Raster, rect: PixelRect): number {
  let count = 0
  for (let y = Math.max(0, Math.ceil(rect.y)); y < Math.min(image.height, rect.y + rect.height); y++) {
    for (let x = Math.max(0, Math.ceil(rect.x)); x < Math.min(image.width, rect.x + rect.width); x++) {
      if (channel(image, x, y, 0) > 120 && channel(image, x, y, 1) < 100
        && channel(image, x, y, 2) > 100 && channel(image, x, y, 3) > 128) count++
    }
  }
  return count
}

export function glyphInkBounds(image: Raster, targets: GlyphTarget[], screenAntialias = false) {
  return targets.map(target => {
    const rgb = target.color.match(/[0-9a-f]{2}/gi)!.map(value => parseInt(value, 16))
    let minX = image.width, maxX = -1, minY = image.height, maxY = -1, count = 0
    for (let y = Math.max(0, Math.floor(target.yPx - target.size * .88)); y < Math.min(image.height, target.yPx + target.size * .12); y++) {
      for (let x = Math.max(0, Math.floor(target.xPx - target.size / 2)); x < Math.min(image.width, target.xPx + target.size / 2); x++) {
        const actual = rgb.map((_, c) => channel(image, x, y, c))
        // Preserve the existing 60% foreground-coverage test for small screen glyphs.
        const coverage = rgb.reduce((sum, value, c) => sum + (255 - actual[c]) / Math.max(1, 255 - value), 0) / 3
        const antialiased = screenAntialias && coverage >= .6 && coverage <= 1.05
          && rgb.every((value, c) => Math.abs(actual[c] - (255 + (value - 255) * coverage)) < 12)
        if (channel(image, x, y, 3) > 128 && (antialiased || rgb.every((value, c) => Math.abs(actual[c] - value) < 25))) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); count++
        }
      }
    }
    return { width: count ? maxX - minX + 1 : 0, height: count ? maxY - minY + 1 : 0, count }
  })
}

export function darkRowBands(image: Raster, rect: PixelRect, threshold = 150) {
  const bands: Array<{ top: number; bottom: number }> = []
  for (let y = Math.max(0, Math.floor(rect.y)); y < Math.min(image.height, rect.y + rect.height); y++) {
    let ink = false
    for (let x = Math.max(0, Math.floor(rect.x)); x < Math.min(image.width, rect.x + rect.width); x++) {
      if ([0, 1, 2].every(c => channel(image, x, y, c) < threshold) && channel(image, x, y, 3) > 128) { ink = true; break }
    }
    if (ink) {
      const last = bands.at(-1)
      if (last && last.bottom === y - 1) last.bottom = y
      else bands.push({ top: y, bottom: y })
    }
  }
  return bands
}
