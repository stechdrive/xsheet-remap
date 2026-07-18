export type Id = string
export type FrameIndex = number
export type PaperTrackName = string
export type ExportMode = 'direct-to-visible-slots' | 'import-stack' | 'sparse-cell-material'
export type MaterialState = 'assigned' | 'unassigned' | 'missing-ok'
export type ValidationSeverity = 'error' | 'warning' | 'info'
export type AnnotationTool = 'pen' | 'eraser'
export type AnnotationKind = 'stroke' | 'text'
export type SheetViewMode = 'single-page' | 'continuous' | 'spread'
export type SheetTimingRole = 'action' | 'cell'
export const NULL_CELL_KEY_ID = '__null_cell__'
export const NULL_CELL_DISPLAY_LABEL = 'x'
export const NULL_CELL_CSP_CELL_NAME = 'SYMBOL_NULL_CELL'
export const INBETWEEN_KEY_ID = '__inbetween_tick__'
export const INBETWEEN_CSP_CELL_NAME = 'SYMBOL_TICK_1'
export const REVERSE_SHEET_KEY_ID = '__reverse_sheet_tick__'
export const REVERSE_SHEET_CSP_CELL_NAME = 'SYMBOL_TICK_2'
export type TimelineEventValueKind = 'cell' | 'blank' | 'inbetween' | 'reverse'
export type TimingSpecialMarker = Exclude<TimelineEventValueKind, 'cell'>
export type TimedRangeRole = 'sound' | 'camera' | 'action' | 'other'
export type AssetRole = 'cell-material' | 'timesheet-scan' | 'reference' | 'unknown'
export type AssetRootHandleKind = 'directory' | 'manual-files' | 'unknown'
export type StackGuideLabelKind = 'background' | 'book' | 'reference' | 'camera-note' | 'memo' | 'other'
export type StackGuidePlacement = 'between-cells' | 'above-cells'
export type StackGuideStackBand = 'cell-interleave' | 'camera-note' | 'memo'
export type CutMetadataFieldId =
  | 'title'
  | 'episode'
  | 'scene'
  | 'cut'
  | 'duration'
  | 'worker'
  | 'page'
  | 'custom'

export interface NormalizedPoint {
  x: number
  y: number
}

export interface CutMetadata {
  title?: string
  episode?: string
  scene?: string
  cut?: string
  cspTimelineName?: string
  worker?: string
  custom?: Record<string, string>
}

export interface PaperTrack {
  paperTrack: PaperTrackName
  label: string
  order: number
  source?: 'template' | 'overlay'
  exportPlacement?: {
    insertAfterPaperTrack?: PaperTrackName
    orderInGap?: number
  }
  viewPlacement?: {
    templateId?: Id
    sheetRole?: SheetTimingRole
    snapIndex?: number
    expanded?: boolean
  }
}

export type LogicalTimelineSectionRole = 'action' | 'sound' | 'cell' | 'camera'
export type LogicalTimelineSectionInputMode = 'point-event' | 'timed-range' | 'free-annotation'
export type LogicalTimelineSectionTrackAxis = 'paper-tracks' | 'fixed-lanes' | 'free'
export type LogicalTimelineSectionFrameAxis = 'shared-logical-frames'

export interface LogicalTimelineLane {
  laneId: Id
  label: string
  order: number
}

export interface LogicalTimelineSection {
  sectionId: Id
  role: LogicalTimelineSectionRole
  label: string
  order: number
  inputMode: LogicalTimelineSectionInputMode
  trackAxis: LogicalTimelineSectionTrackAxis
  frameAxis: LogicalTimelineSectionFrameAxis
  lanes?: LogicalTimelineLane[]
}

export interface ProductionStage {
  stageId: Id
  label: string
  order: number
}

export interface CorrectionLayer {
  layerId: Id
  stageId: Id
  label: string
  order: number
  role: 'base' | 'correction' | 'review' | 'other'
  defaultVisible: boolean
  fileNameSuffix?: string
}

export interface TimingKey {
  keyId: Id
  paperTrack: PaperTrackName
  sheetRole?: SheetTimingRole
  displayLabel: string
  paperToken?: string
  createdFrom: 'manual' | 'asset-drop' | 'recognition' | 'import'
}

export interface TimelineEvent {
  eventId: Id
  paperTrack: PaperTrackName
  sheetRole?: SheetTimingRole
  frame: FrameIndex
  keyId: Id
  valueKind: TimelineEventValueKind
  fontSizePx?: number
  source?: 'manual' | 'recognition' | 'import'
}

export interface LogicalSheet {
  fps: number
  frameOrigin: number
  durationFrames: number
  allowNegativeFrames: boolean
  workRange: LogicalSheetWorkRange
  paperTracks: PaperTrack[]
  timelineSections: LogicalTimelineSection[]
  keys: TimingKey[]
  events: TimelineEvent[]
}

export interface LogicalSheetWorkRange {
  preRollFrames: number
  postRollFrames: number
  showPreRoll: boolean
  showPostRoll: boolean
}

export interface AssetRoot {
  label: string
  path: string
  handleKind: AssetRootHandleKind
}

export interface AssetBin {
  binId: Id
  parentBinId?: Id
  name: string
  order: number
}

export type AssetSource =
  | {
      kind: 'root-relative'
      relativePath: string
    }
  | {
      kind: 'external-file'
      absolutePath: string
    }
  | {
      kind: 'unresolved'
      lastKnownPath?: string
    }

export interface CutAsset {
  assetId: Id
  binId: Id
  originalFileName: string
  displayName: string
  role: AssetRole
  source: AssetSource
  fileSize?: number
  modifiedAt?: string
  contentHash?: string
  thumbnailUrl?: string
}

export interface CspTrackSlot {
  slotId: Id
  paperTrack: PaperTrackName
  stageId?: string
  correctionLayerId?: string
  displayPath: string
  xdtsName: string
  trackNo: number
  occurrenceIndex: number
  resolutionSource: 'csp-export' | 'csv-xdts-compare' | 'psd-bottom-order' | 'manual' | 'preset'
}

export interface CellBinding {
  bindingId: Id
  slotId: Id
  keyId: Id
  cspCellName: string
  assetId?: Id
  materialState: MaterialState
}

export interface StackGuideRegistration {
  registrationId: Id
  correctionLayerId: Id
  cspCellName?: string
  assetIds: Id[]
}

export interface StackGuideLabel {
  labelId: Id
  label: string
  kind: StackGuideLabelKind
  placement?: StackGuidePlacement
  stackBand?: StackGuideStackBand
  displayRole: SheetTimingRole
  viewSnapIndex?: number
  insertAfterPaperTrack?: PaperTrackName
  gapIndex: number
  orderInGap: number
  exportAsStaticCell: boolean
  registrations?: StackGuideRegistration[]
  /** @deprecated Use registrations[].cspCellName. */
  cspCellName?: string
  /** @deprecated Use registrations[].assetIds. */
  assetIds: Id[]
}

export interface StackGuideLabelPlacementState {
  labelId: Id
  displayRole?: SheetTimingRole
  viewSnapIndex?: number
  insertAfterPaperTrack?: PaperTrackName
  gapIndex: number
  orderInGap: number
}

export interface SharedRegisteredCellCatalog {
  keys: TimingKey[]
  bindings: CellBinding[]
  stackGuideLabels: StackGuideLabel[]
}

export interface AnnotationPoint {
  x: number
  y: number
  pressure?: number
}

export type AnnotationCoordinateSpace = 'view-surface' | 'logical-anchor'

export interface AnnotationSurfaceSize {
  widthPx: number
  heightPx: number
}

export interface AnnotationViewSurfaceAnchor {
  kind: 'view-surface'
  templateId?: string
  pageId: Id
  surfaceSize?: AnnotationSurfaceSize
  regionId?: Id
}

export interface AnnotationTimelineAnchor {
  kind: 'timeline'
  role: LogicalTimelineSectionRole
  paperTrack?: PaperTrackName
  frameStart: FrameIndex
  frameEnd?: FrameIndex
  laneId?: Id
}

export interface AnnotationMetadataAnchor {
  kind: 'metadata-field'
  field: CutMetadataFieldId
}

export interface AnnotationRegionAnchor {
  kind: 'template-region'
  templateId?: string
  regionId: Id
}

export type AnnotationAnchor =
  | AnnotationViewSurfaceAnchor
  | AnnotationTimelineAnchor
  | AnnotationMetadataAnchor
  | AnnotationRegionAnchor

export interface AnnotationStroke {
  annotationId: Id
  pageId: Id
  kind?: 'stroke'
  tool: AnnotationTool
  color: string
  width: number
  points: AnnotationPoint[]
  coordinateSpace?: AnnotationCoordinateSpace
  anchor?: AnnotationAnchor
}

export interface AnnotationText {
  annotationId: Id
  pageId: Id
  kind: 'text'
  text: string
  x: number
  y: number
  color: string
  fontSizePx: number
  coordinateSpace?: AnnotationCoordinateSpace
  anchor?: AnnotationAnchor
}

export type Annotation = AnnotationStroke | AnnotationText

export type SheetMemoTargetKind = 'page' | 'template-region'

export interface SheetPageMemoTarget {
  kind: SheetMemoTargetKind
  pageId: Id
  templateId?: string
  regionId?: Id
  surfaceSize?: AnnotationSurfaceSize
}

/**
 * Page and form-region memos share one container.  Stroke/text coordinates
 * remain normalized to the page surface so template and zoom changes do not
 * alter their placement.
 */
export interface SheetPageMemo {
  kind: 'page'
  memoId: Id
  target: SheetPageMemoTarget
  strokes: AnnotationStroke[]
  texts: AnnotationText[]
  order: number
}

export type TimelineMemoRole = 'action' | 'cell' | 'sound' | 'camera'

export interface TimelineMemoAnchor {
  role: TimelineMemoRole
  frame: FrameIndex
  paperTrack?: PaperTrackName
  laneId?: Id
}

export interface TimelineMemoPlacement {
  /** Timeline offset from the anchor to the memo canvas top edge, in frames. */
  frameOffset: number
  /** Horizontal offset from the anchor column edge, measured in frame-row-height units. */
  crossOffsetUnits: number
  /** Canvas width measured in frame-row-height units. */
  widthUnits: number
  /** Canvas height measured in logical frames. */
  heightFrames: number
}

export interface TimelineMemoPoint {
  /** Horizontal position inside the memo canvas, in frame-row-height units. */
  x: number
  /** Vertical position inside the memo canvas, in frame units. */
  y: number
  pressure?: number
}

export interface TimelineMemoStroke {
  strokeId: Id
  color: string
  /** Stroke width measured in frame-row-height units. */
  widthUnits: number
  points: TimelineMemoPoint[]
}

export interface TimelineMemoText {
  textId: Id
  text: string
  color: string
  /** Position and font size measured in frame-row-height units. */
  x: number
  y: number
  fontSizeUnits: number
}

export interface TimelineInkMemo {
  kind: 'timeline'
  memoId: Id
  anchor: TimelineMemoAnchor
  placement: TimelineMemoPlacement
  strokes: TimelineMemoStroke[]
  texts?: TimelineMemoText[]
  order: number
}

/** Canonical project memo collection. Target-specific rendering is derived. */
export type SheetMemo = SheetPageMemo | TimelineInkMemo

export type SheetMemoAnchorPresentation = 'none' | 'marker' | 'camera-connector'

export type CameraInstructionShape = 'range' | 'fade-in' | 'fade-out' | 'overlap'

/**
 * A label box is stored in logical CAMERA-region coordinates so it follows
 * zoom, template geometry, page changes, and temporal cue moves.
 */
export interface CameraLabelPlacement {
  mode: 'manual'
  /** Frame offset from the instruction start used as the box's top edge. */
  frameOffset: number
  /** Horizontal position and width relative to the complete CAMERA region. */
  xRatio: number
  widthRatio: number
  /** Box height expressed in logical sheet frames. */
  heightFrames: number
}

export type CameraInstructionPointRole = 'start' | 'intermediate' | 'end'

/** A short label anchored to an exact frame inside a CAMERA instruction. */
export interface CameraInstructionPoint {
  pointId: Id
  role: CameraInstructionPointRole
  /** Zero-based frame offset from the instruction start. */
  frameOffset: number
  label: string
}

export interface CameraInstruction {
  shape: CameraInstructionShape
  /** Empty endpoint labels are omitted. Intermediate points are user movable. */
  points?: CameraInstructionPoint[]
  /** @deprecated Normalized into points when older in-memory data is encountered. */
  startLabel?: string
  /** @deprecated Normalized into points when older in-memory data is encountered. */
  endLabel?: string
  /**
   * Frame anchoring the crossing of an overlap instruction. Even-duration
   * instructions cross on the boundary after this frame; odd-duration
   * instructions cross at this frame's center.
   */
  pivotAnchorFrame?: FrameIndex
  /** Omitted while the renderer is responsible for automatic placement. */
  labelPlacement?: CameraLabelPlacement
}

export interface TimedRangeCue {
  cueId: Id
  role: TimedRangeRole
  frameStart: FrameIndex
  frameEnd: FrameIndex
  laneId: Id
  label: string
  text: string
  camera?: CameraInstruction
  source?: 'manual' | 'recognition' | 'import'
}

export interface SheetCalibrationPointPair {
  pointId: Id
  label: string
  source: NormalizedPoint
  target: NormalizedPoint
}

export interface SheetImageCalibration {
  enabled: boolean
  points: SheetCalibrationPointPair[]
}

export interface SheetImageLevelCorrection {
  enabled: boolean
  inputBlack: number
  inputWhite: number
  gamma: number
}

export interface SheetImageAlignment {
  opacity: number
  x: number
  y: number
  scale: number
  corners: {
    tl: NormalizedPoint
    tr: NormalizedPoint
    br: NormalizedPoint
    bl: NormalizedPoint
  }
  calibration?: SheetImageCalibration
  levelCorrection?: SheetImageLevelCorrection
}

export interface SheetPageImageRef {
  name: string
  size?: number
  lastModified?: number
  path?: string
  assetPath?: string
  contentHash?: string
  pixelWidth?: number
  pixelHeight?: number
  ppiX?: number
  ppiY?: number
}

export interface SheetSource {
  sourceId: Id
  kind: 'sheet-scan' | 'template-underlay'
  imageRef: SheetPageImageRef
  assetId?: Id
  assignedPageId?: Id
}

export interface SheetPageViewState {
  pageId: Id
  sourceId?: Id
  imageRef?: SheetPageImageRef
  alignment: SheetImageAlignment
}

export interface SheetViewGridLayoutOverride {
  columnWidthsPx?: Record<string, number>
  rowHeightPx?: number
  fontScale?: number
}

export interface SheetViewLayoutOverrides {
  grids?: Record<Id, SheetViewGridLayoutOverride>
}

export interface SheetViewMetadataDisplay {
  sharedCutNumbers: boolean
}

export interface SheetViewContinuationDisplay {
  action: boolean
  cell: boolean
}

export interface SheetViewState {
  templateId: string
  viewMode: SheetViewMode
  activePageId?: Id
  sources: SheetSource[]
  pages: SheetPageViewState[]
  layoutOverrides?: SheetViewLayoutOverrides
  metadataDisplay: SheetViewMetadataDisplay
  continuationDisplay: SheetViewContinuationDisplay
}

export interface ExportProfile {
  profileId: Id
  name: string
  mode: ExportMode
  cspCellNamePolicy?: CspCellNamePolicy
  slotIds: Id[]
}

export type CspCellNamePolicyMode =
  | 'binding-or-paper-track-label'
  | 'binding-or-display-label'
  | 'binding-or-asset-name'
  | 'sequence'

export interface CspCellNamePolicy {
  mode: CspCellNamePolicyMode
  sequencePadding?: number
}

export interface NameNormalizationOptions {
  sheetRole: SheetTimingRole
  keyIds?: Id[]
  paperTracks?: PaperTrackName[]
  correctionLayerIds?: Id[]
  includeStackGuides?: boolean
  includeAssetFiles?: boolean
  sequencePadding?: number
}

export interface NameNormalizationPlanItem {
  itemId: Id
  targetType?: 'binding' | 'stack-guide'
  bindingId: Id
  keyId: Id
  slotId: Id
  stackGuideLabelId?: Id
  stackGuideRegistrationId?: Id
  paperTrack: PaperTrackName
  displayLabel: string
  processLabel?: string
  correctionLayerId?: Id
  currentCspCellName: string
  nextCspCellName: string
  cspCellNameChanged: boolean
  assetId?: Id
  assetDisplayName?: string
}

export interface NameNormalizationAssetRename {
  assetId: Id
  currentFileName: string
  nextFileName: string
  currentPath?: string
  nextPath?: string
  representativePaperTrack: PaperTrackName
  representativeReason: string
  canRename: boolean
  warnings: string[]
}

export interface NameNormalizationPlan {
  options: NameNormalizationOptions
  items: NameNormalizationPlanItem[]
  assetRenames: NameNormalizationAssetRename[]
  warnings: string[]
}

export type SheetFormFieldValue =
  | { kind: 'text'; value: string }
  | { kind: 'number'; value: number | null }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'choice'; value: string }
  | { kind: 'date'; value: string }
  | { kind: 'duration'; frames: number }

export type SheetFormFieldValues = Record<Id, SheetFormFieldValue>

export type SheetFormPageFieldValues = Record<Id, SheetFormFieldValues>

export interface SheetFormData {
  production: SheetFormFieldValues
  cut: SheetFormFieldValues
  revision: SheetFormFieldValues
  pages: SheetFormPageFieldValues
}

export interface NameNormalizationAssetRenameResult {
  assetId: Id
  renamed: boolean
  nextPath?: string
  nextFileName?: string
  error?: string
}

export interface CutProject {
  schemaVersion: number
  projectId: Id
  cut: CutMetadata
  sheetFormData: SheetFormData
  studioPresetId?: string
  sheetTemplateId?: string
  sheetView: SheetViewState
  logicalSheet: LogicalSheet
  productionStages: ProductionStage[]
  correctionLayers: CorrectionLayer[]
  assetRoot?: AssetRoot
  assetBins: AssetBin[]
  assets: CutAsset[]
  cspTrackSlots: CspTrackSlot[]
  bindings: CellBinding[]
  stackGuideLabels: StackGuideLabel[]
  memos: SheetMemo[]
  timedRangeCues: TimedRangeCue[]
  exportProfiles: ExportProfile[]
}

export interface ProductionMetadata {
  title?: string
  episode?: string
  custom?: Record<string, string>
  sheetFields?: SheetFormFieldValues
}

export interface CutSheetMetadata {
  scene?: string
  cut?: string
  cspTimelineName?: string
  worker?: string
  custom?: Record<string, string>
  sheetFields?: SheetFormFieldValues
}

export type CutSheetLogicalSheet = Omit<LogicalSheet, 'keys'>

export interface SheetRevisionReference {
  revisionId: Id
  opacity: number
}

export interface SheetRevisionDocument {
  revisionId: Id
  order: number
  name?: string
  sourceRevisionId?: Id
  protected?: boolean
  reference?: SheetRevisionReference
  metadata: Pick<CutSheetMetadata, 'worker' | 'custom'>
  sheetFields: SheetFormFieldValues
  pageFields: SheetFormPageFieldValues
  sheetView: SheetViewState
  logicalSheet: CutSheetLogicalSheet
  cspTrackSlots: CspTrackSlot[]
  stackGuideLabelPlacements: StackGuideLabelPlacementState[]
  memos: SheetMemo[]
  timedRangeCues: TimedRangeCue[]
}

export interface CutSheetDocument {
  cutId: Id
  order: number
  metadata: CutSheetMetadata
  activeRevisionId: Id
  revisions: SheetRevisionDocument[]
}

/**
 * Opaque, namespaced project data owned by an optional feature.
 *
 * Core never interprets `data`. Keeping the payload in the canonical project
 * document lets a newer optional feature survive an open/save cycle in an
 * application that does not understand it. Required extensions are rejected
 * at the archive capability boundary instead of being silently discarded.
 */
export interface ProjectExtensionPayload {
  schemaVersion: number
  required?: boolean
  data: unknown
}

export interface CutGroupProjectDocument {
  documentKind: 'xsheet-remap-cut-group-project'
  schemaVersion: number
  projectId: Id
  activeCutId: Id
  production: ProductionMetadata
  studioPresetId?: string
  sheetTemplate: import('./sheet-template').SheetTemplate
  productionStages: ProductionStage[]
  correctionLayers: CorrectionLayer[]
  assetRoot?: AssetRoot
  assetBins: AssetBin[]
  assets: CutAsset[]
  registeredCells: SharedRegisteredCellCatalog
  exportProfiles: ExportProfile[]
  cuts: CutSheetDocument[]
  extensions?: Record<string, ProjectExtensionPayload>
}

export type ProjectFile = CutGroupProjectDocument

export interface ValidationIssue {
  issueId: Id
  severity: ValidationSeverity
  code: string
  message: string
  target?: {
    entity: 'project' | 'sheet' | 'key' | 'event' | 'cue' | 'memo' | 'asset' | 'binding' | 'slot' | 'export'
    id?: string
  }
}

export interface RecognitionCandidate {
  candidateId: Id
  provider: 'manual' | 'mark-detection' | 'grid-crop-ocr' | 'vision-model' | 'hybrid'
  engineId?: string
  pageId: Id
  sheetRole: SheetTimingRole
  paperTrack: PaperTrackName
  frame: FrameIndex
  rawText: string
  normalizedLabel: string
  confidence: number
  bbox: { x: number; y: number; w: number; h: number }
}

export interface ExportTrackFrame {
  frame: number
  value: string | null
}

export interface ExportTrack {
  trackNo: number
  name: string
  slotId?: Id
  stackGuideLabelId?: Id
  stackGuideRegistrationId?: Id
  frames: ExportTrackFrame[]
  dummy?: boolean
}

export interface CspInstruction {
  level: 'info' | 'warning'
  message: string
}

export interface ExportPlan {
  mode: ExportMode
  metadata: {
    cut: string
    scene: string
    displayName: string
    timeTableName: string
  }
  timingSourceRole: SheetTimingRole
  durationFrames: number
  fps: number
  tracks: ExportTrack[]
  validation: ValidationIssue[]
  cspInstructions: CspInstruction[]
}

export interface FileRef {
  name: string
  size?: number
  lastModified?: number
  path?: string
  rootPath?: string
  relativePath?: string
  objectUrl?: string
  contentHash?: string
}

export type DomainCommand =
  | {
      type: 'event.create'
      paperTrack: PaperTrackName
      sheetRole?: SheetTimingRole
      frame: FrameIndex
      displayLabel?: string
      createdFrom?: TimingKey['createdFrom']
    }
  | {
      type: 'event.set'
      paperTrack: PaperTrackName
      sheetRole?: SheetTimingRole
      frame: FrameIndex
      keyId: Id
    }
  | {
      type: 'event.clear'
      paperTrack: PaperTrackName
      sheetRole?: SheetTimingRole
      frame: FrameIndex
    }
  | {
      type: 'key.update'
      keyId: Id
      displayLabel?: string
      paperToken?: string
    }
  | {
      type: 'asset.register'
      file: FileRef
      target?: { keyId?: Id; paperTrack?: PaperTrackName; frame?: FrameIndex; slotId?: Id }
    }
  | {
      type: 'binding.upsert'
      slotId: Id
      keyId: Id
      cspCellName?: string
      assetId?: Id
      materialState?: MaterialState
    }
  | {
      type: 'annotation.add'
      stroke: Annotation
    }
  | {
      type: 'annotation.clear'
    }

export interface ProjectHistory {
  past: CutProject[]
  present: CutProject
  future: CutProject[]
}
