import { isInteractiveSheetTemplateGridRegion, type NormalizedRect, type SheetPage } from '@xsheet-remap/core'
import type { SheetRangeSelection } from './appTypes'
import type { SheetRenderModelContext } from './sheetRenderModel'
import { frameOriginForPageHit, overlayColumnRectForPage, overlayRangeRectForPage, projectTimingHitForFrame, rectForHit, shouldSuppressRectUnderActiveOverlay } from './sheet-layers-hit-geometry'
import { rangeRectsForPage } from './sheetInteraction'
import { mergeAdjacentRangeRects } from './sheet-selection-visuals'
import { layoutTimingCellText, type TimingCellTextLayout } from './timingCellTextLayout'
import { defaultTimingTextMinFontSizePx, resolveTimingTextFontSizePx } from './sheetTextLayout'
import type { TimingRangeMovePlan, TimingRangeMoveSource } from './timingEditing'

type GeometryContext = SheetRenderModelContext

export function timingDragRangeRectsForPage(context: GeometryContext, page: SheetPage, range: SheetRangeSelection, activeOverlayPaperTrack: string | null = null) {
  const { project, template, paperTracks, timelineLanes, overlayTracks } = context
  const overlayNames = new Set(overlayTracks.map(track => track.paperTrack))
  const selected = range.paperTracks.filter(Boolean)
  const activeOverlay = overlayTracks.find(track => track.paperTrack === activeOverlayPaperTrack)
  const activeColumn = activeOverlay ? overlayColumnRectForPage(template, project, activeOverlay, page) : null
  // Project logical frames into each block/page. Translating source rectangles
  // would put the ghost in the wrong column across a block or page boundary.
  const groups = new Set(template.regions.filter(region =>
    isInteractiveSheetTemplateGridRegion(region) && region.grid.role === range.role,
  ).map(region => region.flowGroupId ?? region.regionId))
  const normalRange = { ...range, paperTracks: selected.filter(track => !overlayNames.has(track)), paperTrack: undefined }
  const normal = normalRange.paperTracks.length === 0 ? [] : [...groups].flatMap(flowGroupId =>
    rangeRectsForPage(template, { ...normalRange, flowGroupId }, page, {
      paperTracks, timelineLanes, durationFrames: page.frameEnd - page.frameStart + 1,
      frameOrigin: frameOriginForPageHit(template, page), layoutOverrides: project.sheetView.layoutOverrides,
    }),
  )
  const overlays = overlayTracks.filter(track => selected.includes(track.paperTrack)).flatMap(track =>
    overlayRangeRectForPage(template, project, track, range.frameStart, range.frameEnd, page) ?? [],
  )
  return mergeAdjacentRangeRects([...normal.filter(rect => !shouldSuppressRectUnderActiveOverlay(undefined, rect, activeColumn)), ...overlays])
}

export type TimingDragGhostCell = {
  paperTrack: string
  frame: number
  item: TimingRangeMoveSource['items'][number]
  rect: NormalizedRect
  textLayout: TimingCellTextLayout
  collision: boolean
}

export function timingDragGhostCellsForPage(
  context: GeometryContext, page: SheetPage, source: TimingRangeMoveSource, plan: TimingRangeMovePlan,
  activeOverlayPaperTrack: string | null,
  frameRange?: { start: number; end: number },
): TimingDragGhostCell[] {
  const { project, template, pageSize } = context
  if (plan.destinationPaperTracks.length === 0) return []
  const start = Math.max(page.frameStart, source.displayFrameStart, frameRange?.start ?? -Infinity)
  const end = Math.min(page.frameEnd, source.displayFrameEnd, frameRange?.end ?? Infinity)
  const activeOverlay = context.overlayTracks.find(track => track.paperTrack === activeOverlayPaperTrack)
  const activeColumn = activeOverlay ? overlayColumnRectForPage(template, project, activeOverlay, page) : null
  const collisions = new Set(plan.collisionCells.map(cell => `${cell.paperTrack}\u0000${cell.frame}`))
  const cells: TimingDragGhostCell[] = []
  for (const item of source.items) {
    const paperTrack = plan.destinationPaperTracks[item.paperTrackOffset]
    const frame = plan.destinationFrameStart + item.offsetFrames
    if (!paperTrack || frame < start || frame > end) continue
    const hit = projectTimingHitForFrame(template, project, source.range.role, paperTrack, frame)
    if (!hit || hit.pageId !== page.pageId) continue
    const rect = rectForHit(project, template, hit)
    const track = project.logicalSheet.paperTracks.find(candidate => candidate.paperTrack === paperTrack)
    if (!rect || shouldSuppressRectUnderActiveOverlay(track, rect, activeColumn)) continue
    const fontSize = resolveTimingTextFontSizePx(template, source.range.role, item.fontSizePx)
    cells.push({ paperTrack, frame, item, rect,
      textLayout: layoutTimingCellText(item.displayLabel ?? '', fontSize, defaultTimingTextMinFontSizePx(template, source.range.role), rect, pageSize, undefined, item.reference),
      collision: collisions.has(`${paperTrack}\u0000${frame}`),
    })
  }
  return cells
}
