import {
  isInteractiveSheetTemplateGridRegion,
  resolveSheetTemplateGridLayout,
  resolveSheetTemplatePageSize,
  type NormalizedPoint,
  type SheetHit,
  type SheetTemplate,
  type SheetTemplateGridRole,
  type SheetTemplateLayoutResolveOptions,
} from '@xsheet-remap/core'
import { sheetGridHeaderGeometry } from './sheetGridHeaderGeometry'

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
  includeTitle?: boolean
}): { hit: SheetHit; timelineLaneId?: string; part: 'title' | 'column' } | null {
  const pageSize = resolveSheetTemplatePageSize(options.template, options.durationFrames, options)

  for (const region of options.template.regions) {
    if (!isInteractiveSheetTemplateGridRegion(region) || !options.roles.includes(region.grid.role)) continue
    const layout = resolveSheetTemplateGridLayout(options.template, region, options)
    if (!layout) continue
    const rect = layout.rect
    if (options.point.x < rect.x || options.point.x > rect.x + rect.w) continue
    const header = sheetGridHeaderGeometry(options.template, region, rect, pageSize.heightPx)
    const inTitle = header.title.h > 0 && options.point.y >= header.title.y && options.point.y < header.title.y + header.title.h
    const inColumns = header.columns.h > 0 && options.point.y >= header.columns.y && options.point.y <= rect.y
    if (!inColumns && !(options.includeTitle && inTitle)) continue
    const columnIndex = layout.columns.findIndex(column =>
      options.point.x >= column.x && options.point.x <= column.x + column.w,
    )
    const column = layout.columns[columnIndex]
    if (!column) continue
    return {
      part: inColumns ? 'column' : 'title',
      hit: {
        regionId: region.regionId,
        role: region.grid.role,
        frame: layout.frames.frameStart,
        rowIndex: 0,
        columnIndex,
        columnId: column.columnId,
        label: column.label,
        paperTrack: column.paperTrack,
        timelineLaneId: column.timelineLaneId,
      },
      timelineLaneId: column.timelineLaneId,
    }
  }
  return null
}
