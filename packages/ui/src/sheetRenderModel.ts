import {
  cellRectForHit,
  createSheetPages,
  formatSheetTemplateCutNumber,
  getSheetViewLayout,
  getSheetTemplateHiddenPaperTracks,
  localizeFrameToSheetPage,
  logicalSheetDisplayDurationFrames,
  logicalSheetDisplayFrameStart,
  logicalSheetOfficialFrameEnd,
  isSpecialTimingEvent,
  resolveSheetTemplateGridLayout,
  resolveSheetTemplatePageSize,
  resolveSheetTemplateRegionRect,
  resolveSheetTemplateTextStyle,
  sheetTemplateLengthForReferencePx,
  sheetFormFieldsForScope,
  sheetFormFieldValueText,
  sheetTimingRoleForEvent,
  timingEventValueKind,
  stackGuideStackBand,
  timingHitForFrame,
  timelineLanesForLayout,
  type CutProject,
  type CutSheetDocument,
  type NormalizedRect,
  type PaperTrack,
  type SheetPage,
  type SheetTemplate,
  type SheetTimingRole,
  type TimelineEventValueKind,
} from '@xsheet-remap/core'
import { buildTemplateChromeRenderModel, type TemplateFormFieldRenderModel } from './templateEditorGeometry'
import { overlayBandSegments as buildOverlayBandSegments, overlayVisibleSnapIndex, type OverlayBandSegment } from './app-sheet-geometry'
import { resolveTimingTextFontSizePx } from './sheetTextLayout'
import { STACK_GUIDE_MAX_LANE, overlayBandSegmentForRegion, stackGuideAnchorRegions, stackGuidePlacements, stackGuidePlacementsByGap, stackGuideSvgGeometry } from './stack-guides-geometry'
import { auxiliaryLabelRangePx, auxiliaryLabelRangesOverlap, overlayAuxiliaryLabelBandKey, overlayAuxiliaryLabelGeometry, type OverlayAuxiliaryLabelGeometry } from './auxiliary-label-layout'
import { resolveMultilineFormTextLayout } from './formTextLayout'
import { SHEET_TEXT_FONT_FAMILY, sharedTextMeasurementProvider, type TextMeasurementProvider } from './textMetrics'

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
  timelineLanes: ReturnType<typeof timelineLanesForLayout>
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
  kind: TimelineEventValueKind
  text: string
  fontSizePx: number
  rect: NormalizedRect
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
  dominantBaseline: 'hanging' | 'central' | 'text-after-edge' | 'text-before-edge'
  fontSizePx: number
  fontWeight: number
  overflow: boolean
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

export type OverlayPaperTrackRenderItem = {
  track: PaperTrack
  column: OverlayBandSegment & { rect: NormalizedRect }
  label: OverlayAuxiliaryLabelGeometry
}

export type SheetWorkRangeShadeRenderItem = {
  regionId: string
  rect: NormalizedRect
}

type LabelLaneOccupancy = {
  leftPx: number
  rightPx: number
  lane: number
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
  const paperTracks = templatePaperTracks(project, template).map(track => track.paperTrack)
  const timelineLanes = timelineLanesForLayout(project)
  const pageSize = resolveSheetTemplatePageSize(template, displayDurationFrames, {
    paperTracks,
    timelineLanes,
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
    timelineLanes,
    overlayTracks: overlayPaperTracks(project, template),
    cutGroup: options.cutGroup,
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
    if (region.type !== 'exposure-grid' || !region.grid) return []
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
  return context.project.logicalSheet.events.flatMap(event => {
    const key = context.project.logicalSheet.keys.find(key => key.keyId === event.keyId)
    if (!key && !isSpecialTimingEvent(event)) return []
    const sheetRole = sheetTimingRoleForEvent(event)
    const kind = timingEventValueKind(event)
    const track = context.project.logicalSheet.paperTracks.find(item => item.paperTrack === event.paperTrack)
    const rect = track && context.overlayTracks.some(candidate => candidate.paperTrack === track.paperTrack)
      ? overlayCellRectForFrame(context, track, event.frame, page)
      : standardEventRectForPage(context, event, page)
    if (!rect) return []
    return [{
      eventId: event.eventId,
      keyId: event.keyId,
      paperTrack: event.paperTrack,
      frame: event.frame,
      kind,
      text: kind === 'cell' ? key?.displayLabel ?? '' : '',
      fontSizePx: resolveTimingTextFontSizePx(context.template, sheetRole, event.fontSizePx),
      rect,
    }]
  })
}

export function continuationRenderItemsForPage(context: SheetRenderModelContext, page: SheetPage): SheetContinuationRenderItem[] {
  const items: SheetContinuationRenderItem[] = []
  for (const role of ['action', 'cell'] as const) {
    if (!context.project.sheetView.continuationDisplay[role]) continue
    for (const paperTrack of context.project.logicalSheet.paperTracks.map(track => track.paperTrack)) {
      const events = context.project.logicalSheet.events
        .filter(event => event.paperTrack === paperTrack && sheetTimingRoleForEvent(event) === role)
        .sort((left, right) => left.frame - right.frame)
      for (let index = 0; index < events.length; index += 1) {
        const event = events[index]!
        const valueKind = timingEventValueKind(event)
        if (valueKind === 'inbetween' || valueKind === 'reverse') continue
        const nextFrame = events[index + 1]?.frame ?? context.officialFrameEnd + 1
        const frameEnd = Math.min(context.officialFrameEnd, nextFrame - 1)
        if (frameEnd - event.frame + 1 < 4) continue
        const rects: Array<{ frame: number; rect: NormalizedRect }> = []
        for (let frame = event.frame + 1; frame <= frameEnd; frame += 1) {
          const rect = eventRectForTrackFrame(context, role, paperTrack, frame, page)
          if (rect) rects.push({ frame, rect })
        }
        for (const segment of contiguousContinuationSegments(rects)) {
          const first = segment[0]?.rect
          const last = segment.at(-1)?.rect
          if (!first || !last) continue
          const centerX = first.x + first.w / 2
          const startY = first.y + first.h / 2
          const endY = last.y + last.h / 2
          const cellSize = Math.min(first.w, first.h)
          const strokeWidth = Math.max(0.00045, Math.min(0.0015, cellSize * 0.075))
          const path = valueKind === 'blank'
            ? waveContinuationPath(centerX, startY, endY, first.w, first.h)
            : [
                { kind: 'move' as const, x: centerX, y: startY },
                { kind: 'line' as const, x: centerX, y: endY },
              ]
          items.push({
            eventId: event.eventId,
            paperTrack,
            role,
            kind: valueKind === 'blank' ? 'wave' : 'straight',
            path,
            strokeWidth,
          })
        }
      }
    }
  }
  return items
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
  const sharedCutNumbersVisible = sharedLabels.length > 0
  const explicitSharedCutRegion = context.template.regions.some(region =>
    region.type === 'metadata-field'
    && region.usage !== 'ignored'
    && region.binding?.target === 'cut-group'
    && region.binding.field === 'shared-cut-numbers',
  )
  const items = [
    ...context.template.regions.flatMap(region => metadataTextRenderItemsForRegion(
    context,
    page,
    region,
    sharedLabels,
    sharedCutNumbersVisible,
    undefined,
    measurement,
    )),
    ...formFieldTextRenderItems(context, page, sharedCutNumbersVisible, measurement),
  ]
  if (!sharedCutNumbersVisible || explicitSharedCutRegion) return items

  const cutRegion = context.template.regions.find(region =>
    region.type === 'metadata-field'
    && region.usage !== 'ignored'
    && region.binding?.target === 'cut-metadata'
    && region.binding.field === 'cut',
  )
  const cutFormField = buildTemplateChromeRenderModel(
    context.template,
    context.paperTracks,
    context.displayDurationFrames,
    { layoutOverrides: context.project.sheetView.layoutOverrides },
  ).formFields.find(field => field.definition.builtinBinding?.field === 'cut')
  if (!cutRegion && !cutFormField) return items
  const cutRect = cutRegion
    ? resolveSheetTemplateRegionRect(
        context.template,
        cutRegion,
        context.displayDurationFrames,
        { paperTracks: context.paperTracks, timelineLanes: context.timelineLanes, layoutOverrides: context.project.sheetView.layoutOverrides },
      )
    : cutFormField!.rect
  const fallbackRegion: SheetTemplate['regions'][number] = {
    regionId: `${cutRegion?.regionId ?? cutFormField!.key}__shared_cut_numbers`,
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
      fontSize: sheetTemplateLengthForReferencePx(context.template, 12),
      minFontSize: sheetTemplateLengthForReferencePx(context.template, 7),
      lineHeight: sheetTemplateLengthForReferencePx(context.template, 14),
      fontWeight: 700,
      horizontalAlign: 'center',
      verticalAlign: 'top',
      padding: sheetTemplateLengthForReferencePx(context.template, 2, 'spacing'),
      shrinkToFit: true,
      overflowY: 'visible',
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
      measurement,
    ),
  ]
}

function formFieldTextRenderItems(
  context: SheetRenderModelContext,
  page: SheetPage,
  sharedCutNumbersVisible: boolean,
  measurement: TextMeasurementProvider,
): SheetMetadataTextRenderItem[] {
  const chrome = buildTemplateChromeRenderModel(
    context.template,
    context.paperTracks,
    context.displayDurationFrames,
    { layoutOverrides: context.project.sheetView.layoutOverrides },
  )
  return chrome.formFields.flatMap(field => {
    const text = formFieldText(context, field, page)
    if (!text) return []
    const style = field.definition.builtinBinding?.field === 'cut' && sharedCutNumbersVisible
      ? {
          ...field.textStyle,
          verticalAlign: 'top' as const,
          padding: sheetTemplateLengthForReferencePx(context.template, 4, 'spacing'),
        }
      : field.textStyle
    const resolvedStyle = resolveSheetTemplateTextStyle(context.template, context.pageSize, style, { fontWeight: 700 })
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
  const values = sheetFormFieldsForScope(context.project.sheetFormData, field.definition.scope, page.pageId)
  if (field.sourceFieldIds?.length) {
    const sum = field.sourceFieldIds.reduce((total, fieldId) => {
      const value = values[fieldId]
      return total + (value?.kind === 'number' && value.value !== null ? value.value : 0)
    }, 0)
    return sum === 0 ? '' : String(sum)
  }
  return sheetFormFieldValueText(values[field.fieldId])
}

function metadataTextRenderItemsForRegion(
  context: SheetRenderModelContext,
  page: SheetPage,
  region: SheetTemplate['regions'][number],
  sharedLabels: string[],
  sharedCutNumbersVisible: boolean,
  resolvedRect?: NormalizedRect,
  measurement: TextMeasurementProvider = sharedTextMeasurementProvider,
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
      { paperTracks: context.paperTracks, timelineLanes: context.timelineLanes, layoutOverrides: context.project.sheetView.layoutOverrides },
    )
    const sharedCutNumberCutStyle = sharedCutNumbersVisible
      && region.binding.target === 'cut-metadata'
      && region.binding.field === 'cut'
      ? region.textStyleVariants?.sharedCutNumbersVisible ?? {
          verticalAlign: 'top' as const,
          padding: sheetTemplateLengthForReferencePx(context.template, 5, 'spacing'),
        }
      : {}
    const style = {
      ...(region.textStyle ?? {}),
      ...sharedCutNumberCutStyle,
    }
    const resolvedStyle = resolveSheetTemplateTextStyle(context.template, context.pageSize, style, {
      fontSizePx: isSharedCutNumbers ? 12 : 22,
      minFontSizePx: isSharedCutNumbers ? 7 : 10,
      paddingPx: 8,
      fontWeight: 700,
    })
    const paddingPx = resolvedStyle.paddingPx
    const horizontalAlign = resolvedStyle.horizontalAlign
    const verticalAlign = resolvedStyle.verticalAlign
    const fontSizePx = isSharedCutNumbers
      ? sharedCutNumbersFontSizePx(sharedLabels, rect, context.pageSize, {
          fontSizePx: resolvedStyle.fontSizePx,
          minFontSizePx: resolvedStyle.minFontSizePx,
          paddingPx,
          shrinkToFit: resolvedStyle.shrinkToFit,
          opening,
          closing,
          fontWeight: resolvedStyle.fontWeight,
        }, measurement)
      : metadataFontSizePx(text, rect, context.pageSize, {
      fontSizePx: resolvedStyle.fontSizePx,
      minFontSizePx: resolvedStyle.minFontSizePx,
      paddingPx,
      shrinkToFit: resolvedStyle.shrinkToFit,
      fontWeight: resolvedStyle.fontWeight,
    }, measurement)
    const lines = isSharedCutNumbers
      ? wrapSharedCutNumberLines(sharedLabels, {
          availableWidthPx: Math.max(1, rect.w * context.pageSize.widthPx - paddingPx * 2),
          fontSizePx,
          opening,
          closing,
          separator,
          fontWeight: resolvedStyle.fontWeight,
        }, measurement)
      : [text]
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
    fontWeight: number
  },
  measurement: TextMeasurementProvider,
): number {
  const availableWidth = Math.max(1, rect.w * pageSize.widthPx - options.paddingPx * 2)
  const availableHeight = Math.max(1, rect.h * pageSize.heightPx - options.paddingPx * 2)
  const requested = Math.max(1, options.fontSizePx)
  const heightLimited = Math.min(requested, availableHeight)
  if (!options.shrinkToFit) return heightLimited
  const font = metadataFont(heightLimited, options.fontWeight)
  const widestAtomicWidth = labels.reduce(
    (widest, label) => Math.max(widest, measurement.measure(`${options.opening}${label}${options.closing}`, font).widthPx),
    0,
  )
  const widthLimited = widestAtomicWidth > 0 ? heightLimited * availableWidth / widestAtomicWidth : heightLimited
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
    fontWeight: number
  },
  measurement: TextMeasurementProvider,
): string[] {
  if (labels.length === 0) return []
  const groups: string[][] = []
  let current: string[] = []
  for (let index = 0; index < labels.length; index += 1) {
    const candidate = [...current, labels[index]]
    const candidateText = `${groups.length === 0 ? options.opening : ''}${candidate.join(options.separator)}${index === labels.length - 1 ? options.closing : ''}`
    const candidateWidthPx = measurement.measure(candidateText, metadataFont(options.fontSizePx, options.fontWeight)).widthPx
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
            lane,
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
      timelineLanes: context.timelineLanes,
      durationFrames: context.displayDurationFrames,
      layoutOverrides: context.project.sheetView.layoutOverrides,
    })
    if (!layout || layout.columns.length === 0) return []
    const rect = layout.rect
    const occupied = occupiedLanesForRegion(region)
    let lane = 0
    let label = overlayAuxiliaryLabelGeometry(context.template, rect, context.pageSize, track, column, lane, STACK_GUIDE_MAX_LANE)
    while (
      lane < STACK_GUIDE_MAX_LANE
      && occupied.some(candidate => candidate.lane === lane && auxiliaryLabelRangesOverlap(auxiliaryLabelRangePx(label, context.pageSize.widthPx), candidate))
    ) {
      lane += 1
      label = overlayAuxiliaryLabelGeometry(context.template, rect, context.pageSize, track, column, lane, STACK_GUIDE_MAX_LANE)
    }
    occupied.push({ ...auxiliaryLabelRangePx(label, context.pageSize.widthPx), lane })
    return [{ track, column, label }]
  })
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

function templatePaperTracks(project: CutProject, template: SheetTemplate): PaperTrack[] {
  const showAllLogicalTracks = getSheetViewLayout(template).trackAxis?.type === 'logical-width'
  return project.logicalSheet.paperTracks
    .filter(track => showAllLogicalTracks || track.source !== 'overlay')
    .sort((a, b) => a.order - b.order)
}

function overlayPaperTracks(project: CutProject, template: SheetTemplate): PaperTrack[] {
  if (getSheetViewLayout(template).trackAxis?.type === 'logical-width') return []
  const ordered = [...project.logicalSheet.paperTracks].sort((a, b) => a.order - b.order)
  const hidden = new Set(getSheetTemplateHiddenPaperTracks(template, 'cell', ordered.filter(track => track.source !== 'overlay').map(track => track.paperTrack)))
  return ordered.flatMap(track => {
    if (track.source === 'overlay') return track.viewPlacement?.expanded === false ? [] : [track]
    if (!hidden.has(track.paperTrack)) return []
    return [{
      ...track,
      viewPlacement: {
        ...track.viewPlacement,
        templateId: template.templateId,
        sheetRole: 'cell' as const,
        snapIndex: Number.MAX_SAFE_INTEGER,
      },
    }]
  })
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
  const snapIndex = overlayVisibleSnapIndex(context.template, context.project, track, segment)
  const slot = segment.slots[snapIndex]
  if (!slot) return null
  return {
    ...segment,
    rect: {
      x: slot.x,
      y: segment.rect.y,
      w: slot.w,
      h: segment.rect.h,
    },
  }
}

function overlayBandSegments(context: SheetRenderModelContext, role: SheetTimingRole): OverlayBandSegment[] {
  return buildOverlayBandSegments(context.template, context.project, role)
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
    timelineLanes: context.timelineLanes,
    layoutOverrides: context.project.sheetView.layoutOverrides,
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
  if (track && context.overlayTracks.some(candidate => candidate.paperTrack === track.paperTrack)) return overlayCellRectForFrame(context, track, frame, page)
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

function contiguousContinuationSegments(items: Array<{ frame: number; rect: NormalizedRect }>): Array<Array<{ frame: number; rect: NormalizedRect }>> {
  const segments: Array<Array<{ frame: number; rect: NormalizedRect }>> = []
  for (const item of items) {
    const current = segments.at(-1)
    const previous = current?.at(-1)
    const sameColumn = previous && Math.abs((previous.rect.x + previous.rect.w / 2) - (item.rect.x + item.rect.w / 2)) < 0.00001
    if (!previous || item.frame !== previous.frame + 1 || !sameColumn) {
      segments.push([item])
    } else if (current) {
      current.push(item)
    }
  }
  return segments
}

function waveContinuationPath(centerX: number, startY: number, endY: number, cellWidth: number, cellHeight: number): SheetContinuationPathCommand[] {
  const commands: SheetContinuationPathCommand[] = [{ kind: 'move', x: centerX, y: startY }]
  if (endY <= startY) return commands
  const amplitude = Math.min(cellWidth * 0.16, cellHeight * 0.28)
  const targetWavelength = Math.max(cellHeight * 0.9, 0.0001)
  const cycleCount = Math.max(1, Math.round((endY - startY) / targetWavelength))
  const halfWaveCount = cycleCount * 2
  const halfWaveHeight = (endY - startY) / halfWaveCount
  // A cubic with control X at 4/3 amplitude closely approximates a sine half-wave
  // while keeping Y linear. Alternating the sign also keeps the tangent continuous.
  const controlAmplitude = amplitude * (4 / 3)
  for (let index = 0; index < halfWaveCount; index += 1) {
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

function frameOriginForPage(template: SheetTemplate, page: SheetPage): number {
  const layout = getSheetViewLayout(template)
  return layout.frameAxis?.type === 'continuous' || layout.frameAxis?.type === 'infinite'
    ? page.frameStart
    : template.defaults.frameOrigin
}
