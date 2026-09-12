import { describe, expect, it } from 'vitest'
import { digitalStandardSheetTemplate, standardA3SheetTemplate } from './sheet-template'
import { createAlphabeticTrackLabels, createSheetPages, localizeFrameToSheetPage, resolveSheetTemplatePageSize, resolveSheetTemplateRegionRect, resolveSheetTemplateRegionRects } from './sheet-template-layout'

describe('shared authoring layout resolution', () => {
  it('localizes page boundaries and partial last pages with pre-roll and continuous sheets', () => {
    for (const template of [standardA3SheetTemplate, digitalStandardSheetTemplate]) {
      const pages = createSheetPages(template, 14_401, -23)
      for (const page of pages) for (const frame of [page.frameStart, page.frameEnd]) {
        expect(localizeFrameToSheetPage(template, frame, 14_401, -23)?.page).toEqual(page)
      }
      expect(localizeFrameToSheetPage(template, -24, 14_401, -23)).toBeNull()
      expect(localizeFrameToSheetPage(template, 14_378, 14_401, -23)).toBeNull()
    }
  })
  for (const template of [standardA3SheetTemplate, digitalStandardSheetTemplate]) {
    for (const frames of [144, 481]) {
      it(`matches individual resolution for ${template.templateId} at ${frames} frames with expanded tracks`, () => {
        const options = { paperTracks: createAlphabeticTrackLabels(22) }
        const batch = resolveSheetTemplateRegionRects(template, frames, options)
        expect(batch.pageSize).toEqual(resolveSheetTemplatePageSize(template, frames, options))
        for (const region of template.regions) expect(batch.regionRects.get(region.regionId))
          .toEqual(resolveSheetTemplateRegionRect(template, region, frames, options))
        const changed = { ...template, regions: template.regions.map((r, i) => i ? r : { ...r, rect: { ...r.rect, y: r.rect.y + .01 } }) }
        const after = resolveSheetTemplateRegionRects(changed, frames, options)
        expect(after.regionRects.get(changed.regions[0]!.regionId))
          .toEqual(resolveSheetTemplateRegionRect(changed, changed.regions[0]!, frames, options))
      })
    }
  }
})
