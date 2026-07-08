import {
  cellRectForHit,
  globalizeSheetHit,
  type NormalizedPoint,
  type RecognitionCandidate,
  type SheetPage,
  type SheetTemplate,
} from '@xsheet-remap/core'
import type { SheetImageSettings } from './appTypes'
import {
  applyHomography,
  calibrationPointsForSettings,
  computeHomography,
  hasEnabledCalibration,
  loadImage,
  type Homography,
} from './sheetImages'
import { enumerateTemplateCellHits } from './sheetInteraction'

function sampleDarkRatio(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  rect: { x: number; y: number; w: number; h: number },
  imageSettings: SheetImageSettings,
  template: SheetTemplate,
  darknessThreshold: number,
): number {
  let sampled = 0
  let dark = 0
  const calibrationPoints = calibrationPointsForSettings(imageSettings, template)
  const calibrationHomography = hasEnabledCalibration(imageSettings)
    ? computeHomography(calibrationPoints.map(point => point.target), calibrationPoints.map(point => point.source))
    : null
  const stepsX = 9
  const stepsY = 9
  for (let row = 0; row < stepsY; row += 1) {
    for (let col = 0; col < stepsX; col += 1) {
      const templatePoint = {
        x: rect.x + rect.w * ((col + 0.5) / stepsX),
        y: rect.y + rect.h * ((row + 0.5) / stepsY),
      }
      const imagePoint = templatePointToImagePixel(templatePoint, imageSettings, canvas, calibrationHomography)
      if (!imagePoint) continue
      const pixel = ctx.getImageData(imagePoint.x, imagePoint.y, 1, 1).data
      if (pixel[3] < 32) continue
      sampled += 1
      const luminance = pixel[0] * 0.299 + pixel[1] * 0.587 + pixel[2] * 0.114
      if (luminance < darknessThreshold) dark += 1
    }
  }
  return sampled === 0 ? 0 : dark / sampled
}

function templatePointToImagePixel(
  templatePoint: NormalizedPoint,
  imageSettings: SheetImageSettings,
  canvas: HTMLCanvasElement,
  calibrationHomography: Homography | null,
): { x: number; y: number } | null {
  const imagePoint = calibrationHomography ? applyHomography(calibrationHomography, templatePoint.x, templatePoint.y) : null
  if (imagePoint) return normalizedImagePointToPixel(imagePoint, canvas)
  const viewportPoint = mapTemplateToViewport(templatePoint, imageSettings.corners)
  return viewportToImagePixel(viewportPoint, imageSettings, canvas)
}

function mapTemplateToViewport(point: NormalizedPoint, corners: SheetImageSettings['corners']): NormalizedPoint {
  const top = lerpPoint(corners.tl, corners.tr, point.x)
  const bottom = lerpPoint(corners.bl, corners.br, point.x)
  return lerpPoint(top, bottom, point.y)
}

function viewportToImagePixel(point: NormalizedPoint, imageSettings: SheetImageSettings, canvas: HTMLCanvasElement): { x: number; y: number } | null {
  const imageX = (point.x - imageSettings.x) / imageSettings.scale
  const imageY = (point.y - imageSettings.y) / imageSettings.scale
  return normalizedImagePointToPixel({ x: imageX, y: imageY }, canvas)
}

function normalizedImagePointToPixel(point: NormalizedPoint, canvas: HTMLCanvasElement): { x: number; y: number } | null {
  const imageX = point.x
  const imageY = point.y
  if (imageX < 0 || imageY < 0 || imageX > 1 || imageY > 1) return null
  return {
    x: Math.min(canvas.width - 1, Math.max(0, Math.round(imageX * (canvas.width - 1)))),
    y: Math.min(canvas.height - 1, Math.max(0, Math.round(imageY * (canvas.height - 1)))),
  }
}

function lerpPoint(a: NormalizedPoint, b: NormalizedPoint, t: number): NormalizedPoint {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  }
}

export async function detectMarkedCells(
  imageUrl: string,
  template: SheetTemplate,
  page: SheetPage,
  imageSettings: SheetImageSettings,
  darknessThreshold: number,
  minInkRatio: number,
): Promise<RecognitionCandidate[]> {
  const image = await loadImage(imageUrl)
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return []
  ctx.drawImage(image, 0, 0)
  const candidates: RecognitionCandidate[] = []

  for (const localHit of enumerateTemplateCellHits(template)) {
    const hit = globalizeSheetHit(template, localHit, page)
    if (hit.frame > page.frameEnd) continue
    const rect = cellRectForHit(template, hit)
    if (!rect) continue
    const inner = {
      x: rect.x + rect.w * 0.22,
      y: rect.y + rect.h * 0.2,
      w: rect.w * 0.56,
      h: rect.h * 0.6,
    }
    const ratio = sampleDarkRatio(ctx, canvas, inner, imageSettings, template, darknessThreshold)
    if (ratio >= minInkRatio) {
      candidates.push({
        candidateId: `cand_${hit.regionId}_${hit.paperTrack}_${hit.frame}`,
        provider: 'mark-detection',
        paperTrack: hit.paperTrack ?? hit.label,
        frame: hit.frame,
        confidence: Math.min(1, ratio / Math.max(minInkRatio, 0.001)),
        bbox: rect,
      })
    }
  }
  return candidates
}
