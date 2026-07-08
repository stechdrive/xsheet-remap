import type { NormalizedPoint, SheetTemplate } from '@xsheet-remap/core'
import { type AutoCalibrationLocalCornerDebug, detectSheetCalibrationPoints } from './sheetAutoCalibration'
import { defaultCalibrationPoints, loadImage } from './sheetImages'

type CornerId = 'tl' | 'tr' | 'br' | 'bl'

type PixelPoint = {
  x: number
  y: number
}

type CornerDiagnostic = {
  corner: CornerId
  pointPx: PixelPoint
  support: number
  horizontalSupport: number
  verticalSupport: number
  horizontalOffsetPx: number
  verticalOffsetPx: number
  offsetPx: number
  localMatch: AutoCalibrationLocalCornerDebug | null
}

export type SheetCalibrationDiagnostic = {
  path: string
  name: string
  imageSize: { width: number; height: number }
  detected: boolean
  method: string | null
  confidence: number
  detectedLineCount: number
  score: number
  rating: 'pass' | 'review' | 'fail'
  reasons: string[]
  quad: {
    topWidthPx: number
    bottomWidthPx: number
    leftHeightPx: number
    rightHeightPx: number
    widthDisagreementRatio: number
    heightDisagreementRatio: number
    maxIdealDeltaPx: number
  } | null
  corners: CornerDiagnostic[]
  images: {
    montage: string | null
    corners: Record<CornerId, string | null>
  }
}

export async function evaluateSheetCalibrationDiagnostic(
  input: { path: string; name: string; imageUrl: string },
  template: SheetTemplate,
): Promise<SheetCalibrationDiagnostic> {
  const image = await loadImage(input.imageUrl)
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  const fallback: SheetCalibrationDiagnostic = {
    path: input.path,
    name: input.name,
    imageSize: { width, height },
    detected: false,
    method: null,
    confidence: 0,
    detectedLineCount: 0,
    score: 0,
    rating: 'fail',
    reasons: ['自動検出できませんでした。'],
    quad: null,
    corners: [],
    images: {
      montage: null,
      corners: { tl: null, tr: null, br: null, bl: null },
    },
  }
  if (width <= 0 || height <= 0) return fallback

  const sourceCanvas = document.createElement('canvas')
  sourceCanvas.width = width
  sourceCanvas.height = height
  const context = sourceCanvas.getContext('2d', { willReadFrequently: true })
  if (!context) return fallback
  context.drawImage(image, 0, 0, width, height)

  const result = await detectSheetCalibrationPoints(input.imageUrl, template)
  if (!result) return fallback

  const imageData = context.getImageData(0, 0, width, height)
  const sourcePoints = result.points.map(point => normalizedToPixel(point.source, width, height))
  const targetPoints = defaultCalibrationPoints(template).map(point => normalizedToPixel(point.target, width, height))
  const localMatches = result.debugOverlay.localCornerMatches ?? []
  const corners = cornerIds.map((corner, index) => evaluateCorner(
    imageData,
    corner,
    sourcePoints[index],
    localMatches.find(match => match.corner === corner) ?? null,
  ))
  const quad = quadMetrics(sourcePoints, targetPoints)
  const averageSupport = average(corners.map(corner => corner.support))
  const averageUnacceptedGain = average(corners.map(corner => corner.localMatch?.accepted ? 0 : Math.max(0, corner.localMatch?.rawGain ?? 0)))
  const supportScore = clamp((averageSupport - 0.035) / 0.16, 0, 1)
  const localMatchScore = clamp(1 - averageUnacceptedGain / 0.05, 0, 1)
  const consistencyScore = quad
    ? clamp(1 - Math.max(quad.widthDisagreementRatio, quad.heightDisagreementRatio) / 0.035, 0, 1)
    : 0
  const score = Math.round(100 * (
    result.confidence * 0.42 +
    supportScore * 0.28 +
    localMatchScore * 0.12 +
    consistencyScore * 0.18
  ))
  const reasons = diagnosticReasons(result.confidence, corners, quad)
  const rating = score >= 76 && reasons.length === 0
    ? 'pass'
    : score >= 54
      ? 'review'
      : 'fail'
  const cornerCanvases = Object.fromEntries(cornerIds.map((corner, index) => [
    corner,
    makeCornerCropCanvas(sourceCanvas, corner, sourcePoints[index], corners[index]),
  ])) as Record<CornerId, HTMLCanvasElement>

  return {
    path: input.path,
    name: input.name,
    imageSize: { width, height },
    detected: true,
    method: result.debugOverlay.method,
    confidence: result.confidence,
    detectedLineCount: result.detectedLineCount,
    score,
    rating,
    reasons,
    quad,
    corners,
    images: {
      montage: makeMontageDataUrl(cornerCanvases, input.name, score, rating),
      corners: {
        tl: cornerCanvases.tl.toDataURL('image/png'),
        tr: cornerCanvases.tr.toDataURL('image/png'),
        br: cornerCanvases.br.toDataURL('image/png'),
        bl: cornerCanvases.bl.toDataURL('image/png'),
      },
    },
  }
}

const cornerIds: CornerId[] = ['tl', 'tr', 'br', 'bl']

function normalizedToPixel(point: NormalizedPoint, width: number, height: number): PixelPoint {
  return {
    x: point.x * width,
    y: point.y * height,
  }
}

function evaluateCorner(
  image: ImageData,
  corner: CornerId,
  point: PixelPoint,
  localMatch: AutoCalibrationLocalCornerDebug | null,
): CornerDiagnostic {
  const width = image.width
  const height = image.height
  const rectSpan = Math.min(width, height)
  const horizontalArm = Math.round(clamp(rectSpan * 0.075, 90, 210))
  const verticalArm = Math.round(clamp(rectSpan * 0.09, 110, 250))
  const search = Math.round(clamp(rectSpan * 0.009, 10, 24))
  const x = Math.round(point.x)
  const y = Math.round(point.y)
  const horizontalRange = corner === 'tl' || corner === 'bl'
    ? { start: x - 4, end: x + horizontalArm }
    : { start: x - horizontalArm, end: x + 4 }
  const verticalRange = corner === 'tl' || corner === 'tr'
    ? { start: y - 4, end: y + verticalArm }
    : { start: y - verticalArm, end: y + 4 }
  const bestHorizontal = bestPosition(
    y - search,
    y + search,
    candidateY => darkRatioInHorizontalBand(image, candidateY, horizontalRange.start, horizontalRange.end, 2),
  )
  const bestVertical = bestPosition(
    x - search,
    x + search,
    candidateX => darkRatioInVerticalBand(image, candidateX, verticalRange.start, verticalRange.end, 2),
  )
  const horizontalOffsetPx = bestHorizontal.position - y
  const verticalOffsetPx = bestVertical.position - x
  return {
    corner,
    pointPx: { x, y },
    support: bestHorizontal.ratio * 0.55 + bestVertical.ratio * 0.45,
    horizontalSupport: bestHorizontal.ratio,
    verticalSupport: bestVertical.ratio,
    horizontalOffsetPx,
    verticalOffsetPx,
    offsetPx: Math.max(Math.abs(horizontalOffsetPx), Math.abs(verticalOffsetPx)),
    localMatch,
  }
}

function bestPosition(start: number, end: number, scoreAt: (position: number) => number): { position: number; ratio: number } {
  let best = { position: Math.round((start + end) / 2), ratio: -Infinity }
  for (let position = Math.round(start); position <= Math.round(end); position += 1) {
    const ratio = scoreAt(position)
    if (ratio > best.ratio) best = { position, ratio }
  }
  return best
}

function quadMetrics(points: PixelPoint[], targetPoints: PixelPoint[]) {
  const [tl, tr, br, bl] = points
  const [targetTl, targetTr, targetBr, targetBl] = targetPoints
  const topWidthPx = distance(tl, tr)
  const bottomWidthPx = distance(bl, br)
  const leftHeightPx = distance(tl, bl)
  const rightHeightPx = distance(tr, br)
  const widthDisagreementRatio = Math.abs(topWidthPx - bottomWidthPx) / Math.max(1, (topWidthPx + bottomWidthPx) / 2)
  const heightDisagreementRatio = Math.abs(leftHeightPx - rightHeightPx) / Math.max(1, (leftHeightPx + rightHeightPx) / 2)
  const maxIdealDeltaPx = Math.max(
    distance(tl, targetTl),
    distance(tr, targetTr),
    distance(br, targetBr),
    distance(bl, targetBl),
  )
  return {
    topWidthPx,
    bottomWidthPx,
    leftHeightPx,
    rightHeightPx,
    widthDisagreementRatio,
    heightDisagreementRatio,
    maxIdealDeltaPx,
  }
}

function diagnosticReasons(
  confidence: number,
  corners: CornerDiagnostic[],
  quad: ReturnType<typeof quadMetrics> | null,
): string[] {
  const reasons: string[] = []
  if (confidence < 0.62) reasons.push(`検出信頼度が低い (${Math.round(confidence * 100)}%)`)
  for (const corner of corners) {
    if (corner.support < 0.07) reasons.push(`${cornerLabel(corner.corner)}の罫線支持が弱い`)
    if (corner.localMatch && !corner.localMatch.accepted && corner.localMatch.rawGain > 0.06) {
      reasons.push(`${cornerLabel(corner.corner)}の局所格子残差が大きい`)
    }
  }
  if (quad) {
    if (quad.widthDisagreementRatio > 0.035) reasons.push(`上下幅差が大きい (${(quad.widthDisagreementRatio * 100).toFixed(1)}%)`)
    if (quad.heightDisagreementRatio > 0.035) reasons.push(`左右高さ差が大きい (${(quad.heightDisagreementRatio * 100).toFixed(1)}%)`)
  }
  return reasons.slice(0, 6)
}

function makeCornerCropCanvas(
  source: HTMLCanvasElement,
  corner: CornerId,
  point: PixelPoint,
  diagnostic: CornerDiagnostic,
): HTMLCanvasElement {
  const sourceSize = 280
  const scale = 2
  const outputSize = sourceSize * scale
  const canvas = document.createElement('canvas')
  canvas.width = outputSize
  canvas.height = outputSize
  const context = canvas.getContext('2d')
  if (!context) return canvas
  context.imageSmoothingEnabled = false
  context.fillStyle = '#f7f7f2'
  context.fillRect(0, 0, outputSize, outputSize)
  context.drawImage(
    source,
    point.x - sourceSize / 2,
    point.y - sourceSize / 2,
    sourceSize,
    sourceSize,
    0,
    0,
    outputSize,
    outputSize,
  )
  drawCrosshair(context, outputSize / 2, outputSize / 2, outputSize)
  context.fillStyle = 'rgba(255,255,255,0.86)'
  context.fillRect(8, 8, 232, 58)
  context.strokeStyle = '#111'
  context.strokeRect(8, 8, 232, 58)
  context.fillStyle = '#111'
  context.font = '700 18px "LINE Seed JP", sans-serif'
  context.fillText(cornerLabel(corner), 18, 31)
  context.font = '400 13px "LINE Seed JP", sans-serif'
  context.fillText(cornerDiagnosticLabel(diagnostic), 18, 53)
  context.strokeStyle = '#111'
  context.lineWidth = 1
  context.strokeRect(0.5, 0.5, outputSize - 1, outputSize - 1)
  return canvas
}

function cornerDiagnosticLabel(diagnostic: CornerDiagnostic): string {
  const local = diagnostic.localMatch
  if (!local) return `score ${(diagnostic.support * 100).toFixed(1)} / peak ${diagnostic.offsetPx.toFixed(1)}px`
  const status = local.accepted ? 'fit' : 'base'
  const move = `${local.dx.toFixed(0)},${local.dy.toFixed(0)}`
  const gain = Math.max(0, local.rawGain).toFixed(3)
  const angle = Math.abs(local.angleDeg) >= 0.05 ? ` / r ${local.angleDeg.toFixed(1)}` : ''
  return `${status} d ${move}${angle} / gain ${gain}`
}

function drawCrosshair(context: CanvasRenderingContext2D, x: number, y: number, size: number) {
  context.save()
  context.strokeStyle = '#e02525'
  context.lineWidth = 2
  context.beginPath()
  context.moveTo(x, 0)
  context.lineTo(x, size)
  context.moveTo(0, y)
  context.lineTo(size, y)
  context.stroke()
  context.beginPath()
  context.arc(x, y, 6, 0, Math.PI * 2)
  context.stroke()
  context.restore()
}

function makeMontageDataUrl(
  crops: Record<CornerId, HTMLCanvasElement>,
  name: string,
  score: number,
  rating: SheetCalibrationDiagnostic['rating'],
): string {
  const gap = 14
  const header = 46
  const cropSize = crops.tl.width
  const canvas = document.createElement('canvas')
  canvas.width = cropSize * 2 + gap * 3
  canvas.height = header + cropSize * 2 + gap * 3
  const context = canvas.getContext('2d')
  if (!context) return ''
  context.fillStyle = '#efefea'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#111'
  context.font = '700 20px "LINE Seed JP", sans-serif'
  context.fillText(`${name}  score ${score}  ${rating}`, gap, 30)
  context.drawImage(crops.tl, gap, header + gap)
  context.drawImage(crops.tr, gap * 2 + cropSize, header + gap)
  context.drawImage(crops.bl, gap, header + gap * 2 + cropSize)
  context.drawImage(crops.br, gap * 2 + cropSize, header + gap * 2 + cropSize)
  return canvas.toDataURL('image/png')
}

function darkRatioInHorizontalBand(image: ImageData, y: number, xStart: number, xEnd: number, radius: number): number {
  let dark = 0
  let total = 0
  const start = Math.round(Math.max(0, Math.min(xStart, xEnd)))
  const end = Math.round(Math.min(image.width - 1, Math.max(xStart, xEnd)))
  const center = Math.round(clamp(y, 0, image.height - 1))
  for (let yy = center - radius; yy <= center + radius; yy += 1) {
    if (yy < 0 || yy >= image.height) continue
    for (let x = start; x <= end; x += 1) {
      total += 1
      if (isDarkPixel(image, x, yy)) dark += 1
    }
  }
  return dark / Math.max(1, total)
}

function darkRatioInVerticalBand(image: ImageData, x: number, yStart: number, yEnd: number, radius: number): number {
  let dark = 0
  let total = 0
  const start = Math.round(Math.max(0, Math.min(yStart, yEnd)))
  const end = Math.round(Math.min(image.height - 1, Math.max(yStart, yEnd)))
  const center = Math.round(clamp(x, 0, image.width - 1))
  for (let xx = center - radius; xx <= center + radius; xx += 1) {
    if (xx < 0 || xx >= image.width) continue
    for (let y = start; y <= end; y += 1) {
      total += 1
      if (isDarkPixel(image, xx, y)) dark += 1
    }
  }
  return dark / Math.max(1, total)
}

function isDarkPixel(image: ImageData, x: number, y: number): boolean {
  const offset = (y * image.width + x) * 4
  const r = image.data[offset]
  const g = image.data[offset + 1]
  const b = image.data[offset + 2]
  const a = image.data[offset + 3]
  if (a < 20) return false
  const luma = r * 0.299 + g * 0.587 + b * 0.114
  return luma < 185
}

function average(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function distance(a: PixelPoint, b: PixelPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function cornerLabel(corner: CornerId): string {
  return {
    tl: '左上',
    tr: '右上',
    br: '右下',
    bl: '左下',
  }[corner]
}
