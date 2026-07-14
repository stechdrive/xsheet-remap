import { describe, expect, it } from 'vitest'
import {
  buildDarkPixelIntegralImage,
  darkPixelsInColumn,
  darkPixelsInIntegralRect,
  darkPixelsInRow,
  darkRatioInHorizontalBand,
  darkRatioInHorizontalBandIntegral,
  darkRatioInVerticalBand,
  darkRatioInVerticalBandIntegral,
} from './sheet-auto-calibration-projection'

describe('dark pixel integral image', () => {
  it('preserves projection and band counts exactly', () => {
    const image = testImage(37, 29)
    const integral = buildDarkPixelIntegralImage(image)

    for (let y = 0; y < image.height; y += 3) {
      expect(darkPixelsInIntegralRect(integral, 4, y, 31, y)).toBe(darkPixelsInRow(image, y, 4, 31))
      expect(darkRatioInHorizontalBandIntegral(integral, y, 3.2, 32.8, 2))
        .toBe(darkRatioInHorizontalBand(image, y, 3.2, 32.8, 2))
    }
    for (let x = 0; x < image.width; x += 3) {
      expect(darkPixelsInIntegralRect(integral, x, 2, x, 26)).toBe(darkPixelsInColumn(image, x, 2, 26))
      expect(darkRatioInVerticalBandIntegral(integral, x, 1.8, 27.1, 2))
        .toBe(darkRatioInVerticalBand(image, x, 1.8, 27.1, 2))
    }
  })
})

function testImage(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const dark = (x * 17 + y * 29 + x * y) % 11 < 4
      data[offset] = dark ? 25 : 235
      data[offset + 1] = dark ? 30 : 240
      data[offset + 2] = dark ? 35 : 245
      data[offset + 3] = (x + y) % 13 === 0 ? 0 : 255
    }
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData
}
