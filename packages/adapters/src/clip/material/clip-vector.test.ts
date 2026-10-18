// Ported from csp-paperback 2809271; MIT, Copyright (c) 2025 stechdrive.
import { describe, expect, it } from 'vitest'
import { readVectorStrokes, renderVectors, sampleVectorStroke, type VectorBrushes } from './vector'
import { vectorBytes } from '../fixtures/clip-vector'
import { createMaterialDecoder, type MaterialTables } from './material'
import type { ClipDiagnostic, ClipLayer, ClipPixels } from './types'

const brushes = (): VectorBrushes => ({ styles: new Map([[7, { AntiAlias: 1, Hardness: 1 }]]), graphs: new Map(), patterns: new Map() })
const alpha = (image: ClipPixels, x: number, y: number) => x < image.left || y < image.top || x >= image.left + image.width || y >= image.top + image.height ? 0 : image.rgba[((y - image.top) * image.width + x - image.left) * 4 + 3]
const mass = (image: ClipPixels) => image.rgba.reduce((sum, v, i) => sum + (i % 4 === 3 ? v : 0), 0)

describe('bounded CLIP vector decoding and approximate rendering', () => {
  it.each([true, false])('decodes %s modern header with its effective brush ID, width and a single control', modern => {
    const [stroke] = readVectorStrokes(vectorBytes({ modern, size: .5, flow: .7, randomSeed: 0xfedcba98, direction: 42 }))
    expect(stroke).toMatchObject({ brush: 7, diameter: 4, opacity: 1, randomSeed: 0xfedcba98 })
    expect(stroke.points[0]).toMatchObject({ x: 8, y: 8, size: .5, direction: 42 })
    expect(stroke.points[0].flow).toBeCloseTo(.7)
  })
  it('preserves quadratic and cubic handles on every control and follows the curves', () => {
    const [quadratic] = readVectorStrokes(vectorBytes({ flags: 33, stride: 104, points: [[2, 8], [14, 8]], handles: [[8, 0], [-100, -100]] }))
    expect(Math.min(...sampleVectorStroke(quadratic).map(p => p.y))).toBeCloseTo(4, 1)
    const [cubic] = readVectorStrokes(vectorBytes({ flags: 65, stride: 120, points: [[2, 8], [14, 8]], handles: [[2, 0, 14, 0], [-100, -100, -100, -100]] }))
    expect(Math.min(...sampleVectorStroke(cubic).map(p => p.y))).toBeCloseTo(2, 1)
  })
  it('keeps spline controls on opposite sides of a saved corner independent', () => {
    const bytes = vectorBytes({ points: [[2, 8], [8, 8], [14, 8], [14, 32], [2, 24]] })
    bytes.writeUInt32BE(4097, 92 + 2 * 88 + 32) // Corner and locked size coexist.
    const [stroke] = readVectorStrokes(bytes)
    const before = sampleVectorStroke({ ...stroke, points: stroke.points.slice(0, 3) })
    const after = sampleVectorStroke({ ...stroke, points: stroke.points.slice(2) })
    const positions = (points: typeof before) => points.map(p => [p.x, p.y])
    const corner = positions(sampleVectorStroke(stroke))
    expect(corner).toEqual(positions([...before, ...after.slice(1)]))
    expect(before.every(p => Math.abs(p.y - 8) < 1e-10)).toBe(true)
    stroke.points[2].flags &= ~1
    expect(positions(sampleVectorStroke(stroke))).not.toEqual(corner)
  })
  it('draws clicks, subpixel dots and coincident controls at the saved layer offset', () => {
    for (const points of [[[8, 8]], [[8, 8], [8, 8]]]) {
      const image = renderVectors(readVectorStrokes(vectorBytes({ points, diameter: .7 })), brushes(), 32, 32, 4, 5)
      expect(mass(image)).toBeGreaterThan(0)
      expect(alpha(image, 12, 13)).toBeGreaterThan(0)
      expect(alpha(image, 8, 8)).toBe(0)
    }
  })
  it('applies point flow, opacity and locked size once; transparent clicks stay transparent', () => {
    const render = (flow: number, locked: boolean) => renderVectors(readVectorStrokes(vectorBytes({ diameter: 14, size: .5, flow, opacity: .5, pointFlags: locked ? 12288 : 0 })), brushes(), 16, 16)
    expect(mass(render(.5, true))).toBe(mass(render(.5, false)))
    expect(alpha(render(.5, true), 8, 8)).toBeGreaterThan(30)
    expect(alpha(render(.5, true), 8, 8)).toBeLessThanOrEqual(64)
    expect(mass(render(0, true))).toBe(0)
  })
  it('samples embedded tips and reports missing ones while still drawing a round fallback', () => {
    const b = brushes(), strokes = readVectorStrokes(vectorBytes())
    b.styles.set(7, { PatternStyle: 3, AntiAlias: 1 })
    b.patterns.set(3, { width: 2, height: 2, alpha: new Uint8Array([64, 64, 64, 64]) })
    const patterned = renderVectors(strokes, b, 16, 16)
    expect(alpha(patterned, 8, 8)).toBe(64)
    b.patterns.clear()
    const reports: string[] = []
    expect(mass(renderVectors(strokes, b, 16, 16, 0, 0, message => reports.push(message)))).toBeGreaterThan(mass(patterned))
    expect(reports.join()).toContain('先端画像')
  })
  it('rejects truncation, unknown layouts, nonfinite controls and oversized allocations', () => {
    const bytes = vectorBytes()
    expect(() => readVectorStrokes(bytes.subarray(0, bytes.length - 1))).toThrow('切れ')
    const bad = Buffer.from(bytes); bad.writeUInt32BE(200, 0)
    expect(() => readVectorStrokes(bad)).toThrow('未対応')
    const nan = Buffer.from(bytes); nan.writeDoubleBE(NaN, 92)
    expect(() => readVectorStrokes(nan)).toThrow('数値')
    expect(() => renderVectors([], brushes(), 100000, 100000)).toThrow('16 Mpx')
    const [far] = readVectorStrokes(vectorBytes({ points: [[-900000, 0], [900000, 0]] }))
    const reports: string[] = []
    renderVectors([far], brushes(), 16, 16, 0, 0, m => reports.push(m))
    expect(reports.join()).toContain('上限')
  })
  it('recovers vectors through the material decoder and warns on unavailable geometry', async () => {
    const tables: MaterialTables = { mipmaps: new Map(), mipInfos: new Map(), offscreens: new Map(), thumbnails: [],
      external: new Map([['vector', vectorBytes()]]), vectors: new Map([[42, { LayerId: 9, VectorData: 'vector' }]]), brushes: brushes().styles }
    const layer: ClipLayer = { id: 'v', name: 'vector', kind: 'vector', isFolder: false, isAnimationFolder: false, expanded: true, hidden: false, opacity: 1, clipping: false, children: [] }
    const diagnostics: ClipDiagnostic[] = [], decode = createMaterialDecoder(tables, 16, 16, 72, diagnostics)
    await decode(layer, { MainId: 9, VectorNormalStrokeIndex: 42 })
    expect(layer.materialSource).toBe('vector')
    expect(layer.vectorRendering).toBe('approximate')
    expect(alpha(layer.pixels!, 8, 8)).toBeGreaterThan(0)
    expect(diagnostics.some(d => d.message.includes('近似描画'))).toBe(true)
    const missing = { ...layer, pixels: undefined, materialSource: undefined }
    await decode(missing, { MainId: 10 })
    expect(missing.vectorRendering).toBe('unavailable')
    expect(missing.pixels).toBeUndefined()
  })
})
