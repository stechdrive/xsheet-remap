import { describe, expect, it } from 'vitest'
import { addAnnotation, createDefaultProject, createProjectDocumentFromCutProject, digitalStandardSheetTemplate, parseProjectDocument,
  resolveSheetTemplateGridLayout, resolveSheetTemplatePageSize, standardA3SheetTemplate } from './index'

describe('digital row sizing compatibility', () => {
  it.each([1, 24, 48, 72, 144, 288])('keeps a 20px row and fits the canvas to %i frames', durationFrames => {
    const template = digitalStandardSheetTemplate
    const size = resolveSheetTemplatePageSize(template, durationFrames)
    expect(size.heightPx).toBe(720 + durationFrames * 20)
    for (const region of template.regions.filter(region => region.grid?.frameProjection?.source === 'logical-frames')) {
      const layout = resolveSheetTemplateGridLayout(template, region, { durationFrames })!
      expect(layout.frames.rowHeight * size.heightPx).toBeCloseTo(20)
      expect(layout.rect.h * size.heightPx).toBeCloseTo(durationFrames * 20)
    }
    expect(resolveSheetTemplatePageSize(standardA3SheetTemplate, durationFrames)).toEqual({ widthPx: 1754, heightPx: 2481 })
  })
  it('loads embedded v2 geometry and memo coordinates unchanged, without silently migrating to v3', () => {
    const legacy = structuredClone(digitalStandardSheetTemplate)
    legacy.templateId = 'digital-standard-v2'
    delete legacy.viewLayout!.surface!.heightMode
    for (const region of legacy.regions) if (region.grid) delete region.grid.rowSizing
    const project = addAnnotation({ ...createDefaultProject(), studioPresetId: 'digital-standard', sheetTemplateId: legacy.templateId },
      { kind: 'text', annotationId: 'legacy-note', pageId: 'page_1', x: .2, y: .3, text: 'memo', color: '#000000', fontSizePx: 18 })
    const doc = createProjectDocumentFromCutProject(project, { sheetTemplate: legacy })
    const loaded = parseProjectDocument(JSON.parse(JSON.stringify(doc)))
    expect(loaded.sheetTemplate).toEqual(legacy)
    expect(loaded.cuts[0].revisions[0].memos).toEqual(doc.cuts[0].revisions[0].memos)
    const region = legacy.regions.find(region => region.regionId === 'digital_cell_grid')!
    const layout = resolveSheetTemplateGridLayout(loaded.sheetTemplate, region, { durationFrames: 24 })!
    expect(layout.pageSize.heightPx).toBe(3600)
    expect(layout.frames.rowHeight * layout.pageSize.heightPx).toBeCloseTo(120)
  })
})
