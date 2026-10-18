// Ported from csp-paperback 2809271; MIT, Copyright (c) 2025 stechdrive.
import { describe, expect, it } from 'vitest'
import { readVectorStrokes, renderVectors, type VectorBrushes } from './vector'
import { createBrushTexture } from './vector-texture'
import { vectorBytes } from '../fixtures/clip-vector'
import type { ClipPixels } from './types'

const tip = () => ({ width: 3, height: 2, alpha: new Uint8Array([32, 64, 96, 128, 192, 255]), reverse: 0 })
const brushes = (): VectorBrushes => ({ patterns: new Map([[2, tip()]]), graphs: new Map(),
  styles: new Map([[7, { PatternStyle: 2, AntiAlias: 1, Hardness: 1, RotationEffector: 3 }]]) })
const alpha = (p: ClipPixels, x: number, y: number) => x < p.left || y < p.top || x >= p.left + p.width || y >= p.top + p.height ? 0 : p.rgba[((y - p.top) * p.width + x - p.left) * 4 + 3]
const strokes = () => readVectorStrokes(vectorBytes({ points: [[16, 16]], diameter: 12, randomSeed: 14978491 }))

describe('image brush transforms', () => {
  it('keeps rectangular tips rectangular and flips in tip-local axes before rotating', () => {
    const b = brushes(), pattern = b.patterns.get(2)!
    const render = () => renderVectors(strokes(), b, 32, 32)
    const original = render()
    expect(alpha(original, 12, 14)).toBe(32)
    expect(alpha(original, 20, 18)).toBe(255)
    expect(alpha(original, 16, 11)).toBe(0) // 12px wide, 8px tall, not a 12px square.
    expect(alpha(original, 11, 16)).toBeGreaterThan(0)
    pattern.reverse = 1
    expect(alpha(render(), 12, 14)).toBe(96)
    pattern.reverse = 16
    expect(alpha(render(), 12, 14)).toBe(128)
    pattern.reverse = 17
    expect(alpha(render(), 12, 14)).toBe(255)
    b.styles.get(7)!.RotationBase = 90
    expect(alpha(render(), 18, 12)).toBe(255)
    expect([...pattern.alpha]).toEqual([32, 64, 96, 128, 192, 255])
  })
  it('centers random rotation around the base angle and consumes density second', () => {
    const b = brushes(), style = b.styles.get(7)!
    Object.assign(style, { RotationEffector: 131, RotationRandom: 1,
      FlowEffector: new Uint8Array([0, 0, 0, 129, 0, 0, 0, 0]) })
    const randomized = renderVectors(strokes(), b, 32, 32)
    Object.assign(style, { RotationEffector: 3, RotationBase: (7732 / 32768 - .5) * 360,
      FlowEffector: undefined, FlowBase: 14901 / 32768 })
    expect(renderVectors(strokes(), b, 32, 32)).toEqual(randomized)
  })
  it('diagnoses unimplemented flip modes without treating random mode as fixed reverse', () => {
    const b = brushes(), reports: string[] = [], original = renderVectors(strokes(), b, 32, 32)
    for (const reverse of [2, 3, 32, 48, 256, -1, 1.5]) {
      b.patterns.get(2)!.reverse = reverse
      expect(renderVectors(strokes(), b, 32, 32, 0, 0, m => reports.push(m))).toEqual(original)
    }
    expect(reports).toHaveLength(7)
    expect(reports.every(m => m.includes('反転'))).toBe(true)
  })
  it('preserves the previous sub-2px footprint and AA instead of losing thin marks', () => {
    const b = brushes(), st = readVectorStrokes(vectorBytes({ points: [[16, 16]], diameter: 1.75 }))
    const p = renderVectors(st, b, 32, 32)
    // The old square mapping remains for unverified minification of extremely fine tips.
    const square = { width: 6, height: 6, alpha: new Uint8Array(36) }
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) square.alpha[y * 6 + x] = tip().alpha[Math.floor(y / 3) * 3 + Math.floor(x / 2)]
    b.patterns.set(2, square)
    expect(renderVectors(st, b, 32, 32)).toEqual(p)
  })
})

describe('minified paper for weak-AA image tips', () => {
  const style = { TexturePattern: 9, TextureFlag: 17, TextureComposite: 1, TextureScale: .0625, TextureDensityBase: 1 }
  const report = () => { throw Error('unexpected texture fallback') }
  it('keeps a 250px grain tile on the observed 31px repeat, including negative coordinates and rotation', () => {
    const image = { width: 250, height: 250, alpha: Uint8Array.from({ length: 62500 }, (_, i) => (i % 250 * 17 + Math.floor(i / 250) * 29) % 256) }
    const texture = createBrushTexture(style, image, report, true)!
    for (const [x, y] of [[2, 5], [-8, -12], [11, -4]]) {
      expect(texture.sample(x, y)).toBeCloseTo(texture.sample(x + 31, y + 31), 10)
      expect(texture.sample(x + .01, y + .01)).toBe(texture.sample(x + .99, y + .99))
    }
    expect(texture.sample(2, 5)).not.toBeCloseTo(texture.sample(18, 5), 3)
    const rotated = createBrushTexture({ ...style, TextureRotate: 90 }, image, report, true)!
    expect(rotated.sample(-5, 2)).toBeCloseTo(texture.sample(2, 5), 10)
    const moved = createBrushTexture({ ...style, TextureOffsetX: 7, TextureOffsetY: -9 }, image, report, true)!
    expect(moved.sample(9, -4)).toBe(texture.sample(2, 5))
  })
  it('prefilters periodically across the tile seam without changing the shared source bitmap', () => {
    const image = { width: 8, height: 1, alpha: new Uint8Array([0, 40, 80, 120, 160, 200, 240, 255]) }
    const before = image.alpha.slice(), texture = createBrushTexture(style, image, report, true)!
    expect(texture.sample(0, 0)).toBeCloseTo((255 + 0 + 40 + 80) / 4 / 255, 10)
    expect(createBrushTexture(style, image, report, true)!.sample(0, 0)).toBe(texture.sample(0, 0))
    expect(image.alpha).toEqual(before)
    const native = createBrushTexture({ ...style, TextureScale: 1 }, image, report, true)!
    expect(native.sample(1.5, 0)).toBe(40 / 255)
    expect(createBrushTexture({ ...style, TextureScale: 1e-9 }, image, report, true)!.sample(-100, 200)).toBeCloseTo(1095 / 8 / 255)
  })
})
