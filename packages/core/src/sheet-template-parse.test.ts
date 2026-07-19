import { describe, expect, it } from 'vitest'
import { parseSheetTemplate } from './sheet-template-parse'
import { standardA3SheetTemplate } from './sheet-template-presets'

describe('parseSheetTemplate', () => {
  it('accepts a complete template value', () => {
    expect(parseSheetTemplate(structuredClone(standardA3SheetTemplate)).templateId).toBe(standardA3SheetTemplate.templateId)
  })

  it('rejects obsolete template schema versions during development', () => {
    const template = { ...structuredClone(standardA3SheetTemplate), schemaVersion: 4 }
    expect(() => parseSheetTemplate(template)).toThrow('対応していないシートテンプレートバージョン')
  })

  it('rejects duplicate region identifiers', () => {
    const template = structuredClone(standardA3SheetTemplate)
    template.regions[1]!.regionId = template.regions[0]!.regionId
    expect(() => parseSheetTemplate(template)).toThrow('領域IDが重複')
  })

  it('rejects regions outside the normalized page', () => {
    const template = structuredClone(standardA3SheetTemplate)
    template.regions[0]!.rect.x = 0.99
    template.regions[0]!.rect.w = 0.2
    expect(() => parseSheetTemplate(template)).toThrow('矩形が不正')
  })

  it('accepts render-only decorative grids and rejects interactive decorative regions', () => {
    const template = structuredClone(standardA3SheetTemplate)
    expect(parseSheetTemplate(template).regions.some(region => region.type === 'decorative' && region.grid)).toBe(true)

    const invalid = structuredClone(standardA3SheetTemplate)
    const reserve = invalid.regions.find(region => region.regionId === 'left_action_reserve_grid')!
    reserve.usage = 'input'
    expect(() => parseSheetTemplate(invalid)).toThrow('描画専用')
  })

  it('accepts page-scoped multiline fields and rejects unknown field scopes', () => {
    const template = structuredClone(standardA3SheetTemplate)
    expect(parseSheetTemplate(template).fields?.find(field => field.fieldId === 'memo.body')).toMatchObject({
      scope: 'page',
      valueType: 'multiline',
    })

    const invalid = structuredClone(standardA3SheetTemplate) as unknown as { fields: Array<Record<string, unknown>> }
    invalid.fields[0]!.scope = 'sheet'
    expect(() => parseSheetTemplate(invalid)).toThrow('フォーム項目定義が不正')
  })

  it('rejects unknown form edit presentations', () => {
    const invalid = structuredClone(standardA3SheetTemplate) as unknown as Record<string, unknown>
    const regions = invalid.regions as Array<Record<string, unknown>>
    const memo = regions.find(region => region.regionId === 'top_memo_area')!
    const form = memo.form as Record<string, unknown>
    const cells = form.cells as Array<Record<string, unknown>>
    cells.find(cell => cell.cellId === 'memo_body')!.editPresentation = 'floating'

    expect(() => parseSheetTemplate(invalid)).toThrow('フォーム定義が不正')
  })

  it('accepts generic memo targets and rejects groups without a stable id', () => {
    const template = structuredClone(standardA3SheetTemplate)
    const process = template.regions.find(region => region.regionId === 'top_process_check_area')!
    const field = process.form!.cells!.find(cell => cell.cellId === 'process_field_original')!
    field.memoTarget = { scope: 'group', targetId: 'rough-check', label: '前半チェック' }
    expect(parseSheetTemplate(template).regions.find(region => region.regionId === process.regionId)?.form?.cells)
      .toEqual(expect.arrayContaining([expect.objectContaining({ memoTarget: { scope: 'group', targetId: 'rough-check', label: '前半チェック' } })]))

    const invalid = structuredClone(template) as unknown as Record<string, unknown>
    const regions = invalid.regions as Array<Record<string, unknown>>
    const cells = ((regions.find(region => region.regionId === 'top_process_check_area')!.form as Record<string, unknown>).cells) as Array<Record<string, unknown>>
    cells.find(cell => cell.cellId === 'process_field_original')!.memoTarget = { scope: 'group' }
    expect(() => parseSheetTemplate(invalid)).toThrow('フォーム定義が不正')
  })

  it('rejects unknown physical typography units', () => {
    const invalid = structuredClone(standardA3SheetTemplate) as unknown as Record<string, unknown>
    const regions = invalid.regions as Array<Record<string, unknown>>
    const memo = regions.find(region => region.regionId === 'top_memo_area')!
    const form = memo.form as Record<string, unknown>
    const cells = form.cells as Array<Record<string, unknown>>
    const body = cells.find(cell => cell.cellId === 'memo_body')!
    const textStyle = body.textStyle as Record<string, unknown>
    textStyle.fontSize = { value: 8, unit: 'inch' }

    expect(() => parseSheetTemplate(invalid)).toThrow('フォーム定義が不正')
  })

  it('accepts axis-specific text overflow and rejects unknown policies', () => {
    const template = structuredClone(standardA3SheetTemplate)
    const shared = template.regions.find(region => region.regionId === 'top_shared_cut_numbers_field')!
    expect(parseSheetTemplate(template).regions.find(region => region.regionId === shared.regionId)?.textStyle)
      .toMatchObject({ overflowY: 'visible' })

    const invalid = structuredClone(template) as unknown as Record<string, unknown>
    const regions = invalid.regions as Array<Record<string, unknown>>
    const textStyle = regions.find(region => region.regionId === shared.regionId)!.textStyle as Record<string, unknown>
    textStyle.overflowX = 'wrap'
    expect(() => parseSheetTemplate(invalid)).toThrow('文字設定が不正')
  })
})
