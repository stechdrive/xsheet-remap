import {
  type NormalizedPoint,
  type SheetCalibrationPointPair,
  type SheetTemplate,
} from '@xsheet-remap/core'
import {
  calibrationTargetRectForTemplate,
  defaultCalibrationPoints,
  loadImage,
} from './sheetImages'
import { clampNumber } from './sheetInteraction'
import opencvScriptUrl from '@techstark/opencv-js/dist/opencv.js?url'

type OpenCvMat = {
  rows: number
  cols: number
  data32S: Int32Array
  delete: () => void
}

type OpenCvSize = { width: number; height: number }

type OpenCvRuntime = {
  Mat: new () => OpenCvMat
  Size: new (width: number, height: number) => OpenCvSize
  COLOR_RGBA2GRAY: number
  BORDER_DEFAULT: number
  imread: (source: HTMLCanvasElement) => OpenCvMat
  cvtColor: (src: OpenCvMat, dst: OpenCvMat, code: number) => void
  GaussianBlur: (src: OpenCvMat, dst: OpenCvMat, ksize: OpenCvSize, sigmaX: number, sigmaY: number, borderType: number) => void
  Canny: (src: OpenCvMat, dst: OpenCvMat, threshold1: number, threshold2: number, apertureSize: number, l2gradient: boolean) => void
  HoughLinesP: (image: OpenCvMat, lines: OpenCvMat, rho: number, theta: number, threshold: number, minLineLength: number, maxLineGap: number) => void
  onRuntimeInitialized?: () => void
}

type DetectedLine = {
  x1: number
  y1: number
  x2: number
  y2: number
  length: number
  angleDeg: number
  centerX: number
  centerY: number
}

type ScoredLine = {
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

const MAX_AXIS_ANGLE_DEG = 12
const MIN_LINE_SCORE = 4.5
const MIN_PROJECTED_LINE_RATIO = 0.04
const MIN_HORIZONTAL_SPAN_RATIO = 0.12

let openCvPromise: Promise<{ cv: OpenCvRuntime }> | null = null

export async function detectSheetCalibrationPoints(imageUrl: string, template: SheetTemplate): Promise<AutoCalibrationResult | null> {
  const targetRect = calibrationTargetRectForTemplate(template)
  if (!targetRect) return null

  const image = await loadImage(imageUrl)
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  if (width <= 0 || height <= 0) return null

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.drawImage(image, 0, 0, width, height)

  const rectPx = {
    left: targetRect.x * width,
    top: targetRect.y * height,
    right: (targetRect.x + targetRect.w) * width,
    bottom: (targetRect.y + targetRect.h) * height,
  }
  const defaults = defaultCalibrationPoints(template)
  const targetQuad = defaults.map(point => point.target)
  const projected = detectProjectionCalibrationCorners(context, canvas, rectPx, template)
  if (projected && isPlausibleCalibrationQuad(projected.corners)) {
    return buildAutoCalibrationResult(defaults, projected.corners, projected.confidence, 4, projected.method, targetQuad, projected.localCornerMatches)
  }

  const cv = await loadOpenCv()
  const lines = detectAxisLines(cv, canvas)
  if (lines.length === 0) return null
  const selected = selectCalibrationLines(lines, rectPx, width, height)
  if (!selected) return null
  const sourceCorners = calibrationCornersFromSelectedLines(selected, width, height)
  if (!isPlausibleCalibrationQuad(sourceCorners)) return null

  const averageScore = (selected.top.score + selected.bottom.score + selected.left.score + selected.right.score) / 4
  const confidence = clampNumber(1 - averageScore / MIN_LINE_SCORE, 0.05, 0.98)
  return buildAutoCalibrationResult(defaults, sourceCorners, confidence, lines.length, 'opencv-hough', targetQuad)
}

function buildAutoCalibrationResult(
  defaults: SheetCalibrationPointPair[],
  sourceCorners: NormalizedPoint[],
  confidence: number,
  detectedLineCount: number,
  method: AutoCalibrationDebugOverlay['method'],
  targetQuad: NormalizedPoint[],
  localCornerMatches?: AutoCalibrationLocalCornerDebug[],
): AutoCalibrationResult {
  return {
    points: defaults.map((point, index) => ({
      ...point,
      source: sourceCorners[index],
      target: point.target,
    })),
    confidence,
    detectedLineCount,
    debugOverlay: {
      method,
      targetQuad,
      detectedQuad: sourceCorners,
      localCornerMatches,
    },
  }
}

function calibrationCornersFromSelectedLines(
  selected: NonNullable<ReturnType<typeof selectCalibrationLines>>,
  width: number,
  height: number,
): NormalizedPoint[] {
  const topLeft = intersectLines(selected.top.line, selected.left.line)
  const topRight = intersectLines(selected.top.line, selected.right.line)
  const bottomRight = intersectLines(selected.bottom.line, selected.right.line)
  const bottomLeft = intersectLines(selected.bottom.line, selected.left.line)
  if (!topLeft || !topRight || !bottomRight || !bottomLeft) return []
  return [topLeft, topRight, bottomRight, bottomLeft].map(point => normalizePixelPoint(point, width, height))
}

async function loadOpenCv(): Promise<OpenCvRuntime> {
  if (!openCvPromise) {
    openCvPromise = loadOpenCvScript()
  }
  const loaded = await openCvPromise
  return loaded.cv
}

function loadOpenCvScript(): Promise<{ cv: OpenCvRuntime }> {
  const existing = globalOpenCvValue()
  if (existing) return resolveOpenCvModule(existing)
  return new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>('script[data-xsheet-opencv]')
    const script = existingScript ?? document.createElement('script')
    script.dataset.xsheetOpencv = 'true'
    script.async = true
    script.onload = () => {
      const loaded = globalOpenCvValue()
      if (!loaded) {
        reject(new Error('OpenCV script loaded without a runtime'))
        return
      }
      resolveOpenCvModule(loaded).then(resolve, reject)
    }
    script.onerror = () => reject(new Error('OpenCV script failed to load'))
    if (!existingScript) {
      script.src = opencvScriptUrl
      document.head.appendChild(script)
    }
  })
}

function resolveOpenCvModule(loaded: unknown): Promise<{ cv: OpenCvRuntime }> {
  if (isOpenCvRuntimeCandidate(loaded)) return waitForOpenCvRuntime(loaded)
  const then = isObjectRecord(loaded) ? loaded.then : undefined
  if (typeof then === 'function') {
    return new Promise((resolve, reject) => {
      try {
        then.call(
          loaded,
          (value: unknown) => {
            resolveOpenCvValue(value).then(resolve, reject)
          },
          (error: unknown) => reject(error),
        )
      } catch (error) {
        const fallback = isOpenCvRuntimeCandidate(loaded)
          ? loaded
          : globalOpenCvCandidate()
        if (fallback) {
          waitForOpenCvRuntime(fallback).then(resolve, reject)
        } else {
          reject(error)
        }
      }
    })
  }
  return resolveOpenCvValue(loaded)
}

function resolveOpenCvValue(value: unknown): Promise<{ cv: OpenCvRuntime }> {
  if (isOpenCvRuntimeCandidate(value)) return waitForOpenCvRuntime(value)
  const fallback = globalOpenCvCandidate()
  if (fallback) return waitForOpenCvRuntime(fallback)
  return Promise.reject(new Error('OpenCV runtime was not initialized'))
}

function waitForOpenCvRuntime(cv: OpenCvRuntime): Promise<{ cv: OpenCvRuntime }> {
  const runtime = cv as Partial<OpenCvRuntime>
  if (typeof runtime.Mat === 'function' && typeof runtime.imread === 'function') {
    return Promise.resolve({ cv: sanitizeOpenCvRuntime(cv) })
  }
  return new Promise(resolve => {
    const previous = cv.onRuntimeInitialized
    cv.onRuntimeInitialized = () => {
      previous?.()
      resolve({ cv: sanitizeOpenCvRuntime(cv) })
    }
  })
}

function isOpenCvRuntimeCandidate(value: unknown): value is OpenCvRuntime {
  if (!isObjectRecord(value)) return false
  return typeof value.Mat === 'function' ||
    typeof value.imread === 'function' ||
    'onRuntimeInitialized' in value
}

function globalOpenCvCandidate(): OpenCvRuntime | null {
  const value = globalOpenCvValue()
  return isOpenCvRuntimeCandidate(value) ? value : null
}

function globalOpenCvValue(): unknown {
  return (globalThis as typeof globalThis & { cv?: unknown }).cv
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return (typeof value === 'object' || typeof value === 'function') && value !== null
}

function sanitizeOpenCvRuntime(cv: OpenCvRuntime): OpenCvRuntime {
  const maybeThenable = cv as OpenCvRuntime & { then?: unknown }
  if ('then' in maybeThenable) {
    try {
      Object.defineProperty(maybeThenable, 'then', {
        value: undefined,
        configurable: true,
        writable: true,
      })
    } catch {
      try {
        delete maybeThenable.then
      } catch {
        const runtime = Object.create(cv) as OpenCvRuntime & { then?: unknown }
        Object.defineProperty(runtime, 'then', {
          value: undefined,
          configurable: true,
          writable: true,
        })
        return runtime
      }
    }
  }
  return cv
}

function detectAxisLines(cv: OpenCvRuntime, canvas: HTMLCanvasElement): DetectedLine[] {
  const src = cv.imread(canvas)
  const gray = new cv.Mat()
  const blurred = new cv.Mat()
  const edges = new cv.Mat()
  const lineMat = new cv.Mat()
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
    cv.GaussianBlur(gray, blurred, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT)
    cv.Canny(blurred, edges, 45, 140, 3, false)

    const minSide = Math.min(canvas.width, canvas.height)
    const houghThreshold = Math.round(clampNumber(minSide * 0.06, 70, 180))
    const minLineLength = Math.round(clampNumber(minSide * 0.08, 80, 260))
    const maxLineGap = Math.round(clampNumber(minSide * 0.015, 12, 42))
    cv.HoughLinesP(edges, lineMat, 1, Math.PI / 180, houghThreshold, minLineLength, maxLineGap)

    const result: DetectedLine[] = []
    for (let row = 0; row < lineMat.rows; row += 1) {
      const offset = row * 4
      const x1 = lineMat.data32S[offset]
      const y1 = lineMat.data32S[offset + 1]
      const x2 = lineMat.data32S[offset + 2]
      const y2 = lineMat.data32S[offset + 3]
      const dx = x2 - x1
      const dy = y2 - y1
      const length = Math.hypot(dx, dy)
      if (length < minLineLength) continue
      const angleDeg = normalizedAxisAngleDeg(Math.atan2(dy, dx) * 180 / Math.PI)
      if (angleDeg > MAX_AXIS_ANGLE_DEG && Math.abs(90 - angleDeg) > MAX_AXIS_ANGLE_DEG) continue
      result.push({
        x1,
        y1,
        x2,
        y2,
        length,
        angleDeg,
        centerX: (x1 + x2) / 2,
        centerY: (y1 + y2) / 2,
      })
    }
    return result
  } finally {
    src.delete()
    gray.delete()
    blurred.delete()
    edges.delete()
    lineMat.delete()
  }
}

function selectCalibrationLines(
  lines: DetectedLine[],
  rect: { left: number; top: number; right: number; bottom: number },
  width: number,
  height: number,
) {
  const horizontal = lines.filter(line => line.angleDeg <= MAX_AXIS_ANGLE_DEG)
  const vertical = lines.filter(line => Math.abs(90 - line.angleDeg) <= MAX_AXIS_ANGLE_DEG)
  const top = bestHorizontalLine(horizontal, rect.top, rect.left, rect.right, height)
  const bottom = bestHorizontalLine(horizontal, rect.bottom, rect.left, rect.right, height)
  const left = bestVerticalLine(vertical, rect.left, rect.top, rect.bottom, width)
  const right = bestVerticalLine(vertical, rect.right, rect.top, rect.bottom, width)
  if (!top || !bottom || !left || !right) return null
  if ([top, bottom, left, right].some(item => item.score > MIN_LINE_SCORE)) return null
  return { top, bottom, left, right }
}

function detectProjectionCalibrationCorners(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  rect: { left: number; top: number; right: number; bottom: number },
  template: SheetTemplate,
): {
  corners: NormalizedPoint[]
  confidence: number
  method: AutoCalibrationDebugOverlay['method']
  localCornerMatches?: AutoCalibrationLocalCornerDebug[]
} | null {
  const data = context.getImageData(0, 0, canvas.width, canvas.height)
  const left = Math.round(clampNumber(rect.left, 0, canvas.width - 1))
  const right = Math.round(clampNumber(rect.right, 0, canvas.width - 1))
  const top = Math.round(clampNumber(rect.top, 0, canvas.height - 1))
  const bottom = Math.round(clampNumber(rect.bottom, 0, canvas.height - 1))
  const rectWidth = Math.max(1, right - left)
  const rectHeight = Math.max(1, bottom - top)
  const horizontalWindow = Math.round(clampNumber(rectHeight * 0.055, 48, 130))
  const verticalWindow = Math.round(clampNumber(rectWidth * 0.045, 42, 120))
  const projectedTop = bestProjectedLine(
    top,
    horizontalWindow,
    rectWidth,
    y => darkPixelsInRow(data, y, left, right),
  )
  const projectedBottom = bestProjectedLine(
    bottom,
    horizontalWindow,
    rectWidth,
    y => darkPixelsInRow(data, y, left, right),
  )
  const projectedLeft = bestProjectedLine(
    left,
    verticalWindow,
    rectHeight,
    x => darkPixelsInColumn(data, x, top, bottom),
  )
  const projectedRight = bestProjectedLine(
    right,
    verticalWindow,
    rectHeight,
    x => darkPixelsInColumn(data, x, top, bottom),
  )
  if (!projectedTop || !projectedBottom || !projectedLeft || !projectedRight) return null
  const spanCorners = detectHorizontalSpanCorners(data, rect, projectedTop, projectedBottom)
  const projectionPixelCorners = spanCorners ?? [
    { x: projectedLeft.position, y: projectedTop.position },
    { x: projectedRight.position, y: projectedTop.position },
    { x: projectedRight.position, y: projectedBottom.position },
    { x: projectedLeft.position, y: projectedBottom.position },
  ]
  const gridFit = fitTemplateGridCalibration(data, rect, template, projectionPixelCorners)
  const pixelCorners = gridFit?.corners ?? projectionPixelCorners
  const corners = pixelCorners.map(point => normalizePixelPoint(point, canvas.width, canvas.height))
  const averageRatio = (projectedTop.ratio + projectedBottom.ratio + projectedLeft.ratio + projectedRight.ratio) / 4
  const averageDistance = (
    Math.abs(projectedTop.position - top) / Math.max(1, horizontalWindow)
    + Math.abs(projectedBottom.position - bottom) / Math.max(1, horizontalWindow)
    + Math.abs(projectedLeft.position - left) / Math.max(1, verticalWindow)
    + Math.abs(projectedRight.position - right) / Math.max(1, verticalWindow)
  ) / 4
  return {
    corners,
    confidence: gridFit
      ? clampNumber(gridFit.confidence * 0.86 + averageRatio * 0.18 - averageDistance * 0.08, 0.05, 0.98)
      : clampNumber(averageRatio * 1.4 - averageDistance * 0.2, 0.05, 0.98),
    method: gridFit ? 'template-grid-fit' : spanCorners ? 'horizontal-span-projection' : 'pixel-projection',
    localCornerMatches: gridFit?.localCornerMatches,
  }
}

function detectHorizontalSpanCorners(
  image: ImageData,
  rect: { left: number; top: number; right: number; bottom: number },
  topLine: ProjectedLineResult,
  bottomLine: ProjectedLineResult,
): PixelPoint[] | null {
  const rectWidth = Math.max(1, rect.right - rect.left)
  const searchLeft = Math.round(clampNumber(rect.left - rectWidth * 0.08, 0, image.width - 1))
  const searchRight = Math.round(clampNumber(rect.right + rectWidth * 0.08, 0, image.width - 1))
  const maxGap = Math.round(clampNumber(rectWidth * 0.045, 24, 86))
  const bottomSpan = bestHorizontalSideSpan(image, bottomLine, bottomLine.group.bestPosition, searchLeft, searchRight, rect.left, rect.right, maxGap)
  const topSpan = bestHorizontalSideSpan(image, topLine, topLine.position, searchLeft, searchRight, rect.left, rect.right, maxGap, bottomSpan)
  if (!topSpan || !bottomSpan) return null
  const expectedWidth = Math.max(1, rect.right - rect.left)
  const topWidth = topSpan.end - topSpan.start
  const bottomWidth = bottomSpan.end - bottomSpan.start
  if (topWidth < expectedWidth * 0.45 || bottomWidth < expectedWidth * 0.35) return null
  const topLeft = refineHorizontalSpanCorner(image, { x: topSpan.start, y: topSpan.y }, rect, 'left', 'top', topLine)
  const topRight = refineHorizontalSpanCorner(image, { x: topSpan.end, y: topSpan.y }, rect, 'right', 'top', topLine)
  const bottomRight = refineHorizontalSpanCorner(image, { x: bottomSpan.end, y: bottomSpan.y }, rect, 'right', 'bottom', bottomLine)
  const bottomLeft = refineHorizontalSpanCorner(image, { x: bottomSpan.start, y: bottomSpan.y }, rect, 'left', 'bottom', bottomLine)
  const corners = stabilizeCornerSideExtents(image, rect, topLeft, topRight, bottomRight, bottomLeft, expectedWidth)
  return corners
}

type GridFitGuide = {
  ratio: number
  weight: number
}

type GridFitGuides = {
  vertical: GridFitGuide[]
  horizontal: GridFitGuide[]
}

type PixelRect = {
  left: number
  top: number
  right: number
  bottom: number
}

type DarkDistanceMap = {
  width: number
  height: number
  distances: Uint16Array
  unit: number
}

type LocalCornerId = 'tl' | 'tr' | 'br' | 'bl'

type LocalCornerConfig = {
  id: LocalCornerId
  index: 0 | 1 | 2 | 3
  xSign: -1 | 1
  ySign: -1 | 1
}

type LocalCornerMatch = {
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

type LocalCornerGuides = {
  vertical: LocalCornerGuide[]
  horizontal: LocalCornerGuide[]
}

type TemplateGridFitCandidate = {
  corners: [PixelPoint, PixelPoint, PixelPoint, PixelPoint]
  score: number
  localCornerMatches?: AutoCalibrationLocalCornerDebug[]
}

function fitTemplateGridCalibration(
  image: ImageData,
  rect: { left: number; top: number; right: number; bottom: number },
  template: SheetTemplate,
  seedCorners: PixelPoint[],
): {
  corners: [PixelPoint, PixelPoint, PixelPoint, PixelPoint]
  confidence: number
  localCornerMatches?: AutoCalibrationLocalCornerDebug[]
} | null {
  if (seedCorners.length !== 4) return null
  const targetRect = calibrationTargetRectForTemplate(template)
  if (!targetRect) return null
  const guides = templateGridFitGuides(template, targetRect)
  if (guides.vertical.length < 4 || guides.horizontal.length < 4) return null
  const distanceMap = buildDarkDistanceMap(image)

  const [seedTopLeft, seedTopRight, seedBottomRight, seedBottomLeft] = seedCorners
  const seedTop = (seedTopLeft.y + seedTopRight.y) / 2
  const seedBottom = (seedBottomLeft.y + seedBottomRight.y) / 2
  const seedLeft = (seedTopLeft.x + seedBottomLeft.x) / 2
  const seedRight = (seedTopRight.x + seedBottomRight.x) / 2
  const seedBounds = {
    left: seedLeft,
    top: seedTop,
    right: seedRight,
    bottom: seedBottom,
  }
  const expectedWidth = Math.max(1, rect.right - rect.left)
  const expectedHeight = Math.max(1, rect.bottom - rect.top)
  const seedBoundaryReliability = scoreGridFitSeedBoundaryReliability(seedCorners, expectedWidth, expectedHeight)
  const approximateLeft = Math.min(seedLeft, seedRight)
  const approximateRight = Math.max(seedLeft, seedRight)
  const approximateTop = Math.min(seedTop, seedBottom)
  const approximateBottom = Math.max(seedTop, seedBottom)

  const horizontalWindow = clampNumber(expectedHeight * 0.055, 48, 132)
  const verticalWindow = clampNumber(expectedWidth * 0.05, 44, 128)
  const topCandidates = candidateLinePositions(
    image,
    rect.top,
    seedTop,
    horizontalWindow,
    position => darkRatioInHorizontalBand(image, position, approximateLeft, approximateRight, 1),
    image.height - 1,
    5,
    'min',
  )
  const bottomCandidates = candidateLinePositions(
    image,
    rect.bottom,
    seedBottom,
    horizontalWindow,
    position => darkRatioInHorizontalBand(image, position, approximateLeft, approximateRight, 1),
    image.height - 1,
    5,
    'max',
  )
  const leftCandidates = candidateLinePositions(
    image,
    rect.left,
    seedLeft,
    verticalWindow,
    position => darkRatioInVerticalBand(image, position, approximateTop, approximateBottom, 1),
    image.width - 1,
    7,
    'min',
  )
  const rightCandidates = candidateLinePositions(
    image,
    rect.right,
    seedRight,
    verticalWindow,
    position => darkRatioInVerticalBand(image, position, approximateTop, approximateBottom, 1),
    image.width - 1,
    7,
    'max',
  )

  let best: TemplateGridFitCandidate | null = null
  for (const top of topCandidates) {
    for (const bottom of bottomCandidates) {
      const height = bottom - top
      if (height < expectedHeight * 0.82 || height > expectedHeight * 1.16) continue
      for (const left of leftCandidates) {
        for (const right of rightCandidates) {
          const width = right - left
          if (width < expectedWidth * 0.82 || width > expectedWidth * 1.16) continue
          const candidate = { left, top, right, bottom }
          const score = scoreTemplateGridFitRect(image, distanceMap, rect, guides, candidate) -
            gridFitSeedBoundaryPenalty(candidate, seedBounds, expectedWidth, expectedHeight, seedBoundaryReliability)
          if (!best || score > best.score) {
            best = {
              score,
              corners: [
                { x: left, y: top },
                { x: right, y: top },
                { x: right, y: bottom },
                { x: left, y: bottom },
              ],
            }
          }
        }
      }
    }
  }
  if (!best || best.score < 0.34) return null
  best = refineTemplateGridFitRect(
    image,
    distanceMap,
    rect,
    guides,
    best,
    expectedWidth,
    expectedHeight,
    seedBounds,
    seedBoundaryReliability,
  )
  best = refineTemplateGridFitCorners(distanceMap, guides, best, expectedWidth, expectedHeight)
  return {
    corners: best.corners,
    confidence: clampNumber(best.score, 0.05, 0.98),
    localCornerMatches: best.localCornerMatches,
  }
}

function scoreGridFitSeedBoundaryReliability(seedCorners: PixelPoint[], expectedWidth: number, expectedHeight: number): number {
  const [topLeft, topRight, bottomRight, bottomLeft] = seedCorners
  const topWidth = Math.max(0, topRight.x - topLeft.x)
  const bottomWidth = Math.max(0, bottomRight.x - bottomLeft.x)
  const leftHeight = Math.max(0, bottomLeft.y - topLeft.y)
  const rightHeight = Math.max(0, bottomRight.y - topRight.y)
  const averageWidth = (topWidth + bottomWidth) / 2
  const averageHeight = (leftHeight + rightHeight) / 2
  const widthAgreement = 1 - Math.abs(topWidth - bottomWidth) / Math.max(1, expectedWidth * 0.055)
  const heightAgreement = 1 - Math.abs(leftHeight - rightHeight) / Math.max(1, expectedHeight * 0.055)
  const widthScale = 1 - Math.abs(averageWidth - expectedWidth) / Math.max(1, expectedWidth * 0.09)
  const heightScale = 1 - Math.abs(averageHeight - expectedHeight) / Math.max(1, expectedHeight * 0.09)
  return clampNumber(Math.min(widthAgreement, heightAgreement, widthScale, heightScale), 0, 1)
}

function gridFitSeedBoundaryPenalty(
  candidate: PixelRect,
  seed: PixelRect,
  expectedWidth: number,
  expectedHeight: number,
  reliability: number,
): number {
  if (reliability <= 0) return 0
  const xWindow = clampNumber(expectedWidth * 0.018, 18, 42)
  const yWindow = clampNumber(expectedHeight * 0.018, 20, 48)
  const horizontal = (
    seedEdgePenalty(candidate.left, seed.left, xWindow) +
    seedEdgePenalty(candidate.right, seed.right, xWindow)
  ) / 2
  const vertical = (
    seedEdgePenalty(candidate.top, seed.top, yWindow) +
    seedEdgePenalty(candidate.bottom, seed.bottom, yWindow)
  ) / 2
  return reliability * (horizontal * 0.34 + vertical * 0.28)
}

function seedEdgePenalty(candidate: number, seed: number, window: number): number {
  const normalizedDistance = Math.abs(candidate - seed) / Math.max(1, window)
  return Math.max(0, normalizedDistance - 0.22)
}

function templateGridFitGuides(template: SheetTemplate, targetRect: { x: number; y: number; w: number; h: number }): GridFitGuides {
  const vertical: GridFitGuide[] = [
    { ratio: 0, weight: 1.8 },
    { ratio: 1, weight: 1.8 },
  ]
  const horizontal: GridFitGuide[] = [
    { ratio: 0, weight: 1.8 },
    { ratio: 1, weight: 1.8 },
  ]
  for (const region of template.regions) {
    if (region.type !== 'exposure-grid' || !region.grid) continue
    if (!['action', 'sound', 'cell', 'camera'].includes(region.grid.role)) continue
    addGuide(vertical, (region.rect.x - targetRect.x) / targetRect.w, 1.2)
    addGuide(vertical, (region.rect.x + region.rect.w - targetRect.x) / targetRect.w, 1.2)
    const columnCount = Math.max(1, region.grid.columns.length)
    for (let index = 1; index < columnCount; index += 1) {
      addGuide(vertical, (region.rect.x + region.rect.w * (index / columnCount) - targetRect.x) / targetRect.w, 0.7)
    }

    addGuide(horizontal, (region.rect.y - targetRect.y) / targetRect.h, 1.25)
    addGuide(horizontal, (region.rect.y + region.rect.h - targetRect.y) / targetRect.h, 1.15)
    const rowCount = Math.max(1, region.grid.rowCount)
    const minorStep = Math.max(1, Math.floor(rowCount / 18))
    for (let row = minorStep; row < rowCount; row += minorStep) {
      const weight = region.grid.majorLineEvery && row % region.grid.majorLineEvery === 0 ? 0.85 : 0.42
      addGuide(horizontal, (region.rect.y + region.rect.h * (row / rowCount) - targetRect.y) / targetRect.h, weight)
    }
  }
  return {
    vertical: dedupeGuides(vertical).sort((a, b) => a.ratio - b.ratio),
    horizontal: dedupeGuides(horizontal).sort((a, b) => a.ratio - b.ratio),
  }
}

function addGuide(guides: GridFitGuide[], ratio: number, weight: number) {
  if (!Number.isFinite(ratio) || ratio < -0.01 || ratio > 1.01) return
  guides.push({ ratio: clampNumber(ratio, 0, 1), weight })
}

function dedupeGuides(guides: GridFitGuide[]): GridFitGuide[] {
  const sorted = [...guides].sort((a, b) => a.ratio - b.ratio)
  const result: GridFitGuide[] = []
  for (const guide of sorted) {
    const previous = result[result.length - 1]
    if (previous && Math.abs(previous.ratio - guide.ratio) < 0.0016) {
      previous.weight = Math.max(previous.weight, guide.weight)
    } else {
      result.push({ ...guide })
    }
  }
  return result
}

type CandidateEdgePreference = 'min' | 'max'

function candidateLinePositions(
  image: ImageData,
  expected: number,
  seed: number,
  window: number,
  supportAt: (position: number) => number,
  maxPosition: number,
  limit: number,
  edgePreference: CandidateEdgePreference,
): number[] {
  const start = Math.round(Math.max(0, Math.min(expected, seed) - window))
  const end = Math.round(Math.min(maxPosition, Math.max(expected, seed) + window))
  const groups = localSupportGroups(start, end, supportAt, 0.018)
  const scored = new Map<number, number>()
  const addPosition = (position: number, bonus = 0) => {
    const rounded = Math.round(position)
    const support = supportAt(rounded)
    const distance = Math.abs(rounded - expected) / Math.max(1, window)
    const seedDistance = Math.abs(rounded - seed) / Math.max(1, window)
    const score = support * 2.2 - distance * 0.28 - seedDistance * 0.1 + bonus
    const previous = scored.get(rounded)
    if (previous === undefined || score > previous) scored.set(rounded, score)
  }
  addPosition(expected, 0.18)
  addPosition(seed, 0.12)
  for (const group of groups) {
    addPosition(group.bestPosition, group.bestRatio)
    const edgePosition = edgePreference === 'min' ? group.start : group.end
    if (Math.abs(edgePosition - group.bestPosition) >= 10) {
      addPosition(edgePosition, group.bestRatio * 0.45)
    }
    addPosition(projectedLinePositionForExpected(group, expected), group.bestRatio * 0.8)
    addPosition((group.start + group.end) / 2, group.bestRatio * 0.55)
  }
  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([position]) => position)
    .sort((a, b) => a - b)
}

function scoreTemplateGridFitRect(
  image: ImageData,
  distanceMap: DarkDistanceMap,
  expectedRect: { left: number; top: number; right: number; bottom: number },
  guides: GridFitGuides,
  candidate: { left: number; top: number; right: number; bottom: number },
): number {
  const width = Math.max(1, candidate.right - candidate.left)
  const height = Math.max(1, candidate.bottom - candidate.top)
  let weightedScore = 0
  let totalWeight = 0
  for (const guide of guides.vertical) {
    const x = candidate.left + width * guide.ratio
    const support = segmentedVerticalSupport(image, x, candidate.top, candidate.bottom, 1)
    weightedScore += support * guide.weight
    totalWeight += guide.weight
  }
  for (const guide of guides.horizontal) {
    const y = candidate.top + height * guide.ratio
    const support = segmentedHorizontalSupport(image, y, candidate.left, candidate.right, 1)
    weightedScore += support * guide.weight
    totalWeight += guide.weight
  }
  const supportScore = weightedScore / Math.max(1, totalWeight)
  const distanceScore = scoreTemplateGridDistanceFitRect(distanceMap, guides, candidate)
  const gridScore = supportScore * 0.86 + distanceScore * 0.14
  const expectedWidth = Math.max(1, expectedRect.right - expectedRect.left)
  const expectedHeight = Math.max(1, expectedRect.bottom - expectedRect.top)
  const xWindow = clampNumber(expectedWidth * 0.05, 44, 128)
  const yWindow = clampNumber(expectedHeight * 0.055, 48, 132)
  const localDistancePenalty = (
    Math.abs(candidate.left - expectedRect.left) / xWindow +
    Math.abs(candidate.right - expectedRect.right) / xWindow +
    Math.abs(candidate.top - expectedRect.top) / yWindow +
    Math.abs(candidate.bottom - expectedRect.bottom) / yWindow
  ) * 0.08
  const globalDistancePenalty = (
    Math.abs(candidate.left - expectedRect.left) / expectedWidth +
    Math.abs(candidate.right - expectedRect.right) / expectedWidth +
    Math.abs(candidate.top - expectedRect.top) / expectedHeight +
    Math.abs(candidate.bottom - expectedRect.bottom) / expectedHeight
  ) * 0.1
  const outsidePenalty = boundaryOutsidePenalty(image, candidate)
  return gridScore - localDistancePenalty - globalDistancePenalty - outsidePenalty
}

function refineTemplateGridFitRect(
  image: ImageData,
  distanceMap: DarkDistanceMap,
  expectedRect: { left: number; top: number; right: number; bottom: number },
  guides: GridFitGuides,
  initial: { corners: [PixelPoint, PixelPoint, PixelPoint, PixelPoint]; score: number },
  expectedWidth: number,
  expectedHeight: number,
  seedBounds: PixelRect,
  seedBoundaryReliability: number,
): TemplateGridFitCandidate {
  let rect = pixelRectFromCorners(initial.corners)
  let score = initial.score
  const scoreRect = (candidate: PixelRect) => scoreTemplateGridFitRect(image, distanceMap, expectedRect, guides, candidate) -
    gridFitSeedBoundaryPenalty(candidate, seedBounds, expectedWidth, expectedHeight, seedBoundaryReliability)
  const minWidth = expectedWidth * 0.82
  const maxWidth = expectedWidth * 1.16
  const minHeight = expectedHeight * 0.82
  const maxHeight = expectedHeight * 1.16
  const isPlausible = (candidate: PixelRect) => {
    const width = candidate.right - candidate.left
    const height = candidate.bottom - candidate.top
    return width >= minWidth && width <= maxWidth && height >= minHeight && height <= maxHeight
  }

  for (const step of [4, 2, 1]) {
    let improved = true
    let guard = 0
    while (improved && guard < 24) {
      improved = false
      guard += 1
      const variants: PixelRect[] = [
        { ...rect, left: rect.left - step },
        { ...rect, left: rect.left + step },
        { ...rect, right: rect.right - step },
        { ...rect, right: rect.right + step },
        { ...rect, top: rect.top - step },
        { ...rect, top: rect.top + step },
        { ...rect, bottom: rect.bottom - step },
        { ...rect, bottom: rect.bottom + step },
      ]
      for (const candidate of variants) {
        if (!isPlausible(candidate)) continue
        const candidateScore = scoreRect(candidate)
        if (candidateScore > score + 0.006) {
          rect = candidate
          score = candidateScore
          improved = true
        }
      }
    }
  }

  return {
    corners: pixelRectToCorners(rect),
    score,
  }
}

function refineTemplateGridFitCorners(
  distanceMap: DarkDistanceMap,
  guides: GridFitGuides,
  initial: { corners: [PixelPoint, PixelPoint, PixelPoint, PixelPoint]; score: number },
  expectedWidth: number,
  expectedHeight: number,
): {
  corners: [PixelPoint, PixelPoint, PixelPoint, PixelPoint]
  score: number
  localCornerMatches: AutoCalibrationLocalCornerDebug[]
} {
  const corners = [...initial.corners] as [PixelPoint, PixelPoint, PixelPoint, PixelPoint]
  const matches = localCornerConfigs.map(config => matchLocalTemplateCorner(
    distanceMap,
    guides,
    corners[config.index],
    config,
    expectedWidth,
    expectedHeight,
  ))
  const accepted = stabilizeLocalCornerMatches(matches)
  for (const match of accepted) {
    const config = localCornerConfigs.find(item => item.id === match.id)
    if (config) corners[config.index] = match.point
  }
  const averageGain = averageNumber(accepted.map(match => Math.max(0, match.rawScore - match.baseRawScore)))
  return {
    corners,
    score: clampNumber(initial.score + averageGain * 0.08, 0.05, 0.98),
    localCornerMatches: matches.map(match => ({
      corner: match.id,
      dx: match.dx,
      dy: match.dy,
      angleDeg: match.angleDeg,
      rawGain: match.rawScore - match.baseRawScore,
      accepted: accepted.some(acceptedMatch => acceptedMatch.id === match.id),
    })),
  }
}

const localCornerConfigs: LocalCornerConfig[] = [
  { id: 'tl', index: 0, xSign: 1, ySign: 1 },
  { id: 'tr', index: 1, xSign: -1, ySign: 1 },
  { id: 'br', index: 2, xSign: -1, ySign: -1 },
  { id: 'bl', index: 3, xSign: 1, ySign: -1 },
]

function matchLocalTemplateCorner(
  distanceMap: DarkDistanceMap,
  guides: GridFitGuides,
  basePoint: PixelPoint,
  config: LocalCornerConfig,
  expectedWidth: number,
  expectedHeight: number,
): LocalCornerMatch & { id: LocalCornerId } {
  const localSpanX = clampNumber(expectedWidth * 0.16, 170, 340)
  const localSpanY = clampNumber(expectedHeight * 0.15, 210, 380)
  const localGuides = localCornerGuides(guides, config, expectedWidth, expectedHeight, localSpanX, localSpanY)
  const baseRawScore = scoreLocalTemplateCorner(distanceMap, basePoint, config, localGuides, localSpanX, localSpanY, 0)
  let best: LocalCornerMatch & { id: LocalCornerId } = {
    id: config.id,
    point: basePoint,
    score: baseRawScore,
    baseScore: baseRawScore,
    rawScore: baseRawScore,
    baseRawScore,
    dx: 0,
    dy: 0,
    angleDeg: 0,
  }
  const consider = (dx: number, dy: number, angleDeg: number) => {
    const point = { x: basePoint.x + dx, y: basePoint.y + dy }
    const rawScore = scoreLocalTemplateCorner(distanceMap, point, config, localGuides, localSpanX, localSpanY, angleDeg)
    const movementPenalty = Math.hypot(dx, dy) / 16 * 0.018
    const anglePenalty = Math.abs(angleDeg) / 1.2 * 0.012
    const score = rawScore - movementPenalty - anglePenalty
    if (score > best.score) {
      best = {
        id: config.id,
        point,
        score,
        baseScore: baseRawScore,
        rawScore,
        baseRawScore,
        dx,
        dy,
        angleDeg,
      }
    }
  }

  for (let angle = -0.9; angle <= 0.901; angle += 0.3) {
    for (let dy = -16; dy <= 16; dy += 2) {
      for (let dx = -16; dx <= 16; dx += 2) {
        consider(dx, dy, angle)
      }
    }
  }
  const coarse = best
  for (let angle = coarse.angleDeg - 0.25; angle <= coarse.angleDeg + 0.251; angle += 0.1) {
    for (let dy = coarse.dy - 2; dy <= coarse.dy + 2; dy += 1) {
      for (let dx = coarse.dx - 2; dx <= coarse.dx + 2; dx += 1) {
        consider(dx, dy, angle)
      }
    }
  }

  const rawGain = best.rawScore - baseRawScore
  if (rawGain < 0.018 || best.score < baseRawScore + 0.006) {
    return {
      id: config.id,
      point: basePoint,
      score: baseRawScore,
      baseScore: baseRawScore,
      rawScore: baseRawScore,
      baseRawScore,
      dx: 0,
      dy: 0,
      angleDeg: 0,
    }
  }
  return best
}

function stabilizeLocalCornerMatches(matches: Array<LocalCornerMatch & { id: LocalCornerId }>): Array<LocalCornerMatch & { id: LocalCornerId }> {
  const byId = new Map(matches.map(match => [match.id, match]))
  const keep = new Set<LocalCornerId>(matches.map(match => match.id))
  const rejectIsolatedSideMove = (
    firstId: LocalCornerId,
    secondId: LocalCornerId,
    axis: 'x' | 'y',
  ) => {
    const first = byId.get(firstId)
    const second = byId.get(secondId)
    if (!first || !second) return
    const firstDelta = axis === 'x' ? first.dx : first.dy
    const secondDelta = axis === 'x' ? second.dx : second.dy
    if (Math.abs(firstDelta) <= 7 || Math.abs(secondDelta) > 4 || Math.sign(firstDelta) === Math.sign(secondDelta)) return
    if (first.rawScore - first.baseRawScore < 0.04) keep.delete(firstId)
  }
  rejectIsolatedSideMove('tl', 'bl', 'x')
  rejectIsolatedSideMove('bl', 'tl', 'x')
  rejectIsolatedSideMove('tr', 'br', 'x')
  rejectIsolatedSideMove('br', 'tr', 'x')
  rejectIsolatedSideMove('tl', 'tr', 'y')
  rejectIsolatedSideMove('tr', 'tl', 'y')
  rejectIsolatedSideMove('bl', 'br', 'y')
  rejectIsolatedSideMove('br', 'bl', 'y')
  return matches.filter(match => keep.has(match.id) && (match.dx !== 0 || match.dy !== 0 || Math.abs(match.angleDeg) > 0.01))
}

function localCornerGuides(
  guides: GridFitGuides,
  config: LocalCornerConfig,
  expectedWidth: number,
  expectedHeight: number,
  localSpanX: number,
  localSpanY: number,
): LocalCornerGuides {
  const vertical = guides.vertical
    .map(guide => ({
      offset: config.xSign > 0 ? guide.ratio * expectedWidth : (1 - guide.ratio) * expectedWidth,
      weight: guide.weight,
    }))
    .filter(guide => guide.offset >= -0.5 && guide.offset <= localSpanX)
    .sort((a, b) => a.offset - b.offset)
  const horizontal = guides.horizontal
    .map(guide => ({
      offset: config.ySign > 0 ? guide.ratio * expectedHeight : (1 - guide.ratio) * expectedHeight,
      weight: guide.weight,
    }))
    .filter(guide => guide.offset >= -0.5 && guide.offset <= localSpanY)
    .sort((a, b) => a.offset - b.offset)
  return {
    vertical: vertical.slice(0, 14),
    horizontal: horizontal.slice(0, 16),
  }
}

function scoreLocalTemplateCorner(
  distanceMap: DarkDistanceMap,
  origin: PixelPoint,
  config: LocalCornerConfig,
  guides: LocalCornerGuides,
  localSpanX: number,
  localSpanY: number,
  angleDeg: number,
): number {
  const angle = angleDeg * Math.PI / 180
  const right = { x: Math.cos(angle), y: Math.sin(angle) }
  const down = { x: -Math.sin(angle), y: Math.cos(angle) }
  const u = { x: right.x * config.xSign, y: right.y * config.xSign }
  const v = { x: down.x * config.ySign, y: down.y * config.ySign }
  let weightedScore = 0
  let totalWeight = 0
  for (const guide of guides.vertical) {
    const start = addLocalVector(origin, u, guide.offset, v, 0)
    const end = addLocalVector(origin, u, guide.offset, v, localSpanY)
    const score = scoreDistanceSegment(distanceMap, start, end)
    weightedScore += score * guide.weight
    totalWeight += guide.weight
  }
  for (const guide of guides.horizontal) {
    const start = addLocalVector(origin, u, 0, v, guide.offset)
    const end = addLocalVector(origin, u, localSpanX, v, guide.offset)
    const score = scoreDistanceSegment(distanceMap, start, end)
    weightedScore += score * guide.weight
    totalWeight += guide.weight
  }
  return weightedScore / Math.max(1, totalWeight)
}

function addLocalVector(origin: PixelPoint, u: PixelPoint, uDistance: number, v: PixelPoint, vDistance: number): PixelPoint {
  return {
    x: origin.x + u.x * uDistance + v.x * vDistance,
    y: origin.y + u.y * uDistance + v.y * vDistance,
  }
}

function scoreDistanceSegment(distanceMap: DarkDistanceMap, start: PixelPoint, end: PixelPoint): number {
  const length = Math.max(1, distance(start, end))
  const sampleCount = Math.round(clampNumber(length / 18, 14, 40))
  const maxDistance = 5
  let total = 0
  let coverage = 0
  let used = 0
  for (let index = 0; index < sampleCount; index += 1) {
    const t = sampleCount === 1 ? 0.5 : index / (sampleCount - 1)
    const x = start.x + (end.x - start.x) * t
    const y = start.y + (end.y - start.y) * t
    if (x < 0 || y < 0 || x >= distanceMap.width || y >= distanceMap.height) continue
    const currentDistance = darkDistanceAt(distanceMap, x, y)
    const normalized = clampNumber(1 - currentDistance / maxDistance, 0, 1)
    total += normalized
    if (currentDistance <= 2.1) coverage += 1
    used += 1
  }
  if (used === 0) return 0
  return (total / used) * 0.72 + (coverage / used) * 0.28
}

function averageNumber(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function pixelRectFromCorners(corners: [PixelPoint, PixelPoint, PixelPoint, PixelPoint]): PixelRect {
  const [topLeft, topRight, bottomRight, bottomLeft] = corners
  return {
    left: (topLeft.x + bottomLeft.x) / 2,
    top: (topLeft.y + topRight.y) / 2,
    right: (topRight.x + bottomRight.x) / 2,
    bottom: (bottomLeft.y + bottomRight.y) / 2,
  }
}

function pixelRectToCorners(rect: PixelRect): [PixelPoint, PixelPoint, PixelPoint, PixelPoint] {
  return [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ]
}

function scoreTemplateGridDistanceFitRect(
  distanceMap: DarkDistanceMap,
  guides: GridFitGuides,
  candidate: PixelRect,
): number {
  const width = Math.max(1, candidate.right - candidate.left)
  const height = Math.max(1, candidate.bottom - candidate.top)
  let weightedScore = 0
  let totalWeight = 0
  for (const guide of guides.vertical) {
    const x = candidate.left + width * guide.ratio
    const score = scoreDistanceLine(distanceMap, 'vertical', x, candidate.top, candidate.bottom)
    weightedScore += score * guide.weight
    totalWeight += guide.weight
  }
  for (const guide of guides.horizontal) {
    const y = candidate.top + height * guide.ratio
    const score = scoreDistanceLine(distanceMap, 'horizontal', y, candidate.left, candidate.right)
    weightedScore += score * guide.weight
    totalWeight += guide.weight
  }
  return weightedScore / Math.max(1, totalWeight)
}

function scoreDistanceLine(
  distanceMap: DarkDistanceMap,
  orientation: 'horizontal' | 'vertical',
  fixedPosition: number,
  startPosition: number,
  endPosition: number,
): number {
  const start = Math.min(startPosition, endPosition)
  const end = Math.max(startPosition, endPosition)
  const length = Math.max(1, end - start)
  const sampleCount = Math.round(clampNumber(length / 85, 12, 32))
  const maxDistance = 5.5
  let total = 0
  let coverage = 0
  for (let index = 0; index < sampleCount; index += 1) {
    const t = sampleCount === 1 ? 0.5 : index / (sampleCount - 1)
    const moving = start + length * t
    const x = orientation === 'vertical' ? fixedPosition : moving
    const y = orientation === 'vertical' ? moving : fixedPosition
    const distance = darkDistanceAt(distanceMap, x, y)
    const normalized = clampNumber(1 - distance / maxDistance, 0, 1)
    total += normalized
    if (distance <= 2.25) coverage += 1
  }
  const average = total / sampleCount
  return average * 0.68 + (coverage / sampleCount) * 0.32
}

function darkDistanceAt(distanceMap: DarkDistanceMap, x: number, y: number): number {
  const clampedX = Math.round(clampNumber(x, 0, distanceMap.width - 1))
  const clampedY = Math.round(clampNumber(y, 0, distanceMap.height - 1))
  return distanceMap.distances[clampedY * distanceMap.width + clampedX] / distanceMap.unit
}

function buildDarkDistanceMap(image: ImageData): DarkDistanceMap {
  const width = image.width
  const height = image.height
  const distances = new Uint16Array(width * height)
  const maxDistance = 32000
  const unit = 3
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width
    for (let x = 0; x < width; x += 1) {
      distances[rowOffset + x] = isDarkPixel(image, x, y) ? 0 : maxDistance
    }
  }
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width
    for (let x = 0; x < width; x += 1) {
      const index = rowOffset + x
      let value = distances[index]
      if (x > 0) value = Math.min(value, distances[index - 1] + 3)
      if (y > 0) {
        const up = index - width
        value = Math.min(value, distances[up] + 3)
        if (x > 0) value = Math.min(value, distances[up - 1] + 4)
        if (x < width - 1) value = Math.min(value, distances[up + 1] + 4)
      }
      distances[index] = value
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    const rowOffset = y * width
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = rowOffset + x
      let value = distances[index]
      if (x < width - 1) value = Math.min(value, distances[index + 1] + 3)
      if (y < height - 1) {
        const down = index + width
        value = Math.min(value, distances[down] + 3)
        if (x > 0) value = Math.min(value, distances[down - 1] + 4)
        if (x < width - 1) value = Math.min(value, distances[down + 1] + 4)
      }
      distances[index] = value
    }
  }
  return { width, height, distances, unit }
}

function segmentedVerticalSupport(image: ImageData, x: number, yStart: number, yEnd: number, radius: number): number {
  const start = Math.max(0, Math.round(Math.min(yStart, yEnd)))
  const end = Math.min(image.height - 1, Math.round(Math.max(yStart, yEnd)))
  const length = Math.max(1, end - start + 1)
  const segments = Math.max(6, Math.min(24, Math.round(length / 90)))
  let coverage = 0
  let average = 0
  for (let index = 0; index < segments; index += 1) {
    const segmentStart = start + Math.round(length * (index / segments))
    const segmentEnd = start + Math.round(length * ((index + 1) / segments)) - 1
    const ratio = darkRatioInVerticalBand(image, x, segmentStart, segmentEnd, radius)
    const normalized = clampNumber(ratio / 0.1, 0, 1)
    average += normalized
    if (ratio >= 0.018) coverage += 1
  }
  return (average / segments) * 0.42 + (coverage / segments) * 0.58
}

function segmentedHorizontalSupport(image: ImageData, y: number, xStart: number, xEnd: number, radius: number): number {
  const start = Math.max(0, Math.round(Math.min(xStart, xEnd)))
  const end = Math.min(image.width - 1, Math.round(Math.max(xStart, xEnd)))
  const length = Math.max(1, end - start + 1)
  const segments = Math.max(6, Math.min(24, Math.round(length / 90)))
  let coverage = 0
  let average = 0
  for (let index = 0; index < segments; index += 1) {
    const segmentStart = start + Math.round(length * (index / segments))
    const segmentEnd = start + Math.round(length * ((index + 1) / segments)) - 1
    const ratio = darkRatioInHorizontalBand(image, y, segmentStart, segmentEnd, radius)
    const normalized = clampNumber(ratio / 0.1, 0, 1)
    average += normalized
    if (ratio >= 0.018) coverage += 1
  }
  return (average / segments) * 0.42 + (coverage / segments) * 0.58
}

function boundaryOutsidePenalty(
  image: ImageData,
  candidate: { left: number; top: number; right: number; bottom: number },
): number {
  const height = Math.max(1, candidate.bottom - candidate.top)
  const width = Math.max(1, candidate.right - candidate.left)
  const verticalProbe = clampNumber(height * 0.08, 70, 170)
  const horizontalProbe = clampNumber(width * 0.06, 80, 180)
  const topOutsideStart = candidate.top - verticalProbe
  const topOutsideEnd = candidate.top - 8
  const bottomOutsideStart = candidate.bottom + 8
  const bottomOutsideEnd = candidate.bottom + verticalProbe
  const leftOutsideStart = candidate.left - horizontalProbe
  const leftOutsideEnd = candidate.left - 8
  const rightOutsideStart = candidate.right + 8
  const rightOutsideEnd = candidate.right + horizontalProbe
  const verticalOvershoot = Math.max(
    darkRatioInVerticalBand(image, candidate.left, topOutsideStart, topOutsideEnd, 1),
    darkRatioInVerticalBand(image, candidate.right, topOutsideStart, topOutsideEnd, 1),
    darkRatioInVerticalBand(image, candidate.left, bottomOutsideStart, bottomOutsideEnd, 1),
    darkRatioInVerticalBand(image, candidate.right, bottomOutsideStart, bottomOutsideEnd, 1),
  )
  const horizontalOvershoot = Math.max(
    darkRatioInHorizontalBand(image, candidate.top, leftOutsideStart, leftOutsideEnd, 1),
    darkRatioInHorizontalBand(image, candidate.bottom, leftOutsideStart, leftOutsideEnd, 1),
    darkRatioInHorizontalBand(image, candidate.top, rightOutsideStart, rightOutsideEnd, 1),
    darkRatioInHorizontalBand(image, candidate.bottom, rightOutsideStart, rightOutsideEnd, 1),
  )
  return Math.max(0, verticalOvershoot - 0.035) * 0.25 + Math.max(0, horizontalOvershoot - 0.035) * 0.2
}

function stabilizeCornerSideExtents(
  image: ImageData,
  rect: { left: number; top: number; right: number; bottom: number },
  topLeft: PixelPoint,
  topRight: PixelPoint,
  bottomRight: PixelPoint,
  bottomLeft: PixelPoint,
  expectedWidth: number,
): [PixelPoint, PixelPoint, PixelPoint, PixelPoint] {
  let nextTopLeft = topLeft
  let nextTopRight = topRight
  let nextBottomRight = bottomRight
  let nextBottomLeft = bottomLeft
  const sideDeltaLimit = clampNumber(expectedWidth * 0.018, 18, 42)
  const leftDelta = topLeft.x - bottomLeft.x
  const rightDelta = topRight.x - bottomRight.x
  if (Math.abs(leftDelta) > sideDeltaLimit && Math.abs(rightDelta) < sideDeltaLimit * 0.75) {
    const topProjectedLeft = topRight.x - expectedWidth
    const bottomProjectedLeft = bottomRight.x - expectedWidth
    const topDeviation = Math.abs(topLeft.x - topProjectedLeft)
    const bottomDeviation = Math.abs(bottomLeft.x - bottomProjectedLeft)
    const suspect = moreSuspiciousCorner(
      topLeft,
      bottomLeft,
      topDeviation,
      bottomDeviation,
      image,
      rect,
      'left',
    )
    if (suspect === 'top') {
      nextTopLeft = { ...topLeft, x: topProjectedLeft }
    } else if (suspect === 'bottom') {
      nextBottomLeft = { ...bottomLeft, x: bottomProjectedLeft }
    }
  }
  if (Math.abs(rightDelta) > sideDeltaLimit && Math.abs(leftDelta) < sideDeltaLimit * 0.75) {
    const topProjectedRight = topLeft.x + expectedWidth
    const bottomProjectedRight = bottomLeft.x + expectedWidth
    const topDeviation = Math.abs(topRight.x - topProjectedRight)
    const bottomDeviation = Math.abs(bottomRight.x - bottomProjectedRight)
    const suspect = moreSuspiciousCorner(
      topRight,
      bottomRight,
      topDeviation,
      bottomDeviation,
      image,
      rect,
      'right',
    )
    if (suspect === 'top') {
      nextTopRight = { ...topRight, x: topProjectedRight }
    } else if (suspect === 'bottom') {
      nextBottomRight = { ...bottomRight, x: bottomProjectedRight }
    }
  }
  return [nextTopLeft, nextTopRight, nextBottomRight, nextBottomLeft]
}

function moreSuspiciousCorner(
  top: PixelPoint,
  bottom: PixelPoint,
  topDeviation: number,
  bottomDeviation: number,
  image: ImageData,
  rect: { left: number; top: number; right: number; bottom: number },
  horizontalSide: 'left' | 'right',
): 'top' | 'bottom' | null {
  const deviationGap = Math.abs(topDeviation - bottomDeviation)
  const minimumGap = clampNumber((rect.right - rect.left) * 0.01, 10, 24)
  if (deviationGap < minimumGap) return null

  const topScore = cornerGuideSupportScore(image, top, rect, horizontalSide, 'top')
  const bottomScore = cornerGuideSupportScore(image, bottom, rect, horizontalSide, 'bottom')
  if (topDeviation > bottomDeviation && topScore <= bottomScore + 0.02) return 'top'
  if (bottomDeviation > topDeviation && bottomScore <= topScore + 0.02) return 'bottom'
  return null
}

function refineHorizontalSpanCorner(
  image: ImageData,
  point: PixelPoint,
  rect: { left: number; top: number; right: number; bottom: number },
  horizontalSide: 'left' | 'right',
  verticalSide: 'top' | 'bottom',
  horizontalLine: ProjectedLineResult,
): PixelPoint {
  const rectWidth = Math.max(1, rect.right - rect.left)
  const rectHeight = Math.max(1, rect.bottom - rect.top)
  const horizontalArm = Math.round(clampNumber(rectWidth * 0.08, 70, 180))
  const verticalArm = Math.round(clampNumber(rectHeight * 0.08, 90, 200))
  const horizontalRange = horizontalSide === 'left'
    ? { start: point.x - 4, end: point.x + horizontalArm }
    : { start: point.x - horizontalArm, end: point.x + 4 }
  const yGroups = localSupportGroups(
    horizontalLine.group.start - 3,
    horizontalLine.group.end + 3,
    y => darkRatioInHorizontalBand(image, y, horizontalRange.start, horizontalRange.end, 2),
    0.1,
  )
  const yGroup = bestLocalSupportGroup(yGroups, point.y)
  const refinedY = yGroup ? Math.round((yGroup.start + yGroup.end) / 2) : point.y
  const verticalRange = verticalSide === 'top'
    ? { start: refinedY - 4, end: refinedY + verticalArm }
    : { start: refinedY - verticalArm, end: refinedY + 4 }
  const xSearchRadius = Math.round(clampNumber(rectWidth * 0.006, 8, 16))
  const xGroups = localSupportGroups(
    point.x - xSearchRadius,
    point.x + xSearchRadius,
    x => darkRatioInVerticalBand(image, x, verticalRange.start, verticalRange.end, 1),
    0.08,
  )
  const xGroup = bestLocalSupportGroup(xGroups, point.x)
  const refinedX = xGroup ? Math.round((xGroup.start + xGroup.end) / 2) : point.x
  const candidate = { x: refinedX, y: refinedY }
  if (candidate.x === point.x && candidate.y === point.y) return point
  const baseScore = cornerGuideSupportScore(image, point, rect, horizontalSide, verticalSide)
  const candidateScore = cornerGuideSupportScore(image, candidate, rect, horizontalSide, verticalSide)
  const scoreImprovement = candidateScore - baseScore
  if (scoreImprovement >= 0.012) return candidate
  const minorAdjustment = Math.abs(candidate.x - point.x) <= 4 && Math.abs(candidate.y - point.y) <= 2
  if (minorAdjustment && scoreImprovement >= -0.004) return candidate
  return point
}

function cornerGuideSupportScore(
  image: ImageData,
  point: PixelPoint,
  rect: { left: number; top: number; right: number; bottom: number },
  horizontalSide: 'left' | 'right',
  verticalSide: 'top' | 'bottom',
): number {
  const rectWidth = Math.max(1, rect.right - rect.left)
  const rectHeight = Math.max(1, rect.bottom - rect.top)
  const horizontalArm = Math.round(clampNumber(rectWidth * 0.08, 70, 180))
  const verticalArm = Math.round(clampNumber(rectHeight * 0.08, 90, 200))
  const horizontalRange = horizontalSide === 'left'
    ? { start: point.x - 4, end: point.x + horizontalArm }
    : { start: point.x - horizontalArm, end: point.x + 4 }
  const verticalRange = verticalSide === 'top'
    ? { start: point.y - 4, end: point.y + verticalArm }
    : { start: point.y - verticalArm, end: point.y + 4 }
  const horizontalSupport = darkRatioInHorizontalBand(image, point.y, horizontalRange.start, horizontalRange.end, 2)
  const verticalSupport = darkRatioInVerticalBand(image, point.x, verticalRange.start, verticalRange.end, 2)
  return horizontalSupport * 0.62 + verticalSupport * 0.38
}

function bestHorizontalSideSpan(
  image: ImageData,
  line: ProjectedLineResult,
  anchorPosition: number,
  searchLeft: number,
  searchRight: number,
  expectedLeft: number,
  expectedRight: number,
  maxGap: number,
  referenceSpan?: { start: number; end: number } | null,
): ({ y: number } & NonNullable<ReturnType<typeof horizontalLineEndpoints>>) | null {
  const expectedWidth = Math.max(1, expectedRight - expectedLeft)
  let best: ({ y: number; score: number } & NonNullable<ReturnType<typeof horizontalLineEndpoints>>) | null = null
  for (let y = line.group.start; y <= line.group.end; y += 1) {
    const span = horizontalLineEndpoints(image, y, searchLeft, searchRight, expectedLeft, expectedRight, maxGap)
    if (!span) continue
    const width = span.end - span.start
    if (width < expectedWidth * 0.35) continue
    const widthRatio = clampNumber(width / expectedWidth, 0, 1.2)
    const endpointDistance = (Math.abs(span.start - expectedLeft) + Math.abs(span.end - expectedRight)) / expectedWidth
    const referenceDistance = referenceSpan
      ? (Math.abs(span.start - referenceSpan.start) + Math.abs(span.end - referenceSpan.end)) / expectedWidth
      : 0
    const anchorDistance = Math.abs(y - anchorPosition) / Math.max(1, line.group.end - line.group.start + 1)
    const outerBias = ((expectedLeft - span.start) + (span.end - expectedRight)) / expectedWidth
    const score = widthRatio * 1.35 + span.ratio * 0.25 + outerBias * 1.1 - endpointDistance * 0.55 - anchorDistance * 0.25 - referenceDistance * 1.2
    if (!best || score > best.score) best = { ...span, y, score }
  }
  return best
}

type PixelPoint = {
  x: number
  y: number
}

function horizontalLineEndpoints(
  image: ImageData,
  y: number,
  searchLeft: number,
  searchRight: number,
  expectedLeft: number,
  expectedRight: number,
  maxGap: number,
): { start: number; end: number; ratio: number } | null {
  const yCenter = Math.round(clampNumber(y, 0, image.height - 1))
  const yRadius = 2
  const groups: Array<{ start: number; end: number; darkCount: number; sampleCount: number }> = []
  let current: { start: number; end: number; darkCount: number; sampleCount: number; lastHit: number } | null = null
  for (let x = searchLeft; x <= searchRight; x += 1) {
    const ratio = darkPixelsInVerticalBand(image, x, yCenter - yRadius, yCenter + yRadius) / (yRadius * 2 + 1)
    if (ratio >= MIN_HORIZONTAL_SPAN_RATIO) {
      if (!current || x - current.lastHit > maxGap) {
        if (current) groups.push(current)
        current = { start: x, end: x, darkCount: ratio, sampleCount: 1, lastHit: x }
      } else {
        current.end = x
        current.darkCount += ratio
        current.sampleCount += 1
        current.lastHit = x
      }
    }
  }
  if (current) groups.push(current)
  const expectedWidth = Math.max(1, expectedRight - expectedLeft)
  const endpointWindow = expectedWidth * 0.11
  const leftGroups = groups.filter(group => group.start <= expectedLeft + endpointWindow && group.end >= expectedLeft - endpointWindow)
  const rightGroups = groups.filter(group => group.start <= expectedRight + endpointWindow && group.end >= expectedRight - endpointWindow)
  if (leftGroups.length === 0 || rightGroups.length === 0) return null
  const left = Math.min(...leftGroups.map(group => group.start))
  const right = Math.max(...rightGroups.map(group => group.end))
  if (right <= left) return null
  const usedGroups = groups.filter(group => group.end >= left && group.start <= right)
  const darkCount = usedGroups.reduce((sum, group) => sum + group.darkCount, 0)
  const sampleCount = usedGroups.reduce((sum, group) => sum + group.sampleCount, 0)
  return {
    start: left,
    end: right,
    ratio: darkCount / Math.max(1, sampleCount),
  }
}

function bestProjectedLine(
  expectedPosition: number,
  searchWindow: number,
  span: number,
  countDarkPixels: (position: number) => number,
): ProjectedLineResult | null {
  const start = Math.max(0, expectedPosition - searchWindow)
  const end = expectedPosition + searchWindow
  const groups: ProjectedLineGroup[] = []
  let current: ProjectedLineGroup | null = null
  for (let position = start; position <= end; position += 1) {
    const ratio = countDarkPixels(position) / Math.max(1, span)
    if (ratio >= MIN_PROJECTED_LINE_RATIO) {
      if (!current) {
        current = {
          start: position,
          end: position,
          bestPosition: position,
          bestRatio: ratio,
        }
      } else {
        current.end = position
        if (ratio > current.bestRatio) {
          current.bestPosition = position
          current.bestRatio = ratio
        }
      }
      continue
    }
    if (current) {
      groups.push(current)
      current = null
    }
  }
  if (current) groups.push(current)
  const closest = groups.reduce<ProjectedLineGroup | null>((best, group) => {
    if (!best) return group
    const distance = distanceToRange(expectedPosition, group.start, group.end)
    const bestDistance = distanceToRange(expectedPosition, best.start, best.end)
    if (distance !== bestDistance) return distance < bestDistance ? group : best
    return group.bestRatio > best.bestRatio ? group : best
  }, null)
  return closest
    ? {
        position: projectedLinePositionForExpected(closest, expectedPosition),
        ratio: closest.bestRatio,
        group: closest,
      }
    : null
}

type ProjectedLineResult = {
  position: number
  ratio: number
  group: ProjectedLineGroup
}

type ProjectedLineGroup = {
  start: number
  end: number
  bestPosition: number
  bestRatio: number
}

function distanceToRange(value: number, start: number, end: number): number {
  if (value < start) return start - value
  if (value > end) return value - end
  return 0
}

function projectedLinePositionForExpected(group: ProjectedLineGroup, expectedPosition: number): number {
  void expectedPosition
  return Math.round(group.bestPosition)
}

function localSupportGroups(
  startPosition: number,
  endPosition: number,
  supportRatioAt: (position: number) => number,
  minRatio: number,
): ProjectedLineGroup[] {
  const start = Math.round(startPosition)
  const end = Math.round(endPosition)
  const groups: ProjectedLineGroup[] = []
  let current: ProjectedLineGroup | null = null
  for (let position = start; position <= end; position += 1) {
    const ratio = supportRatioAt(position)
    if (ratio >= minRatio) {
      if (!current) {
        current = {
          start: position,
          end: position,
          bestPosition: position,
          bestRatio: ratio,
        }
      } else {
        current.end = position
        if (ratio > current.bestRatio) {
          current.bestPosition = position
          current.bestRatio = ratio
        }
      }
      continue
    }
    if (current) {
      groups.push(current)
      current = null
    }
  }
  if (current) groups.push(current)
  return groups
}

function bestLocalSupportGroup(groups: ProjectedLineGroup[], anchorPosition: number): ProjectedLineGroup | null {
  return groups.reduce<ProjectedLineGroup | null>((best, group) => {
    if (!best) return group
    const distance = distanceToRange(anchorPosition, group.start, group.end)
    const bestDistance = distanceToRange(anchorPosition, best.start, best.end)
    if (distance !== bestDistance) return distance < bestDistance ? group : best
    return group.bestRatio > best.bestRatio ? group : best
  }, null)
}

function darkPixelsInRow(image: ImageData, y: number, xStart: number, xEnd: number): number {
  if (y < 0 || y >= image.height) return 0
  let count = 0
  const start = Math.max(0, Math.min(image.width - 1, xStart))
  const end = Math.max(0, Math.min(image.width - 1, xEnd))
  for (let x = start; x <= end; x += 1) {
    if (isDarkPixel(image, x, y)) count += 1
  }
  return count
}

function darkPixelsInColumn(image: ImageData, x: number, yStart: number, yEnd: number): number {
  if (x < 0 || x >= image.width) return 0
  let count = 0
  const start = Math.max(0, Math.min(image.height - 1, yStart))
  const end = Math.max(0, Math.min(image.height - 1, yEnd))
  for (let y = start; y <= end; y += 1) {
    if (isDarkPixel(image, x, y)) count += 1
  }
  return count
}

function darkPixelsInVerticalBand(image: ImageData, x: number, yStart: number, yEnd: number): number {
  return darkPixelsInColumn(image, x, yStart, yEnd)
}

function darkRatioInHorizontalBand(image: ImageData, y: number, xStart: number, xEnd: number, radius: number): number {
  const center = Math.round(clampNumber(y, 0, image.height - 1))
  const top = Math.max(0, center - radius)
  const bottom = Math.min(image.height - 1, center + radius)
  const start = Math.max(0, Math.min(image.width - 1, Math.round(Math.min(xStart, xEnd))))
  const end = Math.max(0, Math.min(image.width - 1, Math.round(Math.max(xStart, xEnd))))
  let count = 0
  for (let currentY = top; currentY <= bottom; currentY += 1) {
    count += darkPixelsInRow(image, currentY, start, end)
  }
  return count / Math.max(1, (bottom - top + 1) * (end - start + 1))
}

function darkRatioInVerticalBand(image: ImageData, x: number, yStart: number, yEnd: number, radius: number): number {
  const center = Math.round(clampNumber(x, 0, image.width - 1))
  const left = Math.max(0, center - radius)
  const right = Math.min(image.width - 1, center + radius)
  const start = Math.max(0, Math.min(image.height - 1, Math.round(Math.min(yStart, yEnd))))
  const end = Math.max(0, Math.min(image.height - 1, Math.round(Math.max(yStart, yEnd))))
  let count = 0
  for (let currentX = left; currentX <= right; currentX += 1) {
    count += darkPixelsInColumn(image, currentX, start, end)
  }
  return count / Math.max(1, (right - left + 1) * (end - start + 1))
}

function isDarkPixel(image: ImageData, x: number, y: number): boolean {
  const offset = (y * image.width + x) * 4
  if (image.data[offset + 3] < 32) return false
  const luminance = image.data[offset] * 0.299 + image.data[offset + 1] * 0.587 + image.data[offset + 2] * 0.114
  return luminance < 140
}

function bestHorizontalLine(lines: DetectedLine[], expectedY: number, expectedLeft: number, expectedRight: number, imageHeight: number): ScoredLine | null {
  const tolerance = Math.max(imageHeight * 0.035, Math.abs(expectedRight - expectedLeft) * 0.035, 24)
  return bestLine(lines, line => {
    const y = lineYAt(line, (expectedLeft + expectedRight) / 2) ?? line.centerY
    const distanceScore = Math.abs(y - expectedY) / tolerance
    const overlap = rangeOverlap(Math.min(line.x1, line.x2), Math.max(line.x1, line.x2), expectedLeft, expectedRight)
    const expectedWidth = Math.max(1, expectedRight - expectedLeft)
    const overlapRatio = overlap / expectedWidth
    const coverageScore = overlapRatio >= 0.25 ? 0 : (0.25 - overlapRatio) * 5
    return distanceScore + coverageScore + line.angleDeg / 35
  })
}

function bestVerticalLine(lines: DetectedLine[], expectedX: number, expectedTop: number, expectedBottom: number, imageWidth: number): ScoredLine | null {
  const tolerance = Math.max(imageWidth * 0.035, Math.abs(expectedBottom - expectedTop) * 0.035, 24)
  return bestLine(lines, line => {
    const x = lineXAt(line, (expectedTop + expectedBottom) / 2) ?? line.centerX
    const distanceScore = Math.abs(x - expectedX) / tolerance
    const overlap = rangeOverlap(Math.min(line.y1, line.y2), Math.max(line.y1, line.y2), expectedTop, expectedBottom)
    const expectedHeight = Math.max(1, expectedBottom - expectedTop)
    const overlapRatio = overlap / expectedHeight
    const coverageScore = overlapRatio >= 0.25 ? 0 : (0.25 - overlapRatio) * 5
    return distanceScore + coverageScore + Math.abs(90 - line.angleDeg) / 35
  })
}

function bestLine(lines: DetectedLine[], score: (line: DetectedLine) => number): ScoredLine | null {
  let best: ScoredLine | null = null
  for (const line of lines) {
    const current = { line, score: score(line) }
    if (!best || current.score < best.score) best = current
  }
  return best
}

function normalizedAxisAngleDeg(angleDeg: number): number {
  let angle = Math.abs(angleDeg)
  while (angle > 180) angle -= 180
  if (angle > 90) angle = 180 - angle
  return angle
}

function lineYAt(line: DetectedLine, x: number): number | null {
  const dx = line.x2 - line.x1
  if (Math.abs(dx) < 1e-6) return null
  return line.y1 + (line.y2 - line.y1) * ((x - line.x1) / dx)
}

function lineXAt(line: DetectedLine, y: number): number | null {
  const dy = line.y2 - line.y1
  if (Math.abs(dy) < 1e-6) return null
  return line.x1 + (line.x2 - line.x1) * ((y - line.y1) / dy)
}

function rangeOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart))
}

function intersectLines(a: DetectedLine, b: DetectedLine): { x: number; y: number } | null {
  const x1 = a.x1
  const y1 = a.y1
  const x2 = a.x2
  const y2 = a.y2
  const x3 = b.x1
  const y3 = b.y1
  const x4 = b.x2
  const y4 = b.y2
  const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
  if (Math.abs(denominator) < 1e-6) return null
  return {
    x: ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / denominator,
    y: ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / denominator,
  }
}

function normalizePixelPoint(point: { x: number; y: number }, width: number, height: number): NormalizedPoint {
  return {
    x: clampNumber(point.x / Math.max(1, width), 0, 1),
    y: clampNumber(point.y / Math.max(1, height), 0, 1),
  }
}

function isPlausibleCalibrationQuad(points: NormalizedPoint[]): boolean {
  if (points.length !== 4) return false
  const [tl, tr, br, bl] = points
  const topWidth = distance(tl, tr)
  const bottomWidth = distance(bl, br)
  const leftHeight = distance(tl, bl)
  const rightHeight = distance(tr, br)
  const area = polygonArea(points)
  return area > 0.05 &&
    topWidth > 0.15 &&
    bottomWidth > 0.15 &&
    leftHeight > 0.15 &&
    rightHeight > 0.15 &&
    tl.x < tr.x &&
    bl.x < br.x &&
    tl.y < bl.y &&
    tr.y < br.y
}

function distance(a: NormalizedPoint, b: NormalizedPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function polygonArea(points: NormalizedPoint[]): number {
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    area += current.x * next.y - next.x * current.y
  }
  return Math.abs(area) / 2
}

