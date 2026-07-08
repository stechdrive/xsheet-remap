import type { SheetImageLevelCorrection } from '@xsheet-remap/core'

export type LevelCorrectionSettings = SheetImageLevelCorrection

export const LEVEL_CORRECTION_DISABLED_SETTINGS: LevelCorrectionSettings = {
  enabled: false,
  inputBlack: 0,
  inputWhite: 255,
  gamma: 1,
}

export const DEFAULT_LEVEL_CORRECTION_SETTINGS: LevelCorrectionSettings = {
  enabled: true,
  inputBlack: 0,
  inputWhite: 250,
  gamma: 0.5,
}

export const LEVEL_HISTOGRAM_BUCKETS = 256

export function defaultLevelCorrectionSettings(): LevelCorrectionSettings {
  return { ...DEFAULT_LEVEL_CORRECTION_SETTINGS }
}

export function noLevelCorrectionSettings(enabled = false): LevelCorrectionSettings {
  return { ...LEVEL_CORRECTION_DISABLED_SETTINGS, enabled }
}

export function normalizeLevelCorrectionSettings(input?: Partial<LevelCorrectionSettings> | null): LevelCorrectionSettings {
  const enabled = input?.enabled ?? DEFAULT_LEVEL_CORRECTION_SETTINGS.enabled
  const inputBlack = clampInteger(input?.inputBlack ?? DEFAULT_LEVEL_CORRECTION_SETTINGS.inputBlack, 0, 253)
  const inputWhite = clampInteger(input?.inputWhite ?? DEFAULT_LEVEL_CORRECTION_SETTINGS.inputWhite, inputBlack + 2, 255)
  const gamma = clampGamma(input?.gamma ?? DEFAULT_LEVEL_CORRECTION_SETTINGS.gamma)
  return { enabled, inputBlack, inputWhite, gamma }
}

export function updateLevelInputBlack(settings: LevelCorrectionSettings, inputBlack: number): LevelCorrectionSettings {
  const black = clampInteger(inputBlack, 0, 253)
  return normalizeLevelCorrectionSettings({
    ...settings,
    inputBlack: black,
    inputWhite: Math.max(black + 2, settings.inputWhite),
  })
}

export function updateLevelInputWhite(settings: LevelCorrectionSettings, inputWhite: number): LevelCorrectionSettings {
  return normalizeLevelCorrectionSettings({
    ...settings,
    inputWhite: clampInteger(inputWhite, settings.inputBlack + 2, 255),
  })
}

export function updateLevelGamma(settings: LevelCorrectionSettings, gamma: number): LevelCorrectionSettings {
  return normalizeLevelCorrectionSettings({ ...settings, gamma })
}

export function middleInputLevelForGamma(settings: Pick<LevelCorrectionSettings, 'inputBlack' | 'inputWhite' | 'gamma'>): number {
  const range = Math.max(1, settings.inputWhite - settings.inputBlack)
  return settings.inputBlack + range * Math.pow(0.5, settings.gamma)
}

export function gammaForMiddleInputLevel(settings: Pick<LevelCorrectionSettings, 'inputBlack' | 'inputWhite'>, middleInputLevel: number): number {
  const range = Math.max(1, settings.inputWhite - settings.inputBlack)
  const normalized = Math.min(0.999999, Math.max(0.000001, (middleInputLevel - settings.inputBlack) / range))
  return clampGamma(Math.log(normalized) / Math.log(0.5))
}

export function applyLevelCorrectionToImageData(imageData: ImageData, settingsInput: Partial<LevelCorrectionSettings>): ImageData {
  const settings = normalizeLevelCorrectionSettings(settingsInput)
  if (!settings.enabled) return imageData
  const output = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height)
  const { inputBlack, inputWhite, gamma } = settings
  for (let index = 0; index < output.data.length; index += 4) {
    output.data[index] = correctLevelChannel(output.data[index], inputBlack, inputWhite, gamma)
    output.data[index + 1] = correctLevelChannel(output.data[index + 1], inputBlack, inputWhite, gamma)
    output.data[index + 2] = correctLevelChannel(output.data[index + 2], inputBlack, inputWhite, gamma)
  }
  return output
}

export function buildLevelHistogram(imageData: ImageData, bucketCount = LEVEL_HISTOGRAM_BUCKETS): number[] {
  const buckets = new Array<number>(bucketCount).fill(0)
  for (let index = 0; index < imageData.data.length; index += 4) {
    const alpha = imageData.data[index + 3] / 255
    if (alpha <= 0.01) continue
    const luminance = imageData.data[index] * 0.299 + imageData.data[index + 1] * 0.587 + imageData.data[index + 2] * 0.114
    const bucket = Math.min(bucketCount - 1, Math.max(0, Math.round((luminance / 255) * (bucketCount - 1))))
    buckets[bucket] += alpha
  }
  return buckets
}

export function levelCorrectionTableValues(settingsInput: Partial<LevelCorrectionSettings>, sampleCount = 256): string {
  const settings = normalizeLevelCorrectionSettings(settingsInput)
  const count = Math.max(2, Math.round(sampleCount))
  const maxIndex = count - 1
  const values: string[] = []
  for (let index = 0; index < count; index += 1) {
    const input = Math.round((index / maxIndex) * 255)
    values.push((correctLevelChannel(input, settings.inputBlack, settings.inputWhite, settings.gamma) / 255).toFixed(5))
  }
  return values.join(' ')
}

function correctLevelChannel(value: number, inputBlack: number, inputWhite: number, gamma: number): number {
  const normalized = Math.min(1, Math.max(0, (value - inputBlack) / Math.max(1, inputWhite - inputBlack)))
  return Math.round(Math.pow(normalized, 1 / gamma) * 255)
}

function clampGamma(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_LEVEL_CORRECTION_SETTINGS.gamma
  return Math.min(9.99, Math.max(0.1, Math.round(value * 100) / 100))
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}
