// Ported from csp-paperback 2809271; MIT, Copyright (c) 2025 stechdrive.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deflateSync } from 'node:zlib'
import { Blob as NodeBlob } from 'node:buffer'
import { createBrushTexture } from './vector-texture'
import { readVectorStrokes, renderVectors, type VectorBrushes } from './vector'
import { createMaterialDecoder, type MaterialTables } from './material'
import type { ClipDiagnostic, ClipLayer, ClipPixels } from './types'
import type { ClipRow } from './records'
import { vectorBytes } from '../fixtures/clip-vector'

const style = (): ClipRow => ({ PatternStyle: 2, AntiAlias: 1, TexturePattern: 9, TextureFlag: 1, TextureComposite: 1,
  TextureScale: 1, TextureDensityBase: 1, AutoIntervalType: 2, IntervalBase: 1, Hardness: 1 })
const paper = { width: 2, height: 1, alpha: new Uint8Array([0, 255]) }
const brushes = (): VectorBrushes => ({ styles: new Map([[7, style()]]), graphs: new Map(),
  patterns: new Map([[2, { width: 2, height: 2, alpha: new Uint8Array(4).fill(128) }]]), textures: new Map([[9, paper]]) })
const alpha = (p: ClipPixels, x: number, y: number) => x < p.left || y < p.top || x >= p.left + p.width || y >= p.top + p.height ? 0 : p.rgba[((y - p.top) * p.width + x - p.left) * 4 + 3]
const maximum = (p: ClipPixels) => p.rgba.reduce((v, a, i) => i % 4 === 3 ? Math.max(v, a) : v, 0)

describe('embedded vector paper', () => {
  it('tiles across negative coordinates, interpolates seams and respects scale and rotation', () => {
    const report = () => { throw Error('unexpected fallback') }
    const texture = createBrushTexture(style(), paper, report)!
    expect(texture.sample(.5, .5)).toBe(0)
    expect(texture.sample(1.5, .5)).toBe(1)
    expect(texture.sample(-.5, .5)).toBe(1)
    expect(texture.sample(2.5, .5)).toBe(0)
    expect(texture.sample(0, .5)).toBe(.5)
    const scaled = createBrushTexture({ ...style(), TextureScale: 2 }, paper, report)!
    expect(scaled.sample(1, 1)).toBe(0)
    expect(scaled.sample(3, 1)).toBe(1)
    const rotated = createBrushTexture({ ...style(), TextureRotate: 90 }, paper, report)!
    expect(rotated.sample(-.5, 1.5)).toBeCloseTo(1)
    const moved = createBrushTexture({ ...style(), TextureOffsetX: 3, TextureOffsetY: -2 }, paper, report)!
    expect(moved.sample(3.5, -1.5)).toBe(0)
  })
  it('treats zero texture strength as neutral and preserves white/black limits', () => {
    const neutral = createBrushTexture({ ...style(), TextureDensityBase: 0 }, paper, () => {})!
    expect(neutral.sample(.5, .5)).toBe(1)
    const partial = createBrushTexture({ ...style(), TextureDensityBase: .25 }, paper, () => {})!
    expect(partial.sample(.5, .5)).toBe(.75)
    expect(partial.sample(1.5, .5)).toBe(1)
  })
  it('supports native normal grain and the per-dab flag without an unsupported-mode warning', () => {
    const reports: string[] = []
    const normal = createBrushTexture({ ...style(), TextureComposite: 0, TextureFlag: 17 }, paper, s => reports.push(s))!
    expect(normal.perDab).toBe(true)
    expect(normal.sample(.5, .5)).toBe(.5)
    expect(normal.sample(1.5, .5)).toBe(1.5)
    expect(reports).toEqual([])
  })
  it('applies grain before overlapping dabs only when the native flag is on', () => {
    const b = brushes(), strokes = readVectorStrokes(vectorBytes({ points: [[3, 8], [26, 8]], flags: 17 }))
    b.textures!.set(9, { width: 1, height: 1, alpha: new Uint8Array([128]) })
    const whole = renderVectors(strokes, b, 32, 20)
    b.styles.get(7)!.TextureFlag = 17
    const perDab = renderVectors(strokes, b, 32, 20)
    expect(maximum(whole)).toBeLessThanOrEqual(128)
    expect(maximum(perDab)).toBeGreaterThan(maximum(whole))
    // Normal can brighten a dab; an alpha above one must not invert subsequent blends.
    Object.assign(b.styles.get(7)!, { TextureComposite: 0, FlowBase: 1 })
    b.patterns.get(2)!.alpha.fill(255)
    b.textures!.get(9)!.alpha.fill(255)
    expect(maximum(renderVectors(strokes, b, 32, 20))).toBe(255)
  })
  it('leaves disabled paper alone and diagnoses missing, malformed or unsupported paper without losing the stroke', () => {
    const reports: string[] = [], report = (s: string) => reports.push(s)
    expect(createBrushTexture({ ...style(), TextureFlag: 0 }, undefined, report)).toBeUndefined()
    expect(reports).toHaveLength(0)
    expect(createBrushTexture(style(), undefined, report)).toBeUndefined()
    expect(createBrushTexture({ ...style(), TextureComposite: 42 }, paper, report)).toBeUndefined()
    for (const scale of [0, -1, Infinity, NaN]) expect(createBrushTexture({ ...style(), TextureScale: scale }, paper, report)).toBeUndefined()
    expect(createBrushTexture(style(), { ...paper, width: 3 }, report)).toBeUndefined()
    expect(reports.join()).toContain('復元できない')
    expect(reports.join()).toContain('合成方式')
    expect(reports.join()).toContain('不正')
    const b = brushes(); b.textures!.clear()
    expect(maximum(renderVectors(readVectorStrokes(vectorBytes()), b, 20, 20, 0, 0, report))).toBeGreaterThan(0)
  })
  it('reports unverified effect flags and density dynamics while retaining the available grain', () => {
    const reports: string[] = []
    expect(createBrushTexture({ ...style(), TextureFlag: 17, TextureDensityEffector: new Uint8Array([0, 0, 0, 17]) }, paper, s => reports.push(s))).toBeDefined()
    expect(reports.join()).toContain('近似')
  })
  it('moves the grain with the layer and does not restart it at each stroke bounding box', () => {
    const strokes = readVectorStrokes(vectorBytes({ points: [[4, 5], [13.25, 5]], flags: 17 })), b = brushes()
    const p = renderVectors(strokes, b, 32, 32), moved = renderVectors(strokes, b, 32, 32, 7, 9)
    expect(moved.left).toBe(p.left + 7)
    expect(moved.top).toBe(p.top + 9)
    expect(moved.rgba).toEqual(p.rgba)
    const shifted = readVectorStrokes(vectorBytes({ points: [[6, 5], [13.25, 5]], flags: 17 }))
    const q = renderVectors(shifted, b, 32, 32)
    expect(alpha(q, 11, 5)).toBe(alpha(p, 11, 5))
  })
  it('places tips by distance independently of straight-line control subdivision; duplicate controls do not add clicks', () => {
    const b = brushes()
    const render = (points: number[][]) => renderVectors(readVectorStrokes(vectorBytes({ points, flags: 17 })), b, 32, 32)
    expect(render([[4, 8], [13.25, 8]])).toEqual(render([[4, 8], [7.1, 8], [13.25, 8]]))
    expect(render([[8, 8], [8, 8]])).toEqual(render([[8, 8]]))
  })
  it('applies stroke opacity once while separate strokes still build up; translucent erasers only remove their share', () => {
    const b = brushes(); b.textures!.set(9, { width: 1, height: 1, alpha: new Uint8Array([255]) })
    const strokes = readVectorStrokes(vectorBytes({ points: [[3, 8], [26, 8]], flags: 17, opacity: .25 }))
    const once = renderVectors(strokes, b, 32, 20), twice = renderVectors([...strokes, ...strokes], b, 32, 20)
    expect(maximum(once)).toBeGreaterThan(40)
    expect(maximum(once)).toBeLessThanOrEqual(64)
    expect(maximum(twice)).toBeGreaterThan(maximum(once))
    expect(maximum(twice)).toBeLessThanOrEqual(112)
    b.styles.set(8, { ...style(), CompositeMode: 27 })
    const base = { ...strokes[0], opacity: 1, color: [255, 0, 0] }, erase = { ...strokes[0], brush: 8 }
    const solid = renderVectors([base], b, 32, 20), erased = renderVectors([base, erase], b, 32, 20)
    expect(alpha(erased, 15, 8)).toBeLessThan(alpha(solid, 15, 8))
    expect(alpha(erased, 15, 8)).toBeGreaterThanOrEqual(Math.floor(alpha(solid, 15, 8) * .75))
    expect(maximum(renderVectors([{ ...base, opacity: 0 }], b, 32, 20))).toBe(0)
  })
})

const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return new Uint8Array(b) }
const wide = (s: string) => Buffer.concat([u32(s.length), Buffer.from(s, 'utf16le').swap16()])
function solidAttribute(alpha: number) {
  const p = [2, 2, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 256, 256, 0, 0, 0, 0]
  return new Uint8Array(Buffer.concat([Buffer.alloc(16), wide('Parameter'), ...p.map(u32), wide('InitColor'), ...[0, 1, alpha, 0, 0].map(u32),
    wide('BlockSize'), ...[0, 1, 0, 0].map(u32)]))
}

describe('paper image references in the material decoder', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('retains each pattern style\'s reverse modes when two styles share the same decoded image', async () => {
    vi.stubGlobal('Blob', NodeBlob) // jsdom's Blob does not expose a decompression stream.
    const raw = Buffer.alloc(65536)
    raw.set([32, 64, 96]); raw.set([128, 192, 255], 256)
    const compressed = deflateSync(raw), length = Buffer.alloc(4)
    length.writeUInt32LE(compressed.length)
    const chunk = Buffer.concat([wide('BlockDataBeginChunk'), ...[0, raw.length, 256, 256, 1, compressed.length + 4].map(u32), length, compressed, wide('BlockDataEndChunk')])
    const body = new Uint8Array(Buffer.concat([u32(chunk.length + 4), chunk]))
    const parameters = [3, 2, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 256, 256, 0, 0, 0, 0]
    const attribute = new Uint8Array(Buffer.concat([Buffer.alloc(16), wide('Parameter'), ...parameters.map(u32),
      wide('InitColor'), ...[0, 0, 0, 0, 0].map(u32), wide('BlockSize'), ...[0, 1, 0, body.length].map(u32)]))
    const t: MaterialTables = {
      mipmaps: new Map([[100, { BaseMipmapInfo: 101 }]]), mipInfos: new Map([[101, { ThisScale: 100, Offscreen: 102 }]]),
      offscreens: new Map([[102, { Attribute: attribute, BlockData: 'tip' }]]), thumbnails: [],
      external: new Map<string, Uint8Array>([['tip', body], ['horizontal', vectorBytes({ diameter: 12, points: [[16, 16]] })],
        ['vertical', vectorBytes({ brush: 8, diameter: 12, points: [[16, 16]] })]]),
      vectors: new Map([[42, { VectorData: 'horizontal' }], [43, { VectorData: 'vertical' }]]),
      brushes: new Map([[7, { PatternStyle: 10, AntiAlias: 1 }], [8, { PatternStyle: 11, AntiAlias: 1 }]]),
      brushPatterns: new Map([[10, { ImageIndex: u32(20), Reverse2: 1 }], [11, { ImageIndex: u32(20), Reverse2: 16 }]]),
      brushImages: new Map([[20, { Mipmap: 100 }]]),
    }
    const layer = (): ClipLayer => ({ id: 'vector', name: 'vector', kind: 'vector', isFolder: false, isAnimationFolder: false,
      expanded: true, hidden: false, opacity: 1, clipping: false, children: [] })
    const diagnostics: ClipDiagnostic[] = [], decode = createMaterialDecoder(t, 32, 32, 72, diagnostics)
    const horizontal = layer(), vertical = layer(), again = layer()
    await decode(horizontal, { VectorNormalStrokeIndex: 42 })
    await decode(vertical, { VectorNormalStrokeIndex: 43 })
    await decode(again, { VectorNormalStrokeIndex: 42 })
    expect(diagnostics.filter(d => !(d.part === 'material' && d.outcome === 'approximate'))).toEqual([])
    expect(alpha(horizontal.pixels!, 12, 14)).toBe(96)
    expect(alpha(vertical.pixels!, 12, 14)).toBe(128)
    expect(again.pixels).toEqual(horizontal.pixels)
    expect(diagnostics.some(d => /復元できない|不正|未対応/.test(d.message))).toBe(false)
  })
  it('resolves TexturePattern directly as an image, even when a pattern style has the same numeric ID', async () => {
    const t: MaterialTables = {
      mipmaps: new Map([[100, { BaseMipmapInfo: 101 }], [200, { BaseMipmapInfo: 201 }]]),
      mipInfos: new Map([[101, { ThisScale: 100, Offscreen: 102 }], [201, { ThisScale: 100, Offscreen: 202 }]]),
      offscreens: new Map([[102, { Attribute: solidAttribute(128) }], [202, { Attribute: solidAttribute(255) }]]),
      thumbnails: [], external: new Map([['vector', vectorBytes()]]),
      vectors: new Map([[42, { LayerId: 9, VectorData: 'vector' }]]),
      brushes: new Map([[7, { ...style(), PatternStyle: 10, TexturePattern: 10 }]]),
      brushPatterns: new Map([[10, { ImageIndex: u32(20) }]]),
      brushImages: new Map([[10, { Mipmap: 100 }], [20, { Mipmap: 200 }]]),
    }
    const layer: ClipLayer = { id: 'vector', name: 'vector', kind: 'vector', isFolder: false, isAnimationFolder: false,
      expanded: true, hidden: false, opacity: 1, clipping: false, children: [] }
    const diagnostics: ClipDiagnostic[] = []
    await createMaterialDecoder(t, 20, 20, 72, diagnostics)(layer, { MainId: 9, VectorNormalStrokeIndex: 42 })
    expect(layer.materialSource).toBe('vector')
    expect(alpha(layer.pixels!, 8, 8)).toBe(128)
    expect(diagnostics.some(d => /復元できない|不正|未対応/.test(d.message))).toBe(false)
  })
})
