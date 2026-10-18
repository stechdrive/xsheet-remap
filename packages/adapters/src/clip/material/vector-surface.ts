// Adapted from csp-paperback 2809271 (MIT, Copyright (c) 2025 stechdrive).
// See THIRD_PARTY_NOTICES.md. Preview decoding only; export policies are not imported.
import type { ClipPixels } from './types'

const SIZE = 128
interface Tile { left: number; top: number; width: number; height: number; data: Float32Array }

/** Sparse premultiplied float surface. Stroke ordering and float rounding stay unchanged. */
export class VectorSurface {
  private tiles = new Map<number, Tile>()
  private lastKey = -1
  private lastTile: Tile | undefined
  private cols: number
  private width: number
  private height: number

  constructor(width: number, height: number) { this.width = width; this.height = height; this.cols = Math.ceil(width / SIZE) }

  blend(x: number, y: number, alpha: number, color: number[], erase: boolean): void {
    const col = Math.floor(x / SIZE), row = Math.floor(y / SIZE), key = row * this.cols + col
    let tile = key === this.lastKey ? this.lastTile : this.tiles.get(key)
    if (!tile) {
      // Erasing untouched pixels cannot add coverage or color.
      if (erase) return
      const left = col * SIZE, top = row * SIZE
      const width = Math.min(SIZE, this.width - left), height = Math.min(SIZE, this.height - top)
      tile = { left, top, width, height, data: new Float32Array(width * height * 4) }
      this.tiles.set(key, tile)
    }
    this.lastKey = key; this.lastTile = tile
    const at = ((y - tile.top) * tile.width + x - tile.left) * 4, remain = 1 - alpha
    for (let c = 0; c < 3; c++) tile.data[at + c] = (erase ? 0 : color[c] * alpha) + tile.data[at + c] * remain
    tile.data[at + 3] = (erase ? 0 : alpha) + tile.data[at + 3] * remain
  }

  finish(): ClipPixels {
    let left = this.width, top = this.height, right = 0, bottom = 0
    for (const tile of this.tiles.values()) {
      for (let y = 0; y < tile.height; y++) for (let x = 0; x < tile.width; x++) {
        // Match the existing byte-alpha conversion before finding crop bounds.
        if (Math.floor(tile.data[(y * tile.width + x) * 4 + 3] * 256) > 0) {
          left = Math.min(left, tile.left + x); top = Math.min(top, tile.top + y)
          right = Math.max(right, tile.left + x + 1); bottom = Math.max(bottom, tile.top + y + 1)
        }
      }
    }
    if (right <= left || bottom <= top) {
      this.tiles.clear(); this.lastKey = -1; this.lastTile = undefined
      return { width: 1, height: 1, left: 0, top: 0, rgba: new Uint8ClampedArray(4) }
    }
    const width = right - left, height = bottom - top, rgba = new Uint8ClampedArray(width * height * 4)
    for (const tile of this.tiles.values()) {
      const x0 = Math.max(0, left - tile.left), y0 = Math.max(0, top - tile.top)
      const x1 = Math.min(tile.width, right - tile.left), y1 = Math.min(tile.height, bottom - tile.top)
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const from = (y * tile.width + x) * 4, to = ((tile.top + y - top) * width + tile.left + x - left) * 4
        const a = tile.data[from + 3]
        if (a > 0) for (let c = 0; c < 3; c++) rgba[to + c] = tile.data[from + c] / a
        rgba[to + 3] = Math.min(255, Math.floor(a * 256))
      }
    }
    this.tiles.clear(); this.lastKey = -1; this.lastTile = undefined
    return { width, height, left, top, rgba }
  }
}
