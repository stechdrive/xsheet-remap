import { beforeAll, describe, expect, it } from 'vitest'
import { standardA3SheetTemplate } from '@xsheet-remap/core'
import type { SheetPrecisionWarp } from './appTypes'
import {
  buildPrecisionWarpFromMatches,
  detectPrecisionControlMatches,
  precisionGuideAnchors,
  type PrecisionControlMatch,
} from './sheetPrecisionCorrection'
import { precisionWarpDisplacementAt, preparePrecisionWarp } from './sheetPrecisionWarp'

class TestImageData {
  data: Uint8ClampedArray
  width: number
  height: number

  constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, maybeHeight?: number) {
    if (typeof dataOrWidth === 'number') {
      this.width = dataOrWidth
      this.height = widthOrHeight
      this.data = new Uint8ClampedArray(this.width * this.height * 4)
    } else {
      this.data = dataOrWidth
      this.width = widthOrHeight
      this.height = maybeHeight ?? Math.floor(dataOrWidth.length / 4 / widthOrHeight)
    }
  }
}

beforeAll(() => {
  if (!globalThis.ImageData) globalThis.ImageData = TestImageData as typeof ImageData
})

describe('sheet precision correction', () => {
  it('creates dense major-grid anchors for the standard A3 template', () => {
    const anchors = precisionGuideAnchors(standardA3SheetTemplate, 1754, 2481)

    expect(anchors.length).toBeGreaterThan(400)
    expect(Math.max(...anchors.map(anchor => anchor.searchRadiusPx))).toBeLessThanOrEqual(12)
    expect(Math.min(...anchors.map(anchor => anchor.searchRadiusPx))).toBeGreaterThanOrEqual(4)
  })

  it('finds local horizontal and vertical line displacement in a small search window', () => {
    const image = whiteImageData(140, 140)
    drawVerticalLine(image, 42)
    drawHorizontalLine(image, 58)

    const matches = detectPrecisionControlMatches(image, [{
      x: 40 / image.width,
      y: 60 / image.height,
      horizontalSpanPx: 42,
      verticalSpanPx: 42,
      searchRadiusPx: 6,
    }])

    expect(matches).toHaveLength(1)
    expect(matches[0]?.dxPx).toBeCloseTo(2, 0)
    expect(matches[0]?.dyPx).toBeCloseTo(-2, 0)
    expect(matches[0]?.confidence).toBeGreaterThan(0.5)
  })

  it('fits a smooth bounded mesh from distributed control matches', () => {
    const bounds = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }
    const matches: PrecisionControlMatch[] = []
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 5; column += 1) {
        const x = bounds.x + bounds.w * ((column + 0.5) / 5)
        const y = bounds.y + bounds.h * ((row + 0.5) / 4)
        matches.push({ x, y, dxPx: 2 + x, dyPx: -1 + y * 0.5, confidence: 0.92 })
      }
    }

    const warp = buildPrecisionWarpFromMatches(matches, bounds, 1000, 1400)
    expect(warp).not.toBeNull()
    const displacement = precisionWarpDisplacementAt(warp!, 0.5, 0.5)
    expect(displacement.x * 1000).toBeCloseTo(2.5, 0)
    expect(displacement.y * 1400).toBeCloseTo(-0.75, 0)
    expect(warp?.diagnostics.coverage).toBe(1)
  })

  it('requires broad support and rejects displacement beyond the template-relative safety cap', () => {
    const bounds = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }
    const sparse = distributedMatches(bounds, 5, 4, 2, -1)
    expect(buildPrecisionWarpFromMatches(
      sparse,
      bounds,
      1000,
      1400,
      sparse.length,
      sparse.length,
      { columnPx: 24, rowPx: 24 },
    )).toBeNull()

    const unsafe = distributedMatches(bounds, 9, 7, 6, 0)
    expect(buildPrecisionWarpFromMatches(
      unsafe,
      bounds,
      1000,
      1400,
      unsafe.length,
      unsafe.length,
      { columnPx: 24, rowPx: 24 },
    )).toBeNull()
  })
})

describe('precision warp sampling', () => {
  it('precomputes bilinear lookup axes and feathers displacement outside the fitted bounds', () => {
    const warp: SheetPrecisionWarp = {
      version: 1,
      bounds: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 },
      columns: 2,
      rows: 2,
      offsets: [0.01, -0.02, 0.01, -0.02, 0.01, -0.02, 0.01, -0.02],
      diagnostics: {
        totalAnchorCount: 4,
        matchedAnchorCount: 4,
        inlierCount: 4,
        coverage: 1,
        confidence: 1,
        rmsBeforePx: 1,
        rmsAfterPx: 0,
        maxDisplacementPx: 1,
      },
    }

    const center = precisionWarpDisplacementAt(warp, 0.5, 0.5)
    const outside = precisionWarpDisplacementAt(warp, 0, 0.5)
    const prepared = preparePrecisionWarp(warp, 100, 140)

    expect(center.x).toBeCloseTo(0.01, 6)
    expect(center.y).toBeCloseTo(-0.02, 6)
    expect(outside.x).toBe(0)
    expect(prepared?.xIndices).toHaveLength(100)
    expect(prepared?.yIndices).toHaveLength(140)
  })
})

function whiteImageData(width: number, height: number): ImageData {
  const image = new ImageData(width, height)
  image.data.fill(255)
  return image
}

function drawVerticalLine(image: ImageData, x: number) {
  for (let y = 0; y < image.height; y += 1) setBlack(image, x, y)
}

function drawHorizontalLine(image: ImageData, y: number) {
  for (let x = 0; x < image.width; x += 1) setBlack(image, x, y)
}

function setBlack(image: ImageData, x: number, y: number) {
  const offset = (y * image.width + x) * 4
  image.data[offset] = 0
  image.data[offset + 1] = 0
  image.data[offset + 2] = 0
  image.data[offset + 3] = 255
}

function distributedMatches(
  bounds: { x: number; y: number; w: number; h: number },
  columns: number,
  rows: number,
  dxPx: number,
  dyPx: number,
): PrecisionControlMatch[] {
  const matches: PrecisionControlMatch[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      matches.push({
        x: bounds.x + bounds.w * ((column + 0.5) / columns),
        y: bounds.y + bounds.h * ((row + 0.5) / rows),
        dxPx,
        dyPx,
        confidence: 0.95,
      })
    }
  }
  return matches
}
