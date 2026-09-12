import { isTimelineProjectingSheetTemplateGridRegion, resolveSheetTemplateGridLayout } from '@xsheet-remap/core'
import type { SheetRenderModelContext } from './sheetRenderModel'
import type { SheetRenderWindow } from './useSheetRenderWindow'

export function sheetFrameRangeForWindow(context: SheetRenderModelContext, window: SheetRenderWindow) {
  if (!window) return undefined
  let start = Infinity, end = -Infinity
  for (const region of context.template.regions) {
    if (!isTimelineProjectingSheetTemplateGridRegion(region)) continue
    const layout = resolveSheetTemplateGridLayout(context.template, region, {
      paperTracks: context.paperTracks, timelineLanes: context.timelineLanes,
      durationFrames: context.displayDurationFrames, frameOrigin: context.displayFrameStart,
      layoutOverrides: context.project.sheetView.layoutOverrides,
    })
    if (!layout) continue
    const first = Math.max(0, Math.floor((window.top - layout.rect.y) / layout.frames.rowHeight) - 2)
    const last = Math.min(layout.frames.rowCount - 1, Math.ceil((window.bottom - layout.rect.y) / layout.frames.rowHeight) + 2)
    if (first > last) continue
    start = Math.min(start, layout.frames.frameStart + first)
    end = Math.max(end, layout.frames.frameStart + last)
  }
  return { start, end }
}
