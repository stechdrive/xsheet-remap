import {
  getSheetViewLayout,
  isRenderableSheetTemplateGridRegion,
  memoAnchorPresentation,
  resolveSheetTemplateGridLayout,
  sheetAnnotationStrokes,
  sheetAnnotationTexts,
  timelineMemos,
  type CutProject,
  type NormalizedRect,
  type SheetPage,
  type SheetTemplate,
} from '@xsheet-remap/core'
import { alphaComposite, writeRgbPsd, type PsdLayer } from './psdWriter'
import type { SheetPageImage } from './appTypes'
import { defaultSheetImageSettings, loadImage, resolveImageRefUrl, warpSheetImageDataAsync } from './sheetImages'
import { defaultLevelCorrectionSettings } from './levelCorrection'
import {
  createSheetRenderModelContext,
  continuationRenderItemsForPage,
  hasOverlayRenderContent,
  inputTextRenderItemsForPage,
  metadataTextRenderItemsForPage,
  overlayPaperTrackRenderItems,
  stackGuideFlagRenderItemsForPage,
  type FlagLabelGeometry,
  type SheetRenderCutGroupContext,
  type SheetRenderModelContext,
} from './sheetRenderModel'
import { timingEventSymbolGeometry } from './TimingEventSymbol'
import {
  buildTemplateChromeRenderModel,
  buildTemplateGridOverlayRenderModel,
  gridRowLineClassName,
  normalizedRectToPixelEdges,
  type TemplateGridPathRenderModel,
} from './templateEditorGeometry'
import { sheetImageFileName } from './outputFileNames'
import { annotationTextLines, resolveAnnotationTextFontSizePx } from './annotationTextLayout'
import { buildSoundCueTextLayout, soundCueSegmentsForPage } from './soundCueGeometry'
import { resolveGridTypographyFontSizes } from './sheetTextLayout'
import {
  buildCameraCuePageLayouts,
  cameraCuePointLayoutsForPage,
  cameraFadePolygonForSegment,
  cameraOverlapFillPolygonsForSegment,
  cameraOverlapPivotMarkForSegment,
  cameraOverlapPathsForSegment,
  cameraRangeMarkerGeometryForSegment,
} from './cameraCueGeometry'
import { createCanvasTextMeasurementProvider, SHEET_TEXT_FONT_FAMILY, textFontDeclaration } from './textMetrics'
import {
  timelineMemoAnchorCellForPage,
  timelineMemoAnchorConnectorPoints,
  timelineMemoAnchorMarkerRect,
  timelineMemoPointToPagePoint,
  timelineMemoSegmentsForPage,
  timelineMemoStrokePointsForSegment,
} from './timelineMemoGeometry'

export type SheetImageExportFormat = 'jpg' | 'png' | 'psd'

export type SheetImageExportOptions = {
  format: SheetImageExportFormat
  includePaperSheet: boolean
  includeTemplateImage: boolean
  includeTemplateDrawing: boolean
}

export type SheetImageExportResult = {
  bytes: Uint8Array
  fileName: string
  mimeType: string
  extension: SheetImageExportFormat
  pageIndex: number
}

type SheetExportLayerId =
  | 'white'
  | 'paperSheet'
  | 'templateImage'
  | 'templateLines'
  | 'templateLabels'
  | 'overlayTracks'
  | 'metadataText'
  | 'timingInput'
  | 'soundCues'
  | 'cameraCues'
  | 'annotationInk'
  | 'annotationText'

export type TimedRangeCueExportLayerId = Extract<SheetExportLayerId, 'soundCues' | 'cameraCues'>

type SheetExportLayer = {
  id: SheetExportLayerId
  name: string
  imageData: ImageData
  opacity?: number
  opacityByPage?: Record<string, number>
}

export type SheetExportLayerDescriptor = Omit<SheetExportLayer, 'imageData'>

type SheetExportLayerContext = SheetRenderModelContext & {
  runtimeSourceImageUrls: Record<string, string>
}

const SHEET_CANVAS_FONT_FAMILY = SHEET_TEXT_FONT_FAMILY
const TEMPLATE_CANVAS_FONT_FAMILY = SHEET_CANVAS_FONT_FAMILY
const SHEET_EVENT_FONT_WEIGHT = 800
const SHEET_LABEL_FONT_WEIGHT = 700

export function defaultSheetImageExportOptions(
  project: CutProject,
  template: SheetTemplate,
  format: SheetImageExportFormat,
): SheetImageExportOptions {
  const includePaperSheet = hasPaperSheetImages(project)
  return {
    format,
    includePaperSheet,
    includeTemplateImage: !includePaperSheet && Boolean(template.defaultUnderlay) && template.defaultUnderlayUsage !== 'reference-only',
    includeTemplateDrawing: true,
  }
}

export function hasPaperSheetImages(project: CutProject): boolean {
  return project.sheetView.pages.some(page => {
    const source = page.sourceId ? project.sheetView.sources.find(item => item.sourceId === page.sourceId) : undefined
    return source?.kind === 'sheet-scan'
  })
}

export async function renderSheetImageExport(
  project: CutProject,
  template: SheetTemplate,
  runtimeSourceImageUrls: Record<string, string>,
  options: SheetImageExportOptions,
  renderOptions: { cutGroup?: SheetRenderCutGroupContext } = {},
): Promise<SheetImageExportResult> {
  const results = await renderSheetImageExports(project, template, runtimeSourceImageUrls, options, renderOptions)
  const first = results[0]
  if (!first) throw new Error('No sheet pages to export')
  return first
}

export async function renderSheetImageExports(
  project: CutProject,
  template: SheetTemplate,
  runtimeSourceImageUrls: Record<string, string>,
  options: SheetImageExportOptions,
  renderOptions: { cutGroup?: SheetRenderCutGroupContext } = {},
): Promise<SheetImageExportResult[]> {
  await waitForSheetExportFonts()
  const context = createLayerContext(project, template, runtimeSourceImageUrls, renderOptions)
  const layers = await renderSheetExportLayers(context, normalizeExportOptions(project, options))
  const extension = options.format
  const mimeType = extension === 'jpg' ? 'image/jpeg' : 'image/png'
  const totalPages = Math.max(1, context.pages.length)
  const results: SheetImageExportResult[] = []
  for (const page of context.pages) {
    const pageLayers = layers.map(layer => ({
      ...layer,
      opacity: layer.opacityByPage?.[page.pageId] ?? layer.opacity,
      imageData: cropImageData(layer.imageData, 0, page.pageIndex * context.pageSize.heightPx, context.pageSize.widthPx, context.pageSize.heightPx),
    }))
    const composite = compositeLayers(pageLayers)
    const fileName = sheetImageFileName(project, extension, page.pageIndex, totalPages)
    if (extension === 'psd') {
      const psdLayers: PsdLayer[] = pageLayers.map(layer => ({
        name: layer.name,
        imageData: layer.imageData,
        opacity: layer.opacity,
      }))
      results.push({
        bytes: writeRgbPsd({
          width: context.pageSize.widthPx,
          height: context.pageSize.heightPx,
          dpi: context.pageSize.dpi ?? template.page.dpi ?? 72,
          layers: psdLayers,
          composite,
        }),
        fileName,
        mimeType: 'image/vnd.adobe.photoshop',
        extension,
        pageIndex: page.pageIndex,
      })
      continue
    }
    results.push({
      bytes: await imageDataToBytes(composite, mimeType, extension === 'jpg' ? 0.92 : undefined),
      fileName,
      mimeType,
      extension,
      pageIndex: page.pageIndex,
    })
  }
  return results
}

function normalizeExportOptions(project: CutProject, options: SheetImageExportOptions): SheetImageExportOptions {
  if (options.includePaperSheet && !hasPaperSheetImages(project)) {
    return { ...options, includePaperSheet: false }
  }
  return options
}

function createLayerContext(
  project: CutProject,
  template: SheetTemplate,
  runtimeSourceImageUrls: Record<string, string>,
  renderOptions: { cutGroup?: SheetRenderCutGroupContext },
): SheetExportLayerContext {
  return {
    ...createSheetRenderModelContext(project, template, renderOptions),
    runtimeSourceImageUrls,
  }
}

async function renderSheetExportLayers(
  context: SheetExportLayerContext,
  options: SheetImageExportOptions,
): Promise<SheetExportLayer[]> {
  const descriptors = sheetExportLayerDescriptorsForContext(context, options)
  return Promise.all(descriptors.map(async descriptor => ({
    ...descriptor,
    imageData: await renderSheetExportLayer(context, options, descriptor.id),
  })))
}

export function sheetExportLayerDescriptors(
  project: CutProject,
  template: SheetTemplate,
  options: SheetImageExportOptions,
  renderOptions: { cutGroup?: SheetRenderCutGroupContext } = {},
): SheetExportLayerDescriptor[] {
  const context = createLayerContext(project, template, {}, renderOptions)
  return sheetExportLayerDescriptorsForContext(context, normalizeExportOptions(project, options))
}

function sheetExportLayerDescriptorsForContext(
  context: SheetExportLayerContext,
  options: SheetImageExportOptions,
): SheetExportLayerDescriptor[] {
  const layers: SheetExportLayerDescriptor[] = [{ id: 'white', name: '白地' }]
  if (options.includeTemplateImage && context.template.defaultUnderlay && context.template.defaultUnderlayUsage !== 'reference-only') layers.push({ id: 'templateImage', name: 'テンプレ画像' })
  if (options.includePaperSheet) {
    layers.push({
      id: 'paperSheet',
      name: '紙シート画像',
      opacityByPage: Object.fromEntries(context.pages.map(page => [
        page.pageId,
        psdOpacityByte(sheetScanPageImage(context, page.pageId).settings.opacity),
      ])),
    })
  }
  if (options.includeTemplateDrawing) {
    layers.push({ id: 'templateLines', name: 'テンプレ罫線' })
    layers.push({ id: 'templateLabels', name: 'テンプレラベル' })
  }
  if (hasOverlayRenderContent(context)) layers.push({ id: 'overlayTracks', name: '追加トラック/ラベル' })
  layers.push({ id: 'metadataText', name: 'シート情報' })
  layers.push({ id: 'timingInput', name: 'ACTION/CELL入力' })
  for (const id of timedRangeCueExportLayerIds(context.project)) {
    layers.push({ id, name: id === 'soundCues' ? 'SOUND指示' : 'CAMERA指示' })
  }
  layers.push({ id: 'annotationInk', name: 'メモ・手描き' })
  layers.push({ id: 'annotationText', name: 'メモ・テキスト' })
  return layers
}

async function renderSheetExportLayer(
  context: SheetExportLayerContext,
  options: SheetImageExportOptions,
  id: SheetExportLayerId,
): Promise<ImageData> {
  if (id === 'white') return solidWhiteImageData(context.width, context.height)
  if (id === 'templateImage') return renderTemplateImageLayer(context)
  if (id === 'paperSheet') return renderPaperSheetLayer(context)
  if (id === 'templateLines') {
    return renderTemplateDrawingLayer(context, {
      includeStaticChrome: !options.includePaperSheet && !options.includeTemplateImage,
      content: 'lines',
    })
  }
  if (id === 'templateLabels') return renderTemplateDrawingLayer(context, { includeStaticChrome: false, content: 'labels' })
  if (id === 'overlayTracks') return renderOverlayTrackLayer(context)
  if (id === 'metadataText') return renderMetadataTextLayer(context)
  if (id === 'timingInput') return renderTimingInputLayer(context)
  if (id === 'soundCues') return renderSoundCueLayer(context)
  if (id === 'cameraCues') return renderCameraCueLayer(context)
  if (id === 'annotationInk') return alphaComposite(renderSheetAnnotationInkLayer(context), renderTimelineMemoLayer(context))
  return renderAnnotationTextLayer(context)
}

export function psdOpacityByte(value: number): number {
  const normalized = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1
  return Math.round(normalized * 255)
}

export function timedRangeCueExportLayerIds(project: CutProject): TimedRangeCueExportLayerId[] {
  const ids: TimedRangeCueExportLayerId[] = []
  if (project.timedRangeCues.some(cue => cue.role === 'sound')) ids.push('soundCues')
  if (project.timedRangeCues.some(cue => cue.role === 'camera')) ids.push('cameraCues')
  return ids
}

async function renderPaperSheetLayer(context: SheetExportLayerContext): Promise<ImageData> {
  const canvas = createCanvas(context.width, context.height)
  const canvasContext = canvas.getContext('2d', { willReadFrequently: true })
  if (!canvasContext) return blankTransparentImageData(context.width, context.height)
  for (const page of context.pages) {
    const pageImage = sheetScanPageImage(context, page.pageId)
    if (!pageImage.imageUrl) continue
    const image = await loadImage(pageImage.imageUrl)
    const imageData = await warpSheetImageDataAsync(image, pageImage.settings, context.template, context.pageSize.widthPx)
    if (!imageData) continue
    canvasContext.putImageData(imageData, 0, page.pageIndex * context.pageSize.heightPx)
  }
  return canvasContext.getImageData(0, 0, context.width, context.height)
}

function sheetScanPageImage(context: SheetExportLayerContext, pageId: string): SheetPageImage {
  const page = context.project.sheetView.pages.find(item => item.pageId === pageId)
  const source = page?.sourceId
    ? context.project.sheetView.sources.find(item => item.sourceId === page.sourceId && item.kind === 'sheet-scan')
    : undefined
  return {
    imageUrl: source ? context.runtimeSourceImageUrls[source.sourceId] ?? resolveImageRefUrl(source.imageRef) : null,
    sourceId: source?.sourceId,
    imageRef: source?.imageRef,
    settings: {
      ...defaultSheetImageSettings(),
      ...(page?.alignment ?? {}),
      levelCorrection: page?.alignment?.levelCorrection ?? defaultLevelCorrectionSettings(),
    },
  }
}

async function renderTemplateImageLayer(context: SheetExportLayerContext): Promise<ImageData> {
  const imageRef = context.template.defaultUnderlay
    ? { ...context.template.defaultUnderlay.imageRef, assetPath: context.template.defaultUnderlay.assetPath }
    : null
  const imageUrl = imageRef ? resolveImageRefUrl(imageRef) : null
  if (!imageUrl) return blankTransparentImageData(context.width, context.height)
  const image = await loadImage(imageUrl)
  const sourceCanvas = createCanvas(context.pageSize.widthPx, context.pageSize.heightPx)
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true })
  if (!sourceContext) return blankTransparentImageData(context.width, context.height)
  const placement = context.template.defaultUnderlay?.placement
  if (placement?.mode === 'pixel-exact') {
    sourceContext.drawImage(image, placement.offsetXPx, placement.offsetYPx)
  } else {
    sourceContext.drawImage(image, 0, 0, context.pageSize.widthPx, context.pageSize.heightPx)
  }
  const pageLayer = sourceContext.getImageData(0, 0, context.pageSize.widthPx, context.pageSize.heightPx)
  return repeatPageLayer(context, pageLayer)
}

function renderTemplateDrawingLayer(
  context: SheetExportLayerContext,
  options: { includeStaticChrome: boolean; content: 'lines' | 'labels' },
): ImageData {
  const canvas = createCanvas(context.width, context.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return blankTransparentImageData(context.width, context.height)
  const chrome = buildTemplateChromeRenderModel(context.template, context.paperTracks, context.displayDurationFrames, {
    layoutOverrides: context.project.sheetView.layoutOverrides,
  })
  for (const page of context.pages) {
    const offsetY = page.pageIndex * context.pageSize.heightPx
    if (options.content === 'lines') {
      if (options.includeStaticChrome) drawTemplateStaticChrome(ctx, context, chrome, offsetY)
      drawTemplateGridHeaderLines(ctx, context, chrome, offsetY)
    } else {
      drawTemplateGridHeaderLabels(ctx, context, chrome, offsetY)
    }
    for (const region of context.template.regions.filter(isRenderableSheetTemplateGridRegion)) {
      const viewLayout = getSheetViewLayout(context.template)
      const frameOrigin = viewLayout.frameAxis?.type === 'continuous' || viewLayout.frameAxis?.type === 'infinite'
        ? page.frameStart
        : context.template.defaults.frameOrigin
      const model = buildTemplateGridOverlayRenderModel(context.template, region, {
        paperTracks: context.paperTracks,
        durationFrames: page.frameEnd - page.frameStart + 1,
        frameOrigin,
        pageFrameStart: page.frameStart,
        layoutOverrides: context.project.sheetView.layoutOverrides,
      })
      if (model) {
        if (options.content === 'lines') {
          for (const path of model.rowPaths) drawTemplateGridPath(ctx, context, path, offsetY)
          if (model.columnPath) drawTemplateGridPath(ctx, context, model.columnPath, offsetY)
        } else {
          ctx.fillStyle = '#2a302c'
          ctx.textBaseline = 'middle'
          for (const label of model.labels) {
            ctx.font = fontDeclaration(label.fontSizePx, TEMPLATE_CANVAS_FONT_FAMILY, SHEET_LABEL_FONT_WEIGHT)
            ctx.textAlign = label.textAnchor === 'end' ? 'right' : 'left'
            ctx.fillText(label.text, label.x * context.pageSize.widthPx, offsetY + label.y * context.pageSize.heightPx)
          }
          ctx.textBaseline = 'bottom'
          for (const item of [...model.frameNumbers, ...model.secondCounters]) {
            ctx.font = fontDeclaration(item.fontSizePx, TEMPLATE_CANVAS_FONT_FAMILY, SHEET_LABEL_FONT_WEIGHT)
            ctx.textAlign = item.textAnchor === 'end' ? 'right' : 'left'
            ctx.fillText(item.text, item.x * context.pageSize.widthPx, offsetY + item.y * context.pageSize.heightPx)
          }
          ctx.textAlign = 'center'
          for (const item of model.bottomTrackLabels) {
            ctx.globalAlpha = item.opacity
            ctx.font = fontDeclaration(item.fontSizePx, TEMPLATE_CANVAS_FONT_FAMILY, SHEET_LABEL_FONT_WEIGHT)
            ctx.fillText(item.text, item.x * context.pageSize.widthPx, offsetY + item.y * context.pageSize.heightPx)
          }
          ctx.globalAlpha = 1
        }
      }
      const layout = resolveSheetTemplateGridLayout(context.template, region, {
        paperTracks: context.paperTracks,
        durationFrames: page.frameEnd - page.frameStart + 1,
        frameOrigin,
        layoutOverrides: context.project.sheetView.layoutOverrides,
      })
      if (!layout || options.content !== 'lines') continue
      const rect = layout.rect
      const x = rect.x * context.pageSize.widthPx
      const y = offsetY + rect.y * context.pageSize.heightPx
      const w = rect.w * context.pageSize.widthPx
      drawInactiveRange(ctx, context, page, layout, frameOrigin, x, y, w)
    }
  }
  return ctx.getImageData(0, 0, context.width, context.height)
}

function drawTemplateStaticChrome(
  ctx: CanvasRenderingContext2D,
  context: SheetExportLayerContext,
  chrome: ReturnType<typeof buildTemplateChromeRenderModel>,
  offsetY: number,
) {
  ctx.fillStyle = 'transparent'
  ctx.strokeStyle = '#2f3430'
  ctx.lineWidth = 1
  ctx.setLineDash([])
  if (chrome.showOuterFrame) {
    ctx.strokeRect(
      0.02 * context.pageSize.widthPx,
      offsetY + 0.019 * context.pageSize.heightPx,
      0.96 * context.pageSize.widthPx,
      0.952 * context.pageSize.heightPx,
    )
  }
  for (const region of chrome.referenceRegions) {
    if (region.type === 'memo-area') continue
    ctx.strokeStyle = '#416b5a'
    ctx.setLineDash([6, 4])
    const pixelRect = projectedPixelRect(context, region.rect, offsetY)
    ctx.strokeRect(pixelRect.x + 0.5, pixelRect.y + 0.5, Math.max(0, pixelRect.w - 1), Math.max(0, pixelRect.h - 1))
  }
  for (const box of chrome.formBoxes) {
    const pixelRect = projectedPixelRect(context, box.rect, offsetY)
    ctx.strokeStyle = box.style.color
    ctx.lineWidth = box.style.widthPx
    ctx.setLineDash(box.style.dashPx)
    ctx.strokeRect(pixelRect.x, pixelRect.y, pixelRect.w, pixelRect.h)
  }
  ctx.setLineDash([])
}

function drawTemplateGridHeaderLines(
  ctx: CanvasRenderingContext2D,
  context: SheetExportLayerContext,
  chrome: ReturnType<typeof buildTemplateChromeRenderModel>,
  offsetY: number,
) {
  ctx.strokeStyle = '#2f3430'
  ctx.lineWidth = 1
  ctx.setLineDash([])
  for (const header of chrome.headers) {
    ctx.strokeRect(
      header.rect.x * context.pageSize.widthPx,
      offsetY + header.rect.y * context.pageSize.heightPx,
      header.rect.w * context.pageSize.widthPx,
      header.rect.h * context.pageSize.heightPx,
    )
    if (header.columnHeaderRect.h > 0) {
      ctx.strokeRect(
        header.columnHeaderRect.x * context.pageSize.widthPx,
        offsetY + header.columnHeaderRect.y * context.pageSize.heightPx,
        header.columnHeaderRect.w * context.pageSize.widthPx,
        header.columnHeaderRect.h * context.pageSize.heightPx,
      )
      ctx.beginPath()
      for (const x of header.columnBoundaries) {
        ctx.moveTo(x * context.pageSize.widthPx, offsetY + header.columnHeaderRect.y * context.pageSize.heightPx)
        ctx.lineTo(x * context.pageSize.widthPx, offsetY + (header.columnHeaderRect.y + header.columnHeaderRect.h) * context.pageSize.heightPx)
      }
      ctx.stroke()
    }
  }
}

function drawTemplateGridHeaderLabels(
  ctx: CanvasRenderingContext2D,
  context: SheetExportLayerContext,
  chrome: ReturnType<typeof buildTemplateChromeRenderModel>,
  offsetY: number,
) {
  ctx.fillStyle = '#1f2421'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const label of chrome.formLabels) {
    ctx.font = fontDeclaration(label.fontSizePx, TEMPLATE_CANVAS_FONT_FAMILY, label.fontWeight)
    ctx.textAlign = label.textAnchor === 'start' ? 'left' : label.textAnchor === 'end' ? 'right' : 'center'
    ctx.textBaseline = label.dominantBaseline === 'hanging' ? 'top' : label.dominantBaseline === 'text-after-edge' ? 'bottom' : 'middle'
    ctx.fillText(label.text, label.x * context.pageSize.widthPx, offsetY + label.y * context.pageSize.heightPx)
  }
  ctx.textBaseline = 'middle'
  for (const header of chrome.headers) {
    if (header.label) {
      ctx.font = fontDeclaration(header.labelFontSizePx, TEMPLATE_CANVAS_FONT_FAMILY, SHEET_LABEL_FONT_WEIGHT)
      ctx.fillText(header.label, header.labelX * context.pageSize.widthPx, offsetY + header.labelY * context.pageSize.heightPx)
    }
    for (const column of header.columns) {
      if (!column.label) continue
      ctx.font = fontDeclaration(column.fontSizePx, TEMPLATE_CANVAS_FONT_FAMILY, SHEET_LABEL_FONT_WEIGHT)
      ctx.fillText(column.label, column.x * context.pageSize.widthPx, offsetY + column.y * context.pageSize.heightPx)
    }
  }
}

function drawTemplateGridPath(
  ctx: CanvasRenderingContext2D,
  context: SheetExportLayerContext,
  path: TemplateGridPathRenderModel,
  offsetY: number,
) {
  const style = templateGridCanvasStyle(path.className)
  ctx.strokeStyle = path.style?.color ?? style.stroke
  ctx.lineWidth = path.style?.widthPx ?? style.lineWidth
  ctx.setLineDash(path.style?.dashPx ?? [])
  ctx.beginPath()
  for (const segment of path.segments) {
    ctx.moveTo(segment.x1 * context.pageSize.widthPx, offsetY + segment.y1 * context.pageSize.heightPx)
    ctx.lineTo(segment.x2 * context.pageSize.widthPx, offsetY + segment.y2 * context.pageSize.heightPx)
  }
  ctx.stroke()
  ctx.setLineDash([])
}

function templateGridCanvasStyle(className: string): { stroke: string; lineWidth: number } {
  if (className.includes('gridLineStrong')) return { stroke: '#101512', lineWidth: 2.6 }
  if (className.includes('gridLineMedium')) return { stroke: '#343b36', lineWidth: 1.8 }
  if (className.includes('gridLineRegular')) return { stroke: '#646a64', lineWidth: 1.25 }
  return { stroke: '#8b908a', lineWidth: 0.8 }
}

function drawInactiveRange(
  ctx: CanvasRenderingContext2D,
  context: SheetExportLayerContext,
  page: SheetPage,
  layout: NonNullable<ReturnType<typeof resolveSheetTemplateGridLayout>>,
  frameOrigin: number,
  x: number,
  y: number,
  w: number,
) {
  ctx.fillStyle = 'rgba(90, 96, 104, 0.16)'
  const inactiveRanges = [
    { frameStart: page.frameStart, frameEnd: Math.min(page.frameEnd, context.project.logicalSheet.frameOrigin - 1) },
    { frameStart: Math.max(page.frameStart, context.officialFrameEnd + 1), frameEnd: page.frameEnd },
  ].filter(range => range.frameEnd >= range.frameStart)
  for (const range of inactiveRanges) {
    const localStart = frameOrigin === page.frameStart ? range.frameStart : range.frameStart - page.frameStart + context.template.defaults.frameOrigin
    const localEnd = frameOrigin === page.frameStart ? range.frameEnd : range.frameEnd - page.frameStart + context.template.defaults.frameOrigin
    const start = Math.max(layout.frames.frameStart, localStart)
    const end = Math.min(layout.frames.frameEnd, localEnd)
    if (end < start) continue
    const rowIndex = start - layout.frames.frameStart
    ctx.fillRect(x, y + layout.frames.rowHeightPx * rowIndex, w, layout.frames.rowHeightPx * (end - start + 1))
  }
  ctx.fillStyle = '#202421'
}

function renderMetadataTextLayer(context: SheetExportLayerContext): ImageData {
  const canvas = createCanvas(context.width, context.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return blankTransparentImageData(context.width, context.height)
  for (const page of context.pages) {
    const offsetY = page.pageIndex * context.pageSize.heightPx
    for (const item of metadataTextRenderItemsForPage(context, page)) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(
        item.rect.x * context.pageSize.widthPx,
        offsetY + item.rect.y * context.pageSize.heightPx,
        item.rect.w * context.pageSize.widthPx,
        item.rect.h * context.pageSize.heightPx,
      )
      ctx.clip()
      ctx.fillStyle = '#1f2421'
      ctx.font = fontDeclaration(item.fontSizePx, SHEET_CANVAS_FONT_FAMILY, item.fontWeight)
      ctx.textAlign = item.textAnchor === 'start' ? 'left' : item.textAnchor === 'end' ? 'right' : 'center'
      ctx.textBaseline = item.dominantBaseline === 'hanging' || item.dominantBaseline === 'text-before-edge'
        ? 'top'
        : item.dominantBaseline === 'text-after-edge' ? 'bottom' : 'middle'
      item.lines.forEach((line, index) => {
        ctx.fillText(
          line,
          item.x * context.pageSize.widthPx,
          offsetY + item.y * context.pageSize.heightPx + index * item.lineHeightPx,
        )
      })
      ctx.restore()
    }
  }
  return ctx.getImageData(0, 0, context.width, context.height)
}

function renderTimingInputLayer(context: SheetExportLayerContext): ImageData {
  const canvas = createCanvas(context.width, context.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return blankTransparentImageData(context.width, context.height)
  for (const page of context.pages) {
    const offsetY = page.pageIndex * context.pageSize.heightPx
    ctx.strokeStyle = '#113c2d'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const item of continuationRenderItemsForPage(context, page)) {
      const first = item.path[0]
      if (!first) continue
      ctx.beginPath()
      for (const command of item.path) {
        const x = command.x * context.pageSize.widthPx
        const y = offsetY + command.y * context.pageSize.heightPx
        if (command.kind === 'move') {
          ctx.moveTo(x, y)
        } else if (command.kind === 'line') {
          ctx.lineTo(x, y)
        } else {
          ctx.bezierCurveTo(
            command.control1X * context.pageSize.widthPx,
            offsetY + command.control1Y * context.pageSize.heightPx,
            command.control2X * context.pageSize.widthPx,
            offsetY + command.control2Y * context.pageSize.heightPx,
            x,
            y,
          )
        }
      }
      ctx.lineWidth = Math.max(1, item.strokeWidth * context.pageSize.widthPx)
      ctx.stroke()
    }
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const item of inputTextRenderItemsForPage(context, page)) {
      const rect = item.rect
      const { x, y, w, h } = projectedPixelRect(context, rect, offsetY)
      ctx.fillStyle = 'rgba(238, 247, 242, 0.78)'
      ctx.fillRect(x + 1, y + 1, w - 2, h - 2)
      if (item.kind === 'cell') {
        ctx.fillStyle = '#113c2d'
        ctx.font = fontDeclaration(item.fontSizePx, SHEET_CANVAS_FONT_FAMILY, SHEET_EVENT_FONT_WEIGHT)
        ctx.fillText(item.text, x + w / 2, y + h / 2)
      } else {
        drawTimingEventSymbol(ctx, context, offsetY, item.kind, item.rect)
      }
    }
  }
  return ctx.getImageData(0, 0, context.width, context.height)
}

function drawTimingEventSymbol(
  ctx: CanvasRenderingContext2D,
  context: SheetExportLayerContext,
  offsetY: number,
  kind: 'blank' | 'inbetween' | 'reverse',
  rect: NormalizedRect,
) {
  const geometry = timingEventSymbolGeometry(kind, rect)
  const point = (x: number, y: number) => ({
    x: x * context.pageSize.widthPx,
    y: offsetY + y * context.pageSize.heightPx,
  })
  ctx.strokeStyle = '#113c2d'
  ctx.fillStyle = '#113c2d'
  ctx.lineWidth = Math.max(1, geometry.strokeWidth * context.pageSize.widthPx)
  ctx.lineCap = 'round'
  if (kind === 'blank') {
    for (const line of geometry.lines) {
      const start = point(line.x1, line.y1)
      const end = point(line.x2, line.y2)
      ctx.beginPath()
      ctx.moveTo(start.x, start.y)
      ctx.lineTo(end.x, end.y)
      ctx.stroke()
    }
    return
  }
  const center = point(geometry.center.x, geometry.center.y)
  const radiusX = geometry.radiusX * context.pageSize.widthPx
  const radiusY = geometry.radiusY * context.pageSize.heightPx
  ctx.beginPath()
  ctx.ellipse(center.x, center.y, radiusX, radiusY, 0, 0, Math.PI * 2)
  if (kind === 'reverse') ctx.fill()
  else ctx.stroke()
}

function projectedPixelRect(context: SheetExportLayerContext, rect: NormalizedRect, offsetY: number) {
  if (context.template.templateKind === 'digital-native') {
    return {
      x: rect.x * context.pageSize.widthPx,
      y: offsetY + rect.y * context.pageSize.heightPx,
      w: rect.w * context.pageSize.widthPx,
      h: rect.h * context.pageSize.heightPx,
    }
  }
  const edges = normalizedRectToPixelEdges(rect, context.pageSize)
  return {
    x: edges.left,
    y: offsetY + edges.top,
    w: edges.right - edges.left,
    h: edges.bottom - edges.top,
  }
}

function renderSoundCueLayer(context: SheetExportLayerContext): ImageData {
  const canvas = createCanvas(context.width, context.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return blankTransparentImageData(context.width, context.height)
  const textMeasurement = createCanvasTextMeasurementProvider(() => ctx)
  const cues = context.project.timedRangeCues.filter(cue => cue.role === 'sound')
  for (const page of context.pages) {
    const offsetY = page.pageIndex * context.pageSize.heightPx
    for (const cue of cues) {
      for (const segment of soundCueSegmentsForPage(context.template, page, cue, {
        paperTracks: context.paperTracks,
        layoutOverrides: context.project.sheetView.layoutOverrides,
      })) {
        const rect = projectedPixelRect(context, segment.rect, offsetY)
        ctx.fillStyle = 'rgba(37, 121, 94, 0.16)'
        ctx.strokeStyle = 'rgba(25, 91, 70, 0.74)'
        ctx.lineWidth = 1
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
        ctx.strokeRect(rect.x, rect.y, rect.w, rect.h)
        ctx.strokeStyle = 'rgba(18, 82, 62, 0.98)'
        ctx.lineWidth = 3
        if (segment.startsCue) drawCanvasLine(ctx, rect.x, rect.y, rect.x + rect.w, rect.y)
        if (segment.endsCue) drawCanvasLine(ctx, rect.x, rect.y + rect.h, rect.x + rect.w, rect.y + rect.h)
        const typography = context.template.regions.find(region => region.regionId === segment.regionId)?.grid?.typography
        const resolvedTypography = resolveGridTypographyFontSizes(context.template, context.pageSize, typography, { fontSizePx: 14, minFontSizePx: 6 })
        const textLayout = buildSoundCueTextLayout(
          segment.rect,
          context.pageSize,
          segment.startsCue ? cue.label : '',
          cue.text,
          {
            fontSizePx: resolvedTypography.fontSizePx,
            minFontSizePx: resolvedTypography.minFontSizePx,
            regionRect: segment.regionRect,
            fontFamily: SHEET_CANVAS_FONT_FAMILY,
            labelFontWeight: 850,
            textMeasurement,
          },
        )
        const textClipLeft = segment.regionRect.x * context.pageSize.widthPx
        const textClipWidth = segment.regionRect.w * context.pageSize.widthPx
        ctx.save()
        ctx.beginPath()
        ctx.rect(textClipLeft, offsetY, textClipWidth, context.pageSize.heightPx)
        ctx.clip()
        ctx.textAlign = 'center'
        ctx.textBaseline = 'alphabetic'
        for (const glyph of textLayout.labelGlyphs) {
          drawCueText(ctx, glyph.value, glyph.xPx, offsetY + glyph.yPx, textLayout.labelFontSizePx, 850)
        }
        for (const glyph of textLayout.textGlyphs) {
          drawCueText(ctx, glyph.value, glyph.xPx, offsetY + glyph.yPx, textLayout.textFontSizePx, 650)
        }
        ctx.restore()
      }
    }
  }
  return ctx.getImageData(0, 0, context.width, context.height)
}

function renderCameraCueLayer(context: SheetExportLayerContext): ImageData {
  const canvas = createCanvas(context.width, context.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return blankTransparentImageData(context.width, context.height)
  const cues = context.project.timedRangeCues.filter(cue => cue.role === 'camera')
  const pageWidth = context.pageSize.widthPx
  const pageHeight = context.pageSize.heightPx
  for (const page of context.pages) {
    const offsetY = page.pageIndex * pageHeight
    const layouts = buildCameraCuePageLayouts(context.template, page, cues, context.pageSize, {
      paperTracks: context.paperTracks,
      layoutOverrides: context.project.sheetView.layoutOverrides,
    })
    for (const { cue, segments } of layouts) {
      const camera = cue.camera ?? { shape: 'range' as const, points: [] }
      for (const segment of segments) {
        const centerX = (segment.rect.x + segment.rect.w / 2) * pageWidth
        const top = offsetY + segment.rect.y * pageHeight
        const bottom = offsetY + (segment.rect.y + segment.rect.h) * pageHeight
        ctx.strokeStyle = 'rgba(22, 67, 52, 0.96)'
        ctx.fillStyle = 'rgba(55, 112, 87, 0.13)'
        ctx.lineWidth = 1.5
        if (camera.shape === 'range') drawCanvasLine(ctx, centerX, top, centerX, bottom)
        if (camera.shape === 'fade-in' || camera.shape === 'fade-out') {
          drawNormalizedPolygon(ctx, cameraFadePolygonForSegment(cue, segment, camera.shape), pageWidth, pageHeight, offsetY, true)
        }
        if (camera.shape === 'overlap') {
          for (const polygon of cameraOverlapFillPolygonsForSegment(cue, segment)) {
            drawNormalizedPolygon(ctx, polygon, pageWidth, pageHeight, offsetY, true, false)
          }
          for (const path of cameraOverlapPathsForSegment(cue, segment)) {
            drawNormalizedPolyline(ctx, path, pageWidth, pageHeight, offsetY)
          }
          const pivotMark = cameraOverlapPivotMarkForSegment(cue, segment)
          if (pivotMark) {
            ctx.save()
            ctx.strokeStyle = 'rgba(255, 255, 252, 0.96)'
            ctx.lineWidth = 5
            drawCanvasLine(ctx, pivotMark.x1 * pageWidth, offsetY + pivotMark.y * pageHeight, pivotMark.x2 * pageWidth, offsetY + pivotMark.y * pageHeight)
            ctx.strokeStyle = 'rgba(22, 67, 52, 0.98)'
            ctx.lineWidth = 3
            drawCanvasLine(ctx, pivotMark.x1 * pageWidth, offsetY + pivotMark.y * pageHeight, pivotMark.x2 * pageWidth, offsetY + pivotMark.y * pageHeight)
            ctx.restore()
          }
        }
        const marker = cameraRangeMarkerGeometryForSegment(segment, context.pageSize)
        if (camera.shape === 'range' && segment.startsCue) {
          drawCanvasPolygon(ctx, marker.start.map(point => [point.x * pageWidth, offsetY + point.y * pageHeight] as [number, number]), '#194f3c')
        }
        if (camera.shape === 'range' && segment.endsCue) {
          drawCanvasPolygon(ctx, marker.end.map(point => [point.x * pageWidth, offsetY + point.y * pageHeight] as [number, number]), '#194f3c')
        }
      }
      for (const point of cameraCuePointLayoutsForPage(context.template, cue, segments, context.pageSize)) {
        ctx.save()
        ctx.beginPath()
        ctx.rect(
          point.regionRect.x * pageWidth,
          offsetY + point.regionRect.y * pageHeight,
          point.regionRect.w * pageWidth,
          point.regionRect.h * pageHeight,
        )
        ctx.clip()
        ctx.strokeStyle = 'rgba(47, 95, 76, 0.82)'
        ctx.lineWidth = 1.25
        drawCanvasLine(
          ctx,
          point.anchor.x * pageWidth,
          offsetY + point.anchor.y * pageHeight,
          (point.rect.x + point.rect.w / 2) * pageWidth,
          offsetY + point.anchor.y * pageHeight,
        )
        ctx.textAlign = 'center'
        ctx.textBaseline = 'alphabetic'
        drawCueText(ctx, point.point.label, point.textXpx, offsetY + point.textYpx, point.fontSizePx, 850)
        ctx.restore()
      }
    }
    for (const { label } of layouts) {
      if (!label) continue
      if (label.connector) {
        ctx.save()
        ctx.strokeStyle = 'rgba(47, 95, 76, 0.72)'
        ctx.lineWidth = 1
        ctx.setLineDash([2, 2])
        drawCanvasLine(
          ctx,
          label.connector.from.x * pageWidth,
          offsetY + label.connector.from.y * pageHeight,
          label.connector.to.x * pageWidth,
          offsetY + label.connector.to.y * pageHeight,
        )
        ctx.restore()
      }
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      ctx.save()
      ctx.beginPath()
      ctx.rect(
        label.regionRect.x * pageWidth,
        offsetY + label.regionRect.y * pageHeight,
        label.regionRect.w * pageWidth,
        label.regionRect.h * pageHeight,
      )
      ctx.clip()
      for (const glyph of label.glyphs) drawCueText(ctx, glyph.value, glyph.xPx, offsetY + glyph.yPx, label.fontSizePx, 850)
      ctx.restore()
    }
  }
  return ctx.getImageData(0, 0, context.width, context.height)
}

function drawCueText(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  fontSizePx: number,
  fontWeight: number,
) {
  ctx.font = fontDeclaration(fontSizePx, SHEET_CANVAS_FONT_FAMILY, fontWeight)
  ctx.lineJoin = 'round'
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(255, 255, 252, 0.94)'
  ctx.strokeText(value, x, y)
  ctx.fillStyle = '#173f32'
  ctx.fillText(value, x, y)
}

function drawCanvasLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
}

function drawNormalizedPolygon(
  ctx: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number }>,
  pageWidth: number,
  pageHeight: number,
  offsetY: number,
  fill: boolean,
  stroke = true,
) {
  const first = points[0]
  if (!first) return
  ctx.beginPath()
  ctx.moveTo(first.x * pageWidth, offsetY + first.y * pageHeight)
  for (const point of points.slice(1)) ctx.lineTo(point.x * pageWidth, offsetY + point.y * pageHeight)
  ctx.closePath()
  if (fill) ctx.fill()
  if (stroke) ctx.stroke()
}

function drawNormalizedPolyline(
  ctx: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number }>,
  pageWidth: number,
  pageHeight: number,
  offsetY: number,
) {
  const first = points[0]
  if (!first) return
  ctx.beginPath()
  ctx.moveTo(first.x * pageWidth, offsetY + first.y * pageHeight)
  for (const point of points.slice(1)) ctx.lineTo(point.x * pageWidth, offsetY + point.y * pageHeight)
  ctx.stroke()
}

function drawCanvasPolygon(ctx: CanvasRenderingContext2D, points: Array<[number, number]>, fillStyle: string) {
  const first = points[0]
  if (!first) return
  ctx.beginPath()
  ctx.moveTo(first[0], first[1])
  for (const point of points.slice(1)) ctx.lineTo(point[0], point[1])
  ctx.closePath()
  ctx.fillStyle = fillStyle
  ctx.fill()
}

function renderOverlayTrackLayer(context: SheetExportLayerContext): ImageData {
  const canvas = createCanvas(context.width, context.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return blankTransparentImageData(context.width, context.height)
  for (const page of context.pages) {
    const offsetY = page.pageIndex * context.pageSize.heightPx
    drawOverlayPaperTracks(ctx, context, page, offsetY)
    drawStackGuideLabels(ctx, context, page, offsetY)
  }
  return ctx.getImageData(0, 0, context.width, context.height)
}

function drawOverlayPaperTracks(
  ctx: CanvasRenderingContext2D,
  context: SheetExportLayerContext,
  page: SheetPage,
  offsetY: number,
) {
  for (const item of overlayPaperTrackRenderItems(context, page)) {
    const { track, column, label } = item
    const x = column.rect.x * context.pageSize.widthPx
    const y = offsetY + column.rect.y * context.pageSize.heightPx
    const w = column.rect.w * context.pageSize.widthPx
    const h = column.rect.h * context.pageSize.heightPx

    ctx.fillStyle = 'rgba(235, 241, 239, 0.62)'
    ctx.fillRect(x, y, w, h)
    ctx.strokeStyle = 'rgba(47, 80, 70, 0.72)'
    ctx.lineWidth = 1.2
    ctx.strokeRect(x, y, w, h)
    for (let row = 0; row <= column.frames.rowCount; row += 1) {
      const yy = y + (h * row) / column.frames.rowCount
      ctx.lineWidth = overlayGridCanvasLineWidth(gridRowLineClassName(column, row))
      ctx.beginPath()
      ctx.moveTo(x, yy)
      ctx.lineTo(x + w, yy)
      ctx.stroke()
    }

    drawFlagLabel(ctx, context, offsetY, {
      label: track.label,
      geometry: {
        anchorX: label.stemX,
        anchorY: column.rect.y,
        labelAttachX: label.labelAttachX,
        labelBottomY: label.labelBottomY,
        labelX: label.labelX,
        labelY: label.labelY,
        labelTextX: label.labelX + label.labelWidth / 2,
        labelWidth: label.labelWidth,
        labelHeight: label.labelHeight,
        displayText: label.displayText,
        fullText: label.fullText,
        truncated: label.truncated,
        fontSizePx: label.fontSizePx,
        fontFamily: label.fontFamily,
        fontWeight: label.fontWeight,
        radiusX: label.radiusX,
        radiusY: label.radiusY,
        connectorStrokeWidth: 3 / context.pageSize.heightPx,
      },
      color: '#2c6f54',
      align: 'center',
    })
  }
}

function overlayGridCanvasLineWidth(className: string): number {
  if (className.includes('gridLineStrong')) return 1.8
  if (className.includes('gridLineMedium')) return 1.35
  if (className.includes('gridLineRegular')) return 1.05
  return 0.75
}

function drawStackGuideLabels(
  ctx: CanvasRenderingContext2D,
  context: SheetExportLayerContext,
  page: SheetPage,
  offsetY: number,
) {
  for (const item of stackGuideFlagRenderItemsForPage(context, page)) {
    drawFlagLabel(ctx, context, offsetY, item)
  }
}

function drawFlagLabel(
  ctx: CanvasRenderingContext2D,
  context: SheetExportLayerContext,
  offsetY: number,
  input: {
    label: string
    geometry: FlagLabelGeometry
    color: string
    align: 'start' | 'center'
  },
) {
  const geometry = input.geometry
  const pageWidth = context.pageSize.widthPx
  const pageHeight = context.pageSize.heightPx
  const anchorX = geometry.anchorX * pageWidth
  const anchorY = offsetY + geometry.anchorY * pageHeight
  const labelBottomY = offsetY + geometry.labelBottomY * pageHeight
  const labelAttachX = geometry.labelAttachX * pageWidth
  const labelX = geometry.labelX * pageWidth
  const labelY = offsetY + geometry.labelY * pageHeight
  const labelW = geometry.labelWidth * pageWidth
  const labelH = geometry.labelHeight * pageHeight
  const radius = Math.max(1, geometry.radiusX * pageWidth)

  ctx.strokeStyle = input.color
  ctx.fillStyle = input.color
  ctx.lineWidth = Math.max(1, geometry.connectorStrokeWidth * pageHeight)
  ctx.beginPath()
  ctx.moveTo(anchorX, anchorY)
  ctx.lineTo(anchorX, labelBottomY)
  ctx.lineTo(labelAttachX, labelBottomY)
  ctx.stroke()

  roundedRectPath(ctx, labelX, labelY, labelW, labelH, radius)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = fontDeclaration(Math.max(8, geometry.fontSizePx), geometry.fontFamily, geometry.fontWeight)
  ctx.textBaseline = 'middle'
  ctx.textAlign = input.align === 'center' ? 'center' : 'left'
  const textX = input.align === 'center' ? labelX + labelW / 2 : geometry.labelTextX * pageWidth
  ctx.fillText(geometry.displayText, textX, labelY + labelH / 2)
}

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + w - radius, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
  ctx.lineTo(x + w, y + h - radius)
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
  ctx.lineTo(x + radius, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

function renderSheetAnnotationInkLayer(context: SheetExportLayerContext): ImageData {
  const canvas = createCanvas(context.width, context.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return blankTransparentImageData(context.width, context.height)
  for (const page of context.pages) {
    const offsetY = page.pageIndex * context.pageSize.heightPx
    for (const stroke of sheetAnnotationStrokes(context.project).filter(annotation => annotation.pageId === page.pageId && annotation.tool === 'pen')) {
      const [first, ...rest] = stroke.points
      if (!first) continue
      ctx.beginPath()
      ctx.moveTo(first.x * context.pageSize.widthPx, offsetY + first.y * context.pageSize.heightPx)
      for (const point of rest) ctx.lineTo(point.x * context.pageSize.widthPx, offsetY + point.y * context.pageSize.heightPx)
      ctx.strokeStyle = stroke.color
      ctx.lineWidth = Math.max(1, stroke.width * context.pageSize.widthPx)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.stroke()
    }
  }
  return ctx.getImageData(0, 0, context.width, context.height)
}

function renderTimelineMemoLayer(context: SheetExportLayerContext): ImageData {
  const canvas = createCanvas(context.width, context.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return blankTransparentImageData(context.width, context.height)
  const surface = { widthPx: context.pageSize.widthPx, heightPx: context.pageSize.heightPx }
  for (const page of context.pages) {
    const offsetY = page.pageIndex * context.pageSize.heightPx
    for (const memo of timelineMemos(context.project).slice().sort((left, right) => left.order - right.order)) {
      const segments = timelineMemoSegmentsForPage(context.template, page, memo, {
        paperTracks: context.project.logicalSheet.paperTracks.map(track => track.paperTrack),
        layoutOverrides: context.project.sheetView.layoutOverrides,
      })
      const anchorCell = timelineMemoAnchorCellForPage(context.template, page, memo, {
        paperTracks: context.project.logicalSheet.paperTracks.map(track => track.paperTrack),
        layoutOverrides: context.project.sheetView.layoutOverrides,
      })
      if (anchorCell) {
        const marker = timelineMemoAnchorMarkerRect(anchorCell.rect, surface)
        const markerX = marker.x * context.pageSize.widthPx
        const markerY = offsetY + marker.y * context.pageSize.heightPx
        const markerW = marker.w * context.pageSize.widthPx
        const markerH = marker.h * context.pageSize.heightPx
        ctx.fillStyle = '#2d6a57'
        ctx.strokeStyle = '#2d6a57'
        ctx.lineWidth = 1
        roundedRectPath(ctx, markerX, markerY, markerW, markerH, Math.min(markerW, markerH) * 0.32)
        ctx.fill()
        const firstSegment = segments[0]
        if (firstSegment && memoAnchorPresentation(memo) === 'camera-connector') {
          const connector = timelineMemoAnchorConnectorPoints(marker, firstSegment.rect, surface)
          if (connector) {
            drawNormalizedPolygon(
              ctx,
              connector.split(' ').map(point => {
                const [x = 0, y = 0] = point.split(',').map(Number)
                return { x, y }
              }),
              context.pageSize.widthPx,
              context.pageSize.heightPx,
              offsetY,
              true,
            )
          }
        }
      }
      for (const segment of segments) {
        ctx.save()
        ctx.beginPath()
        ctx.rect(
          segment.rect.x * context.pageSize.widthPx,
          offsetY + segment.rect.y * context.pageSize.heightPx,
          segment.rect.w * context.pageSize.widthPx,
          segment.rect.h * context.pageSize.heightPx,
        )
        ctx.clip()
        for (const stroke of memo.strokes) {
          const points = timelineMemoStrokePointsForSegment(segment, stroke.points)
          const [first, ...rest] = points
          if (!first) continue
          const firstPoint = timelineMemoPointToPagePoint(segment, first)
          ctx.beginPath()
          ctx.moveTo(firstPoint.x * context.pageSize.widthPx, offsetY + firstPoint.y * context.pageSize.heightPx)
          for (const point of rest) {
            const rendered = timelineMemoPointToPagePoint(segment, point)
            ctx.lineTo(rendered.x * context.pageSize.widthPx, offsetY + rendered.y * context.pageSize.heightPx)
          }
          ctx.strokeStyle = stroke.color
          ctx.lineWidth = Math.max(1, stroke.widthUnits * segment.rowHeightY * context.pageSize.heightPx)
          ctx.lineCap = 'round'
          ctx.lineJoin = 'round'
          ctx.stroke()
        }
        ctx.restore()
      }
    }
  }
  return ctx.getImageData(0, 0, context.width, context.height)
}

function renderAnnotationTextLayer(context: SheetExportLayerContext): ImageData {
  const canvas = createCanvas(context.width, context.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return blankTransparentImageData(context.width, context.height)
  for (const page of context.pages) {
    const offsetY = page.pageIndex * context.pageSize.heightPx
    for (const annotation of sheetAnnotationTexts(context.project).filter(item => item.pageId === page.pageId)) {
      const lines = annotationTextLines(annotation.text)
      if (lines.length === 0) continue
      const fontSize = resolveAnnotationTextFontSizePx(annotation, context.pageSize)
      const x = annotation.x * context.pageSize.widthPx
      const y = offsetY + annotation.y * context.pageSize.heightPx
      ctx.fillStyle = annotation.color
      ctx.font = fontDeclaration(fontSize, SHEET_CANVAS_FONT_FAMILY, SHEET_LABEL_FONT_WEIGHT)
      ctx.textBaseline = 'top'
      ctx.textAlign = 'left'
      lines.forEach((line, index) => {
        ctx.fillText(line, x, y + index * fontSize * 1.25)
      })
    }
    for (const memo of timelineMemos(context.project).slice().sort((left, right) => left.order - right.order)) {
      const segments = timelineMemoSegmentsForPage(context.template, page, memo, {
        paperTracks: context.project.logicalSheet.paperTracks.map(track => track.paperTrack),
        layoutOverrides: context.project.sheetView.layoutOverrides,
      })
      for (const segment of segments) {
        const texts = (memo.texts ?? []).filter(text => text.y >= segment.memoYStart && text.y < segment.memoYEnd)
        if (texts.length === 0) continue
        ctx.save()
        ctx.beginPath()
        ctx.rect(
          segment.rect.x * context.pageSize.widthPx,
          offsetY + segment.rect.y * context.pageSize.heightPx,
          segment.rect.w * context.pageSize.widthPx,
          segment.rect.h * context.pageSize.heightPx,
        )
        ctx.clip()
        for (const text of texts) {
          const lines = annotationTextLines(text.text)
          if (lines.length === 0) continue
          const point = timelineMemoPointToPagePoint(segment, text)
          const fontSize = Math.max(1, text.fontSizeUnits * segment.rowHeightY * context.pageSize.heightPx)
          const x = point.x * context.pageSize.widthPx
          const y = offsetY + point.y * context.pageSize.heightPx
          ctx.fillStyle = text.color
          ctx.font = fontDeclaration(fontSize, SHEET_CANVAS_FONT_FAMILY, SHEET_LABEL_FONT_WEIGHT)
          ctx.textBaseline = 'top'
          ctx.textAlign = 'left'
          lines.forEach((line, index) => ctx.fillText(line, x, y + index * fontSize * 1.25))
        }
        ctx.restore()
      }
    }
  }
  return ctx.getImageData(0, 0, context.width, context.height)
}

function repeatPageLayer(context: SheetExportLayerContext, pageLayer: ImageData): ImageData {
  const canvas = createCanvas(context.width, context.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return blankTransparentImageData(context.width, context.height)
  for (const page of context.pages) ctx.putImageData(pageLayer, 0, page.pageIndex * context.pageSize.heightPx)
  return ctx.getImageData(0, 0, context.width, context.height)
}

function compositeLayers(layers: SheetExportLayer[]): ImageData {
  const [first, ...rest] = layers
  if (!first) throw new Error('No export layers')
  return rest.reduce((bottom, layer) => alphaComposite(bottom, layerImageDataForComposite(layer)), first.imageData)
}

function layerImageDataForComposite(layer: SheetExportLayer): ImageData {
  return typeof layer.opacity === 'number' ? opacityImageData(layer.imageData, layer.opacity / 255) : layer.imageData
}

function opacityImageData(imageData: ImageData, opacity: number): ImageData {
  if (opacity >= 0.999) return imageData
  const output = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height)
  for (let index = 3; index < output.data.length; index += 4) {
    output.data[index] = Math.round(output.data[index] * opacity)
  }
  return output
}

function cropImageData(imageData: ImageData, x: number, y: number, width: number, height: number): ImageData {
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return blankTransparentImageData(width, height)
  const sourceCanvas = createCanvas(imageData.width, imageData.height)
  const sourceContext = sourceCanvas.getContext('2d')
  if (!sourceContext) return blankTransparentImageData(width, height)
  sourceContext.putImageData(imageData, 0, 0)
  context.drawImage(sourceCanvas, x, y, width, height, 0, 0, width, height)
  return context.getImageData(0, 0, width, height)
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

function blankTransparentImageData(width: number, height: number): ImageData {
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  return context ? context.createImageData(width, height) : new ImageData(width, height)
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

async function imageDataToBytes(imageData: ImageData, mimeType: string, quality?: number): Promise<Uint8Array> {
  const canvas = createCanvas(imageData.width, imageData.height)
  const context = canvas.getContext('2d')
  if (!context) return new Uint8Array()
  context.putImageData(imageData, 0, 0)
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, mimeType, quality))
  if (!blob) return new Uint8Array()
  return new Uint8Array(await blob.arrayBuffer())
}

function fontDeclaration(sizePx: number, family: string, weight: number): string {
  return textFontDeclaration({ family, sizePx, weight })
}

async function waitForSheetExportFonts(): Promise<void> {
  const fonts = typeof document === 'undefined' ? undefined : document.fonts
  if (!fonts) return
  try {
    const sampleText = '日本語ABC123'
    await Promise.all([
      fonts.load(`400 16px "LINE Seed JP"`, sampleText),
      fonts.load(`700 16px "LINE Seed JP"`, sampleText),
      fonts.load(`800 16px "LINE Seed JP"`, sampleText),
    ])
    await fonts.ready
  } catch {
    // Font fallback still produces an export; this only avoids racing self-hosted webfonts.
  }
}
