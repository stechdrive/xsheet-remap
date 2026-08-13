export const BUNDLED_PADDLE_OCR_ASSET_PATHS = Object.freeze({
  textDetectionModel: 'ocr/models/PP-OCRv5_mobile_det_onnx_infer.tar',
  textRecognitionModel: 'ocr/models/PP-OCRv5_mobile_rec_onnx_infer.tar',
  ortRuntime: 'ocr/ort/',
})

export type PaddleOcrAssetUrlResolver = (path: string) => string

/**
 * Keeps the PaddleOCR worker on repository-owned model/config assets.
 *
 * PaddleOCR 0.4.2 embeds js-yaml 4.1.1 in its prebuilt worker. Until the
 * upstream worker is rebuilt with the patched dependency, arbitrary pipeline
 * YAML or caller-provided model URLs must not enter this configuration.
 */
export function createBundledPaddleOcrRuntimeConfig(resolveAssetUrl: PaddleOcrAssetUrlResolver) {
  return {
    worker: true,
    lang: 'ch',
    ocrVersion: 'PP-OCRv5',
    textDetectionModelName: 'PP-OCRv5_mobile_det',
    textRecognitionModelName: 'PP-OCRv5_mobile_rec',
    textDetectionModelAsset: {
      url: resolveAssetUrl(BUNDLED_PADDLE_OCR_ASSET_PATHS.textDetectionModel),
    },
    textRecognitionModelAsset: {
      url: resolveAssetUrl(BUNDLED_PADDLE_OCR_ASSET_PATHS.textRecognitionModel),
    },
    textDetLimitSideLen: 1280,
    textDetLimitType: 'max',
    textRecScoreThresh: 0.2,
    ortOptions: {
      backend: 'wasm',
      numThreads: 1,
      wasmPaths: resolveAssetUrl(BUNDLED_PADDLE_OCR_ASSET_PATHS.ortRuntime),
    },
  } as const
}
