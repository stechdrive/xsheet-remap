import { formatSheetTemplateCutNumber, resolveSheetTemplateRegionCapabilities, resolveSheetTemplateRegionRect, resolveSheetTemplateTextStyle, type ResolvedSheetTemplateTextStyle } from '@xsheet-remap/core'
import type { TemplateFormFieldRenderModel } from './templateEditorGeometry'
import type { SheetMetadataTextRenderItem, SheetRenderModelContext } from './sheetRenderModel'
import { layoutCutHeaderText, type CutHeaderTextBlock } from './cutHeaderTextLayout'
import type { TextMeasurementProvider } from './textMetrics'

export function cutHeaderRenderItems(context: SheetRenderModelContext, labels: string[], fields: TemplateFormFieldRenderModel[], measurement: TextMeasurementProvider): SheetMetadataTextRenderItem[] {
  const { template, pageSize, project } = context
  const primaryText = formatSheetTemplateCutNumber(template, project.cut.cut ?? '')
  const regions = template.regions.filter(region => region.type === 'metadata-field' && resolveSheetTemplateRegionCapabilities(region).rendered)
  const rectFor = (region: typeof regions[number]) => resolveSheetTemplateRegionRect(template, region, context.displayDurationFrames, {
    paperTracks: context.paperTracks, timelineLanes: context.timelineLanes, layoutOverrides: project.sheetView.layoutOverrides,
  })
  const primary = [
    ...regions.filter(region => region.binding?.target === 'cut-metadata' && region.binding.field === 'cut').map(region => ({
      regionId: region.regionId, rect: rectFor(region),
      style: resolveSheetTemplateTextStyle(template, pageSize, region.textStyle, { fontSizePx: 22, minFontSizePx: 10, paddingPx: 8, fontWeight: 700 }),
      groupedStyle: resolveSheetTemplateTextStyle(template, pageSize, { ...region.textStyle, ...region.textStyleVariants?.sharedCutNumbersVisible }, { fontSizePx: 22, minFontSizePx: 10, paddingPx: 8, fontWeight: 700 }),
    })),
    ...fields.filter(field => field.definition.builtinBinding?.field === 'cut').map(field => {
      const style = resolveSheetTemplateTextStyle(template, pageSize, field.textStyle, { fontWeight: 700 })
      return { regionId: field.key, rect: field.rect, style, groupedStyle: style }
    }),
  ]
  const shared = regions.flatMap(region => {
    if (region.binding?.target !== 'cut-group' || region.binding.field !== 'shared-cut-numbers') return []
    const group = { labels, opening: region.binding.opening ?? '[', closing: region.binding.closing ?? ']', separator: region.binding.separator ?? '・' }
    return [{ regionId: region.regionId, rect: rectFor(region), group,
      style: resolveSheetTemplateTextStyle(template, pageSize, region.textStyle, { fontSizePx: 12, minFontSizePx: 7, paddingPx: 2, fontWeight: 700 }) }]
  })
  const fallbackStyle = resolveSheetTemplateTextStyle(template, pageSize, {}, { fontSizePx: 12, minFontSizePx: 7, lineHeightRatio: 14 / 12, paddingPx: 2, fontWeight: 700 })
  const rendered = new Set<string>()
  const items: SheetMetadataTextRenderItem[] = []
  const groupText = (group: CutHeaderTextBlock['group']) => group ? group.opening + group.labels.join(group.separator) + group.closing : primaryText
  const render = (sources: Array<{ regionId: string; style: ResolvedSheetTemplateTextStyle; group?: CutHeaderTextBlock['group'] }>, rect: typeof primary[number]['rect']) => {
    const blocks = sources.map(source => ({ text: groupText(source.group), style: source.style, group: source.group }))
    const layouts = layoutCutHeaderText(blocks, rect, pageSize, measurement)
    sources.forEach((source, index) => items.push({ ...layouts[index], regionId: source.regionId, text: blocks[index].text, field: source.group ? 'shared-cut-numbers' : 'cut' }))
  }
  for (const cut of primary) {
    // An overlapping shared-number region is part of this CUT field. Separate
    // regions keep their own placement; template IDs and fixed percentages play no role.
    const companions = shared.filter(item => !rendered.has(item.regionId)
      && Math.min(item.rect.x + item.rect.w, cut.rect.x + cut.rect.w) - Math.max(item.rect.x, cut.rect.x) > 1e-8
      && Math.min(item.rect.y + item.rect.h, cut.rect.y + cut.rect.h) - Math.max(item.rect.y, cut.rect.y) > 1e-8)
    if (!shared.length) companions.push({ regionId: `${cut.regionId}__shared_cut_numbers`, rect: cut.rect,
      style: fallbackStyle, group: { labels, opening: '[', closing: ']', separator: '・' } })
    render([{ ...cut, style: companions.length ? cut.groupedStyle : cut.style }, ...companions], cut.rect)
    companions.forEach(item => rendered.add(item.regionId))
  }
  for (const item of shared) if (!rendered.has(item.regionId)) render([item], item.rect)
  return items
}
