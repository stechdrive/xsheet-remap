import { describe, expect, it } from 'vitest'
import { createDefaultProject } from './project-model'
import { normalizeSheetFormData, resolveSheetFormFieldValue, sheetFormFieldValueText, updateSheetFormField } from './sheet-form-data'

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

  it('stores page fields independently and requires an explicit page id', () => {
    const definition = { fieldId: 'memo.body', scope: 'page' as const, valueType: 'multiline' as const }
    const first = updateSheetFormField(createDefaultProject(), definition, '1ページのメモ', 'page_1')
    const second = updateSheetFormField(first, definition, '2ページのメモ', 'page_2')

    expect(second.sheetFormData.pages).toEqual({
      page_1: { 'memo.body': { kind: 'text', value: '1ページのメモ' } },
      page_2: { 'memo.body': { kind: 'text', value: '2ページのメモ' } },
    })
    expect(() => updateSheetFormField(second, definition, 'ページ不明')).toThrow('ページIDがありません')
  })

  it('drops malformed external values while preserving valid tagged values', () => {
    expect(normalizeSheetFormData({
      production: { valid: { kind: 'text', value: '作品' }, invalid: { kind: 'number', value: 'NaN' } },
      cut: null,
      revision: { checked: { kind: 'boolean', value: true } },
      pages: {
        page_1: { memo: { kind: 'text', value: '備考' }, invalid: { kind: 'number', value: 'NaN' } },
        empty: { invalid: true },
      },
    })).toEqual({
      production: { valid: { kind: 'text', value: '作品' } },
      cut: {},
      revision: { checked: { kind: 'boolean', value: true } },
      pages: { page_1: { memo: { kind: 'text', value: '備考' } } },
    })
  })

  it('uses a field default only when its declared scope has no stored value', () => {
    const source = createDefaultProject().sheetFormData
    const definition = {
      fieldId: 'workflow.status',
      scope: 'cut' as const,
      valueType: 'choice' as const,
      defaultValue: '未着手',
    }
    const wrongScope = {
      ...source,
      production: { 'workflow.status': { kind: 'choice' as const, value: '作品共通' } },
    }
    const stored = {
      ...wrongScope,
      cut: { 'workflow.status': { kind: 'choice' as const, value: '作業中' } },
    }

    expect(resolveSheetFormFieldValue(source, definition)).toEqual({ kind: 'choice', value: '未着手' })
    expect(resolveSheetFormFieldValue(wrongScope, definition)).toEqual({ kind: 'choice', value: '未着手' })
    expect(resolveSheetFormFieldValue(stored, definition)).toEqual({ kind: 'choice', value: '作業中' })
  })

  it('resolves page defaults independently and treats an explicitly empty value as stored', () => {
    const definition = {
      fieldId: 'memo.body',
      scope: 'page' as const,
      valueType: 'multiline' as const,
      defaultValue: '未記入メモ',
    }
    const data = {
      ...createDefaultProject().sheetFormData,
      pages: {
        page_1: { 'memo.body': { kind: 'text' as const, value: '' } },
        page_2: { 'memo.body': { kind: 'text' as const, value: '2ページ目' } },
      },
    }

    expect(resolveSheetFormFieldValue(data, definition, 'page_1')).toEqual({ kind: 'text', value: '' })
    expect(resolveSheetFormFieldValue(data, definition, 'page_2')).toEqual({ kind: 'text', value: '2ページ目' })
    expect(resolveSheetFormFieldValue(data, definition, 'page_3')).toEqual({ kind: 'text', value: '未記入メモ' })
  })
})
