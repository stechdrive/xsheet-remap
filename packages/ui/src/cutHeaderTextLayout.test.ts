import { describe, expect, it } from 'vitest'
import { addOverlayPaperTrack, createProjectFromTemplate, digitalStandardSheetTemplate, standardA3SheetTemplate, type SheetTemplate } from '@xsheet-remap/core'
import { createSheetRenderModelContext, metadataTextRenderItemsForPage } from './sheetRenderModel'
import { layoutCutHeaderText } from './cutHeaderTextLayout'
import { SHEET_TEXT_FONT_FAMILY, type TextMeasurementProvider } from './textMetrics'

const measurement: TextMeasurementProvider = { measure: (text, font) => ({
  widthPx: Array.from(text).length * font.sizePx * 0.65,
  ascentPx: font.sizePx * 0.95, descentPx: font.sizePx * 0.3, exact: true,
}) }
const style = { fontSizePx: 32, minFontSizePx: 10, lineHeightPx: 36, paddingPx: 3, fontWeight: 700,
  horizontalAlign: 'center', verticalAlign: 'middle', shrinkToFit: true, overflowX: 'clip', overflowY: 'clip' } as const

describe('bounded cut-header layout', () => {
  it('uses the actual combined height and keeps the preferred sizes when the field has space', () => {
    const result = layoutCutHeaderText([
      { text: '001', style },
      { text: '[002・003]', group: { labels: ['002', '003'], opening: '[', closing: ']', separator: '・' }, style: { ...style, fontSizePx: 14, minFontSizePx: 7, lineHeightPx: 16 } },
    ], { x: 0, y: 0, w: 1, h: 1 }, { widthPx: 180, heightPx: 120 }, measurement)
    expect(result.map(item => item.fontSizePx)).toEqual([32, 14])
    expect(result.map(item => item.overflow)).toEqual([false, false])
    expect(result[1].rect.y).toBeGreaterThanOrEqual(result[0].rect.y + result[0].rect.h)
    expect(result[1].lines).toEqual(['[002・003]'])
  })

  it('shrinks the combined block in both axes, including line spacing', () => {
    const result = layoutCutHeaderText([{ text: '001', style }, { text: '002', style }],
      { x: 0, y: 0, w: 1, h: 1 }, { widthPx: 180, heightPx: 50 }, measurement)
    expect(result.every(item => item.fontSizePx < 32 && !item.overflow)).toBe(true)
    expect(result[1].rect.y + result[1].rect.h).toBeLessThanOrEqual(1.00001)
    expect(result[1].rect.y).toBeGreaterThanOrEqual(result[0].rect.y + result[0].rect.h)
  })

  it('marks omitted text explicitly without leaking into neighboring fields or splitting graphemes', () => {
    const result = layoutCutHeaderText([{ text: 'か\u3099'.repeat(20), style: { ...style, shrinkToFit: false } }],
      { x: .1, y: .1, w: .8, h: .8 }, { widthPx: 100, heightPx: 100 }, measurement)[0]
    expect(result.fontSizePx).toBe(32)
    expect(result.overflow).toBe(true)
    expect(result.lines[0]).toMatch(/^(か\u3099)*…$/)
    const tiny = layoutCutHeaderText([{ text: '001', style }, { text: '[002]', style }],
      { x: 0, y: 0, w: 1, h: 1 }, { widthPx: 2, heightPx: 2 }, measurement)
    expect(tiny.every(item => item.lines.length === 0 && item.overflow)).toBe(true)
  })
})

function oversizedDigital(): SheetTemplate {
  const template = structuredClone(digitalStandardSheetTemplate)
  const field = template.regions.flatMap(region => region.form?.cells ?? []).find(cell => cell.fieldId === 'digital.cut')!
  field.textStyle = { ...field.textStyle, fontSize: { value: 48, unit: 'px' }, lineHeight: { value: 64, unit: 'px' } }
  return template
}
const fallbackPaper = { ...standardA3SheetTemplate, regions: standardA3SheetTemplate.regions.filter(region => region.binding?.target !== 'cut-group') }
const paper300 = { ...standardA3SheetTemplate, page: { ...standardA3SheetTemplate.page, widthPx: 3508, heightPx: 4962, dpi: 300 } }

describe('cut headers across template geometry', () => {
  for (const [name, template] of [['paper', standardA3SheetTemplate], ['digital', digitalStandardSheetTemplate], ['custom large font', oversizedDigital()], ['legacy fallback', fallbackPaper], ['300 DPI paper', paper300]] as const) {
    for (const count of [1, 6, 40]) it(`${name}: ${count} shared cuts never overlap or escape the CUT field`, () => {
      let project = createProjectFromTemplate(template)
      if (name === 'digital') for (let index = 0; index < 5; index++) project = addOverlayPaperTrack(project, { insertAfterPaperTrack: project.logicalSheet.paperTracks.at(-1)!.paperTrack }).project
      const cuts = Array.from({ length: count + 1 }, (_, index) => ({ cutId: String(index), order: index, metadata: { cut: String(index + 1).padStart(3, '0') } }))
      const context = createSheetRenderModelContext(project, template, { cutGroup: { activeCutId: '0', cuts } })
      const plain = metadataTextRenderItemsForPage(createSheetRenderModelContext(project, template), context.pages[0], measurement)
      const field = plain.find(item => item.field === 'cut')!.rect
      const items = metadataTextRenderItemsForPage(context, context.pages[0], measurement).filter(item => item.field === 'cut' || item.field === 'shared-cut-numbers')
      expect(items).toHaveLength(2)
      let inkBottom = field.y * context.pageSize.heightPx
      for (const item of items) {
        expect(item.dominantBaseline).toBe('alphabetic')
        expect(item.clipRect.y).toBeGreaterThanOrEqual(field.y - 1e-8)
        expect(item.clipRect.y + item.clipRect.h).toBeLessThanOrEqual(field.y + field.h + 1e-8)
        for (const [index, line] of item.lines.entries()) {
          const metrics = measurement.measure(line, { family: SHEET_TEXT_FONT_FAMILY, sizePx: item.fontSizePx, weight: item.fontWeight })
          const baseline = item.y * context.pageSize.heightPx + index * item.lineHeightPx
          expect(baseline - metrics.ascentPx).toBeGreaterThanOrEqual(inkBottom - 0.01)
          inkBottom = baseline + metrics.descentPx
          expect(inkBottom).toBeLessThanOrEqual((field.y + field.h) * context.pageSize.heightPx + 0.01)
          expect(metrics.widthPx).toBeLessThanOrEqual(field.w * context.pageSize.widthPx + 0.01)
        }
      }
      const shared = items[1]
      expect(shared.text).toContain(cuts.at(-1)!.metadata.cut)
      if (count === 1) expect(shared.lines).toEqual(['[002]'])
      if (count === 40) { expect(shared.overflow).toBe(true); expect(shared.lines.at(-1)).toMatch(/…$/) }
    })
  }

  it('respects a dedicated shared-cut region outside the CUT field', () => {
    const template = structuredClone(standardA3SheetTemplate)
    const dedicated = template.regions.find(region => region.binding?.target === 'cut-group')!
    dedicated.rect = { x: .1, y: .15, w: .2, h: .05 }
    const project = createProjectFromTemplate(template)
    const context = createSheetRenderModelContext(project, template, { cutGroup: { activeCutId: '1', cuts: [
      { cutId: '1', order: 0, metadata: { cut: '001' } }, { cutId: '2', order: 1, metadata: { cut: '002' } },
    ] } })
    const items = metadataTextRenderItemsForPage(context, context.pages[0], measurement)
    const main = items.find(item => item.field === 'cut')!, shared = items.find(item => item.field === 'shared-cut-numbers')!
    const original = template.regions.find(region => region.regionId === main.regionId)!.rect
    expect(main.rect.y + main.rect.h / 2).toBeCloseTo(original.y + original.h / 2)
    expect(shared.rect.x).toBe(dedicated.rect.x)
    expect(shared.rect.y).toBeGreaterThanOrEqual(dedicated.rect.y)
    expect(shared.rect.y + shared.rect.h).toBeLessThanOrEqual(dedicated.rect.y + dedicated.rect.h)
  })
})
