import type { SheetCalibrationPointPair } from '@xsheet-remap/core'
import type { SheetCorrectorImportSourceKind } from './sheetCorrectorImportRules'

export type SheetCorrectorInput = {
  path: string
  name: string
  extension: string
  size?: number
  matched: boolean
  sourceKind: SheetCorrectorImportSourceKind
}

export type SheetCorrectionDraft = {
  templateId: string
  points: SheetCalibrationPointPair[]
  applied: boolean
}

export type QueueState = 'idle' | 'running' | 'corrected' | 'exported' | 'review' | 'error'

export type SheetCorrectorProgressDialogState = {
  title: string
  message: string
  phase: 'collecting' | 'running' | 'done'
  total: number
  processed: number
  exported: number
  review: number
  error: number
  canClose: boolean
}

export type SheetCorrectorSavedWindowState = {
  width: number
  height: number
  x?: number
  y?: number
}

export const SHEET_CORRECTOR_PREVIEW_MIN_ZOOM = 0.25
export const SHEET_CORRECTOR_PREVIEW_MAX_ZOOM = 3
export const supportedImageExtensions = new Set(['png', 'jpg', 'jpeg', 'tif', 'tiff', 'tga', 'bmp'])
export const SHEET_CORRECTOR_MAIN_WINDOW = { width: 1180, height: 820, minWidth: 900, minHeight: 620 }
export const SHEET_CORRECTOR_BATCH_WINDOW = { width: 520, height: 390, minWidth: 460, minHeight: 340 }
export const SHEET_CORRECTOR_WINDOW_STATE_STORAGE_KEY = 'xsheet-remap.sheet-corrector.windowState'
