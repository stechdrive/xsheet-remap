import {
  isInteractiveSheetTemplateGridRegion,
  resolveSheetTemplateGridLayout,
  sheetGridCellRect,
  type RecognitionCandidate,
  type SheetGridLayout,
  type SheetPage,
  type SheetTemplate,
  type SheetTimingRole,
  type SheetViewLayoutOverrides,
} from '@xsheet-remap/core'
import type { SheetImageSettings } from './appTypes'
import { renderCorrectedSheetCanvas } from './sheetImages'
import { deduplicateRecognitionCandidates, normalizeRecognitionLabel } from './sheetRecognitionLabels'
import { createBundledPaddleOcrRuntimeConfig } from './sheetRecognitionPaddleConfig'

export { deduplicateRecognitionCandidates, normalizeRecognitionLabel } from './sheetRecognitionLabels'

const OCR_TILE_ROWS = 12
const OCR_TILE_OVERLAP_ROWS = 1
const OCR_TILE_SCALE = 3
const OCR_MIN_CONFIDENCE = 0.6

export interface SheetOcrDetection {
  text: string
  confidence: number
  polygon: Array<[number, number]>
}

export interface SheetOcrEngine {
  readonly id: string
  recognize(image: HTMLCanvasElement): Promise<SheetOcrDetection[]>
  dispose?(): Promise<void>
}

export interface SheetOcrPageInput {
  page: SheetPage
  imageUrl: string
  imageSettings: SheetImageSettings
  correctedCanvas?: HTMLCanvasElement
}

export interface RecognizeSheetPagesOptions {
  template: SheetTemplate
  pages: SheetOcrPageInput[]
  sheetRole: SheetTimingRole
  durationFrames: number
  frameOrigin: number
  paperTracks?: string[]
  layoutOverrides?: SheetViewLayoutOverrides
  engine?: SheetOcrEngine
  onProgress?: (completed: number, total: number) => void
}

interface OcrTile {
  canvas: HTMLCanvasElement
  layout: SheetGridLayout
  page: SheetPage
  crop: { x: number; y: number; w: number; h: number }
  coreRowStart: number
  coreRowEnd: number
}

interface MappedDetection {
  paperTrack: string
  frame: number
  rawText: string
  normalizedLabel: string
  confidence: number
  bbox: RecognitionCandidate['bbox']
  centerX: number
}

type PaddleOcrRuntime = {
  predict(input: unknown): Promise<Array<{
    items: Array<{ poly: Array<[number, number]>; text: string; score: number }>
  }>>
  dispose(): Promise<void>
}

let sharedPaddleEngine: Promise<SheetOcrEngine> | null = null

export async function recognizeSheetPages(options: RecognizeSheetPagesOptions): Promise<RecognitionCandidate[]> {
  if (options.pages.length === 0) return []
  const engine = options.engine ?? await defaultSheetOcrEngine()
  const layouts = timingLayouts(options)
  const tilesPerPage = layouts.reduce((total, layout) => total + Math.ceil(layout.frames.rowCount / OCR_TILE_ROWS), 0)
  const total = tilesPerPage * options.pages.length
  let completed = 0
  const candidates: RecognitionCandidate[] = []

  for (const pageInput of options.pages) {
    const corrected = pageInput.correctedCanvas ?? await renderCorrectedSheetCanvas(
      pageInput.imageUrl,
      pageInput.imageSettings,
      options.template,
      options.template.page.widthPx,
    )
    for (const layout of layouts) {
      for (const tile of createOcrTiles(corrected, layout, pageInput.page)) {
        const detections = await engine.recognize(tile.canvas)
        candidates.push(...mapTileDetections(detections, tile, options, engine.id))
        completed += 1
        options.onProgress?.(completed, total)
      }
    }
  }

  return deduplicateRecognitionCandidates(candidates)
}

async function defaultSheetOcrEngine(): Promise<SheetOcrEngine> {
  if (!sharedPaddleEngine) sharedPaddleEngine = createPaddleOcrEngine()
  try {
    return await sharedPaddleEngine
  } catch (error) {
    sharedPaddleEngine = null
    throw error
  }
}

async function createPaddleOcrEngine(): Promise<SheetOcrEngine> {
  const { PaddleOCR } = await import('@paddleocr/paddleocr-js')
  const runtime = await PaddleOCR.create(
    createBundledPaddleOcrRuntimeConfig(publicAssetUrl),
  ) as PaddleOcrRuntime
  return {
    id: 'paddle-ocr-v5',
    async recognize(image) {
      const [result] = await runtime.predict(image)
      return result?.items.map(item => ({
        text: item.text,
        confidence: item.score,
        polygon: item.poly,
      })) ?? []
    },
    dispose: () => runtime.dispose(),
  }
}

function publicAssetUrl(path: string): string {
  const baseUrl = ((import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './').replace(/\/?$/, '/')
  return new URL(`${baseUrl}${path.replace(/^\/+/, '')}`, window.location.href).href
}

function timingLayouts(options: RecognizeSheetPagesOptions): SheetGridLayout[] {
  return options.template.regions.flatMap(region => {
    if (!isInteractiveSheetTemplateGridRegion(region) || region.grid.role !== options.sheetRole) return []
    const layout = resolveSheetTemplateGridLayout(options.template, region, {
      durationFrames: options.durationFrames,
      frameOrigin: options.frameOrigin,
      paperTracks: options.paperTracks,
      layoutOverrides: options.layoutOverrides,
    })
    return layout ? [layout] : []
  })
}

function createOcrTiles(source: HTMLCanvasElement, layout: SheetGridLayout, page: SheetPage): OcrTile[] {
  const tiles: OcrTile[] = []
  const columnMargin = Math.max(0, Math.min(...layout.columns.map(column => column.w)) * 0.15)
  for (let coreRowStart = 0; coreRowStart < layout.frames.rowCount; coreRowStart += OCR_TILE_ROWS) {
    const coreRowEnd = Math.min(layout.frames.rowCount, coreRowStart + OCR_TILE_ROWS)
    const cropRowStart = Math.max(0, coreRowStart - OCR_TILE_OVERLAP_ROWS)
    const cropRowEnd = Math.min(layout.frames.rowCount, coreRowEnd + OCR_TILE_OVERLAP_ROWS)
    const crop = clampNormalizedRect({
      x: layout.rect.x - columnMargin,
      y: layout.rect.y + cropRowStart * layout.frames.rowHeight,
      w: layout.rect.w + columnMargin * 2,
      h: (cropRowEnd - cropRowStart) * layout.frames.rowHeight,
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(crop.w * source.width * OCR_TILE_SCALE))
    canvas.height = Math.max(1, Math.round(crop.h * source.height * OCR_TILE_SCALE))
    const context = canvas.getContext('2d')
    if (!context) continue
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(
      source,
      crop.x * source.width,
      crop.y * source.height,
      crop.w * source.width,
      crop.h * source.height,
      0,
      0,
      canvas.width,
      canvas.height,
    )
    tiles.push({ canvas, layout, page, crop, coreRowStart, coreRowEnd })
  }
  return tiles
}

function mapTileDetections(
  detections: SheetOcrDetection[],
  tile: OcrTile,
  options: RecognizeSheetPagesOptions,
  engineId: string,
): RecognitionCandidate[] {
  const mapped = detections
    .filter(detection => detection.confidence >= OCR_MIN_CONFIDENCE)
    .flatMap(detection => mapDetectionToGrid(detection, tile, options))
  const grouped = new Map<string, MappedDetection[]>()
  for (const item of mapped) {
    const key = `${item.paperTrack}\u0000${item.frame}`
    grouped.set(key, [...(grouped.get(key) ?? []), item])
  }
  return [...grouped.values()].flatMap(items => {
    const ordered = [...items].sort((a, b) => a.centerX - b.centerX)
    const rawText = ordered.map(item => item.rawText).join('')
    const normalizedLabel = normalizeRecognitionLabel(ordered.map(item => item.normalizedLabel).join(''))
    if (!normalizedLabel) return []
    const representative = ordered.reduce((best, item) => item.confidence > best.confidence ? item : best)
    return [{
      candidateId: recognitionCandidateId(tile.page.pageId, options.sheetRole, representative.paperTrack, representative.frame),
      provider: 'grid-crop-ocr' as const,
      engineId,
      pageId: tile.page.pageId,
      sheetRole: options.sheetRole,
      paperTrack: representative.paperTrack,
      frame: representative.frame,
      rawText,
      normalizedLabel,
      confidence: ordered.reduce((total, item) => total + item.confidence, 0) / ordered.length,
      bbox: unionRects(ordered.map(item => item.bbox)),
    }]
  })
}

function mapDetectionToGrid(
  detection: SheetOcrDetection,
  tile: OcrTile,
  options: RecognizeSheetPagesOptions,
): MappedDetection[] {
  const normalizedLabel = normalizeRecognitionLabel(detection.text)
  if (!normalizedLabel || detection.polygon.length === 0) return []
  const points = detection.polygon.map(([x, y]) => ({
    x: tile.crop.x + (x / tile.canvas.width) * tile.crop.w,
    y: tile.crop.y + (y / tile.canvas.height) * tile.crop.h,
  }))
  const bbox = boundsForPoints(points)
  const center = {
    x: points.reduce((total, point) => total + point.x, 0) / points.length,
    y: points.reduce((total, point) => total + point.y, 0) / points.length,
  }
  const rowPosition = (center.y - tile.layout.rect.y) / tile.layout.frames.rowHeight
  const rowIndex = Math.floor(rowPosition)
  if (rowIndex < tile.coreRowStart || rowIndex >= tile.coreRowEnd) return []
  const localFrame = tile.layout.frames.frameStart + rowIndex
  const frame = tile.page.frameStart + (localFrame - options.template.defaults.frameOrigin)
  if (frame < tile.page.frameStart || frame > tile.page.frameEnd) return []

  const columns = tile.layout.columns.filter(item => item.paperTrack)
  const averageColumnWidth = columns.reduce((total, column) => total + column.w, 0) / Math.max(1, columns.length)
  const tokens = recognitionLabelTokens(detection.text)
  if (tokens.length > 1 && bbox.w > averageColumnWidth * 1.45) {
    return tokens.flatMap((token, index) => {
      const tokenX = bbox.x + bbox.w * ((index + 0.5) / tokens.length)
      const column = nearestPaperTrackColumn(tile.layout, tokenX)
      if (!column?.paperTrack) return []
      const cellRect = sheetGridCellRect(tile.layout, column.index, rowIndex)
      if (!cellRect || Math.abs(tokenX - (cellRect.x + cellRect.w / 2)) > cellRect.w * 1.05) return []
      return [{
        paperTrack: column.paperTrack,
        frame,
        rawText: token.rawText,
        normalizedLabel: token.normalizedLabel,
        confidence: detection.confidence,
        bbox: {
          x: bbox.x + bbox.w * (index / tokens.length),
          y: bbox.y,
          w: bbox.w / tokens.length,
          h: bbox.h,
        },
        centerX: tokenX,
      }]
    })
  }

  const column = nearestPaperTrackColumn(tile.layout, center.x)
  if (!column?.paperTrack) return []
  const cellRect = sheetGridCellRect(tile.layout, column.index, rowIndex)
  if (!cellRect || Math.abs(center.x - (cellRect.x + cellRect.w / 2)) > cellRect.w * 1.05) return []
  return [{
    paperTrack: column.paperTrack,
    frame,
    rawText: detection.text,
    normalizedLabel,
    confidence: detection.confidence,
    bbox,
    centerX: center.x,
  }]
}

function nearestPaperTrackColumn(layout: SheetGridLayout, x: number): SheetGridLayout['columns'][number] | null {
  return layout.columns
    .filter(item => item.paperTrack)
    .reduce((nearest, item) => {
      const distance = Math.abs(x - (item.x + item.w / 2))
      return !nearest || distance < nearest.distance ? { item, distance } : nearest
    }, null as { item: SheetGridLayout['columns'][number]; distance: number } | null)?.item ?? null
}

function recognitionLabelTokens(rawText: string): Array<{ rawText: string; normalizedLabel: string }> {
  return Array.from(rawText).flatMap(character => {
    const normalizedLabel = normalizeRecognitionLabel(character)
    return normalizedLabel ? [{ rawText: character, normalizedLabel }] : []
  })
}

function recognitionCandidateId(pageId: string, sheetRole: SheetTimingRole, paperTrack: string, frame: number): string {
  return `ocr_${pageId}_${sheetRole}_${encodeURIComponent(paperTrack)}_${frame}`
}

function boundsForPoints(points: Array<{ x: number; y: number }>): RecognitionCandidate['bbox'] {
  const left = Math.min(...points.map(point => point.x))
  const top = Math.min(...points.map(point => point.y))
  const right = Math.max(...points.map(point => point.x))
  const bottom = Math.max(...points.map(point => point.y))
  return clampNormalizedRect({ x: left, y: top, w: right - left, h: bottom - top })
}

function unionRects(rects: RecognitionCandidate['bbox'][]): RecognitionCandidate['bbox'] {
  const left = Math.min(...rects.map(rect => rect.x))
  const top = Math.min(...rects.map(rect => rect.y))
  const right = Math.max(...rects.map(rect => rect.x + rect.w))
  const bottom = Math.max(...rects.map(rect => rect.y + rect.h))
  return clampNormalizedRect({ x: left, y: top, w: right - left, h: bottom - top })
}

function clampNormalizedRect(rect: RecognitionCandidate['bbox']): RecognitionCandidate['bbox'] {
  const x = Math.max(0, Math.min(1, rect.x))
  const y = Math.max(0, Math.min(1, rect.y))
  const right = Math.max(x, Math.min(1, rect.x + rect.w))
  const bottom = Math.max(y, Math.min(1, rect.y + rect.h))
  return { x, y, w: right - x, h: bottom - y }
}
