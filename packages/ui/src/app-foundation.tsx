import type { CSSProperties } from 'react'
import { activeCutProjectFromDocument, assetAbsolutePath, buildCspImportPackage, type CutProject, type AnnotationText, type FileRef, type CutGroupProjectDocument, type LogicalTimelineSectionRole, type SheetHit, type SheetCalibrationPointPair, type SheetTimingRole, formatLogicalSheetFrameTimecode, updateStackGuideLabel, logicalSheetDisplayFrameEnd, logicalSheetDisplayFrameStart, logicalSheetFrameNumber, sheetTimingRoleForEvent, type TimelineEvent, type StackGuideLabel, stackGuideGapIndex, stackGuideStackBand } from '@xsheet-remap/core'
import { isTauriHost, saveBinaryFile, saveTextFile, statNativePaths, writeBinaryFile, writeTextFile, type SaveTextFileOptions } from '@xsheet-remap/adapters'
import { uiText } from './i18n'
import { type Panel, type SheetRangeSelection } from './appTypes'
import { isCellMaterialAsset } from './sheetAssets'
import { REGISTERED_CELL_TEXT_DRAG_PREFIX } from './sheetConstants'
import { clampNumber, sheetRoleForHit, sheetRoleLabel } from './sheetInteraction'
import { type TimelineFrameEditScope } from './timingEditing'
import { type AutoCalibrationDebugOverlay } from './sheetAutoCalibration'
import { compareNaturalFileNameText } from './naturalSort'

export type StackGuideLabelUpdates = Parameters<typeof updateStackGuideLabel>[2]

export type RegisteredCellSortDirection = 'asc' | 'desc'

export type CalibrationPointKind = 'source' | 'target'

export type AutoCalibrationOverlayState = AutoCalibrationDebugOverlay & { pageId: string }

export type ActiveTextTarget =
  | { kind: 'nextTimingInput'; fontSizePx: number }
  | { kind: 'timingEvent'; eventId: string; fontSizePx: number }
  | { kind: 'timingRange'; fontSizePx: number }
  | { kind: 'annotationText'; annotationId: string; fontSizePx: number }

export type TextAnnotationUpdate = Partial<Pick<AnnotationText, 'text' | 'fontSizePx' | 'x' | 'y' | 'color' | 'coordinateSpace' | 'anchor'>>

export const IMPORTED_SHEET_SECONDS_PER_PAGE = 6

export const IMPORTED_SHEET_IMAGE_INITIAL_OPACITY = 0.5

export const SHEET_INTERACTION_ACTIVE_CLASS = 'sheetInteractionActive'

export const CELL_ASSET_PREVIEW_MAX_ITEMS = 6

export const TIMELINE_EVENT_LONG_PRESS_MS = 320

export const TIMELINE_EVENT_DRAG_THRESHOLD_PX = 4

export const CONTINUOUS_CANVAS_MIN_FRAME_ROW_PX = 10

export type MainAppKind = 'editor' | 'remap'

export const SHEET_LEFT_PANE_DEFAULT_WIDTH = 240

export const SHEET_LEFT_PANE_MIN_WIDTH = 180

export const SHEET_LEFT_PANE_MAX_WIDTH = 420

export const SHEET_RIGHT_PANE_DEFAULT_WIDTH = 300

export const SHEET_RIGHT_PANE_MIN_WIDTH = 200

export const SHEET_RIGHT_PANE_MAX_WIDTH = 560

export type SheetPaneLayout = {
  left: boolean
  right: boolean
  leftWidth: number
  rightWidth: number
}

export function initialSheetPaneLayout(appKind: MainAppKind, collapseEditorPanes: boolean): SheetPaneLayout {
  const visibleByDefault = appKind === 'remap' || !collapseEditorPanes
  const fallback: SheetPaneLayout = {
    left: visibleByDefault,
    right: visibleByDefault,
    leftWidth: SHEET_LEFT_PANE_DEFAULT_WIDTH,
    rightWidth: SHEET_RIGHT_PANE_DEFAULT_WIDTH,
  }
  try {
    const stored = window.localStorage.getItem(`xsheet:${appKind}:sheet-pane-layout`)
    if (!stored) return fallback
    const parsed = JSON.parse(stored) as Partial<SheetPaneLayout>
    return {
      left: typeof parsed.left === 'boolean' ? parsed.left : fallback.left,
      right: typeof parsed.right === 'boolean' ? parsed.right : fallback.right,
      leftWidth: typeof parsed.leftWidth === 'number'
        ? clampNumber(parsed.leftWidth, SHEET_LEFT_PANE_MIN_WIDTH, SHEET_LEFT_PANE_MAX_WIDTH)
        : fallback.leftWidth,
      rightWidth: typeof parsed.rightWidth === 'number'
        ? clampNumber(parsed.rightWidth, SHEET_RIGHT_PANE_MIN_WIDTH, SHEET_RIGHT_PANE_MAX_WIDTH)
        : fallback.rightWidth,
    }
  } catch {
    return fallback
  }
}

export const APP_PROFILES: Record<MainAppKind, { appName: string; panels: Panel[]; showDigitalHelp: boolean }> = {
  editor: {
    appName: 'xsheet-editor',
    panels: ['sheet', 'template'],
    showDigitalHelp: true,
  },
  remap: {
    appName: 'xsheet-remap',
    panels: ['sheet'],
    showDigitalHelp: false,
  },
}

const STATUS_HINT_SOURCE_ORDER = ['sheet-drag', 'sheet-drop', 'overlay-paper-track', 'sheet-hover'] as const

export type StatusHintSource = typeof STATUS_HINT_SOURCE_ORDER[number]

export type StatusHints = Partial<Record<StatusHintSource, string>>

export function activeStatusHintText(hints: StatusHints): string | null {
  for (const source of STATUS_HINT_SOURCE_ORDER) {
    const text = hints[source]
    if (text) return text
  }
  return null
}

export type NativeDragDropPayload = {
  type: string
  paths?: string[]
  position?: { x: number; y: number }
}

export function keyIdFromRegisteredCellTextDragData(value: string): string {
  return value.startsWith(REGISTERED_CELL_TEXT_DRAG_PREFIX)
    ? value.slice(REGISTERED_CELL_TEXT_DRAG_PREFIX.length)
    : ''
}

export type FrameOperationKind = 'insert' | 'delete'

export type FrameOperationDialogState = {
  kind: FrameOperationKind
  role: LogicalTimelineSectionRole
  paperTrack: string
  paperTracks: string[]
  frameStart: number
  frameEnd: number
  sourceHit: SheetHit
  sourceRange: SheetRangeSelection | null
}

export type FrameOperationSubmit = {
  scope: TimelineFrameEditScope
  frameCount: number
}

export interface SheetContextMenuState {
  x: number
  y: number
  hit: SheetHit | null
  timelineMemoIds?: string[]
  snapIndex?: number
  sheetRole?: SheetTimingRole
  insertAfterPaperTrack?: string
}

export interface PaperTrackHeaderMenuState {
  x: number
  y: number
  hit: SheetHit
  snapIndex?: number
  sheetRole: SheetTimingRole
}

export interface OverlayPaperTrackMenuState {
  x: number
  y: number
  paperTrack: string
}

export interface StackGuideInsertTarget {
  pageId: string
  regionId: string
  gapIndex: number
  insertAfterPaperTrack?: string
  displayRole: SheetTimingRole
  snapIndex: number
}

export interface StackGuideHeaderMenuState extends StackGuideInsertTarget {
  x: number
  y: number
}

export interface StackGuideInsertContext {
  mode: StackGuideInsertTool
  correctionLayerId?: string
  preferredSnapIndex?: number
}

export interface StackGuideInsertRequest extends StackGuideInsertTarget, StackGuideInsertContext {
  requestId: number
}

export type StackGuideInsertTool = 'label-editor' | 'overlay-track'

export interface StackGuideDropPreviewState extends StackGuideInsertTarget {
  labelId?: string
}

export interface PaperTrackEditorState {
  x: number
  y: number
  mode: 'add' | 'rename'
  initialName: string
  isOverlay?: boolean
  paperTrack?: string
  snapIndex?: number
  sheetRole?: SheetTimingRole
  exportAfterPaperTrack?: string
}

export interface AssetDropMenuState {
  x: number
  y: number
  assetId: string
  keyId: string
  hit: SheetHit | null
}

export type SheetScrollRequest = {
  requestId: number
  hit: SheetHit
}

export type RegisteredCellFirstUse = {
  timecode: string
  title: string
  paperTrack: string
  frame: number
  role: SheetTimingRole
}

export type ImportedSheetSourceCalibrationTarget = {
  pageId: string
  sourceId: string
  imageUrl: string
}

export type ImportedSheetSourceCalibrationResult = {
  target: ImportedSheetSourceCalibrationTarget
  points: SheetCalibrationPointPair[]
}

export type CalibrationGuideMetrics = {
  handleStrokePx: number
  handleOuterX: number
  handleOuterY: number
  handleInnerX: number
  handleInnerY: number
  trimOuterX: number
  trimOuterY: number
  trimStrokePx: number
  hitRadiusX: number
  hitRadiusY: number
}

export function clientPointCandidatesFromNativeDropPosition(position: { x: number; y: number }): Array<{ x: number; y: number }> {
  const scale = window.devicePixelRatio || 1
  const points = [
    { x: position.x / scale, y: position.y / scale },
    { x: position.x, y: position.y },
  ]
  return points.filter((point, index) => {
    if (point.x < 0 || point.y < 0 || point.x > window.innerWidth || point.y > window.innerHeight) return false
    return points.findIndex(item => Math.abs(item.x - point.x) < 0.5 && Math.abs(item.y - point.y) < 0.5) === index
  })
}

export function isImageFileRef(ref: FileRef): boolean {
  return /\.(?:png|jpe?g|gif|webp|bmp|tiff?|tga)$/i.test(ref.name)
}

function normalizeFsPath(path?: string): string {
  return (path ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
}

export function pathCompareKey(path?: string): string {
  return normalizeFsPath(path).toLocaleLowerCase()
}

function formatSignedPaddedNumber(value: number, digits: number): string {
  const rounded = Math.round(value)
  const sign = rounded < 0 ? '-' : ''
  return `${sign}${String(Math.abs(rounded)).padStart(digits, '0')}`
}

function frameNumberDigitCount(project: CutProject): number {
  const displayStart = logicalSheetDisplayFrameStart(project.logicalSheet)
  const displayEnd = logicalSheetDisplayFrameEnd(project.logicalSheet)
  const firstNumber = logicalSheetFrameNumber(project.logicalSheet, displayStart)
  const lastNumber = logicalSheetFrameNumber(project.logicalSheet, displayEnd)
  return Math.max(3, String(Math.max(Math.abs(firstNumber), Math.abs(lastNumber))).length)
}

function formatFrameNumber(project: CutProject, frame: number): string {
  return formatSignedPaddedNumber(logicalSheetFrameNumber(project.logicalSheet, frame), frameNumberDigitCount(project))
}

export function formatPaddedFrameTimecode(project: CutProject, frame: number): string {
  const fpsDigits = Math.max(2, String(Math.max(1, Math.round(project.logicalSheet.fps))).length)
  const raw = formatLogicalSheetFrameTimecode(frame, project.logicalSheet.frameOrigin, project.logicalSheet.fps)
  const [rawSeconds = '0', rawKoma = '1'] = raw.split('+')
  const sign = rawSeconds.startsWith('-') ? '-' : ''
  const seconds = rawSeconds.replace(/^-/, '')
  return `${sign}${seconds.padStart(2, '0')}+${rawKoma.padStart(fpsDigits, '0')}`
}

export function formatPaddedDurationTimecode(project: CutProject, frameCount: number): string {
  const safeFps = Math.max(1, Math.round(project.logicalSheet.fps))
  const totalFrames = Math.max(0, Math.round(frameCount))
  const seconds = Math.floor(totalFrames / safeFps)
  const koma = totalFrames % safeFps
  const fpsDigits = Math.max(2, String(safeFps).length)
  return `${String(seconds).padStart(2, '0')}+${String(koma).padStart(fpsDigits, '0')}`
}

export function formatFramePosition(project: CutProject, frame: number): string {
  return `${formatFrameNumber(project, frame)} (${formatPaddedFrameTimecode(project, frame)})`
}

export function formatFrameRangePosition(project: CutProject, frameStart: number, frameEnd: number): string {
  if (frameStart === frameEnd) return formatFramePosition(project, frameStart)
  return `${formatFrameNumber(project, frameStart)}-${formatFrameNumber(project, frameEnd)} (${formatPaddedFrameTimecode(project, frameStart)}-${formatPaddedFrameTimecode(project, frameEnd)})`
}

export function sheetHitTargetLabel(project: CutProject, hit: SheetHit): string {
  return `${sheetRoleLabel(sheetRoleForHit(hit))} ${hit.paperTrack ?? '-'} ${formatFramePosition(project, hit.frame)}`
}

export function sheetHitStatusHint(project: CutProject, hit: SheetHit): string {
  const role = sheetRoleLabel(sheetRoleForHit(hit))
  const paperTrack = hit.paperTrack ?? '-'
  const frame = formatFramePosition(project, hit.frame)
  return timelineEventAtHit(project, hit)
    ? uiText.statusHints.cellEvent(role, paperTrack, frame)
    : uiText.statusHints.cellEmpty(role, paperTrack, frame)
}

export function timelineEventAtHit(project: CutProject, hit: SheetHit | null): TimelineEvent | null {
  if (!hit?.paperTrack) return null
  const role = sheetRoleForHit(hit)
  return project.logicalSheet.events.find(event =>
    event.paperTrack === hit.paperTrack
    && event.frame === hit.frame
    && sheetTimingRoleForEvent(event) === role
  ) ?? null
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function compareStackGuideLabelsForUi(project: CutProject) {
  return (a: StackGuideLabel, b: StackGuideLabel): number =>
    stackGuideBandSortValue(a) - stackGuideBandSortValue(b)
    || stackGuideGapIndex(project, a) - stackGuideGapIndex(project, b)
    || a.orderInGap - b.orderInGap
    || compareNaturalFileNameText(a.label, b.label)
    || a.labelId.localeCompare(b.labelId, 'ja')
}

function stackGuideBandSortValue(label: StackGuideLabel): number {
  const stackBand = stackGuideStackBand(label)
  if (stackBand === 'cell-interleave') return 0
  if (stackBand === 'camera-note') return 1
  return 2
}

export function floatingEditorStyle(x: number, y: number): CSSProperties {
  const width = 220
  const height = 140
  const inset = 8
  const viewportWidth = typeof window === 'undefined' ? width + inset * 2 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? height + inset * 2 : window.innerHeight
  return {
    left: Math.max(inset, Math.min(x + 8, viewportWidth - width - inset)),
    top: Math.max(inset, Math.min(y + 8, viewportHeight - height - inset)),
    width,
  }
}

type TextFileOutput = {
  fileName: string
  contents: string
}

type BinaryFileOutput = {
  fileName: string
  bytes: Uint8Array
  mimeType: string
}

export function exportCutProjectsFromDocument(document: CutGroupProjectDocument): CutProject[] {
  if (document.cuts.length === 0) return [activeCutProjectFromDocument(document)]
  return document.cuts.map(cut => activeCutProjectFromDocument({ ...document, activeCutId: cut.cutId }))
}

export function fileDialogInitialDirectory(project: CutProject): string | undefined {
  return project.assetRoot?.path
}

export async function saveTextOutputs(outputs: TextFileOutput[], mimeType: string, options: SaveTextFileOptions): Promise<boolean> {
  const [first, ...rest] = outputs
  if (!first) return false
  const firstResult = await saveTextFile(first.contents, first.fileName, mimeType, options)
  if (!firstResult.saved) return false
  const outputDirectory = outputDirectoryFromPath(firstResult.path)
  if (!outputDirectory) {
    for (const output of rest) {
      await saveTextFile(output.contents, output.fileName, mimeType, options)
    }
    return true
  }
  for (const output of rest) {
    await writeTextFile(joinOutputPath(outputDirectory, output.fileName), output.contents)
  }
  return true
}

export async function saveBinaryOutputs(outputs: BinaryFileOutput[], options: SaveTextFileOptions): Promise<boolean> {
  const [first, ...rest] = outputs
  if (!first) return false
  const firstResult = await saveBinaryFile(first.bytes, first.fileName, first.mimeType, options)
  if (!firstResult.saved) return false
  const outputDirectory = outputDirectoryFromPath(firstResult.path)
  if (!outputDirectory) {
    for (const output of rest) {
      await saveBinaryFile(output.bytes, output.fileName, output.mimeType, options)
    }
    return true
  }
  for (const output of rest) {
    await writeBinaryFile(joinOutputPath(outputDirectory, output.fileName), output.bytes)
  }
  return true
}

function outputDirectoryFromPath(path: string | undefined): string | null {
  if (!path) return null
  const slashIndex = path.lastIndexOf('/')
  const backslashIndex = path.lastIndexOf('\\')
  const index = Math.max(slashIndex, backslashIndex)
  return index > 0 ? path.slice(0, index) : null
}

function joinOutputPath(directory: string, fileName: string): string {
  const separator = directory.includes('\\') ? '\\' : '/'
  return `${directory.replace(/[\\/]+$/, '')}${separator}${fileName}`
}

export function cspImportPackageAssetPaths(packageBuild: ReturnType<typeof buildCspImportPackage>): string[] {
  const assetRootPath = packageBuild.assetRootPath
  if (!assetRootPath) return []
  const paths = new Set<string>()
  for (const cut of packageBuild.manifest.cuts) {
    for (const track of cut.tracks) {
      for (const cel of track.cels) {
        if (!cel.material) continue
        paths.add(cel.material.pathKind === 'absolute' ? cel.material.path : joinOutputPath(assetRootPath, cel.material.path))
      }
    }
  }
  return [...paths]
}

type ProjectNativePathChecks = {
  assetRoots: string[]
  materialAssets: string[]
  sheetImages: string[]
}

function projectDocumentNativePathChecks(document: CutGroupProjectDocument): ProjectNativePathChecks {
  const assetPathById = new Map(document.assets.map(asset => [asset.assetId, assetAbsolutePath(asset, document.assetRoot)]))
  const sheetImages = new Set<string>()

  for (const cut of document.cuts) {
    for (const revision of cut.revisions) {
      for (const source of revision.sheetView.sources) {
        if (source.kind !== 'sheet-scan') continue
        const path = source.imageRef.path ?? (source.assetId ? assetPathById.get(source.assetId) : undefined)
        if (path) sheetImages.add(path)
      }
    }
  }

  return {
    assetRoots: uniquePathList([document.assetRoot?.path]),
    materialAssets: uniquePathList(document.assets.filter(isCellMaterialAsset).map(asset => assetAbsolutePath(asset, document.assetRoot))),
    sheetImages: uniquePathList([...sheetImages]),
  }
}

function uniquePathList(paths: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const path of paths) {
    if (!path) continue
    const key = pathCompareKey(path)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(path)
  }
  return unique
}

export async function alertMissingProjectNativePaths(document: CutGroupProjectDocument): Promise<void> {
  if (!isTauriHost()) return
  const checks = projectDocumentNativePathChecks(document)
  const allPaths = uniquePathList([
    ...checks.assetRoots,
    ...checks.materialAssets,
    ...checks.sheetImages,
  ])
  if (allPaths.length === 0) return

  try {
    const statusByPath = new Map((await statNativePaths(allPaths)).map(status => [pathCompareKey(status.path), status]))
    const missingRoots = checks.assetRoots.filter(path => !statusByPath.get(pathCompareKey(path))?.isDirectory)
    const missingMaterials = checks.materialAssets.filter(path => !statusByPath.get(pathCompareKey(path))?.isFile)
    const missingSheetImages = checks.sheetImages.filter(path => !statusByPath.get(pathCompareKey(path))?.isFile)
    if (missingRoots.length === 0 && missingMaterials.length === 0 && missingSheetImages.length === 0) return
    window.alert(uiText.project.nativePathsMissing({
      assetRoots: missingRoots,
      materialAssets: missingMaterials,
      sheetImages: missingSheetImages,
    }))
  } catch (error) {
    window.alert(uiText.project.nativePathCheckFailed(errorMessage(error)))
  }
}

export const SHEET_VIEWPORT_FIT_INSET = { horizontal: 24, vertical: 54 }

export const SHEET_AUTO_FIT_MIN_ZOOM = 0.5

export const SHEET_AUTO_FIT_ZOOM_EPSILON = 0.001
