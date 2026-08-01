import { type CutProject, type NormalizedRect, type SheetPage, type SheetTemplate, type SheetTimingRole, type StackGuideLabel, isInteractiveSheetTemplateGridRegion, resolveSheetTemplateGridFrames, stackGuideGapIndex } from '@xsheet-remap/core'
import { STANDARD_A3_GRID_HEADER_HEIGHT, STANDARD_A3_GRID_HEADER_TOP_OFFSET } from './sheetConstants'
import { clampNumber } from './sheetInteraction'
import { compareStackGuideLabelsForUi } from './app-foundation'
import { overlayBandSegments } from './app-sheet-geometry'
import { auxiliaryLabelBottomPx, auxiliaryLabelHeaderReachPx, auxiliaryLabelMaxWidthForPage, auxiliaryLabelMetrics, auxiliaryLabelRangesOverlap, auxiliaryLabelTextLayout, type AuxiliaryLabelMetrics } from './auxiliary-label-layout'

type StackGuidePreviewPlacement = {
  labelId?: string
  displayRole: SheetTimingRole
  gapIndex: number
  insertAfterPaperTrack?: string
  snapIndex: number
}

type StackGuideSlot = { x: number; w: number; regionId?: string; paperTrack?: string }

export type { AuxiliaryLabelMetrics as StackGuideLabelMetrics } from './auxiliary-label-layout'
export { estimatedLabelTextWidthPx } from './auxiliary-label-layout'

export function overlayBandSegmentForRegion(template: SheetTemplate, project: CutProject, role: SheetTimingRole, regionId: string) {
  return overlayBandSegments(template, project, role).find(segment => segment.regionId === regionId) ?? null
}

export function stackGuideGapIndexFromSnapIndex(snapIndex: number, columnCount: number): number {
  return clampNumber(Math.round(snapIndex) - 1, 0, columnCount)
}

export function stackGuideInsertAfterPaperTrackFromGap(columns: Array<{ paperTrack?: string }>, gapIndex: number): string | undefined {
  return gapIndex > 0 ? columns[gapIndex - 1]?.paperTrack : undefined
}

export function stackGuideVisibleSnapIndex(
  label: StackGuideLabel,
  columns: Array<{ paperTrack?: string }>,
  templateId?: string,
  slots: StackGuideSlot[] = [],
  anchorRegionId?: string,
): number {
  if ((!templateId || !label.viewTemplateId || label.viewTemplateId === templateId) && Number.isFinite(label.viewSnapIndex)) {
    return clampNumber(Math.round(label.viewSnapIndex as number), 0, Number.MAX_SAFE_INTEGER)
  }
  if (label.insertAfterPaperTrack) {
    const slotIndex = slots.findIndex(slot => slot.regionId === anchorRegionId && slot.paperTrack === label.insertAfterPaperTrack)
    if (slotIndex >= 0) return slotIndex + 1
    const trackIndex = columns.findIndex(column => column.paperTrack === label.insertAfterPaperTrack)
    if (trackIndex >= 0) return trackIndex + 2
  }
  return clampNumber(Math.round(label.gapIndex) + 1, 0, columns.length + 1)
}

/**
 * Produces the temporary label model used by both the SVG and its HTML hit
 * targets while a label is being dragged. Keeping this in the shared geometry
 * path prevents the visible flag and the clickable flag from drifting apart.
 */
export function stackGuideLabelsForPreview(
  project: CutProject,
  preview?: StackGuidePreviewPlacement | null,
): StackGuideLabel[] {
  if (!preview?.labelId || !project.stackGuideLabels.some(label => label.labelId === preview.labelId)) {
    return project.stackGuideLabels
  }
  const nextOrderInGap = project.stackGuideLabels
    .filter(label => label.labelId !== preview.labelId && (label.displayRole ?? 'action') === preview.displayRole)
    .reduce((max, label) => Math.max(max, label.orderInGap), -1) + 1
  return project.stackGuideLabels.map(label => label.labelId === preview.labelId
    ? {
        ...label,
        displayRole: preview.displayRole,
        gapIndex: preview.gapIndex,
        insertAfterPaperTrack: preview.insertAfterPaperTrack,
        viewTemplateId: project.sheetTemplateId,
        viewSnapIndex: preview.snapIndex,
        orderInGap: nextOrderInGap,
      }
    : label)
}

const STACK_GUIDE_EDITOR_BASE_HEIGHT_PX = 24

const STACK_GUIDE_EDITOR_LANE_HEIGHT_PX = 20

export const STACK_GUIDE_MAX_LANE = 8

const STACK_GUIDE_EDITOR_WIDTH_PX = 148

const STACK_GUIDE_EDITOR_FORM_HEIGHT_PX = 36

const STACK_GUIDE_EDITOR_EDGE_MARGIN_PX = 8

const DEFAULT_STACK_GUIDE_LABEL_EXTRA_WIDTH_PX = 3

export const OVERLAY_PAPER_TRACK_TOOLTIP_DELAY_MS = 650

interface StackGuidePlacement {
  label: StackGuideLabel
  gapIndex: number
  leftPx: number
  rightPx: number
  lane: number
}

type StackGuideColumn = { paperTrack?: string; x?: number; w?: number }

export function stackGuidePlacementsByGap(
  template: SheetTemplate,
  project: CutProject,
  labels: StackGuideLabel[],
  rect: NormalizedRect,
  pageSize: { widthPx: number; heightPx: number },
  columns: StackGuideColumn[] = [],
  slots: StackGuideSlot[] = [],
  anchorRegionId?: string,
) {
  const placements = stackGuidePlacements(template, project, labels, rect, pageSize, columns, slots, anchorRegionId)
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

export function stackGuidePlacements(
  template: SheetTemplate,
  project: CutProject,
  labels: StackGuideLabel[],
  rect: NormalizedRect,
  pageSize: { widthPx: number; heightPx: number },
  columns: StackGuideColumn[] = [],
  slots: StackGuideSlot[] = [],
  anchorRegionId?: string,
): StackGuidePlacement[] {
  const placed: StackGuidePlacement[] = []
  for (const label of [...labels].sort(compareStackGuidePlacementPriority(project))) {
    const gapIndex = stackGuideVisibleGapIndex(project, label, columns, template.templateId, slots, anchorRegionId)
    if (gapIndex === null) continue
    const geometry = stackGuideSvgGeometry(template, rect, pageSize, label, 0, columns, slots, anchorRegionId)
    const range = {
      leftPx: geometry.labelX * pageSize.widthPx,
      rightPx: (geometry.labelX + geometry.labelWidth) * pageSize.widthPx,
    }
    let lane = 0
    while (
      lane < STACK_GUIDE_MAX_LANE
      && placed.some(candidate => candidate.lane === lane && auxiliaryLabelRangesOverlap(range, candidate))
    ) {
      lane += 1
    }
    placed.push({ label, gapIndex, ...range, lane })
  }
  return placed
}

export function stackGuideVisibleGapIndex(project: CutProject, label: StackGuideLabel, columns?: Array<{ paperTrack?: string }>, templateId?: string, slots: StackGuideSlot[] = [], anchorRegionId?: string): number | null {
  if (!columns) return stackGuideGapIndex(project, label)
  return stackGuideVisibleSnapIndex(label, columns, templateId, slots, anchorRegionId)
}

function compareStackGuidePlacementPriority(project: CutProject) {
  const fallback = compareStackGuideLabelsForUi(project)
  return (a: StackGuideLabel, b: StackGuideLabel): number =>
    fallback(a, b)
}

export function stackGuideGuideHeightPx(maxLane: number) {
  return STACK_GUIDE_EDITOR_BASE_HEIGHT_PX + Math.min(maxLane, STACK_GUIDE_MAX_LANE) * STACK_GUIDE_EDITOR_LANE_HEIGHT_PX
}

function stackGuideEditorLabelBottomPx(lane: number) {
  return STACK_GUIDE_EDITOR_BASE_HEIGHT_PX + Math.min(lane, STACK_GUIDE_MAX_LANE) * STACK_GUIDE_EDITOR_LANE_HEIGHT_PX + 4
}

export function stackGuideLabelBottomPx(template: SheetTemplate, lane: number) {
  return auxiliaryLabelBottomPx(template, lane, STACK_GUIDE_MAX_LANE)
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
  return auxiliaryLabelHeaderReachPx(template, rect, pageHeightPx)
}

export function stackGuideColumnHeaderHitPx(template: SheetTemplate, pageHeightPx: number) {
  return Math.max(8, (STANDARD_A3_GRID_HEADER_TOP_OFFSET - STANDARD_A3_GRID_HEADER_HEIGHT) * pageHeightPx)
}

export function stackGuideNativeHeaderReachPx(template: SheetTemplate, rect: NormalizedRect, pageSize: { heightPx: number }) {
  return stackGuideHeaderReachPx(template, rect, pageSize.heightPx)
}

export function stackGuideLabelMetrics(template: SheetTemplate): AuxiliaryLabelMetrics {
  return auxiliaryLabelMetrics(template, 'stack-guide')
}

export function stackGuideSvgGeometry(template: SheetTemplate, rect: NormalizedRect, pageSize: { widthPx: number; heightPx: number }, label: StackGuideLabel, lane: number, columns: StackGuideColumn[] = [], slots: StackGuideSlot[] = [], anchorRegionId?: string) {
  const metrics = stackGuideLabelMetrics(template)
  const textLayout = auxiliaryLabelTextLayout(label.label, metrics, {
    extraWidthPx: DEFAULT_STACK_GUIDE_LABEL_EXTRA_WIDTH_PX,
    maxLabelWidthPx: auxiliaryLabelMaxWidthForPage(metrics, pageSize.widthPx),
  })
  const snapIndex = stackGuideVisibleSnapIndex(label, columns, template.templateId, slots, anchorRegionId)
  const anchorX = slots[snapIndex]?.x ?? stackGuideSnapX(rect, columns, snapIndex)
  const anchorY = rect.y
  const labelWidth = textLayout.labelWidthPx / pageSize.widthPx
  const labelHeight = metrics.labelHeightPx / pageSize.heightPx
  const labelPoleGap = metrics.poleGapPx / pageSize.widthPx
  const labelTextPadding = metrics.textPaddingPx / pageSize.widthPx
  const pageMargin = metrics.pageMarginPx / pageSize.widthPx
  const labelBottomOffset = (stackGuideNativeHeaderReachPx(template, rect, pageSize) + stackGuideLabelBottomPx(template, lane)) / pageSize.heightPx
  const desiredLabelX = anchorX + labelPoleGap
  const labelX = clampNumber(desiredLabelX, pageMargin, 1 - pageMargin - labelWidth)
  const labelAttachX = clampNumber(anchorX, labelX, labelX + labelWidth)
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
    displayText: textLayout.displayText,
    fullText: textLayout.fullText,
    truncated: textLayout.truncated,
    fontSizePx: textLayout.fontSizePx,
    fontFamily: metrics.fontFamily,
    fontWeight: metrics.fontWeight,
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
    const column = columns[snapIndex - 1]
    return column?.x ?? rect.x
  }
  return rect.x + (rect.w * (snapIndex - 1)) / columnCount
}

export function stackGuideAnchorRegions(template: SheetTemplate, page: SheetPage, frameOrigin: number) {
  if (frameOrigin < page.frameStart || frameOrigin > page.frameEnd) return []
  return template.regions.filter(region => {
    if (!isInteractiveSheetTemplateGridRegion(region)) return false
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
  const snapCount = segment?.snapCount ?? columns.length + 1
  const firstAnchorSlotIndex = segment?.slots.findIndex(slot => slot.regionId === regionId) ?? -1
  return Array.from({ length: snapCount + 1 }, (_, snapIndex) => {
    const gapIndex = firstAnchorSlotIndex >= 0
      ? clampNumber(snapIndex - firstAnchorSlotIndex, 0, columns.length)
      : stackGuideGapIndexFromSnapIndex(snapIndex, columns.length)
    return {
      snapIndex,
      gapIndex,
      insertAfterPaperTrack: stackGuideInsertAfterPaperTrackFromGap(columns, gapIndex),
      x: segment?.slots[snapIndex]?.x ?? rect.x + fallbackColumnWidth * (snapIndex - 1),
    }
  })
}
