import { useEffect, useMemo, useState } from 'react'
import {
  defaultSheetImageAlignment,
  type FileRef,
  type NormalizedPoint,
  type NormalizedRect,
  type SheetCalibrationPointPair,
  type SheetImageAlignment,
  type SheetPageImageRef,
  type SheetTemplate,
  type SheetViewState,
} from '@xsheet-remap/core'
import type { SheetImageSettings, SheetPageImage } from './appTypes'
import { applyLevelCorrectionToImageData, normalizeLevelCorrectionSettings, type LevelCorrectionSettings } from './levelCorrection'
import { SHEET_WARP_PREVIEW_CANVAS_WIDTH } from './sheetConstants'

export function defaultSheetImageSettings(): SheetImageSettings {
  return defaultSheetImageAlignment()
}

const defaultCalibrationFallbackRect: NormalizedRect = { x: 0.08, y: 0.08, w: 0.84, h: 0.84 }
const calibrationGridRoles = new Set(['action', 'sound', 'cell', 'camera'])

export function defaultCalibrationPoints(template?: Pick<SheetTemplate, 'regions'>): SheetCalibrationPointPair[] {
  const rect = calibrationTargetRectForTemplate(template) ?? defaultCalibrationFallbackRect
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
  ]
  return [
    { pointId: 'calibration_point_1', label: calibrationPointLabel(0), source: { ...corners[0] }, target: { ...corners[0] } },
    { pointId: 'calibration_point_2', label: calibrationPointLabel(1), source: { ...corners[1] }, target: { ...corners[1] } },
    { pointId: 'calibration_point_3', label: calibrationPointLabel(2), source: { ...corners[2] }, target: { ...corners[2] } },
    { pointId: 'calibration_point_4', label: calibrationPointLabel(3), source: { ...corners[3] }, target: { ...corners[3] } },
  ]
}

export function calibrationPointsForSettings(settings: SheetImageSettings, template?: Pick<SheetTemplate, 'regions'>): SheetCalibrationPointPair[] {
  const points = settings.calibration?.points ?? []
  const defaults = defaultCalibrationPoints(template)
  return defaults.map((point, index) => ({
    ...point,
    ...(points[index] ?? {}),
    source: points[index]?.source ?? point.source,
    target: points[index]?.target ?? point.target,
  }))
}

export function calibrationTargetRectForTemplate(template?: Pick<SheetTemplate, 'calibration' | 'regions'>): NormalizedRect | null {
  if (template?.calibration?.targetRect) return template.calibration.targetRect
  const rects = template?.regions
    .filter(region => region.type === 'exposure-grid' && region.grid && calibrationGridRoles.has(region.grid.role))
    .map(region => region.rect) ?? []
  if (rects.length === 0) return null
  const left = Math.min(...rects.map(rect => rect.x))
  const top = Math.min(...rects.map(rect => rect.y))
  const right = Math.max(...rects.map(rect => rect.x + rect.w))
  const bottom = Math.max(...rects.map(rect => rect.y + rect.h))
  return { x: left, y: top, w: right - left, h: bottom - top }
}

export function calibrationPointLabel(index: number): string {
  return `${index + 1}`
}

export function getSheetPageImage(sheetView: SheetViewState, runtimeImageUrls: Record<string, string>, pageId: string, template?: Pick<SheetTemplate, 'defaultUnderlay' | 'templateKind'>): SheetPageImage {
  const page = sheetView.pages.find(item => item.pageId === pageId)
  const source = page?.sourceId ? sheetView.sources.find(item => item.sourceId === page.sourceId && item.kind === 'sheet-scan') : undefined
  const defaultUnderlay = template?.defaultUnderlay
  const defaultUnderlayImageRef = defaultUnderlay
    ? { ...defaultUnderlay.imageRef, assetPath: defaultUnderlay.assetPath }
    : undefined
  const defaultUnderlaySettings = defaultUnderlay?.alignment
    ? { ...defaultSheetImageSettings(), ...defaultUnderlay.alignment }
    : defaultSheetImageSettings()
  const templateUnderlaySettings = defaultUnderlayImageRef && isPaperTemplateKind(template)
    ? { ...defaultUnderlaySettings, opacity: 1 }
    : defaultUnderlaySettings
  return {
    imageUrl: source
      ? runtimeImageUrls[source.sourceId] ?? resolveImageRefUrl(source.imageRef)
      : defaultUnderlayImageRef ? resolveImageRefUrl(defaultUnderlayImageRef) : page?.imageRef ? resolveImageRefUrl(page.imageRef) : null,
    sourceId: source?.sourceId,
    imageRef: source?.imageRef ?? page?.imageRef ?? defaultUnderlayImageRef,
    settings: source
      ? page?.alignment ?? defaultSheetImageSettings()
      : defaultUnderlayImageRef ? templateUnderlaySettings : page?.alignment ?? defaultSheetImageSettings(),
  }
}

function isPaperTemplateKind(template?: Pick<SheetTemplate, 'templateKind'>): boolean {
  return template?.templateKind !== 'digital-native'
}

export type SheetWarpTemplate = Pick<SheetTemplate, 'regions'> & {
  page: Pick<SheetTemplate['page'], 'widthPx' | 'heightPx'>
}

export function useWarpedSheetImageUrl(imageUrl: string | null, imageSettings: SheetImageSettings, template: SheetTemplate, quality: 'preview' | 'final'): string | null {
  const [warpedUrl, setWarpedUrl] = useState<{ key: string; url: string | null } | null>(null)
  const calibrationKey = JSON.stringify(imageSettings.calibration ?? null)
  const pageWidth = Math.max(1, Math.round(template.page.widthPx))
  const pageHeight = Math.max(1, Math.round(template.page.heightPx))
  const outputWidth = warpOutputWidth({ page: { widthPx: pageWidth, heightPx: pageHeight } }, quality)
  const warpKey = imageUrl && hasEnabledCalibration(imageSettings) ? `${imageUrl}|${pageWidth}x${pageHeight}|${quality}|${calibrationKey}` : null
  const warpRequest = useMemo(() => {
    if (!warpKey || !imageUrl) return null
    return {
      key: warpKey,
      imageUrl,
      imageSettings: {
        ...defaultSheetImageSettings(),
        calibration: JSON.parse(calibrationKey) as SheetImageSettings['calibration'],
      },
      template: {
        page: { widthPx: pageWidth, heightPx: pageHeight },
        regions: template.regions,
      },
      outputWidth,
    }
  }, [calibrationKey, imageUrl, outputWidth, pageHeight, pageWidth, template.regions, warpKey])

  useEffect(() => {
    if (!warpRequest) return
    let cancelled = false
    let frameId = 0

    void loadImage(warpRequest.imageUrl)
      .then(image => {
        if (cancelled) return
        frameId = window.requestAnimationFrame(() => {
          if (cancelled) return
          setWarpedUrl({
            key: warpRequest.key,
            url: warpSheetImage(image, warpRequest.imageSettings, warpRequest.template, warpRequest.outputWidth),
          })
        })
      })
      .catch(() => {
        if (!cancelled) setWarpedUrl({ key: warpRequest.key, url: null })
      })

    return () => {
      cancelled = true
      if (frameId) window.cancelAnimationFrame(frameId)
    }
  }, [warpRequest])

  return warpKey && warpedUrl?.key === warpKey ? warpedUrl.url : null
}

export function useLevelCorrectedImageUrl(imageUrl: string | null, levelCorrection: LevelCorrectionSettings | undefined): string | null {
  const [correctedUrl, setCorrectedUrl] = useState<{ key: string; url: string | null } | null>(null)
  const settings = useMemo(() => levelCorrection ? normalizeLevelCorrectionSettings(levelCorrection) : null, [levelCorrection])
  const enabled = Boolean(settings?.enabled)
  const key = imageUrl && enabled && settings ? `${imageUrl}|${settings.inputBlack}|${settings.gamma}|${settings.inputWhite}` : null

  useEffect(() => {
    if (!key || !imageUrl || !settings) return
    let cancelled = false
    void applyLevelCorrectionToDataUrl(imageUrl, settings)
      .then(url => {
        if (!cancelled) setCorrectedUrl({ key, url: url ?? imageUrl })
      })
      .catch(() => {
        if (!cancelled) setCorrectedUrl({ key, url: imageUrl })
      })
    return () => {
      cancelled = true
    }
  }, [imageUrl, key, settings])

  if (!imageUrl || !enabled) return imageUrl
  return correctedUrl?.key === key ? correctedUrl.url : imageUrl
}

export async function applyLevelCorrectionToDataUrl(dataUrl: string, settingsInput: LevelCorrectionSettings): Promise<string | null> {
  const settings = normalizeLevelCorrectionSettings(settingsInput)
  if (!settings.enabled) return dataUrl
  const image = await loadImage(dataUrl)
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  if (width <= 0 || height <= 0) return dataUrl
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return dataUrl
  context.drawImage(image, 0, 0, width, height)
  const imageData = context.getImageData(0, 0, width, height)
  context.putImageData(applyLevelCorrectionToImageData(imageData, settings), 0, 0)
  return canvas.toDataURL('image/png')
}

function warpOutputWidth(template: Pick<SheetWarpTemplate, 'page'>, quality: 'preview' | 'final'): number {
  const templateWidth = Math.max(1, Math.round(template.page.widthPx))
  return quality === 'preview'
    ? Math.min(templateWidth, SHEET_WARP_PREVIEW_CANVAS_WIDTH)
    : templateWidth
}

export function hasEnabledCalibration(settings: SheetImageSettings): boolean {
  return Boolean(settings.calibration?.enabled && settings.calibration.points.length >= 4)
}

export function resolveImageRefUrl(imageRef: SheetPageImageRef): string | null {
  const assetPath = imageRef.assetPath
  if (!assetPath) return null
  if (/^(?:https?:|data:|blob:|\/)/.test(assetPath)) return assetPath
  const baseUrl = ((import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/').replace(/\/?$/, '/')
  return `${baseUrl}${assetPath.replace(/^\/+/, '')}`
}

export function viewportToRawImagePoint(point: NormalizedPoint, imageSettings: SheetImageSettings): NormalizedPoint {
  return {
    x: clampUnit((point.x - imageSettings.x) / imageSettings.scale),
    y: clampUnit((point.y - imageSettings.y) / imageSettings.scale),
  }
}

export function rawImageToViewportPoint(point: NormalizedPoint, imageSettings: SheetImageSettings): NormalizedPoint {
  return {
    x: imageSettings.x + point.x * imageSettings.scale,
    y: imageSettings.y + point.y * imageSettings.scale,
  }
}

export function warpSheetImage(image: HTMLImageElement, imageSettings: SheetImageSettings, template: SheetWarpTemplate, outputWidth: number): string | null {
  const outputData = warpSheetImageData(image, imageSettings, template, outputWidth)
  if (!outputData) return null
  const outputCanvas = document.createElement('canvas')
  outputCanvas.width = outputData.width
  outputCanvas.height = outputData.height
  const outputContext = outputCanvas.getContext('2d')
  if (!outputContext) return null
  outputContext.putImageData(outputData, 0, 0)
  return outputCanvas.toDataURL('image/png')
}

export function warpSheetImageData(image: HTMLImageElement, imageSettings: SheetImageSettings, template: SheetWarpTemplate, outputWidth: number): ImageData | null {
  const calibrationPoints = calibrationPointsForSettings(imageSettings, template)
  const homography = computeHomography(
    calibrationPoints.map(point => point.target),
    calibrationPoints.map(point => point.source),
  )
  if (!homography) return null

  const sourceWidth = image.naturalWidth || image.width
  const sourceHeight = image.naturalHeight || image.height
  if (sourceWidth <= 0 || sourceHeight <= 0) return null

  const sourceCanvas = document.createElement('canvas')
  sourceCanvas.width = sourceWidth
  sourceCanvas.height = sourceHeight
  const sourceContext = sourceCanvas.getContext('2d')
  if (!sourceContext) return null
  sourceContext.drawImage(image, 0, 0, sourceWidth, sourceHeight)

  let sourceData: ImageData
  try {
    sourceData = sourceContext.getImageData(0, 0, sourceWidth, sourceHeight)
  } catch {
    return null
  }

  const outputHeight = Math.round(outputWidth * (template.page.heightPx / template.page.widthPx))
  const outputCanvas = document.createElement('canvas')
  outputCanvas.width = outputWidth
  outputCanvas.height = outputHeight
  const outputContext = outputCanvas.getContext('2d')
  if (!outputContext) return null
  const outputData = outputContext.createImageData(outputWidth, outputHeight)

  for (let y = 0; y < outputHeight; y += 1) {
    for (let x = 0; x < outputWidth; x += 1) {
      const source = applyHomography(homography, (x + 0.5) / outputWidth, (y + 0.5) / outputHeight)
      if (!source || source.x < 0 || source.x > 1 || source.y < 0 || source.y > 1) continue
      const color = sampleImageData(sourceData, source.x * (sourceWidth - 1), source.y * (sourceHeight - 1))
      const offset = (y * outputWidth + x) * 4
      outputData.data[offset] = color[0]
      outputData.data[offset + 1] = color[1]
      outputData.data[offset + 2] = color[2]
      outputData.data[offset + 3] = color[3]
    }
  }
  return imageSettings.levelCorrection?.enabled
    ? applyLevelCorrectionToImageData(outputData, imageSettings.levelCorrection)
    : outputData
}

export type Homography = [number, number, number, number, number, number, number, number, number]

export function computeHomography(from: NormalizedPoint[], to: NormalizedPoint[]): Homography | null {
  if (from.length < 4 || to.length < 4) return null
  const matrix: number[][] = []
  const values: number[] = []
  for (let index = 0; index < 4; index += 1) {
    const source = from[index]
    const target = to[index]
    matrix.push([source.x, source.y, 1, 0, 0, 0, -target.x * source.x, -target.x * source.y])
    values.push(target.x)
    matrix.push([0, 0, 0, source.x, source.y, 1, -target.y * source.x, -target.y * source.y])
    values.push(target.y)
  }
  const solved = solveLinearSystem(matrix, values)
  return solved ? [solved[0], solved[1], solved[2], solved[3], solved[4], solved[5], solved[6], solved[7], 1] : null
}

function solveLinearSystem(matrix: number[][], values: number[]): number[] | null {
  const size = values.length
  const augmented = matrix.map((row, index) => [...row, values[index]])
  for (let pivot = 0; pivot < size; pivot += 1) {
    let bestRow = pivot
    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[bestRow][pivot])) bestRow = row
    }
    if (Math.abs(augmented[bestRow][pivot]) < 1e-9) return null
    if (bestRow !== pivot) {
      const current = augmented[pivot]
      augmented[pivot] = augmented[bestRow]
      augmented[bestRow] = current
    }
    const divisor = augmented[pivot][pivot]
    for (let col = pivot; col <= size; col += 1) augmented[pivot][col] /= divisor
    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue
      const factor = augmented[row][pivot]
      for (let col = pivot; col <= size; col += 1) {
        augmented[row][col] -= factor * augmented[pivot][col]
      }
    }
  }
  return augmented.map(row => row[size])
}

export function applyHomography(h: Homography, x: number, y: number): NormalizedPoint | null {
  const denominator = h[6] * x + h[7] * y + h[8]
  if (Math.abs(denominator) < 1e-9) return null
  return {
    x: (h[0] * x + h[1] * y + h[2]) / denominator,
    y: (h[3] * x + h[4] * y + h[5]) / denominator,
  }
}

function sampleImageData(imageData: ImageData, x: number, y: number): [number, number, number, number] {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(imageData.width - 1, x0 + 1)
  const y1 = Math.min(imageData.height - 1, y0 + 1)
  const tx = x - x0
  const ty = y - y0
  const c00 = imagePixel(imageData, x0, y0)
  const c10 = imagePixel(imageData, x1, y0)
  const c01 = imagePixel(imageData, x0, y1)
  const c11 = imagePixel(imageData, x1, y1)
  return [0, 1, 2, 3].map(channel => Math.round(
    c00[channel] * (1 - tx) * (1 - ty) +
    c10[channel] * tx * (1 - ty) +
    c01[channel] * (1 - tx) * ty +
    c11[channel] * tx * ty,
  )) as [number, number, number, number]
}

function imagePixel(imageData: ImageData, x: number, y: number): [number, number, number, number] {
  const offset = (y * imageData.width + x) * 4
  return [
    imageData.data[offset],
    imageData.data[offset + 1],
    imageData.data[offset + 2],
    imageData.data[offset + 3],
  ]
}

export function serializableImageRef(ref: FileRef): SheetPageImageRef {
  return {
    name: ref.name,
    size: ref.size,
    lastModified: ref.lastModified,
    path: ref.path,
    contentHash: ref.contentHash,
  }
}

export function clampPoint(point: NormalizedPoint): NormalizedPoint {
  return { x: clamp01(point.x), y: clamp01(point.y) }
}

function clamp01(value: number): number {
  return Math.min(1.5, Math.max(-0.5, value))
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function rectFromPoints(a: NormalizedPoint, b: NormalizedPoint): { x: number; y: number; w: number; h: number } {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  }
}

export function calibrationPolygonPath(corners: SheetImageAlignment['corners']): string {
  return `M ${corners.tl.x} ${corners.tl.y} L ${corners.tr.x} ${corners.tr.y} L ${corners.br.x} ${corners.br.y} L ${corners.bl.x} ${corners.bl.y} Z`
}

export function roundForInput(value: number): number {
  return Math.round(value * 1000) / 1000
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`failed to load image: ${src}`))
    image.src = src
  })
}
