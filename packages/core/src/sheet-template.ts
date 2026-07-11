import type { CutMetadataFieldId, Id, LogicalTimelineSectionRole, PaperTrackName, SheetImageAlignment, SheetPageImageRef, SheetTimingRole, SheetViewLayoutOverrides, SheetViewMode } from './types'

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
  exportDefaults?: {
    importStackStartSeparatorName?: string
    importStackEndSeparatorName?: string
  }
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

export function resolveSheetTemplatePageSize(
  template: SheetTemplate,
  durationFrames = template.defaults.durationFrames,
  options: SheetTemplateLayoutResolveOptions = {},
): SheetTemplatePageSize {
  const viewLayout = getSheetViewLayout(template)
  const baseSize = { widthPx: template.page.widthPx, heightPx: template.page.heightPx }
  if (viewLayout.surface?.type !== 'continuous-canvas') return baseSize

  let widthPx = template.page.widthPx
  let heightPx = template.page.heightPx
  for (const region of template.regions) {
    if (region.type !== 'exposure-grid' || !region.grid) continue
    const baseY = region.rect.y * template.page.heightPx
    const baseHeight = region.rect.h * template.page.heightPx
    const baseBottomMargin = Math.max(0, template.page.heightPx - (baseY + baseHeight))
    const frames = resolveSheetTemplateGridFrames(template, region.grid, durationFrames)
    const rowHeightPx = gridFixedRowHeightPx(region.grid, options.layoutOverrides?.grids?.[region.regionId])
    const projectedHeight = rowHeightPx
      ? rowHeightPx * frames.rowCount
      : baseHeight * logicalFrameScaleForGrid(region.grid, durationFrames)
    heightPx = Math.max(heightPx, Math.ceil(baseY + projectedHeight + baseBottomMargin))

    const baseX = region.rect.x * template.page.widthPx
    const baseWidth = region.rect.w * template.page.widthPx
    const baseRightMargin = Math.max(0, template.page.widthPx - (baseX + baseWidth))
    const columns = resolveSheetTemplateGridColumns(template, region.grid, options.paperTracks)
    const projectedWidth = gridFixedContentWidthPx(region.grid, columns, options.layoutOverrides?.grids?.[region.regionId]) ?? baseWidth
    widthPx = Math.max(widthPx, Math.ceil(baseX + projectedWidth + baseRightMargin))
  }

  return { ...baseSize, widthPx, heightPx }
}

export function resolveSheetTemplateRegionRect(
  template: SheetTemplate,
  region: SheetTemplateRegion,
  durationFrames = template.defaults.durationFrames,
  options: SheetTemplateLayoutResolveOptions = {},
): NormalizedRect {
  const pageSize = resolveSheetTemplatePageSize(template, durationFrames, options)
  if (pageSize.widthPx === template.page.widthPx && pageSize.heightPx === template.page.heightPx) return region.rect

  const baseX = region.rect.x * template.page.widthPx
  const baseY = region.rect.y * template.page.heightPx
  const baseWidth = region.rect.w * template.page.widthPx
  const baseHeight = region.rect.h * template.page.heightPx
  const columns = region.grid ? resolveSheetTemplateGridColumns(template, region.grid, options.paperTracks) : []
  const width = region.grid
    ? gridFixedContentWidthPx(region.grid, columns, options.layoutOverrides?.grids?.[region.regionId]) ?? baseWidth
    : baseWidth
  const rowHeightPx = region.grid ? gridFixedRowHeightPx(region.grid, options.layoutOverrides?.grids?.[region.regionId]) : undefined
  const frames = region.grid ? resolveSheetTemplateGridFrames(template, region.grid, durationFrames) : undefined
  const height = rowHeightPx && frames
    ? rowHeightPx * frames.rowCount
    : region.grid?.frameProjection?.source === 'logical-frames'
      ? baseHeight * logicalFrameScaleForGrid(region.grid, durationFrames)
      : baseHeight

  return {
    x: baseX / pageSize.widthPx,
    y: baseY / pageSize.heightPx,
    w: width / pageSize.widthPx,
    h: height / pageSize.heightPx,
  }
}

export function resolveSheetTemplateGridColumns(
  template: Pick<SheetTemplate, 'defaults' | 'viewLayout' | 'pageModel'>,
  grid: SheetTemplateGrid,
  paperTracks: PaperTrackName[] = template.defaults.paperTracks,
): SheetTemplateColumn[] {
  if (!usesPaperTracks(grid.role) || grid.trackProjection?.source !== 'logical-paper-tracks') return grid.columns
  const tracks = normalizePaperTrackNames(paperTracks.length > 0 ? paperTracks : template.defaults.paperTracks)
  const startIndex = Math.max(0, Math.floor(grid.trackProjection.startIndex ?? 0))
  const viewLayout = getSheetViewLayout(template)
  const columnCount = viewLayout.trackAxis?.type === 'logical-width'
    ? Math.max(grid.columns.length, Math.max(0, tracks.length - startIndex))
    : grid.columns.length
  return Array.from({ length: columnCount }, (_, index) => {
    const baseColumn = grid.columns[index]
    const paperTrack = tracks[startIndex + index]
    return {
      ...baseColumn,
      columnId: baseColumn?.columnId ?? `${grid.role}_${safeIdFragment(paperTrack ?? '', index)}`,
      label: paperTrack ?? '',
      paperTrack,
      xdtsEligible: paperTrack ? baseColumn?.xdtsEligible ?? grid.role === 'cell' : false,
    }
  })
}

export function resolveSheetTemplateGridFrames(
  template: Pick<SheetTemplate, 'defaults'>,
  grid: SheetTemplateGrid,
  durationFrames = template.defaults.durationFrames,
  frameOrigin = template.defaults.frameOrigin,
): { frameStart: number; frameEnd: number; rowCount: number } {
  if (grid.frameProjection?.source === 'logical-frames') {
    const frameStart = grid.frameProjection.startFrame ?? frameOrigin
    const rowCount = Math.max(1, Math.floor(durationFrames))
    return {
      frameStart,
      frameEnd: frameStart + rowCount - 1,
      rowCount,
    }
  }
  const frameStart = grid.frameStart ?? frameOrigin
  const rowCount = Math.max(1, Math.floor(grid.rowCount))
  return {
    frameStart,
    frameEnd: grid.frameEnd ?? frameStart + rowCount - 1,
    rowCount,
  }
}

export interface SheetGridLayoutColumn extends SheetTemplateColumn {
  index: number
  x: number
  w: number
  xPx: number
  widthPx: number
}

export interface SheetGridLayoutRows {
  frameStart: number
  frameEnd: number
  rowCount: number
  rowHeight: number
  rowHeightPx: number
}

export interface SheetGridLayout {
  regionId: string
  role: SheetTemplateGridRole
  rect: NormalizedRect
  pageSize: SheetTemplatePageSize
  columns: SheetGridLayoutColumn[]
  frames: SheetGridLayoutRows
}

export interface SheetGridLayoutOptions extends SheetTemplateLayoutResolveOptions {
  durationFrames?: number
  frameOrigin?: number
}

type SheetViewGridLayoutOverrideInput = NonNullable<SheetViewLayoutOverrides['grids']>[string]

export function resolveSheetTemplateGridLayout(
  template: SheetTemplate,
  region: SheetTemplateRegion,
  options: SheetGridLayoutOptions = {},
): SheetGridLayout | null {
  if (!region.grid) return null
  const durationFrames = options.durationFrames ?? template.defaults.durationFrames
  const frameOrigin = options.frameOrigin ?? template.defaults.frameOrigin
  const pageSize = resolveSheetTemplatePageSize(template, durationFrames, options)
  const rect = resolveSheetTemplateRegionRect(template, region, durationFrames, options)
  const columns = resolveSheetTemplateGridColumns(template, region.grid, options.paperTracks)
  const frames = resolveSheetTemplateGridFrames(template, region.grid, durationFrames, frameOrigin)
  const columnWidthsPx = resolveGridColumnWidthsPx(region.grid, columns, rect.w * pageSize.widthPx, options.layoutOverrides?.grids?.[region.regionId])
  const rowHeightPx = resolveGridRowHeightPx(region.grid, frames.rowCount, rect.h * pageSize.heightPx, options.layoutOverrides?.grids?.[region.regionId])
  let cursorPx = rect.x * pageSize.widthPx
  return {
    regionId: region.regionId,
    role: region.grid.role,
    rect,
    pageSize,
    columns: columns.map((column, index) => {
      const widthPx = columnWidthsPx[index] ?? 0
      const item: SheetGridLayoutColumn = {
        ...column,
        index,
        x: cursorPx / pageSize.widthPx,
        w: widthPx / pageSize.widthPx,
        xPx: cursorPx,
        widthPx,
      }
      cursorPx += widthPx
      return item
    }),
    frames: {
      ...frames,
      rowHeight: rowHeightPx / pageSize.heightPx,
      rowHeightPx,
    },
  }
}

export function sheetGridColumnAt(layout: SheetGridLayout, x: number): SheetGridLayoutColumn | null {
  return layout.columns.find(column => x >= column.x && x <= column.x + column.w) ?? null
}

export function sheetGridColumnRect(layout: SheetGridLayout, columnIndex: number): NormalizedRect | null {
  const column = layout.columns[columnIndex]
  if (!column) return null
  return {
    x: column.x,
    y: layout.rect.y,
    w: column.w,
    h: layout.rect.h,
  }
}

export function sheetGridCellRect(layout: SheetGridLayout, columnIndex: number, rowIndex: number): NormalizedRect | null {
  const column = layout.columns[columnIndex]
  if (!column || rowIndex < 0 || rowIndex >= layout.frames.rowCount) return null
  return {
    x: column.x,
    y: layout.rect.y + layout.frames.rowHeight * rowIndex,
    w: column.w,
    h: layout.frames.rowHeight,
  }
}

export function sheetGridRowY(layout: SheetGridLayout, row: number): number {
  return layout.rect.y + layout.frames.rowHeight * row
}

export function getSheetTemplateVisiblePaperTracks(
  template: SheetTemplate,
  sheetRole: SheetTimingRole = 'cell',
  paperTracks: PaperTrackName[] = template.defaults.paperTracks,
): PaperTrackName[] {
  const visible: PaperTrackName[] = []
  const seen = new Set<string>()
  for (const region of template.regions) {
    if (region.type !== 'exposure-grid' || region.grid?.role !== sheetRole) continue
    for (const column of resolveSheetTemplateGridColumns(template, region.grid, paperTracks)) {
      if (!column.paperTrack || seen.has(column.paperTrack)) continue
      visible.push(column.paperTrack)
      seen.add(column.paperTrack)
    }
  }
  return visible
}

export function getSheetTemplateHiddenPaperTracks(
  template: SheetTemplate,
  sheetRole: SheetTimingRole = 'cell',
  paperTracks: PaperTrackName[] = template.defaults.paperTracks,
): PaperTrackName[] {
  const visible = new Set(getSheetTemplateVisiblePaperTracks(template, sheetRole, paperTracks))
  return normalizePaperTrackNames(paperTracks).filter(paperTrack => !visible.has(paperTrack))
}

export function hitTestSheetTemplate(
  template: SheetTemplate,
  point: { x: number; y: number },
  options: { onlyXdtsEligible?: boolean; role?: SheetTemplateGrid['role']; paperTracks?: PaperTrackName[]; durationFrames?: number; frameOrigin?: number; layoutOverrides?: SheetViewLayoutOverrides } = {},
): SheetHit | null {
  for (const region of template.regions) {
    if (region.type !== 'exposure-grid' || !region.grid) continue
    if (options.role && region.grid.role !== options.role) continue
    const layout = resolveSheetTemplateGridLayout(template, region, options)
    if (!layout || !contains(layout.rect, point)) continue

    if (layout.columns.length === 0) return null
    const column = sheetGridColumnAt(layout, point.x)
    if (!column) return null
    const localY = (point.y - layout.rect.y) / layout.frames.rowHeight
    const rowIndex = clamp(Math.floor(localY), 0, layout.frames.rowCount - 1)
    if (options.onlyXdtsEligible && !column.xdtsEligible) return null

    return {
      regionId: region.regionId,
      role: region.grid.role,
      frame: layout.frames.frameStart + rowIndex,
      rowIndex,
      columnIndex: column.index,
      columnId: column.columnId,
      label: column.label,
      paperTrack: column.paperTrack,
    }
  }
  return null
}

export function cellRectForHit(
  template: SheetTemplate,
  hit: SheetHit,
  durationFrames = template.defaults.durationFrames,
  frameOrigin = template.defaults.frameOrigin,
  options: SheetTemplateLayoutResolveOptions = {},
): NormalizedRect | null {
  const region = template.regions.find(item => item.regionId === hit.regionId)
  if (!region?.grid) return null
  const layout = resolveSheetTemplateGridLayout(template, region, { ...options, durationFrames, frameOrigin })
  return layout ? sheetGridCellRect(layout, hit.columnIndex, hit.rowIndex) : null
}

export function getSheetViewLayout(template: Pick<SheetTemplate, 'viewLayout' | 'pageModel'>): SheetViewLayout {
  if (template.viewLayout) return normalizeSheetViewLayout(template.viewLayout)
  const pageModel = template.pageModel
  if (!pageModel) return normalizeSheetViewLayout({ type: 'paged', defaultViewMode: 'continuous' })
  if (pageModel.type === 'continuous' || pageModel.type === 'infinite') {
    return normalizeSheetViewLayout({
      type: pageModel.type,
      framesPerPage: pageModel.framesPerPage,
      defaultViewMode: pageModel.defaultViewMode,
    })
  }
  return normalizeSheetViewLayout({
    type: 'paged',
    framesPerPage: pageModel.framesPerPage,
    defaultViewMode: pageModel.defaultViewMode,
  })
}

function normalizeSheetViewLayout(layout: SheetViewLayout): SheetViewLayout {
  const frameAxis = layout.frameAxis ?? defaultFrameAxisLayout(layout)
  const trackAxis = layout.trackAxis ?? defaultTrackAxisLayout(layout)
  const surface = layout.surface ?? defaultViewSurfaceLayout(layout)
  return {
    ...layout,
    framesPerPage: layout.framesPerPage ?? frameAxis.framesPerPage,
    frameAxis,
    trackAxis,
    surface,
  }
}

function defaultFrameAxisLayout(layout: Pick<SheetViewLayout, 'type' | 'framesPerPage'>): SheetFrameAxisLayout {
  if (layout.type === 'continuous') return { type: 'continuous', overflow: 'scroll' }
  if (layout.type === 'infinite') return { type: 'infinite', overflow: 'scroll' }
  return { type: 'paged', framesPerPage: layout.framesPerPage, overflow: 'paginate' }
}

function defaultTrackAxisLayout(layout: Pick<SheetViewLayout, 'type'>): SheetTrackAxisLayout {
  return layout.type === 'infinite'
    ? { type: 'logical-width', overflow: 'scroll' }
    : { type: 'fixed-slots', overflow: 'hidden' }
}

function defaultViewSurfaceLayout(layout: Pick<SheetViewLayout, 'type'>): SheetViewSurfaceLayout {
  return layout.type === 'infinite'
    ? { type: 'continuous-canvas' }
    : { type: 'fixed-page' }
}

export function getTemplateFramesPerPage(template: SheetTemplate): number {
  const viewLayout = getSheetViewLayout(template)
  if (viewLayout.frameAxis?.framesPerPage && viewLayout.frameAxis.framesPerPage > 0) {
    return viewLayout.frameAxis.framesPerPage
  }
  const regionMax = Math.max(
    0,
    ...template.regions.flatMap(region => {
      if (region.type !== 'exposure-grid' || region.grid?.role !== 'cell') return []
      const start = region.grid.frameStart ?? template.defaults.frameOrigin
      return [region.grid.frameEnd ?? start + region.grid.rowCount - 1]
    }),
  )
  return Math.max(1, regionMax || template.defaults.durationFrames)
}

export function createSheetPages(template: SheetTemplate, durationFrames: number, frameOrigin = template.defaults.frameOrigin): SheetPage[] {
  const viewLayout = getSheetViewLayout(template)
  if (viewLayout.frameAxis?.type === 'continuous' || viewLayout.frameAxis?.type === 'infinite') {
    return [{
      pageId: 'page_1',
      pageIndex: 0,
      frameStart: frameOrigin,
      frameEnd: frameOrigin + Math.max(1, durationFrames) - 1,
    }]
  }
  const framesPerPage = getTemplateFramesPerPage(template)
  const pageCount = Math.max(1, Math.ceil(Math.max(1, durationFrames) / framesPerPage))
  return Array.from({ length: pageCount }, (_, pageIndex) => {
    const frameStart = frameOrigin + pageIndex * framesPerPage
    const absoluteEnd = frameOrigin + Math.max(1, durationFrames) - 1
    return {
      pageId: `page_${pageIndex + 1}`,
      pageIndex,
      frameStart,
      frameEnd: Math.min(frameStart + framesPerPage - 1, absoluteEnd),
    }
  })
}

export function localizeFrameToSheetPage(
  template: SheetTemplate,
  frame: number,
  durationFrames = template.defaults.durationFrames,
  frameOrigin = template.defaults.frameOrigin,
): { page: SheetPage; localFrame: number } | null {
  if (durationFrames < 1) return null
  const absoluteEnd = frameOrigin + durationFrames - 1
  if (frame < frameOrigin || frame > absoluteEnd) return null
  const viewLayout = getSheetViewLayout(template)
  if (viewLayout.frameAxis?.type === 'continuous' || viewLayout.frameAxis?.type === 'infinite') {
    const [page] = createSheetPages(template, durationFrames, frameOrigin)
    return page ? { page, localFrame: frame } : null
  }
  const framesPerPage = getTemplateFramesPerPage(template)
  const pageIndex = Math.floor((frame - frameOrigin) / framesPerPage)
  const pages = createSheetPages(template, durationFrames, frameOrigin)
  const page = pages[pageIndex]
  if (!page) return null
  return { page, localFrame: frame - page.frameStart + template.defaults.frameOrigin }
}

export function cellHitForFrame(
  template: SheetTemplate,
  paperTrack: PaperTrackName,
  frame: number,
  durationFrames = template.defaults.durationFrames,
  frameOrigin = template.defaults.frameOrigin,
  paperTracks: PaperTrackName[] = template.defaults.paperTracks,
): SheetHit | null {
  return timingHitForFrame(template, 'cell', paperTrack, frame, durationFrames, frameOrigin, paperTracks)
}

export function timingHitForFrame(
  template: SheetTemplate,
  sheetRole: SheetTimingRole,
  paperTrack: PaperTrackName,
  frame: number,
  durationFrames = template.defaults.durationFrames,
  frameOrigin = template.defaults.frameOrigin,
  paperTracks: PaperTrackName[] = template.defaults.paperTracks,
): SheetHit | null {
  const localized = localizeFrameToSheetPage(template, frame, durationFrames, frameOrigin)
  if (!localized) return null

  for (const region of template.regions) {
    if (region.type !== 'exposure-grid' || region.grid?.role !== sheetRole) continue
    const frames = resolveSheetTemplateGridFrames(template, region.grid, durationFrames, frameOrigin)
    if (localized.localFrame < frames.frameStart || localized.localFrame > frames.frameEnd) continue
    const columns = resolveSheetTemplateGridColumns(template, region.grid, paperTracks)
    const columnIndex = columns.findIndex(column => column.paperTrack === paperTrack)
    if (columnIndex < 0) continue
    const column = columns[columnIndex]
    return {
      regionId: region.regionId,
      role: sheetRole,
      frame,
      localFrame: localized.localFrame,
      rowIndex: localized.localFrame - frames.frameStart,
      columnIndex,
      columnId: column.columnId,
      label: column.label,
      paperTrack,
      pageId: localized.page.pageId,
      pageIndex: localized.page.pageIndex,
    }
  }
  return null
}

export function globalizeSheetHit(template: SheetTemplate, hit: SheetHit, page: SheetPage): SheetHit {
  const localFrame = hit.localFrame ?? hit.frame
  return {
    ...hit,
    frame: page.frameStart + (localFrame - template.defaults.frameOrigin),
    localFrame,
    pageId: page.pageId,
    pageIndex: page.pageIndex,
  }
}

export function alphabeticTrackLabel(index: number): string {
  let value = index
  let label = ''
  do {
    label = String.fromCharCode(65 + (value % 26)) + label
    value = Math.floor(value / 26) - 1
  } while (value >= 0)
  return label
}

export function createAlphabeticTrackLabels(count: number, startIndex = 0): PaperTrackName[] {
  return Array.from({ length: Math.max(0, Math.floor(count)) }, (_, index) => alphabeticTrackLabel(startIndex + index))
}

export function getSheetTemplatePaperTracks(template: Pick<SheetTemplate, 'defaults' | 'regions'>): PaperTrackName[] {
  const tracks: PaperTrackName[] = []
  const seen = new Set<string>()
  for (const region of template.regions) {
    if (region.type !== 'exposure-grid' || region.grid?.role !== 'cell') continue
    if (region.grid.trackProjection?.source === 'logical-paper-tracks') {
      for (const paperTrack of normalizePaperTrackNames(template.defaults.paperTracks)) {
        if (seen.has(paperTrack)) continue
        tracks.push(paperTrack)
        seen.add(paperTrack)
      }
      continue
    }
    for (const column of region.grid.columns) {
      if (!column.xdtsEligible || !column.paperTrack || seen.has(column.paperTrack)) continue
      tracks.push(column.paperTrack)
      seen.add(column.paperTrack)
    }
  }
  return tracks.length > 0 ? tracks : normalizePaperTrackNames(template.defaults.paperTracks)
}

export function withSheetTemplatePaperTracks(template: SheetTemplate, labels: PaperTrackName[]): SheetTemplate {
  const paperTracks = normalizePaperTrackNames(labels)
  return {
    ...template,
    defaults: {
      ...template.defaults,
      paperTracks,
    },
    regions: template.regions.map(region => {
      if (region.type !== 'exposure-grid' || !region.grid || !usesPaperTracks(region.grid.role)) return region
      if (region.grid.trackProjection?.source === 'logical-paper-tracks') return region
      return {
        ...region,
        grid: {
          ...region.grid,
          columns: createPaperTrackColumns(region.grid.role, paperTracks, region.grid.columns),
        },
      }
    }),
  }
}

export function createPaperTrackColumns(
  role: Extract<SheetTemplateGrid['role'], 'action' | 'cell'>,
  paperTracks: PaperTrackName[],
  existing: SheetTemplateColumn[] = [],
): SheetTemplateColumn[] {
  return normalizePaperTrackNames(paperTracks).map((paperTrack, index) => ({
    columnId: existing[index]?.columnId ?? `${role}_${safeIdFragment(paperTrack, index)}`,
    label: paperTrack,
    paperTrack,
    xdtsEligible: role === 'cell',
  }))
}

function resolveGridColumnWidthsPx(
  grid: SheetTemplateGrid,
  columns: SheetTemplateColumn[],
  regionWidthPx: number,
  override?: SheetViewGridLayoutOverrideInput,
): number[] {
  if (columns.length === 0) return []
  const hasSizing = Boolean(
    grid.columnSizing
    || override?.columnWidthsPx
    || columns.some(column => columnSizeForColumn(grid, column)),
  )
  if (!hasSizing) {
    const width = regionWidthPx / columns.length
    return columns.map(() => width)
  }

  const fallbackWeight = 1
  const defaultWidth = grid.columnSizing?.defaultWidthPx
  const minWidth = Math.max(1, grid.columnSizing?.minWidthPx ?? 1)
  const maxWidth = grid.columnSizing?.maxWidthPx
  const specs = columns.map(column => {
    const size = columnSizeForColumn(grid, column)
    const overrideWidth = columnWidthOverridePx(override, column)
    const widthPx = clampOptionalWidth(overrideWidth ?? size?.widthPx ?? defaultWidth, size?.minWidthPx ?? minWidth, size?.maxWidthPx ?? maxWidth)
    return {
      widthPx,
      weight: Math.max(0.01, size?.weight ?? fallbackWeight),
      minWidthPx: size?.minWidthPx ?? minWidth,
      maxWidthPx: size?.maxWidthPx ?? maxWidth,
    }
  })
  const fixedTotal = specs.reduce((total, spec) => total + (spec.widthPx ?? 0), 0)
  const flexibleSpecs = specs.filter(spec => spec.widthPx === undefined)
  const flexibleWeightTotal = flexibleSpecs.reduce((total, spec) => total + spec.weight, 0)
  const remaining = Math.max(0, regionWidthPx - fixedTotal)
  let widths = specs.map(spec => {
    if (spec.widthPx !== undefined) return spec.widthPx
    const raw = flexibleWeightTotal > 0 ? (remaining * spec.weight) / flexibleWeightTotal : remaining / Math.max(1, flexibleSpecs.length)
    return clampWidth(raw, spec.minWidthPx, spec.maxWidthPx)
  })

  if (grid.columnSizing?.mode !== 'fixed-content') {
    const total = widths.reduce((sum, width) => sum + width, 0)
    if (total > 0 && regionWidthPx > 0) {
      const scale = regionWidthPx / total
      widths = widths.map(width => width * scale)
    }
  }
  return widths
}

function resolveGridRowHeightPx(
  grid: SheetTemplateGrid,
  rowCount: number,
  regionHeightPx: number,
  override?: SheetViewGridLayoutOverrideInput,
): number {
  const fixedRowHeight = gridFixedRowHeightPx(grid, override)
  if (fixedRowHeight) return fixedRowHeight
  return regionHeightPx / Math.max(1, rowCount)
}

function gridFixedRowHeightPx(
  grid: SheetTemplateGrid,
  override?: SheetViewGridLayoutOverrideInput,
): number | undefined {
  const raw = override?.rowHeightPx ?? grid.rowSizing?.rowHeightPx
  if (raw === undefined || (grid.rowSizing?.mode ?? 'fit-region') !== 'fixed-height') return undefined
  return clampWidth(raw, grid.rowSizing?.minRowHeightPx ?? 1, grid.rowSizing?.maxRowHeightPx)
}

function gridFixedContentWidthPx(
  grid: SheetTemplateGrid,
  columns: SheetTemplateColumn[],
  override?: SheetViewGridLayoutOverrideInput,
): number | undefined {
  if ((grid.columnSizing?.mode ?? 'fit-region') !== 'fixed-content' && !override?.columnWidthsPx) return undefined
  const explicitWidths = columns.map(column => {
    const size = columnSizeForColumn(grid, column)
    return columnWidthOverridePx(override, column) ?? size?.widthPx ?? grid.columnSizing?.defaultWidthPx
  })
  if (explicitWidths.every(width => width === undefined)) return undefined
  const minWidth = Math.max(1, grid.columnSizing?.minWidthPx ?? 1)
  return explicitWidths.reduce<number>((total, width, index) => {
    const size = columnSizeForColumn(grid, columns[index]!)
    return total + clampOptionalWidth(width ?? minWidth, size?.minWidthPx ?? minWidth, size?.maxWidthPx ?? grid.columnSizing?.maxWidthPx)!
  }, 0)
}

function columnSizeForColumn(grid: SheetTemplateGrid, column: SheetTemplateColumn): SheetTemplateGridColumnSize | undefined {
  const sizes = grid.columnSizing?.columns
  if (!sizes) return undefined
  return sizes[column.columnId] ?? (column.paperTrack ? sizes[column.paperTrack] : undefined) ?? sizes[column.label]
}

function columnWidthOverridePx(
  override: SheetViewGridLayoutOverrideInput | undefined,
  column: SheetTemplateColumn,
): number | undefined {
  const widths = override?.columnWidthsPx
  if (!widths) return undefined
  return widths[column.columnId] ?? (column.paperTrack ? widths[column.paperTrack] : undefined) ?? widths[column.label]
}

function clampOptionalWidth(value: number | undefined, min: number, max?: number): number | undefined {
  return value === undefined ? undefined : clampWidth(value, min, max)
}

function clampWidth(value: number, min: number, max?: number): number {
  const safeValue = Number.isFinite(value) ? value : min
  return Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min, safeValue))
}

function contains(rect: NormalizedRect, point: { x: number; y: number }): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function usesPaperTracks(role: SheetTemplateGrid['role']): role is Extract<SheetTemplateGrid['role'], 'action' | 'cell'> {
  return role === 'action' || role === 'cell'
}

function logicalFrameScaleForGrid(grid: SheetTemplateGrid, durationFrames: number): number {
  if (grid.frameProjection?.source !== 'logical-frames') return 1
  return Math.max(1, Math.max(1, Math.floor(durationFrames)) / Math.max(1, Math.floor(grid.rowCount)))
}

function normalizePaperTrackNames(labels: PaperTrackName[]): PaperTrackName[] {
  const seen = new Set<string>()
  const normalized: PaperTrackName[] = []
  for (const label of labels) {
    const trimmed = label.trim()
    if (!trimmed || seen.has(trimmed)) continue
    normalized.push(trimmed)
    seen.add(trimmed)
  }
  return normalized
}

function safeIdFragment(value: string, index: number): string {
  return value.trim().replace(/[^A-Za-z0-9_-]+/g, '_') || `track_${index + 1}`
}

export const standardA3DefaultPaperTracks = createAlphabeticTrackLabels(9)

const cellColumns = createPaperTrackColumns('cell', standardA3DefaultPaperTracks)

const actionColumns = createPaperTrackColumns('action', standardA3DefaultPaperTracks)

const soundColumns = Array.from({ length: 4 }, (_, index) => ({
  columnId: `sound_${index + 1}`,
  label: '',
  xdtsEligible: false,
}))

const cameraColumns = Array.from({ length: 6 }, (_, index) => ({
  columnId: `camera_${index + 1}`,
  label: '',
  xdtsEligible: false,
}))

const STANDARD_A3_PAGE_WIDTH_PX = 1754
const STANDARD_A3_PAGE_HEIGHT_PX = 2481
const STANDARD_24_FPS_ROW_LINE_RULES: SheetTemplateGridRowLineRule[] = [
  { every: 24, weight: 'strong' },
  { every: 12, weight: 'medium' },
  { every: 6, weight: 'regular' },
]
const STANDARD_A3_TIMING_GRID_TYPOGRAPHY: SheetTemplateGridTypography = {
  cellFontSizePx: 18,
  cellMinFontSizePx: 6,
  cellFontWeight: 800,
  shrinkToFit: false,
}

const STANDARD_A3_METADATA_TEXT_STYLE: SheetTemplateTextStyle = {
  fontSizePx: 24,
  minFontSizePx: 12,
  fontWeight: 700,
  horizontalAlign: 'center',
  verticalAlign: 'middle',
  paddingPx: 8,
  shrinkToFit: true,
}

function standardA3Rect(x: number, y: number, w: number, h: number): NormalizedRect {
  return {
    x: x / STANDARD_A3_PAGE_WIDTH_PX,
    y: y / STANDARD_A3_PAGE_HEIGHT_PX,
    w: w / STANDARD_A3_PAGE_WIDTH_PX,
    h: h / STANDARD_A3_PAGE_HEIGHT_PX,
  }
}

function metadataFieldRegion(
  regionId: string,
  label: string,
  field: CutMetadataFieldId,
  rect: NormalizedRect,
  textStyle: SheetTemplateTextStyle = {
    fontSizePx: 22,
    minFontSizePx: 11,
    fontWeight: 700,
    horizontalAlign: 'center',
    verticalAlign: 'middle',
    paddingPx: 8,
    shrinkToFit: true,
  },
): SheetTemplateRegion {
  return {
    regionId,
    type: 'metadata-field',
    label,
    rect,
    usage: 'input',
    inputKind: 'text',
    binding: { target: 'cut-metadata', field },
    textStyle,
  }
}

function sharedCutNumbersRegion(
  regionId: string,
  rect: NormalizedRect,
  textStyle: SheetTemplateTextStyle,
): SheetTemplateRegion {
  return {
    regionId,
    type: 'metadata-field',
    label: '兼用カット',
    rect,
    usage: 'render-only',
    inputKind: 'text',
    binding: {
      target: 'cut-group',
      field: 'shared-cut-numbers',
      opening: '[',
      closing: ']',
      separator: '・',
    },
    textStyle,
  }
}

export const standardA3DefaultUnderlay: SheetTemplateUnderlay = {
  sourceId: 'sheet_source_standard_a3_default_underlay',
  label: 'A3標準タイムシート',
  assetPath: 'templates/standard-a3/timesheet.png',
  imageRef: {
    name: 'timesheet.png',
    size: 153481,
    assetPath: 'templates/standard-a3/timesheet.png',
  },
}

export const standardA3SheetTemplate: SheetTemplate = {
  schemaVersion: SHEET_TEMPLATE_SCHEMA_VERSION,
  templateId: 'standard-a3-timesheet-v2',
  name: 'A3標準',
  templateKind: 'japanese-a3-paper',
  layoutMode: 'fixed-page',
  defaultUnderlay: standardA3DefaultUnderlay,
  exportDefaults: {
    importStackStartSeparatorName: '===== XSHEET IMPORT START =====',
    importStackEndSeparatorName: '===== XSHEET IMPORT END =====',
  },
  style: {
    bottomTrackLabels: {
      visible: true,
    },
    secondCounter: {
      visible: true,
    },
    gridHeader: {
      labelOverrides: {
        sound: '',
      },
    },
    bgBookLabel: {
      baseOffsetMm: 4.74,
      lanePitchMm: 3.39,
      labelHeightMm: 2.37,
      fontSizePt: 5.04,
      minWidthMm: 3.73,
      maxWidthMm: 12.87,
      pageMarginMm: 1.02,
      poleGapMm: 0.34,
      textPaddingMm: 0.51,
      connectorStrokeMm: 0.67,
      estimatedCharWidthMm: 1.02,
      radiusMm: 0.34,
    },
  },
  calibration: {
    targetRect: standardA3Rect(35, 637, 1683, 1772),
  },
  viewLayout: {
    type: 'paged',
    framesPerPage: 144,
    defaultViewMode: 'continuous',
    workRange: {
      supportsPreRoll: true,
      supportsPostRoll: true,
      preRollFrames: 24,
      postRollFrames: 0,
      showPreRoll: false,
      showPostRoll: true,
    },
    frameAxis: {
      type: 'paged',
      framesPerPage: 144,
      overflow: 'paginate',
    },
    trackAxis: {
      type: 'fixed-slots',
      overflow: 'hidden',
    },
    surface: {
      type: 'fixed-page',
    },
  },
  page: {
    widthPx: STANDARD_A3_PAGE_WIDTH_PX,
    heightPx: STANDARD_A3_PAGE_HEIGHT_PX,
    dpi: 150,
    isPhysical: true,
    format: 'A3',
    orientation: 'portrait',
    coordinateSpace: 'normalized',
  },
  defaults: {
    fps: 24,
    durationFrames: 144,
    frameOrigin: 1,
    paperTracks: standardA3DefaultPaperTracks,
  },
  regions: [
    {
      regionId: 'top_process_check_area',
      type: 'process-check-area',
      label: '工程チェック欄',
      rect: standardA3Rect(35, 47, 1598, 71),
      usage: 'reference',
      inputKind: 'annotation',
    },
    metadataFieldRegion('top_title_field', 'タイトル', 'title', standardA3Rect(35, 165, 655, 71), STANDARD_A3_METADATA_TEXT_STYLE),
    metadataFieldRegion('top_episode_field', '話数', 'episode', standardA3Rect(690, 165, 174, 71), STANDARD_A3_METADATA_TEXT_STYLE),
    {
      ...metadataFieldRegion('top_cut_field', 'カット', 'cut', standardA3Rect(864, 165, 173, 71), STANDARD_A3_METADATA_TEXT_STYLE),
      textStyleVariants: {
        sharedCutNumbersVisible: {
          verticalAlign: 'top',
          paddingPx: 5,
        },
      },
    },
    sharedCutNumbersRegion('top_shared_cut_numbers_field', standardA3Rect(864, 198, 173, 38), {
      fontSizePx: 13,
      minFontSizePx: 8,
      lineHeightPx: 15,
      fontWeight: 700,
      horizontalAlign: 'center',
      verticalAlign: 'top',
      paddingPx: 2,
      shrinkToFit: true,
    }),
    metadataFieldRegion('top_duration_field', '尺', 'duration', standardA3Rect(1037, 165, 258, 71), STANDARD_A3_METADATA_TEXT_STYLE),
    metadataFieldRegion('top_worker_field', '作業者', 'worker', standardA3Rect(1295, 165, 259, 71), STANDARD_A3_METADATA_TEXT_STYLE),
    metadataFieldRegion('top_page_field', 'ページ', 'page', standardA3Rect(1554, 165, 164, 71), STANDARD_A3_METADATA_TEXT_STYLE),
    {
      regionId: 'top_memo_area',
      type: 'memo-area',
      label: 'MEMO',
      rect: standardA3Rect(35, 259, 1113, 331),
      usage: 'input',
      inputKind: 'annotation',
      inputMode: 'free-annotation',
      binding: {
        target: 'annotation-layer',
        layerId: 'memo',
        intent: 'memo',
      },
    },
    {
      regionId: 'top_shooting_notes_area',
      type: 'annotation-area',
      label: '撮影画面処理',
      rect: standardA3Rect(1148, 259, 200, 331),
      usage: 'reference',
      inputKind: 'annotation',
      binding: {
        target: 'annotation-layer',
        layerId: 'camera-note',
        intent: 'camera-note',
      },
    },
    {
      regionId: 'top_count_table_area',
      type: 'count-table',
      label: '二原・動画・ペイント集計',
      rect: standardA3Rect(1405, 259, 313, 331),
      usage: 'reference',
      inputKind: 'number',
    },
    {
      regionId: 'left_action_grid',
      type: 'exposure-grid',
      label: 'ACTION 1-72',
      rect: standardA3Rect(64, 708, 257, 1701),
      usage: 'reference',
      inputKind: 'timing-event',
      inputMode: 'point-event',
      flowGroupId: 'main_action',
      grid: { role: 'action', frameStart: 1, frameEnd: 72, rowCount: 72, majorLineEvery: 6, pageBreakEvery: 24, rowLineRules: STANDARD_24_FPS_ROW_LINE_RULES, trackProjection: { source: 'logical-paper-tracks', startIndex: 0, overflow: 'hidden' }, typography: STANDARD_A3_TIMING_GRID_TYPOGRAPHY, columns: actionColumns },
    },
    {
      regionId: 'left_sound_grid',
      type: 'exposure-grid',
      label: 'SOUND 1-72',
      rect: standardA3Rect(321, 708, 114, 1701),
      usage: 'input',
      inputKind: 'dialogue',
      inputMode: 'timed-range',
      flowGroupId: 'main_sound',
      grid: { role: 'sound', frameStart: 1, frameEnd: 72, rowCount: 72, majorLineEvery: 6, pageBreakEvery: 24, rowLineRules: STANDARD_24_FPS_ROW_LINE_RULES, columns: soundColumns },
    },
    {
      regionId: 'left_cell_grid',
      type: 'exposure-grid',
      label: 'CELL 1-72',
      rect: { x: 0.248, y: 0.2854, w: 0.146, h: 0.6856 },
      usage: 'input',
      inputKind: 'timing-event',
      inputMode: 'point-event',
      flowGroupId: 'main_cell',
      grid: { role: 'cell', frameStart: 1, frameEnd: 72, rowCount: 72, majorLineEvery: 6, pageBreakEvery: 24, rowLineRules: STANDARD_24_FPS_ROW_LINE_RULES, trackProjection: { source: 'logical-paper-tracks', startIndex: 0, overflow: 'hidden' }, typography: STANDARD_A3_TIMING_GRID_TYPOGRAPHY, columns: cellColumns },
    },
    {
      regionId: 'left_camera_grid',
      type: 'exposure-grid',
      label: 'CAMERA 1-72',
      rect: { x: 0.394, y: 0.2854, w: 0.0981, h: 0.6856 },
      usage: 'input',
      inputKind: 'camera',
      inputMode: 'timed-range',
      flowGroupId: 'main_camera',
      grid: { role: 'camera', frameStart: 1, frameEnd: 72, rowCount: 72, majorLineEvery: 6, pageBreakEvery: 24, rowLineRules: STANDARD_24_FPS_ROW_LINE_RULES, columns: cameraColumns },
    },
    {
      regionId: 'right_action_grid',
      type: 'exposure-grid',
      label: 'ACTION 73-144',
      rect: standardA3Rect(920, 708, 256, 1701),
      usage: 'reference',
      inputKind: 'timing-event',
      inputMode: 'point-event',
      flowGroupId: 'main_action',
      grid: { role: 'action', frameStart: 73, frameEnd: 144, rowCount: 72, majorLineEvery: 6, pageBreakEvery: 24, rowLineRules: STANDARD_24_FPS_ROW_LINE_RULES, trackProjection: { source: 'logical-paper-tracks', startIndex: 0, overflow: 'hidden' }, typography: STANDARD_A3_TIMING_GRID_TYPOGRAPHY, columns: actionColumns },
    },
    {
      regionId: 'right_sound_grid',
      type: 'exposure-grid',
      label: 'SOUND 73-144',
      rect: standardA3Rect(1176, 708, 114, 1701),
      usage: 'input',
      inputKind: 'dialogue',
      inputMode: 'timed-range',
      flowGroupId: 'main_sound',
      grid: { role: 'sound', frameStart: 73, frameEnd: 144, rowCount: 72, majorLineEvery: 6, pageBreakEvery: 24, rowLineRules: STANDARD_24_FPS_ROW_LINE_RULES, columns: soundColumns },
    },
    {
      regionId: 'right_cell_grid',
      type: 'exposure-grid',
      label: 'CELL 73-144',
      rect: { x: 0.7355, y: 0.2854, w: 0.1465, h: 0.6856 },
      usage: 'input',
      inputKind: 'timing-event',
      inputMode: 'point-event',
      flowGroupId: 'main_cell',
      grid: { role: 'cell', frameStart: 73, frameEnd: 144, rowCount: 72, majorLineEvery: 6, pageBreakEvery: 24, rowLineRules: STANDARD_24_FPS_ROW_LINE_RULES, trackProjection: { source: 'logical-paper-tracks', startIndex: 0, overflow: 'hidden' }, typography: STANDARD_A3_TIMING_GRID_TYPOGRAPHY, columns: cellColumns },
    },
    {
      regionId: 'right_camera_grid',
      type: 'exposure-grid',
      label: 'CAMERA 73-144',
      rect: { x: 0.882, y: 0.2854, w: 0.0975, h: 0.6856 },
      usage: 'input',
      inputKind: 'camera',
      inputMode: 'timed-range',
      flowGroupId: 'main_camera',
      grid: { role: 'camera', frameStart: 73, frameEnd: 144, rowCount: 72, majorLineEvery: 6, pageBreakEvery: 24, rowLineRules: STANDARD_24_FPS_ROW_LINE_RULES, columns: cameraColumns },
    },
  ],
}

export const standardA3SheetTemplatePreset: SheetTemplatePreset = {
  presetId: 'standard-a3-default',
  name: 'A3標準',
  sheetTemplate: standardA3SheetTemplate,
  defaultUnderlay: standardA3DefaultUnderlay,
  source: 'built-in',
  capabilities: ['sheet-view', 'image-correction'],
}

const DIGITAL_STANDARD_PAGE_WIDTH_PX = 1920
const DIGITAL_STANDARD_PAGE_HEIGHT_PX = 3600
const DIGITAL_STANDARD_MARGIN_X_PX = 32
const DIGITAL_STANDARD_CONTENT_WIDTH_PX = DIGITAL_STANDARD_PAGE_WIDTH_PX - DIGITAL_STANDARD_MARGIN_X_PX * 2
const DIGITAL_STANDARD_GRID_TOP_PX = 620
const DIGITAL_STANDARD_GRID_HEIGHT_PX = 2880
function digitalRect(x: number, y: number, w: number, h: number): NormalizedRect {
  return {
    x: x / DIGITAL_STANDARD_PAGE_WIDTH_PX,
    y: y / DIGITAL_STANDARD_PAGE_HEIGHT_PX,
    w: w / DIGITAL_STANDARD_PAGE_WIDTH_PX,
    h: h / DIGITAL_STANDARD_PAGE_HEIGHT_PX,
  }
}

const digitalActionColumns = createPaperTrackColumns('action', standardA3DefaultPaperTracks)
const digitalCellColumns = createPaperTrackColumns('cell', standardA3DefaultPaperTracks)
const digitalSoundColumns = Array.from({ length: 4 }, (_, index) => ({
  columnId: `digital_sound_${index + 1}`,
  label: `S${index + 1}`,
  xdtsEligible: false,
}))
const digitalCameraColumns = Array.from({ length: 4 }, (_, index) => ({
  columnId: `digital_camera_${index + 1}`,
  label: String(index + 1),
  xdtsEligible: false,
}))

const digitalLogicalFrameProjection: SheetTemplateFrameProjection = {
  source: 'logical-frames',
  overflow: 'scroll',
}

const digitalLogicalPaperTrackProjection: SheetTemplateTrackProjection = {
  source: 'logical-paper-tracks',
  startIndex: 0,
  overflow: 'scroll',
}

const DIGITAL_STANDARD_TIMING_GRID_TYPOGRAPHY: SheetTemplateGridTypography = {
  cellFontSizePx: 18,
  cellMinFontSizePx: 6,
  cellFontWeight: 800,
  shrinkToFit: false,
}

export const digitalStandardSheetTemplate: SheetTemplate = {
  schemaVersion: SHEET_TEMPLATE_SCHEMA_VERSION,
  templateId: 'digital-standard-v2',
  name: 'デジタル標準',
  templateKind: 'digital-native',
  layoutMode: 'infinite-digital',
  exportDefaults: standardA3SheetTemplate.exportDefaults,
  style: {
    secondCounter: {
      visible: true,
    },
  },
  viewLayout: {
    type: 'infinite',
    defaultViewMode: 'continuous',
    workRange: {
      supportsPreRoll: true,
      supportsPostRoll: true,
      preRollFrames: 24,
      postRollFrames: 0,
      showPreRoll: false,
      showPostRoll: true,
    },
    frameAxis: {
      type: 'infinite',
      overflow: 'scroll',
    },
    trackAxis: {
      type: 'logical-width',
      overflow: 'scroll',
    },
    surface: {
      type: 'continuous-canvas',
    },
  },
  page: {
    widthPx: DIGITAL_STANDARD_PAGE_WIDTH_PX,
    heightPx: DIGITAL_STANDARD_PAGE_HEIGHT_PX,
    isPhysical: false,
    format: 'digital',
    orientation: 'portrait',
    coordinateSpace: 'normalized',
  },
  defaults: {
    fps: 24,
    durationFrames: 144,
    frameOrigin: 1,
    paperTracks: standardA3DefaultPaperTracks,
  },
  regions: [
    metadataFieldRegion('digital_title_field', 'タイトル', 'title', digitalRect(32, 54, 600, 60)),
    metadataFieldRegion('digital_episode_field', '話数', 'episode', digitalRect(644, 54, 160, 60)),
    metadataFieldRegion('digital_scene_field', 'シーン', 'scene', digitalRect(816, 54, 160, 60)),
    {
      ...metadataFieldRegion('digital_cut_field', 'カット', 'cut', digitalRect(988, 54, 160, 60)),
      textStyleVariants: {
        sharedCutNumbersVisible: {
          verticalAlign: 'top',
          paddingPx: 4,
        },
      },
    },
    sharedCutNumbersRegion('digital_shared_cut_numbers_field', digitalRect(988, 82, 160, 32), {
      fontSizePx: 12,
      minFontSizePx: 7,
      lineHeightPx: 14,
      fontWeight: 700,
      horizontalAlign: 'center',
      verticalAlign: 'top',
      paddingPx: 2,
      shrinkToFit: true,
    }),
    metadataFieldRegion('digital_duration_field', '尺', 'duration', digitalRect(1160, 54, 190, 60)),
    metadataFieldRegion('digital_worker_field', '作業者', 'worker', digitalRect(1362, 54, 300, 60)),
    metadataFieldRegion('digital_page_field', 'ページ', 'page', digitalRect(1674, 54, 214, 60)),
    {
      regionId: 'digital_memo_area',
      type: 'memo-area',
      label: 'MEMO',
      rect: digitalRect(DIGITAL_STANDARD_MARGIN_X_PX, 160, DIGITAL_STANDARD_CONTENT_WIDTH_PX, 300),
      usage: 'input',
      inputKind: 'annotation',
      inputMode: 'free-annotation',
      binding: {
        target: 'annotation-layer',
        layerId: 'memo',
        intent: 'memo',
      },
    },
    {
      regionId: 'digital_action_grid',
      type: 'exposure-grid',
      label: 'ACTION',
      rect: digitalRect(32, DIGITAL_STANDARD_GRID_TOP_PX, 420, DIGITAL_STANDARD_GRID_HEIGHT_PX),
      usage: 'reference',
      inputKind: 'timing-event',
      inputMode: 'point-event',
      flowGroupId: 'digital_action',
      grid: { role: 'action', frameStart: 1, rowCount: 144, majorLineEvery: 6, pageBreakEvery: 24, rowLineRules: STANDARD_24_FPS_ROW_LINE_RULES, trackProjection: digitalLogicalPaperTrackProjection, frameProjection: digitalLogicalFrameProjection, typography: DIGITAL_STANDARD_TIMING_GRID_TYPOGRAPHY, columns: digitalActionColumns },
    },
    {
      regionId: 'digital_sound_grid',
      type: 'exposure-grid',
      label: 'SOUND',
      rect: digitalRect(476, DIGITAL_STANDARD_GRID_TOP_PX, 220, DIGITAL_STANDARD_GRID_HEIGHT_PX),
      usage: 'input',
      inputKind: 'dialogue',
      inputMode: 'timed-range',
      flowGroupId: 'digital_sound',
      grid: { role: 'sound', frameStart: 1, rowCount: 144, majorLineEvery: 6, pageBreakEvery: 24, frameProjection: digitalLogicalFrameProjection, columns: digitalSoundColumns },
    },
    {
      regionId: 'digital_cell_grid',
      type: 'exposure-grid',
      label: 'CELL',
      rect: digitalRect(720, DIGITAL_STANDARD_GRID_TOP_PX, 800, DIGITAL_STANDARD_GRID_HEIGHT_PX),
      usage: 'input',
      inputKind: 'timing-event',
      inputMode: 'point-event',
      flowGroupId: 'digital_cell',
      grid: { role: 'cell', frameStart: 1, rowCount: 144, majorLineEvery: 6, pageBreakEvery: 24, rowLineRules: STANDARD_24_FPS_ROW_LINE_RULES, trackProjection: digitalLogicalPaperTrackProjection, frameProjection: digitalLogicalFrameProjection, typography: DIGITAL_STANDARD_TIMING_GRID_TYPOGRAPHY, columns: digitalCellColumns },
    },
    {
      regionId: 'digital_camera_grid',
      type: 'exposure-grid',
      label: 'CAMERA',
      rect: digitalRect(1544, DIGITAL_STANDARD_GRID_TOP_PX, 344, DIGITAL_STANDARD_GRID_HEIGHT_PX),
      usage: 'input',
      inputKind: 'camera',
      inputMode: 'timed-range',
      flowGroupId: 'digital_camera',
      grid: { role: 'camera', frameStart: 1, rowCount: 144, majorLineEvery: 6, pageBreakEvery: 24, rowLineRules: STANDARD_24_FPS_ROW_LINE_RULES, frameProjection: digitalLogicalFrameProjection, columns: digitalCameraColumns },
    },
  ],
}

export const digitalStandardSheetTemplatePreset: SheetTemplatePreset = {
  presetId: 'digital-standard',
  name: 'デジタル標準',
  sheetTemplate: digitalStandardSheetTemplate,
  source: 'built-in',
  capabilities: ['sheet-view'],
}

export const sheetTemplatePresets: SheetTemplatePreset[] = [standardA3SheetTemplatePreset, digitalStandardSheetTemplatePreset]

export function sheetTemplatePresetsForCapability(
  capability: SheetTemplatePresetCapability,
  presets: readonly SheetTemplatePreset[] = sheetTemplatePresets,
): SheetTemplatePreset[] {
  return presets.filter(preset => sheetTemplatePresetSupportsCapability(preset, capability))
}

export function sheetTemplatePresetsForImageCorrection(
  presets: readonly SheetTemplatePreset[] = sheetTemplatePresets,
): SheetTemplatePreset[] {
  return sheetTemplatePresetsForCapability('image-correction', presets)
}

export function sheetTemplatePresetSupportsCapability(
  preset: SheetTemplatePreset,
  capability: SheetTemplatePresetCapability,
): boolean {
  return (preset.capabilities ?? defaultSheetTemplatePresetCapabilities(preset.sheetTemplate)).includes(capability)
}

export function defaultSheetTemplatePresetCapabilities(template: SheetTemplate): SheetTemplatePresetCapability[] {
  const capabilities: SheetTemplatePresetCapability[] = ['sheet-view']
  if (isSheetTemplateImageCorrectionCapable(template)) capabilities.push('image-correction')
  return capabilities
}

export function isSheetTemplateImageCorrectionCapable(
  template: Pick<SheetTemplate, 'defaultUnderlay' | 'calibration' | 'page' | 'regions'>,
): boolean {
  return Boolean(
    template.defaultUnderlay
      && template.page.widthPx > 0
      && template.page.heightPx > 0
      && (template.calibration?.targetRect || template.regions.some(region => region.type === 'exposure-grid' && region.grid)),
  )
}
