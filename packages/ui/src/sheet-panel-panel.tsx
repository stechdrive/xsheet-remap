import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent } from 'react'
import { DEFAULT_PRE_ROLL_FRAMES, type CutMetadataFieldId, type CutProject, type AnnotationPoint, type AnnotationStroke, type AnnotationText, type NameNormalizationPlan, type CutGroupProjectDocument, type SheetHit, type SheetImageAlignment, type SheetCalibrationPointPair, type SheetPage, type SheetTemplate, type SheetTimingRole, type SheetViewState, type SheetViewMode, type RecognitionCandidate, type StackGuideLabel, type TimelineMemoPlacement, type TimelineMemoPoint, type TimelineMemoStroke, getSheetTemplateHiddenPaperTracks, getSheetViewLayout, resolveSheetTemplatePageSize, updatePaperTrack, updateLogicalSheetSettings, type CutAsset, logicalSheetDisplayDurationFrames, logicalSheetWorkRange, type SheetTemplatePreset } from '@xsheet-remap/core'
import { type AssetRootCandidate } from '@xsheet-remap/adapters'
import { uiText } from './i18n'
import { type CameraCueClipboard, type EditMode, type SheetRangeSelection, type SheetPageImage, type SoundCueClipboard, type TimingClipboard, type WorkspaceStyle } from './appTypes'
import type { CameraCueTransformUpdates } from './app-camera-cue-controller'
import { AssetTray, type DropDiagnosticReport } from './AssetBrowser'
import { sortedCorrectionLayers } from './sheetAssets'
import { SHEET_ZOOM_MAX, SHEET_ZOOM_MIN } from './sheetConstants'
import { clampSheetZoom } from './sheetInteraction'
import { Tooltip, TooltipTarget } from './Tooltip'
import { ActionMenu, PanelResizeHandle, ToolbarGroup } from './AppControls'
import { CspLayerTree, type CspTreeAssetRegistrationResult, type CspTreeNewTrackRegistrationInput } from './CspLayerTree'
import { AutoCalibrationOverlayState, FrameOperationKind, MainAppKind, SHEET_AUTO_FIT_ZOOM_EPSILON, SHEET_LEFT_PANE_DEFAULT_WIDTH, SHEET_LEFT_PANE_MAX_WIDTH, SHEET_LEFT_PANE_MIN_WIDTH, SHEET_RIGHT_PANE_DEFAULT_WIDTH, SHEET_RIGHT_PANE_MAX_WIDTH, SHEET_RIGHT_PANE_MIN_WIDTH, SHEET_VIEWPORT_FIT_INSET, SheetPaneLayout, SheetScrollRequest, StackGuideInsertContext, StackGuideLabelUpdates, StatusHintSource, TextAnnotationUpdate, initialSheetPaneLayout } from './app-foundation'
import { templatePaperTracks } from './app-sheet-geometry'
import { NameNormalizationDialog, assetRegistrationSummaries } from './app-registered-cells'
import { DisplaySettingsIcon, EraserToolIcon, PaneChevronIcon, PenToolIcon, TextToolIcon, TrashIcon, sheetSourceLabel } from './app-navigation'
import { SheetCanvas } from './app-sheet-canvas'
import { clampAutoFitSheetZoom, fitSheetZoomForViewport } from './sheet-panel-viewport'
import { FontSizeControl } from './sheet-panel-annotation'

export function SheetPanel(props: {
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
  selectedSoundCueId: string | null
  selectedCameraCueId: string | null
  timingDraftValue: string
  timingDraftActive: boolean
  scrollRequest: SheetScrollRequest | null
  rangeSelection: SheetRangeSelection | null
  timingClipboard: TimingClipboard | null
  soundCueClipboard: SoundCueClipboard | null
  cameraCueClipboard: CameraCueClipboard | null
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
  showTemplateGuides: boolean
  showTemplateLabels: boolean
  showInputContent: boolean
  showAnnotations: boolean
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
  onMetadataChange: (field: CutMetadataFieldId, value: string, customKey?: string) => void
  onDurationChange: (frames: number) => void
  autoCalibrationRunning: boolean
  autoCalibrationMessage: string | null
  autoCalibrationOverlay: AutoCalibrationOverlayState | null
  onCellClick: (hit: SheetHit) => void
  onCellSelect: (hit: SheetHit) => void
  onRangeSelect: (range: SheetRangeSelection) => void
  onSoundCueSelect: (cueId: string) => void
  onSoundCueEdit: (cueId: string) => void
  onSoundRangeEdit: (range: SheetRangeSelection) => void
  onSoundCueTransform: (cueId: string, updates: { laneId: string; frameStart: number; frameEnd: number }) => void
  onCameraCueSelect: (cueId: string) => void
  onCameraCueEdit: (cueId: string) => void
  onCameraRangeEdit: (range: SheetRangeSelection) => void
  onCameraCueTransform: (cueId: string, updates: CameraCueTransformUpdates) => void
  onSetNullAtHit: (hit: SheetHit) => void
  onDeleteEventAtHit: (hit: SheetHit) => void
  onKeySelect: (keyId: string | null) => void
  onDeleteEvent: () => void
  onCopyRange: () => void
  onCutRange: () => void
  onCutRangeRipple: () => void
  onPasteTiming: (mode: 'overwrite' | 'insert' | 'repeat-range' | 'repeat-to-end') => void
  onCopySoundCues: () => void
  onCutSoundCues: () => void
  onDeleteSoundCues: () => void
  onPasteSoundCues: (mode: 'overwrite' | 'insert') => void
  onCopyCameraCues: () => void
  onCutCameraCues: () => void
  onDeleteCameraCues: () => void
  onPasteCameraCues: (mode: 'overwrite' | 'insert') => void
  onOpenFrameOperation: (kind: FrameOperationKind, hit: SheetHit) => void
  onCreateTimelineMemo: (hit: SheetHit) => string | null
  onDeleteTimelineMemo: (memoId: string) => void
  onUpdateTimelineMemoPlacement: (memoId: string, placement: TimelineMemoPlacement) => void
  onAppendTimelineMemoStroke: (memoId: string, stroke: Omit<TimelineMemoStroke, 'strokeId'>) => void
  onEraseTimelineMemoStroke: (memoId: string, points: TimelineMemoPoint[], widthUnits: number) => void
  onClearTimelineMemoStrokes: (memoId: string) => void
  onClearSelection: () => void
  onTemplateImage: (files: FileList | File[] | null) => void
  onAssignSheetSource: (pageId: string, sourceId: string | null) => void
  onAssetSheetSources: (assetIds: string[]) => void
  onAssetDrop: (files: File[], hit: SheetHit | null, position?: { x: number; y: number }) => void
  onAssetFiles: (files: FileList | File[] | null) => void
  onAssetRoots: (roots: AssetRootCandidate[]) => void
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
  onDeleteKey: (keyId: string) => void | Promise<void>
  onUpdateKeyCspCellName: (keyId: string, slotId: string, cspCellName: string) => void
  onMoveKeyBindingProcess: (keyId: string, sourceSlotId: string, targetCorrectionLayerId: string) => void
  onRenameProductionStage: (stageId: string, label: string) => void
  onRenameCorrectionLayer: (layerId: string, label: string) => void
  onCreateStackGuideLabel: (input: { label: string; gapIndex: number; insertAfterPaperTrack?: string; displayRole?: SheetTimingRole; viewSnapIndex?: number; kind?: StackGuideLabel['kind']; correctionLayerId?: string }) => void
  onUpdateStackGuideLabel: (labelId: string, updates: StackGuideLabelUpdates) => void
  onUpdateStackGuideRegistration: (labelId: string, correctionLayerId: string, cspCellName: string) => void
  onDeleteStackGuideLabel: (labelId: string) => void
  onAssignAssetToStackGuideLabel: (labelId: string, assetId: string, correctionLayerId?: string) => void
  onAssignAssetsToStackGuideLabel: (labelId: string, assetIds: string[], correctionLayerId?: string) => void
  onRegisterAssetsToCspTrack: (slotId: string, assetIds: string[]) => CspTreeAssetRegistrationResult
  onRegisterAssetsToNewCspTrack: (input: CspTreeNewTrackRegistrationInput) => CspTreeAssetRegistrationResult
  onCreateUnplacedCspCard: (slotId: string, cspCellName: string) => string | null
  onRegisterKeyToCspTrack: (keyId: string, slotId: string) => boolean
  onAddOverlayPaperTrack: (input: { paperTrack?: string; insertAfterPaperTrack?: string; orderInGap?: number; snapIndex?: number; sheetRole?: SheetTimingRole }) => void
  onUpdatePaperTrack: (paperTrack: string, updates: Parameters<typeof updatePaperTrack>[2]) => void
  onDeleteOverlayPaperTrack: (paperTrack: string) => void | Promise<void>
  onApplyNameNormalization: (plan: NameNormalizationPlan) => Promise<void>
  onAssignAssetToKey: (assetId: string, keyId: string, target?: { position?: { x: number; y: number }; slotId?: string }) => void
  onMoveCspStackItem: (itemId: string, direction: 'up' | 'down') => void
}) {
  const activePage = props.sheetPages[props.activePageIndex] ?? props.sheetPages[0]
  const [paneLayout, setPaneLayout] = useState<SheetPaneLayout>(() => initialSheetPaneLayout(props.appKind, props.collapseEditorPanes))
  const [zoomPaletteOpen, setZoomPaletteOpen] = useState(false)
  const [autoFitZoomEnabled, setAutoFitZoomEnabled] = useState(false)
  const [stackGuideInsertTool, setStackGuideInsertTool] = useState<StackGuideInsertContext | null>(null)
  const [normalizationOpen, setNormalizationOpen] = useState(false)
  const [selectedTimelineMemoId, setSelectedTimelineMemoId] = useState<string | null>(null)
  const editMode = props.editMode
  const setEditMode = props.setEditMode
  const activeTimelineMemoId = selectedTimelineMemoId && props.project.timelineMemos.some(memo => memo.memoId === selectedTimelineMemoId)
    ? selectedTimelineMemoId
    : null
  const beginTimelineMemoEdit = useCallback((memoId: string) => {
    setSelectedTimelineMemoId(memoId)
    setEditMode('pen')
  }, [setEditMode])
  const endTimelineMemoEdit = useCallback(() => {
    setSelectedTimelineMemoId(null)
    if (editMode === 'pen' || editMode === 'eraser') setEditMode('new')
  }, [editMode, setEditMode])
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
    if (!activeTimelineMemoId) return
    const closeOutside = (event: globalThis.PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null
      const memoElement = target?.closest('[data-timeline-memo-id]')
      const memoAnchorElement = target?.closest('[data-timeline-memo-ids]')
      const anchorMemoIds = (memoAnchorElement?.getAttribute('data-timeline-memo-ids') ?? '').split(/\s+/).filter(Boolean)
      if (memoElement?.getAttribute('data-timeline-memo-id') === activeTimelineMemoId
        || anchorMemoIds.includes(activeTimelineMemoId)
        || target?.closest('.sheetContextMenu, .annotationFloatingPalette')) return
      endTimelineMemoEdit()
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') endTimelineMemoEdit()
    }
    window.addEventListener('pointerdown', closeOutside, true)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOutside, true)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [activeTimelineMemoId, endTimelineMemoEdit])

  useEffect(() => {
    if (!selectedTimelineMemoId || activeTimelineMemoId) return
    const timer = window.setTimeout(endTimelineMemoEdit, 0)
    return () => window.clearTimeout(timer)
  }, [activeTimelineMemoId, endTimelineMemoEdit, selectedTimelineMemoId])

  useEffect(() => {
    if (!activeTimelineMemoId || editMode === 'new' || editMode === 'pen' || editMode === 'eraser') return
    const timer = window.setTimeout(() => setSelectedTimelineMemoId(null), 0)
    return () => window.clearTimeout(timer)
  }, [activeTimelineMemoId, editMode])

  useEffect(() => {
    try {
      window.localStorage.setItem(`xsheet:${props.appKind}:sheet-pane-layout`, JSON.stringify(paneLayout))
    } catch {
      // Pane state persistence is optional in restricted browser contexts.
    }
  }, [paneLayout, props.appKind])

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
                表示
              </label>
            )}
          </TooltipTarget>
        </ToolbarGroup>
        <ToolbarGroup className="sheetToolbarGroup processPaletteGroup">
          <TooltipTarget label="新規入力キーとシートへ直接配置する素材のCSP登録先">
            {tooltipProps => (
              <label className="compactControl processDestinationControl" {...tooltipProps}>
                <span>{uiText.sheet.registrationProcess}</span>
                <select
                  aria-label={uiText.sheet.registrationProcess}
                  value={props.activeCorrectionLayerId}
                  onChange={event => props.setActiveCorrectionLayerId(event.currentTarget.value)}
                >
                  {correctionLayers.map(layer => <option key={layer.layerId} value={layer.layerId}>{layer.label}</option>)}
                </select>
              </label>
            )}
          </TooltipTarget>
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
        <ToolbarGroup className="sheetToolbarGroup sheetPageToolbarGroup">
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
                <div className="pageJumpPanel" data-action-menu-keep-open>
                  <div className="pageJumpGrid" aria-label={uiText.sheet.pageSelection}>
                    {props.sheetPages.map(page => (
                      <Tooltip key={page.pageId} label={uiText.sheet.pageJumpTitle(page.pageIndex + 1)}>
                        <button
                          type="button"
                          className={page.pageIndex === props.activePageIndex ? 'pageJumpPageButton active' : 'pageJumpPageButton'}
                          aria-pressed={page.pageIndex === props.activePageIndex}
                          onClick={() => props.setActivePageIndex(page.pageIndex)}
                        >
                          {uiText.sheet.pageTab(page.pageIndex + 1)}
                        </button>
                      </Tooltip>
                    ))}
                  </div>
                  {activePage && (() => {
                    const pageState = props.project.sheetView.pages.find(item => item.pageId === activePage.pageId)
                    const sourceId = pageState?.sourceId ?? ''
                    return (
                      <div className="pageJumpEditor">
                        <strong>{uiText.sources.pageAssignmentLabel(activePage.pageIndex + 1)}</strong>
                        <TooltipTarget label={uiText.sources.pageAssignmentTitle(activePage.pageIndex + 1)}>
                          {tooltipProps => (
                            <label className="pageJumpSourceSelect" {...tooltipProps}>
                              <select
                                value={sourceId}
                                aria-label={uiText.sources.pageAssignmentLabel(activePage.pageIndex + 1)}
                                onChange={event => props.onAssignSheetSource(activePage.pageId, event.currentTarget.value || null)}
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
                            onClick={() => props.onAssignSheetSource(activePage.pageId, null)}
                          >
                            {uiText.sources.clearAssignment}
                          </button>
                        </Tooltip>
                      </div>
                    )
                  })()}
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
        </ToolbarGroup>
        {props.editMode === 'calibrate' && props.autoCalibrationMessage && (
          <span className="muted calibrationStatus">{props.autoCalibrationMessage}</span>
        )}
      </div>
      <div
        className={[
          'sheetWorkspace',
          paneLayout.left ? '' : 'leftDockClosed',
          paneLayout.right ? '' : 'rightDockClosed',
        ].filter(Boolean).join(' ')}
        style={{
          '--sheet-left-dock-width': paneLayout.left ? `${paneLayout.leftWidth}px` : '0px',
          '--sheet-right-dock-width': paneLayout.right ? `${paneLayout.rightWidth}px` : '0px',
          '--sheet-left-resizer-width': '16px',
          '--sheet-right-resizer-width': '16px',
        } as WorkspaceStyle}
      >
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
        <div
          className={activeTimelineMemoId ? 'annotationFloatingPalette timelineMemoTarget' : 'annotationFloatingPalette'}
          aria-label={activeTimelineMemoId ? uiText.sheet.timelineMemoAnnotationGroup : uiText.sheet.sheetAnnotationGroup}
          data-annotation-target={activeTimelineMemoId ? 'timeline-memo' : 'sheet'}
        >
          <span className="annotationPaletteTrigger" aria-hidden="true">
            <PenToolIcon />
            {activeTimelineMemoId && <span className="annotationTargetBadge">{uiText.sheet.timelineMemoTargetShort}</span>}
          </span>
          <span className="toolbarGroupLabel annotationPaletteTitle">
            {activeTimelineMemoId ? uiText.sheet.timelineMemoAnnotationGroup : uiText.sheet.sheetAnnotationGroup}
          </span>
          <Tooltip label={activeTimelineMemoId ? uiText.sheet.timelineMemoPenTool : uiText.sheet.penTool}>
            <button
              type="button"
              className={props.editMode === 'pen' ? 'activeToolButton' : ''}
              aria-pressed={props.editMode === 'pen'}
              aria-label={activeTimelineMemoId ? uiText.sheet.timelineMemoPenTool : uiText.sheet.penTool}
              onClick={() => props.setEditMode(props.editMode === 'pen' ? 'new' : 'pen')}
            >
              <PenToolIcon />
            </button>
          </Tooltip>
          <Tooltip label={activeTimelineMemoId ? uiText.sheet.timelineMemoEraserTool : uiText.sheet.eraserTool}>
            <button
              type="button"
              className={props.editMode === 'eraser' ? 'activeToolButton' : ''}
              aria-pressed={props.editMode === 'eraser'}
              aria-label={activeTimelineMemoId ? uiText.sheet.timelineMemoEraserTool : uiText.sheet.eraserTool}
              onClick={() => props.setEditMode(props.editMode === 'eraser' ? 'new' : 'eraser')}
            >
              <EraserToolIcon />
            </button>
          </Tooltip>
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
            {activeTimelineMemoId ? (
              <button type="button" onClick={() => props.onClearTimelineMemoStrokes(activeTimelineMemoId)}>{uiText.sheet.clearTimelineMemoInk}</button>
            ) : (
              <>
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
              </>
            )}
          </ActionMenu>
        </div>
        <aside id="sheet-left-pane" className="sheetDock sheetDockLeft" aria-label="CSPレイヤー構成" hidden={!paneLayout.left}>
          <div className="dockBody">
            <CspLayerTree
              project={props.project}
              exportProfileId={props.exportProfileId}
              selectedKeyId={props.selectedKeyId}
              onSelectKey={props.onKeySelect}
              onDeleteKey={props.onDeleteKey}
              activeCorrectionLayerId={props.activeCorrectionLayerId}
              onUpdateCspCellName={props.onUpdateKeyCspCellName}
              onMoveKeyBindingProcess={props.onMoveKeyBindingProcess}
              onRenameProductionStage={props.onRenameProductionStage}
              onRenameCorrectionLayer={props.onRenameCorrectionLayer}
              onUpdateStackGuideRegistration={props.onUpdateStackGuideRegistration}
              onUpdateStackGuideLabel={props.onUpdateStackGuideLabel}
              onDeleteStackGuideLabel={props.onDeleteStackGuideLabel}
              onRenamePaperTrack={(paperTrack, name) => props.onUpdatePaperTrack(paperTrack, { paperTrack: name, label: name })}
              onMoveStackItem={props.onMoveCspStackItem}
              onAssignAsset={(assetId, keyId, slotId) => props.onAssignAssetToKey(assetId, keyId, { slotId })}
              onAssignAssetsToStackGuideLabel={props.onAssignAssetsToStackGuideLabel}
              onRegisterAssetsToTrack={props.onRegisterAssetsToCspTrack}
              onRegisterAssetsToNewTrack={props.onRegisterAssetsToNewCspTrack}
              onCreateUnplacedCard={props.onCreateUnplacedCspCard}
              onRegisterKeyToTrack={props.onRegisterKeyToCspTrack}
              onOpenNameNormalization={() => setNormalizationOpen(true)}
              onRequestOverlayPaperTrack={() => setStackGuideInsertTool({ mode: 'overlay-track' })}
              onRequestStackGuideInsert={correctionLayerId => setStackGuideInsertTool({
                mode: 'label-editor',
                correctionLayerId,
                preferredSnapIndex: 0,
              })}
              onCreateStackGuideLabel={props.onCreateStackGuideLabel}
            />
          </div>
        </aside>
        <PanelResizeHandle
          label={uiText.layout.resizeCspLayerTreePane}
          min={SHEET_LEFT_PANE_MIN_WIDTH}
          max={SHEET_LEFT_PANE_MAX_WIDTH}
          value={paneLayout.leftWidth}
          defaultValue={SHEET_LEFT_PANE_DEFAULT_WIDTH}
          side="left"
          resizeEnabled={paneLayout.left}
          dockToggle={{
            label: 'CSPレイヤー構成',
            tooltipLabel: `CSPレイヤー構成を${paneLayout.left ? '閉じる' : '開く'}`,
            controls: 'sheet-left-pane',
            expanded: paneLayout.left,
            icon: <PaneChevronIcon direction={paneLayout.left ? 'left' : 'right'} />,
            onToggle: () => setPaneLayout(current => ({ ...current, left: !current.left })),
          }}
          onChange={leftWidth => setPaneLayout(current => ({ ...current, leftWidth }))}
        />
        <SheetCanvas
          {...props}
          selectedTimelineMemoId={activeTimelineMemoId}
          onCreateTimelineMemo={hit => {
            const memoId = props.onCreateTimelineMemo(hit)
            if (memoId) beginTimelineMemoEdit(memoId)
          }}
          onSelectTimelineMemo={memoId => memoId ? beginTimelineMemoEdit(memoId) : endTimelineMemoEdit()}
          onDeleteTimelineMemo={memoId => {
            props.onDeleteTimelineMemo(memoId)
            endTimelineMemoEdit()
          }}
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
        <PanelResizeHandle
          label={uiText.layout.resizeImageAssetPane}
          min={SHEET_RIGHT_PANE_MIN_WIDTH}
          max={SHEET_RIGHT_PANE_MAX_WIDTH}
          value={paneLayout.rightWidth}
          defaultValue={SHEET_RIGHT_PANE_DEFAULT_WIDTH}
          resizeEnabled={paneLayout.right}
          dockToggle={{
            label: '画像素材',
            tooltipLabel: `画像素材を${paneLayout.right ? '閉じる' : '開く'}`,
            controls: 'sheet-right-pane',
            expanded: paneLayout.right,
            icon: <PaneChevronIcon direction={paneLayout.right ? 'right' : 'left'} />,
            onToggle: () => setPaneLayout(current => ({ ...current, right: !current.right })),
          }}
          onChange={rightWidth => setPaneLayout(current => ({ ...current, rightWidth }))}
        />
        <aside id="sheet-right-pane" className="sheetDock sheetDockRight" aria-label={uiText.assets.title} hidden={!paneLayout.right}>
          <div className="dockBody">
            <AssetTray
              assetRoot={props.project.assetRoot}
              assets={props.assets}
              registrationSummaries={assetRegistrationSummaryMap}
              onAssets={props.onAssetFiles}
              onAssetRoots={props.onAssetRoots}
              onAssetSheetSources={props.onAssetSheetSources}
              canUseAssetsAsSheetSources={sheetScanSources.length === 0}
              onDropDiagnostic={props.onDropDiagnostic}
            />
          </div>
        </aside>
      </div>
      {normalizationOpen && (
        <NameNormalizationDialog
          project={props.project}
          selectedKeyId={props.selectedKeyId}
          selectedHit={props.selectedHit}
          rangeSelection={props.rangeSelection}
          initialCorrectionLayerId={props.appKind === 'remap' ? props.activeCorrectionLayerId : undefined}
          onClose={() => setNormalizationOpen(false)}
          onApply={async plan => {
            await props.onApplyNameNormalization(plan)
            setNormalizationOpen(false)
          }}
        />
      )}
    </section>
  )
}
