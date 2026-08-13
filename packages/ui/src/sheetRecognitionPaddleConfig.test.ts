import { describe, expect, it, vi } from 'vitest'
import {
  BUNDLED_PADDLE_OCR_ASSET_PATHS,
  createBundledPaddleOcrRuntimeConfig,
} from './sheetRecognitionPaddleConfig'

describe('PaddleOCR runtime security contract', () => {
  it('uses only repository-owned models and enables the worker', () => {
    const resolveAssetUrl = vi.fn((path: string) => `https://example.test/xsheet-remap/${path}`)
    const config = createBundledPaddleOcrRuntimeConfig(resolveAssetUrl)

    expect(config.worker).toBe(true)
    expect(config.textDetectionModelAsset.url).toBe(
      `https://example.test/xsheet-remap/${BUNDLED_PADDLE_OCR_ASSET_PATHS.textDetectionModel}`,
    )
    expect(config.textRecognitionModelAsset.url).toBe(
      `https://example.test/xsheet-remap/${BUNDLED_PADDLE_OCR_ASSET_PATHS.textRecognitionModel}`,
    )
    expect(config.ortOptions.wasmPaths).toBe(
      `https://example.test/xsheet-remap/${BUNDLED_PADDLE_OCR_ASSET_PATHS.ortRuntime}`,
    )
    expect(resolveAssetUrl.mock.calls.map(([path]) => path)).toEqual([
      BUNDLED_PADDLE_OCR_ASSET_PATHS.textDetectionModel,
      BUNDLED_PADDLE_OCR_ASSET_PATHS.textRecognitionModel,
      BUNDLED_PADDLE_OCR_ASSET_PATHS.ortRuntime,
    ])
  })

  it('does not expose arbitrary YAML or model configuration inputs', () => {
    expect(createBundledPaddleOcrRuntimeConfig).toHaveLength(1)
    const config = createBundledPaddleOcrRuntimeConfig(path => path)

    expect(config).not.toHaveProperty('pipelineConfig')
    expect(config).not.toHaveProperty('assets')
    expect(config.textDetectionModelAsset.url).toBe(BUNDLED_PADDLE_OCR_ASSET_PATHS.textDetectionModel)
    expect(config.textRecognitionModelAsset.url).toBe(BUNDLED_PADDLE_OCR_ASSET_PATHS.textRecognitionModel)
  })
})
