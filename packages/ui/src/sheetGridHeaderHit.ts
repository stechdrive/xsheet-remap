import {
  isInteractiveSheetTemplateGridRegion,
  resolveSheetTemplateGridLayout,
  resolveSheetTemplateRegionRects,
  type NormalizedPoint,
  type SheetHit,
  type SheetTemplate,
  type SheetTemplateGridRole,
  type SheetTemplateLayoutResolveOptions,
} from '@xsheet-remap/core'
import { maxVerticalLabelRows, paperTrackHeaderLabel } from './columnLabelLayout'
import { gridHeaderLabelForRegion, templateGridColumnFontSizePx, templateGridHeaderFontSizePx } from './templateEditorGeometry'
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
  const { pageSize, regionRects } = resolveSheetTemplateRegionRects(options.template, options.durationFrames, options)

  for (const region of options.template.regions) {
    if (!isInteractiveSheetTemplateGridRegion(region) || !options.roles.includes(region.grid.role)) continue
    const layout = resolveSheetTemplateGridLayout(options.template, region, options)
    if (!layout) continue
    const rect = layout.rect
    if (options.point.x < rect.x || options.point.x > rect.x + rect.w) continue
    const header = sheetGridHeaderGeometry(options.template, region, rect, pageSize.heightPx)
    const inTitle = header.title.h > 0 && options.point.y >= header.title.y && options.point.y < header.title.y + header.title.h
    const inColumns = header.columns.h > 0 && options.point.y >= header.columns.y && options.point.y <= rect.y
    const possibleExtension = options.point.y < rect.y && options.point.y >= rect.y - (maxVerticalLabelRows * templateGridColumnFontSizePx(options.template) + 3) / pageSize.heightPx
    if (!inColumns && !inTitle && !possibleExtension) continue
    const columnIndex = layout.columns.findIndex(column =>
      options.point.x >= column.x && options.point.x <= column.x + column.w,
    )
    const column = layout.columns[columnIndex]
    if (!column) continue
    let columnHit = inColumns
    if (!columnHit && column.paperTrack && region.grid.header?.showColumnLabels !== false) {
      const title = region.grid.header?.showLabel === false ? '' : gridHeaderLabelForRegion(options.template, region)
      const label = paperTrackHeaderLabel(column.label, column, templateGridColumnFontSizePx(options.template), header, pageSize, title, templateGridHeaderFontSizePx(options.template), regionRects.values())
      const x = options.point.x * pageSize.widthPx, y = options.point.y * pageSize.heightPx
      columnHit = label.glyphs?.some(g => Math.abs(x - g.xPx) <= label.fontSizePx / 2 && y >= g.yPx - label.fontSizePx * .88 && y <= g.yPx + label.fontSizePx * .12) ?? false
    }
    if (!columnHit && !(options.includeTitle && inTitle)) continue
    return {
      part: columnHit ? 'column' : 'title',
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
