import { createDefaultSheetTemplateTheme, parseSheetTemplate, SHEET_TEMPLATE_SCHEMA_VERSION, type SheetTemplate } from '@xsheet-remap/core'
import { describe, expect, it } from 'vitest'
import { removeTemplateRegion } from './templateDrafts'

function templateWithRegionReferences(): SheetTemplate {
  return {
    schemaVersion: SHEET_TEMPLATE_SCHEMA_VERSION,
    templateId: 'region-delete-test',
    name: '領域削除テスト',
    theme: createDefaultSheetTemplateTheme(),
    page: { widthPx: 1000, heightPx: 1000, coordinateSpace: 'normalized' },
    defaults: { fps: 24, durationFrames: 24, frameOrigin: 1, paperTracks: ['A'] },
    fields: [
      { fieldId: 'deleted-only', label: '削除対象だけ', scope: 'revision', valueType: 'text' },
      { fieldId: 'shared', label: '共有', scope: 'revision', valueType: 'text' },
      { fieldId: 'unrelated', label: '無関係', scope: 'revision', valueType: 'text' },
    ],
    auxiliaryBands: [{ bandId: 'test-band', anchorRegionIds: ['first'], slotRegionIds: ['second'] }],
    horizontalFlow: { regionIds: ['first', 'second'], leftPx: 20, rightPx: 20 },
    regions: [
      {
        regionId: 'first',
        type: 'form-table',
        label: '削除対象',
        rect: { x: 0, y: 0, w: 0.5, h: 1 },
        usage: 'input',
        form: {
          columns: [1],
          rows: [1, 1],
          cells: [
            { cellId: 'deleted', row: 0, column: 0, kind: 'field', fieldId: 'deleted-only' },
            { cellId: 'shared-first', row: 1, column: 0, kind: 'field', fieldId: 'shared' },
          ],
        },
      },
      {
        regionId: 'second',
        type: 'form-table',
        label: '残す領域',
        rect: { x: 0.5, y: 0, w: 0.5, h: 1 },
        usage: 'input',
        form: {
          columns: [1],
          rows: [1],
          cells: [{ cellId: 'shared-second', row: 0, column: 0, kind: 'field', fieldId: 'shared' }],
        },
      },
    ],
  }
}

describe('removeTemplateRegion', () => {
  it('removes one region and cleans only references made invalid by that deletion', () => {
    const template = templateWithRegionReferences()

    const next = removeTemplateRegion(template, 'first')

    expect(next.regions.map(region => region.regionId)).toEqual(['second'])
    expect(next.horizontalFlow?.regionIds).toEqual(['second'])
    expect(next.auxiliaryBands).toBeUndefined()
    expect(next.fields?.map(field => field.fieldId)).toEqual(['shared', 'unrelated'])
    expect(() => parseSheetTemplate(next)).not.toThrow()
    expect(template.regions.map(region => region.regionId)).toEqual(['first', 'second'])
  })

  it('refuses to delete the last display region', () => {
    const template = templateWithRegionReferences()
    template.regions = [template.regions[0]!]

    expect(() => removeTemplateRegion(template, 'first')).toThrow('最後の1領域は削除できません。')
  })
})
