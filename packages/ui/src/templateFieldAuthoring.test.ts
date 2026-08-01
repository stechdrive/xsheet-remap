import { createEmptySheetFormData, standardA3SheetTemplate, type SheetTemplateFieldDefinition } from '@xsheet-remap/core'
import { describe, expect, it } from 'vitest'
import { sheetFormFieldHasStoredValue, templateFieldChoicesFromText, templateFieldReferenceCount, templateFieldSemanticsLockReason } from './templateFieldAuthoring'

const field: SheetTemplateFieldDefinition = {
  fieldId: 'custom.note',
  label: 'メモ',
  scope: 'cut',
  valueType: 'text',
}

describe('template field authoring', () => {
  it('finds stored values in shared and page buckets', () => {
    const empty = createEmptySheetFormData()
    expect(sheetFormFieldHasStoredValue(empty, field.fieldId)).toBe(false)
    expect(sheetFormFieldHasStoredValue({ ...empty, cut: { [field.fieldId]: { kind: 'text', value: '' } } }, field.fieldId)).toBe(true)
    expect(sheetFormFieldHasStoredValue({ ...empty, pages: { page_1: { [field.fieldId]: { kind: 'text', value: 'x' } } } }, field.fieldId)).toBe(true)
  })

  it('locks semantic changes for builtin or populated project fields', () => {
    const empty = createEmptySheetFormData()
    expect(templateFieldSemanticsLockReason(field, null)).toBeNull()
    expect(templateFieldSemanticsLockReason(field, empty)).toBeNull()
    expect(templateFieldSemanticsLockReason({ ...field, builtinBinding: { target: 'cut-metadata', field: 'title' } }, null)).toContain('固定')
    expect(templateFieldSemanticsLockReason(field, { ...empty, revision: { [field.fieldId]: { kind: 'text', value: 'saved' } } })).toContain('入力済み')
  })

  it('normalizes one choice per line', () => {
    expect(templateFieldChoicesFromText('原画\n 動画 \n\n仕上')).toEqual(['原画', '動画', '仕上'])
  })

  it('counts every form cell that shares a field definition', () => {
    const template = structuredClone(standardA3SheetTemplate)
    const memoRegion = template.regions.find(region => region.form?.cells?.some(cell => cell.fieldId === 'memo.body'))!
    template.regions.push({ ...structuredClone(memoRegion), regionId: 'memo_copy' })

    expect(templateFieldReferenceCount(template, 'memo.body')).toBe(2)
  })
})
