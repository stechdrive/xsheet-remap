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
})
