// @vitest-environment node
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import init, { type CanvasKit, type TypefaceFontProvider } from 'canvaskit-wasm'
import { CanvasKitImages } from './canvasKitImages'
import { recordCanvasKitScene, paintCanvasKitPicture } from './canvasKitPainter'
import { applySceneFilters, fontRangeIncludes, intersectSceneRects, scenePixelRatio, type SceneNode, type CanvasKitScene } from './canvasKitScene'
import type { CanvasKitFonts } from './canvasKitRuntime'

const require = createRequire(import.meta.url)
let kit: CanvasKit
let provider: TypefaceFontProvider
let fonts: CanvasKitFonts
beforeAll(async () => {
  const options = { locateFile: () => require.resolve('canvaskit-wasm/bin/canvaskit.wasm'), wasmBinary: readFileSync(require.resolve('canvaskit-wasm/bin/canvaskit.wasm')) }
  kit = await init(options)
  provider = kit.TypefaceFontProvider.Make()
  provider.registerFont(readFileSync('node_modules/@fontsource/line-seed-jp/files/line-seed-jp-latin-400-normal.woff2'), 'test')
  fonts = { provider, families: () => ['test'], supports: () => true } as unknown as CanvasKitFonts
})
afterAll(() => provider.delete())

function node(patch: Partial<SceneNode> = {}): SceneNode {
  return {
    matrix: [1, 0, 0, 1, 0, 0], opacity: 1, blend: 'normal', clips: [], children: [],
    paint: { fill: 'none', stroke: '#000000', fillOpacity: 1, strokeOpacity: 1, strokeWidth: 1, dash: [], dashOffset: 0, cap: 'round', join: 'round', miter: 4, nonScaling: false, evenOdd: false },
    ...patch,
  }
}
function render(scene: CanvasKitScene): Uint8Array {
  const images = new CanvasKitImages(kit)
  const picture = recordCanvasKitScene(kit, fonts, images, scene)
  const surface = kit.MakeSurface(scene.width, scene.height)!
  try {
    paintCanvasKitPicture(kit, surface.getCanvas(), picture, 0, 0, 1, 1, 1)
    const image = surface.makeImageSnapshot()
    try {
      return image.readPixels(0, 0, { width: scene.width, height: scene.height,
        alphaType: kit.AlphaType.Unpremul, colorType: kit.ColorType.RGBA_8888, colorSpace: kit.ColorSpace.SRGB }) as Uint8Array
    } finally { image.delete() }
  } finally { surface.delete(); picture.delete(); images.dispose() }
}

describe('real CanvasKit paper paint', () => {
  it('paints tiny normalized continuation lines and cubic waves without browser SVG strokes', () => {
    const pixels = render({ width: 100, height: 100, nodes: [node({
      matrix: [1000, 0, 0, 1000, 0, 0],
      shape: { kind: 'path', d: 'M .025 .01 L .025 .09 M .06 .01 C .04 .04 .08 .06 .06 .09' },
      paint: { ...node().paint, strokeWidth: 0.0008 },
    })] })
    const alpha = (x: number, y: number) => pixels[(y * 100 + x) * 4 + 3]
    expect(alpha(25, 50) + alpha(24, 50)).toBeGreaterThan(150)
    let wavePixels = 0
    for (let y = 10; y < 90; y++) for (let x = 45; x < 75; x++) if (alpha(x, y)) wavePixels++
    expect(wavePixels).toBeGreaterThan(80)
    expect(alpha(10, 50)).toBe(0)
  })

  it('preserves fixed-width selection strokes and clipping through nonuniform transforms', () => {
    const pixels = render({ width: 100, height: 100, nodes: [node({
      matrix: [100, 0, 0, 200, 0, 0],
      shape: { kind: 'path', d: 'M .5 0 L .5 .5' },
      paint: { ...node().paint, strokeWidth: 2, nonScaling: true },
      clips: [{ shape: { kind: 'rect', rect: { x: 0, y: 20, width: 100, height: 40 }, rx: 0, ry: 0 }, matrix: [1, 0, 0, 1, 0, 0] }],
    })] })
    const alpha = (x: number, y: number) => pixels[(y * 100 + x) * 4 + 3]
    expect(alpha(49, 30)).toBeGreaterThan(200)
    expect(alpha(47, 30)).toBe(0)
    expect(alpha(49, 10)).toBe(0)
    expect(alpha(49, 70)).toBe(0)
  })

  it('composites opacity once for overlapping strokes in a memo group', () => {
    const line = node({ shape: { kind: 'path', d: 'M 10 50 L 90 50' }, paint: { ...node().paint, strokeWidth: 4 } })
    const pixels = render({ width: 100, height: 100, nodes: [node({ opacity: 0.5, children: [line, line] })] })
    expect(pixels[(50 * 100 + 50) * 4 + 3]).toBeGreaterThanOrEqual(126)
    expect(pixels[(50 * 100 + 50) * 4 + 3]).toBeLessThanOrEqual(129)
  })

  it('renders the bundled WOFF2 text with the real paragraph engine', () => {
    const pixels = render({ width: 160, height: 80, nodes: [node({
      text: { value: 'ACTION 123', x: 80, y: 40, size: 20, weight: 400, italic: false, anchor: 'middle', baseline: 'central', letterSpacing: 0 },
      paint: { ...node().paint, fill: '#113c2d', stroke: 'none' },
    })] })
    let count = 0
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) count++
    expect(count).toBeGreaterThan(300)
  })

  it('decodes actual Japanese subsets and shapes their distinct glyphs', () => {
    const text = '継続波線'
    const css = readFileSync('node_modules/@fontsource/line-seed-jp/400.css', 'utf8')
    const aliases = ['test']
    for (const block of css.split('@font-face')) {
      const range = block.match(/unicode-range:\s*([^;]+)/)?.[1]
      const file = block.match(/url\(\.\/files\/([^)]*\.woff2)\)/)?.[1]
      if (!range || !file || ![...text].some(char => fontRangeIncludes(range, char.codePointAt(0)!))) continue
      const bytes = readFileSync(`node_modules/@fontsource/line-seed-jp/files/${file}`)
      const typeface = kit.Typeface.MakeFreeTypeFaceFromData(Uint8Array.from(bytes).buffer)!
      for (const char of text) if (fontRangeIncludes(range, char.codePointAt(0)!)) expect(typeface.getGlyphIDs(char)[0]).toBeGreaterThan(0)
      typeface.delete()
      provider.registerFont(bytes, file); aliases.push(file)
    }
    expect(aliases.length).toBeGreaterThan(1)
    const previous = fonts
    fonts = { provider, families: () => aliases, supports: () => true } as unknown as CanvasKitFonts
    try {
      const pixels = render({ width: 160, height: 80, nodes: [node({
        text: { value: text, x: 80, y: 40, size: 24, weight: 400, italic: false, anchor: 'middle', baseline: 'central', letterSpacing: 0 },
        paint: { ...node().paint, fill: '#111', stroke: 'none' },
      })] })
      expect(pixels.filter((_, i) => i % 4 === 3 && pixels[i] > 0).length).toBeGreaterThan(800)
    } finally { fonts = previous }
  })

  it('keeps the cue and memo text outline behind its fill', () => {
    const pixels = render({ width: 120, height: 80, nodes: [node({
      text: { value: 'MEMO', x: 60, y: 40, size: 24, weight: 400, italic: false, anchor: 'middle', baseline: 'central', letterSpacing: 0 },
      paint: { ...node().paint, fill: '#00ff00', stroke: '#ff0000', strokeWidth: 4, order: 'stroke fill' },
    })] })
    let outline = 0, fill = 0
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 180 && pixels[i + 1] < 80 && pixels[i + 3] > 100) outline++
      if (pixels[i + 1] > 180 && pixels[i] < 80 && pixels[i + 3] > 100) fill++
    }
    expect(outline).toBeGreaterThan(100)
    expect(fill).toBeGreaterThan(100)
  })
})

describe('tablet resource and image contracts', () => {
  it('bounds backing pixels by the visible area even at Retina density', () => {
    const ratio = scenePixelRatio(2732, 2048, 3)
    expect(2732 * 2048 * ratio * ratio).toBeLessThanOrEqual(6_000_001)
    expect(scenePixelRatio(400, 300, 3)).toBe(2)
    expect(intersectSceneRects({ x: -50, y: 20, width: 100, height: 100 }, { x: 0, y: 0, width: 60, height: 60 }))
      .toEqual({ x: 0, y: 20, width: 50, height: 40 })
  })
  it('loads Japanese subsets by unicode range including supplementary characters', () => {
    expect(fontRangeIncludes('U+3000-30FF,U+4E00-9FFF', '継'.codePointAt(0)!)).toBe(true)
    expect(fontRangeIncludes('U+26???', 0x260ed)).toBe(true)
    expect(fontRangeIncludes('U+00-7F', '波'.codePointAt(0)!)).toBe(false)
  })
  it('preserves reference tint, level correction and transparent pixels', () => {
    const data = new Uint8ClampedArray([0, 0, 0, 128, 255, 255, 255, 0])
    applySceneFilters(data, [{ red: [1, 1, 1], green: [0.122, 0.54, 0.96], blue: [0.071, 0.45, 0.95] }])
    expect([...data]).toEqual([255, 31, 18, 128, 255, 245, 242, 0])
  })
})
