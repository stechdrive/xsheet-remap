import { type CutProject, type NormalizedRect, type SheetPage, type SheetTemplate, type SheetTimingRole, type StackGuideLabel, resolveSheetTemplateGridFrames, stackGuideGapIndex } from '@xsheet-remap/core'
import { STANDARD_A3_GRID_HEADER_HEIGHT, STANDARD_A3_GRID_HEADER_TOP_OFFSET } from './sheetConstants'
import { templateGridHeaderFontSizePx } from './templateEditorGeometry'
import { clampNumber } from './sheetInteraction'
import { compareStackGuideLabelsForUi } from './app-foundation'
import { overlayBandSegments } from './app-sheet-geometry'

export function overlayBandSegmentForRegion(template: SheetTemplate, project: CutProject, role: SheetTimingRole, regionId: string) {
  return overlayBandSegments(template, project, role).find(segment => segment.regionId === regionId) ?? null
}

export function stackGuideGapIndexFromSnapIndex(snapIndex: number, columnCount: number): number {
  return clampNumber(Math.round(snapIndex) - 1, 0, columnCount)
}

export function stackGuideInsertAfterPaperTrackFromGap(columns: Array<{ paperTrack?: string }>, gapIndex: number): string | undefined {
  return gapIndex > 0 ? columns[gapIndex - 1]?.paperTrack : undefined
}

export function stackGuideVisibleSnapIndex(label: StackGuideLabel, columns: Array<{ paperTrack?: string }>): number {
  if (Number.isFinite(label.viewSnapIndex)) return clampNumber(Math.round(label.viewSnapIndex as number), 0, Number.MAX_SAFE_INTEGER)
  if (label.insertAfterPaperTrack) {
    const trackIndex = columns.findIndex(column => column.paperTrack === label.insertAfterPaperTrack)
    if (trackIndex >= 0) return trackIndex + 2
  }
  return clampNumber(Math.round(label.gapIndex) + 1, 0, columns.length + 1)
}

const STACK_GUIDE_EDITOR_BASE_HEIGHT_PX = 24

const STACK_GUIDE_EDITOR_LANE_HEIGHT_PX = 20

export const STACK_GUIDE_MAX_LANE = 8

const STACK_GUIDE_EDITOR_WIDTH_PX = 148

const STACK_GUIDE_EDITOR_FORM_HEIGHT_PX = 36

const STACK_GUIDE_EDITOR_EDGE_MARGIN_PX = 8

const DEFAULT_STACK_GUIDE_LABEL_BASE_OFFSET_PX = 28

const DEFAULT_STACK_GUIDE_LABEL_LANE_PITCH_PX = 20

const DEFAULT_STACK_GUIDE_LABEL_HEIGHT_PX = 14

const DEFAULT_STACK_GUIDE_LABEL_MIN_WIDTH_PX = 22

const DEFAULT_STACK_GUIDE_LABEL_MAX_WIDTH_PX = 76

const DEFAULT_STACK_GUIDE_LABEL_FONT_SIZE_PX = 10.5

const DEFAULT_STACK_GUIDE_LABEL_PAGE_MARGIN_PX = 6

const DEFAULT_STACK_GUIDE_LABEL_POLE_GAP_PX = 2

const DEFAULT_STACK_GUIDE_LABEL_TEXT_PADDING_PX = 3

const DEFAULT_STACK_GUIDE_LABEL_CONNECTOR_STROKE_PX = 4

const DEFAULT_STACK_GUIDE_LABEL_CHAR_WIDTH_PX = 6

const DEFAULT_STACK_GUIDE_LABEL_RADIUS_PX = 2

const DEFAULT_STACK_GUIDE_LABEL_EXTRA_WIDTH_PX = 3

export const OVERLAY_PAPER_TRACK_TOOLTIP_DELAY_MS = 650

export interface StackGuideLabelMetrics {
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

interface StackGuidePlacement {
  label: StackGuideLabel
  gapIndex: number
  widthInGaps: number
  lane: number
}

export function stackGuidePlacementsByGap(template: SheetTemplate, project: CutProject, labels: StackGuideLabel[], gapWidthPx: number, columns?: Array<{ paperTrack?: string }>) {
  const placements = stackGuidePlacements(template, project, labels, gapWidthPx, columns)
  const byGap = new Map<number, StackGuidePlacement[]>()
  for (const placement of placements) {
    const gapPlacements = byGap.get(placement.gapIndex) ?? []
    gapPlacements.push(placement)
    byGap.set(placement.gapIndex, gapPlacements)
  }
  for (const gapPlacements of byGap.values()) {
    gapPlacements.sort((a, b) => a.lane - b.lane || compareStackGuideLabelsForUi(project)(a.label, b.label))
  }
  return byGap
}

export function stackGuidePlacements(template: SheetTemplate, project: CutProject, labels: StackGuideLabel[], gapWidthPx: number, columns?: Array<{ paperTrack?: string }>): StackGuidePlacement[] {
  const placed: StackGuidePlacement[] = []
  for (const label of [...labels].sort(compareStackGuidePlacementPriority(project))) {
    const gapIndex = stackGuideVisibleGapIndex(project, label, columns)
    if (gapIndex === null) continue
    const widthInGaps = stackGuideLabelWidthInGaps(template, label, gapWidthPx)
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

export function stackGuideVisibleGapIndex(project: CutProject, label: StackGuideLabel, columns?: Array<{ paperTrack?: string }>): number | null {
  if (!columns) return stackGuideGapIndex(project, label)
  return stackGuideVisibleSnapIndex(label, columns)
}

function compareStackGuidePlacementPriority(project: CutProject) {
  const fallback = compareStackGuideLabelsForUi(project)
  return (a: StackGuideLabel, b: StackGuideLabel): number =>
    stackGuideLabelSequence(a.labelId) - stackGuideLabelSequence(b.labelId)
    || fallback(a, b)
}

function stackGuideLabelSequence(labelId: string) {
  const match = /_(\d+)$/.exec(labelId)
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

function stackGuideLabelWidthInGaps(template: SheetTemplate, label: StackGuideLabel, gapWidthPx: number) {
  return stackGuideLabelWidthPx(label, stackGuideLabelMetrics(template)) / gapWidthPx
}

function stackGuidePlacementsOverlap(
  a: Pick<StackGuidePlacement, 'gapIndex' | 'widthInGaps'>,
  b: Pick<StackGuidePlacement, 'gapIndex' | 'widthInGaps'>,
) {
  return Math.abs(a.gapIndex - b.gapIndex) < (a.widthInGaps + b.widthInGaps) / 2 + 0.18
}

export function stackGuideGuideHeightPx(maxLane: number) {
  return STACK_GUIDE_EDITOR_BASE_HEIGHT_PX + Math.min(maxLane, STACK_GUIDE_MAX_LANE) * STACK_GUIDE_EDITOR_LANE_HEIGHT_PX
}

function stackGuideEditorLabelBottomPx(lane: number) {
  return STACK_GUIDE_EDITOR_BASE_HEIGHT_PX + Math.min(lane, STACK_GUIDE_MAX_LANE) * STACK_GUIDE_EDITOR_LANE_HEIGHT_PX + 4
}

export function stackGuideLabelBottomPx(template: SheetTemplate, lane: number) {
  const metrics = stackGuideLabelMetrics(template)
  return metrics.baseOffsetPx + Math.min(lane, STACK_GUIDE_MAX_LANE) * metrics.lanePitchPx
}

export function stackGuideEditorBottomPx(maxLane: number) {
  return stackGuideEditorLabelBottomPx(maxLane) + 28
}

export function stackGuideClampedEditorBottomPx(anchorY: number, pageHeight: number, preferredBottomPx: number) {
  const maxBottomPx = anchorY * pageHeight - STACK_GUIDE_EDITOR_FORM_HEIGHT_PX - STACK_GUIDE_EDITOR_EDGE_MARGIN_PX
  return Math.max(STACK_GUIDE_EDITOR_EDGE_MARGIN_PX, Math.min(preferredBottomPx, maxBottomPx))
}

export function stackGuideEditorShiftPx(anchorX: number, pageWidth: number) {
  const centerPx = anchorX * pageWidth
  const halfWidth = STACK_GUIDE_EDITOR_WIDTH_PX / 2
  if (centerPx - halfWidth < STACK_GUIDE_EDITOR_EDGE_MARGIN_PX) {
    return STACK_GUIDE_EDITOR_EDGE_MARGIN_PX - (centerPx - halfWidth)
  }
  if (centerPx + halfWidth > pageWidth - STACK_GUIDE_EDITOR_EDGE_MARGIN_PX) {
    return pageWidth - STACK_GUIDE_EDITOR_EDGE_MARGIN_PX - (centerPx + halfWidth)
  }
  return 0
}

export function stackGuideHeaderReachPx(template: SheetTemplate, rect: NormalizedRect, pageHeightPx: number) {
  const headerTopOffsetPx = STANDARD_A3_GRID_HEADER_TOP_OFFSET * template.page.heightPx
  return Math.max(12, Math.min(rect.y * pageHeightPx, headerTopOffsetPx))
}

export function stackGuideColumnHeaderHitPx(template: SheetTemplate, pageHeightPx: number) {
  return Math.max(8, (STANDARD_A3_GRID_HEADER_TOP_OFFSET - STANDARD_A3_GRID_HEADER_HEIGHT) * pageHeightPx)
}

export function stackGuideNativeHeaderReachPx(template: SheetTemplate, rect: NormalizedRect, pageSize: { heightPx: number }) {
  return stackGuideHeaderReachPx(template, rect, pageSize.heightPx)
}

export function stackGuideGapWidthPx(template: SheetTemplate, rect: NormalizedRect, columns?: Array<{ paperTrack?: string; w?: number }>, pageWidthPx = template.page.widthPx) {
  const columnCount = Math.max(1, columns?.length ?? 1)
  const averageColumnWidth = columns?.length && columns.every(column => typeof column.w === 'number')
    ? columns.reduce((total, column) => total + (column.w ?? 0), 0) / columns.length
    : rect.w / columnCount
  return Math.max(1, averageColumnWidth * pageWidthPx)
}

export function stackGuideLabelMetrics(template: SheetTemplate): StackGuideLabelMetrics {
  const style = template.style?.bgBookLabel
  const targetFontSizePx = templateGridHeaderFontSizePx(template)
  const rawFontSizePx = ptToTemplatePx(template, style?.fontSizePt, DEFAULT_STACK_GUIDE_LABEL_FONT_SIZE_PX)
  const fontSizePx = Math.max(rawFontSizePx, targetFontSizePx)
  const textPaddingPx = Math.max(mmToTemplatePx(template, style?.textPaddingMm, DEFAULT_STACK_GUIDE_LABEL_TEXT_PADDING_PX), fontSizePx * 0.22)
  const labelHeightPx = Math.max(mmToTemplatePx(template, style?.labelHeightMm, DEFAULT_STACK_GUIDE_LABEL_HEIGHT_PX), fontSizePx + 4)
  const minWidthPx = Math.max(mmToTemplatePx(template, style?.minWidthMm, DEFAULT_STACK_GUIDE_LABEL_MIN_WIDTH_PX), fontSizePx + textPaddingPx * 2)
  const maxWidthPx = Math.max(mmToTemplatePx(template, style?.maxWidthMm, DEFAULT_STACK_GUIDE_LABEL_MAX_WIDTH_PX), minWidthPx, fontSizePx * 8)
  const estimatedCharWidthPx = Math.max(mmToTemplatePx(template, style?.estimatedCharWidthMm, DEFAULT_STACK_GUIDE_LABEL_CHAR_WIDTH_PX), fontSizePx * 0.56)
  return {
    baseOffsetPx: mmToTemplatePx(template, style?.baseOffsetMm, DEFAULT_STACK_GUIDE_LABEL_BASE_OFFSET_PX),
    lanePitchPx: Math.max(mmToTemplatePx(template, style?.lanePitchMm, DEFAULT_STACK_GUIDE_LABEL_LANE_PITCH_PX), labelHeightPx + 3),
    labelHeightPx,
    minWidthPx,
    maxWidthPx,
    fontSizePx,
    pageMarginPx: mmToTemplatePx(template, style?.pageMarginMm, DEFAULT_STACK_GUIDE_LABEL_PAGE_MARGIN_PX),
    poleGapPx: mmToTemplatePx(template, style?.poleGapMm, DEFAULT_STACK_GUIDE_LABEL_POLE_GAP_PX),
    textPaddingPx,
    connectorStrokePx: mmToTemplatePx(template, style?.connectorStrokeMm, DEFAULT_STACK_GUIDE_LABEL_CONNECTOR_STROKE_PX),
    estimatedCharWidthPx,
    radiusPx: mmToTemplatePx(template, style?.radiusMm, DEFAULT_STACK_GUIDE_LABEL_RADIUS_PX),
  }
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

function stackGuideLabelWidthPx(label: Pick<StackGuideLabel, 'label'>, metrics: StackGuideLabelMetrics) {
  return Math.min(metrics.maxWidthPx, Math.max(metrics.minWidthPx, estimatedLabelTextWidthPx(label.label, metrics) + metrics.textPaddingPx * 2 + DEFAULT_STACK_GUIDE_LABEL_EXTRA_WIDTH_PX))
}

export function estimatedLabelTextWidthPx(text: string, metrics: Pick<StackGuideLabelMetrics, 'fontSizePx' | 'estimatedCharWidthPx'>): number {
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

export function stackGuideSvgGeometry(template: SheetTemplate, rect: NormalizedRect, pageSize: { widthPx: number; heightPx: number }, label: StackGuideLabel, lane: number, columns: Array<{ paperTrack?: string; x?: number; w?: number }> = []) {
  const metrics = stackGuideLabelMetrics(template)
  const snapIndex = stackGuideVisibleSnapIndex(label, columns)
  const anchorX = stackGuideSnapX(rect, columns, snapIndex)
  const anchorY = rect.y
  const labelWidth = stackGuideLabelWidthPx(label, metrics) / pageSize.widthPx
  const labelHeight = metrics.labelHeightPx / pageSize.heightPx
  const labelPoleGap = metrics.poleGapPx / pageSize.widthPx
  const labelTextPadding = metrics.textPaddingPx / pageSize.widthPx
  const pageMargin = metrics.pageMarginPx / pageSize.widthPx
  const labelBottomOffset = (stackGuideNativeHeaderReachPx(template, rect, pageSize) + stackGuideLabelBottomPx(template, lane)) / pageSize.heightPx
  const desiredLabelX = anchorX + labelPoleGap
  const labelX = clampNumber(desiredLabelX, pageMargin, 1 - pageMargin - labelWidth)
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
    fontSizePx: metrics.fontSizePx,
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

export function stackGuideAnchorRegions(template: SheetTemplate, page: SheetPage, frameOrigin: number) {
  if (frameOrigin < page.frameStart || frameOrigin > page.frameEnd) return []
  return template.regions.filter(region => {
    if (region.type !== 'exposure-grid' || !region.grid) return false
    if (region.grid.role !== 'action' && region.grid.role !== 'cell') return false
    if (region.grid.columns.length === 0) return false
    const frames = resolveSheetTemplateGridFrames(template, region.grid, page.frameEnd - page.frameStart + 1, frameOrigin)
    return frameOrigin >= frames.frameStart && frameOrigin <= frames.frameEnd
  })
}

export function stackGuideInsertionTargets(
  template: SheetTemplate,
  project: CutProject,
  displayRole: SheetTimingRole,
  regionId: string,
  rect: NormalizedRect,
  columns: Array<{ paperTrack?: string }>,
) {
  const fallbackColumnWidth = rect.w / Math.max(1, columns.length)
  const segment = overlayBandSegmentForRegion(template, project, displayRole, regionId)
  const minX = segment?.minX ?? rect.x
  const columnWidth = segment?.columnWidth ?? fallbackColumnWidth
  const snapCount = segment?.snapCount ?? columns.length + 1
  return Array.from({ length: snapCount + 1 }, (_, snapIndex) => {
    const gapIndex = stackGuideGapIndexFromSnapIndex(snapIndex, columns.length)
    return {
      snapIndex,
      gapIndex,
      insertAfterPaperTrack: stackGuideInsertAfterPaperTrackFromGap(columns, gapIndex),
      x: minX + columnWidth * snapIndex,
    }
  })
}
