import {
  createSheetPages,
  logicalSheetDisplayDurationFrames,
  logicalSheetDisplayFrameStart,
  type CutProject,
  type SheetCalibrationPointPair,
  type SheetSource,
  type SheetTemplate,
} from '@xsheet-remap/core'
import type { SheetImageSettings, SheetPrecisionWarp } from './appTypes'
import { applyLevelCorrectionToImageData, defaultLevelCorrectionSettings, type LevelCorrectionSettings } from './levelCorrection'
import { alphaComposite, writeRgbPsd } from './psdWriter'
import {
  applyLevelCorrectionToDataUrl,
  calibrationPointsForSettings,
  defaultSheetImageSettings,
  hasEnabledCalibration,
  loadImage,
  resolveImageRefUrl,
  warpSheetImageAsync,
  warpSheetImageDataAsync,
} from './sheetImages'

export type CorrectedSheetImageExportFormat = 'jpg' | 'png' | 'psd'

export type CorrectedSheetImageExportResult = {
  bytes: Uint8Array
  fileName: string
  mimeType: string
  extension: CorrectedSheetImageExportFormat
}

export type CorrectedSheetImageExportPage = {
  pageId: string
  pageIndex: number
  source: SheetSource
}

export function correctedSheetImageExportPlan(
  project: Pick<CutProject, 'logicalSheet' | 'sheetView'>,
  template: SheetTemplate,
): { pages: CorrectedSheetImageExportPage[]; totalPages: number } {
  const scanSources = new Map(project.sheetView.sources
    .filter(source => source.kind === 'sheet-scan')
    .map(source => [source.sourceId, source]))
  const sheetPages = createSheetPages(
    template,
    logicalSheetDisplayDurationFrames(project.logicalSheet),
    logicalSheetDisplayFrameStart(project.logicalSheet),
  )
  const canonicalPageIndex = new Map(sheetPages.map((page, pageIndex) => [page.pageId, pageIndex]))
  const pageCandidates = project.sheetView.pages.flatMap((page, stateIndex) => {
    const source = page.sourceId ? scanSources.get(page.sourceId) : undefined
    if (!source) return []
    const canonicalIndex = canonicalPageIndex.get(page.pageId)
    const numericPage = /^page_(\d+)$/.exec(page.pageId)
    const numericIndex = numericPage ? Number(numericPage[1]) - 1 : Number.NaN
    const fallbackIndex = Number.isSafeInteger(numericIndex) && numericIndex >= 0 ? numericIndex : stateIndex
    return [{
      pageId: page.pageId,
      pageIndex: canonicalIndex ?? fallbackIndex,
      canonical: canonicalIndex !== undefined,
      source,
      stateIndex,
    }]
  })
  const usedPageIndices = new Set<number>()
  const assignedPages = pageCandidates
    .sort((left, right) => Number(right.canonical) - Number(left.canonical) || left.pageIndex - right.pageIndex || left.stateIndex - right.stateIndex)
    .map(page => {
      let pageIndex = page.pageIndex
      while (usedPageIndices.has(pageIndex)) pageIndex += 1
      usedPageIndices.add(pageIndex)
      return { ...page, pageIndex }
    })
    .sort((left, right) => left.pageIndex - right.pageIndex || left.stateIndex - right.stateIndex)
  const totalPages = Math.max(sheetPages.length, ...assignedPages.map(page => page.pageIndex + 1))
  return {
    pages: assignedPages.map(page => ({ pageId: page.pageId, pageIndex: page.pageIndex, source: page.source })),
    totalPages,
  }
}

export async function renderCorrectedSheetImageExport(input: {
  sourceName: string
  imageUrl: string
  imageSettings: SheetImageSettings
  template: SheetTemplate
  format: CorrectedSheetImageExportFormat
}): Promise<CorrectedSheetImageExportResult> {
  const levelCorrection = input.imageSettings.levelCorrection ?? defaultLevelCorrectionSettings()
  const calibrationPoints = calibrationPointsForSettings(input.imageSettings, input.template)
  const fileName = correctedOutputName(input.sourceName, input.format)
  const correctedImageData = hasEnabledCalibration(input.imageSettings)
    ? await correctedSheetImageData(
        input.imageUrl,
        calibrationPoints,
        levelCorrection,
        input.template,
        input.imageSettings.precisionWarp,
      )
    : await alignedSheetImageData(input.imageUrl, input.imageSettings, levelCorrection, input.template)
  if (!correctedImageData) throw new Error('補正済み紙シート画像を生成できませんでした。')

  if (input.format === 'psd') {
    const psdBytes = await correctedPsdBytes(
      input.sourceName,
      correctedImageData,
      templateOverlayImageUrl(input.template),
      input.template,
    )
    return {
      bytes: psdBytes,
      fileName,
      mimeType: 'image/vnd.adobe.photoshop',
      extension: input.format,
    }
  }

  const dataUrl = imageDataToDataUrl(correctedImageData, input.format)
  return {
    bytes: dataUrlToBytes(dataUrl),
    fileName,
    mimeType: input.format === 'jpg' ? 'image/jpeg' : 'image/png',
    extension: input.format,
  }
}

export async function correctedPngDataUrl(
  imageUrl: string,
  points: SheetCalibrationPointPair[],
  levelCorrection: LevelCorrectionSettings,
  template: SheetTemplate,
  precisionWarp?: SheetPrecisionWarp,
): Promise<string | null> {
  const image = await loadImage(imageUrl)
  const pngDataUrl = await warpSheetImageAsync(
    image,
    {
      ...defaultSheetImageSettings(),
      calibration: {
        enabled: true,
        points,
      },
      precisionWarp,
    },
    template,
    template.page.widthPx,
  )
  if (!pngDataUrl || !levelCorrection.enabled) return pngDataUrl
  return applyLevelCorrectionToDataUrl(pngDataUrl, levelCorrection)
}

export async function correctedPsdBase64(
  sourceName: string,
  imageUrl: string,
  templateImageUrl: string | null,
  points: SheetCalibrationPointPair[],
  levelCorrection: LevelCorrectionSettings,
  template: SheetTemplate,
  precisionWarp?: SheetPrecisionWarp,
): Promise<string | null> {
  const correctedImageData = await correctedSheetImageData(imageUrl, points, levelCorrection, template, precisionWarp)
  if (!correctedImageData) return null
  return bytesToBase64(await correctedPsdBytes(sourceName, correctedImageData, templateImageUrl, template))
}

async function correctedPsdBytes(
  sourceName: string,
  correctedImageData: ImageData,
  templateImageUrl: string | null,
  template: SheetTemplate,
): Promise<Uint8Array> {
  const whiteLayer = solidWhiteImageData(correctedImageData.width, correctedImageData.height)
  const templateLayer = templateImageUrl
    ? await templateLineLayerImageData(templateImageUrl, correctedImageData.width, correctedImageData.height, template)
    : blankTransparentImageData(correctedImageData.width, correctedImageData.height)
  const scanLayer = new ImageData(new Uint8ClampedArray(correctedImageData.data), correctedImageData.width, correctedImageData.height)
  const composite = alphaComposite(alphaComposite(whiteLayer, templateLayer), scanLayer)
  const psd = writeRgbPsd({
    width: correctedImageData.width,
    height: correctedImageData.height,
    dpi: template.page.dpi ?? 72,
    layers: [
      { name: '白地', imageData: whiteLayer },
      { name: 'テンプレ', imageData: templateLayer },
      { name: sourceName, imageData: scanLayer },
    ],
    composite,
  })
  return psd
}

async function correctedSheetImageData(
  imageUrl: string,
  points: SheetCalibrationPointPair[],
  levelCorrection: LevelCorrectionSettings,
  template: SheetTemplate,
  precisionWarp?: SheetPrecisionWarp,
): Promise<ImageData | null> {
  const image = await loadImage(imageUrl)
  const imageData = await warpSheetImageDataAsync(
    image,
    {
      ...defaultSheetImageSettings(),
      calibration: {
        enabled: true,
        points,
      },
      precisionWarp,
    },
    template,
    template.page.widthPx,
  )
  if (!imageData) return null
  return levelCorrection.enabled ? applyLevelCorrectionToImageData(imageData, levelCorrection) : imageData
}

async function alignedSheetImageData(
  imageUrl: string,
  imageSettings: SheetImageSettings,
  levelCorrection: LevelCorrectionSettings,
  template: SheetTemplate,
): Promise<ImageData | null> {
  const image = await loadImage(imageUrl)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(template.page.widthPx))
  canvas.height = Math.max(1, Math.round(template.page.heightPx))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.drawImage(
    image,
    imageSettings.x * canvas.width,
    imageSettings.y * canvas.height,
    imageSettings.scale * canvas.width,
    imageSettings.scale * canvas.height,
  )
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
  return levelCorrection.enabled ? applyLevelCorrectionToImageData(imageData, levelCorrection) : imageData
}

async function templateLineLayerImageData(
  templateImageUrl: string,
  width: number,
  height: number,
  template: SheetTemplate,
): Promise<ImageData> {
  const image = await loadImage(templateImageUrl)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return blankTransparentImageData(width, height)
  const placementRect = resolveTemplateUnderlayDrawRect(template, width, height)
  if (placementRect) {
    context.drawImage(
      image,
      placementRect.x,
      placementRect.y,
      placementRect.width,
      placementRect.height,
    )
  } else {
    context.drawImage(image, 0, 0, width, height)
  }
  const imageData = context.getImageData(0, 0, width, height)
  const output = context.createImageData(width, height)
  for (let index = 0; index < imageData.data.length; index += 4) {
    const sourceAlpha = imageData.data[index + 3] / 255
    if (sourceAlpha <= 0.03) continue
    const luminance = imageData.data[index] * 0.299 + imageData.data[index + 1] * 0.587 + imageData.data[index + 2] * 0.114
    const darkness = Math.max(0, 246 - luminance)
    const alpha = Math.max(0, Math.min(255, Math.round(darkness * 2.2 * sourceAlpha)))
    output.data[index] = 0
    output.data[index + 1] = 0
    output.data[index + 2] = 0
    output.data[index + 3] = alpha
  }
  return output
}

export function resolveTemplateUnderlayDrawRect(
  template: Pick<SheetTemplate, 'page' | 'defaultUnderlay'>,
  outputWidth: number,
  outputHeight: number,
): { x: number; y: number; width: number; height: number } | null {
  const placement = template.defaultUnderlay?.placement
  if (!placement) return null
  const scaleX = outputWidth / template.page.widthPx
  const scaleY = outputHeight / template.page.heightPx
  return {
    x: placement.offsetXPx * scaleX,
    y: placement.offsetYPx * scaleY,
    width: placement.renderedWidthPx * scaleX,
    height: placement.renderedHeightPx * scaleY,
  }
}

function blankTransparentImageData(width: number, height: number): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return new ImageData(width, height)
  return context.createImageData(width, height)
}

function solidWhiteImageData(width: number, height: number): ImageData {
  const output = new ImageData(width, height)
  for (let index = 0; index < output.data.length; index += 4) {
    output.data[index] = 255
    output.data[index + 1] = 255
    output.data[index + 2] = 255
    output.data[index + 3] = 255
  }
  return output
}

function imageDataToDataUrl(imageData: ImageData, format: 'jpg' | 'png'): string {
  const sourceCanvas = document.createElement('canvas')
  sourceCanvas.width = imageData.width
  sourceCanvas.height = imageData.height
  const sourceContext = sourceCanvas.getContext('2d')
  if (!sourceContext) throw new Error('画像を生成できませんでした。')
  sourceContext.putImageData(imageData, 0, 0)
  if (format === 'png') return sourceCanvas.toDataURL('image/png')

  const canvas = document.createElement('canvas')
  canvas.width = imageData.width
  canvas.height = imageData.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('JPEG画像を生成できませんでした。')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(sourceCanvas, 0, 0)
  return canvas.toDataURL('image/jpeg', 0.92)
}

export function correctedOutputName(name: string, extension: CorrectedSheetImageExportFormat): string {
  const extensionMatch = /\.[^.]+$/.exec(name)
  const stem = extensionMatch ? name.slice(0, -extensionMatch[0].length) : name
  return extension === 'psd' ? `${stem}.psd` : `${stem}_corrected.${extension}`
}

export function templateOverlayImageUrl(template: SheetTemplate): string | null {
  const underlay = template.defaultUnderlay
  if (!underlay) return null
  return resolveImageRefUrl({ ...underlay.imageRef, assetPath: underlay.assetPath })
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const commaIndex = dataUrl.indexOf(',')
  if (commaIndex < 0) throw new Error('画像データURLの形式が不正です。')
  return base64ToBytes(dataUrl.slice(commaIndex + 1))
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}
