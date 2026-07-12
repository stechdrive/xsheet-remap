import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addAnnotation, addBlankSharedCutToProjectDocument, addOverlayPaperTrack, assignSheetSourceToPage, applyNameNormalizationPlan, activeCutProjectFromDocument, buildCspImportPackage, buildExportPlan, clearEvent, clearAnnotations, clearAnnotationsForPage, commitHistory, createKey, createStackGuideLabel, createSheetPages, createDefaultProject, createProjectDocumentFromCutProject, createDefaultSheetViewState, createRecognizedEvent, createProjectHistory, defaultCorrectionLayerId, DEFAULT_EXPORT_TIMING_ROLE, DEFAULT_PRE_ROLL_FRAMES, deleteOverlayPaperTrack, deleteStackGuideLabel, eraseAnnotations, findTimingKeyByDisplayLabel, type CorrectionLayer, type CutProject, type AnnotationPoint, type AnnotationStroke, type AnnotationText, type ExportProfile, type FileRef, type NameNormalizationPlan, type SheetHit, type SheetImageAlignment, type SheetCalibrationPointPair, type SheetPage, type SheetTemplate, type SheetTimingRole, type SheetViewMode, type RecognitionCandidate, type StackGuideLabel, getSheetTemplatePaperTracks, redoHistory, registerAssetsToCspTrack, resolveSheetTemplatePageSize, setEvent, sheetTimingRoleForEvent, sheetTemplatePresets, timingHitForFrame, undoHistory, updateKey, updateCorrectionLayers, updatePaperTrack, updateLogicalSheetSettings, updateProjectPaperTracks, updateStackGuideLabel, updateSheetPageViewState, updateSheetViewState, upsertBinding, assignAssetToStackGuideLabel, updateStackGuideRegistration, hasBlockingIssues, validateProject, standardA3SheetTemplate, registerAsset, registerAssetRoot, registerSheetSource, NULL_CELL_DISPLAY_LABEL, NULL_CELL_KEY_ID, type CutAsset, type TimingKey, hitTestSheetTemplate, isNullCellKeyId, isNullLabel, logicalSheetDisplayDurationFrames, logicalSheetDisplayFrameEnd, logicalSheetDisplayFrameStart, parseProjectDocument, moveBindingToCorrectionLayer, updateActiveCutProjectInDocument, switchActiveCutInProjectDocument, type AssetRoot } from '@xsheet-remap/core'
import { exportXdts } from '@xsheet-remap/xdts'
import { collectAssetPathDrop, confirmUserAction, fileToFileRef, isTauriHost, openImageFileRefs, readJsonFile, renameMaterialFiles, saveJsonFile, statNativePaths, writeCspImportPackage, writeTextFile, type AssetRootCandidate } from '@xsheet-remap/adapters'
import { APP_VERSION } from './appVersion'
import { issueMessage, uiText, viewModeLabels } from './i18n'
import { type EditMode, type Panel, type Selection, type SheetRangeSelection, type TimingClipboard } from './appTypes'
import { defaultSheetImageExportOptions, renderSheetImageExports, type SheetImageExportFormat, type SheetImageExportOptions } from './cleanSheetExport'
import { cspImportPackageTextOutputs } from './cspImportPackageOutputs'
import { projectFileName, sheetXdtsFileName } from './outputFileNames'
import { type DropDiagnosticReport } from './AssetBrowser'
import { LevelCorrectionDialog } from './LevelCorrectionDialog'
import { defaultLevelCorrectionSettings, normalizeLevelCorrectionSettings, type LevelCorrectionSettings } from './levelCorrection'
import { compareAssetNames, compareFileNames, isImageAssetFile, sheetImageRefFromAsset } from './assetFiles'
import { compareFileNameLikeText } from './naturalSort'
import { bindAssetToHit, isCellMaterialAsset } from './sheetAssets'
import { runDesktopE2EIfRequested } from './desktopE2E'
import { DEFAULT_TEXT_FONT_SIZE_PX, clampTextFontSizePx, defaultTimingTextFontSizePx, resolveTimingTextFontSizePx } from './sheetTextLayout'
import { resolveAnnotationTextFontSizePx } from './annotationTextLayout'
import { calibrationPointsForSettings, getSheetPageImage, roundForInput, serializableImageRef } from './sheetImages'
import { candidateToHit, clampNumber, isTimingValueCharacter, modeShortcut, nextTimingHit, rangeSelectionFromHits, sheetRoleForHit, sheetRoleLabel } from './sheetInteraction'
import { buildTimingClipboard, clearTimingRange, deleteTimelineFrames, insertTimelineFrames, isPointEventRangeForUi, pasteResultRange, pasteTimingClipboardToProject, rangeContainsHit, rangePaperTracks, rippleDeleteTimingRange, timingPasteTarget, type TimelineDeleteDurationPolicy, type TimelineInsertDurationPolicy } from './timingEditing'
import { Tooltip, TooltipTarget } from './Tooltip'
import { normalizeRecognitionLabel, recognizeSheetPages } from './sheetRecognition'
import { detectSheetCalibrationPoints } from './sheetAutoCalibration'
import { CalibrationLoupeDialog } from './sheetCalibrationLoupe'
import { calibrationPointsSignature } from './sheetCalibrationUtils'
import { ActionMenu } from './AppControls'
import { TemplateWorkspace } from './TemplateWorkspace'
import { type CspTreeAssetRegistrationResult, type CspTreeNewTrackRegistrationInput } from './CspLayerTree'
import { createPaperTemplateDraftFromImage, createTemplateDraft, readFileAsDataUrl, readImageDimensionsFromDataUrl, templateJsonFileName, type TemplateDraftKind } from './templateDrafts'
import { APP_PROFILES, ActiveTextTarget, AssetDropMenuState, AutoCalibrationOverlayState, FrameOperationDialogState, FrameOperationKind, FrameOperationSubmit, IMPORTED_SHEET_IMAGE_INITIAL_OPACITY, IMPORTED_SHEET_SECONDS_PER_PAGE, ImportedSheetSourceCalibrationResult, ImportedSheetSourceCalibrationTarget, MainAppKind, NativeDragDropPayload, SheetScrollRequest, StackGuideLabelUpdates, StatusHintSource, StatusHints, TextAnnotationUpdate, activeStatusHintText, alertMissingProjectNativePaths, assetRootForFile, clientPointCandidatesFromNativeDropPosition, cspImportPackageAssetPaths, errorMessage, exportCutProjectsFromDocument, fileDialogInitialDirectory, formatFramePosition, formatFrameRangePosition, isImageFileRef, pathCompareKey, relativePathFromRoot, saveBinaryOutputs, saveTextOutputs, timelineEventAtHit } from './app-foundation'
import { AssetDropProcessMenu, assignRegisteredCellKeyToHit, bindingProcessMoveTarget, cloneTextAnnotationForPaste, deleteTextAnnotation, frameOriginForPageHit, materializePageHit, nextAnnotationId, processSlotsForKey, updateTextAnnotation, updateTimelineEventFontSize } from './app-sheet-layers'
import { paperTrackOrderForRole, templatePaperTracks } from './app-sheet-geometry'
import { BindingPanel, FrameOperationDialog, SheetImageExportDialog, SlotPanel, applyCellStackOrder, automaticRegisteredCellCspName, cellStackOrderItems, firstTimelineUseForKey, registeredCellAssetRows, registeredCellTrackOrder, updateNativeRegisteredCellPreviewIfOpen } from './app-registered-cells'
import { deleteRegisteredCellKey } from './app-stack-guides'
import { AppHelpDialog, AppNavigationMenu, CloseSmallIcon, DurationFrameControl, ExportPanel, HelpIcon, RecognitionActionMenu, RedoIcon, UndoIcon, ViewModeIcon, calibrationCornersForTemplate, calibrationCornersFromPoints, imageExportFilterName, nextCutNumberLabel, shouldAutoCalibrateImportedSheetSources } from './app-navigation'
import { SheetPanel } from './app-sheet-panel'

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
      applyProject: (nextProject, nextTemplate, initialPanel) => {
        setTemplate(nextTemplate)
        setTextFontSizePx(defaultTimingTextFontSizePx(nextTemplate, 'cell'))
        setProjectDocument(createProjectDocumentFromCutProject(nextProject, { sheetTemplate: nextTemplate }))
        setProjectFilePath(null)
        setHistory(createProjectHistory(nextProject))
        switchPanel(initialPanel)
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
    target: { position?: { x: number; y: number }; slotId?: string } = {},
  ) {
    const key = project.logicalSheet.keys.find(item => item.keyId === keyId)
    if (!key) return
    if (target.slotId) {
      assignAssetToKeySlot(assetId, keyId, target.slotId)
      return
    }
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

  function handleRegisterKeyToCspTrack(keyId: string, slotId: string): boolean {
    const key = project.logicalSheet.keys.find(item => item.keyId === keyId)
    const slot = project.cspTrackSlots.find(item => item.slotId === slotId)
    if (!key || !slot || key.paperTrack !== slot.paperTrack) return false
    if (project.bindings.some(binding => binding.keyId === keyId)) return false
    commitProject(upsertBinding(project, {
      slotId,
      keyId,
      cspCellName: automaticRegisteredCellCspName(key, slot, null),
      materialState: 'unassigned',
    }))
    return true
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

  function handleAssignAssetsToStackGuide(labelId: string, assetIds: string[], correctionLayerId = activeCorrectionLayerId) {
    try {
      const uniqueAssetIds = Array.from(new Set(assetIds))
      if (uniqueAssetIds.length !== 1) {
        window.alert('BG／BOOK・撮影指示・メモへ登録する画像素材は1件だけ選択してください。')
        return
      }
      let next = projectRef.current
      for (const assetId of uniqueAssetIds) {
        next = assignAssetToStackGuideLabel(next, labelId, assetId, correctionLayerId)
      }
      commitProject(next)
    } catch (error) {
      window.alert(errorMessage(error))
    }
  }

  function handleRegisterAssetsToCspTrack(slotId: string, assetIds: string[]): CspTreeAssetRegistrationResult {
    try {
      const sourceProject = projectRef.current
      const sheetRole = sourceProject.exportProfiles.find(profile => profile.profileId === exportProfileId)?.timingSourceRole
        ?? DEFAULT_EXPORT_TIMING_ROLE
      const result = registerAssetsToCspTrack(sourceProject, { slotId, assetIds, sheetRole })
      commitProject(result.project)
      return {
        addedCount: result.addedKeyIds.length,
        duplicateCount: result.duplicateKeyIds.length,
        missingCount: result.missingAssetIds.length,
      }
    } catch (error) {
      window.alert(errorMessage(error))
      return { addedCount: 0, duplicateCount: 0, missingCount: assetIds.length }
    }
  }

  function handleRegisterAssetsToNewCspTrack(input: CspTreeNewTrackRegistrationInput): CspTreeAssetRegistrationResult {
    try {
      const sourceProject = projectRef.current
      const sheetRole = sourceProject.exportProfiles.find(profile => profile.profileId === exportProfileId)?.timingSourceRole
        ?? DEFAULT_EXPORT_TIMING_ROLE
      const normalizedName = input.paperTrack.trim()
      const existingTrack = sourceProject.logicalSheet.paperTracks.find(track =>
        track.paperTrack.localeCompare(normalizedName, 'ja', { sensitivity: 'accent' }) === 0
        || track.label.localeCompare(normalizedName, 'ja', { sensitivity: 'accent' }) === 0,
      )
      let next = sourceProject
      let paperTrack = existingTrack?.paperTrack
      if (!paperTrack) {
        const referenceTrack = input.insertAfterPaperTrack
          ? sourceProject.logicalSheet.paperTracks.find(track => track.paperTrack === input.insertAfterPaperTrack)
          : undefined
        const created = addOverlayPaperTrack(sourceProject, {
          paperTrack: normalizedName,
          label: normalizedName,
          insertAfterPaperTrack: referenceTrack?.paperTrack,
          snapIndex: Math.max(0, (referenceTrack?.viewPlacement?.snapIndex ?? -1) + 1),
          templateId: template.templateId,
          sheetRole,
        })
        next = created.project
        paperTrack = created.paperTrack.paperTrack
      }
      const slot = next.cspTrackSlots.find(item =>
        item.paperTrack === paperTrack && item.correctionLayerId === input.correctionLayerId,
      ) ?? next.cspTrackSlots.find(item => item.paperTrack === paperTrack)
      if (!slot) throw new Error(`slot not found: ${paperTrack} / ${input.correctionLayerId}`)
      const result = registerAssetsToCspTrack(next, { slotId: slot.slotId, assetIds: input.assetIds, sheetRole })
      commitProject(result.project)
      return {
        addedCount: result.addedKeyIds.length,
        duplicateCount: result.duplicateKeyIds.length,
        missingCount: result.missingAssetIds.length,
      }
    } catch (error) {
      window.alert(errorMessage(error))
      return { addedCount: 0, duplicateCount: 0, missingCount: input.assetIds.length }
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
            onAssignAssetsToStackGuideLabel={handleAssignAssetsToStackGuide}
            onRegisterAssetsToCspTrack={handleRegisterAssetsToCspTrack}
            onRegisterAssetsToNewCspTrack={handleRegisterAssetsToNewCspTrack}
            onRegisterKeyToCspTrack={handleRegisterKeyToCspTrack}
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
