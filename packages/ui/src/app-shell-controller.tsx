import { useBrowserFileOwnership } from './useBrowserFileOwnership'
import { planPaperTranscriptionImport, type PaperTranscriptionImportOptions, type PaperTranscriptionRequest, type PaperTranscriptionResult } from '@xsheet-remap/core'
import { isCompositionKey } from './compositionKeyboard'
import { baseTimingProcessId, baseTimingProject, setBaseTimingProcess, remapClipTracks, type ClipTrackCorrespondence } from '@xsheet-remap/core'
import { applySheetLabelNormalizationPlan, updateSheetKeyDisplayLabel, type SheetLabelNormalizationPlan } from '@xsheet-remap/core'
import type { CutGroupProjectDocument } from '@xsheet-remap/core'
import { nextProjectTimingHit } from './sheetTimingNavigation'
import { projectTimingHitForFrame } from './sheet-layers-hit-geometry'
import { setTimingReferenceAt, setTimingReferenceRange } from '@xsheet-remap/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RemapWorkMode } from './RemapWorkspaceBar'
import type { PendingClipImageDrop } from './ClipImageDropDialog'
import { addTimelineMemo, appendTimelineMemoStroke, clearTimelineMemoStrokes, deleteTimelineMemo, eraseTimelineMemoStrokes, nextTimelineMemoStrokeId, updateTimelineMemoAppearance, updateTimelineMemoPlacement, upsertTimelineMemoText, type MemoAppearance, type TimelineMemoPlacement, type TimelineMemoPoint, type TimelineMemoStroke, type TimelineMemoText } from '@xsheet-remap/core';
import { addAnnotation, addOverlayPaperTrack, addOverlayPaperTrackAtCspTop, assignSheetSourceToPage, applyNameNormalizationPlan, activeCutProjectFromDocument, assetAbsolutePath, buildExportPlan, clearEvent, commitHistory, createUnplacedCspCard, createStackGuideLabel, createStackGuideLabelAtCspCellBottom, createSheetPages, createProjectDocumentFromCutProject, createProjectHistory, DEFAULT_PRE_ROLL_FRAMES, deleteOverlayPaperTrack, deleteStackGuideLabel, eraseAnnotations, type CorrectionLayer, type CutMetadataFieldId, type CutProject, type AnnotationPoint, type AnnotationStroke, type AnnotationText, type FileRef, type NameNormalizationPlan, type SheetHit, type SheetImageAlignment, type SheetCalibrationPointPair, type SheetPage, type SheetPageMemoTarget, type SheetTemplate, type SheetTimingRole, type StackGuideLabel, projectSheetLayoutOptions, redoHistory, registerAssetsToCspTrack, removeCellBinding, removeSheetSource, reorderCorrectionLayer, reorderProductionStage, reprojectProjectToTemplate, resolveSheetTemplatePageSize, sheetTimingRoleForEvent, sheetTemplatePresets, timelineLanesForLayout, undoHistory, updateCorrectionLayers, updateProductionStageLabel, updatePaperTrack, updateLogicalSheetSettings, updateStackGuideLabel, updateSheetPageViewState, updateSheetViewState, upsertBinding, assignAssetToStackGuideLabel, updateStackGuideRegistration, validateProject, registerAsset, registerSheetSource, synchronizeAssetRoot, type CutAsset, hitTestSheetTemplate, isSpecialTimingKeyId, logicalSheetDisplayDurationFrames, logicalSheetDisplayFrameEnd, logicalSheetDisplayFrameStart, moveBindingToCorrectionLayer, updateActiveCutProjectInDocument, sheetAnnotations, timelineMemos } from '@xsheet-remap/core';
import { collectAssetPathDrop, confirmUserAction, filesToFileRefs, releaseBrowserFileRefs, retainBrowserFiles, isTauriHost, nativeFileSource, openAssetRootDirectory, openImageFileRefs, renameMaterialFiles, saveJsonFile, statNativePaths, subscribeNativeDragDrop, type AssetRootCandidate, type NativeDragDropPayload } from '@xsheet-remap/adapters';
import { clipLayerDropAtElement, publishNativeLayerHover } from './clipLayerDrop';
import { updateNativeFileDragPreview, avoidNativeFileDragPreview, clearNativeFileDragPreview } from './nativeFileDragPreview'
import { projectDocumentsEqual } from './projectDocumentEquality';
import { addClipImages, bindClipCel, clipCelSheetDestination, clipSheetKeyAtFrame, selectTimingProcess, ensureClipDocument, synchronizeClipBindings, updateClipLayer } from '@xsheet-remap/core'
import { clipImageDataUrl } from './clipImageImport'
import { updateCutMetadata } from './cutMetadata';
import { uiText } from './i18n';
import { type Panel, type SheetRangeSelection, type TimingClipboard, type TimingPasteContent, type TimingPasteMode } from './appTypes';
import { loadProjectDocumentFile, projectRuntimeSourceImageUrls } from './projectFileModel';
import { type DropDiagnosticReport } from './AssetBrowser';
import { defaultLevelCorrectionSettings, normalizeLevelCorrectionSettings, type LevelCorrectionSettings } from './levelCorrection';
import { compareAssetNames, compareFileNames, isImageAssetFile, sheetImageRefFromAsset } from './assetFiles';
import { bindAssetToHit, isCellMaterialAsset } from './sheetAssets';
import { runDesktopE2EIfRequested } from './desktopE2E';
import { clampTextFontSizePx, defaultTimingTextFontSizePx, resolveTimingTextFontSizePx } from './sheetTextLayout';
import { resolveAnnotationTextFontSizePx } from './annotationTextLayout';
import { calibrationPointsForSettings, getSheetPageImage } from './sheetImages';
import { clampNumber, isTimingValueCharacter, modeShortcut, navigatePointEventSelection, rangeSelectionFromHits, sheetRoleForHit, sheetRoleLabel } from './sheetInteraction';
import { canPasteTimingClipboardMode, buildTimingClipboard, clearTimingRange, isPointEventRangeForUi, moveTimingEventsInRange, pasteResultRange, pasteTimingClipboardToProject, rangeContainsHit, rangePaperTracks, rippleDeleteTimingRange, timingPasteTarget, timingRangeSelectionForMoveResult } from './timingEditing';
import { detectSheetCalibrationPoints } from './sheetAutoCalibration';
import { calibrationPointsSignature } from './sheetCalibrationUtils';
import { type CspTreeAssetRegistrationResult, type CspTreeNewTrackRegistrationInput } from './CspLayerTree';
import { createTemplateDraft, templateJsonFileName, type TemplateDraftKind } from './templateDrafts';
import { APP_PROFILES, ActiveTextTarget, FrameOperationKind, FrameOperationSubmit, MainAppKind, StackGuideLabelUpdates, StatusHintSource, TextAnnotationUpdate, activeStatusHintText, alertMissingProjectNativePaths, clientPointCandidatesFromNativeDropPosition, errorMessage, isImageFileRef, preferredSaveDirectory, timelineEventAtHit } from './app-foundation';
import { assignRegisteredCellKeyToHit, bindingProcessMoveTarget, cloneTextAnnotationForPaste, deleteTextAnnotation, frameOriginForPageHit, materializePageHit, nextAnnotationId, processSlotsForKey, updateTextAnnotation, updateTimelineEventFontSize } from './app-sheet-layers';
import { paperTrackOrderForRole, stampAuxiliaryPlacementTemplate, templatePaperTracks } from './app-sheet-geometry';
import { automaticRegisteredCellCspName, firstTimelineUseForKey, registeredCellTrackOrder, reorderCspStackItem, updateNativeRegisteredCellPreviewIfOpen, updateNativeStackGuidePreviewIfOpen } from './app-registered-cells';
import { setTimingValueAt } from './sheet-timing-input';
import { calibrationCornersForTemplate, calibrationCornersFromPoints, shouldAutoCalibrateImportedSheetSources } from './app-navigation';
import { DEFAULT_PEN_COLOR, DEFAULT_PEN_WIDTH, useAppShellState } from './app-shell-state'
import { isAssetBrowserNativeDropTarget, nativeCspDropTarget } from './nativeFileDropTargets'
import { deleteRegisteredCellKey } from './stack-guides-paper-track'
import { createAppTimedRangeControllers } from './app-timed-range-controllers'
import { applyFrameOperationToProject, frameOperationDialogStateForHit, pointRoleForFrameOperation } from './frameOperations'
import { buildSelectionPresentation, inputHitForRange } from './app-selection-presentation'
import { timelineMemoSegmentsForPage } from './timelineMemoGeometry'
import { timelineMemoFontSizeUnitsForPx } from './timelineMemoTextLayout'
import { normalizeMemoAppearance, type TimelineInkMemo } from '@xsheet-remap/core'
import { createTimelineMemoForCue, createTimelineMemoForHit } from './timelineMemoEditing'
import { createAppXdtsActions } from './app-xdts-actions'
import { useAppAfterEffectsActions } from './app-after-effects-actions'
import { confirmSheetTemplateImport, loadSheetTemplate } from './app-template-import'
import { useAppSheetHistoryController } from './app-sheet-history-actions'
import { createAppSharedCutActions } from './app-shared-cut-actions'
import { openDirectoryInFileManager } from '@xsheet-remap/adapters'
import { createPreferredProject, rememberSheetTemplatePreset } from './mainAppPreferences'
import { createAppTimelineLaneActions } from './app-timeline-lane-actions'
import { createAppDialogueAudioActions } from './app-dialogue-audio-actions'
import { applyTimingEditSession } from './timingEditSession'
import { createAppProjectPersistenceActions } from './app-project-persistence-actions'
import { useTimingEditOperationBoundaries } from './useTimingEditOperationBoundaries'
import { handleWorkspaceKeyboardBoundary, nextSoundCueNavigationRequest, resolveWorkspaceKeyboardOwner } from './workspaceInteractionPolicy'
import { eventKeyIdAtSheetHit, timingKeyAtSheetHit, timingKeyDisplayLabel } from './workspaceSelectionModel'
import { EMPTY_DIALOGUE_AUDIO_SELECTION } from './dialogueAudioSelectionModel'
import { useSheetRenderModelGeometryProject } from './useSheetRenderModelProject'
import { IMPORTED_SHEET_IMAGE_INITIAL_OPACITY, importPaperSheetSourceRefs, paperSheetImportPlan, type ImportedSheetSourceCalibrationResult, type ImportedSheetSourceCalibrationTarget } from './paperSheetImport'
import { applyDetectedPaperSheetCalibration, paperSheetCalibrationSourceIdentity } from './paperSheetAutoCalibration'
import { createAppDialogueAudioExportAction } from './app-dialogue-audio-export-actions'
export interface AppControllerOptions { appKind?: MainAppKind; collapseEditorSheetPanes?: boolean }
type PaperSheetEditContext = { document: object; cutId: string; revisionId: string; template: SheetTemplate }
export function useAppController({ appKind = 'editor', collapseEditorSheetPanes = false }: AppControllerOptions = {}) {
  const appProfile = APP_PROFILES[appKind]
  const {
    history, setHistory, selectWorkspaceProcess, commitWorkspace, commitProjectDocument, replaceProjectDocument, projectDocument, setProjectDocument, savedProjectDocumentSnapshot, setSavedProjectDocumentSnapshot, projectFilePath, setProjectFilePath, paperSheetInputRef, project, projectRef, template, setTemplate,
    runtimeSourceImageUrls, setRuntimeSourceImageUrls,
    autoCalibrationRunning, setAutoCalibrationRunning, autoCalibrationMessage, setAutoCalibrationMessage, autoCalibrationOverlay, setAutoCalibrationOverlay,
    calibrationLoupeOpen, setCalibrationLoupeOpen, panel, setPanel, editMode, setEditMode, zoom, setZoom, zoomMode, setZoomMode,
    showTemplate, setShowTemplate, showTemplateGuides, setShowTemplateGuides, showTemplateLabels, setShowTemplateLabels,
    showInputContent, setShowInputContent, showAnnotations, setShowAnnotations, penColor, setPenColor,
    penWidth, setPenWidth, eraserWidth, setEraserWidth, textFontSizePx, setTextFontSizePx, memoTextFontSizePx, setMemoTextFontSizePx, memoWritingMode, setMemoWritingMode, selectedTextAnnotationId, setSelectedTextAnnotationId,
    editingTextAnnotationId, setEditingTextAnnotationId, textAnnotationClipboard, setTextAnnotationClipboard, sheetSelection, setSheetSelection,
    dialogueAudioSelection, setDialogueAudioSelection, workspaceFocusOwner, setWorkspaceFocusOwner,
    audioPlayheadStore, soundCueNavigationRequest, setSoundCueNavigationRequest,
    selectedKeyId, setSelectedKeyId, sheetScrollRequest, setSheetScrollRequest, timingClipboard, setTimingClipboard,
    soundCueClipboard, setSoundCueClipboard, soundCueDialog, setSoundCueDialog, soundLabelHistory, setSoundLabelHistory,
    cameraCueClipboard, setCameraCueClipboard, cameraCueDialog, setCameraCueDialog,
    cameraInstructionHistory, setCameraInstructionHistory, cameraPointLabelHistory, setCameraPointLabelHistory,
    statusHints, setStatusHints,
    timingEditSession, timingEditSessionRef, setTimingEditSession, sheetImageExportDraft, setSheetImageExportDraft,
    sheetLevelCorrectionDialogOpen, setSheetLevelCorrectionDialogOpen, appHelpDialogOpen, setAppHelpDialogOpen,
    timingExportDialog, setTimingExportDialog, exportOperationNotice, setExportOperationNotice, xdtsImportDialog, setXdtsImportDialog, clipImportFile, setClipImportFile, frameOperationDialog, setFrameOperationDialog, assetDropMenu, setAssetDropMenu,
    releaseBrowserFilesAfterCommit, workMode, setWorkMode, activeCorrectionLayerIdState, setActiveCorrectionLayerIdState, nativeFileDropHandlerRef, nativeDragDropPayloadHandlerRef, nativeFileDropDedupeRef,
  } = useAppShellState(appKind)
  const [pendingClipImageDrop, setPendingClipImageDrop] = useState<PendingClipImageDrop | null>(null)
  if (pendingClipImageDrop && (pendingClipImageDrop.source !== project || workMode !== 'clip')) setPendingClipImageDrop(null)
  useBrowserFileOwnership(pendingClipImageDrop?.source === project && workMode === 'clip' ? pendingClipImageDrop : null)
  const clipImportContext = useRef<object>({})
  const workModeRef = useRef(workMode)
  workModeRef.current = workMode
  const valueDraft = timingEditSession?.value ?? ''
  const valueDraftActive = timingEditSession !== null
  const exportProfileId = 'import-stack'
  const issues = useMemo(() => validateProject(project, project.exportProfiles.find(profile => profile.profileId === exportProfileId)), [project, exportProfileId])
  const projectDocumentSnapshot = useMemo(() => updateActiveCutProjectInDocument(projectDocument, project, { sheetTemplate: template }), [projectDocument, project, template])
  const { resolvedProjectDocument, handleSaveProjectFile, handleOpenSheetImageExport, handleSaveSheetImageExport, handleSaveCorrectedSheetImages } = createAppProjectPersistenceActions({
    releaseAfterCommit: releaseBrowserFilesAfterCommit, projectDocument, template, resolveProject: () => commitTimingDraft(false), projectFilePath,
    setProjectFilePath, setProjectDocument, setSavedProjectDocumentSnapshot, runtimeSourceImageUrls, setSheetImageExportDraft,
  })
  const handleSaveDialogueAudioTracks = createAppDialogueAudioExportAction(project, setExportOperationNotice)
  const hasUnsavedProjectChanges = useMemo(
    () => timingEditSession !== null || !projectDocumentsEqual(projectDocumentSnapshot, savedProjectDocumentSnapshot),
    [projectDocumentSnapshot, savedProjectDocumentSnapshot, timingEditSession],
  )
  const projectCuts = projectDocumentSnapshot.cuts
  const {
    activeSheetRevision, sheetRevisions, referenceProject,
    handleSwitchSheetRevision, handleAddSheetRevision, handleRenameSheetRevision,
    handleToggleSheetRevisionProtected, handleToggleSheetRevisionSourceReference, handleDeleteSheetRevision,
  } = useAppSheetHistoryController({
    projectDocument: projectDocumentSnapshot, project, resolveProject: () => commitTimingDraft(false), setProjectDocument, setHistory, projectRef,
    setActiveCorrectionLayerId: setActiveCorrectionLayerIdState,
    setRuntimeSourceImageUrls, clearSelection: clearSelectionState, alertError: error => window.alert(errorMessage(error)),
  })
  const paperSheetEditContextRef = useRef<PaperSheetEditContext>({ document: projectDocument, cutId: projectDocumentSnapshot.activeCutId, revisionId: activeSheetRevision.revisionId, template })
  const protectedRevisionRef = useRef(activeSheetRevision.protected)
  protectedRevisionRef.current = activeSheetRevision.protected
  paperSheetEditContextRef.current = { document: projectDocument, cutId: projectDocumentSnapshot.activeCutId, revisionId: activeSheetRevision.revisionId, template }
  const { handleSwitchProjectCut, handleAddSharedCut, handleDeleteSharedCut } = createAppSharedCutActions({
    projectDocument: projectDocumentSnapshot, resolveProject: () => commitTimingDraft(false), template, setProjectDocument, setHistory, projectRef,
    setActiveCorrectionLayerId: setActiveCorrectionLayerIdState,
    setRuntimeSourceImageUrls, clearSelection: clearSelectionState, alertError: error => window.alert(errorMessage(error)),
  })
  const timingExportPlan = useMemo(() => timingExportDialog && timingExportDialog.kind !== 'ae-jsx' && timingExportDialog.kind !== 'ae-send' ? buildExportPlan(project, { profileId: exportProfileId, timingSourceRole: timingExportDialog.timingSourceRole, sheetTemplate: template }) : null, [exportProfileId, project, template, timingExportDialog])
  const timingExportIssues = useMemo(() => timingExportPlan?.validation ?? [], [timingExportPlan])
  const { canSendToAfterEffects, afterEffectsSending, handleCopyAeKeyframeData, handleSaveAeJsx, handleSendAfterEffects } = useAppAfterEffectsActions({
    project, resolveProject: () => commitTimingDraft(false), setExportOperationNotice,
    onSendAccepted: () => setTimingExportDialog(null),
  })
  const {
    openTimingExportDialog, updateTimingExportRole, updateTimingExportOptions, confirmTimingExport,
    handleSaveXdts, handleLoadXdts, updateXdtsImportDialog, confirmXdtsImport,
  } = createAppXdtsActions({
    project,
    resolveProject: () => commitTimingDraft(false),
    getProjectDocument: resolvedProjectDocument,
    exportProfileId,
    timingExportDialog,
    setTimingExportDialog,
    xdtsImportDialog,
    setXdtsImportDialog,
    commitProject,
    clearSelection: clearSelectionState,
    saveAfterEffectsJsx: handleSaveAeJsx,
    sendAfterEffectsRemap: handleSendAfterEffects,
  })
  const sheetDisplayFrameStart = logicalSheetDisplayFrameStart(project.logicalSheet)
  function handleLoadClip(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    commitTimingDraft(false)
    setClipImportFile(file)
  }
  async function handleImportClip(document: CutGroupProjectDocument) {
    if (hasUnsavedProjectChanges && !await confirmUserAction('保存していない変更があります。現在のプロジェクトを閉じて、このCLIPを開きますか？', { title: 'CLIPを開く', okLabel: '開く' })) return
    const next = replaceProjectDocument(document)
    projectRef.current = next
    clearSelectionState()
    setRuntimeSourceImageUrls({})
    setAutoCalibrationOverlay(null)
    setAssetDropMenu(null)
    setProjectFilePath(null)
    setActiveCorrectionLayerIdState(baseTimingProcessId(next))
    resetClipWorkspaceView('clip')
    setClipImportFile(null)
    setExportOperationNotice({ message: 'CLIPのレイヤー構造とタイムラインを開きました。' })
  }
  const sheetDisplayFrameEnd = logicalSheetDisplayFrameEnd(project.logicalSheet)
  const sheetDisplayDurationFrames = logicalSheetDisplayDurationFrames(project.logicalSheet)
  const sheetPages = useMemo(() => createSheetPages(template, sheetDisplayDurationFrames, sheetDisplayFrameStart), [template, sheetDisplayDurationFrames, sheetDisplayFrameStart])
  const activeSheetGeometryProject = useSheetRenderModelGeometryProject(project)
  const rangeSelection = sheetSelection.kind === 'range' ? sheetSelection.range : null
  const selectedTimedRangeCueId = sheetSelection.kind === 'cue' ? sheetSelection.cueId : null
  const dialogueAudioActions = createAppDialogueAudioActions({
    projectRef, template, revisionId: activeSheetRevision.revisionId,
    frameMin: sheetDisplayFrameStart, frameMax: sheetDisplayFrameEnd,
    setSoundCueDialog, commitProject, replaceProject, onPlacementConflict: message => window.alert(message),
  })
  const {
    handleCutStateChange: handleDialogueAudioCutStateChange,
    openSoundCueEditorForAudioCandidate, autoCreateDialogueRegions: handleAutoCreateDialogueRegions,
    applyCandidateLink: applyDialogueAudioCandidateLink,
    applySoundCueProjectChange,
    reconcileAfterSheetRangeChange: reconcileDialogueAudioAfterSheetRangeChange,
  } = dialogueAudioActions
  const {
    selectedTimedRangeCue, selectedSoundCueId, selectedSoundCue, selectedCameraCueId, selectedCameraCue,
    soundCueController, cameraCueController,
    handleTimedRangeKeyDown,
    handleSoundCueSelect: selectSoundCue, openSoundCueEditor, openSoundCueEditorForRange, submitSoundCueDialog, handleTransformSoundCue, copySelectedSoundCueRange, pasteSelectedSoundCueRange,
    handleCameraCueSelect, openCameraCueEditor, openCameraCueEditorForRange, submitCameraCueDialog, handleTransformCameraCue, copySelectedCameraCueRange, pasteSelectedCameraCueRange,
  } = createAppTimedRangeControllers({
    project, getProject: () => projectRef.current, template, rangeSelection, selectedCueId: selectedTimedRangeCueId,
    soundClipboard: soundCueClipboard, cameraClipboard: cameraCueClipboard,
    frameMin: sheetDisplayFrameStart, frameMax: sheetDisplayFrameEnd, commitProject, commitTimingDraft, cancelTimingDraft,
    clearSelection: clearSelectionState, selectRange: setSelectionFromRange,
    setSelectedTextAnnotationId, setSelectedKeyId, setSheetSelection,
    setSoundClipboard: setSoundCueClipboard, setSoundDialog: setSoundCueDialog, setSoundLabelHistory,
    soundDialog: soundCueDialog,
    applyAudioCandidateLink: applyDialogueAudioCandidateLink,
    applySoundCueProjectChange,
    onSoundCuePlacementConflict: message => window.alert(message),
    setCameraClipboard: setCameraCueClipboard, setCameraDialog: setCameraCueDialog,
    setCameraInstructionHistory, setCameraPointLabelHistory,
  })
  const selectedHit = sheetSelection.kind === 'cell'
    ? sheetSelection.hit
    : sheetSelection.kind === 'range'
      ? inputHitForRange(project, template, sheetSelection.range)
      : null
  const selection = { hit: selectedHit, keyId: selectedKeyId }
  const audioPlayheadFrame = project.logicalSheet.frameOrigin
  const sheetSourceRuntimePathEntries = useMemo(() => {
    const assetPathById = new Map(project.assets.map(asset => [asset.assetId, assetAbsolutePath(asset, project.assetRoot)]))
    return project.sheetView.sources.flatMap(source => {
      if (source.kind !== 'sheet-scan') return []
      const path = source.imageRef.path ?? (source.assetId ? assetPathById.get(source.assetId) : undefined)
      return path ? [{ sourceId: source.sourceId, path }] : []
    })
  }, [project.assetRoot, project.assets, project.sheetView.sources])
  const sheetSourceRuntimeAssetEntries = useMemo(() => {
    const thumbnailByAssetId = new Map(project.assets.map(asset => [asset.assetId, asset.thumbnailUrl]))
    return project.sheetView.sources.map(source => ({
      sourceId: source.sourceId,
      imageUrl: source.assetId ? thumbnailByAssetId.get(source.assetId) : undefined,
    }))
  }, [project.assets, project.sheetView.sources])
  const activeSheetLayoutOptions = useMemo(() => projectSheetLayoutOptions(activeSheetGeometryProject, template), [activeSheetGeometryProject, template])
  const activeSheetPageSize = useMemo(
    () => resolveSheetTemplatePageSize(template, sheetDisplayDurationFrames, activeSheetLayoutOptions),
    [activeSheetLayoutOptions, sheetDisplayDurationFrames, template],
  )
  const activePageIndexFromState = Math.max(0, sheetPages.findIndex(page => page.pageId === project.sheetView.activePageId))
  const clampedActivePageIndex = Math.min(activePageIndexFromState, Math.max(0, sheetPages.length - 1))
  const activePage = sheetPages[clampedActivePageIndex] ?? sheetPages[0]
  const activePageImage = getSheetPageImage(project.sheetView, runtimeSourceImageUrls, activePage?.pageId ?? 'page_1', template)
  const selectedKey = selection.keyId ? project.logicalSheet.keys.find(key => key.keyId === selection.keyId) ?? null : null
  const baseProcessId = baseTimingProcessId(project)
  const fallbackCorrectionLayerId = baseProcessId
  const newImageProcessId = workMode === 'clip' && project.logicalSheet.processTimings ? project.logicalSheet.processTimings.activeProcessId : project.correctionLayers.some(layer => layer.layerId === activeCorrectionLayerIdState)
    ? activeCorrectionLayerIdState
    : fallbackCorrectionLayerId
  const activeCorrectionLayerId = project.logicalSheet.processTimings?.activeProcessId ?? (appKind === 'remap' && workMode === 'sheet' ? baseProcessId : newImageProcessId)
  const activeCorrectionLayer = project.correctionLayers.find(layer => layer.layerId === activeCorrectionLayerId) ?? null
  const materialAssets = useMemo(() => project.assets.filter(isCellMaterialAsset), [project.assets])
  const issueErrorCount = issues.filter(issue => issue.severity === 'error').length
  const issueWarningCount = issues.filter(issue => issue.severity === 'warning').length
  const activeCalibrationPoints = activePage ? calibrationPointsForSettings(activePageImage.settings, template) : []
  const activeCalibrationPointsKey = calibrationPointsSignature(activeCalibrationPoints)
  const selectedKeySummary = selection.keyId
    ? isSpecialTimingKeyId(selection.keyId)
      ? timingKeyDisplayLabel(project, selection.keyId)
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
  const setPanelView = useCallback((nextPanel: Panel) => {
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
    setTimingEditSession(null)
  }, [selectedTimedRangeCue, selectedTimedRangeCueId, setSelectedKeyId, setSheetSelection, setTimingEditSession])
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
        setPanelView(initialPanel)
        setActiveCorrectionLayerIdState(baseTimingProcessId(nextProject))
      },
    })
  }, [setActiveCorrectionLayerIdState, setHistory, setPanelView, setProjectDocument, setProjectFilePath, setTemplate, setTextFontSizePx])

  useEffect(() => {
    setRuntimeSourceImageUrls(current => {
      let changed = false
      const next = { ...current }
      for (const entry of sheetSourceRuntimeAssetEntries) {
        if (entry.imageUrl ? next[entry.sourceId] === entry.imageUrl : !(entry.sourceId in next)) continue
        if (entry.imageUrl) next[entry.sourceId] = entry.imageUrl
        else delete next[entry.sourceId]
        changed = true
      }
      return changed ? next : current
    })
  }, [setRuntimeSourceImageUrls, sheetSourceRuntimeAssetEntries])
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
    if (protectedRevisionRef.current) {
      window.alert('このシートは編集保護中です。シート履歴のメニューから保護を解除してください。')
      return false
    }
    nextProject = synchronizeClipBindings(nextProject)
    if (nextProject.logicalSheet.processTimings && nextProject.correctionLayers !== projectRef.current.correctionLayers) updateActiveCutProjectInDocument(projectDocument, nextProject)
    const previousProcess = projectRef.current.logicalSheet.processTimings?.activeProcessId
    projectRef.current = nextProject
    setHistory(current => commitHistory(current, nextProject))
    const nextProcess = nextProject.logicalSheet.processTimings?.activeProcessId
    if (nextProcess && nextProcess !== previousProcess) selectWorkspaceProcess(nextProcess)
    if (selectionIsOutsideProjectDisplay(nextProject)) clearSelectionState()
    return true
  }

  function replaceProject(nextProject: CutProject) { projectRef.current = nextProject; setHistory(current => current.present === nextProject ? current : { ...current, present: nextProject }) }

  function handleApplyPaperTranscription(request: PaperTranscriptionRequest, result: PaperTranscriptionResult, options: PaperTranscriptionImportOptions) {
    if (protectedRevisionRef.current) throw new Error('このシートは編集保護中です。シート履歴のメニューから保護を解除してください。')
    const source = commitTimingDraft(false)
    const scopeKey = `${projectDocumentSnapshot.activeCutId}:${activeSheetRevision.revisionId}`
    const plan = planPaperTranscriptionImport(source, template, scopeKey, request, result, options)
    if (plan.changed) commitProject(plan.project)
  }

  async function handleNativeFileDrop(paths: string[], position: { x: number; y: number }) {
    const clientPoints = clientPointCandidatesFromNativeDropPosition(position)
    if (projectRef.current.clipDocument) {
      if (!allowClipImageImport()) return
      const source = commitTimingDraft(false), processId = newImageProcessId, context = clipImportContext.current
      const layerTarget = clientPoints.map(point => clipLayerDropAtElement(source.clipDocument!, document.elementFromPoint(point.x, point.y), point.y)).find(Boolean)
      const hit = clientPoints.map(point => nativeSheetHitFromClientPoint(point.x, point.y)).find(Boolean) ?? null
      if (!layerTarget && !hit) return
      try {
        const collection = await collectAssetPathDrop(paths, { recursive: true })
        await importClipImageRefs(source, collection.files, layerTarget?.parentId ?? null, layerTarget ? null : hit, processId, layerTarget?.beforeId, context)
      } catch (error) { setStatusHint('sheet-drop', errorMessage(error)) }
      return
    }
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
    const clipDocument = projectRef.current.clipDocument
    const points = clientPointCandidatesFromNativeDropPosition(position)
    if (clipDocument) {
      const point = points.find(point => document.elementFromPoint(point.x, point.y)?.closest('.clipLayerPanel') || nativeSheetHitFromClientPoint(point.x, point.y)) ?? points[0] ?? position
      const hit = nativeSheetHitFromClientPoint(point.x, point.y)
      updateNativeFileDragPreview(payload, point, hit, workMode === 'clip' && !protectedRevisionRef.current)
      const row = document.elementFromPoint(point.x, point.y)?.closest('[data-clip-layer-id]')
      if (row) avoidNativeFileDragPreview(row.getBoundingClientRect())
    }
    if (payload.type === 'leave' || payload.type === 'drop') setStatusHint('sheet-drop', null)
    if (clipDocument) publishNativeLayerHover(payload.type === 'enter' || payload.type === 'over'
      ? clientPointCandidatesFromNativeDropPosition(position).map(point => clipLayerDropAtElement(clipDocument, document.elementFromPoint(point.x, point.y), point.y)).find(Boolean) ?? null
      : null)
    if (clipDocument && (payload.type === 'enter' || payload.type === 'over')) {
      const hit = clientPointCandidatesFromNativeDropPosition(position).map(point => nativeSheetHitFromClientPoint(point.x, point.y)).find(Boolean)
      if (hit?.paperTrack) {
        const process = project.correctionLayers.find(process => process.layerId === newImageProcessId)
        const key = clipSheetKeyAtFrame(selectTimingProcess(project, newImageProcessId), hit.paperTrack, hit.frame, hit.role === 'cell' ? 'cell' : 'action')
        setStatusHint('sheet-drop', workMode === 'clip' ? `${process?.label} / ${hit.paperTrack}${key ? ` / ${key.displayLabel}（登録先・差し替えを選択）` : 'へ新規登録'}` : '画像を登録するには「CLIP組み立て」に切り替えてください。')
      }
    }
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
      clearNativeFileDragPreview()
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
    setDialogueAudioSelection(EMPTY_DIALOGUE_AUDIO_SELECTION)
    setWorkspaceFocusOwner('none')
    setSelectedKeyId(null)
    setSelectedTextAnnotationId(null)
    setEditingTextAnnotationId(null)
    setTimingEditSession(null)
  }

  function setActivePageIndex(pageIndex: number, sourceProject: CutProject = project) {
    const page = sheetPages[pageIndex]
    if (!page || sourceProject.sheetView.activePageId === page.pageId) return
    commitProject(updateSheetViewState(sourceProject, { activePageId: page.pageId }))
  }

  function updateTiming(updates: Parameters<typeof updateLogicalSheetSettings>[1]) {
    runProjectCommand(sourceProject => updateLogicalSheetSettings(sourceProject, updates.workRange
      ? { ...updates, workRange: { ...updates.workRange, preRollFrames: Math.max(DEFAULT_PRE_ROLL_FRAMES, updates.workRange.preRollFrames) } }
      : updates))
  }

  function setSelectionFromHit(hit: SheetHit, sourceProject: CutProject = project, keyIdOverride?: string | null) {
    const keyId = keyIdOverride === undefined ? eventKeyIdAtSheetHit(sourceProject, hit) : keyIdOverride
    setSelectedTextAnnotationId(null)
    setSheetSelection({ kind: 'cell', hit })
    setWorkspaceFocusOwner('sheet')
    setSelectedKeyId(keyId)
    setTimingEditSession(null)
    updateOpenNativePreviewForKey(sourceProject, keyId)
  }

  function setSelectionFromRange(range: SheetRangeSelection, sourceProject: CutProject = project) {
    const inputHit = inputHitForRange(sourceProject, template, range)
    const keyId = eventKeyIdAtSheetHit(sourceProject, inputHit)
    setSelectedTextAnnotationId(null)
    setSheetSelection({ kind: 'range', range })
    setWorkspaceFocusOwner('sheet')
    setSelectedKeyId(keyId)
    setTimingEditSession(null)
    updateOpenNativePreviewForKey(sourceProject, keyId)
  }

  function isPointEventRange(range: SheetRangeSelection | null): range is SheetRangeSelection & { role: SheetTimingRole; paperTrack: string } {
    return isPointEventRangeForUi(range)
  }

  function rangeSelectionForFrames(range: SheetRangeSelection, frameStart: number, frameEnd: number): SheetRangeSelection | null {
    if (!isPointEventRange(range)) return null
    const role = range.role
    const tracks = rangePaperTracks(range)
    const startTrack = tracks[0] ?? range.paperTrack
    const endTrack = tracks.at(-1) ?? startTrack
    const startHit = projectTimingHitForFrame(template, project, role, startTrack, frameStart)
    const endHit = projectTimingHitForFrame(template, project, role, endTrack, frameEnd)
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

  function applyTimingValue(hit: SheetHit | null, rawValue: string, advance = false, sourceProject: CutProject = project): CutProject {
    if (!hit?.paperTrack) return sourceProject
    const value = rawValue.trim()
    const next = setTimingValueAt(sourceProject, hit, value, activeTextFontSizePx, activeCorrectionLayerId)
    commitProject(next.project)
    setTimingEditSession(null)
    const nextHit = advance
      ? nextProjectTimingHit(template, next.project, hit, 0, 1)
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
    const session = timingEditSessionRef.current
    const sourceProject = projectRef.current
    if (!session) return sourceProject
    const nextProject = applyTimingEditSession(sourceProject, template, session)
    if (nextProject !== sourceProject && !commitProject(nextProject)) return sourceProject
    setTimingEditSession(null)
    if (session.target.kind === 'range') {
      const nextRange = advance ? nextSteppedRange(session.target.range) : null
      setSelectionFromRange(nextRange ?? session.target.range, nextProject)
    } else {
      const nextHit = advance
        ? nextProjectTimingHit(template, nextProject, session.target.hit, 0, 1)
        : null
      if (nextHit && typeof nextHit.pageIndex === 'number') setActivePageIndex(nextHit.pageIndex, nextProject)
      setSelectionFromHit(nextHit ?? session.target.hit, nextProject)
    }
    return nextProject
  }

  function cancelTimingDraft() {
    setTimingEditSession(null)
  }

  function runProjectCommand(transform: (sourceProject: CutProject) => CutProject): CutProject {
    const sourceProject = commitTimingDraft(false)
    const transformedProject = transform(sourceProject)
    const nextProject = reconcileDialogueAudioAfterSheetRangeChange(sourceProject, transformedProject)
    if (nextProject !== sourceProject) commitProject(nextProject)
    return nextProject
  }

  function handleClipCorrespondence(assignments: ClipTrackCorrespondence[]) {
    const source = updateActiveCutProjectInDocument(projectDocument, commitTimingDraft(false), { sheetTemplate: template })
    const next = remapClipTracks(source, assignments)
    if (next === source) return
    projectRef.current = commitProjectDocument(next, activeCorrectionLayerId)
    handleClearSelection()
    setTimingClipboard(null)
  }

  function switchPanel(nextPanel: Panel) { commitTimingDraft(false); setPanelView(nextPanel) }

  function handleTimingCharacterInput(character: string) {
    if (!selection.hit || activeSheetRevision.protected) return
    setTimingEditSession(current => {
      if (current) return { ...current, value: `${current.value}${character}` }
      const sourceProject = projectRef.current
      const target = rangeSelection && isPointEventRange(rangeSelection)
        ? { kind: 'range' as const, range: rangeSelection } : { kind: 'cell' as const, hit: selection.hit! }
      return {
        target, value: character, originalValue: timingKeyDisplayLabel(sourceProject, selection.keyId),
        cutId: projectDocumentSnapshot.activeCutId, revisionId: activeSheetRevision.revisionId,
        correctionLayerId: activeCorrectionLayerId, fontSizePx: activeTextFontSizePx,
      }
    })
  }

  useTimingEditOperationBoundaries({
    sessionRef: timingEditSessionRef,
    commitActiveEdit: () => { commitTimingDraft(false) },
    hasUnsavedChanges: hasUnsavedProjectChanges,
  })
  function handleRangeSelect(range: SheetRangeSelection) {
    const sourceProject = commitTimingDraft(false)
    setSelectionFromRange(range, sourceProject)
  }
  function handleSoundCueSelect(cueId: string, origin: 'sheet' | 'audio' = 'sheet') {
    setWorkspaceFocusOwner(origin)
    selectSoundCue(cueId)
    if (origin === 'sheet') setSoundCueNavigationRequest(current => nextSoundCueNavigationRequest(current, cueId))
  }
  function handleDialogueAudioSelectionChange(nextSelection: typeof dialogueAudioSelection) { setDialogueAudioSelection(nextSelection); setWorkspaceFocusOwner('audio') }
  function handleDialogueAudioFocus() { setWorkspaceFocusOwner('audio') }
  function handleAudioPlayheadChange(frame: number) {
    audioPlayheadStore.publish({ cutId: projectDocumentSnapshot.activeCutId, frame })
    const pageIndex = sheetPages.findIndex(page => frame >= page.frameStart && frame <= page.frameEnd)
    if (pageIndex >= 0 && pageIndex !== clampedActivePageIndex) setActivePageIndex(pageIndex)
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
    const sourceProject = commitTimingDraft(false)
    if (typeof hit.pageIndex === 'number') setActivePageIndex(hit.pageIndex, sourceProject)
    applyTimingValue(hit, marker === 'blank' ? 'x' : marker === 'inbetween' ? '/' : '.', false, sourceProject)
  }
  const handleSetNullAtHit = (hit: SheetHit) => handleSetTimingSpecialAtHit(hit, 'blank')
  function handleSetTimingReferenceAtHit(hit: SheetHit, enabled: boolean) {
    if (!hit.paperTrack || activeSheetRevision.protected || (hit.role !== 'action' && hit.role !== 'cell')) return
    const sourceProject = commitTimingDraft(false)
    const range = isPointEventRangeForUi(rangeSelection) && rangeContainsHit(rangeSelection, hit)
      ? { ...rangeSelection, paperTracks: rangePaperTracks(rangeSelection) }
      : { role: hit.role, paperTracks: [hit.paperTrack], frameStart: hit.frame, frameEnd: hit.frame }
    commitProject(setTimingReferenceRange(sourceProject, range, enabled))
  }
  function handleDeleteEventAtHit(hit: SheetHit) {
    if (!hit.paperTrack) return
    const sourceProject = commitTimingDraft(false)
    const sheetRole = sheetRoleForHit(hit)
    const next = setTimingReferenceAt(clearEvent(sourceProject, hit.paperTrack, hit.frame, sheetRole), hit.paperTrack, hit.frame, sheetRole, false)
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
      setTimingEditSession(null)
      return
    }
    const key = sourceProject.logicalSheet.keys.find(item => item.keyId === keyId)
    if (!key) return
    const firstUse = firstTimelineUseForKey(sourceProject, key, registeredCellTrackOrder(sourceProject))
    if (!firstUse) {
      setSheetSelection({ kind: 'none' })
      setTimingEditSession(null)
      updateOpenNativePreviewForKey(sourceProject, keyId)
      return
    }
    const hit = projectTimingHitForFrame(template, sourceProject, firstUse.role, firstUse.paperTrack, firstUse.frame)
    if (!hit) {
      setTimingEditSession(null)
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
    commitTimingDraft(false)
    clipImportContext.current = {}
    setPendingClipImageDrop(null)
    selectWorkspaceProcess(layerId)
    if (project.logicalSheet.processTimings) clearSelectionState()
    setActiveCorrectionLayerIdState(layerId)
  }

  function handleWorkModeChange(mode: RemapWorkMode) {
    commitTimingDraft(false)
    selectWorkspaceProcess(mode === 'sheet' ? undefined : newImageProcessId)
    clearSelectionState()
    resetClipWorkspaceView(mode)
  }

  function handleBaseProcessChange(processId: string) {
    const source = commitTimingDraft(false)
    const next = setBaseTimingProcess(source, processId)
    if (!commitProject(workMode === 'sheet' ? baseTimingProject(next) : next)) return
    if (workMode === 'sheet') selectWorkspaceProcess()
    clipImportContext.current = {}
    setPendingClipImageDrop(null)
    clearSelectionState()
  }

  function resetClipWorkspaceView(mode: RemapWorkMode) {
    clipImportContext.current = {}
    setPendingClipImageDrop(null)
    setAssetDropMenu(null)
    workModeRef.current = mode
    setWorkMode(mode)
    setStatusHint('sheet-drop', null)
  }

  function handleNewImageProcessChange(id: string) {
    handleActiveCorrectionLayerChange(id)
  }

  function allowClipImageImport() {
    if (appKind !== 'remap' || workModeRef.current === 'clip') return true
    setStatusHint('sheet-drop', '画像を登録するには、上部で「CLIP組み立て」に切り替えてください。')
    return false
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
    if (timingEditSessionRef.current) cancelTimingDraft()
    const sourceProject = projectRef.current
    if (isPointEventRange(rangeSelection)) {
      const next = clearTimingRange(sourceProject, rangeSelection)
      commitProject(next)
      setSelectionFromRange(rangeSelection, next)
      return
    }
    if (!selection.hit?.paperTrack) return
    const next = setTimingReferenceAt(clearEvent(sourceProject, selection.hit.paperTrack, selection.hit.frame, sheetRoleForHit(selection.hit)), selection.hit.paperTrack, selection.hit.frame, sheetRoleForHit(selection.hit), false)
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
      setTimingEditSession(null)
    }
  }

  function copySelectedTimingRange(mode: TimingClipboard['mode'], rippleDelete: boolean = false) {
    if (!isPointEventRange(rangeSelection)) return
    const sourceProject = commitTimingDraft(false)
    const clipboard = buildTimingClipboard(sourceProject, rangeSelection, mode)
    setTimingClipboard(clipboard)
    if (mode !== 'cut') return
    const next = rippleDelete
      ? rippleDeleteTimingRange(sourceProject, rangeSelection)
      : clearTimingRange(sourceProject, rangeSelection)
    commitProject(next)
    setSelectionFromRange(rangeSelection, next)
  }

  function pasteTimingClipboard(mode: TimingPasteMode, content: TimingPasteContent = 'auto') {
    const sourceProject = commitTimingDraft(false)
    const baseTarget = timingPasteTarget(selection.hit, rangeSelection)
    const target = baseTarget ? { ...baseTarget, paperTrackOrder: paperTrackOrderForRole(sourceProject, baseTarget.role, template) } : null
    if (!timingClipboard || !target || !canPasteTimingClipboardMode(timingClipboard, selection.hit, rangeSelection, mode, target.paperTrackOrder)) return
    if (mode === 'repeat-range' && !isPointEventRange(rangeSelection)) return
    const next = pasteTimingClipboardToProject(sourceProject, timingClipboard, target, mode, content)
    commitProject(next)
    const nextRange = pasteResultRange(template, next, target, timingClipboard, mode)
    if (nextRange) {
      setSelectionFromRange(nextRange, next)
    } else if (target.hit) {
      setSelectionFromHit(target.hit, next)
    }
  }

  function openFrameOperationDialog(kind: FrameOperationKind, hit: SheetHit) {
    commitTimingDraft(false)
    const state = frameOperationDialogStateForHit(kind, hit, rangeSelection)
    if (state) setFrameOperationDialog(state)
  }

  function applyFrameOperation(input: FrameOperationSubmit) {
    if (!frameOperationDialog) return
    const sourceProject = commitTimingDraft(false)
    const frameCount = Math.max(1, Math.round(input.frameCount))
    const pointRole = pointRoleForFrameOperation(frameOperationDialog)
    const next = applyFrameOperationToProject(sourceProject, frameOperationDialog, input)
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
    const startPaperTrack = paperTracks[0]
    const endPaperTrack = paperTracks.at(-1) ?? startPaperTrack
    const startHit = startPaperTrack ? projectTimingHitForFrame(template, sourceProject, role, startPaperTrack, nextFrameStart) : null
    const endHit = endPaperTrack ? projectTimingHitForFrame(template, sourceProject, role, endPaperTrack, nextFrameEnd) : null
    if (startHit && endHit) {
      const nextRange = rangeSelectionFromHits(template, startHit, endHit, paperTracks)
      if (nextRange) {
        setSelectionFromRange(nextRange, sourceProject)
        return
      }
    }
    if (startHit) setSelectionFromHit(startHit, sourceProject)
  }

  async function handleSheetSourceFiles(files: FileList | File[] | null, startPageId = activePage?.pageId) {
    const targetContext = paperSheetEditContextRef.current
    const imageFiles = Array.from(files ?? [])
      .filter(file => file.type.startsWith('image/'))
      .sort(compareFileNames)
    if (imageFiles.length === 0) return
    const refs = await filesToFileRefs(imageFiles)
    try {
      const currentContext = paperSheetEditContextRef.current
      if (samePaperSheetEditContext(currentContext, targetContext)) handleSheetSourceFileRefs(refs, startPageId, currentContext)
    } finally { releaseBrowserFilesAfterCommit(() => releaseBrowserFileRefs(refs)) }
  }

  function handleSheetSourceFileRefs(refs: FileRef[], startPageId: string | undefined, context: PaperSheetEditContext) {
    const imported = importPaperSheetSourceRefs({ project: projectRef.current, refs, startPageId, template: context.template })
    if (!imported) return
    if (!commitProject(imported.project)) return
    setRuntimeSourceImageUrls(current => ({ ...current, ...imported.runtimeUpdates }))
    setAutoCalibrationOverlay(null)
    void autoCalibrateImportedSheetSources(imported.calibrationTargets, context)
  }

  async function openPaperSheetFilePicker() {
    const targetContext = paperSheetEditContextRef.current
    if (isTauriHost()) {
      try {
        const refs = await openImageFileRefs({
          initialDirectory: preferredSaveDirectory(project),
        })
        const currentContext = paperSheetEditContextRef.current
        if (refs && refs.length > 0 && samePaperSheetEditContext(currentContext, targetContext)) handleSheetSourceFileRefs(refs, activePage?.pageId, currentContext)
        return
      } catch (error) {
        window.alert(errorMessage(error))
        return
      }
    }
    paperSheetInputRef.current?.click()
  }

  async function autoCalibrateImportedSheetSources(targets: ImportedSheetSourceCalibrationTarget[], context: PaperSheetEditContext) {
    if (!shouldAutoCalibrateImportedSheetSources(context.template) || targets.length === 0 || autoCalibrationRunning) return
    setAutoCalibrationRunning(true)
    setAutoCalibrationMessage(uiText.sheet.autoCalibrationImportRunning(targets.length))
    setAutoCalibrationOverlay(null)
    const results: ImportedSheetSourceCalibrationResult[] = []
    const release = retainBrowserFiles(targets)
    try {
      for (const target of targets) {
        try {
          const result = await detectSheetCalibrationPoints(target.imageUrl, context.template)
          if (!samePaperSheetEditContext(paperSheetEditContextRef.current, context)) { setAutoCalibrationMessage(null); return }
          if (result) results.push({ target, points: result.points })
        } catch {
          // Import should succeed even when a scan cannot be auto-corrected.
        }
      }
      if (results.length > 0) {
        setHistory(current => {
          if (!samePaperSheetEditContext(paperSheetEditContextRef.current, context)) return current
          let next = current.present
          let appliedCount = 0
          for (const result of results) {
            const applied = applyDetectedPaperSheetCalibration({ project: next, ...result.target, points: result.points, enabled: true })
            if (!applied) continue
            next = applied.project
            appliedCount += 1
          }
          return appliedCount > 0 ? commitHistory(current, next) : current
        })
      }
      setAutoCalibrationMessage(results.length > 0
        ? uiText.sheet.autoCalibrationImportSucceeded(results.length, targets.length)
        : uiText.sheet.autoCalibrationImportFailed)
    } finally {
      release()
      setAutoCalibrationRunning(false)
    }
  }

  function handleAssetSheetSources(assetIds: string[], startPageId = activePage?.pageId) {
    const context = paperSheetEditContextRef.current
    const selectedAssets = assetIds
      .flatMap(assetId => {
        const asset = project.assets.find(item => item.assetId === assetId)
        return asset && isCellMaterialAsset(asset) ? [asset] : []
      })
      .sort(compareAssetNames)
    if (selectedAssets.length === 0) return
    if (project.sheetView.sources.some(source => source.kind === 'sheet-scan')) return

    const plan = paperSheetImportPlan({ project, startPageId, imageCount: selectedAssets.length, template })
    const runtimeUpdates: Record<string, string> = {}
    const calibrationTargets: ImportedSheetSourceCalibrationTarget[] = []
    let next = updateLogicalSheetSettings(project, { durationFrames: plan.durationFrames })

    for (const [index, asset] of selectedAssets.entries()) {
      const registered = registerSheetSource(next, sheetImageRefFromAsset(asset), { assetId: asset.assetId, initialAlignment: { opacity: IMPORTED_SHEET_IMAGE_INITIAL_OPACITY } })
      next = registered.project
      if (asset.thumbnailUrl) runtimeUpdates[registered.source.sourceId] = asset.thumbnailUrl
      const targetPage = plan.pages[plan.startPageIndex + index]
      if (targetPage) {
        next = assignSheetSourceToPage(next, targetPage.pageId, registered.source.sourceId)
        if (asset.thumbnailUrl) {
          calibrationTargets.push({
            pageId: targetPage.pageId,
            sourceId: registered.source.sourceId,
            sourceIdentity: paperSheetCalibrationSourceIdentity(registered.source),
            imageUrl: asset.thumbnailUrl,
          })
        }
      }
    }

    if (!commitProject(next)) return
    setRuntimeSourceImageUrls(current => ({ ...current, ...runtimeUpdates }))
    setAutoCalibrationOverlay(null)
    void autoCalibrateImportedSheetSources(calibrationTargets, context)
  }

  function handleAssignSheetSource(pageId: string, sourceId: string | null) {
    commitProject(assignSheetSourceToPage(project, pageId, sourceId))
    setAutoCalibrationOverlay(null)
  }

  function handleRemoveSheetSource(sourceId: string) { commitProject(removeSheetSource(project, sourceId)); setAutoCalibrationOverlay(null) }

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
    const context = paperSheetEditContextRef.current
    const targetSource = activePageImage.sourceId
      ? project.sheetView.sources.find(source => source.sourceId === activePageImage.sourceId)
      : undefined
    const target = {
      pageId: activePage.pageId,
      sourceId: activePageImage.sourceId,
      sourceIdentity: targetSource ? paperSheetCalibrationSourceIdentity(targetSource) : undefined,
    }
    setAutoCalibrationRunning(true)
    setAutoCalibrationMessage(uiText.sheet.autoCalibrationRunning)
    try {
      const result = await detectSheetCalibrationPoints(activePageImage.imageUrl, context.template)
      if (!samePaperSheetEditContext(paperSheetEditContextRef.current, context)) { setAutoCalibrationMessage(null); setAutoCalibrationOverlay(null); return }
      if (!result) {
        setAutoCalibrationMessage(uiText.sheet.autoCalibrationFailed)
        setAutoCalibrationOverlay(null)
        return
      }
      const applied = applyDetectedPaperSheetCalibration({ project: projectRef.current, ...target, points: result.points })
      if (!applied) { setAutoCalibrationMessage(null); setAutoCalibrationOverlay(null); return }
      if (!commitProject(applied.project)) return
      setEditMode('calibrate')
      setAutoCalibrationOverlay({ pageId: applied.pageId, ...result.debugOverlay })
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
    if (projectRef.current.clipDocument) { await handleClipImageFiles(Array.from(files), null, targetHit); return }
    const imageFiles = Array.from(files).filter(isImageAssetFile)
    if (imageFiles.length === 0) return
    const refs = await filesToFileRefs(imageFiles)
    try { handleAssetFileRefs(refs, targetHit, position) }
    finally { releaseBrowserFilesAfterCommit(() => releaseBrowserFileRefs(refs)) }
  }

  async function handleAssetNativePaths(paths: string[], targetHit: SheetHit | null = null, position?: { x: number; y: number }, options: { recursive?: boolean } = {}) {
    if (paths.length === 0) return
    if (projectRef.current.clipDocument && !allowClipImageImport()) return
    const source = commitTimingDraft(false), processId = newImageProcessId, context = clipImportContext.current
    const collection = await collectAssetPathDrop(paths, { recursive: options.recursive ?? true })
    if (source.clipDocument) { await importClipImageRefs(source, collection.files, null, targetHit, processId, undefined, context); return }
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
    commitTimingDraft(false)
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
    const sourceProject = commitTimingDraft(false)
    const existingKey = timingKeyAtSheetHit(sourceProject, targetHit)
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
      setSelectionFromHit(selectedAfterDrop.hit, next, selectedAfterDrop.keyId)
    }
    commitProject(next)
    return assetIds
  }

  function handleAssignAsset(assetId: string, targetHit: SheetHit | null, position?: { x: number; y: number }) {
    const sourceProject = commitTimingDraft(false)
    const asset = sourceProject.assets.find(item => item.assetId === assetId)
    if (!asset || !targetHit?.paperTrack) {
      setAssetDropMenu(null)
      return
    }
    const existingKey = timingKeyAtSheetHit(sourceProject, targetHit)
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

  async function handleClipImageFiles(files: File[], parentId: string | null, hit: SheetHit | null = null, beforeId?: string) {
    if (!allowClipImageImport()) return
    const source = commitTimingDraft(false), processId = newImageProcessId, context = clipImportContext.current
    try {
      const images = files.filter(isImageAssetFile)
      if (hit && images.length > 1) throw new Error('シートには画像を1枚ずつ配置してください。複数画像はレイヤーツリーへ追加できます。')
      if (images.reduce((sum, file) => sum + file.size, 0) > 384 * 1024 * 1024) throw new Error('一度に追加する画像は合計384MB以内にしてください。')
      const refs = await filesToFileRefs(images)
      try { await importClipImageRefs(source, refs, parentId, hit, processId, beforeId, context) }
      finally { releaseBrowserFilesAfterCommit(() => releaseBrowserFileRefs(refs)) }
    } catch (error) { setStatusHint('sheet-drop', errorMessage(error)) }
  }

  async function importClipImageRefs(source: CutProject, refs: FileRef[], parentId: string | null, hit: SheetHit | null, processId: string, beforeId?: string, context = clipImportContext.current) {
    if (!allowClipImageImport()) return
    const images = refs.filter(isImageFileRef)
    if (!images.length) return
    if (hit && images.length !== 1) throw new Error('シートには画像を1枚ずつ配置してください。複数画像はレイヤーツリーへ追加できます。')
    if (images.reduce((sum, ref) => sum + (ref.size ?? 0), 0) > 384 * 1024 * 1024) throw new Error('一度に追加する画像は合計384MB以内にしてください。')
    const dataUrls: string[] = []
    let totalLength = 0
    for (const ref of images) {
      const dataUrl = await clipImageDataUrl(ref); totalLength += dataUrl.length
      if (totalLength > 512 * 1024 * 1024) throw new Error('画像の保存データが大きすぎます。画像を分けて追加してください。')
      dataUrls.push(dataUrl)
    }
    // A cut switch, edit, Undo or document replacement invalidates the captured destination.
    if (projectRef.current !== source || context !== clipImportContext.current || !allowClipImageImport()) throw new Error('読み込み中に作業内容・登録先が変わりました。画像をもう一度ドロップしてください。')
    const role = hit && sheetRoleForHit(hit)
    if (hit && (!hit.paperTrack || role !== 'action' && role !== 'cell')) throw new Error('セル列へドロップしてください。')
    let next = source
    const prepared = images.map((ref, index) => {
      const registered = registerMaterialAssetRef(next, ref); next = registered.project
      return { name: ref.name, assetId: registered.asset.assetId, imageDataUrl: dataUrls[index]! }
    })
    if (hit?.paperTrack && role && (clipSheetKeyAtFrame(selectTimingProcess(source, processId), hit.paperTrack, hit.frame, role)
      || !source.clipDocument!.targets.some(target => target.slotId === source.cspTrackSlots.find(slot => slot.paperTrack === hit.paperTrack && slot.correctionLayerId === processId)?.slotId))) {
      setPendingClipImageDrop({ source, prepared: next, images: prepared, hit, processId })
      return
    }
    next = addClipImages(next, parentId, prepared, hit?.paperTrack && role ? { paperTrack: hit.paperTrack, frame: hit.frame, role, processId } : undefined, beforeId)
    if (commitProject(next)) setStatusHint('sheet-drop', `${prepared.length}枚をレイヤーに追加しました。`)
  }

  function applyClipImageDrop(processId: string, newKey: boolean) {
    const pending = pendingClipImageDrop
    if (!pending || pending.source !== projectRef.current || !allowClipImageImport()) { setPendingClipImageDrop(null); return }
    try {
      const { hit } = pending, role = hit.role === 'cell' ? 'cell' : 'action'
      const key = !newKey && clipSheetKeyAtFrame(selectTimingProcess(pending.source, processId), hit.paperTrack!, hit.frame, role)
      const next = addClipImages(pending.prepared, null, pending.images, { paperTrack: hit.paperTrack!, frame: hit.frame, role, processId, newKey, ...(key ? { keyId: key.keyId } : {}) })
      if (commitProject(next)) { setActiveCorrectionLayerIdState(processId); setPendingClipImageDrop(null); setStatusHint('sheet-drop', `${project.correctionLayers.find(process => process.layerId === processId)?.label} / ${hit.paperTrack}へ登録しました。`) }
    } catch (error) { setPendingClipImageDrop(null); setStatusHint('sheet-drop', errorMessage(error)) }
  }

  function handleAssignClipLayer(layerId: string, hit: SheetHit | null) {
    if (!allowClipImageImport()) return
    if (!hit?.paperTrack) return
    const role = sheetRoleForHit(hit)
    if (role !== 'action' && role !== 'cell') return
    try {
      const source = commitTimingDraft(false)
      const { slot } = clipCelSheetDestination(source, layerId, hit.paperTrack, { frame: hit.frame, role })
      const next = bindClipCel(source, layerId, hit.paperTrack, hit.frame, role, slot.correctionLayerId!)
      if (commitProject(next)) { setActiveCorrectionLayerIdState(slot.correctionLayerId!); setSelectionFromHit(hit, next, timingKeyAtSheetHit(next, hit)?.keyId) }
    } catch (error) { setStatusHint('sheet-drop', errorMessage(error)) }
  }

  function handleAssignRegisteredCell(keyId: string, targetHit: SheetHit | null) {
    if (!targetHit?.paperTrack) return
    const sourceProject = commitTimingDraft(false)
    const assigned = assignRegisteredCellKeyToHit(sourceProject, keyId, targetHit, activeTextFontSizePx)
    if (!assigned.keyId) return
    commitProject(assigned.project)
    setSelectionFromHit(targetHit, assigned.project, assigned.keyId)
  }

  function handleMoveTimelineEvent(sourceHit: SheetHit, targetHit: SheetHit, sourceRange?: SheetRangeSelection) {
    if (!sourceHit.paperTrack || !targetHit.paperTrack) return
    const sourceProject = commitTimingDraft(false)
    const sourceRole = sheetRoleForHit(sourceHit)
    if (sourceRole !== sheetRoleForHit(targetHit)) return
    const trackOrder = paperTrackOrderForRole(sourceProject, sourceRole, template)
    const selectedRange = sourceRange && isPointEventRange(sourceRange) && rangeContainsHit(sourceRange, sourceHit)
      ? sourceRange
      : rangeSelectionFromHits(template, sourceHit, sourceHit, trackOrder)
    if (!selectedRange || !isPointEventRange(selectedRange)) return
    const isGroupMove = selectedRange.frameStart !== selectedRange.frameEnd || rangePaperTracks(selectedRange).length > 1
    const moved = moveTimingEventsInRange(sourceProject, selectedRange, sourceHit, targetHit, trackOrder)
    if (moved.status !== 'moved') return
    const confirmation = isGroupMove ? uiText.sheet.moveRangeOverwriteConfirm(moved.collisionCount) : uiText.sheet.moveEventOverwriteConfirm
    if (moved.collisionCount > 0 && !window.confirm(confirmation)) return
    commitProject(moved.project)
    const nextRange = isGroupMove ? timingRangeSelectionForMoveResult(template, moved.project, sourceRole, moved, trackOrder) : null
    if (nextRange) setSelectionFromRange(nextRange, moved.project)
    else setSelectionFromHit(targetHit, moved.project)
  }

  async function handleApplyNameNormalization(plan: NameNormalizationPlan | SheetLabelNormalizationPlan) {
    if ('kind' in plan) {
      commitProject(applySheetLabelNormalizationPlan(projectRef.current, plan))
      return
    }
    const source = projectRef.current
    let next = applyNameNormalizationPlan(source, plan, [])
    if (next.clipDocument) for (const item of plan.items) {
      if (!item.cspCellNameChanged || item.targetType !== 'binding') continue
      const layerId = source.bindings.find(binding => binding.bindingId === item.bindingId)?.clipLayerId
      if (layerId) next = updateClipLayer(next, layerId, { name: item.nextCspCellName })
    }
    const renameResults = plan.options.includeAssetFiles
      ? await renameMaterialFiles(plan.assetRenames)
      : []
    const failedRenames = renameResults.filter(result => !result.renamed)
    if (projectRef.current !== source) throw new Error('処理中にプロジェクトが変わりました。変更後の素材ファイル名を確認してください。')
    commitProject({ ...next, assets: applyNameNormalizationPlan(source, plan, renameResults).assets })
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

  function handleUpdateKeySheetLabel(keyId: string, label: string) {
    try {
      commitProject(updateSheetKeyDisplayLabel(projectRef.current, keyId, label))
    } catch (error) {
      window.alert(errorMessage(error))
    }
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
        sheetRole: createInput.sheetRole ?? (cspPlacement === 'cell-top' ? 'action' : 'cell'),
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
          : baseTimingProcessId(nextProject),
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
      const loaded = appKind === 'remap' ? synchronizeClipBindings(ensureClipDocument(activeCutProjectFromDocument(loadedDocument))) : activeCutProjectFromDocument(loadedDocument)
      rememberSheetTemplatePreset(appKind, loaded.studioPresetId)
      setTemplate(loadedDocument.sheetTemplate)
      setProjectDocument(loadedDocument)
      setSavedProjectDocumentSnapshot(loadedDocument)
      setProjectFilePath(loadedFile.projectFilePath)
      setHistory(createProjectHistory(loaded))
      setActiveCorrectionLayerIdState(baseTimingProcessId(loaded))
      resetClipWorkspaceView(loaded.clipDocument?.source ? 'clip' : 'sheet')
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

  async function handleSaveTemplateJson(templateToSave = template) {
    try {
      return await saveJsonFile(templateToSave, templateJsonFileName(templateToSave), {
        initialDirectory: preferredSaveDirectory(project),
      })
    } catch (error) {
      window.alert(uiText.template.saveFailed(errorMessage(error)))
      return { saved: false }
    }
  }

  function handleUpdateCutMetadata(field: CutMetadataFieldId, value: string, customKey?: string) {
    runProjectCommand(sourceProject => updateCutMetadata(sourceProject, field, value, customKey))
  }

  async function handleOpenExportDirectory() {
    if (!exportOperationNotice?.directoryPath) return
    try {
      await openDirectoryInFileManager(exportOperationNotice.directoryPath)
    } catch (error) {
      setStatusHint('sheet-drop', `書き出し先を開けませんでした: ${errorMessage(error)}`)
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
    const sourceProject = commitTimingDraft(false)
    const nextProjectWithTemplate = reprojectProjectToTemplate(
      stampAuxiliaryPlacementTemplate(sourceProject, sourceProject.sheetTemplateId ?? template.templateId),
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
    setTextFontSizePx(defaultTimingTextFontSizePx(nextTemplate, 'cell'))
  }

  function handleUndo() {
    if (timingEditSessionRef.current) {
      cancelTimingDraft()
      return
    }
    if (!activeSheetRevision.protected) { setHistory(current => undoHistory(current)); if (appKind === 'remap' && workMode === 'sheet') selectWorkspaceProcess() }
  }
  function handleRedo() {
    if (timingEditSessionRef.current) return
    if (!activeSheetRevision.protected) { setHistory(current => redoHistory(current)); if (appKind === 'remap' && workMode === 'sheet') selectWorkspaceProcess() }
  }

  async function handleResetApp() {
    if (hasUnsavedProjectChanges) {
      const confirmed = await confirmUserAction('保存していない変更があります。新しいプロジェクトを作成しますか？', {
        title: '新規プロジェクト',
        okLabel: '新規作成',
      })
      if (!confirmed) return
    }
    const { project: preferredProject, preset } = createPreferredProject(appKind)
    const nextProject = appKind === 'remap' ? synchronizeClipBindings(ensureClipDocument(preferredProject)) : preferredProject
    const nextDocument = createProjectDocumentFromCutProject(nextProject, { sheetTemplate: preset.sheetTemplate })
    setTemplate(preset.sheetTemplate)
    setProjectDocument(nextDocument)
    setSavedProjectDocumentSnapshot(nextDocument)
    setProjectFilePath(null)
    setHistory(createProjectHistory(nextProject))
    setActiveCorrectionLayerIdState(baseTimingProcessId(nextProject))
    resetClipWorkspaceView('sheet')
    setRuntimeSourceImageUrls({})
    setPanelView('sheet')
    setEditMode('new')
    setZoom(1)
    setShowTemplate(true)
    setShowTemplateGuides(true)
    setShowAnnotations(true)
    setPenColor(DEFAULT_PEN_COLOR)
    setPenWidth(DEFAULT_PEN_WIDTH)
    setEraserWidth(0.018)
    setTextFontSizePx(defaultTimingTextFontSizePx(preset.sheetTemplate, 'cell'))
    clearSelectionState()
    setTimingClipboard(null)
    setTimingEditSession(null)
    setAssetDropMenu(null)
  }

  function handleAnnotation(stroke: AnnotationStroke) {
    commitProject(addAnnotation(project, stroke))
  }

  function initializeMemoAppearance(memo: TimelineInkMemo, sourceProject: CutProject): TimelineInkMemo {
    const page = sheetPages.find(item => memo.anchor.frame >= item.frameStart && memo.anchor.frame <= item.frameEnd) ?? activePage
    const segment = page && timelineMemoSegmentsForPage(template, page, memo, projectSheetLayoutOptions(sourceProject, template))[0]
    return { ...memo, appearance: { ...normalizeMemoAppearance(), text: {
      color: penColor,
      fontSizeUnits: segment ? Math.max(0.25, timelineMemoFontSizeUnitsForPx(segment, memoTextFontSizePx, activeSheetPageSize)) : 1,
      writingMode: memoWritingMode,
    } } }
  }

  function handleCreateTimelineMemo(hit: SheetHit): string | null {
    const sourceProject = commitTimingDraft(false)
    const memo = createTimelineMemoForHit(sourceProject, template, hit, rangeSelection)
    if (!memo) return null
    commitProject(addTimelineMemo(sourceProject, initializeMemoAppearance(memo, sourceProject)))
    return memo.memoId
  }
  function handleCreateTimelineMemoForCue(cueId: string): string | null {
    const sourceProject = commitTimingDraft(false)
    const cue = sourceProject.timedRangeCues.find(item => item.cueId === cueId)
    if (!cue) return null
    const memo = createTimelineMemoForCue(sourceProject, template, cue)
    if (!memo) return null
    commitProject(addTimelineMemo(sourceProject, initializeMemoAppearance(memo, sourceProject)))
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
    commitTimingDraft(false)
    setSelectedTextAnnotationId(annotation.annotationId)
    setEditingTextAnnotationId(options.edit ? annotation.annotationId : null)
    setMemoTextFontSizePx(resolveAnnotationTextFontSizePx(annotation, activeSheetPageSize))
    setSheetSelection({ kind: 'none' })
    setSelectedKeyId(null)
    setTimingEditSession(null)
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

  function moveSelection(trackDelta: number, frameDelta: number, extendRange: boolean) {
    const sourceProject = commitTimingDraft(false)
    const role = rangeSelection?.role === 'action' || rangeSelection?.role === 'cell' ? rangeSelection.role : selection.hit ? sheetRoleForHit(selection.hit) : 'cell'
    const trackOrder = paperTrackOrderForRole(sourceProject, role, template)
    const result = navigatePointEventSelection({ template, durationFrames: sheetDisplayDurationFrames, frameOrigin: sheetDisplayFrameStart, currentHit: selection.hit, range: rangeSelection, paperTracks: trackOrder, trackDelta, frameDelta, extendRange, moveHit: hit => nextProjectTimingHit(template, sourceProject, hit, trackDelta, frameDelta) })
    if (!result) return
    if (typeof result.focusHit.pageIndex === 'number') setActivePageIndex(result.focusHit.pageIndex, sourceProject)
    if (result.kind === 'range') setSelectionFromRange(result.range, sourceProject); else setSelectionFromHit(result.hit, sourceProject)
    setSheetScrollRequest(current => ({ requestId: (current?.requestId ?? 0) + 1, hit: result.focusHit }))
  }

  function handleTimingInputBackspace() {
    if (!selection.hit || activeSheetRevision.protected) return
    if (timingEditSessionRef.current) return setTimingEditSession(current => current ? { ...current, value: current.value.slice(0, -1) } : current)
    handleDeleteEvent()
  }
  const handleTimingInputCommit = (advance: boolean) => selection.hit?.paperTrack ? void commitTimingDraft(advance) : undefined
  const handleTimingInputMove = (trackDelta: number, frameDelta: number) => moveSelection(trackDelta, frameDelta, false)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isCompositionKey(event)) return
      const keyboardOwner = resolveWorkspaceKeyboardOwner(event.target, workspaceFocusOwner)
      if (keyboardOwner === 'ignore') return
      if (handleWorkspaceKeyboardBoundary(event, keyboardOwner, { undo: handleUndo, redo: handleRedo })) return
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
          handleTimingInputCommit(true)
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
          commitTimingDraft(false)
          setEditMode(mode)
          return
        }
      }
      if (event.key === 'Backspace' && valueDraftActive && selection.hit) {
        event.preventDefault()
        handleTimingInputBackspace()
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
          cancelTimingDraft()
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
    clipDropContext: clipImportContext.current,
    workMode, handleWorkModeChange, newImageProcessId, handleNewImageProcessChange, baseProcessId, handleBaseProcessChange,
    pendingClipImageDrop: pendingClipImageDrop?.source === project && workMode === 'clip' ? pendingClipImageDrop : null, setPendingClipImageDrop, applyClipImageDrop,
    appKind, collapseEditorSheetPanes, appProfile, history, paperSheetInputRef, project,
    template, runtimeSourceImageUrls, autoCalibrationRunning,
    autoCalibrationMessage, autoCalibrationOverlay, calibrationLoupeOpen, panel, editMode, setEditMode,
    zoom, setZoom, zoomMode, showTemplate, setShowTemplate, showTemplateGuides, setShowTemplateGuides,
    showTemplateLabels, setShowTemplateLabels, showInputContent, setShowInputContent,
    showAnnotations, setShowAnnotations, penColor, setPenColor, penWidth,
    setPenWidth, eraserWidth, setEraserWidth, memoWritingMode, setMemoWritingMode,
    selection, rangeSelection, selectedSoundCueId, selectedSoundCue, selectedCameraCueId, selectedCameraCue, valueDraft, valueDraftActive, sheetScrollRequest, timingClipboard,
    audioPlayheadFrame, audioPlayheadStore, soundCueNavigationRequest, dialogueAudioSelection,
    soundCueClipboard, soundCueDialog, setSoundCueDialog, soundLabelHistory,
    cameraCueClipboard, cameraCueDialog, setCameraCueDialog, cameraInstructionHistory, cameraPointLabelHistory, exportProfileId, sheetImageExportDraft,
    setSheetImageExportDraft, sheetLevelCorrectionDialogOpen, setSheetLevelCorrectionDialogOpen, appHelpDialogOpen, setAppHelpDialogOpen, timingExportDialog,
    setTimingExportDialog, exportOperationNotice, setExportOperationNotice, xdtsImportDialog, setXdtsImportDialog, clipImportFile, setClipImportFile, handleLoadClip, handleImportClip, frameOperationDialog, setFrameOperationDialog, assetDropMenu, setAssetDropMenu, issues,
    projectDocumentSnapshot, projectCuts, sheetRevisions, activeSheetRevision, referenceProject, timingExportPlan, timingExportIssues, sheetPages, clampedActivePageIndex,
    activePage, activePageImage, activeCorrectionLayerId, activeCorrectionLayer, materialAssets,
    issueErrorCount, issueWarningCount, activeCalibrationPoints, activeCalibrationPointsKey, selectedKeySummary,
    selectedFrameSummary, selectedTextAnnotation, editingTextAnnotation, activeTextFontSizePx, activeMemoTextFontSizePx, hasSelectedTextTarget, isTextFontSizeDisabled,
    setStatusHint, switchPanel, activeStatusHint, statusSelectionText, statusHintText, commitProject, runProjectCommand, handleClipCorrespondence, handleApplyPaperTranscription,
    recordDropDiagnostic, setActivePageIndex, updateTiming, updateTimingExportRole, updateTimingExportOptions, updateXdtsImportDialog, handleRangeSelect,
    handleCellClick, handleCellSelect, handleSetNullAtHit, handleSetTimingSpecialAtHit, handleSetTimingReferenceAtHit, handleDeleteEventAtHit, handleTimingCharacterInput, handleTimingInputBackspace, handleTimingInputCommit, handleTimingInputMove, handleKeySelect, handleStackGuideSelect,
    handleSoundCueSelect, handleAudioPlayheadChange, handleDialogueAudioSelectionChange, handleDialogueAudioFocus, openSoundCueEditor, openSoundCueEditorForRange, submitSoundCueDialog, handleTransformSoundCue, openSoundCueEditorForAudioCandidate, handleAutoCreateDialogueRegions,
    handleCameraCueSelect, openCameraCueEditor, openCameraCueEditorForRange, submitCameraCueDialog, handleTransformCameraCue,
    handleActiveCorrectionLayerChange, handleClearSelection, startCalibrationWithLoupe, closeCalibrationLoupe, handleDeleteEvent, handleDeleteCspCard,
    copySelectedTimingRange, pasteTimingClipboard, copySelectedSoundCueRange, pasteSelectedSoundCueRange,
    copySelectedCameraCueRange, pasteSelectedCameraCueRange, openFrameOperationDialog, applyFrameOperation, handleSheetSourceFiles, openPaperSheetFilePicker,
    handleAssetSheetSources, handleAssignSheetSource, handleRemoveSheetSource, updateActivePageAlignment, activePageLevelCorrectionSettings, updateActivePageLevelCorrection, toggleActivePageLevelCorrection,
    updatePageCalibrationPoints, startSheetImageWarp, disableSheetImageWarp, applySheetImageWarp, autoDetectSheetImageWarp, handleAssetFiles,
    handleClipImageFiles, handleAssignClipLayer, handleAssetNativePaths, handleAssetRootCandidates, handleChooseAssetRoot, handleAssetFileRefs, handleAssignAsset, handleAssignRegisteredCell,
    handleMoveTimelineEvent, handleApplyNameNormalization, handleAssignAssetToKey, assignAssetToKeySlot, handleUpdateKeyCspCellName, handleUpdateKeySheetLabel, handleCreateUnplacedCspCard, handleRegisterKeyToCspTrack,
    handleMoveKeyBindingProcess, handleReorderCspStackItem, handleReorderProductionStage, handleReorderCorrectionLayer, handleDeleteCorrectionLayer, handleCreateStackGuideLabel, handleUpdateStackGuideLabel, handleDeleteStackGuideLabel, handleUpdateStackGuideRegistration,
    handleAssignAssetToStackGuide, handleAssignAssetsToStackGuide, handleRegisterAssetsToCspTrack, handleRegisterAssetsToNewCspTrack, handleAddOverlayPaperTrack, handleUpdatePaperTrack,
    handleDeleteOverlayPaperTrack, handleAddTimelineLane, handleUpdateTimelineLane, handleDeleteTimelineLane, handleUpdateCorrectionLayers, handleRenameProductionStage, handleRenameCorrectionLayer, handleLoadProject, handleLoadTemplate, handleImportTemplate, handleLoadXdts, confirmXdtsImport, handleApplyTemplateDraft, handleCreateTemplateDraft,
    handleSaveTemplateJson, handleSaveProjectFile, handleUpdateCutMetadata, handleSwitchProjectCut,
    handleAddSharedCut, handleDeleteSharedCut, handleDialogueAudioCutStateChange, handleSwitchSheetRevision, handleAddSheetRevision, handleRenameSheetRevision, handleToggleSheetRevisionProtected, handleToggleSheetRevisionSourceReference, handleDeleteSheetRevision,
    openTimingExportDialog, confirmTimingExport, handleSaveXdts, handleOpenExportDirectory, handleOpenSheetImageExport, handleSaveSheetImageExport, handleSaveCorrectedSheetImages, handleSaveDialogueAudioTracks, handlePresetSelect,
    canSendToAfterEffects, afterEffectsSending, handleCopyAeKeyframeData,
    handleUndo, handleRedo, handleResetApp, handleAnnotation, handleCreateTimelineMemo, handleCreateTimelineMemoForCue, handleDeleteTimelineMemo, handleUpdateTimelineMemoPlacement, handleAppendTimelineMemoStroke, handleEraseTimelineMemoStroke, handleUpsertTimelineMemoText, handleUpdateTimelineMemoAppearance, handleClearTimelineMemoStrokes, handleTextAnnotation, handleSelectTextAnnotation,
    handleEditTextAnnotation, handleUpdateTextAnnotation, handleCommitTextAnnotation, handleCancelTextAnnotation, handleCommitFocusedTextAnnotationDraft, handleTextFontSizeChange, handleMemoTextFontSizeChange,
    handleEraseAnnotation,
  }
}

function samePaperSheetEditContext(left: PaperSheetEditContext, right: PaperSheetEditContext): boolean {
  return left.document === right.document
    && left.cutId === right.cutId
    && left.revisionId === right.revisionId
    && left.template === right.template
}

export type AppController = ReturnType<typeof useAppController>
