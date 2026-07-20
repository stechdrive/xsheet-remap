import { useCallback, useEffect, useMemo } from 'react';
import { addTimelineMemo, appendTimelineMemoStroke, clearTimelineMemoStrokes, deleteTimelineMemo, eraseTimelineMemoStrokes, nextTimelineMemoStrokeId, updateTimelineMemoAppearance, updateTimelineMemoPlacement, upsertTimelineMemoText, type MemoAppearance, type TimelineMemoPlacement, type TimelineMemoPoint, type TimelineMemoStroke, type TimelineMemoText } from '@xsheet-remap/core';
import { addAnnotation, addOverlayPaperTrack, addOverlayPaperTrackAtCspTop, assignSheetSourceToPage, applyNameNormalizationPlan, activeCutProjectFromDocument, assetAbsolutePath, buildExportPlan, clearEvent, commitHistory, createUnplacedCspCard, createStackGuideLabel, createStackGuideLabelAtCspCellBottom, createSheetPages, createProjectDocumentFromCutProject, createRecognizedEvent, createProjectHistory, defaultCorrectionLayerId, DEFAULT_EXPORT_TIMING_ROLE, DEFAULT_PRE_ROLL_FRAMES, deleteOverlayPaperTrack, deleteStackGuideLabel, eraseAnnotations, type CorrectionLayer, type CutMetadataFieldId, type CutProject, type AnnotationPoint, type AnnotationStroke, type AnnotationText, type FileRef, type NameNormalizationPlan, type SheetHit, type SheetImageAlignment, type SheetCalibrationPointPair, type SheetPage, type SheetPageMemoTarget, type SheetTemplate, type SheetTimingRole, type RecognitionCandidate, type StackGuideLabel, redoHistory, registerAssetsToCspTrack, removeCellBinding, reorderCorrectionLayer, reorderProductionStage, reprojectProjectToTemplate, resolveSheetTemplatePageSize, sheetTimingRoleForEvent, sheetTemplatePresets, timelineLanesForLayout, timingHitForFrame, undoHistory, updateCorrectionLayers, updateProductionStageLabel, updatePaperTrack, updateLogicalSheetSettings, updateStackGuideLabel, updateSheetPageViewState, updateSheetViewState, upsertBinding, assignAssetToStackGuideLabel, updateStackGuideRegistration, validateProject, registerAsset, registerSheetSource, synchronizeAssetRoot, INBETWEEN_KEY_ID, NULL_CELL_DISPLAY_LABEL, NULL_CELL_KEY_ID, REVERSE_SHEET_KEY_ID, type CutAsset, type TimingKey, hitTestSheetTemplate, isSpecialTimingKeyId, logicalSheetDisplayDurationFrames, logicalSheetDisplayFrameEnd, logicalSheetDisplayFrameStart, moveBindingToCorrectionLayer, updateActiveCutProjectInDocument, sheetAnnotations, timelineMemos } from '@xsheet-remap/core';
import { collectAssetPathDrop, confirmUserAction, fileToFileRef, isTauriHost, isXsrProjectFileName, nativeFileSource, openAssetRootDirectory, openImageFileRefs, renameMaterialFiles, saveJsonFile, saveProjectFile, statNativePaths, subscribeNativeDragDrop, writeProjectFile, type AssetRootCandidate, type NativeDragDropPayload } from '@xsheet-remap/adapters';
import { APP_VERSION } from './appVersion';
import { updateCutMetadata } from './cutMetadata';
import { uiText } from './i18n';
import { type Panel, type SheetRangeSelection, type TimingClipboard } from './appTypes';
import { loadProjectDocumentFile, projectRuntimeSourceImageUrls } from './projectFileModel';
import { defaultSheetImageExportOptions, renderSheetImageExports, type SheetImageExportFormat, type SheetImageExportOptions } from './cleanSheetExport';
import { projectFileName } from './outputFileNames';
import { type DropDiagnosticReport } from './AssetBrowser';
import { defaultLevelCorrectionSettings, normalizeLevelCorrectionSettings, type LevelCorrectionSettings } from './levelCorrection';
import { compareAssetNames, compareFileNames, isImageAssetFile, sheetImageRefFromAsset } from './assetFiles';
import { compareFileNameLikeText } from './naturalSort';
import { bindAssetToHit, isCellMaterialAsset } from './sheetAssets';
import { runDesktopE2EIfRequested } from './desktopE2E';
import { clampTextFontSizePx, defaultTimingTextFontSizePx, resolveTimingTextFontSizePx } from './sheetTextLayout';
import { resolveAnnotationTextFontSizePx } from './annotationTextLayout';
import { calibrationPointsForSettings, getSheetPageImage, serializableImageRef } from './sheetImages';
import { candidateToHit, clampNumber, isTimingValueCharacter, modeShortcut, navigatePointEventSelection, nextTimingHit, rangeSelectionFromHits, sheetRoleForHit, sheetRoleLabel } from './sheetInteraction';
import { buildTimingClipboard, clearTimingRange, isPointEventRangeForUi, moveTimingEventsInRange, pasteResultRange, pasteTimingClipboardToProject, rangeContainsHit, rangePaperTracks, rippleDeleteTimingRange, timingPasteTarget, timingRangeSelectionForMoveResult } from './timingEditing';
import { normalizeRecognitionLabel, recognizeSheetPagesIfAvailable } from './runtimeFeatures';
import { detectSheetCalibrationPoints } from './sheetAutoCalibration';
import { calibrationPointsSignature } from './sheetCalibrationUtils';
import { type CspTreeAssetRegistrationResult, type CspTreeNewTrackRegistrationInput } from './CspLayerTree';
import { createPaperTemplateDraftFromImage, createTemplateDraft, readFileAsDataUrl, templateJsonFileName, type TemplateDraftKind } from './templateDrafts';
import { readTemplateImageMetadata } from './templateImageMetadata';
import { APP_PROFILES, ActiveTextTarget, FrameOperationKind, FrameOperationSubmit, IMPORTED_SHEET_IMAGE_INITIAL_OPACITY, IMPORTED_SHEET_SECONDS_PER_PAGE, ImportedSheetSourceCalibrationResult, ImportedSheetSourceCalibrationTarget, MainAppKind, StackGuideLabelUpdates, StatusHintSource, TextAnnotationUpdate, activeStatusHintText, alertMissingProjectNativePaths, clientPointCandidatesFromNativeDropPosition, errorMessage, exportCutProjectsFromDocument, isImageFileRef, preferredSaveDirectory, saveBinaryOutputs, timelineEventAtHit } from './app-foundation';
import { assignRegisteredCellKeyToHit, bindingProcessMoveTarget, cloneTextAnnotationForPaste, deleteTextAnnotation, frameOriginForPageHit, materializePageHit, nextAnnotationId, processSlotsForKey, updateTextAnnotation, updateTimelineEventFontSize } from './app-sheet-layers';
import { paperTrackOrderForRole, stampAuxiliaryPlacementTemplate, templatePaperTracks } from './app-sheet-geometry';
import { automaticRegisteredCellCspName, firstTimelineUseForKey, registeredCellTrackOrder, reorderCspStackItem, updateNativeRegisteredCellPreviewIfOpen, updateNativeStackGuidePreviewIfOpen } from './app-registered-cells';
import { setTimingValueAt } from './sheet-timing-input';
import { calibrationCornersForTemplate, calibrationCornersFromPoints, imageExportFilterName, shouldAutoCalibrateImportedSheetSources } from './app-navigation';
import { useAppShellState } from './app-shell-state'
import { isAssetBrowserNativeDropTarget, nativeCspDropTarget } from './nativeFileDropTargets'
import { deleteRegisteredCellKey } from './stack-guides-paper-track'
import { createAppTimedRangeControllers } from './app-timed-range-controllers'
import { applyFrameOperationToProject, frameOperationDialogStateForHit, pointRoleForFrameOperation } from './frameOperations'
import { buildSelectionPresentation, inputHitForRange } from './app-selection-presentation'
import { createTimelineMemoForCue, createTimelineMemoForHit } from './timelineMemoEditing'
import { createAppXdtsActions } from './app-xdts-actions'
import { confirmSheetTemplateImport, loadSheetTemplate } from './app-template-import'
import { useAppSheetHistoryController } from './app-sheet-history-actions'
import { createAppSharedCutActions } from './app-shared-cut-actions'
import { openCspImportExportDirectory, saveCspImportExportPlan } from './app-csp-import-actions'
import { useCspImportExportPlan } from './useCspImportExportPlan'
import { createPreferredProject, rememberSheetTemplatePreset } from './mainAppPreferences'
import { createAppTimelineLaneActions } from './app-timeline-lane-actions'
export interface AppControllerOptions { appKind?: MainAppKind; collapseEditorSheetPanes?: boolean }
export function useAppController({ appKind = 'editor', collapseEditorSheetPanes = false }: AppControllerOptions = {}) {
  const appProfile = APP_PROFILES[appKind]
  const {
    history, setHistory, commitWorkspace, projectDocument, setProjectDocument, savedProjectDocumentSignature, setSavedProjectDocumentSignature, projectFilePath, setProjectFilePath, paperSheetInputRef, project, projectRef, template, setTemplate,
    runtimeSourceImageUrls, setRuntimeSourceImageUrls, recognitionCandidates, setRecognitionCandidates, recognitionRole: storedRecognitionRole, setRecognitionRole,
    recognitionRunning, setRecognitionRunning, recognitionProgress, setRecognitionProgress, recognitionMessage, setRecognitionMessage,
    autoCalibrationRunning, setAutoCalibrationRunning, autoCalibrationMessage, setAutoCalibrationMessage, autoCalibrationOverlay, setAutoCalibrationOverlay,
    calibrationLoupeOpen, setCalibrationLoupeOpen, panel, setPanel, editMode, setEditMode, zoom, setZoom, zoomMode, setZoomMode,
    showTemplate, setShowTemplate, showTemplateGuides, setShowTemplateGuides, showTemplateLabels, setShowTemplateLabels,
    showInputContent, setShowInputContent, showAnnotations, setShowAnnotations, penColor, setPenColor,
    penWidth, setPenWidth, eraserWidth, setEraserWidth, textFontSizePx, setTextFontSizePx, memoTextFontSizePx, setMemoTextFontSizePx, selectedTextAnnotationId, setSelectedTextAnnotationId,
    editingTextAnnotationId, setEditingTextAnnotationId, textAnnotationClipboard, setTextAnnotationClipboard, sheetSelection, setSheetSelection,
    selectedKeyId, setSelectedKeyId, sheetScrollRequest, setSheetScrollRequest, timingClipboard, setTimingClipboard,
    soundCueClipboard, setSoundCueClipboard, soundCueDialog, setSoundCueDialog, soundLabelHistory, setSoundLabelHistory,
    cameraCueClipboard, setCameraCueClipboard, cameraCueDialog, setCameraCueDialog,
    cameraInstructionHistory, setCameraInstructionHistory, cameraPointLabelHistory, setCameraPointLabelHistory,
    statusHints, setStatusHints,
    valueDraft, setValueDraft, valueDraftActive, setValueDraftActive, sheetImageExportDraft, setSheetImageExportDraft,
    sheetLevelCorrectionDialogOpen, setSheetLevelCorrectionDialogOpen, appHelpDialogOpen, setAppHelpDialogOpen,
    timingExportDialog, setTimingExportDialog, exportOperationNotice, setExportOperationNotice, xdtsImportDialog, setXdtsImportDialog, frameOperationDialog, setFrameOperationDialog, assetDropMenu, setAssetDropMenu,
    activeCorrectionLayerIdState, setActiveCorrectionLayerIdState, nativeFileDropHandlerRef, nativeDragDropPayloadHandlerRef, nativeFileDropDedupeRef,
  } = useAppShellState(appKind)
  const exportProfileId = 'import-stack'
  const templatePanelKey = useMemo(() => JSON.stringify(template), [template])
  const recognitionRoles = (['action', 'cell'] as const).filter(role => template.regions.some(region =>
    region.type === 'exposure-grid' && region.grid?.role === role,
  ))
  const recognitionRole: SheetTimingRole = recognitionRoles.includes(storedRecognitionRole as 'action' | 'cell')
    ? storedRecognitionRole
    : recognitionRoles[0] ?? 'action'
  const issues = useMemo(() => validateProject(project, project.exportProfiles.find(profile => profile.profileId === exportProfileId)), [project, exportProfileId])
  const projectDocumentSnapshot = useMemo(() => updateActiveCutProjectInDocument(projectDocument, project, { sheetTemplate: template }), [projectDocument, project, template])
  const hasUnsavedProjectChanges = useMemo(() => JSON.stringify(projectDocumentSnapshot) !== savedProjectDocumentSignature, [projectDocumentSnapshot, savedProjectDocumentSignature])
  const projectCuts = projectDocumentSnapshot.cuts
  const {
    activeSheetRevision, sheetRevisions, referenceProject,
    handleSwitchSheetRevision, handleAddSheetRevision, handleRenameSheetRevision,
    handleToggleSheetRevisionProtected, handleToggleSheetRevisionSourceReference, handleDeleteSheetRevision,
  } = useAppSheetHistoryController({
    projectDocument: projectDocumentSnapshot, project, setProjectDocument, setHistory, projectRef,
    setActiveCorrectionLayerId: setActiveCorrectionLayerIdState,
    setRuntimeSourceImageUrls, clearSelection: clearSelectionState, alertError: error => window.alert(errorMessage(error)),
  })
  const { handleSwitchProjectCut, handleAddSharedCut, handleDeleteSharedCut } = createAppSharedCutActions({
    projectDocument: projectDocumentSnapshot, project, template, setProjectDocument, setHistory, projectRef,
    setActiveCorrectionLayerId: setActiveCorrectionLayerIdState,
    setRuntimeSourceImageUrls, clearSelection: clearSelectionState, alertError: error => window.alert(errorMessage(error)),
  })
  const timingExportPlan = useMemo(() => timingExportDialog ? buildExportPlan(project, { profileId: exportProfileId, timingSourceRole: timingExportDialog.timingSourceRole, sheetTemplate: template }) : null, [exportProfileId, project, template, timingExportDialog])
  const timingExportIssues = useMemo(() => timingExportPlan?.validation ?? [], [timingExportPlan])
  const cspImportExport = useCspImportExportPlan({
    enabled: timingExportDialog?.kind === 'csp-import',
    projectDocument: projectDocumentSnapshot,
    exportProfileId,
    timingSourceRole: timingExportDialog?.timingSourceRole ?? DEFAULT_EXPORT_TIMING_ROLE,
    appVersion: APP_VERSION,
  })
  const {
    openTimingExportDialog, updateTimingExportRole, updateTimingExportOptions, confirmTimingExport,
    handleSaveXdts, handleLoadXdts, updateXdtsImportDialog, confirmXdtsImport,
  } = createAppXdtsActions({
    project,
    getProject: () => projectRef.current,
    projectDocument: projectDocumentSnapshot,
    exportProfileId,
    timingExportDialog,
    setTimingExportDialog,
    xdtsImportDialog,
    setXdtsImportDialog,
    commitProject,
    clearSelection: clearSelectionState,
    saveCspImportPackage: handleSaveCspImportPackage,
  })
  const sheetDisplayFrameStart = logicalSheetDisplayFrameStart(project.logicalSheet)
  const sheetDisplayFrameEnd = logicalSheetDisplayFrameEnd(project.logicalSheet)
  const sheetDisplayDurationFrames = logicalSheetDisplayDurationFrames(project.logicalSheet)
  const sheetPages = useMemo(() => createSheetPages(template, sheetDisplayDurationFrames, sheetDisplayFrameStart), [template, sheetDisplayDurationFrames, sheetDisplayFrameStart])
  const rangeSelection = sheetSelection.kind === 'range' ? sheetSelection.range : null
  const selectedTimedRangeCueId = sheetSelection.kind === 'cue' ? sheetSelection.cueId : null
  const {
    selectedTimedRangeCue, selectedSoundCueId, selectedSoundCue, selectedCameraCueId, selectedCameraCue,
    soundCueController, cameraCueController,
    handleTimedRangeKeyDown,
    handleSoundCueSelect, openSoundCueEditor, openSoundCueEditorForRange, submitSoundCueDialog, handleTransformSoundCue, copySelectedSoundCueRange, pasteSelectedSoundCueRange,
    handleCameraCueSelect, openCameraCueEditor, openCameraCueEditorForRange, submitCameraCueDialog, handleTransformCameraCue, copySelectedCameraCueRange, pasteSelectedCameraCueRange,
  } = createAppTimedRangeControllers({
    project, getProject: () => projectRef.current, template, rangeSelection, selectedCueId: selectedTimedRangeCueId,
    soundClipboard: soundCueClipboard, cameraClipboard: cameraCueClipboard,
    frameMin: sheetDisplayFrameStart, frameMax: sheetDisplayFrameEnd, commitProject, commitTimingDraft,
    clearSelection: clearSelectionState, selectRange: setSelectionFromRange,
    setSelectedTextAnnotationId, setSelectedKeyId, setSheetSelection, setValueDraft, setValueDraftActive,
    setSoundClipboard: setSoundCueClipboard, setSoundDialog: setSoundCueDialog, setSoundLabelHistory,
    setCameraClipboard: setCameraCueClipboard, setCameraDialog: setCameraCueDialog,
    setCameraInstructionHistory, setCameraPointLabelHistory,
  })
  const selectedHit = sheetSelection.kind === 'cell'
    ? sheetSelection.hit
    : sheetSelection.kind === 'range'
      ? inputHitForRange(project, template, sheetSelection.range, sheetDisplayDurationFrames, sheetDisplayFrameStart)
      : null
  const selection = { hit: selectedHit, keyId: selectedKeyId }
  const sheetSourceRuntimePathEntries = useMemo(() => {
    const assetPathById = new Map(project.assets.map(asset => [asset.assetId, assetAbsolutePath(asset, project.assetRoot)]))
    return project.sheetView.sources.flatMap(source => {
      if (source.kind !== 'sheet-scan') return []
      const path = source.imageRef.path ?? (source.assetId ? assetPathById.get(source.assetId) : undefined)
      return path ? [{ sourceId: source.sourceId, path }] : []
    })
  }, [project.assetRoot, project.assets, project.sheetView.sources])
  const activeSheetPageSize = useMemo(
    () => resolveSheetTemplatePageSize(template, sheetDisplayDurationFrames, {
      paperTracks: templatePaperTracks(project, template).map(track => track.paperTrack),
      timelineLanes: timelineLanesForLayout(project),
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
  const issueErrorCount = issues.filter(issue => issue.severity === 'error').length
  const issueWarningCount = issues.filter(issue => issue.severity === 'warning').length
  const activeCalibrationPoints = activePage ? calibrationPointsForSettings(activePageImage.settings, template) : []
  const activeCalibrationPointsKey = calibrationPointsSignature(activeCalibrationPoints)
  const selectedKeySummary = selection.keyId
    ? isSpecialTimingKeyId(selection.keyId)
      ? keyDisplayLabelForId(selection.keyId)
      : selectedKey ? `${selectedKey.displayLabel} (${selectedKey.keyId})` : '-'
    : '-'
  const selectedTextAnnotation = selectedTextAnnotationId
    ? sheetAnnotations(project).find((annotation): annotation is AnnotationText => annotation.kind === 'text' && annotation.annotationId === selectedTextAnnotationId) ?? null
    : null
  const editingTextAnnotation = editingTextAnnotationId
    ? sheetAnnotations(project).find((annotation): annotation is AnnotationText => annotation.kind === 'text' && annotation.annotationId === editingTextAnnotationId) ?? null
    : null
  const selectedTimelineEvent = timelineEventAtHit(project, selection.hit)
  const { selectedFrameSummary, statusSelectionText, statusFallbackHint } = buildSelectionPresentation({
    project,
    rangeSelection,
    selectedCue: selectedTimedRangeCue,
    selectedHit: selection.hit,
    correctionLayerLabel: activeCorrectionLayer?.label ?? '-',
    panel,
    editMode,
    hasTimingClipboard: Boolean(timingClipboard),
    hasSelectedTimelineEvent: Boolean(selectedTimelineEvent),
  })
  const selectedTimelineEventFontSizePx = selectedTimelineEvent
    ? resolveTimingTextFontSizePx(template, sheetTimingRoleForEvent(selectedTimelineEvent), selectedTimelineEvent.fontSizePx)
    : undefined
  const activeTextTarget: ActiveTextTarget = rangeSelection
    ? { kind: 'timingRange', fontSizePx: textFontSizePx }
    : selectedTimelineEvent && selectedTimelineEventFontSizePx !== undefined
      ? { kind: 'timingEvent', eventId: selectedTimelineEvent.eventId, fontSizePx: selectedTimelineEventFontSizePx }
      : { kind: 'nextTimingInput', fontSizePx: textFontSizePx }
  const activeTextFontSizePx = activeTextTarget.fontSizePx
  const hasSelectedTextTarget = activeTextTarget.kind === 'timingEvent'
  const isTextFontSizeDisabled = activeTextTarget.kind === 'timingRange'
  const activeMemoTextFontSizePx = selectedTextAnnotation
    ? resolveAnnotationTextFontSizePx(selectedTextAnnotation, activeSheetPageSize)
    : memoTextFontSizePx
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
  }, [setStatusHints])
  const switchPanel = useCallback((nextPanel: Panel) => {
    setStatusHints({})
    setPanel(nextPanel)
  }, [setPanel, setStatusHints])
  const activeStatusHint = activeStatusHintText(statusHints)
  const statusHintText = activeStatusHint ?? statusFallbackHint
  useEffect(() => {
    projectRef.current = project
  }, [project, projectRef])
  useEffect(() => {
    if (!selectedTimedRangeCueId || selectedTimedRangeCue) return
    setSheetSelection({ kind: 'none' })
    setSelectedKeyId(null)
    setValueDraft('')
    setValueDraftActive(false)
  }, [selectedTimedRangeCue, selectedTimedRangeCueId, setSelectedKeyId, setSheetSelection, setValueDraft, setValueDraftActive])
  useEffect(() => {
    if (!selectedKey || isSpecialTimingKeyId(selectedKey.keyId)) return
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
  }, [setActiveCorrectionLayerIdState, setHistory, setProjectDocument, setProjectFilePath, setTemplate, setTextFontSizePx, switchPanel])

  useEffect(() => {
    if (!isTauriHost() || sheetSourceRuntimePathEntries.length === 0) return undefined
    let cancelled = false

    void Promise.all(sheetSourceRuntimePathEntries.map(async entry => ({
      ...entry,
      imageUrl: await nativeFileSource(entry.path),
    })))
      .then(entries => {
        if (cancelled) return
        setRuntimeSourceImageUrls(current => {
          let changed = false
          const next = { ...current }
          for (const entry of entries) {
            if (next[entry.sourceId] === entry.imageUrl) continue
            next[entry.sourceId] = entry.imageUrl
            changed = true
          }
          return changed ? next : current
        })
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [setRuntimeSourceImageUrls, sheetSourceRuntimePathEntries])

  function commitProject(nextProject: CutProject) {
    if (activeSheetRevision.protected) {
      window.alert('このシートは編集保護中です。シート履歴のメニューから保護を解除してください。')
      return
    }
    projectRef.current = nextProject
    setHistory(current => commitHistory(current, nextProject))
    if (selectionIsOutsideProjectDisplay(nextProject)) clearSelectionState()
  }

  async function handleNativeFileDrop(paths: string[], position: { x: number; y: number }) {
    const clientPoints = clientPointCandidatesFromNativeDropPosition(position)
    const pathStatuses = await statNativePaths(paths)
    const directoryPaths = pathStatuses.filter(status => status.isDirectory).map(status => status.path)
    const filePaths = pathStatuses.filter(status => status.isFile).map(status => status.path)
    recordDropDiagnostic({
      source: 'native-router',
      type: 'paths',
      target: 'classified',
      paths,
      position,
      details: `入力 ${paths.length}件 / ファイル ${filePaths.length}件 / フォルダ ${directoryPaths.length}件`,
    })
    const assetBrowserTarget = isAssetBrowserNativeDropTarget(clientPoints)
    if (assetBrowserTarget) {
      const roots = await assetRootCandidatesFromNativePaths(directoryPaths)
      const collection = filePaths.length > 0
        ? await collectAssetPathDrop(filePaths, { recursive: false })
        : { roots: [], files: [] }
      recordDropDiagnostic({
        source: 'native-router',
        type: 'route',
        target: 'asset-browser',
        paths,
        position,
        details: `素材ブラウザ判定 / フォルダ候補 ${roots.length}件 / ファイル ${collection.files.length}件`,
      })
      await handleAssetRootCandidates(roots)
      const assetIds = handleAssetFileRefs(collection.files, null, position)
      const registeredAssets = assetIds.map(assetId => {
        const asset = projectRef.current.assets.find(item => item.assetId === assetId)
        return asset ? {
          assetId: asset.assetId,
          source: asset.source,
        } : { assetId, missing: true }
      })
      recordDropDiagnostic({
        source: 'native-router',
        type: 'registered',
        target: 'asset-browser',
        paths: filePaths,
        position,
        details: JSON.stringify(registeredAssets),
      })
      return
    }
    const directoryRoots = await assetRootCandidatesFromNativePaths(directoryPaths)
    if (directoryRoots.length > 0) {
      recordDropDiagnostic({
        source: 'native-router',
        type: 'route',
        target: 'asset-root',
        paths,
        position,
        details: `フォルダ候補 ${directoryRoots.length}件 / 座標に関係なく登録`,
      })
      await handleAssetRootCandidates(directoryRoots)
    }
    if (filePaths.length === 0) return

    const cspTarget = nativeCspDropTarget(clientPoints)
    if (cspTarget) {
      const collection = await collectAssetPathDrop(filePaths, { recursive: false })
      const assetIds = handleAssetFileRefs(collection.files, null, position)
      if (assetIds.length === 0) return
      if (cspTarget.kind === 'cel') {
        if (assetIds.length !== 1) {
          setStatusHint('sheet-drop', '登録済みカードへ割り当てる画像素材は1件だけ選択してください。素材は素材ブラウザへ登録しました。')
          return
        }
        handleAssignAssetToKey(assetIds[0]!, cspTarget.keyId, { slotId: cspTarget.slotId, position })
        setStatusHint('sheet-drop', '画像素材をカードへ割り当てました。')
      } else if (cspTarget.kind === 'paper-track') {
        const result = handleRegisterAssetsToCspTrack(cspTarget.slotId, assetIds)
        const duplicateNotice = result.duplicateCount > 0 ? ` ${result.duplicateCount}件は登録済みです。` : ''
        setStatusHint('sheet-drop', `${result.addedCount}件のカードを追加しました。${duplicateNotice}`)
      } else {
        if (assetIds.length !== 1) {
          setStatusHint('sheet-drop', 'BG／BOOK・撮影指示・メモへ割り当てる画像素材は1件だけ選択してください。素材は素材ブラウザへ登録しました。')
          return
        }
        handleAssignAssetsToStackGuide(cspTarget.labelId, assetIds, cspTarget.correctionLayerId)
        setStatusHint('sheet-drop', '画像素材を追加トラックへ割り当てました。')
      }
      recordDropDiagnostic({
        source: 'native-router',
        type: 'route',
        target: `csp/${cspTarget.kind}`,
        paths: filePaths,
        position,
        details: `${assetIds.length}件`,
      })
      return
    }
    const sheetPoint = clientPoints.find(point => nativeSheetHitFromClientPoint(point.x, point.y)) ?? clientPoints[0] ?? position
    const hit = nativeSheetHitFromClientPoint(sheetPoint.x, sheetPoint.y)
    recordDropDiagnostic({
      source: 'native-router',
      type: 'route',
      target: hit ? `${sheetRoleLabel(sheetRoleForHit(hit))} ${hit.paperTrack ?? '-'}` : 'sheet/no-hit',
      paths: filePaths,
      position,
      details: hit ? `フレーム ${hit.frame + 1}` : 'シートヒットなし',
    })
    void handleAssetNativePaths(filePaths, hit, sheetPoint, { recursive: false })
  }

  useEffect(() => {
    nativeFileDropHandlerRef.current = (paths, position) => {
      void handleNativeFileDrop(paths, position)
    }
  })

  function recordDropDiagnostic(report: DropDiagnosticReport) {
    const diagnosticWindow = window as Window & { __xsheetDropDiagnostics?: DropDiagnosticReport[] }
    if (report.type !== 'over') diagnosticWindow.__xsheetDropDiagnostics?.push(report)
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
    let unsubscribe: (() => void) | undefined
    async function subscribeNativeDropEvents() {
      const nextUnsubscribe = await subscribeNativeDragDrop(
        (payload, source) => nativeDragDropPayloadHandlerRef.current(payload, `native:${source}`),
        ['webview', 'window', 'event'],
      )
      if (disposed) {
        nextUnsubscribe()
        return
      }
      unsubscribe = nextUnsubscribe
    }
    void subscribeNativeDropEvents().catch(error => {
      console.error('Failed to subscribe native file drop event', error)
    })
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [nativeDragDropPayloadHandlerRef])

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
    const templateTrackNames = templatePaperTracks(project, template).map(track => track.paperTrack)
    const hitOptions = { paperTracks: templateTrackNames, timelineLanes: timelineLanesForLayout(project), durationFrames: page.frameEnd - page.frameStart + 1, frameOrigin, layoutOverrides: project.sheetView.layoutOverrides }
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
    setSheetSelection({ kind: 'none' })
    setSelectedKeyId(null)
    setSelectedTextAnnotationId(null)
    setEditingTextAnnotationId(null)
    setValueDraft('')
    setValueDraftActive(false)
  }

  function setActivePageIndex(pageIndex: number, sourceProject: CutProject = project) {
    const page = sheetPages[pageIndex]
    if (!page || sourceProject.sheetView.activePageId === page.pageId) return
    commitProject(updateSheetViewState(sourceProject, { activePageId: page.pageId }))
  }

  function updateTiming(updates: Parameters<typeof updateLogicalSheetSettings>[1]) {
    commitProject(updateLogicalSheetSettings(project, updates.workRange
      ? { ...updates, workRange: { ...updates.workRange, preRollFrames: DEFAULT_PRE_ROLL_FRAMES, showPostRoll: true } }
      : updates))
  }

  function eventKeyIdAtHit(hit: SheetHit | null, sourceProject: CutProject = project): string | null {
    if (!hit?.paperTrack) return null
    const sheetRole = sheetRoleForHit(hit)
    return sourceProject.logicalSheet.events.find(event => event.paperTrack === hit.paperTrack && event.frame === hit.frame && sheetTimingRoleForEvent(event) === sheetRole)?.keyId ?? null
  }

  function keyAtHit(sourceProject: CutProject, hit: SheetHit | null): TimingKey | null {
    const keyId = eventKeyIdAtHit(hit, sourceProject)
    if (!keyId || isSpecialTimingKeyId(keyId)) return null
    return sourceProject.logicalSheet.keys.find(key => key.keyId === keyId) ?? null
  }

  function keyDisplayLabelForId(keyId: string | null | undefined, sourceProject: CutProject = project): string {
    if (!keyId) return ''
    if (keyId === NULL_CELL_KEY_ID) return NULL_CELL_DISPLAY_LABEL
    if (keyId === INBETWEEN_KEY_ID) return '/'
    if (keyId === REVERSE_SHEET_KEY_ID) return '.'
    return sourceProject.logicalSheet.keys.find(item => item.keyId === keyId)?.displayLabel ?? ''
  }

  function setSelectionFromHit(hit: SheetHit, sourceProject: CutProject = project, keyIdOverride?: string | null) {
    const keyId = keyIdOverride === undefined ? eventKeyIdAtHit(hit, sourceProject) : keyIdOverride
    setSelectedTextAnnotationId(null)
    setSheetSelection({ kind: 'cell', hit })
    setSelectedKeyId(keyId)
    setValueDraft(keyDisplayLabelForId(keyId, sourceProject))
    setValueDraftActive(false)
    updateOpenNativePreviewForKey(sourceProject, keyId)
  }

  function setSelectionFromRange(range: SheetRangeSelection, sourceProject: CutProject = project) {
    const inputHit = inputHitForRange(sourceProject, template, range, sheetDisplayDurationFrames, sheetDisplayFrameStart)
    const keyId = eventKeyIdAtHit(inputHit, sourceProject)
    setSelectedTextAnnotationId(null)
    setSheetSelection({ kind: 'range', range })
    setSelectedKeyId(keyId)
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

  function applyTimingValueToRange(range: SheetRangeSelection, rawValue: string, advance: boolean, sourceProject: CutProject = project): CutProject {
    if (!isPointEventRange(range)) return sourceProject
    const trackOrder = paperTrackOrderForRole(sourceProject, range.role)
    const value = rawValue.trim()
    let next = { project: sourceProject, keyId: null as string | null }
    for (const paperTrack of rangePaperTracks(range)) {
      const startHit = timingHitForFrame(template, range.role, paperTrack, range.frameStart, sheetDisplayDurationFrames, sheetDisplayFrameStart, trackOrder)
      if (startHit) next = setTimingValueAt(next.project, startHit, value, activeTextFontSizePx, activeCorrectionLayerId)
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
    return next.project
  }

  function applyTimingValue(hit: SheetHit | null, rawValue: string, advance = false, sourceProject: CutProject = project): CutProject {
    if (!hit?.paperTrack) return sourceProject
    const value = rawValue.trim()
    const next = setTimingValueAt(sourceProject, hit, value, activeTextFontSizePx, activeCorrectionLayerId)
    commitProject(next.project)
    setValueDraft(value)
    setValueDraftActive(false)
    const nextHit = advance
      ? nextTimingHit(template, sheetDisplayDurationFrames, sheetDisplayFrameStart, hit, 0, 1)
      : null
    if (nextHit) {
      if (typeof nextHit.pageIndex === 'number') setActivePageIndex(nextHit.pageIndex, next.project)
      setSelectionFromHit(nextHit, next.project)
    } else {
      setSelectionFromHit(hit, next.project, next.keyId)
    }
    return next.project
  }

  function commitTimingDraft(advance: boolean): CutProject {
    if (!valueDraftActive) return project
    if (rangeSelection) {
      return applyTimingValueToRange(rangeSelection, valueDraft, advance)
    }
    return applyTimingValue(selection.hit, valueDraft, advance)
  }

  function handleTimingCharacterInput(character: string) {
    if (!selection.hit) return
    const nextValue = valueDraftActive ? `${valueDraft}${character}` : character
    setValueDraft(nextValue)
    setValueDraftActive(true)
  }

  function handleRangeSelect(range: SheetRangeSelection) {
    const sourceProject = commitTimingDraft(false)
    setSelectionFromRange(range, sourceProject)
  }
  function handleCellClick(hit: SheetHit) {
    if (!hit.paperTrack) return
    const sourceProject = commitTimingDraft(false)
    if (typeof hit.pageIndex === 'number') setActivePageIndex(hit.pageIndex, sourceProject)
    setSelectionFromHit(hit, sourceProject)
  }
  function handleCellSelect(hit: SheetHit) {
    if (!hit.paperTrack) return
    const sourceProject = commitTimingDraft(false)
    if (typeof hit.pageIndex === 'number') setActivePageIndex(hit.pageIndex, sourceProject)
    setSelectionFromHit(hit, sourceProject)
  }
  function handleSetTimingSpecialAtHit(hit: SheetHit, marker: 'blank' | 'inbetween' | 'reverse') {
    if (!hit.paperTrack) return
    if (typeof hit.pageIndex === 'number') setActivePageIndex(hit.pageIndex)
    applyTimingValue(hit, marker === 'blank' ? 'x' : marker === 'inbetween' ? '/' : '.')
  }
  const handleSetNullAtHit = (hit: SheetHit) => handleSetTimingSpecialAtHit(hit, 'blank')
  function handleDeleteEventAtHit(hit: SheetHit) {
    if (!hit.paperTrack) return
    const sheetRole = sheetRoleForHit(hit)
    const next = clearEvent(project, hit.paperTrack, hit.frame, sheetRole)
    commitProject(next)
    if (typeof hit.pageIndex === 'number') setActivePageIndex(hit.pageIndex, next)
    setSelectionFromHit(hit, next, null)
  }

  function handleKeySelect(keyId: string | null) {
    if (isSpecialTimingKeyId(keyId)) return
    const sourceProject = commitTimingDraft(false)
    setSelectedTextAnnotationId(null)
    setSelectedKeyId(keyId)
    if (!keyId) {
      setSheetSelection({ kind: 'none' })
      setValueDraftActive(false)
      return
    }
    const key = sourceProject.logicalSheet.keys.find(item => item.keyId === keyId)
    if (!key) return
    const firstUse = firstTimelineUseForKey(sourceProject, key, registeredCellTrackOrder(sourceProject))
    if (!firstUse) {
      setSheetSelection({ kind: 'none' })
      setValueDraft(key.displayLabel)
      setValueDraftActive(false)
      updateOpenNativePreviewForKey(sourceProject, keyId)
      return
    }
    const hit = timingHitForFrame(
      template,
      firstUse.role,
      firstUse.paperTrack,
      firstUse.frame,
      sheetDisplayDurationFrames,
      sheetDisplayFrameStart,
      templatePaperTracks(sourceProject, template).map(track => track.paperTrack),
    )
    if (!hit) {
      setValueDraft(key.displayLabel)
      setValueDraftActive(false)
      updateOpenNativePreviewForKey(sourceProject, keyId)
      return
    }
    if (typeof hit.pageIndex === 'number') setActivePageIndex(hit.pageIndex, sourceProject)
    setSelectionFromHit(hit, sourceProject, keyId)
    setSheetScrollRequest(current => ({ requestId: (current?.requestId ?? 0) + 1, hit }))
  }

  function updateOpenNativePreviewForKey(sourceProject: CutProject, keyId: string | null) {
    if (keyId) void updateNativeRegisteredCellPreviewIfOpen(sourceProject, keyId)
  }

  function handleStackGuideSelect(labelId: string) {
    void updateNativeStackGuidePreviewIfOpen(projectRef.current, labelId)
  }

  function handleActiveCorrectionLayerChange(layerId: string) {
    setActiveCorrectionLayerIdState(layerId)
  }

  function handleClearSelection() {
    if (valueDraftActive) commitTimingDraft(false)
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
    if (cameraCueController.deleteSelection()) return
    if (soundCueController.deleteSelection()) return
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

  function handleDeleteCspCard(keyId: string, bindingId?: string) {
    if (isSpecialTimingKeyId(keyId)) return
    const sourceProject = projectRef.current
    const nextProject = bindingId
      ? removeCellBinding(sourceProject, bindingId)
      : deleteRegisteredCellKey(sourceProject, keyId)
    if (nextProject === sourceProject) return
    commitProject(nextProject)
    const keyDeleted = !nextProject.logicalSheet.keys.some(key => key.keyId === keyId)
    if (selection.keyId === keyId && keyDeleted) {
      setSelectedKeyId(null)
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
    const state = frameOperationDialogStateForHit(kind, hit, rangeSelection)
    if (state) setFrameOperationDialog(state)
  }

  function applyFrameOperation(input: FrameOperationSubmit) {
    if (!frameOperationDialog) return
    const frameCount = Math.max(1, Math.round(input.frameCount))
    const pointRole = pointRoleForFrameOperation(frameOperationDialog)
    const next = applyFrameOperationToProject(project, frameOperationDialog, input)
    commitProject(next)
    setFrameOperationDialog(null)
    if (pointRole) {
      setSelectionToFrameSpan(next, pointRole, frameOperationDialog.paperTracks, frameOperationDialog.frameStart, frameOperationDialog.kind === 'insert' ? frameCount : 1)
    } else {
      clearSelectionState()
    }
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
          initialDirectory: preferredSaveDirectory(project),
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
    if (targetHit && collection.files.length > 1) {
      handleAssetFileRefs(collection.files, null, position)
      setStatusHint('sheet-drop', '複数素材は1つのフレームへ直接登録できません。素材ブラウザへ全件登録しました。CSP列へドロップしてカードを作成してください。')
      return
    }
    handleAssetFileRefs(collection.files, targetHit, position)
  }

  async function assetRootCandidatesFromNativePaths(paths: string[]): Promise<AssetRootCandidate[]> {
    if (paths.length === 0) return []
    const collection = await collectAssetPathDrop(paths, { recursive: false })
    return collection.roots.filter(root => root.fromDirectoryDrop)
  }

  async function handleAssetRootCandidates(candidates: AssetRootCandidate[]) {
    if (candidates.length === 0) return false
    const candidate = candidates[0]!
    try {
      const previousAssetIds = new Set(projectRef.current.assets.map(asset => asset.assetId))
      const collection = await collectAssetPathDrop([candidate.path], { recursive: true, rootPath: candidate.path })
      const imageRefs = collection.files.filter(isImageFileRef)
      const synchronized = synchronizeAssetRoot(projectRef.current, {
        label: candidate.label,
        path: candidate.path,
        handleKind: 'directory',
      }, imageRefs)
      commitProject(synchronized.project)
      const synchronizedIds = new Set(synchronized.assetIds)
      const reconnectedCount = [...synchronizedIds].filter(assetId => previousAssetIds.has(assetId)).length
      const addedCount = [...synchronizedIds].filter(assetId => !previousAssetIds.has(assetId)).length
      const unresolvedCount = synchronized.project.assets.filter(asset => asset.source.kind === 'unresolved').length
      setStatusHint('sheet-drop', `${candidate.label} をカットフォルダに設定しました。再接続 ${reconnectedCount}件 / 新規 ${addedCount}件 / 未解決 ${unresolvedCount}件`)
      return true
    } catch (error) {
      setStatusHint('sheet-drop', `アセットルートを読み込めませんでした: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  async function handleChooseAssetRoot() {
    const path = await openAssetRootDirectory()
    if (!path) return false
    const candidates = await assetRootCandidatesFromNativePaths([path])
    return handleAssetRootCandidates(candidates)
  }

  function registerMaterialAssetRef(sourceProject: CutProject, ref: FileRef): { project: CutProject; asset: CutAsset } {
    return registerAsset(sourceProject, ref, {
      role: 'cell-material',
    })
  }

  function handleAssetFileRefs(refs: FileRef[], targetHit: SheetHit | null = null, position?: { x: number; y: number }): string[] {
    if (refs.length === 0) return []
    const sourceProject = projectRef.current
    const existingKey = keyAtHit(sourceProject, targetHit)
    if (refs.length === 1 && existingKey) {
      const registered = registerMaterialAssetRef(sourceProject, refs[0])
      const menuPosition = position ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
      commitProject(registered.project)
      if (targetHit) setSelectionFromHit(targetHit, registered.project, existingKey.keyId)
      setAssetDropMenu({
        x: menuPosition.x,
        y: menuPosition.y,
        assetId: registered.asset.assetId,
        keyId: existingKey.keyId,
        hit: targetHit,
      })
      return [registered.asset.assetId]
    }
    let next = sourceProject
    let selectedAfterDrop: { hit: SheetHit; keyId: string } | null = null
    const assetIds: string[] = []
    for (const ref of refs) {
      const registered = registerMaterialAssetRef(next, ref)
      next = registered.project
      assetIds.push(registered.asset.assetId)
      if (targetHit?.paperTrack) {
        const bound = bindAssetToHit(next, registered.asset, targetHit, activeCorrectionLayerId)
        next = bound.project
        selectedAfterDrop = bound.keyId ? { hit: targetHit, keyId: bound.keyId } : null
      }
    }
    if (selectedAfterDrop) {
      const key = selectedAfterDrop.keyId ? next.logicalSheet.keys.find(item => item.keyId === selectedAfterDrop.keyId) ?? null : null
      setSelectionFromHit(selectedAfterDrop.hit, next, selectedAfterDrop.keyId)
      setValueDraft(key?.displayLabel ?? '')
    }
    commitProject(next)
    return assetIds
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
      setSelectionFromHit(targetHit, sourceProject, existingKey.keyId)
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
      setSelectionFromHit(targetHit, bound.project, bound.keyId)
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

  function handleMoveTimelineEvent(sourceHit: SheetHit, targetHit: SheetHit, sourceRange?: SheetRangeSelection) {
    if (!sourceHit.paperTrack || !targetHit.paperTrack) return
    const sourceRole = sheetRoleForHit(sourceHit)
    if (sourceRole !== sheetRoleForHit(targetHit)) return
    const trackOrder = paperTrackOrderForRole(project, sourceRole)
    const selectedRange = sourceRange && isPointEventRange(sourceRange) && rangeContainsHit(sourceRange, sourceHit)
      ? sourceRange
      : rangeSelectionFromHits(template, sourceHit, sourceHit, trackOrder)
    if (!selectedRange || !isPointEventRange(selectedRange)) return
    const isGroupMove = selectedRange.frameStart !== selectedRange.frameEnd || rangePaperTracks(selectedRange).length > 1
    const moved = moveTimingEventsInRange(project, selectedRange, sourceHit, targetHit, trackOrder)
    if (moved.status !== 'moved') return
    const confirmation = isGroupMove ? uiText.sheet.moveRangeOverwriteConfirm(moved.collisionCount) : uiText.sheet.moveEventOverwriteConfirm
    if (moved.collisionCount > 0 && !window.confirm(confirmation)) return
    commitProject(moved.project)
    const nextRange = isGroupMove ? timingRangeSelectionForMoveResult(template, moved.project, sourceRole, moved, trackOrder) : null
    if (nextRange) setSelectionFromRange(nextRange, moved.project)
    else setSelectionFromHit(targetHit, moved.project)
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
    const sourceProject = projectRef.current
    const key = sourceProject.logicalSheet.keys.find(item => item.keyId === keyId)
    if (!key) return
    if (target.slotId) {
      assignAssetToKeySlot(assetId, keyId, target.slotId)
      return
    }
    const options = processSlotsForKey(sourceProject, key)
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
    const sourceProject = projectRef.current
    const asset = sourceProject.assets.find(item => item.assetId === assetId)
    const key = sourceProject.logicalSheet.keys.find(item => item.keyId === keyId)
    const slot = sourceProject.cspTrackSlots.find(item => item.slotId === slotId)
    if (!asset || !key || !slot) return
    const binding = sourceProject.bindings.find(item => item.slotId === slotId && item.keyId === keyId)
    const cspCellName = binding?.cspCellName ?? automaticRegisteredCellCspName(key, slot, asset)
    if (hit?.paperTrack) {
      setSelectionFromHit(hit, sourceProject, keyId)
    }
    setAssetDropMenu(null)
    commitProject(upsertBinding(sourceProject, {
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

  function handleCreateUnplacedCspCard(slotId: string, cspCellName: string): string | null {
    try {
      const sourceProject = projectRef.current
      const created = createUnplacedCspCard(sourceProject, { slotId, cspCellName })
      commitProject(created.project)
      return created.key.keyId
    } catch (error) {
      window.alert(errorMessage(error))
      return null
    }
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

  function handleReorderCspStackItem(itemId: string, referenceItemId: string, edge: 'before' | 'after') {
    const sourceProject = projectRef.current
    const next = reorderCspStackItem(sourceProject, itemId, referenceItemId, edge, true)
    if (next) commitProject(next)
  }

  function handleReorderProductionStage(stageId: string, referenceStageId: string, edge: 'before' | 'after') {
    const next = reorderProductionStage(projectRef.current, stageId, referenceStageId, edge)
    if (next) commitProject(next)
  }

  function handleReorderCorrectionLayer(layerId: string, referenceLayerId: string, edge: 'before' | 'after') {
    const next = reorderCorrectionLayer(projectRef.current, layerId, referenceLayerId, edge)
    if (next) commitProject(next)
  }

  function handleDeleteCorrectionLayer(layerId: string) {
    try {
      const sourceProject = projectRef.current
      commitProject(updateCorrectionLayers(sourceProject, sourceProject.correctionLayers.filter(layer => layer.layerId !== layerId)))
    } catch (error) {
      window.alert(errorMessage(error))
    }
  }

  function handleCreateStackGuideLabel(input: { label: string; gapIndex: number; insertAfterPaperTrack?: string; displayRole?: SheetTimingRole; viewSnapIndex?: number; kind?: StackGuideLabel['kind']; correctionLayerId?: string; cspPlacement?: 'cell-bottom' }) {
    try {
      const { cspPlacement, ...createInput } = input
      const created = cspPlacement === 'cell-bottom'
        ? createStackGuideLabelAtCspCellBottom(project, createInput)
        : createStackGuideLabel(project, { correctionLayerId: activeCorrectionLayerId, ...createInput })
      commitProject(created.project)
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
      const result = registerAssetsToCspTrack(sourceProject, { slotId, assetIds })
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
        })
        next = created.project
        paperTrack = created.paperTrack.paperTrack
      }
      const slot = next.cspTrackSlots.find(item =>
        item.paperTrack === paperTrack && item.correctionLayerId === input.correctionLayerId,
      ) ?? next.cspTrackSlots.find(item => item.paperTrack === paperTrack)
      if (!slot) throw new Error(`slot not found: ${paperTrack} / ${input.correctionLayerId}`)
      const result = registerAssetsToCspTrack(next, { slotId: slot.slotId, assetIds: input.assetIds })
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

  function handleAddOverlayPaperTrack(input: { paperTrack?: string; insertAfterPaperTrack?: string; orderInGap?: number; snapIndex?: number; sheetRole?: SheetTimingRole; cspPlacement?: 'cell-top' }) {
    try {
      const { cspPlacement, ...createInput } = input
      const created = (cspPlacement === 'cell-top' ? addOverlayPaperTrackAtCspTop : addOverlayPaperTrack)(project, {
        ...createInput,
        templateId: template.templateId,
        sheetRole: createInput.sheetRole ?? 'cell',
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

  function handleDeleteOverlayPaperTrack(paperTrack: string) {
    const sourceProject = projectRef.current
    const track = sourceProject.logicalSheet.paperTracks.find(item => item.paperTrack === paperTrack)
    if (!track || track.source !== 'overlay') return
    const keyIds = new Set(sourceProject.logicalSheet.keys.filter(key => key.paperTrack === paperTrack).map(key => key.keyId))
    try {
      const next = deleteOverlayPaperTrack(sourceProject, paperTrack)
      commitProject(next)
      if (selection.hit?.paperTrack === paperTrack || (selection.keyId && keyIds.has(selection.keyId))) clearSelectionState()
    } catch (error) {
      window.alert(errorMessage(error))
    }
  }

  const { handleAddTimelineLane, handleUpdateTimelineLane, handleDeleteTimelineLane } = createAppTimelineLaneActions({
    getProject: () => projectRef.current,
    commitProject,
    clearSelection: clearSelectionState,
  })

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

  function handleRenameProductionStage(stageId: string, label: string) {
    try {
      const sourceProject = projectRef.current
      commitProject(updateProductionStageLabel(sourceProject, stageId, label))
    } catch (error) {
      window.alert(errorMessage(error))
    }
  }

  function handleRenameCorrectionLayer(layerId: string, label: string) {
    try {
      const sourceProject = projectRef.current
      commitProject(updateCorrectionLayers(sourceProject, sourceProject.correctionLayers.map(layer =>
        layer.layerId === layerId ? { ...layer, label } : layer,
      )))
    } catch (error) {
      window.alert(errorMessage(error))
    }
  }

  async function handleLoadProject(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    try {
      if (hasUnsavedProjectChanges) {
        const confirmed = await confirmUserAction('保存していない変更があります。現在のプロジェクトを閉じて開きますか？', {
          title: 'プロジェクトを開く',
          okLabel: '開く',
        })
        if (!confirmed) return
      }
      const loadedFile = await loadProjectDocumentFile(file)
      const loadedDocument = loadedFile.document
      const loaded = activeCutProjectFromDocument(loadedDocument)
      rememberSheetTemplatePreset(appKind, loaded.studioPresetId)
      setTemplate(loadedDocument.sheetTemplate)
      setProjectDocument(loadedDocument)
      setSavedProjectDocumentSignature(JSON.stringify(loadedDocument))
      setProjectFilePath(loadedFile.projectFilePath)
      setHistory(createProjectHistory(loaded))
      setActiveCorrectionLayerIdState(defaultCorrectionLayerId(loaded) ?? '')
      setRuntimeSourceImageUrls(projectRuntimeSourceImageUrls(loadedDocument))
      clearSelectionState()
      void alertMissingProjectNativePaths(loadedDocument)
      if (loadedFile.recoveredFromBackup) {
        window.alert('プロジェクト本体を読み込めなかったため、直前の正常保存バックアップを開きました。バックアップを保護するため、次の保存では保存先を指定してください。')
      }
    } catch (error) {
      window.alert(uiText.project.loadFailed(errorMessage(error)))
    }
  }
  const handleLoadTemplate = loadSheetTemplate
  async function handleImportTemplate(files: FileList | null) {
    const nextTemplate = await confirmSheetTemplateImport(files)
    if (nextTemplate) handleApplyTemplateDraft(nextTemplate)
  }
  function handleApplyTemplateDraft(nextTemplate: SheetTemplate) {
    syncProjectToTemplateTracks(nextTemplate, {
      studioPresetId: undefined,
      commitTemplate: true,
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
      const imageSize = await readTemplateImageMetadata(file, dataUrl)
      return createPaperTemplateDraftFromImage(file, dataUrl, imageSize)
    } catch (error) {
      window.alert(uiText.template.referenceImageLoadFailed(errorMessage(error)))
      return null
    }
  }

  async function handleSaveTemplateJson(templateToSave = template) {
    try {
      await saveJsonFile(templateToSave, templateJsonFileName(templateToSave), {
        initialDirectory: preferredSaveDirectory(project),
      })
    } catch (error) {
      window.alert(uiText.template.saveFailed(errorMessage(error)))
    }
  }

  async function handleSaveProjectFile(options: { saveAs?: boolean } = {}) {
    try {
      const nextDocument = updateActiveCutProjectInDocument(projectDocument, project, { sheetTemplate: template })
      if (!options.saveAs && projectFilePath && isXsrProjectFileName(projectFilePath)) {
        await writeProjectFile(projectFilePath, nextDocument, { createdWith: APP_VERSION })
        setProjectDocument(nextDocument)
        setSavedProjectDocumentSignature(JSON.stringify(nextDocument))
        return
      }
      const result = await saveProjectFile(nextDocument, projectFileName(nextDocument), {
        initialDirectory: preferredSaveDirectory(project),
        createdWith: APP_VERSION,
      })
      if (!result.saved) return
      if (result.path) setProjectFilePath(result.path)
      setProjectDocument(nextDocument)
      setSavedProjectDocumentSignature(JSON.stringify(nextDocument))
    } catch (error) {
      window.alert(uiText.project.saveFailed(errorMessage(error)))
    }
  }

  function handleUpdateCutMetadata(field: CutMetadataFieldId, value: string, customKey?: string) {
    commitProject(updateCutMetadata(project, field, value, customKey))
  }

  async function handleSaveCspImportPackage() {
    const plan = cspImportExport.state.plan
    if (cspImportExport.state.phase !== 'ready' || !plan || plan.blockingIssues.length > 0) return
    cspImportExport.markWriting(plan)
    try {
      const notice = await saveCspImportExportPlan(plan)
      setTimingExportDialog(null)
      setExportOperationNotice(notice)
    } catch (error) {
      cspImportExport.markError(errorMessage(error), plan)
    }
  }

  async function handleOpenExportDirectory() {
    if (!exportOperationNotice?.directoryPath) return
    try {
      await openCspImportExportDirectory(exportOperationNotice.directoryPath)
    } catch (error) {
      setStatusHint('sheet-drop', `書き出し先を開けませんでした: ${errorMessage(error)}`)
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
        initialDirectory: preferredSaveDirectory(project),
      })
      if (saved) setSheetImageExportDraft(null)
    } catch (error) {
      window.alert(uiText.export.saveFailed(errorMessage(error)))
    }
  }

  function handlePresetSelect(presetId: string) {
    const preset = sheetTemplatePresets.find(item => item.presetId === presetId)
    if (!preset) return
    rememberSheetTemplatePreset(appKind, preset.presetId)
    syncProjectToTemplateTracks(preset.sheetTemplate, {
      studioPresetId: preset.presetId,
      resetSheetView: true,
      commitTemplate: true,
    })
  }

  function syncProjectToTemplateTracks(
    nextTemplate: SheetTemplate,
    options: { studioPresetId?: string; resetSheetView?: boolean; commitTemplate?: boolean } = {},
  ) {
    const nextProjectWithTemplate = reprojectProjectToTemplate(
      stampAuxiliaryPlacementTemplate(project, project.sheetTemplateId ?? template.templateId),
      nextTemplate,
      { studioPresetId: options.studioPresetId, resetSheetView: options.resetSheetView },
    )
    if (options.commitTemplate) {
      projectRef.current = nextProjectWithTemplate
      commitWorkspace(nextProjectWithTemplate, nextTemplate)
    } else {
      commitProject(nextProjectWithTemplate)
    }
    clearSelectionState()
    setRecognitionCandidates([])
    setTextFontSizePx(defaultTimingTextFontSizePx(nextTemplate, 'cell'))
  }

  function handleUndo() { if (!activeSheetRevision.protected) setHistory(current => undoHistory(current)) }
  function handleRedo() { if (!activeSheetRevision.protected) setHistory(current => redoHistory(current)) }

  async function handleResetApp() {
    if (hasUnsavedProjectChanges) {
      const confirmed = await confirmUserAction('保存していない変更があります。新しいプロジェクトを作成しますか？', {
        title: '新規プロジェクト',
        okLabel: '新規作成',
      })
      if (!confirmed) return
    }
    const { project: nextProject, preset } = createPreferredProject(appKind)
    const nextDocument = createProjectDocumentFromCutProject(nextProject, { sheetTemplate: preset.sheetTemplate })
    setTemplate(preset.sheetTemplate)
    setProjectDocument(nextDocument)
    setSavedProjectDocumentSignature(JSON.stringify(nextDocument))
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
    setTextFontSizePx(defaultTimingTextFontSizePx(preset.sheetTemplate, 'cell'))
    clearSelectionState()
    setTimingClipboard(null)
    setValueDraft('')
    setValueDraftActive(false)
    setAssetDropMenu(null)
  }

  function handleAnnotation(stroke: AnnotationStroke) {
    commitProject(addAnnotation(project, stroke))
  }

  function handleCreateTimelineMemo(hit: SheetHit): string | null {
    const memo = createTimelineMemoForHit(project, template, hit, rangeSelection)
    if (!memo) return null
    commitProject(addTimelineMemo(project, memo))
    return memo.memoId
  }
  function handleCreateTimelineMemoForCue(cueId: string): string | null {
    const cue = project.timedRangeCues.find(item => item.cueId === cueId)
    if (!cue) return null
    const memo = createTimelineMemoForCue(project, template, cue)
    if (!memo) return null
    commitProject(addTimelineMemo(project, memo))
    return memo.memoId
  }
  function handleDeleteTimelineMemo(memoId: string) {
    const next = deleteTimelineMemo(project, memoId)
    if (next !== project) commitProject(next)
  }
  function handleUpdateTimelineMemoPlacement(memoId: string, placement: TimelineMemoPlacement) {
    const next = updateTimelineMemoPlacement(project, memoId, placement)
    if (next !== project) commitProject(next)
  }
  function handleAppendTimelineMemoStroke(memoId: string, stroke: Omit<TimelineMemoStroke, 'strokeId'>) {
    const memo = timelineMemos(project).find(item => item.memoId === memoId)
    if (!memo) return
    commitProject(appendTimelineMemoStroke(project, memoId, { ...stroke, strokeId: nextTimelineMemoStrokeId(memo) }))
  }
  function handleEraseTimelineMemoStroke(memoId: string, points: TimelineMemoPoint[], widthUnits: number) {
    const next = eraseTimelineMemoStrokes(project, { memoId, points, widthUnits })
    if (next !== project) commitProject(next)
  }
  function handleUpsertTimelineMemoText(memoId: string, text: TimelineMemoText, appearance: MemoAppearance) {
    const next = upsertTimelineMemoText(project, memoId, text, appearance)
    if (next !== project) commitProject(next)
  }
  function handleUpdateTimelineMemoAppearance(memoId: string, appearance: MemoAppearance) { const next = updateTimelineMemoAppearance(project, memoId, appearance); if (next !== project) commitProject(next) }
  function handleClearTimelineMemoStrokes(memoId: string) {
    const next = clearTimelineMemoStrokes(project, memoId)
    if (next !== project) commitProject(next)
  }

  function handleTextAnnotation(annotation: AnnotationText) {
    const nextProject = addAnnotation(project, annotation)
    commitProject(project.sheetView.activePageId === annotation.pageId
      ? nextProject
      : updateSheetViewState(nextProject, { activePageId: annotation.pageId }))
    selectTextAnnotationState(annotation, { edit: true })
  }

  function handleSelectTextAnnotation(annotationId: string) {
    const annotation = sheetAnnotations(project).find((item): item is AnnotationText => item.kind === 'text' && item.annotationId === annotationId)
    if (!annotation) return
    selectTextAnnotationState(annotation)
    if (project.sheetView.activePageId !== annotation.pageId) {
      commitProject(updateSheetViewState(project, { activePageId: annotation.pageId }))
    }
  }

  function handleEditTextAnnotation(annotationId: string) {
    const annotation = sheetAnnotations(project).find((item): item is AnnotationText => item.kind === 'text' && item.annotationId === annotationId)
    if (!annotation) return
    selectTextAnnotationState(annotation, { edit: true })
    if (project.sheetView.activePageId !== annotation.pageId) {
      commitProject(updateSheetViewState(project, { activePageId: annotation.pageId }))
    }
  }

  function selectTextAnnotationState(annotation: AnnotationText, options: { edit?: boolean } = {}) {
    setSelectedTextAnnotationId(annotation.annotationId)
    setEditingTextAnnotationId(options.edit ? annotation.annotationId : null)
    setMemoTextFontSizePx(resolveAnnotationTextFontSizePx(annotation, activeSheetPageSize))
    setSheetSelection({ kind: 'none' })
    setSelectedKeyId(null)
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
    const annotation = sheetAnnotations(project).find((item): item is AnnotationText => item.kind === 'text' && item.annotationId === annotationId)
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
      annotationId: nextAnnotationId(sheetAnnotations(project)),
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
    if (activeTextTarget.kind === 'timingEvent') {
      const nextProject = updateTimelineEventFontSize(project, activeTextTarget.eventId, nextSize)
      if (nextProject !== project) commitProject(nextProject)
    }
  }

  function handleMemoTextFontSizeChange(value: number) {
    const nextSize = clampTextFontSizePx(value)
    setMemoTextFontSizePx(nextSize)
    if (!selectedTextAnnotation) return
    handleUpdateTextAnnotation(selectedTextAnnotation.annotationId, { fontSizePx: nextSize })
  }

  function handleEraseAnnotation(pageId: string, points: AnnotationPoint[], width: number, target: SheetPageMemoTarget) {
    const nextProject = eraseAnnotations(project, { pageId, points, width, target })
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
      const candidates = await recognizeSheetPagesIfAvailable({
        template,
        pages,
        sheetRole: recognitionRole,
        durationFrames: sheetDisplayDurationFrames,
        frameOrigin: sheetDisplayFrameStart,
        paperTracks: templatePaperTracks(project, template).map(track => track.paperTrack),
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
    const hit = candidateToHit(template, sheetDisplayDurationFrames, sheetDisplayFrameStart, candidate)
    if (hit) setSelectionFromHit(hit, result.project, result.key?.keyId ?? null)
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
    if (last) {
      const hit = candidateToHit(template, logicalSheetDisplayDurationFrames(next.logicalSheet), logicalSheetDisplayFrameStart(next.logicalSheet), last)
      if (hit) setSelectionFromHit(hit, next)
    }
    setRecognitionCandidates(conflicts)
    setRecognitionMessage(conflicts.length > 0 ? uiText.recognition.conflictsRemain(conflicts.length) : null)
  }

  function updateRecognitionCandidateLabel(candidateId: string, value: string) {
    setRecognitionCandidates(current => current.map(candidate => candidate.candidateId === candidateId
      ? { ...candidate, normalizedLabel: normalizeRecognitionLabel(value) ?? value.trim() }
      : candidate))
  }
  function moveSelection(trackDelta: number, frameDelta: number, extendRange: boolean) {
    const sourceProject = commitTimingDraft(false)
    const role = rangeSelection?.role === 'action' || rangeSelection?.role === 'cell' ? rangeSelection.role : selection.hit ? sheetRoleForHit(selection.hit) : 'cell'
    const trackOrder = paperTrackOrderForRole(sourceProject, role)
    const result = navigatePointEventSelection({ template, durationFrames: sheetDisplayDurationFrames, frameOrigin: sheetDisplayFrameStart, currentHit: selection.hit, range: rangeSelection, paperTracks: trackOrder, trackDelta, frameDelta, extendRange })
    if (!result) return
    if (typeof result.focusHit.pageIndex === 'number') setActivePageIndex(result.focusHit.pageIndex, sourceProject)
    if (result.kind === 'range') setSelectionFromRange(result.range, sourceProject)
    else setSelectionFromHit(result.hit, sourceProject)
    setSheetScrollRequest(current => ({ requestId: (current?.requestId ?? 0) + 1, hit: result.focusHit }))
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
      if (handleTimedRangeKeyDown(event)) return
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
        if (event.shiftKey) handleRedo(); else handleUndo()
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
        if (selection.hit?.paperTrack && isTimingValueCharacter(event.key)) {
          event.preventDefault()
          handleTimingCharacterInput(event.key)
          return
        }
        if (event.key === 'Enter' && selection.hit?.paperTrack) {
          event.preventDefault()
          commitTimingDraft(true)
          return
        }
        if (selectedTextAnnotation && !editingTextAnnotation && (event.key === 'Enter' || event.key === 'F2')) {
          event.preventDefault()
          handleEditTextAnnotation(selectedTextAnnotation.annotationId)
          return
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          moveSelection(0, -1, event.shiftKey)
          return
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          moveSelection(0, 1, event.shiftKey)
          return
        }
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          moveSelection(-1, 0, event.shiftKey)
          return
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          moveSelection(1, 0, event.shiftKey)
          return
        }
        const mode = modeShortcut(event.key)
        if (mode) {
          event.preventDefault()
          setEditMode(mode)
          return
        }
      }
      if (event.key === 'Backspace' && valueDraftActive && selection.hit) {
        event.preventDefault()
        setValueDraft(current => current.slice(0, -1))
        return
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
        if (valueDraftActive && selection.hit) {
          const keyId = eventKeyIdAtHit(selection.hit)
          setValueDraft(keyDisplayLabelForId(keyId))
          setValueDraftActive(false)
          return
        }
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
  }, [assetDropMenu, setAssetDropMenu])

    return {
    appKind, collapseEditorSheetPanes, appProfile, history, paperSheetInputRef, project,
    template, templatePanelKey, runtimeSourceImageUrls, recognitionCandidates, setRecognitionCandidates, recognitionRole,
    setRecognitionRole, recognitionRunning, recognitionProgress, recognitionMessage, setRecognitionMessage, autoCalibrationRunning,
    autoCalibrationMessage, autoCalibrationOverlay, calibrationLoupeOpen, panel, editMode, setEditMode,
    zoom, setZoom, zoomMode, showTemplate, setShowTemplate, showTemplateGuides, setShowTemplateGuides,
    showTemplateLabels, setShowTemplateLabels, showInputContent, setShowInputContent,
    showAnnotations, setShowAnnotations, penColor, setPenColor, penWidth,
    setPenWidth, eraserWidth, setEraserWidth,
    selection, rangeSelection, selectedSoundCueId, selectedSoundCue, selectedCameraCueId, selectedCameraCue, valueDraft, valueDraftActive, sheetScrollRequest, timingClipboard,
    soundCueClipboard, soundCueDialog, setSoundCueDialog, soundLabelHistory,
    cameraCueClipboard, cameraCueDialog, setCameraCueDialog, cameraInstructionHistory, cameraPointLabelHistory, exportProfileId, sheetImageExportDraft,
    setSheetImageExportDraft, sheetLevelCorrectionDialogOpen, setSheetLevelCorrectionDialogOpen, appHelpDialogOpen, setAppHelpDialogOpen, timingExportDialog,
    setTimingExportDialog, cspImportExportState: cspImportExport.state, exportOperationNotice, setExportOperationNotice, xdtsImportDialog, setXdtsImportDialog, frameOperationDialog, setFrameOperationDialog, assetDropMenu, setAssetDropMenu, issues,
    projectDocumentSnapshot, projectCuts, sheetRevisions, activeSheetRevision, referenceProject, timingExportPlan, timingExportIssues, sheetPages, clampedActivePageIndex,
    activePage, activePageImage, hasRecognitionSheetImages, activeCorrectionLayerId, activeCorrectionLayer, materialAssets,
    issueErrorCount, issueWarningCount, activeCalibrationPoints, activeCalibrationPointsKey, selectedKeySummary,
    selectedFrameSummary, selectedTextAnnotation, editingTextAnnotation, activeTextFontSizePx, activeMemoTextFontSizePx, hasSelectedTextTarget, isTextFontSizeDisabled,
    setStatusHint, switchPanel, activeStatusHint, statusSelectionText, statusHintText, commitProject,
    recordDropDiagnostic, setActivePageIndex, updateTiming, updateTimingExportRole, updateTimingExportOptions, updateXdtsImportDialog, handleRangeSelect,
    handleCellClick, handleCellSelect, handleSetNullAtHit, handleSetTimingSpecialAtHit, handleDeleteEventAtHit, handleKeySelect, handleStackGuideSelect,
    handleSoundCueSelect, openSoundCueEditor, openSoundCueEditorForRange, submitSoundCueDialog, handleTransformSoundCue,
    handleCameraCueSelect, openCameraCueEditor, openCameraCueEditorForRange, submitCameraCueDialog, handleTransformCameraCue,
    handleActiveCorrectionLayerChange, handleClearSelection, startCalibrationWithLoupe, closeCalibrationLoupe, handleDeleteEvent, handleDeleteCspCard,
    copySelectedTimingRange, pasteTimingClipboard, copySelectedSoundCueRange, pasteSelectedSoundCueRange,
    copySelectedCameraCueRange, pasteSelectedCameraCueRange, openFrameOperationDialog, applyFrameOperation, handleSheetSourceFiles, openPaperSheetFilePicker,
    handleAssetSheetSources, handleAssignSheetSource, updateActivePageAlignment, activePageLevelCorrectionSettings, updateActivePageLevelCorrection, toggleActivePageLevelCorrection,
    updatePageCalibrationPoints, startSheetImageWarp, disableSheetImageWarp, applySheetImageWarp, autoDetectSheetImageWarp, handleAssetFiles,
    handleAssetNativePaths, handleAssetRootCandidates, handleChooseAssetRoot, handleAssetFileRefs, handleAssignAsset, handleAssignRegisteredCell,
    handleMoveTimelineEvent, handleApplyNameNormalization, handleAssignAssetToKey, assignAssetToKeySlot, handleUpdateKeyCspCellName, handleCreateUnplacedCspCard, handleRegisterKeyToCspTrack,
    handleMoveKeyBindingProcess, handleReorderCspStackItem, handleReorderProductionStage, handleReorderCorrectionLayer, handleDeleteCorrectionLayer, handleCreateStackGuideLabel, handleUpdateStackGuideLabel, handleDeleteStackGuideLabel, handleUpdateStackGuideRegistration,
    handleAssignAssetToStackGuide, handleAssignAssetsToStackGuide, handleRegisterAssetsToCspTrack, handleRegisterAssetsToNewCspTrack, handleAddOverlayPaperTrack, handleUpdatePaperTrack,
    handleDeleteOverlayPaperTrack, handleAddTimelineLane, handleUpdateTimelineLane, handleDeleteTimelineLane, handleUpdateCorrectionLayers, handleRenameProductionStage, handleRenameCorrectionLayer, handleLoadProject, handleLoadTemplate, handleImportTemplate, handleLoadXdts, confirmXdtsImport, handleApplyTemplateDraft, handleCreateTemplateDraft,
    handleCreatePaperTemplateFromImage, handleSaveTemplateJson, handleSaveProjectFile, handleUpdateCutMetadata, handleSwitchProjectCut,
    handleAddSharedCut, handleDeleteSharedCut, handleSwitchSheetRevision, handleAddSheetRevision, handleRenameSheetRevision, handleToggleSheetRevisionProtected, handleToggleSheetRevisionSourceReference, handleDeleteSheetRevision,
    openTimingExportDialog, confirmTimingExport, handleSaveXdts, handleSaveCspImportPackage, handleOpenExportDirectory, handleOpenSheetImageExport, handleSaveSheetImageExport, handlePresetSelect,
    handleUndo, handleRedo, handleResetApp, handleAnnotation, handleCreateTimelineMemo, handleCreateTimelineMemoForCue, handleDeleteTimelineMemo, handleUpdateTimelineMemoPlacement, handleAppendTimelineMemoStroke, handleEraseTimelineMemoStroke, handleUpsertTimelineMemoText, handleUpdateTimelineMemoAppearance, handleClearTimelineMemoStrokes, handleTextAnnotation, handleSelectTextAnnotation,
    handleEditTextAnnotation, handleUpdateTextAnnotation, handleCommitTextAnnotation, handleCancelTextAnnotation, handleCommitFocusedTextAnnotationDraft, handleTextFontSizeChange, handleMemoTextFontSizeChange,
    handleEraseAnnotation, handleRecognizeSheet, acceptRecognitionCandidate, acceptAllRecognitionCandidates, updateRecognitionCandidateLabel,
  }
}
export type AppController = ReturnType<typeof useAppController>
