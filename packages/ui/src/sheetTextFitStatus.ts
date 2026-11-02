import type { CutProject, SheetTemplate } from '@xsheet-remap/core'
import { buildCameraCuePageLayouts, cameraCuePointLayoutsForPage } from './cameraCueGeometry'
import { buildSoundCuePageTextLayouts } from './soundCueGeometry'
import { createSheetRenderModelContext, inputTextRenderItemsForPage } from './sheetRenderModel'
import { cueTextSizes } from './cueTextSizing'
import type { SheetTextTargets } from './sheetTextSizing'

/** Read the same layouts used by the screen and exports, only for the selected text. */
export function sheetTextFitStatus(project: CutProject, template: SheetTemplate, targets: SheetTextTargets) {
  if (!targets.events.length && !targets.cues.length) return undefined
  const context = createSheetRenderModelContext(project, template)
  const overflow = new Set<string>(), fitted = new Set<string>()
  if (targets.events.length) {
    const selectedContext = { ...context, project: { ...project, logicalSheet: { ...project.logicalSheet, events: targets.events } } }
    for (const page of context.pages) {
      if (!targets.events.some(event => event.frame >= page.frameStart && event.frame <= page.frameEnd)) continue
      for (const item of inputTextRenderItemsForPage(selectedContext, page)) {
        if (item.textLayout.overflow || item.textLayout.fontSizePx > item.rect.h * context.pageSize.heightPx) overflow.add(item.eventId)
        if (item.textLayout.fontSizePx < item.fontSizePx - .01) fitted.add(item.eventId)
      }
    }
  }
  const ids = new Set(targets.cues.map(cue => cue.cueId))
  const options = { paperTracks: context.paperTracks, timelineLanes: context.timelineLanes, layoutOverrides: project.sheetView.layoutOverrides }
  if (targets.cues.some(cue => cue.role === 'sound')) {
    for (const item of buildSoundCuePageTextLayouts(template, context.pages, project.timedRangeCues, context.pageSize, options)) {
      if (!ids.has(item.cue.cueId)) continue
      const sizes = cueTextSizes(template, item.cue, context.pageSize), text = item.textLayout
      if (text.overflowLabel || text.truncatedText) overflow.add(item.cue.cueId)
      if ((text.labelGlyphs.length && text.labelFontSizePx < sizes.primary - .01)
        || (text.textGlyphs.length && text.textFontSizePx < sizes.secondary - .01)) fitted.add(item.cue.cueId)
    }
  }
  if (targets.cues.some(cue => cue.role === 'camera')) {
    for (const page of context.pages) {
      if (!targets.cues.some(cue => cue.frameStart <= page.frameEnd && cue.frameEnd >= page.frameStart)) continue
      for (const item of buildCameraCuePageLayouts(template, page, project.timedRangeCues, context.pageSize, options)) {
        if (!ids.has(item.cue.cueId)) continue
        const points = cameraCuePointLayoutsForPage(template, item.cue, item.segments, context.pageSize)
        const sizes = cueTextSizes(template, item.cue, context.pageSize)
        if (item.label?.overflow || points.some(point => point.overflow)) overflow.add(item.cue.cueId)
        if ((item.label && item.label.fontSizePx < sizes.primary - .01)
          || points.some(point => point.point.label && point.fontSizePx < sizes.secondary - .01)) fitted.add(item.cue.cueId)
      }
    }
  }
  return overflow.size ? `${overflow.size}件の文字が枠を超えています。サイズを下げるか「枠に収める」で調整できます。`
    : fitted.size ? `${fitted.size}件を指定サイズより小さく表示して枠に収めています。` : undefined
}
