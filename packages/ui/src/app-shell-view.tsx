import { useEffect, useMemo, useRef, useState } from 'react'
import { clearAnnotations, clearAnnotationsForPage, getSheetViewLayout, sheetTemplatePresets, timelineLanesForLayout, updateLogicalSheetSettings, updateSheetFormField, updateSheetViewState } from '@xsheet-remap/core';
import { XSR_PROJECT_FILE_ACCEPT } from '@xsheet-remap/adapters';
import { APP_VERSION } from './appVersion';
import { uiText } from './i18n';
import { LevelCorrectionDialog } from './LevelCorrectionDialog';
import { roundForInput } from './sheetImages';
import { sheetRoleForHit, sheetRoleLabel } from './sheetInteraction';
import { Tooltip, TooltipTarget } from './Tooltip';
import { CalibrationLoupeDialog } from './sheetCalibrationLoupe';
import { ActionMenu, IconButton, ScrubbableNumberInput } from './AppControls';
import { TemplateWorkspace, type TemplateWorkspaceDraftState } from './TemplateWorkspace';
import { AssetDropProcessMenu } from './app-sheet-layers';
import { FrameOperationDialog, SheetImageExportDialog } from './app-registered-cells';
import { AppHelpDialog, AppNavigationMenu, CutMetadataActionMenu, HelpIcon, PaperSheetIcon, RecognitionActionMenu, RedoIcon, UndoIcon } from './app-navigation';
import { SheetPanel } from './app-sheet-panel';
import type { AppController } from './app-shell-controller'
import { TimingExportDialog } from './TimingExportDialog'
import { SoundCueDialog } from './SoundCueDialog'
import { CameraCueDialog } from './CameraCueDialog'
import { XdtsImportDialog } from './XdtsImportDialog'
import { SHEET_OCR_AVAILABLE } from './runtimeFeatures'
import { DialogueAudioTimeline } from './DialogueAudioTimeline'
import { dialogueAudioCutStateFromProject } from './dialogueAudioProject'
import { correctedSheetImageExportPlan, type CorrectedSheetImageExportFormat } from './correctedSheetImageExport'
import { PaperSheetAssignmentEditor } from './PaperSheetAssignmentEditor'
import type { DialogueAudioTrackExportFormat } from './dialogueAudioExport'

export function AppShellView({ controller }: { controller: AppController }) {
  const {
    appKind, collapseEditorSheetPanes, appProfile, history, paperSheetInputRef, project,
    template, runtimeSourceImageUrls, recognitionCandidates, setRecognitionCandidates, recognitionRole,
    setRecognitionRole, recognitionRunning, recognitionProgress, recognitionMessage, setRecognitionMessage, autoCalibrationRunning,
    autoCalibrationMessage, autoCalibrationOverlay, calibrationLoupeOpen, panel, editMode, setEditMode,
    zoom, setZoom, zoomMode, showTemplate, setShowTemplate, showTemplateGuides, setShowTemplateGuides,
    showTemplateLabels, setShowTemplateLabels, showInputContent, setShowInputContent,
    showAnnotations, setShowAnnotations, penColor, setPenColor, penWidth,
    setPenWidth, eraserWidth, setEraserWidth,
    selection, rangeSelection, selectedSoundCueId, selectedSoundCue, selectedCameraCueId, selectedCameraCue, valueDraft, valueDraftActive, sheetScrollRequest, timingClipboard,
    audioPlayheadFrame, soundCueNavigationRequest, dialogueAudioSelection,
    soundCueClipboard, soundCueDialog, setSoundCueDialog, soundLabelHistory,
    cameraCueClipboard, cameraCueDialog, setCameraCueDialog, cameraInstructionHistory, cameraPointLabelHistory, exportProfileId, sheetImageExportDraft,
    setSheetImageExportDraft, sheetLevelCorrectionDialogOpen, setSheetLevelCorrectionDialogOpen, appHelpDialogOpen, setAppHelpDialogOpen, timingExportDialog,
    setTimingExportDialog, cspImportExportState, exportOperationNotice, setExportOperationNotice, xdtsImportDialog, setXdtsImportDialog, frameOperationDialog, setFrameOperationDialog, assetDropMenu, setAssetDropMenu,
    projectDocumentSnapshot, projectCuts, sheetRevisions, activeSheetRevision, referenceProject, timingExportPlan, timingExportIssues, sheetPages, clampedActivePageIndex,
    activePage, activePageImage, hasRecognitionSheetImages, activeCorrectionLayerId, activeCorrectionLayer, materialAssets,
    issueErrorCount, issueWarningCount, activeCalibrationPoints, activeCalibrationPointsKey, selectedKeySummary,
    selectedFrameSummary, selectedTextAnnotation, editingTextAnnotation, activeTextFontSizePx, activeMemoTextFontSizePx, hasSelectedTextTarget, isTextFontSizeDisabled,
    setStatusHint, switchPanel, activeStatusHint, statusSelectionText, statusHintText, runProjectCommand,
    recordDropDiagnostic, setActivePageIndex, updateTiming, updateTimingExportRole, updateTimingExportOptions, updateXdtsImportDialog, handleRangeSelect,
    handleCellClick, handleCellSelect, handleSetNullAtHit, handleSetTimingSpecialAtHit, handleDeleteEventAtHit, handleTimingCharacterInput, handleTimingInputBackspace, handleTimingInputCommit, handleTimingInputMove, handleKeySelect, handleStackGuideSelect,
    handleSoundCueSelect, handleAudioPlayheadChange, handleDialogueAudioSelectionChange, handleDialogueAudioFocus, openSoundCueEditor, openSoundCueEditorForRange, submitSoundCueDialog, handleTransformSoundCue, openSoundCueEditorForAudioCandidate, handleAutoCreateDialogueRegions,
    handleCameraCueSelect, openCameraCueEditor, openCameraCueEditorForRange, submitCameraCueDialog, handleTransformCameraCue,
    handleActiveCorrectionLayerChange, handleClearSelection, startCalibrationWithLoupe, closeCalibrationLoupe, handleDeleteEvent, handleDeleteCspCard,
    copySelectedTimingRange, pasteTimingClipboard, copySelectedSoundCueRange, pasteSelectedSoundCueRange,
    copySelectedCameraCueRange, pasteSelectedCameraCueRange, openFrameOperationDialog, applyFrameOperation, handleSheetSourceFiles, openPaperSheetFilePicker,
    handleAssetSheetSources, handleAssignSheetSource, handleRemoveSheetSource, updateActivePageAlignment, activePageLevelCorrectionSettings, updateActivePageLevelCorrection, toggleActivePageLevelCorrection,
    updatePageCalibrationPoints, startSheetImageWarp, disableSheetImageWarp, applySheetImageWarp, autoDetectSheetImageWarp, handleAssetFiles,
    handleAssetNativePaths, handleAssetRootCandidates, handleChooseAssetRoot, handleAssignAsset, handleAssignRegisteredCell,
    handleMoveTimelineEvent, handleApplyNameNormalization, handleAssignAssetToKey, assignAssetToKeySlot, handleUpdateKeyCspCellName, handleCreateUnplacedCspCard, handleRegisterKeyToCspTrack,
    handleMoveKeyBindingProcess, handleReorderCspStackItem, handleReorderProductionStage, handleReorderCorrectionLayer, handleDeleteCorrectionLayer, handleCreateStackGuideLabel, handleUpdateStackGuideLabel, handleDeleteStackGuideLabel, handleUpdateStackGuideRegistration,
    handleAssignAssetToStackGuide, handleAssignAssetsToStackGuide, handleRegisterAssetsToCspTrack, handleRegisterAssetsToNewCspTrack, handleAddOverlayPaperTrack, handleUpdatePaperTrack,
    handleDeleteOverlayPaperTrack, handleAddTimelineLane, handleUpdateTimelineLane, handleDeleteTimelineLane, handleUpdateCorrectionLayers, handleRenameProductionStage, handleRenameCorrectionLayer, handleLoadProject, handleLoadTemplate, handleImportTemplate, handleLoadXdts, confirmXdtsImport, handleApplyTemplateDraft, handleCreateTemplateDraft,
    handleSaveTemplateJson, handleSaveProjectFile, handleUpdateCutMetadata, handleSwitchProjectCut,
    handleSwitchSheetRevision, handleAddSheetRevision, handleRenameSheetRevision, handleToggleSheetRevisionProtected, handleToggleSheetRevisionSourceReference, handleDeleteSheetRevision,
    handleAddSharedCut, handleDeleteSharedCut, handleDialogueAudioCutStateChange, openTimingExportDialog, confirmTimingExport, handleOpenExportDirectory, handleOpenSheetImageExport, handleSaveSheetImageExport, handleSaveCorrectedSheetImages, handleSaveDialogueAudioTracks, handlePresetSelect,
    canSendToAfterEffects, afterEffectsSending, handleCopyAeKeyframeData,
    handleUndo, handleRedo, handleResetApp, handleAnnotation, handleCreateTimelineMemo, handleCreateTimelineMemoForCue, handleDeleteTimelineMemo, handleUpdateTimelineMemoPlacement, handleAppendTimelineMemoStroke, handleEraseTimelineMemoStroke, handleUpsertTimelineMemoText, handleUpdateTimelineMemoAppearance, handleClearTimelineMemoStrokes, handleTextAnnotation, handleSelectTextAnnotation,
    handleEditTextAnnotation, handleUpdateTextAnnotation, handleCommitTextAnnotation, handleCancelTextAnnotation, handleCommitFocusedTextAnnotationDraft, handleTextFontSizeChange, handleMemoTextFontSizeChange,
    handleEraseAnnotation, handleRecognizeSheet, acceptRecognitionCandidate, acceptAllRecognitionCandidates, updateRecognitionCandidateLabel,
  } = controller

  const dialogueAudioCutState = useMemo(() => dialogueAudioCutStateFromProject(
    project,
    project.logicalSheet.frameOrigin,
    project.logicalSheet.durationFrames,
  ), [project])
  const templateDraftState = useRef<TemplateWorkspaceDraftState | null>(null)
  const [templateDraftForMount, setTemplateDraftForMount] = useState<TemplateWorkspaceDraftState | null>(null)
  const correctedSheetImageExportInFlight = useRef(false)
  const [correctedSheetImageExportSaving, setCorrectedSheetImageExportSaving] = useState<CorrectedSheetImageExportFormat | null>(null)
  const dialogueAudioExportInFlight = useRef(false)
  const [dialogueAudioExportSaving, setDialogueAudioExportSaving] = useState<DialogueAudioTrackExportFormat | null>(null)
  const correctedSheetImagePageCount = useMemo(() => correctedSheetImageExportPlan(project, template).pages.length, [project, template])

  async function saveCorrectedSheetImages(format: CorrectedSheetImageExportFormat) {
    if (correctedSheetImageExportInFlight.current) return
    correctedSheetImageExportInFlight.current = true
    setCorrectedSheetImageExportSaving(format)
    try {
      await handleSaveCorrectedSheetImages(format)
    } finally {
      correctedSheetImageExportInFlight.current = false
      setCorrectedSheetImageExportSaving(null)
    }
  }

  async function saveDialogueAudioTracks(format: DialogueAudioTrackExportFormat) {
    if (dialogueAudioExportInFlight.current) return
    dialogueAudioExportInFlight.current = true
    setDialogueAudioExportSaving(format)
    try {
      await handleSaveDialogueAudioTracks(format)
    } finally {
      dialogueAudioExportInFlight.current = false
      setDialogueAudioExportSaving(null)
    }
  }

  useEffect(() => {
    if (panel !== 'template') setTemplateDraftForMount(templateDraftState.current)
  }, [panel])

  useEffect(() => {
    if (panel === 'template' || !templateDraftForMount?.dirty) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [panel, templateDraftForMount?.dirty])

  const sheetRailExternalActions = panel === 'sheet' ? (
    <>
      <ActionMenu
        label={<PaperSheetIcon />}
        ariaLabel="紙シート"
        tooltipLabel="シート画像の読込・補正"
        className="workspaceRailAction paperSheetRailMenu"
        placement="right-start"
      >
        <div className="paperSheetRailMenuBody" aria-label="紙シート画像の操作">
          <TooltipTarget label={uiText.actions.loadSheetSourceFilesTitle}>
            {tooltipProps => (
              <>
                <button
                  type="button"
                  className="paperSheetLoadButton"
                  onClick={() => void openPaperSheetFilePicker()}
                  {...tooltipProps}
                >
                  {uiText.actions.loadSheetSourceFiles}
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
          <p className="paperSheetImportHint">{['continuous', 'infinite'].includes(getSheetViewLayout(template).frameAxis?.type ?? '') ? uiText.sources.addHintContinuous : uiText.sources.addHint}</p>
          <Tooltip label={uiText.sheet.imageCorrectionTitle}>
            <button
              type="button"
              aria-label={uiText.sheet.imageCorrection}
              className={editMode === 'calibrate' ? 'activeToolButton' : ''}
              disabled={!activePageImage.imageUrl}
              onClick={() => void startCalibrationWithLoupe()}
            >
              {uiText.sheet.imageCorrection}
            </button>
          </Tooltip>
          <TooltipTarget label={uiText.sheet.imageOpacityTitle}>
            {tooltipProps => (
              <label className="compactControl topOpacityControl" {...tooltipProps}>
                {uiText.sheet.imageOpacity}
                <ScrubbableNumberInput
                  value={Math.round(activePageImage.settings.opacity * 100)}
                  min={0}
                  max={100}
                  pixelsPerStep={2}
                  ariaLabel={uiText.sheet.imageOpacity}
                  ariaValueText={value => `${value}%`}
                  disabled={!activePageImage.sourceId}
                  onChange={value => updateActivePageAlignment({ opacity: value / 100 })}
                />
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
          {autoCalibrationMessage && <p className="muted calibrationStatus" role="status">{autoCalibrationMessage}</p>}
          <PaperSheetAssignmentEditor
            pages={sheetPages}
            pageStates={project.sheetView.pages}
            sources={project.sheetView.sources}
            activePageId={activePage?.pageId}
            onPageSelect={setActivePageIndex}
            onAssign={handleAssignSheetSource}
            onRemove={handleRemoveSheetSource}
          />
        </div>
      </ActionMenu>
      {SHEET_OCR_AVAILABLE && (
        <RecognitionActionMenu
          label={<span className="workspaceRailTextIcon">OCR</span>}
          className="workspaceRailAction"
          placement="right-start"
          candidates={recognitionCandidates}
          sheetRole={recognitionRole}
          running={recognitionRunning}
          progress={recognitionProgress}
          message={recognitionMessage}
          project={project}
          template={template}
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
      )}
    </>
  ) : null

  return (
    <div className="appShell" onContextMenu={event => event.preventDefault()}>
      <header className="topBar">
        <div className="topIdentity">
          <AppNavigationMenu
            appName={appProfile.appName}
            appVersion={APP_VERSION}
            panels={appProfile.panels}
            panel={panel}
            onSelect={switchPanel}
            onLoadProject={files => void handleLoadProject(files)}
            onLoadXdts={files => void handleLoadXdts(files)}
            onLoadTemplate={files => void handleImportTemplate(files)}
            onSaveProject={() => void handleSaveProjectFile()}
            onSaveProjectAs={() => void handleSaveProjectFile({ saveAs: true })}
            onSaveTemplate={() => void handleSaveTemplateJson()}
            onResetApp={handleResetApp}
            onOpenSheetImageExport={handleOpenSheetImageExport}
            correctedSheetImagePageCount={appKind === 'editor' ? correctedSheetImagePageCount : 0}
            correctedSheetImageExportSaving={correctedSheetImageExportSaving}
            onSaveCorrectedSheetImages={appKind === 'editor' ? saveCorrectedSheetImages : undefined}
            dialogueAudioExportSaving={dialogueAudioExportSaving}
            onSaveDialogueAudioTracks={appKind === 'editor' ? saveDialogueAudioTracks : undefined}
            onSaveXdts={() => openTimingExportDialog('xdts')}
            onSaveAeJsx={() => openTimingExportDialog('ae-jsx')}
            onSendAfterEffects={canSendToAfterEffects ? () => openTimingExportDialog('ae-send') : undefined}
            onSaveCspImportPackage={() => openTimingExportDialog('csp-import')}
          />
          <span className="topBrand">
            <strong>{appProfile.appName}</strong>
          </span>
        </div>
        <div className="topActions">
          <CutMetadataActionMenu
            project={project}
            template={template}
            onMetadataChange={handleUpdateCutMetadata}
            onDurationChange={durationFrames => runProjectCommand(sourceProject => updateLogicalSheetSettings(sourceProject, { durationFrames }))}
          />
          <div className="topUtilityActions">
            <Tooltip label={uiText.actions.undo}>
              <IconButton data-timing-edit-boundary="manual" onClick={handleUndo} disabled={!valueDraftActive && history.past.length === 0} aria-label={uiText.actions.undo}><UndoIcon /></IconButton>
            </Tooltip>
            <Tooltip label={uiText.actions.redo}>
              <IconButton onClick={handleRedo} disabled={valueDraftActive || history.future.length === 0} aria-label={uiText.actions.redo}><RedoIcon /></IconButton>
            </Tooltip>
            <Tooltip label={`${appProfile.appName}のクイックガイドと詳しい使い方を開く`}>
              <IconButton onClick={() => setAppHelpDialogOpen(true)} aria-label="ヘルプ"><HelpIcon /></IconButton>
            </Tooltip>
          </div>
        </div>
      </header>

      <main className={`mainPane ${panel === 'template' ? 'templateMainPane' : ''}`.trim()}>
        {panel === 'sheet' && (
          <div className={appKind === 'editor' ? 'editorAudioWorkspace' : 'sheetPanelWorkspace'}>
            <SheetPanel
            appKind={appKind}
            collapseEditorPanes={collapseEditorSheetPanes}
            project={project}
            referenceProject={referenceProject}
            referenceOpacity={activeSheetRevision.reference?.opacity ?? 0.28}
            exportProfileId={exportProfileId}
            template={template}
            templatePresets={sheetTemplatePresets}
            selectedPresetId={project.studioPresetId ?? sheetTemplatePresets.find(preset => preset.sheetTemplate.templateId === template.templateId)?.presetId}
            onPresetSelect={handlePresetSelect}
            railExternalActions={sheetRailExternalActions}
            projectCuts={projectCuts}
            activeCutId={projectDocumentSnapshot.activeCutId}
            onSwitchProjectCut={handleSwitchProjectCut}
            onAddSharedCut={handleAddSharedCut}
            onDeleteSharedCut={handleDeleteSharedCut}
            sheetRevisions={sheetRevisions}
            activeSheetRevisionId={activeSheetRevision.revisionId}
            onSwitchSheetRevision={handleSwitchSheetRevision}
            onAddSheetRevision={handleAddSheetRevision}
            onRenameSheetRevision={handleRenameSheetRevision}
            onToggleSheetRevisionProtected={handleToggleSheetRevisionProtected}
            onToggleSheetRevisionSourceReference={handleToggleSheetRevisionSourceReference}
            onDeleteSheetRevision={handleDeleteSheetRevision}
            onSetSharedCutNumbersVisible={visible => runProjectCommand(sourceProject => updateSheetViewState(sourceProject, {
              metadataDisplay: { ...sourceProject.sheetView.metadataDisplay, sharedCutNumbers: visible },
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
            audioPlayheadFrame={appKind === 'editor' ? audioPlayheadFrame : null}
            selectedSoundCueId={selectedSoundCueId}
            selectedCameraCueId={selectedCameraCueId}
            timingDraftValue={valueDraft}
            timingDraftActive={valueDraftActive}
            timingInputDisabled={Boolean(activeSheetRevision.protected)}
            onTimingInputCharacter={handleTimingCharacterInput}
            onTimingInputBackspace={handleTimingInputBackspace}
            onTimingInputCommit={handleTimingInputCommit}
            onTimingInputMove={handleTimingInputMove}
            scrollRequest={sheetScrollRequest}
            rangeSelection={rangeSelection}
            timingClipboard={timingClipboard}
            soundCueClipboard={soundCueClipboard}
            cameraCueClipboard={cameraCueClipboard}
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
            showTemplateGuides={showTemplateGuides}
            showTemplateLabels={showTemplateLabels}
            showInputContent={showInputContent}
            showAnnotations={showAnnotations}
            onShowTemplateChange={setShowTemplate}
            onShowTemplateGuidesChange={setShowTemplateGuides}
            onShowTemplateLabelsChange={setShowTemplateLabels}
            onShowInputContentChange={setShowInputContent}
            onShowAnnotationsChange={setShowAnnotations}
            onContinuationDisplayChange={(role, visible) => runProjectCommand(sourceProject => updateSheetViewState(sourceProject, {
              continuationDisplay: { ...sourceProject.sheetView.continuationDisplay, [role]: visible },
            }))}
            penColor={penColor}
            setPenColor={setPenColor}
            penWidth={penWidth}
            setPenWidth={setPenWidth}
            eraserWidth={eraserWidth}
            setEraserWidth={setEraserWidth}
            textFontSizePx={activeMemoTextFontSizePx}
            timingTextFontSizePx={activeTextFontSizePx}
            selectedTextAnnotationId={selectedTextAnnotation?.annotationId ?? null}
            editingTextAnnotationId={editingTextAnnotation?.annotationId ?? null}
            hasSelectedTextTarget={hasSelectedTextTarget}
            textFontSizeDisabled={isTextFontSizeDisabled}
            onTextFontSizeChange={handleTextFontSizeChange}
            onMemoTextFontSizeChange={handleMemoTextFontSizeChange}
            onUpsertTimelineMemoText={handleUpsertTimelineMemoText}
            onUpdateTimelineMemoAppearance={handleUpdateTimelineMemoAppearance}
            onMetadataChange={handleUpdateCutMetadata}
            onDurationChange={durationFrames => runProjectCommand(sourceProject => updateLogicalSheetSettings(sourceProject, { durationFrames }))}
            onFormFieldChange={(definition, value, pageId) => runProjectCommand(sourceProject => updateSheetFormField(sourceProject, definition, value, pageId))}
            autoCalibrationRunning={autoCalibrationRunning}
            autoCalibrationMessage={autoCalibrationMessage}
            autoCalibrationOverlay={autoCalibrationOverlay}
            onCellClick={handleCellClick}
            onCellSelect={handleCellSelect}
            onRangeSelect={handleRangeSelect}
            onSoundCueSelect={handleSoundCueSelect}
            onSoundCueEdit={openSoundCueEditor}
            onSoundRangeEdit={openSoundCueEditorForRange}
            onSoundCueTransform={handleTransformSoundCue}
            onCameraCueSelect={handleCameraCueSelect}
            onCameraCueEdit={openCameraCueEditor}
            onCameraRangeEdit={openCameraCueEditorForRange}
            onCameraCueTransform={handleTransformCameraCue}
            onSetNullAtHit={handleSetNullAtHit}
            onSetTimingSpecialAtHit={handleSetTimingSpecialAtHit}
            onDeleteEventAtHit={handleDeleteEventAtHit}
            onKeySelect={handleKeySelect}
            onStackGuideSelect={handleStackGuideSelect}
            onDeleteEvent={handleDeleteEvent}
            onCopyRange={() => copySelectedTimingRange('copy')}
            onCutRange={() => copySelectedTimingRange('cut', false)}
            onCutRangeRipple={() => copySelectedTimingRange('cut', true)}
            onPasteTiming={pasteTimingClipboard}
            onCopySoundCues={() => copySelectedSoundCueRange('copy')}
            onCutSoundCues={() => copySelectedSoundCueRange('cut')}
            onDeleteSoundCues={handleDeleteEvent}
            onPasteSoundCues={pasteSelectedSoundCueRange}
            onCopyCameraCues={() => copySelectedCameraCueRange('copy')}
            onCutCameraCues={() => copySelectedCameraCueRange('cut')}
            onDeleteCameraCues={handleDeleteEvent}
            onPasteCameraCues={pasteSelectedCameraCueRange}
            onOpenFrameOperation={openFrameOperationDialog}
            onCreateTimelineMemo={handleCreateTimelineMemo}
            onCreateTimelineMemoForCue={handleCreateTimelineMemoForCue}
            onDeleteTimelineMemo={handleDeleteTimelineMemo}
            onUpdateTimelineMemoPlacement={handleUpdateTimelineMemoPlacement}
            onAppendTimelineMemoStroke={handleAppendTimelineMemoStroke}
            onEraseTimelineMemoStroke={handleEraseTimelineMemoStroke}
            onClearTimelineMemoStrokes={handleClearTimelineMemoStrokes}
            onClearSelection={handleClearSelection}
            onAssetSheetSources={assetIds => handleAssetSheetSources(assetIds, activePage?.pageId)}
            onAssetDrop={(files, hit, position) => void handleAssetFiles(files, hit, position)}
            onAssetFiles={files => void handleAssetFiles(files)}
            onAssetRoots={roots => void handleAssetRootCandidates(roots)}
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
            onClearPageAnnotations={pageId => runProjectCommand(sourceProject => clearAnnotationsForPage(sourceProject, pageId))}
            onClearAllAnnotations={() => {
              if (!window.confirm(uiText.actions.clearAllInkConfirm)) return
              runProjectCommand(clearAnnotations)
            }}
            onUpdateActivePageAlignment={updateActivePageAlignment}
            onStartSheetImageWarp={startSheetImageWarp}
            onDisableSheetImageWarp={disableSheetImageWarp}
            onAutoDetectSheetImageWarp={autoDetectSheetImageWarp}
            onApplySheetImageWarp={applySheetImageWarp}
            onUpdateTiming={updateTiming}
            onSetViewMode={viewMode => runProjectCommand(sourceProject => updateSheetViewState(sourceProject, { viewMode }))}
            onDeleteKey={handleDeleteCspCard}
            onUpdateKeyCspCellName={handleUpdateKeyCspCellName}
            onMoveKeyBindingProcess={handleMoveKeyBindingProcess}
            onRenameProductionStage={handleRenameProductionStage}
            onRenameCorrectionLayer={handleRenameCorrectionLayer}
            onCreateStackGuideLabel={handleCreateStackGuideLabel}
            onUpdateStackGuideLabel={handleUpdateStackGuideLabel}
            onUpdateStackGuideRegistration={handleUpdateStackGuideRegistration}
            onDeleteStackGuideLabel={handleDeleteStackGuideLabel}
            onAssignAssetToStackGuideLabel={handleAssignAssetToStackGuide}
            onAssignAssetsToStackGuideLabel={handleAssignAssetsToStackGuide}
            onRegisterAssetsToCspTrack={handleRegisterAssetsToCspTrack}
            onRegisterAssetsToNewCspTrack={handleRegisterAssetsToNewCspTrack}
            onCreateUnplacedCspCard={handleCreateUnplacedCspCard}
            onRegisterKeyToCspTrack={handleRegisterKeyToCspTrack}
            onAddOverlayPaperTrack={handleAddOverlayPaperTrack}
            onUpdatePaperTrack={handleUpdatePaperTrack}
            onDeleteOverlayPaperTrack={handleDeleteOverlayPaperTrack}
            onCopyAeKeyframeData={handleCopyAeKeyframeData}
            onAddTimelineLane={handleAddTimelineLane}
            onUpdateTimelineLane={handleUpdateTimelineLane}
            onDeleteTimelineLane={handleDeleteTimelineLane}
            onApplyNameNormalization={handleApplyNameNormalization}
            onAssignAssetToKey={handleAssignAssetToKey}
            onReorderCspStackItem={handleReorderCspStackItem}
            onReorderProductionStage={handleReorderProductionStage}
            onReorderCorrectionLayer={handleReorderCorrectionLayer}
            onDeleteCorrectionLayer={handleDeleteCorrectionLayer}
            />
            {appKind === 'editor' && (
              <DialogueAudioTimeline
                key={projectDocumentSnapshot.activeCutId}
                cutState={dialogueAudioCutState}
                audioSelection={dialogueAudioSelection}
                fps={project.logicalSheet.fps}
                frameOrigin={project.logicalSheet.frameOrigin}
                cutDurationFrames={project.logicalSheet.durationFrames}
                activeRevisionId={activeSheetRevision.revisionId}
                soundCues={project.timedRangeCues.filter(cue => cue.role === 'sound')}
                selectedSoundCueId={selectedSoundCueId}
                soundCueNavigationRequest={soundCueNavigationRequest}
                onCutStateChange={handleDialogueAudioCutStateChange}
                onAudioSelectionChange={handleDialogueAudioSelectionChange}
                onWorkspaceFocus={handleDialogueAudioFocus}
                canUndo={history.past.length > 0}
                canRedo={history.future.length > 0}
                onUndo={handleUndo}
                onRedo={handleRedo}
                onCutDurationChange={durationFrames => runProjectCommand(sourceProject => updateLogicalSheetSettings(sourceProject, { durationFrames }))}
                onPlayheadChange={handleAudioPlayheadChange}
                onSoundCueSelect={handleSoundCueSelect}
                onSoundCueEdit={openSoundCueEditor}
                onSoundCueTransform={handleTransformSoundCue}
                onSoundCandidateEdit={openSoundCueEditorForAudioCandidate}
                onAutoCreateDialogueRegions={handleAutoCreateDialogueRegions}
              />
            )}
          </div>
        )}
        {panel === 'template' && (
          <TemplateWorkspace
            project={project}
            template={template}
            initialDraftTemplate={templateDraftForMount?.dirty ? templateDraftForMount.template : undefined}
            initialDraftDirty={templateDraftForMount?.dirty ?? false}
            onDraftStateChange={state => { templateDraftState.current = state }}
            onLoadTemplate={handleLoadTemplate}
            onSaveTemplate={handleSaveTemplateJson}
            onApplyTemplate={handleApplyTemplateDraft}
            onCreateTemplateDraft={handleCreateTemplateDraft}
            onUpdateCorrectionLayers={handleUpdateCorrectionLayers}
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
        <AppHelpDialog appName={appProfile.appName} appKind={appKind} onClose={() => setAppHelpDialogOpen(false)} />
      )}

      {timingExportDialog && (timingExportPlan || timingExportDialog.kind === 'ae-jsx' || timingExportDialog.kind === 'ae-send') && (
        <TimingExportDialog
          state={timingExportDialog}
          timelineSections={project.logicalSheet.timelineSections}
          issues={timingExportIssues}
          cspImportState={cspImportExportState}
          afterEffectsSending={afterEffectsSending}
          onChangeRole={updateTimingExportRole}
          onChangeOptions={updateTimingExportOptions}
          onReconnectAssetRoot={handleChooseAssetRoot}
          onCancel={() => setTimingExportDialog(null)}
          onConfirm={confirmTimingExport}
        />
      )}

      {xdtsImportDialog && (
        <XdtsImportDialog
          state={xdtsImportDialog}
          template={template}
          onChange={updateXdtsImportDialog}
          onCancel={() => setXdtsImportDialog(null)}
          onConfirm={confirmXdtsImport}
        />
      )}

      {soundCueDialog && (() => {
        const sectionLabel = project.logicalSheet.timelineSections
          .find(section => section.role === 'sound')
          ?.label ?? 'SOUND'
        return (
          <SoundCueDialog
            state={soundCueDialog}
            cue={soundCueDialog.cueId === selectedSoundCue?.cueId ? selectedSoundCue : null}
            sectionLabel={sectionLabel}
            fps={project.logicalSheet.fps}
            frameMin={project.logicalSheet.frameOrigin}
            frameMax={project.logicalSheet.frameOrigin + project.logicalSheet.durationFrames - 1}
            labelHistory={soundLabelHistory}
            soundLanes={timelineLanesForLayout(project).sound ?? []}
            soundCues={project.timedRangeCues.filter(cue => cue.role === 'sound')}
            onSubmit={submitSoundCueDialog}
            onCancel={() => setSoundCueDialog(null)}
          />
        )
      })()}

      {cameraCueDialog && (() => {
        return (
          <CameraCueDialog
            state={cameraCueDialog}
            cue={cameraCueDialog.cueId === selectedCameraCue?.cueId ? selectedCameraCue : null}
            fps={project.logicalSheet.fps}
            frameMin={project.logicalSheet.frameOrigin}
            frameMax={project.logicalSheet.frameOrigin + project.logicalSheet.durationFrames - 1}
            instructionHistory={cameraInstructionHistory}
            pointLabelHistory={cameraPointLabelHistory}
            onSubmit={submitCameraCueDialog}
            onCancel={() => setCameraCueDialog(null)}
          />
        )
      })()}

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
          <dd>{selectedSoundCue ? selectedSoundCue.laneId : rangeSelection ? rangeSelection.paperTrack ?? rangeSelection.columnId : selection.hit?.paperTrack ?? '-'}</dd>
          <dt>{uiText.inspector.sheetRole}</dt>
          <dd>{selectedSoundCue ? 'SOUND' : rangeSelection ? rangeSelection.role.toUpperCase() : selection.hit ? sheetRoleLabel(sheetRoleForHit(selection.hit)) : '-'}</dd>
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
          <input type="file" accept={XSR_PROJECT_FILE_ACCEPT} onChange={event => void handleLoadProject(event.currentTarget.files)} />
        </label>
      </aside>

      <footer className="statusBar">
        <span className="statusSelection">{statusSelectionText}</span>
        {exportOperationNotice ? (
          <span className="exportOperationNotice" role="status">
            <strong>✓ {exportOperationNotice.message}</strong>
            {exportOperationNotice.directoryPath && <button type="button" onClick={() => void handleOpenExportDirectory()}>フォルダを開く</button>}
            <button type="button" className="dismiss" aria-label="書き出し通知を閉じる" onClick={() => setExportOperationNotice(null)}>×</button>
          </span>
        ) : statusHintText && <span className={activeStatusHint ? 'statusHint active' : 'statusHint'}>{statusHintText}</span>}
        <span className="statusIssueSummary">{uiText.issue.errorCount(issueErrorCount)} / 警告 {issueWarningCount}件</span>
      </footer>
    </div>
  )
}
