// Adapted from csp-paperback a454748 (MIT, Copyright (c) 2025 stechdrive).
// See THIRD_PARTY_NOTICES.md. Preview decoding only; export policies are not imported.
import type { WatercolorEffect } from './rendering'

function smooth(source: Float32Array, width: number, height: number, weights: number[]): Float32Array {
  const radius = (weights.length - 1) / 2
  const temp = new Float32Array(source.length), result = new Float32Array(source.length)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let value = 0
    for (let k = Math.max(-radius, -x); k <= Math.min(radius, width - x - 1); k++) value += source[y * width + x + k] * weights[k + radius]
    temp[y * width + x] = value
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let value = 0
    for (let k = Math.max(-radius, -y); k <= Math.min(radius, height - y - 1); k++) value += temp[(y + k) * width + x] * weights[k + radius]
    result[y * width + x] = value
  }
  return result
}

/** Empirical normal-watercolor model, not CSP's published/internal algorithm.
 * A support-mask curvature field creates a darkened rim, which is blurred in
 * premultiplied RGBA before being added to the original paint. Native fixtures
 * constrain the range/strength profile; thin strokes still differ.
 */
function renderTile(data: Uint8ClampedArray, width: number, height: number, effect: WatercolorEffect): void {
  const count = width * height, mask = new Float32Array(count)
  for (let i = 0; i < count; i++) mask[i] = data[i * 4 + 3] ? 1 : 0
  const radius = Math.max(0, Math.ceil(effect.range) - 1), weights: number[] = []
  let value = 0
  for (let i = radius; i >= 0; i--) {
    value += i === 0 ? 0.03 * Math.min(effect.range, 1) : 0.1 * Math.max(0, effect.range - i) / (effect.range + 1)
    weights[radius + i] = weights[radius - i] = value
  }
  const gain = weights.reduce((sum, weight) => sum + weight, 0)
  const support = smooth(mask, width, height, weights.map(weight => weight / gain))
  const channels: Float32Array[] = Array.from({ length: 4 }, () => new Float32Array(count))
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x
    let alpha = data[i * 4 + 3]
    if (!alpha) continue
    for (let dy = Math.max(-1, -y); dy <= Math.min(1, height - y - 1); dy++) {
      for (let dx = Math.max(-1, -x); dx <= Math.min(1, width - x - 1); dx++) alpha = Math.max(alpha, data[(i + dy * width + dx) * 4 + 3])
    }
    const curvature = 4 * support[i] - (x ? support[i - 1] : 0) - (x + 1 < width ? support[i + 1] : 0)
      - (y ? support[i - width] : 0) - (y + 1 < height ? support[i + width] : 0)
    const extra = Math.min(255, Math.max(0, curvature) * gain * alpha * effect.opacity)
    channels[3][i] = extra
    const brightness = Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])
    const scale = brightness ? Math.max(0, brightness - 2 * effect.darkness) / brightness : 0
    for (let c = 0; c < 3; c++) channels[c][i] = data[i * 4 + c] * scale * extra
  }
  if (effect.blur > 0.2) {
    const sigma = effect.blur / 3, radius = Math.ceil(effect.blur)
    const weights = Array.from({ length: radius * 2 + 1 }, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma)))
    const sum = weights.reduce((a, b) => a + b, 0)
    for (let i = 0; i < weights.length; i++) weights[i] /= sum
    for (let c = 0; c < 4; c++) channels[c] = smooth(channels[c], width, height, weights)
  }
  for (let i = 0; i < count; i++) {
    const alpha = data[i * 4 + 3], total = alpha + channels[3][i]
    if (!total) continue
    // Divide by the unclipped sum to preserve rim color even at saturated alpha.
    for (let c = 0; c < 3; c++) data[i * 4 + c] = (data[i * 4 + c] * alpha + channels[c][i]) / total
    data[i * 4 + 3] = total
  }
}

export function applyWatercolor(data: Uint8ClampedArray, width: number, height: number, effect: WatercolorEffect): void {
  if (effect.style || !effect.range || !effect.opacity) return
  // Keep float working buffers bounded on production-size canvases. The halo
  // includes both filters and the curvature/alpha-neighbor taps, so tiles agree.
  const source = new Uint8ClampedArray(data), halo = Math.ceil(effect.range) + Math.ceil(effect.blur) + 2
  const tileSize = 256
  for (let ty = 0; ty < height; ty += tileSize) for (let tx = 0; tx < width; tx += tileSize) {
    const left = Math.max(0, tx - halo), top = Math.max(0, ty - halo)
    const right = Math.min(width, tx + tileSize + halo), bottom = Math.min(height, ty + tileSize + halo)
    const w = right - left, h = bottom - top, tile = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) tile.set(source.subarray(((top + y) * width + left) * 4, ((top + y) * width + right) * 4), y * w * 4)
    renderTile(tile, w, h, effect)
    for (let y = ty; y < Math.min(height, ty + tileSize); y++) {
      const start = ((y - top) * w + tx - left) * 4, count = Math.min(tileSize, width - tx) * 4
      data.set(tile.subarray(start, start + count), (y * width + tx) * 4)
    }
  }
}
