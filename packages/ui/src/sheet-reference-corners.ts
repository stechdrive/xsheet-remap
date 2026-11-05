import type { NormalizedPoint } from '@xsheet-remap/core'
import type { SheetRaster } from './sheet-reference-raster'

type Point = NormalizedPoint
type Ray = { nx: number; ny: number; offset: number; continues: boolean }
type Corner = { horizontal: Ray | null; vertical: Ray | null }
type Size = { width: number; height: number }

function median(values: number[]): number {
  values.sort((a, b) => a - b)
  return (values[(values.length - 1) >> 1] + values[values.length >> 1]) / 2
}

// Only read a patch around the corner. Cap the sampling density for large originals.
function cornerPatch(raster: SheetRaster, corner: Point, size: Size) {
  const { image, rect } = raster
  const sx = Math.min(2, (image.naturalWidth || image.width) / (size.width * rect.w))
  const sy = Math.min(2, (image.naturalHeight || image.height) / (size.height * rect.h))
  const left = Math.floor((corner.x - 84) * sx),
    top = Math.floor((corner.y - 84) * sy)
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(168 * sx) + 2
  canvas.height = Math.ceil(168 * sy) + 2
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 2D unavailable')
  ctx.fillStyle = 'white'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(
    image,
    rect.x * size.width * sx - left,
    rect.y * size.height * sy - top,
    rect.w * size.width * sx,
    rect.h * size.height * sy,
  )
  const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  const gray = new Uint8Array(canvas.width * canvas.height)
  for (let i = 0; i < gray.length; i++)
    gray[i] = Math.round(rgba[4 * i] * 0.299 + rgba[4 * i + 1] * 0.587 + rgba[4 * i + 2] * 0.114)
  return (x: number, y: number) => {
    const u = x * sx - left,
      v = y * sy - top
    if (u < 0 || v < 0 || u >= canvas.width - 1 || v >= canvas.height - 1) return 255
    const ix = Math.floor(u),
      iy = Math.floor(v),
      fx = u - ix,
      fy = v - iy,
      k = iy * canvas.width + ix
    const upper = gray[k] + fx * (gray[k + 1] - gray[k])
    const lower = gray[k + canvas.width] + fx * (gray[k + canvas.width + 1] - gray[k + canvas.width])
    return upper + fy * (lower - upper)
  }
}

function measureRay(sample: (x: number, y: number) => number, from: Point, to: Point): Ray | null {
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  if (length < 20) return null
  const vx = (to.x - from.x) / length,
    vy = (to.y - from.y) / length
  const nx = -vy,
    ny = vx
  function contrast(distance: number, offset: number) {
    const x = from.x + vx * distance + nx * offset,
      y = from.y + vy * distance + ny * offset
    return Math.max(0, Math.min(sample(x + 3.5 * nx, y + 3.5 * ny), sample(x - 3.5 * nx, y - 3.5 * ny)) - sample(x, y))
  }
  const offsets: number[] = [],
    strengths: number[] = []
  const stop = Math.min(69, length * 0.65)
  for (let distance = 9; distance <= stop; distance += 4) {
    const values = Array.from({ length: 15 }, (_, i) => contrast(distance, i - 7))
    const i = values.indexOf(Math.max(...values))
    if (i === 0 || i === 14 || values[i] < 12) continue
    const a = values[i - 1],
      b = values[i],
      c = values[i + 1],
      den = a - 2 * b + c
    offsets.push(i - 7 + (Math.abs(den) > 1e-6 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0))
    strengths.push(b)
  }
  if (offsets.length < Math.max(3, Math.ceil(((stop - 9 + 4) / 4) * 0.55))) return null
  const offset = median(offsets)
  if (median(offsets.map(q => Math.abs(q - offset))) > 1) return null
  const outside = Array.from({ length: 9 }, (_, i) => contrast(-9 - 4 * i, offset))
  return { nx, ny, offset, continues: median(outside) > Math.max(12, median(strengths) * 0.5) }
}

function measureCorners(raster: SheetRaster, points: Point[], size: Size): Corner[] {
  const pixels = points.map(p => ({ x: p.x * size.width, y: p.y * size.height }))
  return pixels.map((p, i) => {
    const sample = cornerPatch(raster, p, size)
    return {
      horizontal: measureRay(sample, p, pixels[[1, 0, 3, 2][i]]),
      vertical: measureRay(sample, p, pixels[[3, 2, 1, 0][i]]),
    }
  })
}

const templates = new WeakMap<SheetRaster, { key: string; corners: Corner[] }>()

export function refineRegisteredCorners(
  reference: SheetRaster,
  scan: SheetRaster,
  targets: Point[],
  seed: Point[],
  size: Size,
) {
  const key = [size.width, size.height, ...targets.flatMap(p => [p.x, p.y])].join(',')
  let cached = templates.get(reference)
  if (cached?.key !== key) {
    cached = { key, corners: measureCorners(reference, targets, size) }
    templates.set(reference, cached)
  }
  const observed = measureCorners(scan, seed, size)
  const estimated: number[] = []
  let measurable = 0
  const corners = observed.map((lines, i) => {
    const target = cached.corners[i]
    const h = lines.horizontal,
      v = lines.vertical,
      th = target.horizontal,
      tv = target.vertical
    if (th && tv) measurable++
    if (h && v && th && tv && h.continues === th.continues && v.continues === tv.continues) {
      const det = h.nx * v.ny - h.ny * v.nx
      const dh = h.offset - th.offset,
        dv = v.offset - tv.offset
      const dx = (dh * v.ny - h.ny * dv) / det,
        dy = (h.nx * dv - dh * v.nx) / det
      const distance = Math.hypot(dx, dy)
      if (distance <= 7) {
        if (distance < 0.55) return seed[i]
        const x = seed[i].x + dx / size.width,
          y = seed[i].y + dy / size.height
        if (x >= 0 && x <= 1 && y >= 0 && y <= 1) return { x, y }
      }
    }
    estimated.push(i)
    return seed[i]
  })
  return { corners, estimated, measurable }
}
