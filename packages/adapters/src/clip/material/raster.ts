// Adapted from csp-paperback 2809271 (MIT, Copyright (c) 2025 stechdrive).
// See THIRD_PARTY_NOTICES.md. Preview decoding only; export policies are not imported.
// Offscreen format and tile permutation: wamsoft/clipparse (MIT).
import { check, inflate, Reader } from './binary'
import { cropPixels } from './pixels'
import type { ClipPixels } from './types'

export interface OffscreenAttribute {
  width: number; height: number; cols: number; rows: number
  channels: number; bitDepth: number; planeBytes: number
  hasColor: boolean; color: number; rgb?: number[]; sizes: number[]
}

export function readAttribute(bytes: Uint8Array, brushPattern = false): OffscreenAttribute {
  const r = new Reader(bytes)
  r.take(16)
  check(r.wideName() === 'Parameter', '画像のParameterがありません')
  const p = Array.from({ length: 20 }, () => r.u32())
  check(r.wideName() === 'InitColor', '画像のInitColorがありません')
  r.u32()
  const hasColor = r.u32() !== 0, color = r.u32(), extra = r.u32()
  r.u32()
  check(extra <= 4, '未対応の初期色です')
  const colorValues = Array.from({ length: extra }, () => r.u32())
  check(r.wideName() === 'BlockSize', '画像のBlockSizeがありません')
  r.u32()
  const count = r.u32()
  r.u32()
  check(count <= 65536 && count === p[2] * p[3], '画像のタイル数が不正です')
  const sizes = Array.from({ length: count }, () => r.u32())
  check(r.position === bytes.length, '画像属性の末尾が不正です')
  check(p[0] > 0 && p[1] > 0 && p[0] <= p[2] * 256 && p[1] <= p[3] * 256, '画像の寸法が不正です')
  check([1, 33].includes(p[4]) && [0, 1, 2, 4].includes(p[6]) && [1, 5].includes(p[7])
    || brushPattern && p[4] === 17 && p[6] === 1 && p[7] === 2 && p[8] === 65536, '未対応の画像色形式です')
  check(p[14] === 256 && p[15] === 256, '256px以外のタイルには未対応です')
  const rgb = p[6] === 4 && extra === 4 ? [colorValues[2] >>> 24, colorValues[1] >>> 24, colorValues[0] >>> 24] : undefined
  return { width: p[0], height: p[1], cols: p[2], rows: p[3], channels: p[6], bitDepth: p[7], planeBytes: p[8], hasColor, color, rgb, sizes }
}

export async function readRaster(a: OffscreenAttribute, body: Uint8Array | undefined, mask: boolean, crop = false): Promise<ClipPixels | undefined> {
  if (!body && !a.hasColor) return undefined
  check(a.width * a.height <= 64 * 1024 * 1024, '画像1枚のサイズが上限を超えました')
  const baseColor = mask ? [a.color & 255, a.color & 255, a.color & 255, 255] : [...(a.rgb ?? [a.color >>> 24, a.color >>> 16 & 255, a.color >>> 8 & 255]), a.color & 255]
  // Inspect compressed tile headers before allocating pixels. Keep source views,
  // not inflated tiles; each tile is still validated and inflated exactly once.
  const tiles: { x: number; y: number; expected: number; compressed: Uint8Array }[] = []
  const fullExtent = !crop || (mask ? !a.hasColor && (a.color & 255) !== 0 : a.hasColor && baseColor[3] !== 0)
  let left = fullExtent ? 0 : a.width, top = fullExtent ? 0 : a.height
  let right = fullExtent ? a.width : 0, bottom = fullExtent ? a.height : 0
  if (body) {
    const source = new Reader(body)
    for (let index = 0; index < a.sizes.length; index++) {
      const size = a.sizes[index]
      check(size >= 104, 'タイルサイズが不正です')
      const r = new Reader(source.take(size))
      check(r.u32() === size && r.wideName() === 'BlockDataBeginChunk', 'タイルのヘッダーが不正です')
      check(r.u32() === index, 'タイル番号が不正です')
      const length = r.u32(), width = r.u32(), height = r.u32(), hasData = r.u32()
      check(width === 256 && height === 256, 'タイル寸法が不正です')
      if (hasData) {
        const section = r.u32()
        const lengthReader = new Reader(r.take(4), true)
        const compressed = lengthReader.u32()
        check(section === compressed + 4, 'タイルの圧縮サイズが不正です')
        const expected = a.channels === 4 ? 256 * 256 * 5 : a.channels === 0 ? 256 * 256 : a.planeBytes * 2
        check(length === expected && expected <= 327680, '未対応のタイル形式です')
        const x0 = index % a.cols * 256, y0 = Math.floor(index / a.cols) * 256
        tiles.push({ x: x0, y: y0, expected, compressed: r.take(compressed) })
        if (x0 < a.width && y0 < a.height) {
          left = Math.min(left, x0); top = Math.min(top, y0)
          right = Math.max(right, Math.min(a.width, x0 + 256)); bottom = Math.max(bottom, Math.min(a.height, y0 + 256))
        }
      }
      check(r.wideName() === 'BlockDataEndChunk' && r.position === size, 'タイルの終端が不正です')
    }
    // Some files have a BlockStatus/BlockCheckSum trailer; the per-tile sizes bound decoding.
  }
  if (right <= left || bottom <= top) { left = top = 0; right = bottom = 1 }
  const width = right - left, height = bottom - top
  const rgba = new Uint8ClampedArray(width * height * 4)
  if (a.hasColor) for (let i = 0; i < rgba.length; i += 4) rgba.set(baseColor, i)
  for (const tile of tiles) {
    const raw = await inflate(tile.compressed, tile.expected)
    check(raw.length === tile.expected, 'タイルの展開サイズが不正です')
    for (let y = 0; y < 256 && tile.y + y < a.height; y++) for (let x = 0; x < 256 && tile.x + x < a.width; x++) {
      const pixel = y * 256 + x, dst = ((tile.y + y - top) * width + tile.x + x - left) * 4
      if (a.channels === 4) {
        const color = 65536 + pixel * 4
        rgba[dst] = raw[color + 2]; rgba[dst + 1] = raw[color + 1]; rgba[dst + 2] = raw[color]
        rgba[dst + 3] = raw[(Math.floor(y / 4) * 256 + y % 4 * 64 + Math.floor(x / 4)) * 4 + x % 4]
      } else if (a.channels === 0) {
        rgba[dst] = rgba[dst + 1] = rgba[dst + 2] = mask ? raw[pixel] : 255
        rgba[dst + 3] = mask ? 255 : raw[pixel]
      } else {
        const at = a.bitDepth === 1 ? Math.floor(pixel / 8) : pixel
        const alpha = a.bitDepth === 1 ? (raw[at] >>> (7 - pixel % 8) & 1) * 255 : raw[at]
        const value = a.bitDepth === 1 ? (raw[a.planeBytes + at] >>> (7 - pixel % 8) & 1) * 255 : raw[a.planeBytes + at]
        rgba[dst] = rgba[dst + 1] = rgba[dst + 2] = value
        rgba[dst + 3] = alpha
      }
    }
  }
  const pixels = { width, height, left, top, rgba, defaultColor: a.color & 255 }
  if (!crop) return pixels
  const cropped = cropPixels(pixels, mask)
  // Empty images have always used a 1px placeholder at the offscreen origin.
  if (cropped.width === 1 && cropped.height === 1 && (mask ? cropped.rgba[0] === pixels.defaultColor : cropped.rgba[3] === 0)) {
    cropped.left = cropped.top = 0
  }
  return cropped
}
