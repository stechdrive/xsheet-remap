// @vitest-environment node
import { expect, it } from 'vitest'
import { darkRowBands, glyphInkBounds, pinkPixelCount, psdRaster, type Raster } from './raster'

it('detects missing glyphs, wrong orientation and transparent ink in both image layouts', () => {
  const data = new Uint8Array(20 * 20 * 4).fill(255)
  for (let y = 4; y < 14; y++) for (let x = 9; x < 11; x++) data.set([208, 0, 192, 255], (y * 20 + x) * 4)
  const rgba: Raster = { width: 20, height: 20, data, layout: 'rgba' }
  const target = { xPx: 10, yPx: 15, size: 16, color: '#d000c0' }
  const planes = Uint8Array.from({ length: 1200 }, (_, i) => data[(i % 400) * 4 + Math.floor(i / 400)])
  const expected = [{ width: 2, height: 10, count: 20 }]
  expect(glyphInkBounds(rgba, [target])).toEqual(expected)
  expect(glyphInkBounds(psdRaster({ width: 20, height: 20, planes }), [target])).toEqual(expected)
  const horizontal: Raster = { ...rgba, data: new Uint8Array(data.length).fill(255) }
  for (let y = 9; y < 11; y++) for (let x = 4; x < 14; x++) horizontal.data.set([208, 0, 192, 255], (y * 20 + x) * 4)
  expect(glyphInkBounds(horizontal, [target])).toEqual([{ width: 10, height: 2, count: 20 }])
  expect(pinkPixelCount(rgba, { x: -5, y: -5, width: 30, height: 30 })).toBe(20)
  expect(glyphInkBounds(rgba, [{ ...target, color: '#00a040' }])[0].count).toBe(0)
  for (let y = 4; y < 14; y++) for (let x = 9; x < 11; x++) data[(y * 20 + x) * 4 + 3] = 0
  expect(glyphInkBounds(rgba, [target])[0].count).toBe(0)
  expect(pinkPixelCount(rgba, { x: 0, y: 0, width: 20, height: 20 })).toBe(0)
})

it('distinguishes separate rows, merged rows and an empty raster', () => {
  const image: Raster = { width: 8, height: 12, data: new Uint8Array(8 * 12 * 4).fill(255), layout: 'rgba' }
  const rect = { x: 1, y: 0, width: 6, height: 12 }
  const line = (y: number) => { for (let x = 2; x < 6; x++) image.data.set([0, 0, 0, 255], (y * 8 + x) * 4) }
  expect(darkRowBands(image, rect)).toEqual([])
  line(3); line(5)
  expect(darkRowBands(image, rect)).toEqual([{ top: 3, bottom: 3 }, { top: 5, bottom: 5 }])
  line(4)
  expect(darkRowBands(image, rect)).toEqual([{ top: 3, bottom: 5 }])
})

it('recognizes antialiased small text without mistaking paper or transparent pixels for ink', () => {
  const image: Raster = { width: 5, height: 5, data: new Uint8Array(5 * 5 * 4), layout: 'rgba' }
  for (let i = 0; i < 25; i++) image.data.set([247, 247, 244, 255], i * 4)
  const rect = { x: 0, y: 0, width: 5, height: 5 }
  expect(darkRowBands(image, rect, 200)).toEqual([])
  for (const y of [1, 2, 3]) image.data.set([185, 190, 180, 255], (y * 5 + 2) * 4)
  image.data.set([0, 0, 0, 0], 0)
  expect(darkRowBands(image, rect, 200)).toEqual([{ top: 1, bottom: 3 }])
  for (const y of [1, 2, 3]) image.data.set([247, 247, 244, 255], (y * 5 + 2) * 4)
  expect(darkRowBands(image, rect, 200)).toEqual([])
})
