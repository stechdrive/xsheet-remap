import { getSheetViewLayout, isTimelineProjectingSheetTemplateGridRegion, paperTrackDisplayRole, resolveSheetTemplateGridLayout, timingGroupKey, type NormalizedRect, type SheetPage, type SheetTimingRole } from '@xsheet-remap/core'
import { overlayColumnsForPage } from './app-sheet-geometry'
import type { SheetRenderModelContext, SheetRenderModelGeometry } from './sheetRenderModel'

type TimingBlock = { first: number; last: number; x: number; y: number; width: number; rowHeight: number }

export function timingBlockRow(block: TimingBlock, frame: number): NormalizedRect {
  return { x: block.x, y: block.y + (frame - block.first) * block.rowHeight, w: block.width, h: block.rowHeight }
}

function createTimingGridProjection(context: SheetRenderModelContext) {
  const { template, paperTracks, timelineLanes, displayFrameStart, displayDurationFrames } = context
  const paged = getSheetViewLayout(template).frameAxis?.type === 'paged'
  const repeatCells = paged && template.templateKind !== 'digital-native' && !template.layoutMode?.endsWith('-digital')
    && (template.page.isPhysical !== false || template.templateKind?.includes('paper') === true)
  const grids = new Map<string, TimingBlock[]>()
  for (const region of template.regions) {
    if (!isTimelineProjectingSheetTemplateGridRegion(region) || (region.grid.role !== 'action' && region.grid.role !== 'cell')) continue
    const layout = resolveSheetTemplateGridLayout(template, region, { paperTracks, timelineLanes,
      durationFrames: displayDurationFrames, frameOrigin: paged ? template.defaults.frameOrigin : displayFrameStart,
      layoutOverrides: context.project.sheetView.layoutOverrides })
    if (!layout) continue
    for (const column of layout.columns) {
      if (!column.paperTrack) continue
      const key = timingGroupKey(region.grid.role, column.paperTrack)
      const blocks = grids.get(key) ?? []
      blocks.push({ first: layout.frames.frameStart, last: Math.min(layout.frames.frameEnd, layout.frames.frameStart + layout.frames.rowCount - 1),
        x: column.x, width: column.w, y: layout.rect.y, rowHeight: layout.frames.rowHeight })
      grids.set(key, blocks)
    }
  }
  const overlays = new Map(context.overlayTracks.map(track => [timingGroupKey(paperTrackDisplayRole(track), track.paperTrack), track]))
  const byPage = new WeakMap<SheetPage, Map<string, TimingBlock[]>>()
  function blocks(role: SheetTimingRole, paperTrack: string, page: SheetPage): TimingBlock[] {
    let pageBlocks = byPage.get(page)
    if (!pageBlocks) { pageBlocks = new Map(); byPage.set(page, pageBlocks) }
    const key = timingGroupKey(role, paperTrack)
    const cached = pageBlocks.get(key)
    if (cached) return cached
    const overlay = overlays.get(key)
    const offset = paged ? page.frameStart - template.defaults.frameOrigin : 0
    const projected = overlay
      ? overlayColumnsForPage(template, context.project, overlay, page).map(column => ({
        first: column.globalFrameStart, last: column.globalFrameEnd, x: column.rect.x, width: column.rect.w,
        y: column.rect.y, rowHeight: column.rect.h / column.frames.rowCount,
      }))
      : (grids.get(key) ?? []).map(block => ({ ...block, first: block.first + offset, last: block.last + offset }))
    const visible = projected.filter(block => block.first <= page.frameEnd && block.last >= page.frameStart)
    pageBlocks.set(key, visible)
    return visible
  }
  return { repeatCells, blocks }
}

const projections = new WeakMap<SheetRenderModelGeometry, ReturnType<typeof createTimingGridProjection>>()

export function sheetTimingGridProjection(context: SheetRenderModelContext) {
  let projection = projections.get(context.geometry)
  if (!projection) { projection = createTimingGridProjection(context); projections.set(context.geometry, projection) }
  return projection
}
