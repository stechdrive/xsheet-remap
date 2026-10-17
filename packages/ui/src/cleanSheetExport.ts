import {
  getSheetViewLayout,
  isRenderableSheetTemplateGridRegion,
  logicalSheetDisplayDurationFrames,
  normalizeMemoAppearance,
  timelineMemos,
  type CutProject,
  type NormalizedRect,
  type SheetTemplate,
} from '@xsheet-remap/core'
import { alphaComposite } from './psdWriter'
import type { Layer } from 'ag-psd'
import { drawSheetExportText, SheetPsdTextCollector, writeSheetTextPsd, type SheetTextOutput } from './sheetPsdText'
import type { SheetPageImage } from './appTypes'
import { defaultSheetImageSettings, loadImage, resolveImageRefUrl, warpSheetImageDataAsync } from './sheetImages'
import { defaultLevelCorrectionSettings } from './levelCorrection'
import {
  createSheetRenderModelContext,
  continuationRenderItemsForPages,
  hasOverlayRenderContent,
  inputTextRenderItemsForPage,
  referenceOnlyRenderItemsForPage,
  metadataTextRenderItemsForPage,
  overlayPaperTrackRenderItems,
  stackGuideFlagRenderItemsForPage,
  workRangeShadeRenderItemsForPage,
  type FlagLabelGeometry,
  type OverlayPaperTrackRenderItem,
  type SheetRenderCutGroupContext,
  type SheetRenderModelContext,
  type StackGuideFlagRenderItem,
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
import { annotationTextLines, annotationVerticalLayout, resolveAnnotationTextFontSizePx } from './annotationTextLayout'
import { drawVerticalGlyph } from './verticalTextLayout'
import { buildSoundCuePageTextLayouts } from './soundCueGeometry'
import {
  buildCameraCuePageLayouts,
  cameraCuePointLayoutsForPage,
  cameraInstructionSpans,
  cameraFadePolygonForSegment,
  cameraOverlapFillPolygonsForSegment,
  cameraOverlapPivotMarkForSegment,
  cameraOverlapPathsForSegment,
  cameraRangeMarkerGeometryForSegment,
  cameraRangePathsForSegment,
  type CameraRangePathCommand,
} from './cameraCueGeometry'
import { createCanvasTextMeasurementProvider, SHEET_TEXT_FONT_FAMILY, sharedTextMeasurementProvider, textFontDeclaration } from './textMetrics'
import {
  timelineMemoPointToPagePoint,
  timelineMemoSegmentsForPage,
  timelineMemoStrokePointsForSegment,
} from './timelineMemoGeometry'
import { buildTimelineMemoTextLayout } from './timelineMemoTextLayout'
import { positionMultilineTextLines } from './multilineTextLayout'
import { colorWithOpacity, timedRangeCueColumnPaint } from './timedRangeCueAppearance'
import { pageMemoRenderItemsForPage, templateMemoTargetGeometries } from './pageMemoProjection'

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
  | 'paperBackground'
  | 'secondBands'
  | 'paperSheet'
  | 'templateImage'
  | 'templateLines'
  | 'templateLabels'
  | 'workRangeShade'
  | 'overlayTracks'
  | 'metadataText'
  | 'timingInput'
  | 'soundCues'
  | 'cameraCues'
  | 'annotationBackground'
  | 'annotationInk'
  | 'annotationText'

export type TimedRangeCueExportLayerId = Extract<SheetExportLayerId, 'soundCues' | 'cameraCues'>

type SheetExportLayer = {
  id: SheetExportLayerId
  name: string
  imageData: ImageData
  opacity?: number
  opacityByPage?: Record<string, number>
  psdBase?: ImageData
  psdText?: SheetPsdTextCollector
}

export type SheetExportLayerDescriptor = Omit<SheetExportLayer, 'imageData' | 'psdBase' | 'psdText'>

type SheetExportLayerContext = SheetRenderModelContext<CutProject> & {
  runtimeSourceImageUrls: Record<string, string>
  textOutput?: SheetTextOutput
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
  await waitForSheetExportFonts(project, template, options.format === 'psd')
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
      const psdLayers: Layer[] = pageLayers.map(layer => {
        const texts = layer.psdText?.forPage(page.pageIndex) ?? []
        const base: Layer = { name: layer.name, imageData: layer.imageData, opacity: (layer.opacity ?? 255) / 255 }
        if (!texts.length || !layer.psdBase) return base
        return { name: layer.name, opened: false, children: [
          { ...base, name: layer.id === 'timingInput' ? 'ACTION/CELL記号' : '線・図形', imageData: cropImageData(layer.psdBase, 0, page.pageIndex * context.pageSize.heightPx, context.pageSize.widthPx, context.pageSize.heightPx) },
          ...texts,
        ] }
      })
      results.push({
        bytes: await writeSheetTextPsd(context.pageSize.widthPx, context.pageSize.heightPx,
          context.pageSize.dpi ?? template.page.dpi ?? 72, psdLayers, composite),
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
  const layers: SheetExportLayer[] = []
  for (const descriptor of descriptors) {
    const psdText = options.format === 'psd' ? new SheetPsdTextCollector(context.pageSize.widthPx, context.pageSize.heightPx) : undefined
    const imageData = await renderSheetExportLayer({ ...context, textOutput: psdText }, options, descriptor.id)
    const hasText = psdText && context.pages.some(page => psdText.forPage(page.pageIndex).length > 0)
    const psdBase = hasText ? await renderSheetExportLayer({ ...context, textOutput: 'omit' }, options, descriptor.id) : undefined
    layers.push({ ...descriptor, imageData, psdText, psdBase })
  }
  return layers
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
  const layers: SheetExportLayerDescriptor[] = [{ id: 'paperBackground', name: '用紙色' }]
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
    if (context.template.theme.paper.secondBands.enabled) layers.push({ id: 'secondBands', name: '秒背景帯' })
    layers.push({ id: 'templateLines', name: 'テンプレ罫線' })
    layers.push({ id: 'templateLabels', name: 'テンプレラベル' })
  }
  if (context.pages.some(page => workRangeShadeRenderItemsForPage(context, page).length > 0)) {
    layers.push({ id: 'workRangeShade', name: '尺外グレー' })
  }
  if (hasOverlayRenderContent(context)) layers.push({ id: 'overlayTracks', name: '追加トラック/ラベル' })
  layers.push({ id: 'metadataText', name: 'シート情報' })
  layers.push({ id: 'timingInput', name: 'ACTION/CELL入力' })
  for (const id of timedRangeCueExportLayerIds(context.project)) {
    layers.push({ id, name: id === 'soundCues' ? 'SOUND指示' : 'CAMERA指示' })
  }
  layers.push({ id: 'annotationBackground', name: 'メモ・背景' })
  layers.push({ id: 'annotationInk', name: 'メモ・手描き' })
  layers.push({ id: 'annotationText', name: 'メモ・テキスト' })
  return layers
}

async function renderSheetExportLayer(
  context: SheetExportLayerContext,
  options: SheetImageExportOptions,
  id: SheetExportLayerId,
): Promise<ImageData> {
  if (id === 'paperBackground') return solidColorImageData(context.width, context.height, context.template.theme.paper.color)
  if (id === 'templateImage') return renderTemplateImageLayer(context)
  if (id === 'paperSheet') return renderPaperSheetLayer(context)
  if (id === 'secondBands') return renderSecondBandLayer(context)
  if (id === 'templateLines') {
    return renderTemplateDrawingLayer(context, {
      includeStaticChrome: !options.includePaperSheet && !options.includeTemplateImage,
      content: 'lines',
    })
  }
  if (id === 'templateLabels') return renderTemplateDrawingLayer(context, { includeStaticChrome: false, content: 'labels' })
  if (id === 'workRangeShade') return renderWorkRangeShadeLayer(context)
  if (id === 'overlayTracks') return renderOverlayTrackLayer(context)
  if (id === 'metadataText') return renderMetadataTextLayer(context)
  if (id === 'timingInput') return renderTimingInputLayer(context)
  if (id === 'soundCues') return renderSoundCueLayer(context)
  if (id === 'cameraCues') return renderCameraCueLayer(context)
  if (id === 'annotationBackground') return renderTimelineMemoBackgroundLayer(context)
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
      ...(source?.alignment ?? page?.alignment ?? {}),
      levelCorrection: source?.alignment?.levelCorrection ?? page?.alignment?.levelCorrection ?? defaultLevelCorrectionSettings(),
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
    timelineLanes: context.timelineLanes,
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
        timelineLanes: context.timelineLanes,
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
          ctx.fillStyle = model.theme.ink.text
          ctx.textBaseline = 'middle'
          for (const label of model.labels) {
            ctx.font = fontDeclaration(label.fontSizePx, TEMPLATE_CANVAS_FONT_FAMILY, SHEET_LABEL_FONT_WEIGHT)
            ctx.textAlign = label.textAnchor === 'end' ? 'right' : 'left'
            drawExportLabel(context, ctx, label.text, label.x * context.pageSize.widthPx, offsetY + label.y * context.pageSize.heightPx, label.fontSizePx, SHEET_LABEL_FONT_WEIGHT, offsetY, ['欄名'])
          }
          ctx.textBaseline = 'bottom'
          for (const item of [...model.frameNumbers, ...model.secondCounters]) {
            ctx.font = fontDeclaration(item.fontSizePx, TEMPLATE_CANVAS_FONT_FAMILY, SHEET_LABEL_FONT_WEIGHT)
            ctx.textAlign = item.textAnchor === 'end' ? 'right' : 'left'
            drawExportLabel(context, ctx, item.text, item.x * context.pageSize.widthPx, offsetY + item.y * context.pageSize.heightPx, item.fontSizePx, SHEET_LABEL_FONT_WEIGHT, offsetY, ['フレーム・秒数'])
          }
          ctx.textAlign = 'center'
          for (const item of model.bottomTrackLabels) {
            ctx.globalAlpha = item.opacity
            ctx.font = fontDeclaration(item.fontSizePx, TEMPLATE_CANVAS_FONT_FAMILY, SHEET_LABEL_FONT_WEIGHT)
            drawExportLabel(context, ctx, item.text, item.x * context.pageSize.widthPx, offsetY + item.y * context.pageSize.heightPx, item.fontSizePx, SHEET_LABEL_FONT_WEIGHT, offsetY, ['フレーム・秒数'])
          }
          ctx.globalAlpha = 1
        }
      }
    }
  }
  return ctx.getImageData(0, 0, context.width, context.height)
}

function renderSecondBandLayer(context: SheetExportLayerContext): ImageData {
  const canvas = createCanvas(context.width, context.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return blankTransparentImageData(context.width, context.height)
  for (const page of context.pages) {
    const offsetY = page.pageIndex * context.pageSize.heightPx
    for (const region of context.template.regions.filter(isRenderableSheetTemplateGridRegion)) {
      const viewLayout = getSheetViewLayout(context.template)
      const frameOrigin = viewLayout.frameAxis?.type === 'continuous' || viewLayout.frameAxis?.type === 'infinite'
        ? page.frameStart
        : context.template.defaults.frameOrigin
      const model = buildTemplateGridOverlayRenderModel(context.template, region, {
        paperTracks: context.paperTracks,
        timelineLanes: context.timelineLanes,
        durationFrames: page.frameEnd - page.frameStart + 1,
        frameOrigin,
        pageFrameStart: page.frameStart,
        layoutOverrides: context.project.sheetView.layoutOverrides,
      })
      if (!model) continue
      for (const band of model.backgroundBands) {
        const rect = projectedPixelRect(context, band.rect, offsetY)
        ctx.globalAlpha = band.opacity
        ctx.fillStyle = band.color
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
      }
    }
  }
  ctx.globalAlpha = 1
  return ctx.getImageData(0, 0, context.width, context.height)
}

function drawTemplateStaticChrome(
  ctx: CanvasRenderingContext2D,
  context: SheetExportLayerContext,
  chrome: ReturnType<typeof buildTemplateChromeRenderModel>,
  offsetY: number,
) {
  ctx.fillStyle = 'transparent'
  ctx.strokeStyle = chrome.theme.ink.lines.outer
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
    ctx.strokeStyle = chrome.theme.ink.reference
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
  ctx.strokeStyle = chrome.theme.ink.lines.outer
  ctx.lineWidth = 1
  ctx.setLineDash([])
  for (const header of chrome.headers) {
    ctx.strokeStyle = chrome.theme.ink.lines.outer
    ctx.strokeRect(
      header.rect.x * context.pageSize.widthPx,
      offsetY + header.rect.y * context.pageSize.heightPx,
      header.rect.w * context.pageSize.widthPx,
      header.rect.h * context.pageSize.heightPx,
    )
    if (header.columnHeaderRect.h > 0) {
      ctx.strokeStyle = chrome.theme.ink.lines.outer
      ctx.strokeRect(
        header.columnHeaderRect.x * context.pageSize.widthPx,
        offsetY + header.columnHeaderRect.y * context.pageSize.heightPx,
        header.columnHeaderRect.w * context.pageSize.widthPx,
        header.columnHeaderRect.h * context.pageSize.heightPx,
      )
      ctx.beginPath()
      ctx.strokeStyle = chrome.theme.ink.lines.thin
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
  ctx.fillStyle = chrome.theme.ink.text
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const label of chrome.formLabels) {
    ctx.font = fontDeclaration(label.fontSizePx, TEMPLATE_CANVAS_FONT_FAMILY, label.fontWeight)
    ctx.textAlign = label.textAnchor === 'start' ? 'left' : label.textAnchor === 'end' ? 'right' : 'center'
    ctx.textBaseline = label.dominantBaseline === 'hanging' ? 'top' : label.dominantBaseline === 'text-after-edge' ? 'bottom' : 'middle'
    drawExportLabel(context, ctx, label.text, label.x * context.pageSize.widthPx, offsetY + label.y * context.pageSize.heightPx, label.fontSizePx, label.fontWeight, offsetY, ['欄名'])
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const header of chrome.headers) {
    if (header.label) {
      ctx.textBaseline = 'middle'
      ctx.font = fontDeclaration(header.labelFontSizePx, TEMPLATE_CANVAS_FONT_FAMILY, SHEET_LABEL_FONT_WEIGHT)
      drawExportLabel(context, ctx, header.label, header.labelX * context.pageSize.widthPx, offsetY + header.labelY * context.pageSize.heightPx, header.labelFontSizePx, SHEET_LABEL_FONT_WEIGHT, offsetY, ['欄名'])
    }
    for (const column of header.columns) {
      if (!column.label) continue
      ctx.textBaseline = column.dominantBaseline
      ctx.font = fontDeclaration(column.fontSizePx, TEMPLATE_CANVAS_FONT_FAMILY, SHEET_LABEL_FONT_WEIGHT)
      drawExportLabel(context, ctx, column.label, column.x * context.pageSize.widthPx, offsetY + column.y * context.pageSize.heightPx, column.fontSizePx, SHEET_LABEL_FONT_WEIGHT, offsetY, [header.label || '列名'])
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

function renderWorkRangeShadeLayer(context: SheetExportLayerContext): ImageData {
  const canvas = createCanvas(context.width, context.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return blankTransparentImageData(context.width, context.height)
  ctx.fillStyle = 'rgba(80, 80, 80, 0.18)'
  for (const page of context.pages) {
    const offsetY = page.pageIndex * context.pageSize.heightPx
    for (const item of workRangeShadeRenderItemsForPage(context, page)) {
      ctx.fillRect(
        item.rect.x * context.pageSize.widthPx,
        offsetY + item.rect.y * context.pageSize.heightPx,
        item.rect.w * context.pageSize.widthPx,
        item.rect.h * context.pageSize.heightPx,
      )
    }
  }
  return ctx.getImageData(0, 0, context.width, context.height)
}

function renderMetadataTextLayer(context: SheetExportLayerContext): ImageData {
  const canvas = createCanvas(context.width, context.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return blankTransparentImageData(context.width, context.height)
  const textMeasurement = createCanvasTextMeasurementProvider(() => ctx)
  for (const page of context.pages) {
    const offsetY = page.pageIndex * context.pageSize.heightPx
    for (const item of metadataTextRenderItemsForPage(context, page, textMeasurement)) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(
        item.clipRect.x * context.pageSize.widthPx,
        offsetY + item.clipRect.y * context.pageSize.heightPx,
        item.clipRect.w * context.pageSize.widthPx,
        item.clipRect.h * context.pageSize.heightPx,
      )
      ctx.clip()
      ctx.fillStyle = '#1f2421'
      ctx.font = fontDeclaration(item.fontSizePx, SHEET_CANVAS_FONT_FAMILY, item.fontWeight)
      ctx.textAlign = item.textAnchor === 'start' ? 'left' : item.textAnchor === 'end' ? 'right' : 'center'
      ctx.textBaseline = item.dominantBaseline === 'hanging' || item.dominantBaseline === 'text-before-edge'
        ? 'top'
        : item.dominantBaseline === 'text-after-edge' ? 'bottom' : item.dominantBaseline === 'alphabetic' ? 'alphabetic' : 'middle'
      const lines = positionMultilineTextLines(
        item.lines,
        item.x * context.pageSize.widthPx,
        offsetY + item.y * context.pageSize.heightPx,
        item.lineHeightPx,
      )
      drawSheetExportText(context.textOutput, ctx, {
        text: item.lines.join('\n'), x: item.x * context.pageSize.widthPx, y: offsetY + item.y * context.pageSize.heightPx,
        size: item.fontSizePx, weight: item.fontWeight, leading: item.lineHeightPx, offsetY, name: item.field,
        clips: [exportClipRect(context, item.clipRect, offsetY)],
      }, target => { for (const line of lines) target.fillText(line.text, line.xPx, line.yPx) })
      ctx.restore()
    }
  }
  return ctx.getImageData(0, 0, context.width, context.height)
}

function renderTimingInputLayer(context: SheetExportLayerContext): ImageData {
  const canvas = createCanvas(context.width, context.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return blankTransparentImageData(context.width, context.height)
  const continuationItemsByPage = continuationRenderItemsForPages(context, context.pages)
  for (const page of context.pages) {
    const offsetY = page.pageIndex * context.pageSize.heightPx
    ctx.strokeStyle = '#113c2d'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const item of continuationItemsByPage.get(page.pageId) ?? []) {
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
    for (const item of [...inputTextRenderItemsForPage(context, page), ...referenceOnlyRenderItemsForPage(context, page)]) {
      const rect = item.rect
      const { x, y, w, h } = projectedPixelRect(context, rect, offsetY)
      if (item.kind === 'cell') {
        ctx.save()
        ctx.beginPath()
        const layout = item.textLayout
        const clip = layout.clipRect
        ctx.rect(clip.x * context.pageSize.widthPx, offsetY + clip.y * context.pageSize.heightPx, clip.w * context.pageSize.widthPx, clip.h * context.pageSize.heightPx)
        ctx.clip()
        if (layout.reference) {
          const points = layout.reference.points
          ctx.beginPath()
          ctx.moveTo(points[0], offsetY + points[1])
          for (let index = 2; index < points.length; index += 2) ctx.lineTo(points[index], offsetY + points[index + 1])
          ctx.closePath()
          ctx.strokeStyle = '#113c2d'
          ctx.lineWidth = layout.reference.strokeWidthPx
          ctx.lineJoin = 'round'
          ctx.stroke()
        }
        ctx.fillStyle = '#113c2d'
        ctx.font = fontDeclaration(layout.fontSizePx, SHEET_CANVAS_FONT_FAMILY, SHEET_EVENT_FONT_WEIGHT)
        ctx.textBaseline = layout.baseline ?? 'middle'
        const textX = layout.textPosition ? layout.textPosition.x * context.pageSize.widthPx : x + w / 2
        const textY = layout.textPosition ? offsetY + layout.textPosition.y * context.pageSize.heightPx : y + h / 2
        if (layout.outlineWidthPx) {
          ctx.strokeStyle = '#fff'
          ctx.lineWidth = layout.outlineWidthPx
          ctx.lineJoin = 'round'
        }
        drawSheetExportText(context.textOutput, ctx, {
          text: layout.text, x: textX, y: textY, size: layout.fontSizePx, weight: SHEET_EVENT_FONT_WEIGHT, offsetY,
          name: `${String(item.frame).padStart(3, '0')}f：${item.text}`,
          groups: [(item.sheetRole ?? 'cell').toUpperCase(), item.paperTrack],
          clips: [exportClipRect(context, clip, offsetY)], stroke: Boolean(layout.outlineWidthPx),
        }, target => {
          if (layout.outlineWidthPx) target.strokeText(layout.text, textX, textY)
          target.fillText(layout.text, textX, textY)
        })
        ctx.restore()
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
  const geometry = timingEventSymbolGeometry(kind, rect, context.pageSize)
  const point = (x: number, y: number) => ({
    x,
    y: offsetY + y,
  })
  ctx.strokeStyle = '#113c2d'
  ctx.fillStyle = '#113c2d'
  ctx.lineWidth = geometry.strokeWidth
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
  const radiusX = geometry.radiusX
  const radiusY = geometry.radiusY
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

function exportClipRect(context: SheetExportLayerContext, rect: NormalizedRect, offsetY: number) {
  return { x: rect.x * context.pageSize.widthPx, y: offsetY + rect.y * context.pageSize.heightPx,
    w: rect.w * context.pageSize.widthPx, h: rect.h * context.pageSize.heightPx }
}

function renderSoundCueLayer(context: SheetExportLayerContext): ImageData {
  const canvas = createCanvas(context.width, context.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return blankTransparentImageData(context.width, context.height)
  const textMeasurement = createCanvasTextMeasurementProvider(() => ctx)
  const cues = context.project.timedRangeCues.filter(cue => cue.role === 'sound')
  const pageTextLayouts = buildSoundCuePageTextLayouts(
    context.template,
    context.pages,
    cues,
    context.pageSize,
    {
      paperTracks: context.paperTracks,
      timelineLanes: context.timelineLanes,
      layoutOverrides: context.project.sheetView.layoutOverrides,
      fontFamily: SHEET_CANVAS_FONT_FAMILY,
      labelFontWeight: 850,
      textMeasurement,
    },
  )
  for (const page of context.pages) {
    const offsetY = page.pageIndex * context.pageSize.heightPx
    for (const { cue, segment, textLayout } of pageTextLayouts.filter(item => item.pageId === page.pageId)) {
      const rect = projectedPixelRect(context, segment.rect, offsetY)
      const paint = timedRangeCueColumnPaint(context.template.theme, 'sound', segment.columnIndex)
      ctx.fillStyle = colorWithOpacity(paint.fillColor, paint.fillOpacity)
      ctx.strokeStyle = paint.strokeColor
      ctx.lineWidth = 1
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h)
      ctx.strokeStyle = paint.strokeColor
      ctx.lineWidth = 3
      if (segment.startsCue) drawCanvasLine(ctx, rect.x, rect.y, rect.x + rect.w, rect.y)
      if (segment.endsCue) drawCanvasLine(ctx, rect.x, rect.y + rect.h, rect.x + rect.w, rect.y + rect.h)
      const textClipLeft = segment.regionRect.x * context.pageSize.widthPx
      const textClipWidth = segment.regionRect.w * context.pageSize.widthPx
      ctx.save()
      ctx.beginPath()
      ctx.rect(textClipLeft, offsetY, textClipWidth, context.pageSize.heightPx)
      ctx.clip()
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      for (const part of [
        { glyphs: textLayout.labelGlyphs, size: textLayout.labelFontSizePx, weight: 850, vertical: textLayout.labelOrientation === 'vertical', name: '話者' },
        { glyphs: textLayout.textGlyphs, size: textLayout.textFontSizePx, weight: 650, vertical: true, name: 'セリフ' },
      ]) {
        const first = part.glyphs[0]
        if (!first) continue
        setCueTextStyle(ctx, part.size, part.weight, paint.textColor)
        drawSheetExportText(context.textOutput, ctx, {
          text: part.glyphs.map(g => g.value).join(''), x: first.xPx, y: offsetY + first.yPx,
          size: part.size, weight: part.weight, offsetY, vertical: part.vertical,
          ...(part.vertical ? { glyphs: part.glyphs.map(g => ({ ...g, yPx: offsetY + g.yPx })) } : {}),
          name: part.name, groups: [`${String(cue.frameStart).padStart(3, '0')}f：${cue.label || 'SOUND'}`],
          clips: [{ x: textClipLeft, y: offsetY, w: textClipWidth, h: context.pageSize.heightPx }], stroke: true,
        }, target => {
          for (const glyph of part.glyphs) drawCueText(target, glyph.value, glyph.xPx, offsetY + glyph.yPx, part.size, part.weight, paint.textColor, part.vertical)
        })
      }
      ctx.restore()
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
      timelineLanes: context.timelineLanes,
      layoutOverrides: context.project.sheetView.layoutOverrides,
    })
    for (const { cue, segments } of layouts) {
      const instructionSpans = cameraInstructionSpans(cue)
      const cuePaint = timedRangeCueColumnPaint(context.template.theme, 'camera', segments[0]?.columnIndex ?? 0)
      for (const segment of segments) {
        const paint = timedRangeCueColumnPaint(context.template.theme, 'camera', segment.columnIndex)
        ctx.strokeStyle = paint.strokeColor
        ctx.fillStyle = colorWithOpacity(paint.fillColor, paint.fillOpacity)
        ctx.lineWidth = 1.5
        for (const path of cameraRangePathsForSegment(cue, segment, context.pageSize)) {
          drawNormalizedCameraRangePath(ctx, path.commands, pageWidth, pageHeight, offsetY)
        }
        const spans = instructionSpans.filter(span => span.frameEndExclusive > segment.frameStart && span.frameStart < segment.frameEnd + 1)
        for (const span of spans) {
          if (span.kind === 'fade-in' || span.kind === 'fade-out') {
            drawNormalizedPolygon(ctx, cameraFadePolygonForSegment(cue, segment, span.kind, span), pageWidth, pageHeight, offsetY, true)
          }
          if (span.kind !== 'overlap') continue
          for (const polygon of cameraOverlapFillPolygonsForSegment(cue, segment, span)) {
            drawNormalizedPolygon(ctx, polygon, pageWidth, pageHeight, offsetY, true, false)
          }
          for (const path of cameraOverlapPathsForSegment(cue, segment, span)) {
            drawNormalizedPolyline(ctx, path, pageWidth, pageHeight, offsetY)
          }
          const pivotMark = cameraOverlapPivotMarkForSegment(cue, segment, span)
          if (pivotMark) {
            ctx.save()
            ctx.strokeStyle = 'rgba(255, 255, 252, 0.96)'
            ctx.lineWidth = 5
            drawCanvasLine(ctx, pivotMark.x1 * pageWidth, offsetY + pivotMark.y * pageHeight, pivotMark.x2 * pageWidth, offsetY + pivotMark.y * pageHeight)
            ctx.strokeStyle = paint.strokeColor
            ctx.lineWidth = 3
            drawCanvasLine(ctx, pivotMark.x1 * pageWidth, offsetY + pivotMark.y * pageHeight, pivotMark.x2 * pageWidth, offsetY + pivotMark.y * pageHeight)
            ctx.restore()
          }
        }
        const startKind = instructionSpans[0]?.kind
        const endKind = instructionSpans.at(-1)?.kind
        const marker = cameraRangeMarkerGeometryForSegment(segment, context.pageSize)
        if ((startKind === 'straight' || startKind === 'wave') && segment.startsCue) {
          drawCanvasPolygon(ctx, marker.start.map(point => [point.x * pageWidth, offsetY + point.y * pageHeight] as [number, number]), paint.strokeColor)
        }
        if ((endKind === 'straight' || endKind === 'wave') && segment.endsCue) {
          drawCanvasPolygon(ctx, marker.end.map(point => [point.x * pageWidth, offsetY + point.y * pageHeight] as [number, number]), paint.strokeColor)
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
        if (point.mark) {
          ctx.strokeStyle = 'rgba(255, 255, 252, 0.96)'
          ctx.lineWidth = 5
          drawCanvasLine(
            ctx,
            point.mark.x1 * pageWidth,
            offsetY + point.mark.y * pageHeight,
            point.mark.x2 * pageWidth,
            offsetY + point.mark.y * pageHeight,
          )
          ctx.strokeStyle = cuePaint.strokeColor
          ctx.lineWidth = 3
          drawCanvasLine(
            ctx,
            point.mark.x1 * pageWidth,
            offsetY + point.mark.y * pageHeight,
            point.mark.x2 * pageWidth,
            offsetY + point.mark.y * pageHeight,
          )
        }
        if (point.connector) {
          ctx.strokeStyle = cuePaint.strokeColor
          ctx.lineWidth = 1.25
          drawCanvasLine(
            ctx,
            point.connector.from.x * pageWidth,
            offsetY + point.connector.from.y * pageHeight,
            point.connector.to.x * pageWidth,
            offsetY + point.connector.to.y * pageHeight,
          )
        }
        if (point.point.label) {
          ctx.textAlign = 'center'
          ctx.textBaseline = 'alphabetic'
          setCueTextStyle(ctx, point.fontSizePx, 850, cuePaint.textColor)
          drawSheetExportText(context.textOutput, ctx, {
            text: point.point.label, x: point.textXpx, y: offsetY + point.textYpx, size: point.fontSizePx,
            weight: 850, offsetY, stroke: true, clips: [exportClipRect(context, point.regionRect, offsetY)],
            groups: [`${cue.frameStart}f：${cue.label || 'CAMERA'}`],
          }, target => drawCueText(target, point.point.label, point.textXpx, offsetY + point.textYpx, point.fontSizePx, 850, cuePaint.textColor))
        }
        ctx.restore()
      }
    }
    for (const { label, segments } of layouts) {
      if (!label) continue
      const paint = timedRangeCueColumnPaint(context.template.theme, 'camera', segments[0]?.columnIndex ?? 0)
      if (label.connector) {
        ctx.save()
        ctx.strokeStyle = paint.strokeColor
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
      const labelRect = projectedPixelRect(context, label.rect, offsetY)
      ctx.fillStyle = colorWithOpacity(paint.fillColor, paint.fillOpacity)
      ctx.strokeStyle = paint.strokeColor
      ctx.lineWidth = 1
      ctx.fillRect(labelRect.x, labelRect.y, labelRect.w, labelRect.h)
      ctx.strokeRect(labelRect.x, labelRect.y, labelRect.w, labelRect.h)
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
      const first = label.glyphs[0]
      if (first) {
        setCueTextStyle(ctx, label.fontSizePx, 850, paint.textColor)
        drawSheetExportText(context.textOutput, ctx, {
          text: label.glyphs.map(g => g.value).join('\n'), x: first.xPx, y: offsetY + first.yPx,
          size: label.fontSizePx, weight: 850, offsetY, stroke: true,
          leading: label.glyphs.length > 1 ? label.glyphs[1].yPx - first.yPx : label.fontSizePx * 1.25,
          clips: [exportClipRect(context, label.regionRect, offsetY)],
        }, target => { for (const glyph of label.glyphs) drawCueText(target, glyph.value, glyph.xPx, offsetY + glyph.yPx, label.fontSizePx, 850, paint.textColor) })
      }
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
  color: string,
  vertical = false,
) {
  setCueTextStyle(ctx, fontSizePx, fontWeight, color)
  if (vertical) drawVerticalGlyph(ctx, value, x, y, fontSizePx, fontWeight, true)
  else {
    ctx.strokeText(value, x, y)
    ctx.fillText(value, x, y)
  }
}

function setCueTextStyle(ctx: CanvasRenderingContext2D, fontSizePx: number, fontWeight: number, color: string) {
  ctx.font = fontDeclaration(fontSizePx, SHEET_CANVAS_FONT_FAMILY, fontWeight)
  ctx.lineJoin = 'round'
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(255, 255, 252, 0.94)'
  ctx.fillStyle = color
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

function drawNormalizedCameraRangePath(
  ctx: CanvasRenderingContext2D,
  commands: CameraRangePathCommand[],
  pageWidth: number,
  pageHeight: number,
  offsetY: number,
) {
  if (commands.length === 0) return
  ctx.beginPath()
  for (const command of commands) {
    const x = command.x * pageWidth
    const y = offsetY + command.y * pageHeight
    if (command.kind === 'move') ctx.moveTo(x, y)
    else if (command.kind === 'line') ctx.lineTo(x, y)
    else ctx.bezierCurveTo(
      command.control1X * pageWidth,
      offsetY + command.control1Y * pageHeight,
      command.control2X * pageWidth,
      offsetY + command.control2Y * pageHeight,
      x,
      y,
    )
  }
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
    const overlayItems = overlayPaperTrackRenderItems(context, page)
    drawOverlayPaperTracks(ctx, context, overlayItems, offsetY)
    const flagItems = [
      ...overlayItems.map(item => overlayTrackFlagRenderItem(context, item)),
      ...stackGuideFlagRenderItemsForPage(context, page),
    ]
    for (const item of flagItems) drawFlagConnector(ctx, context, offsetY, item)
    for (const item of flagItems) drawFlagBody(ctx, context, offsetY, item)
  }
  return ctx.getImageData(0, 0, context.width, context.height)
}

function drawOverlayPaperTracks(
  ctx: CanvasRenderingContext2D,
  context: SheetExportLayerContext,
  items: OverlayPaperTrackRenderItem[],
  offsetY: number,
) {
  for (const { column } of items) {
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
  }
}

function overlayTrackFlagRenderItem(
  context: SheetExportLayerContext,
  { track, column, label }: OverlayPaperTrackRenderItem,
): StackGuideFlagRenderItem {
  return {
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
  }
}

function overlayGridCanvasLineWidth(className: string): number {
  if (className.includes('gridLineStrong')) return 1.8
  if (className.includes('gridLineMedium')) return 1.35
  if (className.includes('gridLineRegular')) return 1.05
  return 0.75
}

function drawFlagConnector(
  ctx: CanvasRenderingContext2D,
  context: SheetExportLayerContext,
  offsetY: number,
  input: StackGuideFlagRenderItem,
) {
  const geometry = input.geometry
  const pageWidth = context.pageSize.widthPx
  const pageHeight = context.pageSize.heightPx
  const anchorX = geometry.anchorX * pageWidth
  const anchorY = offsetY + geometry.anchorY * pageHeight
  const labelBottomY = offsetY + geometry.labelBottomY * pageHeight
  const labelAttachX = geometry.labelAttachX * pageWidth
  ctx.strokeStyle = input.color
  ctx.lineWidth = Math.max(1, geometry.connectorStrokeWidth * pageHeight)
  ctx.beginPath()
  ctx.moveTo(anchorX, anchorY)
  ctx.lineTo(anchorX, labelBottomY)
  ctx.lineTo(labelAttachX, labelBottomY)
  ctx.stroke()
}

function drawFlagBody(
  ctx: CanvasRenderingContext2D,
  context: SheetExportLayerContext,
  offsetY: number,
  input: StackGuideFlagRenderItem,
) {
  const geometry: FlagLabelGeometry = input.geometry
  const pageWidth = context.pageSize.widthPx
  const pageHeight = context.pageSize.heightPx
  const labelX = geometry.labelX * pageWidth
  const labelY = offsetY + geometry.labelY * pageHeight
  const labelW = geometry.labelWidth * pageWidth
  const labelH = geometry.labelHeight * pageHeight
  const radius = Math.max(1, geometry.radiusX * pageWidth)

  ctx.fillStyle = input.color
  roundedRectPath(ctx, labelX, labelY, labelW, labelH, radius)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = fontDeclaration(Math.max(8, geometry.fontSizePx), geometry.fontFamily, geometry.fontWeight)
  ctx.textBaseline = 'middle'
  ctx.textAlign = input.align === 'center' ? 'center' : 'left'
  const textX = input.align === 'center' ? labelX + labelW / 2 : geometry.labelTextX * pageWidth
  drawExportLabel(context, ctx, geometry.displayText, textX, labelY + labelH / 2, Math.max(8, geometry.fontSizePx), geometry.fontWeight, offsetY)
}

function drawExportLabel(context: SheetExportLayerContext, ctx: CanvasRenderingContext2D, text: string,
  x: number, y: number, size: number, weight: number, offsetY: number, groups?: string[]) {
  drawSheetExportText(context.textOutput, ctx, { text, x, y, size, weight, offsetY, groups }, target => target.fillText(text, x, y))
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
  const targetGeometries = templateMemoTargetGeometries(context.template, {
    paperTracks: context.paperTracks,
    timelineLanes: context.timelineLanes,
    durationFrames: logicalSheetDisplayDurationFrames(context.project.logicalSheet),
    layoutOverrides: context.project.sheetView.layoutOverrides,
  })
  for (const page of context.pages) {
    const offsetY = page.pageIndex * context.pageSize.heightPx
    for (const item of pageMemoRenderItemsForPage(context.project, page, targetGeometries).strokes) {
      const [first, ...rest] = item.points
      if (!first) continue
      ctx.beginPath()
      ctx.moveTo(first.x * context.pageSize.widthPx, offsetY + first.y * context.pageSize.heightPx)
      for (const point of rest) ctx.lineTo(point.x * context.pageSize.widthPx, offsetY + point.y * context.pageSize.heightPx)
      ctx.strokeStyle = item.stroke.color
      ctx.lineWidth = Math.max(1, item.stroke.width * Math.min(context.pageSize.widthPx, context.pageSize.heightPx))
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.stroke()
    }
  }
  return ctx.getImageData(0, 0, context.width, context.height)
}

// A translated memo may reach the paper edge, but must never bleed into the
// next page of a combined PNG/PSD. The app's page surface clips the same edge.
function clipTimelineMemoPage(ctx: CanvasRenderingContext2D, context: SheetExportLayerContext, offsetY: number) {
  ctx.beginPath()
  ctx.rect(0, offsetY, context.pageSize.widthPx, context.pageSize.heightPx)
  ctx.clip()
}

function renderTimelineMemoLayer(context: SheetExportLayerContext): ImageData {
  const canvas = createCanvas(context.width, context.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return blankTransparentImageData(context.width, context.height)
  for (const page of context.pages) {
    const offsetY = page.pageIndex * context.pageSize.heightPx
    for (const memo of timelineMemos(context.project).slice().sort((left, right) => left.order - right.order)) {
      const appearance = normalizeMemoAppearance(memo.appearance)
      const segments = timelineMemoSegmentsForPage(context.template, page, memo, {
        paperTracks: context.paperTracks,
        timelineLanes: context.timelineLanes,
        layoutOverrides: context.project.sheetView.layoutOverrides,
      })
      for (const segment of segments) {
        ctx.save()
        clipTimelineMemoPage(ctx, context, offsetY)
        ctx.globalAlpha = appearance.inkOpacity
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

function renderTimelineMemoBackgroundLayer(context: SheetExportLayerContext): ImageData {
  const canvas = createCanvas(context.width, context.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return blankTransparentImageData(context.width, context.height)
  for (const page of context.pages) {
    const offsetY = page.pageIndex * context.pageSize.heightPx
    for (const memo of timelineMemos(context.project).slice().sort((left, right) => left.order - right.order)) {
      const appearance = normalizeMemoAppearance(memo.appearance)
      if (!appearance.background.enabled || appearance.background.opacity <= 0) continue
      const segments = timelineMemoSegmentsForPage(context.template, page, memo, {
        paperTracks: context.paperTracks,
        timelineLanes: context.timelineLanes,
        layoutOverrides: context.project.sheetView.layoutOverrides,
      })
      ctx.save()
      clipTimelineMemoPage(ctx, context, offsetY)
      ctx.globalAlpha = appearance.background.opacity
      ctx.fillStyle = appearance.background.color
      for (const segment of segments) {
        ctx.fillRect(
          segment.rect.x * context.pageSize.widthPx,
          offsetY + segment.rect.y * context.pageSize.heightPx,
          segment.rect.w * context.pageSize.widthPx,
          segment.rect.h * context.pageSize.heightPx,
        )
      }
      ctx.restore()
    }
  }
  return ctx.getImageData(0, 0, context.width, context.height)
}

function renderAnnotationTextLayer(context: SheetExportLayerContext): ImageData {
  const canvas = createCanvas(context.width, context.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return blankTransparentImageData(context.width, context.height)
  const targetGeometries = templateMemoTargetGeometries(context.template, {
    paperTracks: context.paperTracks,
    timelineLanes: context.timelineLanes,
    durationFrames: logicalSheetDisplayDurationFrames(context.project.logicalSheet),
    layoutOverrides: context.project.sheetView.layoutOverrides,
  })
  for (const page of context.pages) {
    const offsetY = page.pageIndex * context.pageSize.heightPx
    for (const item of pageMemoRenderItemsForPage(context.project, page, targetGeometries).texts) {
      const annotation = item.annotation
      const lines = annotationTextLines(annotation.text)
      if (lines.length === 0) continue
      const fontSize = resolveAnnotationTextFontSizePx(annotation, context.pageSize)
      const x = item.x * context.pageSize.widthPx
      const y = offsetY + item.y * context.pageSize.heightPx
      ctx.fillStyle = annotation.color
      if (annotation.writingMode === 'vertical') {
        const glyphs = annotationVerticalLayout(annotation, context.pageSize, item).glyphs.map(g => ({ ...g, yPx: offsetY + g.yPx }))
        drawSheetExportText(context.textOutput, ctx, {
          text: annotation.text, x, y, size: fontSize, weight: SHEET_LABEL_FONT_WEIGHT, offsetY, vertical: true, glyphs,
        }, target => { for (const glyph of glyphs) drawVerticalGlyph(target, glyph.value, glyph.xPx, glyph.yPx, fontSize) })
        continue
      }
      ctx.font = fontDeclaration(fontSize, SHEET_CANVAS_FONT_FAMILY, SHEET_LABEL_FONT_WEIGHT)
      ctx.textBaseline = 'top'
      ctx.textAlign = 'left'
      drawSheetExportText(context.textOutput, ctx, { text: lines.join('\n'), x, y, size: fontSize, weight: SHEET_LABEL_FONT_WEIGHT, offsetY }, target => {
        for (const line of positionMultilineTextLines(lines, x, y, fontSize * 1.25)) target.fillText(line.text, line.xPx, line.yPx)
      })
    }
    for (const memo of timelineMemos(context.project).slice().sort((left, right) => left.order - right.order)) {
      const appearance = normalizeMemoAppearance(memo.appearance)
      const segments = timelineMemoSegmentsForPage(context.template, page, memo, {
        paperTracks: context.paperTracks,
        timelineLanes: context.timelineLanes,
        layoutOverrides: context.project.sheetView.layoutOverrides,
      })
      for (const segment of segments) {
        const texts = (memo.texts ?? []).filter(text => text.y >= segment.memoYStart && text.y < segment.memoYEnd)
        if (texts.length === 0) continue
        ctx.save()
        clipTimelineMemoPage(ctx, context, offsetY)
        ctx.globalAlpha = appearance.textOpacity
        ctx.beginPath()
        ctx.rect(
          segment.rect.x * context.pageSize.widthPx,
          offsetY + segment.rect.y * context.pageSize.heightPx,
          segment.rect.w * context.pageSize.widthPx,
          segment.rect.h * context.pageSize.heightPx,
        )
        ctx.clip()
        for (const text of texts) {
          const layout = buildTimelineMemoTextLayout(segment, text, appearance.text.fontSizeUnits, context.pageSize, undefined, appearance.text.writingMode)
          if (layout.lines.length === 0) continue
          ctx.fillStyle = appearance.text.color
          const clips = [exportClipRect(context, segment.rect, offsetY),
            { x: 0, y: offsetY, w: context.pageSize.widthPx, h: context.pageSize.heightPx }]
          if (layout.glyphs) {
            const glyphs = layout.glyphs.map(g => ({ ...g, yPx: offsetY + g.yPx }))
            drawSheetExportText(context.textOutput, ctx, {
              text: text.text, x: layout.xPx, y: offsetY + layout.yPx, size: layout.fontSizePx,
              weight: SHEET_LABEL_FONT_WEIGHT, offsetY, vertical: true, glyphs, clips,
              groups: [`${memo.anchor.role.toUpperCase()} ${memo.anchor.paperTrack ?? ''} ${memo.anchor.frame}f`],
            }, target => { for (const glyph of glyphs) drawVerticalGlyph(target, glyph.value, glyph.xPx, glyph.yPx, layout.fontSizePx) })
            continue
          }
          ctx.font = fontDeclaration(layout.fontSizePx, SHEET_CANVAS_FONT_FAMILY, SHEET_LABEL_FONT_WEIGHT)
          ctx.textBaseline = 'top'
          ctx.textAlign = 'left'
          drawSheetExportText(context.textOutput, ctx, {
            text: layout.lines.join('\n'), x: layout.xPx, y: offsetY + layout.yPx, size: layout.fontSizePx,
            weight: SHEET_LABEL_FONT_WEIGHT, leading: layout.lineHeightPx, offsetY, clips,
            groups: [`${memo.anchor.role.toUpperCase()} ${memo.anchor.paperTrack ?? ''} ${memo.anchor.frame}f`],
          }, target => {
            for (const line of positionMultilineTextLines(layout.lines, layout.xPx, offsetY + layout.yPx, layout.lineHeightPx)) target.fillText(line.text, line.xPx, line.yPx)
          })
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

function solidColorImageData(width: number, height: number, color: string): ImageData {
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  if (!context) return new ImageData(width, height)
  context.fillStyle = color
  context.fillRect(0, 0, canvas.width, canvas.height)
  return context.getImageData(0, 0, canvas.width, canvas.height)
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

async function waitForSheetExportFonts(project: CutProject, template: SheetTemplate, requireFont: boolean): Promise<void> {
  const fonts = typeof document === 'undefined' ? undefined : document.fonts
  if (!fonts) return
  try {
    // Load the subsets actually used by this sheet before measuring or drawing.
    // Waiting only for a fixed sample can leave rare Japanese characters in a fallback font.
    const strings: string[] = []
    const collect = (value: unknown) => {
      if (typeof value === 'string' && value.length < 100_000 && !value.startsWith('data:')) strings.push(value)
      else if (value && typeof value === 'object') Object.values(value).forEach(collect)
    }
    collect(project); collect(template)
    const sampleText = [...new Set(strings.join(''))].join('')
    const loaded = await Promise.all([
      fonts.load(`400 16px "LINE Seed JP"`, sampleText),
      fonts.load(`700 16px "LINE Seed JP"`, sampleText),
      fonts.load(`800 16px "LINE Seed JP"`, sampleText),
    ])
    if (requireFont && loaded.some(faces => faces.length === 0 || faces.some(face => face.status !== 'loaded'))) {
      throw new Error('LINE Seed JPを読み込めませんでした。接続を確認してからPSDを書き出してください。')
    }
    await fonts.ready
    sharedTextMeasurementProvider.clear()
  } catch (error) {
    if (requireFont) throw error
    // Font fallback still produces an export; this only avoids racing self-hosted webfonts.
  }
}
