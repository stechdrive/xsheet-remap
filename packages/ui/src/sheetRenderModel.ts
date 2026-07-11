import {
  cellRectForHit,
  createSheetPages,
  formatSheetTemplateCutNumber,
  getSheetViewLayout,
  localizeFrameToSheetPage,
  logicalSheetDisplayDurationFrames,
  logicalSheetDisplayFrameStart,
  logicalSheetOfficialFrameEnd,
  NULL_CELL_DISPLAY_LABEL,
  isNullCellKeyId,
  resolveSheetTemplateGridFrames,
  resolveSheetTemplateGridLayout,
  resolveSheetTemplatePageSize,
  resolveSheetTemplateRegionRect,
  sheetTimingRoleForEvent,
  stackGuideGapIndex,
  stackGuideStackBand,
  timingHitForFrame,
  type CutProject,
  type CutSheetDocument,
  type NormalizedRect,
  type PaperTrack,
  type SheetPage,
  type SheetTemplate,
  type SheetTimingRole,
  type StackGuideLabel,
} from '@xsheet-remap/core'
import { compareNaturalFileNameText } from './naturalSort'
import { STANDARD_A3_GRID_HEADER_TOP_OFFSET } from './sheetConstants'
import { resolveTimingTextFontSizePx } from './sheetTextLayout'

export type SheetRenderModelContext = {
  project: CutProject
  template: SheetTemplate
  pages: SheetPage[]
  pageSize: { widthPx: number; heightPx: number; dpi?: number }
  width: number
  height: number
  displayFrameStart: number
  displayDurationFrames: number
  officialFrameEnd: number
  paperTracks: string[]
  overlayTracks: PaperTrack[]
  cutGroup?: SheetRenderCutGroupContext
}

export type SheetRenderCutGroupContext = {
  activeCutId: string
  cuts: Array<Pick<CutSheetDocument, 'cutId' | 'order' | 'metadata'>>
}

export type SheetInputTextRenderItem = {
  eventId: string
  keyId: string
  paperTrack: string
  frame: number
  text: string
  fontSizePx: number
  rect: NormalizedRect
}

export type SheetMetadataTextRenderItem = {
  regionId: string
  field: string
  text: string
  rect: NormalizedRect
  x: number
  y: number
  textAnchor: 'start' | 'middle' | 'end'
  dominantBaseline: 'hanging' | 'central' | 'text-after-edge'
  fontSizePx: number
  fontWeight: number
}

export type FlagLabelGeometry = {
  anchorX: number
  anchorY: number
  labelX: number
  labelY: number
  labelAttachX: number
  labelTextX: number
  labelBottomY: number
  labelWidth: number
  labelHeight: number
  fontSize: number
  radiusX: number
  radiusY: number
  connectorStrokeWidth: number
}

export type StackGuideFlagRenderItem = {
  label: string
  geometry: FlagLabelGeometry
  color: string
  align: 'start' | 'center'
}

export type OverlayBandSegment = {
  regionId: string
  rect: NormalizedRect
  frames: { frameStart: number; frameEnd: number; rowCount: number }
  minX: number
  columnWidth: number
  snapCount: number
  majorLineEvery?: number
}

export type OverlayPaperTrackRenderItem = {
  track: PaperTrack
  column: OverlayBandSegment & { rect: NormalizedRect }
  label: OverlayPaperTrackLabelGeometry
}

type StackGuidePlacement = {
  label: StackGuideLabel
  gapIndex: number
  widthInGaps: number
  lane: number
}

type StackGuideLabelMetrics = {
  baseOffsetPx: number
  lanePitchPx: number
  labelHeightPx: number
  minWidthPx: number
  maxWidthPx: number
  fontSizePx: number
  pageMarginPx: number
  poleGapPx: number
  textPaddingPx: number
  connectorStrokePx: number
  estimatedCharWidthPx: number
  radiusPx: number
}

type OverlayPaperTrackLabelGeometry = {
  stemX: number
  labelX: number
  labelY: number
  labelAttachX: number
  labelBottomY: number
  labelWidth: number
  labelHeight: number
  fontSize: number
  radiusX: number
  radiusY: number
}

type LabelLaneOccupancy = {
  leftPx: number
  rightPx: number
  lane: number
  source: 'stack-guide' | 'overlay-track'
}

const STACK_GUIDE_MAX_LANE = 8
const STACK_GUIDE_LABEL_BASE_OFFSET_PX = 28
const STACK_GUIDE_LABEL_LANE_PITCH_PX = 20
const STACK_GUIDE_LABEL_HEIGHT_PX = 14
const STACK_GUIDE_LABEL_MIN_WIDTH_PX = 22
const STACK_GUIDE_LABEL_MAX_WIDTH_PX = 76
const STACK_GUIDE_LABEL_FONT_SIZE_PX = 10.5
const STACK_GUIDE_LABEL_PAGE_MARGIN_PX = 6
const STACK_GUIDE_LABEL_POLE_GAP_PX = 2
const STACK_GUIDE_LABEL_TEXT_PADDING_PX = 3
const STACK_GUIDE_LABEL_CONNECTOR_STROKE_PX = 4
const STACK_GUIDE_LABEL_CHAR_WIDTH_PX = 6
const STACK_GUIDE_LABEL_RADIUS_PX = 2
const STACK_GUIDE_LABEL_EXTRA_WIDTH_PX = 3

export function createSheetRenderModelContext(
  project: CutProject,
  template: SheetTemplate,
  options: { cutGroup?: SheetRenderCutGroupContext } = {},
): SheetRenderModelContext {
  const displayFrameStart = logicalSheetDisplayFrameStart(project.logicalSheet)
  const displayDurationFrames = logicalSheetDisplayDurationFrames(project.logicalSheet)
  const officialFrameEnd = logicalSheetOfficialFrameEnd(project.logicalSheet)
  const pages = createSheetPages(template, displayDurationFrames, displayFrameStart)
  const paperTracks = templatePaperTracks(project).map(track => track.paperTrack)
  const pageSize = resolveSheetTemplatePageSize(template, displayDurationFrames, {
    paperTracks,
    layoutOverrides: project.sheetView.layoutOverrides,
  })
  return {
    project,
    template,
    pages,
    pageSize,
    width: pageSize.widthPx,
    height: pageSize.heightPx * pages.length,
    displayFrameStart,
    displayDurationFrames,
    officialFrameEnd,
    paperTracks,
    overlayTracks: overlayPaperTracks(project),
    cutGroup: options.cutGroup,
  }
}

export function hasOverlayRenderContent(context: SheetRenderModelContext): boolean {
  return context.overlayTracks.length > 0 || context.project.stackGuideLabels.some(label => stackGuideStackBand(label) === 'cell-interleave')
}

export function inputTextRenderItemsForPage(context: SheetRenderModelContext, page: SheetPage): SheetInputTextRenderItem[] {
  return context.project.logicalSheet.events.flatMap(event => {
    const key = context.project.logicalSheet.keys.find(key => key.keyId === event.keyId)
    if (!key && !isNullCellKeyId(event.keyId)) return []
    const sheetRole = sheetTimingRoleForEvent(event)
    const track = context.project.logicalSheet.paperTracks.find(item => item.paperTrack === event.paperTrack)
    const rect = track?.source === 'overlay'
      ? overlayCellRectForFrame(context, track, event.frame, page)
      : standardEventRectForPage(context, event, page)
    if (!rect) return []
    return [{
      eventId: event.eventId,
      keyId: event.keyId,
      paperTrack: event.paperTrack,
      frame: event.frame,
      text: isNullCellKeyId(event.keyId) ? NULL_CELL_DISPLAY_LABEL : key?.displayLabel ?? '',
      fontSizePx: resolveTimingTextFontSizePx(context.template, sheetRole, event.fontSizePx),
      rect,
    }]
  })
}

export function metadataTextRenderItemsForPage(context: SheetRenderModelContext, page: SheetPage): SheetMetadataTextRenderItem[] {
  const sharedCutNumbersVisible = sharedCutNumberLabels(context).length > 0
  return context.template.regions.flatMap(region => {
    if (region.type !== 'metadata-field' || !region.binding || region.usage === 'ignored') return []
    const text = region.binding.target === 'cut-metadata'
      ? metadataFieldText(context, page, region.binding.field, region.binding.customKey)
      : region.binding.target === 'cut-group' && region.binding.field === 'shared-cut-numbers'
        ? sharedCutNumbersText(context, region.binding.prefix, region.binding.separator)
        : ''
    if (!text) return []
    const field = region.binding.target === 'cut-metadata' || region.binding.target === 'cut-group'
      ? region.binding.field
      : ''
    const rect = resolveSheetTemplateRegionRect(
      context.template,
      region,
      context.displayDurationFrames,
      { paperTracks: context.paperTracks, layoutOverrides: context.project.sheetView.layoutOverrides },
    )
    const style = {
      ...(region.textStyle ?? {}),
      ...(sharedCutNumbersVisible ? region.textStyleVariants?.sharedCutNumbersVisible ?? {} : {}),
    }
    const paddingPx = Math.max(0, style.paddingPx ?? 8)
    const horizontalAlign = style.horizontalAlign ?? 'center'
    const verticalAlign = style.verticalAlign ?? 'middle'
    const fontSizePx = metadataFontSizePx(text, rect, context.pageSize, {
      fontSizePx: style.fontSizePx ?? 22,
      minFontSizePx: style.minFontSizePx ?? 10,
      paddingPx,
      shrinkToFit: style.shrinkToFit !== false,
    })
    const paddingX = paddingPx / context.pageSize.widthPx
    const paddingY = paddingPx / context.pageSize.heightPx
    return [{
      regionId: region.regionId,
      field,
      text,
      rect,
      x: horizontalAlign === 'left' ? rect.x + paddingX : horizontalAlign === 'right' ? rect.x + rect.w - paddingX : rect.x + rect.w / 2,
      y: verticalAlign === 'top' ? rect.y + paddingY : verticalAlign === 'bottom' ? rect.y + rect.h - paddingY : rect.y + rect.h / 2,
      textAnchor: horizontalAlign === 'left' ? 'start' : horizontalAlign === 'right' ? 'end' : 'middle',
      dominantBaseline: verticalAlign === 'top' ? 'hanging' : verticalAlign === 'bottom' ? 'text-after-edge' : 'central',
      fontSizePx,
      fontWeight: Math.max(100, Math.min(900, Math.round(style.fontWeight ?? 700))),
    }]
  })
}

function sharedCutNumberLabels(context: SheetRenderModelContext): string[] {
  if (!context.project.sheetView.metadataDisplay.sharedCutNumbers || !context.cutGroup) return []
  const seen = new Set<string>()
  return [...context.cutGroup.cuts]
    .sort((a, b) => a.order - b.order || a.cutId.localeCompare(b.cutId, 'ja'))
    .flatMap(cut => {
      if (cut.cutId === context.cutGroup?.activeCutId) return []
      const cutNumber = cut.metadata.cut?.trim()
      if (!cutNumber) return []
      const label = formatSheetTemplateCutNumber(context.template, cutNumber)
      if (!label || seen.has(label)) return []
      seen.add(label)
      return [label]
    })
}

function sharedCutNumbersText(context: SheetRenderModelContext, prefix = '兼用 ', separator = '・'): string {
  const labels = sharedCutNumberLabels(context)
  return labels.length > 0 ? `${prefix}${labels.join(separator)}` : ''
}

function metadataFieldText(
  context: SheetRenderModelContext,
  page: SheetPage,
  field: string,
  customKey?: string,
): string {
  if (field === 'duration') {
    const fps = Math.max(1, Math.round(context.project.logicalSheet.fps))
    const duration = Math.max(1, Math.round(context.project.logicalSheet.durationFrames))
    return `${String(Math.floor(duration / fps)).padStart(2, '0')}+${String(duration % fps).padStart(2, '0')}`
  }
  if (field === 'page') return `${page.pageIndex + 1}/${context.pages.length}`
  if (field === 'cut') return formatSheetTemplateCutNumber(context.template, context.project.cut.cut ?? '')
  if (field === 'custom') return customKey ? context.project.cut.custom?.[customKey] ?? '' : ''
  const value = context.project.cut[field as keyof typeof context.project.cut]
  return typeof value === 'string' ? value : ''
}

function metadataFontSizePx(
  text: string,
  rect: NormalizedRect,
  pageSize: { widthPx: number; heightPx: number },
  options: { fontSizePx: number; minFontSizePx: number; paddingPx: number; shrinkToFit: boolean },
): number {
  const availableWidth = Math.max(1, rect.w * pageSize.widthPx - options.paddingPx * 2)
  const availableHeight = Math.max(1, rect.h * pageSize.heightPx - options.paddingPx * 2)
  const requested = Math.max(1, options.fontSizePx)
  const heightLimited = Math.min(requested, availableHeight)
  if (!options.shrinkToFit) return heightLimited
  const widthUnits = Array.from(text).reduce((total, character) => total + (/^[\x20-\x7e]$/.test(character) ? 0.58 : 1), 0)
  const widthLimited = widthUnits > 0 ? availableWidth / widthUnits : heightLimited
  return Math.max(Math.min(options.minFontSizePx, heightLimited), Math.min(heightLimited, widthLimited))
}

export function overlayPaperTrackRenderItems(context: SheetRenderModelContext, page: SheetPage): OverlayPaperTrackRenderItem[] {
  const occupiedByRegion = new Map<string, LabelLaneOccupancy[]>()

  function occupiedLanesForRegion(region: SheetTemplate['regions'][number]) {
    const bandKey = overlayPaperTrackLabelBandKey(context.template, region)
    const existing = occupiedByRegion.get(bandKey)
    if (existing) return existing
    const occupied = stackGuideAnchorRegions(context, page)
      .filter(anchorRegion => overlayPaperTrackLabelBandKey(context.template, anchorRegion) === bandKey)
      .flatMap(anchorRegion => {
        const layout = resolveSheetTemplateGridLayout(context.template, anchorRegion, {
          paperTracks: context.paperTracks,
          durationFrames: context.displayDurationFrames,
          layoutOverrides: context.project.sheetView.layoutOverrides,
        })
        if (!layout || layout.columns.length === 0) return []
        const rect = layout.rect
        const columns = layout.columns
        const gapWidthPx = stackGuideGapWidthPx(context.template, rect, columns, context.pageSize.widthPx)
        const labelsForRegion = context.project.stackGuideLabels.filter(label =>
          (label.displayRole ?? 'action') === anchorRegion.grid?.role
          && stackGuideStackBand(label) === 'cell-interleave',
        )
        return stackGuidePlacements(context, labelsForRegion, gapWidthPx, columns).map(({ label, lane }) => {
          const geometry = stackGuideSvgGeometry(context.template, rect, context.pageSize, label, lane, columns)
          return {
            leftPx: geometry.labelX * context.pageSize.widthPx,
            rightPx: (geometry.labelX + geometry.labelWidth) * context.pageSize.widthPx,
            lane,
            source: 'stack-guide' as const,
          }
        })
      })
    occupiedByRegion.set(bandKey, occupied)
    return occupied
  }

  return context.overlayTracks.flatMap(track => {
    const column = overlayColumnRectForPage(context, track, page)
    if (!column) return []
    const region = context.template.regions.find(item => item.regionId === column.regionId)
    if (!region?.grid) return []
    const layout = resolveSheetTemplateGridLayout(context.template, region, {
      paperTracks: context.paperTracks,
      durationFrames: context.displayDurationFrames,
      layoutOverrides: context.project.sheetView.layoutOverrides,
    })
    if (!layout || layout.columns.length === 0) return []
    const rect = layout.rect
    const metrics = overlayPaperTrackLabelMetrics(context.template)
    const labelWidthPx = overlayPaperTrackLabelWidthPx(track, metrics)
    const occupied = occupiedLanesForRegion(region)
    const highestStackGuideLane = occupied.reduce((highest, candidate) => candidate.source === 'stack-guide' ? Math.max(highest, candidate.lane) : highest, -1)
    let lane = highestStackGuideLane >= 0 ? Math.min(highestStackGuideLane + 1, STACK_GUIDE_MAX_LANE) : 0
    let label = overlayPaperTrackLabelGeometry(context.template, rect, context.pageSize, track, column, lane, metrics, labelWidthPx)
    while (
      lane < STACK_GUIDE_MAX_LANE
      && occupied.some(candidate => candidate.lane === lane && labelLaneRangesOverlap(overlayPaperTrackLabelRangePx(label, context.pageSize), candidate))
    ) {
      lane += 1
      label = overlayPaperTrackLabelGeometry(context.template, rect, context.pageSize, track, column, lane, metrics, labelWidthPx)
    }
    occupied.push({ ...overlayPaperTrackLabelRangePx(label, context.pageSize), lane, source: 'overlay-track' })
    return [{ track, column, label }]
  })
}

export function stackGuideFlagRenderItemsForPage(context: SheetRenderModelContext, page: SheetPage): StackGuideFlagRenderItem[] {
  return stackGuideAnchorRegions(context, page).flatMap(region => {
    const displayRole = region.grid?.role as SheetTimingRole
    const layout = resolveSheetTemplateGridLayout(context.template, region, {
      paperTracks: context.paperTracks,
      durationFrames: context.displayDurationFrames,
      layoutOverrides: context.project.sheetView.layoutOverrides,
    })
    if (!layout || layout.columns.length === 0) return []
    const columns = layout.columns
    const rect = layout.rect
    const gapWidthPx = stackGuideGapWidthPx(context.template, rect, columns, context.pageSize.widthPx)
    const labelsForRegion = context.project.stackGuideLabels.filter(label =>
      (label.displayRole ?? 'action') === displayRole
      && stackGuideStackBand(label) === 'cell-interleave',
    )
    const placementsByGap = stackGuidePlacementsByGap(context, labelsForRegion, gapWidthPx, columns)
    return [...placementsByGap.values()].flatMap(placements =>
      placements.map(({ label, lane }) => ({
        label: label.label,
        geometry: stackGuideSvgGeometry(context.template, rect, context.pageSize, label, lane, columns),
        color: '#315bdc',
        align: 'start' as const,
      })),
    )
  })
}

function templatePaperTracks(project: CutProject): PaperTrack[] {
  return project.logicalSheet.paperTracks.filter(track => track.source !== 'overlay').sort((a, b) => a.order - b.order)
}

function overlayPaperTracks(project: CutProject): PaperTrack[] {
  return project.logicalSheet.paperTracks
    .filter(track => track.source === 'overlay' && track.viewPlacement?.expanded !== false)
    .sort((a, b) => a.order - b.order)
}

function stackGuideAnchorRegions(context: SheetRenderModelContext, page: SheetPage) {
  const frameOrigin = context.project.logicalSheet.frameOrigin
  if (frameOrigin < page.frameStart || frameOrigin > page.frameEnd) return []
  return context.template.regions.filter(region => {
    if (region.type !== 'exposure-grid' || !region.grid) return false
    if (region.grid.role !== 'action' && region.grid.role !== 'cell') return false
    if (region.grid.columns.length === 0) return false
    const frames = resolveSheetTemplateGridFrames(context.template, region.grid, page.frameEnd - page.frameStart + 1, frameOrigin)
    return frameOrigin >= frames.frameStart && frameOrigin <= frames.frameEnd
  })
}

function stackGuidePlacementsByGap(
  context: SheetRenderModelContext,
  labels: StackGuideLabel[],
  gapWidthPx: number,
  columns: Array<{ paperTrack?: string }>,
) {
  const placements = stackGuidePlacements(context, labels, gapWidthPx, columns)
  const byGap = new Map<number, StackGuidePlacement[]>()
  for (const placement of placements) {
    const gapPlacements = byGap.get(placement.gapIndex) ?? []
    gapPlacements.push(placement)
    byGap.set(placement.gapIndex, gapPlacements)
  }
  for (const gapPlacements of byGap.values()) {
    gapPlacements.sort((a, b) => a.lane - b.lane || compareStackGuideLabelsForExport(context)(a.label, b.label))
  }
  return byGap
}

function stackGuidePlacements(
  context: SheetRenderModelContext,
  labels: StackGuideLabel[],
  gapWidthPx: number,
  columns: Array<{ paperTrack?: string }>,
): StackGuidePlacement[] {
  const placed: StackGuidePlacement[] = []
  for (const label of [...labels].sort(compareStackGuidePlacementPriority(context))) {
    const gapIndex = stackGuideVisibleGapIndex(context, label, columns)
    if (gapIndex === null) continue
    const widthInGaps = stackGuideLabelWidthPx(label, stackGuideLabelMetrics(context.template)) / gapWidthPx
    let lane = 0
    while (
      lane < STACK_GUIDE_MAX_LANE
      && placed.some(candidate => candidate.lane === lane && stackGuidePlacementsOverlap({ gapIndex, widthInGaps }, candidate))
    ) {
      lane += 1
    }
    placed.push({ label, gapIndex, widthInGaps, lane })
  }
  return placed
}

function compareStackGuidePlacementPriority(context: SheetRenderModelContext) {
  const fallback = compareStackGuideLabelsForExport(context)
  return (a: StackGuideLabel, b: StackGuideLabel): number =>
    stackGuideLabelSequence(a.labelId) - stackGuideLabelSequence(b.labelId)
    || fallback(a, b)
}

function compareStackGuideLabelsForExport(context: SheetRenderModelContext) {
  return (a: StackGuideLabel, b: StackGuideLabel): number =>
    stackGuideBandSortValue(a) - stackGuideBandSortValue(b)
    || stackGuideGapIndex(context.project, a) - stackGuideGapIndex(context.project, b)
    || a.orderInGap - b.orderInGap
    || compareNaturalFileNameText(a.label, b.label)
    || a.labelId.localeCompare(b.labelId, 'ja')
}

function stackGuideBandSortValue(label: StackGuideLabel): number {
  const stackBand = stackGuideStackBand(label)
  if (stackBand === 'cell-interleave') return 0
  if (stackBand === 'camera-note') return 1
  return 2
}

function stackGuideLabelSequence(labelId: string) {
  const match = /_(\d+)$/.exec(labelId)
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

function stackGuideVisibleGapIndex(_context: SheetRenderModelContext, label: StackGuideLabel, columns: Array<{ paperTrack?: string }>): number | null {
  return stackGuideVisibleSnapIndex(label, columns)
}

function stackGuideVisibleSnapIndex(label: StackGuideLabel, columns: Array<{ paperTrack?: string }>): number {
  if (Number.isFinite(label.viewSnapIndex)) return clampNumberForRender(Math.round(label.viewSnapIndex as number), 0, Number.MAX_SAFE_INTEGER)
  if (label.insertAfterPaperTrack) {
    const trackIndex = columns.findIndex(column => column.paperTrack === label.insertAfterPaperTrack)
    if (trackIndex >= 0) return trackIndex + 2
  }
  return clampNumberForRender(Math.round(label.gapIndex) + 1, 0, columns.length + 1)
}

function stackGuidePlacementsOverlap(
  a: Pick<StackGuidePlacement, 'gapIndex' | 'widthInGaps'>,
  b: Pick<StackGuidePlacement, 'gapIndex' | 'widthInGaps'>,
) {
  return Math.abs(a.gapIndex - b.gapIndex) < (a.widthInGaps + b.widthInGaps) / 2 + 0.18
}

function stackGuideSvgGeometry(
  template: SheetTemplate,
  rect: NormalizedRect,
  pageSize: { widthPx: number; heightPx: number },
  label: StackGuideLabel,
  lane: number,
  columns: Array<{ paperTrack?: string; x?: number; w?: number }>,
): FlagLabelGeometry {
  const metrics = stackGuideLabelMetrics(template)
  const snapIndex = stackGuideVisibleSnapIndex(label, columns)
  const anchorX = stackGuideSnapX(rect, columns, snapIndex)
  const anchorY = rect.y
  const labelWidth = stackGuideLabelWidthPx(label, metrics) / pageSize.widthPx
  const labelHeight = metrics.labelHeightPx / pageSize.heightPx
  const labelPoleGap = metrics.poleGapPx / pageSize.widthPx
  const labelTextPadding = metrics.textPaddingPx / pageSize.widthPx
  const pageMargin = metrics.pageMarginPx / pageSize.widthPx
  const labelBottomOffset = (stackGuideHeaderReachPx(template, rect, pageSize.heightPx) + stackGuideLabelBottomPx(template, lane)) / pageSize.heightPx
  const desiredLabelX = anchorX + labelPoleGap
  const labelX = clampNumberForRender(desiredLabelX, pageMargin, 1 - pageMargin - labelWidth)
  const labelAttachX = labelX >= anchorX ? labelX : labelX + labelWidth
  const labelBottomY = anchorY - labelBottomOffset
  const labelY = labelBottomY - labelHeight
  return {
    anchorX,
    anchorY,
    labelX,
    labelY,
    labelAttachX,
    labelTextX: labelX + labelTextPadding,
    labelBottomY,
    labelWidth,
    labelHeight,
    fontSize: metrics.fontSizePx / pageSize.heightPx,
    radiusX: metrics.radiusPx / pageSize.widthPx,
    radiusY: metrics.radiusPx / pageSize.heightPx,
    connectorStrokeWidth: metrics.connectorStrokePx / pageSize.heightPx,
  }
}

function stackGuideSnapX(rect: NormalizedRect, columns: Array<{ x?: number; w?: number }>, snapIndex: number): number {
  const columnCount = Math.max(1, columns.length)
  if (columns.length > 0 && columns.every(column => typeof column.x === 'number' && typeof column.w === 'number')) {
    const first = columns[0]!
    const last = columns[columns.length - 1]!
    if (snapIndex <= 0) return (first.x ?? rect.x) - (first.w ?? rect.w / columnCount)
    if (snapIndex >= columns.length + 1) return (last.x ?? rect.x) + (last.w ?? rect.w / columnCount)
    const previous = columns[snapIndex - 1]
    return previous ? (previous.x ?? rect.x) + (previous.w ?? rect.w / columnCount) : rect.x
  }
  return rect.x + (rect.w * (snapIndex - 1)) / columnCount
}

function stackGuideGapWidthPx(template: SheetTemplate, rect: NormalizedRect, columns: Array<{ paperTrack?: string; w?: number }>, pageWidthPx: number) {
  const columnCount = Math.max(1, columns.length)
  const averageColumnWidth = columns.length > 0 && columns.every(column => typeof column.w === 'number')
    ? columns.reduce((total, column) => total + (column.w ?? 0), 0) / columns.length
    : rect.w / columnCount
  return Math.max(1, averageColumnWidth * pageWidthPx)
}

function stackGuideLabelMetrics(template: SheetTemplate): StackGuideLabelMetrics {
  const style = template.style?.bgBookLabel
  const targetFontSizePx = templateGridHeaderFontSizePx(template)
  const rawFontSizePx = ptToTemplatePx(template, style?.fontSizePt, STACK_GUIDE_LABEL_FONT_SIZE_PX)
  const fontSizePx = Math.max(rawFontSizePx, targetFontSizePx)
  const textPaddingPx = Math.max(mmToTemplatePx(template, style?.textPaddingMm, STACK_GUIDE_LABEL_TEXT_PADDING_PX), fontSizePx * 0.22)
  const labelHeightPx = Math.max(mmToTemplatePx(template, style?.labelHeightMm, STACK_GUIDE_LABEL_HEIGHT_PX), fontSizePx + 4)
  const minWidthPx = Math.max(mmToTemplatePx(template, style?.minWidthMm, STACK_GUIDE_LABEL_MIN_WIDTH_PX), fontSizePx + textPaddingPx * 2)
  const maxWidthPx = Math.max(mmToTemplatePx(template, style?.maxWidthMm, STACK_GUIDE_LABEL_MAX_WIDTH_PX), minWidthPx, fontSizePx * 8)
  const estimatedCharWidthPx = Math.max(mmToTemplatePx(template, style?.estimatedCharWidthMm, STACK_GUIDE_LABEL_CHAR_WIDTH_PX), fontSizePx * 0.56)
  return {
    baseOffsetPx: mmToTemplatePx(template, style?.baseOffsetMm, STACK_GUIDE_LABEL_BASE_OFFSET_PX),
    lanePitchPx: Math.max(mmToTemplatePx(template, style?.lanePitchMm, STACK_GUIDE_LABEL_LANE_PITCH_PX), labelHeightPx + 3),
    labelHeightPx,
    minWidthPx,
    maxWidthPx,
    fontSizePx,
    pageMarginPx: mmToTemplatePx(template, style?.pageMarginMm, STACK_GUIDE_LABEL_PAGE_MARGIN_PX),
    poleGapPx: mmToTemplatePx(template, style?.poleGapMm, STACK_GUIDE_LABEL_POLE_GAP_PX),
    textPaddingPx,
    connectorStrokePx: mmToTemplatePx(template, style?.connectorStrokeMm, STACK_GUIDE_LABEL_CONNECTOR_STROKE_PX),
    estimatedCharWidthPx,
    radiusPx: mmToTemplatePx(template, style?.radiusMm, STACK_GUIDE_LABEL_RADIUS_PX),
  }
}

function stackGuideLabelBottomPx(template: SheetTemplate, lane: number) {
  const metrics = stackGuideLabelMetrics(template)
  return metrics.baseOffsetPx + Math.min(lane, STACK_GUIDE_MAX_LANE) * metrics.lanePitchPx
}

function stackGuideHeaderReachPx(template: SheetTemplate, rect: NormalizedRect, pageHeightPx: number) {
  const headerTopOffsetPx = STANDARD_A3_GRID_HEADER_TOP_OFFSET * template.page.heightPx
  return Math.max(12, Math.min(rect.y * pageHeightPx, headerTopOffsetPx))
}

function stackGuideLabelWidthPx(label: Pick<StackGuideLabel, 'label'>, metrics: StackGuideLabelMetrics) {
  return Math.min(
    metrics.maxWidthPx,
    Math.max(
      metrics.minWidthPx,
      estimatedLabelTextWidthPx(label.label, metrics) + metrics.textPaddingPx * 2 + STACK_GUIDE_LABEL_EXTRA_WIDTH_PX,
    ),
  )
}

function estimatedLabelTextWidthPx(text: string, metrics: Pick<StackGuideLabelMetrics, 'fontSizePx' | 'estimatedCharWidthPx'>): number {
  return Array.from(text).reduce((width, char) => width + estimatedLabelCharWidthPx(char, metrics), 0)
}

function estimatedLabelCharWidthPx(char: string, metrics: Pick<StackGuideLabelMetrics, 'fontSizePx' | 'estimatedCharWidthPx'>): number {
  if (/[\u3000-\u9fff\u3040-\u30ff\uff00-\uffef]/u.test(char)) return metrics.fontSizePx * 0.92
  if (/[ilI1|]/.test(char)) return metrics.fontSizePx * 0.34
  if (/[MW@%]/.test(char)) return metrics.fontSizePx * 0.78
  if (/[A-Z0-9]/.test(char)) return metrics.fontSizePx * 0.52
  if (/[a-z]/.test(char)) return metrics.fontSizePx * 0.48
  if (/\s/.test(char)) return metrics.fontSizePx * 0.32
  return Math.min(metrics.estimatedCharWidthPx, metrics.fontSizePx * 0.56)
}

function stackGuideTemplateDpi(template: SheetTemplate): number | undefined {
  return template.style?.bgBookLabel?.designDpi ?? template.page.dpi
}

function mmToTemplatePx(template: SheetTemplate, mm: number | undefined, fallbackPx: number): number {
  const dpi = stackGuideTemplateDpi(template)
  return mm !== undefined && dpi ? (mm * dpi) / 25.4 : fallbackPx
}

function ptToTemplatePx(template: SheetTemplate, pt: number | undefined, fallbackPx: number): number {
  const dpi = stackGuideTemplateDpi(template)
  return pt !== undefined && dpi ? (pt * dpi) / 72 : fallbackPx
}

function templateGridHeaderFontSizePx(template: SheetTemplate): number {
  return 0.0075 * template.page.heightPx
}

function overlayPaperTrackLabelMetrics(template: SheetTemplate): StackGuideLabelMetrics {
  const base = stackGuideLabelMetrics(template)
  const textPaddingPx = Math.max(2, base.textPaddingPx * 0.72)
  const fontSizePx = base.fontSizePx
  return {
    ...base,
    labelHeightPx: Math.max(11, fontSizePx + 3),
    minWidthPx: Math.max(13, fontSizePx * 0.72 + textPaddingPx * 2),
    fontSizePx,
    textPaddingPx,
    estimatedCharWidthPx: Math.max(base.estimatedCharWidthPx * 0.9, fontSizePx * 0.54),
    radiusPx: Math.max(1.5, base.radiusPx * 0.8),
  }
}

function overlayPaperTrackLabelWidthPx(track: Pick<PaperTrack, 'label'>, metrics: StackGuideLabelMetrics) {
  return Math.min(metrics.maxWidthPx, Math.max(metrics.minWidthPx, estimatedLabelTextWidthPx(track.label, metrics) + metrics.textPaddingPx * 2))
}

function overlayPaperTrackLabelGeometry(
  template: SheetTemplate,
  rect: NormalizedRect,
  pageSize: { widthPx: number; heightPx: number },
  track: PaperTrack,
  column: { rect: NormalizedRect },
  lane: number,
  metrics: StackGuideLabelMetrics,
  labelWidthPx: number,
): OverlayPaperTrackLabelGeometry {
  const labelWidth = labelWidthPx / pageSize.widthPx
  const labelHeight = metrics.labelHeightPx / pageSize.heightPx
  const pageMargin = metrics.pageMarginPx / pageSize.widthPx
  const poleGap = metrics.poleGapPx / pageSize.widthPx
  const labelBottomOffset = (stackGuideHeaderReachPx(template, rect, pageSize.heightPx) + stackGuideLabelBottomPx(template, lane)) / pageSize.heightPx
  const stemX = column.rect.x
  const labelBottomY = rect.y - labelBottomOffset
  const labelY = labelBottomY - labelHeight
  const desiredLabelX = stemX + poleGap
  const labelX = clampNumberForRender(desiredLabelX, pageMargin, 1 - pageMargin - labelWidth)
  const labelAttachX = labelX >= stemX ? labelX : labelX + labelWidth
  return {
    stemX,
    labelX,
    labelY,
    labelAttachX,
    labelBottomY,
    labelWidth,
    labelHeight,
    fontSize: metrics.fontSizePx / pageSize.heightPx,
    radiusX: metrics.radiusPx / pageSize.widthPx,
    radiusY: metrics.radiusPx / pageSize.heightPx,
  }
}

function overlayPaperTrackLabelBandKey(template: SheetTemplate, region: SheetTemplate['regions'][number]) {
  return String(region.grid?.frameStart ?? template.defaults.frameOrigin)
}

function overlayPaperTrackLabelRangePx(label: OverlayPaperTrackLabelGeometry, pageSize: { widthPx: number }) {
  return {
    leftPx: label.labelX * pageSize.widthPx,
    rightPx: (label.labelX + label.labelWidth) * pageSize.widthPx,
  }
}

function labelLaneRangesOverlap(a: Pick<LabelLaneOccupancy, 'leftPx' | 'rightPx'>, b: Pick<LabelLaneOccupancy, 'leftPx' | 'rightPx'>) {
  const marginPx = 4
  return a.leftPx < b.rightPx + marginPx && b.leftPx < a.rightPx + marginPx
}

function overlayCellRectForFrame(context: SheetRenderModelContext, track: PaperTrack, frame: number, page: SheetPage): NormalizedRect | null {
  const localized = localizeFrameToSheetPage(context.template, frame, context.displayDurationFrames, context.displayFrameStart)
  if (!localized || localized.page.pageId !== page.pageId) return null
  const column = overlayColumnRectForPage(context, track, page)
  if (!column) return null
  if (localized.localFrame < column.frames.frameStart || localized.localFrame > column.frames.frameEnd) return null
  const rowIndex = localized.localFrame - column.frames.frameStart
  const rowH = column.rect.h / column.frames.rowCount
  return {
    x: column.rect.x,
    y: column.rect.y + rowH * rowIndex,
    w: column.rect.w,
    h: rowH,
  }
}

function overlayColumnRectForPage(context: SheetRenderModelContext, track: PaperTrack, page: SheetPage): (OverlayBandSegment & { rect: NormalizedRect }) | null {
  const role = track.viewPlacement?.sheetRole ?? 'cell'
  const segments = overlayBandSegments(context, role)
  const frameOrigin = frameOriginForPage(context.template, page)
  const segment = segments.find(item => {
    const segmentStart = page.frameStart + (item.frames.frameStart - frameOrigin)
    const segmentEnd = page.frameStart + (item.frames.frameEnd - frameOrigin)
    return page.frameStart <= segmentEnd && page.frameEnd >= segmentStart
  })
  if (!segment) return null
  const snapIndex = clampNumberForRender(Math.round(track.viewPlacement?.snapIndex ?? 0), 0, segment.snapCount)
  return {
    ...segment,
    rect: {
      x: segment.minX + segment.columnWidth * snapIndex,
      y: segment.rect.y,
      w: segment.columnWidth,
      h: segment.rect.h,
    },
  }
}

function overlayBandSegments(context: SheetRenderModelContext, role: SheetTimingRole): OverlayBandSegment[] {
  const viewLayout = getSheetViewLayout(context.template)
  const frameOrigin = viewLayout.frameAxis?.type === 'continuous' || viewLayout.frameAxis?.type === 'infinite'
    ? context.displayFrameStart
    : context.template.defaults.frameOrigin
  return context.template.regions.flatMap(region => {
    if (region.type !== 'exposure-grid' || region.grid?.role !== role) return []
    const layout = resolveSheetTemplateGridLayout(context.template, region, {
      paperTracks: context.paperTracks,
      durationFrames: context.displayDurationFrames,
      frameOrigin,
      layoutOverrides: context.project.sheetView.layoutOverrides,
    })
    if (!layout || layout.columns.length === 0) return []
    const rect = layout.rect
    const columns = layout.columns
    const frames = layout.frames
    const actionRegion = matchingGridRegion(context.template, 'action', frames.frameStart)
    const cameraRegion = matchingGridRegion(context.template, 'camera', frames.frameStart)
    const actionLayout = actionRegion ? resolveSheetTemplateGridLayout(context.template, actionRegion, {
      paperTracks: context.paperTracks,
      durationFrames: context.displayDurationFrames,
      frameOrigin,
      layoutOverrides: context.project.sheetView.layoutOverrides,
    }) : null
    const cameraLayout = cameraRegion ? resolveSheetTemplateGridLayout(context.template, cameraRegion, {
      paperTracks: context.paperTracks,
      durationFrames: context.displayDurationFrames,
      frameOrigin,
      layoutOverrides: context.project.sheetView.layoutOverrides,
    }) : null
    const actionRect = actionLayout?.rect ?? rect
    const cameraRect = cameraLayout?.rect ?? rect
    const columnWidth = columns.reduce((total, column) => total + column.w, 0) / columns.length
    const minX = Math.max(0, actionRect.x - columnWidth)
    const maxX = Math.min(1 - columnWidth, cameraRect.x + cameraRect.w)
    const snapCount = Math.max(0, Math.round((maxX - minX) / columnWidth))
    return [{
      regionId: region.regionId,
      rect,
      frames,
      minX,
      columnWidth,
      snapCount,
      majorLineEvery: region.grid.majorLineEvery,
    }]
  })
}

function standardEventRectForPage(
  context: SheetRenderModelContext,
  event: CutProject['logicalSheet']['events'][number],
  page: SheetPage,
): NormalizedRect | null {
  const hit = timingHitForFrame(
    context.template,
    sheetTimingRoleForEvent(event),
    event.paperTrack,
    event.frame,
    context.displayDurationFrames,
    context.displayFrameStart,
    context.paperTracks,
  )
  if (!hit || hit.pageId !== page.pageId) return null
  return cellRectForHit(context.template, hit, context.displayDurationFrames, context.displayFrameStart, {
    paperTracks: context.paperTracks,
    layoutOverrides: context.project.sheetView.layoutOverrides,
  })
}

function matchingGridRegion(template: SheetTemplate, role: 'action' | 'cell' | 'camera', frameStart: number): SheetTemplate['regions'][number] | undefined {
  return template.regions.find(region =>
    region.type === 'exposure-grid'
    && region.grid?.role === role
    && (region.grid.frameStart ?? template.defaults.frameOrigin) === frameStart,
  )
}

function frameOriginForPage(template: SheetTemplate, page: SheetPage): number {
  const layout = getSheetViewLayout(template)
  return layout.frameAxis?.type === 'continuous' || layout.frameAxis?.type === 'infinite'
    ? page.frameStart
    : template.defaults.frameOrigin
}

function clampNumberForRender(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}
