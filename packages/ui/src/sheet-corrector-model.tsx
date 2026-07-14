import { type SheetCalibrationPointPair, type SheetTemplate } from '@xsheet-remap/core'
import { configureCurrentNativeWindow, currentNativeWindowBounds, invokeDesktopCommand } from '@xsheet-remap/adapters'
import { compareFileNameLikeText } from './naturalSort'
import type { SheetPrecisionWarp } from './appTypes'
import { defaultSheetImageSettings, applyLevelCorrectionToDataUrl, loadImage, resolveImageRefUrl, warpSheetImage, warpSheetImageData } from './sheetImages'
import { alphaComposite, writeRgbPsd } from './psdWriter'
import { applyLevelCorrectionToImageData, type LevelCorrectionSettings } from './levelCorrection'
import { LEGACY_SHEET_CORRECTOR_PATTERN_STORAGE_KEY, SHEET_CORRECTOR_IMPORT_RULES_STORAGE_KEY, defaultSheetCorrectorImportRules, parseStoredSheetCorrectorImportRules, type SheetCorrectorImportRule } from './sheetCorrectorImportRules'
import { type SheetCorrectorTemplateFile } from './sheetCorrectorTemplates'
import { type QueueState, SHEET_CORRECTOR_BATCH_WINDOW, SHEET_CORRECTOR_MAIN_WINDOW, SHEET_CORRECTOR_PREVIEW_MAX_ZOOM, SHEET_CORRECTOR_PREVIEW_MIN_ZOOM, SHEET_CORRECTOR_WINDOW_STATE_STORAGE_KEY, type SheetCorrectionDraft, type SheetCorrectorInput, type SheetCorrectorProgressDialogState, type SheetCorrectorSavedWindowState, supportedImageExtensions } from './sheet-corrector-types'

export function clampPreviewZoom(value: number): number {
  return Math.min(SHEET_CORRECTOR_PREVIEW_MAX_ZOOM, Math.max(SHEET_CORRECTOR_PREVIEW_MIN_ZOOM, value))
}

export function draftForTemplate(draft: SheetCorrectionDraft | undefined, templateId: string): SheetCorrectionDraft | undefined {
  return draft?.templateId === templateId ? draft : undefined
}

export function filterDraftsForTemplate(drafts: Record<string, SheetCorrectionDraft>, templateId: string): Record<string, SheetCorrectionDraft> {
  return Object.fromEntries(Object.entries(drafts).filter(([, draft]) => draft.templateId === templateId))
}

export function correctionStateLabel(draft: SheetCorrectionDraft | undefined): string {
  if (draft?.applied && draft.precisionWarp) return '高精度補正済み'
  if (draft?.applied) return '補正済み'
  if (draft) return '調整中'
  return '未補正'
}

export function queueItemStateLabel(state: QueueState | undefined): string {
  switch (state) {
    case 'running':
      return '処理中'
    case 'corrected':
      return '補正済み'
    case 'exported':
      return '出力完了'
    case 'review':
      return '要確認'
    case 'error':
      return 'エラー'
    default:
      return '未処理'
  }
}

export function fileToBrowserInput(file: File): SheetCorrectorInput {
  return {
    path: browserFilePath(file),
    name: file.name,
    extension: extensionOf(file.name),
    size: file.size,
    matched: true,
    sourceKind: 'browser-file',
  }
}

export function browserFilePath(file: File): string {
  const fileWithRelativePath = file as File & { webkitRelativePath?: string }
  return fileWithRelativePath.webkitRelativePath || file.name
}

export function imageUrlForItem(
  item: SheetCorrectorInput,
  browserFileUrls: Record<string, string>,
  nativeFileUrls: Record<string, string>,
  overrides?: Record<string, string>,
): string | null {
  return browserFileUrls[item.path] ?? overrides?.[item.path] ?? nativeFileUrls[item.path] ?? null
}

export async function createNativeSheetImageDataUrl(item: SheetCorrectorInput): Promise<string | null> {
  if (item.sourceKind === 'browser-file') return null
  return await invokeDesktopCommand<string>('sheet_corrector_image_data_url', {
    sourcePath: item.path,
  })
}

export async function openNativeSheetCorrectorTemplateFile(): Promise<SheetCorrectorTemplateFile | null> {
  return await invokeDesktopCommand<SheetCorrectorTemplateFile | null>('open_sheet_corrector_template')
}

export async function readNativeSheetCorrectorTemplatePath(path: string): Promise<SheetCorrectorTemplateFile> {
  return await invokeDesktopCommand<SheetCorrectorTemplateFile>('read_sheet_corrector_template', { path })
}

export async function correctedPngDataUrl(
  imageUrl: string,
  points: SheetCalibrationPointPair[],
  levelCorrection: LevelCorrectionSettings,
  template: SheetTemplate,
  precisionWarp?: SheetPrecisionWarp,
): Promise<string | null> {
  const image = await loadImage(imageUrl)
  const pngDataUrl = warpSheetImage(
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
  const whiteLayer = solidWhiteImageData(correctedImageData.width, correctedImageData.height)
  const templateLayer = templateImageUrl
    ? await templateLineLayerImageData(templateImageUrl, correctedImageData.width, correctedImageData.height)
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
  return bytesToBase64(psd)
}

async function correctedSheetImageData(
  imageUrl: string,
  points: SheetCalibrationPointPair[],
  levelCorrection: LevelCorrectionSettings,
  template: SheetTemplate,
  precisionWarp?: SheetPrecisionWarp,
): Promise<ImageData | null> {
  const image = await loadImage(imageUrl)
  const imageData = warpSheetImageData(
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

async function templateLineLayerImageData(templateImageUrl: string, width: number, height: number): Promise<ImageData> {
  const image = await loadImage(templateImageUrl)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return blankTransparentImageData(width, height)
  context.drawImage(image, 0, 0, width, height)
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

export function correctedOutputName(name: string, extension: 'png' | 'psd'): string {
  const extensionMatch = /\.[^.]+$/.exec(name)
  const stem = extensionMatch ? name.slice(0, -extensionMatch[0].length) : name
  return extension === 'psd' ? `${stem}.psd` : `${stem}_corrected.png`
}

export function downloadDataUrl(dataUrl: string, fileName: string) {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
}

export function downloadBytes(bytes: Uint8Array, fileName: string, mimeType: string) {
  const copy = new Uint8Array(bytes)
  const blob = new Blob([copy.buffer as ArrayBuffer], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
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

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export function templateOverlayImageUrl(template: SheetTemplate): string | null {
  const underlay = template.defaultUnderlay
  if (!underlay) return null
  return resolveImageRefUrl({ ...underlay.imageRef, assetPath: underlay.assetPath })
}

export function sheetCorrectorErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function emptySheetCorrectorProgressState(title: string, message: string): SheetCorrectorProgressDialogState {
  return {
    title,
    message,
    phase: 'collecting',
    total: 0,
    processed: 0,
    exported: 0,
    review: 0,
    error: 0,
    canClose: false,
  }
}

export async function configureSheetCorrectorBatchWindow(): Promise<void> {
  try {
    await configureCurrentNativeWindow(SHEET_CORRECTOR_BATCH_WINDOW)
  } catch {
    // Browser preview and non-desktop hosts do not expose native windows.
  }
}

export async function restoreSheetCorrectorMainWindow(): Promise<void> {
  try {
    const saved = loadSheetCorrectorWindowState()
    await configureCurrentNativeWindow({
      ...SHEET_CORRECTOR_MAIN_WINDOW,
      width: saved?.width ?? SHEET_CORRECTOR_MAIN_WINDOW.width,
      height: saved?.height ?? SHEET_CORRECTOR_MAIN_WINDOW.height,
      position: saved && typeof saved.x === 'number' && typeof saved.y === 'number'
        ? { x: saved.x, y: saved.y }
        : undefined,
      physicalSize: Boolean(saved),
    })
  } catch {
    // Rust setup still shows the normal startup window; browser preview has no native window.
  }
}

export async function saveCurrentSheetCorrectorWindowState(): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    const bounds = await currentNativeWindowBounds()
    const state: SheetCorrectorSavedWindowState = {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
    }
    if (!isValidSheetCorrectorWindowState(state)) return
    window.localStorage.setItem(SHEET_CORRECTOR_WINDOW_STATE_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Window state persistence should never block app use.
  }
}

function loadSheetCorrectorWindowState(): SheetCorrectorSavedWindowState | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = window.localStorage.getItem(SHEET_CORRECTOR_WINDOW_STATE_STORAGE_KEY)
    if (!stored) return null
    const parsed = JSON.parse(stored) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const record = parsed as Record<string, unknown>
    const state: SheetCorrectorSavedWindowState = {
      width: typeof record.width === 'number' ? Math.round(record.width) : 0,
      height: typeof record.height === 'number' ? Math.round(record.height) : 0,
      x: typeof record.x === 'number' ? Math.round(record.x) : undefined,
      y: typeof record.y === 'number' ? Math.round(record.y) : undefined,
    }
    return isValidSheetCorrectorWindowState(state) ? state : null
  } catch {
    return null
  }
}

function isValidSheetCorrectorWindowState(state: SheetCorrectorSavedWindowState): boolean {
  return Number.isFinite(state.width)
    && Number.isFinite(state.height)
    && state.width >= SHEET_CORRECTOR_MAIN_WINDOW.minWidth
    && state.height >= SHEET_CORRECTOR_MAIN_WINDOW.minHeight
}

export function loadStoredSheetImportRules(): SheetCorrectorImportRule[] {
  if (typeof window === 'undefined') return defaultSheetCorrectorImportRules()
  try {
    const stored = window.localStorage.getItem(SHEET_CORRECTOR_IMPORT_RULES_STORAGE_KEY)
    const legacyStored = window.localStorage.getItem(LEGACY_SHEET_CORRECTOR_PATTERN_STORAGE_KEY)
    return parseStoredSheetCorrectorImportRules(stored, legacyStored)
  } catch {
    return defaultSheetCorrectorImportRules()
  }
}

export function saveStoredSheetImportRules(rules: SheetCorrectorImportRule[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SHEET_CORRECTOR_IMPORT_RULES_STORAGE_KEY, JSON.stringify(rules))
  } catch {
    // Local storage is only a convenience for the next drop operation.
  }
}

export function objectUrlsForFiles(files: File[]): Record<string, string> {
  return Object.fromEntries(files.map(file => [browserFilePath(file), URL.createObjectURL(file)]))
}

export function replaceBrowserFileUrls(
  nextUrls: Record<string, string>,
  urlsRef: { current: Record<string, string> },
  setUrls: (urls: Record<string, string>) => void,
) {
  revokeBrowserFileUrls(urlsRef.current)
  urlsRef.current = nextUrls
  setUrls(nextUrls)
}

export function revokeBrowserFileUrls(urls: Record<string, string>) {
  for (const url of Object.values(urls)) URL.revokeObjectURL(url)
}

export function isSupportedSheetImageFile(file: File): boolean {
  return supportedImageExtensions.has(extensionOf(file.name))
}

function extensionOf(name: string): string {
  const match = /\.([^.]+)$/.exec(name)
  return match ? match[1].toLowerCase() : ''
}

export function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

export function dedupeFiles(files: File[]): File[] {
  const seen = new Set<string>()
  const result: File[] = []
  for (const file of files) {
    const key = `${browserFilePath(file)}\u0000${file.size}\u0000${file.lastModified}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(file)
  }
  return result
}

export function dedupeSheetCorrectorInputs(inputs: SheetCorrectorInput[]): SheetCorrectorInput[] {
  const seen = new Set<string>()
  const result: SheetCorrectorInput[] = []
  for (const input of inputs) {
    const key = input.path.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(input)
  }
  return result
}

export function omitRecordKeys<T>(record: Record<string, T>, keys: Set<string>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.has(key)))
}

export function compareSheetCorrectorInputs(a: SheetCorrectorInput, b: SheetCorrectorInput): number {
  return compareFileNameLikeText(a.name, b.name) || compareFileNameLikeText(a.path, b.path)
}
