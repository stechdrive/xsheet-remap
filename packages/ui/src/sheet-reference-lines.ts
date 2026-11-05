import type { NormalizedPoint as Point } from '@xsheet-remap/core'
import type { SheetRaster } from './sheet-reference-raster'

export type Size = { width: number; height: number }
export type Ray = { nx: number; ny: number; offset: number; continues: boolean; samples: number[]; nearCount: number }
export type RailEvidence = { distant: number | null; neighbors: { distance: number; offset: number }[] }

function median(values: number[]): number {
  values.sort((a, b) => a - b)
  return (values[(values.length - 1) >> 1] + values[values.length >> 1]) / 2
}

// Only read a patch around the corner. Cap the sampling density for large originals.
export function cornerPatch(raster: SheetRaster, corner: Point, size: Size, radius = 84) {
  const { image, rect } = raster
  const sx = Math.min(2, (image.naturalWidth || image.width) / (size.width * rect.w))
  const sy = Math.min(2, (image.naturalHeight || image.height) / (size.height * rect.h))
  const left = Math.floor((corner.x - radius) * sx),
    top = Math.floor((corner.y - radius) * sy)
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(2 * radius * sx) + 2
  canvas.height = Math.ceil(2 * radius * sy) + 2
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

export function measureRay(sample: (x: number, y: number) => number, from: Point, to: Point, start = 9, end = 69): Ray | null {
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
  let nearCount = 0
  const stop = Math.min(end, length * 0.65)
  for (let distance = start; distance <= stop; distance += 4) {
    const values = Array.from({ length: 15 }, (_, i) => contrast(distance, i - 7))
    const i = values.indexOf(Math.max(...values))
    if (i === 0 || i === 14 || values[i] < 12) continue
    const a = values[i - 1],
      b = values[i],
      c = values[i + 1],
      den = a - 2 * b + c
    offsets.push(i - 7 + (Math.abs(den) > 1e-6 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0))
    if (distance <= (start + stop) / 2) nearCount++
    strengths.push(b)
  }
  if (offsets.length < Math.max(3, Math.ceil(((stop - start + 4) / 4) * 0.55))) return null
  const offset = median(offsets.slice())
  if (median(offsets.map(q => Math.abs(q - offset))) > 1) return null
  const outside = Array.from({ length: 9 }, (_, i) => contrast(-9 - 4 * i, offset))
  return { nx, ny, offset, samples: offsets, nearCount, continues: median(outside) > Math.max(12, median(strengths) * 0.5) }
}

export function partialRayShift(scan: Ray, reference: Ray): number | null {
  const halves = (r: Ray) => {
    if (r.nearCount < 3 || r.samples.length - r.nearCount < 3) return null
    return [median(r.samples.slice(0, r.nearCount)), median(r.samples.slice(r.nearCount))]
  }
  const delta = scan.offset - reference.offset
  if (Math.abs(delta) < 0.55 || Math.abs(delta) > 6.5) return null
  const observed = halves(scan), expected = halves(reference)
  if (!observed || !expected) return null
  const near = observed[0] - expected[0], far = observed[1] - expected[1]
  return near * far > 0 && Math.abs(near - far) <= 0.75 ? delta : null
}

// Work in the local tangent/normal frame so rotated sheets and unequal paper sizes
// use the same checks. The signed span points towards the inside of the table.
export function railFrame(from: Point, to: Point, other: Point) {
  const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy)
  const vx = dx / length, vy = dy / length
  const span = (other.x - from.x) * -vy + (other.y - from.y) * vx
  return {
    length, span,
    at: (along: number, across: number) => ({ x: from.x + vx * along - vy * across, y: from.y + vy * along + vx * across }),
  }
}

type Frame = ReturnType<typeof railFrame>

function distantOffset(raster: SheetRaster, frame: Frame, size: Size) {
  if (frame.length * 0.65 < 117) return null
  const patch = cornerPatch(raster, frame.at(104, 0), size, 25)
  return measureRay(patch, frame.at(0, 0), frame.at(frame.length, 0), 91, 117)?.offset ?? null
}

function neighborOffset(raster: SheetRaster, frame: Frame, size: Size, distance: number) {
  const patch = cornerPatch(raster, frame.at(41, distance), size, 44)
  return measureRay(patch, frame.at(0, distance), frame.at(frame.length, distance), 13, 69)?.offset ?? null
}

export function referenceRails(raster: SheetRaster, frame: Frame, size: Size): RailEvidence {
  const distant = distantOffset(raster, frame, size)
  const neighbors: RailEvidence['neighbors'] = []
  if (distant === null) return { distant, neighbors }
  const sign = Math.sign(frame.span), max = Math.min(92, Math.abs(frame.span) * 0.4)
  const sample = cornerPatch(raster, frame.at(43, 50 * sign), size, 69)
  const candidates: { distance: number; score: number }[] = []
  for (let d = 13; d <= max; d++) {
    const distance = d * sign, contrasts: number[] = []
    for (let along = 13; along <= 69; along += 4) {
      const p = frame.at(along, distance), left = frame.at(along, distance - 3.5), right = frame.at(along, distance + 3.5)
      contrasts.push(Math.min(sample(left.x, left.y), sample(right.x, right.y)) - sample(p.x, p.y))
    }
    const strength = median(contrasts)
    if (strength >= 22 && contrasts.filter(v => v >= 12).length >= contrasts.length * 0.65)
      candidates.push({ distance, score: strength - 0.25 * d })
  }
  candidates.sort((a, b) => b.score - a.score)
  for (const { distance } of candidates) {
    if (neighbors.some(n => Math.abs(n.distance - distance) < 11)) continue
    const offset = neighborOffset(raster, frame, size, distance)
    if (offset !== null && Math.abs(offset) <= 2) neighbors.push({ distance, offset })
    if (neighbors.length === 2) break
  }
  return { distant, neighbors }
}

export function corroborateRail(raster: SheetRaster, frame: Frame, size: Size, reference: RailEvidence, scale: number, delta: number) {
  if (reference.distant === null || !reference.neighbors.length || !Number.isFinite(scale) || scale <= 0) return false
  const distant = distantOffset(raster, frame, size)
  if (distant === null || Math.abs(distant - reference.distant - delta) > 0.9) return false
  let supported = false
  for (const neighbor of reference.neighbors) {
    const offset = neighborOffset(raster, frame, size, neighbor.distance * scale)
    if (offset === null) continue
    if (Math.abs(offset - neighbor.offset * scale - delta) > 1.05) return false
    supported = true
  }
  return supported
}
