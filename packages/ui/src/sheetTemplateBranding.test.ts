import { describe, expect, it } from 'vitest'
import { digitalStandardSheetTemplate, standardA3SheetTemplate, resolveSheetTemplatePageSize,
  withSheetTemplatePaperTracks, type SheetTemplate } from '@xsheet-remap/core'
import { buildTemplateChromeRenderModel } from './templateEditorGeometry'
import { buildSheetTemplateBranding } from './sheetTemplateBranding'
import { createTemplateDraft, ensureEditableTemplateDraft, finalizeTemplateDraftForApply } from './templateDrafts'
import { templateChromePaperModel } from './canvasKitTemplateModel'

describe('standard sheet app link', () => {
  it.each([standardA3SheetTemplate, digitalStandardSheetTemplate])('fits outside the working fields on $name', template => {
    const model = buildTemplateChromeRenderModel(template)
    const { qrRect: qr, name } = model.branding!
    expect(qr.w * model.pageSize.widthPx).toBeCloseTo(qr.h * model.pageSize.heightPx)
    expect(qr.x + qr.w).toBeLessThan(1)
    expect(qr.y).toBeGreaterThan(0)
    for (const { rect } of [...model.formBoxes, ...model.formFields]) {
      expect(qr.x >= rect.x + rect.w || qr.x + qr.w <= rect.x || qr.y >= rect.y + rect.h || qr.y + qr.h <= rect.y,
        'QR and its white margin must not overlap any form').toBe(true)
    }
    const bottom = Math.max(...model.headers.map(header => header.rect.y + header.rect.h),
      ...template.regions.map(region => region.rect.y + region.rect.h))
    expect(name.y).toBeGreaterThan(bottom)
    expect(name.y).toBeLessThan(1)
    expect(name.text).toBe('xsheet-remap')
    const direct = templateChromePaperModel(model, true, true)
    expect(direct.primitives.filter(item => item.style.startsWith('branding'))).toHaveLength(3)
    expect(templateChromePaperModel(model, true, false).primitives.some(item => item.style.startsWith('branding'))).toBe(false)
  })

  it.each([standardA3SheetTemplate, digitalStandardSheetTemplate])('hides on copies, authored and externally edited $name templates', template => {
    const customized = structuredClone(template)
    customized.theme.ink.text = '#123456' // Even an external JSON retaining the built-in ID is custom.
    for (const custom of [customized, ensureEditableTemplateDraft(template),
      createTemplateDraft('duplicate-current', template), createTemplateDraft('paper-standard', template),
      createTemplateDraft('digital-standard', template)]) {
      expect(buildTemplateChromeRenderModel(custom).branding).toBeNull()
      expect(buildTemplateChromeRenderModel(JSON.parse(JSON.stringify(custom)) as SheetTemplate).branding).toBeNull()
    }
    expect(buildTemplateChromeRenderModel(finalizeTemplateDraftForApply(template)).branding).not.toBeNull()
    expect(buildTemplateChromeRenderModel(JSON.parse(JSON.stringify(template)) as SheetTemplate).branding).not.toBeNull()
  })

  it('keeps branding anchored when logical digital columns and duration grow; custom metadata keeps its full width', () => {
    const template = withSheetTemplatePaperTracks(digitalStandardSheetTemplate, Array.from({ length: 20 }, (_, i) => `L${i}`))
    const size = resolveSheetTemplatePageSize(template, 500)
    expect(size.widthPx).toBeGreaterThan(digitalStandardSheetTemplate.page.widthPx)
    expect(size.heightPx).toBeGreaterThan(digitalStandardSheetTemplate.page.heightPx)
    const branding = buildSheetTemplateBranding(template, size)!
    expect((branding.qrRect.x + branding.qrRect.w) * size.widthPx).toBeCloseTo(size.widthPx - 32)
    expect(branding.qrRect.y * size.heightPx).toBe(24)
    expect(branding.name.y * size.heightPx).toBe(size.heightPx - 40)
    const builtIn = buildTemplateChromeRenderModel(digitalStandardSheetTemplate)
    const custom = buildTemplateChromeRenderModel(ensureEditableTemplateDraft(digitalStandardSheetTemplate))
    const right = (model: typeof builtIn, id: string) => Math.max(...model.formBoxes
      .filter(box => box.key.startsWith(id + ':')).map(box => (box.rect.x + box.rect.w) * model.pageSize.widthPx))
    expect(right(custom, 'digital_metadata_form')).toBeCloseTo(1888)
    expect(right(builtIn, 'digital_metadata_form')).toBeCloseTo(1765)
    expect(right(custom, 'digital_memo_area')).toBeCloseTo(right(builtIn, 'digital_memo_area'))
  })
})
