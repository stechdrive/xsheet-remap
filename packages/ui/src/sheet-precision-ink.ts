import type { Homography } from './sheetImages'
import { applyHomography } from './sheetImages'
import type { SheetRaster } from './sheet-reference-raster'
import type { PrecisionGuideAnchor } from './sheetPrecisionCorrection'

const TILE = 24

// Mark the two directional search strips. Adjacent strips share the same inverse projection.
function guideTiles(anchors: PrecisionGuideAnchor[], width: number, height: number) {
  const columns = Math.ceil(width / TILE),
    rows = Math.ceil(height / TILE)
  const used = new Uint8Array(columns * rows)
  function mark(x: number, y: number, halfWidth: number, halfHeight: number) {
    const left = Math.max(0, Math.floor((x - halfWidth) / TILE)),
      right = Math.min(columns - 1, Math.floor((x + halfWidth) / TILE))
    const top = Math.max(0, Math.floor((y - halfHeight) / TILE)),
      bottom = Math.min(rows - 1, Math.floor((y + halfHeight) / TILE))
    if (right < left) return
    for (let row = top; row <= bottom; row++) used.fill(1, row * columns + left, row * columns + right + 1)
  }
  for (const anchor of anchors) {
    const x = anchor.x * width,
      y = anchor.y * height,
      radius = anchor.searchRadiusPx + 6
    mark(x, y, radius, anchor.verticalSpanPx + 1)
    mark(x, y, anchor.horizontalSpanPx + 1, radius)
  }
  return { columns, rows, used }
}

export const identitySheetTransform: Homography = [1, 0, 0, 0, 1, 0, 0, 0, 1]

export function precisionGuideInk(
  raster: SheetRaster,
  h: Homography,
  width: number,
  height: number,
  anchors: PrecisionGuideAnchor[],
): Uint8Array {
  const darkness = new Uint8Array(width * height)
  const { rows, columns, used } = guideTiles(anchors, width, height)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return darkness
  const { image, rect } = raster
  const nativeX = (image.naturalWidth || image.width) / (width * rect.w)
  const nativeY = (image.naturalHeight || image.height) / (height * rect.h)
  const identity = h.every((v, i) => Math.abs(v - identitySheetTransform[i]) < 1e-12)
  function sampleStrip(left: number, top: number, right: number, bottom: number) {
    let x0 = left,
      y0 = top,
      x1 = right,
      y1 = bottom
    if (!identity) {
      const quad = [
        [left, top],
        [right - 1, top],
        [right - 1, bottom - 1],
        [left, bottom - 1],
      ]
      const points = quad.map(([x, y]) => applyHomography(h, (x + 0.5) / width, (y + 0.5) / height))
      if (points.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return
      const xs = points.map(p => p!.x * width - 0.5),
        ys = points.map(p => p!.y * height - 0.5)
      x0 = Math.max(0, Math.floor(Math.min(...xs)) - 1)
      y0 = Math.max(0, Math.floor(Math.min(...ys)) - 1)
      x1 = Math.min(width, Math.ceil(Math.max(...xs)) + 2)
      y1 = Math.min(height, Math.ceil(Math.max(...ys)) + 2)
    }
    const w = x1 - x0,
      hh = y1 - y0
    if (w <= 0 || hh <= 0) return
    // Reuse the backing store between strips. Source and destination pixels share the same center convention as export.
    if (canvas.width < w) canvas.width = w
    if (canvas.height < hh) canvas.height = hh
    ctx!.fillStyle = 'white'
    ctx!.fillRect(0, 0, w, hh)
    ctx!.drawImage(
      image,
      (x0 - rect.x * width) * nativeX,
      (y0 - rect.y * height) * nativeY,
      w * nativeX,
      hh * nativeY,
      0,
      0,
      w,
      hh,
    )
    const pixels = ctx!.getImageData(0, 0, w, hh).data
    // Measure ink before interpolation so a thin rule retains its signal between projected pixels.
    const ink = new Uint8Array(w * hh)
    for (let i = 0; i < ink.length; i++) {
      const luminance = Math.round(pixels[4 * i] * 0.299 + pixels[4 * i + 1] * 0.587 + pixels[4 * i + 2] * 0.114)
      ink[i] = Math.round(Math.max(0, Math.min(255, (205 - luminance) * 1.55)))
    }
    for (let y = top; y < bottom; y++) {
      const v = (y + 0.5) / height
      for (let x = left; x < right; x++) {
        let sample: number
        if (identity) {
          sample = ink[(y - y0) * w + x - x0]
        } else {
          const u = (x + 0.5) / width,
            den = h[6] * u + h[7] * v + h[8]
          const px = ((h[0] * u + h[1] * v + h[2]) / den) * width - 0.5,
            py = ((h[3] * u + h[4] * v + h[5]) / den) * height - 0.5
          if (px < -0.5 || py < -0.5 || px > width - 0.5 || py > height - 0.5) continue
          const sx = Math.max(0, Math.min(w - 1, px - x0)),
            sy = Math.max(0, Math.min(hh - 1, py - y0))
          const ix = Math.floor(sx),
            iy = Math.floor(sy),
            fx = sx - ix,
            fy = sy - iy
          const k = iy * w + ix,
            n = iy * w + Math.min(w - 1, ix + 1),
            below = iy + 1 < hh ? w : 0
          const upper = ink[k] + fx * (ink[n] - ink[k])
          const lower = ink[k + below] + fx * (ink[n + below] - ink[k + below])
          sample = upper + fy * (lower - upper)
        }
        darkness[y * width + x] = Math.round(sample)
      }
    }
  }
  for (let row = 0; row < rows; row++) {
    let col = 0
    while (col < columns) {
      if (!used[row * columns + col]) {
        col++
        continue
      }
      const start = col
      while (col < columns && used[row * columns + col]) col++
      sampleStrip(start * TILE, row * TILE, Math.min(width, col * TILE), Math.min(height, (row + 1) * TILE))
    }
  }
  return darkness
}
