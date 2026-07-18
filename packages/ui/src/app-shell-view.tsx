import { clearAnnotations, clearAnnotationsForPage, type SheetViewMode, sheetTemplatePresets, updateLogicalSheetSettings, updateSheetViewState } from '@xsheet-remap/core';
import { APP_VERSION } from './appVersion';
import { uiText, viewModeLabels } from './i18n';
import { LevelCorrectionDialog } from './LevelCorrectionDialog';
import { roundForInput } from './sheetImages';
import { sheetRoleForHit, sheetRoleLabel } from './sheetInteraction';
import { Tooltip, TooltipTarget } from './Tooltip';
import { CalibrationLoupeDialog } from './sheetCalibrationLoupe';
import { ActionMenu, ScrubbableNumberInput } from './AppControls';
import { TemplateWorkspace } from './TemplateWorkspace';
import { AssetDropProcessMenu } from './app-sheet-layers';
import { FrameOperationDialog, SheetImageExportDialog } from './app-registered-cells';
import { AppHelpDialog, AppNavigationMenu, CutMetadataActionMenu, HelpIcon, RecognitionActionMenu, RedoIcon, UndoIcon, ViewModeIcon } from './app-navigation';
import { SheetPanel } from './app-sheet-panel';
import type { AppController } from './app-shell-controller'
import { TimingExportDialog } from './TimingExportDialog'
import { SoundCueDialog } from './SoundCueDialog'
import { CameraCueDialog } from './CameraCueDialog'
import { XdtsImportDialog } from './XdtsImportDialog'

export function AppShellView({ controller }: { controller: AppController }) {
  const {
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
    setTimingExportDialog, xdtsImportDialog, setXdtsImportDialog, frameOperationDialog, setFrameOperationDialog, assetDropMenu, setAssetDropMenu,
    projectDocumentSnapshot, projectCuts, timingExportPlan, sheetPages, clampedActivePageIndex,
    activePage, activePageImage, hasRecognitionSheetImages, activeCorrectionLayerId, activeCorrectionLayer, materialAssets,
    issueErrorCount, issueWarningCount, activeCalibrationPoints, activeCalibrationPointsKey, selectedKeySummary,
    selectedFrameSummary, selectedTextAnnotation, editingTextAnnotation, activeTextFontSizePx, hasSelectedTextTarget, isTextFontSizeDisabled,
    setStatusHint, switchPanel, activeStatusHint, statusSelectionText, statusHintText, commitProject,
    recordDropDiagnostic, setActivePageIndex, updateTiming, updateTimingExportRole, updateTimingExportOptions, updateXdtsImportDialog, handleRangeSelect,
    handleCellClick, handleCellSelect, handleSetNullAtHit, handleDeleteEventAtHit, handleKeySelect,
    handleSoundCueSelect, openSoundCueEditor, openSoundCueEditorForRange, submitSoundCueDialog, handleTransformSoundCue,
    handleCameraCueSelect, openCameraCueEditor, openCameraCueEditorForRange, submitCameraCueDialog, handleTransformCameraCue,
    handleActiveCorrectionLayerChange, handleClearSelection, startCalibrationWithLoupe, closeCalibrationLoupe, handleDeleteEvent, handleDeleteCspCard,
    copySelectedTimingRange, pasteTimingClipboard, copySelectedSoundCueRange, pasteSelectedSoundCueRange,
    copySelectedCameraCueRange, pasteSelectedCameraCueRange, openFrameOperationDialog, applyFrameOperation, handleSheetSourceFiles, openPaperSheetFilePicker,
    handleAssetSheetSources, handleAssignSheetSource, updateActivePageAlignment, activePageLevelCorrectionSettings, updateActivePageLevelCorrection, toggleActivePageLevelCorrection,
    updatePageCalibrationPoints, startSheetImageWarp, disableSheetImageWarp, applySheetImageWarp, autoDetectSheetImageWarp, handleAssetFiles,
    handleAssetNativePaths, handleAssetRootCandidates, handleAssignAsset, handleAssignRegisteredCell,
    handleMoveTimelineEvent, handleApplyNameNormalization, handleAssignAssetToKey, assignAssetToKeySlot, handleUpdateKeyCspCellName, handleCreateUnplacedCspCard, handleRegisterKeyToCspTrack,
    handleMoveKeyBindingProcess, handleMoveCspStackItem, handleCreateStackGuideLabel, handleUpdateStackGuideLabel, handleDeleteStackGuideLabel, handleUpdateStackGuideRegistration,
    handleAssignAssetToStackGuide, handleAssignAssetsToStackGuide, handleRegisterAssetsToCspTrack, handleRegisterAssetsToNewCspTrack, handleAddOverlayPaperTrack, handleUpdatePaperTrack,
    handleDeleteOverlayPaperTrack, handleUpdateCorrectionLayers, handleRenameProductionStage, handleRenameCorrectionLayer, handleLoadProject, handleLoadTemplate, handleImportTemplate, handleLoadXdts, confirmXdtsImport, handleApplyTemplateDraft, handleCreateTemplateDraft,
    handleCreatePaperTemplateFromImage, handleSaveTemplateJson, handleSaveProjectJson, handleUpdateCutMetadata, handleSwitchProjectCut,
    handleAddSharedCut, openTimingExportDialog, confirmTimingExport, handleOpenSheetImageExport, handleSaveSheetImageExport, handlePresetSelect,
    handleUndo, handleRedo, handleResetApp, handleAnnotation, handleCreateTimelineMemo, handleDeleteTimelineMemo, handleUpdateTimelineMemoPlacement, handleAppendTimelineMemoStroke, handleEraseTimelineMemoStroke, handleClearTimelineMemoStrokes, handleTextAnnotation, handleSelectTextAnnotation,
    handleEditTextAnnotation, handleUpdateTextAnnotation, handleCommitTextAnnotation, handleCancelTextAnnotation, handleCommitFocusedTextAnnotationDraft, handleTextFontSizeChange,
    handleEraseAnnotation, handleRecognizeSheet, acceptRecognitionCandidate, acceptAllRecognitionCandidates, updateRecognitionCandidateLabel,
  } = controller

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
            onSaveProject={() => void handleSaveProjectJson()}
            onSaveProjectAs={() => void handleSaveProjectJson({ saveAs: true })}
            onSaveTemplate={() => void handleSaveTemplateJson()}
            onResetApp={handleResetApp}
            onOpenSheetImageExport={handleOpenSheetImageExport}
            onSaveXdts={() => openTimingExportDialog('xdts')}
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
            onDurationChange={durationFrames => commitProject(updateLogicalSheetSettings(project, { durationFrames }))}
          />
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
                <TooltipTarget label={uiText.sheet.imageOpacityTitle}>
                  {tooltipProps => (
                    <label className="compactControl topOpacityControl" {...tooltipProps}>
                      不透明度
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
              </div>
            </>
          )}
          <div className="topUtilityActions">
            {panel === 'sheet' && (
              <ActionMenu label={<ViewModeIcon />} ariaLabel={uiText.sheet.viewModeMenu} tooltipLabel={uiText.sheet.viewModeMenuTitle} className="iconActionMenu topViewModeMenu sheetLayerMenu" closeOnMenuItemClick>
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
                <div className="sheetLayerMenuList" data-action-menu-keep-open>
                  <span className="actionMenuSectionLabel">描画レイヤー</span>
                  <label className="compactControl">
                    <input type="checkbox" checked={showTemplate} onChange={event => setShowTemplate(event.currentTarget.checked)} />
                    {uiText.sheet.paperSheetImage}
                  </label>
                  <label className="compactControl">
                    <input type="checkbox" checked={showTemplateGuides} onChange={event => setShowTemplateGuides(event.currentTarget.checked)} />
                    {uiText.sheet.templateGuides}
                  </label>
                  <label className="compactControl">
                    <input type="checkbox" checked={showTemplateLabels} onChange={event => setShowTemplateLabels(event.currentTarget.checked)} />
                    {uiText.sheet.templateLabels}
                  </label>
                  <label className="compactControl">
                    <input type="checkbox" checked={showInputContent} onChange={event => setShowInputContent(event.currentTarget.checked)} />
                    {uiText.sheet.inputContent}
                  </label>
                  <label className="compactControl">
                    <input type="checkbox" checked={showAnnotations} onChange={event => setShowAnnotations(event.currentTarget.checked)} />
                    {uiText.sheet.annotations}
                  </label>
                </div>
              </ActionMenu>
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
            selectedSoundCueId={selectedSoundCueId}
            selectedCameraCueId={selectedCameraCueId}
            timingDraftValue={valueDraft}
            timingDraftActive={valueDraftActive}
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
            onMetadataChange={handleUpdateCutMetadata}
            onDurationChange={durationFrames => commitProject(updateLogicalSheetSettings(project, { durationFrames }))}
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
            onDeleteEventAtHit={handleDeleteEventAtHit}
            onKeySelect={handleKeySelect}
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
            onDeleteTimelineMemo={handleDeleteTimelineMemo}
            onUpdateTimelineMemoPlacement={handleUpdateTimelineMemoPlacement}
            onAppendTimelineMemoStroke={handleAppendTimelineMemoStroke}
            onEraseTimelineMemoStroke={handleEraseTimelineMemoStroke}
            onClearTimelineMemoStrokes={handleClearTimelineMemoStrokes}
            onClearSelection={handleClearSelection}
            onTemplateImage={files => void handleSheetSourceFiles(files, activePage?.pageId)}
            onAssignSheetSource={handleAssignSheetSource}
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
            onApplyNameNormalization={handleApplyNameNormalization}
            onAssignAssetToKey={handleAssignAssetToKey}
            onMoveCspStackItem={handleMoveCspStackItem}
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

      {timingExportDialog && timingExportPlan && (
        <TimingExportDialog
          state={timingExportDialog}
          template={template}
          assetRootPath={project.assetRoot?.path}
          issues={timingExportPlan.validation}
          onChangeRole={updateTimingExportRole}
          onChangeOptions={updateTimingExportOptions}
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
        const lane = project.logicalSheet.timelineSections
          .find(section => section.role === 'sound')
          ?.lanes?.find(item => item.laneId === soundCueDialog.laneId) ?? null
        return (
          <SoundCueDialog
            state={soundCueDialog}
            cue={soundCueDialog.cueId === selectedSoundCue?.cueId ? selectedSoundCue : null}
            lane={lane}
            fps={project.logicalSheet.fps}
            frameMin={project.logicalSheet.frameOrigin}
            frameMax={project.logicalSheet.frameOrigin + project.logicalSheet.durationFrames - 1}
            labelHistory={soundLabelHistory}
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
