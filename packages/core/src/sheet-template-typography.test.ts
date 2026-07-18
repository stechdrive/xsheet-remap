import { describe, expect, it } from 'vitest'
import { digitalStandardSheetTemplate, standardA3SheetTemplate } from './sheet-template-presets'
import { resolveSheetTemplateTextStyle, sheetTemplateDesignDpi } from './sheet-template-typography'

describe('sheet template typography', () => {
  it('resolves the A3 MEMO physical metrics to the original 150 dpi design pixels', () => {
    const memo = standardA3SheetTemplate.regions
      .find(region => region.regionId === 'top_memo_area')
      ?.form?.cells?.find(cell => cell.cellId === 'memo_body')
    const resolved = resolveSheetTemplateTextStyle(
      standardA3SheetTemplate,
      standardA3SheetTemplate.page,
      memo?.textStyle,
    )

    expect(resolved).toMatchObject({
      fontSizePx: 16,
      minFontSizePx: 10,
      lineHeightPx: 20,
      paddingPx: 8,
    })
  })

  it('keeps the same physical typography when a paper template uses twice the DPI', () => {
    const memo = standardA3SheetTemplate.regions
      .find(region => region.regionId === 'top_memo_area')
      ?.form?.cells?.find(cell => cell.cellId === 'memo_body')
    const template300 = {
      ...standardA3SheetTemplate,
      page: {
        ...standardA3SheetTemplate.page,
        widthPx: standardA3SheetTemplate.page.widthPx * 2,
        heightPx: standardA3SheetTemplate.page.heightPx * 2,
        dpi: 300,
      },
    }
    const at150 = resolveSheetTemplateTextStyle(standardA3SheetTemplate, standardA3SheetTemplate.page, memo?.textStyle)
    const at300 = resolveSheetTemplateTextStyle(template300, template300.page, memo?.textStyle)

    expect(at300.fontSizePx).toBeCloseTo(at150.fontSizePx * 2)
    expect(at300.lineHeightPx).toBeCloseTo(at150.lineHeightPx * 2)
    expect(at300.paddingPx).toBeCloseTo(at150.paddingPx * 2)
  })

  it('uses digital design pixels and scales them with an enlarged output surface', () => {
    const region = digitalStandardSheetTemplate.regions.find(item => item.regionId === 'digital_title_field')
    const base = resolveSheetTemplateTextStyle(digitalStandardSheetTemplate, digitalStandardSheetTemplate.page, region?.textStyle, {
      fontSizePx: 22,
      minFontSizePx: 10,
      paddingPx: 8,
    })
    const doubled = resolveSheetTemplateTextStyle(digitalStandardSheetTemplate, {
      widthPx: digitalStandardSheetTemplate.page.widthPx * 2,
      heightPx: digitalStandardSheetTemplate.page.heightPx * 2,
    }, region?.textStyle, {
      fontSizePx: 22,
      minFontSizePx: 10,
      paddingPx: 8,
    })

    expect(base.fontSizePx).toBe(22)
    expect(doubled.fontSizePx).toBe(44)
    expect(doubled.paddingPx).toBe(16)
  })

  it('falls back to underlay density when a physical template omits page DPI', () => {
    const template = {
      ...standardA3SheetTemplate,
      page: { ...standardA3SheetTemplate.page, dpi: undefined },
      defaultUnderlay: {
        ...standardA3SheetTemplate.defaultUnderlay!,
        placement: {
          ...standardA3SheetTemplate.defaultUnderlay!.placement!,
          ppiX: 300,
          ppiY: 300,
        },
      },
    }

    expect(sheetTemplateDesignDpi(template)).toBe(300)
  })
})
