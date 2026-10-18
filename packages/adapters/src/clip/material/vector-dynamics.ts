// Adapted from csp-paperback 2809271 (MIT, Copyright (c) 2025 stechdrive).
// See THIRD_PARTY_NOTICES.md. Preview decoding only; export policies are not imported.
import { check, Reader } from './binary'
import { num, type ClipRow } from './records'
import type { VectorPoint } from './vector'

const clamp = (v: number) => Math.max(0, Math.min(1, v))
type Curve = (v: number) => number

function curve(row: ClipRow | undefined): Curve {
  const count = row && num(row, 'ControlNumber'), data = row?.ControlPoints
  if (!count || !(data instanceof Uint8Array)) return clamp
  check(count <= 256 && data.length === count * 16, '筆圧カーブが不正です')
  const r = new Reader(data), points = Array.from({ length: count }, () => [r.number('f64'), r.number('f64')])
  check(points.every((p, i) => p.every(v => v >= 0 && v <= 1) && (!i || p[0] >= points[i - 1][0])), '筆圧カーブが不正です')
  // Nonlinear CSP graph interpolation is still approximated by line segments.
  return x => {
    if (x <= points[0][0]) return points[0][1]
    for (let i = 1; i < count; i++) if (x <= points[i][0]) {
      const [x0, y0] = points[i - 1], [x1, y1] = points[i]
      return x1 === x0 ? y1 : y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    }
    return points[count - 1][1]
  }
}

export interface BrushDynamics {
  value: (point: VectorPoint) => number
  randomMinimum?: number
}

/** Decode once per brush, including the speed graph stored AFTER the random minimum. */
export function readBrushDynamics(data: ClipRow[string], graphs: Map<number, ClipRow>): BrushDynamics {
  if (!(data instanceof Uint8Array) || !data.length) return { value: () => 1 }
  const r = new Reader(data), flags = r.u32(), factors: Array<(p: VectorPoint) => number> = []
  if (flags & 16) {
    const min = r.number('f32'), response = curve(graphs.get(r.u32()))
    factors.push(p => min + (1 - min) * response(clamp(p.pressure)))
  }
  let velocity: { min: number; response: Curve } | undefined
  if (flags & 32) velocity = { min: r.number('f32'), response: curve(graphs.get(r.u32())) }
  const speedMin = flags & 64 ? r.number('f32') : undefined
  const randomMinimum = flags & 128 ? clamp(r.number('f32')) : undefined
  if (flags & 256) {
    const min = r.number('f32')
    factors.push(p => min + (1 - min) * clamp(Math.abs(p.tilt)))
  }
  if (velocity) {
    // Retain the legacy interpretation for this input; native UI mapping is unverified.
    const { min, response } = velocity, max = r.position + 4 <= data.length ? r.number('f32') : 1
    factors.push(p => min + (max - min) * response(clamp(p.velocity)))
  }
  if (speedMin !== undefined) {
    const response = r.position + 4 <= data.length ? curve(graphs.get(r.u32())) : (v: number) => 1 - clamp(v)
    factors.push(p => speedMin + (1 - speedMin) * response(clamp(p.smooth)))
  }
  return { randomMinimum, value: p => clamp(factors.reduce((out, factor) => out * factor(p), 1)) }
}

/** CLIP saved state transitions and native density/angle fixtures use this 15-bit LCG. */
export function brushRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 0x41c64e6d) + 0x12d687) >>> 0
    return ((state >>> 16) & 32767) / 32768
  }
}
