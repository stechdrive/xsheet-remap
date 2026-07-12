import type { CutMetadataFieldId, Id, LogicalTimelineSectionRole, PaperTrackName, SheetImageAlignment, SheetPageImageRef, SheetViewLayoutOverrides, SheetViewMode } from './types'

export const SHEET_TEMPLATE_SCHEMA_VERSION = 2

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
  cellFontSizePx?: number
  cellMinFontSizePx?: number
  cellFontWeight?: number
  shrinkToFit?: boolean
}

export interface SheetTemplateTrackProjection {
  source: 'logical-paper-tracks'
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
  trackProjection?: SheetTemplateTrackProjection
  frameProjection?: SheetTemplateFrameProjection
  columnSizing?: SheetTemplateGridColumnSizing
  rowSizing?: SheetTemplateGridRowSizing
  typography?: SheetTemplateGridTypography
  columns: SheetTemplateColumn[]
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
    | 'annotation-area'
    | 'decorative'
  label: string
  rect: NormalizedRect
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
}

export interface SheetTemplateTextStyle {
  fontSizePx?: number
  minFontSizePx?: number
  lineHeightPx?: number
  fontWeight?: number
  horizontalAlign?: 'left' | 'center' | 'right'
  verticalAlign?: 'top' | 'middle' | 'bottom'
  paddingPx?: number
  shrinkToFit?: boolean
}

export interface SheetTemplateBgBookLabelStyle {
  designDpi?: number
  baseOffsetMm?: number
  lanePitchMm?: number
  labelHeightMm?: number
  fontSizePt?: number
  minWidthMm?: number
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
  bgBookLabel?: SheetTemplateBgBookLabelStyle
  bottomTrackLabels?: SheetTemplateBottomTrackLabelsStyle
  gridHeader?: SheetTemplateGridHeaderStyle
  secondCounter?: SheetTemplateSecondCounterStyle
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

export interface SheetTemplate {
  schemaVersion: number
  templateId: string
  name: string
  templateKind?: 'japanese-a3-paper' | 'studio-paper' | 'paper-scan' | 'paper-clean' | 'digital-native'
  layoutMode?: 'fixed-page' | 'paged-digital' | 'infinite-digital'
  naming?: SheetTemplateNaming
  defaultUnderlay?: SheetTemplateUnderlay
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
  defaults: {
    fps: number
    durationFrames: number
    frameOrigin: number
    paperTracks: PaperTrackName[]
  }
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
  layoutOverrides?: SheetViewLayoutOverrides
}
