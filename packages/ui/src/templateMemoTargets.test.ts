import { describe, expect, it } from 'vitest'
import {
  digitalStandardSheetTemplate,
  standardA3SheetTemplate,
} from '@xsheet-remap/core'
import {
  resolveTemplateFormCellMemoTarget,
  resolveTemplateRegionMemoTarget,
} from './templateMemoTargets'

describe('template memo logical targets', () => {
  it('maps paper and digital metadata fields to the same logical identity', () => {
    const paperTitle = standardA3SheetTemplate.regions.find(region => region.regionId === 'top_title_field')!
    const digitalRegion = digitalStandardSheetTemplate.regions.find(region => region.regionId === 'digital_metadata_form')!
    const digitalCell = digitalRegion.form!.cells!.find(cell => cell.cellId === 'digital_title_box')!
    const digitalDefinition = digitalStandardSheetTemplate.fields!.find(field => field.fieldId === digitalCell.fieldId)!

    expect(resolveTemplateRegionMemoTarget(paperTitle).logicalTargetId).toBe('metadata:title')
    expect(resolveTemplateFormCellMemoTarget(
      digitalRegion,
      digitalCell,
      digitalDefinition.label,
      digitalDefinition,
    )?.logicalTargetId).toBe('metadata:title')
  })

  it('maps paper and digital memo areas to the same logical identity', () => {
    const paperRegion = standardA3SheetTemplate.regions.find(region => region.regionId === 'top_memo_area')!
    const paperCell = paperRegion.form!.cells!.find(cell => cell.cellId === 'memo_body')!
    const paperDefinition = standardA3SheetTemplate.fields!.find(field => field.fieldId === paperCell.fieldId)!
    const digitalRegion = digitalStandardSheetTemplate.regions.find(region => region.regionId === 'digital_memo_area')!
    const digitalCell = digitalRegion.form!.cells!.find(cell => cell.cellId === 'digital_memo_box')!

    expect(resolveTemplateFormCellMemoTarget(
      paperRegion,
      paperCell,
      paperDefinition.label,
      paperDefinition,
    )?.logicalTargetId).toBe('memo:main')
    expect(resolveTemplateFormCellMemoTarget(
      digitalRegion,
      digitalCell,
      'MEMO',
    )?.logicalTargetId).toBe('memo:main')
  })
})
