import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import { sheetTemplatePresetsForImageCorrection, standardA3SheetTemplate, type SheetCalibrationPointPair } from '@xsheet-remap/core'
import { APP_VERSION } from './appVersion'
import { collectAssetFilesFromDrop, hasFileTransferPayload } from './assetFiles'
import { compareFileNameLikeText } from './naturalSort'
import { detectSheetCalibrationPoints, type AutoCalibrationResult } from './sheetAutoCalibration'
import { detectSheetPrecisionWarp } from './sheetPrecisionCorrection'
import { evaluateSheetCalibrationDiagnostic, type SheetCalibrationDiagnostic } from './sheetCalibrationDiagnostics'
import { CalibrationLoupeDialog } from './sheetCalibrationLoupe'
import { calibrationPointsSignature } from './sheetCalibrationUtils'
import { defaultCalibrationPoints, defaultSheetImageSettings, getLastSheetWarpBackend, useWarpedSheetImageUrl } from './sheetImages'
import { Tooltip, TooltipTarget } from './Tooltip'
import { closeCurrentNativeWindow, invokeDesktopCommand, isTauriHost, nativeFileSource, subscribeNativeDragDrop, watchCurrentNativeWindowBounds } from '@xsheet-remap/adapters'
import { LevelCorrectionDialog } from './LevelCorrectionDialog'
import { defaultLevelCorrectionSettings, normalizeLevelCorrectionSettings, type LevelCorrectionSettings } from './levelCorrection'
import { defaultSheetCorrectorImportRules, matchSheetCorrectorImportCandidates, sheetCorrectorImportRule, sheetCorrectorImportRuleSummary } from './sheetCorrectorImportRules'
import { SHEET_CORRECTOR_EXTERNAL_TEMPLATE_VALUE, SHEET_CORRECTOR_LOAD_TEMPLATE_VALUE, loadSheetCorrectorTemplateFile, loadStoredSheetCorrectorTemplatePath, saveStoredSheetCorrectorTemplatePath, sheetCorrectorExternalTemplateLabel, type SheetCorrectorExternalTemplate, type SheetCorrectorTemplateFile } from './sheetCorrectorTemplates'
import { base64ToBytes, browserFilePath, compareSheetCorrectorInputs, configureSheetCorrectorBatchWindow, correctedOutputName, correctedPngDataUrl, correctedPsdBase64, correctionStateLabel, createNativeSheetImageDataUrl, dedupeFiles, dedupeSheetCorrectorInputs, dedupeStrings, downloadBytes, downloadDataUrl, draftForTemplate, emptySheetCorrectorProgressState, fileToBrowserInput, filterDraftsForTemplate, imageUrlForItem, isSupportedSheetImageFile, loadStoredSheetImportRules, objectUrlsForFiles, omitRecordKeys, openNativeSheetCorrectorTemplateFile, queueItemStateLabel, readNativeSheetCorrectorTemplatePath, replaceBrowserFileUrls, restoreSheetCorrectorMainWindow, revokeBrowserFileUrls, saveCurrentSheetCorrectorWindowState, saveStoredSheetImportRules, sheetCorrectorErrorMessage, templateOverlayImageUrl } from './sheet-corrector-model'
import { SheetCorrectorBatchProgress, SheetCorrectorHelpDialog, SheetCorrectorImportRulesControl, SheetCorrectorItemList, SheetCorrectorProgressDialog, SheetCorrectorQueueIcon, SheetCorrectorSourcePreview } from './sheet-corrector-components'
import type { SheetPrecisionWarp } from './appTypes'
import type { QueueState, SheetCorrectionDraft, SheetCorrectorInput, SheetCorrectorProgressDialogState } from './sheet-corrector-types'

type SheetCorrectorInputCollection = {
  inputs: SheetCorrectorInput[]
  hasDirectory: boolean
}

type SheetCorrectorExportFormat = 'psd' | 'png'

type QueueProcessOptions = {
  showProgressDialog?: boolean
  progressTitle?: string
  imageUrlOverrides?: Record<string, string>
  createImageUrl?: (item: SheetCorrectorInput) => Promise<string | null>
}

type NativeCollectMode = 'enqueue' | 'auto-export'

type NativeCollectSource = 'window-drop' | 'launch'

type SheetCorrectorViewMode = 'pending' | 'main' | 'batch'

type SheetPrecisionComparisonDiagnostic = {
  path: string
  name: string
  calibration: {
    confidence: number
    detectedLineCount: number
    method: AutoCalibrationResult['debugOverlay']['method']
  } | null
  precisionDiagnostics: SheetPrecisionWarp['diagnostics'] | null
  warpBackend: {
    basic: ReturnType<typeof getLastSheetWarpBackend> | null
    precision: ReturnType<typeof getLastSheetWarpBackend> | null
    basicMs: number | null
    precisionMs: number | null
  }
  basicPngDataUrl: string | null
  precisionPngDataUrl: string | null
}

declare global {
  interface Window {
    __xsheetCorrectorDiagnostics?: {
      evaluateCalibrationFile: (path: string) => Promise<SheetCalibrationDiagnostic>
      evaluatePrecisionComparisonFile: (path: string) => Promise<SheetPrecisionComparisonDiagnostic>
    }
  }
}

const SHEET_PATTERN_TOOLTIP = '* は任意の文字列、? は任意の1文字。直接指定した画像は条件に関係なく追加し、条件はフォルダ内画像だけに使います。'

const SHEET_TEMPLATE_TOOLTIP = 'タイムシートテンプレートを選択します。'

const SHEET_TEMPLATE_OVERLAY_TOOLTIP = 'テンプレート罫線を赤色で薄く重ねて表示します。'

const SHEET_CORRECTOR_TEMPLATE_PRESETS = sheetTemplatePresetsForImageCorrection()

const DEFAULT_SHEET_CORRECTOR_TEMPLATE = SHEET_CORRECTOR_TEMPLATE_PRESETS[0]?.sheetTemplate ?? standardA3SheetTemplate

export function SheetCorrectorApp() {
  const [viewMode, setViewMode] = useState<SheetCorrectorViewMode>(() => isTauriHost() ? 'pending' : 'main')
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
  const [externalTemplate, setExternalTemplate] = useState<SheetCorrectorExternalTemplate | null>(null)
  const [templateRestoreReady, setTemplateRestoreReady] = useState(() => !isTauriHost() || !loadStoredSheetCorrectorTemplatePath())
  const [templateOverlayEnabled, setTemplateOverlayEnabled] = useState(true)
  const [templateOverlayOpacity, setTemplateOverlayOpacity] = useState(80)
  const didLoadLaunchPaths = useRef(false)
  const stopQueueRequestedRef = useRef(false)
  const nextImportRuleIdRef = useRef(0)
  const browserFileUrlsRef = useRef<Record<string, string>>({})
  const browserFileInputRef = useRef<HTMLInputElement | null>(null)
  const correctionMenuRef = useRef<HTMLDetailsElement | null>(null)
  const jobMenuRef = useRef<HTMLDetailsElement | null>(null)

  const selectedTemplate = useMemo(() => {
    if (selectedTemplateId === SHEET_CORRECTOR_EXTERNAL_TEMPLATE_VALUE && externalTemplate) {
      return externalTemplate.template
    }
    return SHEET_CORRECTOR_TEMPLATE_PRESETS.find(preset => preset.sheetTemplate.templateId === selectedTemplateId)?.sheetTemplate ?? DEFAULT_SHEET_CORRECTOR_TEMPLATE
  }, [externalTemplate, selectedTemplateId])
  const selectedTemplateSelectValue = selectedTemplateId === SHEET_CORRECTOR_EXTERNAL_TEMPLATE_VALUE && externalTemplate
    ? SHEET_CORRECTOR_EXTERNAL_TEMPLATE_VALUE
    : selectedTemplate.templateId
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
    precisionWarp: selectedDraft?.precisionWarp,
  }), [selectedDraft?.applied, selectedDraft?.precisionWarp, selectedPoints])
  const warpedPreviewUrl = useWarpedSheetImageUrl(selectedImageUrl, selectedImageSettings, selectedTemplate, 'preview')
  const previewImageUrl = selectedDraft?.applied ? (warpedPreviewUrl ?? selectedImageUrl) : selectedImageUrl
  const selectedPrecisionKey = selectedDraft?.precisionWarp ? JSON.stringify(selectedDraft.precisionWarp) : 'basic'
  const previewViewKey = selectedItem ? `${selectedItem.path}:${selectedTemplate.templateId}:${selectedDraft?.applied ? `${selectedCalibrationKey}:${selectedPrecisionKey}` : 'raw'}` : null
  const templateImageUrl = useMemo(() => templateOverlayImageUrl(selectedTemplate), [selectedTemplate])
  const revokeBrowserPreviewUrls = useCallback(() => {
    const urls = browserFileUrlsRef.current
    browserFileUrlsRef.current = {}
    revokeBrowserFileUrls(urls)
  }, [])

  const applyExternalTemplateFile = useCallback((file: SheetCorrectorTemplateFile, restored = false): boolean => {
    try {
      const loaded = loadSheetCorrectorTemplateFile(file)
      setExternalTemplate(loaded)
      setSelectedTemplateId(SHEET_CORRECTOR_EXTERNAL_TEMPLATE_VALUE)
      saveStoredSheetCorrectorTemplatePath(loaded.path)
      setStatus(`テンプレ「${sheetCorrectorExternalTemplateLabel(loaded.template, loaded.path)}」を${restored ? '復元' : '読み込み'}ました。`)
      return true
    } catch (error) {
      if (!restored) setStatus(`テンプレJSONを読み込めません: ${sheetCorrectorErrorMessage(error)}`)
      return false
    }
  }, [])

  useEffect(() => revokeBrowserPreviewUrls, [revokeBrowserPreviewUrls])

  useEffect(() => {
    if (!isTauriHost()) return undefined
    const templatePath = loadStoredSheetCorrectorTemplatePath()
    if (!templatePath) return undefined
    let disposed = false
    void readNativeSheetCorrectorTemplatePath(templatePath)
      .then(file => {
        if (disposed) return
        if (!applyExternalTemplateFile(file, true)) {
          saveStoredSheetCorrectorTemplatePath(undefined)
          setSelectedTemplateId(DEFAULT_SHEET_CORRECTOR_TEMPLATE.templateId)
        }
      })
      .catch(error => {
        if (disposed) return
        saveStoredSheetCorrectorTemplatePath(undefined)
        setSelectedTemplateId(DEFAULT_SHEET_CORRECTOR_TEMPLATE.templateId)
        setStatus(`前回のテンプレを読み込めません。A3標準に戻しました: ${sheetCorrectorErrorMessage(error)}`)
      })
      .finally(() => {
        if (!disposed) setTemplateRestoreReady(true)
      })
    return () => {
      disposed = true
    }
  }, [applyExternalTemplateFile])

  useEffect(() => {
    let disposed = false
    window.__xsheetCorrectorDiagnostics = {
      evaluateCalibrationFile: async (path: string) => {
        const normalizedPath = path.replace(/\\/g, '/')
        const name = normalizedPath.split('/').pop() || path
        if (disposed) throw new Error('sheet corrector diagnostics disposed')
        return evaluateSheetCalibrationDiagnostic(
          {
            path,
            name,
            imageUrl: await nativeFileSource(path),
          },
          standardA3SheetTemplate,
        )
      },
      evaluatePrecisionComparisonFile: async (path: string) => {
        const normalizedPath = path.replace(/\\/g, '/')
        const name = normalizedPath.split('/').pop() || path
        if (disposed) throw new Error('sheet corrector diagnostics disposed')
        const imageUrl = await nativeFileSource(path)
        const calibration = await detectSheetCalibrationPoints(imageUrl, standardA3SheetTemplate)
        if (!calibration) {
          return {
            path,
            name,
            calibration: null,
            precisionDiagnostics: null,
            warpBackend: { basic: null, precision: null, basicMs: null, precisionMs: null },
            basicPngDataUrl: null,
            precisionPngDataUrl: null,
          }
        }
        const levels = defaultLevelCorrectionSettings()
        const basicStartedAt = performance.now()
        const basicPngDataUrl = await correctedPngDataUrl(
          imageUrl,
          calibration.points,
          levels,
          standardA3SheetTemplate,
        )
        const basicMs = performance.now() - basicStartedAt
        const basicBackend = getLastSheetWarpBackend()
        const precisionWarp = await detectSheetPrecisionWarp(imageUrl, calibration.points, standardA3SheetTemplate)
        const precisionStartedAt = performance.now()
        const precisionPngDataUrl = precisionWarp
          ? await correctedPngDataUrl(
              imageUrl,
              calibration.points,
              levels,
              standardA3SheetTemplate,
              precisionWarp,
            )
          : null
        const precisionMs = precisionWarp ? performance.now() - precisionStartedAt : null
        const precisionBackend = precisionWarp ? getLastSheetWarpBackend() : null
        return {
          path,
          name,
          calibration: {
            confidence: calibration.confidence,
            detectedLineCount: calibration.detectedLineCount,
            method: calibration.debugOverlay.method,
          },
          precisionDiagnostics: precisionWarp?.diagnostics ?? null,
          warpBackend: {
            basic: basicBackend,
            precision: precisionBackend,
            basicMs,
            precisionMs,
          },
          basicPngDataUrl,
          precisionPngDataUrl,
        }
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
    let unlistenWindowBounds: (() => void) | undefined

    function scheduleSave() {
      if (disposed) return
      if (saveTimer) window.clearTimeout(saveTimer)
      saveTimer = window.setTimeout(() => {
        void saveCurrentSheetCorrectorWindowState()
      }, 300)
    }

    void watchCurrentNativeWindowBounds(scheduleSave)
      .then(unlisten => {
        if (disposed) {
          unlisten()
          return
        }
        scheduleSave()
        unlistenWindowBounds = unlisten
      })
      .catch(() => {
        // Window state persistence is a convenience for desktop runs.
      })

    return () => {
      disposed = true
      if (saveTimer) window.clearTimeout(saveTimer)
      unlistenWindowBounds?.()
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
      const selectedItems = await invokeDesktopCommand<SheetCorrectorInput[]>('open_sheet_corrector_inputs')
      if (selectedItems.length === 0) return
      await enqueueNativeItems(selectedItems, '直接追加')
    } catch (error) {
      setStatus(`画像選択に失敗: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function handleTemplateLoadClick() {
    if (!isTauriHost()) {
      setStatus('テンプレJSONの読み込みはデスクトップ版で使えます。')
      return
    }
    try {
      const file = await openNativeSheetCorrectorTemplateFile()
      if (!file) return
      applyExternalTemplateFile(file)
    } catch (error) {
      setStatus(`テンプレJSONを読み込めません: ${sheetCorrectorErrorMessage(error)}`)
    }
  }

  function handleTemplateSelectChange(value: string) {
    if (value === SHEET_CORRECTOR_LOAD_TEMPLATE_VALUE) {
      void handleTemplateLoadClick()
      return
    }
    setSelectedTemplateId(value)
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

  const updateDraftForPath = useCallback((
    path: string,
    points: SheetCalibrationPointPair[],
    applied: boolean,
    precisionWarp?: SheetPrecisionWarp,
    precisionEvaluated = Boolean(precisionWarp),
  ) => {
    setCorrectionDrafts(current => ({
      ...current,
      [path]: { templateId: selectedTemplate.templateId, points, applied, precisionWarp, precisionEvaluated },
    }))
  }, [selectedTemplate.templateId])

  function applySelectedWarp(pointsOverride?: SheetCalibrationPointPair[]) {
    if (!selectedItem) return
    updateDraftForPath(selectedItem.path, pointsOverride ?? selectedPoints, true)
    setQueueStates(current => ({ ...current, [selectedItem.path]: 'corrected' }))
    setAutoCalibrationMessage('通常補正を適用しました。テンプレート適応補正を確認しています。')
  }

  async function analyzeSelectedPrecisionWarp(points: SheetCalibrationPointPair[]): Promise<SheetPrecisionWarp | null> {
    if (!selectedItem || !selectedImageUrl) return null
    return await detectSheetPrecisionWarp(selectedImageUrl, points, selectedTemplate)
  }

  function applySelectedPrecisionWarp(points: SheetCalibrationPointPair[], precisionWarp: SheetPrecisionWarp) {
    if (!selectedItem) return
    updateDraftForPath(selectedItem.path, points, true, precisionWarp)
    setQueueStates(current => ({ ...current, [selectedItem.path]: 'corrected' }))
    setAutoCalibrationMessage(`テンプレート適応補正を適用しました。対応点 ${precisionWarp.diagnostics.inlierCount}点 / 最大補正 ${precisionWarp.diagnostics.maxDisplacementPx.toFixed(1)}px`)
  }

  function markSelectedPrecisionEvaluated(points: SheetCalibrationPointPair[]) {
    if (!selectedItem) return
    updateDraftForPath(selectedItem.path, points, true, undefined, true)
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
    precisionWarp?: SheetPrecisionWarp,
  ): Promise<string | null> => {
    const pngDataUrl = await correctedPngDataUrl(imageUrl, points, levelCorrectionSettings, selectedTemplate, precisionWarp)
    if (!pngDataUrl) return null
    if (item.sourceKind === 'browser-file') {
      downloadDataUrl(pngDataUrl, correctedOutputName(item.name, 'png'))
      return correctedOutputName(item.name, 'png')
    }
    return await invokeDesktopCommand<string>('export_sheet_corrector_png', {
      sourcePath: item.path,
      pngDataUrl,
    })
  }, [levelCorrectionSettings, selectedTemplate])

  const exportCorrectedItem = useCallback(async (
    item: SheetCorrectorInput,
    format: SheetCorrectorExportFormat,
    pointsOverride?: SheetCalibrationPointPair[],
    precisionWarpOverride?: SheetPrecisionWarp,
    detectIfMissing = true,
    imageUrlOverrides?: Record<string, string>,
  ): Promise<string | null> => {
    const imageUrl = imageUrlForItem(item, browserFileUrls, nativeFileUrls, imageUrlOverrides)
      ?? await createNativeSheetImageDataUrl(item)
    if (!imageUrl) return null
    const currentDraft = draftForTemplate(correctionDrafts[item.path], selectedTemplate.templateId)
    let points = pointsOverride ?? (currentDraft?.applied ? currentDraft.points : undefined)
    let precisionWarp = precisionWarpOverride ?? (currentDraft?.applied ? currentDraft.precisionWarp : undefined)
    if (!points && detectIfMissing) {
      points = await detectCalibrationForItem(item, imageUrlOverrides) ?? undefined
      if (!points) return null
      updateDraftForPath(item.path, points, true)
      precisionWarp = undefined
    }
    if (!points) return null
    if (!precisionWarp && !currentDraft?.precisionEvaluated) {
      precisionWarp = await detectSheetPrecisionWarp(imageUrl, points, selectedTemplate) ?? undefined
      updateDraftForPath(item.path, points, true, precisionWarp, true)
    }
    if (format === 'png') return exportCorrectedPngItem(item, imageUrl, points, precisionWarp)
    const psdBase64 = await correctedPsdBase64(item.name, imageUrl, templateImageUrl, points, levelCorrectionSettings, selectedTemplate, precisionWarp)
    if (!psdBase64) return null
    if (item.sourceKind === 'browser-file') {
      downloadBytes(base64ToBytes(psdBase64), correctedOutputName(item.name, 'psd'), 'image/vnd.adobe.photoshop')
      return correctedOutputName(item.name, 'psd')
    }
    return await invokeDesktopCommand<string>('export_sheet_corrector_psd', {
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
          let precisionWarp: SheetPrecisionWarp | undefined
          if (existingDraft?.applied) {
            points = existingDraft.points
            precisionWarp = existingDraft.precisionWarp
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
          const outputPath = await exportCorrectedItem(item, 'psd', points, precisionWarp, false, imageUrlOverrides)
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
    void invokeDesktopCommand('quit_sheet_corrector')
      .catch(() => closeCurrentNativeWindow())
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
      const collection = await invokeDesktopCommand<SheetCorrectorInputCollection>('collect_sheet_corrector_inputs', {
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
    if (!templateRestoreReady) return undefined
    if (didLoadLaunchPaths.current) return
    didLoadLaunchPaths.current = true
    if (!isTauriHost()) return undefined
    let cancelled = false
    void invokeDesktopCommand<string[]>('sheet_corrector_launch_paths')
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
  }, [collectNativePaths, templateRestoreReady])

  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | undefined
    void subscribeNativeDragDrop(payload => {
        if (cancelled) return
        if (payload.type === 'enter' || payload.type === 'over') {
          setIsDragOver(true)
          return
        }
        if (payload.type === 'leave') {
          setIsDragOver(false)
          return
        }
        setIsDragOver(false)
        if (payload.paths && payload.paths.length > 0) void collectNativePaths(payload.paths, 'enqueue', 'window-drop')
      })
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
                    value={selectedTemplateSelectValue}
                    onChange={event => {
                      const value = event.currentTarget.value
                      if (value === SHEET_CORRECTOR_LOAD_TEMPLATE_VALUE) {
                        event.currentTarget.value = selectedTemplateSelectValue
                      }
                      handleTemplateSelectChange(value)
                    }}
                  >
                    {SHEET_CORRECTOR_TEMPLATE_PRESETS.map(preset => (
                      <option key={preset.sheetTemplate.templateId} value={preset.sheetTemplate.templateId}>
                        {preset.name || preset.sheetTemplate.name}
                      </option>
                    ))}
                    {externalTemplate ? <option value="__separator-external-template" disabled>────────</option> : null}
                    {externalTemplate ? (
                      <option value={SHEET_CORRECTOR_EXTERNAL_TEMPLATE_VALUE}>
                        {sheetCorrectorExternalTemplateLabel(externalTemplate.template, externalTemplate.path)}
                      </option>
                    ) : null}
                    <option value="__separator-load-template" disabled>────────</option>
                    <option value={SHEET_CORRECTOR_LOAD_TEMPLATE_VALUE}>テンプレJSONを読み込み...</option>
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
          autoDetectOnOpen={!selectedDraft?.applied}
          commitOnPointChange={false}
          precisionCorrection={{
            basicApplied: Boolean(selectedDraft?.applied),
            appliedWarp: selectedDraft?.precisionWarp,
            onAnalyze: analyzeSelectedPrecisionWarp,
            onApply: applySelectedPrecisionWarp,
            onEvaluated: markSelectedPrecisionEvaluated,
            closeOnApply: true,
          }}
        />
      )}
    </main>
  )
}
