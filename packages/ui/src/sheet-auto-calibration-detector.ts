import { type NormalizedPoint, type SheetCalibrationPointPair, type SheetTemplate } from '@xsheet-remap/core'
import { calibrationTargetRectForTemplate, defaultCalibrationPoints, loadImage } from './sheetImages'
import { clampNumber } from './sheetInteraction'
import opencvScriptUrl from '@techstark/opencv-js/dist/opencv.js?url'
import { ProjectedLineResult, bestHorizontalLine, bestProjectedLine, bestVerticalLine, buildDarkPixelIntegralImage, darkPixelsInIntegralRect, intersectLines, isPlausibleCalibrationQuad, normalizePixelPoint, normalizedAxisAngleDeg } from './sheet-auto-calibration-projection'
import { fitTemplateGridCalibration } from './sheet-auto-calibration-grid-fit'
import { bestHorizontalSideSpan, refineHorizontalSpanCorner, stabilizeCornerSideExtents } from './sheet-auto-calibration-corners'
import type { AutoCalibrationDebugOverlay, AutoCalibrationLocalCornerDebug, AutoCalibrationResult, DetectedLine, PixelPoint } from './sheet-auto-calibration-types'

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

const MAX_AXIS_ANGLE_DEG = 12

const MIN_LINE_SCORE = 4.5

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
  const darkIntegral = buildDarkPixelIntegralImage(data)
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
    y => darkPixelsInIntegralRect(darkIntegral, left, y, right, y),
  )
  const projectedBottom = bestProjectedLine(
    bottom,
    horizontalWindow,
    rectWidth,
    y => darkPixelsInIntegralRect(darkIntegral, left, y, right, y),
  )
  const projectedLeft = bestProjectedLine(
    left,
    verticalWindow,
    rectHeight,
    x => darkPixelsInIntegralRect(darkIntegral, x, top, x, bottom),
  )
  const projectedRight = bestProjectedLine(
    right,
    verticalWindow,
    rectHeight,
    x => darkPixelsInIntegralRect(darkIntegral, x, top, x, bottom),
  )
  if (!projectedTop || !projectedBottom || !projectedLeft || !projectedRight) return null
  const spanCorners = detectHorizontalSpanCorners(data, rect, projectedTop, projectedBottom)
  const projectionPixelCorners = spanCorners ?? [
    { x: projectedLeft.position, y: projectedTop.position },
    { x: projectedRight.position, y: projectedTop.position },
    { x: projectedRight.position, y: projectedBottom.position },
    { x: projectedLeft.position, y: projectedBottom.position },
  ]
  const gridFit = fitTemplateGridCalibration(data, rect, template, projectionPixelCorners, darkIntegral)
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
