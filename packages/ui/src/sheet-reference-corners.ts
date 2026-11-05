import type { NormalizedPoint as Point } from '@xsheet-remap/core'
import type { SheetRaster } from './sheet-reference-raster'
import { cornerPatch, corroborateRail, measureRay, partialRayShift, railFrame, referenceRails, type RailEvidence, type Ray, type Size } from './sheet-reference-lines'

type Corner = { horizontal: Ray | null; vertical: Ray | null }
const horizontalNeighbor = [1, 0, 3, 2]
const verticalNeighbor = [3, 2, 1, 0]

function measureCorners(raster: SheetRaster, pixels: Point[], size: Size): Corner[] {
  return pixels.map((p, i) => {
    const sample = cornerPatch(raster, p, size)
    return {
      horizontal: measureRay(sample, p, pixels[horizontalNeighbor[i]]),
      vertical: measureRay(sample, p, pixels[verticalNeighbor[i]]),
    }
  })
}

const templates = new WeakMap<SheetRaster, { key: string; pixels: Point[]; corners: Corner[]; rails: Map<number, RailEvidence> }>()

export function refineRegisteredCorners(
  reference: SheetRaster,
  scan: SheetRaster,
  targets: Point[],
  seed: Point[],
  size: Size,
  allowPartial = false,
) {
  const key = [size.width, size.height, ...targets.flatMap(p => [p.x, p.y])].join(',')
  const toPixels = (p: Point) => ({ x: p.x * size.width, y: p.y * size.height })
  let cached = templates.get(reference)
  if (cached?.key !== key) {
    const pixels = targets.map(toPixels)
    cached = { key, pixels, corners: measureCorners(reference, pixels, size), rails: new Map() }
    templates.set(reference, cached)
  }
  const pixels = seed.map(toPixels)
  const observed = measureCorners(scan, pixels, size)
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
    // A single rail constrains only its normal. Retain the estimated-corner flag.
    if (!allowPartial) return seed[i]
    const horizontal = h && th && h.continues === th.continues
    const vertical = v && tv && v.continues === tv.continues
    if (!!horizontal === !!vertical) return seed[i]
    const ray = horizontal ? h : v, expected = horizontal ? th : tv
    if (!ray || !expected) return seed[i]
    const delta = partialRayShift(ray, expected)
    if (delta === null) return seed[i]
    const along = horizontal ? horizontalNeighbor[i] : verticalNeighbor[i]
    const across = horizontal ? verticalNeighbor[i] : horizontalNeighbor[i]
    const frame = (p: Point[]) => railFrame(p[i], p[along], p[across])
    const model = frame(cached.pixels), actual = frame(pixels), id = 2 * i + Number(!!horizontal)
    let evidence = cached.rails.get(id)
    if (!evidence) {
      evidence = referenceRails(reference, model, size)
      cached.rails.set(id, evidence)
    }
    if (!corroborateRail(scan, actual, size, evidence, actual.span / model.span, delta)) return seed[i]
    const x = seed[i].x + ray.nx * delta / size.width, y = seed[i].y + ray.ny * delta / size.height
    return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : seed[i]
  })
  return { corners, estimated, measurable }
}
