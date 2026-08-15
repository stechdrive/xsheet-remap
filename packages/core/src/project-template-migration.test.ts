import { describe, expect, it } from 'vitest'
import {
  createDefaultProject,
  createProjectDocumentFromCutProject,
  digitalStandardSheetTemplate,
  parseProjectDocument,
  type SheetTemplate,
} from './index'

describe('built-in project template migrations', () => {
  it('refreshes the embedded built-in digital template and preserves removed PAGE annotations on the page', () => {
    const legacyTemplate = legacyDigitalTemplateWithPage()
    const project = {
      ...createDefaultProject(),
      studioPresetId: 'digital-standard',
      sheetTemplateId: legacyTemplate.templateId,
    }
    const raw = createProjectDocumentFromCutProject(project, { sheetTemplate: legacyTemplate })
    raw.studioPresetId = 'digital-standard'
    raw.cuts[0]!.revisions[0]!.memos.push({
      kind: 'page',
      memoId: 'memo_removed_page_field',
      target: {
        kind: 'template-region',
        pageId: 'page_1',
        templateId: legacyTemplate.templateId,
        regionId: 'digital_metadata_form',
        targetId: 'cell:digital_page_box',
        logicalTargetId: 'metadata:page',
        targetRect: { x: 0.8, y: 0.1, w: 0.1, h: 0.05 },
      },
      strokes: [{
        annotationId: 'stroke_removed_page_field',
        pageId: 'page_1',
        tool: 'pen',
        color: '#000000',
        width: 0.001,
        points: [{ x: 0.01, y: 0.02 }],
        coordinateSpace: 'memo-target',
        anchor: {
          kind: 'view-surface',
          templateId: legacyTemplate.templateId,
          pageId: 'page_1',
          regionId: 'digital_metadata_form',
          targetId: 'cell:digital_page_box',
          logicalTargetId: 'metadata:page',
        },
      }],
      texts: [],
      order: 1,
    })

    const parsed = parseProjectDocument(raw)
    const migratedMemo = parsed.cuts[0]!.revisions[0]!.memos.find(memo => memo.memoId === 'memo_removed_page_field')

    expect(parsed.sheetTemplate.fields?.some(field => field.builtinBinding?.field === 'page')).toBe(false)
    expect(migratedMemo).toMatchObject({
      kind: 'page',
      target: { kind: 'page', pageId: 'page_1' },
      strokes: [{ coordinateSpace: 'view-surface' }],
    })
    if (migratedMemo?.kind !== 'page') throw new Error('migrated page memo not found')
    expect(migratedMemo.strokes[0]?.points[0]?.x).toBeCloseTo(0.81)
    expect(migratedMemo.strokes[0]?.points[0]?.y).toBeCloseTo(0.12)
  })

  it('never refreshes a custom template that only retains the digital preset selection', () => {
    const customTemplate = legacyDigitalTemplateWithPage()
    customTemplate.templateId = 'studio-custom-infinite'
    const project = {
      ...createDefaultProject(),
      studioPresetId: 'digital-standard',
      sheetTemplateId: customTemplate.templateId,
    }
    const raw = createProjectDocumentFromCutProject(project, { sheetTemplate: customTemplate })
    raw.studioPresetId = 'digital-standard'

    const parsed = parseProjectDocument(raw)

    expect(parsed.sheetTemplate.templateId).toBe('studio-custom-infinite')
    expect(parsed.sheetTemplate.fields?.some(field => field.fieldId === 'digital.page')).toBe(true)
  })
})

function legacyDigitalTemplateWithPage(): SheetTemplate {
  const template = structuredClone(digitalStandardSheetTemplate)
  template.fields!.push({
    fieldId: 'digital.page',
    label: 'ページ数',
    scope: 'page',
    valueType: 'text',
    builtinBinding: { target: 'cut-metadata', field: 'page' },
  })
  const form = template.regions.find(region => region.regionId === 'digital_metadata_form')!.form!
  form.columns.push(12, 214)
  form.columnFlex!.push(0, 0)
  form.cells!.push(
    { cellId: 'digital_page_label', row: 0, column: 12, kind: 'label', label: 'ページ数' },
    { cellId: 'digital_page_box', row: 1, column: 12, kind: 'field', fieldId: 'digital.page' },
  )
  return template
}
