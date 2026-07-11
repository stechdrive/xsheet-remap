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
export type TimedRangeRole = 'sound' | 'camera' | 'action' | 'other'
export type TimedRangeCueKind =
  | 'dialogue'
  | 'se'
  | 'music'
  | 'ol'
  | 'fi'
  | 'fo'
  | 'pan'
  | 'tu'
  | 'tb'
  | 'book'
  | 'effect'
  | 'note'
  | 'other'
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

export interface LogicalTimelineSection {
  sectionId: Id
  role: LogicalTimelineSectionRole
  label: string
  order: number
  inputMode: LogicalTimelineSectionInputMode
  trackAxis: LogicalTimelineSectionTrackAxis
  frameAxis: LogicalTimelineSectionFrameAxis
  laneLabels?: string[]
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
  rootId: Id
  label: string
  path?: string
  handleKind: AssetRootHandleKind
}

export interface CutAsset {
  assetId: Id
  originalFileName: string
  displayName: string
  role: AssetRole
  rootId?: Id
  relativePath?: string
  currentPath?: string
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

export interface TimedRangeCue {
  cueId: Id
  role: TimedRangeRole
  kind: TimedRangeCueKind
  frameStart: FrameIndex
  frameEnd: FrameIndex
  laneId?: Id
  character?: string
  text: string
  params?: Record<string, string | number | boolean>
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

export interface SheetViewState {
  templateId: string
  viewMode: SheetViewMode
  activePageId?: Id
  sources: SheetSource[]
  pages: SheetPageViewState[]
  layoutOverrides?: SheetViewLayoutOverrides
  metadataDisplay: SheetViewMetadataDisplay
}

export interface ExportProfile {
  profileId: Id
  name: string
  mode: ExportMode
  timingSourceRole?: SheetTimingRole
  cspCellNamePolicy?: CspCellNamePolicy
  slotIds: Id[]
  includeDummySeparators: boolean
  importStackStartSeparatorName?: string
  importStackEndSeparatorName?: string
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
  studioPresetId?: string
  sheetTemplateId?: string
  sheetView: SheetViewState
  logicalSheet: LogicalSheet
  productionStages: ProductionStage[]
  correctionLayers: CorrectionLayer[]
  assetRoots: AssetRoot[]
  assets: CutAsset[]
  cspTrackSlots: CspTrackSlot[]
  bindings: CellBinding[]
  stackGuideLabels: StackGuideLabel[]
  annotations: Annotation[]
  timedRangeCues: TimedRangeCue[]
  exportProfiles: ExportProfile[]
}

export interface ProductionMetadata {
  title?: string
  episode?: string
  custom?: Record<string, string>
}

export interface CutSheetMetadata {
  scene?: string
  cut?: string
  cspTimelineName?: string
  worker?: string
  custom?: Record<string, string>
}

export type CutSheetLogicalSheet = Omit<LogicalSheet, 'keys'>

export interface CutSheetDocument {
  cutId: Id
  order: number
  metadata: CutSheetMetadata
  sheetView: SheetViewState
  logicalSheet: CutSheetLogicalSheet
  cspTrackSlots: CspTrackSlot[]
  stackGuideLabelPlacements: StackGuideLabelPlacementState[]
  annotations: Annotation[]
  timedRangeCues: TimedRangeCue[]
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
  assetRoots: AssetRoot[]
  cspImportAssetRootId?: Id
  assets: CutAsset[]
  registeredCells: SharedRegisteredCellCatalog
  exportProfiles: ExportProfile[]
  cuts: CutSheetDocument[]
}

export type ProjectFile = CutGroupProjectDocument

export interface ValidationIssue {
  issueId: Id
  severity: ValidationSeverity
  code: string
  message: string
  target?: {
    entity: 'project' | 'sheet' | 'key' | 'event' | 'cue' | 'asset' | 'binding' | 'slot' | 'export'
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
  | {
      type: 'slot.update'
      slotId: Id
      updates: Partial<Pick<CspTrackSlot, 'displayPath' | 'xdtsName' | 'trackNo' | 'occurrenceIndex' | 'stageId' | 'correctionLayerId'>>
    }

export interface ProjectHistory {
  past: CutProject[]
  present: CutProject
  future: CutProject[]
}
