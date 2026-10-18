// Ported from csp-paperback 2809271; MIT, Copyright (c) 2025 stechdrive.
import { describe, expect, it } from 'vitest'
import { inflateSync } from 'node:zlib'
import { readVectorStrokes, renderVectors, type VectorBrushes } from './vector'
import { brushRandom, readBrushDynamics } from './vector-dynamics'
import { vectorBytes } from '../fixtures/clip-vector'
import { readFileSync } from 'node:fs'
import type { ClipPixels } from './types'

const goldens = JSON.parse(readFileSync(new URL('../fixtures/native-vector-goldens.json', import.meta.url), 'utf8')) as {
  seed: number; points: number[][]; crop: { x: number; y: number; width: number; height: number }
  cases: { name: string; diameter: number; autoInterval: number; interval: number; alphaDeflateBase64: string }[]
}

const alpha = (p: ClipPixels, x: number, y: number) => x < p.left || y < p.top || x >= p.left + p.width || y >= p.top + p.height ? 0 : p.rgba[((y - p.top) * p.width + x - p.left) * 4 + 3]
const hex = (s: string) => new Uint8Array(Buffer.from(s, 'hex'))
const brush = (): VectorBrushes => ({ styles: new Map([[7, { Hardness: 1, AntiAlias: 1, CompositeMode: 0, ThicknessBase: 1 }]]), patterns: new Map(), graphs: new Map() })

describe('native CSP controlled vector captures', () => {
  it('matches the native weak-AA round click pixel for pixel', () => {
    const p = renderVectors(readVectorStrokes(vectorBytes({ diameter: 7 })), brush(), 16, 16)
    const rows = Array.from({ length: 6 }, (_, y) => Array.from({ length: 6 }, (_, x) => alpha(p, x + 5, y + 5)))
    expect(rows).toEqual([
      [0, 99, 162, 162, 99, 0], [99, 235, 255, 255, 235, 99],
      [162, 255, 255, 255, 255, 162], [162, 255, 255, 255, 255, 162],
      [99, 235, 255, 255, 235, 99], [0, 99, 162, 162, 99, 0],
    ])
  })
  it.each(goldens.cases)('matches the native PSD for $name without moving the curve', test => {
    const b = brush()
    Object.assign(b.styles.get(7)!, { FlowBase: .5, FlowEffector: hex('0000008100000000'), RotationEffector: 131,
      RotationRandom: 1, AutoIntervalType: test.autoInterval, IntervalBase: test.interval })
    const p = renderVectors(readVectorStrokes(vectorBytes({ diameter: test.diameter, randomSeed: goldens.seed, points: goldens.points, flags: 17 })), b, 512, 128)
    const expected = inflateSync(Buffer.from(test.alphaDeflateBase64, 'base64'))
    const { x, y, width, height } = goldens.crop
    expect(expected).toHaveLength(width * height)
    let error = 0, referenceMass = 0
    for (let i = 0; i < expected.length; i++) {
      error += Math.abs(alpha(p, x + i % width, y + Math.floor(i / width)) - expected[i])
      referenceMass += expected[i]
    }
    // Native round/position quantization differs slightly; compare only ink, not empty canvas.
    expect(error / referenceMass).toBeLessThan(.0015)
  })
  it('uses the native seed and consumes rotation before density', () => {
    const b = brush(), strokes = readVectorStrokes(vectorBytes({ diameter: 7, randomSeed: 14978491 }))
    Object.assign(b.styles.get(7)!, { FlowEffector: hex('0000008100000000'), RotationEffector: 3 })
    expect(alpha(renderVectors(strokes, b, 16, 16), 8, 8)).toBe(60)
    b.styles.get(7)!.RotationEffector = 131
    expect(alpha(renderVectors(strokes, b, 16, 16), 8, 8)).toBe(116)
    b.styles.get(7)!.FlowEffector = hex('000000813f000000')
    expect(alpha(renderVectors(strokes, b, 16, 16), 8, 8)).toBe(186)
  })
  it('reads the speed graph after the random minimum without consuming graph bits as a float', () => {
    const points = Buffer.alloc(32)
    points.writeDoubleBE(1, 8); points.writeDoubleBE(1, 16)
    const graph = new Map([[2, { ControlNumber: 2, ControlPoints: new Uint8Array(points) }]])
    const dynamics = readBrushDynamics(hex('000000c1000000003f00000000000002'), graph)
    const p = readVectorStrokes(vectorBytes())[0].points[0]
    expect(dynamics.randomMinimum).toBe(.5)
    expect(dynamics.value({ ...p, smooth: .25 })).toBe(.75)
    expect(dynamics.value({ ...p, smooth: 1 })).toBe(0)
    expect(() => readBrushDynamics(hex('000000c100000000'), graph)).toThrow('切れ')
  })
  it('restarts each stroke deterministically instead of sharing a global RNG', () => {
    const a = brushRandom(14978491), b = brushRandom(14978491)
    expect(a()).toBe(7732 / 32768)
    expect(b()).toBe(7732 / 32768)
    expect(a()).toBe(14901 / 32768)
  })
})
