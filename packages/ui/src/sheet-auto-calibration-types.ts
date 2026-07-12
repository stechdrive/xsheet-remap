import type { NormalizedPoint, SheetCalibrationPointPair } from '@xsheet-remap/core'

export type PixelPoint = {
  x: number
  y: number
}

export type DetectedLine = {
  x1: number
  y1: number
  x2: number
  y2: number
  length: number
  angleDeg: number
  centerX: number
  centerY: number
}

export type ScoredLine = {
  line: DetectedLine
  score: number
}

export type AutoCalibrationResult = {
  points: SheetCalibrationPointPair[]
  confidence: number
  detectedLineCount: number
  debugOverlay: AutoCalibrationDebugOverlay
}

export type AutoCalibrationDebugOverlay = {
  method: 'template-grid-fit' | 'horizontal-span-projection' | 'pixel-projection' | 'opencv-hough'
  targetQuad: NormalizedPoint[]
  detectedQuad: NormalizedPoint[]
  localCornerMatches?: AutoCalibrationLocalCornerDebug[]
}

export type AutoCalibrationLocalCornerDebug = {
  corner: 'tl' | 'tr' | 'br' | 'bl'
  dx: number
  dy: number
  angleDeg: number
  rawGain: number
  accepted: boolean
}

export type GridFitGuide = {
  ratio: number
  weight: number
}

export type GridFitGuides = {
  vertical: GridFitGuide[]
  horizontal: GridFitGuide[]
}

export type PixelRect = {
  left: number
  top: number
  right: number
  bottom: number
}

export type DarkDistanceMap = {
  width: number
  height: number
  distances: Uint16Array
  unit: number
}

export type LocalCornerId = 'tl' | 'tr' | 'br' | 'bl'

export type LocalCornerConfig = {
  id: LocalCornerId
  index: 0 | 1 | 2 | 3
  xSign: -1 | 1
  ySign: -1 | 1
}

export type LocalCornerMatch = {
  point: PixelPoint
  score: number
  baseScore: number
  rawScore: number
  baseRawScore: number
  dx: number
  dy: number
  angleDeg: number
}

type LocalCornerGuide = {
  offset: number
  weight: number
}

export type LocalCornerGuides = {
  vertical: LocalCornerGuide[]
  horizontal: LocalCornerGuide[]
}

export const MIN_PROJECTED_LINE_RATIO = 0.04
export const MIN_HORIZONTAL_SPAN_RATIO = 0.12
