import {
  paperTrackDisplayRole, timingEventIndex, timingGroupKey, timingFrameLowerBound, timingEventsInRange, timingKeyIndex,
  timingReferenceAddress,
  timingReferenceMap,
  cellRectForHit,
  createSheetPages,
  formatSheetTemplateCutNumber,
  getSheetViewLayout,
  logicalSheetDisplayDurationFrames,
  logicalSheetDisplayFrameStart,
  logicalSheetOfficialFrameEnd,
  projectSheetLayoutOptions,
  isTimelineProjectingSheetTemplateGridRegion,
  isSpecialTimingEvent,
  resolveSheetTemplateGridLayout,
  resolveSheetTemplatePageSize,
  resolveSheetTemplateRegionRect,
  resolveSheetTemplateRegionCapabilities,
  resolveSheetTemplateTextStyle,
  resolveSheetFormFieldValue,
  sheetFormFieldsForScope,
  sheetFormFieldValueText,
  sheetTimingRoleForEvent,
  timingEventValueKind,
  stackGuideStackBand,
  timingHitForFrame,
  type SheetGeometryInput,
  type SheetContentInput,
  type CutSheetDocument,
  type NormalizedRect,
  type PaperTrack,
  type SheetPage,
  type SheetTemplate,
  type SheetTemplateLayoutResolveOptions,
  type SheetTimingRole,
  type TimelineEventValueKind,
  type TimelineEvent,
} from '@xsheet-remap/core'
import { buildTemplateChromeRenderModel, type TemplateFormFieldRenderModel } from './templateEditorGeometry'
import { overlayColumnsForPage, overlayCellRect, overlayColumnAtFrame, overlayPaperTracks, type OverlayBandSegment } from './app-sheet-geometry'
import { defaultTimingTextMinFontSizePx, resolveTimingTextFontSizePx } from './sheetTextLayout'
import { layoutTimingCellText, type TimingCellTextLayout } from './timingCellTextLayout'
import { STACK_GUIDE_MAX_LANE, overlayBandSegmentForRegion, stackGuideAnchorRegions, stackGuidePlacements, stackGuidePlacementsByGap, stackGuideSvgGeometry } from './stack-guides-geometry'
import { overlayAuxiliaryLabelBandKey, placeOverlayAuxiliaryLabel, type LabelLaneOccupancy, type OverlayAuxiliaryLabelGeometry } from './auxiliary-label-layout'
import { resolveMultilineFormTextLayout } from './formTextLayout'
import { cutHeaderRenderItems } from './cutHeaderRenderItems'
import { SHEET_TEXT_FONT_FAMILY, sharedTextMeasurementProvider, type TextMeasurementProvider } from './textMetrics'
import { sheetTimingGridProjection, timingBlockRow } from './sheetTimingGridProjection'
import { sheetFrameRangeForWindow } from './sheetRenderWindowGeometry'

const MIN_CONTINUATION_SPAN_FRAMES = 4
const ACTION_VISIBLE_CONTINUATION_FRAMES = 3

export type SheetRenderModelGeometry = {
  template: SheetTemplate
  pages: SheetPage[]
  pageSize: { widthPx: number; heightPx: number; dpi?: number }
  width: number
  height: number
  displayFrameStart: number
  displayDurationFrames: number
  officialFrameEnd: number
  paperTracks: string[]
  timelineLanes: NonNullable<SheetTemplateLayoutResolveOptions['timelineLanes']>
  overlayTracks: PaperTrack[]
}

export type SheetRenderModelContext<Project extends SheetContentInput = SheetContentInput> = SheetRenderModelGeometry & {
  project: Project
  geometry: SheetRenderModelGeometry
  cutGroup?: SheetRenderCutGroupContext
  visibleKeyIds?: ReadonlySet<string>
}

export type SheetRenderCutGroupContext = {
  activeCutId: string
  cuts: ReadonlyArray<Pick<CutSheetDocument, 'cutId' | 'order' | 'metadata'>>
}

export type SheetInputTextRenderItem = {
  sheetRole?: SheetTimingRole
  eventId: string
  keyId: string
  paperTrack: string
  frame: number
  kind: TimelineEventValueKind
  text: string
  fontSizePx: number
  rect: NormalizedRect
  textLayout: TimingCellTextLayout
}

export type SheetContinuationRenderItem = {
  eventId: string
  paperTrack: string
  role: SheetTimingRole
  kind: 'straight' | 'wave'
  path: SheetContinuationPathCommand[]
  strokeWidth: number
}

export type SheetContinuationPathCommand =
  | { kind: 'move'; x: number; y: number }
  | { kind: 'line'; x: number; y: number }
  | { kind: 'cubic'; control1X: number; control1Y: number; control2X: number; control2Y: number; x: number; y: number }

export type SheetMetadataTextRenderItem = {
  regionId: string
  field: string
  text: string
  lines: string[]
  lineHeightPx: number
  rect: NormalizedRect
  clipRect: NormalizedRect
  x: number
  y: number
  textAnchor: 'start' | 'middle' | 'end'
  dominantBaseline: 'hanging' | 'central' | 'text-after-edge' | 'text-before-edge' | 'alphabetic'
  fontSizePx: number
  fontWeight: number
  overflow: boolean
}

export type FlagLabelGeometry = Pick<OverlayAuxiliaryLabelGeometry, 'glyphs'> & {
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

export type OverlayPaperTrackRenderItem = {
  track: PaperTrack
  column: OverlayBandSegment & { rect: NormalizedRect }
  label: OverlayAuxiliaryLabelGeometry
}

export type SheetWorkRangeShadeRenderItem = {
  regionId: string
  rect: NormalizedRect
}

export function createSheetRenderModelContext<Project extends SheetContentInput>(
  project: Project,
  template: SheetTemplate,
  options: { geometry?: SheetRenderModelGeometry; cutGroup?: SheetRenderCutGroupContext; visibleKeyIds?: ReadonlySet<string> } = {},
): SheetRenderModelContext<Project> {
  const geometry = options.geometry ?? createSheetRenderModelGeometry(project, template)
  return {
    ...geometry,
    project,
    geometry,
    cutGroup: options.cutGroup,
    visibleKeyIds: options.visibleKeyIds,
  }
}

export function createSheetRenderModelGeometry(
  project: SheetGeometryInput,
  template: SheetTemplate,
): SheetRenderModelGeometry {
  const displayFrameStart = logicalSheetDisplayFrameStart(project.logicalSheet)
  const layoutOptions = projectSheetLayoutOptions(project, template)
  const displayDurationFrames = layoutOptions.durationFrames ?? logicalSheetDisplayDurationFrames(project.logicalSheet)
  const officialFrameEnd = logicalSheetOfficialFrameEnd(project.logicalSheet)
  const pages = createSheetPages(template, displayDurationFrames, displayFrameStart)
  const paperTracks = layoutOptions.paperTracks ?? []
  const timelineLanes = layoutOptions.timelineLanes ?? {}
  const pageSize = resolveSheetTemplatePageSize(template, displayDurationFrames, layoutOptions)
  return {
    template,
    pages,
    pageSize,
    width: pageSize.widthPx,
    height: pageSize.heightPx * pages.length,
    displayFrameStart,
    displayDurationFrames,
    officialFrameEnd,
    paperTracks,
    timelineLanes,
    overlayTracks: overlayPaperTracks(project, template).filter(track => track.viewPlacement?.expanded !== false),
  }
}

export function hasOverlayRenderContent(context: SheetRenderModelContext): boolean {
  return context.overlayTracks.length > 0 || context.project.stackGuideLabels.some(label => stackGuideStackBand(label) === 'cell-interleave')
}

export function workRangeShadeRenderItemsForPage(
  context: SheetRenderModelContext,
  page: SheetPage,
): SheetWorkRangeShadeRenderItem[] {
  const viewLayout = getSheetViewLayout(context.template)
  const continuousFrameAxis = viewLayout.frameAxis?.type === 'continuous' || viewLayout.frameAxis?.type === 'infinite'
  const frameOrigin = continuousFrameAxis ? page.frameStart : context.template.defaults.frameOrigin
  const localFrameToGlobalFrame = (frame: number) => continuousFrameAxis
    ? frame
    : page.frameStart + (frame - context.template.defaults.frameOrigin)
  const globalFrameToLocalFrame = (frame: number) => continuousFrameAxis
    ? frame
    : frame - page.frameStart + context.template.defaults.frameOrigin
  const officialFrameStart = context.project.logicalSheet.frameOrigin

  return context.template.regions.flatMap(region => {
    if (!isTimelineProjectingSheetTemplateGridRegion(region)) return []
    const layout = resolveSheetTemplateGridLayout(context.template, region, {
      paperTracks: context.paperTracks,
      timelineLanes: context.timelineLanes,
      durationFrames: page.frameEnd - page.frameStart + 1,
      frameOrigin,
      layoutOverrides: context.project.sheetView.layoutOverrides,
    })
    if (!layout) return []
    const visibleFrameStart = localFrameToGlobalFrame(layout.frames.frameStart)
    const visibleFrameEnd = localFrameToGlobalFrame(layout.frames.frameEnd)
    const ranges = [
      { frameStart: visibleFrameStart, frameEnd: Math.min(visibleFrameEnd, officialFrameStart - 1) },
      { frameStart: Math.max(visibleFrameStart, context.officialFrameEnd + 1), frameEnd: visibleFrameEnd },
    ].filter(range => range.frameEnd >= range.frameStart)

    return ranges.flatMap(range => {
      const frameStart = Math.max(layout.frames.frameStart, globalFrameToLocalFrame(range.frameStart))
      const frameEnd = Math.min(layout.frames.frameEnd, globalFrameToLocalFrame(range.frameEnd))
      if (frameEnd < frameStart) return []
      return [{
        regionId: region.regionId,
        rect: {
          x: layout.rect.x,
          y: layout.rect.y + layout.frames.rowHeight * (frameStart - layout.frames.frameStart),
          w: layout.rect.w,
          h: layout.frames.rowHeight * (frameEnd - frameStart + 1),
        },
      }]
    })
  })
}

export function inputTextRenderItemsForPage(context: SheetRenderModelContext, page: SheetPage): SheetInputTextRenderItem[] {
  const keys = timingKeyIndex(context.project.logicalSheet.keys)
  const references = timingReferenceMap(context.project.logicalSheet.referenceMarks)
  return timingEventsInRange(context.project.logicalSheet.events, page.frameStart, page.frameEnd).flatMap(event => {
    if (context.visibleKeyIds && !isSpecialTimingEvent(event) && !context.visibleKeyIds.has(event.keyId)) return []
    const key = keys.get(event.keyId)
    if (!key && !isSpecialTimingEvent(event)) return []
    const sheetRole = sheetTimingRoleForEvent(event)
    const rect = eventRectForTrackFrame(context, sheetRole, event.paperTrack, event.frame, page)
    if (!rect) return []
    return [timingInputItem(context, event, event.frame, rect, key?.displayLabel ?? '', references.get(timingReferenceAddress(event)))]
  })
}

function timingInputItem(context: SheetRenderModelContext, event: TimelineEvent, frame: number, rect: NormalizedRect, label: string, enclosure?: 'triangle' | 'circle'): SheetInputTextRenderItem {
  const sheetRole = sheetTimingRoleForEvent(event), kind = timingEventValueKind(event)
  const text = kind === 'cell' ? label : ''
  const fontSizePx = resolveTimingTextFontSizePx(context.template, sheetRole, event.fontSizePx)
  return { eventId: event.eventId, sheetRole, keyId: event.keyId, paperTrack: event.paperTrack, frame, kind, text, fontSizePx, rect,
    textLayout: layoutTimingCellText(text, fontSizePx, defaultTimingTextMinFontSizePx(context.template, sheetRole), rect, context.pageSize,
      undefined, kind === 'cell' ? enclosure : false, event.fontSizeMode !== 'fixed', event.fontSizeMode === 'fit') }
}

/** Notation at a physical block head has no timing event or editing target of its own. */
export function paperCellCarryItemsForPage(context: SheetRenderModelContext, page: SheetPage): SheetInputTextRenderItem[] {
  if (!context.project.logicalSheet.events.length) return []
  const projection = sheetTimingGridProjection(context)
  if (!projection.repeatCells) return []
  const { events, keys } = context.project.logicalSheet
  const groups = timingEventIndex(events).groups, keyById = timingKeyIndex(keys)
  const items: SheetInputTextRenderItem[] = []
  for (const track of context.project.logicalSheet.paperTracks) {
    const trackEvents = groups.get(timingGroupKey('cell', track.paperTrack))
    if (!trackEvents?.length) continue
    for (const block of projection.blocks('cell', track.paperTrack, page)) {
      const frame = Math.max(page.frameStart, block.first)
      const index = timingFrameLowerBound(trackEvents, frame)
      if (index === 0 || trackEvents[index]?.frame === frame) continue
      const source = trackEvents[index - 1]!
      const kind = timingEventValueKind(source), key = keyById.get(source.keyId)
      if (kind !== 'blank' && (kind !== 'cell' || !key || context.visibleKeyIds && !context.visibleKeyIds.has(source.keyId))) continue
      items.push(timingInputItem(context, source, frame, timingBlockRow(block, frame), key?.displayLabel ?? ''))
    }
  }
  return items
}

export function referenceOnlyRenderItemsForPage(context: SheetRenderModelContext, page: SheetPage, frameRange?: { start: number; end: number }): SheetInputTextRenderItem[] {
  const occupied = new Set(timingEventsInRange(context.project.logicalSheet.events, page.frameStart, page.frameEnd).map(timingReferenceAddress))
  const start = Math.max(page.frameStart, frameRange?.start ?? page.frameStart)
  const end = Math.min(page.frameEnd, frameRange?.end ?? page.frameEnd)
  return (context.project.logicalSheet.referenceMarks ?? []).flatMap(mark => {
    if (mark.frame < start || mark.frame > end || occupied.has(timingReferenceAddress(mark))) return []
    const rect = eventRectForTrackFrame(context, mark.sheetRole, mark.paperTrack, mark.frame, page)
    if (!rect) return []
    const fontSizePx = resolveTimingTextFontSizePx(context.template, mark.sheetRole, undefined)
    return [{ eventId: `reference:${timingReferenceAddress(mark)}`, keyId: '', paperTrack: mark.paperTrack, frame: mark.frame, sheetRole: mark.sheetRole,
      kind: 'cell' as const, text: '', fontSizePx, rect,
      textLayout: layoutTimingCellText('', fontSizePx, defaultTimingTextMinFontSizePx(context.template, mark.sheetRole), rect, context.pageSize, undefined, mark.shape ?? 'triangle') }]
  })
}

export function continuationRenderItemsForPage(context: SheetRenderModelContext, page: SheetPage): SheetContinuationRenderItem[] {
  return continuationRenderItemsForPages(context, [page]).get(page.pageId) ?? []
}

// Geometry owns this projection cache. Immutable event identity and the next
// boundary cover both an edited event and its predecessor's changed hold.
const continuationProjections = new WeakMap<SheetRenderModelGeometry, WeakMap<TimelineEvent, Map<string, {
  signature: string; items: SheetContinuationRenderItem[]
}>>>()

export function continuationRenderItemsForPages(
  context: SheetRenderModelContext,
  pages: SheetPage[],
  renderWindow?: { top: number; bottom: number } | null,
): Map<string, SheetContinuationRenderItem[]> {
  const itemsByPage = new Map(pages.map(page => [page.pageId, [] as SheetContinuationRenderItem[]]))
  if (pages.length === 0 || context.project.logicalSheet.events.length === 0) return itemsByPage
  const displayFrameEnd = context.displayFrameStart + context.displayDurationFrames - 1

  const projection = sheetTimingGridProjection(context)
  const eventsByRoleAndTrack = timingEventIndex(context.project.logicalSheet.events).groups
  const frameRange = getSheetViewLayout(context.template).frameAxis?.type === 'paged' ? undefined : sheetFrameRangeForWindow(context, renderWindow ?? null)
  let projections = continuationProjections.get(context.geometry)
  if (!projections) { projections = new WeakMap(); continuationProjections.set(context.geometry, projections) }

  for (const role of ['action', 'cell'] as const) {
    if (!context.project.sheetView.continuationDisplay[role]) continue
    for (const { paperTrack } of context.project.logicalSheet.paperTracks) {
      const events = eventsByRoleAndTrack.get(timingGroupKey(role, paperTrack))
      if (!events?.length) continue
      for (const page of pages) {
        const blocks = projection.blocks(role, paperTrack, page)
        if (!blocks.length) continue
        const rangeStart = Math.max(page.frameStart, frameRange?.start ?? page.frameStart)
        const rangeEnd = Math.min(page.frameEnd, frameRange?.end ?? page.frameEnd)
        if (rangeStart > rangeEnd) continue
        const firstIndex = Math.max(0, timingFrameLowerBound(events, rangeStart) - 1)
        const after = timingFrameLowerBound(events, rangeEnd + 1)
        for (let index = firstIndex; index < after; index++) {
          const event = events[index]!
          if (context.visibleKeyIds && !isSpecialTimingEvent(event) && !context.visibleKeyIds.has(event.keyId)) continue
          const kind = timingEventValueKind(event)
          if (kind !== 'cell' && kind !== 'blank') continue
          const heldEnd = Math.min(displayFrameEnd, (events[index + 1]?.frame ?? displayFrameEnd + 1) - 1)
          const visibleEnd = visibleContinuationFrameEnd(role, event.frame, heldEnd)
          if (visibleEnd === null) continue
          const first = Math.max(event.frame + 1, page.frameStart), last = Math.min(visibleEnd, page.frameEnd)
          if (first > last) continue
          const signature = `${first}:${last}:${renderWindow?.top ?? ''}:${renderWindow?.bottom ?? ''}`
          let eventPages = projections.get(event)
          if (!eventPages) { eventPages = new Map(); projections.set(event, eventPages) }
          let cached = eventPages.get(page.pageId)
          if (cached?.signature !== signature) {
            const segments: Array<{ first: number; last: number; from: NormalizedRect; to: NormalizedRect; carry: boolean }> = []
            for (const block of blocks) {
              const head = Math.max(block.first, page.frameStart)
              const carry = role === 'cell' && projection.repeatCells && event.frame < head
              const start = Math.max(first, carry ? head + 1 : head), end = Math.min(last, block.last)
              if (start > end) continue
              const from = timingBlockRow(block, start), to = timingBlockRow(block, end)
              const previous = segments.at(-1)
              if (!carry && previous && previous.last + 1 === start && Math.abs(previous.to.x + previous.to.w / 2 - from.x - from.w / 2) < 0.00001) {
                previous.last = end
                previous.to = to
              } else segments.push({ first: start, last: end, from, to, carry })
            }
            const items = segments.flatMap(segment => continuationRenderItem(event.eventId, paperTrack, role, kind, segment.from, segment.to,
              segment.first === segment.last && (role === 'action' || segment.carry), renderWindow) ?? [])
            cached = { signature, items }
            eventPages.set(page.pageId, cached)
          }
          itemsByPage.get(page.pageId)!.push(...cached.items)
        }
      }
    }
  }
  return itemsByPage
}

export function sheetContinuationPathData(commands: SheetContinuationPathCommand[]): string {
  return commands.map(command => {
    const end = `${pathNumber(command.x)} ${pathNumber(command.y)}`
    if (command.kind === 'move') return `M ${end}`
    if (command.kind === 'line') return `L ${end}`
    return `C ${pathNumber(command.control1X)} ${pathNumber(command.control1Y)} ${pathNumber(command.control2X)} ${pathNumber(command.control2Y)} ${end}`
  }).join(' ')
}

export function metadataTextRenderItemsForPage(
  context: SheetRenderModelContext,
  page: SheetPage,
  measurement: TextMeasurementProvider = sharedTextMeasurementProvider,
): SheetMetadataTextRenderItem[] {
  const sharedLabels = sharedCutNumberLabels(context)
  const formFields = buildTemplateChromeRenderModel(
    context.template, context.paperTracks, context.displayDurationFrames,
    { timelineLanes: context.timelineLanes, layoutOverrides: context.project.sheetView.layoutOverrides },
  ).formFields
  const hasShared = sharedLabels.length > 0
  return [
    ...context.template.regions.flatMap(region => hasShared && region.binding?.target === 'cut-metadata' && region.binding.field === 'cut'
      ? [] : metadataTextRenderItemsForRegion(context, page, region, measurement)),
    ...formFieldTextRenderItems(context, page, hasShared ? formFields.filter(field => field.definition.builtinBinding?.field !== 'cut') : formFields, measurement),
    ...(hasShared ? cutHeaderRenderItems(context, sharedLabels, formFields, measurement) : []),
  ]
}

function formFieldTextRenderItems(
  context: SheetRenderModelContext,
  page: SheetPage,
  fields: TemplateFormFieldRenderModel[],
  measurement: TextMeasurementProvider,
): SheetMetadataTextRenderItem[] {
  return fields.flatMap(field => {
    const text = formFieldText(context, field, page)
    if (!text) return []
    const resolvedStyle = resolveSheetTemplateTextStyle(context.template, context.pageSize, field.textStyle, { fontWeight: 700 })
    const paddingPx = resolvedStyle.paddingPx
    const horizontalAlign = resolvedStyle.horizontalAlign
    const verticalAlign = resolvedStyle.verticalAlign
    const multilineLayout = field.definition.valueType === 'multiline'
      ? resolveMultilineFormTextLayout(text, field.rect, context.pageSize, resolvedStyle, measurement)
      : null
    const fontSizePx = multilineLayout?.fontSizePx ?? metadataFontSizePx(text, field.rect, context.pageSize, {
        fontSizePx: resolvedStyle.fontSizePx,
        minFontSizePx: resolvedStyle.minFontSizePx,
        paddingPx,
        shrinkToFit: resolvedStyle.shrinkToFit,
        fontWeight: resolvedStyle.fontWeight,
      }, measurement)
    const paddingX = paddingPx / context.pageSize.widthPx
    const paddingY = paddingPx / context.pageSize.heightPx
    const lineHeightPx = multilineLayout?.lineHeightPx ?? Math.max(fontSizePx, resolvedStyle.lineHeightPx)
    const lines = multilineLayout?.lines ?? [text]
    const multilineContentTop = multilineLayout
      ? verticalAlign === 'top'
        ? field.rect.y + paddingY
        : verticalAlign === 'bottom'
          ? field.rect.y + field.rect.h - paddingY - multilineLayout.contentHeightPx / context.pageSize.heightPx
          : field.rect.y + (field.rect.h - multilineLayout.contentHeightPx / context.pageSize.heightPx) / 2
      : null
    return [{
      regionId: field.key,
      field: field.definition.builtinBinding?.field ?? field.fieldId,
      text,
      lines,
      lineHeightPx,
      rect: field.rect,
      clipRect: metadataTextClipRect(field.rect, resolvedStyle.overflowX, resolvedStyle.overflowY),
      x: horizontalAlign === 'left' ? field.rect.x + paddingX : horizontalAlign === 'right' ? field.rect.x + field.rect.w - paddingX : field.rect.x + field.rect.w / 2,
      y: multilineLayout && multilineContentTop !== null
        ? multilineContentTop + Math.max(0, lineHeightPx - fontSizePx) / 2 / context.pageSize.heightPx
        : verticalAlign === 'top' ? field.rect.y + paddingY : verticalAlign === 'bottom' ? field.rect.y + field.rect.h - paddingY : field.rect.y + field.rect.h / 2,
      textAnchor: horizontalAlign === 'left' ? 'start' : horizontalAlign === 'right' ? 'end' : 'middle',
      dominantBaseline: multilineLayout
        ? 'text-before-edge'
        : verticalAlign === 'top' ? 'hanging' : verticalAlign === 'bottom' ? 'text-after-edge' : 'central',
      fontSizePx,
      fontWeight: resolvedStyle.fontWeight,
      overflow: multilineLayout?.overflow ?? false,
    }]
  })
}

function formFieldText(context: SheetRenderModelContext, field: TemplateFormFieldRenderModel, page: SheetPage): string {
  const builtin = field.definition.builtinBinding
  if (builtin) return metadataFieldText(context, page, builtin.field, builtin.customKey)
  if (field.sourceFieldIds?.length) {
    const values = sheetFormFieldsForScope(context.project.sheetFormData, field.definition.scope, page.pageId)
    const sum = field.sourceFieldIds.reduce((total, fieldId) => {
      const value = values[fieldId]
      return total + (value?.kind === 'number' && value.value !== null ? value.value : 0)
    }, 0)
    return sum === 0 ? '' : String(sum)
  }
  return sheetFormFieldValueText(resolveSheetFormFieldValue(
    context.project.sheetFormData,
    field.definition,
    page.pageId,
  ))
}

function metadataTextRenderItemsForRegion(
  context: SheetRenderModelContext,
  page: SheetPage,
  region: SheetTemplate['regions'][number],
  measurement: TextMeasurementProvider,
): SheetMetadataTextRenderItem[] {
    if (region.type !== 'metadata-field' || region.binding?.target !== 'cut-metadata' || !resolveSheetTemplateRegionCapabilities(region).rendered) return []
    const field = region.binding.field
    const text = metadataFieldText(context, page, field, region.binding.customKey)
    if (!text) return []
    const rect = resolveSheetTemplateRegionRect(
      context.template, region, context.displayDurationFrames,
      { paperTracks: context.paperTracks, timelineLanes: context.timelineLanes, layoutOverrides: context.project.sheetView.layoutOverrides },
    )
    const resolvedStyle = resolveSheetTemplateTextStyle(context.template, context.pageSize, region.textStyle, {
      fontSizePx: 22, minFontSizePx: 10, paddingPx: 8, fontWeight: 700,
    })
    const paddingPx = resolvedStyle.paddingPx
    const horizontalAlign = resolvedStyle.horizontalAlign
    const verticalAlign = resolvedStyle.verticalAlign
    const fontSizePx = metadataFontSizePx(text, rect, context.pageSize, {
      fontSizePx: resolvedStyle.fontSizePx, minFontSizePx: resolvedStyle.minFontSizePx, paddingPx,
      shrinkToFit: resolvedStyle.shrinkToFit, fontWeight: resolvedStyle.fontWeight,
    }, measurement)
    const lines = [text]
    const paddingX = paddingPx / context.pageSize.widthPx
    const paddingY = paddingPx / context.pageSize.heightPx
    return [{
      regionId: region.regionId,
      field,
      text,
      lines,
      lineHeightPx: Math.max(fontSizePx, resolvedStyle.lineHeightPx),
      rect,
      clipRect: metadataTextClipRect(rect, resolvedStyle.overflowX, resolvedStyle.overflowY),
      x: horizontalAlign === 'left' ? rect.x + paddingX : horizontalAlign === 'right' ? rect.x + rect.w - paddingX : rect.x + rect.w / 2,
      y: verticalAlign === 'top' ? rect.y + paddingY : verticalAlign === 'bottom' ? rect.y + rect.h - paddingY : rect.y + rect.h / 2,
      textAnchor: horizontalAlign === 'left' ? 'start' : horizontalAlign === 'right' ? 'end' : 'middle',
      dominantBaseline: verticalAlign === 'top' ? 'hanging' : verticalAlign === 'bottom' ? 'text-after-edge' : 'central',
      fontSizePx,
      fontWeight: resolvedStyle.fontWeight,
      overflow: metadataTextOverflows(lines, rect, context.pageSize, {
        fontSizePx,
        lineHeightPx: Math.max(fontSizePx, resolvedStyle.lineHeightPx),
        paddingPx,
        fontWeight: resolvedStyle.fontWeight,
      }, measurement),
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
  options: { fontSizePx: number; minFontSizePx: number; paddingPx: number; shrinkToFit: boolean; fontWeight: number },
  measurement: TextMeasurementProvider,
): number {
  const availableWidth = Math.max(1, rect.w * pageSize.widthPx - options.paddingPx * 2)
  const availableHeight = Math.max(1, rect.h * pageSize.heightPx - options.paddingPx * 2)
  const requested = Math.max(1, options.fontSizePx)
  const heightLimited = Math.min(requested, availableHeight)
  if (!options.shrinkToFit) return heightLimited
  const measuredWidth = measurement.measure(text, metadataFont(heightLimited, options.fontWeight)).widthPx
  const widthLimited = measuredWidth > 0 ? heightLimited * availableWidth / measuredWidth : heightLimited
  return Math.max(Math.min(options.minFontSizePx, heightLimited), Math.min(heightLimited, widthLimited))
}

function metadataFont(fontSizePx: number, fontWeight: number) {
  return {
    family: SHEET_TEXT_FONT_FAMILY,
    sizePx: fontSizePx,
    weight: fontWeight,
  }
}

function metadataTextClipRect(
  rect: NormalizedRect,
  overflowX: 'clip' | 'visible',
  overflowY: 'clip' | 'visible',
): NormalizedRect {
  return {
    x: overflowX === 'visible' ? 0 : rect.x,
    y: overflowY === 'visible' ? 0 : rect.y,
    w: overflowX === 'visible' ? 1 : rect.w,
    h: overflowY === 'visible' ? 1 : rect.h,
  }
}

function metadataTextOverflows(
  lines: string[],
  rect: NormalizedRect,
  pageSize: { widthPx: number; heightPx: number },
  options: { fontSizePx: number; lineHeightPx: number; paddingPx: number; fontWeight: number },
  measurement: TextMeasurementProvider,
): boolean {
  const availableWidthPx = Math.max(1, rect.w * pageSize.widthPx - options.paddingPx * 2)
  const availableHeightPx = Math.max(1, rect.h * pageSize.heightPx - options.paddingPx * 2)
  const font = metadataFont(options.fontSizePx, options.fontWeight)
  const contentWidthPx = lines.reduce(
    (widest, line) => Math.max(widest, measurement.measure(line, font).widthPx),
    0,
  )
  const contentHeightPx = lines.length === 0
    ? 0
    : options.fontSizePx + (lines.length - 1) * options.lineHeightPx
  return contentWidthPx > availableWidthPx + 0.01 || contentHeightPx > availableHeightPx + 0.01
}

export function overlayPaperTrackRenderItems(context: SheetRenderModelContext, page: SheetPage, tracks = context.overlayTracks): OverlayPaperTrackRenderItem[] {
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
          timelineLanes: context.timelineLanes,
          durationFrames: context.displayDurationFrames,
          layoutOverrides: context.project.sheetView.layoutOverrides,
        })
        if (!layout || layout.columns.length === 0) return []
        const rect = layout.rect
        const columns = layout.columns
        const slots = overlayBandSegmentForRegion(context.template, context.project, anchorRegion.grid?.role as SheetTimingRole, anchorRegion.regionId)?.slots ?? []
        const labelsForRegion = context.project.stackGuideLabels.filter(label =>
          (label.displayRole ?? 'action') === anchorRegion.grid?.role
          && stackGuideStackBand(label) === 'cell-interleave',
        )
        return stackGuidePlacements(context.template, context.project, labelsForRegion, rect, context.pageSize, columns, slots, anchorRegion.regionId).map(({ label, lane }) => {
          const geometry = stackGuideSvgGeometry(context.template, rect, context.pageSize, label, lane, columns, slots, anchorRegion.regionId)
          return {
            leftPx: geometry.labelX * context.pageSize.widthPx,
            rightPx: (geometry.labelX + geometry.labelWidth) * context.pageSize.widthPx,
            top: geometry.labelY,
            bottom: geometry.labelBottomY,
          }
        })
      })
    occupiedByRegion.set(bandKey, occupied)
    return occupied
  }

  return tracks.flatMap(track => overlayColumnsForPage(context.template, context.project, track, page).flatMap(column => {
    const region = context.template.regions.find(item => item.regionId === column.regionId)
    if (!region?.grid) return []
    const layout = resolveSheetTemplateGridLayout(context.template, region, {
      paperTracks: context.paperTracks,
      timelineLanes: context.timelineLanes,
      durationFrames: context.displayDurationFrames,
      layoutOverrides: context.project.sheetView.layoutOverrides,
    })
    if (!layout || layout.columns.length === 0) return []
    const rect = layout.rect
    const occupied = occupiedLanesForRegion(region)
    const label = placeOverlayAuxiliaryLabel(context.template, rect, context.pageSize, track, column, occupied, STACK_GUIDE_MAX_LANE)
    return [{ track, column, label }]
  }))
}

export function stackGuideFlagRenderItemsForPage(context: SheetRenderModelContext, page: SheetPage): StackGuideFlagRenderItem[] {
  return stackGuideAnchorRegions(context.template, page, context.project.logicalSheet.frameOrigin).flatMap(region => {
    const displayRole = region.grid?.role as SheetTimingRole
    const layout = resolveSheetTemplateGridLayout(context.template, region, {
      paperTracks: context.paperTracks,
      timelineLanes: context.timelineLanes,
      durationFrames: context.displayDurationFrames,
      layoutOverrides: context.project.sheetView.layoutOverrides,
    })
    if (!layout || layout.columns.length === 0) return []
    const columns = layout.columns
    const rect = layout.rect
    const slots = overlayBandSegmentForRegion(context.template, context.project, displayRole, region.regionId)?.slots ?? []
    const labelsForRegion = context.project.stackGuideLabels.filter(label =>
      (label.displayRole ?? 'action') === displayRole
      && stackGuideStackBand(label) === 'cell-interleave',
    )
    const placementsByGap = stackGuidePlacementsByGap(context.template, context.project, labelsForRegion, rect, context.pageSize, columns, slots, region.regionId)
    return [...placementsByGap.values()].flatMap(placements =>
      placements.map(({ label, lane }) => ({
        label: label.label,
        geometry: stackGuideSvgGeometry(context.template, rect, context.pageSize, label, lane, columns, slots, region.regionId),
        color: '#315bdc',
        align: 'start' as const,
      })),
    )
  })
}

function eventRectForTrackFrame(
  context: SheetRenderModelContext,
  role: SheetTimingRole,
  paperTrack: string,
  frame: number,
  page: SheetPage,
): NormalizedRect | null {
  const track = context.project.logicalSheet.paperTracks.find(item => item.paperTrack === paperTrack)
  if (track && paperTrackDisplayRole(track) === role && context.overlayTracks.some(candidate => candidate.paperTrack === track.paperTrack)) {
    const column = overlayColumnAtFrame(overlayColumnsForPage(context.template, context.project, track, page), frame)
    return column && frame >= page.frameStart && frame <= page.frameEnd ? overlayCellRect(column, frame) : null
  }
  const hit = timingHitForFrame(
    context.template,
    role,
    paperTrack,
    frame,
    context.displayDurationFrames,
    context.displayFrameStart,
    context.paperTracks,
  )
  if (!hit || hit.pageId !== page.pageId) return null
  return cellRectForHit(context.template, hit, context.displayDurationFrames, context.displayFrameStart, {
    paperTracks: context.paperTracks,
    timelineLanes: context.timelineLanes,
    layoutOverrides: context.project.sheetView.layoutOverrides,
  })
}

function visibleContinuationFrameEnd(
  role: 'action' | 'cell',
  eventFrame: number,
  heldFrameEnd: number,
): number | null {
  if (heldFrameEnd - eventFrame + 1 < MIN_CONTINUATION_SPAN_FRAMES) return null
  return role === 'action'
    ? Math.min(heldFrameEnd, eventFrame + ACTION_VISIBLE_CONTINUATION_FRAMES)
    : heldFrameEnd
}

function continuationRenderItem(
  eventId: string,
  paperTrack: string,
  role: 'action' | 'cell',
  valueKind: ReturnType<typeof timingEventValueKind>,
  first: NormalizedRect,
  last: NormalizedRect,
  isolatedFrame: boolean,
  renderWindow?: { top: number; bottom: number } | null,
): SheetContinuationRenderItem | null {
  const centerX = first.x + first.w / 2
  const startY = first.y + first.h * (isolatedFrame ? 0.25 : 0.5)
  const endY = last.y + last.h * (isolatedFrame ? 0.75 : 0.5)
  if (renderWindow && (endY < renderWindow.top || startY > renderWindow.bottom)) return null
  const cellSize = Math.min(first.w, first.h)
  const strokeWidth = Math.max(0.00045, Math.min(0.0015, cellSize * 0.075))
  const path = valueKind === 'blank'
    ? waveContinuationPath(centerX, startY, endY, first.w, first.h, renderWindow)
    : [
        { kind: 'move' as const, x: centerX, y: startY },
        { kind: 'line' as const, x: centerX, y: endY },
      ]
  return {
    eventId,
    paperTrack,
    role,
    kind: valueKind === 'blank' ? 'wave' : 'straight',
    path,
    strokeWidth,
  }
}

function waveContinuationPath(centerX: number, startY: number, endY: number, cellWidth: number, cellHeight: number, renderWindow?: { top: number; bottom: number } | null): SheetContinuationPathCommand[] {
  const commands: SheetContinuationPathCommand[] = [{ kind: 'move', x: centerX, y: startY }]
  if (endY <= startY) return commands
  const amplitude = Math.min(cellWidth * 0.16, cellHeight * 0.28)
  const targetWavelength = Math.max(cellHeight * 0.9, 0.0001)
  const cycleCount = Math.max(1, Math.round((endY - startY) / targetWavelength))
  const halfWaveCount = cycleCount * 2
  const halfWaveHeight = (endY - startY) / halfWaveCount
  const first = renderWindow ? Math.max(0, Math.floor((renderWindow.top - startY) / halfWaveHeight) - 1) : 0
  const after = renderWindow ? Math.min(halfWaveCount, Math.ceil((renderWindow.bottom - startY) / halfWaveHeight) + 1) : halfWaveCount
  commands[0] = { kind: 'move', x: centerX, y: startY + halfWaveHeight * first }
  // A cubic with control X at 4/3 amplitude closely approximates a sine half-wave
  // while keeping Y linear. Alternating the sign also keeps the tangent continuous.
  const controlAmplitude = amplitude * (4 / 3)
  for (let index = first; index < after; index += 1) {
    const y = startY + halfWaveHeight * index
    const sign = index % 2 === 0 ? 1 : -1
    commands.push({
      kind: 'cubic',
      control1X: centerX + sign * controlAmplitude,
      control1Y: y + halfWaveHeight / 3,
      control2X: centerX + sign * controlAmplitude,
      control2Y: y + halfWaveHeight * 2 / 3,
      x: centerX,
      y: y + halfWaveHeight,
    })
  }
  return commands
}

function pathNumber(value: number): string {
  return String(Number(value.toFixed(7)))
}
