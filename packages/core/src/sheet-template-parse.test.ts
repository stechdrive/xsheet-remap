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
})
