import { beforeAll, describe, expect, it } from 'vitest'
import {
  applyLevelCorrectionToImageData,
  buildLevelHistogram,
  gammaForMiddleInputLevel,
  levelCorrectionTableValues,
  middleInputLevelForGamma,
  normalizeLevelCorrectionSettings,
  updateLevelInputBlack,
} from './levelCorrection'

class TestImageData {
  data: Uint8ClampedArray
  width: number
  height: number

  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data
    this.width = width
    this.height = height
  }
}

beforeAll(() => {
  if (!globalThis.ImageData) {
    globalThis.ImageData = TestImageData as typeof ImageData
  }
})

describe('levelCorrection', () => {
  it('normalizes Photoshop-like input levels', () => {
    expect(normalizeLevelCorrectionSettings({ enabled: true, inputBlack: -20, inputWhite: 500, gamma: 20 })).toEqual({
      enabled: true,
      inputBlack: 0,
      inputWhite: 255,
      gamma: 9.99,
    })
  })

  it('keeps the gamma value while black point movement changes the middle handle position', () => {
    const initial = normalizeLevelCorrectionSettings({ enabled: true, inputBlack: 0, inputWhite: 255, gamma: 1 })
    const updated = updateLevelInputBlack(initial, 32)

    expect(updated.gamma).toBe(1)
    expect(Math.round(middleInputLevelForGamma(initial))).toBe(128)
    expect(Math.round(middleInputLevelForGamma(updated))).toBe(144)
  })

  it('converts between middle handle position and gamma', () => {
    const settings = normalizeLevelCorrectionSettings({ enabled: true, inputBlack: 0, inputWhite: 255, gamma: 0.5 })
    const middle = middleInputLevelForGamma(settings)

    expect(Math.round(middle)).toBe(180)
    expect(gammaForMiddleInputLevel(settings, middle)).toBe(0.5)
  })

  it('applies input level gamma using Photoshop-style gamma display values', () => {
    const imageData = new ImageData(new Uint8ClampedArray([128, 128, 128, 255]), 1, 1)
    const lightened = applyLevelCorrectionToImageData(imageData, { enabled: true, inputBlack: 0, inputWhite: 255, gamma: 2 })
    const darkened = applyLevelCorrectionToImageData(imageData, { enabled: true, inputBlack: 0, inputWhite: 255, gamma: 0.5 })

    expect(lightened.data[0]).toBeGreaterThan(128)
    expect(darkened.data[0]).toBeLessThan(128)
  })

  it('builds SVG filter table values from the same input level curve', () => {
    const identityValues = levelCorrectionTableValues({ enabled: true, inputBlack: 0, inputWhite: 255, gamma: 1 }, 3)
      .split(' ')
      .map(Number)
    const darkenedValues = levelCorrectionTableValues({ enabled: true, inputBlack: 0, inputWhite: 255, gamma: 0.5 }, 3)
      .split(' ')
      .map(Number)

    expect(identityValues).toEqual([0, 0.50196, 1])
    expect(darkenedValues[1]).toBeLessThan(identityValues[1])
  })

  it('builds luminance histogram buckets', () => {
    const imageData = new ImageData(new Uint8ClampedArray([
      0, 0, 0, 255,
      255, 255, 255, 255,
    ]), 2, 1)

    expect(buildLevelHistogram(imageData, 4)).toEqual([1, 0, 0, 1])
  })
})
