import {
  resolveSheetTemplateGridLayout,
  resolveSheetTemplatePageSize,
  type NormalizedPoint,
  type SheetHit,
  type SheetTemplate,
  type SheetTemplateGridRole,
  type SheetTemplateLayoutResolveOptions,
} from '@xsheet-remap/core'
import { STANDARD_A3_GRID_HEADER_HEIGHT, STANDARD_A3_GRID_HEADER_TOP_OFFSET } from './sheetConstants'

export function gridColumnHeaderHitFromPoint(options: {
  template: SheetTemplate
  point: NormalizedPoint
  roles: SheetTemplateGridRole[]
  paperTracks: string[]
  timelineLanes: SheetTemplateLayoutResolveOptions['timelineLanes']
  durationFrames: number
  frameOrigin: number
  layoutOverrides: SheetTemplateLayoutResolveOptions['layoutOverrides']
  viewportHeightPx?: number
}): { hit: SheetHit; timelineLaneId?: string } | null {
  const pageSize = resolveSheetTemplatePageSize(options.template, options.durationFrames, options)
  const headerTopOffset = (STANDARD_A3_GRID_HEADER_TOP_OFFSET * options.template.page.heightPx) / pageSize.heightPx
  const headerHeight = (STANDARD_A3_GRID_HEADER_HEIGHT * options.template.page.heightPx) / pageSize.heightPx
  const columnHeaderHeight = Math.max(0.001, headerTopOffset - headerHeight)
  const minHitHeight = options.viewportHeightPx && options.viewportHeightPx > 0
    ? 28 / options.viewportHeightPx
    : columnHeaderHeight
  const hitHeight = Math.min(headerTopOffset, Math.max(columnHeaderHeight, minHitHeight))
  const hitBottomPadding = options.viewportHeightPx && options.viewportHeightPx > 0
    ? Math.min(0.0025, 4 / options.viewportHeightPx)
    : 0

  for (const region of options.template.regions) {
    if (region.type !== 'exposure-grid' || !region.grid || !options.roles.includes(region.grid.role)) continue
    const layout = resolveSheetTemplateGridLayout(options.template, region, options)
    if (!layout) continue
    const rect = layout.rect
    if (options.point.x < rect.x || options.point.x > rect.x + rect.w) continue
    if (options.point.y < rect.y - hitHeight || options.point.y > rect.y + hitBottomPadding) continue
    const columnIndex = layout.columns.findIndex(column =>
      options.point.x >= column.x && options.point.x <= column.x + column.w,
    )
    const column = layout.columns[columnIndex]
    if (!column) continue
    return {
      hit: {
        regionId: region.regionId,
        role: region.grid.role,
        frame: layout.frames.frameStart,
        rowIndex: 0,
        columnIndex,
        columnId: column.columnId,
        label: column.label,
        paperTrack: column.paperTrack,
      },
      timelineLaneId: column.timelineLaneId,
    }
  }
  return null
}
