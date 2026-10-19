// Native synthetic references ported from csp-paperback a454748 (MIT).
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { expect, it } from 'vitest'
import { applyEdge } from './edge-effect'
import { applyWatercolor } from './watercolor-effect'
import { readMaterialEffects } from './material'
import type { MaterialEffects } from './rendering'
import { previewMaterialImage } from './preview-image'

const data = JSON.parse(readFileSync(new URL('../fixtures/native-effects.json', import.meta.url), 'utf8')) as {
  effects: Record<string, string>; options: Record<string, string>
  cases: (MaterialEffects & { file: string })[]
  images: Record<string, { width: number; height: number; rgbaDeflate: string }>
}
const pixels = (name: string) => new Uint8ClampedArray(inflateSync(Buffer.from(data.images[name].rgbaDeflate, 'base64')))
const decode = (value: string) => readMaterialEffects({ LayerEffectAttached: 1, LayerEffectInfo: new Uint8Array(Buffer.from(value, 'base64')) })!
function difference(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  let alphaMax = 0, alphaOverOne = 0, rgbMax = 0, sum = 0, foreground = 0
  for (let i = 0; i < a.length; i += 4) {
    const aa = a[i + 3] / 255, ba = b[i + 3] / 255, delta = Math.abs(a[i + 3] - b[i + 3])
    alphaMax = Math.max(alphaMax, delta); if (delta > 1) alphaOverOne++; if (aa || ba) foreground++
    for (const background of [0, 255]) for (let c = 0; c < 3; c++) {
      const d = Math.abs(Math.round(a[i + c] * aa + background * (1 - aa)) - Math.round(b[i + c] * ba + background * (1 - ba)))
      sum += d; rgbMax = Math.max(rgbMax, d)
    }
  }
  return { alphaMax, alphaOverOne, rgbMax, rgbMean: sum / (foreground * 6 || 1) }
}

it('reads native border opacity, AA, watercolor and tone independently', () => {
  expect(decode(data.effects.watercolor)).toEqual({ watercolor: { range: 5, opacity: 50, darkness: 20, blur: 10 } })
  expect(decode(data.effects.edgeOn).edge).toEqual({ radius: 3, color: [255, 255, 255], reflectOpacity: true, antialias: true })
  expect(decode(data.options.antialiasOff).edge).toMatchObject({ reflectOpacity: false, antialias: false })
  expect(decode(data.options.waterVivid).watercolor?.style).toBe(1)
  expect(decode(data.options.tone)).toEqual({ tone: true })
})

it.each(data.cases.filter(k => k.edge))('matches native border pixels: $file', fixture => {
  const actual = pixels('kernels-base.png'), expected = pixels(fixture.file)
  applyEdge(actual, 128, 128, fixture.edge!)
  const diff = difference(actual, expected)
  if (fixture.edge!.antialias) { expect(diff.alphaMax).toBeLessThanOrEqual(1); expect(diff.rgbMax).toBeLessThanOrEqual(3) }
  else { expect(diff.alphaOverOne).toBeLessThanOrEqual(8); expect(diff.rgbMean).toBeLessThan(0.8) }
})

it.each(data.cases.filter(k => k.watercolor && k.watercolor.range))('improves native watercolor reconstruction: $file', fixture => {
  const base = pixels('kernels-base.png'), actual = base.slice(), expected = pixels(fixture.file)
  applyWatercolor(actual, 128, 128, fixture.watercolor!)
  const diff = difference(actual, expected), omitted = difference(base, expected)
  expect(diff.rgbMean).toBeLessThan(omitted.rgbMean)
})

it('keeps unsupported watercolor unchanged and makes supported tiled output translation-invariant', () => {
  const width = 600, height = 80, original = new Uint8ClampedArray(width * height * 4)
  for (let y = 22; y < 57; y++) for (let x = 241; x < 269; x++) original.set([80, 120, 180, 127], (y * width + x) * 4)
  const effect = { range: 10, opacity: 50, darkness: 20, blur: 10 }, unchanged = original.slice()
  applyWatercolor(unchanged, width, height, { ...effect, style: 1 })
  expect(Buffer.from(unchanged).equals(Buffer.from(original))).toBe(true)
  const result = original.slice(), shifted = new Uint8ClampedArray(original.length)
  for (let y = 0; y < height; y++) shifted.set(original.subarray(y * width * 4, (y * width + width - 80) * 4), (y * width + 80) * 4)
  applyWatercolor(result, width, height, effect); applyWatercolor(shifted, width, height, effect)
  for (let y = 0; y < height; y++) expect(Buffer.from(result.subarray((y * width + 220) * 4, (y * width + 290) * 4))
    .equals(Buffer.from(shifted.subarray((y * width + 300) * 4, (y * width + 370) * 4)))).toBe(true)
})

it('renders saved pixel effects without a canvas API and masks after the effect expansion', () => {
  const preview = previewMaterialImage({ id: 'effect', name: 'effect', kind: '3d', isFolder: false, isAnimationFolder: false,
    expanded: true, hidden: false, opacity: 1, clipping: false, children: [],
    pixels: { width: 1, height: 1, left: 10, top: 10, rgba: new Uint8ClampedArray([0, 0, 0, 255]) },
    effects: { edge: { radius: 3, color: [255, 255, 255] } },
    mask: { width: 1, height: 1, left: 12, top: 10, defaultColor: 0, rgba: new Uint8ClampedArray([255, 255, 255, 255]) },
  }, 32, 24)
  expect(preview).toMatchObject({ width: 1, height: 1, left: 12, top: 10 })
  expect(Array.from(preview.rgba)).toEqual([255, 255, 255, 255])
})
