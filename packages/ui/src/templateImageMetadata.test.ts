import { describe, expect, it } from 'vitest'
import { parseTemplateImageMetadata } from './templateImageMetadata'
import { resolvePixelExactUnderlayPlacement, templateImageDensityMatches } from './templateDrafts'

describe('template image metadata and placement', () => {
  it('reads PNG dimensions and pixels-per-meter density', () => {
    const bytes = new Uint8Array(8 + 25 + 21)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    writeChunk(bytes, 8, 'IHDR', [0, 0, 6, 218, 0, 0, 9, 177, 8, 6, 0, 0, 0])
    writeChunk(bytes, 33, 'pHYs', [0, 0, 23, 18, 0, 0, 23, 18, 1])

    const metadata = parseTemplateImageMetadata(bytes.buffer)

    expect(metadata?.width).toBe(1754)
    expect(metadata?.height).toBe(2481)
    expect(metadata?.ppiX).toBeCloseTo(150.0124, 4)
    expect(metadata?.ppiY).toBeCloseTo(150.0124, 4)
  })

  it('centers at integer pixels and trims an odd excess on the trailing edge', () => {
    const metadata = { width: 1754, height: 2481, ppiX: 150.0124, ppiY: 150.0124 }
    const placement = resolvePixelExactUnderlayPlacement(1754, 2480, metadata)

    expect(placement).toMatchObject({ mode: 'pixel-exact', offsetXPx: 0, offsetYPx: 0, renderedWidthPx: 1754, renderedHeightPx: 2481 })
    expect(templateImageDensityMatches(150, metadata)).toBe(true)
    expect(templateImageDensityMatches(300, metadata)).toBe(false)
  })
})

function writeChunk(target: Uint8Array, offset: number, type: string, data: number[]) {
  const view = new DataView(target.buffer)
  view.setUint32(offset, data.length)
  for (let index = 0; index < 4; index += 1) target[offset + 4 + index] = type.charCodeAt(index)
  target.set(data, offset + 8)
}
