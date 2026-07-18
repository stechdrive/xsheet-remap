import type {
  AnnotationPoint,
  AnnotationStroke,
  AnnotationText,
  CutGroupProjectDocument,
  CutMetadataFieldId,
  CutProject,
  RecognitionCandidate,
  SheetCalibrationPointPair,
  SheetHit,
  SheetPage,
  SheetPageMemoTarget,
  SheetTemplate,
  SheetTemplateFieldDefinition,
  SheetTimingRole,
  SheetViewState,
  StackGuideLabel,
  TimelineMemoPlacement,
  TimelineMemoPoint,
  TimelineMemoStroke,
  TimelineMemoText,
  TimingSpecialMarker,
} from '@xsheet-remap/core'
import { updatePaperTrack } from '@xsheet-remap/core'
import type { CameraCueClipboard, EditMode, SheetRangeSelection, SoundCueClipboard, TemplateRegionAnnotationTarget, TimingClipboard } from './appTypes'
import type { DropDiagnosticReport } from './AssetBrowser'
import type { AutoCalibrationOverlayState, FrameOperationKind, SheetScrollRequest, StackGuideInsertContext, StackGuideLabelUpdates, StatusHintSource, TextAnnotationUpdate } from './app-foundation'
import type { CameraCueTransformUpdates } from './app-camera-cue-controller'

export type SheetCanvasProps = {
  project: CutProject
  referenceProject: CutProject | null
  referenceOpacity: number
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
  selectedSoundCueId: string | null
  selectedCameraCueId: string | null
  selectedTimelineMemoId: string | null
  selectedTimelineMemoTextId: string | null
  pageAnnotationTarget: SheetPageMemoTarget
  timingDraftValue: string
  timingDraftActive: boolean
  scrollRequest: SheetScrollRequest | null
  rangeSelection: SheetRangeSelection | null
  timingClipboard: TimingClipboard | null
  soundCueClipboard: SoundCueClipboard | null
  cameraCueClipboard: CameraCueClipboard | null
  editMode: EditMode
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
  penWidth: number
  eraserWidth: number
  textFontSizePx: number
  selectedTextAnnotationId: string | null
  editingTextAnnotationId: string | null
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
  onSetTimingSpecialAtHit: (hit: SheetHit, marker: TimingSpecialMarker) => void
  onDeleteEventAtHit: (hit: SheetHit) => void
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
  onCreateTimelineMemo: (hit: SheetHit) => void
  onSelectTimelineMemo: (memoId: string | null) => void
  onSelectTimelineMemoText: (memoId: string, textId: string) => void
  onDeleteTimelineMemo: (memoId: string) => void
  onUpdateTimelineMemoPlacement: (memoId: string, placement: TimelineMemoPlacement) => void
  onAppendTimelineMemoStroke: (memoId: string, stroke: Omit<TimelineMemoStroke, 'strokeId'>) => void
  onEraseTimelineMemoStroke: (memoId: string, points: TimelineMemoPoint[], widthUnits: number) => void
  onUpsertTimelineMemoText: (memoId: string, text: TimelineMemoText) => void
  onTemplateImage: (files: FileList | File[] | null) => void
  onAssetSheetSources: (assetIds: string[]) => void
  onAssetDrop: (files: File[], hit: SheetHit | null, position?: { x: number; y: number }) => void
  onAssetAssign: (assetId: string, hit: SheetHit | null, position?: { x: number; y: number }) => void
  onRegisteredCellAssign: (keyId: string, hit: SheetHit | null) => void
  onDropDiagnostic: (report: DropDiagnosticReport) => void
  onMoveTimelineEvent: (sourceHit: SheetHit, targetHit: SheetHit) => void
  onMoveKeyBindingProcess: (keyId: string, sourceSlotId: string, targetCorrectionLayerId: string) => void
  onEraseAnnotation: (pageId: string, points: AnnotationPoint[], width: number, target: SheetPageMemoTarget) => void
  onCreateStackGuideLabel: (input: { label: string; gapIndex: number; insertAfterPaperTrack?: string; displayRole?: SheetTimingRole; viewSnapIndex?: number; kind?: StackGuideLabel['kind']; correctionLayerId?: string }) => void
  onUpdateStackGuideLabel: (labelId: string, updates: StackGuideLabelUpdates) => void
  onAssignAssetToStackGuideLabel: (labelId: string, assetId: string, correctionLayerId?: string) => void
  onAddOverlayPaperTrack: (input: { paperTrack?: string; insertAfterPaperTrack?: string; orderInGap?: number; snapIndex?: number; sheetRole?: SheetTimingRole }) => void
  onUpdatePaperTrack: (paperTrack: string, updates: Parameters<typeof updatePaperTrack>[2]) => void
  onDeleteOverlayPaperTrack: (paperTrack: string) => void | Promise<void>
  stackGuideInsertTool: StackGuideInsertContext | null
  onStackGuideInsertToolConsumed: () => void
  onClearSelection: () => void
  onSelectTemplateRegionAnnotationTarget: (target: TemplateRegionAnnotationTarget) => void
  onAnnotation: (stroke: AnnotationStroke) => void
  onTextAnnotation: (annotation: AnnotationText) => void
  onSelectTextAnnotation: (annotationId: string) => void
  onEditTextAnnotation: (annotationId: string) => void
  onUpdateTextAnnotation: (annotationId: string, updates: TextAnnotationUpdate) => void
  onCommitTextAnnotation: (annotationId: string, text: string) => void
  onCancelTextAnnotation: (annotationId: string) => void
  onCommitFocusedTextAnnotationDraft: () => void
  onMetadataChange: (field: CutMetadataFieldId, value: string, customKey?: string) => void
  onDurationChange: (frames: number) => void
  onFormFieldChange: (definition: SheetTemplateFieldDefinition, value: string | number | boolean, pageId: string) => void
  onCalibrationPoints: (page: SheetPage, points: SheetCalibrationPointPair[], enabled?: boolean) => void
}

export type SheetDropTargetPreview = {
  hit: SheetHit
  validity: 'valid' | 'invalid'
}
