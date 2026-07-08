import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { sheetTemplatePresetsForImageCorrection, standardA3SheetTemplate, type SheetCalibrationPointPair, type SheetTemplate } from '@xsheet-remap/core'
import { APP_VERSION } from './appVersion'
import { collectAssetFilesFromDrop, hasFileTransferPayload } from './assetFiles'
import { compareFileNameLikeText } from './naturalSort'
import { detectSheetCalibrationPoints, type AutoCalibrationResult } from './sheetAutoCalibration'
import { evaluateSheetCalibrationDiagnostic, type SheetCalibrationDiagnostic } from './sheetCalibrationDiagnostics'
import { CalibrationLoupeDialog } from './sheetCalibrationLoupe'
import { calibrationPointsSignature } from './sheetCalibrationUtils'
import {
  defaultCalibrationPoints,
  defaultSheetImageSettings,
  applyLevelCorrectionToDataUrl,
  loadImage,
  resolveImageRefUrl,
  useWarpedSheetImageUrl,
  warpSheetImage,
  warpSheetImageData,
} from './sheetImages'
import { alphaComposite, writeRgbPsd } from './psdWriter'
import { Tooltip, TooltipTarget } from './Tooltip'
import { isTauriHost } from '@xsheet-remap/adapters'
import { LevelCorrectionDialog } from './LevelCorrectionDialog'
import { LevelCorrectionFilterDefinition } from './LevelCorrectionFilter'
import { levelCorrectionFilterUrl, useLevelCorrectionFilterId } from './levelCorrectionFilterModel'
import { applyLevelCorrectionToImageData, defaultLevelCorrectionSettings, normalizeLevelCorrectionSettings, type LevelCorrectionSettings } from './levelCorrection'
import {
  DEFAULT_SHEET_IMPORT_RULE_PATTERN,
  LEGACY_SHEET_CORRECTOR_PATTERN_STORAGE_KEY,
  SHEET_CORRECTOR_IMPORT_RULES_STORAGE_KEY,
  activeSheetCorrectorImportPatterns,
  defaultSheetCorrectorImportRules,
  matchSheetCorrectorImportCandidates,
  parseStoredSheetCorrectorImportRules,
  sheetCorrectorImportRule,
  sheetCorrectorImportRuleSummary,
  type SheetCorrectorImportRule,
  type SheetCorrectorImportSourceKind,
} from './sheetCorrectorImportRules'

type SheetCorrectorInput = {
  path: string
  name: string
  extension: string
  size?: number
  matched: boolean
  sourceKind: SheetCorrectorImportSourceKind
}

type SheetCorrectorInputCollection = {
  inputs: SheetCorrectorInput[]
  hasDirectory: boolean
}

type SheetCorrectionDraft = {
  templateId: string
  points: SheetCalibrationPointPair[]
  applied: boolean
}

type QueueState = 'idle' | 'running' | 'corrected' | 'exported' | 'review' | 'error'
type SheetCorrectorExportFormat = 'psd' | 'png'

type SheetCorrectorProgressDialogState = {
  title: string
  message: string
  phase: 'collecting' | 'running' | 'done'
  total: number
  processed: number
  exported: number
  review: number
  error: number
  canClose: boolean
}

type QueueProcessOptions = {
  showProgressDialog?: boolean
  progressTitle?: string
  imageUrlOverrides?: Record<string, string>
  createImageUrl?: (item: SheetCorrectorInput) => Promise<string | null>
}

type NativeCollectMode = 'enqueue' | 'auto-export'
type NativeCollectSource = 'window-drop' | 'launch'
type SheetCorrectorViewMode = 'pending' | 'main' | 'batch'
type SheetCorrectorSavedWindowState = {
  width: number
  height: number
  x?: number
  y?: number
}

declare global {
  interface Window {
    __xsheetCorrectorDiagnostics?: {
      evaluateCalibrationFile: (path: string) => Promise<SheetCalibrationDiagnostic>
    }
  }
}

const SHEET_PATTERN_TOOLTIP = '* は任意の文字列、? は任意の1文字。直接指定した画像は条件に関係なく追加し、条件はフォルダ内画像だけに使います。'
const SHEET_TEMPLATE_TOOLTIP = 'タイムシートテンプレートを選択します。'
const SHEET_TEMPLATE_OVERLAY_TOOLTIP = 'テンプレート罫線を赤色で薄く重ねて表示します。'
const SHEET_CORRECTOR_PREVIEW_MIN_ZOOM = 0.25
const SHEET_CORRECTOR_PREVIEW_MAX_ZOOM = 3
const supportedImageExtensions = new Set(['png', 'jpg', 'jpeg', 'tif', 'tiff', 'tga', 'bmp'])
const SHEET_CORRECTOR_TEMPLATE_PRESETS = sheetTemplatePresetsForImageCorrection()
const DEFAULT_SHEET_CORRECTOR_TEMPLATE = SHEET_CORRECTOR_TEMPLATE_PRESETS[0]?.sheetTemplate ?? standardA3SheetTemplate
const SHEET_CORRECTOR_MAIN_WINDOW = { width: 1180, height: 820, minWidth: 900, minHeight: 620 }
const SHEET_CORRECTOR_BATCH_WINDOW = { width: 520, height: 390, minWidth: 460, minHeight: 340 }
const SHEET_CORRECTOR_WINDOW_STATE_STORAGE_KEY = 'xsheet-remap.sheet-corrector.windowState'

export function SheetCorrectorApp() {
  const [viewMode, setViewMode] = useState<SheetCorrectorViewMode>('pending')
  const [importRules, setImportRules] = useState(loadStoredSheetImportRules)
  const [items, setItems] = useState<SheetCorrectorInput[]>([])
  const [browserFiles, setBrowserFiles] = useState<File[]>([])
  const [browserFileUrls, setBrowserFileUrls] = useState<Record<string, string>>({})
  const [nativeFileUrls, setNativeFileUrls] = useState<Record<string, string>>({})
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])
  const [primarySelectedPath, setPrimarySelectedPath] = useState<string | null>(null)
  const [lastSelectedPath, setLastSelectedPath] = useState<string | null>(null)
  const [queueStates, setQueueStates] = useState<Record<string, QueueState>>({})
  const [correctionDrafts, setCorrectionDrafts] = useState<Record<string, SheetCorrectionDraft>>({})
  const [status, setStatus] = useState('フォルダまたはシート画像をドロップしてください。')
  const [autoCalibrationMessage, setAutoCalibrationMessage] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [queueRunning, setQueueRunning] = useState(false)
  const [autoCalibrationRunning, setAutoCalibrationRunning] = useState(false)
  const [correctionMenuOpen, setCorrectionMenuOpen] = useState(false)
  const [jobMenuOpen, setJobMenuOpen] = useState(false)
  const [calibrationLoupeOpen, setCalibrationLoupeOpen] = useState(false)
  const [helpDialogOpen, setHelpDialogOpen] = useState(false)
  const [progressDialog, setProgressDialog] = useState<SheetCorrectorProgressDialogState | null>(null)
  const [levelCorrectionSettings, setLevelCorrectionSettings] = useState<LevelCorrectionSettings>(() => defaultLevelCorrectionSettings())
  const [levelCorrectionDialogOpen, setLevelCorrectionDialogOpen] = useState(false)
  const [selectedTemplateId, setSelectedTemplateId] = useState(DEFAULT_SHEET_CORRECTOR_TEMPLATE.templateId)
  const [templateOverlayEnabled, setTemplateOverlayEnabled] = useState(true)
  const [templateOverlayOpacity, setTemplateOverlayOpacity] = useState(80)
  const didLoadLaunchPaths = useRef(false)
  const stopQueueRequestedRef = useRef(false)
  const nextImportRuleIdRef = useRef(0)
  const browserFileUrlsRef = useRef<Record<string, string>>({})
  const browserFileInputRef = useRef<HTMLInputElement | null>(null)
  const correctionMenuRef = useRef<HTMLDetailsElement | null>(null)
  const jobMenuRef = useRef<HTMLDetailsElement | null>(null)

  const selectedTemplate = useMemo(
    () => SHEET_CORRECTOR_TEMPLATE_PRESETS.find(preset => preset.sheetTemplate.templateId === selectedTemplateId)?.sheetTemplate ?? DEFAULT_SHEET_CORRECTOR_TEMPLATE,
    [selectedTemplateId],
  )
  const queueItems = useMemo(
    () => items.filter(item => item.matched).sort(compareSheetCorrectorInputs),
    [items],
  )
  const selectedItem = useMemo(
    () => queueItems.find(item => item.path === primarySelectedPath)
      ?? queueItems.find(item => selectedPaths.includes(item.path))
      ?? queueItems[0]
      ?? null,
    [primarySelectedPath, queueItems, selectedPaths],
  )
  const selectedImageUrl = selectedItem ? imageUrlForItem(selectedItem, browserFileUrls, nativeFileUrls) : null
  const selectedDraft = selectedItem ? draftForTemplate(correctionDrafts[selectedItem.path], selectedTemplate.templateId) : undefined
  const currentTemplateCorrectionDrafts = useMemo(
    () => filterDraftsForTemplate(correctionDrafts, selectedTemplate.templateId),
    [correctionDrafts, selectedTemplate.templateId],
  )
  const selectedPoints = useMemo(
    () => selectedDraft?.points ?? defaultCalibrationPoints(selectedTemplate),
    [selectedDraft, selectedTemplate],
  )
  const selectedCalibrationKey = calibrationPointsSignature(selectedPoints)
  const selectedImageSettings = useMemo(() => ({
    ...defaultSheetImageSettings(),
    calibration: {
      enabled: selectedDraft?.applied ?? false,
      points: selectedPoints,
    },
  }), [selectedDraft?.applied, selectedPoints])
  const warpedPreviewUrl = useWarpedSheetImageUrl(selectedImageUrl, selectedImageSettings, selectedTemplate, 'preview')
  const previewImageUrl = selectedDraft?.applied ? (warpedPreviewUrl ?? selectedImageUrl) : selectedImageUrl
  const previewViewKey = selectedItem ? `${selectedItem.path}:${selectedTemplate.templateId}:${selectedDraft?.applied ? selectedCalibrationKey : 'raw'}` : null
  const templateImageUrl = useMemo(() => templateOverlayImageUrl(selectedTemplate), [selectedTemplate])
  const revokeBrowserPreviewUrls = useCallback(() => {
    const urls = browserFileUrlsRef.current
    browserFileUrlsRef.current = {}
    revokeBrowserFileUrls(urls)
  }, [])

  useEffect(() => revokeBrowserPreviewUrls, [revokeBrowserPreviewUrls])

  useEffect(() => {
    let disposed = false
    window.__xsheetCorrectorDiagnostics = {
      evaluateCalibrationFile: async (path: string) => {
        const { convertFileSrc } = await import('@tauri-apps/api/core')
        const normalizedPath = path.replace(/\\/g, '/')
        const name = normalizedPath.split('/').pop() || path
        if (disposed) throw new Error('sheet corrector diagnostics disposed')
        return evaluateSheetCalibrationDiagnostic(
          {
            path,
            name,
            imageUrl: convertFileSrc(path),
          },
          standardA3SheetTemplate,
        )
      },
    }
    return () => {
      disposed = true
      if (window.__xsheetCorrectorDiagnostics) delete window.__xsheetCorrectorDiagnostics
    }
  }, [])

  useEffect(() => {
    saveStoredSheetImportRules(importRules)
  }, [importRules])

  useEffect(() => {
    if (viewMode !== 'main') return undefined
    let disposed = false
    let saveTimer: number | undefined
    let unlistenResize: (() => void) | undefined
    let unlistenMove: (() => void) | undefined

    function scheduleSave() {
      if (disposed) return
      if (saveTimer) window.clearTimeout(saveTimer)
      saveTimer = window.setTimeout(() => {
        void saveCurrentSheetCorrectorWindowState()
      }, 300)
    }

    void import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => {
        if (disposed) return
        const currentWindow = getCurrentWindow()
        scheduleSave()
        void currentWindow.onResized(() => scheduleSave()).then(unlisten => {
          if (disposed) {
            unlisten()
          } else {
            unlistenResize = unlisten
          }
        })
        void currentWindow.onMoved(() => scheduleSave()).then(unlisten => {
          if (disposed) {
            unlisten()
          } else {
            unlistenMove = unlisten
          }
        })
      })
      .catch(() => {
        // Window state persistence is a convenience for desktop runs.
      })

    return () => {
      disposed = true
      if (saveTimer) window.clearTimeout(saveTimer)
      unlistenResize?.()
      unlistenMove?.()
    }
  }, [viewMode])

  useEffect(() => {
    if (!correctionMenuOpen && !jobMenuOpen) return undefined
    function handlePointerDown(event: globalThis.PointerEvent) {
      const target = event.target
      if (target instanceof Node && correctionMenuRef.current?.contains(target)) return
      if (target instanceof Node && jobMenuRef.current?.contains(target)) return
      setCorrectionMenuOpen(false)
      setJobMenuOpen(false)
    }
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') return
      setCorrectionMenuOpen(false)
      setJobMenuOpen(false)
    }
    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [correctionMenuOpen, jobMenuOpen])

  const syncQueueSelectionAfterEnqueue = useCallback((nextItems: SheetCorrectorInput[], preferredPaths: string[]) => {
    const nextQueueItems = nextItems.filter(item => item.matched).sort(compareSheetCorrectorInputs)
    const nextQueuePaths = new Set(nextQueueItems.map(item => item.path))
    const preferredPath = preferredPaths.find(path => nextQueuePaths.has(path)) ?? null
    if (preferredPath) {
      setSelectedPaths([preferredPath])
      setPrimarySelectedPath(preferredPath)
      setLastSelectedPath(preferredPath)
      return
    }
    const currentSelection = selectedPaths.filter(path => nextQueuePaths.has(path))
    if (currentSelection.length > 0 && primarySelectedPath && nextQueuePaths.has(primarySelectedPath)) return
    const fallbackPath = nextQueueItems[0]?.path ?? null
    setSelectedPaths(fallbackPath ? [fallbackPath] : [])
    setPrimarySelectedPath(fallbackPath)
    setLastSelectedPath(fallbackPath)
  }, [primarySelectedPath, selectedPaths])

  const enqueueNativeItems = useCallback(async (incomingItems: SheetCorrectorInput[], label: string): Promise<string[]> => {
    const incoming = incomingItems
      .filter(item => item.sourceKind !== 'browser-file')
      .map(item => ({ ...item, matched: true }))
    if (incoming.length === 0) {
      setStatus('追加できる対応画像がありません。')
      return []
    }
    const existingPaths = new Set(items.map(item => item.path))
    const added = incoming.filter(item => !existingPaths.has(item.path))
    const nextItems = dedupeSheetCorrectorInputs([...items, ...added]).sort(compareSheetCorrectorInputs)
    setItems(nextItems)
    syncQueueSelectionAfterEnqueue(nextItems, added.map(item => item.path))
    setStatus(`${label}: ${added.length}件をキューに追加しました${incoming.length > added.length ? ` / 登録済み ${incoming.length - added.length}件` : ''}。`)
    return added.map(item => item.path)
  }, [items, syncQueueSelectionAfterEnqueue])

  useEffect(() => {
    if (!selectedItem || selectedItem.sourceKind === 'browser-file') return undefined
    if (nativeFileUrls[selectedItem.path]) return undefined
    let cancelled = false
    void createNativeSheetImageDataUrl(selectedItem)
      .then(imageUrl => {
        if (cancelled || !imageUrl) return
        setNativeFileUrls(current => current[selectedItem.path] ? current : { [selectedItem.path]: imageUrl })
      })
      .catch(error => {
        if (!cancelled) setStatus(`プレビュー読込エラー: ${selectedItem.name}: ${error instanceof Error ? error.message : String(error)}`)
      })
    return () => {
      cancelled = true
    }
  }, [nativeFileUrls, selectedItem])

  function enqueueBrowserFiles(files: File[]) {
    const incomingFiles = files.filter(isSupportedSheetImageFile)
    if (incomingFiles.length === 0) return
    const previousFileKeys = new Set(browserFiles.map(browserFilePath))
    const nextFiles = dedupeFiles([...browserFiles, ...incomingFiles]).sort((a, b) => compareFileNameLikeText(a.name, b.name))
    const addedFiles = nextFiles.filter(file => !previousFileKeys.has(browserFilePath(file)))
    setBrowserFiles(nextFiles)
    replaceBrowserFileUrls(objectUrlsForFiles(nextFiles), browserFileUrlsRef, setBrowserFileUrls)
    const nativeItems = items.filter(item => item.sourceKind !== 'browser-file')
    const nextItems = dedupeSheetCorrectorInputs([...nativeItems, ...nextFiles.map(fileToBrowserInput)]).sort(compareSheetCorrectorInputs)
    setItems(nextItems)
    syncQueueSelectionAfterEnqueue(nextItems, addedFiles.map(browserFilePath))
    setStatus(`直接追加: ${addedFiles.length}件をキューに追加しました${incomingFiles.length > addedFiles.length ? ` / 登録済み ${incomingFiles.length - addedFiles.length}件` : ''}。`)
  }

  function runQueueJob(paths: string[]) {
    setJobMenuOpen(false)
    void processQueue(paths)
  }

  function runCorrectionJob(paths: string[]) {
    setCorrectionMenuOpen(false)
    void processCorrection(paths)
  }

  function runSingleQueueItem(path: string) {
    void processQueue([path])
  }

  async function handleDrop(event: DragEvent<HTMLElement>) {
    if (!hasFileTransferPayload(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    setIsDragOver(false)
    const files = await collectAssetFilesFromDrop(event.dataTransfer)
    enqueueBrowserFiles(files)
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    if (!hasFileTransferPayload(event.dataTransfer)) {
      setIsDragOver(false)
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setIsDragOver(true)
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    const relatedTarget = event.relatedTarget
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) return
    setIsDragOver(false)
  }

  function handleContextMenu(event: MouseEvent<HTMLElement>) {
    event.preventDefault()
  }

  function handleFilePicker(files: FileList | null) {
    if (!files) return
    enqueueBrowserFiles(Array.from(files))
  }

  async function handleQueueAddClick() {
    if (!isTauriHost()) {
      browserFileInputRef.current?.click()
      return
    }
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const selectedItems = await invoke<SheetCorrectorInput[]>('open_sheet_corrector_inputs')
      if (selectedItems.length === 0) return
      await enqueueNativeItems(selectedItems, '直接追加')
    } catch (error) {
      setStatus(`画像選択に失敗: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function addImportRule() {
    nextImportRuleIdRef.current += 1
    const id = `rule-${Date.now()}-${nextImportRuleIdRef.current}`
    setImportRules(current => [...current, sheetCorrectorImportRule(id, '')])
  }

  function updateImportRulePattern(id: string, pattern: string) {
    setImportRules(current => current.map(rule => rule.id === id ? { ...rule, pattern } : rule))
  }

  function updateImportRuleEnabled(id: string, enabled: boolean) {
    setImportRules(current => current.map(rule => rule.id === id ? { ...rule, enabled } : rule))
  }

  function removeImportRule(id: string) {
    setImportRules(current => current.filter(rule => rule.id !== id))
  }

  function resetImportRules() {
    setImportRules(defaultSheetCorrectorImportRules())
  }

  function handleQueueItemSelect(path: string, event: MouseEvent<HTMLButtonElement>) {
    const visiblePaths = queueItems.map(item => item.path)
    if (event.shiftKey && lastSelectedPath && visiblePaths.includes(lastSelectedPath)) {
      const anchorIndex = visiblePaths.indexOf(lastSelectedPath)
      const focusIndex = visiblePaths.indexOf(path)
      const start = Math.min(anchorIndex, focusIndex)
      const end = Math.max(anchorIndex, focusIndex)
      const range = visiblePaths.slice(start, end + 1)
      setSelectedPaths(event.ctrlKey || event.metaKey ? dedupeStrings([...selectedPaths, ...range]) : range)
      setPrimarySelectedPath(path)
      return
    }
    if (event.ctrlKey || event.metaKey) {
      const selected = selectedPaths.includes(path)
      const nextSelection = selected ? selectedPaths.filter(itemPath => itemPath !== path) : [...selectedPaths, path]
      setSelectedPaths(nextSelection)
      setPrimarySelectedPath(path)
      setLastSelectedPath(path)
      return
    }
    setSelectedPaths([path])
    setPrimarySelectedPath(path)
    setLastSelectedPath(path)
  }

  function removeQueueItems(paths: string[]) {
    if (paths.length === 0 || queueRunning) return
    const removeSet = new Set(paths)
    const nextItems = items.filter(item => !removeSet.has(item.path))
    setItems(nextItems)
    setBrowserFiles(current => current.filter(file => !removeSet.has(browserFilePath(file))))
    setNativeFileUrls(current => omitRecordKeys(current, removeSet))
    setQueueStates(current => omitRecordKeys(current, removeSet))
    setCorrectionDrafts(current => omitRecordKeys(current, removeSet))
    replaceBrowserFileUrls(objectUrlsForFiles(browserFiles.filter(file => !removeSet.has(browserFilePath(file)))), browserFileUrlsRef, setBrowserFileUrls)
    syncQueueSelectionAfterRemoval(nextItems, removeSet)
  }

  function syncQueueSelectionAfterRemoval(nextItems: SheetCorrectorInput[], removeSet: Set<string>) {
    const nextQueueItems = nextItems.filter(item => item.matched).sort(compareSheetCorrectorInputs)
    const nextQueuePaths = new Set(nextQueueItems.map(item => item.path))
    const nextSelectedPaths = selectedPaths.filter(path => !removeSet.has(path) && nextQueuePaths.has(path))
    const nextPrimaryPath = primarySelectedPath && !removeSet.has(primarySelectedPath) && nextQueuePaths.has(primarySelectedPath)
      ? primarySelectedPath
      : nextSelectedPaths[0] ?? nextQueueItems[0]?.path ?? null
    setSelectedPaths(nextSelectedPaths.length > 0 ? nextSelectedPaths : (nextPrimaryPath ? [nextPrimaryPath] : []))
    setPrimarySelectedPath(nextPrimaryPath)
    setLastSelectedPath(nextPrimaryPath)
  }

  const updateDraftForPath = useCallback((path: string, points: SheetCalibrationPointPair[], applied: boolean) => {
    setCorrectionDrafts(current => ({
      ...current,
      [path]: { templateId: selectedTemplate.templateId, points, applied },
    }))
  }, [selectedTemplate.templateId])

  function applySelectedWarp(pointsOverride?: SheetCalibrationPointPair[]) {
    if (!selectedItem) return
    updateDraftForPath(selectedItem.path, pointsOverride ?? selectedPoints, true)
    setQueueStates(current => ({ ...current, [selectedItem.path]: 'corrected' }))
    setAutoCalibrationMessage('補正を適用しました。')
  }

  const detectCalibrationResultForItem = useCallback(async (
    item: SheetCorrectorInput,
    imageUrlOverrides?: Record<string, string>,
  ): Promise<AutoCalibrationResult | null> => {
    const imageUrl = imageUrlForItem(item, browserFileUrls, nativeFileUrls, imageUrlOverrides)
      ?? await createNativeSheetImageDataUrl(item)
    if (!imageUrl) return null
    return await detectSheetCalibrationPoints(imageUrl, selectedTemplate)
  }, [browserFileUrls, nativeFileUrls, selectedTemplate])

  const detectCalibrationForItem = useCallback(async (
    item: SheetCorrectorInput,
    imageUrlOverrides?: Record<string, string>,
  ): Promise<SheetCalibrationPointPair[] | null> => {
    const result = await detectCalibrationResultForItem(item, imageUrlOverrides)
    return result?.points ?? null
  }, [detectCalibrationResultForItem])

  const exportCorrectedPngItem = useCallback(async (
    item: SheetCorrectorInput,
    imageUrl: string,
    points: SheetCalibrationPointPair[],
  ): Promise<string | null> => {
    const pngDataUrl = await correctedPngDataUrl(imageUrl, points, levelCorrectionSettings, selectedTemplate)
    if (!pngDataUrl) return null
    if (item.sourceKind === 'browser-file') {
      downloadDataUrl(pngDataUrl, correctedOutputName(item.name, 'png'))
      return correctedOutputName(item.name, 'png')
    }
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<string>('export_sheet_corrector_png', {
      sourcePath: item.path,
      pngDataUrl,
    })
  }, [levelCorrectionSettings, selectedTemplate])

  const exportCorrectedItem = useCallback(async (
    item: SheetCorrectorInput,
    format: SheetCorrectorExportFormat,
    pointsOverride?: SheetCalibrationPointPair[],
    detectIfMissing = true,
    imageUrlOverrides?: Record<string, string>,
  ): Promise<string | null> => {
    const imageUrl = imageUrlForItem(item, browserFileUrls, nativeFileUrls, imageUrlOverrides)
      ?? await createNativeSheetImageDataUrl(item)
    if (!imageUrl) return null
    const currentDraft = draftForTemplate(correctionDrafts[item.path], selectedTemplate.templateId)
    let points = pointsOverride ?? (currentDraft?.applied ? currentDraft.points : undefined)
    if (!points && detectIfMissing) {
      points = await detectCalibrationForItem(item, imageUrlOverrides) ?? undefined
      if (!points) return null
      updateDraftForPath(item.path, points, true)
    }
    if (!points) return null
    if (format === 'png') return exportCorrectedPngItem(item, imageUrl, points)
    const psdBase64 = await correctedPsdBase64(item.name, imageUrl, templateImageUrl, points, levelCorrectionSettings, selectedTemplate)
    if (!psdBase64) return null
    if (item.sourceKind === 'browser-file') {
      downloadBytes(base64ToBytes(psdBase64), correctedOutputName(item.name, 'psd'), 'image/vnd.adobe.photoshop')
      return correctedOutputName(item.name, 'psd')
    }
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<string>('export_sheet_corrector_psd', {
      sourcePath: item.path,
      psdBase64,
    })
  }, [
    browserFileUrls,
    correctionDrafts,
    detectCalibrationForItem,
    exportCorrectedPngItem,
    levelCorrectionSettings,
    nativeFileUrls,
    selectedTemplate,
    templateImageUrl,
    updateDraftForPath,
  ])

  async function autoDetectSelectedForLoupe(): Promise<SheetCalibrationPointPair[] | undefined> {
    if (!selectedItem || autoCalibrationRunning) return undefined
    setAutoCalibrationRunning(true)
    setAutoCalibrationMessage('自動検出中...')
    try {
      const points = await detectCalibrationForItem(selectedItem)
      if (!points) {
        setAutoCalibrationMessage('自動検出できませんでした。手動で四隅を合わせてください。')
        return undefined
      }
      setAutoCalibrationMessage('自動検出しました。必要なら四隅を微調整してください。')
      return points
    } catch (error) {
      setAutoCalibrationMessage(`自動検出エラー: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    } finally {
      setAutoCalibrationRunning(false)
    }
  }

  const processQueueItems = useCallback(async (targets: SheetCorrectorInput[], options: QueueProcessOptions = {}) => {
    if (queueRunning) return
    const dedupedTargets = dedupeSheetCorrectorInputs(targets).sort(compareSheetCorrectorInputs)
    const showProgressDialog = options.showProgressDialog ?? false
    const progressTitle = options.progressTitle ?? 'PSD出力'
    if (dedupedTargets.length === 0) {
      if (showProgressDialog) {
        setProgressDialog({
          title: progressTitle,
          message: '処理対象がありません。',
          phase: 'done',
          total: 0,
          processed: 0,
          exported: 0,
          review: 0,
          error: 0,
          canClose: true,
        })
      }
      return
    }
    stopQueueRequestedRef.current = false
    setQueueRunning(true)
    setStatus(`${dedupedTargets.length}件の処理を開始しました。`)
    if (showProgressDialog) {
      setProgressDialog({
        title: progressTitle,
        message: `${dedupedTargets.length}件のPSD出力を開始しました。`,
        phase: 'running',
        total: dedupedTargets.length,
        processed: 0,
        exported: 0,
        review: 0,
        error: 0,
        canClose: false,
      })
    }
    let exportedCount = 0
    let reviewCount = 0
    let errorCount = 0
    let processedCount = 0
    try {
      for (const item of dedupedTargets) {
        if (stopQueueRequestedRef.current) break
        setQueueStates(current => ({ ...current, [item.path]: 'running' }))
        if (showProgressDialog) {
          setProgressDialog(current => current ? {
            ...current,
            message: `${item.name} を処理しています...`,
          } : current)
        }
        try {
          const existingDraft = draftForTemplate(correctionDrafts[item.path], selectedTemplate.templateId)
          let imageUrlOverrides = options.imageUrlOverrides
          if (options.createImageUrl) {
            const imageUrl = await options.createImageUrl(item)
            if (!imageUrl) {
              reviewCount += 1
              setQueueStates(current => ({ ...current, [item.path]: 'review' }))
              continue
            }
            imageUrlOverrides = { [item.path]: imageUrl }
          }
          let points: SheetCalibrationPointPair[] | undefined
          if (existingDraft?.applied) {
            points = existingDraft.points
          } else {
            const result = await detectCalibrationResultForItem(item, imageUrlOverrides)
            if (!result) {
              reviewCount += 1
              setQueueStates(current => ({ ...current, [item.path]: 'review' }))
              continue
            }
            points = result.points
            updateDraftForPath(item.path, points, true)
          }
          const outputPath = await exportCorrectedItem(item, 'psd', points, false, imageUrlOverrides)
          if (outputPath) {
            exportedCount += 1
            setQueueStates(current => ({ ...current, [item.path]: 'exported' }))
          } else {
            reviewCount += 1
            setQueueStates(current => ({ ...current, [item.path]: 'review' }))
          }
        } catch (error) {
          errorCount += 1
          setQueueStates(current => ({ ...current, [item.path]: 'error' }))
          setStatus(`処理エラー: ${item.name}: ${error instanceof Error ? error.message : String(error)}`)
        }
        processedCount += 1
        if (showProgressDialog) {
          setProgressDialog(current => current ? {
            ...current,
            processed: processedCount,
            exported: exportedCount,
            review: reviewCount,
            error: errorCount,
            message: `${processedCount}/${dedupedTargets.length}件を処理しました。`,
          } : current)
        }
      }
    } finally {
      setQueueRunning(false)
      const finalMessage = stopQueueRequestedRef.current
        ? `キュー処理を停止しました。PSD出力 ${exportedCount}件${reviewCount > 0 ? ` / 要確認 ${reviewCount}件` : ''}${errorCount > 0 ? ` / エラー ${errorCount}件` : ''}`
        : `処理が完了しました。PSD出力 ${exportedCount}件${reviewCount > 0 ? ` / 要確認 ${reviewCount}件` : ''}${errorCount > 0 ? ` / エラー ${errorCount}件` : ''}`
      setStatus(finalMessage)
      if (showProgressDialog) {
        setProgressDialog({
          title: progressTitle,
          message: finalMessage,
          phase: 'done',
          total: dedupedTargets.length,
          processed: processedCount,
          exported: exportedCount,
          review: reviewCount,
          error: errorCount,
          canClose: true,
        })
      }
      stopQueueRequestedRef.current = false
    }
  }, [
    correctionDrafts,
    detectCalibrationResultForItem,
    exportCorrectedItem,
    queueRunning,
    selectedTemplate.templateId,
    updateDraftForPath,
  ])

  const correctQueueItems = useCallback(async (targets: SheetCorrectorInput[]) => {
    if (queueRunning) return
    const dedupedTargets = dedupeSheetCorrectorInputs(targets).sort(compareSheetCorrectorInputs)
    if (dedupedTargets.length === 0) {
      setStatus('補正対象がありません。')
      return
    }
    stopQueueRequestedRef.current = false
    setQueueRunning(true)
    setStatus(`${dedupedTargets.length}件の補正を開始しました。`)
    let correctedCount = 0
    let keptCount = 0
    let reviewCount = 0
    let processedCount = 0
    try {
      for (const item of dedupedTargets) {
        if (stopQueueRequestedRef.current) break
        const existingDraft = draftForTemplate(correctionDrafts[item.path], selectedTemplate.templateId)
        if (existingDraft?.applied) {
          keptCount += 1
          setQueueStates(current => {
            if (current[item.path] === 'exported') return current
            return { ...current, [item.path]: 'corrected' }
          })
          processedCount += 1
          setStatus(`${processedCount}/${dedupedTargets.length}件を補正しました。`)
          continue
        }
        setQueueStates(current => ({ ...current, [item.path]: 'running' }))
        try {
          const result = await detectCalibrationResultForItem(item)
          if (!result) {
            reviewCount += 1
            setQueueStates(current => ({ ...current, [item.path]: 'review' }))
          } else {
            correctedCount += 1
            updateDraftForPath(item.path, result.points, true)
            setQueueStates(current => ({ ...current, [item.path]: 'corrected' }))
          }
        } catch (error) {
          reviewCount += 1
          setQueueStates(current => ({ ...current, [item.path]: 'error' }))
          setStatus(`補正エラー: ${item.name}: ${error instanceof Error ? error.message : String(error)}`)
        }
        processedCount += 1
        setStatus(`${processedCount}/${dedupedTargets.length}件を補正しました。`)
      }
    } finally {
      setQueueRunning(false)
      const finalMessage = stopQueueRequestedRef.current
        ? `補正を停止しました。補正 ${correctedCount}件${keptCount > 0 ? ` / 補正済み ${keptCount}件` : ''}${reviewCount > 0 ? ` / 要確認 ${reviewCount}件` : ''}`
        : `補正が完了しました。補正 ${correctedCount}件${keptCount > 0 ? ` / 補正済み ${keptCount}件` : ''}${reviewCount > 0 ? ` / 要確認 ${reviewCount}件` : ''}`
      setStatus(finalMessage)
      stopQueueRequestedRef.current = false
    }
  }, [
    correctionDrafts,
    detectCalibrationResultForItem,
    queueRunning,
    selectedTemplate.templateId,
    updateDraftForPath,
  ])

  async function processQueue(paths: string[], options: QueueProcessOptions = {}) {
    const pathSet = new Set(paths)
    const targets = queueItems.filter(item => pathSet.has(item.path))
    await processQueueItems(targets, options)
  }

  async function processCorrection(paths: string[]) {
    const pathSet = new Set(paths)
    const targets = queueItems.filter(item => pathSet.has(item.path))
    await correctQueueItems(targets)
  }

  function stopQueue() {
    stopQueueRequestedRef.current = true
    setStatus('現在の処理後に停止します。')
    setProgressDialog(current => current && !current.canClose
      ? { ...current, message: 'キャンセル中です。現在の処理が終わるまで待機しています。' }
      : current)
  }

  const openMainView = useCallback(() => {
    const nextSelectedItem = queueItems.find(item => {
      const state = queueStates[item.path]
      return state === 'review' || state === 'error'
    }) ?? queueItems[0]
    if (nextSelectedItem) {
      setSelectedPaths([nextSelectedItem.path])
      setPrimarySelectedPath(nextSelectedItem.path)
      setLastSelectedPath(nextSelectedItem.path)
    }
    setProgressDialog(null)
    void restoreSheetCorrectorMainWindow()
      .finally(() => setViewMode('main'))
  }, [queueItems, queueStates])

  function closeSheetCorrector() {
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('quit_sheet_corrector'))
      .catch(() => import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) => getCurrentWindow().close()))
      .catch(() => {
        if (viewMode !== 'batch') {
          setProgressDialog(null)
          return
        }
        setProgressDialog(current => current ? {
          ...current,
          message: 'アプリを閉じられませんでした。ウィンドウの閉じるボタンで終了してください。',
          phase: 'done',
          canClose: true,
        } : {
          title: '自動PSD出力',
          message: 'アプリを閉じられませんでした。ウィンドウの閉じるボタンで終了してください。',
          phase: 'done',
          total: 0,
          processed: 0,
          exported: 0,
          review: 0,
          error: 0,
          canClose: true,
        })
      })
  }

  const collectNativePaths = useCallback(async (paths: string[], mode: NativeCollectMode, source: NativeCollectSource = 'window-drop') => {
    const nextPaths = dedupeStrings(paths)
    if (nextPaths.length === 0) return
    const autoExport = mode === 'auto-export'
    setStatus('候補を収集中...')
    if (autoExport) {
      setProgressDialog({
        title: '自動PSD出力',
        message: '対象画像を抽出しています...',
        phase: 'collecting',
        total: 0,
          processed: 0,
          exported: 0,
          review: 0,
          error: 0,
          canClose: false,
        })
      }
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const collection = await invoke<SheetCorrectorInputCollection>('collect_sheet_corrector_inputs', {
        paths: nextPaths,
      })
      const match = matchSheetCorrectorImportCandidates(collection.inputs, importRules)
      const targets = match.targets.sort(compareSheetCorrectorInputs)
      const targetPaths = dedupeStrings(targets.map(item => item.path))
      if (targetPaths.length === 0) {
        const patternLabel = sheetCorrectorImportRuleSummary(importRules)
        const message = collection.inputs.length > 0
          ? `取込条件 ${patternLabel} に合うフォルダ内画像がありませんでした。`
          : '対応画像が見つかりませんでした。'
        setStatus(message)
        if (autoExport) {
          setProgressDialog({
            title: '自動PSD出力',
            message,
            phase: 'done',
            total: 0,
            processed: 0,
            exported: 0,
            review: 0,
            error: 0,
            canClose: true,
          })
        }
        return
      }
      await enqueueNativeItems(targets, autoExport ? '自動取込' : source === 'launch' ? '起動時取込' : 'ドロップ取込')
      const skippedLabel = match.skippedDirectoryEntries.length > 0 ? ` / 条件外 ${match.skippedDirectoryEntries.length}件` : ''
      if (!autoExport) {
        setStatus(`${targetPaths.length}件をキューに追加しました${skippedLabel}。必要なアイテムを選んで出力してください。`)
        return
      }
      setStatus(`${targetPaths.length}件を自動PSD出力します${skippedLabel}。`)
      setProgressDialog({
        title: '自動PSD出力',
        message: `${targetPaths.length}件を処理待ちです。`,
        phase: 'collecting',
        total: targetPaths.length,
        processed: 0,
        exported: 0,
        review: 0,
        error: 0,
        canClose: false,
      })
      void processQueueItems(targets, {
        showProgressDialog: true,
        progressTitle: '自動PSD出力',
        createImageUrl: createNativeSheetImageDataUrl,
      })
    } catch (error) {
      const message = `候補収集に失敗: ${error instanceof Error ? error.message : String(error)}`
      setStatus(message)
      if (autoExport) {
        setProgressDialog({
          title: '自動PSD出力',
          message,
          phase: 'done',
          total: 0,
          processed: 0,
          exported: 0,
          review: 0,
          error: 0,
          canClose: true,
        })
      }
    }
  }, [enqueueNativeItems, importRules, processQueueItems])

  useEffect(() => {
    if (didLoadLaunchPaths.current) return
    didLoadLaunchPaths.current = true
    let cancelled = false
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke<string[]>('sheet_corrector_launch_paths'))
      .then(paths => {
        if (cancelled) return
        if (paths.length > 0) {
          setProgressDialog({
            title: '自動PSD出力',
            message: '起動時ドロップを読み込んでいます...',
            phase: 'collecting',
            total: 0,
            processed: 0,
            exported: 0,
            review: 0,
            error: 0,
            canClose: false,
          })
          setViewMode('batch')
          void configureSheetCorrectorBatchWindow()
          void collectNativePaths(paths, 'auto-export', 'launch')
          return
        }
        void restoreSheetCorrectorMainWindow()
          .finally(() => setViewMode('main'))
      })
      .catch(() => {
        // Browser preview does not have the native launch argument command.
        if (!cancelled) {
          setViewMode('main')
        }
      })
    return () => {
      cancelled = true
    }
  }, [collectNativePaths])

  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | undefined
    void import('@tauri-apps/api/webview')
      .then(({ getCurrentWebview }) => getCurrentWebview().onDragDropEvent(event => {
        if (cancelled) return
        const payload = event.payload
        if (payload.type === 'enter' || payload.type === 'over') {
          setIsDragOver(true)
          return
        }
        if (payload.type === 'leave') {
          setIsDragOver(false)
          return
        }
        setIsDragOver(false)
        if (payload.paths.length > 0) void collectNativePaths(payload.paths, 'enqueue', 'window-drop')
      }))
      .then(nextUnlisten => {
        if (cancelled) {
          nextUnlisten()
        } else {
          unlisten = nextUnlisten
        }
      })
      .catch(() => {
        // Browser preview keeps using DOM file drops.
        if ('__TAURI_INTERNALS__' in window) {
          setStatus('ネイティブドロップ監視の初期化に失敗しました。')
        }
      })
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [collectNativePaths])

  if (viewMode === 'pending') {
    return (
      <main className="sheetCorrectorBatchShell" aria-busy="true">
        <section className="sheetCorrectorProgressDialog">
          <header>
            <div>
              <strong>シート画像補正</strong>
              <span>起動しています...</span>
            </div>
          </header>
        </section>
      </main>
    )
  }

  if (viewMode === 'batch') {
    return (
      <main className="sheetCorrectorBatchShell" onContextMenu={handleContextMenu}>
        <SheetCorrectorBatchProgress
          state={progressDialog ?? emptySheetCorrectorProgressState('自動PSD出力', '起動時ドロップを読み込んでいます...')}
          queueRunning={queueRunning}
          onStop={stopQueue}
          onClose={closeSheetCorrector}
          onOpenApp={openMainView}
        />
      </main>
    )
  }

  return (
    <main
      className="sheetCorrectorShell"
      onDragEnter={handleDragOver}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={event => void handleDrop(event)}
      onContextMenu={handleContextMenu}
    >
      <header className="sheetCorrectorTopBar">
        <div>
          <strong>シート画像補正</strong>
          <span>v{APP_VERSION}</span>
        </div>
        <div className="sheetCorrectorTopBarActions">
          <Tooltip label="シートコレクターの使い方">
            <button type="button" className="sheetCorrectorHelpButton" onClick={() => setHelpDialogOpen(true)}>
              <SheetCorrectorQueueIcon name="help" />
              <span>ヘルプ</span>
            </button>
          </Tooltip>
        </div>
      </header>
      <section className="sheetCorrectorWorkspace">
        <aside className="sheetCorrectorControls">
          <section className="sheetCorrectorPanelBlock">
            <div className="sheetCorrectorQueueHeader">
              <h1>キュー</h1>
            </div>
            <div className="sheetCorrectorQueueToolbar">
              <Tooltip label="キュー追加">
                <button type="button" className="sheetCorrectorIconButton sheetCorrectorFileButton" aria-label="キュー追加" onClick={() => void handleQueueAddClick()}>
                  <SheetCorrectorQueueIcon name="add" />
                </button>
              </Tooltip>
              <input
                ref={browserFileInputRef}
                className="hiddenFileInput"
                type="file"
                accept="image/*,.tga"
                multiple
                onChange={event => {
                  handleFilePicker(event.currentTarget.files)
                  event.currentTarget.value = ''
                }}
              />
              <details
                ref={correctionMenuRef}
                className="sheetCorrectorJobMenu"
                open={correctionMenuOpen}
                onToggle={event => {
                  const nextOpen = event.currentTarget.open
                  setCorrectionMenuOpen(nextOpen)
                  if (nextOpen) setJobMenuOpen(false)
                }}
              >
                <TooltipTarget label="補正メニュー" disabled={correctionMenuOpen}>
                  {tooltipProps => (
                    <summary
                      {...tooltipProps}
                      className="sheetCorrectorOutputSummary"
                      aria-label="補正メニュー"
                      onClick={tooltipProps.onPointerDown}
                    >
                      <span>補正</span>
                      <span className="sheetCorrectorOutputChevron">▼</span>
                    </summary>
                  )}
                </TooltipTarget>
                <div className="sheetCorrectorJobMenuContent" role="menu">
                  <Tooltip label="選択ファイルを自動補正します。補正済みのファイルはそのまま維持します。">
                    <button type="button" role="menuitem" disabled={queueRunning || selectedPaths.length === 0} onClick={() => runCorrectionJob(selectedPaths)}>
                      選択を補正
                    </button>
                  </Tooltip>
                  <Tooltip label="キュー内の全ファイルを自動補正します。補正済みのファイルはそのまま維持します。">
                    <button type="button" role="menuitem" disabled={queueRunning || queueItems.length === 0} onClick={() => runCorrectionJob(queueItems.map(item => item.path))}>
                      一括補正
                    </button>
                  </Tooltip>
                </div>
              </details>
              <details
                ref={jobMenuRef}
                className="sheetCorrectorJobMenu"
                open={jobMenuOpen}
                onToggle={event => {
                  const nextOpen = event.currentTarget.open
                  setJobMenuOpen(nextOpen)
                  if (nextOpen) setCorrectionMenuOpen(false)
                }}
              >
                <TooltipTarget label="出力メニュー" disabled={jobMenuOpen}>
                  {tooltipProps => (
                    <summary
                      {...tooltipProps}
                      className="sheetCorrectorOutputSummary"
                      aria-label="出力メニュー"
                      onClick={tooltipProps.onPointerDown}
                    >
                      <SheetCorrectorQueueIcon name="export" />
                      <span>出力</span>
                      <span className="sheetCorrectorOutputChevron">▼</span>
                    </summary>
                  )}
                </TooltipTarget>
                <div className="sheetCorrectorJobMenuContent" role="menu">
                  <Tooltip label="選択ファイルをPSD出力します。未補正は自動補正して出力し、補正済みはそのまま出力します。">
                    <button type="button" role="menuitem" disabled={queueRunning || selectedPaths.length === 0} onClick={() => runQueueJob(selectedPaths)}>
                      選択を出力
                    </button>
                  </Tooltip>
                  <Tooltip label="キュー内の全ファイルをPSD出力します。未補正は自動補正して出力し、補正済みはそのまま出力します。">
                    <button type="button" role="menuitem" disabled={queueRunning || queueItems.length === 0} onClick={() => runQueueJob(queueItems.map(item => item.path))}>
                      全件を出力
                    </button>
                  </Tooltip>
                </div>
              </details>
              <Tooltip label="停止">
                <button type="button" className="sheetCorrectorIconButton" disabled={!queueRunning} aria-label="停止" onClick={stopQueue}>
                  <SheetCorrectorQueueIcon name="stop" />
                </button>
              </Tooltip>
            </div>
            <SheetCorrectorImportRulesControl
              rules={importRules}
              tooltipLabel={SHEET_PATTERN_TOOLTIP}
              onAdd={addImportRule}
              onReset={resetImportRules}
              onToggle={updateImportRuleEnabled}
              onChange={updateImportRulePattern}
              onRemove={removeImportRule}
            />
          </section>
          <SheetCorrectorItemList
            items={queueItems}
            selectedPaths={selectedPaths}
            primarySelectedPath={selectedItem?.path ?? null}
            queueStates={queueStates}
            correctionDrafts={currentTemplateCorrectionDrafts}
            actionsDisabled={queueRunning}
            emptyText="キューはまだありません。"
            onSelect={handleQueueItemSelect}
            onExport={runSingleQueueItem}
            onRemove={path => removeQueueItems([path])}
          />
        </aside>
        <section className="sheetCorrectorMain">
          <div className="sheetCorrectorCorrectionHeader">
            <div>
              <strong>{selectedItem?.name ?? 'シート未選択'}</strong>
              <span>{selectedItem ? `${queueItemStateLabel(queueStates[selectedItem.path])} / ${correctionStateLabel(selectedDraft)}` : 'キューから画像を選択してください。'}</span>
            </div>
            <div className="sheetCorrectorCorrectionActions">
              <Tooltip label={SHEET_TEMPLATE_TOOLTIP}>
                <label className="sheetCorrectorTemplateSelect">
                  <span>テンプレ</span>
                  <select
                    value={selectedTemplate.templateId}
                    onChange={event => setSelectedTemplateId(event.currentTarget.value)}
                  >
                    {SHEET_CORRECTOR_TEMPLATE_PRESETS.map(preset => (
                      <option key={preset.sheetTemplate.templateId} value={preset.sheetTemplate.templateId}>
                        {preset.name || preset.sheetTemplate.name}
                      </option>
                    ))}
                  </select>
                </label>
              </Tooltip>
              <Tooltip label={SHEET_TEMPLATE_OVERLAY_TOOLTIP}>
                <label className="sheetCorrectorOverlayToggle">
                  <input
                    type="checkbox"
                    checked={templateOverlayEnabled}
                    onChange={event => setTemplateOverlayEnabled(event.currentTarget.checked)}
                  />
                  表示
                </label>
              </Tooltip>
              <label className="sheetCorrectorOverlayOpacity">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={templateOverlayOpacity}
                  disabled={!templateOverlayEnabled}
                  onChange={event => setTemplateOverlayOpacity(Number(event.currentTarget.value))}
                />
                <span>{templateOverlayOpacity}%</span>
              </label>
              <Tooltip label="プレビューとPSD出力時にシート画像の濃淡を補正します。">
                <div className="sheetCorrectorCheck sheetCorrectorLevelCorrection">
                  <input
                    type="checkbox"
                    aria-label="レベル補正"
                    checked={levelCorrectionSettings.enabled}
                    onChange={event => setLevelCorrectionSettings(current => normalizeLevelCorrectionSettings({ ...current, enabled: event.currentTarget.checked }))}
                  />
                  <button type="button" className="levelCorrectionInlineButton" onClick={() => setLevelCorrectionDialogOpen(true)}>
                    レベル補正
                  </button>
                </div>
              </Tooltip>
              <Tooltip label="四隅合わせを開きます。">
                <button type="button" disabled={!selectedImageUrl || autoCalibrationRunning} onClick={() => setCalibrationLoupeOpen(true)}>
                  画像補正
                </button>
              </Tooltip>
            </div>
          </div>
          {(status || autoCalibrationMessage) && (
            <p className="sheetCorrectorStatus">{autoCalibrationMessage ?? status}</p>
          )}
          <SheetCorrectorSourcePreview
            imageUrl={previewImageUrl}
            viewKey={previewViewKey}
            levelCorrection={levelCorrectionSettings}
            templateImageUrl={templateImageUrl}
            overlayEnabled={templateOverlayEnabled}
            overlayOpacity={templateOverlayOpacity / 100}
          />
        </section>
      </section>
      {isDragOver && (
        <div className="sheetCorrectorDropOverlay" aria-hidden="true">
          <strong>ここへドロップ</strong>
          <span>画像またはフォルダを追加してPSD出力します。</span>
        </div>
      )}
      {progressDialog && (
        <SheetCorrectorProgressDialog
          state={progressDialog}
          queueRunning={queueRunning}
          onStop={stopQueue}
          onClose={() => {
            if (progressDialog.canClose) setProgressDialog(null)
          }}
        />
      )}
      {helpDialogOpen && (
        <SheetCorrectorHelpDialog onClose={() => setHelpDialogOpen(false)} />
      )}
      {levelCorrectionDialogOpen && (
        <LevelCorrectionDialog
          imageUrl={previewImageUrl}
          settings={levelCorrectionSettings}
          onChange={setLevelCorrectionSettings}
          onClose={() => setLevelCorrectionDialogOpen(false)}
        />
      )}
      {calibrationLoupeOpen && selectedItem && selectedImageUrl && (
        <CalibrationLoupeDialog
          key={`${selectedItem.path}:${selectedTemplate.templateId}:${selectedCalibrationKey}`}
          imageUrl={selectedImageUrl}
          template={selectedTemplate}
          points={selectedPoints}
          autoCalibrationRunning={autoCalibrationRunning}
          autoCalibrationMessage={autoCalibrationMessage}
          onAutoDetect={autoDetectSelectedForLoupe}
          onApply={applySelectedWarp}
          onClose={() => setCalibrationLoupeOpen(false)}
          autoDetectLabel="再検出"
          autoDetectOnOpen
          closeOnApply
          commitOnPointChange={false}
        />
      )}
    </main>
  )
}

type SheetCorrectorQueueIconName =
  | 'add'
  | 'export'
  | 'help'
  | 'remove'
  | 'stop'

function SheetCorrectorQueueIcon({ name }: { name: SheetCorrectorQueueIconName }) {
  if (name === 'add') {
    return (
      <svg className="sheetCorrectorQueueIcon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </svg>
    )
  }
  if (name === 'export') {
    return (
      <svg className="sheetCorrectorQueueIcon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v12" />
        <path d="m7 10 5 5 5-5" />
        <path d="M5 15v4h14v-4" />
      </svg>
    )
  }
  if (name === 'stop') {
    return (
      <svg className="sheetCorrectorQueueIcon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 7h10v10H7Z" />
      </svg>
    )
  }
  if (name === 'help') {
    return (
      <svg className="sheetCorrectorQueueIcon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
        <path d="M9.5 9a2.6 2.6 0 0 1 5 1c0 1.7-1.4 2.2-2.2 3.2-.3.3-.3.6-.3 1" />
        <path d="M12 17h.01" />
      </svg>
    )
  }
  if (name === 'remove') {
    return (
      <svg className="sheetCorrectorQueueIcon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 6l12 12" />
        <path d="M18 6 6 18" />
      </svg>
    )
  }
  return (
    <svg className="sheetCorrectorQueueIcon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 7h10v10H7Z" />
    </svg>
  )
}

function SheetCorrectorHelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="sheetCorrectorModalBackdrop" role="dialog" aria-modal="true" aria-label="シートコレクターの使い方">
      <section className="sheetCorrectorHelpDialog">
        <header>
          <div>
            <strong>シートコレクターの使い方</strong>
            <span>バッチ処理とカット毎の確認処理で、触る場所が少し違います。</span>
          </div>
          <button type="button" onClick={onClose}>閉じる</button>
        </header>
        <div className="sheetCorrectorHelpWorkflows">
          <article className="sheetCorrectorHelpWorkflow">
            <h2>バッチ処理したい</h2>
            <p>フォルダ内のシート画像をまとめて拾い、自動補正してPSDを書き出す流れです。</p>
            <ol>
              <li>
                <strong>左の「取込条件」を決める</strong>
                <span>「条件を追加」でファイル名パターンを増やします。条件はフォルダ内画像だけに効きます。</span>
              </li>
              <li>
                <strong>自動で全部処理するなら、フォルダや画像をEXEへドロップ</strong>
                <span>エクスプローラーでカットフォルダや複数画像を「xsheet-corrector.exe」に重ねます。起動後に自動PSD出力が始まります。</span>
              </li>
              <li>
                <strong>画面で確認してから処理するなら、フォルダを画面へドロップ</strong>
                <span>左の「ファイル」に条件一致した画像が入ります。不要な行は右端の × で外します。</span>
              </li>
              <li>
                <strong>左上の「出力」から「全件を出力」</strong>
                <span>未補正の画像は自動検出してからPSD出力します。補正済みの画像はその補正を使います。</span>
              </li>
              <li>
                <strong>「要確認」が出た画像だけ直す</strong>
                <span>左の「ファイル」で画像を選び、右上の「画像補正」を開いて「4点自動検出」または手動調整後に「変形適用」します。</span>
              </li>
            </ol>
          </article>
          <article className="sheetCorrectorHelpWorkflow">
            <h2>カット毎のシートを処理したい</h2>
            <p>数枚ずつ見ながら、補正結果を確認してPSDを書き出す流れです。</p>
            <ol>
              <li>
                <strong>左上の +「キュー追加」または画面へ画像ドロップ</strong>
                <span>画像を直接追加した場合、取込条件は使われません。複数画像をまとめて追加できます。</span>
              </li>
              <li>
                <strong>左の「ファイル」から1枚選ぶ</strong>
                <span>選んだ画像が右のプレビューに出ます。Shiftクリックで範囲選択して、まとめて出力もできます。</span>
              </li>
              <li>
                <strong>右上でテンプレと表示を確認</strong>
                <span>「テンプレ」を選び、「表示」とスライダーで赤い罫線の重なりを見やすくします。必要なら「レベル補正」を切り替えます。</span>
              </li>
              <li>
                <strong>右上の「画像補正」で四隅を合わせる</strong>
                <span>開いた画面で「4点自動検出」を使い、ずれていれば四隅の拡大枠をドラッグします。最後に「変形適用」を押します。</span>
              </li>
              <li>
                <strong>左上の「出力」から「選択を出力」</strong>
                <span>選択中の画像だけPSDにします。全部まとめてよければ「全件を出力」を使います。</span>
              </li>
            </ol>
          </article>
        </div>
        <footer>
          <p>PSDは元画像と同じフォルダへ作られます。同名PSDがある場合は番号付きの別名で保存されます。</p>
        </footer>
      </section>
    </div>
  )
}

function SheetCorrectorImportRulesControl({
  rules,
  tooltipLabel,
  onAdd,
  onReset,
  onToggle,
  onChange,
  onRemove,
}: {
  rules: SheetCorrectorImportRule[]
  tooltipLabel: string
  onAdd: () => void
  onReset: () => void
  onToggle: (id: string, enabled: boolean) => void
  onChange: (id: string, pattern: string) => void
  onRemove: (id: string) => void
}) {
  const activePatterns = activeSheetCorrectorImportPatterns(rules)
  return (
    <section className="sheetCorrectorFolderFilter" aria-label="取込条件">
      <header className="sheetCorrectorFolderFilterHeader">
        <span>取込条件</span>
        <Tooltip label={tooltipLabel}>
          <span className="sheetCorrectorFolderFilterScope">フォルダ</span>
        </Tooltip>
      </header>
      <div className="sheetCorrectorImportRuleList">
        {rules.length === 0 ? (
          <p>フィルターなし</p>
        ) : rules.map((rule, index) => (
          <div className="sheetCorrectorImportRuleRow" key={rule.id}>
            <Tooltip label={rule.enabled ? '条件を無効化' : '条件を有効化'}>
              <label className="sheetCorrectorImportRuleToggle">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  aria-label={`取込条件 ${index + 1}を有効化`}
                  onChange={event => onToggle(rule.id, event.currentTarget.checked)}
                />
              </label>
            </Tooltip>
            <Tooltip label={tooltipLabel}>
              <input
                className="sheetCorrectorFolderFilterInput"
                value={rule.pattern}
                placeholder={DEFAULT_SHEET_IMPORT_RULE_PATTERN}
                aria-label={`取込条件 ${index + 1}`}
                onChange={event => onChange(rule.id, event.currentTarget.value)}
              />
            </Tooltip>
            <Tooltip label="削除">
              <button type="button" className="sheetCorrectorImportRuleRemove" aria-label={`取込条件 ${index + 1}を削除`} onClick={() => onRemove(rule.id)}>
                <SheetCorrectorQueueIcon name="remove" />
              </button>
            </Tooltip>
          </div>
        ))}
      </div>
      <div className="sheetCorrectorImportRuleActions">
        <button type="button" onClick={onAdd}>条件を追加</button>
        <button type="button" onClick={onReset}>初期条件</button>
      </div>
      <div className="sheetCorrectorImportSummary">
        <span>{activePatterns.length === 0 ? 'フィルターなし' : `${activePatterns.length}条件`}</span>
        {activePatterns.slice(0, 2).map((pattern, index) => (
          <span key={`${pattern}:${index}`}>{pattern}</span>
        ))}
        {activePatterns.length > 2 && <span>他 {activePatterns.length - 2}</span>}
      </div>
    </section>
  )
}

function SheetCorrectorProgressDialog({
  state,
  queueRunning,
  onStop,
  onClose,
}: {
  state: SheetCorrectorProgressDialogState
  queueRunning: boolean
  onStop: () => void
  onClose: () => void
}) {
  return (
    <div className="sheetCorrectorModalBackdrop" role="dialog" aria-modal="true" aria-label={state.title}>
      <SheetCorrectorProgressPanel
        state={state}
        queueRunning={queueRunning}
        onStop={onStop}
        stopLabel="停止"
      >
        <button type="button" className="primary" disabled={!state.canClose} onClick={onClose}>
          閉じる
        </button>
      </SheetCorrectorProgressPanel>
    </div>
  )
}

function SheetCorrectorBatchProgress({
  state,
  queueRunning,
  onStop,
  onClose,
  onOpenApp,
}: {
  state: SheetCorrectorProgressDialogState
  queueRunning: boolean
  onStop: () => void
  onClose: () => void
  onOpenApp: () => void
}) {
  const hasAttentionItems = state.review > 0 || state.error > 0
  return (
    <SheetCorrectorProgressPanel
      state={state}
      queueRunning={queueRunning}
      onStop={onStop}
      stopLabel="キャンセル"
    >
      {state.canClose && (
        <button type="button" onClick={onClose}>
          閉じる
        </button>
      )}
      <button type="button" className="primary" disabled={!state.canClose} onClick={onOpenApp}>
        {hasAttentionItems ? 'アプリで確認' : 'アプリで開く'}
      </button>
    </SheetCorrectorProgressPanel>
  )
}

function SheetCorrectorProgressPanel({
  state,
  queueRunning,
  onStop,
  stopLabel,
  children,
}: {
  state: SheetCorrectorProgressDialogState
  queueRunning: boolean
  onStop: () => void
  stopLabel: string
  children: ReactNode
}) {
  const progressPercent = state.total > 0 ? Math.round((state.processed / state.total) * 100) : 0
  return (
    <section className="sheetCorrectorProgressDialog">
      <header>
        <div>
          <strong>{state.title}</strong>
          <span>{state.message}</span>
        </div>
      </header>
      <div className="sheetCorrectorProgressMeter" aria-label="処理進捗">
        <div>
          <span style={{ width: `${progressPercent}%` }} />
        </div>
        <strong>{state.total > 0 ? `${state.processed}/${state.total}` : '-'}</strong>
      </div>
      <dl className="sheetCorrectorProgressStats">
        <div>
          <dt>PSD出力</dt>
          <dd>{state.exported}</dd>
        </div>
        <div>
          <dt>要確認</dt>
          <dd>{state.review}</dd>
        </div>
        <div>
          <dt>エラー</dt>
          <dd>{state.error}</dd>
        </div>
      </dl>
      <footer>
        {queueRunning && (
          <button type="button" onClick={onStop}>{stopLabel}</button>
        )}
        {children}
      </footer>
    </section>
  )
}

function SheetCorrectorItemList({
  items,
  selectedPaths,
  primarySelectedPath,
  queueStates,
  correctionDrafts,
  actionsDisabled,
  emptyText,
  onSelect,
  onExport,
  onRemove,
}: {
  items: SheetCorrectorInput[]
  selectedPaths: string[]
  primarySelectedPath: string | null
  queueStates: Record<string, QueueState>
  correctionDrafts: Record<string, SheetCorrectionDraft>
  actionsDisabled: boolean
  emptyText: string
  onSelect: (path: string, event: MouseEvent<HTMLButtonElement>) => void
  onExport: (path: string) => void
  onRemove: (path: string) => void
}) {
  return (
    <section className="sheetCorrectorList">
      <header>
        <strong>ファイル</strong>
        <span>{items.length}件</span>
      </header>
      {items.length === 0 ? (
        <p className="muted">{emptyText}</p>
      ) : (
        <ol>
          {items.map(item => {
            const exportLabel = correctionDrafts[item.path]?.applied
              ? `PSD出力: ${item.name}`
              : `自動補正してPSD出力: ${item.name}`
            const exportAriaLabel = correctionDrafts[item.path]?.applied
              ? `${item.name}をPSD出力`
              : `${item.name}を自動補正してPSD出力`
            return (
              <li key={item.path}>
                <Tooltip label={`${item.name}を選択`}>
                  <button
                    type="button"
                    className={[
                      'sheetCorrectorQueueSelect',
                      selectedPaths.includes(item.path) ? 'selected' : '',
                      item.path === primarySelectedPath ? 'primary' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={event => onSelect(item.path, event)}
                  >
                    <span>{item.name}</span>
                    <em className={`sheetCorrectorQueueState ${queueStates[item.path] ?? 'idle'}`}>
                      {queueItemStateLabel(queueStates[item.path])}
                    </em>
                  </button>
                </Tooltip>
                <div className="sheetCorrectorQueueItemActions">
                  <Tooltip label={exportLabel}>
                    <button
                      type="button"
                      className="sheetCorrectorQueueItemAction"
                      disabled={actionsDisabled}
                      aria-label={exportAriaLabel}
                      onClick={() => onExport(item.path)}
                    >
                      <SheetCorrectorQueueIcon name="export" />
                    </button>
                  </Tooltip>
                  <Tooltip label={`${item.name}をキューから外す`}>
                    <button
                      type="button"
                      className="sheetCorrectorQueueItemAction"
                      disabled={actionsDisabled}
                      aria-label={`${item.name}をキューから外す`}
                      onClick={() => onRemove(item.path)}
                    >
                      <SheetCorrectorQueueIcon name="remove" />
                    </button>
                  </Tooltip>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

function SheetCorrectorSourcePreview({
  imageUrl,
  viewKey,
  levelCorrection,
  templateImageUrl,
  overlayEnabled,
  overlayOpacity,
}: {
  imageUrl: string | null
  viewKey: string | null
  levelCorrection: LevelCorrectionSettings
  templateImageUrl: string | null
  overlayEnabled: boolean
  overlayOpacity: number
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const previewPanRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    scrollLeft: number
    scrollTop: number
  } | null>(null)
  const [previewZoomState, setPreviewZoomState] = useState<{ viewKey: string | null; zoom: number }>({ viewKey: null, zoom: 1 })
  const [isPreviewPanning, setIsPreviewPanning] = useState(false)
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null)
  const previewZoom = previewZoomState.viewKey === viewKey ? previewZoomState.zoom : 1
  const levelCorrectionFilterId = useLevelCorrectionFilterId('sheetCorrectorLevelCorrection')
  const levelCorrectionFilter = levelCorrectionFilterUrl(levelCorrectionFilterId, levelCorrection)

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return undefined
    const updateSize = () => {
      setViewportSize({
        width: viewport.clientWidth,
        height: viewport.clientHeight,
      })
    }
    updateSize()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize)
      return () => window.removeEventListener('resize', updateSize)
    }
    const observer = new ResizeObserver(updateSize)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  const previewBaseSize = useMemo(() => {
    if (!imageSize || viewportSize.width <= 0 || viewportSize.height <= 0) return null
    const availableWidth = Math.max(1, viewportSize.width - 20)
    const availableHeight = Math.max(1, viewportSize.height - 20)
    const fitScale = Math.min(availableWidth / imageSize.width, availableHeight / imageSize.height)
    const scale = Math.min(1, Math.max(0.02, fitScale))
    return {
      width: imageSize.width * scale,
      height: imageSize.height * scale,
    }
  }, [imageSize, viewportSize.height, viewportSize.width])

  const handlePreviewWheel = useCallback((event: globalThis.WheelEvent) => {
    if (!imageUrl) return
    if (event.cancelable) event.preventDefault()
    event.stopPropagation()
    const viewport = viewportRef.current
    if (!viewport) return
    const rect = viewport.getBoundingClientRect()
    const anchor = {
      x: event.clientX - rect.left + viewport.scrollLeft,
      y: event.clientY - rect.top + viewport.scrollTop,
    }
    const cursor = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
    setPreviewZoomState(currentState => {
      const current = currentState.viewKey === viewKey ? currentState.zoom : 1
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12
      const next = clampPreviewZoom(current * factor)
      if (next === current) return currentState.viewKey === viewKey ? currentState : { viewKey, zoom: current }
      window.requestAnimationFrame(() => {
        const ratio = next / current
        viewport.scrollLeft = anchor.x * ratio - cursor.x
        viewport.scrollTop = anchor.y * ratio - cursor.y
      })
      return { viewKey, zoom: next }
    })
  }, [imageUrl, viewKey])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return undefined
    viewport.addEventListener('wheel', handlePreviewWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', handlePreviewWheel)
  }, [handlePreviewWheel])

  function beginPreviewPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (!imageUrl || event.button !== 0) return
    const viewport = viewportRef.current
    if (!viewport) return
    event.preventDefault()
    previewPanRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsPreviewPanning(true)
  }

  function movePreviewPan(event: ReactPointerEvent<HTMLDivElement>) {
    const pan = previewPanRef.current
    if (!pan || pan.pointerId !== event.pointerId) return
    const viewport = viewportRef.current
    if (!viewport) return
    event.preventDefault()
    viewport.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX)
    viewport.scrollTop = pan.scrollTop - (event.clientY - pan.startY)
  }

  function endPreviewPan(event: ReactPointerEvent<HTMLDivElement>) {
    const pan = previewPanRef.current
    if (!pan || pan.pointerId !== event.pointerId) return
    previewPanRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setIsPreviewPanning(false)
  }

  return (
    <section className="sheetCorrectorPreviewPanel">
      <div
        ref={viewportRef}
        className={[
          'sheetCorrectorImageViewport',
          imageUrl ? 'panEnabled' : '',
          isPreviewPanning ? 'panning' : '',
        ].filter(Boolean).join(' ')}
        onDoubleClick={() => setPreviewZoomState({ viewKey, zoom: 1 })}
        onPointerDown={beginPreviewPan}
        onPointerMove={movePreviewPan}
        onPointerUp={endPreviewPan}
        onPointerCancel={endPreviewPan}
      >
        {imageUrl ? (
          <div
            className="sheetCorrectorPreviewStack"
            style={previewBaseSize ? {
              width: `${previewBaseSize.width * previewZoom}px`,
              height: `${previewBaseSize.height * previewZoom}px`,
            } : undefined}
          >
            {levelCorrectionFilter && (
              <svg className="levelCorrectionFilterSvg" aria-hidden="true">
                <defs>
                  <LevelCorrectionFilterDefinition id={levelCorrectionFilterId} settings={levelCorrection} />
                </defs>
              </svg>
            )}
            <img
              className="sheetCorrectorPreviewImage"
              src={imageUrl}
              alt=""
              draggable={false}
              style={levelCorrectionFilter ? { filter: levelCorrectionFilter } : undefined}
              onLoad={event => {
                const image = event.currentTarget
                const width = image.naturalWidth || image.width
                const height = image.naturalHeight || image.height
                if (width > 0 && height > 0) setImageSize({ width, height })
              }}
            />
            {overlayEnabled && templateImageUrl && (
              <svg
                className="sheetCorrectorTemplateOverlay"
                viewBox="0 0 1 1"
                preserveAspectRatio="none"
                style={{ opacity: overlayOpacity }}
                aria-hidden="true"
              >
                <defs>
                  <filter id="sheetCorrectorTemplateTint" colorInterpolationFilters="sRGB">
                    <feColorMatrix
                      in="SourceGraphic"
                      result="darknessMask"
                      type="matrix"
                      values="
                        0 0 0 0 0
                        0 0 0 0 0
                        0 0 0 0 0
                        -0.2126 -0.7152 -0.0722 0 1
                      "
                    />
                    <feComposite in="darknessMask" in2="SourceAlpha" operator="in" result="visibleDarkness" />
                    <feFlood floodColor="#ff1f12" result="overlayColor" />
                    <feComposite in="overlayColor" in2="visibleDarkness" operator="in" />
                  </filter>
                </defs>
                <image
                  href={templateImageUrl}
                  x="0"
                  y="0"
                  width="1"
                  height="1"
                  preserveAspectRatio="none"
                  filter="url(#sheetCorrectorTemplateTint)"
                />
              </svg>
            )}
          </div>
        ) : (
          <div className="sheetCorrectorPreviewPlaceholder">
            <strong>フォルダまたはシート画像をドロップ</strong>
            <span>フォルダは候補を確認してからキューに追加します。</span>
          </div>
        )}
      </div>
    </section>
  )
}

function clampPreviewZoom(value: number): number {
  return Math.min(SHEET_CORRECTOR_PREVIEW_MAX_ZOOM, Math.max(SHEET_CORRECTOR_PREVIEW_MIN_ZOOM, value))
}

function draftForTemplate(draft: SheetCorrectionDraft | undefined, templateId: string): SheetCorrectionDraft | undefined {
  return draft?.templateId === templateId ? draft : undefined
}

function filterDraftsForTemplate(drafts: Record<string, SheetCorrectionDraft>, templateId: string): Record<string, SheetCorrectionDraft> {
  return Object.fromEntries(Object.entries(drafts).filter(([, draft]) => draft.templateId === templateId))
}

function correctionStateLabel(draft: SheetCorrectionDraft | undefined): string {
  if (draft?.applied) return '補正済み'
  if (draft) return '調整中'
  return '未補正'
}

function queueItemStateLabel(state: QueueState | undefined): string {
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

function fileToBrowserInput(file: File): SheetCorrectorInput {
  return {
    path: browserFilePath(file),
    name: file.name,
    extension: extensionOf(file.name),
    size: file.size,
    matched: true,
    sourceKind: 'browser-file',
  }
}

function browserFilePath(file: File): string {
  const fileWithRelativePath = file as File & { webkitRelativePath?: string }
  return fileWithRelativePath.webkitRelativePath || file.name
}

function imageUrlForItem(
  item: SheetCorrectorInput,
  browserFileUrls: Record<string, string>,
  nativeFileUrls: Record<string, string>,
  overrides?: Record<string, string>,
): string | null {
  return browserFileUrls[item.path] ?? overrides?.[item.path] ?? nativeFileUrls[item.path] ?? null
}

async function createNativeSheetImageDataUrl(item: SheetCorrectorInput): Promise<string | null> {
  if (item.sourceKind === 'browser-file') return null
  const { invoke } = await import('@tauri-apps/api/core')
  return await invoke<string>('sheet_corrector_image_data_url', {
    sourcePath: item.path,
  })
}

async function correctedPngDataUrl(
  imageUrl: string,
  points: SheetCalibrationPointPair[],
  levelCorrection: LevelCorrectionSettings,
  template: SheetTemplate,
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
    },
    template,
    template.page.widthPx,
  )
  if (!pngDataUrl || !levelCorrection.enabled) return pngDataUrl
  return applyLevelCorrectionToDataUrl(pngDataUrl, levelCorrection)
}

async function correctedPsdBase64(
  sourceName: string,
  imageUrl: string,
  templateImageUrl: string | null,
  points: SheetCalibrationPointPair[],
  levelCorrection: LevelCorrectionSettings,
  template: SheetTemplate,
): Promise<string | null> {
  const correctedImageData = await correctedSheetImageData(imageUrl, points, levelCorrection, template)
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

function correctedOutputName(name: string, extension: 'png' | 'psd'): string {
  const extensionMatch = /\.[^.]+$/.exec(name)
  const stem = extensionMatch ? name.slice(0, -extensionMatch[0].length) : name
  return extension === 'psd' ? `${stem}.psd` : `${stem}_corrected.png`
}

function downloadDataUrl(dataUrl: string, fileName: string) {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
}

function downloadBytes(bytes: Uint8Array, fileName: string, mimeType: string) {
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

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function templateOverlayImageUrl(template: SheetTemplate): string | null {
  const underlay = template.defaultUnderlay
  if (!underlay) return null
  return resolveImageRefUrl({ ...underlay.imageRef, assetPath: underlay.assetPath })
}

function emptySheetCorrectorProgressState(title: string, message: string): SheetCorrectorProgressDialogState {
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

async function configureSheetCorrectorBatchWindow(): Promise<void> {
  try {
    const { getCurrentWindow, LogicalSize } = await import('@tauri-apps/api/window')
    const currentWindow = getCurrentWindow()
    await currentWindow.setMinSize(new LogicalSize(SHEET_CORRECTOR_BATCH_WINDOW.minWidth, SHEET_CORRECTOR_BATCH_WINDOW.minHeight))
    await currentWindow.setSize(new LogicalSize(SHEET_CORRECTOR_BATCH_WINDOW.width, SHEET_CORRECTOR_BATCH_WINDOW.height))
    await currentWindow.center()
    await currentWindow.show()
  } catch {
    // Browser preview and non-desktop hosts do not expose native windows.
  }
}

async function restoreSheetCorrectorMainWindow(): Promise<void> {
  try {
    const { getCurrentWindow, LogicalSize, PhysicalPosition, PhysicalSize } = await import('@tauri-apps/api/window')
    const currentWindow = getCurrentWindow()
    const saved = loadSheetCorrectorWindowState()
    await currentWindow.setMinSize(new LogicalSize(SHEET_CORRECTOR_MAIN_WINDOW.minWidth, SHEET_CORRECTOR_MAIN_WINDOW.minHeight))
    if (saved) {
      await currentWindow.setSize(new PhysicalSize(saved.width, saved.height))
      if (typeof saved.x === 'number' && typeof saved.y === 'number') {
        await currentWindow.setPosition(new PhysicalPosition(saved.x, saved.y))
      }
    } else {
      await currentWindow.setSize(new LogicalSize(SHEET_CORRECTOR_MAIN_WINDOW.width, SHEET_CORRECTOR_MAIN_WINDOW.height))
      await currentWindow.center()
    }
    await currentWindow.show()
  } catch {
    // Rust setup still shows the normal startup window; browser preview has no native window.
  }
}

async function saveCurrentSheetCorrectorWindowState(): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const currentWindow = getCurrentWindow()
    const [size, position] = await Promise.all([
      currentWindow.innerSize(),
      currentWindow.outerPosition(),
    ])
    const state: SheetCorrectorSavedWindowState = {
      width: Math.round(size.width),
      height: Math.round(size.height),
      x: Math.round(position.x),
      y: Math.round(position.y),
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

function loadStoredSheetImportRules(): SheetCorrectorImportRule[] {
  if (typeof window === 'undefined') return defaultSheetCorrectorImportRules()
  try {
    const stored = window.localStorage.getItem(SHEET_CORRECTOR_IMPORT_RULES_STORAGE_KEY)
    const legacyStored = window.localStorage.getItem(LEGACY_SHEET_CORRECTOR_PATTERN_STORAGE_KEY)
    return parseStoredSheetCorrectorImportRules(stored, legacyStored)
  } catch {
    return defaultSheetCorrectorImportRules()
  }
}

function saveStoredSheetImportRules(rules: SheetCorrectorImportRule[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SHEET_CORRECTOR_IMPORT_RULES_STORAGE_KEY, JSON.stringify(rules))
  } catch {
    // Local storage is only a convenience for the next drop operation.
  }
}

function objectUrlsForFiles(files: File[]): Record<string, string> {
  return Object.fromEntries(files.map(file => [browserFilePath(file), URL.createObjectURL(file)]))
}

function replaceBrowserFileUrls(
  nextUrls: Record<string, string>,
  urlsRef: { current: Record<string, string> },
  setUrls: (urls: Record<string, string>) => void,
) {
  revokeBrowserFileUrls(urlsRef.current)
  urlsRef.current = nextUrls
  setUrls(nextUrls)
}

function revokeBrowserFileUrls(urls: Record<string, string>) {
  for (const url of Object.values(urls)) URL.revokeObjectURL(url)
}

function isSupportedSheetImageFile(file: File): boolean {
  return supportedImageExtensions.has(extensionOf(file.name))
}

function extensionOf(name: string): string {
  const match = /\.([^.]+)$/.exec(name)
  return match ? match[1].toLowerCase() : ''
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function dedupeFiles(files: File[]): File[] {
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

function dedupeSheetCorrectorInputs(inputs: SheetCorrectorInput[]): SheetCorrectorInput[] {
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

function omitRecordKeys<T>(record: Record<string, T>, keys: Set<string>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.has(key)))
}

function compareSheetCorrectorInputs(a: SheetCorrectorInput, b: SheetCorrectorInput): number {
  return compareFileNameLikeText(a.name, b.name) || compareFileNameLikeText(a.path, b.path)
}
