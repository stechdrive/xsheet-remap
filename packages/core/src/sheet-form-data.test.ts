import { describe, expect, it } from 'vitest'
import { createDefaultProject } from './project-model'
import { normalizeSheetFormData, sheetFormFieldValueText, updateSheetFormField } from './sheet-form-data'

describe('sheet form data', () => {
  it('keeps typed values in their declared scope', () => {
    const project = updateSheetFormField(createDefaultProject(), {
      fieldId: 'output.sizeX',
      scope: 'cut',
      valueType: 'number',
    }, '1920')
    const updated = updateSheetFormField(project, {
      fieldId: 'process.animationDirector.final',
      scope: 'revision',
      valueType: 'text',
    }, '山田')

    expect(updated.sheetFormData.cut['output.sizeX']).toEqual({ kind: 'number', value: 1920 })
    expect(updated.sheetFormData.revision['process.animationDirector.final']).toEqual({ kind: 'text', value: '山田' })
    expect(sheetFormFieldValueText(updated.sheetFormData.cut['output.sizeX'])).toBe('1920')
  })

  it('drops malformed external values while preserving valid tagged values', () => {
    expect(normalizeSheetFormData({
      production: { valid: { kind: 'text', value: '作品' }, invalid: { kind: 'number', value: 'NaN' } },
      cut: null,
      revision: { checked: { kind: 'boolean', value: true } },
    })).toEqual({
      production: { valid: { kind: 'text', value: '作品' } },
      cut: {},
      revision: { checked: { kind: 'boolean', value: true } },
    })
  })
})
