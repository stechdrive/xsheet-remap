import type { SheetPrecisionWarp } from './appTypes'

export type PreparedPrecisionWarp = {
  columns: number
  offsets: Float32Array
  xIndices: Int16Array
  xFractions: Float32Array
  xFades: Float32Array
  yIndices: Int16Array
  yFractions: Float32Array
  yFades: Float32Array
}

export function preparePrecisionWarp(
  warp: SheetPrecisionWarp | undefined,
  outputWidth: number,
  outputHeight: number,
): PreparedPrecisionWarp | null {
  if (!warp || warp.version !== 1 || warp.columns < 2 || warp.rows < 2) return null
  if (warp.bounds.w <= 0 || warp.bounds.h <= 0) return null
  if (warp.offsets.length !== warp.columns * warp.rows * 2 || warp.offsets.some(value => !Number.isFinite(value))) return null
  const x = prepareAxis(outputWidth, warp.bounds.x, warp.bounds.w, warp.columns)
  const y = prepareAxis(outputHeight, warp.bounds.y, warp.bounds.h, warp.rows)
  return {
    columns: warp.columns,
    offsets: Float32Array.from(warp.offsets),
    xIndices: x.indices,
    xFractions: x.fractions,
    xFades: x.fades,
    yIndices: y.indices,
    yFractions: y.fractions,
    yFades: y.fades,
  }
}

export function precisionWarpDisplacementAt(
  warp: SheetPrecisionWarp,
  x: number,
  y: number,
): { x: number; y: number } {
  if (warp.columns < 2 || warp.rows < 2 || warp.offsets.length !== warp.columns * warp.rows * 2) {
    return { x: 0, y: 0 }
  }
  const xSample = axisSample(x, warp.bounds.x, warp.bounds.w, warp.columns)
  const ySample = axisSample(y, warp.bounds.y, warp.bounds.h, warp.rows)
  const topLeft = (ySample.index * warp.columns + xSample.index) * 2
  const topRight = topLeft + 2
  const bottomLeft = topLeft + warp.columns * 2
  const bottomRight = bottomLeft + 2
  const topX = lerp(warp.offsets[topLeft] ?? 0, warp.offsets[topRight] ?? 0, xSample.fraction)
  const topY = lerp(warp.offsets[topLeft + 1] ?? 0, warp.offsets[topRight + 1] ?? 0, xSample.fraction)
  const bottomX = lerp(warp.offsets[bottomLeft] ?? 0, warp.offsets[bottomRight] ?? 0, xSample.fraction)
  const bottomY = lerp(warp.offsets[bottomLeft + 1] ?? 0, warp.offsets[bottomRight + 1] ?? 0, xSample.fraction)
  const fade = xSample.fade * ySample.fade
  return {
    x: lerp(topX, bottomX, ySample.fraction) * fade,
    y: lerp(topY, bottomY, ySample.fraction) * fade,
  }
}

function prepareAxis(lengthInput: number, start: number, span: number, count: number) {
  const length = Math.max(1, Math.round(lengthInput))
  const indices = new Int16Array(length)
  const fractions = new Float32Array(length)
  const fades = new Float32Array(length)
  for (let pixel = 0; pixel < length; pixel += 1) {
    const sample = axisSample((pixel + 0.5) / length, start, span, count)
    indices[pixel] = sample.index
    fractions[pixel] = sample.fraction
    fades[pixel] = sample.fade
  }
  return { indices, fractions, fades }
}

function axisSample(value: number, start: number, span: number, count: number) {
  const end = start + span
  const clamped = clamp(value, start, end)
  const local = ((clamped - start) / span) * (count - 1)
  const index = Math.min(count - 2, Math.max(0, Math.floor(local)))
  const fraction = clamp(local - index, 0, 1)
  const feather = Math.max(span * 0.18, 0.025)
  const outsideDistance = value < start ? start - value : value > end ? value - end : 0
  return {
    index,
    fraction,
    fade: clamp(1 - outsideDistance / feather, 0, 1),
  }
}

function lerp(a: number, b: number, amount: number): number {
  return a + (b - a) * amount
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
