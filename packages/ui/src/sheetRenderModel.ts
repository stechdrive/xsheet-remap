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
  resolveSheetTemplateGridLayout,
  resolveSheetTemplatePageSize,
  resolveSheetTemplateRegionRect,
  sheetTimingRoleForEvent,
  stackGuideStackBand,
  timingHitForFrame,
  type CutProject,
  type CutSheetDocument,
  type NormalizedRect,
  type PaperTrack,
  type SheetPage,
  type SheetTemplate,
  type SheetTemplateGridRowLineRule,
  type SheetTimingRole,
} from '@xsheet-remap/core'
import { resolveTimingTextFontSizePx } from './sheetTextLayout'
import { STACK_GUIDE_MAX_LANE, stackGuideAnchorRegions, stackGuideGapWidthPx, stackGuidePlacements, stackGuidePlacementsByGap, stackGuideSvgGeometry } from './stack-guides-geometry'
import { auxiliaryLabelRangePx, auxiliaryLabelRangesOverlap, overlayAuxiliaryLabelBandKey, overlayAuxiliaryLabelGeometry, type OverlayAuxiliaryLabelGeometry } from './auxiliary-label-layout'

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
  lines: string[]
  lineHeightPx: number
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
  displayText: string
  fullText: string
  truncated: boolean
  fontSizePx: number
  fontFamily: string
  fontWeight: number
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
  rowLineRules?: SheetTemplateGridRowLineRule[]
}

export type OverlayPaperTrackRenderItem = {
  track: PaperTrack
  column: OverlayBandSegment & { rect: NormalizedRect }
  label: OverlayAuxiliaryLabelGeometry
}

type LabelLaneOccupancy = {
  leftPx: number
  rightPx: number
  lane: number
  source: 'stack-guide' | 'overlay-track'
}

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
  const sharedLabels = sharedCutNumberLabels(context)
  const sharedCutNumbersVisible = sharedLabels.length > 0
  const explicitSharedCutRegion = context.template.regions.some(region =>
    region.type === 'metadata-field'
    && region.usage !== 'ignored'
    && region.binding?.target === 'cut-group'
    && region.binding.field === 'shared-cut-numbers',
  )
  const items = context.template.regions.flatMap(region => metadataTextRenderItemsForRegion(
    context,
    page,
    region,
    sharedLabels,
    sharedCutNumbersVisible,
  ))
  if (!sharedCutNumbersVisible || explicitSharedCutRegion) return items

  const cutRegion = context.template.regions.find(region =>
    region.type === 'metadata-field'
    && region.usage !== 'ignored'
    && region.binding?.target === 'cut-metadata'
    && region.binding.field === 'cut',
  )
  if (!cutRegion) return items
  const cutRect = resolveSheetTemplateRegionRect(
    context.template,
    cutRegion,
    context.displayDurationFrames,
    { paperTracks: context.paperTracks, layoutOverrides: context.project.sheetView.layoutOverrides },
  )
  const fallbackRegion: SheetTemplate['regions'][number] = {
    regionId: `${cutRegion.regionId}__shared_cut_numbers`,
    type: 'metadata-field',
    label: '兼用カット',
    rect: {
      x: cutRect.x,
      y: cutRect.y + cutRect.h * 0.48,
      w: cutRect.w,
      h: cutRect.h * 0.52,
    },
    usage: 'render-only',
    inputKind: 'text',
    binding: {
      target: 'cut-group',
      field: 'shared-cut-numbers',
      opening: '[',
      closing: ']',
      separator: '・',
    },
    textStyle: {
      fontSizePx: 12,
      minFontSizePx: 7,
      lineHeightPx: 14,
      fontWeight: 700,
      horizontalAlign: 'center',
      verticalAlign: 'top',
      paddingPx: 2,
      shrinkToFit: true,
    },
  }
  return [
    ...items,
    ...metadataTextRenderItemsForRegion(
      context,
      page,
      fallbackRegion,
      sharedLabels,
      sharedCutNumbersVisible,
      fallbackRegion.rect,
    ),
  ]
}

function metadataTextRenderItemsForRegion(
  context: SheetRenderModelContext,
  page: SheetPage,
  region: SheetTemplate['regions'][number],
  sharedLabels: string[],
  sharedCutNumbersVisible: boolean,
  resolvedRect?: NormalizedRect,
): SheetMetadataTextRenderItem[] {
    if (region.type !== 'metadata-field' || !region.binding || region.usage === 'ignored') return []
    const sharedCutBinding = region.binding.target === 'cut-group' && region.binding.field === 'shared-cut-numbers'
      ? region.binding
      : null
    const isSharedCutNumbers = sharedCutBinding !== null
    const opening = sharedCutBinding?.opening ?? '['
    const closing = sharedCutBinding?.closing ?? ']'
    const separator = sharedCutBinding?.separator ?? '・'
    const text = region.binding.target === 'cut-metadata'
      ? metadataFieldText(context, page, region.binding.field, region.binding.customKey)
      : isSharedCutNumbers
        ? sharedCutNumbersText(sharedLabels, opening, closing, separator)
        : ''
    if (!text) return []
    const field = region.binding.target === 'cut-metadata' || region.binding.target === 'cut-group'
      ? region.binding.field
      : ''
    const rect = resolvedRect ?? resolveSheetTemplateRegionRect(
      context.template,
      region,
      context.displayDurationFrames,
      { paperTracks: context.paperTracks, layoutOverrides: context.project.sheetView.layoutOverrides },
    )
    const sharedCutNumberCutStyle = sharedCutNumbersVisible
      && region.binding.target === 'cut-metadata'
      && region.binding.field === 'cut'
      ? region.textStyleVariants?.sharedCutNumbersVisible ?? {
          verticalAlign: 'top' as const,
          paddingPx: Math.min(region.textStyle?.paddingPx ?? 8, 5),
        }
      : {}
    const style = {
      ...(region.textStyle ?? {}),
      ...sharedCutNumberCutStyle,
    }
    const paddingPx = Math.max(0, style.paddingPx ?? 8)
    const horizontalAlign = style.horizontalAlign ?? 'center'
    const verticalAlign = style.verticalAlign ?? 'middle'
    const fontSizePx = isSharedCutNumbers
      ? sharedCutNumbersFontSizePx(sharedLabels, rect, context.pageSize, {
          fontSizePx: style.fontSizePx ?? 12,
          minFontSizePx: style.minFontSizePx ?? 7,
          paddingPx,
          shrinkToFit: style.shrinkToFit !== false,
          opening,
          closing,
        })
      : metadataFontSizePx(text, rect, context.pageSize, {
      fontSizePx: style.fontSizePx ?? 22,
      minFontSizePx: style.minFontSizePx ?? 10,
      paddingPx,
      shrinkToFit: style.shrinkToFit !== false,
    })
    const lines = isSharedCutNumbers
      ? wrapSharedCutNumberLines(sharedLabels, {
          availableWidthPx: Math.max(1, rect.w * context.pageSize.widthPx - paddingPx * 2),
          fontSizePx,
          opening,
          closing,
          separator,
        })
      : [text]
    const paddingX = paddingPx / context.pageSize.widthPx
    const paddingY = paddingPx / context.pageSize.heightPx
    return [{
      regionId: region.regionId,
      field,
      text,
      lines,
      lineHeightPx: Math.max(fontSizePx, style.lineHeightPx ?? fontSizePx * 1.15),
      rect,
      x: horizontalAlign === 'left' ? rect.x + paddingX : horizontalAlign === 'right' ? rect.x + rect.w - paddingX : rect.x + rect.w / 2,
      y: verticalAlign === 'top' ? rect.y + paddingY : verticalAlign === 'bottom' ? rect.y + rect.h - paddingY : rect.y + rect.h / 2,
      textAnchor: horizontalAlign === 'left' ? 'start' : horizontalAlign === 'right' ? 'end' : 'middle',
      dominantBaseline: verticalAlign === 'top' ? 'hanging' : verticalAlign === 'bottom' ? 'text-after-edge' : 'central',
      fontSizePx,
      fontWeight: Math.max(100, Math.min(900, Math.round(style.fontWeight ?? 700))),
    }]
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

function sharedCutNumbersText(labels: string[], opening: string, closing: string, separator: string): string {
  return labels.length > 0 ? `${opening}${labels.join(separator)}${closing}` : ''
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
  const widthUnits = metadataTextWidthUnits(text)
  const widthLimited = widthUnits > 0 ? availableWidth / widthUnits : heightLimited
  return Math.max(Math.min(options.minFontSizePx, heightLimited), Math.min(heightLimited, widthLimited))
}

function sharedCutNumbersFontSizePx(
  labels: string[],
  rect: NormalizedRect,
  pageSize: { widthPx: number; heightPx: number },
  options: {
    fontSizePx: number
    minFontSizePx: number
    paddingPx: number
    shrinkToFit: boolean
    opening: string
    closing: string
  },
): number {
  const availableWidth = Math.max(1, rect.w * pageSize.widthPx - options.paddingPx * 2)
  const availableHeight = Math.max(1, rect.h * pageSize.heightPx - options.paddingPx * 2)
  const requested = Math.max(1, options.fontSizePx)
  const heightLimited = Math.min(requested, availableHeight)
  if (!options.shrinkToFit) return heightLimited
  const widestAtomicUnits = labels.reduce(
    (widest, label) => Math.max(widest, metadataTextWidthUnits(`${options.opening}${label}${options.closing}`)),
    0,
  )
  const widthLimited = widestAtomicUnits > 0 ? availableWidth / widestAtomicUnits : heightLimited
  return Math.max(Math.min(options.minFontSizePx, heightLimited), Math.min(heightLimited, widthLimited))
}

function wrapSharedCutNumberLines(
  labels: string[],
  options: {
    availableWidthPx: number
    fontSizePx: number
    opening: string
    closing: string
    separator: string
  },
): string[] {
  if (labels.length === 0) return []
  const groups: string[][] = []
  let current: string[] = []
  for (let index = 0; index < labels.length; index += 1) {
    const candidate = [...current, labels[index]]
    const candidateText = `${groups.length === 0 ? options.opening : ''}${candidate.join(options.separator)}${index === labels.length - 1 ? options.closing : ''}`
    const candidateWidthPx = metadataTextWidthUnits(candidateText) * options.fontSizePx
    if (current.length === 0 || candidateWidthPx <= options.availableWidthPx) {
      current = candidate
      continue
    }
    groups.push(current)
    current = [labels[index]]
  }
  if (current.length > 0) groups.push(current)
  return groups.map((group, index) =>
    `${index === 0 ? options.opening : ''}${group.join(options.separator)}${index === groups.length - 1 ? options.closing : ''}`,
  )
}

function metadataTextWidthUnits(text: string): number {
  return Array.from(text).reduce((total, character) => total + (/^[\x20-\x7e]$/.test(character) ? 0.58 : 1), 0)
}

export function overlayPaperTrackRenderItems(context: SheetRenderModelContext, page: SheetPage): OverlayPaperTrackRenderItem[] {
  const occupiedByRegion = new Map<string, LabelLaneOccupancy[]>()

  function occupiedLanesForRegion(region: SheetTemplate['regions'][number]) {
    const bandKey = overlayAuxiliaryLabelBandKey(context.template, region)
    const existing = occupiedByRegion.get(bandKey)
    if (existing) return existing
    const occupied = stackGuideAnchorRegions(context.template, page, context.project.logicalSheet.frameOrigin)
      .filter(anchorRegion => overlayAuxiliaryLabelBandKey(context.template, anchorRegion) === bandKey)
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
        return stackGuidePlacements(context.template, context.project, labelsForRegion, gapWidthPx, columns).map(({ label, lane }) => {
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
    const occupied = occupiedLanesForRegion(region)
    const highestStackGuideLane = occupied.reduce((highest, candidate) => candidate.source === 'stack-guide' ? Math.max(highest, candidate.lane) : highest, -1)
    let lane = highestStackGuideLane >= 0 ? Math.min(highestStackGuideLane + 1, STACK_GUIDE_MAX_LANE) : 0
    let label = overlayAuxiliaryLabelGeometry(context.template, rect, context.pageSize, track, column, lane, STACK_GUIDE_MAX_LANE)
    while (
      lane < STACK_GUIDE_MAX_LANE
      && occupied.some(candidate => candidate.lane === lane && auxiliaryLabelRangesOverlap(auxiliaryLabelRangePx(label, context.pageSize.widthPx), candidate))
    ) {
      lane += 1
      label = overlayAuxiliaryLabelGeometry(context.template, rect, context.pageSize, track, column, lane, STACK_GUIDE_MAX_LANE)
    }
    occupied.push({ ...auxiliaryLabelRangePx(label, context.pageSize.widthPx), lane, source: 'overlay-track' })
    return [{ track, column, label }]
  })
}

export function stackGuideFlagRenderItemsForPage(context: SheetRenderModelContext, page: SheetPage): StackGuideFlagRenderItem[] {
  return stackGuideAnchorRegions(context.template, page, context.project.logicalSheet.frameOrigin).flatMap(region => {
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
    const placementsByGap = stackGuidePlacementsByGap(context.template, context.project, labelsForRegion, gapWidthPx, columns)
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
      rowLineRules: region.grid.rowLineRules,
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
