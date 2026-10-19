// Adapted from csp-paperback a454748 (MIT, Copyright (c) 2025 stechdrive).
// See THIRD_PARTY_NOTICES.md. Preview decoding only; export policies are not imported.
import type { EdgeEffect } from './rendering'

/** Circular maximum with a soft outer ring, recovered from native alpha kernels.
 * The constant interior uses sliding maxima; only the narrow ring visits offsets.
 * Work is O(pixels * radius), rather than O(pixels * radius squared).
 */
export function applyEdge(data: Uint8ClampedArray, width: number, height: number, edge: EdgeEffect): void {
  const radius = edge.radius
  if (!(radius > 0)) return
  const reflect = !!edge.reflectOpacity, alpha = new Uint8Array(width * height)
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3]
  const expanded = new Float32Array(alpha.length), queue = new Int32Array(width)
  const outerRadius = radius + 1.5, coreRadius = reflect ? radius + 0.5 : radius - 0.5
  const narrowGain = Math.max(0, Math.min(1, radius - 0.5))
  for (let dy = 0; dy <= Math.min(height - 1, Math.ceil(outerRadius)); dy++) {
    const core = (reflect || radius >= 1.5) && dy <= coreRadius
      ? Math.min(width - 1, Math.floor(Math.sqrt(coreRadius ** 2 - dy ** 2))) : -1
    if (core >= 0) {
      for (let y = 0; y < height; y++) {
        const row = y * width
        let head = 0, tail = 0, next = 0
        for (let x = 0; x < width; x++) {
          while (next < width && next <= x + core) {
            while (tail > head && alpha[row + queue[tail - 1]] <= alpha[row + next]) tail--
            queue[tail++] = next++
          }
          while (head < tail && queue[head] < x - core) head++
          const a = alpha[row + queue[head]], value = reflect ? a : a ? 255 : 0
          if (y + dy < height) {
            const at = row + dy * width + x
            if (value > expanded[at]) expanded[at] = value
          }
          if (dy && y >= dy) {
            const at = row - dy * width + x
            if (value > expanded[at]) expanded[at] = value
          }
        }
      }
    }
    const extent = Math.min(width - 1, Math.floor(Math.sqrt(Math.max(0, outerRadius ** 2 - dy ** 2))))
    for (let dx = core + 1; dx <= extent; dx++) {
      const distance = Math.hypot(dx, dy)
      const outer = Math.max(0, Math.min(1, outerRadius - distance))
      if (!outer) continue
      // Below 1.5 px the opaque interior fades in; the center retains source alpha.
      const inner = Math.max(0, Math.min(1, radius + 0.5 - Math.max(1, distance))) * (distance ? narrowGain : 1)
      for (const sy of dy ? [-dy, dy] : [0]) for (const sx of dx ? [-dx, dx] : [0]) {
        const x0 = Math.max(0, -sx), x1 = Math.min(width, width - sx)
        const y0 = Math.max(0, -sy), y1 = Math.min(height, height - sy)
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const a = alpha[y * width + x]
          if (!a) continue
          const value = a * outer + (reflect ? 0 : (255 - a) * inner)
          const at = (y + sy) * width + x + sx
          if (value > expanded[at]) expanded[at] = value
        }
      }
    }
  }
  for (let i = 0; i < alpha.length; i++) {
    const a = alpha[i]
    // CSP disables the AA checkbox while reflect-opacity is enabled.
    const stroke = !reflect && edge.antialias === false ? (expanded[i] >= 128 ? 255 : 0) : expanded[i]
    const combined = reflect ? Math.max(a, stroke) : a + stroke * (1 - a / 255)
    if (!combined) continue
    for (let c = 0; c < 3; c++) data[i * 4 + c] = (data[i * 4 + c] * a + edge.color[c] * (combined - a)) / combined
    data[i * 4 + 3] = Math.floor(combined + 1e-6)
  }
}
