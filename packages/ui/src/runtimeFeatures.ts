import type { RecognitionCandidate } from '@xsheet-remap/core'
import type { RecognizeSheetPagesOptions } from './sheetRecognition'

export { normalizeRecognitionLabel } from './sheetRecognitionLabels'

export const SHEET_OCR_AVAILABLE = import.meta.env.MODE !== 'pages'

export async function recognizeSheetPagesIfAvailable(options: RecognizeSheetPagesOptions): Promise<RecognitionCandidate[]> {
  if (!SHEET_OCR_AVAILABLE) return []
  const { recognizeSheetPages } = await import('./sheetRecognition')
  return recognizeSheetPages(options)
}
