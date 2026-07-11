import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type FocusEvent, type FormEvent, type MouseEvent, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  addAnnotation,
  addBlankSharedCutToProjectDocument,
  addOverlayPaperTrack,
  assignSheetSourceToPage,
  applyNameNormalizationPlan,
  activeCutProjectFromDocument,
  buildCspImportPackage,
  cspTopToBottomFromXdtsBottomToTop,
  buildExportPlan,
  buildNameNormalizationPlan,
  cellRectForHit,
  clearEvent,
  clearAnnotations,
  clearAnnotationsForPage,
  commitHistory,
  createKey,
  createStackGuideLabel,
  createSheetPages,
  createDefaultProject,
  createProjectDocumentFromCutProject,
  createDefaultSheetViewState,
  createRecognizedEvent,
  createProjectHistory,
  defaultCspCellName,
  defaultCorrectionLayerId,
  DEFAULT_PRE_ROLL_FRAMES,
  deleteOverlayPaperTrack,
  deleteStackGuideLabel,
  eraseAnnotations,
  findTimingKeyByDisplayLabel,
  type Annotation,
  type CellBinding,
  type CorrectionLayer,
  type CutProject,
  type AnnotationPoint,
  type AnnotationStroke,
  type AnnotationText,
  type CspTrackSlot,
  type ExportProfile,
  type FileRef,
  type NormalizedRect,
  type NormalizedPoint,
  type NameNormalizationOptions,
  type NameNormalizationPlan,
  type PaperTrack,
  type CutGroupProjectDocument,
  type SheetHit,
  type SheetImageAlignment,
  type SheetCalibrationPointPair,
  type SheetPage,
  type SheetSource,
  type SheetTemplate,
  type SheetTimingRole,
  type SheetViewState,
  type SheetViewMode,
  type RecognitionCandidate,
  type StackGuideLabel,
  type TimelineEvent,
  formatLogicalSheetFrameTimecode,
  getSheetTemplateHiddenPaperTracks,
  getSheetTemplatePaperTracks,
  getSheetViewLayout,
  redoHistory,
  resolveSheetTemplateGridFrames,
  resolveSheetTemplateGridLayout,
  resolveSheetTemplatePageSize,
  resolveSheetTemplateRegionRect,
  setEvent,
  sheetTimingRoleForEvent,
  sheetTimingRoleForKey,
  stackGuideCspCellName,
  stackGuideGapIndex,
  stackGuideRegistrationForLayer,
  stackGuideRegistrations,
  stackGuideStackBand,
  sheetTemplatePresets,
  timingHitForFrame,
  undoHistory,
  updateKey,
  updateCorrectionLayers,
  updatePaperTrack,
  updateLogicalSheetSettings,
  updateProjectPaperTracks,
  updateStackGuideLabel,
  updateSheetPageViewState,
  updateSheetViewState,
  updateSlot,
  upsertBinding,
  assignAssetToStackGuideLabel,
  updateStackGuideRegistration,
  hasBlockingIssues,
  validateProject,
  standardA3SheetTemplate,
  registerAsset,
  registerAssetRoot,
  registerSheetSource,
  NULL_CELL_DISPLAY_LABEL,
  NULL_CELL_KEY_ID,
  type CutAsset,
  type TimingKey,
  globalizeSheetHit,
  hitTestSheetTemplate,
  localizeFrameToSheetPage,
  isNullCellKeyId,
  isNullLabel,
  logicalSheetDisplayDurationFrames,
  logicalSheetDisplayFrameEnd,
  logicalSheetDisplayFrameStart,
  logicalSheetFrameNumber,
  logicalSheetOfficialFrameEnd,
  logicalSheetWorkRange,
  parseProjectDocument,
  moveBindingToCorrectionLayer,
  type SheetTemplatePreset,
  updateActiveCutProjectInDocument,
  xdtsBottomToTopFromCspTopToBottom,
  switchActiveCutInProjectDocument,
  type AssetRoot,
} from '@xsheet-remap/core'
import { exportXdts } from '@xsheet-remap/xdts'
import { collectAssetPathDrop, confirmUserAction, fileToFileRef, isTauriHost, openImageFileRefs, readJsonFile, renameMaterialFiles, saveBinaryFile, saveJsonFile, saveTextFile, statNativePaths, writeBinaryFile, writeCspImportPackage, writeTextFile, type AssetRootCandidate, type SaveTextFileOptions } from '@xsheet-remap/adapters'
import { APP_VERSION } from './appVersion'
import {
  issueMessage,
  materialStateLabels,
  severityLabel,
  uiText,
  viewModeLabels,
} from './i18n'
import {
  type EditMode,
  type Panel,
  type Selection,
  type SheetRangeSelection,
  type SheetImageSettings,
  type SheetPageImage,
  type TimingClipboard,
  type WorkspaceStyle,
} from './appTypes'
import { defaultSheetImageExportOptions, hasPaperSheetImages, renderSheetImageExports, type SheetImageExportFormat, type SheetImageExportOptions } from './cleanSheetExport'
import { cspImportPackageTextOutputs } from './cspImportPackageOutputs'
import { projectFileName, sheetXdtsFileName } from './outputFileNames'
import { AssetTray, type AssetRegistrationSummary, type DropDiagnosticReport } from './AssetBrowser'
import { LevelCorrectionDialog } from './LevelCorrectionDialog'
import { defaultLevelCorrectionSettings, normalizeLevelCorrectionSettings, type LevelCorrectionSettings } from './levelCorrection'
import {
  assetBaseName,
  assetIdFromAssetTextDragData,
  assetIdFromAssetDragData,
  collectAssetFilesFromDrop,
  compareAssetNames,
  compareFileNames,
  hasAssetDragPayload,
  hasFileTransferPayload,
  isImageAssetFile,
  parseAssetIdsFromDragData,
  sheetImageRefFromAsset,
} from './assetFiles'
import {
  AssetFloatingPreview,
} from './assetPreview'
import {
  clampAssetPreviewRect,
  initialAssetPreviewRect,
  nativeAssetPreviewItemPayload,
  openNativeAssetPreviewPayload,
  updateNativeAssetPreviewPayloadIfOpen,
  writeAssetPreviewRect,
  type AssetPreviewItemPayload,
  type AssetPreviewPayload,
  type AssetPreviewRect,
} from './assetPreviewModel'
import { compareFileNameLikeText, compareNaturalFileNameText } from './naturalSort'
import { createPointerDragGhost, type PointerDragGhost } from './pointerDragGhost'
import {
  bindAssetToHit,
  cellAssetPreviewItemsForHit,
  cellAssetPreviewPosition,
  type CellAssetPreviewItem,
  isCellMaterialAsset,
  sortedCorrectionLayers,
} from './sheetAssets'
import { runDesktopE2EIfRequested } from './desktopE2E'
import {
  ASSET_MULTI_DRAG_MIME,
  ASSET_DRAG_MIME,
  ASSET_POINTER_DROP_EVENT,
  REGISTERED_CELL_DRAG_MIME,
  REGISTERED_CELL_POINTER_DROP_EVENT,
  REGISTERED_CELL_TEXT_DRAG_PREFIX,
  STACK_GUIDE_DRAG_MIME,
  SHEET_ZOOM_MAX,
  SHEET_ZOOM_MIN,
  SHEET_ZOOM_WHEEL_FACTOR,
  STANDARD_A3_GRID_HEADER_HEIGHT,
  STANDARD_A3_GRID_HEADER_TOP_OFFSET,
} from './sheetConstants'
import {
  buildTemplateChromeRenderModel,
  buildTemplateGridOverlayRenderModel,
  gridRowLineClassName,
  templateGridHeaderFontSizePx,
} from './templateEditorGeometry'
import {
  DEFAULT_TEXT_FONT_SIZE_PX,
  TEXT_FONT_SIZE_MAX_PX,
  TEXT_FONT_SIZE_MIN_PX,
  TEXT_FONT_SIZE_PRESETS,
  clampTextFontSizePx,
  defaultTimingTextFontSizePx,
  resolveTimingTextFontSizePx,
} from './sheetTextLayout'
import {
  annotationTextCssLayout,
  annotationTextLines,
  annotationTextSvgFontSize,
  resolveAnnotationTextFontSizePx,
  type AnnotationTextPageSize,
} from './annotationTextLayout'
import {
  createSheetRenderModelContext,
  metadataTextRenderItemsForPage,
  type SheetRenderModelContext,
} from './sheetRenderModel'
import {
  calibrationPointsForSettings,
  calibrationTargetRectForTemplate,
  clampPoint,
  getSheetPageImage,
  rawImageToViewportPoint,
  roundForInput,
  serializableImageRef,
  viewportToRawImagePoint,
} from './sheetImages'
import {
  candidateToHit,
  clampNumber,
  clampSheetZoom,
  fitZoomForViewport,
  handleNativeHorizontalWheelScroll,
  isTimingValueCharacter,
  modeShortcut,
  nextTimingHit,
  rangeRectsForPage,
  rangeSelectionFromHits,
  sheetRoleForHit,
  sheetRoleLabel,
  nativeVerticalWheelDelta,
} from './sheetInteraction'
import {
  buildTimingClipboard,
  canPasteTimingClipboardMode,
  clearTimingRange,
  deleteTimelineFrames,
  insertTimelineFrames,
  isPointEventRangeForUi,
  pasteResultRange,
  pasteTimingClipboardToProject,
  rangeContainsHit,
  rangePaperTracks,
  rippleDeleteTimingRange,
  sameSheetHitCell,
  timingPasteTarget,
  type TimelineDeleteDurationPolicy,
  type TimelineFrameEditScope,
  type TimelineInsertDurationPolicy,
} from './timingEditing'
import { Tooltip, TooltipTarget } from './Tooltip'
import { normalizeRecognitionLabel, recognizeSheetPages } from './sheetRecognition'
import { detectSheetCalibrationPoints, type AutoCalibrationDebugOverlay } from './sheetAutoCalibration'
import { CalibrationLoupeDialog } from './sheetCalibrationLoupe'
import { calibrationPointsSignature } from './sheetCalibrationUtils'
import { ActionMenu, PanelResizeHandle, ToolbarGroup } from './AppControls'
import { GridOverlayLayer, SheetImageLayer, TemplateChromeLayer } from './SheetTemplateLayers'
import { TemplateWorkspace } from './TemplateWorkspace'
import { CspLayerTree } from './CspLayerTree'
import {
  createPaperTemplateDraftFromImage,
  createTemplateDraft,
  readFileAsDataUrl,
  readImageDimensionsFromDataUrl,
  templateJsonFileName,
  type TemplateDraftKind,
} from './templateDrafts'

type StackGuideLabelUpdates = Parameters<typeof updateStackGuideLabel>[2]

type CalibrationPointKind = 'source' | 'target'
type AutoCalibrationOverlayState = AutoCalibrationDebugOverlay & { pageId: string }
type ActiveTextTarget =
  | { kind: 'nextTimingInput'; fontSizePx: number }
  | { kind: 'timingEvent'; eventId: string; fontSizePx: number }
  | { kind: 'timingRange'; fontSizePx: number }
  | { kind: 'annotationText'; annotationId: string; fontSizePx: number }
type TextAnnotationUpdate = Partial<Pick<AnnotationText, 'text' | 'fontSizePx' | 'x' | 'y' | 'color' | 'coordinateSpace' | 'anchor'>>
const IMPORTED_SHEET_SECONDS_PER_PAGE = 6
const IMPORTED_SHEET_IMAGE_INITIAL_OPACITY = 0.5
const SHEET_INTERACTION_ACTIVE_CLASS = 'sheetInteractionActive'
const CELL_ASSET_PREVIEW_MAX_ITEMS = 6
const TIMELINE_EVENT_LONG_PRESS_MS = 320
const TIMELINE_EVENT_DRAG_THRESHOLD_PX = 4
const CONTINUOUS_CANVAS_MIN_FRAME_ROW_PX = 10
export type MainAppKind = 'editor' | 'remap'

type SheetPaneVisibility = { left: boolean; right: boolean }

function initialSheetPaneVisibility(appKind: MainAppKind, collapseEditorPanes: boolean): SheetPaneVisibility {
  const fallback = appKind === 'remap' || !collapseEditorPanes
    ? { left: true, right: true }
    : { left: false, right: false }
  try {
    const stored = window.localStorage.getItem(`xsheet:${appKind}:sheet-panes`)
    if (!stored) return fallback
    const parsed = JSON.parse(stored) as Partial<SheetPaneVisibility>
    return {
      left: typeof parsed.left === 'boolean' ? parsed.left : fallback.left,
      right: typeof parsed.right === 'boolean' ? parsed.right : fallback.right,
    }
  } catch {
    return fallback
  }
}

const APP_PROFILES: Record<MainAppKind, { appName: string; panels: Panel[]; showDigitalHelp: boolean }> = {
  editor: {
    appName: 'xsheet-editor',
    panels: ['sheet', 'bindings', 'slots', 'template', 'export'],
    showDigitalHelp: true,
  },
  remap: {
    appName: 'xsheet-remap',
    panels: ['sheet'],
    showDigitalHelp: false,
  },
}
const STATUS_HINT_SOURCE_ORDER = ['sheet-drag', 'sheet-drop', 'overlay-paper-track', 'sheet-hover'] as const

type StatusHintSource = typeof STATUS_HINT_SOURCE_ORDER[number]
type StatusHints = Partial<Record<StatusHintSource, string>>

function activeStatusHintText(hints: StatusHints): string | null {
  for (const source of STATUS_HINT_SOURCE_ORDER) {
    const text = hints[source]
    if (text) return text
  }
  return null
}

type NativeDragDropPayload = {
  type: string
  paths?: string[]
  position?: { x: number; y: number }
}

type AssetDragWindow = Window & {
  __xsheetRemapAssetDragIds?: string[]
  __xsheetRemapRegisteredCellDragKeyId?: string
}

type AssetPointerDropDetail = {
  assetIds?: string[]
  clientX?: number
  clientY?: number
}

type AssetPointerDropEvent = CustomEvent<AssetPointerDropDetail>

type RegisteredCellPointerDropDetail = {
  keyId?: string
  clientX?: number
  clientY?: number
}

function registeredCellTextDragData(keyId: string): string {
  return `${REGISTERED_CELL_TEXT_DRAG_PREFIX}${keyId}`
}

function keyIdFromRegisteredCellTextDragData(value: string): string {
  return value.startsWith(REGISTERED_CELL_TEXT_DRAG_PREFIX)
    ? value.slice(REGISTERED_CELL_TEXT_DRAG_PREFIX.length)
    : ''
}

type FrameOperationKind = 'insert' | 'delete'

type FrameOperationDialogState = {
  kind: FrameOperationKind
  role: SheetTimingRole
  paperTrack: string
  paperTracks: string[]
  frameStart: number
  frameEnd: number
  sourceHit: SheetHit
  sourceRange: SheetRangeSelection | null
}

type FrameOperationSubmit = {
  scope: TimelineFrameEditScope
  frameCount: number
  durationPolicy: TimelineInsertDurationPolicy | TimelineDeleteDurationPolicy
}

interface SheetContextMenuState {
  x: number
  y: number
  hit: SheetHit | null
  snapIndex?: number
  sheetRole?: SheetTimingRole
  insertAfterPaperTrack?: string
}

interface PaperTrackHeaderMenuState {
  x: number
  y: number
  hit: SheetHit
  snapIndex?: number
  sheetRole: SheetTimingRole
}

interface OverlayPaperTrackMenuState {
  x: number
  y: number
  paperTrack: string
}

interface StackGuideInsertTarget {
  pageId: string
  regionId: string
  gapIndex: number
  insertAfterPaperTrack?: string
  displayRole: SheetTimingRole
  snapIndex: number
}

interface StackGuideHeaderMenuState extends StackGuideInsertTarget {
  x: number
  y: number
}

interface StackGuideInsertRequest extends StackGuideInsertTarget {
  requestId: number
  mode: StackGuideInsertTool
}

type StackGuideInsertTool = 'label-editor' | 'overlay-track'

interface StackGuideDropPreviewState extends StackGuideInsertTarget {
  labelId?: string
}

interface PaperTrackEditorState {
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

interface AssetDropMenuState {
  x: number
  y: number
  assetId: string
  keyId: string
  hit: SheetHit | null
}

type SheetScrollRequest = {
  requestId: number
  hit: SheetHit
}

type RegisteredCellFirstUse = {
  timecode: string
  title: string
  paperTrack: string
  frame: number
  role: SheetTimingRole
}

type ImportedSheetSourceCalibrationTarget = {
  pageId: string
  sourceId: string
  imageUrl: string
}

type ImportedSheetSourceCalibrationResult = {
  target: ImportedSheetSourceCalibrationTarget
  points: SheetCalibrationPointPair[]
}

type CalibrationGuideMetrics = {
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

function clientPointCandidatesFromNativeDropPosition(position: { x: number; y: number }): Array<{ x: number; y: number }> {
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

function isImageFileRef(ref: FileRef): boolean {
  return /\.(?:png|jpe?g|gif|webp|bmp|tiff?|tga)$/i.test(ref.name)
}

function normalizeFsPath(path?: string): string {
  return (path ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
}

function pathCompareKey(path?: string): string {
  return normalizeFsPath(path).toLocaleLowerCase()
}

function relativePathFromRoot(filePath?: string, rootPath?: string): string | undefined {
  const file = normalizeFsPath(filePath)
  const root = normalizeFsPath(rootPath)
  if (!file || !root) return undefined
  const fileKey = pathCompareKey(file)
  const rootKey = pathCompareKey(root)
  if (fileKey === rootKey) return undefined
  if (!fileKey.startsWith(`${rootKey}/`)) return undefined
  return file.slice(root.length + 1)
}

function assetRootForFile(roots: AssetRoot[], ref: FileRef): AssetRoot | undefined {
  const explicitRoot = ref.rootPath
    ? roots.find(root => pathCompareKey(root.path) === pathCompareKey(ref.rootPath))
    : undefined
  if (explicitRoot) return explicitRoot
  return roots
    .filter(root => relativePathFromRoot(ref.path, root.path))
    .sort((a, b) => normalizeFsPath(b.path).length - normalizeFsPath(a.path).length)[0]
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

function formatPaddedFrameTimecode(project: CutProject, frame: number): string {
  const fpsDigits = Math.max(2, String(Math.max(1, Math.round(project.logicalSheet.fps))).length)
  const raw = formatLogicalSheetFrameTimecode(frame, project.logicalSheet.frameOrigin, project.logicalSheet.fps)
  const [rawSeconds = '0', rawKoma = '1'] = raw.split('+')
  const sign = rawSeconds.startsWith('-') ? '-' : ''
  const seconds = rawSeconds.replace(/^-/, '')
  return `${sign}${seconds.padStart(2, '0')}+${rawKoma.padStart(fpsDigits, '0')}`
}

function formatPaddedDurationTimecode(project: CutProject, frameCount: number): string {
  const safeFps = Math.max(1, Math.round(project.logicalSheet.fps))
  const totalFrames = Math.max(0, Math.round(frameCount))
  const seconds = Math.floor(totalFrames / safeFps)
  const koma = totalFrames % safeFps
  const fpsDigits = Math.max(2, String(safeFps).length)
  return `${String(seconds).padStart(2, '0')}+${String(koma).padStart(fpsDigits, '0')}`
}

function formatFramePosition(project: CutProject, frame: number): string {
  return `${formatFrameNumber(project, frame)} (${formatPaddedFrameTimecode(project, frame)})`
}

function formatFrameRangePosition(project: CutProject, frameStart: number, frameEnd: number): string {
  if (frameStart === frameEnd) return formatFramePosition(project, frameStart)
  return `${formatFrameNumber(project, frameStart)}-${formatFrameNumber(project, frameEnd)} (${formatPaddedFrameTimecode(project, frameStart)}-${formatPaddedFrameTimecode(project, frameEnd)})`
}

function sheetHitTargetLabel(project: CutProject, hit: SheetHit): string {
  return `${sheetRoleLabel(sheetRoleForHit(hit))} ${hit.paperTrack ?? '-'} ${formatFramePosition(project, hit.frame)}`
}

function sheetHitStatusHint(project: CutProject, hit: SheetHit): string {
  const role = sheetRoleLabel(sheetRoleForHit(hit))
  const paperTrack = hit.paperTrack ?? '-'
  const frame = formatFramePosition(project, hit.frame)
  return timelineEventAtHit(project, hit)
    ? uiText.statusHints.cellEvent(role, paperTrack, frame)
    : uiText.statusHints.cellEmpty(role, paperTrack, frame)
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

function exportCutProjectsFromDocument(document: CutGroupProjectDocument): CutProject[] {
  if (document.cuts.length === 0) return [activeCutProjectFromDocument(document)]
  return document.cuts.map(cut => activeCutProjectFromDocument({ ...document, activeCutId: cut.cutId }))
}

function fileDialogInitialDirectory(project: CutProject): string | undefined {
  return project.assetRoots.find(root => root.path)?.path
}

async function saveTextOutputs(outputs: TextFileOutput[], mimeType: string, options: SaveTextFileOptions): Promise<boolean> {
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

async function saveBinaryOutputs(outputs: BinaryFileOutput[], options: SaveTextFileOptions): Promise<boolean> {
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

function cspImportPackageAssetPaths(packageBuild: ReturnType<typeof buildCspImportPackage>): string[] {
  const assetRootPath = packageBuild.assetRootPath
  if (!assetRootPath) return []
  const paths = new Set<string>()
  for (const cut of packageBuild.manifest.cuts) {
    for (const track of cut.tracks) {
      for (const cel of track.cels) {
        if (cel.assetPath) paths.add(joinOutputPath(assetRootPath, cel.assetPath))
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
  const rootsById = new Map(document.assetRoots.map(root => [root.rootId, root]))
  const assetPathById = new Map(document.assets.map(asset => [asset.assetId, nativePathForProjectAsset(asset, rootsById)]))
  const sheetImages = new Set<string>()

  for (const cut of document.cuts) {
    for (const source of cut.sheetView.sources) {
      if (source.kind !== 'sheet-scan') continue
      const path = source.imageRef.path ?? (source.assetId ? assetPathById.get(source.assetId) : undefined)
      if (path) sheetImages.add(path)
    }
  }

  return {
    assetRoots: uniquePathList(document.assetRoots.map(root => root.path)),
    materialAssets: uniquePathList(document.assets.filter(isCellMaterialAsset).map(asset => nativePathForProjectAsset(asset, rootsById))),
    sheetImages: uniquePathList([...sheetImages]),
  }
}

function nativePathForProjectAsset(asset: CutAsset, rootsById: Map<string, AssetRoot>): string | undefined {
  if (asset.currentPath) return asset.currentPath
  const rootPath = asset.rootId ? rootsById.get(asset.rootId)?.path : undefined
  return rootPath && asset.relativePath ? joinOutputPath(rootPath, asset.relativePath) : undefined
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

async function alertMissingProjectNativePaths(document: CutGroupProjectDocument): Promise<void> {
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

const SHEET_VIEWPORT_FIT_INSET = { horizontal: 24, vertical: 54 }
const SHEET_AUTO_FIT_MIN_ZOOM = 0.5
const SHEET_AUTO_FIT_ZOOM_EPSILON = 0.001

export function EditorApp() {
  return <App appKind="editor" collapseEditorSheetPanes />
}

export function RemapApp() {
  return <App appKind="remap" />
}

export function App({ appKind = 'editor', collapseEditorSheetPanes = false }: { appKind?: MainAppKind; collapseEditorSheetPanes?: boolean } = {}) {
  const appProfile = APP_PROFILES[appKind]
  const [history, setHistory] = useState(() => createProjectHistory(createDefaultProject()))
  const [projectDocument, setProjectDocument] = useState(() => createProjectDocumentFromCutProject(createDefaultProject()))
  const [projectFilePath, setProjectFilePath] = useState<string | null>(null)
  const paperSheetInputRef = useRef<HTMLInputElement | null>(null)
  const project = history.present
  const projectRef = useRef(project)
  const [template, setTemplate] = useState<SheetTemplate>(() => standardA3SheetTemplate)
  const templatePanelKey = useMemo(() => JSON.stringify(template), [template])
  const [runtimeSourceImageUrls, setRuntimeSourceImageUrls] = useState<Record<string, string>>({})
  const [recognitionCandidates, setRecognitionCandidates] = useState<RecognitionCandidate[]>([])
  const [recognitionRole, setRecognitionRole] = useState<SheetTimingRole>('cell')
  const [recognitionRunning, setRecognitionRunning] = useState(false)
  const [recognitionProgress, setRecognitionProgress] = useState<{ completed: number; total: number } | null>(null)
  const [recognitionMessage, setRecognitionMessage] = useState<string | null>(null)
  const [autoCalibrationRunning, setAutoCalibrationRunning] = useState(false)
  const [autoCalibrationMessage, setAutoCalibrationMessage] = useState<string | null>(null)
  const [autoCalibrationOverlay, setAutoCalibrationOverlay] = useState<AutoCalibrationOverlayState | null>(null)
  const [calibrationLoupeOpen, setCalibrationLoupeOpen] = useState(false)
  const [panel, setPanel] = useState<Panel>('sheet')
  const [editMode, setEditMode] = useState<EditMode>('new')
  const [zoom, setZoom] = useState(1)
  const [zoomMode, setZoomMode] = useState(false)
  const [showTemplate, setShowTemplate] = useState(true)
  const [showTemplateGuides, setShowTemplateGuides] = useState(true)
  const [showAnnotations, setShowAnnotations] = useState(true)
  const [penColor, setPenColor] = useState('#d52b2b')
  const [penWidth, setPenWidth] = useState(0.004)
  const [eraserWidth, setEraserWidth] = useState(0.018)
  const [textFontSizePx, setTextFontSizePx] = useState(DEFAULT_TEXT_FONT_SIZE_PX)
  const [selectedTextAnnotationId, setSelectedTextAnnotationId] = useState<string | null>(null)
  const [editingTextAnnotationId, setEditingTextAnnotationId] = useState<string | null>(null)
  const [textAnnotationClipboard, setTextAnnotationClipboard] = useState<AnnotationText | null>(null)
  const [selection, setSelection] = useState<Selection>({ hit: null, keyId: null })
  const [rangeSelection, setRangeSelection] = useState<SheetRangeSelection | null>(null)
  const [sheetScrollRequest, setSheetScrollRequest] = useState<SheetScrollRequest | null>(null)
  const [timingClipboard, setTimingClipboard] = useState<TimingClipboard | null>(null)
  const [statusHints, setStatusHints] = useState<StatusHints>({})
  const [valueDraft, setValueDraft] = useState('')
  const [valueDraftActive, setValueDraftActive] = useState(false)
  const [exportProfileId, setExportProfileId] = useState('import-stack')
  const [sheetImageExportDraft, setSheetImageExportDraft] = useState<SheetImageExportOptions | null>(null)
  const [sheetLevelCorrectionDialogOpen, setSheetLevelCorrectionDialogOpen] = useState(false)
  const [appHelpDialogOpen, setAppHelpDialogOpen] = useState(false)
  const [exportSettingsDialogOpen, setExportSettingsDialogOpen] = useState(false)
  const [frameOperationDialog, setFrameOperationDialog] = useState<FrameOperationDialogState | null>(null)
  const [assetDropMenu, setAssetDropMenu] = useState<AssetDropMenuState | null>(null)
  const [activeCorrectionLayerIdState, setActiveCorrectionLayerIdState] = useState(() => defaultCorrectionLayerId(createDefaultProject()) ?? '')
  const nativeFileDropHandlerRef = useRef<(paths: string[], position: { x: number; y: number }) => void>(() => undefined)
  const nativeDragDropPayloadHandlerRef = useRef<(payload: NativeDragDropPayload, source: string) => void>(() => undefined)
  const nativeFileDropDedupeRef = useRef<{ signature: string; timestamp: number } | null>(null)

  const issues = useMemo(() => validateProject(project, project.exportProfiles.find(profile => profile.profileId === exportProfileId)), [project, exportProfileId])
  const projectDocumentSnapshot = useMemo(
    () => updateActiveCutProjectInDocument(projectDocument, project, { sheetTemplate: template }),
    [projectDocument, project, template],
  )
  const projectCuts = projectDocumentSnapshot.cuts
  const exportPlan = useMemo(() => buildExportPlan(project, exportProfileId), [project, exportProfileId])
  const xdtsText = useMemo(() => exportXdts(exportPlan), [exportPlan])
  const sheetDisplayFrameStart = logicalSheetDisplayFrameStart(project.logicalSheet)
  const sheetDisplayFrameEnd = logicalSheetDisplayFrameEnd(project.logicalSheet)
  const sheetDisplayDurationFrames = logicalSheetDisplayDurationFrames(project.logicalSheet)
  const sheetPages = useMemo(() => createSheetPages(template, sheetDisplayDurationFrames, sheetDisplayFrameStart), [template, sheetDisplayDurationFrames, sheetDisplayFrameStart])
  const sheetSourceRuntimePathEntries = useMemo(() => {
    const assetPathById = new Map(project.assets.map(asset => [asset.assetId, asset.currentPath]))
    return project.sheetView.sources.flatMap(source => {
      if (source.kind !== 'sheet-scan') return []
      const path = source.imageRef.path ?? (source.assetId ? assetPathById.get(source.assetId) : undefined)
      return path ? [{ sourceId: source.sourceId, path }] : []
    })
  }, [project.assets, project.sheetView.sources])
  const activeSheetPageSize = useMemo(
    () => resolveSheetTemplatePageSize(template, sheetDisplayDurationFrames, {
      paperTracks: templatePaperTracks(project).map(track => track.paperTrack),
      layoutOverrides: project.sheetView.layoutOverrides,
    }),
    [project, sheetDisplayDurationFrames, template],
  )
  const activePageIndexFromState = Math.max(0, sheetPages.findIndex(page => page.pageId === project.sheetView.activePageId))
  const clampedActivePageIndex = Math.min(activePageIndexFromState, Math.max(0, sheetPages.length - 1))
  const activePage = sheetPages[clampedActivePageIndex] ?? sheetPages[0]
  const activePageImage = getSheetPageImage(project.sheetView, runtimeSourceImageUrls, activePage?.pageId ?? 'page_1', template)
  const hasRecognitionSheetImages = sheetPages.some(page => {
    const pageImage = getSheetPageImage(project.sheetView, runtimeSourceImageUrls, page.pageId, template)
    return Boolean(pageImage.sourceId && pageImage.imageUrl)
  })
  const selectedKey = selection.keyId ? project.logicalSheet.keys.find(key => key.keyId === selection.keyId) ?? null : null
  const fallbackCorrectionLayerId = defaultCorrectionLayerId(project) ?? ''
  const activeCorrectionLayerId = project.correctionLayers.some(layer => layer.layerId === activeCorrectionLayerIdState)
    ? activeCorrectionLayerIdState
    : fallbackCorrectionLayerId
  const activeCorrectionLayer = project.correctionLayers.find(layer => layer.layerId === activeCorrectionLayerId) ?? null
  const materialAssets = useMemo(() => project.assets.filter(isCellMaterialAsset), [project.assets])
  const blockingExport = hasBlockingIssues(issues)
  const issueErrorCount = issues.filter(issue => issue.severity === 'error').length
  const issueWarningCount = issues.filter(issue => issue.severity === 'warning').length
  const activeCalibrationPoints = activePage ? calibrationPointsForSettings(activePageImage.settings, template) : []
  const activeCalibrationPointsKey = calibrationPointsSignature(activeCalibrationPoints)
  const selectedKeySummary = selection.keyId
    ? isNullCellKeyId(selection.keyId)
      ? NULL_CELL_DISPLAY_LABEL
      : selectedKey ? `${selectedKey.displayLabel} (${selectedKey.keyId})` : '-'
    : '-'
  const selectedFrameSummary = rangeSelection
    ? formatFrameRangePosition(project, rangeSelection.frameStart, rangeSelection.frameEnd)
    : selection.hit
      ? formatFramePosition(project, selection.hit.frame)
      : '-'
  const rangeSummary = rangeSelection
    ? `${rangeSelection.role.toUpperCase()} ${rangeSelection.paperTrack ?? rangeSelection.columnId} ${selectedFrameSummary}`
    : null
  const selectedTextAnnotation = selectedTextAnnotationId
    ? project.annotations.find((annotation): annotation is AnnotationText => annotation.kind === 'text' && annotation.annotationId === selectedTextAnnotationId) ?? null
    : null
  const editingTextAnnotation = editingTextAnnotationId
    ? project.annotations.find((annotation): annotation is AnnotationText => annotation.kind === 'text' && annotation.annotationId === editingTextAnnotationId) ?? null
    : null
  const selectedTimelineEvent = timelineEventAtHit(project, selection.hit)
  const selectedTimelineEventFontSizePx = selectedTimelineEvent
    ? resolveTimingTextFontSizePx(template, sheetTimingRoleForEvent(selectedTimelineEvent), selectedTimelineEvent.fontSizePx)
    : undefined
  const activeTextTarget: ActiveTextTarget = selectedTextAnnotation
    ? { kind: 'annotationText', annotationId: selectedTextAnnotation.annotationId, fontSizePx: resolveAnnotationTextFontSizePx(selectedTextAnnotation, activeSheetPageSize) }
    : rangeSelection
      ? { kind: 'timingRange', fontSizePx: textFontSizePx }
      : selectedTimelineEvent && selectedTimelineEventFontSizePx !== undefined
        ? { kind: 'timingEvent', eventId: selectedTimelineEvent.eventId, fontSizePx: selectedTimelineEventFontSizePx }
        : { kind: 'nextTimingInput', fontSizePx: textFontSizePx }
  const activeTextFontSizePx = activeTextTarget.fontSizePx
  const hasSelectedTextTarget = activeTextTarget.kind === 'annotationText' || activeTextTarget.kind === 'timingEvent'
  const isTextFontSizeDisabled = activeTextTarget.kind === 'timingRange'
  const setStatusHint = useCallback((source: StatusHintSource, text: string | null) => {
    setStatusHints(current => {
      if (text === null) {
        if (!(source in current)) return current
        const next = { ...current }
        delete next[source]
        return next
      }
      if (current[source] === text) return current
      return { ...current, [source]: text }
    })
  }, [])
  const switchPanel = useCallback((nextPanel: Panel) => {
    setStatusHints({})
    setPanel(nextPanel)
  }, [])
  const activeStatusHint = activeStatusHintText(statusHints)
  const statusSelectionText = rangeSummary
    ? `${activeCorrectionLayer?.label ?? '-'} / ${rangeSummary}`
    : selection.hit
      ? `${activeCorrectionLayer?.label ?? '-'} / ${sheetRoleLabel(sheetRoleForHit(selection.hit))} ${selection.hit.paperTrack ?? '-'} ${selectedFrameSummary}`
      : `${activeCorrectionLayer?.label ?? '-'} / ${uiText.app.noCellSelected}`
  const statusFallbackHint = panel === 'sheet'
    ? editMode === 'calibrate'
      ? uiText.statusHints.calibrateMode
      : editMode === 'pen'
        ? uiText.statusHints.penMode
        : editMode === 'eraser'
          ? uiText.statusHints.eraserMode
          : editMode === 'text'
            ? uiText.statusHints.textMode
            : rangeSelection
              ? uiText.statusHints.selectedRange(Boolean(timingClipboard))
              : selection.hit
                ? uiText.statusHints.selectedCell(Boolean(selectedTimelineEvent))
                : uiText.statusHints.sheetIdle
    : ''
  const statusHintText = activeStatusHint ?? statusFallbackHint

  useEffect(() => {
    projectRef.current = project
  }, [project])

  useEffect(() => {
    if (!selectedKey || isNullCellKeyId(selectedKey.keyId)) return
    void updateNativeRegisteredCellPreviewIfOpen(project, selectedKey)
  }, [project, selectedKey])

  useEffect(() => {
    void runDesktopE2EIfRequested({
      applyProject: (nextProject, nextTemplate) => {
        setTemplate(nextTemplate)
        setTextFontSizePx(defaultTimingTextFontSizePx(nextTemplate, 'cell'))
        setProjectDocument(createProjectDocumentFromCutProject(nextProject, { sheetTemplate: nextTemplate }))
        setProjectFilePath(null)
        setHistory(createProjectHistory(nextProject))
        switchPanel('export')
        setActiveCorrectionLayerIdState(defaultCorrectionLayerId(nextProject) ?? '')
      },
    })
  }, [switchPanel])

  useEffect(() => {
    if (!isTauriHost() || sheetSourceRuntimePathEntries.length === 0) return undefined
    let cancelled = false

    void import('@tauri-apps/api/core')
      .then(({ convertFileSrc }) => {
        if (cancelled) return
        setRuntimeSourceImageUrls(current => {
          let changed = false
          const next = { ...current }
          for (const entry of sheetSourceRuntimePathEntries) {
            const imageUrl = convertFileSrc(entry.path)
            if (next[entry.sourceId] === imageUrl) continue
            next[entry.sourceId] = imageUrl
            changed = true
          }
          return changed ? next : current
        })
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [sheetSourceRuntimePathEntries])

  function commitProject(nextProject: CutProject) {
    projectRef.current = nextProject
    setHistory(current => commitHistory(current, nextProject))
    if (selectionIsOutsideProjectDisplay(nextProject)) clearSelectionState()
  }

  async function handleNativeFileDrop(paths: string[], position: { x: number; y: number }) {
    const clientPoints = clientPointCandidatesFromNativeDropPosition(position)
    const assetBrowserTarget = isAssetBrowserNativeDropTarget(clientPoints)
    if (assetBrowserTarget) {
      const roots = await assetRootCandidatesFromNativePaths(paths)
      recordDropDiagnostic({
        source: 'native-router',
        type: 'route',
        target: 'asset-browser',
        paths,
        position,
        details: `素材ブラウザ判定 / フォルダ候補 ${roots.length}件`,
      })
      handleAssetRootCandidates(roots)
      return
    }
    const directoryRoots = await assetRootCandidatesFromNativePaths(paths)
    if (directoryRoots.length > 0) {
      recordDropDiagnostic({
        source: 'native-router',
        type: 'route',
        target: 'asset-root',
        paths,
        position,
        details: `フォルダ候補 ${directoryRoots.length}件 / 座標に関係なく登録`,
      })
      handleAssetRootCandidates(directoryRoots)
      return
    }
    const sheetPoint = clientPoints.find(point => nativeSheetHitFromClientPoint(point.x, point.y)) ?? clientPoints[0] ?? position
    const hit = nativeSheetHitFromClientPoint(sheetPoint.x, sheetPoint.y)
    recordDropDiagnostic({
      source: 'native-router',
      type: 'route',
      target: hit ? `${sheetRoleLabel(sheetRoleForHit(hit))} ${hit.paperTrack ?? '-'}` : 'sheet/no-hit',
      paths,
      position,
      details: hit ? `フレーム ${hit.frame + 1}` : 'シートヒットなし',
    })
    void handleAssetNativePaths(paths, hit, sheetPoint, { recursive: false })
  }

  function isAssetBrowserNativeDropTarget(points: Array<{ x: number; y: number }>): boolean {
    if (document.querySelector('.assetBrowser-dropActive')) return true
    const browsers = Array.from(document.querySelectorAll<HTMLElement>('.assetBrowser'))
    return points.some(point => {
      const target = document.elementFromPoint(point.x, point.y)
      if (target instanceof Element && target.closest('.assetBrowser')) return true
      return browsers.some(browser => {
        const rect = browser.getBoundingClientRect()
        return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
      })
    })
  }

  useEffect(() => {
    nativeFileDropHandlerRef.current = (paths, position) => {
      void handleNativeFileDrop(paths, position)
    }
  })

  function recordDropDiagnostic(report: DropDiagnosticReport) {
    void report
  }

  function handleNativeDragDropPayload(payload: NativeDragDropPayload, source: string) {
    const position = payload.position ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    if (payload.type === 'drop' && Array.isArray(payload.paths) && payload.paths.length > 0) {
      const signature = `${payload.paths.join('\u001f')}@${Math.round(position.x)},${Math.round(position.y)}`
      const timestamp = performance.now()
      const previous = nativeFileDropDedupeRef.current
      if (previous && previous.signature === signature && timestamp - previous.timestamp < 500) return
      nativeFileDropDedupeRef.current = { signature, timestamp }
    }
    recordDropDiagnostic({
      source,
      type: payload.type,
      paths: payload.paths,
      position,
      fileCount: payload.paths?.length ?? 0,
      details: payload.paths ? `${payload.paths.length}パス` : 'パスなし',
    })
    if (payload.type !== 'drop' || !Array.isArray(payload.paths) || payload.paths.length === 0) return
    nativeFileDropHandlerRef.current(payload.paths, position)
  }

  useEffect(() => {
    nativeDragDropPayloadHandlerRef.current = handleNativeDragDropPayload
  })

  useEffect(() => {
    if (!isTauriHost()) return undefined
    let disposed = false
    const unlisteners: Array<() => void> = []
    async function subscribeNativeDropEvents() {
      const [{ getCurrentWebview }, { getCurrentWindow }, { listen }] = await Promise.all([
        import('@tauri-apps/api/webview'),
        import('@tauri-apps/api/window'),
        import('@tauri-apps/api/event'),
      ])
      const nextUnlisteners = await Promise.all([
        getCurrentWebview().onDragDropEvent(event => nativeDragDropPayloadHandlerRef.current(event.payload, 'native:webview')),
        getCurrentWindow().onDragDropEvent(event => nativeDragDropPayloadHandlerRef.current(event.payload, 'native:window')),
        listen('tauri://drag-drop', event => nativeDragDropPayloadHandlerRef.current(event.payload as NativeDragDropPayload, 'native:event')),
      ])
      if (disposed) {
        nextUnlisteners.forEach(unlisten => unlisten())
        return
      }
      unlisteners.push(...nextUnlisteners)
    }
    void subscribeNativeDropEvents().catch(error => {
      console.error('Failed to subscribe native file drop event', error)
    })
    return () => {
      disposed = true
      unlisteners.forEach(unlisten => unlisten())
    }
  }, [])

  function nativeSheetHitFromClientPoint(clientX: number, clientY: number): SheetHit | null {
    const target = document.elementFromPoint(clientX, clientY)
    const svg = target instanceof Element ? target.closest<SVGSVGElement>('svg.sheetSvg') : null
    if (!svg) return null
    const page = sheetPages.find(item => item.pageId === svg.dataset.pageId)
    if (!page) return null
    const box = svg.getBoundingClientRect()
    if (box.width <= 0 || box.height <= 0) return null
    const point = {
      x: (clientX - box.left) / box.width,
      y: (clientY - box.top) / box.height,
    }
    if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return null
    const frameOrigin = frameOriginForPageHit(template, page)
    const templateTrackNames = templatePaperTracks(project).map(track => track.paperTrack)
    const hitOptions = { paperTracks: templateTrackNames, durationFrames: page.frameEnd - page.frameStart + 1, frameOrigin, layoutOverrides: project.sheetView.layoutOverrides }
    const localHit = hitTestSheetTemplate(template, point, { ...hitOptions, role: 'cell' })
      ?? hitTestSheetTemplate(template, point, { ...hitOptions, role: 'action' })
    if (!localHit?.paperTrack) return null
    const hit = materializePageHit(template, localHit, page)
    return hit.frame <= page.frameEnd ? hit : null
  }

  function selectionIsOutsideProjectDisplay(sourceProject: CutProject): boolean {
    const displayStart = logicalSheetDisplayFrameStart(sourceProject.logicalSheet)
    const displayEnd = logicalSheetDisplayFrameEnd(sourceProject.logicalSheet)
    const hitOutsideDisplay = selection.hit
      ? selection.hit.frame < displayStart || selection.hit.frame > displayEnd
      : false
    const rangeOutsideDisplay = rangeSelection
      ? rangeSelection.frameStart < displayStart || rangeSelection.frameEnd > displayEnd
      : false
    return hitOutsideDisplay || rangeOutsideDisplay
  }

  function clearSelectionState() {
    setSelection({ hit: null, keyId: null })
    setRangeSelection(null)
    setSelectedTextAnnotationId(null)
    setEditingTextAnnotationId(null)
    setValueDraft('')
    setValueDraftActive(false)
  }

  function setActivePageIndex(pageIndex: number) {
    const page = sheetPages[pageIndex]
    if (!page || project.sheetView.activePageId === page.pageId) return
    commitProject(updateSheetViewState(project, { activePageId: page.pageId }))
  }

  function updateTiming(updates: Parameters<typeof updateLogicalSheetSettings>[1]) {
    commitProject(updateLogicalSheetSettings(project, updates.workRange
      ? { ...updates, workRange: { ...updates.workRange, preRollFrames: DEFAULT_PRE_ROLL_FRAMES, showPostRoll: true } }
      : updates))
  }

  function updateExportTimingSourceRole(sheetRole: SheetTimingRole) {
    updateExportProfile(exportProfileId, { timingSourceRole: sheetRole })
  }

  function updateExportProfile(profileId: string, updates: Partial<ExportProfile>) {
    commitProject({
      ...project,
      exportProfiles: project.exportProfiles.map(profile =>
        profile.profileId === profileId ? { ...profile, ...updates } : profile,
      ),
    })
  }

  function eventKeyIdAtHit(hit: SheetHit | null, sourceProject: CutProject = project): string | null {
    if (!hit?.paperTrack) return null
    const sheetRole = sheetRoleForHit(hit)
    return sourceProject.logicalSheet.events.find(event => event.paperTrack === hit.paperTrack && event.frame === hit.frame && sheetTimingRoleForEvent(event) === sheetRole)?.keyId ?? null
  }

  function keyAtHit(sourceProject: CutProject, hit: SheetHit | null): TimingKey | null {
    const keyId = eventKeyIdAtHit(hit, sourceProject)
    if (!keyId || isNullCellKeyId(keyId)) return null
    return sourceProject.logicalSheet.keys.find(key => key.keyId === keyId) ?? null
  }

  function keyDisplayLabelForId(keyId: string | null | undefined, sourceProject: CutProject = project): string {
    if (!keyId) return ''
    if (isNullCellKeyId(keyId)) return NULL_CELL_DISPLAY_LABEL
    return sourceProject.logicalSheet.keys.find(item => item.keyId === keyId)?.displayLabel ?? ''
  }

  function setTimingValueAt(sourceProject: CutProject, hit: SheetHit, rawValue: string, fontSizePx = activeTextFontSizePx): { project: CutProject; keyId: string | null } {
    if (!hit.paperTrack) return { project: sourceProject, keyId: null }
    const value = rawValue.trim()
    const sheetRole = sheetRoleForHit(hit)
    if (!value) {
      return { project: clearEvent(sourceProject, hit.paperTrack, hit.frame, sheetRole), keyId: null }
    }
    if (isNullLabel(value)) {
      return {
        project: setEvent(sourceProject, hit.paperTrack, hit.frame, NULL_CELL_KEY_ID, sheetRole, { fontSizePx }),
        keyId: NULL_CELL_KEY_ID,
      }
    }

    const existingKeyId = eventKeyIdAtHit(hit, sourceProject)
    const reusableKey = findTimingKeyByDisplayLabel(sourceProject, hit.paperTrack, value, sheetRole)
    if (reusableKey && reusableKey.keyId !== existingKeyId) {
      return {
        project: setEvent(sourceProject, hit.paperTrack, hit.frame, reusableKey.keyId, sheetRole, { fontSizePx }),
        keyId: reusableKey.keyId,
      }
    }
    if (existingKeyId && !isNullCellKeyId(existingKeyId)) {
      return {
        project: updateKey(sourceProject, existingKeyId, { displayLabel: value, paperToken: value }),
        keyId: existingKeyId,
      }
    }

    const created = createKey(sourceProject, hit.paperTrack, value, 'manual', value, sheetRole)
    return {
      project: setEvent(created.project, hit.paperTrack, hit.frame, created.key.keyId, sheetRole, { fontSizePx }),
      keyId: created.key.keyId,
    }
  }

  function setSelectionFromHit(hit: SheetHit, sourceProject: CutProject = project, keyIdOverride?: string | null) {
    const keyId = keyIdOverride === undefined ? eventKeyIdAtHit(hit, sourceProject) : keyIdOverride
    setRangeSelection(null)
    setSelectedTextAnnotationId(null)
    setSelection({ hit, keyId })
    setValueDraft(keyDisplayLabelForId(keyId, sourceProject))
    setValueDraftActive(false)
    updateOpenNativePreviewForKey(sourceProject, keyId)
  }

  function setSelectionFromRange(range: SheetRangeSelection, sourceProject: CutProject = project) {
    const focusHit = range.focusHit
    const keyId = eventKeyIdAtHit(focusHit, sourceProject)
    setRangeSelection(range)
    setSelectedTextAnnotationId(null)
    setSelection({ hit: focusHit, keyId })
    setValueDraft(keyDisplayLabelForId(keyId, sourceProject))
    setValueDraftActive(false)
    updateOpenNativePreviewForKey(sourceProject, keyId)
  }

  function isPointEventRange(range: SheetRangeSelection | null): range is SheetRangeSelection & { role: SheetTimingRole; paperTrack: string } {
    return isPointEventRangeForUi(range)
  }

  function rangeSelectionForFrames(range: SheetRangeSelection, frameStart: number, frameEnd: number): SheetRangeSelection | null {
    if (!isPointEventRange(range)) return null
    const role = range.role
    const tracks = rangePaperTracks(range)
    const trackOrder = paperTrackOrderForRole(project, role)
    const startTrack = tracks[0] ?? range.paperTrack
    const endTrack = tracks.at(-1) ?? startTrack
    const startHit = timingHitForFrame(template, role, startTrack, frameStart, sheetDisplayDurationFrames, sheetDisplayFrameStart, trackOrder)
    const endHit = timingHitForFrame(template, role, endTrack, frameEnd, sheetDisplayDurationFrames, sheetDisplayFrameStart, trackOrder)
    if (!startHit || !endHit) return null
    const forward = range.focusFrame >= range.anchorFrame
    return rangeSelectionFromHits(template, forward ? startHit : endHit, forward ? endHit : startHit, tracks)
  }

  function nextSteppedRange(range: SheetRangeSelection): SheetRangeSelection | null {
    const spanFrames = range.frameEnd - range.frameStart + 1
    if (spanFrames < 1) return null
    const forward = range.focusFrame >= range.anchorFrame
    const lastFrame = sheetDisplayFrameEnd
    const nextStart = forward ? range.frameEnd + 1 : range.frameStart - spanFrames
    const nextEnd = forward ? range.frameEnd + spanFrames : range.frameStart - 1
    if (nextStart < sheetDisplayFrameStart || nextEnd > lastFrame) return null
    return rangeSelectionForFrames(range, nextStart, nextEnd)
  }

  function applyTimingValueToRange(range: SheetRangeSelection, rawValue: string, advance: boolean) {
    if (!isPointEventRange(range)) return
    const trackOrder = paperTrackOrderForRole(project, range.role)
    const value = rawValue.trim()
    let next = { project, keyId: null as string | null }
    for (const paperTrack of rangePaperTracks(range)) {
      const startHit = timingHitForFrame(template, range.role, paperTrack, range.frameStart, sheetDisplayDurationFrames, sheetDisplayFrameStart, trackOrder)
      if (startHit) next = setTimingValueAt(next.project, startHit, value, activeTextFontSizePx)
    }
    commitProject(next.project)
    const nextRange = advance ? nextSteppedRange(range) : null
    if (nextRange) {
      setSelectionFromRange(nextRange, next.project)
    } else {
      setSelectionFromRange(range, next.project)
    }
    setValueDraft(value)
    setValueDraftActive(false)
  }

  function applyTimingValue(hit: SheetHit | null, rawValue: string, draftActive = true) {
    if (!hit?.paperTrack) return
    const value = rawValue.trim()
    const next = setTimingValueAt(project, hit, value, activeTextFontSizePx)
    commitProject(next.project)
    setRangeSelection(null)
    setSelection({ hit, keyId: next.keyId })
    setValueDraft(value)
    setValueDraftActive(draftActive)
  }

  function applyTimingValueToSelection(rawValue: string, draftActive = true) {
    if (rangeSelection) {
      applyTimingValueToRange(rangeSelection, rawValue, false)
      return
    }
    if (!selection.hit) return
    applyTimingValue(selection.hit, rawValue, draftActive)
  }

  function handleTimingCharacterInput(character: string) {
    if (rangeSelection) {
      applyTimingValueToRange(rangeSelection, character, true)
      return
    }
    if (!selection.hit) return
    const nextValue = valueDraftActive ? `${valueDraft}${character}` : character
    applyTimingValueToSelection(nextValue)
  }

  function handleCellClick(hit: SheetHit) {
    if (!hit.paperTrack) return
    if (typeof hit.pageIndex === 'number') setActivePageIndex(hit.pageIndex)
    setSelectionFromHit(hit)
  }

  function handleCellSelect(hit: SheetHit) {
    if (!hit.paperTrack) return
    if (typeof hit.pageIndex === 'number') setActivePageIndex(hit.pageIndex)
    setSelectionFromHit(hit)
  }

  function handleSetNullAtHit(hit: SheetHit) {
    if (!hit.paperTrack) return
    if (typeof hit.pageIndex === 'number') setActivePageIndex(hit.pageIndex)
    applyTimingValue(hit, 'x', false)
  }

  function handleDeleteEventAtHit(hit: SheetHit) {
    if (!hit.paperTrack) return
    const sheetRole = sheetRoleForHit(hit)
    const next = clearEvent(project, hit.paperTrack, hit.frame, sheetRole)
    commitProject(next)
    if (typeof hit.pageIndex === 'number') setActivePageIndex(hit.pageIndex)
    setSelectionFromHit(hit, next, null)
  }

  function handleKeySelect(keyId: string | null) {
    if (isNullCellKeyId(keyId)) return
    setRangeSelection(null)
    setSelectedTextAnnotationId(null)
    setSelection(current => ({ ...current, keyId }))
    setValueDraft(keyDisplayLabelForId(keyId))
    setValueDraftActive(false)
    updateOpenNativePreviewForKey(project, keyId)
  }

  function updateOpenNativePreviewForKey(sourceProject: CutProject, keyId: string | null) {
    if (!keyId || isNullCellKeyId(keyId)) return
    const key = sourceProject.logicalSheet.keys.find(item => item.keyId === keyId)
    if (!key) return
    void updateNativeRegisteredCellPreviewIfOpen(sourceProject, key)
  }

  function handleJumpToKeyFirstUse(keyId: string) {
    if (isNullCellKeyId(keyId)) return
    const key = project.logicalSheet.keys.find(item => item.keyId === keyId)
    if (!key) return
    const firstUse = firstTimelineUseForKey(project, key, registeredCellTrackOrder(project))
    if (!firstUse) {
      handleKeySelect(keyId)
      return
    }
    const hit = timingHitForFrame(
      template,
      firstUse.role,
      firstUse.paperTrack,
      firstUse.frame,
      sheetDisplayDurationFrames,
      sheetDisplayFrameStart,
      templatePaperTracks(project).map(track => track.paperTrack),
    )
    if (!hit) {
      handleKeySelect(keyId)
      return
    }
    if (typeof hit.pageIndex === 'number') setActivePageIndex(hit.pageIndex)
    setRangeSelection(null)
    setSelectedTextAnnotationId(null)
    setSelection({ hit, keyId })
    setValueDraft(keyDisplayLabelForId(keyId))
    setValueDraftActive(false)
    updateOpenNativePreviewForKey(project, keyId)
    setSheetScrollRequest(current => ({ requestId: (current?.requestId ?? 0) + 1, hit }))
  }

  function handleActiveCorrectionLayerChange(layerId: string) {
    setActiveCorrectionLayerIdState(layerId)
  }

  function handleClearSelection() {
    clearSelectionState()
  }

  async function startCalibrationWithLoupe() {
    startSheetImageWarp()
    setCalibrationLoupeOpen(true)
    if (activePageImage.imageUrl && !autoCalibrationRunning) {
      await autoDetectSheetImageWarp()
    }
  }

  function closeCalibrationLoupe() {
    setCalibrationLoupeOpen(false)
    if (editMode === 'calibrate') setEditMode('new')
  }

  function handleDeleteEvent() {
    if (isPointEventRange(rangeSelection)) {
      const next = clearTimingRange(project, rangeSelection)
      commitProject(next)
      setSelectionFromRange(rangeSelection, next)
      return
    }
    if (!selection.hit?.paperTrack) return
    const next = clearEvent(project, selection.hit.paperTrack, selection.hit.frame, sheetRoleForHit(selection.hit))
    commitProject(next)
    setSelectionFromHit(selection.hit, next, null)
  }

  async function handleDeleteKey(keyId: string) {
    if (isNullCellKeyId(keyId)) return
    const key = project.logicalSheet.keys.find(item => item.keyId === keyId)
    if (!key) return
    const materialCount = registeredCellAssetRows(project, key).length
    const bindingCount = project.bindings.filter(binding => binding.keyId === keyId).length
    const eventCount = project.logicalSheet.events.filter(event => event.keyId === keyId).length
    if (materialCount > 0 || bindingCount > 0 || eventCount > 0) {
      const confirmed = await confirmUserAction(uiText.keys.deleteConfirm(key.displayLabel || key.paperTrack, materialCount, eventCount), {
        title: uiText.keys.delete,
        okLabel: uiText.keys.deleteConfirmOk,
        cancelLabel: uiText.keys.deleteConfirmCancel,
      })
      if (!confirmed) return
    }
    const next = deleteRegisteredCellKey(project, keyId)
    commitProject(next)
    if (selection.keyId === keyId) {
      setSelection(current => ({ ...current, keyId: null }))
      setValueDraft('')
      setValueDraftActive(false)
    }
  }

  function copySelectedTimingRange(mode: TimingClipboard['mode'], rippleDelete: boolean = false) {
    if (!isPointEventRange(rangeSelection)) return
    const clipboard = buildTimingClipboard(project, rangeSelection, mode)
    setTimingClipboard(clipboard)
    if (mode !== 'cut') return
    const next = rippleDelete
      ? rippleDeleteTimingRange(project, rangeSelection)
      : clearTimingRange(project, rangeSelection)
    commitProject(next)
    setSelectionFromRange(rangeSelection, next)
  }

  function pasteTimingClipboard(mode: 'overwrite' | 'insert' | 'repeat-range' | 'repeat-to-end') {
    const baseTarget = timingPasteTarget(selection.hit, rangeSelection)
    const target = baseTarget ? { ...baseTarget, paperTrackOrder: paperTrackOrderForRole(project, baseTarget.role) } : null
    if (!timingClipboard || !target || timingClipboard.role !== target.role) return
    if (mode === 'repeat-range' && !isPointEventRange(rangeSelection)) return
    const next = pasteTimingClipboardToProject(project, timingClipboard, target, mode)
    commitProject(next)
    const nextRange = pasteResultRange(template, next, target, timingClipboard, mode)
    if (nextRange) {
      setSelectionFromRange(nextRange, next)
    } else if (target.hit) {
      setSelectionFromHit(target.hit, next)
    }
  }

  function openFrameOperationDialog(kind: FrameOperationKind, hit: SheetHit) {
    if (!hit.paperTrack) return
    const role = sheetRoleForHit(hit)
    const sourceRange = isPointEventRange(rangeSelection)
      && rangeSelection.role === role
      && rangeContainsHit(rangeSelection, hit)
      && hit.frame >= rangeSelection.frameStart
      && hit.frame <= rangeSelection.frameEnd
      ? rangeSelection
      : null
    setFrameOperationDialog({
      kind,
      role,
      paperTrack: hit.paperTrack,
      paperTracks: sourceRange ? rangePaperTracks(sourceRange) : [hit.paperTrack],
      frameStart: sourceRange?.frameStart ?? hit.frame,
      frameEnd: sourceRange?.frameEnd ?? hit.frame,
      sourceHit: hit,
      sourceRange,
    })
  }

  function applyFrameOperation(input: FrameOperationSubmit) {
    if (!frameOperationDialog) return
    const frameCount = Math.max(1, Math.round(input.frameCount))
    const next = frameOperationDialog.kind === 'insert'
      ? insertTimelineFrames(project, {
          scope: input.scope,
          role: frameOperationDialog.role,
          paperTrack: frameOperationDialog.paperTrack,
          paperTracks: frameOperationDialog.paperTracks,
          atFrame: frameOperationDialog.frameStart,
          frameCount,
          durationPolicy: input.durationPolicy as TimelineInsertDurationPolicy,
        })
      : deleteTimelineFrames(project, {
          scope: input.scope,
          role: frameOperationDialog.role,
          paperTrack: frameOperationDialog.paperTrack,
          paperTracks: frameOperationDialog.paperTracks,
          frameStart: frameOperationDialog.frameStart,
          frameCount,
          durationPolicy: input.durationPolicy as TimelineDeleteDurationPolicy,
        })
    commitProject(next)
    setFrameOperationDialog(null)
    setSelectionToFrameSpan(next, frameOperationDialog.role, frameOperationDialog.paperTracks, frameOperationDialog.frameStart, frameOperationDialog.kind === 'insert' ? frameCount : 1)
  }

  function setSelectionToFrameSpan(sourceProject: CutProject, role: SheetTimingRole, paperTracks: string[], frameStart: number, spanFrames: number) {
    const displayStart = logicalSheetDisplayFrameStart(sourceProject.logicalSheet)
    const displayEnd = logicalSheetDisplayFrameEnd(sourceProject.logicalSheet)
    const nextFrameStart = clampNumber(frameStart, displayStart, displayEnd)
    const nextFrameEnd = clampNumber(frameStart + Math.max(1, spanFrames) - 1, displayStart, displayEnd)
    const displayDuration = logicalSheetDisplayDurationFrames(sourceProject.logicalSheet)
    const trackOrder = paperTrackOrderForRole(sourceProject, role)
    const startPaperTrack = paperTracks[0]
    const endPaperTrack = paperTracks.at(-1) ?? startPaperTrack
    const startHit = startPaperTrack ? timingHitForFrame(template, role, startPaperTrack, nextFrameStart, displayDuration, displayStart, trackOrder) : null
    const endHit = endPaperTrack ? timingHitForFrame(template, role, endPaperTrack, nextFrameEnd, displayDuration, displayStart, trackOrder) : null
    if (startHit && endHit) {
      const nextRange = rangeSelectionFromHits(template, startHit, endHit, paperTracks)
      if (nextRange) {
        setSelectionFromRange(nextRange, sourceProject)
        return
      }
    }
    if (startHit) setSelectionFromHit(startHit, sourceProject)
  }

  function assignSheetSourceToPageWithInitialOpacity(sourceProject: CutProject, pageId: string, sourceId: string | null): CutProject {
    const assigned = assignSheetSourceToPage(sourceProject, pageId, sourceId)
    return sourceId
      ? updateSheetPageViewState(assigned, pageId, { alignment: { opacity: IMPORTED_SHEET_IMAGE_INITIAL_OPACITY } })
      : assigned
  }

  async function handleSheetSourceFiles(files: FileList | File[] | null, startPageId = activePage?.pageId) {
    const imageFiles = Array.from(files ?? [])
      .filter(file => file.type.startsWith('image/'))
      .sort(compareFileNames)
    if (imageFiles.length === 0) return
    const refs = await Promise.all(imageFiles.map(fileToFileRef))
    handleSheetSourceFileRefs(refs, startPageId)
  }

  function handleSheetSourceFileRefs(refs: FileRef[], startPageId = activePage?.pageId) {
    const imageRefs = refs
      .filter(ref => isImageFileRef(ref))
      .sort((a, b) => compareFileNameLikeText(a.name, b.name))
    if (imageRefs.length === 0) return
    const startIndex = Math.max(0, sheetPages.findIndex(page => page.pageId === startPageId))
    const importedSheetPageFrames = Math.max(1, Math.round(project.logicalSheet.fps * IMPORTED_SHEET_SECONDS_PER_PAGE))
    const durationFrames = Math.max(1, (startIndex + imageRefs.length) * importedSheetPageFrames)
    const targetPages = createSheetPages(template, durationFrames, project.logicalSheet.frameOrigin)
    const runtimeUpdates: Record<string, string> = {}
    const calibrationTargets: ImportedSheetSourceCalibrationTarget[] = []
    let next = updateLogicalSheetSettings(project, { durationFrames })

    for (const [index, ref] of imageRefs.entries()) {
      const assetRegistered = registerAsset(next, ref, { role: 'timesheet-scan' })
      const registered = registerSheetSource(assetRegistered.project, serializableImageRef(ref), { assetId: assetRegistered.asset.assetId })
      next = registered.project
      if (ref.objectUrl) runtimeUpdates[registered.source.sourceId] = ref.objectUrl
      const targetPage = targetPages[startIndex + index]
      if (targetPage) {
        next = assignSheetSourceToPageWithInitialOpacity(next, targetPage.pageId, registered.source.sourceId)
        if (ref.objectUrl) {
          calibrationTargets.push({
            pageId: targetPage.pageId,
            sourceId: registered.source.sourceId,
            imageUrl: ref.objectUrl,
          })
        }
      }
    }

    setRuntimeSourceImageUrls(current => ({ ...current, ...runtimeUpdates }))
    commitProject(next)
    setRecognitionCandidates([])
    setAutoCalibrationOverlay(null)
    void autoCalibrateImportedSheetSources(calibrationTargets)
  }

  async function openPaperSheetFilePicker() {
    if (isTauriHost()) {
      try {
        const refs = await openImageFileRefs({
          initialDirectory: fileDialogInitialDirectory(project),
        })
        if (refs && refs.length > 0) {
          handleSheetSourceFileRefs(refs, activePage?.pageId)
        }
        return
      } catch (error) {
        window.alert(errorMessage(error))
        return
      }
    }
    paperSheetInputRef.current?.click()
  }

  async function autoCalibrateImportedSheetSources(targets: ImportedSheetSourceCalibrationTarget[]) {
    if (!shouldAutoCalibrateImportedSheetSources(template) || targets.length === 0 || autoCalibrationRunning) return
    setAutoCalibrationRunning(true)
    setAutoCalibrationMessage(uiText.sheet.autoCalibrationImportRunning(targets.length))
    setAutoCalibrationOverlay(null)
    const results: ImportedSheetSourceCalibrationResult[] = []
    try {
      for (const target of targets) {
        try {
          const result = await detectSheetCalibrationPoints(target.imageUrl, template)
          if (result) results.push({ target, points: result.points })
        } catch {
          // Import should succeed even when a scan cannot be auto-corrected.
        }
      }
      if (results.length > 0) {
        setHistory(current => {
          let next = current.present
          let appliedCount = 0
          for (const result of results) {
            const page = next.sheetView.pages.find(item => item.pageId === result.target.pageId)
            if (page?.sourceId !== result.target.sourceId) continue
            next = updateSheetPageViewState(next, result.target.pageId, {
              alignment: {
                corners: calibrationCornersFromPoints(result.points, 'source') ?? page.alignment.corners,
                calibration: {
                  enabled: true,
                  points: result.points,
                },
              },
            })
            appliedCount += 1
          }
          return appliedCount > 0 ? commitHistory(current, next) : current
        })
      }
      setAutoCalibrationMessage(results.length > 0
        ? uiText.sheet.autoCalibrationImportSucceeded(results.length, targets.length)
        : uiText.sheet.autoCalibrationImportFailed)
    } finally {
      setAutoCalibrationRunning(false)
    }
  }

  function handleAssetSheetSources(assetIds: string[], startPageId = activePage?.pageId) {
    const selectedAssets = assetIds
      .flatMap(assetId => {
        const asset = project.assets.find(item => item.assetId === assetId)
        return asset && isCellMaterialAsset(asset) ? [asset] : []
      })
      .sort(compareAssetNames)
    if (selectedAssets.length === 0) return
    if (project.sheetView.sources.some(source => source.kind === 'sheet-scan')) return

    const startIndex = Math.max(0, sheetPages.findIndex(page => page.pageId === startPageId))
    const importedSheetPageFrames = Math.max(1, Math.round(project.logicalSheet.fps * IMPORTED_SHEET_SECONDS_PER_PAGE))
    const durationFrames = Math.max(1, (startIndex + selectedAssets.length) * importedSheetPageFrames)
    const targetPages = createSheetPages(template, durationFrames, project.logicalSheet.frameOrigin)
    const runtimeUpdates: Record<string, string> = {}
    const calibrationTargets: ImportedSheetSourceCalibrationTarget[] = []
    let next = updateLogicalSheetSettings(project, { durationFrames })

    for (const [index, asset] of selectedAssets.entries()) {
      const registered = registerSheetSource(next, sheetImageRefFromAsset(asset), { assetId: asset.assetId })
      next = registered.project
      if (asset.thumbnailUrl) runtimeUpdates[registered.source.sourceId] = asset.thumbnailUrl
      const targetPage = targetPages[startIndex + index]
      if (targetPage) {
        next = assignSheetSourceToPageWithInitialOpacity(next, targetPage.pageId, registered.source.sourceId)
        if (asset.thumbnailUrl) {
          calibrationTargets.push({
            pageId: targetPage.pageId,
            sourceId: registered.source.sourceId,
            imageUrl: asset.thumbnailUrl,
          })
        }
      }
    }

    setRuntimeSourceImageUrls(current => ({ ...current, ...runtimeUpdates }))
    commitProject(next)
    setRecognitionCandidates([])
    setAutoCalibrationOverlay(null)
    void autoCalibrateImportedSheetSources(calibrationTargets)
  }

  function handleAssignSheetSource(pageId: string, sourceId: string | null) {
    commitProject(assignSheetSourceToPageWithInitialOpacity(project, pageId, sourceId))
    setRecognitionCandidates([])
    setAutoCalibrationOverlay(null)
  }

  function updateActivePageAlignment(alignment: Partial<SheetImageAlignment>) {
    if (!activePage) return
    commitProject(updateSheetPageViewState(project, activePage.pageId, { alignment }))
  }

  function activePageLevelCorrectionSettings(): LevelCorrectionSettings {
    return activePageImage.settings.levelCorrection
      ? normalizeLevelCorrectionSettings(activePageImage.settings.levelCorrection)
      : defaultLevelCorrectionSettings()
  }

  function updateActivePageLevelCorrection(levelCorrection: LevelCorrectionSettings) {
    updateActivePageAlignment({ levelCorrection: normalizeLevelCorrectionSettings(levelCorrection) })
  }

  function toggleActivePageLevelCorrection(enabled: boolean) {
    const current = activePageLevelCorrectionSettings()
    updateActivePageLevelCorrection(enabled && !activePageImage.settings.levelCorrection
      ? defaultLevelCorrectionSettings()
      : { ...current, enabled })
  }

  function updatePageCalibrationPoints(page: SheetPage, points: SheetCalibrationPointPair[], enabled = false) {
    commitProject(updateSheetPageViewState(project, page.pageId, {
      alignment: {
        calibration: {
          enabled,
          points,
        },
      },
    }))
  }

  function startSheetImageWarp() {
    if (!activePage) return
    const points = calibrationPointsForSettings(activePageImage.settings, template)
    setAutoCalibrationMessage(null)
    setAutoCalibrationOverlay(null)
    commitProject(updateSheetPageViewState(project, activePage.pageId, {
      alignment: {
        corners: calibrationCornersFromPoints(points, 'source') ?? calibrationCornersForTemplate(template) ?? activePageImage.settings.corners,
        calibration: {
          enabled: false,
          points,
        },
      },
    }))
    setEditMode('calibrate')
  }

  function disableSheetImageWarp() {
    if (!activePage) return
    const points = calibrationPointsForSettings(activePageImage.settings, template)
    setAutoCalibrationMessage(null)
    setAutoCalibrationOverlay(null)
    commitProject(updateSheetPageViewState(project, activePage.pageId, {
      alignment: {
        corners: calibrationCornersFromPoints(points, 'source') ?? activePageImage.settings.corners,
        calibration: {
          enabled: false,
          points,
        },
      },
    }))
    if (editMode === 'calibrate') setEditMode('new')
  }

  function applySheetImageWarp(pointsOverride?: SheetCalibrationPointPair[]) {
    if (!activePage) return
    const points = pointsOverride ?? calibrationPointsForSettings(activePageImage.settings, template)
    setAutoCalibrationMessage(null)
    setAutoCalibrationOverlay(null)
    commitProject(updateSheetPageViewState(project, activePage.pageId, {
      alignment: {
        corners: calibrationCornersFromPoints(points, 'source') ?? activePageImage.settings.corners,
        calibration: {
          enabled: true,
          points,
        },
      },
    }))
    setEditMode('new')
  }

  async function autoDetectSheetImageWarp() {
    if (!activePage || !activePageImage.imageUrl || autoCalibrationRunning) return
    setAutoCalibrationRunning(true)
    setAutoCalibrationMessage(uiText.sheet.autoCalibrationRunning)
    try {
      const result = await detectSheetCalibrationPoints(activePageImage.imageUrl, template)
      if (!result) {
        setAutoCalibrationMessage(uiText.sheet.autoCalibrationFailed)
        setAutoCalibrationOverlay(null)
        return
      }
      commitProject(updateSheetPageViewState(project, activePage.pageId, {
        alignment: {
          corners: calibrationCornersFromPoints(result.points, 'source') ?? activePageImage.settings.corners,
          calibration: {
            enabled: false,
            points: result.points,
          },
        },
      }))
      setEditMode('calibrate')
      setAutoCalibrationOverlay({ pageId: activePage.pageId, ...result.debugOverlay })
      setAutoCalibrationMessage(uiText.sheet.autoCalibrationSucceeded(Math.round(result.confidence * 100), result.detectedLineCount))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setAutoCalibrationMessage(uiText.sheet.autoCalibrationError(message))
      setAutoCalibrationOverlay(null)
    } finally {
      setAutoCalibrationRunning(false)
    }
  }

  async function handleAssetFiles(files: FileList | File[] | null, targetHit: SheetHit | null = null, position?: { x: number; y: number }) {
    if (!files) return
    const imageFiles = Array.from(files).filter(isImageAssetFile)
    if (imageFiles.length === 0) return
    const refs = await Promise.all(imageFiles.map(fileToFileRef))
    handleAssetFileRefs(refs, targetHit, position)
  }

  async function handleAssetNativePaths(paths: string[], targetHit: SheetHit | null = null, position?: { x: number; y: number }, options: { recursive?: boolean } = {}) {
    if (paths.length === 0) return
    const collection = await collectAssetPathDrop(paths, { recursive: options.recursive ?? true })
    handleAssetFileRefs(collection.files, targetHit, position, collection.roots)
  }

  async function assetRootCandidatesFromNativePaths(paths: string[]): Promise<AssetRootCandidate[]> {
    if (paths.length === 0) return []
    const collection = await collectAssetPathDrop(paths, { recursive: false })
    return collection.roots.filter(root => root.fromDirectoryDrop)
  }

  function handleAssetRootCandidates(candidates: AssetRootCandidate[]) {
    if (candidates.length === 0) return
    const rooted = registerAssetRootsFromCandidates(projectRef.current, candidates)
    commitProject(rooted.project)
  }

  function registerAssetRootsFromCandidates(sourceProject: CutProject, candidates: AssetRootCandidate[]): { project: CutProject; rootsByPath: Map<string, AssetRoot> } {
    let next = sourceProject
    const rootsByPath = new Map<string, AssetRoot>()
    for (const candidate of candidates) {
      const registered = registerAssetRoot(next, {
        label: candidate.label,
        path: candidate.path,
        handleKind: 'directory',
      })
      next = registered.project
      rootsByPath.set(pathCompareKey(candidate.path), registered.root)
    }
    for (const root of next.assetRoots) {
      if (root.path) rootsByPath.set(pathCompareKey(root.path), root)
    }
    return { project: next, rootsByPath }
  }

  function registerMaterialAssetRef(sourceProject: CutProject, ref: FileRef): { project: CutProject; asset: CutAsset } {
    const root = assetRootForFile(sourceProject.assetRoots, ref)
    const relativePath = ref.relativePath ?? relativePathFromRoot(ref.path, root?.path)
    return registerAsset(sourceProject, ref, {
      role: 'cell-material',
      rootId: root?.rootId,
      relativePath,
    })
  }

  function handleEnsureAssetRef(ref: FileRef): string | null {
    if (!isImageFileRef(ref)) return null
    const registered = registerMaterialAssetRef(projectRef.current, ref)
    commitProject(registered.project)
    return registered.asset.assetId
  }

  function handleAssetFileRefs(refs: FileRef[], targetHit: SheetHit | null = null, position?: { x: number; y: number }, rootCandidates: AssetRootCandidate[] = []) {
    if (refs.length === 0) return
    const rooted = registerAssetRootsFromCandidates(projectRef.current, rootCandidates)
    const sourceProject = rooted.project
    const existingKey = keyAtHit(sourceProject, targetHit)
    if (refs.length === 1 && existingKey) {
      const registered = registerMaterialAssetRef(sourceProject, refs[0])
      const menuPosition = position ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
      commitProject(registered.project)
      setRangeSelection(null)
      setSelection({ hit: targetHit, keyId: existingKey.keyId })
      setValueDraft(existingKey.displayLabel)
      setValueDraftActive(false)
      setAssetDropMenu({
        x: menuPosition.x,
        y: menuPosition.y,
        assetId: registered.asset.assetId,
        keyId: existingKey.keyId,
        hit: targetHit,
      })
      return
    }
    let next = sourceProject
    let selectedAfterDrop: Selection | null = null
    for (const ref of refs) {
      const registered = registerMaterialAssetRef(next, ref)
      next = registered.project
      if (targetHit?.paperTrack) {
        const bound = bindAssetToHit(next, registered.asset, targetHit, activeCorrectionLayerId)
        next = bound.project
        selectedAfterDrop = bound.keyId ? { hit: targetHit, keyId: bound.keyId } : null
      }
    }
    if (selectedAfterDrop) {
      const key = selectedAfterDrop.keyId ? next.logicalSheet.keys.find(item => item.keyId === selectedAfterDrop.keyId) ?? null : null
      setRangeSelection(null)
      setSelection(selectedAfterDrop)
      setValueDraft(key?.displayLabel ?? '')
      setValueDraftActive(false)
    }
    commitProject(next)
  }

  function handleAssignAsset(assetId: string, targetHit: SheetHit | null, position?: { x: number; y: number }) {
    const sourceProject = projectRef.current
    const asset = sourceProject.assets.find(item => item.assetId === assetId)
    if (!asset || !targetHit?.paperTrack) {
      setAssetDropMenu(null)
      return
    }
    const existingKey = keyAtHit(sourceProject, targetHit)
    if (existingKey && position) {
      setRangeSelection(null)
      setSelection({ hit: targetHit, keyId: existingKey.keyId })
      setValueDraft(existingKey.displayLabel)
      setValueDraftActive(false)
      setAssetDropMenu({
        x: position.x,
        y: position.y,
        assetId,
        keyId: existingKey.keyId,
        hit: targetHit,
      })
      return
    }
    setAssetDropMenu(null)
    const bound = bindAssetToHit(sourceProject, asset, targetHit, activeCorrectionLayerId)
    if (bound.keyId) {
      const key = bound.project.logicalSheet.keys.find(item => item.keyId === bound.keyId) ?? null
      setRangeSelection(null)
      setSelection({ hit: targetHit, keyId: bound.keyId })
      setValueDraft(key?.displayLabel ?? '')
      setValueDraftActive(false)
    }
    commitProject(bound.project)
  }

  function handleAssignRegisteredCell(keyId: string, targetHit: SheetHit | null) {
    if (!targetHit?.paperTrack) return
    const assigned = assignRegisteredCellKeyToHit(project, keyId, targetHit, activeTextFontSizePx)
    if (!assigned.keyId) return
    commitProject(assigned.project)
    setSelectionFromHit(targetHit, assigned.project, assigned.keyId)
  }

  function handleMoveTimelineEvent(sourceHit: SheetHit, targetHit: SheetHit) {
    if (!sourceHit.paperTrack || !targetHit.paperTrack) return
    const sourceRole = sheetRoleForHit(sourceHit)
    const targetRole = sheetRoleForHit(targetHit)
    if (sourceRole !== targetRole) return
    const sourceEvent = timelineEventAtHit(project, sourceHit)
    const sourceKeyId = sourceEvent?.keyId ?? null
    if (!sourceKeyId) return
    const sameTarget = sourceHit.paperTrack === targetHit.paperTrack
      && sourceHit.frame === targetHit.frame
      && sourceRole === targetRole
    if (sameTarget) {
      setSelectionFromHit(targetHit, project, sourceKeyId)
      return
    }
    const targetKeyId = eventKeyIdAtHit(targetHit)
    if (targetKeyId && !window.confirm(uiText.sheet.moveEventOverwriteConfirm)) return

    let next = clearEvent(project, sourceHit.paperTrack, sourceHit.frame, sourceRole)
    if (isNullCellKeyId(sourceKeyId)) {
      next = setEvent(next, targetHit.paperTrack, targetHit.frame, NULL_CELL_KEY_ID, targetRole, { fontSizePx: sourceEvent?.fontSizePx })
      commitProject(next)
      setSelectionFromHit(targetHit, next, NULL_CELL_KEY_ID)
      return
    }

    const assigned = assignRegisteredCellKeyToHit(next, sourceKeyId, targetHit, sourceEvent?.fontSizePx)
    if (!assigned.keyId) return
    commitProject(assigned.project)
    setSelectionFromHit(targetHit, assigned.project, assigned.keyId)
  }

  async function handleApplyNameNormalization(plan: NameNormalizationPlan) {
    const renameResults = plan.options.includeAssetFiles
      ? await renameMaterialFiles(plan.assetRenames)
      : []
    const failedRenames = renameResults.filter(result => !result.renamed)
    commitProject(applyNameNormalizationPlan(project, plan, renameResults))
    if (failedRenames.length > 0) {
      window.alert(uiText.nameNormalization.renameFailed(failedRenames.length))
    }
  }

  function handleAssignAssetToKey(
    assetId: string,
    keyId: string,
    target: { position?: { x: number; y: number } } = {},
  ) {
    const key = project.logicalSheet.keys.find(item => item.keyId === keyId)
    if (!key) return
    const options = processSlotsForKey(project, key)
    if (options.length === 0) return
    const position = target.position ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    setAssetDropMenu({
      x: position.x,
      y: position.y,
      assetId,
      keyId,
      hit: null,
    })
  }

  function assignAssetToKeySlot(assetId: string, keyId: string, slotId: string, hit?: SheetHit | null) {
    const asset = project.assets.find(item => item.assetId === assetId)
    const key = project.logicalSheet.keys.find(item => item.keyId === keyId)
    const slot = project.cspTrackSlots.find(item => item.slotId === slotId)
    if (!asset || !key || !slot) return
    const binding = project.bindings.find(item => item.slotId === slotId && item.keyId === keyId)
    const cspCellName = binding?.cspCellName ?? automaticRegisteredCellCspName(key, slot, asset)
    if (hit?.paperTrack) {
      setSelection({ hit, keyId })
      setValueDraft(key.displayLabel)
      setValueDraftActive(false)
    }
    setAssetDropMenu(null)
    commitProject(upsertBinding(project, {
      slotId,
      keyId,
      assetId,
      cspCellName,
      materialState: 'assigned',
    }))
  }

  function handleUpdateKeyCspCellName(keyId: string, slotId: string, cspCellName: string) {
    const binding = project.bindings.find(item => item.slotId === slotId && item.keyId === keyId)
    commitProject(upsertBinding(project, {
      slotId,
      keyId,
      cspCellName,
      assetId: binding?.assetId,
      materialState: binding?.materialState ?? 'unassigned',
    }))
  }

  function handleMoveKeyBindingProcess(keyId: string, sourceSlotId: string, targetCorrectionLayerId: string) {
    const moveTarget = bindingProcessMoveTarget(project, keyId, sourceSlotId, targetCorrectionLayerId)
    if (!moveTarget) {
      window.alert(uiText.processMove.noTarget)
      return
    }
    if (moveTarget.targetSlot.slotId === sourceSlotId) return
    const overwrite = moveTarget.existingTargetBinding
      ? window.confirm(uiText.processMove.overwriteConfirm(moveTarget.sourceLabel, moveTarget.targetLabel))
      : false
    if (moveTarget.existingTargetBinding && !overwrite) return
    try {
      commitProject(moveBindingToCorrectionLayer(project, {
        keyId,
        sourceSlotId,
        targetCorrectionLayerId,
        overwrite,
      }))
    } catch (error) {
      window.alert(errorMessage(error))
    }
  }

  function handleMoveCspStackItem(itemId: string, direction: 'up' | 'down') {
    const stackItems = cellStackOrderItems(project)
    const currentIndex = stackItems.findIndex(item => item.id === itemId)
    const targetIndex = currentIndex + (direction === 'up' ? 1 : -1)
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= stackItems.length) return
    const nextIds = stackItems.map(item => item.id)
    const [moved] = nextIds.splice(currentIndex, 1)
    nextIds.splice(targetIndex, 0, moved)
    commitProject(applyCellStackOrder(project, nextIds, true))
  }

  function handleCreateStackGuideLabel(input: { label: string; gapIndex: number; insertAfterPaperTrack?: string; displayRole?: SheetTimingRole; viewSnapIndex?: number; kind?: StackGuideLabel['kind']; correctionLayerId?: string }) {
    try {
      commitProject(createStackGuideLabel(project, { correctionLayerId: activeCorrectionLayerId, ...input }).project)
    } catch (error) {
      window.alert(errorMessage(error))
    }
  }

  function handleUpdateStackGuideLabel(labelId: string, updates: StackGuideLabelUpdates) {
    try {
      commitProject(updateStackGuideLabel(project, labelId, updates))
    } catch (error) {
      window.alert(errorMessage(error))
    }
  }

  function handleDeleteStackGuideLabel(labelId: string) {
    commitProject(deleteStackGuideLabel(project, labelId))
  }

  function handleUpdateStackGuideRegistration(labelId: string, correctionLayerId: string, cspCellName: string) {
    try {
      commitProject(updateStackGuideRegistration(project, labelId, correctionLayerId, { cspCellName }))
    } catch (error) {
      window.alert(errorMessage(error))
    }
  }

  function handleAssignAssetToStackGuide(labelId: string, assetId: string, correctionLayerId = activeCorrectionLayerId) {
    try {
      commitProject(assignAssetToStackGuideLabel(project, labelId, assetId, correctionLayerId))
    } catch (error) {
      window.alert(errorMessage(error))
    }
  }

  function handleAddOverlayPaperTrack(input: { paperTrack?: string; insertAfterPaperTrack?: string; orderInGap?: number; snapIndex?: number; sheetRole?: SheetTimingRole }) {
    try {
      const created = addOverlayPaperTrack(project, {
        ...input,
        templateId: template.templateId,
        sheetRole: input.sheetRole ?? 'cell',
      })
      commitProject(created.project)
    } catch (error) {
      window.alert(errorMessage(error))
    }
  }

  function handleUpdatePaperTrack(paperTrack: string, updates: Parameters<typeof updatePaperTrack>[2]) {
    try {
      commitProject(updatePaperTrack(project, paperTrack, updates))
    } catch (error) {
      window.alert(errorMessage(error))
    }
  }

  async function handleDeleteOverlayPaperTrack(paperTrack: string) {
    const track = project.logicalSheet.paperTracks.find(item => item.paperTrack === paperTrack)
    if (!track || track.source !== 'overlay') return
    const keyIds = new Set(project.logicalSheet.keys.filter(key => key.paperTrack === paperTrack).map(key => key.keyId))
    const eventCount = project.logicalSheet.events.filter(event => event.paperTrack === paperTrack || keyIds.has(event.keyId)).length
    const bindingCount = project.bindings.filter(binding => keyIds.has(binding.keyId)).length
    const confirmed = await confirmUserAction(uiText.actions.deleteOverlayPaperTrackConfirm(track.label || track.paperTrack, keyIds.size, eventCount, bindingCount), {
      title: uiText.actions.deleteOverlayPaperTrack,
      okLabel: uiText.actions.deleteOverlayPaperTrackConfirmOk,
      cancelLabel: uiText.keys.deleteConfirmCancel,
    })
    if (!confirmed) return
    try {
      const next = deleteOverlayPaperTrack(project, paperTrack)
      commitProject(next)
      if (selection.hit?.paperTrack === paperTrack || (selection.keyId && keyIds.has(selection.keyId))) clearSelectionState()
    } catch (error) {
      window.alert(errorMessage(error))
    }
  }

  function handleUpdateCorrectionLayers(layers: CorrectionLayer[]): boolean {
    try {
      const nextProject = updateCorrectionLayers(project, layers)
      commitProject(nextProject)
      setActiveCorrectionLayerIdState(current =>
        nextProject.correctionLayers.some(layer => layer.layerId === current)
          ? current
          : defaultCorrectionLayerId(nextProject) ?? '',
      )
      return true
    } catch (error) {
      window.alert(errorMessage(error))
      return false
    }
  }

  async function handleLoadProject(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    try {
      const loadedDocument = parseProjectDocument(await readJsonFile<unknown>(file))
      const loaded = activeCutProjectFromDocument(loadedDocument)
      setTemplate(loadedDocument.sheetTemplate)
      setProjectDocument(loadedDocument)
      setProjectFilePath((file as File & { path?: string }).path ?? null)
      setHistory(createProjectHistory(loaded))
      setActiveCorrectionLayerIdState(defaultCorrectionLayerId(loaded) ?? '')
      setRuntimeSourceImageUrls({})
      clearSelectionState()
      void alertMissingProjectNativePaths(loadedDocument)
    } catch (error) {
      window.alert(uiText.project.loadFailed(errorMessage(error)))
    }
  }

  async function handleLoadTemplate(files: FileList | null): Promise<SheetTemplate | null> {
    const file = files?.[0]
    if (!file) return null
    return readJsonFile<SheetTemplate>(file)
  }

  function handleApplyTemplateDraft(nextTemplate: SheetTemplate) {
    setTemplate(nextTemplate)
    syncProjectToTemplateTracks(nextTemplate, {
      studioPresetId: undefined,
    })
  }

  function handleCreateTemplateDraft(kind: TemplateDraftKind): SheetTemplate {
    return createTemplateDraft(kind, template)
  }

  async function handleCreatePaperTemplateFromImage(files: FileList | null): Promise<SheetTemplate | null> {
    const file = files?.[0]
    if (!file) return null
    try {
      const dataUrl = await readFileAsDataUrl(file)
      const imageSize = await readImageDimensionsFromDataUrl(dataUrl)
      return createPaperTemplateDraftFromImage(file, dataUrl, imageSize)
    } catch (error) {
      window.alert(uiText.template.referenceImageLoadFailed(errorMessage(error)))
      return null
    }
  }

  async function handleSaveTemplateJson(templateToSave = template) {
    try {
      await saveJsonFile(templateToSave, templateJsonFileName(templateToSave), {
        initialDirectory: fileDialogInitialDirectory(project),
      })
    } catch (error) {
      window.alert(uiText.template.saveFailed(errorMessage(error)))
    }
  }

  async function handleSaveProjectJson(options: { saveAs?: boolean } = {}) {
    try {
      const nextDocument = updateActiveCutProjectInDocument(projectDocument, project, { sheetTemplate: template })
      const json = `${JSON.stringify(nextDocument, null, 2)}\n`
      if (!options.saveAs && projectFilePath) {
        await writeTextFile(projectFilePath, json)
        setProjectDocument(nextDocument)
        return
      }
      const result = await saveJsonFile(nextDocument, projectFileName(nextDocument), {
        initialDirectory: fileDialogInitialDirectory(project),
      })
      if (result.path) setProjectFilePath(result.path)
      setProjectDocument(nextDocument)
    } catch (error) {
      window.alert(uiText.project.saveFailed(errorMessage(error)))
    }
  }

  function handleUpdateCutMetadata(field: 'title' | 'episode' | 'scene' | 'cut', value: string) {
    const trimmed = value.trim()
    commitProject({
      ...project,
      cut: {
        ...project.cut,
        [field]: trimmed || undefined,
      },
    })
  }

  function handleCspImportAssetRootChange(rootId: string) {
    const nextDocument = updateActiveCutProjectInDocument(projectDocument, project, {
      sheetTemplate: template,
      cspImportAssetRootId: rootId || undefined,
    })
    setProjectDocument(nextDocument)
  }

  function handleSwitchProjectCut(cutId: string) {
    if (!cutId || cutId === projectDocumentSnapshot.activeCutId) return
    try {
      const nextDocument = switchActiveCutInProjectDocument(projectDocumentSnapshot, project, cutId, { sheetTemplate: template })
      const nextProject = activeCutProjectFromDocument(nextDocument)
      setProjectDocument(nextDocument)
      setHistory(createProjectHistory(nextProject))
      setActiveCorrectionLayerIdState(defaultCorrectionLayerId(nextProject) ?? '')
      setRuntimeSourceImageUrls({})
      clearSelectionState()
    } catch (error) {
      window.alert(errorMessage(error))
    }
  }

  function handleAddSharedCut() {
    try {
      const suggestedCutNumber = nextCutNumberLabel(projectDocumentSnapshot)
      const nextDocument = addBlankSharedCutToProjectDocument(projectDocumentSnapshot, project, {
        cut: { cut: suggestedCutNumber },
      })
      const nextProject = activeCutProjectFromDocument(nextDocument)
      setProjectDocument(nextDocument)
      setHistory(createProjectHistory(nextProject))
      setActiveCorrectionLayerIdState(defaultCorrectionLayerId(nextProject) ?? '')
      setRuntimeSourceImageUrls({})
      clearSelectionState()
    } catch (error) {
      window.alert(errorMessage(error))
    }
  }

  async function handleSaveXdts() {
    try {
      const outputs = exportCutProjectsFromDocument(projectDocumentSnapshot).map(cutProject => ({
        fileName: sheetXdtsFileName(cutProject),
        contents: exportXdts(buildExportPlan(cutProject, exportProfileId)),
      }))
      await saveTextOutputs(outputs, 'text/plain;charset=utf-8', {
        filterName: 'XDTS',
        extensions: ['xdts'],
        defaultExtension: 'xdts',
        initialDirectory: fileDialogInitialDirectory(project),
      })
    } catch (error) {
      window.alert(uiText.export.saveFailed(errorMessage(error)))
    }
  }

  async function handleSaveCspImportPackage() {
    try {
      const packageBuild = buildCspImportPackage(projectDocumentSnapshot, {
        exportProfileId,
        appVersion: APP_VERSION,
      })
      const blockingIssues = packageBuild.issues.filter(issue => issue.severity === 'error')
      if (blockingIssues.length > 0 || !packageBuild.assetRootPath) {
        const details = blockingIssues.map(issueMessage).join('\n') || 'パス付きのカットフォルダが必要です。'
        window.alert(uiText.export.cspImportPackageBlocked(details))
        return
      }
      if (isTauriHost()) {
        const assetRootStatus = (await statNativePaths([packageBuild.assetRootPath]))[0]
        if (!assetRootStatus?.isDirectory) {
          window.alert(uiText.export.cspImportAssetRootMissing(packageBuild.assetRootPath))
          return
        }
        const assetPaths = cspImportPackageAssetPaths(packageBuild)
        const missingAssets = (await statNativePaths(assetPaths)).filter(status => !status.isFile)
        if (missingAssets.length > 0) {
          window.alert(uiText.export.cspImportAssetFilesMissing(missingAssets.length, missingAssets.slice(0, 12).map(status => status.path)))
          return
        }
      }
      const files = cspImportPackageTextOutputs(packageBuild)
      const result = await writeCspImportPackage({
        assetRootPath: packageBuild.assetRootPath,
        outputDirectoryName: packageBuild.outputDirectoryName,
        files,
      })
      if (!result) return
      window.alert(uiText.export.cspImportPackageSaved(result.outputDirectoryPath))
    } catch (error) {
      window.alert(uiText.export.saveFailed(errorMessage(error)))
    }
  }

  function handleOpenSheetImageExport(format: SheetImageExportFormat) {
    setSheetImageExportDraft(defaultSheetImageExportOptions(project, template, format))
  }

  async function handleSaveSheetImageExport(options: SheetImageExportOptions) {
    try {
      const outputs = []
      const cutProjects = exportCutProjectsFromDocument(projectDocumentSnapshot)
      for (const [index, cutProject] of cutProjects.entries()) {
        outputs.push(...await renderSheetImageExports(cutProject, template, runtimeSourceImageUrls, options, {
          cutGroup: {
            activeCutId: projectDocumentSnapshot.cuts[index]?.cutId ?? projectDocumentSnapshot.activeCutId,
            cuts: projectDocumentSnapshot.cuts,
          },
        }))
      }
      const saved = await saveBinaryOutputs(outputs, {
        filterName: imageExportFilterName(options.format),
        extensions: [options.format],
        defaultExtension: options.format,
        initialDirectory: fileDialogInitialDirectory(project),
      })
      if (saved) setSheetImageExportDraft(null)
    } catch (error) {
      window.alert(uiText.export.saveFailed(errorMessage(error)))
    }
  }

  function handlePresetSelect(presetId: string) {
    const preset = sheetTemplatePresets.find(item => item.presetId === presetId)
    if (!preset) return
    setTemplate(preset.sheetTemplate)
    syncProjectToTemplateTracks(preset.sheetTemplate, {
      studioPresetId: preset.presetId,
      resetSheetView: true,
    })
  }

  function syncProjectToTemplateTracks(
    nextTemplate: SheetTemplate,
    options: { studioPresetId?: string; resetSheetView?: boolean } = {},
  ) {
    const reconfigured = updateProjectPaperTracks(project, getSheetTemplatePaperTracks(nextTemplate))
    const nextProject = updateLogicalSheetSettings(reconfigured, { fps: nextTemplate.defaults.fps })
    commitProject({
      ...nextProject,
      studioPresetId: options.studioPresetId,
      sheetTemplateId: nextTemplate.templateId,
      sheetView: options.resetSheetView
        ? createDefaultSheetViewState(nextTemplate)
        : { ...nextProject.sheetView, templateId: nextTemplate.templateId },
    })
    clearSelectionState()
    setRecognitionCandidates([])
    setTextFontSizePx(defaultTimingTextFontSizePx(nextTemplate, 'cell'))
  }

  function handleUndo() {
    setHistory(current => undoHistory(current))
  }

  function handleRedo() {
    setHistory(current => redoHistory(current))
  }

  function handleResetApp() {
    const nextProject = createDefaultProject()
    setTemplate(standardA3SheetTemplate)
    setProjectDocument(createProjectDocumentFromCutProject(nextProject))
    setProjectFilePath(null)
    setHistory(createProjectHistory(nextProject))
    setActiveCorrectionLayerIdState(defaultCorrectionLayerId(nextProject) ?? '')
    setRuntimeSourceImageUrls({})
    setRecognitionCandidates([])
    switchPanel('sheet')
    setEditMode('new')
    setZoom(1)
    setShowTemplate(true)
    setShowTemplateGuides(true)
    setShowAnnotations(true)
    setPenColor('#d52b2b')
    setPenWidth(0.004)
    setEraserWidth(0.018)
    setTextFontSizePx(defaultTimingTextFontSizePx(standardA3SheetTemplate, 'cell'))
    clearSelectionState()
    setTimingClipboard(null)
    setValueDraft('')
    setValueDraftActive(false)
    setExportProfileId('import-stack')
    setAssetDropMenu(null)
  }

  function handleAnnotation(stroke: AnnotationStroke) {
    commitProject(addAnnotation(project, stroke))
  }

  function handleTextAnnotation(annotation: AnnotationText) {
    const nextProject = addAnnotation(project, annotation)
    commitProject(project.sheetView.activePageId === annotation.pageId
      ? nextProject
      : updateSheetViewState(nextProject, { activePageId: annotation.pageId }))
    selectTextAnnotationState(annotation, { edit: true })
  }

  function handleSelectTextAnnotation(annotationId: string) {
    const annotation = project.annotations.find((item): item is AnnotationText => item.kind === 'text' && item.annotationId === annotationId)
    if (!annotation) return
    selectTextAnnotationState(annotation)
    if (project.sheetView.activePageId !== annotation.pageId) {
      commitProject(updateSheetViewState(project, { activePageId: annotation.pageId }))
    }
  }

  function handleEditTextAnnotation(annotationId: string) {
    const annotation = project.annotations.find((item): item is AnnotationText => item.kind === 'text' && item.annotationId === annotationId)
    if (!annotation) return
    selectTextAnnotationState(annotation, { edit: true })
    if (project.sheetView.activePageId !== annotation.pageId) {
      commitProject(updateSheetViewState(project, { activePageId: annotation.pageId }))
    }
  }

  function currentTextAnnotationAnchor(pageId: string): AnnotationText['anchor'] {
    return {
      kind: 'view-surface',
      templateId: template.templateId,
      pageId,
      surfaceSize: activeSheetPageSize,
    }
  }

  function selectTextAnnotationState(annotation: AnnotationText, options: { edit?: boolean } = {}) {
    setSelectedTextAnnotationId(annotation.annotationId)
    setEditingTextAnnotationId(options.edit ? annotation.annotationId : null)
    setTextFontSizePx(resolveAnnotationTextFontSizePx(annotation, activeSheetPageSize))
    setRangeSelection(null)
    setSelection({ hit: null, keyId: null })
    setValueDraft('')
    setValueDraftActive(false)
  }

  function handleUpdateTextAnnotation(annotationId: string, updates: TextAnnotationUpdate) {
    const nextProject = updateTextAnnotation(project, annotationId, updates)
    if (nextProject !== project) commitProject(nextProject)
  }

  function handleCommitTextAnnotation(annotationId: string, text: string) {
    if (!text.trim()) {
      handleDeleteTextAnnotation(annotationId)
      return
    }
    const nextProject = updateTextAnnotation(project, annotationId, { text })
    if (nextProject !== project) commitProject(nextProject)
    setSelectedTextAnnotationId(annotationId)
    if (editingTextAnnotationId === annotationId) setEditingTextAnnotationId(null)
  }

  function handleCancelTextAnnotation(annotationId: string) {
    const annotation = project.annotations.find((item): item is AnnotationText => item.kind === 'text' && item.annotationId === annotationId)
    if (annotation && !annotation.text.trim()) {
      handleDeleteTextAnnotation(annotationId)
      return
    }
    setSelectedTextAnnotationId(annotationId)
    if (editingTextAnnotationId === annotationId) setEditingTextAnnotationId(null)
  }

  function handleCommitFocusedTextAnnotationDraft() {
    const activeEditor = document.activeElement instanceof HTMLTextAreaElement && document.activeElement.classList.contains('annotationTextEditor')
      ? document.activeElement
      : null
    const selectedEditor = editingTextAnnotationId
      ? Array.from(document.querySelectorAll<HTMLTextAreaElement>('.annotationTextEditor'))
          .find(item => item.dataset.annotationId === editingTextAnnotationId) ?? null
      : null
    const editor = activeEditor ?? selectedEditor
    if (!editor) {
      setEditingTextAnnotationId(null)
      return
    }
    const annotationId = editor.dataset.annotationId
    if (!annotationId) {
      setEditingTextAnnotationId(null)
      return
    }
    editor.dataset.commitHandled = 'true'
    handleCommitTextAnnotation(annotationId, editor.value)
  }

  function handleDeleteTextAnnotation(annotationId = selectedTextAnnotation?.annotationId) {
    if (!annotationId) return
    const nextProject = deleteTextAnnotation(project, annotationId)
    if (nextProject !== project) commitProject(nextProject)
    if (selectedTextAnnotationId === annotationId) setSelectedTextAnnotationId(null)
    if (editingTextAnnotationId === annotationId) setEditingTextAnnotationId(null)
  }

  function handleCopyTextAnnotation(annotation = selectedTextAnnotation) {
    if (!annotation) return
    setTextAnnotationClipboard(annotation)
  }

  function handleCutTextAnnotation() {
    if (!selectedTextAnnotation) return
    setTextAnnotationClipboard(selectedTextAnnotation)
    handleDeleteTextAnnotation(selectedTextAnnotation.annotationId)
  }

  function handlePasteTextAnnotation() {
    if (!textAnnotationClipboard || !activePage) return
    const pastedAnnotation = cloneTextAnnotationForPaste(textAnnotationClipboard, {
      annotationId: nextAnnotationId(project.annotations),
      pageId: activePage.pageId,
      templateId: template.templateId,
      surfaceSize: activeSheetPageSize,
    })
    const nextProject = addAnnotation(project, pastedAnnotation)
    commitProject(project.sheetView.activePageId === pastedAnnotation.pageId
      ? nextProject
      : updateSheetViewState(nextProject, { activePageId: pastedAnnotation.pageId }))
    setTextAnnotationClipboard(pastedAnnotation)
    selectTextAnnotationState(pastedAnnotation)
  }

  function handleTextFontSizeChange(value: number) {
    const nextSize = clampTextFontSizePx(value)
    if (activeTextTarget.kind === 'timingRange') return
    setTextFontSizePx(nextSize)
    if (activeTextTarget.kind === 'annotationText') {
      const annotation = project.annotations.find((item): item is AnnotationText => item.kind === 'text' && item.annotationId === activeTextTarget.annotationId)
      handleUpdateTextAnnotation(activeTextTarget.annotationId, {
        fontSizePx: nextSize,
        coordinateSpace: 'view-surface',
        anchor: currentTextAnnotationAnchor(annotation?.pageId ?? activePage?.pageId ?? project.sheetView.activePageId),
      })
      return
    }
    if (activeTextTarget.kind === 'timingEvent') {
      const nextProject = updateTimelineEventFontSize(project, activeTextTarget.eventId, nextSize)
      if (nextProject !== project) commitProject(nextProject)
    }
  }

  function handleEraseAnnotation(pageId: string, points: AnnotationPoint[], width: number) {
    const nextProject = eraseAnnotations(project, { pageId, points, width })
    if (nextProject !== project) commitProject(nextProject)
  }

  async function handleRecognizeSheet() {
    const pages = sheetPages.flatMap(page => {
      const pageImage = getSheetPageImage(project.sheetView, runtimeSourceImageUrls, page.pageId, template)
      return pageImage.sourceId && pageImage.imageUrl
        ? [{ page, imageUrl: pageImage.imageUrl, imageSettings: pageImage.settings }]
        : []
    })
    if (pages.length === 0 || recognitionRunning) return
    setRecognitionRunning(true)
    setRecognitionProgress({ completed: 0, total: 0 })
    setRecognitionMessage(null)
    try {
      const candidates = await recognizeSheetPages({
        template,
        pages,
        sheetRole: recognitionRole,
        durationFrames: sheetDisplayDurationFrames,
        frameOrigin: sheetDisplayFrameStart,
        paperTracks: templatePaperTracks(project).map(track => track.paperTrack),
        layoutOverrides: project.sheetView.layoutOverrides,
        onProgress: (completed, total) => setRecognitionProgress({ completed, total }),
      })
      setRecognitionCandidates(candidates)
      setRecognitionMessage(uiText.recognition.completed(candidates.length, pages.length))
    } catch (error) {
      setRecognitionMessage(uiText.recognition.failed(errorMessage(error)))
    } finally {
      setRecognitionRunning(false)
    }
  }

  function acceptRecognitionCandidate(candidate: RecognitionCandidate) {
    const result = createRecognizedEvent(project, candidate.paperTrack, candidate.frame, candidate.sheetRole, candidate.normalizedLabel)
    if (result.status === 'conflict') {
      setRecognitionMessage(uiText.recognition.conflict(candidate.paperTrack, candidate.frame))
      return
    }
    if (result.project !== project) commitProject(result.project)
    setSelection({ hit: candidateToHit(template, sheetDisplayDurationFrames, sheetDisplayFrameStart, candidate), keyId: result.key?.keyId ?? null })
    setRecognitionCandidates(current => current.filter(item => item.candidateId !== candidate.candidateId))
  }

  function acceptAllRecognitionCandidates() {
    let next = project
    let last: RecognitionCandidate | undefined
    const conflicts: RecognitionCandidate[] = []
    for (const candidate of recognitionCandidates) {
      const result = createRecognizedEvent(next, candidate.paperTrack, candidate.frame, candidate.sheetRole, candidate.normalizedLabel)
      if (result.status === 'conflict') {
        conflicts.push(candidate)
        continue
      }
      next = result.project
      last = candidate
    }
    if (next !== project) commitProject(next)
    if (last) setSelection({ hit: candidateToHit(template, logicalSheetDisplayDurationFrames(next.logicalSheet), logicalSheetDisplayFrameStart(next.logicalSheet), last), keyId: null })
    setRecognitionCandidates(conflicts)
    setRecognitionMessage(conflicts.length > 0 ? uiText.recognition.conflictsRemain(conflicts.length) : null)
  }

  function updateRecognitionCandidateLabel(candidateId: string, value: string) {
    setRecognitionCandidates(current => current.map(candidate => candidate.candidateId === candidateId
      ? { ...candidate, normalizedLabel: normalizeRecognitionLabel(value) ?? value.trim() }
      : candidate))
  }

  function moveSelection(trackDelta: number, frameDelta: number) {
    const nextHit = nextTimingHit(template, sheetDisplayDurationFrames, sheetDisplayFrameStart, selection.hit, trackDelta, frameDelta)
    if (!nextHit) return
    const nextRole = sheetRoleForHit(nextHit)
    const existingEvent = project.logicalSheet.events.find(event => event.paperTrack === nextHit.paperTrack && event.frame === nextHit.frame && sheetTimingRoleForEvent(event) === nextRole)
    if (typeof nextHit.pageIndex === 'number') setActivePageIndex(nextHit.pageIndex)
    const key = existingEvent?.keyId ? project.logicalSheet.keys.find(item => item.keyId === existingEvent.keyId) ?? null : null
    setRangeSelection(null)
    setSelection({ hit: nextHit, keyId: existingEvent?.keyId ?? null })
    setValueDraft(key?.displayLabel ?? '')
    setValueDraftActive(false)
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.isComposing) return
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && selectedTextAnnotation) {
        event.preventDefault()
        handleCopyTextAnnotation()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x' && selectedTextAnnotation) {
        event.preventDefault()
        handleCutTextAnnotation()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && rangeSelection) {
        event.preventDefault()
        copySelectedTimingRange('copy')
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x' && rangeSelection) {
        event.preventDefault()
        copySelectedTimingRange('cut', false)
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
        event.preventDefault()
        if (textAnnotationClipboard && !selection.hit && !rangeSelection) {
          handlePasteTextAnnotation()
          return
        }
        pasteTimingClipboard(event.shiftKey ? 'repeat-range' : 'overwrite')
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        handleUndo()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        handleRedo()
        return
      }
      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        if (
          panel === 'sheet'
          && event.key.toLowerCase() === 'z'
          && !selection.hit
          && !rangeSelection
          && editMode !== 'calibrate'
        ) {
          event.preventDefault()
          setZoomMode(current => !current)
          return
        }
        if (selection.hit && isTimingValueCharacter(event.key)) {
          event.preventDefault()
          handleTimingCharacterInput(event.key)
          return
        }
        if (event.key === 'Enter' && selection.hit) {
          event.preventDefault()
          applyTimingValueToSelection(valueDraft, false)
          return
        }
        if (selectedTextAnnotation && !editingTextAnnotation && (event.key === 'Enter' || event.key === 'F2')) {
          event.preventDefault()
          handleEditTextAnnotation(selectedTextAnnotation.annotationId)
          return
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          moveSelection(0, -1)
          return
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          moveSelection(0, 1)
          return
        }
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          moveSelection(-1, 0)
          return
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          moveSelection(1, 0)
          return
        }
        const mode = modeShortcut(event.key)
        if (mode) {
          event.preventDefault()
          setEditMode(mode)
          return
        }
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        if (selectedTextAnnotation) {
          handleDeleteTextAnnotation()
          return
        }
        handleDeleteEvent()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setAssetDropMenu(null)
        setEditMode('new')
        setZoomMode(false)
        handleClearSelection()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  useEffect(() => {
    if (!assetDropMenu) return
    const close = () => setAssetDropMenu(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [assetDropMenu])

  return (
    <div className="appShell" onContextMenu={event => event.preventDefault()}>
      <header className="topBar">
        <div className="topIdentity">
          <AppNavigationMenu
            panels={appProfile.panels}
            panel={panel}
            onSelect={switchPanel}
            onLoadProject={files => void handleLoadProject(files)}
            onSaveProject={() => void handleSaveProjectJson()}
            onSaveProjectAs={() => void handleSaveProjectJson({ saveAs: true })}
            onSaveTemplate={() => void handleSaveTemplateJson()}
            onResetApp={handleResetApp}
            onOpenSheetImageExport={handleOpenSheetImageExport}
            onSaveXdts={() => void handleSaveXdts()}
            onSaveCspImportPackage={() => void handleSaveCspImportPackage()}
            onOpenExportSettings={appKind === 'remap' ? () => setExportSettingsDialogOpen(true) : undefined}
            blockingExport={blockingExport}
          />
          <span className="topBrand">
            <strong>{appProfile.appName}</strong>
            <span className="appVersion">v{APP_VERSION}</span>
          </span>
        </div>
        <div className="topActions">
          <div className="cutMetadataTopGroup" aria-label="カット情報">
            <TooltipTarget label={uiText.sheet.cutTitleTitle}>
              {tooltipProps => (
                <label className="topTextField" {...tooltipProps}>
                  <span>タイトル</span>
                  <input
                    value={project.cut.title ?? ''}
                    placeholder=""
                    onChange={event => handleUpdateCutMetadata('title', event.currentTarget.value)}
                  />
                </label>
              )}
            </TooltipTarget>
            <TooltipTarget label={uiText.sheet.cutEpisodeTitle}>
              {tooltipProps => (
                <label className="topTextField compact" {...tooltipProps}>
                  <span>話数</span>
                  <input
                    value={project.cut.episode ?? ''}
                    onChange={event => handleUpdateCutMetadata('episode', event.currentTarget.value)}
                  />
                </label>
              )}
            </TooltipTarget>
            <TooltipTarget label="シーン・カット管理を行う作品だけ入力します。">
              {tooltipProps => (
                <label className="topTextField compact" {...tooltipProps}>
                  <span>シーン</span>
                  <input
                    value={project.cut.scene ?? ''}
                    onChange={event => handleUpdateCutMetadata('scene', event.currentTarget.value)}
                  />
                </label>
              )}
            </TooltipTarget>
            <TooltipTarget label={uiText.sheet.cutNumberTitle}>
              {tooltipProps => (
                <label className="topTextField compact" {...tooltipProps}>
                  <span>カット</span>
                  <input
                    value={project.cut.cut ?? ''}
                    onChange={event => handleUpdateCutMetadata('cut', event.currentTarget.value)}
                  />
                </label>
              )}
            </TooltipTarget>
            <DurationFrameControl
              frames={project.logicalSheet.durationFrames}
              fps={project.logicalSheet.fps}
              onChange={durationFrames => commitProject(updateLogicalSheetSettings(project, { durationFrames }))}
            />
          </div>
          {panel === 'sheet' && (
            <>
              <div className="paperSheetTopGroup" aria-label="紙シート">
                <span className="topGroupLabel">紙シート</span>
                <TooltipTarget label={uiText.actions.loadSheetSourceFilesTitle}>
                  {tooltipProps => (
                    <>
                      <button
                        type="button"
                        className="paperSheetLoadButton"
                        onClick={() => void openPaperSheetFilePicker()}
                        {...tooltipProps}
                      >
                        読込
                      </button>
                      <input
                        ref={paperSheetInputRef}
                        className="hiddenFileInput"
                        type="file"
                        aria-label={uiText.actions.loadSheetSourceFiles}
                        accept="image/*"
                        multiple
                        onChange={event => {
                          void handleSheetSourceFiles(event.currentTarget.files, activePage?.pageId)
                          event.currentTarget.value = ''
                        }}
                      />
                    </>
                  )}
                </TooltipTarget>
                <Tooltip label={uiText.sheet.imageCorrectionTitle}>
                  <button
                    type="button"
                    aria-label={uiText.sheet.imageCorrection}
                    className={editMode === 'calibrate' ? 'activeToolButton' : ''}
                    disabled={!activePageImage.imageUrl}
                    onClick={() => void startCalibrationWithLoupe()}
                  >
                    補正
                  </button>
                </Tooltip>
                <RecognitionActionMenu
                  candidates={recognitionCandidates}
                  sheetRole={recognitionRole}
                  running={recognitionRunning}
                  progress={recognitionProgress}
                  message={recognitionMessage}
                  project={project}
                  disabled={!hasRecognitionSheetImages}
                  onSheetRoleChange={role => {
                    setRecognitionRole(role)
                    setRecognitionCandidates([])
                    setRecognitionMessage(null)
                  }}
                  onDetect={() => void handleRecognizeSheet()}
                  onAccept={acceptRecognitionCandidate}
                  onAcceptAll={acceptAllRecognitionCandidates}
                  onUpdateLabel={updateRecognitionCandidateLabel}
                  onRemove={candidateId => setRecognitionCandidates(current => current.filter(candidate => candidate.candidateId !== candidateId))}
                  onClear={() => {
                    setRecognitionCandidates([])
                    setRecognitionMessage(null)
                  }}
                />
                <TooltipTarget label={uiText.sheet.paperSheetImageVisibleTitle}>
                  {tooltipProps => (
                    <label className="compactControl topCheckboxControl" {...tooltipProps}>
                      <input type="checkbox" checked={showTemplate} onChange={event => setShowTemplate(event.currentTarget.checked)} />
                      表示
                    </label>
                  )}
                </TooltipTarget>
                <TooltipTarget label={uiText.sheet.templateGuidesTitle}>
                  {tooltipProps => (
                    <label className="compactControl topCheckboxControl" {...tooltipProps}>
                      <input type="checkbox" checked={showTemplateGuides && editMode !== 'calibrate'} disabled={editMode === 'calibrate'} onChange={event => setShowTemplateGuides(event.currentTarget.checked)} />
                      罫線
                    </label>
                  )}
                </TooltipTarget>
                <TooltipTarget label={uiText.sheet.imageOpacityTitle}>
                  {tooltipProps => (
                    <label className="compactControl topOpacityControl" {...tooltipProps}>
                      不透明度
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={Math.round(activePageImage.settings.opacity * 100)}
                        disabled={!activePageImage.sourceId}
                        onChange={event => updateActivePageAlignment({ opacity: Number(event.currentTarget.value) / 100 })}
                      />
                      <span className="zoomValue">{Math.round(activePageImage.settings.opacity * 100)}%</span>
                    </label>
                  )}
                </TooltipTarget>
                <TooltipTarget label="紙シート画像の入力レベルを補正します。">
                  {tooltipProps => {
                    const levelCorrection = activePageLevelCorrectionSettings()
                    return (
                      <div className="compactControl topCheckboxControl sheetLevelCorrectionControl" {...tooltipProps}>
                        <input
                          type="checkbox"
                          aria-label="レベル補正"
                          checked={levelCorrection.enabled}
                          disabled={!activePageImage.imageUrl}
                          onChange={event => toggleActivePageLevelCorrection(event.currentTarget.checked)}
                        />
                        <button
                          type="button"
                          className="levelCorrectionInlineButton"
                          disabled={!activePageImage.imageUrl}
                          onClick={() => setSheetLevelCorrectionDialogOpen(true)}
                        >
                          レベル補正
                        </button>
                      </div>
                    )
                  }}
                </TooltipTarget>
              </div>
              <ActionMenu label={<ViewModeIcon />} ariaLabel={uiText.sheet.viewModeMenu} tooltipLabel={uiText.sheet.viewModeMenuTitle} className="iconActionMenu topViewModeMenu" closeOnMenuItemClick>
                <div className="viewModeMenuList">
                  {([
                    ['single-page', viewModeLabels['single-page']],
                    ['continuous', viewModeLabels.continuous],
                    ['spread', viewModeLabels.spread],
                  ] as Array<[SheetViewMode, string]>).map(([viewMode, label]) => (
                    <button
                      key={viewMode}
                      type="button"
                      className={project.sheetView.viewMode === viewMode ? 'active' : ''}
                      onClick={() => commitProject(updateSheetViewState(project, { viewMode }))}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </ActionMenu>
            </>
          )}
          <Tooltip label={uiText.actions.undo}>
            <button className="topIconButton" onClick={handleUndo} disabled={history.past.length === 0} aria-label={uiText.actions.undo}><UndoIcon /></button>
          </Tooltip>
          <Tooltip label={uiText.actions.redo}>
            <button className="topIconButton" onClick={handleRedo} disabled={history.future.length === 0} aria-label={uiText.actions.redo}><RedoIcon /></button>
          </Tooltip>
          <Tooltip label={`${appProfile.appName}の基本操作と作業手順を開く`}>
            <button className="topIconButton" type="button" onClick={() => setAppHelpDialogOpen(true)} aria-label="ヘルプ"><HelpIcon /></button>
          </Tooltip>
        </div>
      </header>

      <main className="mainPane">
        {panel === 'sheet' && (
          <SheetPanel
            appKind={appKind}
            collapseEditorPanes={collapseEditorSheetPanes}
            project={project}
            exportProfileId={exportProfileId}
            template={template}
            templatePresets={sheetTemplatePresets}
            selectedPresetId={project.studioPresetId ?? sheetTemplatePresets.find(preset => preset.sheetTemplate.templateId === template.templateId)?.presetId}
            onPresetSelect={handlePresetSelect}
            projectCuts={projectCuts}
            activeCutId={projectDocumentSnapshot.activeCutId}
            onSwitchProjectCut={handleSwitchProjectCut}
            onAddSharedCut={handleAddSharedCut}
            onSetSharedCutNumbersVisible={visible => commitProject(updateSheetViewState(project, {
              metadataDisplay: { ...project.sheetView.metadataDisplay, sharedCutNumbers: visible },
            }))}
            sheetPages={sheetPages}
            activePageIndex={clampedActivePageIndex}
            setActivePageIndex={setActivePageIndex}
            sheetView={project.sheetView}
            assets={materialAssets}
            runtimeSourceImageUrls={runtimeSourceImageUrls}
            activePageImage={activePageImage}
            recognitionCandidates={recognitionCandidates}
            selectedKeyId={selection.keyId}
            selectedHit={selection.hit}
            scrollRequest={sheetScrollRequest}
            rangeSelection={rangeSelection}
            timingClipboard={timingClipboard}
            activeCorrectionLayerId={activeCorrectionLayerId}
            setActiveCorrectionLayerId={handleActiveCorrectionLayerChange}
            editMode={editMode}
            setEditMode={setEditMode}
            zoom={zoom}
            setZoom={setZoom}
            zoomMode={zoomMode}
            onStatusHint={setStatusHint}
            suppressAssetPreview={assetDropMenu !== null}
            showTemplate={showTemplate}
            setShowTemplate={setShowTemplate}
            showTemplateGuides={showTemplateGuides}
            setShowTemplateGuides={setShowTemplateGuides}
            showAnnotations={showAnnotations}
            setShowAnnotations={setShowAnnotations}
            penColor={penColor}
            setPenColor={setPenColor}
            penWidth={penWidth}
            setPenWidth={setPenWidth}
            eraserWidth={eraserWidth}
            setEraserWidth={setEraserWidth}
            textFontSizePx={activeTextFontSizePx}
            selectedTextAnnotationId={selectedTextAnnotation?.annotationId ?? null}
            editingTextAnnotationId={editingTextAnnotation?.annotationId ?? null}
            hasSelectedTextTarget={hasSelectedTextTarget}
            textFontSizeDisabled={isTextFontSizeDisabled}
            onTextFontSizeChange={handleTextFontSizeChange}
            autoCalibrationRunning={autoCalibrationRunning}
            autoCalibrationMessage={autoCalibrationMessage}
            autoCalibrationOverlay={autoCalibrationOverlay}
            onCellClick={handleCellClick}
            onCellSelect={handleCellSelect}
            onJumpToKeyFirstUse={handleJumpToKeyFirstUse}
            onRangeSelect={setSelectionFromRange}
            onSetNullAtHit={handleSetNullAtHit}
            onDeleteEventAtHit={handleDeleteEventAtHit}
            onKeySelect={handleKeySelect}
            onDeleteEvent={handleDeleteEvent}
            onCopyRange={() => copySelectedTimingRange('copy')}
            onCutRange={() => copySelectedTimingRange('cut', false)}
            onCutRangeRipple={() => copySelectedTimingRange('cut', true)}
            onPasteTiming={pasteTimingClipboard}
            onOpenFrameOperation={openFrameOperationDialog}
            onClearSelection={handleClearSelection}
            onTemplateImage={files => void handleSheetSourceFiles(files, activePage?.pageId)}
            onAssignSheetSource={handleAssignSheetSource}
            onAssetSheetSources={assetIds => handleAssetSheetSources(assetIds, activePage?.pageId)}
            onAssetDrop={(files, hit, position) => void handleAssetFiles(files, hit, position)}
            onAssetFiles={files => void handleAssetFiles(files)}
            onAssetFileRefs={handleAssetFileRefs}
            onAssetRoots={handleAssetRootCandidates}
            onEnsureAssetRef={handleEnsureAssetRef}
            onAssetNativePaths={(paths, options) => void handleAssetNativePaths(paths, null, undefined, options)}
            onDropDiagnostic={recordDropDiagnostic}
            onAssetAssign={handleAssignAsset}
            onRegisteredCellAssign={handleAssignRegisteredCell}
            onMoveTimelineEvent={handleMoveTimelineEvent}
            onAnnotation={handleAnnotation}
            onTextAnnotation={handleTextAnnotation}
            onSelectTextAnnotation={handleSelectTextAnnotation}
            onEditTextAnnotation={handleEditTextAnnotation}
            onUpdateTextAnnotation={handleUpdateTextAnnotation}
            onCommitTextAnnotation={handleCommitTextAnnotation}
            onCancelTextAnnotation={handleCancelTextAnnotation}
            onCommitFocusedTextAnnotationDraft={handleCommitFocusedTextAnnotationDraft}
            onEraseAnnotation={handleEraseAnnotation}
            onCalibrationPoints={updatePageCalibrationPoints}
            onClearPageAnnotations={pageId => commitProject(clearAnnotationsForPage(project, pageId))}
            onClearAllAnnotations={() => {
              if (!window.confirm(uiText.actions.clearAllInkConfirm)) return
              commitProject(clearAnnotations(project))
            }}
            onUpdateActivePageAlignment={updateActivePageAlignment}
            onStartSheetImageWarp={startSheetImageWarp}
            onDisableSheetImageWarp={disableSheetImageWarp}
            onAutoDetectSheetImageWarp={autoDetectSheetImageWarp}
            onApplySheetImageWarp={applySheetImageWarp}
            onUpdateTiming={updateTiming}
            onSetViewMode={viewMode => commitProject(updateSheetViewState(project, { viewMode }))}
            onUpdateKey={(keyId, displayLabel) => commitProject(updateKey(project, keyId, { displayLabel, paperToken: displayLabel }))}
            onDeleteKey={handleDeleteKey}
            onUpdateKeyCspCellName={handleUpdateKeyCspCellName}
            onMoveKeyBindingProcess={handleMoveKeyBindingProcess}
            onCreateStackGuideLabel={handleCreateStackGuideLabel}
            onUpdateStackGuideLabel={handleUpdateStackGuideLabel}
            onUpdateStackGuideRegistration={handleUpdateStackGuideRegistration}
            onDeleteStackGuideLabel={handleDeleteStackGuideLabel}
            onAssignAssetToStackGuideLabel={handleAssignAssetToStackGuide}
            onAddOverlayPaperTrack={handleAddOverlayPaperTrack}
            onUpdatePaperTrack={handleUpdatePaperTrack}
            onDeleteOverlayPaperTrack={handleDeleteOverlayPaperTrack}
            onApplyNameNormalization={handleApplyNameNormalization}
            onAssignAssetToKey={handleAssignAssetToKey}
            onMoveCspStackItem={handleMoveCspStackItem}
          />
        )}
        {panel === 'bindings' && <BindingPanel project={project} commitProject={commitProject} selectedKeyId={selection.keyId} />}
        {panel === 'slots' && (
          <SlotPanel
            project={project}
            commitProject={commitProject}
            template={template}
            sheetPages={sheetPages}
            activePageIndex={clampedActivePageIndex}
            sheetView={project.sheetView}
            runtimeSourceImageUrls={runtimeSourceImageUrls}
            showTemplate={showTemplate}
            showAnnotations={showAnnotations}
            projectCuts={projectCuts}
            activeCutId={projectDocumentSnapshot.activeCutId}
          />
        )}
        {panel === 'template' && (
          <TemplateWorkspace
            key={templatePanelKey}
            project={project}
            template={template}
            onLoadTemplate={handleLoadTemplate}
            onSaveTemplate={draftTemplate => void handleSaveTemplateJson(draftTemplate)}
            onApplyTemplate={handleApplyTemplateDraft}
            onCreateTemplateDraft={handleCreateTemplateDraft}
            onCreatePaperTemplateFromImage={handleCreatePaperTemplateFromImage}
            onUpdateCorrectionLayers={handleUpdateCorrectionLayers}
          />
        )}
        {panel === 'export' && (
          <ExportPanel
            project={project}
            cspImportAssetRootId={projectDocumentSnapshot.cspImportAssetRootId}
            issues={issues}
            exportPlan={exportPlan}
            xdtsText={xdtsText}
            setTimingSourceRole={updateExportTimingSourceRole}
            updateExportProfile={updateExportProfile}
            onCspImportAssetRootChange={handleCspImportAssetRootChange}
          />
        )}
      </main>

      {sheetImageExportDraft && (
        <SheetImageExportDialog
          project={project}
          template={template}
          initialOptions={sheetImageExportDraft}
          onClose={() => setSheetImageExportDraft(null)}
          onExport={handleSaveSheetImageExport}
        />
      )}

      {appHelpDialogOpen && (
        <AppHelpDialog appName={appProfile.appName} showDigitalHelp={appProfile.showDigitalHelp} onClose={() => setAppHelpDialogOpen(false)} />
      )}

      {exportSettingsDialogOpen && (
        <div className="assetQuickPreviewBackdrop exportSettingsBackdrop" role="dialog" aria-modal="true" aria-label="XDTS詳細設定" onPointerDown={() => setExportSettingsDialogOpen(false)}>
          <section className="exportSettingsDialog" onPointerDown={event => event.stopPropagation()}>
            <header>
              <div>
                <strong>XDTS詳細設定</strong>
                <span>通常は変更せずに書き出せます。</span>
              </div>
              <button type="button" aria-label="閉じる" onClick={() => setExportSettingsDialogOpen(false)}><CloseSmallIcon /></button>
            </header>
            <ExportPanel
              project={project}
              cspImportAssetRootId={projectDocumentSnapshot.cspImportAssetRootId}
              issues={issues}
              exportPlan={exportPlan}
              xdtsText={xdtsText}
              setTimingSourceRole={updateExportTimingSourceRole}
              updateExportProfile={updateExportProfile}
              onCspImportAssetRootChange={handleCspImportAssetRootChange}
            />
          </section>
        </div>
      )}

      {sheetLevelCorrectionDialogOpen && (
        <LevelCorrectionDialog
          title="紙シートのレベル補正"
          imageUrl={activePageImage.imageUrl}
          settings={activePageLevelCorrectionSettings()}
          onChange={updateActivePageLevelCorrection}
          onClose={() => setSheetLevelCorrectionDialogOpen(false)}
        />
      )}

      {frameOperationDialog && (
        <FrameOperationDialog
          state={frameOperationDialog}
          project={project}
          onSubmit={applyFrameOperation}
          onClose={() => setFrameOperationDialog(null)}
        />
      )}

      {calibrationLoupeOpen && editMode === 'calibrate' && activePage && activePageImage.imageUrl && (
        <CalibrationLoupeDialog
          key={`${activePage.pageId}:${activeCalibrationPointsKey}`}
          imageUrl={activePageImage.imageUrl}
          template={template}
          points={activeCalibrationPoints}
          autoCalibrationRunning={autoCalibrationRunning}
          autoCalibrationMessage={autoCalibrationMessage}
          onPoints={(points, enabled) => updatePageCalibrationPoints(activePage, points, enabled)}
          onAutoDetect={autoDetectSheetImageWarp}
          onApply={applySheetImageWarp}
          onClose={closeCalibrationLoupe}
        />
      )}

      {assetDropMenu && (
        <AssetDropProcessMenu
          state={assetDropMenu}
          project={project}
          onSelect={slotId => assignAssetToKeySlot(assetDropMenu.assetId, assetDropMenu.keyId, slotId, assetDropMenu.hit)}
          onCancel={() => setAssetDropMenu(null)}
        />
      )}

      <aside className="inspector">
        <h2>{uiText.inspector.title}</h2>
        <dl>
          <dt>{uiText.inspector.frame}</dt>
          <dd>{selectedFrameSummary}</dd>
          <dt>{uiText.inspector.track}</dt>
          <dd>{rangeSelection ? rangeSelection.paperTrack ?? rangeSelection.columnId : selection.hit?.paperTrack ?? '-'}</dd>
          <dt>{uiText.inspector.sheetRole}</dt>
          <dd>{rangeSelection ? rangeSelection.role.toUpperCase() : selection.hit ? sheetRoleLabel(sheetRoleForHit(selection.hit)) : '-'}</dd>
          <dt>{uiText.inspector.process}</dt>
          <dd>{activeCorrectionLayer?.label ?? '-'}</dd>
          <dt>{uiText.inspector.key}</dt>
          <dd>{selectedKeySummary}</dd>
          <dt>{uiText.inspector.duration}</dt>
          <dd>{project.logicalSheet.durationFrames}F / {roundForInput(project.logicalSheet.durationFrames / project.logicalSheet.fps)}s</dd>
          <dt>{uiText.inspector.pages}</dt>
          <dd>{sheetPages.length}</dd>
        </dl>
        <div className="divider" />
        <label className="fileButton">
          {uiText.actions.loadProject}
          <input type="file" accept=".json,application/json" onChange={event => void handleLoadProject(event.currentTarget.files)} />
        </label>
      </aside>

      <footer className="statusBar">
        <span className="statusSelection">{statusSelectionText}</span>
        {statusHintText && <span className={activeStatusHint ? 'statusHint active' : 'statusHint'}>{statusHintText}</span>}
        <span className="statusIssueSummary">{uiText.issue.errorCount(issueErrorCount)} / 警告 {issueWarningCount}件</span>
      </footer>
    </div>
  )
}

function SheetPanel(props: {
  appKind: MainAppKind
  collapseEditorPanes: boolean
  project: CutProject
  exportProfileId: string
  template: SheetTemplate
  templatePresets: SheetTemplatePreset[]
  selectedPresetId?: string
  onPresetSelect: (presetId: string) => void
  projectCuts: CutGroupProjectDocument['cuts']
  activeCutId: string
  onSwitchProjectCut: (cutId: string) => void
  onAddSharedCut: () => void
  onSetSharedCutNumbersVisible: (visible: boolean) => void
  sheetPages: SheetPage[]
  activePageIndex: number
  setActivePageIndex: (pageIndex: number) => void
  sheetView: SheetViewState
  assets: CutAsset[]
  runtimeSourceImageUrls: Record<string, string>
  activePageImage: SheetPageImage
  recognitionCandidates: RecognitionCandidate[]
  selectedKeyId: string | null
  selectedHit: SheetHit | null
  scrollRequest: SheetScrollRequest | null
  rangeSelection: SheetRangeSelection | null
  timingClipboard: TimingClipboard | null
  activeCorrectionLayerId: string
  setActiveCorrectionLayerId: (value: string) => void
  editMode: EditMode
  setEditMode: (mode: EditMode) => void
  zoom: number
  setZoom: (value: number) => void
  zoomMode: boolean
  onStatusHint: (source: StatusHintSource, text: string | null) => void
  suppressAssetPreview: boolean
  showTemplate: boolean
  setShowTemplate: (value: boolean) => void
  showTemplateGuides: boolean
  setShowTemplateGuides: (value: boolean) => void
  showAnnotations: boolean
  setShowAnnotations: (value: boolean) => void
  penColor: string
  setPenColor: (value: string) => void
  penWidth: number
  setPenWidth: (value: number) => void
  eraserWidth: number
  setEraserWidth: (value: number) => void
  textFontSizePx: number
  selectedTextAnnotationId: string | null
  editingTextAnnotationId: string | null
  hasSelectedTextTarget: boolean
  textFontSizeDisabled: boolean
  onTextFontSizeChange: (value: number) => void
  autoCalibrationRunning: boolean
  autoCalibrationMessage: string | null
  autoCalibrationOverlay: AutoCalibrationOverlayState | null
  onCellClick: (hit: SheetHit) => void
  onCellSelect: (hit: SheetHit) => void
  onJumpToKeyFirstUse: (keyId: string) => void
  onRangeSelect: (range: SheetRangeSelection) => void
  onSetNullAtHit: (hit: SheetHit) => void
  onDeleteEventAtHit: (hit: SheetHit) => void
  onKeySelect: (keyId: string | null) => void
  onDeleteEvent: () => void
  onCopyRange: () => void
  onCutRange: () => void
  onCutRangeRipple: () => void
  onPasteTiming: (mode: 'overwrite' | 'insert' | 'repeat-range' | 'repeat-to-end') => void
  onOpenFrameOperation: (kind: FrameOperationKind, hit: SheetHit) => void
  onClearSelection: () => void
  onTemplateImage: (files: FileList | File[] | null) => void
  onAssignSheetSource: (pageId: string, sourceId: string | null) => void
  onAssetSheetSources: (assetIds: string[]) => void
  onAssetDrop: (files: File[], hit: SheetHit | null, position?: { x: number; y: number }) => void
  onAssetFiles: (files: FileList | File[] | null) => void
  onAssetFileRefs: (refs: FileRef[]) => void
  onAssetRoots: (roots: AssetRootCandidate[]) => void
  onEnsureAssetRef: (ref: FileRef) => string | null
  onAssetNativePaths: (paths: string[], options?: { recursive?: boolean }) => void
  onDropDiagnostic: (report: DropDiagnosticReport) => void
  onAssetAssign: (assetId: string, hit: SheetHit | null, position?: { x: number; y: number }) => void
  onRegisteredCellAssign: (keyId: string, hit: SheetHit | null) => void
  onMoveTimelineEvent: (sourceHit: SheetHit, targetHit: SheetHit) => void
  onAnnotation: (stroke: AnnotationStroke) => void
  onTextAnnotation: (annotation: AnnotationText) => void
  onSelectTextAnnotation: (annotationId: string) => void
  onEditTextAnnotation: (annotationId: string) => void
  onUpdateTextAnnotation: (annotationId: string, updates: TextAnnotationUpdate) => void
  onCommitTextAnnotation: (annotationId: string, text: string) => void
  onCancelTextAnnotation: (annotationId: string) => void
  onCommitFocusedTextAnnotationDraft: () => void
  onEraseAnnotation: (pageId: string, points: AnnotationPoint[], width: number) => void
  onCalibrationPoints: (page: SheetPage, points: SheetCalibrationPointPair[], enabled?: boolean) => void
  onClearPageAnnotations: (pageId: string) => void
  onClearAllAnnotations: () => void
  onUpdateActivePageAlignment: (alignment: Partial<SheetImageAlignment>) => void
  onStartSheetImageWarp: () => void
  onDisableSheetImageWarp: () => void
  onAutoDetectSheetImageWarp: () => void | Promise<void>
  onApplySheetImageWarp: (pointsOverride?: SheetCalibrationPointPair[]) => void
  onUpdateTiming: (updates: Parameters<typeof updateLogicalSheetSettings>[1]) => void
  onSetViewMode: (viewMode: SheetViewMode) => void
  onUpdateKey: (keyId: string, displayLabel: string) => void
  onDeleteKey: (keyId: string) => void | Promise<void>
  onUpdateKeyCspCellName: (keyId: string, slotId: string, cspCellName: string) => void
  onMoveKeyBindingProcess: (keyId: string, sourceSlotId: string, targetCorrectionLayerId: string) => void
  onCreateStackGuideLabel: (input: { label: string; gapIndex: number; insertAfterPaperTrack?: string; displayRole?: SheetTimingRole; viewSnapIndex?: number; kind?: StackGuideLabel['kind']; correctionLayerId?: string }) => void
  onUpdateStackGuideLabel: (labelId: string, updates: StackGuideLabelUpdates) => void
  onUpdateStackGuideRegistration: (labelId: string, correctionLayerId: string, cspCellName: string) => void
  onDeleteStackGuideLabel: (labelId: string) => void
  onAssignAssetToStackGuideLabel: (labelId: string, assetId: string, correctionLayerId?: string) => void
  onAddOverlayPaperTrack: (input: { paperTrack?: string; insertAfterPaperTrack?: string; orderInGap?: number; snapIndex?: number; sheetRole?: SheetTimingRole }) => void
  onUpdatePaperTrack: (paperTrack: string, updates: Parameters<typeof updatePaperTrack>[2]) => void
  onDeleteOverlayPaperTrack: (paperTrack: string) => void | Promise<void>
  onApplyNameNormalization: (plan: NameNormalizationPlan) => Promise<void>
  onAssignAssetToKey: (assetId: string, keyId: string) => void
  onMoveCspStackItem: (itemId: string, direction: 'up' | 'down') => void
}) {
  const activePage = props.sheetPages[props.activePageIndex] ?? props.sheetPages[0]
  const currentFrameBadge = props.rangeSelection
    ? formatFramePosition(props.project, props.rangeSelection.focusFrame)
    : props.selectedHit
      ? formatFramePosition(props.project, props.selectedHit.frame)
      : uiText.sheet.noFrameSelection
  const rangeTimingSummary = props.rangeSelection
    ? {
        start: formatPaddedFrameTimecode(props.project, props.rangeSelection.frameStart),
        end: formatPaddedFrameTimecode(props.project, props.rangeSelection.frameEnd),
        duration: formatPaddedDurationTimecode(props.project, props.rangeSelection.frameEnd - props.rangeSelection.frameStart + 1),
      }
    : { start: '--+--', end: '--+--', duration: '--+--' }
  const [registeredCellPaneWidth, setRegisteredCellPaneWidth] = useState(240)
  const [imageAssetPaneWidth, setImageAssetPaneWidth] = useState(300)
  const [paneVisibility, setPaneVisibility] = useState<SheetPaneVisibility>(() => initialSheetPaneVisibility(props.appKind, props.collapseEditorPanes))
  const [zoomPaletteOpen, setZoomPaletteOpen] = useState(false)
  const [autoFitZoomEnabled, setAutoFitZoomEnabled] = useState(false)
  const [stackGuideInsertTool, setStackGuideInsertTool] = useState<StackGuideInsertTool | null>(null)
  const zoomPaletteRef = useRef<HTMLDivElement>(null)
  const didFitInitialSheetZoom = useRef(false)
  const sheetZoomRef = useRef(props.zoom)
  const updateSheetZoom = props.setZoom
  const correctionLayers = sortedCorrectionLayers(props.project)
  const templatePaperTrackNames = useMemo(
    () => templatePaperTracks(props.project).map(track => track.paperTrack),
    [props.project],
  )
  const hiddenPaperTracks = getSheetTemplateHiddenPaperTracks(props.template, 'cell', templatePaperTrackNames)
  const sheetViewLayout = getSheetViewLayout(props.template)
  const isContinuousCanvas = sheetViewLayout.surface?.type === 'continuous-canvas'
  const workRange = logicalSheetWorkRange(props.project.logicalSheet)
  const displayDurationFrames = logicalSheetDisplayDurationFrames(props.project.logicalSheet)
  const sheetScanSources = props.project.sheetView.sources.filter(source => source.kind === 'sheet-scan')
  const sheetPageSize = useMemo(
    () => resolveSheetTemplatePageSize(props.template, displayDurationFrames, {
      paperTracks: templatePaperTrackNames,
      layoutOverrides: props.project.sheetView.layoutOverrides,
    }),
    [props.template, displayDurationFrames, props.project.sheetView.layoutOverrides, templatePaperTrackNames],
  )
  const assetRegistrationSummaryMap = useMemo(() => assetRegistrationSummaries(props.project), [props.project])

  useEffect(() => {
    try {
      window.localStorage.setItem(`xsheet:${props.appKind}:sheet-panes`, JSON.stringify(paneVisibility))
    } catch {
      // Pane state persistence is optional in restricted browser contexts.
    }
  }, [paneVisibility, props.appKind])

  useLayoutEffect(() => {
    sheetZoomRef.current = props.zoom
  }, [props.zoom])

  const setClampedZoom = useCallback((value: number) => {
    setAutoFitZoomEnabled(false)
    updateSheetZoom(clampSheetZoom(value))
  }, [updateSheetZoom])

  const applyAutoFitZoom = useCallback((value: number) => {
    setAutoFitZoomEnabled(true)
    updateSheetZoom(clampAutoFitSheetZoom(value))
  }, [updateSheetZoom])

  function fitSheetToViewport() {
    const viewport = document.querySelector<HTMLElement>('.sheetViewport')
    if (!viewport) return
    const zoom = fitSheetZoomForViewport(viewport, props.template, sheetPageSize, displayDurationFrames, SHEET_VIEWPORT_FIT_INSET)
    if (zoom !== null) applyAutoFitZoom(zoom)
  }

  function setPreRollVisible(showPreRoll: boolean) {
    props.onUpdateTiming({
      workRange: {
        ...workRange,
        preRollFrames: DEFAULT_PRE_ROLL_FRAMES,
        showPreRoll,
        showPostRoll: true,
      },
    })
  }

  function closeZoomPalette() {
    setZoomPaletteOpen(false)
  }

  function handleZoomPalettePointerLeave() {
    if (zoomPaletteRef.current?.contains(document.activeElement)) return
    closeZoomPalette()
  }

  function handleZoomPaletteBlur(event: FocusEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && zoomPaletteRef.current?.contains(nextTarget)) return
    closeZoomPalette()
  }

  useEffect(() => {
    if (!zoomPaletteOpen) return undefined
    function closeFromOutside(event: globalThis.PointerEvent) {
      const target = event.target
      if (target instanceof Node && zoomPaletteRef.current?.contains(target)) return
      closeZoomPalette()
      if (document.activeElement instanceof HTMLElement && zoomPaletteRef.current?.contains(document.activeElement)) {
        document.activeElement.blur()
      }
    }
    window.addEventListener('pointerdown', closeFromOutside)
    return () => window.removeEventListener('pointerdown', closeFromOutside)
  }, [zoomPaletteOpen])

  useLayoutEffect(() => {
    if (didFitInitialSheetZoom.current) return
    const applyInitialFit = () => {
      if (didFitInitialSheetZoom.current) return
      const viewport = document.querySelector<HTMLElement>('.sheetViewport')
      const zoom = viewport ? fitSheetZoomForViewport(viewport, props.template, sheetPageSize, displayDurationFrames, SHEET_VIEWPORT_FIT_INSET) : null
      if (zoom === null) return
      didFitInitialSheetZoom.current = true
      applyAutoFitZoom(zoom)
    }
    applyInitialFit()
    const frameId = window.requestAnimationFrame(applyInitialFit)
    return () => window.cancelAnimationFrame(frameId)
  }, [applyAutoFitZoom, displayDurationFrames, props.template, sheetPageSize])

  useLayoutEffect(() => {
    if (!autoFitZoomEnabled) return undefined
    const viewport = document.querySelector<HTMLElement>('.sheetViewport')
    if (!viewport) return undefined
    let frameId = 0
    const syncAutoFitZoomToViewport = () => {
      if (frameId !== 0) return
      frameId = window.requestAnimationFrame(() => {
        frameId = 0
        const fitZoom = fitSheetZoomForViewport(viewport, props.template, sheetPageSize, displayDurationFrames, SHEET_VIEWPORT_FIT_INSET)
        if (fitZoom === null) return
        const nextZoom = clampAutoFitSheetZoom(fitZoom)
        if (Math.abs(nextZoom - sheetZoomRef.current) <= SHEET_AUTO_FIT_ZOOM_EPSILON) return
        updateSheetZoom(nextZoom)
      })
    }
    syncAutoFitZoomToViewport()
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncAutoFitZoomToViewport)
    resizeObserver?.observe(viewport)
    window.addEventListener('resize', syncAutoFitZoomToViewport)
    return () => {
      if (frameId !== 0) window.cancelAnimationFrame(frameId)
      resizeObserver?.disconnect()
      window.removeEventListener('resize', syncAutoFitZoomToViewport)
    }
  }, [autoFitZoomEnabled, displayDurationFrames, props.template, sheetPageSize, updateSheetZoom])

  return (
    <section className="panel sheetLayout">
      <div className="sheetToolbar">
        <ToolbarGroup className="sheetToolbarGroup sheetTimingGroup">
          <ActionMenu
            label={<DisplaySettingsIcon />}
            ariaLabel={uiText.sheet.displaySettingsMenu}
            tooltipLabel={uiText.sheet.settingsMenuTitle}
            className="iconActionMenu sheetDisplaySettingsMenu"
            closeOnMenuItemClick
          >
            <div className="sheetTemplateMenuList" aria-label={uiText.sheet.viewTemplate}>
              {!props.selectedPresetId && (
                <div className="sheetTemplateMenuCurrent">
                  <span>{uiText.sheet.customPreset}</span>
                  <span aria-hidden="true">✓</span>
                </div>
              )}
              {props.templatePresets.map(preset => {
                const isActive = preset.presetId === props.selectedPresetId
                return (
                  <Tooltip key={preset.presetId} label={uiText.sheet.viewTemplateOptionTitle(preset.name)}>
                    <button
                      type="button"
                      className={isActive ? 'sheetTemplateMenuButton active' : 'sheetTemplateMenuButton'}
                      aria-pressed={isActive}
                      onClick={() => props.onPresetSelect(preset.presetId)}
                    >
                      <span>{preset.name}</span>
                      {isActive && <span className="sheetTemplateMenuCheck" aria-hidden="true">✓</span>}
                    </button>
                  </Tooltip>
                )
              })}
            </div>
          </ActionMenu>
        </ToolbarGroup>
        <ToolbarGroup className="sheetToolbarGroup dummyKToolbarGroup">
          <TooltipTarget label={`${uiText.sheet.preRollTitle}\n${uiText.sheet.preRollFixedTitle(DEFAULT_PRE_ROLL_FRAMES)}`}>
            {tooltipProps => (
              <label className="compactControl dummyKControl" {...tooltipProps}>
                <input
                  type="checkbox"
                  aria-label={uiText.sheet.preRoll}
                  checked={workRange.showPreRoll}
                  disabled={sheetViewLayout.workRange?.supportsPreRoll === false}
                  onChange={event => setPreRollVisible(event.currentTarget.checked)}
                />
                {uiText.sheet.preRollFrames}
              </label>
            )}
          </TooltipTarget>
          {workRange.postRollFrames > 0 && (
            <span className="muted workRangeMeta">{uiText.sheet.postRollFrames(workRange.postRollFrames)}</span>
          )}
        </ToolbarGroup>
        <ToolbarGroup className="sheetToolbarGroup cutSwitchToolbarGroup">
          <TooltipTarget label={uiText.sheet.cutSwitchTitle}>
            {tooltipProps => (
              <label className="compactControl cutSwitchControl" {...tooltipProps}>
                兼用
                <select value={props.activeCutId} onChange={event => props.onSwitchProjectCut(event.currentTarget.value)}>
                  {props.projectCuts.map((cut, index) => (
                    <option key={cut.cutId} value={cut.cutId}>
                      {cut.metadata.cut?.trim() || `カット${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </TooltipTarget>
          <Tooltip label={uiText.sheet.addSharedCutTitle}>
            <button type="button" className="cutSwitchAddButton" onClick={props.onAddSharedCut}>＋</button>
          </Tooltip>
          <TooltipTarget label={uiText.sheet.sharedCutNumbersTitle}>
            {tooltipProps => (
              <label className="compactControl sharedCutNumbersControl" {...tooltipProps}>
                <input
                  type="checkbox"
                  aria-label={uiText.sheet.sharedCutNumbers}
                  checked={props.project.sheetView.metadataDisplay.sharedCutNumbers}
                  onChange={event => props.onSetSharedCutNumbersVisible(event.currentTarget.checked)}
                />
                番号表示
              </label>
            )}
          </TooltipTarget>
        </ToolbarGroup>
        <ToolbarGroup className="sheetToolbarGroup processPaletteGroup">
          <span className="toolbarGroupLabel">{uiText.sheet.registrationProcess}</span>
          <div className="processPaletteButtons" role="group" aria-label={uiText.sheet.registrationProcess}>
            {correctionLayers.map(layer => (
              <Tooltip key={layer.layerId} label={uiText.sheet.processPaletteButtonTitle(layer.label)}>
                <button
                  type="button"
                  className={layer.layerId === props.activeCorrectionLayerId ? 'activeToolButton' : ''}
                  aria-label={uiText.sheet.processPaletteButtonTitle(layer.label)}
                  aria-pressed={layer.layerId === props.activeCorrectionLayerId}
                  onClick={() => props.setActiveCorrectionLayerId(layer.layerId)}
                >
                  {layer.label}
                </button>
              </Tooltip>
            ))}
          </div>
        </ToolbarGroup>
        <ToolbarGroup className="sheetToolbarGroup textToolbarGroup">
          <Tooltip label={props.editMode === 'text' ? uiText.sheet.textToolActiveTitle : uiText.sheet.textToolTitle}>
            <button
              type="button"
              className={props.editMode === 'text' ? 'activeToolButton textToolButton' : 'textToolButton'}
              aria-pressed={props.editMode === 'text'}
              aria-label={uiText.sheet.textTool}
              onClick={() => props.setEditMode(props.editMode === 'text' ? 'new' : 'text')}
            >
              <TextToolIcon />
            </button>
          </Tooltip>
          <FontSizeControl
            value={props.textFontSizePx}
            active={props.hasSelectedTextTarget}
            disabled={props.textFontSizeDisabled}
            onChange={props.onTextFontSizeChange}
          />
        </ToolbarGroup>
        <div className="sheetFrameStatus">
          <span className={props.selectedHit || props.rangeSelection ? 'currentFrameBadge' : 'currentFrameBadge empty'}>
            {currentFrameBadge}
          </span>
          <span className={props.rangeSelection ? 'rangeFrameInspector' : 'rangeFrameInspector empty'}>
            <span className="rangeFrameInspectorItem">
              <span className="rangeFrameInspectorLabel">{uiText.sheet.rangeStart}</span>
              <span className="rangeFrameInspectorValue">{rangeTimingSummary.start}</span>
            </span>
            <span className="rangeFrameInspectorItem">
              <span className="rangeFrameInspectorLabel">{uiText.sheet.rangeEnd}</span>
              <span className="rangeFrameInspectorValue">{rangeTimingSummary.end}</span>
            </span>
            <span className="rangeFrameInspectorItem">
              <span className="rangeFrameInspectorLabel">{uiText.sheet.rangeDuration}</span>
              <span className="rangeFrameInspectorValue">{rangeTimingSummary.duration}</span>
            </span>
          </span>
          <div className="pageTabs sheetPageTabs">
            {isContinuousCanvas && activePage && (
              <span className="pageTabsSurface">{uiText.sheet.surfaceTab(activePage.frameStart, activePage.frameEnd)}</span>
            )}
            {!isContinuousCanvas && activePage && props.sheetPages.length <= 1 && (
              <span className="pageTabsSurface active">{uiText.sheet.pageTab(activePage.pageIndex + 1)}</span>
            )}
            {!isContinuousCanvas && activePage && props.sheetPages.length > 1 && (
              <ActionMenu
                label={uiText.sheet.pageTab(activePage.pageIndex + 1)}
                ariaLabel={uiText.sheet.activePage}
                className="pageJumpMenu"
                closeOnMenuItemClick
              >
                <div className="pageJumpList">
                  {props.sheetPages.map(page => {
                    const pageState = props.project.sheetView.pages.find(item => item.pageId === page.pageId)
                    const sourceId = pageState?.sourceId ?? ''
                    return (
                      <div key={page.pageId} className={page.pageIndex === props.activePageIndex ? 'pageJumpRow active' : 'pageJumpRow'}>
                        <Tooltip label={uiText.sheet.pageJumpTitle(page.pageIndex + 1)}>
                          <button
                            type="button"
                            className="pageJumpPageButton"
                            onClick={() => props.setActivePageIndex(page.pageIndex)}
                          >
                            {uiText.sheet.pageTab(page.pageIndex + 1)}
                          </button>
                        </Tooltip>
                        <TooltipTarget label={uiText.sources.pageAssignmentTitle(page.pageIndex + 1)}>
                          {tooltipProps => (
                            <label className="pageJumpSourceSelect" data-action-menu-keep-open {...tooltipProps}>
                              <select
                                value={sourceId}
                                aria-label={uiText.sources.pageAssignmentLabel(page.pageIndex + 1)}
                                onChange={event => props.onAssignSheetSource(page.pageId, event.currentTarget.value || null)}
                              >
                                <option value="">{uiText.app.unassigned}</option>
                                {sheetScanSources.map(source => (
                                  <option key={source.sourceId} value={source.sourceId}>{sheetSourceLabel(source)}</option>
                                ))}
                              </select>
                            </label>
                          )}
                        </TooltipTarget>
                        <Tooltip label={uiText.sources.clearAssignmentTitle}>
                          <button
                            type="button"
                            className="pageJumpClearButton"
                            disabled={!sourceId}
                            onClick={() => props.onAssignSheetSource(page.pageId, null)}
                          >
                            {uiText.sources.clearAssignment}
                          </button>
                        </Tooltip>
                      </div>
                    )
                  })}
                  {sheetScanSources.length === 0 && (
                    <p className="pageJumpEmpty">{uiText.sources.empty}</p>
                  )}
                </div>
              </ActionMenu>
            )}
            {hiddenPaperTracks.length > 0 && (
              <Tooltip label={hiddenPaperTracks.join(', ')}>
                <span className="muted">
                  {uiText.sheet.hiddenPaperTracks(hiddenPaperTracks.length)}
                </span>
              </Tooltip>
            )}
          </div>
        </div>
        {props.editMode === 'calibrate' && props.autoCalibrationMessage && (
          <span className="muted calibrationStatus">{props.autoCalibrationMessage}</span>
        )}
      </div>
      <div
        className={[
          'sheetWorkspace',
          paneVisibility.left ? '' : 'leftDockClosed',
          paneVisibility.right ? '' : 'rightDockClosed',
        ].filter(Boolean).join(' ')}
        style={{
          '--sheet-left-dock-width': paneVisibility.left ? `${registeredCellPaneWidth}px` : '0px',
          '--sheet-right-dock-width': paneVisibility.right ? `${imageAssetPaneWidth}px` : '0px',
          '--sheet-left-resizer-width': paneVisibility.left ? '10px' : '0px',
          '--sheet-right-resizer-width': paneVisibility.right ? '10px' : '0px',
        } as WorkspaceStyle}
      >
        <div className="sheetPaneVisibilityControls" aria-label="サイドペイン">
          <Tooltip label={props.appKind === 'remap' ? 'CSPレイヤー構成を表示' : '登録セルを表示'}>
            <button
              type="button"
              className={paneVisibility.left ? 'active' : ''}
              aria-label={props.appKind === 'remap' ? 'CSPレイヤー構成' : '登録セル'}
              aria-pressed={paneVisibility.left}
              onClick={() => setPaneVisibility(current => ({ ...current, left: !current.left }))}
            >構成</button>
          </Tooltip>
          <Tooltip label="画像素材を表示">
            <button
              type="button"
              className={paneVisibility.right ? 'active' : ''}
              aria-label="画像素材"
              aria-pressed={paneVisibility.right}
              onClick={() => setPaneVisibility(current => ({ ...current, right: !current.right }))}
            >素材</button>
          </Tooltip>
        </div>
        <div
          ref={zoomPaletteRef}
          className={[
            'sheetZoomFloatingPalette',
            zoomPaletteOpen ? 'open' : '',
            props.zoomMode ? 'zoomModeActive' : '',
          ].filter(Boolean).join(' ')}
          aria-label={uiText.sheet.zoom}
          onPointerEnter={() => setZoomPaletteOpen(true)}
          onPointerLeave={handleZoomPalettePointerLeave}
          onFocus={() => setZoomPaletteOpen(true)}
          onBlur={handleZoomPaletteBlur}
        >
          <Tooltip label={uiText.sheet.zoomTitle}>
            <span className="zoomPaletteTrigger">{Math.round(props.zoom * 100)}%</span>
          </Tooltip>
          <div className="zoomPaletteControls">
            <TooltipTarget label={uiText.sheet.zoomTitle}>
              {tooltipProps => (
                <label className="compactControl zoomSliderControl" aria-label={uiText.sheet.zoom} {...tooltipProps}>
                  <input
                    type="range"
                    min={SHEET_ZOOM_MIN * 100}
                    max={SHEET_ZOOM_MAX * 100}
                    value={Math.round(props.zoom * 100)}
                    onChange={event => setClampedZoom(Number(event.currentTarget.value) / 100)}
                  />
                </label>
              )}
            </TooltipTarget>
            <span className="zoomValue">{Math.round(props.zoom * 100)}%</span>
            <Tooltip label={uiText.actions.zoomResetTitle}>
              <button className="zoomResetButton" onClick={() => setClampedZoom(1)}>{uiText.actions.zoomReset}</button>
            </Tooltip>
            <Tooltip label={uiText.actions.zoomFitTitle}>
              <button className="zoomFitButton" aria-label={uiText.actions.zoomFit} onClick={fitSheetToViewport}>全体</button>
            </Tooltip>
          </div>
        </div>
        <div className="annotationFloatingPalette" aria-label={uiText.sheet.annotationGroup}>
          <span className="annotationPaletteTrigger" aria-hidden="true"><PenToolIcon /></span>
          <span className="toolbarGroupLabel annotationPaletteTitle">{uiText.sheet.annotationGroup}</span>
          <Tooltip label={uiText.sheet.penTool}>
            <button
              type="button"
              className={props.editMode === 'pen' ? 'activeToolButton' : ''}
              aria-pressed={props.editMode === 'pen'}
              aria-label={uiText.sheet.penTool}
              onClick={() => props.setEditMode(props.editMode === 'pen' ? 'new' : 'pen')}
            >
              <PenToolIcon />
            </button>
          </Tooltip>
          <Tooltip label={uiText.sheet.eraserTool}>
            <button
              type="button"
              className={props.editMode === 'eraser' ? 'activeToolButton' : ''}
              aria-pressed={props.editMode === 'eraser'}
              aria-label={uiText.sheet.eraserTool}
              onClick={() => props.setEditMode(props.editMode === 'eraser' ? 'new' : 'eraser')}
            >
              <EraserToolIcon />
            </button>
          </Tooltip>
          <TooltipTarget label={uiText.sheet.annotationVisibleTitle}>
            {tooltipProps => (
              <label className="compactControl annotationVisibilityToggle" {...tooltipProps}>
                <input type="checkbox" checked={props.showAnnotations} onChange={event => props.setShowAnnotations(event.currentTarget.checked)} />
                {uiText.sheet.annotationVisible}
              </label>
            )}
          </TooltipTarget>
          <Tooltip label={uiText.sheet.penColor}>
            <input type="color" value={props.penColor} onChange={event => props.setPenColor(event.currentTarget.value)} />
          </Tooltip>
          <ActionMenu label={uiText.sheet.penWidth} tooltipLabel={uiText.sheet.penWidthTitle} className="annotationWidthMenu">
            <label className="compactControl">
              {uiText.sheet.penWidth}
              <input type="range" min="1" max="12" value={Math.round(props.penWidth * 1000)} onChange={event => props.setPenWidth(Number(event.currentTarget.value) / 1000)} />
            </label>
            <label className="compactControl">
              {uiText.sheet.eraserWidth}
              <input type="range" min="4" max="32" value={Math.round(props.eraserWidth * 1000)} onChange={event => props.setEraserWidth(Number(event.currentTarget.value) / 1000)} />
            </label>
          </ActionMenu>
          <ActionMenu label={<TrashIcon />} ariaLabel={uiText.actions.clearInk} tooltipLabel={uiText.actions.clearInkTitle} className="annotationClearMenu" closeOnMenuItemClick>
            <button
              type="button"
              disabled={!activePage}
              onClick={() => {
                if (activePage) props.onClearPageAnnotations(activePage.pageId)
              }}
            >
              {uiText.actions.clearPageInk}
            </button>
            <button type="button" onClick={props.onClearAllAnnotations}>{uiText.actions.clearAllInk}</button>
          </ActionMenu>
        </div>
        <aside className="sheetDock sheetDockLeft" aria-label={props.appKind === 'remap' ? 'CSPレイヤー構成' : uiText.keys.title} hidden={!paneVisibility.left}>
          <div className="dockBody">
            {props.appKind === 'remap' ? <CspLayerTree
              project={props.project}
              exportProfileId={props.exportProfileId}
              selectedKeyId={props.selectedKeyId}
              onSelectKey={props.onKeySelect}
              onJumpToFirstUse={props.onJumpToKeyFirstUse}
              onUpdateCspCellName={props.onUpdateKeyCspCellName}
              onUpdateStackGuideRegistration={props.onUpdateStackGuideRegistration}
              onMoveStackItem={props.onMoveCspStackItem}
              onAssignAsset={props.onAssignAssetToKey}
            /> : <KeyList
              project={props.project}
              activeCorrectionLayerId={props.activeCorrectionLayerId}
              selectedKeyId={props.selectedKeyId}
              selectedHit={props.selectedHit}
              rangeSelection={props.rangeSelection}
              onSelect={props.onKeySelect}
              onJumpToFirstUse={props.onJumpToKeyFirstUse}
              onUpdateKey={props.onUpdateKey}
              onDeleteKey={props.onDeleteKey}
              onUpdateCspCellName={props.onUpdateKeyCspCellName}
              onMoveKeyBindingProcess={props.onMoveKeyBindingProcess}
              onUpdateStackGuideLabel={props.onUpdateStackGuideLabel}
              onUpdateStackGuideRegistration={props.onUpdateStackGuideRegistration}
              onDeleteStackGuideLabel={props.onDeleteStackGuideLabel}
              onApplyNameNormalization={props.onApplyNameNormalization}
              onAssignAsset={props.onAssignAssetToKey}
              onAssignAssetToStackGuideLabel={props.onAssignAssetToStackGuideLabel}
              onCreateStackGuideLabel={props.onCreateStackGuideLabel}
              onRequestStackGuideInsert={setStackGuideInsertTool}
            />}
          </div>
        </aside>
        {paneVisibility.left && <PanelResizeHandle
          label={uiText.layout.resizeRegisteredCellPane}
          min={180}
          max={420}
          value={registeredCellPaneWidth}
          side="left"
          onChange={setRegisteredCellPaneWidth}
        />}
        <SheetCanvas
          {...props}
          setZoom={setClampedZoom}
          onCreateStackGuideLabel={props.onCreateStackGuideLabel}
          onAssignAssetToStackGuideLabel={props.onAssignAssetToStackGuideLabel}
          onMoveTimelineEvent={props.onMoveTimelineEvent}
          onAddOverlayPaperTrack={props.onAddOverlayPaperTrack}
          onUpdatePaperTrack={props.onUpdatePaperTrack}
          onDeleteOverlayPaperTrack={props.onDeleteOverlayPaperTrack}
          stackGuideInsertTool={stackGuideInsertTool}
          onStackGuideInsertToolConsumed={() => setStackGuideInsertTool(null)}
        />
        {paneVisibility.right && <PanelResizeHandle
          label={uiText.layout.resizeImageAssetPane}
          min={200}
          max={560}
          value={imageAssetPaneWidth}
          onChange={setImageAssetPaneWidth}
        />}
        <aside className="sheetDock sheetDockRight" aria-label={uiText.assets.title} hidden={!paneVisibility.right}>
          <div className="dockBody">
            <AssetTray
              assetRoots={props.project.assetRoots}
              assets={props.assets}
              registrationSummaries={assetRegistrationSummaryMap}
              onAssets={props.onAssetFiles}
              onAssetRefs={props.onAssetFileRefs}
              onAssetRoots={props.onAssetRoots}
              onEnsureAssetRef={props.onEnsureAssetRef}
              onAssetSheetSources={props.onAssetSheetSources}
              canUseAssetsAsSheetSources={sheetScanSources.length === 0}
              onDropDiagnostic={props.onDropDiagnostic}
            />
          </div>
        </aside>
      </div>
    </section>
  )
}

function AnnotationTextLayer({
  annotations,
  selectedAnnotationId,
  editingAnnotationId,
  pageSize,
  zoom,
  onSelect,
  onEdit,
  onUpdate,
  onCommit,
  onCancel,
}: {
  annotations: AnnotationText[]
  selectedAnnotationId: string | null
  editingAnnotationId: string | null
  pageSize: AnnotationTextPageSize
  zoom: number
  onSelect: (annotationId: string) => void
  onEdit: (annotationId: string) => void
  onUpdate: (annotationId: string, updates: TextAnnotationUpdate) => void
  onCommit: (annotationId: string, text: string) => void
  onCancel: (annotationId: string) => void
}) {
  return (
    <div className="annotationTextLayer">
      {annotations.map(annotation => (
        <AnnotationTextItem
          key={annotation.annotationId}
          annotation={annotation}
          selected={annotation.annotationId === selectedAnnotationId}
          editing={annotation.annotationId === editingAnnotationId}
          pageSize={pageSize}
          zoom={zoom}
          onSelect={onSelect}
          onEdit={onEdit}
          onUpdate={onUpdate}
          onCommit={onCommit}
          onCancel={onCancel}
        />
      ))}
    </div>
  )
}

function AnnotationTextItem({
  annotation,
  selected,
  editing,
  pageSize,
  zoom,
  onSelect,
  onEdit,
  onUpdate,
  onCommit,
  onCancel,
}: {
  annotation: AnnotationText
  selected: boolean
  editing: boolean
  pageSize: AnnotationTextPageSize
  zoom: number
  onSelect: (annotationId: string) => void
  onEdit: (annotationId: string) => void
  onUpdate: (annotationId: string, updates: TextAnnotationUpdate) => void
  onCommit: (annotationId: string, text: string) => void
  onCancel: (annotationId: string) => void
}) {
  const editorRef = useRef<HTMLTextAreaElement | null>(null)
  const closeHandledRef = useRef(false)
  const dragRef = useRef<{
    pointerId: number
    startClientX: number
    startClientY: number
    startX: number
    startY: number
    x: number
    y: number
    moved: boolean
  } | null>(null)
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null)
  const renderedX = dragPosition?.x ?? annotation.x
  const renderedY = dragPosition?.y ?? annotation.y
  const layout = annotationTextCssLayout(annotation, pageSize, zoom, { x: renderedX, y: renderedY })
  const commonStyle = {
    left: `${layout.leftPx}px`,
    top: `${layout.topPx}px`,
    maxWidth: `${layout.maxWidthPx}px`,
    color: annotation.color,
    fontSize: `${layout.fontSizePx}px`,
  } satisfies CSSProperties

  useEffect(() => {
    if (!editing) return
    const frame = window.requestAnimationFrame(() => {
      const editor = editorRef.current
      editor?.focus()
      if (editor && !editor.value) editor.select()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [annotation.annotationId, editing])

  function commitDraftText() {
    closeHandledRef.current = true
    onCommit(annotation.annotationId, editorRef.current?.value ?? annotation.text)
  }

  function cancelDraftText() {
    closeHandledRef.current = true
    onCancel(annotation.annotationId)
  }

  function handleEditorBlur(event: FocusEvent<HTMLTextAreaElement>) {
    if (closeHandledRef.current || event.currentTarget.dataset.commitHandled === 'true') return
    onCommit(annotation.annotationId, event.currentTarget.value)
  }

  function handleDisplayPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: annotation.x,
      startY: annotation.y,
      x: annotation.x,
      y: annotation.y,
      moved: false,
    }
  }

  function handleDisplayPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    const deltaX = event.clientX - drag.startClientX
    const deltaY = event.clientY - drag.startClientY
    const moved = drag.moved || Math.hypot(deltaX, deltaY) >= 3
    if (!moved) return
    const surfaceWidth = Math.max(1, pageSize.widthPx * Math.max(zoom, 0.001))
    const surfaceHeight = Math.max(1, pageSize.heightPx * Math.max(zoom, 0.001))
    const x = clampNumber(drag.startX + deltaX / surfaceWidth, 0, 1)
    const y = clampNumber(drag.startY + deltaY / surfaceHeight, 0, 1)
    dragRef.current = { ...drag, x, y, moved: true }
    setDragPosition({ x, y })
  }

  function handleDisplayPointerEnd(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    dragRef.current = null
    setDragPosition(null)
    if (drag.moved) {
      onUpdate(annotation.annotationId, { x: drag.x, y: drag.y })
    }
    onSelect(annotation.annotationId)
  }

  function handleDisplayPointerCancel(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    setDragPosition(null)
  }

  if (editing) {
    return (
      <>
        <div
          className="annotationTextEditorActions"
          style={{
            left: `${layout.leftPx}px`,
            top: `${Math.max(0, layout.topPx - 30)}px`,
          }}
          onPointerDown={event => {
            event.preventDefault()
            event.stopPropagation()
          }}
        >
          <button type="button" aria-label={uiText.sheet.textAnnotationCommit} onClick={commitDraftText}>
            <CheckSmallIcon />
          </button>
          <button type="button" aria-label={uiText.sheet.textAnnotationCancel} onClick={cancelDraftText}>
            <CloseSmallIcon />
          </button>
        </div>
        <textarea
          key={`${annotation.annotationId}:${annotation.text}`}
          ref={editorRef}
          className="annotationTextEditor"
          data-annotation-id={annotation.annotationId}
          defaultValue={annotation.text}
          placeholder={uiText.sheet.textPlaceholder}
          style={{ ...commonStyle, width: `${layout.editorWidthPx}px`, minHeight: `${layout.editorHeightPx}px` }}
          onBlur={handleEditorBlur}
          onPointerDown={event => {
            event.stopPropagation()
            onSelect(annotation.annotationId)
          }}
          onKeyDown={event => {
            event.stopPropagation()
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault()
              commitDraftText()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              cancelDraftText()
            }
          }}
        />
        <div
          className="annotationTextCommitHint"
          style={{
            left: `${layout.leftPx + layout.editorWidthPx}px`,
            top: `${layout.topPx + layout.editorHeightPx}px`,
          }}
        >
          {uiText.sheet.textAnnotationCommitHint}
        </div>
      </>
    )
  }

  return (
    <button
      type="button"
      className={[
        'annotationTextDisplay',
        annotation.text.trim() ? '' : 'empty',
        selected ? 'selected' : '',
      ].filter(Boolean).join(' ')}
      style={commonStyle}
      aria-label={uiText.sheet.textTool}
      data-dragging={dragPosition ? 'true' : undefined}
      onPointerDown={handleDisplayPointerDown}
      onPointerMove={handleDisplayPointerMove}
      onPointerUp={handleDisplayPointerEnd}
      onPointerCancel={handleDisplayPointerCancel}
      onDoubleClick={event => {
        event.preventDefault()
        event.stopPropagation()
        onEdit(annotation.annotationId)
      }}
    >
      {annotation.text || uiText.sheet.textPlaceholder}
    </button>
  )
}

function AnnotationSvgText({
  annotation,
  pageSize,
}: {
  annotation: AnnotationText
  pageSize: { widthPx: number; heightPx: number }
}) {
  const lines = annotationTextLines(annotation.text)
  if (lines.length === 0) return null
  const fontSize = annotationTextSvgFontSize(annotation, pageSize)
  return (
    <text
      className="annotationTextSvg"
      x={annotation.x}
      y={annotation.y}
      fill={annotation.color}
      fontSize={fontSize}
      dominantBaseline="hanging"
    >
      {lines.map((line, index) => (
        <tspan key={index} x={annotation.x} dy={index === 0 ? 0 : '1.25em'}>
          {line}
        </tspan>
      ))}
    </text>
  )
}

function FontSizeControl({
  value,
  active,
  disabled = false,
  onChange,
}: {
  value: number
  active: boolean
  disabled?: boolean
  onChange: (value: number) => void
}) {
  const clampedValue = clampTextFontSizePx(value)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(clampedValue))

  function startEditing() {
    if (disabled) return
    setDraft(String(clampedValue))
    setEditing(true)
  }

  function commitDraft() {
    if (disabled) {
      setEditing(false)
      return
    }
    const parsed = Number(draft)
    if (Number.isFinite(parsed)) onChange(parsed)
    setEditing(false)
  }

  function cancelDraft() {
    setDraft(String(clampedValue))
    setEditing(false)
  }

  function step(delta: number) {
    if (disabled) return
    onChange(clampedValue + delta)
  }

  return (
    <TooltipTarget label={uiText.sheet.textFontSizeTitle}>
      {tooltipProps => (
        <div
          className={[
            'textFontSizeControl',
            active ? 'active' : '',
            disabled ? 'disabled' : '',
          ].filter(Boolean).join(' ')}
          aria-disabled={disabled}
          {...tooltipProps}
        >
          <span className="toolbarGroupLabel">{uiText.sheet.textFontSize}</span>
          {editing
            ? (
              <input
                className="fontSizeInput"
                type="number"
                min={TEXT_FONT_SIZE_MIN_PX}
                max={TEXT_FONT_SIZE_MAX_PX}
                value={draft}
                autoFocus
                disabled={disabled}
                onChange={event => setDraft(event.currentTarget.value)}
                onBlur={commitDraft}
                onKeyDown={event => {
                  event.stopPropagation()
                  if (event.key === 'Enter') commitDraft()
                  if (event.key === 'Escape') cancelDraft()
                }}
              />
            )
            : (
              <button
                type="button"
                className="fontSizeDragValue"
                aria-label={uiText.sheet.textFontSize}
                disabled={disabled}
                onPointerDown={event => {
                  if (!disabled) beginFontSizeDrag(event, clampedValue, onChange)
                }}
                onDoubleClick={startEditing}
                onKeyDown={event => {
                  if (disabled) return
                  if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
                    event.preventDefault()
                    step(event.shiftKey ? -10 : -1)
                  }
                  if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
                    event.preventDefault()
                    step(event.shiftKey ? 10 : 1)
                  }
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    startEditing()
                  }
                }}
              >
                {clampedValue}
              </button>
            )}
          <span className="fontSizeUnit">px</span>
          {!disabled && (
            <ActionMenu label={<span className="fontSizePresetTrigger" aria-hidden="true">▾</span>} ariaLabel={uiText.sheet.textFontSizePreset} className="fontSizePresetMenu" closeOnMenuItemClick>
              <div className="fontSizePresetList" aria-label={uiText.sheet.textFontSizePreset}>
                {TEXT_FONT_SIZE_PRESETS.map(size => (
                  <button
                    key={size}
                    type="button"
                    className={size === clampedValue ? 'active' : ''}
                    onClick={() => onChange(size)}
                  >
                    {size}px
                  </button>
                ))}
              </div>
            </ActionMenu>
          )}
        </div>
      )}
    </TooltipTarget>
  )
}

function beginFontSizeDrag(event: PointerEvent<HTMLElement>, startValue: number, onChange: (value: number) => void) {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  const startX = event.clientX
  const previousCursor = document.body.style.cursor
  const previousUserSelect = document.body.style.userSelect
  document.body.style.cursor = 'ew-resize'
  document.body.style.userSelect = 'none'
  let lastValue = clampTextFontSizePx(startValue)

  function onPointerMove(moveEvent: globalThis.PointerEvent) {
    moveEvent.preventDefault()
    const step = moveEvent.shiftKey ? 1 : moveEvent.altKey ? 0.05 : 0.25
    const nextValue = clampTextFontSizePx(startValue + Math.round((moveEvent.clientX - startX) * step))
    if (nextValue === lastValue) return
    lastValue = nextValue
    onChange(nextValue)
  }

  function stopDrag() {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', stopDrag)
    window.removeEventListener('pointercancel', stopDrag)
    document.body.style.cursor = previousCursor
    document.body.style.userSelect = previousUserSelect
  }

  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', stopDrag)
  window.addEventListener('pointercancel', stopDrag)
}

function clampAutoFitSheetZoom(value: number): number {
  return clampSheetZoom(Math.max(value, SHEET_AUTO_FIT_MIN_ZOOM))
}

function fitSheetZoomForViewport(
  viewport: HTMLElement,
  template: SheetTemplate,
  pageSize: { widthPx: number; heightPx: number },
  durationFrames: number,
  inset: { horizontal: number; vertical: number },
): number | null {
  if (getSheetViewLayout(template).surface?.type !== 'continuous-canvas') {
    return fitZoomForViewport(viewport, pageSize, inset)
  }
  if (viewport.clientWidth <= 0 || viewport.clientHeight <= 0) return null
  const availableWidth = Math.max(1, viewport.clientWidth - inset.horizontal)
  const widthZoom = availableWidth / pageSize.widthPx
  const rowHeight = minLogicalFrameRowHeightPx(template, pageSize, durationFrames)
  const rowZoom = rowHeight ? CONTINUOUS_CANVAS_MIN_FRAME_ROW_PX / rowHeight : 0
  return Math.max(widthZoom, rowZoom)
}

function scrollSheetHitIntoView(
  viewport: HTMLElement,
  svg: SVGSVGElement,
  project: CutProject,
  template: SheetTemplate,
  hit: SheetHit,
) {
  if (viewport.clientWidth <= 0 || viewport.clientHeight <= 0) return
  const rect = rectForHit(project, template, hit)
  if (!rect) return
  const viewportRect = viewport.getBoundingClientRect()
  const svgRect = svg.getBoundingClientRect()
  const targetCenterX = viewport.scrollLeft + (svgRect.left - viewportRect.left) + (rect.x + rect.w / 2) * svgRect.width
  const targetCenterY = viewport.scrollTop + (svgRect.top - viewportRect.top) + (rect.y + rect.h / 2) * svgRect.height
  viewport.scrollLeft = clampNumber(targetCenterX - viewport.clientWidth / 2, 0, Math.max(0, viewport.scrollWidth - viewport.clientWidth))
  viewport.scrollTop = clampNumber(targetCenterY - viewport.clientHeight / 2, 0, Math.max(0, viewport.scrollHeight - viewport.clientHeight))
}

function autoScrollViewportForDrag(event: Pick<DragEvent<Element>, 'clientX' | 'clientY'>, viewport: HTMLElement | null) {
  if (!viewport) return
  const rect = viewport.getBoundingClientRect()
  const edge = 64
  const maxStep = 28
  const dx = dragAutoScrollDelta(event.clientX - rect.left, viewport.clientWidth, edge, maxStep)
  const dy = dragAutoScrollDelta(event.clientY - rect.top, viewport.clientHeight, edge, maxStep)
  if (dx !== 0) viewport.scrollLeft += dx
  if (dy !== 0) viewport.scrollTop += dy
}

function dragAutoScrollDelta(position: number, size: number, edge: number, maxStep: number): number {
  if (size <= 0) return 0
  if (position < 0 || position > size) return 0
  if (position < edge) return -Math.ceil(((edge - position) / edge) * maxStep)
  if (position > size - edge) return Math.ceil(((position - (size - edge)) / edge) * maxStep)
  return 0
}

function minLogicalFrameRowHeightPx(
  template: SheetTemplate,
  pageSize: { widthPx: number; heightPx: number },
  durationFrames: number,
): number | null {
  const rowHeights = template.regions.flatMap(region => {
    if (region.type !== 'exposure-grid' || region.grid?.frameProjection?.source !== 'logical-frames') return []
    const rect = resolveSheetTemplateRegionRect(template, region, durationFrames)
    const frames = resolveSheetTemplateGridFrames(template, region.grid, durationFrames, template.defaults.frameOrigin)
    return [(rect.h * pageSize.heightPx) / frames.rowCount]
  })
  return rowHeights.length > 0 ? Math.min(...rowHeights) : null
}

function SheetCanvas(props: {
  project: CutProject
  template: SheetTemplate
  projectCuts: CutGroupProjectDocument['cuts']
  activeCutId: string
  sheetPages: SheetPage[]
  activePageIndex: number
  setActivePageIndex: (pageIndex: number) => void
  sheetView: SheetViewState
  runtimeSourceImageUrls: Record<string, string>
  recognitionCandidates: RecognitionCandidate[]
  selectedHit: SheetHit | null
  scrollRequest: SheetScrollRequest | null
  rangeSelection: SheetRangeSelection | null
  timingClipboard: TimingClipboard | null
  editMode: EditMode
  zoom: number
  setZoom: (value: number) => void
  zoomMode: boolean
  onStatusHint: (source: StatusHintSource, text: string | null) => void
  suppressAssetPreview: boolean
  showTemplate: boolean
  showTemplateGuides: boolean
  showAnnotations: boolean
  penColor: string
  penWidth: number
  eraserWidth: number
  textFontSizePx: number
  selectedTextAnnotationId: string | null
  editingTextAnnotationId: string | null
  autoCalibrationOverlay: AutoCalibrationOverlayState | null
  onCellClick: (hit: SheetHit) => void
  onCellSelect: (hit: SheetHit) => void
  onRangeSelect: (range: SheetRangeSelection) => void
  onSetNullAtHit: (hit: SheetHit) => void
  onDeleteEventAtHit: (hit: SheetHit) => void
  onCopyRange: () => void
  onCutRange: () => void
  onCutRangeRipple: () => void
  onPasteTiming: (mode: 'overwrite' | 'insert' | 'repeat-range' | 'repeat-to-end') => void
  onOpenFrameOperation: (kind: FrameOperationKind, hit: SheetHit) => void
  onTemplateImage: (files: FileList | File[] | null) => void
  onAssetSheetSources: (assetIds: string[]) => void
  onAssetDrop: (files: File[], hit: SheetHit | null, position?: { x: number; y: number }) => void
  onAssetAssign: (assetId: string, hit: SheetHit | null, position?: { x: number; y: number }) => void
  onRegisteredCellAssign: (keyId: string, hit: SheetHit | null) => void
  onDropDiagnostic: (report: DropDiagnosticReport) => void
  onMoveTimelineEvent: (sourceHit: SheetHit, targetHit: SheetHit) => void
  onMoveKeyBindingProcess: (keyId: string, sourceSlotId: string, targetCorrectionLayerId: string) => void
  onEraseAnnotation: (pageId: string, points: AnnotationPoint[], width: number) => void
  onCreateStackGuideLabel: (input: { label: string; gapIndex: number; insertAfterPaperTrack?: string; displayRole?: SheetTimingRole; viewSnapIndex?: number; kind?: StackGuideLabel['kind']; correctionLayerId?: string }) => void
  onUpdateStackGuideLabel: (labelId: string, updates: StackGuideLabelUpdates) => void
  onAssignAssetToStackGuideLabel: (labelId: string, assetId: string, correctionLayerId?: string) => void
  onAddOverlayPaperTrack: (input: { paperTrack?: string; insertAfterPaperTrack?: string; orderInGap?: number; snapIndex?: number; sheetRole?: SheetTimingRole }) => void
  onUpdatePaperTrack: (paperTrack: string, updates: Parameters<typeof updatePaperTrack>[2]) => void
  onDeleteOverlayPaperTrack: (paperTrack: string) => void | Promise<void>
  stackGuideInsertTool: StackGuideInsertTool | null
  onStackGuideInsertToolConsumed: () => void
  onClearSelection: () => void
  onAnnotation: (stroke: AnnotationStroke) => void
  onTextAnnotation: (annotation: AnnotationText) => void
  onSelectTextAnnotation: (annotationId: string) => void
  onEditTextAnnotation: (annotationId: string) => void
  onUpdateTextAnnotation: (annotationId: string, updates: TextAnnotationUpdate) => void
  onCommitTextAnnotation: (annotationId: string, text: string) => void
  onCancelTextAnnotation: (annotationId: string) => void
  onCommitFocusedTextAnnotationDraft: () => void
  onCalibrationPoints: (page: SheetPage, points: SheetCalibrationPointPair[], enabled?: boolean) => void
}) {
  const [draftStroke, setDraftStroke] = useState<AnnotationStroke | null>(null)
  const [draftRange, setDraftRange] = useState<{ pointerId: number; anchor: SheetHit; focus: SheetHit; moved: boolean } | null>(null)
  const [hoveredHit, setHoveredHit] = useState<SheetHit | null>(null)
  const [hoverPreviewAnchor, setHoverPreviewAnchor] = useState<{ x: number; y: number } | null>(null)
  const [textCursorBadge, setTextCursorBadge] = useState<{ pageId: string; x: number; y: number } | null>(null)
  const [contextMenu, setContextMenu] = useState<SheetContextMenuState | null>(null)
  const [paperTrackHeaderMenu, setPaperTrackHeaderMenu] = useState<PaperTrackHeaderMenuState | null>(null)
  const [overlayPaperTrackMenu, setOverlayPaperTrackMenu] = useState<OverlayPaperTrackMenuState | null>(null)
  const [stackGuideHeaderMenu, setStackGuideHeaderMenu] = useState<StackGuideHeaderMenuState | null>(null)
  const [stackGuideInsertRequest, setStackGuideInsertRequest] = useState<StackGuideInsertRequest | null>(null)
  const [stackGuideDropPreview, setStackGuideDropPreview] = useState<StackGuideDropPreviewState | null>(null)
  const [paperTrackEditor, setPaperTrackEditor] = useState<PaperTrackEditorState | null>(null)
  const [overlayTrackDrag, setOverlayTrackDrag] = useState<OverlayPaperTrackDrag | null>(null)
  const [timelineEventDrag, setTimelineEventDrag] = useState<{ pointerId: number; sourceHit: SheetHit; currentHit: SheetHit | null; startX: number; startY: number; moved: boolean } | null>(null)
  const [pendingTimelineEventDrag, setPendingTimelineEventDrag] = useState<{ pointerId: number; sourceHit: SheetHit; startX: number; startY: number; ready: boolean } | null>(null)
  const [activeOverlayPaperTrack, setActiveOverlayPaperTrack] = useState<string | null>(null)
  const [draftCalibration, setDraftCalibration] = useState<{ pageId: string; points: SheetCalibrationPointPair[] } | null>(null)
  const [spacePanReady, setSpacePanReady] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  const spacePanReadyRef = useRef(false)
  const panningRef = useRef(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const sheetSvgRefs = useRef<Record<string, SVGSVGElement | null>>({})
  const activePageIndexRef = useRef(props.activePageIndex)
  const hoveredHitSignatureRef = useRef<string | null>(null)
  const hoveredHitHasPreviewRef = useRef(false)
  const hoverPreviewFrameRef = useRef<number | null>(null)
  const pendingHoverPreviewAnchorRef = useRef<{ x: number; y: number } | null>(null)
  const handledScrollRequestIdRef = useRef<number | null>(null)
  const previousOverlayTrackNamesRef = useRef<Set<string>>(new Set())
  const timelineEventLongPressTimerRef = useRef<number | null>(null)
  const stackGuideInsertRequestIdRef = useRef(0)
  const onStatusHint = props.onStatusHint

  useEffect(() => {
    hoveredHitSignatureRef.current = null
    hoveredHitHasPreviewRef.current = false
  }, [props.project])
  useEffect(() => () => {
    onStatusHint('sheet-hover', null)
    onStatusHint('sheet-drop', null)
    onStatusHint('sheet-drag', null)
    onStatusHint('overlay-paper-track', null)
  }, [onStatusHint])
  useEffect(() => {
    const clearDropStatus = () => onStatusHint('sheet-drop', null)
    window.addEventListener('dragend', clearDropStatus)
    window.addEventListener('drop', clearDropStatus)
    return () => {
      window.removeEventListener('dragend', clearDropStatus)
      window.removeEventListener('drop', clearDropStatus)
    }
  }, [onStatusHint])
  const hasActiveSheetInteraction = Boolean(draftStroke || draftRange || timelineEventDrag || pendingTimelineEventDrag || isPanning)
  const zoom = props.zoom
  const setZoom = props.setZoom
  const sheetViewLayout = getSheetViewLayout(props.template)
  const isContinuousCanvas = sheetViewLayout.surface?.type === 'continuous-canvas'
  const displayFrameStart = logicalSheetDisplayFrameStart(props.project.logicalSheet)
  const displayDurationFrames = logicalSheetDisplayDurationFrames(props.project.logicalSheet)
  const displayFrameEnd = logicalSheetDisplayFrameEnd(props.project.logicalSheet)
  const officialFrameEnd = logicalSheetOfficialFrameEnd(props.project.logicalSheet)
  const templateTrackNames = useMemo(
    () => templatePaperTracks(props.project).map(track => track.paperTrack),
    [props.project],
  )
  const sheetPageSize = useMemo(
    () => resolveSheetTemplatePageSize(props.template, displayDurationFrames, {
      paperTracks: templateTrackNames,
      layoutOverrides: props.sheetView.layoutOverrides,
    }),
    [props.template, displayDurationFrames, props.sheetView.layoutOverrides, templateTrackNames],
  )
  const sheetPageWidth = Math.round(sheetPageSize.widthPx * zoom)
  const sheetPageHeight = Math.round(sheetPageSize.heightPx * zoom)
  const overlayTracks = overlayPaperTracks(props.project)
  const sheetRenderModelContext = useMemo(
    () => createSheetRenderModelContext(props.project, props.template, {
      cutGroup: { activeCutId: props.activeCutId, cuts: props.projectCuts },
    }),
    [props.activeCutId, props.project, props.projectCuts, props.template],
  )
  const rangeTrackOrder = (role: SheetTimingRole) => paperTrackOrderForRole(props.project, role)
  const rangeFromHits = (anchorHit: SheetHit, focusHit: SheetHit): SheetRangeSelection | null => {
    const usesOverlayTrack = [anchorHit.paperTrack, focusHit.paperTrack].some(paperTrack =>
      props.project.logicalSheet.paperTracks.some(track => track.paperTrack === paperTrack && track.source === 'overlay'),
    )
    return rangeSelectionFromHits(props.template, anchorHit, focusHit, usesOverlayTrack ? rangeTrackOrder(sheetRoleForHit(anchorHit)) : templateTrackNames)
  }
  const visiblePages = props.sheetView.viewMode === 'single-page'
    ? props.sheetPages.filter(page => page.pageIndex === props.activePageIndex)
    : props.sheetPages
  const isCalibratingSheet = props.editMode === 'calibrate'

  useEffect(() => {
    activePageIndexRef.current = props.activePageIndex
  }, [props.activePageIndex])

  useEffect(() => {
    const previousNames = previousOverlayTrackNamesRef.current
    const currentNames = new Set(overlayTracks.map(track => track.paperTrack))
    const addedTrack = overlayTracks.find(track => !previousNames.has(track.paperTrack))
    if (addedTrack) {
      setActiveOverlayPaperTrack(addedTrack.paperTrack)
    } else if (activeOverlayPaperTrack && !currentNames.has(activeOverlayPaperTrack)) {
      setActiveOverlayPaperTrack(null)
    }
    previousOverlayTrackNamesRef.current = currentNames
  }, [activeOverlayPaperTrack, overlayTracks])

  useEffect(() => () => {
    if (hoverPreviewFrameRef.current !== null) {
      window.cancelAnimationFrame(hoverPreviewFrameRef.current)
    }
  }, [])

  useEffect(() => {
    if (!hasActiveSheetInteraction) return
    document.body.classList.add(SHEET_INTERACTION_ACTIVE_CLASS)
    document.getSelection()?.removeAllRanges()
    return () => {
      document.body.classList.remove(SHEET_INTERACTION_ACTIVE_CLASS)
    }
  }, [hasActiveSheetInteraction])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const wheelViewport = viewport

    function handleViewportWheel(event: globalThis.WheelEvent) {
      if (!props.zoomMode && !event.ctrlKey && !event.metaKey) {
        handleNativeHorizontalWheelScroll(event, wheelViewport)
        return
      }
      const rawVerticalDelta = nativeVerticalWheelDelta(event)
      if (rawVerticalDelta === 0) return
      event.preventDefault()

      const rect = wheelViewport.getBoundingClientRect()
      const localX = event.clientX - rect.left
      const localY = event.clientY - rect.top
      const contentX = wheelViewport.scrollLeft + localX
      const contentY = wheelViewport.scrollTop + localY
      const factor = rawVerticalDelta < 0 ? SHEET_ZOOM_WHEEL_FACTOR : 1 / SHEET_ZOOM_WHEEL_FACTOR
      const nextZoom = clampSheetZoom(zoom * factor)
      const ratio = nextZoom / zoom

      setZoom(nextZoom)
      window.requestAnimationFrame(() => {
        wheelViewport.scrollLeft = contentX * ratio - localX
        wheelViewport.scrollTop = contentY * ratio - localY
      })
    }

    viewport.addEventListener('wheel', handleViewportWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', handleViewportWheel)
  }, [props.zoomMode, setZoom, zoom])

  useLayoutEffect(() => {
    const request = props.scrollRequest
    if (!request || handledScrollRequestIdRef.current === request.requestId) return undefined
    const frameId = window.requestAnimationFrame(() => {
      const viewport = viewportRef.current
      if (!viewport) return
      const page = visiblePages.find(item => item.pageId === request.hit.pageId)
      if (!page) return
      const svg = svgForPage(page)
      if (!svg) return
      scrollSheetHitIntoView(viewport, svg, props.project, props.template, request.hit)
      handledScrollRequestIdRef.current = request.requestId
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [props.project, props.scrollRequest, props.template, visiblePages, zoom])

  useEffect(() => {
    function setSpaceReady(nextReady: boolean) {
      spacePanReadyRef.current = nextReady
      setSpacePanReady(nextReady)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.code !== 'Space' || isInteractiveKeyboardTarget(event.target)) return
      event.preventDefault()
      setSpaceReady(true)
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (event.code === 'Space') setSpaceReady(false)
    }

    function handleBlur() {
      setSpaceReady(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
    }
  }, [])

  useEffect(() => {
    if (!contextMenu && !paperTrackHeaderMenu && !overlayPaperTrackMenu && !stackGuideHeaderMenu) return
    const close = (event?: globalThis.PointerEvent) => {
      const target = event?.target
      if (target instanceof Element && target.closest('.sheetContextMenu')) return
      setContextMenu(null)
      setPaperTrackHeaderMenu(null)
      setOverlayPaperTrackMenu(null)
      setStackGuideHeaderMenu(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [contextMenu, paperTrackHeaderMenu, overlayPaperTrackMenu, stackGuideHeaderMenu])

  useEffect(() => () => {
    if (timelineEventLongPressTimerRef.current !== null) {
      window.clearTimeout(timelineEventLongPressTimerRef.current)
      timelineEventLongPressTimerRef.current = null
    }
  }, [])

  function pointFromEvent(event: PointerEvent<SVGSVGElement> | DragEvent<SVGSVGElement> | MouseEvent<SVGSVGElement>) {
    const svg = event.currentTarget
    const box = svg.getBoundingClientRect()
    return {
      x: (event.clientX - box.left) / box.width,
      y: (event.clientY - box.top) / box.height,
    }
  }

  function setActivePageIndexIfNeeded(pageIndex: number) {
    if (activePageIndexRef.current === pageIndex) return
    activePageIndexRef.current = pageIndex
    props.setActivePageIndex(pageIndex)
  }

  function svgForPage(page: SheetPage): SVGSVGElement | null {
    return sheetSvgRefs.current[page.pageId] ?? null
  }

  function pageHitFromClientPoint(clientX: number, clientY: number): { page: SheetPage; hit: SheetHit | null } | null {
    let fallback: { page: SheetPage; hit: SheetHit | null } | null = null
    for (const page of visiblePages) {
      const svg = svgForPage(page)
      if (!svg) continue
      const box = svg.getBoundingClientRect()
      const point = {
        x: (clientX - box.left) / box.width,
        y: (clientY - box.top) / box.height,
      }
      const clampedPoint = { x: clampNumber(point.x, 0, 1), y: clampNumber(point.y, 0, 1) }
      fallback ??= { page, hit: hitFromPoint(clampedPoint, page) }
      if (clientX < box.left || clientX > box.right || clientY < box.top || clientY > box.bottom) continue
      return { page, hit: hitFromPoint(point, page) }
    }
    return fallback
  }

  function dropTargetFromClientPoint(clientX: number, clientY: number): { page: SheetPage; hit: SheetHit | null } | null {
    const target = pageHitFromClientPoint(clientX, clientY)
    if (!target || target.hit?.paperTrack) return target
    if (hoveredHit?.paperTrack && hoveredHit.pageId === target.page.pageId) {
      return { page: target.page, hit: hoveredHit }
    }
    return target
  }

  function dropHitForActiveRange(hit: SheetHit | null): SheetHit | null {
    if (!rangeContainsHit(props.rangeSelection, hit)) return hit
    return rangeStartHit(props.rangeSelection) ?? hit
  }

  useEffect(() => {
    function handleAssetPointerDrop(event: Event) {
      const detail = (event as AssetPointerDropEvent).detail
      const assetIds = detail?.assetIds ?? []
      const clientX = detail?.clientX
      const clientY = detail?.clientY
      if (assetIds.length === 0 || typeof clientX !== 'number' || typeof clientY !== 'number') return

      const target = dropTargetFromClientPoint(clientX, clientY)
      if (!target?.hit?.paperTrack) return
      if (target) props.setActivePageIndex(target.page.pageIndex)
      const hit = dropHitForActiveRange(target?.hit ?? null)
      props.onDropDiagnostic({
        source: 'asset-pointer',
        type: 'drop',
        target: hit ? `${sheetRoleLabel(sheetRoleForHit(hit))} ${hit.paperTrack ?? '-'}` : 'sheet/no-hit',
        fileCount: assetIds.length,
        position: { x: clientX, y: clientY },
        details: `assetIds ${assetIds.join(', ')}`,
      })
      clearHover()
      if (hit && assetIds.length === 1) {
        props.onAssetAssign(assetIds[0], hit, { x: clientX, y: clientY })
      }
    }

    window.addEventListener(ASSET_POINTER_DROP_EVENT, handleAssetPointerDrop)
    return () => window.removeEventListener(ASSET_POINTER_DROP_EVENT, handleAssetPointerDrop)
  })

  useEffect(() => {
    function handleRegisteredCellPointerDrop(event: Event) {
      const detail = (event as CustomEvent<RegisteredCellPointerDropDetail>).detail
      const keyId = detail?.keyId ?? ''
      const clientX = detail?.clientX
      const clientY = detail?.clientY
      if (!keyId || typeof clientX !== 'number' || typeof clientY !== 'number') return

      const target = dropTargetFromClientPoint(clientX, clientY)
      if (target) props.setActivePageIndex(target.page.pageIndex)
      const hit = dropHitForActiveRange(target?.hit ?? null)
      clearHover()
      props.onRegisteredCellAssign(keyId, hit)
    }

    window.addEventListener(REGISTERED_CELL_POINTER_DROP_EVENT, handleRegisteredCellPointerDrop)
    return () => window.removeEventListener(REGISTERED_CELL_POINTER_DROP_EVENT, handleRegisteredCellPointerDrop)
  })

  function rangeStartHit(range: SheetRangeSelection | null): SheetHit | null {
    if (!isPointEventRangeForUi(range)) return null
    if (range.anchorHit.frame === range.frameStart && range.anchorHit.paperTrack) return range.anchorHit
    if (range.focusHit.frame === range.frameStart && range.focusHit.paperTrack) return range.focusHit
    const tracks = rangePaperTracks(range)
    const paperTrack = tracks[0] ?? range.paperTrack
    return paperTrack
      ? timingHitForFrame(props.template, range.role, paperTrack, range.frameStart, displayDurationFrames, displayFrameStart, rangeTrackOrder(range.role))
      : null
  }

  function lockedRangeHitFromClientPoint(clientX: number, clientY: number, anchorHit: SheetHit): { page: SheetPage; hit: SheetHit | null } | null {
    for (const page of visiblePages) {
      const svg = svgForPage(page)
      if (!svg) continue
      const box = svg.getBoundingClientRect()
      if (clientX < box.left || clientX > box.right || clientY < box.top || clientY > box.bottom) continue
      const point = {
        x: (clientX - box.left) / box.width,
        y: (clientY - box.top) / box.height,
      }
      const directHit = rangeHitFromPoint(point, page)
      if (directHit && rangeFromHits(anchorHit, directHit)) {
        return { page, hit: directHit }
      }
      return { page, hit: lockedRangeHitFromPoint(point, page, anchorHit) }
    }
    return null
  }

  function lockedRangeHitFromPoint(point: NormalizedPoint, page: SheetPage, anchorHit: SheetHit): SheetHit | null {
    const anchorRegion = props.template.regions.find(region => region.regionId === anchorHit.regionId)
    if (!anchorRegion?.grid) return null
    const flowGroupId = anchorRegion.flowGroupId ?? anchorRegion.regionId

    for (const region of props.template.regions) {
      if (region.type !== 'exposure-grid' || !region.grid) continue
      if (region.grid.role !== anchorHit.role) continue
      if ((region.flowGroupId ?? region.regionId) !== flowGroupId) continue
      const layout = resolveSheetTemplateGridLayout(props.template, region, {
        paperTracks: templateTrackNames,
        durationFrames: displayDurationFrames,
        frameOrigin: frameOriginForPageHit(props.template, page),
        layoutOverrides: props.project.sheetView.layoutOverrides,
      })
      if (!layout) continue
      const rect = layout.rect
      if (point.x < rect.x || point.x > rect.x + rect.w) continue
      if (point.y < rect.y || point.y > rect.y + rect.h) continue

      const columns = layout.columns
      const columnIndex = anchorHit.paperTrack
        ? columns.findIndex(column => column.paperTrack === anchorHit.paperTrack)
        : columns.findIndex(column => column.columnId === anchorHit.columnId)
      const column = columnIndex >= 0 ? columns[columnIndex] : null
      if (!column) continue

      const frames = layout.frames
      const localY = (point.y - rect.y) / frames.rowHeight
      const rowIndex = clampNumber(Math.floor(localY), 0, frames.rowCount - 1)
      const hit = materializePageHit(props.template, {
        regionId: region.regionId,
        role: region.grid.role,
        frame: frames.frameStart + rowIndex,
        rowIndex,
        columnIndex,
        columnId: column.columnId,
        label: column.label,
        paperTrack: column.paperTrack,
      }, page)
      if (hit.frame <= page.frameEnd && rangeFromHits(anchorHit, hit)) return hit
    }
    return null
  }

  function hasSheetDropPayload(dataTransfer: DataTransfer) {
    const types = Array.from(dataTransfer.types ?? [])
    return types.length === 0
      || types.includes(ASSET_DRAG_MIME)
      || types.includes(ASSET_MULTI_DRAG_MIME)
      || types.includes(REGISTERED_CELL_DRAG_MIME)
      || types.includes(STACK_GUIDE_DRAG_MIME)
      || Boolean(dataTransfer.getData(STACK_GUIDE_DRAG_MIME))
      || types.includes('text/plain')
      || types.includes('Files')
  }

  function dragDataTypes(dataTransfer: DataTransfer): string[] {
    return Array.from(dataTransfer.types ?? [])
  }

  function canReadDragDataType(types: string[], type: string): boolean {
    return types.length === 0 || types.includes(type)
  }

  function hasExternalFileDragPayload(dataTransfer: DataTransfer, types = dragDataTypes(dataTransfer)): boolean {
    return hasFileTransferPayload(dataTransfer)
      || types.includes('Files')
      || types.includes('text/uri-list')
      || types.includes('application/x-moz-file')
  }

  function activeAssetDragIds(): string[] {
    return (window as AssetDragWindow).__xsheetRemapAssetDragIds ?? []
  }

  function activeRegisteredCellDragKeyId(): string {
    return (window as AssetDragWindow).__xsheetRemapRegisteredCellDragKeyId ?? ''
  }

  function keyIdFromDragData(dataTransfer: DataTransfer): string {
    const types = dragDataTypes(dataTransfer)
    if (hasExternalFileDragPayload(dataTransfer, types)) return ''
    const activeKeyId = activeRegisteredCellDragKeyId()
    if (activeKeyId) return activeKeyId
    const explicitKeyId = canReadDragDataType(types, REGISTERED_CELL_DRAG_MIME)
      ? dataTransfer.getData(REGISTERED_CELL_DRAG_MIME)
      : ''
    if (explicitKeyId) return explicitKeyId
    return canReadDragDataType(types, 'text/plain')
      ? keyIdFromRegisteredCellTextDragData(dataTransfer.getData('text/plain'))
      : ''
  }

  function stackGuideLabelIdFromDragData(dataTransfer: DataTransfer): string {
    return dataTransfer.getData(STACK_GUIDE_DRAG_MIME)
  }

  function hasStackGuideDragPayload(dataTransfer: DataTransfer): boolean {
    const types = dragDataTypes(dataTransfer)
    return types.includes(STACK_GUIDE_DRAG_MIME)
      || (types.length === 0 && Boolean(dataTransfer.getData(STACK_GUIDE_DRAG_MIME)))
  }

  function setDropStatusForHit(dataTransfer: DataTransfer, hit: SheetHit | null, assetIds = assetIdsFromDragData(dataTransfer)) {
    if (!hit?.paperTrack) {
      props.onStatusHint('sheet-drop', uiText.statusHints.dropUnavailable)
      return
    }
    if (assetIds.length > 1) {
      props.onStatusHint('sheet-drop', uiText.statusHints.dropMultipleAssetsUnavailable)
      return
    }
    const target = sheetHitTargetLabel(props.project, hit)
    if (keyIdFromDragData(dataTransfer)) {
      props.onStatusHint('sheet-drop', uiText.statusHints.dropRegisteredCell(target))
    } else if (assetIds.length === 1) {
      props.onStatusHint('sheet-drop', uiText.statusHints.dropAsset(target))
    } else {
      props.onStatusHint('sheet-drop', uiText.statusHints.dropFiles(target))
    }
  }

  function assetIdsFromDragData(dataTransfer: DataTransfer): string[] {
    const types = dragDataTypes(dataTransfer)
    if (hasExternalFileDragPayload(dataTransfer, types)) return []
    const activeAssetIds = activeAssetDragIds()
    if (activeAssetIds.length > 0) return activeAssetIds
    if (keyIdFromDragData(dataTransfer)) return []
    const multiAssetIds = canReadDragDataType(types, ASSET_MULTI_DRAG_MIME)
      ? parseAssetIdsFromDragData(dataTransfer.getData(ASSET_MULTI_DRAG_MIME))
      : []
    if (multiAssetIds.length > 0) return multiAssetIds
    const explicitAssetId = canReadDragDataType(types, ASSET_DRAG_MIME)
      ? dataTransfer.getData(ASSET_DRAG_MIME)
      : ''
    if (explicitAssetId) return [explicitAssetId]
    const textAssetId = canReadDragDataType(types, 'text/plain')
      ? assetIdFromAssetTextDragData(dataTransfer.getData('text/plain'))
      : ''
    if (textAssetId) return [textAssetId]
    return []
  }

  function hitFromPoint(point: NormalizedPoint, page: SheetPage): SheetHit | null {
    const frameOrigin = frameOriginForPageHit(props.template, page)
    const hitOptions = { paperTracks: templateTrackNames, durationFrames: page.frameEnd - page.frameStart + 1, frameOrigin, layoutOverrides: props.project.sheetView.layoutOverrides }
    const localHit = overlayHitFromPoint(props.template, props.project, page, point, activeOverlayPaperTrack)
      ?? hitTestSheetTemplate(props.template, point, { ...hitOptions, role: 'cell' })
      ?? hitTestSheetTemplate(props.template, point, { ...hitOptions, role: 'action' })
    if (!localHit?.paperTrack) return null
    const hit = materializePageHit(props.template, localHit, page)
    return hit.frame <= page.frameEnd ? hit : null
  }

  function rangeHitFromPoint(point: NormalizedPoint, page: SheetPage): SheetHit | null {
    const frameOrigin = frameOriginForPageHit(props.template, page)
    const hitOptions = { paperTracks: templateTrackNames, durationFrames: page.frameEnd - page.frameStart + 1, frameOrigin, layoutOverrides: props.project.sheetView.layoutOverrides }
    const localHit = overlayHitFromPoint(props.template, props.project, page, point, activeOverlayPaperTrack)
      ?? hitTestSheetTemplate(props.template, point, { ...hitOptions, role: 'cell' })
      ?? hitTestSheetTemplate(props.template, point, { ...hitOptions, role: 'action' })
      ?? hitTestSheetTemplate(props.template, point, { ...hitOptions, role: 'sound' })
      ?? hitTestSheetTemplate(props.template, point, { ...hitOptions, role: 'camera' })
    if (!localHit) return null
    const hit = materializePageHit(props.template, localHit, page)
    return hit.frame <= page.frameEnd ? hit : null
  }

  function paperTrackHeaderHitFromPoint(point: NormalizedPoint, page: SheetPage, viewportHeightPx?: number): SheetHit | null {
    const pageSize = resolveSheetTemplatePageSize(props.template, displayDurationFrames, {
      paperTracks: templateTrackNames,
      layoutOverrides: props.project.sheetView.layoutOverrides,
    })
    const headerTopOffset = (STANDARD_A3_GRID_HEADER_TOP_OFFSET * props.template.page.heightPx) / pageSize.heightPx
    const headerHeight = (STANDARD_A3_GRID_HEADER_HEIGHT * props.template.page.heightPx) / pageSize.heightPx
    const columnHeaderHeight = Math.max(0.001, headerTopOffset - headerHeight)
    const minHitHeight = viewportHeightPx && viewportHeightPx > 0 ? 28 / viewportHeightPx : columnHeaderHeight
    const hitHeight = Math.min(headerTopOffset, Math.max(columnHeaderHeight, minHitHeight))
    const hitBottomPadding = viewportHeightPx && viewportHeightPx > 0 ? Math.min(0.0025, 4 / viewportHeightPx) : 0

    for (const region of props.template.regions) {
      if (region.type !== 'exposure-grid' || !region.grid) continue
      if (region.grid.role !== 'action' && region.grid.role !== 'cell') continue
      const layout = resolveSheetTemplateGridLayout(props.template, region, {
        paperTracks: templateTrackNames,
        durationFrames: displayDurationFrames,
        frameOrigin: frameOriginForPageHit(props.template, page),
        layoutOverrides: props.project.sheetView.layoutOverrides,
      })
      if (!layout) continue
      const rect = layout.rect
      if (point.x < rect.x || point.x > rect.x + rect.w) continue
      if (point.y < rect.y - hitHeight || point.y > rect.y + hitBottomPadding) continue

      const columns = layout.columns
      if (columns.length === 0) continue
      const columnIndex = columns.findIndex(column => point.x >= column.x && point.x <= column.x + column.w)
      if (columnIndex < 0) continue
      const column = columns[columnIndex]
      if (!column?.paperTrack) continue
      const frames = layout.frames
      const localHit: SheetHit = {
        regionId: region.regionId,
        role: region.grid.role,
        frame: frames.frameStart,
        rowIndex: 0,
        columnIndex,
        columnId: column.columnId,
        label: column.label,
        paperTrack: column.paperTrack,
      }
      return materializePageHit(props.template, localHit, page)
    }
    return null
  }

  function stackGuideHeaderInsertTargetFromPoint(point: NormalizedPoint, page: SheetPage): StackGuideInsertTarget | null {
    return stackGuideInsertTargetFromPoint(props.template, props.project, page, point)
  }

  function stackGuideDropTargetFromClientPoint(clientX: number, clientY: number): StackGuideDropPreviewState | null {
    let fallback: StackGuideDropPreviewState | null = null
    for (const page of visiblePages) {
      const svg = svgForPage(page)
      if (!svg) continue
      const box = svg.getBoundingClientRect()
      const target = stackGuidePlacementTargetFromPointer(svg, clientX, clientY, props.project, props.template, page)
      if (!target) continue
      const preview: StackGuideDropPreviewState = {
        pageId: target.pageId,
        regionId: target.regionId,
        gapIndex: target.gapIndex,
        insertAfterPaperTrack: target.insertAfterPaperTrack,
        displayRole: target.displayRole,
        snapIndex: target.snapIndex,
      }
      fallback ??= preview
      if (clientX >= box.left && clientX <= box.right && clientY >= box.top && clientY <= box.bottom) {
        return preview
      }
    }
    return fallback
  }

  function updateStackGuideDropPreview(labelId: string | undefined, clientX: number, clientY: number) {
    const target = stackGuideDropTargetFromClientPoint(clientX, clientY)
    setStackGuideDropPreview(target ? { ...target, labelId } : null)
    if (target) setActivePageIndexIfNeeded(visiblePages.find(page => page.pageId === target.pageId)?.pageIndex ?? props.activePageIndex)
    return target
  }

  function moveStackGuideLabelFromDragData(dataTransfer: DataTransfer, clientX: number, clientY: number): boolean {
    const labelId = stackGuideLabelIdFromDragData(dataTransfer)
    if (!labelId) return false
    const label = props.project.stackGuideLabels.find(item => item.labelId === labelId)
    if (!label) return true
    const target = stackGuideDropTargetFromClientPoint(clientX, clientY)
    if (!target) return true
    const page = visiblePages.find(item => item.pageId === target.pageId)
    if (!page) return true
    const update = stackGuidePlacementUpdateFromPointer(svgForPage(page), clientX, clientY, props.project, props.template, page, label)
    if (update) {
      props.onUpdateStackGuideLabel(label.labelId, update)
    }
    setStackGuideDropPreview(null)
    return true
  }

  function updateHover(hit: SheetHit | null, anchor?: { x: number; y: number }) {
    const signature = hoverHitSignature(hit)
    if (hoveredHitSignatureRef.current !== signature) {
      hoveredHitSignatureRef.current = signature
      const hasPreview = Boolean(hit && cellAssetPreviewItemsForHit(props.project, hit).length > 0)
      hoveredHitHasPreviewRef.current = hasPreview
      setHoveredHit(hit)
      props.onStatusHint('sheet-hover', hit ? sheetHitStatusHint(props.project, hit) : null)
    }
    scheduleHoverPreviewAnchor(hoveredHitHasPreviewRef.current, anchor)
  }

  function scheduleHoverPreviewAnchor(hasPreview: boolean, anchor?: { x: number; y: number }) {
    if (!hasPreview || !anchor) {
      pendingHoverPreviewAnchorRef.current = null
      if (hoverPreviewFrameRef.current !== null) {
        window.cancelAnimationFrame(hoverPreviewFrameRef.current)
        hoverPreviewFrameRef.current = null
      }
      setHoverPreviewAnchor(null)
      return
    }

    pendingHoverPreviewAnchorRef.current = anchor
    if (hoverPreviewFrameRef.current !== null) return
    hoverPreviewFrameRef.current = window.requestAnimationFrame(() => {
      hoverPreviewFrameRef.current = null
      setHoverPreviewAnchor(pendingHoverPreviewAnchorRef.current)
    })
  }

  function hoverHitSignature(hit: SheetHit | null): string | null {
    if (!hit) return null
    return [
      hit.pageId,
      hit.regionId,
      hit.role,
      hit.frame,
      hit.paperTrack ?? '',
      hit.columnId ?? '',
    ].join('|')
  }

  function clearHover() {
    updateHover(null)
    setTextCursorBadge(null)
  }

  function clearTimelineEventLongPressTimer() {
    if (timelineEventLongPressTimerRef.current === null) return
    window.clearTimeout(timelineEventLongPressTimerRef.current)
    timelineEventLongPressTimerRef.current = null
  }

  function clearPendingTimelineEventDrag() {
    clearTimelineEventLongPressTimer()
    setPendingTimelineEventDrag(null)
  }

  function selectPaperTrackColumn(hit: SheetHit) {
    if (!hit.paperTrack || (hit.role !== 'action' && hit.role !== 'cell')) return
    const startHit = timingHitForFrame(props.template, hit.role, hit.paperTrack, displayFrameStart, displayDurationFrames, displayFrameStart, templateTrackNames)
    const endHit = timingHitForFrame(props.template, hit.role, hit.paperTrack, displayFrameEnd, displayDurationFrames, displayFrameStart, templateTrackNames)
    const range = startHit && endHit ? rangeFromHits(startHit, endHit) : null
    if (range) {
      props.onRangeSelect(range)
    } else {
      props.onCellClick(hit)
    }
  }

  function timelineMoveTargetFromClientPoint(clientX: number, clientY: number, sourceHit: SheetHit): { page: SheetPage; hit: SheetHit | null } | null {
    const target = dropTargetFromClientPoint(clientX, clientY)
    if (target) setActivePageIndexIfNeeded(target.page.pageIndex)
    const targetHit = target?.hit?.paperTrack && sheetRoleForHit(target.hit) === sheetRoleForHit(sourceHit)
      ? target.hit
      : null
    return target ? { page: target.page, hit: targetHit } : null
  }

  function beginTimelineEventDrag(pointerId: number, sourceHit: SheetHit, startX: number, startY: number) {
    clearPendingTimelineEventDrag()
    clearHover()
    setContextMenu(null)
    setPaperTrackHeaderMenu(null)
    setOverlayPaperTrackMenu(null)
    setStackGuideHeaderMenu(null)
    setTimelineEventDrag({
      pointerId,
      sourceHit,
      currentHit: sourceHit,
      startX,
      startY,
      moved: false,
    })
    props.onStatusHint('sheet-drag', uiText.statusHints.eventDragging)
  }

  function updateTimelineEventDragFromClient(pointerId: number, clientX: number, clientY: number, viewport: HTMLElement | null) {
    if (!timelineEventDrag || timelineEventDrag.pointerId !== pointerId) return false
    autoScrollViewportForDrag({ clientX, clientY }, viewport)
    const target = timelineMoveTargetFromClientPoint(clientX, clientY, timelineEventDrag.sourceHit)
    const targetHit = target?.hit ?? null
    updateHover(targetHit, targetHit ? { x: clientX, y: clientY } : undefined)
    const movedByPointer = Math.abs(clientX - timelineEventDrag.startX) >= 3 || Math.abs(clientY - timelineEventDrag.startY) >= 3
    setTimelineEventDrag(current => current && current.pointerId === pointerId
      ? {
          ...current,
          currentHit: targetHit,
          moved: current.moved || movedByPointer || Boolean(targetHit && !sameSheetHitCell(targetHit, current.sourceHit)),
        }
      : current)
    return true
  }

  function updateDraftRangeFromClientPoint(pointerId: number, clientX: number, clientY: number, fallbackPage?: SheetPage) {
    if (!draftRange || draftRange.pointerId !== pointerId) return false
    const target = lockedRangeHitFromClientPoint(clientX, clientY, draftRange.anchor)
    if (target) setActivePageIndexIfNeeded(target.page.pageIndex)
    let hit = target?.hit ?? null
    if (!hit && fallbackPage) {
      const svg = svgForPage(fallbackPage)
      if (svg) {
        const box = svg.getBoundingClientRect()
        hit = rangeHitFromPoint({
          x: (clientX - box.left) / box.width,
          y: (clientY - box.top) / box.height,
        }, fallbackPage)
      }
    }
    const range = hit ? rangeFromHits(draftRange.anchor, hit) : null
    if (hit && range) {
      const focusHit = hit
      setDraftRange(current => current
        ? {
            ...current,
            focus: focusHit,
            moved: current.moved
              || focusHit.frame !== current.anchor.frame
              || focusHit.paperTrack !== current.anchor.paperTrack
              || focusHit.role !== current.anchor.role,
          }
        : current)
    }
    return true
  }

  function beginDraftRangeFromTimelineEvent(pointerId: number, sourceHit: SheetHit, clientX: number, clientY: number) {
    const target = lockedRangeHitFromClientPoint(clientX, clientY, sourceHit)
    if (target) setActivePageIndexIfNeeded(target.page.pageIndex)
    const focusHit = target?.hit && rangeFromHits(sourceHit, target.hit)
      ? target.hit
      : sourceHit
    setDraftRange({
      pointerId,
      anchor: sourceHit,
      focus: focusHit,
      moved: !sameSheetHitCell(sourceHit, focusHit),
    })
    props.onStatusHint('sheet-drag', uiText.statusHints.rangeDragging)
    clearPendingTimelineEventDrag()
  }

  function commitDraftRangeFromPointer(pointerId: number, clientX: number, clientY: number) {
    if (!draftRange || draftRange.pointerId !== pointerId) return false
    const target = lockedRangeHitFromClientPoint(clientX, clientY, draftRange.anchor)
    const focusHit = target?.hit && rangeFromHits(draftRange.anchor, target.hit)
      ? target.hit
      : draftRange.focus
    const range = rangeFromHits(draftRange.anchor, focusHit)
    const moved = draftRange.moved
      || focusHit.frame !== draftRange.anchor.frame
      || focusHit.paperTrack !== draftRange.anchor.paperTrack
      || focusHit.role !== draftRange.anchor.role
    if (range && (moved || !range.paperTrack)) {
      props.onRangeSelect(range)
    } else if (draftRange.anchor.paperTrack) {
      props.onCellClick(draftRange.anchor)
    } else if (range) {
      props.onRangeSelect(range)
    }
    setDraftRange(null)
    props.onStatusHint('sheet-drag', null)
    return true
  }

  function handlePointerDown(event: PointerEvent<SVGSVGElement>, page: SheetPage) {
    if (beginViewportPan(event, event.currentTarget.closest<HTMLElement>('.sheetViewport'))) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    setContextMenu(null)
    setPaperTrackHeaderMenu(null)
    setOverlayPaperTrackMenu(null)
    setStackGuideHeaderMenu(null)
    props.setActivePageIndex(page.pageIndex)
    const point = pointFromEvent(event)
    if (props.editMode === 'calibrate') {
      return
    }
    if (props.editMode === 'text') {
      if (props.editingTextAnnotationId) {
        props.onCommitFocusedTextAnnotationDraft()
        return
      }
      props.onTextAnnotation({
        annotationId: nextAnnotationId(props.project.annotations),
        pageId: page.pageId,
        kind: 'text',
        text: '',
        x: clampNumber(point.x, 0, 1),
        y: clampNumber(point.y, 0, 1),
        color: props.penColor,
        fontSizePx: props.textFontSizePx,
        coordinateSpace: 'view-surface',
        anchor: {
          kind: 'view-surface',
          templateId: props.template.templateId,
          pageId: page.pageId,
          surfaceSize: sheetPageSize,
        },
      })
      return
    }
    if (props.editMode === 'pen' || props.editMode === 'eraser') {
      const tool = props.editMode
      event.currentTarget.setPointerCapture(event.pointerId)
      setDraftStroke({
        annotationId: nextAnnotationId(props.project.annotations),
        pageId: page.pageId,
        tool,
        color: tool === 'pen' ? props.penColor : '#2f7f6a',
        width: tool === 'pen' ? props.penWidth : props.eraserWidth,
        coordinateSpace: 'view-surface',
        anchor: {
          kind: 'view-surface',
          templateId: props.template.templateId,
          pageId: page.pageId,
          surfaceSize: sheetPageSize,
        },
        points: [{ ...point, pressure: event.pressure || 1 }],
      })
      return
    }
    const headerHit = paperTrackHeaderHitFromPoint(point, page, event.currentTarget.getBoundingClientRect().height)
    if (headerHit?.paperTrack) {
      clearHover()
      selectPaperTrackColumn(headerHit)
      return
    }
    const hit = rangeHitFromPoint(point, page)
    if (hit) {
      event.currentTarget.setPointerCapture?.(event.pointerId)
      setDraftRange({ pointerId: event.pointerId, anchor: hit, focus: hit, moved: false })
      props.onStatusHint('sheet-drag', uiText.statusHints.rangeDragging)
      return
    }
    props.onClearSelection()
  }

  function timelineEventHitForPage(
    timelineEvent: { paperTrack: string; frame: number; sheetRole?: SheetTimingRole },
    page: SheetPage,
  ): SheetHit | null {
    const role = sheetTimingRoleForEvent(timelineEvent)
    const track = props.project.logicalSheet.paperTracks.find(item => item.paperTrack === timelineEvent.paperTrack)
    if (track?.source === 'overlay') return overlayHitForFrame(props.template, props.project, track, timelineEvent.frame, page, role)
    const hit = timingHitForFrame(props.template, role, timelineEvent.paperTrack, timelineEvent.frame, displayDurationFrames, displayFrameStart, templateTrackNames)
    return hit?.pageId === page.pageId ? hit : null
  }

  function handleTimelineEventPointerDown(
    event: PointerEvent<SVGGElement>,
    timelineEvent: { paperTrack: string; frame: number; sheetRole?: SheetTimingRole },
    page: SheetPage,
  ) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (props.editMode === 'pen' || props.editMode === 'eraser' || props.editMode === 'calibrate') return
    if (spacePanReadyRef.current) return
    const sourceHit = timelineEventHitForPage(timelineEvent, page)
    if (!sourceHit?.paperTrack) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    clearHover()
    setContextMenu(null)
    setPaperTrackHeaderMenu(null)
    setStackGuideHeaderMenu(null)
    props.setActivePageIndex(page.pageIndex)
    if (event.altKey) {
      beginTimelineEventDrag(event.pointerId, sourceHit, event.clientX, event.clientY)
      return
    }
    clearTimelineEventLongPressTimer()
    setPendingTimelineEventDrag({
      pointerId: event.pointerId,
      sourceHit,
      startX: event.clientX,
      startY: event.clientY,
      ready: false,
    })
    timelineEventLongPressTimerRef.current = window.setTimeout(() => {
      timelineEventLongPressTimerRef.current = null
      setPendingTimelineEventDrag(current => current && current.pointerId === event.pointerId
        ? { ...current, ready: true }
        : current)
    }, TIMELINE_EVENT_LONG_PRESS_MS)
  }

  function handleTimelineEventPointerMove(event: PointerEvent<SVGGElement>) {
    const handlesThisPointer = (draftRange && draftRange.pointerId === event.pointerId)
      || (pendingTimelineEventDrag && pendingTimelineEventDrag.pointerId === event.pointerId)
      || (timelineEventDrag && timelineEventDrag.pointerId === event.pointerId)
    if (!handlesThisPointer) return
    event.preventDefault()
    event.stopPropagation()
    const viewport = event.currentTarget.closest<HTMLElement>('.sheetViewport')
    if (draftRange && draftRange.pointerId === event.pointerId) {
      autoScrollViewportForDrag(event, viewport)
      updateDraftRangeFromClientPoint(event.pointerId, event.clientX, event.clientY)
      return
    }
    if (pendingTimelineEventDrag && pendingTimelineEventDrag.pointerId === event.pointerId) {
      const movedByPointer = Math.abs(event.clientX - pendingTimelineEventDrag.startX) >= TIMELINE_EVENT_DRAG_THRESHOLD_PX
        || Math.abs(event.clientY - pendingTimelineEventDrag.startY) >= TIMELINE_EVENT_DRAG_THRESHOLD_PX
      if (!pendingTimelineEventDrag.ready && movedByPointer) {
        autoScrollViewportForDrag(event, viewport)
        beginDraftRangeFromTimelineEvent(event.pointerId, pendingTimelineEventDrag.sourceHit, event.clientX, event.clientY)
        return
      }
      if (pendingTimelineEventDrag.ready) {
        autoScrollViewportForDrag(event, viewport)
        const target = timelineMoveTargetFromClientPoint(event.clientX, event.clientY, pendingTimelineEventDrag.sourceHit)
        const targetHit = target?.hit ?? null
        updateHover(targetHit, targetHit ? { x: event.clientX, y: event.clientY } : undefined)
        const moved = movedByPointer || Boolean(targetHit && !sameSheetHitCell(targetHit, pendingTimelineEventDrag.sourceHit))
        const nextDrag = {
          pointerId: event.pointerId,
          sourceHit: pendingTimelineEventDrag.sourceHit,
          currentHit: targetHit,
          startX: pendingTimelineEventDrag.startX,
          startY: pendingTimelineEventDrag.startY,
          moved,
        }
        clearPendingTimelineEventDrag()
        setTimelineEventDrag(nextDrag)
        props.onStatusHint('sheet-drag', uiText.statusHints.eventDragging)
        return
      }
      return
    }
    updateTimelineEventDragFromClient(event.pointerId, event.clientX, event.clientY, viewport)
  }

  function handleTimelineEventPointerUp(event: PointerEvent<SVGGElement>) {
    if (draftRange && draftRange.pointerId === event.pointerId) {
      event.preventDefault()
      event.stopPropagation()
      commitDraftRangeFromPointer(event.pointerId, event.clientX, event.clientY)
      return
    }
    if (pendingTimelineEventDrag && pendingTimelineEventDrag.pointerId === event.pointerId) {
      event.preventDefault()
      event.stopPropagation()
      const sourceHit = pendingTimelineEventDrag.sourceHit
      clearPendingTimelineEventDrag()
      props.onCellClick(sourceHit)
      return
    }
    if (!timelineEventDrag || timelineEventDrag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    const current = timelineEventDrag
    setTimelineEventDrag(null)
    props.onStatusHint('sheet-drag', null)
    clearHover()
    const target = dropTargetFromClientPoint(event.clientX, event.clientY)
    const releaseHit = target?.hit?.paperTrack && sheetRoleForHit(target.hit) === sheetRoleForHit(current.sourceHit)
      ? target.hit
      : current.currentHit
    if ((current.moved || Boolean(releaseHit && !sameSheetHitCell(releaseHit, current.sourceHit))) && releaseHit?.paperTrack) {
      props.onMoveTimelineEvent(current.sourceHit, releaseHit)
      return
    }
    props.onCellClick(current.sourceHit)
  }

  function handleTimelineEventPointerCancel(event: PointerEvent<SVGGElement>) {
    if (draftRange && draftRange.pointerId === event.pointerId) {
      event.preventDefault()
      event.stopPropagation()
      setDraftRange(null)
      props.onStatusHint('sheet-drag', null)
      return
    }
    if (pendingTimelineEventDrag && pendingTimelineEventDrag.pointerId === event.pointerId) {
      event.preventDefault()
      event.stopPropagation()
      clearPendingTimelineEventDrag()
      return
    }
    if (!timelineEventDrag || timelineEventDrag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    setTimelineEventDrag(null)
    props.onStatusHint('sheet-drag', null)
    clearHover()
  }

  function calibrationPointsForPage(page: SheetPage, settings: SheetImageSettings): SheetCalibrationPointPair[] {
    return draftCalibration?.pageId === page.pageId ? draftCalibration.points : calibrationPointsForSettings(settings, props.template)
  }

  function handleCalibrationHandlePointerDown(
    event: PointerEvent<SVGElement>,
    page: SheetPage,
    settings: SheetImageSettings,
    pointIndex: number,
    pointKind: CalibrationPointKind,
  ) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    props.setActivePageIndex(page.pageIndex)
    const svg = event.currentTarget.ownerSVGElement
    if (!svg) return
    const pointerId = event.pointerId
    const basePoints = calibrationPointsForPage(page, settings)
    let latestPoints = basePoints

    const updateFromClient = (clientX: number, clientY: number) => {
      const box = svg.getBoundingClientRect()
      const viewportPoint = {
        x: (clientX - box.left) / box.width,
        y: (clientY - box.top) / box.height,
      }
      latestPoints = basePoints.map((point, index) => {
        if (index !== pointIndex) return point
        return pointKind === 'source'
          ? { ...point, source: viewportToRawImagePoint(viewportPoint, settings) }
          : { ...point, target: clampPoint(viewportPoint) }
      })
      setDraftCalibration({ pageId: page.pageId, points: latestPoints })
    }

    const handleMove = (nextEvent: globalThis.PointerEvent) => {
      if (nextEvent.pointerId !== pointerId) return
      updateFromClient(nextEvent.clientX, nextEvent.clientY)
    }
    const handleStop = (nextEvent: globalThis.PointerEvent) => {
      if (nextEvent.pointerId !== pointerId) return
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleStop)
      window.removeEventListener('pointercancel', handleStop)
      props.onCalibrationPoints(page, latestPoints, false)
      setDraftCalibration(null)
    }

    event.currentTarget.setPointerCapture?.(pointerId)
    updateFromClient(event.clientX, event.clientY)
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleStop)
    window.addEventListener('pointercancel', handleStop)
  }

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    if (panningRef.current) return
    const page = props.sheetPages.find(page => page.pageId === event.currentTarget.dataset.pageId)
    const viewport = event.currentTarget.closest<HTMLElement>('.sheetViewport')
    if (props.editMode === 'text' && page && !props.editingTextAnnotationId) {
      const box = event.currentTarget.getBoundingClientRect()
      setTextCursorBadge({
        pageId: page.pageId,
        x: clampNumber(event.clientX - box.left, 0, box.width),
        y: clampNumber(event.clientY - box.top, 0, box.height),
      })
    } else if (textCursorBadge) {
      setTextCursorBadge(null)
    }
    if (draftRange && draftRange.pointerId === event.pointerId) {
      updateDraftRangeFromClientPoint(event.pointerId, event.clientX, event.clientY, page)
      return
    }
    if (pendingTimelineEventDrag && pendingTimelineEventDrag.pointerId === event.pointerId) {
      event.preventDefault()
      const movedByPointer = Math.abs(event.clientX - pendingTimelineEventDrag.startX) >= TIMELINE_EVENT_DRAG_THRESHOLD_PX
        || Math.abs(event.clientY - pendingTimelineEventDrag.startY) >= TIMELINE_EVENT_DRAG_THRESHOLD_PX
      if (!pendingTimelineEventDrag.ready && movedByPointer) {
        autoScrollViewportForDrag(event, viewport)
        beginDraftRangeFromTimelineEvent(event.pointerId, pendingTimelineEventDrag.sourceHit, event.clientX, event.clientY)
        return
      }
      if (pendingTimelineEventDrag.ready) {
        autoScrollViewportForDrag(event, viewport)
        const target = timelineMoveTargetFromClientPoint(event.clientX, event.clientY, pendingTimelineEventDrag.sourceHit)
        const targetHit = target?.hit ?? null
        updateHover(targetHit, targetHit ? { x: event.clientX, y: event.clientY } : undefined)
        const moved = movedByPointer || Boolean(targetHit && !sameSheetHitCell(targetHit, pendingTimelineEventDrag.sourceHit))
        setTimelineEventDrag({
          pointerId: event.pointerId,
          sourceHit: pendingTimelineEventDrag.sourceHit,
          currentHit: targetHit,
          startX: pendingTimelineEventDrag.startX,
          startY: pendingTimelineEventDrag.startY,
          moved,
        })
        clearPendingTimelineEventDrag()
        return
      }
      return
    }
    if (timelineEventDrag && timelineEventDrag.pointerId === event.pointerId) {
      event.preventDefault()
      updateTimelineEventDragFromClient(event.pointerId, event.clientX, event.clientY, viewport)
      return
    }
    if (draftStroke) {
      const point = pointFromEvent(event)
      setDraftStroke(current => current ? { ...current, points: [...current.points, { ...point, pressure: event.pressure || 1 }] } : current)
      return
    }
    if (page && props.editMode !== 'pen' && props.editMode !== 'eraser' && props.editMode !== 'calibrate') {
      const hit = hitFromPoint(pointFromEvent(event), page)
      updateHover(hit, { x: event.clientX, y: event.clientY })
    }
  }

  function handleContextMenu(event: MouseEvent<SVGSVGElement>, page: SheetPage) {
    event.preventDefault()
    event.stopPropagation()
    props.setActivePageIndex(page.pageIndex)
    const point = pointFromEvent(event)
    const stackGuideTarget = stackGuideHeaderInsertTargetFromPoint(point, page)
    if (stackGuideTarget) {
      clearHover()
      setContextMenu(null)
      setPaperTrackHeaderMenu(null)
      setOverlayPaperTrackMenu(null)
      setStackGuideHeaderMenu({
        ...stackGuideTarget,
        x: event.clientX,
        y: event.clientY,
      })
      return
    }
    const headerHit = paperTrackHeaderHitFromPoint(point, page, event.currentTarget.getBoundingClientRect().height)
    if (headerHit?.paperTrack) {
      clearHover()
      setContextMenu(null)
      setOverlayPaperTrackMenu(null)
      setStackGuideHeaderMenu(null)
      const sheetRole = sheetRoleForHit(headerHit)
      setPaperTrackHeaderMenu({
        x: event.clientX,
        y: event.clientY,
        hit: headerHit,
        sheetRole,
        snapIndex: overlaySnapIndexFromPoint(props.template, props.project, point, sheetRole),
      })
      return
    }
    const hit = hitFromPoint(point, page)
    if (hit?.paperTrack && !rangeContainsHit(props.rangeSelection, hit)) props.onCellSelect(hit)
    clearHover()
    const sheetRole = hit ? sheetRoleForHit(hit) : 'cell'
    const snapIndex = overlaySnapIndexFromPoint(props.template, props.project, point, sheetRole)
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      hit,
      snapIndex,
      sheetRole,
      insertAfterPaperTrack: hit?.paperTrack,
    })
    setPaperTrackHeaderMenu(null)
    setOverlayPaperTrackMenu(null)
    setStackGuideHeaderMenu(null)
  }

  function runContextMenuAction(action: () => void) {
    action()
    setContextMenu(null)
  }

  function runPaperTrackHeaderMenuAction(action: () => void) {
    action()
    setPaperTrackHeaderMenu(null)
  }

  function runOverlayPaperTrackMenuAction(action: () => void | Promise<void>) {
    void action()
    setOverlayPaperTrackMenu(null)
  }

  function runStackGuideHeaderMenuAction(action: () => void) {
    action()
    setStackGuideHeaderMenu(null)
  }

  function requestStackGuideInsert(target: StackGuideInsertTarget, mode: StackGuideInsertTool) {
    stackGuideInsertRequestIdRef.current += 1
    setStackGuideInsertRequest({
      ...target,
      requestId: stackGuideInsertRequestIdRef.current,
      mode,
    })
  }

  function openPaperTrackRenameEditor(
    paperTrack: string,
    input: { x: number; y: number; sheetRole: SheetTimingRole; snapIndex?: number },
  ) {
    const track = props.project.logicalSheet.paperTracks.find(item => item.paperTrack === paperTrack)
    if (!track) return
    const isOverlay = track.source === 'overlay'
    setPaperTrackEditor({
      x: input.x,
      y: input.y,
      mode: 'rename',
      initialName: track.paperTrack,
      isOverlay,
      paperTrack: track.paperTrack,
      snapIndex: input.snapIndex,
      sheetRole: input.sheetRole,
      exportAfterPaperTrack: isOverlay
        ? exportPreviousPaperTrackName(props.project.logicalSheet.paperTracks, track.paperTrack)
        : undefined,
    })
    setContextMenu(null)
    setPaperTrackHeaderMenu(null)
    setOverlayPaperTrackMenu(null)
    setStackGuideHeaderMenu(null)
  }

  function openAddOverlayPaperTrackEditor(input: { x: number; y: number; insertAfterPaperTrack?: string; snapIndex: number; sheetRole: SheetTimingRole }) {
    setPaperTrackEditor({
      x: input.x,
      y: input.y,
      mode: 'add',
      initialName: nextOverlayTrackNameForUi(props.project),
      isOverlay: true,
      snapIndex: input.snapIndex,
      sheetRole: input.sheetRole,
      exportAfterPaperTrack: defaultExportAfterTrackForInsertAfter(props.project.logicalSheet.paperTracks, input.insertAfterPaperTrack),
    })
    setContextMenu(null)
    setPaperTrackHeaderMenu(null)
    setOverlayPaperTrackMenu(null)
    setStackGuideHeaderMenu(null)
  }

  function openOverlayPaperTrackEditor(track: PaperTrack, position: { x: number; y: number }) {
    setPaperTrackEditor({
      x: position.x,
      y: position.y,
      mode: 'rename',
      initialName: track.paperTrack,
      isOverlay: true,
      paperTrack: track.paperTrack,
      snapIndex: track.viewPlacement?.snapIndex ?? 0,
      sheetRole: track.viewPlacement?.sheetRole ?? 'cell',
      exportAfterPaperTrack: exportPreviousPaperTrackName(props.project.logicalSheet.paperTracks, track.paperTrack),
    })
    setContextMenu(null)
    setPaperTrackHeaderMenu(null)
    setOverlayPaperTrackMenu(null)
    setStackGuideHeaderMenu(null)
  }

  function openOverlayPaperTrackMenu(track: PaperTrack, position: { x: number; y: number }) {
    setOverlayPaperTrackMenu({
      x: position.x,
      y: position.y,
      paperTrack: track.paperTrack,
    })
    setContextMenu(null)
    setPaperTrackHeaderMenu(null)
    setStackGuideHeaderMenu(null)
  }

  function submitPaperTrackEditor(name: string, exportAfterPaperTrack?: string) {
    if (!paperTrackEditor) return
    const trimmedName = name.trim()
    if (!trimmedName) return
    const exportPlacement = paperTrackEditor.isOverlay
      ? overlayExportPlacementAfterTrack(props.project.logicalSheet.paperTracks, exportAfterPaperTrack, paperTrackEditor.paperTrack)
      : null
    if (paperTrackEditor.mode === 'add') {
      props.onAddOverlayPaperTrack({
        paperTrack: trimmedName,
        insertAfterPaperTrack: exportPlacement?.insertAfterPaperTrack,
        orderInGap: exportPlacement?.orderInGap,
        snapIndex: paperTrackEditor.snapIndex,
        sheetRole: paperTrackEditor.sheetRole,
      })
    } else if (paperTrackEditor.paperTrack) {
      props.onUpdatePaperTrack(paperTrackEditor.paperTrack, {
        paperTrack: trimmedName,
        label: trimmedName,
        ...(paperTrackEditor.isOverlay && exportPlacement ? { exportPlacement } : {}),
      })
    }
    setPaperTrackEditor(null)
  }

  function handlePointerUp(event: PointerEvent<SVGSVGElement>) {
    if (panningRef.current) return
    if (draftRange && draftRange.pointerId === event.pointerId) {
      commitDraftRangeFromPointer(event.pointerId, event.clientX, event.clientY)
      return
    }
    if (pendingTimelineEventDrag && pendingTimelineEventDrag.pointerId === event.pointerId) {
      const sourceHit = pendingTimelineEventDrag.sourceHit
      clearPendingTimelineEventDrag()
      props.onCellClick(sourceHit)
      return
    }
    if (timelineEventDrag && timelineEventDrag.pointerId === event.pointerId) {
      const current = timelineEventDrag
      setTimelineEventDrag(null)
      props.onStatusHint('sheet-drag', null)
      clearHover()
      const target = dropTargetFromClientPoint(event.clientX, event.clientY)
      const releaseHit = target?.hit?.paperTrack && sheetRoleForHit(target.hit) === sheetRoleForHit(current.sourceHit)
        ? target.hit
        : current.currentHit
      if ((current.moved || Boolean(releaseHit && !sameSheetHitCell(releaseHit, current.sourceHit))) && releaseHit?.paperTrack) {
        props.onMoveTimelineEvent(current.sourceHit, releaseHit)
        return
      }
      props.onCellClick(current.sourceHit)
      return
    }
    if (!draftStroke) return
    if (draftStroke.tool === 'eraser') {
      props.onEraseAnnotation(draftStroke.pageId, draftStroke.points, draftStroke.width)
    } else {
      props.onAnnotation(draftStroke)
    }
    setDraftStroke(null)
  }

  async function handleDrop(event: DragEvent<SVGSVGElement>, page: SheetPage) {
    event.preventDefault()
    event.stopPropagation()
    props.onStatusHint('sheet-drop', null)
    const dataTransfer = event.dataTransfer
    props.setActivePageIndex(page.pageIndex)
    if (moveStackGuideLabelFromDragData(dataTransfer, event.clientX, event.clientY)) {
      clearHover()
      return
    }
    const point = pointFromEvent(event)
    const rawHit = hitFromPoint(point, page) ?? (hoveredHit?.pageId === page.pageId ? hoveredHit : null)
    const hit = dropHitForActiveRange(rawHit)
    props.onDropDiagnostic({
      source: 'sheet-dom',
      type: 'drop',
      target: hit ? `${sheetRoleLabel(sheetRoleForHit(hit))} ${hit.paperTrack ?? '-'}` : 'sheet/no-hit',
      fileCount: dataTransfer.files?.length ?? 0,
      position: { x: event.clientX, y: event.clientY },
      details: `types ${Array.from(dataTransfer.types ?? []).join(', ') || '-'}`,
    })
    const keyId = keyIdFromDragData(dataTransfer)
    if (keyId) {
      clearHover()
      props.onRegisteredCellAssign(keyId, hit)
      return
    }
    const assetIds = assetIdsFromDragData(dataTransfer)
    if (assetIds.length > 0) {
      clearHover()
      if (hit && assetIds.length === 1) {
        props.onAssetAssign(assetIds[0], hit, { x: event.clientX, y: event.clientY })
      }
      return
    }
    props.onAssetDrop(await collectAssetFilesFromDrop(dataTransfer), hit, { x: event.clientX, y: event.clientY })
  }

  function handleDragOver(event: DragEvent<SVGSVGElement>, page: SheetPage) {
    event.preventDefault()
    event.stopPropagation()
    autoScrollViewportForDrag(event, event.currentTarget.closest<HTMLElement>('.sheetViewport'))
    if (hasStackGuideDragPayload(event.dataTransfer)) {
      event.dataTransfer.dropEffect = 'move'
      const target = updateStackGuideDropPreview(stackGuideLabelIdFromDragData(event.dataTransfer) || undefined, event.clientX, event.clientY)
      props.onStatusHint('sheet-drop', target ? uiText.statusHints.dropStackGuide : uiText.statusHints.dropUnavailable)
      clearHover()
      return
    }
    setStackGuideDropPreview(null)
    const hit = dropHitForActiveRange(hitFromPoint(pointFromEvent(event), page))
    const assetIds = assetIdsFromDragData(event.dataTransfer)
    props.onDropDiagnostic({
      source: 'sheet-dom',
      type: 'dragover',
      target: hit ? `${sheetRoleLabel(sheetRoleForHit(hit))} ${hit.paperTrack ?? '-'}` : 'sheet/no-hit',
      fileCount: assetIds.length,
      position: { x: event.clientX, y: event.clientY },
      details: `assetIds ${assetIds.length}`,
    })
    if (assetIds.length > 1 && hit) {
      event.dataTransfer.dropEffect = 'none'
      setDropStatusForHit(event.dataTransfer, hit, assetIds)
      clearHover()
      return
    }
    event.dataTransfer.dropEffect = 'copy'
    setDropStatusForHit(event.dataTransfer, hit, assetIds)
    updateHover(hit, { x: event.clientX, y: event.clientY })
  }

  function handleViewportDragOver(event: DragEvent<HTMLDivElement>) {
    if (!hasSheetDropPayload(event.dataTransfer)) return
    event.preventDefault()
    autoScrollViewportForDrag(event, event.currentTarget)
    if (hasStackGuideDragPayload(event.dataTransfer)) {
      event.dataTransfer.dropEffect = 'move'
      const target = updateStackGuideDropPreview(stackGuideLabelIdFromDragData(event.dataTransfer) || undefined, event.clientX, event.clientY)
      props.onStatusHint('sheet-drop', target ? uiText.statusHints.dropStackGuide : uiText.statusHints.dropUnavailable)
      clearHover()
      return
    }
    setStackGuideDropPreview(null)
    event.dataTransfer.dropEffect = 'copy'
    const target = dropTargetFromClientPoint(event.clientX, event.clientY)
    const hit = dropHitForActiveRange(target?.hit ?? null)
    const assetIds = assetIdsFromDragData(event.dataTransfer)
    props.onDropDiagnostic({
      source: 'sheet-viewport-dom',
      type: 'dragover',
      target: hit ? `${sheetRoleLabel(sheetRoleForHit(hit))} ${hit.paperTrack ?? '-'}` : 'sheet/no-hit',
      fileCount: assetIds.length,
      position: { x: event.clientX, y: event.clientY },
      details: `assetIds ${assetIds.length}`,
    })
    if (assetIds.length > 1 && hit) {
      event.dataTransfer.dropEffect = 'none'
      setDropStatusForHit(event.dataTransfer, hit, assetIds)
      clearHover()
      return
    }
    if (target) {
      props.setActivePageIndex(target.page.pageIndex)
      setDropStatusForHit(event.dataTransfer, hit, assetIds)
      updateHover(hit, { x: event.clientX, y: event.clientY })
    } else {
      props.onStatusHint('sheet-drop', uiText.statusHints.dropUnavailable)
      clearHover()
    }
  }

  async function handleViewportDrop(event: DragEvent<HTMLDivElement>) {
    if (!hasSheetDropPayload(event.dataTransfer)) return
    event.preventDefault()
    props.onStatusHint('sheet-drop', null)
    const dataTransfer = event.dataTransfer
    if (moveStackGuideLabelFromDragData(dataTransfer, event.clientX, event.clientY)) {
      clearHover()
      return
    }
    const target = dropTargetFromClientPoint(event.clientX, event.clientY)
    if (target) props.setActivePageIndex(target.page.pageIndex)
    const hit = dropHitForActiveRange(target?.hit ?? null)
    props.onDropDiagnostic({
      source: 'sheet-viewport-dom',
      type: 'drop',
      target: hit ? `${sheetRoleLabel(sheetRoleForHit(hit))} ${hit.paperTrack ?? '-'}` : 'sheet/no-hit',
      fileCount: dataTransfer.files?.length ?? 0,
      position: { x: event.clientX, y: event.clientY },
      details: `types ${Array.from(dataTransfer.types ?? []).join(', ') || '-'}`,
    })
    const keyId = keyIdFromDragData(dataTransfer)
    if (keyId) {
      clearHover()
      props.onRegisteredCellAssign(keyId, hit)
      return
    }
    const assetIds = assetIdsFromDragData(dataTransfer)
    if (assetIds.length > 0) {
      clearHover()
      if (hit && assetIds.length === 1) {
        props.onAssetAssign(assetIds[0], hit, { x: event.clientX, y: event.clientY })
      }
      return
    }
    props.onAssetDrop(await collectAssetFilesFromDrop(dataTransfer), hit, { x: event.clientX, y: event.clientY })
  }

  function handleViewportPointerDown(event: PointerEvent<HTMLDivElement>) {
    beginViewportPan(event, event.currentTarget)
  }

  function beginViewportPan(event: PointerEvent<HTMLElement> | PointerEvent<SVGSVGElement>, viewport: HTMLElement | null) {
    const isMiddlePan = event.pointerType === 'mouse' && event.button === 1
    const isSpacePan = event.pointerType === 'mouse' && event.button === 0 && spacePanReadyRef.current
    if (!viewport || (!isMiddlePan && !isSpacePan)) return false

    event.preventDefault()
    event.stopPropagation()
    setContextMenu(null)
    setPaperTrackHeaderMenu(null)
    setStackGuideHeaderMenu(null)
    setStackGuideDropPreview(null)
    clearHover()

    const panViewport = viewport
    const pointerId = event.pointerId
    const startX = event.clientX
    const startY = event.clientY
    const startScrollLeft = panViewport.scrollLeft
    const startScrollTop = panViewport.scrollTop
    panningRef.current = true
    setIsPanning(true)
    props.onStatusHint('sheet-drag', uiText.statusHints.panning)

    function stopPan(nextEvent: globalThis.PointerEvent) {
      if (nextEvent.pointerId !== pointerId) return
      window.removeEventListener('pointermove', movePan)
      window.removeEventListener('pointerup', stopPan)
      window.removeEventListener('pointercancel', stopPan)
      panningRef.current = false
      setIsPanning(false)
      props.onStatusHint('sheet-drag', null)
    }

    function movePan(nextEvent: globalThis.PointerEvent) {
      if (nextEvent.pointerId !== pointerId) return
      nextEvent.preventDefault()
      panViewport.scrollLeft = startScrollLeft - (nextEvent.clientX - startX)
      panViewport.scrollTop = startScrollTop - (nextEvent.clientY - startY)
    }

    window.addEventListener('pointermove', movePan)
    window.addEventListener('pointerup', stopPan)
    window.addEventListener('pointercancel', stopPan)
    return true
  }

  const contextProcessMove = contextMenu?.hit ? singleMovableBindingForHit(props.project, contextMenu.hit) : null
  const contextProcessMoveOptions = contextProcessMove ? processMoveOptionsForSlot(props.project, contextProcessMove.slot, contextProcessMove.binding.keyId) : []
  const canCopyContextRange = isPointEventRangeForUi(props.rangeSelection)
  const contextPasteRole = props.rangeSelection?.role === 'action' || props.rangeSelection?.role === 'cell'
    ? props.rangeSelection.role
    : props.selectedHit ? sheetRoleForHit(props.selectedHit) : 'cell'
  const contextPaperTrackOrder = rangeTrackOrder(contextPasteRole)
  const canPasteContextOverwrite = canPasteTimingClipboardMode(props.timingClipboard, props.selectedHit, props.rangeSelection, 'overwrite', contextPaperTrackOrder)
  const canPasteContextInsert = canPasteTimingClipboardMode(props.timingClipboard, props.selectedHit, props.rangeSelection, 'insert', contextPaperTrackOrder)
  const canPasteContextRepeatRange = canPasteTimingClipboardMode(props.timingClipboard, props.selectedHit, props.rangeSelection, 'repeat-range', contextPaperTrackOrder)
  const canPasteContextRepeatToEnd = canPasteTimingClipboardMode(props.timingClipboard, props.selectedHit, props.rangeSelection, 'repeat-to-end', contextPaperTrackOrder)
  const hasSheetContextMenuItems = Boolean(contextMenu?.hit?.paperTrack)
  const contextProcessMoveItemCount = contextProcessMove && contextProcessMoveOptions.length > 0 ? 1 + contextProcessMoveOptions.length : 0
  const sheetContextMenuItemCount = 12 + contextProcessMoveItemCount
  const overlayPaperTrackMenuTrack = overlayPaperTrackMenu
    ? overlayTracks.find(track => track.paperTrack === overlayPaperTrackMenu.paperTrack) ?? null
    : null
  const hoverPreviewItems = !isCalibratingSheet && !props.suppressAssetPreview && hoveredHit ? cellAssetPreviewItemsForHit(props.project, hoveredHit) : []
  const hoverPreviewPosition = hoverPreviewAnchor && hoverPreviewItems.length > 0
    ? cellAssetPreviewPosition(hoverPreviewAnchor, hoverPreviewItems.length)
    : null
  const activeRange = draftRange
    ? rangeFromHits(draftRange.anchor, draftRange.focus)
    : props.rangeSelection
  const viewportClassName = [
    'sheetViewport',
    spacePanReady ? 'spacePanReady' : '',
    isPanning ? 'panning' : '',
    props.zoomMode ? 'zoomMode' : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      ref={viewportRef}
      className={viewportClassName}
      onPointerDown={handleViewportPointerDown}
      onDragOver={handleViewportDragOver}
      onDrop={event => void handleViewportDrop(event)}
    >
      <div className={`sheetPageStack ${props.sheetView.viewMode}`}>
        {visiblePages.map(page => {
          const isCalibrating = isCalibratingSheet
          const pageImage = getSheetPageImage(props.sheetView, props.runtimeSourceImageUrls, page.pageId, props.template)
          const strokes = !isCalibrating && props.showAnnotations
            ? [
                ...props.project.annotations.filter((annotation): annotation is AnnotationStroke => isAnnotationStroke(annotation) && annotation.pageId === page.pageId && annotation.tool === 'pen'),
                ...(draftStroke?.pageId === page.pageId ? [draftStroke] : []),
              ]
            : []
          const textAnnotations = !isCalibrating && props.showAnnotations
            ? props.project.annotations.filter((annotation): annotation is AnnotationText => annotation.kind === 'text' && annotation.pageId === page.pageId)
            : []
          const activeOverlayTrack = !isCalibrating && activeOverlayPaperTrack
            ? props.project.logicalSheet.paperTracks.find(track => track.paperTrack === activeOverlayPaperTrack && track.source === 'overlay')
            : undefined
          const activeOverlayColumn = activeOverlayTrack ? overlayColumnRectForPage(props.template, props.project, activeOverlayTrack, page) : null
          const eventRects = isCalibrating ? [] : eventRectsForPage(props.project, props.template, page, { activeOverlayPaperTrack })
          const candidateRects = isCalibrating
            ? []
            : props.recognitionCandidates.filter(candidate => {
                if (candidate.pageId !== page.pageId) return false
                const candidateTrack = props.project.logicalSheet.paperTracks.find(track => track.paperTrack === candidate.paperTrack)
                return !shouldSuppressRectUnderActiveOverlay(candidateTrack, candidate.bbox, activeOverlayColumn)
              })
          const calibrationPoints = calibrationPointsForPage(page, pageImage.settings)
          const calibrationMetrics = calibrationGuideMetrics(props.template, sheetPageSize)
          const calibrationDebugOverlay = isCalibrating && props.autoCalibrationOverlay?.pageId === page.pageId
            ? props.autoCalibrationOverlay
            : null
          const showTemplateGuides = props.showTemplateGuides && !isCalibrating
          const displayImageSettings = { ...pageImage.settings, calibration: { ...(pageImage.settings.calibration ?? { enabled: false }), points: calibrationPoints } }
          const rawHoverRect = !isCalibrating && hoveredHit?.pageId === page.pageId ? rectForHit(props.project, props.template, hoveredHit) : null
          const hoverTrack = hoveredHit?.paperTrack ? props.project.logicalSheet.paperTracks.find(track => track.paperTrack === hoveredHit.paperTrack) : undefined
          const hoverRect = rawHoverRect && !shouldSuppressRectUnderActiveOverlay(hoverTrack, rawHoverRect, activeOverlayColumn) ? rawHoverRect : null
          const rawSelectedRect = !isCalibrating && props.selectedHit?.pageId === page.pageId ? rectForHit(props.project, props.template, props.selectedHit) : null
          const selectedTrack = props.selectedHit?.paperTrack ? props.project.logicalSheet.paperTracks.find(track => track.paperTrack === props.selectedHit?.paperTrack) : undefined
          const selectedRect = rawSelectedRect && !shouldSuppressRectUnderActiveOverlay(selectedTrack, rawSelectedRect, activeOverlayColumn) ? rawSelectedRect : null
          const normalRangeRects = !isCalibrating && activeRange
            ? rangeRectsForPage(props.template, activeRange, page, templateTrackNames)
                .filter(rect => !shouldSuppressRectUnderActiveOverlay(undefined, rect, activeOverlayColumn))
            : []
          const overlayRangeRects = !isCalibrating && activeRange
            ? rangePaperTracks(activeRange).flatMap(paperTrack => {
                const track = props.project.logicalSheet.paperTracks.find(item => item.paperTrack === paperTrack)
                return track?.source === 'overlay'
                  ? overlayRangeRectForPage(props.template, props.project, track, activeRange.frameStart, activeRange.frameEnd, page) ?? []
                  : []
              })
            : []
          const rangeRects = [...normalRangeRects, ...overlayRangeRects]

          return (
            <figure key={page.pageId} className={page.pageIndex === props.activePageIndex ? 'sheetPage active' : 'sheetPage'}>
              <figcaption>
                {isContinuousCanvas
                  ? uiText.sheet.surfaceCaption(page.frameStart, page.frameEnd)
                  : uiText.sheet.pageCaption(page.pageIndex + 1, page.frameStart, page.frameEnd)}
              </figcaption>
              <div
                className="sheetPageSurface"
                style={{ width: `${sheetPageWidth}px`, height: `${sheetPageHeight}px` }}
              >
                <svg
                  viewBox="0 0 1 1"
                  preserveAspectRatio="none"
                  className={[
                    'sheetSvg',
                    draftCalibration?.pageId === page.pageId ? 'calibrationDragging' : '',
                    props.editMode === 'text' ? 'textAnnotationMode' : '',
                    props.editMode === 'text' && !props.editingTextAnnotationId ? 'textAnnotationPlacementMode' : '',
                  ].filter(Boolean).join(' ')}
                  data-page-id={page.pageId}
                  ref={element => {
                    if (element) {
                      sheetSvgRefs.current[page.pageId] = element
                    } else {
                      delete sheetSvgRefs.current[page.pageId]
                    }
                  }}
                  style={{ width: `${sheetPageWidth}px`, height: `${sheetPageHeight}px` }}
                  onPointerDown={event => handlePointerDown(event, page)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={() => {
                    setDraftStroke(null)
                    setDraftRange(null)
                    setTimelineEventDrag(null)
                    props.onStatusHint('sheet-drag', null)
                    clearHover()
                  }}
                  onPointerLeave={clearHover}
                  onDragOver={event => handleDragOver(event, page)}
                  onDrop={event => void handleDrop(event, page)}
                  onDragStart={event => event.preventDefault()}
                  onContextMenu={event => handleContextMenu(event, page)}
                  aria-label={isContinuousCanvas ? uiText.sheet.canvasSurfaceLabel : page.pageIndex === 0 ? uiText.sheet.canvasLabel : uiText.sheet.canvasPageLabel(page.pageIndex + 1)}
                >
                  <rect x="0" y="0" width="1" height="1" fill="#f7f7f4" />
                  {props.showTemplate && pageImage.imageUrl && (
                    <SheetImageLayer
                      imageUrl={pageImage.imageUrl}
                      imageSettings={displayImageSettings}
                      template={props.template}
                      forceRaw={isCalibrating}
                      preview
                    />
                  )}
                  {showTemplateGuides && <TemplateChrome template={props.template} paperTracks={templateTrackNames} durationFrames={displayDurationFrames} />}
                  {showTemplateGuides && props.template.regions.filter(region => region.type === 'exposure-grid').map(region => (
                    <GridOverlay key={region.regionId} template={props.template} region={region} paperTracks={templateTrackNames} durationFrames={page.frameEnd - page.frameStart + 1} frameOrigin={isContinuousCanvas ? page.frameStart : props.template.defaults.frameOrigin} />
                  ))}
                  {showTemplateGuides && <MetadataTextLayer context={sheetRenderModelContext} page={page} />}
                  {candidateRects.map(candidate => (
                    <rect
                      key={candidate.candidateId}
                      className="candidateRect"
                      x={candidate.bbox.x}
                      y={candidate.bbox.y}
                      width={candidate.bbox.w}
                      height={candidate.bbox.h}
                    />
                  ))}
                  {!isCalibrating && (
                    <WorkRangeOverlay
                      template={props.template}
                      page={page}
                      displayDurationFrames={displayDurationFrames}
                      officialFrameStart={props.project.logicalSheet.frameOrigin}
                      officialFrameEnd={officialFrameEnd}
                    />
                  )}
                  {!isCalibrating && overlayTracks.length > 0 && (
                    <OverlayPaperTrackLayer
                      project={props.project}
                      template={props.template}
                      page={page}
                      tracks={overlayTracks}
                      activePaperTrack={activeOverlayPaperTrack}
                      drag={overlayTrackDrag?.pageId === page.pageId ? overlayTrackDrag : null}
                    />
                  )}
                  {rangeRects.map((rect, index) => (
                    <rect
                      key={`${index}-${rect.x}-${rect.y}`}
                      className={draftRange ? 'draftRangeRect' : 'selectedRangeRect'}
                      x={rect.x}
                      y={rect.y}
                      width={rect.w}
                      height={rect.h}
                    />
                  ))}
                  {calibrationDebugOverlay && (
                    <AutoCalibrationGuideOverlay
                      overlay={calibrationDebugOverlay}
                      imageSettings={pageImage.settings}
                    />
                  )}
                  {isCalibrating && (
                    <CalibrationQuadEditor
                      points={calibrationPoints}
                      imageSettings={pageImage.settings}
                      metrics={calibrationMetrics}
                      onHandlePointerDown={(event, index, kind) => handleCalibrationHandlePointerDown(event, page, pageImage.settings, index, kind)}
                    />
                  )}
                  {eventRects.map(({ event, displayLabel, rect, hasAssetBinding, fontSizePx }) => {
                    const eventHit = timelineEventHitForPage(event, page)
                    const isDraggingEvent = Boolean(timelineEventDrag && sameSheetHitCell(timelineEventDrag.sourceHit, eventHit))
                    const pendingEventDrag = pendingTimelineEventDrag && sameSheetHitCell(pendingTimelineEventDrag.sourceHit, eventHit)
                      ? pendingTimelineEventDrag
                      : null
                    const textGeometry = eventTextGeometry(rect, fontSizePx, sheetPageSize)
                    const timelineEventClassName = [
                      isDraggingEvent ? 'timelineEventDragSource' : 'timelineEventHandle',
                      pendingEventDrag ? 'timelineEventDragPending' : '',
                      pendingEventDrag?.ready ? 'timelineEventDragReady' : '',
                    ].filter(Boolean).join(' ')
                    return (
                      <g
                        key={event.eventId}
                        className={timelineEventClassName}
                        onPointerDown={eventHit ? pointerEvent => handleTimelineEventPointerDown(pointerEvent, event, page) : undefined}
                        onPointerMove={handleTimelineEventPointerMove}
                        onPointerUp={handleTimelineEventPointerUp}
                        onPointerCancel={handleTimelineEventPointerCancel}
                      >
                        <rect className={hasAssetBinding ? 'eventRect assetAssignedEventRect' : 'eventRect'} x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx="0.002" />
                        {hasAssetBinding && <polygon className="assetAssignedEventMarker" points={assetAssignedEventMarkerPoints(rect)} />}
                        {displayLabel.trim()
                          && (
                            <text
                              className="eventText"
                              x={textGeometry.x}
                              y={textGeometry.y}
                              transform={textGeometry.transform}
                              textAnchor="middle"
                              dominantBaseline="central"
                              alignmentBaseline="central"
                              fontSize={textGeometry.fontSize}
                            >
                              {displayLabel}
                            </text>
                        )}
                      </g>
                    )
                  })}
                  {!isCalibrating && (
                    <StackGuideSvgLayer
                      project={props.project}
                      template={props.template}
                      page={page}
                      onAssignAsset={props.onAssignAssetToStackGuideLabel}
                      onUpdateLabel={props.onUpdateStackGuideLabel}
                      onPreviewPlacement={(labelId, clientX, clientY) => {
                        updateStackGuideDropPreview(labelId, clientX, clientY)
                      }}
                      onClearPreview={() => setStackGuideDropPreview(null)}
                    />
                  )}
                  {strokes.map(stroke => (
                    <path
                      key={stroke.annotationId}
                      className={stroke.tool === 'eraser' ? 'annotationStroke annotationEraserPreview' : 'annotationStroke'}
                      d={strokePath(stroke)}
                      stroke={stroke.color}
                      strokeWidth={stroke.width}
                    />
                  ))}
                  {selectedRect && (
                    <g className="selectedCellOverlay">
                      <rect className="selectedCellRect" x={selectedRect.x} y={selectedRect.y} width={selectedRect.w} height={selectedRect.h} />
                    </g>
                  )}
                </svg>
                {!isCalibrating && textAnnotations.length > 0 && (
                  <AnnotationTextLayer
                    annotations={textAnnotations}
                    selectedAnnotationId={props.selectedTextAnnotationId}
                    editingAnnotationId={props.editingTextAnnotationId}
                    pageSize={sheetPageSize}
                    zoom={zoom}
                    onSelect={props.onSelectTextAnnotation}
                    onEdit={props.onEditTextAnnotation}
                    onUpdate={props.onUpdateTextAnnotation}
                    onCommit={props.onCommitTextAnnotation}
                    onCancel={props.onCancelTextAnnotation}
                  />
                )}
                {props.editMode === 'text' && !props.editingTextAnnotationId && textCursorBadge?.pageId === page.pageId && (
                  <div
                    className="textCursorBadge"
                    style={{ left: `${textCursorBadge.x}px`, top: `${textCursorBadge.y}px` }}
                    aria-hidden="true"
                  >
                    T+
                  </div>
                )}
                {!isCalibrating && (
                    <StackGuideOverlay
                      project={props.project}
                      template={props.template}
                      page={page}
                      pageWidth={sheetPageWidth}
                      pageHeight={sheetPageHeight}
                      insertRequest={stackGuideInsertRequest?.pageId === page.pageId ? stackGuideInsertRequest : null}
                      insertTool={page.pageIndex === props.activePageIndex ? props.stackGuideInsertTool : null}
                      dropPreview={stackGuideDropPreview?.pageId === page.pageId ? stackGuideDropPreview : null}
                      onInsertRequestConsumed={() => setStackGuideInsertRequest(null)}
                      onInsertToolConsumed={props.onStackGuideInsertToolConsumed}
                      onCreate={props.onCreateStackGuideLabel}
                      onCreateOverlayPaperTrack={openAddOverlayPaperTrackEditor}
                    />
                )}
                {!isCalibrating && overlayTracks.length > 0 && (
                  <OverlayPaperTrackInteractionLayer
                    project={props.project}
                    template={props.template}
                    page={page}
                    tracks={overlayTracks}
                    pageWidth={sheetPageWidth}
                    pageHeight={sheetPageHeight}
                    activePaperTrack={activeOverlayPaperTrack}
                    drag={overlayTrackDrag}
                    onActivePaperTrackChange={nextTrack => {
                      setActiveOverlayPaperTrack(nextTrack)
                      if (!nextTrack || props.selectedHit?.paperTrack !== nextTrack) props.onClearSelection()
                    }}
                    onOpenPaperTrackMenu={(track, position) => openOverlayPaperTrackMenu(track, position)}
                    onDragChange={setOverlayTrackDrag}
                    onStatusHint={props.onStatusHint}
                    onUpdatePaperTrack={props.onUpdatePaperTrack}
                  />
                )}
                {hoverRect && <HoverCellOverlay rect={hoverRect} />}
              </div>
            </figure>
          )
        })}
      </div>
      {hoverPreviewPosition && <CellAssetPreview position={hoverPreviewPosition} items={hoverPreviewItems} />}
      {contextMenu && hasSheetContextMenuItems && (
        <div
          className="sheetContextMenu"
          style={sheetContextMenuStyle(contextMenu.x, contextMenu.y, sheetContextMenuItemCount)}
          role="menu"
          onPointerDown={event => event.stopPropagation()}
          onContextMenu={event => event.preventDefault()}
        >
          <button role="menuitem" disabled={!canCopyContextRange} onClick={() => runContextMenuAction(props.onCopyRange)}>{uiText.actions.copyRange}</button>
          <button role="menuitem" disabled={!canCopyContextRange} onClick={() => runContextMenuAction(props.onCutRange)}>{uiText.actions.cutRange}</button>
          <button role="menuitem" disabled={!canCopyContextRange} onClick={() => runContextMenuAction(props.onCutRangeRipple)}>{uiText.actions.cutRangeRipple}</button>
          <button role="menuitem" disabled={!canPasteContextOverwrite} onClick={() => runContextMenuAction(() => props.onPasteTiming('overwrite'))}>{uiText.actions.pasteOverwrite}</button>
          <button role="menuitem" disabled={!canPasteContextInsert} onClick={() => runContextMenuAction(() => props.onPasteTiming('insert'))}>{uiText.actions.pasteInsert}</button>
          <button role="menuitem" disabled={!canPasteContextRepeatRange} onClick={() => runContextMenuAction(() => props.onPasteTiming('repeat-range'))}>{uiText.actions.repeatPaste}</button>
          <button role="menuitem" disabled={!canPasteContextRepeatToEnd} onClick={() => runContextMenuAction(() => props.onPasteTiming('repeat-to-end'))}>{uiText.actions.repeatPasteToEnd}</button>
          <button role="menuitem" onClick={() => runContextMenuAction(() => props.onSetNullAtHit(contextMenu.hit as SheetHit))}>{uiText.actions.setNullCell}</button>
          <button role="menuitem" onClick={() => runContextMenuAction(() => props.onDeleteEventAtHit(contextMenu.hit as SheetHit))}>{uiText.actions.deleteEvent}</button>
          <div className="sheetContextMenuTitle">{uiText.frameOperation.title}</div>
          <button role="menuitem" onClick={() => runContextMenuAction(() => props.onOpenFrameOperation('insert', contextMenu.hit as SheetHit))}>{uiText.frameOperation.insert}</button>
          <button role="menuitem" onClick={() => runContextMenuAction(() => props.onOpenFrameOperation('delete', contextMenu.hit as SheetHit))}>{uiText.frameOperation.delete}</button>
          {contextProcessMove && contextProcessMoveOptions.length > 0 && (
            <>
              <div className="sheetContextMenuTitle">{uiText.processMove.title}</div>
              {contextProcessMoveOptions.map(({ layer, existingTargetBinding }) => (
                <button
                  key={layer.layerId}
                  role="menuitem"
                  onClick={() => runContextMenuAction(() => props.onMoveKeyBindingProcess(contextProcessMove.binding.keyId, contextProcessMove.binding.slotId, layer.layerId))}
                >
                  {existingTargetBinding ? uiText.processMove.moveToOccupied(layer.label) : uiText.processMove.moveTo(layer.label)}
                </button>
              ))}
            </>
          )}
        </div>
      )}
      {paperTrackHeaderMenu && (
        <div
          className="sheetContextMenu"
          style={sheetContextMenuStyle(paperTrackHeaderMenu.x, paperTrackHeaderMenu.y, 2)}
          role="menu"
          onPointerDown={event => event.stopPropagation()}
          onContextMenu={event => event.preventDefault()}
        >
          <button
            role="menuitem"
            onClick={() => runPaperTrackHeaderMenuAction(() => selectPaperTrackColumn(paperTrackHeaderMenu.hit))}
          >
            {uiText.actions.selectPaperTrackColumn}
          </button>
          <button
            role="menuitem"
            onClick={() => runPaperTrackHeaderMenuAction(() => openPaperTrackRenameEditor(paperTrackHeaderMenu.hit.paperTrack ?? '', {
              x: paperTrackHeaderMenu.x,
              y: paperTrackHeaderMenu.y,
              sheetRole: paperTrackHeaderMenu.sheetRole,
              snapIndex: paperTrackHeaderMenu.snapIndex,
            }))}
          >
            {uiText.actions.renamePaperTrack}
          </button>
        </div>
      )}
      {overlayPaperTrackMenu && overlayPaperTrackMenuTrack && (
        <div
          className="sheetContextMenu"
          style={sheetContextMenuStyle(overlayPaperTrackMenu.x, overlayPaperTrackMenu.y, 2)}
          role="menu"
          onPointerDown={event => event.stopPropagation()}
          onContextMenu={event => event.preventDefault()}
        >
          <button
            role="menuitem"
            onClick={() => runOverlayPaperTrackMenuAction(() => openOverlayPaperTrackEditor(overlayPaperTrackMenuTrack, {
              x: overlayPaperTrackMenu.x,
              y: overlayPaperTrackMenu.y,
            }))}
          >
            {uiText.actions.renamePaperTrack}
          </button>
          <button
            role="menuitem"
            onClick={() => runOverlayPaperTrackMenuAction(() => props.onDeleteOverlayPaperTrack(overlayPaperTrackMenu.paperTrack))}
          >
            {uiText.actions.deleteOverlayPaperTrack}
          </button>
        </div>
      )}
      {stackGuideHeaderMenu && (
        <div
          className="sheetContextMenu"
          style={sheetContextMenuStyle(stackGuideHeaderMenu.x, stackGuideHeaderMenu.y, 2)}
          role="menu"
          aria-label={uiText.stackGuides.insertMenuLabel}
          onPointerDown={event => event.stopPropagation()}
          onContextMenu={event => event.preventDefault()}
        >
          <button
            role="menuitem"
            onClick={() => runStackGuideHeaderMenuAction(() => requestStackGuideInsert(stackGuideHeaderMenu, 'label-editor'))}
          >
            {uiText.stackGuides.add}
          </button>
          <button
            role="menuitem"
            onClick={() => runStackGuideHeaderMenuAction(() => requestStackGuideInsert(stackGuideHeaderMenu, 'overlay-track'))}
          >
            {uiText.stackGuides.addOverlayTrack}
          </button>
        </div>
      )}
      {paperTrackEditor && (
        <PaperTrackEditorPopover
          state={paperTrackEditor}
          paperTracks={props.project.logicalSheet.paperTracks}
          onSubmit={submitPaperTrackEditor}
          onCancel={() => setPaperTrackEditor(null)}
        />
      )}
    </div>
  )
}

function PaperTrackEditorPopover({
  state,
  paperTracks,
  onSubmit,
  onCancel,
}: {
  state: PaperTrackEditorState
  paperTracks: PaperTrack[]
  onSubmit: (name: string, exportAfterPaperTrack?: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(state.initialName)
  const [exportAfterPaperTrack, setExportAfterPaperTrack] = useState(state.exportAfterPaperTrack ?? '')
  const exportAfterOptions = exportAfterOptionsForPaperTrack(paperTracks, state.paperTrack)
  return (
    <form
      className="paperTrackEditorPopover"
      style={floatingEditorStyle(state.x, state.y)}
      onSubmit={event => {
        event.preventDefault()
        onSubmit(name, exportAfterPaperTrack || undefined)
      }}
      onPointerDown={event => event.stopPropagation()}
    >
      <label>
        <span>{state.mode === 'add' ? uiText.sheet.addOverlayTrackName : uiText.sheet.renameTrackName}</span>
        <input autoFocus value={name} onChange={event => setName(event.currentTarget.value)} />
      </label>
      {state.isOverlay && (
        <label>
          <span>{uiText.sheet.exportOrderAfter}</span>
          <select value={exportAfterPaperTrack} onChange={event => setExportAfterPaperTrack(event.currentTarget.value)}>
            <option value="">{uiText.sheet.exportInsertAtStart}</option>
            {exportAfterOptions.map(track => (
              <option key={track.paperTrack} value={track.paperTrack}>{uiText.sheet.exportInsertAfterTrack(track.label || track.paperTrack)}</option>
            ))}
          </select>
        </label>
      )}
      <div>
        <Tooltip label={uiText.stackGuides.confirm}>
          <button type="submit" aria-label={uiText.stackGuides.confirm}>✓</button>
        </Tooltip>
        <Tooltip label={uiText.stackGuides.cancel}>
          <button type="button" aria-label={uiText.stackGuides.cancel} onClick={onCancel}>×</button>
        </Tooltip>
      </div>
    </form>
  )
}

function exportAfterOptionsForPaperTrack(paperTracks: PaperTrack[], currentPaperTrack?: string): PaperTrack[] {
  return exportOrderedPaperTracks(paperTracks).filter(track => track.paperTrack !== currentPaperTrack)
}

function exportPreviousPaperTrackName(paperTracks: PaperTrack[], paperTrackName: string): string {
  const ordered = exportOrderedPaperTracks(paperTracks)
  const index = ordered.findIndex(track => track.paperTrack === paperTrackName)
  return index > 0 ? ordered[index - 1]?.paperTrack ?? '' : ''
}

function defaultExportAfterTrackForInsertAfter(paperTracks: PaperTrack[], insertAfterPaperTrack?: string): string {
  const directTrack = insertAfterPaperTrack ? paperTracks.find(track => track.paperTrack === insertAfterPaperTrack) : null
  if (directTrack?.source === 'overlay') return directTrack.paperTrack
  const gapKey = insertAfterPaperTrack ?? ''
  const lastOverlayInGap = exportOrderedPaperTracks(paperTracks)
    .filter(track => track.source === 'overlay' && (track.exportPlacement?.insertAfterPaperTrack ?? '') === gapKey)
    .at(-1)
  return lastOverlayInGap?.paperTrack ?? insertAfterPaperTrack ?? ''
}

function overlayExportPlacementAfterTrack(
  paperTracks: PaperTrack[],
  exportAfterPaperTrack: string | undefined,
  currentPaperTrack?: string,
): NonNullable<PaperTrack['exportPlacement']> {
  const candidates = paperTracks.filter(track => track.paperTrack !== currentPaperTrack)
  const afterTrack = exportAfterPaperTrack ? candidates.find(track => track.paperTrack === exportAfterPaperTrack) : null
  if (!afterTrack) {
    return { insertAfterPaperTrack: undefined, orderInGap: -1 }
  }
  if (afterTrack.source === 'overlay') {
    return {
      insertAfterPaperTrack: afterTrack.exportPlacement?.insertAfterPaperTrack,
      orderInGap: (afterTrack.exportPlacement?.orderInGap ?? 0) + 0.5,
    }
  }
  return {
    insertAfterPaperTrack: afterTrack.paperTrack,
    orderInGap: -1,
  }
}

function exportOrderedPaperTracks(paperTracks: PaperTrack[]): PaperTrack[] {
  return [...paperTracks].sort((a, b) =>
    a.order - b.order
    || compareNaturalFileNameText(a.paperTrack, b.paperTrack),
  )
}

function deleteRegisteredCellKey(project: CutProject, keyId: string): CutProject {
  return {
    ...project,
    logicalSheet: {
      ...project.logicalSheet,
      keys: project.logicalSheet.keys.filter(key => key.keyId !== keyId),
      events: project.logicalSheet.events.filter(event => event.keyId !== keyId),
    },
    bindings: project.bindings.filter(binding => binding.keyId !== keyId),
  }
}

function isInteractiveKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest('input, textarea, select, button, [contenteditable="true"]'))
}

const REGISTERED_CELL_POINTER_DRAG_THRESHOLD_PX = 4

function startRegisteredCellPointerDrag(
  event: PointerEvent<HTMLElement>,
  input: {
    keyId: string
    onDragStart: () => void
    onDrop: (position: { x: number; y: number }) => void
    onDragEnd: () => void
    createDragGhost: () => HTMLElement
  },
) {
  if (event.button !== 0 || isInteractiveKeyboardTarget(event.target)) return

  const pointerId = event.pointerId
  const startX = event.clientX
  const startY = event.clientY
  let isDragging = false
  let dragGhost: PointerDragGhost | null = null

  function cleanup() {
    window.removeEventListener('pointermove', handleMove)
    window.removeEventListener('pointerup', handleStop)
    window.removeEventListener('pointercancel', handleCancel)
    dragGhost?.dispose()
    dragGhost = null
  }

  function ensureDragging(nextEvent: globalThis.PointerEvent) {
    if (isDragging) return true
    const moved = Math.abs(nextEvent.clientX - startX) >= REGISTERED_CELL_POINTER_DRAG_THRESHOLD_PX
      || Math.abs(nextEvent.clientY - startY) >= REGISTERED_CELL_POINTER_DRAG_THRESHOLD_PX
    if (!moved) return false
    input.onDragStart()
    dragGhost = createPointerDragGhost(input.createDragGhost(), nextEvent.clientX, nextEvent.clientY)
    isDragging = true
    return true
  }

  function handleMove(nextEvent: globalThis.PointerEvent) {
    if (nextEvent.pointerId !== pointerId) return
    if (!ensureDragging(nextEvent)) return
    nextEvent.preventDefault()
    dragGhost?.move(nextEvent.clientX, nextEvent.clientY)
  }

  function handleStop(nextEvent: globalThis.PointerEvent) {
    if (nextEvent.pointerId !== pointerId) return
    cleanup()
    if (!isDragging) return
    nextEvent.preventDefault()
    input.onDrop({ x: nextEvent.clientX, y: nextEvent.clientY })
    input.onDragEnd()
  }

  function handleCancel(nextEvent: globalThis.PointerEvent) {
    if (nextEvent.pointerId !== pointerId) return
    cleanup()
    if (isDragging) input.onDragEnd()
  }

  window.addEventListener('pointermove', handleMove)
  window.addEventListener('pointerup', handleStop)
  window.addEventListener('pointercancel', handleCancel)
}

function HoverCellOverlay({ rect }: { rect: { x: number; y: number; w: number; h: number } }) {
  return (
    <div
      className="hoverCellRect"
      style={{
        left: `${rect.x * 100}%`,
        top: `${rect.y * 100}%`,
        width: `${rect.w * 100}%`,
        height: `${rect.h * 100}%`,
      }}
    />
  )
}

function StackGuideOverlay({
  project,
  template,
  page,
  pageWidth,
  pageHeight,
  insertRequest,
  insertTool,
  dropPreview,
  onInsertRequestConsumed,
  onInsertToolConsumed,
  onCreate,
  onCreateOverlayPaperTrack,
}: {
  project: CutProject
  template: SheetTemplate
  page: SheetPage
  pageWidth: number
  pageHeight: number
  insertRequest?: StackGuideInsertRequest | null
  insertTool?: StackGuideInsertTool | null
  dropPreview?: StackGuideDropPreviewState | null
  onInsertRequestConsumed?: () => void
  onInsertToolConsumed?: () => void
  onCreate: (input: { label: string; gapIndex: number; insertAfterPaperTrack?: string; displayRole?: SheetTimingRole; viewSnapIndex?: number }) => void
  onCreateOverlayPaperTrack: (input: { x: number; y: number; insertAfterPaperTrack?: string; snapIndex: number; sheetRole: SheetTimingRole }) => void
}) {
  const editorInputRef = useRef<HTMLInputElement | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const [requestInsertTool, setRequestInsertTool] = useState<StackGuideInsertTool | null>(null)
  const [insertToolTarget, setInsertToolTarget] = useState<StackGuideInsertTarget | null>(null)
  const [insertMenu, setInsertMenu] = useState<{
    regionId: string
    gapIndex: number
    insertAfterPaperTrack?: string
    displayRole: SheetTimingRole
    snapIndex: number
  } | null>(null)
  const [editor, setEditor] = useState<{
    regionId: string
    gapIndex: number
    insertAfterPaperTrack?: string
    displayRole: SheetTimingRole
    snapIndex: number
    value: string
  } | null>(null)
  const displayDurationFrames = logicalSheetDisplayDurationFrames(project.logicalSheet)
  const pageSize = resolveSheetTemplatePageSize(template, displayDurationFrames, {
    paperTracks: project.logicalSheet.paperTracks.map(track => track.paperTrack),
    layoutOverrides: project.sheetView.layoutOverrides,
  })
  const anchorRegions = stackGuideAnchorRegions(template, page, project.logicalSheet.frameOrigin)
  const activeInsertTool = insertTool ?? requestInsertTool
  const currentInsertToolTarget = activeInsertTool
    ? insertToolTarget ?? defaultStackGuideInsertTarget(template, project, page)
    : null

  useEffect(() => {
    if (!insertRequest || insertRequest.pageId !== page.pageId) return
    const timer = window.setTimeout(() => {
      setInsertMenu(null)
      setEditor(null)
      setRequestInsertTool(insertRequest.mode)
      setInsertToolTarget(insertRequest)
      onInsertRequestConsumed?.()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [insertRequest, onInsertRequestConsumed, page.pageId])

  useEffect(() => {
    if (!editor && !insertMenu) return undefined
    const cancelFloatingUi = () => {
      setInsertMenu(null)
      setEditor(current => current && current.value.trim() === '' ? null : current)
    }
    window.addEventListener('pointerdown', cancelFloatingUi)
    return () => window.removeEventListener('pointerdown', cancelFloatingUi)
  }, [editor, insertMenu])

  useLayoutEffect(() => {
    if (!activeInsertTool) return undefined
    function handleOutsidePointer(event: globalThis.PointerEvent) {
      const target = event.target as Element | null
      if (target?.closest('.stackGuideOverlay, .stackGuideInsertHandle, .stackGuideEditor, .stackGuideInsertMenu, .actionMenu')) return
      setRequestInsertTool(null)
      onInsertToolConsumed?.()
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setRequestInsertTool(null)
      onInsertToolConsumed?.()
    }
    window.addEventListener('pointerdown', handleOutsidePointer)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('pointerdown', handleOutsidePointer)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [activeInsertTool, onInsertToolConsumed])

  if (anchorRegions.length === 0) return null

  function stackGuideInsertTargetFromClientPoint(clientX: number, clientY: number): StackGuideInsertTarget | null {
    const box = overlayRef.current?.getBoundingClientRect()
    if (!box || box.width <= 0 || box.height <= 0) return null
    return stackGuideInsertTargetFromPoint(template, project, page, {
      x: clampNumber((clientX - box.left) / box.width, 0, 1),
      y: clampNumber((clientY - box.top) / box.height, 0, 1),
    }, 'page')
  }

  function updateInsertToolTargetFromEvent(event: PointerEvent<HTMLDivElement> | MouseEvent<HTMLDivElement>): StackGuideInsertTarget | null {
    if (!activeInsertTool) return null
    const target = stackGuideInsertTargetFromClientPoint(event.clientX, event.clientY)
    if (target) setInsertToolTarget(target)
    return target
  }

  function clearActiveInsertTool() {
    setRequestInsertTool(null)
    setInsertToolTarget(null)
    onInsertToolConsumed?.()
  }

  function confirmInsertTool(event: MouseEvent<HTMLDivElement>, fallbackTarget?: StackGuideInsertTarget | null) {
    if (!activeInsertTool) return
    const target = stackGuideInsertTargetFromClientPoint(event.clientX, event.clientY) ?? fallbackTarget ?? currentInsertToolTarget
    if (!target) return
    event.preventDefault()
    event.stopPropagation()
    setInsertToolTarget(target)
    if (activeInsertTool === 'label-editor') {
      openEditor(target.regionId, target.gapIndex, target.insertAfterPaperTrack, target.displayRole, target.snapIndex)
      clearActiveInsertTool()
      return
    }
    onCreateOverlayPaperTrack({
      x: event.clientX,
      y: event.clientY,
      insertAfterPaperTrack: target.insertAfterPaperTrack,
      snapIndex: target.snapIndex,
      sheetRole: target.displayRole,
    })
    clearActiveInsertTool()
  }

  function openEditor(regionId: string, gapIndex: number, insertAfterPaperTrack: string | undefined, displayRole: SheetTimingRole, snapIndex: number) {
    setInsertMenu(null)
    setEditor({ regionId, gapIndex, insertAfterPaperTrack, displayRole, snapIndex, value: '' })
  }

  function openInsertMenu(regionId: string, gapIndex: number, insertAfterPaperTrack: string | undefined, displayRole: SheetTimingRole, snapIndex: number) {
    setEditor(null)
    setInsertMenu({ regionId, gapIndex, insertAfterPaperTrack, displayRole, snapIndex })
  }

  function submitEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editor) return
    const formInput = event.currentTarget.elements.namedItem('stackGuideLabel') as HTMLInputElement | null
    const label = (formInput?.value ?? editorInputRef.current?.value ?? editor.value).trim()
    if (!label) {
      formInput?.focus()
      return
    }
    onCreate({
      label,
      gapIndex: editor.gapIndex,
      insertAfterPaperTrack: editor.insertAfterPaperTrack,
      displayRole: editor.displayRole,
      viewSnapIndex: editor.snapIndex,
    })
    setEditor(null)
  }

  return (
    <div
      ref={overlayRef}
      className={editor || insertMenu || activeInsertTool ? 'stackGuideOverlay editing' : 'stackGuideOverlay'}
      aria-label={uiText.stackGuides.overlayLabel}
      onPointerMove={event => {
        updateInsertToolTargetFromEvent(event)
      }}
      onClick={event => {
        confirmInsertTool(event)
      }}
    >
      {anchorRegions.map(region => {
        const layout = resolveSheetTemplateGridLayout(template, region, {
          paperTracks: project.logicalSheet.paperTracks.map(track => track.paperTrack),
          durationFrames: displayDurationFrames,
          layoutOverrides: project.sheetView.layoutOverrides,
        })
        const columns = layout?.columns ?? []
        const displayRole = region.grid?.role as SheetTimingRole
        const rect = layout?.rect ?? resolveSheetTemplateRegionRect(template, region, displayDurationFrames)
        const anchorY = rect.y
        const headerReachPx = stackGuideHeaderReachPx(template, rect, pageHeight)
        const columnHeaderHitPx = stackGuideColumnHeaderHitPx(template, pageHeight)
        const gapWidthPx = stackGuideGapWidthPx(template, rect, columns, pageSize.widthPx)
        const labelsForRegion = project.stackGuideLabels.filter(label => (label.displayRole ?? 'action') === displayRole && stackGuideStackBand(label) === 'cell-interleave')
        const placementsByGap = stackGuidePlacementsByGap(template, project, labelsForRegion, gapWidthPx, columns)
        return (
          <div key={region.regionId}>
            {stackGuideInsertionTargets(template, project, displayRole, region.regionId, rect, columns).map(target => {
              const { gapIndex, insertAfterPaperTrack, snapIndex, x } = target
              const placements = placementsByGap.get(snapIndex) ?? []
              const activeEditor = editor?.regionId === region.regionId && editor.gapIndex === gapIndex
                && editor.snapIndex === snapIndex
              const activeInsertMenu = insertMenu?.regionId === region.regionId && insertMenu.gapIndex === gapIndex
                && insertMenu.snapIndex === snapIndex
              const activeDropPreview = dropPreview?.regionId === region.regionId
                && dropPreview.gapIndex === gapIndex
                && dropPreview.displayRole === displayRole
                && dropPreview.snapIndex === snapIndex
              const activeInsertToolTarget = activeInsertTool
                && currentInsertToolTarget?.regionId === region.regionId
                && currentInsertToolTarget.gapIndex === gapIndex
                && currentInsertToolTarget.displayRole === displayRole
                && currentInsertToolTarget.snapIndex === snapIndex
              const maxLane = placements.reduce((max, placement) => Math.max(max, placement.lane), 0)
              const guideHeight = stackGuideGuideHeightPx(maxLane)
              const preferredEditorBottomPx = headerReachPx + stackGuideEditorBottomPx(maxLane)
              const editorShiftPx = stackGuideEditorShiftPx(x, pageWidth)
              const className = [
                'stackGuideGap',
                placements.length > 0 ? 'hasLabels' : '',
                activeEditor || activeInsertMenu ? 'editing' : '',
                activeDropPreview ? 'preview' : '',
                activeInsertToolTarget ? 'insertToolActive' : '',
              ].filter(Boolean).join(' ')
              return (
                <div
                  key={`${region.regionId}-${snapIndex}`}
                  className={className}
                  data-region-id={region.regionId}
                  data-stack-guide-role={displayRole}
                  data-stack-guide-gap-index={gapIndex}
                  data-stack-guide-snap-index={snapIndex}
                  style={{
                    left: `${x * 100}%`,
                    top: `${anchorY * 100}%`,
                    '--stack-guide-guide-height': `${guideHeight}px`,
                    '--stack-guide-header-reach': `${headerReachPx}px`,
                    '--stack-guide-column-header-hit': `${columnHeaderHitPx}px`,
                    '--stack-guide-editor-bottom': `${stackGuideClampedEditorBottomPx(anchorY, pageHeight, preferredEditorBottomPx)}px`,
                    '--stack-guide-editor-shift': `${editorShiftPx}px`,
                  } as CSSProperties}
                >
                  <TooltipTarget label={uiText.stackGuides.insertHandleTitle} disabled={activeInsertMenu}>
                    {tooltipProps => (
                      <button
                        {...tooltipProps}
                        type="button"
                        className="stackGuideInsertHandle"
                        aria-label={uiText.stackGuides.addAtGap(gapIndex)}
                        onClick={event => {
                          event.preventDefault()
                          event.stopPropagation()
                          const target = { pageId: page.pageId, regionId: region.regionId, gapIndex, insertAfterPaperTrack, displayRole, snapIndex }
                          if (activeInsertTool === 'label-editor') {
                            openEditor(region.regionId, gapIndex, insertAfterPaperTrack, displayRole, snapIndex)
                            clearActiveInsertTool()
                            return
                          }
                          if (activeInsertTool === 'overlay-track') {
                            setInsertToolTarget(target)
                            onCreateOverlayPaperTrack({
                              x: event.clientX,
                              y: event.clientY,
                              insertAfterPaperTrack,
                              snapIndex,
                              sheetRole: displayRole,
                            })
                            clearActiveInsertTool()
                            return
                          }
                          openInsertMenu(region.regionId, gapIndex, insertAfterPaperTrack, displayRole, snapIndex)
                        }}
                        onPointerDown={event => {
                          tooltipProps.onPointerDown()
                          event.stopPropagation()
                        }}
                      />
                    )}
                  </TooltipTarget>
                  {activeInsertMenu && (
                    <div
                      className="stackGuideInsertMenu"
                      role="menu"
                      aria-label={uiText.stackGuides.insertMenuLabel}
                      onPointerDown={event => event.stopPropagation()}
                      onClick={event => event.stopPropagation()}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => openEditor(region.regionId, gapIndex, insertAfterPaperTrack, displayRole, snapIndex)}
                      >
                        {uiText.stackGuides.add}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={event => {
                          onCreateOverlayPaperTrack({
                            x: event.clientX,
                            y: event.clientY,
                            insertAfterPaperTrack,
                            snapIndex,
                            sheetRole: displayRole,
                          })
                          setInsertMenu(null)
                        }}
                      >
                        {uiText.stackGuides.addOverlayTrack}
                      </button>
                    </div>
                  )}
                  {activeEditor && (
                    <form
                      className="stackGuideEditor"
                      onSubmit={submitEditor}
                      onPointerDown={event => event.stopPropagation()}
                      onClick={event => event.stopPropagation()}
                    >
                      <input
                        ref={editorInputRef}
                        name="stackGuideLabel"
                        autoFocus
                        aria-label={uiText.stackGuides.inputLabel}
                        value={editor.value}
                        placeholder={uiText.stackGuides.placeholder}
                        onInput={event => {
                          const value = event.currentTarget.value
                          setEditor(current => current ? { ...current, value } : current)
                        }}
                        onChange={event => {
                          const value = event.currentTarget.value
                          setEditor(current => current ? { ...current, value } : current)
                        }}
                        onKeyDown={event => {
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            setEditor(null)
                          }
                        }}
                      />
                      <Tooltip label={uiText.stackGuides.confirm}>
                        <button type="submit" className="stackGuideEditorIconButton" aria-label={uiText.stackGuides.confirm}>✓</button>
                      </Tooltip>
                      <Tooltip label={uiText.stackGuides.cancel}>
                        <button type="button" className="stackGuideEditorIconButton" aria-label={uiText.stackGuides.cancel} onClick={() => setEditor(null)}>×</button>
                      </Tooltip>
                    </form>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

function StackGuideSvgLayer({
  project,
  template,
  page,
  onAssignAsset,
  onUpdateLabel,
  onPreviewPlacement,
  onClearPreview,
}: {
  project: CutProject
  template: SheetTemplate
  page: SheetPage
  onAssignAsset: (labelId: string, assetId: string) => void
  onUpdateLabel?: (labelId: string, updates: StackGuideLabelUpdates) => void
  onPreviewPlacement?: (labelId: string, clientX: number, clientY: number) => void
  onClearPreview?: () => void
}) {
  type LabelDragState = {
    pointerId: number
    labelId: string
    startX: number
    startY: number
    moved: boolean
  }
  const [dragState, setDragState] = useState<LabelDragState | null>(null)
  const dragStateRef = useRef<LabelDragState | null>(null)
  const dragSvgRef = useRef<SVGSVGElement | null>(null)
  const dragCaptureTargetRef = useRef<SVGGElement | null>(null)
  const anchorRegions = stackGuideAnchorRegions(template, page, project.logicalSheet.frameOrigin)
  const displayDurationFrames = logicalSheetDisplayDurationFrames(project.logicalSheet)
  const pageSize = resolveSheetTemplatePageSize(template, displayDurationFrames, {
    paperTracks: project.logicalSheet.paperTracks.map(track => track.paperTrack),
    layoutOverrides: project.sheetView.layoutOverrides,
  })

  const setCurrentDragState = useCallback((next: LabelDragState | null) => {
    dragStateRef.current = next
    setDragState(next)
  }, [])

  const updateLabelDragFromPoint = useCallback((pointerId: number, clientX: number, clientY: number) => {
    const current = dragStateRef.current
    if (!current || current.pointerId !== pointerId) return
    const moved = current.moved || Math.hypot(clientX - current.startX, clientY - current.startY) > 4
    if (moved) onPreviewPlacement?.(current.labelId, clientX, clientY)
    if (moved !== current.moved) setCurrentDragState({ ...current, moved })
  }, [onPreviewPlacement, setCurrentDragState])

  const finishLabelDragFromPoint = useCallback((pointerId: number, clientX: number, clientY: number, svg: SVGSVGElement | null) => {
    const current = dragStateRef.current
    if (!current || current.pointerId !== pointerId) return false
    const label = project.stackGuideLabels.find(item => item.labelId === current.labelId)
    const captureTarget = dragCaptureTargetRef.current
    if (captureTarget?.hasPointerCapture(pointerId)) {
      captureTarget.releasePointerCapture(pointerId)
    }
    dragCaptureTargetRef.current = null
    dragSvgRef.current = null
    setCurrentDragState(null)
    onClearPreview?.()
    const moved = current.moved || Math.hypot(clientX - current.startX, clientY - current.startY) > 4
    if (!moved || !onUpdateLabel || !label) return false
    const update = stackGuidePlacementUpdateFromPointer(svg, clientX, clientY, project, template, page, label)
    if (update) onUpdateLabel(label.labelId, update)
    return true
  }, [onClearPreview, onUpdateLabel, page, project, setCurrentDragState, template])

  useEffect(() => {
    if (!dragState) return
    const currentDragState = dragState
    function handlePointerMove(event: globalThis.PointerEvent) {
      updateLabelDragFromPoint(event.pointerId, event.clientX, event.clientY)
    }
    function handlePointerUp(event: globalThis.PointerEvent) {
      finishLabelDragFromPoint(event.pointerId, event.clientX, event.clientY, dragSvgRef.current)
    }
    function handlePointerCancel(event: globalThis.PointerEvent) {
      if (currentDragState.pointerId !== event.pointerId) return
      dragCaptureTargetRef.current = null
      dragSvgRef.current = null
      setCurrentDragState(null)
      onClearPreview?.()
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
    }
  }, [dragState, finishLabelDragFromPoint, onClearPreview, setCurrentDragState, updateLabelDragFromPoint])

  if (anchorRegions.length === 0) return null

  function startLabelDrag(event: PointerEvent<SVGGElement>, label: StackGuideLabel) {
    if (!onUpdateLabel) {
      event.stopPropagation()
      return
    }
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragSvgRef.current = event.currentTarget.ownerSVGElement
    dragCaptureTargetRef.current = event.currentTarget
    setCurrentDragState({
      pointerId: event.pointerId,
      labelId: label.labelId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    })
  }

  function updateLabelDrag(event: PointerEvent<SVGGElement>) {
    updateLabelDragFromPoint(event.pointerId, event.clientX, event.clientY)
  }

  function endLabelDrag(event: PointerEvent<SVGGElement>, label: StackGuideLabel) {
    if (dragStateRef.current?.labelId !== label.labelId) return false
    event.preventDefault()
    event.stopPropagation()
    return finishLabelDragFromPoint(event.pointerId, event.clientX, event.clientY, event.currentTarget.ownerSVGElement)
  }

  return (
    <g className="stackGuideSvgLayer">
      {anchorRegions.map(region => {
        const displayRole = region.grid?.role as SheetTimingRole
        const layout = resolveSheetTemplateGridLayout(template, region, {
          paperTracks: project.logicalSheet.paperTracks.map(track => track.paperTrack),
          durationFrames: displayDurationFrames,
          layoutOverrides: project.sheetView.layoutOverrides,
        })
        const columns = layout?.columns ?? []
        const rect = layout?.rect ?? resolveSheetTemplateRegionRect(template, region, displayDurationFrames)
        const gapWidthPx = stackGuideGapWidthPx(template, rect, columns, pageSize.widthPx)
        const labelsForRegion = project.stackGuideLabels.filter(label => (label.displayRole ?? 'action') === displayRole && stackGuideStackBand(label) === 'cell-interleave')
        const placementsByGap = stackGuidePlacementsByGap(template, project, labelsForRegion, gapWidthPx, columns)

        return Array.from(placementsByGap.values()).flatMap(placements => placements.map(({ label, lane }) => {
          const geometry = stackGuideSvgGeometry(template, rect, pageSize, label, lane, columns)
          const className = [
            'stackGuideLabel',
            'stackGuideSvgLabel',
            onUpdateLabel ? 'draggable' : '',
            dragState?.labelId === label.labelId ? 'dragging' : '',
            label.assetIds.length > 0 ? 'assigned' : '',
          ].filter(Boolean).join(' ')
          return (
            <g
              key={`${region.regionId}-${label.labelId}`}
              className={className}
              data-stack-guide-role={displayRole}
              data-region-id={region.regionId}
              aria-label={uiText.stackGuides.labelTitle(label.label, label.assetIds.length)}
              onPointerDown={event => startLabelDrag(event, label)}
              onPointerMove={updateLabelDrag}
              onPointerUp={event => {
                endLabelDrag(event, label)
              }}
              onPointerCancel={event => {
                if (dragStateRef.current?.pointerId === event.pointerId) {
                  setCurrentDragState(null)
                  onClearPreview?.()
                }
              }}
              onClick={event => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onDragOver={event => {
                if (!hasAssetDragPayload(event.dataTransfer)) return
                event.preventDefault()
                event.stopPropagation()
                event.dataTransfer.dropEffect = 'copy'
              }}
              onDrop={event => {
                const assetId = assetIdFromAssetDragData(event.dataTransfer)
                if (!assetId) return
                event.preventDefault()
                event.stopPropagation()
                onAssignAsset(label.labelId, assetId)
              }}
            >
              <path className="stackGuideSvgConnector" d={`M ${geometry.anchorX} ${geometry.anchorY} V ${geometry.labelBottomY} H ${geometry.labelAttachX}`} strokeWidth={geometry.connectorStrokeWidth} />
              <rect
                className="stackGuideSvgLabelBox"
                x={geometry.labelX}
                y={geometry.labelY}
                width={geometry.labelWidth}
                height={geometry.labelHeight}
                rx={geometry.radiusX}
                ry={geometry.radiusY}
              />
              <text
                className="stackGuideSvgLabelText"
                x={geometry.labelTextX}
                y={geometry.labelY + geometry.labelHeight / 2}
                dy="0.08em"
                textAnchor="start"
                dominantBaseline="middle"
                fontSize={geometry.fontSize}
              >
                {label.label}
              </text>
            </g>
          )
        }))
      })}
    </g>
  )
}

const STACK_GUIDE_EDITOR_BASE_HEIGHT_PX = 24
const STACK_GUIDE_EDITOR_LANE_HEIGHT_PX = 20
const STACK_GUIDE_MAX_LANE = 8
const STACK_GUIDE_EDITOR_WIDTH_PX = 148
const STACK_GUIDE_EDITOR_FORM_HEIGHT_PX = 36
const STACK_GUIDE_EDITOR_EDGE_MARGIN_PX = 8
const DEFAULT_STACK_GUIDE_LABEL_BASE_OFFSET_PX = 28
const DEFAULT_STACK_GUIDE_LABEL_LANE_PITCH_PX = 20
const DEFAULT_STACK_GUIDE_LABEL_HEIGHT_PX = 14
const DEFAULT_STACK_GUIDE_LABEL_MIN_WIDTH_PX = 22
const DEFAULT_STACK_GUIDE_LABEL_MAX_WIDTH_PX = 76
const DEFAULT_STACK_GUIDE_LABEL_FONT_SIZE_PX = 10.5
const DEFAULT_STACK_GUIDE_LABEL_PAGE_MARGIN_PX = 6
const DEFAULT_STACK_GUIDE_LABEL_POLE_GAP_PX = 2
const DEFAULT_STACK_GUIDE_LABEL_TEXT_PADDING_PX = 3
const DEFAULT_STACK_GUIDE_LABEL_CONNECTOR_STROKE_PX = 4
const DEFAULT_STACK_GUIDE_LABEL_CHAR_WIDTH_PX = 6
const DEFAULT_STACK_GUIDE_LABEL_RADIUS_PX = 2
const DEFAULT_STACK_GUIDE_LABEL_EXTRA_WIDTH_PX = 3
const OVERLAY_PAPER_TRACK_TOOLTIP_DELAY_MS = 650

interface StackGuideLabelMetrics {
  baseOffsetPx: number
  lanePitchPx: number
  labelHeightPx: number
  minWidthPx: number
  maxWidthPx: number
  fontSizePx: number
  pageMarginPx: number
  poleGapPx: number
  textPaddingPx: number
  connectorStrokePx: number
  estimatedCharWidthPx: number
  radiusPx: number
}

interface StackGuidePlacement {
  label: StackGuideLabel
  gapIndex: number
  widthInGaps: number
  lane: number
}

function stackGuidePlacementsByGap(template: SheetTemplate, project: CutProject, labels: StackGuideLabel[], gapWidthPx: number, columns?: Array<{ paperTrack?: string }>) {
  const placements = stackGuidePlacements(template, project, labels, gapWidthPx, columns)
  const byGap = new Map<number, StackGuidePlacement[]>()
  for (const placement of placements) {
    const gapPlacements = byGap.get(placement.gapIndex) ?? []
    gapPlacements.push(placement)
    byGap.set(placement.gapIndex, gapPlacements)
  }
  for (const gapPlacements of byGap.values()) {
    gapPlacements.sort((a, b) => a.lane - b.lane || compareStackGuideLabelsForUi(project)(a.label, b.label))
  }
  return byGap
}

function stackGuidePlacements(template: SheetTemplate, project: CutProject, labels: StackGuideLabel[], gapWidthPx: number, columns?: Array<{ paperTrack?: string }>): StackGuidePlacement[] {
  const placed: StackGuidePlacement[] = []
  for (const label of [...labels].sort(compareStackGuidePlacementPriority(project))) {
    const gapIndex = stackGuideVisibleGapIndex(project, label, columns)
    if (gapIndex === null) continue
    const widthInGaps = stackGuideLabelWidthInGaps(template, label, gapWidthPx)
    let lane = 0
    while (
      lane < STACK_GUIDE_MAX_LANE
      && placed.some(candidate => candidate.lane === lane && stackGuidePlacementsOverlap({ gapIndex, widthInGaps }, candidate))
    ) {
      lane += 1
    }
    placed.push({ label, gapIndex, widthInGaps, lane })
  }
  return placed
}

function stackGuideVisibleGapIndex(project: CutProject, label: StackGuideLabel, columns?: Array<{ paperTrack?: string }>): number | null {
  if (!columns) return stackGuideGapIndex(project, label)
  return stackGuideVisibleSnapIndex(label, columns)
}

function compareStackGuidePlacementPriority(project: CutProject) {
  const fallback = compareStackGuideLabelsForUi(project)
  return (a: StackGuideLabel, b: StackGuideLabel): number =>
    stackGuideLabelSequence(a.labelId) - stackGuideLabelSequence(b.labelId)
    || fallback(a, b)
}

function stackGuideLabelSequence(labelId: string) {
  const match = /_(\d+)$/.exec(labelId)
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

function stackGuideLabelWidthInGaps(template: SheetTemplate, label: StackGuideLabel, gapWidthPx: number) {
  return stackGuideLabelWidthPx(label, stackGuideLabelMetrics(template)) / gapWidthPx
}

function stackGuidePlacementsOverlap(
  a: Pick<StackGuidePlacement, 'gapIndex' | 'widthInGaps'>,
  b: Pick<StackGuidePlacement, 'gapIndex' | 'widthInGaps'>,
) {
  return Math.abs(a.gapIndex - b.gapIndex) < (a.widthInGaps + b.widthInGaps) / 2 + 0.18
}

function stackGuideGuideHeightPx(maxLane: number) {
  return STACK_GUIDE_EDITOR_BASE_HEIGHT_PX + Math.min(maxLane, STACK_GUIDE_MAX_LANE) * STACK_GUIDE_EDITOR_LANE_HEIGHT_PX
}

function stackGuideEditorLabelBottomPx(lane: number) {
  return STACK_GUIDE_EDITOR_BASE_HEIGHT_PX + Math.min(lane, STACK_GUIDE_MAX_LANE) * STACK_GUIDE_EDITOR_LANE_HEIGHT_PX + 4
}

function stackGuideLabelBottomPx(template: SheetTemplate, lane: number) {
  const metrics = stackGuideLabelMetrics(template)
  return metrics.baseOffsetPx + Math.min(lane, STACK_GUIDE_MAX_LANE) * metrics.lanePitchPx
}

function stackGuideEditorBottomPx(maxLane: number) {
  return stackGuideEditorLabelBottomPx(maxLane) + 28
}

function stackGuideClampedEditorBottomPx(anchorY: number, pageHeight: number, preferredBottomPx: number) {
  const maxBottomPx = anchorY * pageHeight - STACK_GUIDE_EDITOR_FORM_HEIGHT_PX - STACK_GUIDE_EDITOR_EDGE_MARGIN_PX
  return Math.max(STACK_GUIDE_EDITOR_EDGE_MARGIN_PX, Math.min(preferredBottomPx, maxBottomPx))
}

function stackGuideEditorShiftPx(anchorX: number, pageWidth: number) {
  const centerPx = anchorX * pageWidth
  const halfWidth = STACK_GUIDE_EDITOR_WIDTH_PX / 2
  if (centerPx - halfWidth < STACK_GUIDE_EDITOR_EDGE_MARGIN_PX) {
    return STACK_GUIDE_EDITOR_EDGE_MARGIN_PX - (centerPx - halfWidth)
  }
  if (centerPx + halfWidth > pageWidth - STACK_GUIDE_EDITOR_EDGE_MARGIN_PX) {
    return pageWidth - STACK_GUIDE_EDITOR_EDGE_MARGIN_PX - (centerPx + halfWidth)
  }
  return 0
}

function stackGuideHeaderReachPx(template: SheetTemplate, rect: NormalizedRect, pageHeightPx: number) {
  const headerTopOffsetPx = STANDARD_A3_GRID_HEADER_TOP_OFFSET * template.page.heightPx
  return Math.max(12, Math.min(rect.y * pageHeightPx, headerTopOffsetPx))
}

function stackGuideColumnHeaderHitPx(template: SheetTemplate, pageHeightPx: number) {
  return Math.max(8, (STANDARD_A3_GRID_HEADER_TOP_OFFSET - STANDARD_A3_GRID_HEADER_HEIGHT) * pageHeightPx)
}

function stackGuideNativeHeaderReachPx(template: SheetTemplate, rect: NormalizedRect, pageSize: { heightPx: number }) {
  return stackGuideHeaderReachPx(template, rect, pageSize.heightPx)
}

function stackGuideGapWidthPx(template: SheetTemplate, rect: NormalizedRect, columns?: Array<{ paperTrack?: string; w?: number }>, pageWidthPx = template.page.widthPx) {
  const columnCount = Math.max(1, columns?.length ?? 1)
  const averageColumnWidth = columns?.length && columns.every(column => typeof column.w === 'number')
    ? columns.reduce((total, column) => total + (column.w ?? 0), 0) / columns.length
    : rect.w / columnCount
  return Math.max(1, averageColumnWidth * pageWidthPx)
}

function stackGuideLabelMetrics(template: SheetTemplate): StackGuideLabelMetrics {
  const style = template.style?.bgBookLabel
  const targetFontSizePx = templateGridHeaderFontSizePx(template)
  const rawFontSizePx = ptToTemplatePx(template, style?.fontSizePt, DEFAULT_STACK_GUIDE_LABEL_FONT_SIZE_PX)
  const fontSizePx = Math.max(rawFontSizePx, targetFontSizePx)
  const textPaddingPx = Math.max(mmToTemplatePx(template, style?.textPaddingMm, DEFAULT_STACK_GUIDE_LABEL_TEXT_PADDING_PX), fontSizePx * 0.22)
  const labelHeightPx = Math.max(mmToTemplatePx(template, style?.labelHeightMm, DEFAULT_STACK_GUIDE_LABEL_HEIGHT_PX), fontSizePx + 4)
  const minWidthPx = Math.max(mmToTemplatePx(template, style?.minWidthMm, DEFAULT_STACK_GUIDE_LABEL_MIN_WIDTH_PX), fontSizePx + textPaddingPx * 2)
  const maxWidthPx = Math.max(mmToTemplatePx(template, style?.maxWidthMm, DEFAULT_STACK_GUIDE_LABEL_MAX_WIDTH_PX), minWidthPx, fontSizePx * 8)
  const estimatedCharWidthPx = Math.max(mmToTemplatePx(template, style?.estimatedCharWidthMm, DEFAULT_STACK_GUIDE_LABEL_CHAR_WIDTH_PX), fontSizePx * 0.56)
  return {
    baseOffsetPx: mmToTemplatePx(template, style?.baseOffsetMm, DEFAULT_STACK_GUIDE_LABEL_BASE_OFFSET_PX),
    lanePitchPx: Math.max(mmToTemplatePx(template, style?.lanePitchMm, DEFAULT_STACK_GUIDE_LABEL_LANE_PITCH_PX), labelHeightPx + 3),
    labelHeightPx,
    minWidthPx,
    maxWidthPx,
    fontSizePx,
    pageMarginPx: mmToTemplatePx(template, style?.pageMarginMm, DEFAULT_STACK_GUIDE_LABEL_PAGE_MARGIN_PX),
    poleGapPx: mmToTemplatePx(template, style?.poleGapMm, DEFAULT_STACK_GUIDE_LABEL_POLE_GAP_PX),
    textPaddingPx,
    connectorStrokePx: mmToTemplatePx(template, style?.connectorStrokeMm, DEFAULT_STACK_GUIDE_LABEL_CONNECTOR_STROKE_PX),
    estimatedCharWidthPx,
    radiusPx: mmToTemplatePx(template, style?.radiusMm, DEFAULT_STACK_GUIDE_LABEL_RADIUS_PX),
  }
}

function stackGuideTemplateDpi(template: SheetTemplate): number | undefined {
  return template.style?.bgBookLabel?.designDpi ?? template.page.dpi
}

function mmToTemplatePx(template: SheetTemplate, mm: number | undefined, fallbackPx: number): number {
  const dpi = stackGuideTemplateDpi(template)
  return mm !== undefined && dpi ? (mm * dpi) / 25.4 : fallbackPx
}

function ptToTemplatePx(template: SheetTemplate, pt: number | undefined, fallbackPx: number): number {
  const dpi = stackGuideTemplateDpi(template)
  return pt !== undefined && dpi ? (pt * dpi) / 72 : fallbackPx
}

function stackGuideLabelWidthPx(label: Pick<StackGuideLabel, 'label'>, metrics: StackGuideLabelMetrics) {
  return Math.min(metrics.maxWidthPx, Math.max(metrics.minWidthPx, estimatedLabelTextWidthPx(label.label, metrics) + metrics.textPaddingPx * 2 + DEFAULT_STACK_GUIDE_LABEL_EXTRA_WIDTH_PX))
}

function estimatedLabelTextWidthPx(text: string, metrics: Pick<StackGuideLabelMetrics, 'fontSizePx' | 'estimatedCharWidthPx'>): number {
  return Array.from(text).reduce((width, char) => width + estimatedLabelCharWidthPx(char, metrics), 0)
}

function estimatedLabelCharWidthPx(char: string, metrics: Pick<StackGuideLabelMetrics, 'fontSizePx' | 'estimatedCharWidthPx'>): number {
  if (/[\u3000-\u9fff\u3040-\u30ff\uff00-\uffef]/u.test(char)) return metrics.fontSizePx * 0.92
  if (/[ilI1|]/.test(char)) return metrics.fontSizePx * 0.34
  if (/[MW@%]/.test(char)) return metrics.fontSizePx * 0.78
  if (/[A-Z0-9]/.test(char)) return metrics.fontSizePx * 0.52
  if (/[a-z]/.test(char)) return metrics.fontSizePx * 0.48
  if (/\s/.test(char)) return metrics.fontSizePx * 0.32
  return Math.min(metrics.estimatedCharWidthPx, metrics.fontSizePx * 0.56)
}

function stackGuideSvgGeometry(template: SheetTemplate, rect: NormalizedRect, pageSize: { widthPx: number; heightPx: number }, label: StackGuideLabel, lane: number, columns: Array<{ paperTrack?: string; x?: number; w?: number }> = []) {
  const metrics = stackGuideLabelMetrics(template)
  const snapIndex = stackGuideVisibleSnapIndex(label, columns)
  const anchorX = stackGuideSnapX(rect, columns, snapIndex)
  const anchorY = rect.y
  const labelWidth = stackGuideLabelWidthPx(label, metrics) / pageSize.widthPx
  const labelHeight = metrics.labelHeightPx / pageSize.heightPx
  const labelPoleGap = metrics.poleGapPx / pageSize.widthPx
  const labelTextPadding = metrics.textPaddingPx / pageSize.widthPx
  const pageMargin = metrics.pageMarginPx / pageSize.widthPx
  const labelBottomOffset = (stackGuideNativeHeaderReachPx(template, rect, pageSize) + stackGuideLabelBottomPx(template, lane)) / pageSize.heightPx
  const desiredLabelX = anchorX + labelPoleGap
  const labelX = clampNumber(desiredLabelX, pageMargin, 1 - pageMargin - labelWidth)
  const labelAttachX = labelX >= anchorX ? labelX : labelX + labelWidth
  const labelBottomY = anchorY - labelBottomOffset
  const labelY = labelBottomY - labelHeight
  return {
    anchorX,
    anchorY,
    labelX,
    labelY,
    labelAttachX,
    labelTextX: labelX + labelTextPadding,
    labelBottomY,
    labelWidth,
    labelHeight,
    fontSize: metrics.fontSizePx / pageSize.heightPx,
    radiusX: metrics.radiusPx / pageSize.widthPx,
    radiusY: metrics.radiusPx / pageSize.heightPx,
    connectorStrokeWidth: metrics.connectorStrokePx / pageSize.heightPx,
  }
}

function stackGuideSnapX(rect: NormalizedRect, columns: Array<{ x?: number; w?: number }>, snapIndex: number): number {
  const columnCount = Math.max(1, columns.length)
  if (columns.length > 0 && columns.every(column => typeof column.x === 'number' && typeof column.w === 'number')) {
    const first = columns[0]!
    const last = columns[columns.length - 1]!
    if (snapIndex <= 0) return (first.x ?? rect.x) - (first.w ?? rect.w / columnCount)
    if (snapIndex >= columns.length + 1) return (last.x ?? rect.x) + (last.w ?? rect.w / columnCount)
    const previous = columns[snapIndex - 1]
    return previous ? (previous.x ?? rect.x) + (previous.w ?? rect.w / columnCount) : rect.x
  }
  return rect.x + (rect.w * (snapIndex - 1)) / columnCount
}

function stackGuideAnchorRegions(template: SheetTemplate, page: SheetPage, frameOrigin: number) {
  if (frameOrigin < page.frameStart || frameOrigin > page.frameEnd) return []
  return template.regions.filter(region => {
    if (region.type !== 'exposure-grid' || !region.grid) return false
    if (region.grid.role !== 'action' && region.grid.role !== 'cell') return false
    if (region.grid.columns.length === 0) return false
    const frames = resolveSheetTemplateGridFrames(template, region.grid, page.frameEnd - page.frameStart + 1, frameOrigin)
    return frameOrigin >= frames.frameStart && frameOrigin <= frames.frameEnd
  })
}

function stackGuideInsertionTargets(
  template: SheetTemplate,
  project: CutProject,
  displayRole: SheetTimingRole,
  regionId: string,
  rect: NormalizedRect,
  columns: Array<{ paperTrack?: string }>,
) {
  const fallbackColumnWidth = rect.w / Math.max(1, columns.length)
  const segment = overlayBandSegmentForRegion(template, project, displayRole, regionId)
  const minX = segment?.minX ?? rect.x
  const columnWidth = segment?.columnWidth ?? fallbackColumnWidth
  const snapCount = segment?.snapCount ?? columns.length + 1
  return Array.from({ length: snapCount + 1 }, (_, snapIndex) => {
    const gapIndex = stackGuideGapIndexFromSnapIndex(snapIndex, columns.length)
    return {
      snapIndex,
      gapIndex,
      insertAfterPaperTrack: stackGuideInsertAfterPaperTrackFromGap(columns, gapIndex),
      x: minX + columnWidth * snapIndex,
    }
  })
}

type StackGuideInsertHitMode = 'header' | 'page'

function stackGuideInsertTargetFromPoint(
  template: SheetTemplate,
  project: CutProject,
  page: SheetPage,
  point: NormalizedPoint,
  hitMode: StackGuideInsertHitMode = 'header',
): StackGuideInsertTarget | null {
  const anchorRegions = stackGuideAnchorRegions(template, page, project.logicalSheet.frameOrigin)
  const displayDurationFrames = logicalSheetDisplayDurationFrames(project.logicalSheet)
  const paperTracks = project.logicalSheet.paperTracks.map(track => track.paperTrack)
  const pageSize = resolveSheetTemplatePageSize(template, displayDurationFrames, {
    paperTracks,
    layoutOverrides: project.sheetView.layoutOverrides,
  })
  const candidates: Array<StackGuideInsertTarget & { score: number }> = []

  for (const region of anchorRegions) {
    if (!region.grid) continue
    const displayRole = region.grid.role as SheetTimingRole
    const layout = resolveSheetTemplateGridLayout(template, region, {
      paperTracks,
      durationFrames: displayDurationFrames,
      layoutOverrides: project.sheetView.layoutOverrides,
    })
    if (!layout || layout.columns.length === 0) continue
    const columns = layout.columns
    const rect = layout.rect
    const targets = stackGuideInsertionTargets(template, project, displayRole, region.regionId, rect, columns)
    if (targets.length === 0) continue
    const minX = Math.min(...targets.map(target => target.x))
    const maxX = Math.max(...targets.map(target => target.x))
    if (hitMode === 'header' && (point.x < minX || point.x > maxX)) continue

    const headerReach = stackGuideNativeHeaderReachPx(template, rect, pageSize) / pageSize.heightPx
    const columnHeaderHit = stackGuideColumnHeaderHitPx(template, pageSize.heightPx) / pageSize.heightPx
    const headerTop = rect.y - headerReach
    const headerBottom = rect.y - columnHeaderHit
    if (hitMode === 'header' && (point.y < headerTop || point.y > headerBottom)) continue

    const nearestTarget = targets.reduce((nearest, target) =>
      Math.abs(point.x - target.x) < Math.abs(point.x - nearest.x) ? target : nearest,
    )
    const outsideX = point.x < rect.x ? rect.x - point.x : point.x > rect.x + rect.w ? point.x - (rect.x + rect.w) : 0
    const outsideHeaderOrGridY = point.y < headerTop ? headerTop - point.y : point.y > rect.y + rect.h ? point.y - (rect.y + rect.h) : 0
    const xDistance = Math.abs(point.x - nearestTarget.x)
    const score = hitMode === 'header'
      ? outsideX
      : xDistance * 0.65 + outsideX * 0.35 + outsideHeaderOrGridY * 1.8 + Math.abs(point.y - rect.y) * 0.2
    candidates.push({
      pageId: page.pageId,
      regionId: region.regionId,
      gapIndex: nearestTarget.gapIndex,
      insertAfterPaperTrack: nearestTarget.insertAfterPaperTrack,
      displayRole,
      snapIndex: nearestTarget.snapIndex,
      score,
    })
  }

  const [target] = candidates.sort((a, b) => a.score - b.score)
  if (!target) return null
  return {
    pageId: target.pageId,
    regionId: target.regionId,
    gapIndex: target.gapIndex,
    insertAfterPaperTrack: target.insertAfterPaperTrack,
    displayRole: target.displayRole,
    snapIndex: target.snapIndex,
  }
}

function defaultStackGuideInsertTarget(template: SheetTemplate, project: CutProject, page: SheetPage): StackGuideInsertTarget | null {
  const displayDurationFrames = logicalSheetDisplayDurationFrames(project.logicalSheet)
  const paperTracks = project.logicalSheet.paperTracks.map(track => track.paperTrack)
  const anchorRegions = stackGuideAnchorRegions(template, page, project.logicalSheet.frameOrigin)
  const region = anchorRegions.find(item => item.grid?.role === 'action') ?? anchorRegions.find(item => item.grid)
  if (!region?.grid) return null
  const displayRole = region.grid.role as SheetTimingRole
  const layout = resolveSheetTemplateGridLayout(template, region, {
    paperTracks,
    durationFrames: displayDurationFrames,
    layoutOverrides: project.sheetView.layoutOverrides,
  })
  if (!layout || layout.columns.length === 0) return null
  const columns = layout.columns
  const rect = layout.rect
  const targets = stackGuideInsertionTargets(template, project, displayRole, region.regionId, rect, columns)
  const target = targets.find(item => item.snapIndex === 1) ?? targets[0]
  return target
    ? {
        pageId: page.pageId,
        regionId: region.regionId,
        gapIndex: target.gapIndex,
        insertAfterPaperTrack: target.insertAfterPaperTrack,
        displayRole,
        snapIndex: target.snapIndex,
      }
    : null
}

function overlayBandSegmentForRegion(template: SheetTemplate, project: CutProject, role: SheetTimingRole, regionId: string) {
  return overlayBandSegments(template, project, role).find(segment => segment.regionId === regionId) ?? null
}

function stackGuideGapIndexFromSnapIndex(snapIndex: number, columnCount: number): number {
  return clampNumber(Math.round(snapIndex) - 1, 0, columnCount)
}

function stackGuideInsertAfterPaperTrackFromGap(columns: Array<{ paperTrack?: string }>, gapIndex: number): string | undefined {
  return gapIndex > 0 ? columns[gapIndex - 1]?.paperTrack : undefined
}

function stackGuideVisibleSnapIndex(label: StackGuideLabel, columns: Array<{ paperTrack?: string }>): number {
  if (Number.isFinite(label.viewSnapIndex)) return clampNumber(Math.round(label.viewSnapIndex as number), 0, Number.MAX_SAFE_INTEGER)
  if (label.insertAfterPaperTrack) {
    const trackIndex = columns.findIndex(column => column.paperTrack === label.insertAfterPaperTrack)
    if (trackIndex >= 0) return trackIndex + 2
  }
  return clampNumber(Math.round(label.gapIndex) + 1, 0, columns.length + 1)
}

function stackGuidePlacementUpdateFromPointer(
  svg: SVGSVGElement | null,
  clientX: number,
  clientY: number,
  project: CutProject,
  template: SheetTemplate,
  page: SheetPage,
  label: StackGuideLabel,
): StackGuideLabelUpdates | null {
  const target = stackGuidePlacementTargetFromPointer(svg, clientX, clientY, project, template, page)
  if (!target) return null
  const orderInGap = nextStackGuideOrderInGap(project, label.labelId, target.displayRole, target.gapIndex, target.columns)
  return {
    displayRole: target.displayRole,
    gapIndex: target.gapIndex,
    insertAfterPaperTrack: target.insertAfterPaperTrack ?? '',
    viewSnapIndex: target.snapIndex,
    orderInGap,
  }
}

function stackGuidePlacementTargetFromPointer(
  svg: SVGSVGElement | null,
  clientX: number,
  clientY: number,
  project: CutProject,
  template: SheetTemplate,
  page: SheetPage,
): (StackGuideInsertTarget & { columns: Array<{ paperTrack?: string }> }) | null {
  if (!svg) return null
  const box = svg.getBoundingClientRect()
  if (box.width <= 0 || box.height <= 0) return null
  const point = {
    x: clampNumber((clientX - box.left) / box.width, 0, 1),
    y: clampNumber((clientY - box.top) / box.height, 0, 1),
  }
  const displayDurationFrames = logicalSheetDisplayDurationFrames(project.logicalSheet)
  const trackNames = project.logicalSheet.paperTracks.map(track => track.paperTrack)
  type StackGuideDropCandidate = {
    role: SheetTimingRole
    regionId: string
    columns: Array<{ paperTrack?: string }>
    rect: NormalizedRect
    score: number
  }
  const candidates = stackGuideAnchorRegions(template, page, project.logicalSheet.frameOrigin)
    .flatMap((region): StackGuideDropCandidate[] => {
      if (!region.grid) return []
      const role = region.grid.role as SheetTimingRole
      const layout = resolveSheetTemplateGridLayout(template, region, {
        paperTracks: trackNames,
        durationFrames: displayDurationFrames,
        layoutOverrides: project.sheetView.layoutOverrides,
      })
      if (!layout || layout.columns.length === 0) return []
      const columns = layout.columns
      const rect = layout.rect
      const outsideX = point.x < rect.x ? rect.x - point.x : point.x > rect.x + rect.w ? point.x - (rect.x + rect.w) : 0
      const outsideY = point.y < rect.y ? rect.y - point.y : point.y > rect.y + rect.h ? point.y - (rect.y + rect.h) : 0
      return [{ role, regionId: region.regionId, columns, rect, score: Math.abs(point.y - rect.y) + outsideX * 0.65 + outsideY * 1.8 }]
    })
    .sort((a, b) => a.score - b.score)
  const target = candidates[0]
  if (!target) return null
  const segment = overlayBandSegmentForRegion(template, project, target.role, target.regionId)
  const snapIndex = overlaySnapIndexFromSegment(point.x, segment)
  const gapIndex = stackGuideGapIndexFromSnapIndex(snapIndex, target.columns.length)
  const insertAfterPaperTrack = stackGuideInsertAfterPaperTrackFromGap(target.columns, gapIndex)
  return {
    pageId: page.pageId,
    regionId: target.regionId,
    displayRole: target.role,
    gapIndex,
    insertAfterPaperTrack,
    snapIndex,
    columns: target.columns,
  }
}

function nextStackGuideOrderInGap(
  project: CutProject,
  movedLabelId: string,
  displayRole: SheetTimingRole,
  gapIndex: number,
  columns: Array<{ paperTrack?: string }>,
): number {
  const orders = project.stackGuideLabels
    .filter(label =>
      label.labelId !== movedLabelId
      && stackGuideStackBand(label) === 'cell-interleave'
      && (label.displayRole ?? 'action') === displayRole
      && stackGuideVisibleGapIndex(project, label, columns) === gapIndex,
    )
    .map(label => label.orderInGap)
  return orders.length > 0 ? Math.max(...orders) + 1 : 0
}

function CellAssetPreview({ position, items }: { position: { left: number; top: number; width: number; maxHeight: number; visibleCount: number }; items: CellAssetPreviewItem[] }) {
  const previewItems = items.slice(0, Math.min(CELL_ASSET_PREVIEW_MAX_ITEMS, position.visibleCount))
  const hiddenCount = Math.max(0, items.length - previewItems.length)
  const className = items.length === 1 ? 'cellAssetPreviewPanel single' : 'cellAssetPreviewPanel grid'
  return (
    <div className={className} style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight }}>
      <div className="cellAssetPreviewTitle">{uiText.sheet.registeredAssetsCount(items.length)}</div>
      <div className="cellAssetPreviewList">
        {previewItems.map(item => (
          <TooltipTarget key={item.bindingId} label={`${item.processLabel}: ${item.cspCellName}`}>
            {tooltipProps => (
              <div className="cellAssetPreviewItem" {...tooltipProps}>
                {item.thumbnailUrl
                  ? <img src={item.thumbnailUrl} alt="" />
                  : <div className="cellAssetPreviewThumbFallback">{uiText.app.noPreview}</div>}
                <div className="cellAssetPreviewMeta">
                  <span className="cellAssetPreviewProcess">{item.processLabel}</span>
                  <strong>{item.cspCellName}</strong>
                </div>
              </div>
            )}
          </TooltipTarget>
        ))}
        {hiddenCount > 0 && <div className="cellAssetPreviewMore">{uiText.sheet.moreRegisteredAssets(hiddenCount)}</div>}
      </div>
    </div>
  )
}

function AssetDropProcessMenu({
  state,
  project,
  onSelect,
  onCancel,
}: {
  state: AssetDropMenuState
  project: CutProject
  onSelect: (slotId: string) => void
  onCancel: () => void
}) {
  const asset = project.assets.find(item => item.assetId === state.assetId)
  const key = project.logicalSheet.keys.find(item => item.keyId === state.keyId)
  if (!asset || !key) return null
  const options = processSlotsForKey(project, key)
  if (options.length === 0) return null
  const position = assetDropMenuPosition(state, options.length)

  return (
    <div
      className="sheetContextMenu assetDropMenu"
      role="menu"
      style={{ left: position.left, top: position.top }}
      onPointerDown={event => event.stopPropagation()}
      onContextMenu={event => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <div className="assetDropMenuTitle">{uiText.assetDrop.title}</div>
      <Tooltip label={`${sheetRoleLabel(sheetTimingRoleForKey(key))} ${key.paperTrack} ${key.displayLabel} / ${asset.displayName}`}>
        <div className="assetDropMenuMeta">
          <strong>{sheetRoleLabel(sheetTimingRoleForKey(key))} {key.paperTrack} {key.displayLabel || uiText.assetDrop.untitledCell}</strong>
          <span>{asset.displayName}</span>
        </div>
      </Tooltip>
      {options.map(({ slot, label, bindingAsset }) => (
        <button key={slot.slotId} role="menuitem" onClick={() => onSelect(slot.slotId)}>
          <span>{bindingAsset ? uiText.assetDrop.overwrite(label) : uiText.assetDrop.register(label)}</span>
          <small>{bindingAsset ? bindingAsset.displayName : slot.displayPath}</small>
        </button>
      ))}
      <button role="menuitem" onClick={onCancel}>
        <span>{uiText.assetDrop.cancel}</span>
      </button>
    </div>
  )
}

function ProcessMoveMenu({
  project,
  keyId,
  sourceSlotId,
  x,
  y,
  onSelect,
  onCancel,
}: {
  project: CutProject
  keyId: string
  sourceSlotId: string
  x: number
  y: number
  onSelect: (targetCorrectionLayerId: string) => void
  onCancel: () => void
}) {
  const sourceSlot = project.cspTrackSlots.find(slot => slot.slotId === sourceSlotId)
  if (!sourceSlot) return null
  const sourceLabel = processLabelForSlot(project, sourceSlot)
  const options = processMoveOptionsForSlot(project, sourceSlot, keyId)
  if (options.length === 0) return null
  const position = assetDropMenuPosition({ x, y }, options.length + 1)

  return (
    <div
      className="sheetContextMenu assetDropMenu processMoveMenu"
      role="menu"
      style={{ left: position.left, top: position.top }}
      onPointerDown={event => event.stopPropagation()}
      onContextMenu={event => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <div className="assetDropMenuTitle">{uiText.processMove.title}</div>
      <div className="assetDropMenuMeta">
        <strong>{uiText.processMove.current(sourceLabel)}</strong>
      </div>
      {options.map(({ layer, targetSlot, existingTargetBinding }) => (
        <button key={layer.layerId} role="menuitem" onClick={() => onSelect(layer.layerId)}>
          <span>{uiText.processMove.moveTo(layer.label)}</span>
          <small>{existingTargetBinding ? uiText.processMove.occupied : targetSlot.displayPath}</small>
        </button>
      ))}
      <button role="menuitem" onClick={onCancel}>
        <span>{uiText.assetDrop.cancel}</span>
      </button>
    </div>
  )
}

function processSlotsForKey(project: CutProject, key: Pick<TimingKey, 'keyId' | 'paperTrack'>) {
  const correctionLayerOrder = new Map(sortedCorrectionLayers(project).map((layer, index) => [layer.layerId, index]))
  return project.cspTrackSlots
    .filter(slot => slot.paperTrack === key.paperTrack)
    .map(slot => {
      const binding = project.bindings.find(item => item.slotId === slot.slotId && item.keyId === key.keyId)
      const bindingAsset = binding?.assetId ? project.assets.find(asset => asset.assetId === binding.assetId) ?? null : null
      return {
        slot,
        bindingAsset,
        label: processLabelForSlot(project, slot),
      }
    })
    .sort((a, b) =>
      (correctionLayerOrder.get(a.slot.correctionLayerId ?? '') ?? 999) - (correctionLayerOrder.get(b.slot.correctionLayerId ?? '') ?? 999)
      || a.slot.trackNo - b.slot.trackNo
      || a.slot.occurrenceIndex - b.slot.occurrenceIndex
      || a.slot.displayPath.localeCompare(b.slot.displayPath, 'ja'),
    )
}

function processLabelForSlot(project: CutProject, slot: CspTrackSlot): string {
  return slot.correctionLayerId
    ? project.correctionLayers.find(layer => layer.layerId === slot.correctionLayerId)?.label ?? slot.displayPath
    : slot.displayPath
}

type BindingProcessMoveTarget = {
  sourceSlot: CspTrackSlot
  targetSlot: CspTrackSlot
  existingTargetBinding: CellBinding | undefined
  sourceLabel: string
  targetLabel: string
}

function bindingProcessMoveTarget(
  project: CutProject,
  keyId: string,
  sourceSlotId: string,
  targetCorrectionLayerId: string,
): BindingProcessMoveTarget | null {
  const sourceSlot = project.cspTrackSlots.find(slot => slot.slotId === sourceSlotId)
  if (!sourceSlot) return null
  const targetSlot = project.cspTrackSlots.find(slot =>
    slot.paperTrack === sourceSlot.paperTrack
    && slot.correctionLayerId === targetCorrectionLayerId,
  )
  if (!targetSlot) return null
  return {
    sourceSlot,
    targetSlot,
    existingTargetBinding: project.bindings.find(binding => binding.keyId === keyId && binding.slotId === targetSlot.slotId),
    sourceLabel: processLabelForSlot(project, sourceSlot),
    targetLabel: processLabelForSlot(project, targetSlot),
  }
}

function processMoveOptionsForSlot(project: CutProject, sourceSlot: CspTrackSlot, keyId: string) {
  const layersById = new Map(project.correctionLayers.map(layer => [layer.layerId, layer]))
  return sortedCorrectionLayers(project)
    .flatMap(layer => {
      if (layer.layerId === sourceSlot.correctionLayerId) return []
      const target = bindingProcessMoveTarget(project, keyId, sourceSlot.slotId, layer.layerId)
      if (!target) return []
      return [{
        layer: layersById.get(layer.layerId) ?? layer,
        targetSlot: target.targetSlot,
        existingTargetBinding: target.existingTargetBinding,
      }]
    })
}

function assetDropMenuPosition(anchor: { x: number; y: number }, itemCount: number) {
  const width = 280
  const estimatedHeight = Math.min(420, 86 + itemCount * 46)
  const padding = 12
  const viewportWidth = window.innerWidth || width + padding * 2
  const viewportHeight = window.innerHeight || estimatedHeight + padding * 2
  return {
    left: clampNumber(anchor.x, padding, Math.max(padding, viewportWidth - width - padding)),
    top: clampNumber(anchor.y, padding, Math.max(padding, viewportHeight - estimatedHeight - padding)),
  }
}

type BindingCloneSpec = {
  slotId: string
  cspCellName: string
  assetId?: string
  materialState: CellBinding['materialState']
}

function assignRegisteredCellKeyToHit(project: CutProject, keyId: string, hit: SheetHit, fontSizePx?: number): { project: CutProject; keyId: string | null } {
  if (!hit.paperTrack) return { project, keyId: null }
  const sourceKey = project.logicalSheet.keys.find(key => key.keyId === keyId)
  if (!sourceKey) return { project, keyId: null }
  const sheetRole = sheetRoleForHit(hit)
  if (sheetTimingRoleForKey(sourceKey) !== sheetRole) return { project, keyId: null }

  if (sourceKey.paperTrack === hit.paperTrack) {
    return {
      project: setEvent(project, hit.paperTrack, hit.frame, sourceKey.keyId, sheetRole, { fontSizePx }),
      keyId: sourceKey.keyId,
    }
  }

  const reusableKey = findReusableRegisteredCellClone(project, sourceKey, hit.paperTrack, sheetRole)
  if (reusableKey) {
    return {
      project: setEvent(project, hit.paperTrack, hit.frame, reusableKey.keyId, sheetRole, { fontSizePx }),
      keyId: reusableKey.keyId,
    }
  }

  const created = createKey(project, hit.paperTrack, sourceKey.displayLabel || undefined, sourceKey.createdFrom, sourceKey.paperToken, sheetRole)
  let next = updateKey(created.project, created.key.keyId, { displayLabel: sourceKey.displayLabel, paperToken: sourceKey.paperToken })
  for (const spec of bindingCloneSpecsForTarget(project, sourceKey, hit.paperTrack)) {
    next = upsertBinding(next, {
      ...spec,
      keyId: created.key.keyId,
    })
  }
  return {
    project: setEvent(next, hit.paperTrack, hit.frame, created.key.keyId, sheetRole, { fontSizePx }),
    keyId: created.key.keyId,
  }
}

function findReusableRegisteredCellClone(
  project: CutProject,
  sourceKey: TimingKey,
  targetPaperTrack: string,
  sheetRole: SheetTimingRole,
): TimingKey | null {
  const expectedSignature = bindingCloneSignature(bindingCloneSpecsForTarget(project, sourceKey, targetPaperTrack))
  return project.logicalSheet.keys.find(candidate => {
    if (candidate.paperTrack !== targetPaperTrack) return false
    if (sheetTimingRoleForKey(candidate) !== sheetRole) return false
    if (candidate.displayLabel !== sourceKey.displayLabel) return false
    if ((candidate.paperToken ?? '') !== (sourceKey.paperToken ?? '')) return false
    return bindingCloneSignature(bindingCloneSpecsForExistingKey(project, candidate.keyId, targetPaperTrack)) === expectedSignature
  }) ?? null
}

function bindingCloneSpecsForTarget(project: CutProject, sourceKey: TimingKey, targetPaperTrack: string): BindingCloneSpec[] {
  const usedTargetSlotIds = new Set<string>()
  return project.bindings
    .flatMap(binding => {
      if (binding.keyId !== sourceKey.keyId) return []
      const sourceSlot = project.cspTrackSlots.find(slot => slot.slotId === binding.slotId)
      if (!sourceSlot) return []
      const targetSlot = correspondingSlotForPaperTrack(project, sourceSlot, targetPaperTrack)
      if (!targetSlot || usedTargetSlotIds.has(targetSlot.slotId)) return []
      usedTargetSlotIds.add(targetSlot.slotId)
      return [{
        slotId: targetSlot.slotId,
        cspCellName: binding.cspCellName,
        assetId: binding.assetId,
        materialState: binding.materialState,
      }]
    })
    .sort(compareBindingCloneSpecs)
}

function bindingCloneSpecsForExistingKey(project: CutProject, keyId: string, paperTrack: string): BindingCloneSpec[] {
  return project.bindings
    .flatMap(binding => {
      if (binding.keyId !== keyId) return []
      const slot = project.cspTrackSlots.find(item => item.slotId === binding.slotId)
      if (!slot || slot.paperTrack !== paperTrack) return []
      return [{
        slotId: binding.slotId,
        cspCellName: binding.cspCellName,
        assetId: binding.assetId,
        materialState: binding.materialState,
      }]
    })
    .sort(compareBindingCloneSpecs)
}

function correspondingSlotForPaperTrack(project: CutProject, sourceSlot: CspTrackSlot, targetPaperTrack: string): CspTrackSlot | null {
  const candidates = project.cspTrackSlots.filter(slot => slot.paperTrack === targetPaperTrack)
  return candidates.find(slot => slot.correctionLayerId === sourceSlot.correctionLayerId && slot.occurrenceIndex === sourceSlot.occurrenceIndex)
    ?? candidates.find(slot => slot.correctionLayerId === sourceSlot.correctionLayerId && slot.stageId === sourceSlot.stageId)
    ?? candidates.find(slot => slot.correctionLayerId === sourceSlot.correctionLayerId)
    ?? candidates.find(slot => slot.occurrenceIndex === sourceSlot.occurrenceIndex && slot.trackNo === sourceSlot.trackNo)
    ?? candidates[0]
    ?? null
}

function bindingCloneSignature(specs: BindingCloneSpec[]): string {
  return specs
    .map(spec => `${spec.slotId}\u0000${spec.cspCellName}\u0000${spec.assetId ?? ''}\u0000${spec.materialState}`)
    .join('\u0001')
}

function compareBindingCloneSpecs(a: BindingCloneSpec, b: BindingCloneSpec): number {
  return a.slotId.localeCompare(b.slotId, 'ja')
    || a.cspCellName.localeCompare(b.cspCellName, 'ja')
    || (a.assetId ?? '').localeCompare(b.assetId ?? '', 'ja')
    || a.materialState.localeCompare(b.materialState, 'ja')
}

function AutoCalibrationGuideOverlay({
  overlay,
  imageSettings,
}: {
  overlay: AutoCalibrationOverlayState
  imageSettings: SheetImageSettings
}) {
  const detectedPoints = overlay.detectedQuad.map(point => rawImageToViewportPoint(point, imageSettings))
  return (
    <g className="autoCalibrationGuideOverlay" data-method={overlay.method} aria-hidden="true">
      <polygon className="autoCalibrationExpectedQuad" points={normalizedPolygonPoints(overlay.targetQuad)} />
      <polygon className="autoCalibrationDetectedQuad" points={normalizedPolygonPoints(detectedPoints)} />
    </g>
  )
}

function normalizedPolygonPoints(points: NormalizedPoint[]): string {
  return points.map(point => `${point.x},${point.y}`).join(' ')
}

function CalibrationQuadEditor({
  points,
  imageSettings,
  metrics,
  onHandlePointerDown,
}: {
  points: SheetCalibrationPointPair[]
  imageSettings: SheetImageSettings
  metrics: CalibrationGuideMetrics
  onHandlePointerDown: (event: PointerEvent<SVGElement>, index: number, kind: CalibrationPointKind) => void
}) {
  const sourcePoints = points.map(point => rawImageToViewportPoint(point.source, imageSettings))
  const pointKind: CalibrationPointKind = 'source'

  return (
    <g>
      {sourcePoints.map((point, index) => (
        <g key={points[index].pointId}>
          <path className="calibrationTrimMark source" d={calibrationTrimMarkPath(point, index, metrics)} style={{ strokeWidth: `${metrics.trimStrokePx}px` }} />
          <path className="calibrationHandleMark source" d={calibrationHandlePath(point, metrics)} style={{ strokeWidth: `${metrics.handleStrokePx}px` }} />
          <ellipse
            className="calibrationHandle source"
            cx={point.x}
            cy={point.y}
            rx={metrics.hitRadiusX}
            ry={metrics.hitRadiusY}
            onPointerDown={event => onHandlePointerDown(event, index, pointKind)}
          />
        </g>
      ))}
    </g>
  )
}

function calibrationGuideMetrics(template: SheetTemplate, pageSize: { widthPx: number; heightPx: number }): CalibrationGuideMetrics {
  const dpi = template.page.dpi ?? 150
  const pxPerMm = dpi / 25.4
  const handleStrokePx = clampNumber(pxPerMm * 0.18, 0.85, 1.35)
  const handleOuterPx = clampNumber(pxPerMm * 1.6, 8, 16)
  const handleInnerPx = clampNumber(pxPerMm * 0.55, 3, 6)
  const trimOuterPx = clampNumber(pxPerMm * 5.5, 24, 48)
  const trimStrokePx = clampNumber(pxPerMm * 0.24, 1.1, 1.8)
  const hitRadiusPx = clampNumber(pxPerMm * 2.2, 12, 24)

  return {
    handleStrokePx,
    handleOuterX: handleOuterPx / pageSize.widthPx,
    handleOuterY: handleOuterPx / pageSize.heightPx,
    handleInnerX: handleInnerPx / pageSize.widthPx,
    handleInnerY: handleInnerPx / pageSize.heightPx,
    trimOuterX: trimOuterPx / pageSize.widthPx,
    trimOuterY: trimOuterPx / pageSize.heightPx,
    trimStrokePx,
    hitRadiusX: hitRadiusPx / pageSize.widthPx,
    hitRadiusY: hitRadiusPx / pageSize.heightPx,
  }
}

function calibrationTrimMarkPath(point: NormalizedPoint, index: number, metrics: CalibrationGuideMetrics): string {
  const horizontalDirection = index === 1 || index === 2 ? -1 : 1
  const verticalDirection = index >= 2 ? -1 : 1
  const xEnd = point.x + metrics.trimOuterX * horizontalDirection
  const yEnd = point.y + metrics.trimOuterY * verticalDirection
  return [
    `M ${point.x} ${point.y} L ${xEnd} ${point.y}`,
    `M ${point.x} ${point.y} L ${point.x} ${yEnd}`,
  ].join(' ')
}

function calibrationHandlePath(point: NormalizedPoint, metrics: CalibrationGuideMetrics): string {
  return [
    `M ${point.x - metrics.handleOuterX} ${point.y} L ${point.x - metrics.handleInnerX} ${point.y}`,
    `M ${point.x + metrics.handleInnerX} ${point.y} L ${point.x + metrics.handleOuterX} ${point.y}`,
    `M ${point.x} ${point.y - metrics.handleOuterY} L ${point.x} ${point.y - metrics.handleInnerY}`,
    `M ${point.x} ${point.y + metrics.handleInnerY} L ${point.x} ${point.y + metrics.handleOuterY}`,
  ].join(' ')
}

const TemplateChrome = memo(function TemplateChrome({
  template,
  paperTracks = template.defaults.paperTracks,
  durationFrames = template.defaults.durationFrames,
}: {
  template: SheetTemplate
  paperTracks?: string[]
  durationFrames?: number
}) {
  const model = useMemo(
    () => buildTemplateChromeRenderModel(template, paperTracks, durationFrames),
    [durationFrames, paperTracks, template],
  )
  return <TemplateChromeLayer model={model} />
})

const GridOverlay = memo(function GridOverlay({
  template,
  region,
  paperTracks = template.defaults.paperTracks,
  durationFrames = template.defaults.durationFrames,
  frameOrigin = template.defaults.frameOrigin,
}: {
  template: SheetTemplate
  region: SheetTemplate['regions'][number]
  paperTracks?: string[]
  durationFrames?: number
  frameOrigin?: number
}) {
  const model = useMemo(
    () => buildTemplateGridOverlayRenderModel(template, region, { paperTracks, durationFrames, frameOrigin }),
    [durationFrames, frameOrigin, paperTracks, region, template],
  )
  return model ? <GridOverlayLayer model={model} /> : null
})

function MetadataTextLayer({ context, page }: { context: SheetRenderModelContext; page: SheetPage }) {
  const items = metadataTextRenderItemsForPage(context, page)
  if (items.length === 0) return null
  return (
    <g className="metadataTextLayer" aria-hidden="true">
      {items.map(item => (
        <text
          key={item.regionId}
          className="metadataFieldText"
          x={item.x}
          y={item.y}
          textAnchor={item.textAnchor}
          dominantBaseline={item.dominantBaseline}
          fontSize={item.fontSizePx / context.pageSize.heightPx}
          fontWeight={item.fontWeight}
        >
          {item.lines.map((line, index) => (
            <tspan
              key={`${item.regionId}_${index}`}
              x={item.x}
              dy={index === 0 ? 0 : item.lineHeightPx / context.pageSize.heightPx}
            >
              {line}
            </tspan>
          ))}
        </text>
      ))}
    </g>
  )
}

function WorkRangeOverlay({
  template,
  page,
  displayDurationFrames = template.defaults.durationFrames,
  officialFrameStart,
  officialFrameEnd,
}: {
  template: SheetTemplate
  page: SheetPage
  displayDurationFrames?: number
  officialFrameStart: number
  officialFrameEnd: number
}) {
  const frameOrigin = frameOriginForPageHit(template, page)
  const isContinuousFrameAxis = frameOrigin === page.frameStart
  const localFrameToGlobalFrame = (frame: number) => isContinuousFrameAxis
    ? frame
    : page.frameStart + (frame - template.defaults.frameOrigin)
  const globalFrameToLocalFrame = (frame: number) => isContinuousFrameAxis
    ? frame
    : frame - page.frameStart + template.defaults.frameOrigin
  const rects = template.regions.flatMap(region => {
    if (region.type !== 'exposure-grid' || !region.grid) return []
    const layout = resolveSheetTemplateGridLayout(template, region, { durationFrames: displayDurationFrames, frameOrigin })
    if (!layout) return []
    const frames = layout.frames
    const visibleFrameStart = localFrameToGlobalFrame(frames.frameStart)
    const visibleFrameEnd = localFrameToGlobalFrame(frames.frameEnd)
    const dimRanges = [
      { frameStart: visibleFrameStart, frameEnd: Math.min(visibleFrameEnd, officialFrameStart - 1) },
      { frameStart: Math.max(visibleFrameStart, officialFrameEnd + 1), frameEnd: visibleFrameEnd },
    ].filter(range => range.frameEnd >= range.frameStart)
    return dimRanges.flatMap(range => {
      const localStart = globalFrameToLocalFrame(range.frameStart)
      const localEnd = globalFrameToLocalFrame(range.frameEnd)
      const start = Math.max(frames.frameStart, localStart)
      const end = Math.min(frames.frameEnd, localEnd)
      if (end < start) return []
      const rowIndex = start - frames.frameStart
      const rowCount = end - start + 1
      return [{
        x: layout.rect.x,
        y: layout.rect.y + frames.rowHeight * rowIndex,
        w: layout.rect.w,
        h: frames.rowHeight * rowCount,
      }]
    })
  })
  return (
    <g>
      {rects.map((rect, index) => (
        <rect key={index} className="inactiveFrameRect" x={rect.x} y={rect.y} width={rect.w} height={rect.h} />
      ))}
    </g>
  )
}

type OverlayPaperTrackDrag = {
  paperTrack: string
  snapIndex: number
  sheetRole: SheetTimingRole
  pageId: string
  startClientX: number
  startClientY: number
  moved: boolean
}

function OverlayPaperTrackLayer({
  project,
  template,
  page,
  tracks,
  activePaperTrack,
  drag,
}: {
  project: CutProject
  template: SheetTemplate
  page: SheetPage
  tracks: PaperTrack[]
  activePaperTrack: string | null
  drag: OverlayPaperTrackDrag | null
}) {
  return (
    <g className="overlayPaperTrackLayer">
      {overlayPaperTrackRenderItems(template, project, page, tracks, drag).map(({ track, column, label }) => {
        const isInputTarget = activePaperTrack === track.paperTrack
        const frames = column.frames
          const lines = []
          for (let row = 0; row <= frames.rowCount; row += 1) {
            const y = column.rect.y + (column.rect.h * row) / frames.rowCount
            lines.push(<line key={`r${row}`} className={`overlayPaperTrackLine ${gridRowLineClassName(column, row)}`} x1={column.rect.x} x2={column.rect.x + column.rect.w} y1={y} y2={y} />)
          }
        return (
          <g key={track.paperTrack} className={isInputTarget ? 'overlayPaperTrack inputActive' : 'overlayPaperTrack inputInactive'}>
            <rect className="overlayPaperTrackColumn" x={column.rect.x} y={column.rect.y} width={column.rect.w} height={column.rect.h} />
            <line className="overlayPaperTrackBorder" x1={column.rect.x} x2={column.rect.x} y1={column.rect.y} y2={column.rect.y + column.rect.h} />
            <line className="overlayPaperTrackBorder" x1={column.rect.x + column.rect.w} x2={column.rect.x + column.rect.w} y1={column.rect.y} y2={column.rect.y + column.rect.h} />
            {lines}
            <g className="overlayPaperTrackLabel">
              <path className="overlayPaperTrackStem" d={`M ${label.stemX} ${column.rect.y} V ${label.labelBottomY} H ${label.labelAttachX}`} />
              <rect className="overlayPaperTrackLabelBox" x={label.labelX} y={label.labelY} width={label.labelWidth} height={label.labelHeight} rx={label.radiusX} ry={label.radiusY} />
              <text
                className="overlayPaperTrackLabelText"
                x={label.labelX + label.labelWidth / 2}
                y={label.labelY + label.labelHeight / 2}
                dy="0.08em"
                dominantBaseline="middle"
                textAnchor="middle"
                fontSize={label.fontSize}
              >
                {track.label}
              </text>
            </g>
          </g>
        )
      })}
    </g>
  )
}

function OverlayPaperTrackInteractionLayer({
  project,
  template,
  page,
  tracks,
  pageWidth,
  pageHeight,
  activePaperTrack,
  drag,
  onActivePaperTrackChange,
  onOpenPaperTrackMenu,
  onDragChange,
  onStatusHint,
  onUpdatePaperTrack,
}: {
  project: CutProject
  template: SheetTemplate
  page: SheetPage
  tracks: PaperTrack[]
  pageWidth: number
  pageHeight: number
  activePaperTrack: string | null
  drag: OverlayPaperTrackDrag | null
  onActivePaperTrackChange: (paperTrack: string | null) => void
  onOpenPaperTrackMenu: (track: PaperTrack, position: { x: number; y: number }) => void
  onDragChange: (drag: OverlayPaperTrackDrag | null) => void
  onStatusHint: (source: StatusHintSource, text: string | null) => void
  onUpdatePaperTrack: (paperTrack: string, updates: Parameters<typeof updatePaperTrack>[2]) => void
}) {
  const layerRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<OverlayPaperTrackDrag | null>(drag)
  const activeDrag = drag?.pageId === page.pageId ? drag : null

  useEffect(() => {
    dragRef.current = drag
  }, [drag])

  useEffect(() => {
    function snapIndexFromClientPoint(clientX: number, clientY: number, sheetRole: SheetTimingRole): number | null {
      const layer = layerRef.current
      if (!layer) return null
      const box = layer.getBoundingClientRect()
      if (box.width <= 0 || box.height <= 0) return null
      const point = {
        x: (clientX - box.left) / box.width,
        y: (clientY - box.top) / box.height,
      }
      return overlaySnapIndexFromPoint(template, project, point, sheetRole)
    }

    function updateDragFromPointer(event: globalThis.PointerEvent) {
      const current = dragRef.current
      if (!current || current.pageId !== page.pageId) return null
      const snapIndex = snapIndexFromClientPoint(event.clientX, event.clientY, current.sheetRole)
      if (snapIndex === null) return current
      const moved = current.moved || Math.hypot(event.clientX - current.startClientX, event.clientY - current.startClientY) > 3
      const next = { ...current, snapIndex, moved }
      dragRef.current = next
      onDragChange(next)
      return next
    }

    function handlePointerMove(event: globalThis.PointerEvent) {
      if (dragRef.current?.pageId !== page.pageId) return
      event.preventDefault()
      updateDragFromPointer(event)
    }

    function handlePointerUp(event: globalThis.PointerEvent) {
      if (dragRef.current?.pageId !== page.pageId) return
      const current = updateDragFromPointer(event) ?? dragRef.current
      if (current?.moved) {
        onUpdatePaperTrack(current.paperTrack, { viewPlacement: { snapIndex: current.snapIndex, expanded: true } })
      } else if (current) {
        onActivePaperTrackChange(activePaperTrack === current.paperTrack ? null : current.paperTrack)
      }
      dragRef.current = null
      onDragChange(null)
      onStatusHint('sheet-drag', null)
    }

    function handlePointerCancel() {
      if (dragRef.current?.pageId !== page.pageId) return
      dragRef.current = null
      onDragChange(null)
      onStatusHint('sheet-drag', null)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
    }
  }, [activePaperTrack, onActivePaperTrackChange, onDragChange, onStatusHint, onUpdatePaperTrack, page.pageId, project, template])

  return (
    <div ref={layerRef} className="overlayPaperTrackInteractionLayer">
      {overlayPaperTrackRenderItems(template, project, page, tracks, activeDrag).map(({ track, renderedTrack, label }) => {
        const isInputTarget = activePaperTrack === track.paperTrack
        const inputStateLabel = isInputTarget
          ? uiText.actions.overlayPaperTrackInputActive(track.label)
          : uiText.actions.overlayPaperTrackInputInactive(track.label)
        const title = `${inputStateLabel}\n${uiText.actions.overlayPaperTrackEdit}`
        const statusHint = uiText.statusHints.overlayPaperTrack(track.label, isInputTarget)
        return (
          <TooltipTarget key={track.paperTrack} label={title} delayMs={OVERLAY_PAPER_TRACK_TOOLTIP_DELAY_MS}>
            {tooltipProps => (
              <button
                {...tooltipProps}
                type="button"
                className={isInputTarget ? 'overlayPaperTrackDragHandle inputActive' : 'overlayPaperTrackDragHandle inputInactive'}
                aria-pressed={isInputTarget}
                aria-label={inputStateLabel}
                style={{
                  left: `${label.labelX * pageWidth}px`,
                  top: `${label.labelY * pageHeight}px`,
                  width: `${label.labelWidth * pageWidth}px`,
                  height: `${label.labelHeight * pageHeight}px`,
                }}
                onPointerDown={event => {
                  tooltipProps.onPointerDown()
                  if (event.pointerType === 'mouse' && event.button !== 0) return
                  event.preventDefault()
                  event.stopPropagation()
                  event.currentTarget.setPointerCapture?.(event.pointerId)
                  const sheetRole = track.viewPlacement?.sheetRole ?? 'cell'
                  const nextDrag = {
                    paperTrack: track.paperTrack,
                    snapIndex: renderedTrack.viewPlacement?.snapIndex ?? 0,
                    sheetRole,
                    pageId: page.pageId,
                    startClientX: event.clientX,
                    startClientY: event.clientY,
                    moved: false,
                  }
                  dragRef.current = nextDrag
                  onDragChange(nextDrag)
                  onStatusHint('sheet-drag', uiText.statusHints.overlayPaperTrackDragging(track.label))
                }}
                onPointerEnter={event => {
                  tooltipProps.onPointerEnter(event)
                  onStatusHint('overlay-paper-track', statusHint)
                }}
                onPointerLeave={() => {
                  tooltipProps.onPointerLeave()
                  onStatusHint('overlay-paper-track', null)
                }}
                onFocus={event => {
                  tooltipProps.onFocus(event)
                  onStatusHint('overlay-paper-track', statusHint)
                }}
                onBlur={() => {
                  tooltipProps.onBlur()
                  onStatusHint('overlay-paper-track', null)
                }}
                onContextMenu={event => {
                  event.preventDefault()
                  event.stopPropagation()
                  onOpenPaperTrackMenu(track, { x: event.clientX, y: event.clientY })
                }}
                onPointerCancel={() => {
                  dragRef.current = null
                  onDragChange(null)
                  onStatusHint('sheet-drag', null)
                }}
              />
            )}
          </TooltipTarget>
        )
      })}
    </div>
  )
}

interface OverlayPaperTrackRenderItem {
  track: PaperTrack
  renderedTrack: PaperTrack
  column: OverlayBandSegment & { rect: NormalizedRect }
  label: OverlayPaperTrackLabelGeometry
}

interface OverlayPaperTrackLabelGeometry {
  stemX: number
  labelX: number
  labelY: number
  labelAttachX: number
  labelTextX: number
  labelBottomY: number
  labelWidth: number
  labelHeight: number
  fontSize: number
  radiusX: number
  radiusY: number
}

interface LabelLaneOccupancy {
  leftPx: number
  rightPx: number
  lane: number
  source: 'stack-guide' | 'overlay-track'
}

function overlayPaperTrackRenderItems(
  template: SheetTemplate,
  project: CutProject,
  page: SheetPage,
  tracks: PaperTrack[],
  drag: OverlayPaperTrackDrag | null,
): OverlayPaperTrackRenderItem[] {
  const displayDurationFrames = logicalSheetDisplayDurationFrames(project.logicalSheet)
  const templateTracks = templatePaperTracks(project).map(track => track.paperTrack)
  const pageSize = resolveSheetTemplatePageSize(template, displayDurationFrames, {
    paperTracks: templateTracks,
    layoutOverrides: project.sheetView.layoutOverrides,
  })
  const occupiedByRegion = new Map<string, LabelLaneOccupancy[]>()

  function occupiedLanesForRegion(region: SheetTemplate['regions'][number]) {
    const bandKey = overlayPaperTrackLabelBandKey(template, region)
    const existing = occupiedByRegion.get(bandKey)
    if (existing) return existing
    const occupied = stackGuideAnchorRegions(template, page, project.logicalSheet.frameOrigin)
      .filter(anchorRegion => overlayPaperTrackLabelBandKey(template, anchorRegion) === bandKey)
      .flatMap(anchorRegion => {
        const layout = resolveSheetTemplateGridLayout(template, anchorRegion, {
          paperTracks: templateTracks,
          durationFrames: displayDurationFrames,
          layoutOverrides: project.sheetView.layoutOverrides,
        })
        if (!layout || layout.columns.length === 0) return []
        const rect = layout.rect
        const columns = layout.columns
        const gapWidthPx = stackGuideGapWidthPx(template, rect, columns, pageSize.widthPx)
        const labelsForRegion = project.stackGuideLabels.filter(label => (label.displayRole ?? 'action') === anchorRegion.grid?.role && stackGuideStackBand(label) === 'cell-interleave')
        return stackGuidePlacements(template, project, labelsForRegion, gapWidthPx, columns).map(({ label, lane }) => {
          const geometry = stackGuideSvgGeometry(template, rect, pageSize, label, lane, columns)
          return {
            leftPx: geometry.labelX * pageSize.widthPx,
            rightPx: (geometry.labelX + geometry.labelWidth) * pageSize.widthPx,
            lane,
            source: 'stack-guide' as const,
          }
        })
      })
    occupiedByRegion.set(bandKey, occupied)
    return occupied
  }

  return tracks.flatMap(track => {
    const renderedTrack = drag?.paperTrack === track.paperTrack
      ? { ...track, viewPlacement: { ...track.viewPlacement, snapIndex: drag.snapIndex } }
      : track
    const column = overlayColumnRectForPage(template, project, renderedTrack, page)
    if (!column) return []
    const region = template.regions.find(item => item.regionId === column.regionId)
    if (!region?.grid) return []
    const layout = resolveSheetTemplateGridLayout(template, region, {
      paperTracks: templateTracks,
      durationFrames: displayDurationFrames,
      layoutOverrides: project.sheetView.layoutOverrides,
    })
    if (!layout || layout.columns.length === 0) return []
    const rect = layout.rect
    const metrics = overlayPaperTrackLabelMetrics(template)
    const labelWidthPx = overlayPaperTrackLabelWidthPx(renderedTrack, metrics)
    const occupied = occupiedLanesForRegion(region)
    const highestStackGuideLane = occupied.reduce((highest, candidate) => candidate.source === 'stack-guide' ? Math.max(highest, candidate.lane) : highest, -1)
    let lane = highestStackGuideLane >= 0 ? Math.min(highestStackGuideLane + 1, STACK_GUIDE_MAX_LANE) : 0
    let label = overlayPaperTrackLabelGeometry(template, rect, pageSize, renderedTrack, column, lane, metrics, labelWidthPx)
    while (
      lane < STACK_GUIDE_MAX_LANE
      && occupied.some(candidate => candidate.lane === lane && labelLaneRangesOverlap(overlayPaperTrackLabelRangePx(label, pageSize), candidate))
    ) {
      lane += 1
      label = overlayPaperTrackLabelGeometry(template, rect, pageSize, renderedTrack, column, lane, metrics, labelWidthPx)
    }
    occupied.push({ ...overlayPaperTrackLabelRangePx(label, pageSize), lane, source: 'overlay-track' })
    return [{
      track,
      renderedTrack,
      column,
      label,
    }]
  })
}

function labelLaneRangesOverlap(a: Pick<LabelLaneOccupancy, 'leftPx' | 'rightPx'>, b: Pick<LabelLaneOccupancy, 'leftPx' | 'rightPx'>) {
  const marginPx = 4
  return a.leftPx < b.rightPx + marginPx && b.leftPx < a.rightPx + marginPx
}

function overlayPaperTrackLabelRangePx(label: OverlayPaperTrackLabelGeometry, pageSize: { widthPx: number }) {
  return {
    leftPx: label.labelX * pageSize.widthPx,
    rightPx: (label.labelX + label.labelWidth) * pageSize.widthPx,
  }
}

function overlayPaperTrackLabelMetrics(template: SheetTemplate): StackGuideLabelMetrics {
  const base = stackGuideLabelMetrics(template)
  const textPaddingPx = Math.max(2, base.textPaddingPx * 0.72)
  const fontSizePx = base.fontSizePx
  return {
    ...base,
    labelHeightPx: Math.max(11, fontSizePx + 3),
    minWidthPx: Math.max(13, fontSizePx * 0.72 + textPaddingPx * 2),
    fontSizePx,
    textPaddingPx,
    estimatedCharWidthPx: Math.max(base.estimatedCharWidthPx * 0.9, fontSizePx * 0.54),
    radiusPx: Math.max(1.5, base.radiusPx * 0.8),
  }
}

function overlayPaperTrackLabelWidthPx(track: Pick<PaperTrack, 'label'>, metrics: StackGuideLabelMetrics) {
  return Math.min(metrics.maxWidthPx, Math.max(metrics.minWidthPx, estimatedLabelTextWidthPx(track.label, metrics) + metrics.textPaddingPx * 2))
}

function overlayPaperTrackLabelBandKey(template: SheetTemplate, region: SheetTemplate['regions'][number]) {
  return String(region.grid?.frameStart ?? template.defaults.frameOrigin)
}

function overlayPaperTrackLabelGeometry(
  template: SheetTemplate,
  rect: NormalizedRect,
  pageSize: { widthPx: number; heightPx: number },
  track: PaperTrack,
  column: { rect: NormalizedRect },
  lane: number,
  metrics: StackGuideLabelMetrics,
  labelWidthPx = overlayPaperTrackLabelWidthPx(track, metrics),
): OverlayPaperTrackLabelGeometry {
  const labelWidth = labelWidthPx / pageSize.widthPx
  const labelHeight = metrics.labelHeightPx / pageSize.heightPx
  const textPadding = metrics.textPaddingPx / pageSize.widthPx
  const pageMargin = metrics.pageMarginPx / pageSize.widthPx
  const poleGap = metrics.poleGapPx / pageSize.widthPx
  const labelBottomOffset = (stackGuideNativeHeaderReachPx(template, rect, pageSize) + stackGuideLabelBottomPx(template, lane)) / pageSize.heightPx
  const stemX = column.rect.x
  const labelBottomY = rect.y - labelBottomOffset
  const labelY = labelBottomY - labelHeight
  const desiredLabelX = stemX + poleGap
  const labelX = clampNumber(desiredLabelX, pageMargin, 1 - pageMargin - labelWidth)
  const labelAttachX = labelX >= stemX ? labelX : labelX + labelWidth
  return {
    stemX,
    labelX,
    labelY,
    labelAttachX,
    labelTextX: labelX + textPadding,
    labelBottomY,
    labelWidth,
    labelHeight,
    fontSize: metrics.fontSizePx / pageSize.heightPx,
    radiusX: metrics.radiusPx / pageSize.widthPx,
    radiusY: metrics.radiusPx / pageSize.heightPx,
  }
}

function eventRectsForPage(project: CutProject, template: SheetTemplate, page: SheetPage, options: { activeOverlayPaperTrack?: string | null } = {}) {
  const paperTracks = templatePaperTracks(project).map(track => track.paperTrack)
  const displayFrameStart = logicalSheetDisplayFrameStart(project.logicalSheet)
  const displayDurationFrames = logicalSheetDisplayDurationFrames(project.logicalSheet)
  const activeOverlayTrack = options.activeOverlayPaperTrack
    ? project.logicalSheet.paperTracks.find(track => track.paperTrack === options.activeOverlayPaperTrack && track.source === 'overlay')
    : undefined
  const activeOverlayColumn = activeOverlayTrack ? overlayColumnRectForPage(template, project, activeOverlayTrack, page) : null
  return project.logicalSheet.events.flatMap(event => {
    const key = project.logicalSheet.keys.find(item => item.keyId === event.keyId)
    if (!key && !isNullCellKeyId(event.keyId)) return []
    const displayLabel = isNullCellKeyId(event.keyId) ? NULL_CELL_DISPLAY_LABEL : key?.displayLabel ?? ''
    const sheetRole = sheetTimingRoleForEvent(event)
    const fontSizePx = resolveTimingTextFontSizePx(template, sheetRole, event.fontSizePx)
    const track = project.logicalSheet.paperTracks.find(item => item.paperTrack === event.paperTrack)
    const rect = track?.source === 'overlay'
      ? overlayCellRectForFrame(template, project, track, event.frame, page)
      : (() => {
          const hit = timingHitForFrame(template, sheetRole, event.paperTrack, event.frame, displayDurationFrames, displayFrameStart, paperTracks)
          if (!hit || hit.pageId !== page.pageId) return null
          return cellRectForHit(template, hit, displayDurationFrames, displayFrameStart, {
            paperTracks,
            layoutOverrides: project.sheetView.layoutOverrides,
          })
        })()
    const hasAssetBinding = project.bindings.some(binding => binding.keyId === event.keyId && Boolean(binding.assetId))
    if (rect && shouldSuppressRectUnderActiveOverlay(track, rect, activeOverlayColumn)) return []
    return rect ? [{ event, displayLabel, fontSizePx, rect, hasAssetBinding }] : []
  })
}

function shouldSuppressRectUnderActiveOverlay(track: PaperTrack | undefined, rect: NormalizedRect, activeOverlayColumn: (OverlayBandSegment & { rect: NormalizedRect }) | null): boolean {
  if (!activeOverlayColumn || track?.source === 'overlay') return false
  return normalizedRectsOverlap(rect, activeOverlayColumn.rect)
}

function normalizedRectsOverlap(a: NormalizedRect, b: NormalizedRect): boolean {
  return a.x < b.x + b.w
    && a.x + a.w > b.x
    && a.y < b.y + b.h
    && a.y + a.h > b.y
}

function rectForHit(project: CutProject, template: SheetTemplate, hit: SheetHit): NormalizedRect | null {
  const displayFrameStart = logicalSheetDisplayFrameStart(project.logicalSheet)
  const displayDurationFrames = logicalSheetDisplayDurationFrames(project.logicalSheet)
  const track = hit.paperTrack ? project.logicalSheet.paperTracks.find(item => item.paperTrack === hit.paperTrack) : undefined
  if (track?.source === 'overlay') {
    const page = hit.pageId ? createSheetPages(template, displayDurationFrames, displayFrameStart).find(item => item.pageId === hit.pageId) : undefined
    return page ? overlayCellRectForFrame(template, project, track, hit.frame, page) : null
  }
  return cellRectForHit(template, hit, displayDurationFrames, displayFrameStart, {
    paperTracks: templatePaperTracks(project).map(track => track.paperTrack),
    layoutOverrides: project.sheetView.layoutOverrides,
  })
}

function frameOriginForPageHit(template: SheetTemplate, page: SheetPage): number {
  const layout = getSheetViewLayout(template)
  return layout.frameAxis?.type === 'continuous' || layout.frameAxis?.type === 'infinite'
    ? page.frameStart
    : template.defaults.frameOrigin
}

function materializePageHit(template: SheetTemplate, hit: SheetHit, page: SheetPage): SheetHit {
  const layout = getSheetViewLayout(template)
  if (layout.frameAxis?.type === 'continuous' || layout.frameAxis?.type === 'infinite') {
    return {
      ...hit,
      localFrame: hit.localFrame ?? hit.frame,
      pageId: page.pageId,
      pageIndex: page.pageIndex,
    }
  }
  return globalizeSheetHit(template, hit, page)
}

function templatePaperTracks(project: CutProject): PaperTrack[] {
  return project.logicalSheet.paperTracks.filter(track => track.source !== 'overlay').sort((a, b) => a.order - b.order)
}

function overlayPaperTracks(project: CutProject): PaperTrack[] {
  return project.logicalSheet.paperTracks.filter(track => track.source === 'overlay').sort((a, b) => a.order - b.order)
}

function paperTrackOrderForRole(project: CutProject, role: SheetTimingRole): string[] {
  const templateTracks = templatePaperTracks(project)
  const templateOrder = new Map(templateTracks.map((track, index) => [track.paperTrack, index]))
  const sortableTracks = project.logicalSheet.paperTracks
    .filter(track => track.source !== 'overlay' || (track.viewPlacement?.sheetRole ?? 'cell') === role)
    .map(track => {
      const baseOrder = templateOrder.get(track.paperTrack)
      const visualOrder = track.source === 'overlay'
        ? (track.viewPlacement?.snapIndex ?? baseOrder ?? track.order) - 0.35
        : baseOrder ?? track.order
      return { track, visualOrder }
    })
  return sortableTracks
    .sort((a, b) =>
      a.visualOrder - b.visualOrder
      || a.track.order - b.track.order
      || compareNaturalFileNameText(a.track.paperTrack, b.track.paperTrack),
    )
    .map(item => item.track.paperTrack)
}

function nextOverlayTrackNameForUi(project: CutProject): string {
  const used = new Set(project.logicalSheet.paperTracks.map(track => track.paperTrack))
  for (let code = 0; code < 26; code += 1) {
    const candidate = String.fromCharCode(74 + code)
    if (!used.has(candidate)) return candidate
  }
  return '追加'
}

function overlayHitFromPoint(template: SheetTemplate, project: CutProject, page: SheetPage, point: NormalizedPoint, activePaperTrack: string | null): SheetHit | null {
  if (!activePaperTrack) return null
  for (const track of overlayPaperTracks(project)) {
    if (track.paperTrack !== activePaperTrack) continue
    const column = overlayColumnRectForPage(template, project, track, page)
    if (!column) continue
    const rect = column.rect
    if (point.x < rect.x || point.x > rect.x + rect.w || point.y < rect.y || point.y > rect.y + rect.h) continue
    const rowIndex = clampNumber(Math.floor(((point.y - rect.y) / rect.h) * column.frames.rowCount), 0, column.frames.rowCount - 1)
    const localFrame = column.frames.frameStart + rowIndex
    const localHit: SheetHit = {
      regionId: `overlay:${track.paperTrack}:${column.regionId}`,
      role: track.viewPlacement?.sheetRole ?? 'cell',
      frame: localFrame,
      localFrame,
      rowIndex,
      columnIndex: 0,
      columnId: `overlay_${track.paperTrack}`,
      label: track.label,
      paperTrack: track.paperTrack,
    }
    const hit = materializePageHit(template, localHit, page)
    return hit.frame <= page.frameEnd ? localHit : null
  }
  return null
}

function overlayCellRectForFrame(template: SheetTemplate, project: CutProject, track: PaperTrack, frame: number, page: SheetPage): NormalizedRect | null {
  const localized = localizeFrameToSheetPage(template, frame, logicalSheetDisplayDurationFrames(project.logicalSheet), logicalSheetDisplayFrameStart(project.logicalSheet))
  if (!localized || localized.page.pageId !== page.pageId) return null
  const column = overlayColumnRectForPage(template, project, track, page)
  if (!column) return null
  if (localized.localFrame < column.frames.frameStart || localized.localFrame > column.frames.frameEnd) return null
  const rowIndex = localized.localFrame - column.frames.frameStart
  const rowH = column.rect.h / column.frames.rowCount
  return {
    x: column.rect.x,
    y: column.rect.y + rowH * rowIndex,
    w: column.rect.w,
    h: rowH,
  }
}

function overlayRangeRectForPage(template: SheetTemplate, project: CutProject, track: PaperTrack, frameStart: number, frameEnd: number, page: SheetPage): NormalizedRect | null {
  const start = Math.max(frameStart, page.frameStart)
  const end = Math.min(frameEnd, page.frameEnd)
  if (end < start) return null
  const startRect = overlayCellRectForFrame(template, project, track, start, page)
  const endRect = overlayCellRectForFrame(template, project, track, end, page)
  if (!startRect || !endRect) return null
  return {
    x: startRect.x,
    y: startRect.y,
    w: startRect.w,
    h: endRect.y + endRect.h - startRect.y,
  }
}

function overlayHitForFrame(template: SheetTemplate, project: CutProject, track: PaperTrack, frame: number, page: SheetPage, role: SheetTimingRole): SheetHit | null {
  const localized = localizeFrameToSheetPage(template, frame, logicalSheetDisplayDurationFrames(project.logicalSheet), logicalSheetDisplayFrameStart(project.logicalSheet))
  if (!localized || localized.page.pageId !== page.pageId) return null
  const column = overlayColumnRectForPage(template, project, track, page)
  if (!column) return null
  if (localized.localFrame < column.frames.frameStart || localized.localFrame > column.frames.frameEnd) return null
  const rowIndex = localized.localFrame - column.frames.frameStart
  return {
    regionId: `overlay:${track.paperTrack}:${column.regionId}`,
    role,
    frame,
    localFrame: localized.localFrame,
    rowIndex,
    columnIndex: 0,
    columnId: `overlay_${track.paperTrack}`,
    label: track.label,
    paperTrack: track.paperTrack,
    pageId: page.pageId,
    pageIndex: page.pageIndex,
  }
}

function overlayColumnRectForPage(template: SheetTemplate, project: CutProject, track: PaperTrack, page: SheetPage): (OverlayBandSegment & { rect: NormalizedRect }) | null {
  const role = track.viewPlacement?.sheetRole ?? 'cell'
  const segments = overlayBandSegments(template, project, role)
  const frameOrigin = frameOriginForPageHit(template, page)
  const segment = segments.find(item => {
    const segmentStart = page.frameStart + (item.frames.frameStart - frameOrigin)
    const segmentEnd = page.frameStart + (item.frames.frameEnd - frameOrigin)
    return page.frameStart <= segmentEnd && page.frameEnd >= segmentStart
  })
  if (!segment) return null
  const snapIndex = clampNumber(Math.round(track.viewPlacement?.snapIndex ?? 0), 0, segment.snapCount)
  return {
    ...segment,
    rect: {
      x: segment.minX + segment.columnWidth * snapIndex,
      y: segment.rect.y,
      w: segment.columnWidth,
      h: segment.rect.h,
    },
  }
}

interface OverlayBandSegment {
  regionId: string
  rect: NormalizedRect
  frames: { frameStart: number; frameEnd: number; rowCount: number }
  globalFrameStart: number
  globalFrameEnd: number
  minX: number
  columnWidth: number
  snapCount: number
  majorLineEvery?: number
  rowLineRules?: NonNullable<SheetTemplate['regions'][number]['grid']>['rowLineRules']
}

function overlayBandSegments(template: SheetTemplate, project: CutProject, role: SheetTimingRole): OverlayBandSegment[] {
  const templateTrackNames = templatePaperTracks(project).map(track => track.paperTrack)
  const displayDurationFrames = logicalSheetDisplayDurationFrames(project.logicalSheet)
  const viewLayout = getSheetViewLayout(template)
  const frameOrigin = viewLayout.frameAxis?.type === 'continuous' || viewLayout.frameAxis?.type === 'infinite'
    ? logicalSheetDisplayFrameStart(project.logicalSheet)
    : template.defaults.frameOrigin
  return template.regions.flatMap(region => {
    if (region.type !== 'exposure-grid' || region.grid?.role !== role) return []
    const layout = resolveSheetTemplateGridLayout(template, region, {
      paperTracks: templateTrackNames,
      durationFrames: displayDurationFrames,
      frameOrigin,
      layoutOverrides: project.sheetView.layoutOverrides,
    })
    if (!layout || layout.columns.length === 0) return []
    const rect = layout.rect
    const columns = layout.columns
    const frames = layout.frames
    const actionRegion = matchingGridRegion(template, 'action', frames.frameStart)
    const cameraRegion = matchingGridRegion(template, 'camera', frames.frameStart)
    const actionLayout = actionRegion ? resolveSheetTemplateGridLayout(template, actionRegion, {
      paperTracks: templateTrackNames,
      durationFrames: displayDurationFrames,
      frameOrigin,
      layoutOverrides: project.sheetView.layoutOverrides,
    }) : null
    const cameraLayout = cameraRegion ? resolveSheetTemplateGridLayout(template, cameraRegion, {
      paperTracks: templateTrackNames,
      durationFrames: displayDurationFrames,
      frameOrigin,
      layoutOverrides: project.sheetView.layoutOverrides,
    }) : null
    const actionRect = actionLayout?.rect ?? rect
    const cameraRect = cameraLayout?.rect ?? rect
    const columnWidth = columns.reduce((total, column) => total + column.w, 0) / columns.length
    const minX = Math.max(0, actionRect.x - columnWidth)
    const maxX = Math.min(1 - columnWidth, cameraRect.x + cameraRect.w)
    const snapCount = Math.max(0, Math.round((maxX - minX) / columnWidth))
    return [{
      regionId: region.regionId,
      rect,
      frames,
      globalFrameStart: frames.frameStart,
      globalFrameEnd: frames.frameEnd,
      minX,
      columnWidth,
      snapCount,
      majorLineEvery: region.grid.majorLineEvery,
      rowLineRules: region.grid.rowLineRules,
    }]
  })
}

function matchingGridRegion(template: SheetTemplate, role: 'action' | 'cell' | 'camera', frameStart: number): SheetTemplate['regions'][number] | undefined {
  return template.regions.find(region =>
    region.type === 'exposure-grid'
    && region.grid?.role === role
    && (region.grid.frameStart ?? template.defaults.frameOrigin) === frameStart,
  )
}

function overlaySnapIndexFromPoint(template: SheetTemplate, project: CutProject, point: NormalizedPoint, role: SheetTimingRole): number {
  const segments = overlayBandSegments(template, project, role)
  const segment = segments.find(item => {
    const minX = item.minX
    const maxX = item.minX + item.columnWidth * item.snapCount
    return point.x >= minX && point.x <= maxX
  }) ?? segments.find(item =>
    point.y >= item.rect.y && point.y <= item.rect.y + item.rect.h,
  ) ?? segments[0]
  return overlaySnapIndexFromSegment(point.x, segment)
}

function overlaySnapIndexFromSegment(x: number, segment: OverlayBandSegment | null | undefined): number {
  if (!segment) return 0
  return clampNumber(Math.round((x - segment.minX) / segment.columnWidth), 0, segment.snapCount)
}

function eventTextGeometry(rect: NormalizedRect, fontSizePx: number, pageSize: { widthPx: number; heightPx: number }) {
  const safeWidth = Math.max(1, pageSize.widthPx)
  const safeHeight = Math.max(1, pageSize.heightPx)
  return {
    x: (rect.x + rect.w / 2) * safeWidth,
    y: (rect.y + rect.h / 2) * safeHeight,
    fontSize: clampTextFontSizePx(fontSizePx),
    transform: `scale(${1 / safeWidth} ${1 / safeHeight})`,
  }
}

function timelineEventAtHit(project: CutProject, hit: SheetHit | null): TimelineEvent | null {
  if (!hit?.paperTrack) return null
  const role = sheetRoleForHit(hit)
  return project.logicalSheet.events.find(event =>
    event.paperTrack === hit.paperTrack
    && event.frame === hit.frame
    && sheetTimingRoleForEvent(event) === role
  ) ?? null
}

function updateTimelineEventFontSize(project: CutProject, eventId: string, fontSizePx: number): CutProject {
  let changed = false
  const events = project.logicalSheet.events.map(event => {
    if (event.eventId !== eventId) return event
    const nextFontSizePx = clampTextFontSizePx(fontSizePx)
    if (event.fontSizePx === nextFontSizePx) return event
    changed = true
    return { ...event, fontSizePx: nextFontSizePx }
  })
  return changed ? { ...project, logicalSheet: { ...project.logicalSheet, events } } : project
}

function updateTextAnnotation(
  project: CutProject,
  annotationId: string,
  updates: TextAnnotationUpdate,
): CutProject {
  let changed = false
  const annotations = project.annotations.map(annotation => {
    if (annotation.kind !== 'text' || annotation.annotationId !== annotationId) return annotation
    const nextAnnotation = {
      ...annotation,
      ...updates,
      ...(updates.fontSizePx === undefined ? {} : { fontSizePx: clampTextFontSizePx(updates.fontSizePx) }),
      ...(updates.x === undefined ? {} : { x: clampNumber(updates.x, 0, 1) }),
      ...(updates.y === undefined ? {} : { y: clampNumber(updates.y, 0, 1) }),
    }
    if (
      nextAnnotation.text === annotation.text
      && nextAnnotation.fontSizePx === annotation.fontSizePx
      && nextAnnotation.x === annotation.x
      && nextAnnotation.y === annotation.y
      && nextAnnotation.color === annotation.color
      && nextAnnotation.coordinateSpace === annotation.coordinateSpace
      && annotationAnchorSignature(nextAnnotation.anchor) === annotationAnchorSignature(annotation.anchor)
    ) {
      return annotation
    }
    changed = true
    return nextAnnotation
  })
  return changed ? { ...project, annotations } : project
}

function annotationAnchorSignature(anchor: AnnotationText['anchor']): string {
  if (!anchor) return ''
  if (anchor.kind === 'view-surface') {
    return [
      anchor.kind,
      anchor.templateId ?? '',
      anchor.pageId,
      anchor.regionId ?? '',
      anchor.surfaceSize?.widthPx ?? '',
      anchor.surfaceSize?.heightPx ?? '',
    ].join(':')
  }
  return JSON.stringify(anchor)
}

function deleteTextAnnotation(project: CutProject, annotationId: string): CutProject {
  const annotations = project.annotations.filter(annotation => annotation.annotationId !== annotationId)
  return annotations.length === project.annotations.length ? project : { ...project, annotations }
}

function cloneTextAnnotationForPaste(
  annotation: AnnotationText,
  input: {
    annotationId: string
    pageId: string
    templateId: string
    surfaceSize: { widthPx: number; heightPx: number }
  },
): AnnotationText {
  return {
    ...annotation,
    annotationId: input.annotationId,
    pageId: input.pageId,
    fontSizePx: resolveAnnotationTextFontSizePx(annotation, input.surfaceSize),
    x: clampNumber(annotation.x + 0.012, 0, 0.98),
    y: clampNumber(annotation.y + 0.012, 0, 0.98),
    coordinateSpace: 'view-surface',
    anchor: {
      kind: 'view-surface',
      templateId: input.templateId,
      pageId: input.pageId,
      surfaceSize: input.surfaceSize,
    },
  }
}

function assetAssignedEventMarkerPoints(rect: { x: number; y: number; w: number; h: number }) {
  const markerW = rect.w * 0.38
  const markerH = rect.h * 0.48
  return [
    `${rect.x + rect.w},${rect.y}`,
    `${rect.x + rect.w},${rect.y + markerH}`,
    `${rect.x + rect.w - markerW},${rect.y}`,
  ].join(' ')
}

function strokePath(stroke: AnnotationStroke): string {
  const [first, ...rest] = stroke.points
  if (!first) return ''
  return [`M ${first.x} ${first.y}`, ...rest.map(point => `L ${point.x} ${point.y}`)].join(' ')
}

function isAnnotationStroke(annotation: Annotation): annotation is AnnotationStroke {
  return annotation.kind !== 'text'
}

function nextAnnotationId(annotations: Annotation[]): string {
  const used = new Set(annotations.map(annotation => annotation.annotationId))
  let index = annotations.length + 1
  let candidate = `anno_${String(index).padStart(4, '0')}`
  while (used.has(candidate)) {
    index += 1
    candidate = `anno_${String(index).padStart(4, '0')}`
  }
  return candidate
}

type RegisteredCellViewMode = 'detail' | 'list'
type RegisteredCellSortDirection = 'asc' | 'desc'

type RegisteredCellSection = {
  sectionId: SheetTimingRole
  title: string
  keys: TimingKey[]
}

function KeyList({
  project,
  activeCorrectionLayerId,
  selectedKeyId,
  selectedHit,
  rangeSelection,
  onSelect,
  onJumpToFirstUse,
  onUpdateKey,
  onDeleteKey,
  onUpdateCspCellName,
  onMoveKeyBindingProcess,
  onCreateStackGuideLabel,
  onUpdateStackGuideLabel,
  onUpdateStackGuideRegistration,
  onDeleteStackGuideLabel,
  onApplyNameNormalization,
  onAssignAsset,
  onAssignAssetToStackGuideLabel,
  onRequestStackGuideInsert,
}: {
  project: CutProject
  activeCorrectionLayerId: string
  selectedKeyId: string | null
  selectedHit: SheetHit | null
  rangeSelection: SheetRangeSelection | null
  onSelect: (keyId: string | null) => void
  onJumpToFirstUse: (keyId: string) => void
  onUpdateKey: (keyId: string, displayLabel: string) => void
  onDeleteKey: (keyId: string) => void | Promise<void>
  onUpdateCspCellName: (keyId: string, slotId: string, cspCellName: string) => void
  onMoveKeyBindingProcess: (keyId: string, sourceSlotId: string, targetCorrectionLayerId: string) => void
  onCreateStackGuideLabel: (input: { label: string; gapIndex: number; insertAfterPaperTrack?: string; displayRole?: SheetTimingRole; viewSnapIndex?: number; kind?: StackGuideLabel['kind']; correctionLayerId?: string }) => void
  onUpdateStackGuideLabel: (labelId: string, updates: StackGuideLabelUpdates) => void
  onUpdateStackGuideRegistration: (labelId: string, correctionLayerId: string, cspCellName: string) => void
  onDeleteStackGuideLabel: (labelId: string) => void
  onApplyNameNormalization: (plan: NameNormalizationPlan) => Promise<void>
  onAssignAsset: (assetId: string, keyId: string, target?: { position?: { x: number; y: number } }) => void
  onAssignAssetToStackGuideLabel: (labelId: string, assetId: string, correctionLayerId?: string) => void
  onRequestStackGuideInsert: (tool: StackGuideInsertTool) => void
}) {
  const trackOrder = useMemo(() => registeredCellTrackOrder(project), [project])
  const [normalizationOpen, setNormalizationOpen] = useState(false)
  const [registeredCellViewMode, setRegisteredCellViewMode] = useState<RegisteredCellViewMode>('detail')
  const [registeredCellSortDirection, setRegisteredCellSortDirection] = useState<RegisteredCellSortDirection>('asc')
  const [embeddedPreviewPayload, setEmbeddedPreviewPayload] = useState<AssetPreviewPayload | null>(null)
  const [embeddedPreviewOpen, setEmbeddedPreviewOpen] = useState(false)
  const [embeddedPreviewKind, setEmbeddedPreviewKind] = useState<'registered-cell' | 'stack-guide' | null>(null)
  const [previewRect, setPreviewRect] = useState<AssetPreviewRect>(() => initialAssetPreviewRect())
  const [stackGuideDraft, setStackGuideDraft] = useState<{ kind: Extract<StackGuideLabel['kind'], 'camera-note' | 'memo'>; label: string } | null>(null)
  const [stackGuideDrop, setStackGuideDrop] = useState<{ labelId: string; assetId: string; x: number; y: number } | null>(null)
  const [processMoveMenu, setProcessMoveMenu] = useState<{ keyId: string; sourceSlotId: string; x: number; y: number } | null>(null)
  const [cardHoverPreview, setCardHoverPreview] = useState<{ rows: RegisteredCellThumbnailRow[]; label: string; style: CSSProperties } | null>(null)
  const keyListRef = useRef<HTMLDivElement | null>(null)
  const registeredCellSections = useMemo(() => registeredCellSectionsForUi(project, trackOrder, registeredCellSortDirection), [project, registeredCellSortDirection, trackOrder])
  const stackGuideLabels = useMemo(() => {
    const labels = [...project.stackGuideLabels].sort(compareStackGuideLabelsForUi(project))
    return registeredCellSortDirection === 'asc' ? labels : labels.reverse()
  }, [project, registeredCellSortDirection])
  const selectedPreviewKey = selectedKeyId ? project.logicalSheet.keys.find(item => item.keyId === selectedKeyId) ?? null : null
  const activeEmbeddedPreviewPayload = embeddedPreviewOpen && embeddedPreviewKind === 'registered-cell' && selectedPreviewKey
    ? embeddedRegisteredCellPreviewPayload(project, selectedPreviewKey) ?? embeddedPreviewPayload
    : embeddedPreviewPayload

  useEffect(() => {
    if (!stackGuideDrop) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setStackGuideDrop(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [stackGuideDrop])

  useEffect(() => {
    if (!processMoveMenu) return undefined
    const close = () => setProcessMoveMenu(null)
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [processMoveMenu])

  useEffect(() => {
    function handleAssetPointerDrop(event: Event) {
      const detail = (event as AssetPointerDropEvent).detail
      const assetId = detail?.assetIds?.length === 1 ? detail.assetIds[0] : ''
      const clientX = detail?.clientX
      const clientY = detail?.clientY
      if (!assetId || typeof clientX !== 'number' || typeof clientY !== 'number') return

      const root = keyListRef.current
      const target = document.elementFromPoint(clientX, clientY)
      if (!root || !target || !root.contains(target)) return

      const stackGuideLayerRow = target.closest<HTMLElement>('.stackGuideRegistrationRow[data-stack-guide-label-id][data-correction-layer-id]')
      if (stackGuideLayerRow && root.contains(stackGuideLayerRow)) {
        const labelId = stackGuideLayerRow.dataset.stackGuideLabelId
        const correctionLayerId = stackGuideLayerRow.dataset.correctionLayerId
        if (!labelId || !correctionLayerId) return
        onAssignAssetToStackGuideLabel(labelId, assetId, correctionLayerId)
        setStackGuideDrop(null)
        return
      }

      const stackGuideCard = target.closest<HTMLElement>('.stackGuideCard[data-stack-guide-label-id]')
      if (stackGuideCard && root.contains(stackGuideCard)) {
        const labelId = stackGuideCard.dataset.stackGuideLabelId
        if (!labelId) return
        setStackGuideDrop({ labelId, assetId, x: clientX, y: clientY })
        return
      }

      const registeredCellCard = target.closest<HTMLElement>('.registeredCellCard[data-registered-cell-key-id]')
      if (registeredCellCard && root.contains(registeredCellCard)) {
        const keyId = registeredCellCard.dataset.registeredCellKeyId
        if (!keyId) return
        onAssignAsset(assetId, keyId, { position: { x: clientX, y: clientY } })
      }
    }

    window.addEventListener(ASSET_POINTER_DROP_EVENT, handleAssetPointerDrop)
    return () => window.removeEventListener(ASSET_POINTER_DROP_EVENT, handleAssetPointerDrop)
  })

  async function openPreviewForRegisteredCell(key: TimingKey) {
    const nativePayload = await nativeRegisteredCellPreviewPayload(project, key)
    if (nativePayload && await openNativeAssetPreviewPayload(nativePayload)) {
      setEmbeddedPreviewOpen(false)
      setEmbeddedPreviewPayload(null)
      setEmbeddedPreviewKind(null)
      return
    }
    const embeddedPayload = embeddedRegisteredCellPreviewPayload(project, key)
    if (!embeddedPayload) return
    setEmbeddedPreviewPayload(embeddedPayload)
    setEmbeddedPreviewKind('registered-cell')
    setEmbeddedPreviewOpen(true)
  }

  function updatePreviewRect(rect: AssetPreviewRect) {
    const nextRect = clampAssetPreviewRect(rect)
    setPreviewRect(nextRect)
    writeAssetPreviewRect(nextRect)
  }

  function showCardHoverPreview(event: MouseEvent<HTMLElement>, label: string, rows: RegisteredCellThumbnailRow[]) {
    if (rows.length === 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    setCardHoverPreview({
      rows,
      label,
      style: registeredCellHoverPreviewStyle(rect, rows.length),
    })
  }

  async function openPreviewForStackGuideLabel(label: StackGuideLabel) {
    const nativePayload = await nativeStackGuidePreviewPayload(project, label)
    if (nativePayload && await openNativeAssetPreviewPayload(nativePayload)) {
      setEmbeddedPreviewOpen(false)
      setEmbeddedPreviewPayload(null)
      setEmbeddedPreviewKind(null)
      return
    }
    const embeddedPayload = embeddedStackGuidePreviewPayload(project, label)
    if (!embeddedPayload) return
    setEmbeddedPreviewPayload(embeddedPayload)
    setEmbeddedPreviewKind('stack-guide')
    setEmbeddedPreviewOpen(true)
  }

  function selectRegisteredCell(key: TimingKey) {
    onSelect(key.keyId)
    void updateNativeRegisteredCellPreviewIfOpen(project, key)
  }

  return (
    <div className="keyList" ref={keyListRef}>
      <div className="dockHeader keyListHeader">
        <h2>{uiText.keys.title}</h2>
        <div className="keyListHeaderActions">
          <Tooltip label={uiText.keys.normalizeTitle}>
            <button
              type="button"
              className="iconOnlyButton keyListNormalizeButton"
              aria-label={uiText.nameNormalization.open}
              onClick={() => setNormalizationOpen(true)}
            >
              <NormalizeNamesIcon />
            </button>
          </Tooltip>
          <div className="iconSegmentedControl registeredCellViewToggle" role="group" aria-label={uiText.keys.viewMode}>
            <Tooltip label={uiText.keys.view.detailTitle}>
              <button
                type="button"
                className={registeredCellViewMode === 'detail' ? 'active' : ''}
                aria-label={uiText.keys.view.detail}
                onClick={() => setRegisteredCellViewMode('detail')}
              >
                <RegisteredCellDetailViewIcon />
              </button>
            </Tooltip>
            <Tooltip label={uiText.keys.view.listTitle}>
              <button
                type="button"
                className={registeredCellViewMode === 'list' ? 'active' : ''}
                aria-label={uiText.keys.view.list}
                onClick={() => setRegisteredCellViewMode('list')}
              >
                <RegisteredCellListViewIcon />
              </button>
            </Tooltip>
          </div>
          <Tooltip label={registeredCellSortDirection === 'asc' ? uiText.keys.sort.ascendingTitle : uiText.keys.sort.descendingTitle}>
            <button
              type="button"
              className="assetSortButton registeredCellSortButton"
              aria-label={registeredCellSortDirection === 'asc' ? uiText.keys.sort.toDescending : uiText.keys.sort.toAscending}
              onClick={() => setRegisteredCellSortDirection(current => current === 'asc' ? 'desc' : 'asc')}
            >
              <RegisteredCellSortIcon direction={registeredCellSortDirection} />
            </button>
          </Tooltip>
        </div>
      </div>
      {registeredCellSections.length === 0 && stackGuideLabels.length === 0 && <p className="muted">{uiText.keys.empty}</p>}
      {registeredCellSections.map(section => (
        <section className="registeredCellSection" data-section-title={section.title} key={section.sectionId}>
          <div className="registeredCellSectionHeader">
            <h3 className="registeredCellSectionTitle">{section.title}</h3>
          </div>
          <div className={registeredCellViewMode === 'list' ? 'registeredCellCardList compact' : 'registeredCellCardList'}>
      {section.keys.map(key => {
        const slot = primarySlotForKey(project, key, activeCorrectionLayerId)
        const binding = slot ? project.bindings.find(item => item.slotId === slot.slotId && item.keyId === key.keyId) ?? null : null
        const primaryAsset = binding?.assetId ? project.assets.find(asset => asset.assetId === binding.assetId) ?? null : null
        const automaticName = slot ? automaticRegisteredCellCspName(key, slot, primaryAsset) : ''
        const cspCellName = binding?.cspCellName ?? automaticName
        const isManualName = Boolean(binding && binding.cspCellName !== automaticName)
        const assetRows = registeredCellAssetRows(project, key)
        const thumbnailRows = assetRows.map(row => ({
          rowId: row.bindingId,
          correctionLayerId: row.correctionLayerId,
          processLabel: row.processLabel,
          cspCellName: row.cspCellName,
          assetName: row.assetName,
          thumbnailUrl: row.thumbnailUrl,
          detailText: row.detailText,
        }))
        const firstUse = firstTimelineUseForKey(project, key, trackOrder)
        const dragLabel = `${section.title} ${key.paperTrack}${key.displayLabel ? ` ${key.displayLabel}` : ''}`
        const dragSubLabel = cspCellName || uiText.assetDrop.untitledCell
        const primaryName = registeredCellPrimaryDisplayName(key, cspCellName)
        const showCspSubLabel = Boolean(cspCellName && cspCellName !== primaryName)
        const processLabels = registeredCellProcessLabels(assetRows)

        function handleDrop(event: DragEvent<HTMLElement>) {
          const assetId = assetIdFromAssetDragData(event.dataTransfer)
          if (!assetId) return
          event.preventDefault()
          onAssignAsset(assetId, key.keyId, { position: { x: event.clientX, y: event.clientY } })
        }

        function handleAssetRowDrop(event: DragEvent<HTMLElement>) {
          const assetId = assetIdFromAssetDragData(event.dataTransfer)
          if (!assetId) return
          event.preventDefault()
          event.stopPropagation()
          onAssignAsset(assetId, key.keyId, { position: { x: event.clientX, y: event.clientY } })
        }

        function openProcessMoveMenu(event: MouseEvent<HTMLElement>, slotId: string) {
          event.preventDefault()
          event.stopPropagation()
          setProcessMoveMenu({
            keyId: key.keyId,
            sourceSlotId: slotId,
            x: event.clientX,
            y: event.clientY,
          })
        }

        return (
          <article
            key={key.keyId}
            className={[
              'registeredCellCard',
              registeredCellViewMode === 'list' ? 'compact' : '',
              key.keyId === selectedKeyId ? 'selected' : '',
            ].filter(Boolean).join(' ')}
            data-registered-cell-key-id={key.keyId}
            tabIndex={0}
            draggable={false}
            onClick={() => selectRegisteredCell(key)}
            onPointerDown={event => {
              const dragSource = event.currentTarget
              startRegisteredCellPointerDrag(event, {
                keyId: key.keyId,
                onDragStart: () => {
                  setCardHoverPreview(null)
                  const dragWindow = window as AssetDragWindow
                  dragWindow.__xsheetRemapRegisteredCellDragKeyId = key.keyId
                },
                onDrop: position => {
                  window.dispatchEvent(new CustomEvent(REGISTERED_CELL_POINTER_DROP_EVENT, {
                    detail: {
                      keyId: key.keyId,
                      clientX: position.x,
                      clientY: position.y,
                    } satisfies RegisteredCellPointerDropDetail,
                  }))
                },
                onDragEnd: () => {
                  delete (window as AssetDragWindow).__xsheetRemapRegisteredCellDragKeyId
                },
                createDragGhost: () => createRegisteredCellDragImage(dragLabel, dragSubLabel, dragSource),
              })
            }}
            onKeyDown={event => {
              if (isInteractiveKeyboardTarget(event.target)) return
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              selectRegisteredCell(key)
            }}
            onDragStart={event => {
              setCardHoverPreview(null)
              if (isInteractiveKeyboardTarget(event.target)) {
                event.preventDefault()
                return
              }
              const dragWindow = window as AssetDragWindow
              dragWindow.__xsheetRemapRegisteredCellDragKeyId = key.keyId
              event.dataTransfer.setData(REGISTERED_CELL_DRAG_MIME, key.keyId)
              event.dataTransfer.setData('text/plain', registeredCellTextDragData(key.keyId))
              event.dataTransfer.effectAllowed = 'copy'
              if (event.dataTransfer.setDragImage) {
                const dragImage = createRegisteredCellDragImage(dragLabel, dragSubLabel, event.currentTarget)
                document.body.append(dragImage)
                event.dataTransfer.setDragImage(dragImage, 0, 0)
                window.setTimeout(() => dragImage.remove(), 0)
              }
            }}
            onDragEnd={() => {
              delete (window as AssetDragWindow).__xsheetRemapRegisteredCellDragKeyId
            }}
            onDragOver={event => {
              if (!hasAssetDragPayload(event.dataTransfer)) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
            }}
            onDrop={handleDrop}
            onMouseEnter={event => showCardHoverPreview(event, dragLabel, thumbnailRows)}
            onMouseLeave={() => setCardHoverPreview(null)}
          >
            <div className="registeredCellHeader">
              <div className="registeredCellIdentity" aria-label={`${section.title} ${key.paperTrack}`}>
                <span className="registeredCellTrackBadge">{key.paperTrack}</span>
                {firstUse
                  ? (
                    <Tooltip label={firstUse.title}>
                      <button
                        type="button"
                        className="registeredCellFirstUse"
                        aria-label={uiText.keys.firstUseJump(firstUse.timecode)}
                        draggable={false}
                        onClick={event => {
                          event.stopPropagation()
                          onJumpToFirstUse(key.keyId)
                        }}
                        onPointerDown={event => event.stopPropagation()}
                        onDragStart={event => {
                          event.preventDefault()
                          event.stopPropagation()
                        }}
                      >
                        {uiText.keys.firstUse(firstUse.timecode)}
                      </button>
                    </Tooltip>
                    )
                  : (
                    <Tooltip label={uiText.keys.unplaced}>
                      <span className="registeredCellFirstUse empty">
                        {uiText.keys.unplaced}
                      </span>
                    </Tooltip>
                    )}
                {registeredCellViewMode === 'list' && (
                  <>
                    <Tooltip label={registeredCellCompactTitle(key, cspCellName)}>
                      <strong className="registeredCellCompactName">{primaryName}</strong>
                    </Tooltip>
                    {showCspSubLabel && (
                      <Tooltip label={cspCellName}>
                        <small className="registeredCellCompactSub">{uiText.keys.cspCellName}: {cspCellName}</small>
                      </Tooltip>
                    )}
                    {processLabels.length > 0 && (
                      <span className="registeredCellProcessStrip" aria-label={uiText.keys.imageAsset}>
                        {processLabels.map(label => <span className="registeredCellAssetProcess" key={label}>{label}</span>)}
                      </span>
                    )}
                  </>
                )}
              </div>
              {assetRows.length > 0 && (
                <Tooltip label={uiText.assets.quickPreview}>
                  <button
                    type="button"
                    className="registeredCellPreviewButton"
                    aria-label={uiText.assets.previewDialog(dragLabel)}
                    draggable={false}
                    onClick={event => {
                      event.stopPropagation()
                      selectRegisteredCell(key)
                      void openPreviewForRegisteredCell(key)
                    }}
                    onPointerDown={event => event.stopPropagation()}
                    onDragStart={event => {
                      event.preventDefault()
                      event.stopPropagation()
                    }}
                  >
                    <span className="assetQuickPreviewIcon" aria-hidden="true" />
                  </button>
                </Tooltip>
              )}
              <Tooltip label={uiText.keys.delete}>
                <button
                  type="button"
                  className="registeredCellDeleteButton"
                  aria-label={uiText.keys.deleteLabel(dragLabel)}
                  draggable={false}
                  onClick={event => {
                    event.stopPropagation()
                    void onDeleteKey(key.keyId)
                  }}
                  onPointerDown={event => event.stopPropagation()}
                  onDragStart={event => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                >
                  <TrashIcon />
                </button>
              </Tooltip>
              <span className={isManualName ? 'cellNameMode manual' : 'cellNameMode'}>{isManualName ? uiText.keys.manualName : uiText.keys.autoName}</span>
            </div>
            {registeredCellViewMode === 'detail' && (
              <>
                <label className="registeredCellField">
                  <span>{uiText.keys.displayName}</span>
                  <input value={key.displayLabel} onChange={event => onUpdateKey(key.keyId, event.currentTarget.value)} />
                </label>
                <label className="registeredCellField">
                  <span>{uiText.keys.cspCellName}</span>
                  <input
                    value={cspCellName}
                    disabled={!slot}
                    onChange={event => {
                      if (slot) onUpdateCspCellName(key.keyId, slot.slotId, event.currentTarget.value)
                    }}
                  />
                </label>
                <div className="registeredCellMeta">
                  <span>{uiText.keys.imageAsset}</span>
                  <div className="registeredCellAssetList">
                    {assetRows.length === 0
                      ? <span className="registeredCellAssetEmpty">{uiText.app.unassigned}</span>
                      : assetRows.map(row => (
                        <div
                          className="registeredCellAssetRow"
                          key={row.bindingId}
                          onDragOver={event => {
                            if (!hasAssetDragPayload(event.dataTransfer)) return
                            event.preventDefault()
                            event.stopPropagation()
                            event.dataTransfer.dropEffect = 'copy'
                          }}
                          onDrop={handleAssetRowDrop}
                        >
                          <Tooltip label={uiText.processMove.badgeTitle(row.processLabel)}>
                            <button
                              type="button"
                              className="registeredCellAssetProcess registeredCellAssetProcessButton"
                              onClick={event => openProcessMoveMenu(event, row.slotId)}
                              onContextMenu={event => openProcessMoveMenu(event, row.slotId)}
                              onPointerDown={event => event.stopPropagation()}
                          >
                            {row.processLabel}
                          </button>
                        </Tooltip>
                          <Tooltip label={`${row.processLabel}: ${row.assetName} / ${row.cspCellName}`}>
                            <strong>{row.assetName}</strong>
                          </Tooltip>
                        </div>
                      ))}
                  </div>
                </div>
                {slot && isManualName && (
                  <Tooltip label={uiText.keys.resetAutoNameTitle}>
                    <button className="registeredCellAutoButton" onClick={() => onUpdateCspCellName(key.keyId, slot.slotId, automaticName)}>
                      {uiText.keys.resetAutoName}
                    </button>
                  </Tooltip>
                )}
              </>
            )}
          </article>
        )
      })}
          </div>
        </section>
      ))}
      <section className="registeredCellSection stackGuideCardSection" data-section-title={uiText.stackGuides.title} aria-label={uiText.stackGuides.title}>
        <div className="stackGuideSectionHeader">
          <TooltipTarget label={uiText.stackGuides.titleHelp}>
            {tooltipProps => <h3 {...tooltipProps}>{uiText.stackGuides.title}</h3>}
          </TooltipTarget>
          <div className="stackGuideCreateButtons">
            <ActionMenu
              label={<PlusIcon />}
              ariaLabel={uiText.stackGuides.addMenu}
              tooltipLabel={uiText.stackGuides.addMenuTitle}
              className="stackGuideAddMenu iconActionMenu"
              closeOnMenuItemClick
            >
              <Tooltip label={uiText.stackGuides.addBackgroundBookTitle}>
                <button type="button" onClick={() => onRequestStackGuideInsert('label-editor')}>{uiText.stackGuides.add}</button>
              </Tooltip>
              <Tooltip label={uiText.stackGuides.addOverlayTrackTitle}>
                <button type="button" onClick={() => onRequestStackGuideInsert('overlay-track')}>{uiText.stackGuides.addOverlayTrack}</button>
              </Tooltip>
              <Tooltip label={uiText.stackGuides.addCameraNoteTitle}>
                <button type="button" onClick={() => setStackGuideDraft({ kind: 'camera-note', label: '' })}>{uiText.stackGuides.addCameraNote}</button>
              </Tooltip>
              <Tooltip label={uiText.stackGuides.addMemoTitle}>
                <button type="button" onClick={() => setStackGuideDraft({ kind: 'memo', label: '' })}>{uiText.stackGuides.addMemo}</button>
              </Tooltip>
            </ActionMenu>
          </div>
        </div>
        {stackGuideDraft && (
          <form
            className="stackGuideCreateForm"
            onSubmit={event => {
              event.preventDefault()
              const label = stackGuideDraft.label.trim()
              if (!label) return
              onCreateStackGuideLabel({
                label,
                kind: stackGuideDraft.kind,
                gapIndex: project.logicalSheet.paperTracks.length,
                correctionLayerId: activeCorrectionLayerId,
              })
              setStackGuideDraft(null)
            }}
          >
            <input
              autoFocus
              aria-label={uiText.stackGuides.inputLabel}
              placeholder={stackGuideDraft.kind === 'camera-note' ? uiText.stackGuides.cameraNotePlaceholder : uiText.stackGuides.memoPlaceholder}
              value={stackGuideDraft.label}
              onChange={event => {
                const label = event.currentTarget.value
                setStackGuideDraft(current => current ? { ...current, label } : current)
              }}
            />
            <Tooltip label={uiText.stackGuides.confirm}>
              <button type="submit" className="stackGuideEditorIconButton" aria-label={uiText.stackGuides.confirm}>✓</button>
            </Tooltip>
            <Tooltip label={uiText.stackGuides.cancel}>
              <button type="button" className="stackGuideEditorIconButton" aria-label={uiText.stackGuides.cancel} onClick={() => setStackGuideDraft(null)}>×</button>
            </Tooltip>
          </form>
        )}
        {stackGuideLabels.length === 0
          ? <p className="muted">{uiText.stackGuides.empty}</p>
          : (
            <>
          {stackGuideLabels.map(label => {
            const rows = stackGuideAssetRows(project, label)
            const kindLabel = stackGuideKindLabel(label.kind)
            const processLabels = registeredCellProcessLabels(rows)
            const thumbnailRows = rows.map(row => ({
              rowId: row.rowId,
              correctionLayerId: row.correctionLayerId,
              processLabel: row.processLabel,
              cspCellName: row.cspCellName,
              assetName: row.assetName,
              thumbnailUrl: row.thumbnailUrl,
              detailText: row.detailText,
            }))
            const registrationRows = stackGuideRegistrations(label)
              .map(registration => {
                const layer = project.correctionLayers.find(item => item.layerId === registration.correctionLayerId)
                const assets = registration.assetIds.flatMap(assetId => {
                  const asset = project.assets.find(item => item.assetId === assetId)
                  return asset ? [asset] : []
                })
                return { layer, registration, assets }
              })
              .sort((a, b) =>
                (a.layer?.order ?? Number.MAX_SAFE_INTEGER) - (b.layer?.order ?? Number.MAX_SAFE_INTEGER)
                || a.registration.correctionLayerId.localeCompare(b.registration.correctionLayerId, 'ja'),
              )

            function handleDrop(event: DragEvent<HTMLElement>) {
              const assetId = assetIdFromAssetDragData(event.dataTransfer)
              if (!assetId) return
              event.preventDefault()
              event.stopPropagation()
              setStackGuideDrop({ labelId: label.labelId, assetId, x: event.clientX, y: event.clientY })
            }

            function handleLayerDrop(event: DragEvent<HTMLElement>, correctionLayerId: string) {
              const assetId = assetIdFromAssetDragData(event.dataTransfer)
              if (!assetId) return
              event.preventDefault()
              event.stopPropagation()
              onAssignAssetToStackGuideLabel(label.labelId, assetId, correctionLayerId)
              setStackGuideDrop(null)
            }

            return (
              <article
                key={label.labelId}
                className={[
                  'registeredCellCard',
                  'stackGuideCard',
                  registeredCellViewMode === 'list' ? 'compact' : '',
                ].filter(Boolean).join(' ')}
                data-stack-guide-label-id={label.labelId}
                draggable={stackGuideStackBand(label) === 'cell-interleave'}
                onDragStart={event => {
                  setCardHoverPreview(null)
                  if (isInteractiveKeyboardTarget(event.target) || stackGuideStackBand(label) !== 'cell-interleave') {
                    event.preventDefault()
                    return
                  }
                  event.dataTransfer.setData(STACK_GUIDE_DRAG_MIME, label.labelId)
                  event.dataTransfer.effectAllowed = 'move'
                  if (event.dataTransfer.setDragImage) {
                    const dragImage = createRegisteredCellDragImage(label.label, kindLabel, event.currentTarget)
                    document.body.append(dragImage)
                    event.dataTransfer.setDragImage(dragImage, 0, 0)
                    window.setTimeout(() => dragImage.remove(), 0)
                  }
                }}
                onDragOver={event => {
                  if (!hasAssetDragPayload(event.dataTransfer)) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'copy'
                }}
                onDrop={handleDrop}
                onMouseEnter={event => showCardHoverPreview(event, label.label, thumbnailRows)}
                onMouseLeave={() => setCardHoverPreview(null)}
              >
                <div className="registeredCellHeader">
                  <div className="registeredCellIdentity" aria-label={uiText.stackGuides.cardLabel(label.label)}>
                    <span className="registeredCellRoleBadge">{kindLabel}</span>
                    <span className="registeredCellTrackBadge">{label.label}</span>
                    {registeredCellViewMode === 'list' && processLabels.length > 0 && (
                      <span className="registeredCellProcessStrip" aria-label={uiText.keys.imageAsset}>
                        {processLabels.map(processLabel => <span className="registeredCellAssetProcess" key={processLabel}>{processLabel}</span>)}
                      </span>
                    )}
                  </div>
                  {rows.length > 0 && (
                    <Tooltip label={uiText.assets.quickPreview}>
                      <button
                        type="button"
                        className="registeredCellPreviewButton"
                        aria-label={uiText.assets.previewDialog(label.label)}
                        draggable={false}
                        onClick={event => {
                          event.stopPropagation()
                          void openPreviewForStackGuideLabel(label)
                        }}
                        onPointerDown={event => event.stopPropagation()}
                      >
                        <span className="assetQuickPreviewIcon" aria-hidden="true" />
                      </button>
                    </Tooltip>
                  )}
                  <Tooltip label={uiText.keys.delete}>
                    <button
                      type="button"
                      className="registeredCellDeleteButton"
                      aria-label={uiText.keys.deleteLabel(label.label)}
                      draggable={false}
                      onClick={event => {
                        event.stopPropagation()
                        onDeleteStackGuideLabel(label.labelId)
                      }}
                      onPointerDown={event => event.stopPropagation()}
                      onDragStart={event => {
                        event.preventDefault()
                        event.stopPropagation()
                      }}
                    >
                      <TrashIcon />
                    </button>
                  </Tooltip>
                </div>
                {registeredCellViewMode === 'detail' && (
                  <>
                    <label className="registeredCellField">
                      <span>{uiText.stackGuides.label}</span>
                      <input value={label.label} onChange={event => onUpdateStackGuideLabel(label.labelId, { label: event.currentTarget.value })} />
                    </label>
                    <div className="registeredCellMeta">
                      <span>{uiText.stackGuides.registrations}</span>
                      <div className="stackGuideRegistrationList">
                        {registrationRows.length === 0
                          ? <span className="registeredCellAssetEmpty">{uiText.app.unassigned}</span>
                          : registrationRows.map(row => (
                            <div
                              className="stackGuideRegistrationRow"
                              key={row.registration.registrationId}
                              data-stack-guide-label-id={label.labelId}
                              data-correction-layer-id={row.registration.correctionLayerId}
                              onDragOver={event => {
                                if (!hasAssetDragPayload(event.dataTransfer)) return
                                event.preventDefault()
                                event.stopPropagation()
                                event.dataTransfer.dropEffect = 'copy'
                              }}
                              onDrop={event => handleLayerDrop(event, row.registration.correctionLayerId)}
                            >
                              <span className="registeredCellAssetProcess">{row.layer?.label ?? row.registration.correctionLayerId}</span>
                              <input
                                aria-label={`${row.layer?.label ?? row.registration.correctionLayerId} ${uiText.keys.cspCellName}`}
                                value={stackGuideCspCellName(label, row.registration)}
                                onChange={event => onUpdateStackGuideRegistration(label.labelId, row.registration.correctionLayerId, event.currentTarget.value)}
                              />
                              <Tooltip label={`${row.layer?.label ?? row.registration.correctionLayerId}: ${stackGuideCspCellName(label, row.registration)}`}>
                                <strong>{row.assets.length > 0 ? row.assets.map(asset => asset.displayName).join(', ') : uiText.app.unassigned}</strong>
                              </Tooltip>
                            </div>
                          ))}
                      </div>
                    </div>
                  </>
                )}
              </article>
            )
          })}
            </>
          )}
      </section>
      {stackGuideDrop && (
        <div className="stackGuideDropMenuScrim" onPointerDown={() => setStackGuideDrop(null)}>
          <div
            className="stackGuideDropMenu"
            style={stackGuideDropMenuStyle(stackGuideDrop.x, stackGuideDrop.y)}
            role="menu"
            aria-label={uiText.stackGuides.selectCorrectionLayer}
            onPointerDown={event => event.stopPropagation()}
          >
            <strong>{uiText.stackGuides.selectCorrectionLayer}</strong>
            {project.correctionLayers
              .slice()
              .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'ja'))
              .map(layer => {
                const label = project.stackGuideLabels.find(item => item.labelId === stackGuideDrop.labelId)
                const registration = label ? stackGuideRegistrationForLayer(label, layer.layerId) : undefined
                const assetCount = registration?.assetIds.length ?? 0
                return (
                  <button
                    type="button"
                    key={layer.layerId}
                    role="menuitem"
                    onClick={() => {
                      onAssignAssetToStackGuideLabel(stackGuideDrop.labelId, stackGuideDrop.assetId, layer.layerId)
                      setStackGuideDrop(null)
                    }}
                  >
                    <span>{layer.label}</span>
                    <small>{registration ? uiText.stackGuides.registeredAssetCount(assetCount) : uiText.stackGuides.unregistered}</small>
                  </button>
                )
              })}
          </div>
        </div>
      )}
      {processMoveMenu && (
        <ProcessMoveMenu
          project={project}
          keyId={processMoveMenu.keyId}
          sourceSlotId={processMoveMenu.sourceSlotId}
          x={processMoveMenu.x}
          y={processMoveMenu.y}
          onSelect={targetCorrectionLayerId => {
            onMoveKeyBindingProcess(processMoveMenu.keyId, processMoveMenu.sourceSlotId, targetCorrectionLayerId)
            setProcessMoveMenu(null)
          }}
          onCancel={() => setProcessMoveMenu(null)}
        />
      )}
      {embeddedPreviewOpen && activeEmbeddedPreviewPayload && (
        <AssetFloatingPreview
          payload={activeEmbeddedPreviewPayload}
          rect={previewRect}
          isDragPassthrough={false}
          onRectChange={updatePreviewRect}
          onClose={() => {
            setEmbeddedPreviewOpen(false)
            setEmbeddedPreviewKind(null)
          }}
        />
      )}
      {cardHoverPreview && (
        <RegisteredCellHoverPreviewOverlay
          project={project}
          rows={cardHoverPreview.rows}
          label={cardHoverPreview.label}
          style={cardHoverPreview.style}
        />
      )}
      {normalizationOpen && (
        <NameNormalizationDialog
          project={project}
          selectedKeyId={selectedKeyId}
          selectedHit={selectedHit}
          rangeSelection={rangeSelection}
          onClose={() => setNormalizationOpen(false)}
          onApply={async plan => {
            await onApplyNameNormalization(plan)
            setNormalizationOpen(false)
          }}
        />
      )}
    </div>
  )
}

function FrameOperationDialog({
  state,
  project,
  onSubmit,
  onClose,
}: {
  state: FrameOperationDialogState
  project: CutProject
  onSubmit: (input: FrameOperationSubmit) => void
  onClose: () => void
}) {
  const selectedSpanFrames = Math.max(1, state.frameEnd - state.frameStart + 1)
  const deleteUsesSelectedRange = state.kind === 'delete' && state.sourceRange !== null
  const trackScope: TimelineFrameEditScope = state.paperTracks.length > 1 ? 'tracks' : 'track'
  const [scope, setScope] = useState<TimelineFrameEditScope>(trackScope)
  const [frameCount, setFrameCount] = useState(selectedSpanFrames)
  const [durationPolicy, setDurationPolicy] = useState<TimelineInsertDurationPolicy | TimelineDeleteDurationPolicy>(() => defaultFrameOperationDurationPolicy(state.kind, trackScope))
  const title = state.kind === 'insert' ? uiText.frameOperation.dialogTitleInsert : uiText.frameOperation.dialogTitleDelete
  const hint = state.kind === 'insert' ? uiText.frameOperation.insertHint : uiText.frameOperation.deleteHint
  const sanitizedFrameCount = Math.max(1, Math.round(frameCount))

  function updateScope(nextScope: TimelineFrameEditScope) {
    setScope(nextScope)
    setDurationPolicy(defaultFrameOperationDurationPolicy(state.kind, nextScope))
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    onSubmit({
      scope,
      frameCount: sanitizedFrameCount,
      durationPolicy,
    })
  }

  return createPortal(
    <div className="assetQuickPreviewBackdrop frameOperationBackdrop" role="dialog" aria-modal="true" aria-label={title} onPointerDown={onClose}>
      <form className="frameOperationDialog" onSubmit={submit} onPointerDown={event => event.stopPropagation()}>
        <header className="frameOperationHeader">
          <div>
            <strong>{title}</strong>
            <span>{hint}</span>
          </div>
          <button type="button" className="dialogIconButton" aria-label={uiText.actions.cancel} onClick={onClose}>×</button>
        </header>
        <div className="frameOperationBody">
          <div className="frameOperationSummary">
            <span>{state.sourceRange
              ? uiText.frameOperation.selectedRange(
                  formatFramePosition(project, state.frameStart),
                  formatFramePosition(project, state.frameEnd),
                  selectedSpanFrames,
                )
              : uiText.frameOperation.startFrame(formatFramePosition(project, state.frameStart))}</span>
            <span>{sheetRoleLabel(state.role)} {state.paperTracks.join(', ')}</span>
          </div>
          <fieldset className="frameOperationFieldset">
            <legend>{uiText.frameOperation.target}</legend>
            <label>
              <input type="radio" name="frameOperationScope" value={trackScope} checked={scope === trackScope} onChange={() => updateScope(trackScope)} />
              {state.paperTracks.length > 1 ? uiText.frameOperation.targetTracks : uiText.frameOperation.targetTrack}
            </label>
            <label>
              <input type="radio" name="frameOperationScope" value="cut" checked={scope === 'cut'} onChange={() => updateScope('cut')} />
              {uiText.frameOperation.targetCut}
            </label>
          </fieldset>
          <label className="frameOperationInputRow">
            <span>{uiText.frameOperation.frameCount}</span>
            <input
              type="number"
              min="1"
              step="1"
              value={sanitizedFrameCount}
              disabled={deleteUsesSelectedRange}
              onChange={event => setFrameCount(Number(event.currentTarget.value))}
            />
          </label>
          <fieldset className="frameOperationFieldset">
            <legend>{uiText.frameOperation.durationPolicy}</legend>
            <label>
              <input
                type="radio"
                name="frameOperationDuration"
                value="preserve"
                checked={durationPolicy === 'preserve'}
                onChange={() => setDurationPolicy('preserve')}
              />
              {uiText.frameOperation.preserveDuration}
            </label>
            {state.kind === 'insert' ? (
              <label>
                <input
                  type="radio"
                  name="frameOperationDuration"
                  value="extend"
                  checked={durationPolicy === 'extend'}
                  onChange={() => setDurationPolicy('extend')}
                />
                {uiText.frameOperation.extendDuration}
              </label>
            ) : (
              <label>
                <input
                  type="radio"
                  name="frameOperationDuration"
                  value="shrink"
                  checked={durationPolicy === 'shrink'}
                  onChange={() => setDurationPolicy('shrink')}
                />
                {uiText.frameOperation.shrinkDuration}
              </label>
            )}
          </fieldset>
        </div>
        <footer className="frameOperationFooter">
          <button type="button" onClick={onClose}>{uiText.actions.cancel}</button>
          <button type="submit">{state.kind === 'insert' ? uiText.frameOperation.submitInsert : uiText.frameOperation.submitDelete}</button>
        </footer>
      </form>
    </div>,
    document.body,
  )
}

function defaultFrameOperationDurationPolicy(kind: FrameOperationKind, scope: TimelineFrameEditScope): TimelineInsertDurationPolicy | TimelineDeleteDurationPolicy {
  if (kind === 'insert') return scope === 'cut' ? 'extend' : 'preserve'
  return scope === 'cut' ? 'shrink' : 'preserve'
}

type NameNormalizationTarget = 'selected-key' | 'selected-column' | 'cell' | 'action'

function NameNormalizationDialog({
  project,
  selectedKeyId,
  selectedHit,
  rangeSelection,
  onClose,
  onApply,
}: {
  project: CutProject
  selectedKeyId: string | null
  selectedHit: SheetHit | null
  rangeSelection: SheetRangeSelection | null
  onClose: () => void
  onApply: (plan: NameNormalizationPlan) => Promise<void>
}) {
  const [target, setTarget] = useState<NameNormalizationTarget>(() => defaultNameNormalizationTarget())
  const [includeAssetFiles, setIncludeAssetFiles] = useState(false)
  const [sequencePadding, setSequencePadding] = useState<number | undefined>(undefined)
  const [isApplying, setIsApplying] = useState(false)
  const targetOptions = nameNormalizationTargetOptions(project, selectedKeyId, selectedHit, rangeSelection)
  const options = useMemo<NameNormalizationOptions>(
    () => nameNormalizationOptionsForTarget(project, target, selectedKeyId, selectedHit, rangeSelection, includeAssetFiles, sequencePadding),
    [includeAssetFiles, project, rangeSelection, selectedHit, selectedKeyId, sequencePadding, target],
  )
  const plan = useMemo(() => buildNameNormalizationPlan(project, options), [options, project])
  const assetRenameByAssetId = useMemo(() => new Map(plan.assetRenames.map(rename => [rename.assetId, rename])), [plan.assetRenames])
  const cspChangeCount = plan.items.filter(item => item.cspCellNameChanged).length
  const assetRenameCount = plan.assetRenames.filter(rename => rename.currentFileName !== rename.nextFileName).length
  const canApply = !isApplying && (cspChangeCount > 0 || plan.assetRenames.some(rename => rename.canRename))

  async function handleApply() {
    if (!canApply) return
    setIsApplying(true)
    try {
      await onApply(plan)
    } catch (error) {
      window.alert(uiText.nameNormalization.applyFailed(errorMessage(error)))
      setIsApplying(false)
    }
  }

  return (
    <div className="assetQuickPreviewBackdrop nameNormalizationBackdrop" role="dialog" aria-modal="true" aria-label={uiText.nameNormalization.title}>
      <section className="nameNormalizationDialog">
        <header className="nameNormalizationHeader">
          <strong>{uiText.nameNormalization.title}</strong>
          <button onClick={onClose}>{uiText.nameNormalization.cancel}</button>
        </header>
        <div className="nameNormalizationControls">
          <label>
            {uiText.nameNormalization.target}
            <select value={target} onChange={event => setTarget(event.currentTarget.value as NameNormalizationTarget)}>
              {targetOptions.map(option => (
                <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            {uiText.nameNormalization.padding}
            <select value={sequencePadding === undefined ? 'auto' : String(sequencePadding)} onChange={event => setSequencePadding(event.currentTarget.value === 'auto' ? undefined : Number(event.currentTarget.value))}>
              <option value="auto">{uiText.nameNormalization.paddingAuto}</option>
              <option value="3">3</option>
              <option value="4">4</option>
            </select>
          </label>
          <label className="nameNormalizationCheckbox">
            <input type="checkbox" checked={includeAssetFiles} onChange={event => setIncludeAssetFiles(event.currentTarget.checked)} />
            {uiText.nameNormalization.includeAssetFiles}
          </label>
        </div>
        <div className="nameNormalizationSummary">
          <span>{uiText.nameNormalization.cspChanges(cspChangeCount)}</span>
          <span>{uiText.nameNormalization.assetRenames(assetRenameCount)}</span>
        </div>
        {plan.warnings.length > 0 && (
          <div className="nameNormalizationWarnings">
            {plan.warnings.slice(0, 6).map((warning, index) => <p key={`${index}-${warning}`}>{warning}</p>)}
            {plan.warnings.length > 6 && <p>{uiText.nameNormalization.moreWarnings(plan.warnings.length - 6)}</p>}
          </div>
        )}
        <div className="nameNormalizationTableWrap">
          <table className="nameNormalizationTable">
            <thead>
              <tr>
                <th>{uiText.nameNormalization.headers.process}</th>
                <th>{uiText.nameNormalization.headers.track}</th>
                <th>{uiText.nameNormalization.headers.display}</th>
                <th>{uiText.nameNormalization.headers.currentCsp}</th>
                <th>{uiText.nameNormalization.headers.nextCsp}</th>
                <th>{uiText.nameNormalization.headers.asset}</th>
                <th>{uiText.nameNormalization.headers.nextFile}</th>
                <th>{uiText.nameNormalization.headers.status}</th>
              </tr>
            </thead>
            <tbody>
              {plan.items.slice(0, 160).map(item => {
                const rename = item.assetId ? assetRenameByAssetId.get(item.assetId) : undefined
                const status = [
                  item.cspCellNameChanged ? uiText.nameNormalization.status.csp : '',
                  rename && rename.currentFileName !== rename.nextFileName
                    ? rename.canRename ? uiText.nameNormalization.status.file : uiText.nameNormalization.status.fileBlocked
                    : '',
                ].filter(Boolean).join(' / ') || uiText.nameNormalization.status.noChange
                return (
                  <tr key={item.itemId}>
                    <td>{item.processLabel ?? '-'}</td>
                    <td>{item.paperTrack}</td>
                    <td>{item.displayLabel}</td>
                    <td>{item.currentCspCellName}</td>
                    <td>{item.nextCspCellName}</td>
                    <td>{item.assetDisplayName ?? '-'}</td>
                    <td>
                      <Tooltip label={rename?.representativeReason ?? ''}>
                        <span>{rename ? rename.nextFileName : '-'}</span>
                      </Tooltip>
                    </td>
                    <td>{status}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {plan.items.length > 160 && <p className="muted">{uiText.nameNormalization.moreRows(plan.items.length - 160)}</p>}
        </div>
        <footer className="nameNormalizationFooter">
          <button onClick={onClose}>{uiText.nameNormalization.cancel}</button>
          <button disabled={!canApply} onClick={() => void handleApply()}>
            {isApplying ? uiText.nameNormalization.applying : uiText.nameNormalization.apply}
          </button>
        </footer>
      </section>
    </div>
  )
}

function SheetImageExportDialog({
  project,
  template,
  initialOptions,
  onClose,
  onExport,
}: {
  project: CutProject
  template: SheetTemplate
  initialOptions: SheetImageExportOptions
  onClose: () => void
  onExport: (options: SheetImageExportOptions) => Promise<void>
}) {
  const hasPaper = hasPaperSheetImages(project)
  const hasTemplateImage = Boolean(template.defaultUnderlay)
  const [options, setOptions] = useState(() => normalizeSheetImageExportDialogOptions(initialOptions, hasPaper, hasTemplateImage))
  const [isSaving, setIsSaving] = useState(false)

  function updateIncludePaperSheet(includePaperSheet: boolean) {
    setOptions(current => normalizeSheetImageExportDialogOptions({ ...current, includePaperSheet }, hasPaper, hasTemplateImage))
  }

  function updateTemplateImage(includeTemplateImage: boolean) {
    setOptions(current => normalizeSheetImageExportDialogOptions({ ...current, includeTemplateImage }, hasPaper, hasTemplateImage))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSaving(true)
    try {
      await onExport(normalizeSheetImageExportDialogOptions(options, hasPaper, hasTemplateImage))
    } catch {
      setIsSaving(false)
    }
  }

  return (
    <div className="assetQuickPreviewBackdrop sheetImageExportBackdrop" role="dialog" aria-modal="true" aria-label={uiText.actions.imageExport}>
      <form className="sheetImageExportDialog" onSubmit={event => void handleSubmit(event)}>
        <header className="sheetImageExportHeader">
          <div>
            <strong>{uiText.actions.imageExportTitle(options.format.toUpperCase())}</strong>
            <span>{uiText.actions.imageExportMenuTitle}</span>
          </div>
        </header>
        <div className="sheetImageExportControls">
          <TooltipTarget label={uiText.actions.imageExportPaperSheetTitle}>
            {tooltipProps => (
              <label className="sheetImageExportCheckbox" {...tooltipProps}>
                <input
                  type="checkbox"
                  checked={options.includePaperSheet}
                  disabled={!hasPaper}
                  onChange={event => updateIncludePaperSheet(event.currentTarget.checked)}
                />
                {uiText.actions.imageExportPaperSheet}
              </label>
            )}
          </TooltipTarget>
          <fieldset className="sheetImageExportTemplateModes">
            <legend>{uiText.actions.imageExportLayers}</legend>
            <TooltipTarget label={uiText.actions.imageExportTemplateImageTitle}>
              {tooltipProps => (
                <label className={!hasTemplateImage ? 'disabled' : ''} {...tooltipProps}>
                  <input
                    type="checkbox"
                    checked={options.includeTemplateImage}
                    disabled={!hasTemplateImage}
                    onChange={event => updateTemplateImage(event.currentTarget.checked)}
                  />
                  {uiText.actions.imageExportTemplateImage}
                </label>
              )}
            </TooltipTarget>
            <TooltipTarget label={uiText.actions.imageExportTemplateDrawingTitle}>
              {tooltipProps => (
                <label {...tooltipProps}>
                  <input
                    type="checkbox"
                    checked={options.includeTemplateDrawing}
                    onChange={event => setOptions(current => ({ ...current, includeTemplateDrawing: event.currentTarget.checked }))}
                  />
                  {uiText.actions.imageExportTemplateDrawing}
                </label>
              )}
            </TooltipTarget>
          </fieldset>
        </div>
        <footer className="sheetImageExportFooter">
          <button type="button" onClick={onClose}>{uiText.nameNormalization.cancel}</button>
          <button type="submit" disabled={isSaving}>
            {isSaving ? uiText.nameNormalization.applying : uiText.actions.imageExportSave}
          </button>
        </footer>
      </form>
    </div>
  )
}

function normalizeSheetImageExportDialogOptions(
  options: SheetImageExportOptions,
  hasPaper: boolean,
  hasTemplateImage: boolean,
): SheetImageExportOptions {
  const includePaperSheet = hasPaper && options.includePaperSheet
  const includeTemplateImage = hasTemplateImage && options.includeTemplateImage
  return { ...options, includePaperSheet, includeTemplateImage }
}

interface RegisteredCellThumbnailRow {
  rowId: string
  correctionLayerId?: string
  processLabel: string
  cspCellName: string
  assetName: string
  thumbnailUrl?: string
  detailText?: string
}

function RegisteredCellHoverPreviewOverlay({ project, rows, label, style }: { project: CutProject; rows: RegisteredCellThumbnailRow[]; label: string; style: CSSProperties }) {
  const sortedRows = sortedThumbnailRows(project, rows)
  if (sortedRows.length === 0) return null
  return (
    <div className="registeredCellHoverPreview" role="tooltip" aria-label={uiText.assets.previewDialog(label)} style={style}>
      <div className="registeredCellHoverPreviewGrid">
        {sortedRows.slice(0, 8).map(row => (
          <TooltipTarget key={row.rowId} label={`${row.processLabel}: ${row.assetName}`}>
            {tooltipProps => (
              <div className="registeredCellHoverPreviewItem" {...tooltipProps}>
                <div className="registeredCellHoverPreviewImage">
                  {row.thumbnailUrl ? <img src={row.thumbnailUrl} alt="" /> : <div className="registeredCellThumbPlaceholder">{uiText.app.noPreview}</div>}
                </div>
                <div className="registeredCellHoverPreviewCaption">
                  <span className="registeredCellAssetProcess">{row.processLabel}</span>
                  <strong>{row.cspCellName || row.assetName}</strong>
                </div>
              </div>
            )}
          </TooltipTarget>
        ))}
        {sortedRows.length > 8 && <div className="registeredCellThumbMore">{uiText.sheet.moreRegisteredAssets(sortedRows.length - 8)}</div>}
      </div>
    </div>
  )
}

function registeredCellHoverPreviewStyle(anchor: DOMRect, rowCount: number): CSSProperties {
  const width = rowCount === 1 ? 178 : 348
  const visibleCount = Math.min(rowCount, 8)
  const columns = rowCount === 1 ? 1 : 2
  const rows = Math.ceil(visibleCount / columns)
  const estimatedHeight = Math.min(window.innerHeight - 24, 12 + rows * 190 + (rowCount > 8 ? 24 : 0))
  const rightSideLeft = anchor.right + 8
  const left = rightSideLeft + width <= window.innerWidth - 12
    ? rightSideLeft
    : Math.max(12, anchor.left - width - 8)
  const top = clampNumber(anchor.top, 12, Math.max(12, window.innerHeight - estimatedHeight - 12))
  return {
    left,
    top,
    width,
    maxHeight: 'calc(100vh - 24px)',
  }
}

function sortedThumbnailRows(project: CutProject, rows: RegisteredCellThumbnailRow[]): RegisteredCellThumbnailRow[] {
  const defaultLayerId = defaultCorrectionLayerId(project)
  const correctionLayerOrder = new Map(sortedCorrectionLayers(project).map((layer, index) => [layer.layerId, index]))
  return [...rows].sort((a, b) =>
    (a.correctionLayerId === defaultLayerId ? 0 : 1) - (b.correctionLayerId === defaultLayerId ? 0 : 1)
    || (correctionLayerOrder.get(a.correctionLayerId ?? '') ?? 999) - (correctionLayerOrder.get(b.correctionLayerId ?? '') ?? 999)
    || a.processLabel.localeCompare(b.processLabel, 'ja')
    || a.assetName.localeCompare(b.assetName, 'ja'),
  )
}

function defaultNameNormalizationTarget(): NameNormalizationTarget {
  return 'action'
}

function nameNormalizationTargetOptions(
  project: CutProject,
  selectedKeyId: string | null,
  selectedHit: SheetHit | null,
  rangeSelection: SheetRangeSelection | null,
) {
  return [
    { value: 'selected-key' as const, label: uiText.nameNormalization.targets.selectedKey, disabled: !selectedKeyId || !project.logicalSheet.keys.some(key => key.keyId === selectedKeyId) },
    { value: 'selected-column' as const, label: uiText.nameNormalization.targets.selectedColumn, disabled: !normalizationColumnTarget(selectedHit, rangeSelection) },
    { value: 'cell' as const, label: uiText.nameNormalization.targets.cell },
    { value: 'action' as const, label: uiText.nameNormalization.targets.action },
  ]
}

function nameNormalizationOptionsForTarget(
  project: CutProject,
  target: NameNormalizationTarget,
  selectedKeyId: string | null,
  selectedHit: SheetHit | null,
  rangeSelection: SheetRangeSelection | null,
  includeAssetFiles: boolean,
  sequencePadding: number | undefined,
): NameNormalizationOptions {
  const selectedKey = selectedKeyId ? project.logicalSheet.keys.find(key => key.keyId === selectedKeyId) ?? null : null
  const columnTarget = normalizationColumnTarget(selectedHit, rangeSelection)
  const base = { includeAssetFiles, includeStackGuides: target === 'action', sequencePadding }
  if (target === 'selected-key' && selectedKey) {
    return { ...base, sheetRole: sheetTimingRoleForKey(selectedKey), keyIds: [selectedKey.keyId] }
  }
  if (target === 'selected-column' && columnTarget) {
    return { ...base, sheetRole: columnTarget.sheetRole, paperTracks: columnTarget.paperTracks }
  }
  return {
    ...base,
    sheetRole: target === 'action' ? 'action' : 'cell',
  }
}

function normalizationColumnTarget(
  selectedHit: SheetHit | null,
  rangeSelection: SheetRangeSelection | null,
): { sheetRole: SheetTimingRole; paperTracks: string[] } | null {
  if (rangeSelection && (rangeSelection.role === 'action' || rangeSelection.role === 'cell') && rangeSelection.paperTrack) {
    return { sheetRole: rangeSelection.role, paperTracks: rangePaperTracks(rangeSelection) }
  }
  if (selectedHit?.paperTrack && (selectedHit.role === 'action' || selectedHit.role === 'cell')) {
    return { sheetRole: sheetRoleForHit(selectedHit), paperTracks: [selectedHit.paperTrack] }
  }
  return null
}

function registeredCellSectionsForUi(project: CutProject, trackOrder: Map<string, number>, direction: RegisteredCellSortDirection): RegisteredCellSection[] {
  const comparer = compareRegisteredCellKeysForUi(project, trackOrder)
  return ([
    { sectionId: 'action', title: uiText.keys.sections.action },
    { sectionId: 'cell', title: uiText.keys.sections.cell },
  ] as const)
    .map(section => {
      const keys = project.logicalSheet.keys
        .filter(key => sheetTimingRoleForKey(key) === section.sectionId)
        .sort(comparer)
      return {
        ...section,
        keys: direction === 'asc' ? keys : keys.reverse(),
      }
    })
    .filter(section => section.keys.length > 0)
}

function compareRegisteredCellKeysForUi(project: CutProject, trackOrder: Map<string, number>) {
  const firstUseByKeyId = new Map(
    project.logicalSheet.keys.map(key => [key.keyId, firstTimelineUseForKey(project, key, trackOrder)]),
  )
  return (a: TimingKey, b: TimingKey): number =>
    (trackOrder.get(a.paperTrack) ?? Number.MAX_SAFE_INTEGER) - (trackOrder.get(b.paperTrack) ?? Number.MAX_SAFE_INTEGER)
    || compareNaturalFileNameText(a.paperTrack, b.paperTrack)
    || (firstUseByKeyId.get(a.keyId)?.frame ?? Number.MAX_SAFE_INTEGER) - (firstUseByKeyId.get(b.keyId)?.frame ?? Number.MAX_SAFE_INTEGER)
    || compareNaturalFileNameText(a.displayLabel, b.displayLabel)
    || a.keyId.localeCompare(b.keyId, 'ja')
}

function registeredCellPrimaryDisplayName(key: TimingKey, cspCellName: string): string {
  return key.displayLabel.trim() || cspCellName || key.paperTrack
}

function registeredCellCompactTitle(key: TimingKey, cspCellName: string): string {
  return [key.displayLabel.trim(), cspCellName].filter(Boolean).join(' / ') || key.paperTrack
}

function registeredCellProcessLabels(rows: Array<{ processLabel: string }>): string[] {
  return Array.from(new Set(rows.map(row => row.processLabel).filter(Boolean)))
}

function registeredCellTrackOrder(project: CutProject): Map<string, number> {
  return new Map(
    cellStackOrderItems(project)
      .filter((item): item is Extract<CellStackOrderItem, { paperTrack: string }> => 'paperTrack' in item)
      .map((item, index) => [item.paperTrack, index]),
  )
}

function firstTimelineUseForKey(project: CutProject, key: TimingKey, trackOrder: Map<string, number>): RegisteredCellFirstUse | null {
  const keyRole = sheetTimingRoleForKey(key)
  const roleMatchedEvents = project.logicalSheet.events.filter(event =>
    event.keyId === key.keyId
    && sheetTimingRoleForEvent(event) === keyRole,
  )
  const events = roleMatchedEvents.length > 0
    ? roleMatchedEvents
    : project.logicalSheet.events.filter(event => event.keyId === key.keyId)
  if (events.length === 0) return null

  const [first] = [...events].sort((a, b) =>
    (trackOrder.get(a.paperTrack) ?? Number.MAX_SAFE_INTEGER) - (trackOrder.get(b.paperTrack) ?? Number.MAX_SAFE_INTEGER)
    || a.frame - b.frame
    || sheetTimingRoleSortValue(sheetTimingRoleForEvent(a)) - sheetTimingRoleSortValue(sheetTimingRoleForEvent(b))
    || a.eventId.localeCompare(b.eventId, 'ja'),
  )
  if (!first) return null

  const timecode = formatLogicalSheetFrameTimecode(first.frame, project.logicalSheet.frameOrigin, project.logicalSheet.fps)
  return {
    timecode,
    paperTrack: first.paperTrack,
    frame: first.frame,
    role: sheetTimingRoleForEvent(first),
    title: uiText.keys.firstUseTitle(sheetRoleLabel(sheetTimingRoleForEvent(first)), first.paperTrack, first.frame, timecode),
  }
}

function sheetTimingRoleSortValue(role: SheetTimingRole): number {
  return role === 'action' ? 0 : 1
}

function compareStackGuideLabelsForUi(project: CutProject) {
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

function primarySlotForKey(project: CutProject, key: Pick<TimingKey, 'paperTrack'>, activeCorrectionLayerId: string): CspTrackSlot | null {
  return project.cspTrackSlots.find(slot => slot.paperTrack === key.paperTrack && slot.correctionLayerId === activeCorrectionLayerId)
    ?? project.cspTrackSlots.find(slot => slot.paperTrack === key.paperTrack)
    ?? null
}

function automaticRegisteredCellCspName(key: TimingKey, slot: CspTrackSlot, primaryAsset: CutAsset | null): string {
  return key.displayLabel.trim()
    ? defaultCspCellName(key.displayLabel, slot.paperTrack)
    : primaryAsset
      ? assetBaseName(primaryAsset)
      : defaultCspCellName(key.displayLabel, slot.paperTrack)
}

function registeredCellAssetRows(project: CutProject, key: TimingKey) {
  const slotsById = new Map(project.cspTrackSlots.map(slot => [slot.slotId, slot]))
  const assetsById = new Map(project.assets.map(asset => [asset.assetId, asset]))
  const correctionLayerOrder = new Map(sortedCorrectionLayers(project).map((layer, index) => [layer.layerId, index]))
  return project.bindings
    .flatMap(binding => {
      if (binding.keyId !== key.keyId || !binding.assetId) return []
      const slot = slotsById.get(binding.slotId)
      const asset = assetsById.get(binding.assetId)
      if (!slot || !asset) return []
        return [{
          bindingId: binding.bindingId,
          slotId: slot.slotId,
          correctionLayerId: slot.correctionLayerId,
          assetId: asset.assetId,
          processLabel: processLabelForSlot(project, slot),
          assetName: asset.displayName,
          cspCellName: binding.cspCellName,
          thumbnailUrl: asset.thumbnailUrl,
          detailText: asset.relativePath ?? asset.currentPath ?? asset.displayName,
        sortKey: [
          correctionLayerOrder.get(slot.correctionLayerId ?? '') ?? 999,
          slot.trackNo,
          slot.occurrenceIndex,
          slot.displayPath,
          asset.displayName,
        ] as const,
      }]
    })
    .sort((a, b) =>
      a.sortKey[0] - b.sortKey[0]
      || a.sortKey[1] - b.sortKey[1]
      || a.sortKey[2] - b.sortKey[2]
      || a.sortKey[3].localeCompare(b.sortKey[3], 'ja')
      || a.sortKey[4].localeCompare(b.sortKey[4], 'ja'),
    )
    .map(row => ({
      bindingId: row.bindingId,
      slotId: row.slotId,
      correctionLayerId: row.correctionLayerId,
      assetId: row.assetId,
      processLabel: row.processLabel,
      assetName: row.assetName,
      cspCellName: row.cspCellName,
      thumbnailUrl: row.thumbnailUrl,
      detailText: row.detailText,
    }))
}

function singleMovableBindingForHit(project: CutProject, hit: SheetHit): { binding: CellBinding; slot: CspTrackSlot; key: TimingKey } | null {
  if (!hit.paperTrack) return null
  const sheetRole = sheetRoleForHit(hit)
  const event = project.logicalSheet.events.find(item =>
    item.paperTrack === hit.paperTrack
    && item.frame === hit.frame
    && sheetTimingRoleForEvent(item) === sheetRole,
  )
  if (!event || isNullCellKeyId(event.keyId)) return null
  const key = project.logicalSheet.keys.find(item => item.keyId === event.keyId)
  if (!key) return null
  const bindings = project.bindings.filter(binding => binding.keyId === key.keyId && binding.assetId)
  if (bindings.length !== 1) return null
  const binding = bindings[0]
  const slot = project.cspTrackSlots.find(item => item.slotId === binding.slotId)
  if (!slot) return null
  return { binding, slot, key }
}

function stackGuideAssetRows(project: CutProject, label: StackGuideLabel) {
  const assetsById = new Map(project.assets.map(asset => [asset.assetId, asset]))
  return stackGuideRegistrations(label).flatMap(registration => {
    const layer = project.correctionLayers.find(item => item.layerId === registration.correctionLayerId)
    return registration.assetIds.flatMap(assetId => {
      const asset = assetsById.get(assetId)
      if (!asset) return []
      return [{
        rowId: `${registration.registrationId}:${asset.assetId}`,
        registrationId: registration.registrationId,
        correctionLayerId: registration.correctionLayerId,
        processLabel: layer?.label ?? registration.correctionLayerId,
        cspCellName: stackGuideCspCellName(label, registration),
        assetId: asset.assetId,
        assetName: asset.displayName,
        thumbnailUrl: asset.thumbnailUrl,
        detailText: asset.relativePath ?? asset.currentPath ?? asset.displayName,
      }]
    })
  })
}

function stackGuideKindLabel(kind: StackGuideLabel['kind']): string {
  return uiText.stackGuides.kind[kind] ?? uiText.stackGuides.kind.other
}

function stackGuideDropMenuStyle(x: number, y: number): CSSProperties {
  const width = 188
  const minHeight = 160
  const inset = 8
  const viewportWidth = typeof window === 'undefined' ? width + inset * 2 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 420 : window.innerHeight
  const left = Math.max(inset, Math.min(x + 8, viewportWidth - width - inset))
  const top = Math.max(inset, Math.min(y + 8, viewportHeight - minHeight - inset))
  return {
    left,
    top,
    width,
    maxHeight: Math.max(minHeight, viewportHeight - top - inset),
  }
}

function sheetContextMenuStyle(x: number, y: number, itemCount: number): CSSProperties {
  const width = 240
  const height = 10 + Math.max(1, itemCount) * 34
  const inset = 8
  const viewportWidth = typeof window === 'undefined' ? width + inset * 2 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? height + inset * 2 : window.innerHeight
  return {
    left: Math.max(inset, Math.min(x, viewportWidth - width - inset)),
    top: Math.max(inset, Math.min(y, viewportHeight - height - inset)),
    width,
  }
}

function floatingEditorStyle(x: number, y: number): CSSProperties {
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

function assetRegistrationSummaries(project: CutProject): Map<string, AssetRegistrationSummary> {
  const keysById = new Map(project.logicalSheet.keys.map(key => [key.keyId, key]))
  const slotsById = new Map(project.cspTrackSlots.map(slot => [slot.slotId, slot]))
  const detailsByAssetId = new Map<string, string[]>()

  for (const binding of project.bindings) {
    if (!binding.assetId) continue
    const key = keysById.get(binding.keyId)
    const slot = slotsById.get(binding.slotId)
    const detail = assetRegistrationDetail(binding, key, slot)
    const details = detailsByAssetId.get(binding.assetId) ?? []
    if (!details.includes(detail)) details.push(detail)
    detailsByAssetId.set(binding.assetId, details)
  }
  for (const label of project.stackGuideLabels) {
    const kindLabel = stackGuideKindLabel(label.kind)
    for (const row of stackGuideAssetRows(project, label)) {
      const detail = [kindLabel, label.label, row.processLabel, row.cspCellName].filter(Boolean).join(' / ')
      const details = detailsByAssetId.get(row.assetId) ?? []
      if (!details.includes(detail)) details.push(detail)
      detailsByAssetId.set(row.assetId, details)
    }
  }

  return new Map(Array.from(detailsByAssetId.entries()).map(([assetId, details]) => {
    const sortedDetails = [...details].sort(compareNaturalFileNameText)
    const count = sortedDetails.length
    return [assetId, {
      badgeLabel: count === 1 ? uiText.assets.registered : uiText.assets.registeredCount(count),
      title: `${count === 1 ? uiText.assets.registered : uiText.assets.registeredCount(count)}\n${sortedDetails.join('\n')}`,
    }]
  }))
}

function assetRegistrationDetail(binding: CellBinding, key: TimingKey | undefined, slot: CspTrackSlot | undefined): string {
  const roleLabel = key ? sheetRoleLabel(sheetTimingRoleForKey(key)) : ''
  const paperTrack = key?.paperTrack ?? slot?.paperTrack ?? ''
  const cellName = binding.cspCellName || key?.displayLabel || uiText.assetDrop.untitledCell
  const processLabel = slot?.displayPath ?? slot?.xdtsName ?? ''
  const sheetLabel = [roleLabel, paperTrack].filter(Boolean).join(' ')
  return [processLabel, sheetLabel, cellName].filter(Boolean).join(' / ')
}

async function updateNativeRegisteredCellPreviewIfOpen(project: CutProject, key: TimingKey): Promise<boolean> {
  const payload = await nativeRegisteredCellPreviewPayload(project, key)
  return payload ? updateNativeAssetPreviewPayloadIfOpen(payload) : false
}

async function nativeRegisteredCellPreviewPayload(project: CutProject, key: TimingKey): Promise<AssetPreviewPayload | null> {
  if (!isTauriHost()) return null
  const rows = registeredCellAssetRows(project, key)
  const assetsById = new Map(project.assets.map(asset => [asset.assetId, asset]))
  const items = (await Promise.all(rows.map(row => {
    const asset = assetsById.get(row.assetId)
    if (!asset) return null
    return nativeAssetPreviewItemPayload(asset, {
      label: row.cspCellName || row.assetName,
      processLabel: row.processLabel,
    })
  }))).filter((item): item is AssetPreviewItemPayload => Boolean(item))
  if (items.length === 0) return null
  return {
    displayName: registeredCellPreviewName(key),
    imageUrl: items.length === 1 ? items[0].imageUrl : undefined,
    detailText: items.length === 1 ? items[0].detailText : undefined,
    items,
  }
}

async function nativeStackGuidePreviewPayload(project: CutProject, label: StackGuideLabel): Promise<AssetPreviewPayload | null> {
  if (!isTauriHost()) return null
  const assetsById = new Map(project.assets.map(asset => [asset.assetId, asset]))
  const rows = stackGuideAssetRows(project, label)
  const items = (await Promise.all(rows.map(row => {
    const asset = assetsById.get(row.assetId)
    if (!asset) return null
    return nativeAssetPreviewItemPayload(asset, {
      label: row.cspCellName,
      processLabel: row.processLabel,
    })
  }))).filter((item): item is AssetPreviewItemPayload => Boolean(item))
  if (items.length === 0) return null
  return {
    displayName: label.label,
    imageUrl: items.length === 1 ? items[0].imageUrl : undefined,
    detailText: items.length === 1 ? items[0].detailText : undefined,
    items,
  }
}

function embeddedRegisteredCellPreviewPayload(project: CutProject, key: TimingKey): AssetPreviewPayload | null {
  const rows = registeredCellAssetRows(project, key)
  const assetsById = new Map(project.assets.map(asset => [asset.assetId, asset]))
  const items = rows.flatMap<AssetPreviewItemPayload>(row => {
    const asset = assetsById.get(row.assetId)
    if (!asset) return []
    return [{
      label: row.cspCellName || row.assetName,
      imageUrl: asset.thumbnailUrl,
      detailText: asset.relativePath ?? asset.currentPath ?? asset.displayName,
      processLabel: row.processLabel,
    }]
  })
  if (items.length === 0) return null
  return {
    displayName: registeredCellPreviewName(key),
    imageUrl: items.length === 1 ? items[0].imageUrl : undefined,
    detailText: items.length === 1 ? items[0].detailText : undefined,
    items,
  }
}

function embeddedStackGuidePreviewPayload(project: CutProject, label: StackGuideLabel): AssetPreviewPayload | null {
  const rows = stackGuideAssetRows(project, label)
  const assetsById = new Map(project.assets.map(asset => [asset.assetId, asset]))
  const items = rows.flatMap<AssetPreviewItemPayload>(row => {
    const asset = assetsById.get(row.assetId)
    if (!asset) return []
    return [{
      label: row.cspCellName,
      imageUrl: asset.thumbnailUrl,
      detailText: asset.relativePath ?? asset.currentPath ?? asset.displayName,
      processLabel: row.processLabel,
    }]
  })
  if (items.length === 0) return null
  return {
    displayName: label.label,
    imageUrl: items.length === 1 ? items[0].imageUrl : undefined,
    detailText: items.length === 1 ? items[0].detailText : undefined,
    items,
  }
}

function registeredCellPreviewName(key: TimingKey): string {
  return [
    sheetRoleLabel(sheetTimingRoleForKey(key)),
    key.paperTrack,
    key.displayLabel.trim(),
  ].filter(Boolean).join(' ')
}

function createRegisteredCellDragImage(label: string, subLabel: string, source?: HTMLElement) {
  const shell = document.createElement('div')
  shell.className = 'registeredCellDragImageShell'

  if (source) {
    const card = source.cloneNode(true) as HTMLElement
    card.classList.add('registeredCellDragCardClone')
    card.removeAttribute('tabindex')
    card.querySelectorAll<HTMLElement>('button, input, textarea, select').forEach(control => {
      control.setAttribute('tabindex', '-1')
      control.setAttribute('aria-hidden', 'true')
    })
    shell.append(card)
    return shell
  }

  const preview = document.createElement('div')
  preview.className = 'registeredCellDragImagePreview'

  const title = document.createElement('strong')
  title.textContent = label
  preview.append(title)

  if (subLabel) {
    const meta = document.createElement('span')
    meta.textContent = subLabel
    preview.append(meta)
  }

  shell.append(preview)
  return shell
}

function BindingPanel({ project, commitProject, selectedKeyId }: { project: CutProject; commitProject: (project: CutProject) => void; selectedKeyId: string | null }) {
  const keys = selectedKeyId ? project.logicalSheet.keys.filter(key => key.keyId === selectedKeyId) : project.logicalSheet.keys
  return (
    <section className="panel">
      <div className="bindingTableWrap">
        <table className="bindingTable">
          <thead>
            <tr>
              <th>{uiText.bindings.key}</th>
              {project.cspTrackSlots.map(slot => <th key={slot.slotId}>{slot.displayPath}</th>)}
            </tr>
          </thead>
          <tbody>
            {keys.map(key => (
              <tr key={key.keyId}>
                <th>{sheetRoleLabel(sheetTimingRoleForKey(key))} {key.paperTrack}-{key.displayLabel}</th>
                {project.cspTrackSlots.map(slot => {
                  const binding = project.bindings.find(item => item.keyId === key.keyId && item.slotId === slot.slotId)
                  return (
                    <td key={slot.slotId}>
                      <input
                        value={binding?.cspCellName ?? ''}
                        placeholder={`${slot.paperTrack}${key.displayLabel}`}
                        onChange={event => commitProject(upsertBinding(project, { slotId: slot.slotId, keyId: key.keyId, cspCellName: event.target.value, materialState: binding?.materialState ?? 'unassigned' }))}
                      />
                      <select
                        value={binding?.materialState ?? 'unassigned'}
                        onChange={event => commitProject(upsertBinding(project, { slotId: slot.slotId, keyId: key.keyId, materialState: event.target.value as 'assigned' | 'unassigned' | 'missing-ok' }))}
                      >
                        <option value="unassigned">{materialStateLabels.unassigned}</option>
                        <option value="assigned">{materialStateLabels.assigned}</option>
                        <option value="missing-ok">{materialStateLabels['missing-ok']}</option>
                      </select>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function SlotPanel({
  project,
  commitProject,
  template,
  sheetPages,
  activePageIndex,
  sheetView,
  runtimeSourceImageUrls,
  showTemplate,
  showAnnotations,
  projectCuts,
  activeCutId,
}: {
  project: CutProject
  commitProject: (project: CutProject) => void
  template: SheetTemplate
  sheetPages: SheetPage[]
  activePageIndex: number
  sheetView: SheetViewState
  runtimeSourceImageUrls: Record<string, string>
  showTemplate: boolean
  showAnnotations: boolean
  projectCuts: CutGroupProjectDocument['cuts']
  activeCutId: string
}) {
  const [syncViewOrder, setSyncViewOrder] = useState(true)
  const [selectedStackItemIds, setSelectedStackItemIds] = useState<Set<string>>(() => new Set())
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null)
  const [draggingStackItemIds, setDraggingStackItemIds] = useState<string[]>([])
  const [dropVisualIndex, setDropVisualIndex] = useState<number | null>(null)
  const [pointerStackDrag, setPointerStackDrag] = useState<StackPointerDrag | null>(null)
  const slotOrderListRef = useRef<HTMLDivElement | null>(null)
  const pointerStackDragRef = useRef<StackPointerDrag | null>(null)
  const suppressStackClickRef = useRef(false)
  const stackItems = useMemo(() => cellStackOrderItems(project), [project])
  const visibleStackItems = useMemo(
    () => cspTopToBottomFromXdtsBottomToTop(stackItems.map((item, stackIndex) => ({ item, stackIndex }))),
    [stackItems],
  )
  const visibleStackItemIds = useMemo(() => visibleStackItems.map(({ item }) => item.id), [visibleStackItems])
  const validSelectedStackItemIds = useMemo(
    () => new Set([...selectedStackItemIds].filter(id => visibleStackItemIds.includes(id))),
    [selectedStackItemIds, visibleStackItemIds],
  )
  const previewStackItems = useMemo(
    () => reorderVisibleStackItemsForDropPreview(visibleStackItems, draggingStackItemIds, dropVisualIndex),
    [draggingStackItemIds, dropVisualIndex, visibleStackItems],
  )
  const previewStackItemIds = useMemo(() => previewStackItems.map(({ item }) => item.id), [previewStackItems])
  const sheetPreviewProject = useMemo(
    () => draggingStackItemIds.length > 0 && dropVisualIndex !== null
      ? applyCellStackOrder(project, xdtsBottomToTopFromCspTopToBottom(previewStackItemIds), syncViewOrder)
      : project,
    [draggingStackItemIds.length, dropVisualIndex, previewStackItemIds, project, syncViewOrder],
  )

  const visualDropIndexFromClientY = useCallback((clientY: number): number => {
    const list = slotOrderListRef.current
    if (!list) return visibleStackItems.length
    const rows = Array.from(list.querySelectorAll<HTMLElement>('.slotOrderItem'))
    for (let index = 0; index < rows.length; index += 1) {
      const rect = rows[index]?.getBoundingClientRect()
      if (rect && clientY < rect.top + rect.height / 2) return index
    }
    return rows.length
  }, [visibleStackItems.length])

  const clearStackDragState = useCallback(() => {
    setDraggingStackItemIds([])
    setDropVisualIndex(null)
    setPointerStackDrag(null)
    pointerStackDragRef.current = null
  }, [])

  useEffect(() => {
    pointerStackDragRef.current = pointerStackDrag
  }, [pointerStackDrag])

  useEffect(() => {
    if (!pointerStackDrag) return

    function handlePointerMove(event: globalThis.PointerEvent) {
      const current = pointerStackDragRef.current
      if (!current || event.pointerId !== current.pointerId) return
      const moved = current.moved || Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > 4
      if (!moved) return
      event.preventDefault()
      setDraggingStackItemIds(current.itemIds)
      setDropVisualIndex(visualDropIndexFromClientY(event.clientY))
      if (!current.moved) {
        const next = { ...current, moved: true }
        pointerStackDragRef.current = next
        setPointerStackDrag(next)
      }
    }

    function handlePointerUp(event: globalThis.PointerEvent) {
      const current = pointerStackDragRef.current
      if (!current || event.pointerId !== current.pointerId) return
      if (current.moved) {
        const nextDropIndex = visualDropIndexFromClientY(event.clientY)
        const nextVisibleIds = reorderVisibleIdsForDrop(visibleStackItemIds, current.itemIds, nextDropIndex)
        commitProject(applyCellStackOrder(project, xdtsBottomToTopFromCspTopToBottom(nextVisibleIds), syncViewOrder))
        setSelectedStackItemIds(new Set(current.itemIds))
        setSelectionAnchorId(current.itemIds[0] ?? null)
        suppressStackClickRef.current = true
      }
      clearStackDragState()
    }

    function handlePointerCancel(event: globalThis.PointerEvent) {
      const current = pointerStackDragRef.current
      if (!current || event.pointerId !== current.pointerId) return
      clearStackDragState()
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
    }
  }, [clearStackDragState, commitProject, pointerStackDrag, project, syncViewOrder, visualDropIndexFromClientY, visibleStackItemIds])

  function moveStackItem(itemId: string, visualDirection: -1 | 1) {
    const currentIndex = stackItems.findIndex(item => item.id === itemId)
    const outputDirection = visualDirection === -1 ? 1 : -1
    const targetIndex = currentIndex + outputDirection
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= stackItems.length) return
    const nextIds = stackItems.map(item => item.id)
    const [moved] = nextIds.splice(currentIndex, 1)
    nextIds.splice(targetIndex, 0, moved)
    commitProject(applyCellStackOrder(project, nextIds, syncViewOrder))
  }

  function handleStackItemSelect(event: MouseEvent, itemId: string) {
    if (suppressStackClickRef.current) {
      suppressStackClickRef.current = false
      return
    }
    if (event.shiftKey && selectionAnchorId) {
      const anchorIndex = visibleStackItemIds.indexOf(selectionAnchorId)
      const targetIndex = visibleStackItemIds.indexOf(itemId)
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const [start, end] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex]
        setSelectedStackItemIds(new Set(visibleStackItemIds.slice(start, end + 1)))
        return
      }
    }
    if (event.ctrlKey || event.metaKey) {
      setSelectedStackItemIds(current => {
        const next = new Set(current)
        if (next.has(itemId)) next.delete(itemId)
        else next.add(itemId)
        return next
      })
      setSelectionAnchorId(itemId)
      return
    }
    setSelectedStackItemIds(new Set([itemId]))
    setSelectionAnchorId(itemId)
  }

  function handleStackItemPointerDown(event: PointerEvent<HTMLDivElement>, itemId: string) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (event.ctrlKey || event.metaKey || event.shiftKey) return
    const movingIds = validSelectedStackItemIds.has(itemId)
      ? visibleStackItemIds.filter(id => validSelectedStackItemIds.has(id))
      : [itemId]
    if (!validSelectedStackItemIds.has(itemId)) {
      setSelectedStackItemIds(new Set(movingIds))
      setSelectionAnchorId(itemId)
    }
    setPointerStackDrag({
      pointerId: event.pointerId,
      itemIds: movingIds,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    })
  }

  return (
    <section className="panel">
      <section className="slotOrderSection">
        <div className="slotSectionHeader">
          <div>
            <h3>{uiText.slots.cellStackOrder}</h3>
            <p className="muted">{uiText.slots.cellStackOrderHint}</p>
          </div>
          <label className="slotSyncToggle">
            <input type="checkbox" checked={syncViewOrder} onChange={event => setSyncViewOrder(event.currentTarget.checked)} />
            {uiText.slots.syncViewOrder}
          </label>
        </div>
        <div className="slotOrderWorkspace">
          <div
            ref={slotOrderListRef}
            className="slotOrderList"
            role="listbox"
            aria-multiselectable="true"
          >
          {visibleStackItems.map(({ item, stackIndex }, visualIndex) => {
            const canMoveUp = stackIndex < stackItems.length - 1
            const canMoveDown = stackIndex > 0
            const isSelected = validSelectedStackItemIds.has(item.id)
            const isDragging = draggingStackItemIds.includes(item.id)
            const dropBefore = dropVisualIndex === visualIndex
            const dropAfter = dropVisualIndex === visualIndex + 1
            return (
              <div
                key={item.id}
                className={[
                  'slotOrderItem',
                  item.kind,
                  isSelected ? 'selected' : '',
                  isDragging ? 'dragging' : '',
                  dropBefore ? 'drop-before' : '',
                  dropAfter ? 'drop-after' : '',
                ].filter(Boolean).join(' ')}
                role="option"
                aria-selected={isSelected}
                tabIndex={0}
                onClick={event => handleStackItemSelect(event, item.id)}
                onPointerDown={event => handleStackItemPointerDown(event, item.id)}
              >
                <div className="slotOrderControls" onClick={event => event.stopPropagation()}>
                  <button type="button" aria-label={`${item.label} ${uiText.slots.moveUp}`} disabled={!canMoveUp} onClick={() => moveStackItem(item.id, -1)}>▲</button>
                  <button type="button" aria-label={`${item.label} ${uiText.slots.moveDown}`} disabled={!canMoveDown} onClick={() => moveStackItem(item.id, 1)}>▼</button>
                </div>
                <span className="slotOrderIndex">{stackIndex + 1}</span>
                <span className="slotOrderName">{item.label}</span>
                <span className="slotOrderBadge">{item.kindLabel}</span>
              </div>
            )
          })}
          </div>
          <aside className="slotStackPreview" aria-label={uiText.slots.sheetPreview}>
            <div className="slotStackPreviewHeader">{uiText.slots.sheetPreview}</div>
            <SlotSheetPreview
              project={sheetPreviewProject}
              template={template}
              sheetPages={sheetPages}
              activePageIndex={activePageIndex}
              sheetView={sheetView}
              runtimeSourceImageUrls={runtimeSourceImageUrls}
              showTemplate={showTemplate}
              showAnnotations={showAnnotations}
              projectCuts={projectCuts}
              activeCutId={activeCutId}
            />
          </aside>
        </div>
      </section>
      <details className="slotOrderSection slotDetailSection">
        <summary className="slotDetailSummary">{uiText.slots.detailSlots}</summary>
        <div className="bindingTableWrap">
          <table className="bindingTable">
            <thead>
              <tr>
                <th>{uiText.slots.trackNo}</th>
                <th>{uiText.slots.paper}</th>
                <th>{uiText.slots.xdtsName}</th>
                <th>{uiText.slots.displayPath}</th>
                <th>{uiText.slots.occurrence}</th>
              </tr>
            </thead>
            <tbody>
              {project.cspTrackSlots.map(slot => (
                <tr key={slot.slotId}>
                  <td>
                    <input
                      className="numberInput"
                      type="number"
                      value={slot.trackNo}
                      onChange={event => commitProject(updateSlot(project, slot.slotId, { trackNo: Number(event.currentTarget.value) }))}
                    />
                  </td>
                  <td>{slot.paperTrack}</td>
                  <td>
                    <input value={slot.xdtsName} onChange={event => commitProject(updateSlot(project, slot.slotId, { xdtsName: event.currentTarget.value }))} />
                  </td>
                  <td>
                    <input value={slot.displayPath} onChange={event => commitProject(updateSlot(project, slot.slotId, { displayPath: event.currentTarget.value }))} />
                  </td>
                  <td>
                    <input
                      className="numberInput"
                      type="number"
                      value={slot.occurrenceIndex}
                      onChange={event => commitProject(updateSlot(project, slot.slotId, { occurrenceIndex: Number(event.currentTarget.value) }))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}

function SlotSheetPreview({
  project,
  template,
  sheetPages,
  activePageIndex,
  sheetView,
  runtimeSourceImageUrls,
  showTemplate,
  showAnnotations,
  projectCuts,
  activeCutId,
}: {
  project: CutProject
  template: SheetTemplate
  sheetPages: SheetPage[]
  activePageIndex: number
  sheetView: SheetViewState
  runtimeSourceImageUrls: Record<string, string>
  showTemplate: boolean
  showAnnotations: boolean
  projectCuts: CutGroupProjectDocument['cuts']
  activeCutId: string
}) {
  const page = sheetPages[activePageIndex] ?? sheetPages[0]
  const displayDurationFrames = logicalSheetDisplayDurationFrames(project.logicalSheet)
  const templateTrackNames = templatePaperTracks(project).map(track => track.paperTrack)
  const pageSize = resolveSheetTemplatePageSize(template, displayDurationFrames, {
    paperTracks: templateTrackNames,
    layoutOverrides: sheetView.layoutOverrides,
  })
  const sheetRenderModelContext = createSheetRenderModelContext(project, template, {
    cutGroup: { activeCutId, cuts: projectCuts },
  })
  const overlayTracks = overlayPaperTracks(project)
  if (!page) return <p className="muted">{uiText.slots.noSheetPreview}</p>

  const pageImage = getSheetPageImage(sheetView, runtimeSourceImageUrls, page.pageId, template)
  const displayImageSettings = { ...pageImage.settings }
  const eventRects = eventRectsForPage(project, template, page)
  const strokes = showAnnotations ? project.annotations.filter((annotation): annotation is AnnotationStroke => isAnnotationStroke(annotation) && annotation.pageId === page.pageId && annotation.tool === 'pen') : []
  const textAnnotations = showAnnotations ? project.annotations.filter((annotation): annotation is AnnotationText => annotation.kind === 'text' && annotation.pageId === page.pageId) : []

  return (
    <div className="slotSheetPreviewViewport">
      <figure className="slotSheetPreviewPage">
        <figcaption>
          {uiText.slots.sheetPreviewPage(page.pageIndex + 1, page.frameStart, page.frameEnd)}
        </figcaption>
        <div
          className="slotSheetPreviewSurface"
          style={{ aspectRatio: `${pageSize.widthPx} / ${pageSize.heightPx}` }}
        >
          <svg
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            className="slotSheetPreviewSvg"
            aria-label={uiText.slots.sheetPreview}
          >
            <rect x="0" y="0" width="1" height="1" fill="#f7f7f4" />
            {showTemplate && pageImage.imageUrl && (
              <SheetImageLayer
                imageUrl={pageImage.imageUrl}
                imageSettings={displayImageSettings}
                template={template}
                preview
              />
            )}
            <TemplateChrome template={template} paperTracks={templateTrackNames} durationFrames={displayDurationFrames} />
            {template.regions.filter(region => region.type === 'exposure-grid').map(region => (
              <GridOverlay key={region.regionId} template={template} region={region} paperTracks={templateTrackNames} durationFrames={page.frameEnd - page.frameStart + 1} frameOrigin={getSheetViewLayout(template).surface?.type === 'continuous-canvas' ? page.frameStart : template.defaults.frameOrigin} />
            ))}
            <MetadataTextLayer context={sheetRenderModelContext} page={page} />
            <WorkRangeOverlay
              template={template}
              page={page}
              displayDurationFrames={displayDurationFrames}
              officialFrameStart={project.logicalSheet.frameOrigin}
              officialFrameEnd={logicalSheetOfficialFrameEnd(project.logicalSheet)}
            />
            {overlayTracks.length > 0 && (
              <OverlayPaperTrackLayer
                project={project}
                template={template}
                page={page}
                tracks={overlayTracks}
                activePaperTrack={null}
                drag={null}
              />
            )}
            {eventRects.map(({ event, displayLabel, rect, hasAssetBinding, fontSizePx }) => {
              const textGeometry = eventTextGeometry(rect, fontSizePx, pageSize)
              return (
                <g key={event.eventId}>
                  <rect className={hasAssetBinding ? 'eventRect assetAssignedEventRect' : 'eventRect'} x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx="0.002" />
                  {hasAssetBinding && <polygon className="assetAssignedEventMarker" points={assetAssignedEventMarkerPoints(rect)} />}
                  {displayLabel.trim()
                    && (
                      <text
                        className="eventText"
                        x={textGeometry.x}
                        y={textGeometry.y}
                        transform={textGeometry.transform}
                        textAnchor="middle"
                        dominantBaseline="central"
                        alignmentBaseline="central"
                        fontSize={textGeometry.fontSize}
                      >
                        {displayLabel}
                      </text>
                  )}
                </g>
              )
            })}
            <StackGuideSvgLayer
              project={project}
              template={template}
              page={page}
              onAssignAsset={() => undefined}
            />
            {strokes.map(stroke => (
              <path key={stroke.annotationId} className="annotationStroke" d={strokePath(stroke)} stroke={stroke.color} strokeWidth={stroke.width} />
            ))}
            {textAnnotations.map(annotation => (
              <AnnotationSvgText key={annotation.annotationId} annotation={annotation} pageSize={pageSize} />
            ))}
          </svg>
        </div>
      </figure>
    </div>
  )
}

type CellStackOrderItem =
  | { id: string; kind: 'template-track'; label: string; kindLabel: string; paperTrack: string }
  | { id: string; kind: 'overlay-track'; label: string; kindLabel: string; paperTrack: string }
  | { id: string; kind: 'stack-guide'; label: string; kindLabel: string; labelId: string }

type VisibleCellStackOrderItem = { item: CellStackOrderItem; stackIndex: number }

type StackPointerDrag = {
  pointerId: number
  itemIds: string[]
  startX: number
  startY: number
  moved: boolean
}

function reorderVisibleStackItemsForDropPreview(
  visibleItems: VisibleCellStackOrderItem[],
  movingIds: string[],
  dropIndex: number | null,
): VisibleCellStackOrderItem[] {
  if (movingIds.length === 0 || dropIndex === null) return visibleItems
  const byId = new Map(visibleItems.map(entry => [entry.item.id, entry]))
  return reorderVisibleIdsForDrop(visibleItems.map(entry => entry.item.id), movingIds, dropIndex)
    .map(id => byId.get(id))
    .filter((entry): entry is VisibleCellStackOrderItem => Boolean(entry))
}

function reorderVisibleIdsForDrop(visibleIds: string[], movingIds: string[], dropIndex: number): string[] {
  const movingSet = new Set(movingIds)
  const moving = visibleIds.filter(id => movingSet.has(id))
  if (moving.length === 0) return visibleIds
  const remaining = visibleIds.filter(id => !movingSet.has(id))
  const insertionIndex = visibleIds.slice(0, dropIndex).filter(id => !movingSet.has(id)).length
  return [
    ...remaining.slice(0, insertionIndex),
    ...moving,
    ...remaining.slice(insertionIndex),
  ]
}

function cellStackOrderItems(project: CutProject): CellStackOrderItem[] {
  const templateTracks = project.logicalSheet.paperTracks
    .filter(track => track.source !== 'overlay')
    .sort((a, b) => a.order - b.order || compareNaturalFileNameText(a.paperTrack, b.paperTrack))
  const entriesByAnchor = new Map<string, Array<{ orderInGap: number; item: CellStackOrderItem }>>()

  function addGapEntry(anchor: string | undefined, orderInGap: number, item: CellStackOrderItem) {
    const key = anchor ?? ''
    const entries = entriesByAnchor.get(key) ?? []
    entries.push({ orderInGap, item })
    entriesByAnchor.set(key, entries)
  }

  for (const track of project.logicalSheet.paperTracks) {
    if (track.source !== 'overlay') continue
    addGapEntry(track.exportPlacement?.insertAfterPaperTrack, track.exportPlacement?.orderInGap ?? 0, {
      id: `paper:${track.paperTrack}`,
      kind: 'overlay-track',
      label: track.label || track.paperTrack,
      kindLabel: uiText.slots.overlayTrack,
      paperTrack: track.paperTrack,
    })
  }
  for (const label of project.stackGuideLabels) {
    if (stackGuideStackBand(label) !== 'cell-interleave') continue
    addGapEntry(stackGuideAnchorForCellOrder(project, label), label.orderInGap, {
      id: `stack:${label.labelId}`,
      kind: 'stack-guide',
      label: label.label,
      kindLabel: uiText.slots.stackGuideTrack,
      labelId: label.labelId,
    })
  }
  for (const entries of entriesByAnchor.values()) {
    entries.sort((a, b) =>
      a.orderInGap - b.orderInGap
      || cellStackOrderKindRank(a.item) - cellStackOrderKindRank(b.item)
      || compareNaturalFileNameText(a.item.label, b.item.label)
      || a.item.id.localeCompare(b.item.id, 'ja'),
    )
  }

  const items: CellStackOrderItem[] = []
  items.push(...cellStackGapItems(entriesByAnchor, undefined))
  templateTracks.forEach(track => {
    items.push({
      id: `paper:${track.paperTrack}`,
      kind: 'template-track',
      label: track.label || track.paperTrack,
      kindLabel: uiText.slots.fixedAnchor,
      paperTrack: track.paperTrack,
    })
    items.push(...cellStackGapItems(entriesByAnchor, track.paperTrack))
  })
  return items
}

function cellStackGapItems(entriesByAnchor: Map<string, Array<{ item: CellStackOrderItem }>>, anchor: string | undefined): CellStackOrderItem[] {
  return (entriesByAnchor.get(anchor ?? '') ?? []).map(entry => entry.item)
}

function stackGuideAnchorForCellOrder(project: CutProject, label: StackGuideLabel): string | undefined {
  const anchorTrack = label.insertAfterPaperTrack
    ? project.logicalSheet.paperTracks.find(track => track.paperTrack === label.insertAfterPaperTrack)
    : undefined
  if (anchorTrack?.source === 'overlay') return anchorTrack.exportPlacement?.insertAfterPaperTrack
  return label.insertAfterPaperTrack
}

function cellStackOrderKindRank(item: CellStackOrderItem) {
  if (item.kind === 'overlay-track') return 0
  if (item.kind === 'stack-guide') return 1
  return 2
}

function applyCellStackOrder(project: CutProject, orderedItemIds: string[], syncViewOrder: boolean): CutProject {
  const currentItems = new Map(cellStackOrderItems(project).map(item => [item.id, item]))
  const gapOrder = new Map<string, number>()
  const paperTrackUpdates = new Map<string, { insertAfterPaperTrack?: string; orderInGap: number; snapIndex?: number }>()
  const stackGuideUpdates = new Map<string, { insertAfterPaperTrack?: string; orderInGap: number }>()
  const templateOrderUpdates = new Map<string, number>()
  let currentTemplateAnchor: string | undefined
  let paperDisplayIndex = 0

  function nextOrderInGap(insertAfterPaperTrack: string | undefined) {
    const key = insertAfterPaperTrack ?? ''
    const next = gapOrder.get(key) ?? 0
    gapOrder.set(key, next + 1)
    return next
  }

  for (const itemId of orderedItemIds) {
    const item = currentItems.get(itemId)
    if (!item) continue
    if (item.kind === 'template-track') {
      currentTemplateAnchor = item.paperTrack
      templateOrderUpdates.set(item.paperTrack, paperDisplayIndex)
      paperDisplayIndex += 1
      continue
    }
    if (item.kind === 'overlay-track') {
      paperTrackUpdates.set(item.paperTrack, {
        insertAfterPaperTrack: currentTemplateAnchor,
        orderInGap: nextOrderInGap(currentTemplateAnchor),
        ...(syncViewOrder ? { snapIndex: paperDisplayIndex } : {}),
      })
      paperDisplayIndex += 1
      continue
    }
    stackGuideUpdates.set(item.labelId, {
      insertAfterPaperTrack: currentTemplateAnchor,
      orderInGap: nextOrderInGap(currentTemplateAnchor),
    })
  }

  const paperTracks = normalizePaperTracksForUi(project.logicalSheet.paperTracks.map(track => {
    const update = paperTrackUpdates.get(track.paperTrack)
    const orderUpdate = templateOrderUpdates.get(track.paperTrack)
    if (!update) {
      return typeof orderUpdate === 'number' ? { ...track, order: orderUpdate } : track
    }
    return {
      ...track,
      order: typeof orderUpdate === 'number' ? orderUpdate : track.order,
      exportPlacement: {
        ...track.exportPlacement,
        insertAfterPaperTrack: update.insertAfterPaperTrack,
        orderInGap: update.orderInGap,
      },
      viewPlacement: syncViewOrder
        ? {
            ...track.viewPlacement,
            snapIndex: update.snapIndex,
            expanded: true,
          }
        : track.viewPlacement,
    }
  }))
  const paperTrackIndex = new Map(paperTracks.map((track, index) => [track.paperTrack, index]))

  return {
    ...project,
    logicalSheet: {
      ...project.logicalSheet,
      paperTracks,
    },
    stackGuideLabels: project.stackGuideLabels.map(label => {
      const update = stackGuideUpdates.get(label.labelId)
      if (!update) return label
      return {
        ...label,
        insertAfterPaperTrack: update.insertAfterPaperTrack,
        gapIndex: update.insertAfterPaperTrack ? (paperTrackIndex.get(update.insertAfterPaperTrack) ?? -1) + 1 : 0,
        orderInGap: update.orderInGap,
      }
    }),
  }
}

function normalizePaperTracksForUi(paperTracks: PaperTrack[]): PaperTrack[] {
  const templateTracks = paperTracks.filter(track => track.source !== 'overlay').sort((a, b) => a.order - b.order || compareNaturalFileNameText(a.paperTrack, b.paperTrack))
  const templateOrder = new Map(templateTracks.map((track, index) => [track.paperTrack, index]))
  return [...paperTracks]
    .sort((a, b) => {
      const aKey = paperTrackExportSortKeyForUi(a, templateOrder)
      const bKey = paperTrackExportSortKeyForUi(b, templateOrder)
      return aKey.position - bKey.position
        || aKey.orderInGap - bKey.orderInGap
        || aKey.baseOrder - bKey.baseOrder
        || compareNaturalFileNameText(a.paperTrack, b.paperTrack)
    })
    .map((track, order) => ({ ...track, order }))
}

function paperTrackExportSortKeyForUi(track: PaperTrack, templateOrder: Map<string, number>): { position: number; orderInGap: number; baseOrder: number } {
  const baseOrder = templateOrder.get(track.paperTrack) ?? Number.MAX_SAFE_INTEGER
  if (track.source !== 'overlay') return { position: baseOrder, orderInGap: 0, baseOrder }
  const insertAfter = track.exportPlacement?.insertAfterPaperTrack
  const afterOrder = insertAfter ? templateOrder.get(insertAfter) : undefined
  return {
    position: (afterOrder ?? -1) + 0.5,
    orderInGap: track.exportPlacement?.orderInGap ?? 0,
    baseOrder,
  }
}

function RecognitionActionMenu({
  candidates,
  sheetRole,
  running,
  progress,
  message,
  project,
  disabled,
  onSheetRoleChange,
  onDetect,
  onAccept,
  onAcceptAll,
  onUpdateLabel,
  onRemove,
  onClear,
}: {
  candidates: RecognitionCandidate[]
  sheetRole: SheetTimingRole
  running: boolean
  progress: { completed: number; total: number } | null
  message: string | null
  project: CutProject
  disabled: boolean
  onSheetRoleChange: (sheetRole: SheetTimingRole) => void
  onDetect: () => void
  onAccept: (candidate: RecognitionCandidate) => void
  onAcceptAll: () => void
  onUpdateLabel: (candidateId: string, value: string) => void
  onRemove: (candidateId: string) => void
  onClear: () => void
}) {
  const readyCount = candidates.filter(candidate => !recognitionCandidateHasConflict(project, candidate)).length
  return (
    <ActionMenu
      label={<><OcrIcon /><span>OCR</span></>}
      ariaLabel={uiText.recognition.menu}
      tooltipLabel={uiText.recognition.menuTitle}
      className="sheetRecognitionMenu"
    >
      <div className="recognitionMenuBody">
        <div className="recognitionRoleControl" role="group" aria-label={uiText.recognition.targetField}>
          {(['action', 'cell'] as const).map(role => (
            <button
              key={role}
              type="button"
              className={sheetRole === role ? 'active' : ''}
              aria-pressed={sheetRole === role}
              disabled={running}
              onClick={() => onSheetRoleChange(role)}
            >
              {uiText.sheetRoles[role]}
            </button>
          ))}
        </div>
        <button type="button" className="recognitionRunButton" disabled={disabled || running} onClick={onDetect}>
          {running ? uiText.recognition.running : uiText.actions.runOcrAllPages}
        </button>
        {running && progress && (
          <progress
            className="recognitionProgress"
            max={Math.max(1, progress.total)}
            value={progress.completed}
            aria-label={uiText.recognition.running}
          />
        )}
        <div className="recognitionMenuActions">
          <button type="button" disabled={readyCount === 0 || running} onClick={onAcceptAll}>{uiText.actions.acceptAll}</button>
          <button type="button" disabled={candidates.length === 0 || running} onClick={onClear}>{uiText.recognition.clearCandidates}</button>
        </div>
        {disabled && <p className="muted">{uiText.recognition.disabled}</p>}
        {message && <p className="recognitionMessage" role="status">{message}</p>}
        <div className="recognitionMenuCandidateHeader">
          <strong>{uiText.recognition.candidates}</strong>
          <span>{uiText.recognition.candidateCount(candidates.length)}</span>
        </div>
        {candidates.length > 0 && (
          <div className="candidateList recognitionMenuCandidateList">
            {candidates.map(candidate => {
              const conflict = recognitionCandidateHasConflict(project, candidate)
              return (
                <div key={candidate.candidateId} className={conflict ? 'candidateItem conflict' : 'candidateItem'}>
                  <div className="candidateItemMeta">
                    <strong>{candidate.paperTrack} {candidate.frame}F</strong>
                    <span>{Math.round(candidate.confidence * 100)}%</span>
                  </div>
                  <input
                    value={candidate.normalizedLabel}
                    aria-label={uiText.recognition.candidateLabel(candidate.paperTrack, candidate.frame)}
                    onChange={event => onUpdateLabel(candidate.candidateId, event.currentTarget.value)}
                  />
                  {conflict && <span className="candidateConflictLabel">{uiText.recognition.existingEvent}</span>}
                  <div className="candidateItemActions">
                    <button type="button" disabled={conflict || !candidate.normalizedLabel.trim()} onClick={() => onAccept(candidate)}>{uiText.recognition.accept}</button>
                    <button type="button" onClick={() => onRemove(candidate.candidateId)}>{uiText.actions.remove}</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </ActionMenu>
  )
}

function recognitionCandidateHasConflict(project: CutProject, candidate: RecognitionCandidate): boolean {
  const event = project.logicalSheet.events.find(item =>
    item.paperTrack === candidate.paperTrack
    && item.frame === candidate.frame
    && sheetTimingRoleForEvent(item) === candidate.sheetRole,
  )
  if (!event) return false
  const key = project.logicalSheet.keys.find(item => item.keyId === event.keyId)
  return key?.displayLabel.trim().normalize('NFKC') !== candidate.normalizedLabel.trim().normalize('NFKC')
}

function ExportPanel(props: {
  project: CutProject
  cspImportAssetRootId?: string
  issues: ReturnType<typeof validateProject>
  exportPlan: ReturnType<typeof buildExportPlan>
  xdtsText: string
  setTimingSourceRole: (value: SheetTimingRole) => void
  updateExportProfile: (profileId: string, updates: Partial<ExportProfile>) => void
  onCspImportAssetRootChange: (rootId: string) => void
}) {
  const activeProfile = props.project.exportProfiles.find(profile => profile.mode === 'import-stack') ?? props.project.exportProfiles[0]
  const timingSourceRole = activeProfile?.timingSourceRole ?? 'action'
  const infoInstructions = props.exportPlan.cspInstructions.filter(instruction => instruction.level === 'info')
  const visibleWarnings = props.exportPlan.cspInstructions.filter(instruction => instruction.level !== 'info')

  return (
    <section className="panel exportPanel">
      <div className="toolRow">
        <label>
          CSPカットフォルダ
          <select value={props.cspImportAssetRootId ?? ''} onChange={event => props.onCspImportAssetRootChange(event.currentTarget.value)}>
            <option value="">未選択</option>
            {props.project.assetRoots.filter(root => root.path).map(root => (
              <option key={root.rootId} value={root.rootId}>{root.label || root.path}</option>
            ))}
          </select>
        </label>
        <label>
          {uiText.export.timingSource}
          <select value={timingSourceRole} onChange={event => props.setTimingSourceRole(event.currentTarget.value as SheetTimingRole)}>
            <option value="action">{uiText.sheetRoles.action}</option>
            <option value="cell">{uiText.sheetRoles.cell}</option>
          </select>
        </label>
        <label>
          {uiText.export.importStart}
          <input
            value={activeProfile?.importStackStartSeparatorName ?? ''}
            onChange={event => activeProfile && props.updateExportProfile(activeProfile.profileId, { importStackStartSeparatorName: event.currentTarget.value })}
          />
        </label>
        <label>
          {uiText.export.importEnd}
          <input
            value={activeProfile?.importStackEndSeparatorName ?? ''}
            onChange={event => activeProfile && props.updateExportProfile(activeProfile.profileId, { importStackEndSeparatorName: event.currentTarget.value })}
          />
        </label>
      </div>
      <div className="instructionSummary">
        <strong>{uiText.export.importStackHeading}</strong>
        <ul>
          {infoInstructions.map((instruction, index) => <li key={index}>{instruction.message}</li>)}
        </ul>
      </div>
      {visibleWarnings.length > 0 && (
        <div className="instructionList">
          {visibleWarnings.map((instruction, index) => (
            <div key={index} className={`issue ${instruction.level}`}>
              <strong>{severityLabel(instruction.level)}</strong>
              <span>{instruction.message}</span>
            </div>
          ))}
        </div>
      )}
      <TrackPlanTable plan={props.exportPlan} />
      <IssueList issues={props.issues} />
      <textarea className="xdtsPreview" value={props.xdtsText} readOnly />
    </section>
  )
}

function TrackPlanTable({ plan }: { plan: ReturnType<typeof buildExportPlan> }) {
  return (
    <table className="trackPlan">
      <thead>
        <tr>
          <th>trackNo</th>
          <th>{uiText.export.trackPlan.name}</th>
          <th>{uiText.export.trackPlan.frames}</th>
        </tr>
      </thead>
      <tbody>
        {plan.tracks.map(track => (
          <tr key={`${track.trackNo}-${track.name}`}>
            <td>{track.trackNo}</td>
            <td>{track.name}</td>
            <td>{track.frames.length}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function IssueList({ issues }: { issues: ReturnType<typeof validateProject> }) {
  return (
    <div className="issueList">
      {issues.map(issue => (
        <div key={issue.issueId} className={`issue ${issue.severity}`}>
          <strong>{severityLabel(issue.severity)}</strong>
          <span>{issue.code}</span>
          <span>{issueMessage(issue)}</span>
        </div>
      ))}
    </div>
  )
}

function DurationFrameControl({
  frames,
  fps,
  onChange,
}: {
  frames: number
  fps: number
  onChange: (frames: number) => void
}) {
  const labelId = useId()
  const safeFps = Math.max(1, Math.round(fps))
  const { seconds, frameRemainder } = durationParts(frames, safeFps)

  function setDurationParts(nextSeconds: number, nextFrameRemainder: number) {
    const clampedSeconds = clampNumber(Math.round(nextSeconds), 0, 999)
    const clampedRemainder = clampNumber(Math.round(nextFrameRemainder), 0, safeFps - 1)
    onChange(Math.max(1, clampedSeconds * safeFps + clampedRemainder))
  }

  function stepSeconds(delta: number) {
    onChange(clampDurationFrames(frames + delta * safeFps, safeFps))
  }

  function stepFrames(delta: number) {
    onChange(clampDurationFrames(frames + delta, safeFps))
  }

  return (
    <div className="compactControl durationControl">
      <span id={labelId}>{uiText.sheet.duration}</span>
      <span className="durationStepper" role="group" aria-labelledby={labelId}>
        <DurationStepperUnit
          displayValue={formatDurationPart(seconds, 2)}
          max={999}
          inputLabel={uiText.sheet.durationSeconds}
          upLabel={uiText.sheet.durationSecondsUp}
          downLabel={uiText.sheet.durationSecondsDown}
          onInput={value => setDurationParts(value, frameRemainder)}
          onStep={stepSeconds}
        />
        <span className="durationSeparator" aria-hidden="true">+</span>
        <DurationStepperUnit
          displayValue={formatDurationPart(frameRemainder, 2)}
          max={safeFps - 1}
          inputLabel={uiText.sheet.durationFrames}
          upLabel={uiText.sheet.durationFramesUp}
          downLabel={uiText.sheet.durationFramesDown}
          onInput={value => setDurationParts(seconds, value)}
          onStep={stepFrames}
        />
      </span>
    </div>
  )
}

function DurationStepperUnit({
  displayValue,
  inputLabel,
  upLabel,
  downLabel,
  max,
  onInput,
  onStep,
}: {
  displayValue: string
  inputLabel: string
  upLabel: string
  downLabel: string
  max: number
  onInput: (value: number) => void
  onStep: (delta: number) => void
}) {
  function handleInput(rawValue: string) {
    const normalized = rawValue
      .replace(/[０-９]/g, character => String.fromCharCode(character.charCodeAt(0) - 0xfee0))
      .replace(/\D/g, '')
    const value = normalized ? Number(normalized) : 0
    onInput(clampNumber(value, 0, max))
  }

  return (
    <span className="durationUnitStepper">
      <input
        className="durationInput"
        value={displayValue}
        inputMode="numeric"
        aria-label={inputLabel}
        onChange={event => handleInput(event.currentTarget.value)}
        onKeyDown={event => {
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            onStep(1)
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            onStep(-1)
          }
        }}
      />
      <span className="durationArrowStack">
        <button type="button" className="durationArrowButton" aria-label={upLabel} onClick={() => onStep(1)}>
          ▲
        </button>
        <button type="button" className="durationArrowButton" aria-label={downLabel} onClick={() => onStep(-1)}>
          ▼
        </button>
      </span>
    </span>
  )
}

function durationParts(frames: number, fps: number): { seconds: number; frameRemainder: number } {
  const safeFrames = Math.max(1, Math.round(frames))
  return {
    seconds: Math.floor(safeFrames / fps),
    frameRemainder: safeFrames % fps,
  }
}

function clampDurationFrames(frames: number, fps: number): number {
  return clampNumber(Math.round(frames), 1, 999 * fps + fps - 1)
}

function formatDurationPart(value: number, minDigits: number): string {
  return String(Math.max(0, Math.round(value))).padStart(minDigits, '0')
}

function RegisteredCellSortIcon({ direction }: { direction: RegisteredCellSortDirection }) {
  return (
    <svg className="assetSortIcon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={direction === 'asc' ? 'M8 18V6m0 0L4.5 9.5M8 6l3.5 3.5' : 'M8 6v12m0 0l-3.5-3.5M8 18l3.5-3.5'} />
      <path d="M14 7h6M14 12h4.5M14 17h3" />
    </svg>
  )
}

function NormalizeNamesIcon() {
  return (
    <svg className="assetBrowserIcon registeredCellNormalizeIcon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 6.5h6M14.5 6.5h6" />
      <path d="M3.5 12h11M19.5 12h1" />
      <path d="M3.5 17.5h4.5M13 17.5h7.5" />
      <circle cx="12" cy="6.5" r="2.6" />
      <circle cx="17" cy="12" r="2.6" />
      <circle cx="10.5" cy="17.5" r="2.6" />
    </svg>
  )
}

function RegisteredCellDetailViewIcon() {
  return (
    <svg className="assetBrowserIcon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
    </svg>
  )
}

function RegisteredCellListViewIcon() {
  return (
    <svg className="assetBrowserIcon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 6h12M8 12h12M8 18h12" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" />
    </svg>
  )
}

function UndoIcon() {
  return (
    <svg className="topIconSvg" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h9a6 6 0 0 1 0 12h-1" />
    </svg>
  )
}

function RedoIcon() {
  return (
    <svg className="topIconSvg" viewBox="0 0 24 24" aria-hidden="true">
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9h-9a6 6 0 0 0 0 12h1" />
    </svg>
  )
}

function HelpIcon() {
  return (
    <svg className="topIconSvg" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 0 1 4.7 1.2c0 1.8-2.2 2.2-2.2 4" />
      <path d="M12 17.5h.01" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg className="topIconSvg" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M9 7V5h6v2" />
      <path d="M7 7l1 14h8l1-14" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg className="topIconSvg" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  )
}

function PenToolIcon() {
  return (
    <svg className="topIconSvg" viewBox="0 0 24 24" aria-hidden="true">
      <path d="m15.5 4.5 4 4" />
      <path d="M4 20l4.5-1 10-10a2.8 2.8 0 0 0-4-4l-10 10L4 20Z" />
      <path d="m13.5 6.5 4 4" />
    </svg>
  )
}

function TextToolIcon() {
  return (
    <span className="textToolIconBox" aria-hidden="true">
      <svg className="textToolIconSvg" viewBox="0 0 18 18" focusable="false">
        <path d="M3 2h12v4h-4v10H7V6H3z" />
      </svg>
    </span>
  )
}

function CheckSmallIcon() {
  return (
    <svg className="smallInlineIcon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8.2 6.4 11.5 13 4.5" />
    </svg>
  )
}

function CloseSmallIcon() {
  return (
    <svg className="smallInlineIcon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 4l8 8" />
      <path d="M12 4l-8 8" />
    </svg>
  )
}

function EraserToolIcon() {
  return (
    <svg className="topIconSvg" viewBox="0 0 24 24" aria-hidden="true">
      <path d="m7 21-4-4 9.5-9.5a3 3 0 0 1 4.2 0l1.8 1.8a3 3 0 0 1 0 4.2L11 21H7Z" />
      <path d="m9.5 10.5 5 5" />
      <path d="M14 21h7" />
    </svg>
  )
}

function MenuIcon() {
  return (
    <svg className="topIconSvg" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  )
}

function ViewModeIcon() {
  return (
    <svg className="topIconSvg" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="5" width="7" height="14" rx="1" />
      <rect x="13.5" y="5" width="7" height="14" rx="1" />
      <path d="M7 8.5h.01M7 12h.01M7 15.5h.01" />
      <path d="M17 8.5h.01M17 12h.01M17 15.5h.01" />
    </svg>
  )
}

function OcrIcon() {
  return (
    <svg className="topIconSvg" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 9V6.5A1.5 1.5 0 0 1 6.5 5H9" />
      <path d="M15 5h2.5A1.5 1.5 0 0 1 19 6.5V9" />
      <path d="M19 15v2.5a1.5 1.5 0 0 1-1.5 1.5H15" />
      <path d="M9 19H6.5A1.5 1.5 0 0 1 5 17.5V15" />
      <path d="M4 12h16" />
      <path d="M8.2 10.2a2.6 2.6 0 0 1 4.9 0" />
      <path d="M15.2 9.2h1.5a1.4 1.4 0 0 1 0 2.8h-1.5V9.2Z" />
      <path d="m17.5 12 1.2 2.4" />
    </svg>
  )
}

function DisplaySettingsIcon() {
  return (
    <svg className="topIconSvg displayTemplateIcon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1.5" y="2" width="21" height="20" rx="1.8" />
      <path d="M1.5 7.7h21" />
      <path d="M6.75 7.7v14.3" />
      <path d="M12 7.7v14.3" />
      <path d="M17.25 7.7v14.3" />
      <path d="M1.5 12.5h21" />
      <path d="M1.5 17.3h21" />
    </svg>
  )
}

function AppHelpDialog({
  appName,
  showDigitalHelp,
  onClose,
}: {
  appName: string
  showDigitalHelp: boolean
  onClose: () => void
}) {
  return (
    <div className="appHelpBackdrop" role="dialog" aria-modal="true" aria-label={`${appName}の使い方`}>
      <section className="appHelpDialog">
        <header>
          <div>
            <strong>{appName}の使い方</strong>
            <span>CSPはCLIP STUDIO PAINT、つまりクリスタのことです。ここでは主な作業の流れを説明します。</span>
          </div>
          <button type="button" onClick={onClose}>閉じる</button>
        </header>
        <div className="appHelpBody">
          <article className="appHelpWorkflow appHelpWorkflowPrep">
            <h2>必ず先に準備すること</h2>
            <p>CSPはCLIP STUDIO PAINT、つまりクリスタのことです。クリスタへ組み込む前に、紙シート画像と作画素材を用意します。</p>
            <ol>
              <li>
                <strong>タイムシート画像を指定dpiでスキャンする</strong>
                <span>紙タイムシートを読み込む場合は、使用する表示テンプレートに合わせたdpiでスキャンしてください。紙シート画像を下敷きにして、シート上のキーや登録内容を確認できるようになります。</span>
              </li>
              <li>
                <strong>作画素材をOLMペグホールスタビライザーで揃える</strong>
                <span>スキャンした作画素材は、読み込み前にOLMペグホールスタビライザーでタップ穴基準の位置合わせを済ませてください。位置合わせ後の画像をこのアプリへ読み込みます。</span>
              </li>
              <li>
                <strong>作画素材を読み込める場所にまとめる</strong>
                <span>作画素材は、カットフォルダなど、あとで読み込みやすい場所にまとめておきます。事前に画像を見ながらA1、B3などへリネームしておく必要はありません。このアプリでは、素材ブラウザのクイックビューで中身を確認し、該当するシート上のキーへ置くことで素材とタイムシートを紐づけます。</span>
              </li>
            </ol>
          </article>
          <article className="appHelpWorkflow">
            <h2>CSP組み込み用シートを作る</h2>
            <p>{appName}でタイムシートと素材対応を作り、ヘルパーでCLIP STUDIO PAINT（クリスタ）へ登録します。</p>
            <ol>
              <li>
                <strong>紙シート画像を読み込む</strong>
                <span>上部の「紙シート」から「読込」を押します。必要なら「補正」で四隅を合わせ、「レベル補正」で薄いスキャンを見やすくします。</span>
              </li>
              <li>
                <strong>画像素材を素材ブラウザへ入れる</strong>
                <span>カットフォルダまたは画像ファイルを右側の素材ブラウザへドロップします。素材カードからプレビューを確認できます。</span>
              </li>
              <li>
                <strong>素材をセル欄へドラッグしてキーを作る</strong>
                <span>素材カードをシート上のCELL/ACTION/CAMERA欄へ置きます。範囲選択してから素材を置くと、開始位置へまとめて割り当てできます。</span>
              </li>
              <li>
                <strong>登録セルと工程を確認する</strong>
                <span>左の登録セルカードで、作画・演出・作監などの工程、クリスタ上のセル名、重ね順を確認します。BG/BOOKやメモは追加トラックとして登録します。</span>
              </li>
              <li>
                <strong>クリスタ用の名前を整える</strong>
                <span>必要に応じて、登録セル名・クリスタセル名・実ファイル名をまとめて整えます。クリスタはファイル名をセル名として扱うため、ここを揃えるのが重要です。</span>
              </li>
              <li>
                <strong>「書き出し」から「タイムシート/CSP自動登録」を保存する</strong>
                <span>
                  「タイムシート/CSP自動登録」を保存すると、ヘルパー用の登録ファイル（csp-import.xci）、XDTS、素材参照がカットフォルダ配下に作られます。csp-import.xciはクリスタではなく、CSP自動登録ヘルパーで選択します。
                </span>
              </li>
            </ol>
          </article>
          {showDigitalHelp && <article className="appHelpWorkflow">
            <h2>デジタルタイムシートとして使う</h2>
            <p>この領域は拡張中ですが、紙シートの下敷き、キー入力、注釈、XDTS/画像出力の作業台として使えます。</p>
            <ol>
              <li>
                <strong>シート入力でフレームを選ぶ</strong>
                <span>フレームをクリックして選択し、素材ドロップや右クリックメニューからキー作成・削除・カラセル入力を行います。</span>
              </li>
              <li>
                <strong>範囲を選んで編集する</strong>
                <span>ドラッグで範囲を作り、右クリックメニューからコピー、切り取り、貼り付け、挿入貼り付け、選択範囲内/末尾までのリピート貼り付けを使います。</span>
              </li>
              <li>
                <strong>表示と注釈を調整する</strong>
                <span>全体表示、連続/見開き表示、紙シート不透明度、罫線表示、ペン注釈で確認しやすい状態にします。</span>
              </li>
              <li>
                <strong>画像またはXDTSとして書き出す</strong>
                <span>確認用にはJPG/PNG/PSD、連携用にはXDTSを使います。CSP自動登録には専用の「タイムシート/CSP自動登録」を使ってください。</span>
              </li>
            </ol>
          </article>}
        </div>
        <footer>
          <p>CSP自動登録は、同梱のCSP自動登録ヘルパーがクリスタを操作して行います。csp-import.xciはヘルパー用の登録ファイルであり、クリスタへ直接読み込むファイルではありません。</p>
        </footer>
      </section>
    </div>
  )
}

function AppNavigationMenu({
  panels,
  panel,
  onSelect,
  onLoadProject,
  onSaveProject,
  onSaveProjectAs,
  onSaveTemplate,
  onResetApp,
  onOpenSheetImageExport,
  onSaveXdts,
  onSaveCspImportPackage,
  onOpenExportSettings,
  blockingExport,
}: {
  panels: Panel[]
  panel: Panel
  onSelect: (panel: Panel) => void
  onLoadProject: (files: FileList | null) => void
  onSaveProject: () => void
  onSaveProjectAs: () => void
  onSaveTemplate: () => void
  onResetApp: () => void
  onOpenSheetImageExport: (format: SheetImageExportFormat) => void
  onSaveXdts: () => void
  onSaveCspImportPackage: () => void
  onOpenExportSettings?: () => void
  blockingExport: boolean
}) {
  return (
    <ActionMenu label={<MenuIcon />} ariaLabel={uiText.nav.menu} tooltipLabel={uiText.nav.menuTitle} className="appNavMenu iconActionMenu" closeOnMenuItemClick>
      <div className="appNavFlyout">
        <Tooltip label={uiText.nav.fileMenuTitle}>
          <button type="button" className="appNavMenuItem appNavFlyoutTrigger" data-action-menu-keep-open>
            ファイル
          </button>
        </Tooltip>
        <div className="appNavFlyoutMenu">
          <TooltipTarget label={uiText.actions.loadProjectTitle}>
            {tooltipProps => (
              <label className="fileButton appNavMenuItem" {...tooltipProps}>
                {uiText.actions.loadProject}
                <input type="file" accept=".json,application/json" onChange={event => onLoadProject(event.currentTarget.files)} />
              </label>
            )}
          </TooltipTarget>
          <Tooltip label={uiText.actions.saveProjectTitle}>
            <button type="button" className="appNavMenuItem" onClick={onSaveProject}>{uiText.actions.saveProject}</button>
          </Tooltip>
          <Tooltip label={uiText.actions.projectJsonTitle}>
            <button type="button" className="appNavMenuItem" onClick={onSaveProjectAs}>{uiText.actions.projectJson}</button>
          </Tooltip>
          <Tooltip label={uiText.actions.templateJsonTitle}>
            <button type="button" className="appNavMenuItem" onClick={onSaveTemplate}>{uiText.actions.templateJson}</button>
          </Tooltip>
        </div>
      </div>
      <div className="appNavFlyout">
        <Tooltip label={uiText.actions.exportMenuTitle}>
          <button type="button" className="appNavMenuItem appNavFlyoutTrigger" data-action-menu-keep-open>
            {uiText.actions.exportMenu}
          </button>
        </Tooltip>
        <div className="appNavFlyoutMenu appNavExportFlyoutMenu">
          <div className="imageExportMenuGroup appNavImageExportGroup" aria-label={uiText.actions.imageExportMenuTitle}>
            <div className="imageExportMenuLabel">{uiText.actions.imageExportMenu}</div>
            <div className="imageExportFormatButtons">
              {(['jpg', 'png', 'psd'] as SheetImageExportFormat[]).map(format => {
                const label = format.toUpperCase()
                return (
                  <Tooltip key={format} label={uiText.actions.imageExportFormatTitle(label)}>
                    <button type="button" onClick={() => onOpenSheetImageExport(format)}>
                      {label}
                    </button>
                  </Tooltip>
                )
              })}
            </div>
          </div>
          <Tooltip label={uiText.actions.xdtsTitle}>
            <button type="button" className="appNavMenuItem" disabled={blockingExport} onClick={onSaveXdts}>{uiText.actions.xdts}</button>
          </Tooltip>
          <Tooltip label={uiText.actions.cspImportPackageTitle}>
            <button type="button" className="appNavMenuItem" onClick={onSaveCspImportPackage}>{uiText.actions.cspImportPackage}</button>
          </Tooltip>
          {onOpenExportSettings && (
            <Tooltip label="XDTSの工程・対象トラック・セル名規則を設定">
              <button type="button" className="appNavMenuItem" onClick={onOpenExportSettings}>XDTS詳細設定...</button>
            </Tooltip>
          )}
        </div>
      </div>
      <Tooltip label={uiText.actions.resetAppTitle}>
        <button type="button" className="appNavMenuItem" onClick={onResetApp}>{uiText.actions.resetApp}</button>
      </Tooltip>
      <div className="appNavSectionLabel">ワークスペース</div>
      {panels.map(item => (
        <Tooltip key={item} label={uiText.nav.workspaceItemTitle(panelLabel(item))}>
          <button
            type="button"
            className={item === panel ? 'appNavMenuItem active' : 'appNavMenuItem'}
            aria-current={item === panel ? 'page' : undefined}
            onClick={() => onSelect(item)}
          >
            {panelLabel(item)}
          </button>
        </Tooltip>
      ))}
    </ActionMenu>
  )
}

function panelLabel(panel: Panel): string {
  switch (panel) {
    case 'sheet':
      return uiText.nav.sheet
    case 'bindings':
      return uiText.nav.bindings
    case 'slots':
      return uiText.nav.slots
    case 'template':
      return uiText.nav.template
    case 'export':
      return uiText.nav.export
  }
}

function sheetSourceLabel(source: SheetSource): string {
  return source.imageRef.name
}

function calibrationCornersForTemplate(template: Pick<SheetTemplate, 'regions'>): SheetImageAlignment['corners'] | null {
  const rect = calibrationTargetRectForTemplate(template)
  if (!rect) return null
  return cornersFromRect(rect)
}

function shouldAutoCalibrateImportedSheetSources(template: SheetTemplate): boolean {
  if (!isTauriHost()) return false
  const layout = getSheetViewLayout(template)
  return layout.surface?.type === 'fixed-page' && Boolean(calibrationTargetRectForTemplate(template))
}

function calibrationCornersFromPoints(
  points: SheetCalibrationPointPair[],
  kind: CalibrationPointKind,
): SheetImageAlignment['corners'] | null {
  if (points.length < 4) return null
  return {
    tl: { ...points[0][kind] },
    tr: { ...points[1][kind] },
    br: { ...points[2][kind] },
    bl: { ...points[3][kind] },
  }
}

function cornersFromRect(rect: NormalizedRect): SheetImageAlignment['corners'] {
  return {
    tl: { x: rect.x, y: rect.y },
    tr: { x: rect.x + rect.w, y: rect.y },
    br: { x: rect.x + rect.w, y: rect.y + rect.h },
    bl: { x: rect.x, y: rect.y + rect.h },
  }
}

function nextCutNumberLabel(document: CutGroupProjectDocument): string {
  const used = new Set(document.cuts.map(cut => cut.metadata.cut).filter((value): value is string => Boolean(value?.trim())))
  let index = document.cuts.length + 1
  let candidate = String(index).padStart(3, '0')
  while (used.has(candidate)) {
    index += 1
    candidate = String(index).padStart(3, '0')
  }
  return candidate
}

function imageExportFilterName(format: SheetImageExportFormat): string {
  switch (format) {
    case 'jpg':
      return 'JPEG'
    case 'png':
      return 'PNG'
    case 'psd':
      return 'PSD'
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
