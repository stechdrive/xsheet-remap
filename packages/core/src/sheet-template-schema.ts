import type { CutMetadataFieldId, Id, LogicalTimelineLane, LogicalTimelineSectionRole, PaperTrackName, SheetImageAlignment, SheetPageImageRef, SheetViewLayoutOverrides, SheetViewMode } from './types'

export const SHEET_TEMPLATE_SCHEMA_VERSION = 6

export interface NormalizedRect {
  x: number
  y: number
  w: number
  h: number
}

export interface SheetTemplateColumn {
  columnId: string
  label: string
  paperTrack?: PaperTrackName
  timelineLaneId?: Id
  xdtsEligible?: boolean
}

export interface SheetTemplateGridColumnSize {
  widthPx?: number
  minWidthPx?: number
  maxWidthPx?: number
  weight?: number
}

export interface SheetTemplateGridColumnSizing {
  mode?: 'fit-region' | 'fixed-content'
  defaultWidthPx?: number
  minWidthPx?: number
  maxWidthPx?: number
  columns?: Record<string, SheetTemplateGridColumnSize>
}

export interface SheetTemplateGridRowSizing {
  mode?: 'fit-region' | 'fixed-height'
  rowHeightPx?: number
  minRowHeightPx?: number
  maxRowHeightPx?: number
}

export interface SheetTemplateGridTypography {
  cellFontSize?: SheetTemplateLength
  cellMinFontSize?: SheetTemplateLength
  /** @deprecated Use cellFontSize with an explicit unit. */
  cellFontSizePx?: number
  /** @deprecated Use cellMinFontSize with an explicit unit. */
  cellMinFontSizePx?: number
  cellFontWeight?: number
  shrinkToFit?: boolean
}

export type SheetTemplateLinePattern = 'solid' | 'dotted' | 'dashed'

export interface SheetTemplateLineStyle {
  weight?: SheetTemplateGridRowLineWeight
  pattern?: SheetTemplateLinePattern
  color?: string
  widthPx?: number
  dashPx?: number[]
}

export interface SheetTemplateGridLineStyleRule {
  axis: 'row' | 'column'
  target: 'all' | 'inner' | 'outer' | 'indexes'
  indexes?: number[]
  every?: number
  offset?: number
  /**
   * Limits each line to ranges on the orthogonal grid axis. The values are
   * boundary indexes: row lines use column boundaries and column lines use
   * row boundaries. Omitting spans draws across the complete grid.
   */
  spans?: SheetTemplateGridLineSpan[]
  style?: SheetTemplateLineStyle
}

export interface SheetTemplateGridLineSpan {
  startBoundary: number
  endBoundary: number
}

export interface SheetTemplateGridHeader {
  topOffsetPx?: number
  heightPx?: number
  columnHeightPx?: number
  showLabel?: boolean
  showColumnLabels?: boolean
}

export interface SheetTemplateTrackProjection {
  source: 'logical-paper-tracks' | 'logical-timeline-lanes'
  startIndex?: number
  overflow?: 'hidden' | 'scroll' | 'paginate'
}

export interface SheetTemplateFrameProjection {
  source: 'logical-frames'
  startFrame?: number
  overflow?: 'hidden' | 'scroll' | 'paginate'
}

export type SheetTemplateGridRole = 'action' | 'sound' | 'cell' | 'camera' | 'frame-guide' | 'count-table' | 'other'

export type SheetTemplateGridRowLineWeight = 'thin' | 'regular' | 'medium' | 'strong'

export interface SheetTemplateGridRowLineRule {
  every: number
  weight: SheetTemplateGridRowLineWeight
  offset?: number
}

export interface SheetTemplateGridRowLabelRule {
  every: number
  format: 'elapsed-seconds'
  offset?: number
  skipRowZero?: boolean
  xAnchor?: 'start' | 'end'
  xOffsetPx?: number
  yOffsetPx?: number
  fontSizePx?: number
}

export interface SheetTemplateGrid {
  role: SheetTemplateGridRole
  frameStart?: number
  frameEnd?: number
  rowCount: number
  majorLineEvery?: number
  pageBreakEvery?: number
  rowLineRules?: SheetTemplateGridRowLineRule[]
  rowLabelRules?: SheetTemplateGridRowLabelRule[]
  /** When present, these rules replace the legacy automatic row/column line set. */
  lineRules?: SheetTemplateGridLineStyleRule[]
  header?: SheetTemplateGridHeader
  trackProjection?: SheetTemplateTrackProjection
  frameProjection?: SheetTemplateFrameProjection
  columnSizing?: SheetTemplateGridColumnSizing
  rowSizing?: SheetTemplateGridRowSizing
  typography?: SheetTemplateGridTypography
  columns: SheetTemplateColumn[]
}

export type SheetTemplateFieldScope = 'production' | 'cut' | 'revision' | 'page'

export type SheetTemplateFieldValueType = 'text' | 'multiline' | 'number' | 'boolean' | 'choice' | 'date' | 'duration'

export interface SheetTemplateFieldDefinition {
  fieldId: string
  label: string
  scope: SheetTemplateFieldScope
  valueType: SheetTemplateFieldValueType
  choices?: string[]
  defaultValue?: string | number | boolean
  builtinBinding?: {
    target: 'cut-metadata'
    field: CutMetadataFieldId
    customKey?: string
  }
}

export type SheetTemplateMemoTargetScope = 'cell' | 'region' | 'group' | 'none'

/**
 * Declares how a form cell participates in page-annotation targeting.
 * Geometry and target identity stay separate: a small cell can be the stable
 * anchor while the memo itself uses a larger editable canvas.
 */
export interface SheetTemplateMemoTarget {
  scope: SheetTemplateMemoTargetScope
  /** Stable, template-owned group identity. Required when scope is `group`. */
  targetId?: string
  /** Optional user-facing target name. Field/region labels are used by default. */
  label?: string
}

export interface SheetTemplateFormCell {
  cellId: string
  row: number
  column: number
  rowSpan?: number
  columnSpan?: number
  kind: 'label' | 'field' | 'annotation' | 'spacer'
  label?: string
  fieldId?: string
  border?: boolean
  borderStyle?: SheetTemplateLineStyle
  textStyle?: SheetTemplateTextStyle
  editPresentation?: 'inline' | 'popover'
  /** Field cells default to an individual `cell` target when omitted. */
  memoTarget?: SheetTemplateMemoTarget
}

export interface SheetTemplateTrackCountColumn {
  columnId: string
  label: string
  fieldSuffix: string
}

export interface SheetTemplateTrackCountProjection {
  source: 'logical-paper-tracks'
  nameLabel?: string
  totalLabel?: string
  fieldPrefix: string
  scope: SheetTemplateFieldScope
  columns: SheetTemplateTrackCountColumn[]
}

export interface SheetTemplateForm {
  columns: number[]
  /**
   * Optional flex factors applied only to width added beyond the declared
   * column total. Base column widths and zero-flex gutters stay unchanged.
   */
  columnFlex?: number[]
  rows: number[]
  fillEmptyCells?: boolean
  cells?: SheetTemplateFormCell[]
  borderStyle?: SheetTemplateLineStyle
  projection?: SheetTemplateTrackCountProjection
}

export type SheetTemplateInputMode = 'point-event' | 'timed-range' | 'free-annotation' | 'reference'

export type SheetTemplateRegionBinding =
  | {
      target: 'cut-metadata'
      field: CutMetadataFieldId
      customKey?: string
    }
  | {
      target: 'cut-group'
      field: 'shared-cut-numbers'
      opening?: string
      closing?: string
      separator?: string
    }
  | {
      target: 'timeline-section'
      role: LogicalTimelineSectionRole
      sectionId?: Id
    }
  | {
      target: 'annotation-layer'
      layerId: Id
      intent?: 'memo' | 'camera-note' | 'process-note' | 'free'
    }

export interface SheetTemplateUnderlay {
  sourceId: string
  label: string
  assetPath: string
  imageRef: SheetPageImageRef
  alignment?: Partial<SheetImageAlignment>
  placement?: SheetTemplateUnderlayPlacement
}

export interface SheetTemplateUnderlayPlacement {
  mode: 'pixel-exact' | 'fit'
  sourceWidthPx: number
  sourceHeightPx: number
  offsetXPx: number
  offsetYPx: number
  renderedWidthPx: number
  renderedHeightPx: number
  ppiX?: number
  ppiY?: number
}

export interface SheetTemplateCalibration {
  targetRect?: NormalizedRect
}

export interface SheetTemplateRegion {
  regionId: string
  type:
    | 'metadata-field'
    | 'memo-area'
    | 'exposure-grid'
    | 'frame-guide'
    | 'count-table'
    | 'process-check-area'
    | 'form-table'
    | 'annotation-area'
    | 'decorative'
  label: string
  rect: NormalizedRect
  /** Keeps the base left/right page margins while the digital canvas widens. */
  horizontalSpan?: {
    source: 'resolved-page-content'
  }
  usage: 'input' | 'reference' | 'render-only' | 'ignored'
  inputKind?: 'text' | 'number' | 'timing-event' | 'camera' | 'dialogue' | 'annotation'
  inputMode?: SheetTemplateInputMode
  flowGroupId?: string
  binding?: SheetTemplateRegionBinding
  grid?: SheetTemplateGrid
  textStyle?: SheetTemplateTextStyle
  textStyleVariants?: {
    sharedCutNumbersVisible?: SheetTemplateTextStyle
  }
  form?: SheetTemplateForm
}

/**
 * A grid can be part of the printed template without being an editable
 * timeline surface. Keeping this predicate separate from exposure-grid hit
 * testing prevents decorative ruling from acquiring input behaviour merely
 * because it uses the shared grid geometry model.
 */
export function isRenderableSheetTemplateGridRegion(
  region: SheetTemplateRegion,
): region is SheetTemplateRegion & { grid: SheetTemplateGrid } {
  return Boolean(region.grid) && region.usage !== 'ignored'
}

export function isInteractiveSheetTemplateGridRegion(
  region: SheetTemplateRegion,
): region is SheetTemplateRegion & { type: 'exposure-grid'; grid: SheetTemplateGrid } {
  return region.type === 'exposure-grid' && Boolean(region.grid) && region.usage !== 'ignored'
}

export type SheetTemplateLengthUnit = 'px' | 'pt' | 'mm'

/**
 * A template-space length. `px` is a design pixel at template.page size;
 * `pt` and `mm` are physical units resolved through the template DPI.
 */
export interface SheetTemplateLength {
  value: number
  unit: SheetTemplateLengthUnit
}

export interface SheetTemplateTextStyle {
  fontSize?: SheetTemplateLength
  minFontSize?: SheetTemplateLength
  lineHeight?: SheetTemplateLength
  padding?: SheetTemplateLength
  /** @deprecated Use fontSize with an explicit unit. */
  fontSizePx?: number
  /** @deprecated Use minFontSize with an explicit unit. */
  minFontSizePx?: number
  /** @deprecated Use lineHeight with an explicit unit. */
  lineHeightPx?: number
  fontWeight?: number
  horizontalAlign?: 'left' | 'center' | 'right'
  verticalAlign?: 'top' | 'middle' | 'bottom'
  /** @deprecated Use padding with an explicit unit. */
  paddingPx?: number
  shrinkToFit?: boolean
  /** Controls whether text may paint outside the field horizontally. */
  overflowX?: 'clip' | 'visible'
  /** Controls whether text may paint outside the field vertically. */
  overflowY?: 'clip' | 'visible'
}

export interface SheetTemplateBgBookLabelStyle {
  designDpi?: number
  baseOffsetMm?: number
  /** Legacy absolute lane pitch. Used to derive the clear gap when laneGapMm is omitted. */
  lanePitchMm?: number
  /** Physical clear gap between adjacent label boxes. */
  laneGapMm?: number
  labelHeightMm?: number
  fontSizePt?: number
  minFontSizePt?: number
  fontFamily?: string
  fontWeight?: number
  shrinkToFit?: boolean
  minWidthMm?: number
  /** Optional physical cap. When omitted, labels may use the template page's drawable width. */
  maxWidthMm?: number
  pageMarginMm?: number
  poleGapMm?: number
  textPaddingMm?: number
  connectorStrokeMm?: number
  estimatedCharWidthMm?: number
  radiusMm?: number
}

export interface SheetTemplateGridHeaderStyle {
  labelOverrides?: Partial<Record<SheetTemplateGridRole, string>>
}

export interface SheetTemplateSecondCounterStyle {
  visible: boolean
}

export interface SheetTemplateBottomTrackLabelsStyle {
  visible: boolean
}

export interface SheetTemplateStyle {
  outerFrame?: { visible: boolean }
  bgBookLabel?: SheetTemplateBgBookLabelStyle
  bottomTrackLabels?: SheetTemplateBottomTrackLabelsStyle
  gridHeader?: SheetTemplateGridHeaderStyle
  secondCounter?: SheetTemplateSecondCounterStyle
}

export interface SheetTemplateSecondBandTheme {
  enabled: boolean
  color: string
  opacity: number
}

export interface SheetTemplateLineColorTheme {
  thin: string
  regular: string
  medium: string
  strong: string
  outer: string
}

export interface SheetTemplateTimedRangeCueTheme {
  columnColors: [string, string]
  fillOpacity: number
  hoverOpacity: number
  strokeColor: string
  textColor: string
}

export interface SheetTemplateTheme {
  presetId?: string
  paper: {
    color: string
    secondBands: SheetTemplateSecondBandTheme
  }
  ink: {
    text: string
    reference: string
    lines: SheetTemplateLineColorTheme
  }
  timedRangeCues: {
    sound: SheetTemplateTimedRangeCueTheme
    camera: SheetTemplateTimedRangeCueTheme
  }
}

export type SheetViewLayoutType = 'paged' | 'continuous' | 'infinite'

export type SheetFrameAxisLayoutType = 'paged' | 'continuous' | 'infinite'

export interface SheetFrameAxisLayout {
  type: SheetFrameAxisLayoutType
  framesPerPage?: number
  overflow?: 'paginate' | 'scroll'
}

export type SheetTrackAxisLayoutType = 'fixed-slots' | 'logical-width'

export interface SheetTrackAxisLayout {
  type: SheetTrackAxisLayoutType
  overflow?: 'hidden' | 'scroll' | 'paginate'
}

export type SheetViewSurfaceLayoutType = 'fixed-page' | 'continuous-canvas'

export interface SheetViewSurfaceLayout {
  type: SheetViewSurfaceLayoutType
}

export interface SheetViewWorkRangeDefaults {
  supportsPreRoll?: boolean
  supportsPostRoll?: boolean
  preRollFrames?: number
  postRollFrames?: number
  showPreRoll?: boolean
  showPostRoll?: boolean
}

export interface SheetViewLayout {
  type: SheetViewLayoutType
  framesPerPage?: number
  defaultViewMode?: SheetViewMode
  frameAxis?: SheetFrameAxisLayout
  trackAxis?: SheetTrackAxisLayout
  surface?: SheetViewSurfaceLayout
  workRange?: SheetViewWorkRangeDefaults
}

export type SheetTemplateCutNumberPrefixMode = 'numeric-only' | 'always'

export interface SheetTemplateNaming {
  cutNumberPrefix?: string
  cutNumberPrefixMode?: SheetTemplateCutNumberPrefixMode
}

/**
 * Declares the exact visual slots used by auxiliary paper tracks and stack
 * guides around one or more timing grids. Region order is significant: each
 * region contributes its resolved grid columns from left to right.
 */
export interface SheetTemplateAuxiliaryBand {
  bandId: string
  anchorRegionIds: string[]
  slotRegionIds: string[]
}

/** Places variable-width regions from left to right on a continuous canvas. */
export interface SheetTemplateHorizontalFlow {
  regionIds: string[]
  leftPx: number
  rightPx: number
  gapPx?: number
}

export interface SheetTemplate {
  schemaVersion: number
  templateId: string
  name: string
  theme: SheetTemplateTheme
  templateKind?: 'japanese-a3-paper' | 'studio-paper' | 'paper-scan' | 'paper-clean' | 'digital-native'
  layoutMode?: 'fixed-page' | 'paged-digital' | 'infinite-digital'
  naming?: SheetTemplateNaming
  defaultUnderlay?: SheetTemplateUnderlay
  /** A reference-only underlay is available to template authoring/correction, but is not the canonical sheet drawing. */
  defaultUnderlayUsage?: 'canvas' | 'reference-only'
  style?: SheetTemplateStyle
  calibration?: SheetTemplateCalibration
  viewLayout?: SheetViewLayout
  pageModel?: {
    type: 'paged-repeat' | 'continuous' | 'spread' | 'infinite'
    framesPerPage?: number
    defaultViewMode?: SheetViewMode
  }
  page: {
    widthPx: number
    heightPx: number
    dpi?: number
    isPhysical?: boolean
    format?: string
    orientation?: 'portrait' | 'landscape'
    coordinateSpace: 'normalized'
  }
  annotationDefaults?: {
    timelineMemo?: {
      /** Used only while creating a memo on a physical template. */
      defaultWidthMm?: number
      /** Used only while creating a memo when a native-pixel width is preferred. */
      defaultWidthPx?: number
      singleFrameHeightFrames?: number
    }
  }
  defaults: {
    fps: number
    durationFrames: number
    frameOrigin: number
    paperTracks: PaperTrackName[]
  }
  auxiliaryBands?: SheetTemplateAuxiliaryBand[]
  horizontalFlow?: SheetTemplateHorizontalFlow
  fields?: SheetTemplateFieldDefinition[]
  regions: SheetTemplateRegion[]
}

export type SheetTemplatePresetCapability = 'sheet-view' | 'image-correction'

export type SheetTemplatePresetSource = 'built-in' | 'template-pack'

export interface SheetTemplatePreset {
  presetId: string
  name: string
  sheetTemplate: SheetTemplate
  defaultUnderlay?: SheetTemplateUnderlay
  source?: SheetTemplatePresetSource
  capabilities?: SheetTemplatePresetCapability[]
}

export function sheetTemplateCutNumberPrefix(template: Pick<SheetTemplate, 'naming'> | undefined): string {
  return template?.naming?.cutNumberPrefix?.trim() ?? ''
}

export function sheetTemplateCutNumberPrefixMode(template: Pick<SheetTemplate, 'naming'> | undefined): SheetTemplateCutNumberPrefixMode {
  return template?.naming?.cutNumberPrefixMode === 'always' ? 'always' : 'numeric-only'
}

export function formatSheetTemplateCutNumber(template: Pick<SheetTemplate, 'naming'> | undefined, cutNumber: string): string {
  const value = cutNumber.trim()
  const prefix = sheetTemplateCutNumberPrefix(template)
  if (!value || !prefix) return value
  if (value.toLowerCase().startsWith(prefix.toLowerCase())) return value
  const prefixMode = sheetTemplateCutNumberPrefixMode(template)
  return prefixMode === 'always' || /^\d/.test(value) ? `${prefix}${value}` : value
}

export interface SheetHit {
  regionId: string
  role: SheetTemplateGrid['role']
  frame: number
  rowIndex: number
  columnIndex: number
  columnId: string
  label: string
  paperTrack?: PaperTrackName
  pageId?: string
  pageIndex?: number
  localFrame?: number
}

export interface SheetPage {
  pageId: string
  pageIndex: number
  frameStart: number
  frameEnd: number
}

export interface SheetTemplatePageSize {
  widthPx: number
  heightPx: number
}

export interface SheetTemplateLayoutResolveOptions {
  paperTracks?: PaperTrackName[]
  timelineLanes?: Partial<Record<'sound' | 'camera', LogicalTimelineLane[]>>
  layoutOverrides?: SheetViewLayoutOverrides
}
