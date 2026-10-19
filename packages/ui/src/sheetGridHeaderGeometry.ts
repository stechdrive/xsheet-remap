import type { NormalizedRect, SheetTemplate, SheetTemplateRegion } from '@xsheet-remap/core'
import { STANDARD_A3_GRID_HEADER_HEIGHT, STANDARD_A3_GRID_HEADER_TOP_OFFSET } from './sheetConstants'

/** The drawing and every header hit target share these template-defined rectangles. */
export function sheetGridHeaderGeometry(template: SheetTemplate, region: SheetTemplateRegion, rect: NormalizedRect, pageHeightPx: number) {
  const topOffset = (region.grid?.header?.topOffsetPx ?? STANDARD_A3_GRID_HEADER_TOP_OFFSET * template.page.heightPx) / pageHeightPx
  const height = (region.grid?.header?.heightPx ?? STANDARD_A3_GRID_HEADER_HEIGHT * template.page.heightPx) / pageHeightPx
  const columnHeight = region.grid?.header?.columnHeightPx === undefined
    ? Math.max(0, topOffset - height)
    : region.grid.header.columnHeightPx / pageHeightPx
  return {
    title: { x: rect.x, y: rect.y - topOffset, w: rect.w, h: height },
    columns: { x: rect.x, y: rect.y - columnHeight, w: rect.w, h: columnHeight },
  }
}
