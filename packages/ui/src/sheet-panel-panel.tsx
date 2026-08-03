import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type FormEvent, type ReactNode } from 'react'
import { DEFAULT_PRE_ROLL_FRAMES, type CutMetadataFieldId, type CutProject, type AnnotationPoint, type AnnotationStroke, type AnnotationText, type NameNormalizationPlan, type CutGroupProjectDocument, type SheetHit, type SheetImageAlignment, type SheetCalibrationPointPair, type SheetPage, type SheetPageMemoTarget, type SheetTemplate, type SheetTemplateFieldDefinition, type SheetTimingRole, type SheetViewState, type SheetViewMode, type TimedRangeRole, type RecognitionCandidate, type SheetRevisionDocument, type StackGuideLabel, type TimelineMemoPlacement, type TimelineMemoPoint, type TimelineMemoStroke, type TimelineMemoText, type TimingSpecialMarker, getSheetTemplateHiddenPaperTracks, getSheetViewLayout, resolveSheetTemplatePageSize, timelineLanesForLayout, updatePaperTrack, updateLogicalSheetSettings, type CutAsset, logicalSheetDisplayDurationFrames, logicalSheetWorkRange, type SheetTemplatePreset, sheetAnnotations, timelineMemos } from '@xsheet-remap/core'
import { timelineMemoSegmentsForPage } from './timelineMemoGeometry'
import { normalizeMemoAppearance, type MemoAppearance } from '@xsheet-remap/core'
import { type AssetRootCandidate } from '@xsheet-remap/adapters'
import { uiText, viewModeLabels } from './i18n'
import { type CameraCueClipboard, type EditMode, type SheetRangeSelection, type SheetPageImage, type SoundCueClipboard, type TemplateRegionAnnotationTarget, type TimingClipboard, type WorkspaceStyle } from './appTypes'
import type { CameraCueTransformUpdates } from './app-camera-cue-controller'
import type { DialogueSoundCueChangeIntent } from './dialogueAudioBinding'
import { AssetTray, type DropDiagnosticReport } from './AssetBrowser'
import { SHEET_ZOOM_MAX, SHEET_ZOOM_MIN } from './sheetConstants'
import { clampSheetZoom } from './sheetInteraction'
import { Tooltip, TooltipSuppressionProvider, TooltipTarget } from './Tooltip'
import { ActionMenu, PanelResizeHandle } from './AppControls'
import { CspLayerTree, type CspTreeAssetRegistrationResult, type CspTreeNewTrackRegistrationInput } from './CspLayerTree'
import { AutoCalibrationOverlayState, FrameOperationKind, MainAppKind, SHEET_AUTO_FIT_ZOOM_EPSILON, SHEET_LEFT_PANE_DEFAULT_WIDTH, SHEET_LEFT_PANE_MAX_WIDTH, SHEET_LEFT_PANE_MIN_WIDTH, SHEET_RIGHT_PANE_DEFAULT_WIDTH, SHEET_RIGHT_PANE_MAX_WIDTH, SHEET_RIGHT_PANE_MIN_WIDTH, SHEET_VIEWPORT_FIT_INSET, SheetPaneLayout, SheetScrollRequest, StackGuideInsertContext, StackGuideLabelUpdates, StatusHintSource, TextAnnotationUpdate, initialSheetPaneLayout } from './app-foundation'
import { templatePaperTracks } from './app-sheet-geometry'
import { NameNormalizationDialog, assetRegistrationSummaries } from './app-registered-cells'
import { CheckSmallIcon, CloseSmallIcon, DisplaySettingsIcon, EraserToolIcon, PaneChevronIcon, PenToolIcon, PlusIcon, SharedCutIcon, TextSizeIcon, TextToolIcon, TrashIcon } from './app-navigation'
import { SheetCanvas, type SheetCanvasHandle } from './app-sheet-canvas'
import { clampAutoFitSheetZoom, fitSheetZoomForViewport } from './sheet-panel-viewport'
import { FontSizeControl } from './sheet-panel-annotation'
import { templateMemoTargetLabel } from './templateMemoTargets'
import {
  resolveTemplateMemoTargetGeometry,
  templateMemoTargetGeometries,
} from './pageMemoProjection'
import { SheetHistoryRail } from './SheetHistoryRail'
import { suppressSheetTooltips } from './sheetInteractionOwnership'
import { resolveSheetAnnotationTarget } from './sheetAnnotationTarget'
import { SheetTouchControls } from './SheetTouchControls'
import { timingKeyDisplayLabel } from './workspaceSelectionModel'

export type TemplateRegionAnnotationTargetIdentity = Pick<
  TemplateRegionAnnotationTarget,
  'kind' | 'pageId' | 'templateId' | 'regionId' | 'targetId' | 'logicalTargetId'
>

export function templateRegionAnnotationTargetIdentity(
  target: TemplateRegionAnnotationTarget,
): TemplateRegionAnnotationTargetIdentity {
  return {
    kind: 'template-region',
    pageId: target.pageId,
    templateId: target.templateId,
    regionId: target.regionId,
    targetId: target.targetId,
    logicalTargetId: target.logicalTargetId,
  }
}

export function resolveSelectedTemplateRegionAnnotationTarget(
  selected: TemplateRegionAnnotationTargetIdentity | null,
  activePageId: string | undefined,
  template: SheetTemplate,
  geometries: ReturnType<typeof templateMemoTargetGeometries>,
): { target: TemplateRegionAnnotationTarget | null; unavailable: boolean } {
  const selectedOnCurrentSurface = Boolean(
    selected
      && selected.pageId === activePageId
      && selected.templateId === template.templateId,
  )
  if (!selected || !selectedOnCurrentSurface) return { target: null, unavailable: false }
  const geometry = resolveTemplateMemoTargetGeometry(selected, geometries)
  if (!geometry) return { target: null, unavailable: true }
  return {
    target: {
      kind: 'template-region',
      pageId: selected.pageId,
      templateId: template.templateId,
      regionId: geometry.regionId,
      targetId: geometry.targetId,
      logicalTargetId: geometry.logicalTargetId,
      rect: geometry.rect,
      label: templateMemoTargetLabel(template, geometry),
    },
    unavailable: false,
  }
}

export function isSelectedTextMemoTargetUnavailable(
  selectedTextAnnotationId: string | null,
  annotation: Pick<AnnotationText, 'coordinateSpace'> | null,
  resolvedTarget: unknown | null,
): boolean {
  return Boolean(
    selectedTextAnnotationId
      && (!annotation || (annotation.coordinateSpace === 'memo-target' && !resolvedTarget)),
  )
}

export function useCurrentTemplateMemoTargetGeometries(
  template: SheetTemplate,
  project: Pick<CutProject, 'logicalSheet' | 'sheetView'>,
) {
  const logicalSheet = project.logicalSheet
  const paperTracks = logicalSheet.paperTracks
  const timelineSections = logicalSheet.timelineSections
  const durationFrames = logicalSheetDisplayDurationFrames(logicalSheet)
  const layoutOverrides = project.sheetView.layoutOverrides
  return useMemo(
    () => templateMemoTargetGeometries(template, {
      paperTracks: paperTracks.map(track => track.paperTrack),
      timelineLanes: timelineLanesForMemoTargetGeometry(timelineSections),
      durationFrames,
      layoutOverrides,
    }),
    [
      durationFrames,
      layoutOverrides,
      paperTracks,
      template,
      timelineSections,
    ],
  )
}

function timelineLanesForMemoTargetGeometry(
  timelineSections: CutProject['logicalSheet']['timelineSections'],
): ReturnType<typeof timelineLanesForLayout> {
  return Object.fromEntries(
    timelineSections
      .filter(section => section.role === 'sound' || section.role === 'camera')
      .map(section => [section.role, [...(section.lanes ?? [])].sort((left, right) => left.order - right.order)]),
  )
}

export function SheetPanel(props: {
  appKind: MainAppKind
  collapseEditorPanes: boolean
  project: CutProject
  referenceProject: CutProject | null
  referenceOpacity: number
  exportProfileId: string
  template: SheetTemplate
  templatePresets: SheetTemplatePreset[]
  selectedPresetId?: string
  onPresetSelect: (presetId: string) => void
  railExternalActions?: ReactNode
  projectCuts: CutGroupProjectDocument['cuts']
  activeCutId: string
  onSwitchProjectCut: (cutId: string) => void
  onAddSharedCut: (label: string) => void
  onDeleteSharedCut: () => void
  sheetRevisions: SheetRevisionDocument[]
  activeSheetRevisionId: string
  onSwitchSheetRevision: (revisionId: string) => void
  onAddSheetRevision: (input: { name: string; mode: 'duplicate' | 'blank'; showSourceReference: boolean }) => void
  onRenameSheetRevision: (revisionId: string, name: string | undefined) => void
  onToggleSheetRevisionProtected: (revisionId: string, protectedState: boolean) => void
  onToggleSheetRevisionSourceReference: (revisionId: string, enabled: boolean) => void
  onDeleteSheetRevision: (revisionId: string) => void
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
  audioPlayheadFrame: number | null
  selectedSoundCueId: string | null
  selectedCameraCueId: string | null
  timingDraftValue: string
  timingDraftActive: boolean
  timingInputDisabled: boolean
  onTimingInputCharacter: (character: string) => void
  onTimingInputBackspace: () => void
  onTimingInputCommit: (advance: boolean) => void
  onTimingInputMove: (trackDelta: number, frameDelta: number) => void
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
  onShowTemplateChange: (visible: boolean) => void
  onShowTemplateGuidesChange: (visible: boolean) => void
  onShowTemplateLabelsChange: (visible: boolean) => void
  onShowInputContentChange: (visible: boolean) => void
  onShowAnnotationsChange: (visible: boolean) => void
  onContinuationDisplayChange: (role: 'action' | 'cell', visible: boolean) => void
  penColor: string
  setPenColor: (value: string) => void
  penWidth: number
  setPenWidth: (value: number) => void
  eraserWidth: number
  setEraserWidth: (value: number) => void
  textFontSizePx: number
  timingTextFontSizePx: number
  selectedTextAnnotationId: string | null
  editingTextAnnotationId: string | null
  hasSelectedTextTarget: boolean
  textFontSizeDisabled: boolean
  onTextFontSizeChange: (value: number) => void
  onMemoTextFontSizeChange: (value: number) => void
  onMetadataChange: (field: CutMetadataFieldId, value: string, customKey?: string) => void
  onDurationChange: (frames: number) => void
  onFormFieldChange: (definition: SheetTemplateFieldDefinition, value: string | number | boolean, pageId: string) => void
  autoCalibrationRunning: boolean
  autoCalibrationMessage: string | null
  autoCalibrationOverlay: AutoCalibrationOverlayState | null
  onCellClick: (hit: SheetHit) => void
  onCellSelect: (hit: SheetHit) => void
  onRangeSelect: (range: SheetRangeSelection) => void
  onSoundCueSelect: (cueId: string) => void
  onSoundCueEdit: (cueId: string) => void
  onSoundRangeEdit: (range: SheetRangeSelection) => void
  onSoundCueTransform: (
    cueId: string,
    updates: { laneId: string; frameStart: number; frameEnd: number },
    intent?: DialogueSoundCueChangeIntent,
  ) => void
  onCameraCueSelect: (cueId: string) => void
  onCameraCueEdit: (cueId: string) => void
  onCameraRangeEdit: (range: SheetRangeSelection) => void
  onCameraCueTransform: (cueId: string, updates: CameraCueTransformUpdates) => void
  onSetNullAtHit: (hit: SheetHit) => void
  onSetTimingSpecialAtHit: (hit: SheetHit, marker: TimingSpecialMarker) => void
  onDeleteEventAtHit: (hit: SheetHit) => void
  onKeySelect: (keyId: string | null) => void
  onStackGuideSelect: (labelId: string) => void
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
  onCreateTimelineMemoForCue: (cueId: string) => string | null
  onDeleteTimelineMemo: (memoId: string) => void
  onUpdateTimelineMemoPlacement: (memoId: string, placement: TimelineMemoPlacement) => void
  onAppendTimelineMemoStroke: (memoId: string, stroke: Omit<TimelineMemoStroke, 'strokeId'>) => void
  onEraseTimelineMemoStroke: (memoId: string, points: TimelineMemoPoint[], widthUnits: number) => void
  onUpsertTimelineMemoText: (memoId: string, text: TimelineMemoText, appearance: MemoAppearance) => void
  onUpdateTimelineMemoAppearance: (memoId: string, appearance: MemoAppearance) => void
  onClearTimelineMemoStrokes: (memoId: string) => void
  onClearSelection: () => void
  onAssetSheetSources: (assetIds: string[]) => void
  onAssetDrop: (files: File[], hit: SheetHit | null, position?: { x: number; y: number }) => void
  onAssetFiles: (files: FileList | File[] | null) => void
  onAssetRoots: (roots: AssetRootCandidate[]) => void
  onAssetNativePaths: (paths: string[], options?: { recursive?: boolean }) => void
  onDropDiagnostic: (report: DropDiagnosticReport) => void
  onAssetAssign: (assetId: string, hit: SheetHit | null, position?: { x: number; y: number }) => void
  onRegisteredCellAssign: (keyId: string, hit: SheetHit | null) => void
  onMoveTimelineEvent: (sourceHit: SheetHit, targetHit: SheetHit, sourceRange?: SheetRangeSelection) => void
  onAnnotation: (stroke: AnnotationStroke) => void
  onTextAnnotation: (annotation: AnnotationText) => void
  onSelectTextAnnotation: (annotationId: string) => void
  onEditTextAnnotation: (annotationId: string) => void
  onUpdateTextAnnotation: (annotationId: string, updates: TextAnnotationUpdate) => void
  onCommitTextAnnotation: (annotationId: string, text: string) => void
  onCancelTextAnnotation: (annotationId: string) => void
  onCommitFocusedTextAnnotationDraft: () => void
  onEraseAnnotation: (pageId: string, points: AnnotationPoint[], width: number, target: SheetPageMemoTarget) => void
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
  onCreateStackGuideLabel: (input: { label: string; gapIndex: number; insertAfterPaperTrack?: string; displayRole?: SheetTimingRole; viewSnapIndex?: number; kind?: StackGuideLabel['kind']; correctionLayerId?: string; cspPlacement?: 'cell-bottom' }) => void
  onUpdateStackGuideLabel: (labelId: string, updates: StackGuideLabelUpdates) => void
  onUpdateStackGuideRegistration: (labelId: string, correctionLayerId: string, cspCellName: string) => void
  onDeleteStackGuideLabel: (labelId: string) => void
  onAssignAssetToStackGuideLabel: (labelId: string, assetId: string, correctionLayerId?: string) => void
  onAssignAssetsToStackGuideLabel: (labelId: string, assetIds: string[], correctionLayerId?: string) => void
  onRegisterAssetsToCspTrack: (slotId: string, assetIds: string[]) => CspTreeAssetRegistrationResult
  onRegisterAssetsToNewCspTrack: (input: CspTreeNewTrackRegistrationInput) => CspTreeAssetRegistrationResult
  onCreateUnplacedCspCard: (slotId: string, cspCellName: string) => string | null
  onRegisterKeyToCspTrack: (keyId: string, slotId: string) => boolean
  onAddOverlayPaperTrack: (input: { paperTrack?: string; insertAfterPaperTrack?: string; orderInGap?: number; snapIndex?: number; sheetRole?: SheetTimingRole; cspPlacement?: 'cell-top' }) => void
  onUpdatePaperTrack: (paperTrack: string, updates: Parameters<typeof updatePaperTrack>[2]) => void
  onDeleteOverlayPaperTrack: (paperTrack: string) => void | Promise<void>
  onCopyAeKeyframeData: (paperTrack: string, sheetRole: SheetTimingRole, locale?: 'ja' | 'en') => void
  onAddTimelineLane: (input: { role: TimedRangeRole; label: string; insertAfterLaneId?: string }) => void
  onUpdateTimelineLane: (role: TimedRangeRole, laneId: string, label: string) => void
  onDeleteTimelineLane: (role: TimedRangeRole, laneId: string) => void
  onApplyNameNormalization: (plan: NameNormalizationPlan) => Promise<void>
  onAssignAssetToKey: (assetId: string, keyId: string, target?: { position?: { x: number; y: number }; slotId?: string }) => void
  onReorderCspStackItem: (itemId: string, referenceItemId: string, edge: 'before' | 'after') => void
  onReorderProductionStage: (stageId: string, referenceStageId: string, edge: 'before' | 'after') => void
  onReorderCorrectionLayer: (layerId: string, referenceLayerId: string, edge: 'before' | 'after') => void
  onDeleteCorrectionLayer: (layerId: string) => void
}) {
  const activePage = props.sheetPages[props.activePageIndex] ?? props.sheetPages[0]
  const [paneLayout, setPaneLayout] = useState<SheetPaneLayout>(() => initialSheetPaneLayout(props.appKind, props.collapseEditorPanes))
  const [zoomPaletteOpen, setZoomPaletteOpen] = useState(false)
  const [annotationPaletteOpen, setAnnotationPaletteOpen] = useState(false)
  const [autoFitZoomEnabled, setAutoFitZoomEnabled] = useState(false)
  const [stackGuideInsertTool, setStackGuideInsertTool] = useState<StackGuideInsertContext | null>(null)
  const [normalizationOpen, setNormalizationOpen] = useState(false)
  const [sharedCutDraft, setSharedCutDraft] = useState<string | null>(null)
  const [sharedCutDraftError, setSharedCutDraftError] = useState<string | null>(null)
  const [selectedTimelineMemoId, setSelectedTimelineMemoId] = useState<string | null>(null)
  const [selectedAnnotationRegion, setSelectedAnnotationRegion] = useState<TemplateRegionAnnotationTargetIdentity | null>(null)
  const [touchControlsVisible, setTouchControlsVisible] = useState(false)
  const [touchRangeSelectionMode, setTouchRangeSelectionMode] = useState(false)
  const sharedCutInputRef = useRef<HTMLInputElement>(null)
  const annotationPaletteRef = useRef<HTMLDivElement>(null)
  const sheetCanvasRef = useRef<SheetCanvasHandle>(null)
  const editMode = props.editMode
  const setEditMode = props.setEditMode
  const onTimingInputCommit = props.onTimingInputCommit
  const annotationSessionActive = editMode === 'pen' || editMode === 'eraser' || editMode === 'text'
  const annotationPaletteExpanded = annotationPaletteOpen || annotationSessionActive
  const activeTimelineMemoId = selectedTimelineMemoId && timelineMemos(props.project).some(memo => memo.memoId === selectedTimelineMemoId)
    ? selectedTimelineMemoId
    : null
  const touchTimingInputVisible = Boolean(
    props.selectedHit?.paperTrack
      && (props.selectedHit.role === 'action' || props.selectedHit.role === 'cell'),
  )
  const touchContextMenuAvailable = Boolean(
    props.selectedHit
      || props.rangeSelection
      || props.selectedSoundCueId
      || props.selectedCameraCueId
      || activeTimelineMemoId,
  )
  const touchTimingDisplayValue = timingKeyDisplayLabel(props.project, props.selectedKeyId)
  const activeTimelineMemo = activeTimelineMemoId
    ? timelineMemos(props.project).find(memo => memo.memoId === activeTimelineMemoId) ?? null
    : null
  const activeTimelineMemoAppearance = normalizeMemoAppearance(activeTimelineMemo?.appearance)
  const activeTimelineMemoTextSegment = activeTimelineMemo && activePage
    ? timelineMemoSegmentsForPage(props.template, activePage, activeTimelineMemo, {
        paperTracks: props.project.logicalSheet.paperTracks.map(track => track.paperTrack),
        layoutOverrides: props.project.sheetView.layoutOverrides,
      })[0] ?? null
    : null
  const activeTimelineMemoTextFontSizePx = activeTimelineMemo && activeTimelineMemoTextSegment
    ? activeTimelineMemoAppearance.text.fontSizeUnits * activeTimelineMemoTextSegment.rowHeightY * resolveSheetTemplatePageSize(props.template).heightPx
    : null
  const selectedCueId = props.selectedSoundCueId ?? props.selectedCameraCueId
  const selectedCue = selectedCueId ? props.project.timedRangeCues.find(cue => cue.cueId === selectedCueId) ?? null : null
  const selectedTextAnnotation = props.selectedTextAnnotationId
    ? sheetAnnotations(props.project).find(annotation => annotation.annotationId === props.selectedTextAnnotationId) ?? null
    : null
  const selectedTextRegionId = selectedTextAnnotation?.anchor?.kind === 'view-surface'
    ? selectedTextAnnotation.anchor.regionId
    : undefined
  const selectedTextTargetId = selectedTextAnnotation?.anchor?.kind === 'view-surface'
    ? selectedTextAnnotation.anchor.targetId
    : undefined
  const selectedTextLogicalTargetId = selectedTextAnnotation?.anchor?.kind === 'view-surface'
    ? selectedTextAnnotation.anchor.logicalTargetId
    : undefined
  const currentTemplateMemoTargetGeometries = useCurrentTemplateMemoTargetGeometries(
    props.template,
    props.project,
  )
  const selectedTextTargetGeometry = selectedTextRegionId || selectedTextLogicalTargetId
    ? resolveTemplateMemoTargetGeometry({
        kind: 'template-region',
        templateId: selectedTextAnnotation?.anchor?.kind === 'view-surface'
          ? selectedTextAnnotation.anchor.templateId
          : undefined,
        regionId: selectedTextRegionId,
        targetId: selectedTextTargetId,
        logicalTargetId: selectedTextLogicalTargetId,
      }, currentTemplateMemoTargetGeometries)
    : null
  const selectedTextRegion = selectedTextTargetGeometry
    ? {
        kind: 'template-region' as const,
        pageId: selectedTextAnnotation!.pageId,
        templateId: props.template.templateId,
        regionId: selectedTextTargetGeometry.regionId,
        targetId: selectedTextTargetGeometry.targetId,
        logicalTargetId: selectedTextTargetGeometry.logicalTargetId,
        rect: selectedTextTargetGeometry.rect,
        label: templateMemoTargetLabel(props.template, selectedTextTargetGeometry),
      }
    : null
  const selectedAnnotationRegionResolution = resolveSelectedTemplateRegionAnnotationTarget(
    selectedAnnotationRegion,
    activePage?.pageId,
    props.template,
    currentTemplateMemoTargetGeometries,
  )
  const activeSelectedAnnotationRegion = props.selectedTextAnnotationId
    ? selectedTextRegion
    : selectedAnnotationRegionResolution.target
  const selectedAnnotationRegionUnavailable = props.selectedTextAnnotationId
    ? isSelectedTextMemoTargetUnavailable(
        props.selectedTextAnnotationId,
        selectedTextAnnotation,
        selectedTextRegion,
      )
    : selectedAnnotationRegionResolution.unavailable
  const annotationTarget = resolveSheetAnnotationTarget({
    activeMemo: activeTimelineMemo,
    selectedCue,
    selectedHit: props.selectedHit,
    rangeSelection: props.rangeSelection,
    selectedRegion: activeSelectedAnnotationRegion,
    activePage: activePage ?? null,
    cues: props.project.timedRangeCues,
  })
  const pageAnnotationTarget: SheetPageMemoTarget = annotationTarget.kind === 'template-region'
    ? {
        kind: 'template-region',
        pageId: annotationTarget.region.pageId,
        templateId: annotationTarget.region.templateId,
        regionId: annotationTarget.region.regionId,
        targetId: annotationTarget.region.targetId,
        logicalTargetId: annotationTarget.region.logicalTargetId,
        targetRect: annotationTarget.region.rect,
      }
    : { kind: 'page', pageId: activePage?.pageId ?? 'page_1', templateId: props.template.templateId }
  const sheetCanvasEditMode: EditMode = selectedAnnotationRegionUnavailable
    && annotationTarget.kind === 'page'
    && annotationSessionActive
    ? 'new'
    : editMode
  const beginTimelineMemoEdit = useCallback((memoId: string, mode: Extract<EditMode, 'pen' | 'text'> = 'pen') => {
    setSelectedTimelineMemoId(memoId)
    setEditMode(mode)
  }, [setEditMode])
  const endTimelineMemoEdit = useCallback(() => {
    setSelectedTimelineMemoId(null)
    if (editMode === 'pen' || editMode === 'eraser' || editMode === 'text') setEditMode('new')
  }, [editMode, setEditMode])
  const blurAnnotationPaletteFocus = useCallback(() => {
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement && annotationPaletteRef.current?.contains(activeElement)) {
      activeElement.blur()
    }
  }, [])
  const closeAnnotationPalette = useCallback(() => {
    setAnnotationPaletteOpen(false)
    blurAnnotationPaletteFocus()
  }, [blurAnnotationPaletteFocus])
  const handleSheetInputModalityChange = useCallback((modality: 'mouse' | 'pen' | 'touch') => {
    if (modality === 'touch') {
      setTouchControlsVisible(true)
      return
    }
    setTouchControlsVisible(false)
    setTouchRangeSelectionMode(false)
  }, [])
  const toggleTouchRangeSelectionMode = useCallback(() => {
    onTimingInputCommit(false)
    setEditMode('new')
    setTouchRangeSelectionMode(current => !current)
  }, [onTimingInputCommit, setEditMode])
  const openTouchContextMenu = useCallback((anchor: HTMLElement) => {
    onTimingInputCommit(false)
    const rect = anchor.getBoundingClientRect()
    sheetCanvasRef.current?.openSelectionContextMenu(rect.left, rect.top)
  }, [onTimingInputCommit])
  const closeTouchControls = useCallback(() => {
    onTimingInputCommit(false)
    setTouchRangeSelectionMode(false)
    setTouchControlsVisible(false)
  }, [onTimingInputCommit])
  const finishAnnotationSession = useCallback(() => {
    closeAnnotationPalette()
    if (activeTimelineMemoId) {
      setSelectedTimelineMemoId(null)
    }
    setEditMode('new')
  }, [activeTimelineMemoId, closeAnnotationPalette, setEditMode])
  const zoomPaletteRef = useRef<HTMLDivElement>(null)
  const didFitInitialSheetZoom = useRef(false)
  const sheetZoomRef = useRef(props.zoom)
  const updateSheetZoom = props.setZoom
  const projectCuts = props.projectCuts
  const onAddSharedCut = props.onAddSharedCut
  const activeCutIndex = projectCuts.findIndex(cut => cut.cutId === props.activeCutId)
  const activeCut = activeCutIndex >= 0 ? projectCuts[activeCutIndex] : projectCuts[0]
  const activeCutLabel = activeCut?.metadata.cut?.trim() || `カット${Math.max(1, activeCutIndex + 1)}`
  const addingSharedCut = sharedCutDraft !== null
  const cancelSharedCutAddition = useCallback(() => {
    setSharedCutDraft(null)
    setSharedCutDraftError(null)
  }, [])
  const handleSharedCutMenuOpenChange = useCallback((open: boolean) => {
    if (!open) cancelSharedCutAddition()
  }, [cancelSharedCutAddition])
  const beginSharedCutAddition = useCallback(() => {
    setSharedCutDraft(nextSharedCutLabel(projectCuts))
    setSharedCutDraftError(null)
  }, [projectCuts])
  const submitSharedCutAddition = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const label = sharedCutDraft?.trim() ?? ''
    if (!label) {
      setSharedCutDraftError(uiText.sheet.sharedCutNameRequired)
      return
    }
    if (projectCuts.some(cut => cut.metadata.cut?.trim() === label)) {
      setSharedCutDraftError(uiText.sheet.sharedCutNameDuplicate(label))
      return
    }
    onAddSharedCut(label)
    cancelSharedCutAddition()
  }, [cancelSharedCutAddition, onAddSharedCut, projectCuts, sharedCutDraft])
  useLayoutEffect(() => {
    if (!addingSharedCut) return
    sharedCutInputRef.current?.focus()
    sharedCutInputRef.current?.select()
  }, [addingSharedCut])
  const templatePaperTrackNames = useMemo(
    () => templatePaperTracks(props.project, props.template).map(track => track.paperTrack),
    [props.project, props.template],
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
      timelineLanes: timelineLanesForLayout(props.project),
      layoutOverrides: props.project.sheetView.layoutOverrides,
    }),
    [props.template, displayDurationFrames, props.project, templatePaperTrackNames],
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
        || target?.closest('.sheetContextMenu, .annotationFloatingPalette, .actionMenuPortalContent')) return
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
    if (!activeTimelineMemoId || editMode === 'new' || editMode === 'pen' || editMode === 'eraser' || editMode === 'text') return
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

  useEffect(() => {
    if (!annotationPaletteOpen || annotationSessionActive) return undefined
    const closeFromOutside = (event: globalThis.PointerEvent) => {
      const target = event.target
      if (target instanceof Node && annotationPaletteRef.current?.contains(target)) return
      if (target instanceof Element && target.closest('.actionMenuPortalContent')) return
      closeAnnotationPalette()
    }
    window.addEventListener('pointerdown', closeFromOutside)
    return () => window.removeEventListener('pointerdown', closeFromOutside)
  }, [annotationPaletteOpen, annotationSessionActive, closeAnnotationPalette])

  useEffect(() => {
    if (!annotationSessionActive) return undefined
    const finishOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finishAnnotationSession()
    }
    window.addEventListener('keydown', finishOnEscape)
    return () => window.removeEventListener('keydown', finishOnEscape)
  }, [annotationSessionActive, finishAnnotationSession])

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
    <TooltipSuppressionProvider suppressed={suppressSheetTooltips(editMode)}>
    <section className="panel sheetLayout">
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
          '--sheet-history-rail-width': '42px',
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
          ref={annotationPaletteRef}
          className={[
            'annotationFloatingPalette',
            activeTimelineMemoId ? 'timelineMemoTarget' : '',
            annotationSessionActive ? 'annotationSessionActive' : '',
            annotationPaletteExpanded ? 'open' : '',
          ].filter(Boolean).join(' ')}
          aria-label={activeTimelineMemoId ? uiText.sheet.timelineMemoAnnotationGroup : uiText.sheet.sheetAnnotationGroup}
          data-annotation-target={activeTimelineMemoId ? 'timeline-memo' : 'sheet'}
          data-annotation-target-kind={annotationTarget.kind}
          data-annotation-session={annotationSessionActive ? 'active' : 'idle'}
          data-annotation-tool={annotationSessionActive ? editMode : undefined}
        >
          <button
            type="button"
            className="annotationPaletteTrigger"
            aria-label="メモツールを開く"
            aria-expanded={annotationPaletteExpanded}
            onClick={() => {
              if (annotationSessionActive) return
              if (annotationPaletteOpen) closeAnnotationPalette()
              else setAnnotationPaletteOpen(true)
            }}
          >
            <PenToolIcon />
            {activeTimelineMemoId && <span className="annotationTargetBadge">{uiText.sheet.timelineMemoTargetShort}</span>}
          </button>
          <span className="toolbarGroupLabel annotationPaletteTitle">
            {annotationSessionActive
              ? uiText.sheet.annotationSessionTitle
              : activeTimelineMemoId ? uiText.sheet.timelineMemoAnnotationGroup : uiText.sheet.sheetAnnotationGroup}
          </span>
          <span className="annotationTargetLabel">
            対象: {annotationTarget.label}
          </span>
          <Tooltip label={activeTimelineMemoId ? uiText.sheet.timelineMemoPenTool : uiText.sheet.penTool}>
            <button
              type="button"
              className={props.editMode === 'pen' ? 'activeToolButton' : ''}
              aria-pressed={props.editMode === 'pen'}
              aria-label={activeTimelineMemoId ? uiText.sheet.timelineMemoPenTool : uiText.sheet.penTool}
              onClick={() => {
                if (props.editMode === 'pen') {
                  finishAnnotationSession()
                  return
                }
                if (!activeTimelineMemoId && annotationTarget.kind === 'timed-cue') {
                  const memoId = props.onCreateTimelineMemoForCue(annotationTarget.cue.cueId)
                  if (memoId) beginTimelineMemoEdit(memoId)
                  return
                }
                if (!activeTimelineMemoId && annotationTarget.kind === 'timeline-range') {
                  const memoId = props.onCreateTimelineMemo(annotationTarget.hit)
                  if (memoId) beginTimelineMemoEdit(memoId)
                  return
                }
                props.setEditMode('pen')
              }}
            >
              <PenToolIcon />
            </button>
          </Tooltip>
          <Tooltip label={props.editMode === 'text' ? uiText.sheet.textToolActiveTitle : uiText.sheet.textToolTitle}>
            <button
              type="button"
              className={props.editMode === 'text' ? 'activeToolButton' : ''}
              aria-pressed={props.editMode === 'text'}
              aria-label={uiText.sheet.textTool}
              onClick={() => {
                if (props.editMode === 'text') return
                if (!activeTimelineMemoId && annotationTarget.kind === 'timed-cue') {
                  const memoId = props.onCreateTimelineMemoForCue(annotationTarget.cue.cueId)
                  if (memoId) beginTimelineMemoEdit(memoId, 'text')
                  return
                }
                if (!activeTimelineMemoId && annotationTarget.kind === 'timeline-range') {
                  const memoId = props.onCreateTimelineMemo(annotationTarget.hit)
                  if (memoId) beginTimelineMemoEdit(memoId, 'text')
                  return
                }
                if (!activeTimelineMemoId) props.onClearSelection()
                props.setEditMode('text')
              }}
            >
              <TextToolIcon />
            </button>
          </Tooltip>
          <Tooltip label={activeTimelineMemoId ? uiText.sheet.timelineMemoEraserTool : uiText.sheet.eraserTool}>
            <button
              type="button"
              className={props.editMode === 'eraser' ? 'activeToolButton' : ''}
              aria-pressed={props.editMode === 'eraser'}
              aria-label={activeTimelineMemoId ? uiText.sheet.timelineMemoEraserTool : uiText.sheet.eraserTool}
              onClick={() => {
                if (props.editMode !== 'eraser') props.setEditMode('eraser')
              }}
            >
              <EraserToolIcon />
            </button>
          </Tooltip>
          <Tooltip label={props.editMode === 'text' && activeTimelineMemoId ? 'メモ全体の文字色' : uiText.sheet.penColor}>
            <input
              type="color"
              aria-label={props.editMode === 'text' && activeTimelineMemoId ? 'メモ全体の文字色' : uiText.sheet.penColor}
              value={props.editMode === 'text' && activeTimelineMemoId ? activeTimelineMemoAppearance.text.color : selectedTextAnnotation?.color ?? props.penColor}
              onChange={event => {
              const color = event.currentTarget.value
              if (activeTimelineMemoId && props.editMode === 'text') {
                props.onUpdateTimelineMemoAppearance(activeTimelineMemoId, {
                  ...activeTimelineMemoAppearance,
                  text: { ...activeTimelineMemoAppearance.text, color },
                })
              } else if (selectedTextAnnotation?.kind === 'text') {
                props.onUpdateTextAnnotation(selectedTextAnnotation.annotationId, { color })
              } else props.setPenColor(color)
              }}
            />
          </Tooltip>
          <FontSizeControl
            value={activeTimelineMemoTextFontSizePx ?? props.textFontSizePx}
            active={Boolean(props.selectedTextAnnotationId || activeTimelineMemo)}
            onChange={value => {
              if (activeTimelineMemoId && activeTimelineMemoTextSegment) {
                const pageHeight = resolveSheetTemplatePageSize(props.template).heightPx
                props.onUpdateTimelineMemoAppearance(activeTimelineMemoId, {
                  ...activeTimelineMemoAppearance,
                  text: {
                    ...activeTimelineMemoAppearance.text,
                    fontSizeUnits: value / Math.max(1, activeTimelineMemoTextSegment.rowHeightY * pageHeight),
                  },
                })
                return
              }
              props.onMemoTextFontSizeChange(value)
            }}
            label={uiText.sheet.memoTextFontSize}
            tooltip={uiText.sheet.memoTextFontSizeTitle}
            compact
          />
          {(props.editMode === 'pen' || props.editMode === 'eraser') && (
            <label className="annotationActiveWidthControl">
              <span>{props.editMode === 'pen' ? uiText.sheet.penWidth : uiText.sheet.eraserWidth}</span>
              <input
                type="range"
                aria-label={props.editMode === 'pen' ? uiText.sheet.penWidth : uiText.sheet.eraserWidth}
                min={props.editMode === 'pen' ? 1 : 4}
                max={props.editMode === 'pen' ? 12 : 32}
                value={Math.round((props.editMode === 'pen' ? props.penWidth : props.eraserWidth) * 1000)}
                onChange={event => {
                  const width = Number(event.currentTarget.value) / 1000
                  if (props.editMode === 'pen') props.setPenWidth(width)
                  else props.setEraserWidth(width)
                }}
              />
              <output>{Math.round((props.editMode === 'pen' ? props.penWidth : props.eraserWidth) * 1000)}</output>
            </label>
          )}
          {!annotationSessionActive && <ActionMenu label={uiText.sheet.penWidth} tooltipLabel={uiText.sheet.penWidthTitle} className="annotationWidthMenu">
            <label className="compactControl">
              {uiText.sheet.penWidth}
              <input type="range" min="1" max="12" value={Math.round(props.penWidth * 1000)} onChange={event => props.setPenWidth(Number(event.currentTarget.value) / 1000)} />
            </label>
            <label className="compactControl">
              {uiText.sheet.eraserWidth}
              <input type="range" min="4" max="32" value={Math.round(props.eraserWidth * 1000)} onChange={event => props.setEraserWidth(Number(event.currentTarget.value) / 1000)} />
            </label>
          </ActionMenu>}
          {activeTimelineMemoId && <ActionMenu label="見た目" ariaLabel="メモの見た目" tooltipLabel="メモの不透明度と背景を調整" className="annotationAppearanceMenu">
            <label className="compactControl annotationAppearanceControl">
              <span>手描き</span>
              <input type="range" aria-label="手描きの不透明度" min="0" max="100" value={Math.round(activeTimelineMemoAppearance.inkOpacity * 100)} onChange={event => props.onUpdateTimelineMemoAppearance(activeTimelineMemoId, {
                ...activeTimelineMemoAppearance,
                inkOpacity: Number(event.currentTarget.value) / 100,
              })} />
              <output>{Math.round(activeTimelineMemoAppearance.inkOpacity * 100)}</output>
            </label>
            <label className="compactControl annotationAppearanceControl">
              <span>文字</span>
              <input type="range" aria-label="文字の不透明度" min="0" max="100" value={Math.round(activeTimelineMemoAppearance.textOpacity * 100)} onChange={event => props.onUpdateTimelineMemoAppearance(activeTimelineMemoId, {
                ...activeTimelineMemoAppearance,
                textOpacity: Number(event.currentTarget.value) / 100,
              })} />
              <output>{Math.round(activeTimelineMemoAppearance.textOpacity * 100)}</output>
            </label>
            <label className="annotationBackgroundToggle">
              <input type="checkbox" aria-label="背景色を使用" checked={activeTimelineMemoAppearance.background.enabled} onChange={event => props.onUpdateTimelineMemoAppearance(activeTimelineMemoId, {
                ...activeTimelineMemoAppearance,
                background: { ...activeTimelineMemoAppearance.background, enabled: event.currentTarget.checked },
              })} />
              背景
            </label>
            <input type="color" aria-label="背景色" value={activeTimelineMemoAppearance.background.color} disabled={!activeTimelineMemoAppearance.background.enabled} onChange={event => props.onUpdateTimelineMemoAppearance(activeTimelineMemoId, {
              ...activeTimelineMemoAppearance,
              background: { ...activeTimelineMemoAppearance.background, color: event.currentTarget.value },
            })} />
            <label className="compactControl annotationAppearanceControl">
              <span>背景濃度</span>
              <input type="range" aria-label="背景の不透明度" min="0" max="100" disabled={!activeTimelineMemoAppearance.background.enabled} value={Math.round(activeTimelineMemoAppearance.background.opacity * 100)} onChange={event => props.onUpdateTimelineMemoAppearance(activeTimelineMemoId, {
                ...activeTimelineMemoAppearance,
                background: { ...activeTimelineMemoAppearance.background, opacity: Number(event.currentTarget.value) / 100 },
              })} />
              <output>{Math.round(activeTimelineMemoAppearance.background.opacity * 100)}</output>
            </label>
          </ActionMenu>}
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
          {annotationSessionActive && (
            <button type="button" className="annotationSessionDoneButton" onClick={finishAnnotationSession}>
              {uiText.sheet.annotationSessionDone}
            </button>
          )}
        </div>
        <aside id="sheet-left-pane" className="sheetDock sheetDockLeft" aria-label="CSPレイヤー構成" hidden={!paneLayout.left}>
          <div className="dockBody">
            <CspLayerTree
              project={props.project}
              exportProfileId={props.exportProfileId}
              selectedKeyId={props.selectedKeyId}
              onSelectKey={props.onKeySelect}
              onSelectStackGuideLabel={props.onStackGuideSelect}
              onDeleteKey={props.onDeleteKey}
              activeCorrectionLayerId={props.activeCorrectionLayerId}
              onActiveCorrectionLayerChange={props.setActiveCorrectionLayerId}
              onUpdateCspCellName={props.onUpdateKeyCspCellName}
              onMoveKeyBindingProcess={props.onMoveKeyBindingProcess}
              onRenameProductionStage={props.onRenameProductionStage}
              onRenameCorrectionLayer={props.onRenameCorrectionLayer}
              onUpdateStackGuideRegistration={props.onUpdateStackGuideRegistration}
              onUpdateStackGuideLabel={props.onUpdateStackGuideLabel}
              onDeleteStackGuideLabel={props.onDeleteStackGuideLabel}
              onDeleteOverlayPaperTrack={props.onDeleteOverlayPaperTrack}
              onDeleteCorrectionLayer={props.onDeleteCorrectionLayer}
              onRenamePaperTrack={(paperTrack, name) => props.onUpdatePaperTrack(paperTrack, { paperTrack: name, label: name })}
              onReorderStackItem={props.onReorderCspStackItem}
              onReorderProductionStage={props.onReorderProductionStage}
              onReorderCorrectionLayer={props.onReorderCorrectionLayer}
              onAssignAsset={(assetId, keyId, slotId) => props.onAssignAssetToKey(assetId, keyId, { slotId })}
              onAssignAssetsToStackGuideLabel={props.onAssignAssetsToStackGuideLabel}
              onRegisterAssetsToTrack={props.onRegisterAssetsToCspTrack}
              onRegisterAssetsToNewTrack={props.onRegisterAssetsToNewCspTrack}
              onCreateUnplacedCard={props.onCreateUnplacedCspCard}
              onRegisterKeyToTrack={props.onRegisterKeyToCspTrack}
              onOpenNameNormalization={() => setNormalizationOpen(true)}
              onCreateDefaultOverlayPaperTrack={input => props.onAddOverlayPaperTrack({ ...input, cspPlacement: 'cell-top' })}
              onCreateDefaultStackGuideLabel={input => props.onCreateStackGuideLabel({ ...input, gapIndex: 0, cspPlacement: 'cell-bottom' })}
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
        <div className="sheetViewportFrame">
          <SheetHistoryRail
            topActions={(
              <ActionMenu
                label={(
                  <span className="workspaceRailIconWithBadge">
                    <SharedCutIcon />
                    <span className="cutSwitchMenuLabel"><strong>{activeCutLabel}</strong></span>
                  </span>
                )}
                ariaLabel={uiText.sheet.cutSwitchTitle}
                tooltipLabel={`${uiText.sheet.cutSwitchTitle}（現在: ${activeCutLabel}）`}
                className="workspaceRailAction cutSwitchMenu"
                placement="right-start"
                onOpenChange={handleSharedCutMenuOpenChange}
              >
                <div className="cutSwitchMenuSelectRow">
                  <label className="cutSwitchMenuSelect">
                    <span>兼用カット</span>
                    <select
                      aria-label="兼用カット"
                      value={props.activeCutId}
                      disabled={addingSharedCut}
                      onChange={event => props.onSwitchProjectCut(event.currentTarget.value)}
                    >
                      {props.projectCuts.map((cut, index) => (
                        <option key={cut.cutId} value={cut.cutId}>
                          {cut.metadata.cut?.trim() || `カット${index + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                  <TooltipTarget label={uiText.sheet.addSharedCutTitle}>
                    {tooltipProps => (
                      <button
                        type="button"
                        className="cutSwitchAddButton cutSwitchIconButton"
                        aria-label={uiText.sheet.addSharedCutTitle}
                        disabled={addingSharedCut}
                        onClick={beginSharedCutAddition}
                        {...tooltipProps}
                      >
                        <PlusIcon />
                      </button>
                    )}
                  </TooltipTarget>
                </div>
                {addingSharedCut && (
                  <form className="cutSwitchAddForm" onSubmit={submitSharedCutAddition}>
                    <span className="cutSwitchAddFormLabel">{uiText.sheet.addSharedCutName}</span>
                    <div className="cutSwitchAddFormRow">
                      <input
                        ref={sharedCutInputRef}
                        aria-label={uiText.sheet.addSharedCutName}
                        autoComplete="off"
                        spellCheck={false}
                        value={sharedCutDraft ?? ''}
                        onChange={event => {
                          setSharedCutDraft(event.currentTarget.value)
                          if (sharedCutDraftError) setSharedCutDraftError(null)
                        }}
                        onKeyDown={event => {
                          if (event.key !== 'Escape') return
                          event.preventDefault()
                          event.stopPropagation()
                          cancelSharedCutAddition()
                        }}
                      />
                      <TooltipTarget label={uiText.sheet.addSharedCutConfirm}>
                        {tooltipProps => (
                          <button
                            type="submit"
                            className="cutSwitchAddConfirmButton cutSwitchIconButton"
                            aria-label={uiText.sheet.addSharedCutConfirm}
                            {...tooltipProps}
                          >
                            <CheckSmallIcon />
                          </button>
                        )}
                      </TooltipTarget>
                      <TooltipTarget label={uiText.sheet.cancelSharedCutAddition}>
                        {tooltipProps => (
                          <button
                            type="button"
                            className="cutSwitchAddCancelButton cutSwitchIconButton"
                            aria-label={uiText.sheet.cancelSharedCutAddition}
                            onClick={cancelSharedCutAddition}
                            {...tooltipProps}
                          >
                            <CloseSmallIcon />
                          </button>
                        )}
                      </TooltipTarget>
                    </div>
                    {sharedCutDraftError && <p className="cutSwitchAddError" role="alert">{sharedCutDraftError}</p>}
                  </form>
                )}
                <TooltipTarget label={uiText.sheet.sharedCutNumbersTitle}>
                  {tooltipProps => (
                    <label className="compactControl sharedCutNumbersControl" {...tooltipProps}>
                      <input
                        type="checkbox"
                        aria-label={uiText.sheet.sharedCutNumbers}
                        checked={props.project.sheetView.metadataDisplay.sharedCutNumbers}
                        onChange={event => props.onSetSharedCutNumbersVisible(event.currentTarget.checked)}
                      />
                      シートに兼用カット名を表示
                    </label>
                  )}
                </TooltipTarget>
                <div className="cutSwitchMenuActions">
                  <TooltipTarget
                    label={props.projectCuts.length <= 1
                      ? uiText.sheet.deleteSharedCutUnavailableTitle
                      : uiText.sheet.deleteSharedCutCurrentTitle(activeCutLabel)}
                  >
                    {tooltipProps => (
                      <button
                        type="button"
                        className="cutSwitchDeleteButton cutSwitchIconButton"
                        aria-label={uiText.sheet.deleteSharedCutTitle}
                        disabled={props.projectCuts.length <= 1}
                        title={props.projectCuts.length <= 1 ? uiText.sheet.deleteSharedCutUnavailableTitle : undefined}
                        onClick={props.onDeleteSharedCut}
                        {...tooltipProps}
                      >
                        <TrashIcon />
                      </button>
                    )}
                  </TooltipTarget>
                </div>
              </ActionMenu>
            )}
            bottomActions={(
              <>
                {props.railExternalActions}
                <ActionMenu
                  label={<DisplaySettingsIcon />}
                  ariaLabel={uiText.sheet.displaySettingsMenu}
                  tooltipLabel={uiText.sheet.displaySettingsMenu}
                  className="workspaceRailAction sheetDisplaySettingsMenu sheetLayerMenu"
                  placement="right-start"
                >
                  <div className="viewModeMenuList" aria-label={uiText.sheet.viewModeMenu}>
                    {([
                      ['single-page', viewModeLabels['single-page']],
                      ['continuous', viewModeLabels.continuous],
                      ['spread', viewModeLabels.spread],
                    ] as Array<[SheetViewMode, string]>).map(([viewMode, label]) => (
                      <button
                        key={viewMode}
                        type="button"
                        className={props.project.sheetView.viewMode === viewMode ? 'active' : ''}
                        onClick={() => props.onSetViewMode(viewMode)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="sheetTemplateMenuList" aria-label={uiText.sheet.viewTemplate}>
                    <span className="actionMenuSectionLabel">表示テンプレート</span>
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
                  <div className="sheetLayerMenuList" data-action-menu-keep-open>
                    <span className="actionMenuSectionLabel">描画レイヤー</span>
                    <label className="compactControl"><input type="checkbox" checked={props.showTemplate} onChange={event => props.onShowTemplateChange(event.currentTarget.checked)} />{uiText.sheet.paperSheetImage}</label>
                    <label className="compactControl"><input type="checkbox" checked={props.showTemplateGuides} onChange={event => props.onShowTemplateGuidesChange(event.currentTarget.checked)} />{uiText.sheet.templateGuides}</label>
                    <label className="compactControl"><input type="checkbox" checked={props.showTemplateLabels} onChange={event => props.onShowTemplateLabelsChange(event.currentTarget.checked)} />{uiText.sheet.templateLabels}</label>
                    <label className="compactControl"><input type="checkbox" checked={props.showInputContent} onChange={event => props.onShowInputContentChange(event.currentTarget.checked)} />{uiText.sheet.inputContent}</label>
                    <label className="compactControl"><input type="checkbox" checked={props.project.sheetView.continuationDisplay.action} onChange={event => props.onContinuationDisplayChange('action', event.currentTarget.checked)} />{uiText.sheet.actionContinuation}</label>
                    <label className="compactControl"><input type="checkbox" checked={props.project.sheetView.continuationDisplay.cell} onChange={event => props.onContinuationDisplayChange('cell', event.currentTarget.checked)} />{uiText.sheet.cellContinuation}</label>
                    <label className="compactControl"><input type="checkbox" checked={props.showAnnotations} onChange={event => props.onShowAnnotationsChange(event.currentTarget.checked)} />{uiText.sheet.annotations}</label>
                    <TooltipTarget label={`${uiText.sheet.preRollTitle}\n${uiText.sheet.preRollFixedTitle(DEFAULT_PRE_ROLL_FRAMES)}`}>
                      {tooltipProps => (
                        <label className="compactControl dummyKControl" {...tooltipProps}>
                          <input type="checkbox" aria-label={uiText.sheet.preRoll} checked={workRange.showPreRoll} disabled={sheetViewLayout.workRange?.supportsPreRoll === false} onChange={event => setPreRollVisible(event.currentTarget.checked)} />
                          {uiText.sheet.preRollFrames}
                        </label>
                      )}
                    </TooltipTarget>
                    {workRange.postRollFrames > 0 && <span className="muted workRangeMeta">{uiText.sheet.postRollFrames(workRange.postRollFrames)}</span>}
                    {hiddenPaperTracks.length > 0 && <span className="muted" title={hiddenPaperTracks.join(', ')}>{uiText.sheet.hiddenPaperTracks(hiddenPaperTracks.length)}</span>}
                  </div>
                </ActionMenu>
                <ActionMenu
                  label={<TextSizeIcon />}
                  ariaLabel={uiText.sheet.timingTextSettings}
                  tooltipLabel="入力文字サイズ"
                  className={`workspaceRailAction timingTextRailMenu${props.hasSelectedTextTarget ? ' active' : ''}`}
                  placement="right-start"
                >
                  <div className="timingTextRailMenuBody">
                    <FontSizeControl
                      value={props.timingTextFontSizePx}
                      active={props.hasSelectedTextTarget}
                      disabled={props.textFontSizeDisabled}
                      onChange={props.onTextFontSizeChange}
                      label={uiText.sheet.timingTextFontSize}
                      tooltip={uiText.sheet.timingTextFontSizeTitle}
                    />
                  </div>
                </ActionMenu>
                {activePage && (
                  <ActionMenu
                    label={<span className="workspaceRailPageBadge">{uiText.sheet.pageTab(activePage.pageIndex + 1)}</span>}
                    ariaLabel={uiText.sheet.activePage}
                    tooltipLabel={isContinuousCanvas ? uiText.sheet.surfaceTab(activePage.frameStart, activePage.frameEnd) : uiText.sheet.pageJumpTitle(activePage.pageIndex + 1)}
                    className="workspaceRailAction pageJumpMenu"
                    placement="right-start"
                  >
                    <div className="pageJumpPanel" data-action-menu-keep-open>
                      <div className="pageJumpGrid" aria-label={uiText.sheet.pageSelection}>
                        {props.sheetPages.map(page => (
                          <Tooltip key={page.pageId} label={uiText.sheet.pageJumpTitle(page.pageIndex + 1)}>
                            <button
                              type="button"
                              className={page.pageIndex === props.activePageIndex ? 'pageJumpPageButton active' : 'pageJumpPageButton'}
                              aria-pressed={page.pageIndex === props.activePageIndex}
                              onClick={() => {
                                setSelectedAnnotationRegion(null)
                                props.setActivePageIndex(page.pageIndex)
                              }}
                            >
                              {uiText.sheet.pageTab(page.pageIndex + 1)}
                            </button>
                          </Tooltip>
                        ))}
                      </div>
                    </div>
                  </ActionMenu>
                )}
              </>
            )}
            revisions={props.sheetRevisions}
            activeRevisionId={props.activeSheetRevisionId}
            processSuggestions={props.project.correctionLayers.map(layer => layer.label).filter(Boolean)}
            onSwitch={props.onSwitchSheetRevision}
            onAdd={props.onAddSheetRevision}
            onRename={props.onRenameSheetRevision}
            onToggleProtected={props.onToggleSheetRevisionProtected}
            onToggleSourceReference={props.onToggleSheetRevisionSourceReference}
            onDelete={props.onDeleteSheetRevision}
          />
          <SheetCanvas
            ref={sheetCanvasRef}
            {...props}
            editMode={sheetCanvasEditMode}
            touchInputActive={touchControlsVisible}
            touchRangeSelectionMode={touchRangeSelectionMode}
            onInputModalityChange={handleSheetInputModalityChange}
            selectedTimelineMemoId={activeTimelineMemoId}
            pageAnnotationTarget={pageAnnotationTarget}
            setActivePageIndex={pageIndex => {
              if (pageIndex !== props.activePageIndex) setSelectedAnnotationRegion(null)
              props.setActivePageIndex(pageIndex)
            }}
            onCellClick={hit => {
              setSelectedAnnotationRegion(null)
              props.onCellClick(hit)
            }}
            onCellSelect={hit => {
              setSelectedAnnotationRegion(null)
              props.onCellSelect(hit)
            }}
            onRangeSelect={range => {
              setSelectedAnnotationRegion(null)
              if (touchRangeSelectionMode) setTouchRangeSelectionMode(false)
              props.onRangeSelect(range)
            }}
            onSoundCueSelect={cueId => {
              setSelectedAnnotationRegion(null)
              props.onSoundCueSelect(cueId)
            }}
            onCameraCueSelect={cueId => {
              setSelectedAnnotationRegion(null)
              props.onCameraCueSelect(cueId)
            }}
            onClearSelection={() => {
              setSelectedAnnotationRegion(null)
              props.onClearSelection()
            }}
            onSelectTemplateRegionAnnotationTarget={target => {
              setSelectedAnnotationRegion(templateRegionAnnotationTargetIdentity(target))
              setSelectedTimelineMemoId(null)
              props.onClearSelection()
            }}
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
            onAddTimelineLane={props.onAddTimelineLane}
            onUpdateTimelineLane={props.onUpdateTimelineLane}
            onDeleteTimelineLane={props.onDeleteTimelineLane}
            stackGuideInsertTool={stackGuideInsertTool}
            onStackGuideInsertToolConsumed={() => setStackGuideInsertTool(null)}
          />
          <SheetTouchControls
            visible={touchControlsVisible}
            timingInputVisible={touchTimingInputVisible}
            timingInputDisabled={props.timingInputDisabled}
            timingDraftValue={props.timingDraftActive ? props.timingDraftValue : ''}
            timingDisplayValue={touchTimingDisplayValue}
            rangeSelectionMode={touchRangeSelectionMode}
            contextMenuAvailable={touchContextMenuAvailable}
            onTimingCharacter={props.onTimingInputCharacter}
            onTimingBackspace={props.onTimingInputBackspace}
            onTimingCommit={() => props.onTimingInputCommit(true)}
            onTimingMove={props.onTimingInputMove}
            onToggleRangeSelectionMode={toggleTouchRangeSelectionMode}
            onOpenContextMenu={openTouchContextMenu}
            onClose={closeTouchControls}
          />
        </div>
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
          onClose={() => setNormalizationOpen(false)}
          onApply={async plan => {
            await props.onApplyNameNormalization(plan)
            setNormalizationOpen(false)
          }}
        />
      )}
    </section>
    </TooltipSuppressionProvider>
  )
}

function nextSharedCutLabel(cuts: CutGroupProjectDocument['cuts']): string {
  const usedLabels = new Set(cuts.map(cut => cut.metadata.cut?.trim()).filter(Boolean))
  let index = Math.max(1, cuts.length + 1)
  let candidate = String(index).padStart(3, '0')
  while (usedLabels.has(candidate)) {
    index += 1
    candidate = String(index).padStart(3, '0')
  }
  return candidate
}
