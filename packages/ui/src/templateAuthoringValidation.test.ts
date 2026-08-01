import { describe, expect, it } from 'vitest'
import { standardA3SheetTemplate, type NormalizedRect, type SheetTemplate } from '@xsheet-remap/core'
import { validateTemplateAuthoring } from './templateAuthoringValidation'

describe('template authoring validation', () => {
  it('accepts the complete built-in A3 template', () => {
    const result = validateTemplateAuthoring(cloneStandardTemplate())

    expect(result.canComplete).toBe(true)
    expect(result.issues).toEqual([])
    expect(result.calibrationTargetSource).toBe('explicit')
  })

  it('requires a non-blank template id and name', () => {
    const template = cloneStandardTemplate()
    template.templateId = '  '
    template.name = '\t'

    const result = validateTemplateAuthoring(template)

    expect(issueCodes(result.errors)).toEqual(expect.arrayContaining([
      'template-id-missing',
      'template-name-missing',
    ]))
    expect(result.canComplete).toBe(false)
    expect(result.errors.every(issue => issue.message.length > 10)).toBe(true)
  })

  it('reports duplicate ids, non-positive rectangles, and page overflow with region targets', () => {
    const template = cloneStandardTemplate()
    template.regions = [
      region('duplicate', rect(0.1, 0.1, 0.2, 0.2)),
      region('duplicate', rect(-0.1, 0.2, 0.3, 0.2)),
      region('zero-size', rect(0.2, 0.2, 0, 0.2)),
      region('overflow', rect(0.9, 0.9, 0.2, 0.2)),
    ]

    const result = validateTemplateAuthoring(template)

    expect(issueCodes(result.errors)).toEqual(expect.arrayContaining([
      'region-id-duplicate',
      'region-rect-non-positive',
      'region-rect-outside-page',
    ]))
    expect(result.errors.find(issue => issue.code === 'region-id-duplicate')).toMatchObject({
      field: 'regionId',
      regionId: 'duplicate',
      regionIndex: 1,
    })
    expect(result.canComplete).toBe(false)
  })

  it('blocks blank region labels and invalid grid row counts before export', () => {
    const template = cloneStandardTemplate()
    template.regions[0] = { ...template.regions[0], label: '' }
    const gridIndex = template.regions.findIndex(regionValue => regionValue.grid)
    template.regions[gridIndex] = {
      ...template.regions[gridIndex],
      grid: { ...template.regions[gridIndex].grid!, rowCount: 0 },
    }

    const result = validateTemplateAuthoring(template)

    expect(issueCodes(result.errors)).toEqual(expect.arrayContaining([
      'region-label-missing',
      'region-grid-row-count-invalid',
    ]))
    expect(result.canComplete).toBe(false)
  })

  it('uses the core parser as the final save-format contract', () => {
    const template = cloneStandardTemplate()
    template.page.widthPx = 0

    const result = validateTemplateAuthoring(template)

    expect(issueCodes(result.errors)).toContain('template-schema-invalid')
    expect(result.errors.find(issue => issue.code === 'template-schema-invalid')?.message).toContain('ページ寸法')
  })

  it('can defer the deep import contract during ordinary typing', () => {
    const template = cloneStandardTemplate()
    template.page.widthPx = 0

    expect(issueCodes(validateTemplateAuthoring(template, { deep: false }).errors)).not.toContain('template-schema-invalid')
    expect(issueCodes(validateTemplateAuthoring(template).errors)).toContain('template-schema-invalid')
  })

  it('reports authoring-name, printed-label, input-label, and binding-id problems on their regions', () => {
    const template = cloneStandardTemplate()
    const heading = template.regions.find(regionValue => regionValue.regionId === 'top_metadata_form')!
    heading.authoringName = '  '
    heading.form!.cells!.find(cell => cell.kind === 'label')!.label = ''
    template.fields!.find(field => field.fieldId === 'memo.body')!.label = ''
    const choiceField = template.fields!.find(field => field.fieldId === 'memo.body')!
    choiceField.valueType = 'choice'
    choiceField.choices = []
    const annotation = template.regions.find(regionValue => regionValue.binding?.target === 'annotation-layer')!
    annotation.binding = { target: 'annotation-layer', layerId: '', intent: 'memo' }

    const result = validateTemplateAuthoring(template)

    expect(issueCodes(result.errors)).toEqual(expect.arrayContaining([
      'region-authoring-name-invalid',
      'region-fixed-label-missing',
      'field-label-missing',
      'field-choice-missing',
      'region-binding-id-missing',
    ]))
    expect(result.errors.filter(issue => issue.code === 'region-fixed-label-missing')[0]?.regionId).toBe('top_metadata_form')
    expect(result.errors.filter(issue => issue.code === 'region-binding-id-missing')[0]?.regionId).toBe(annotation.regionId)
  })

  it('blocks completion when every region is display-only', () => {
    const template = cloneStandardTemplate()
    template.regions = template.regions.map(regionValue => ({
      ...regionValue,
      usage: 'render-only',
      inputKind: undefined,
      inputMode: undefined,
    }))

    const result = validateTemplateAuthoring(template)

    expect(issueCodes(result.errors)).toContain('input-region-missing')
    expect(result.errors.find(issue => issue.code === 'input-region-missing')?.message).toContain('1つ以上追加')
    expect(result.canComplete).toBe(false)
  })

  it('warns when physical reference-image density differs and ignores unavailable metadata', () => {
    const mismatched = cloneStandardTemplate()
    mismatched.page.dpi = 150
    mismatched.defaultUnderlay = {
      ...mismatched.defaultUnderlay!,
      imageRef: {
        ...mismatched.defaultUnderlay!.imageRef,
        ppiX: 300,
        ppiY: 300,
      },
    }

    const mismatchResult = validateTemplateAuthoring(mismatched)

    expect(issueCodes(mismatchResult.warnings)).toContain('reference-image-ppi-mismatch')
    expect(mismatchResult.canComplete).toBe(true)
    expect(mismatchResult.warnings.find(issue => issue.code === 'reference-image-ppi-mismatch')?.message).toContain('300 × 300')

    const withoutDensity = cloneStandardTemplate()
    withoutDensity.defaultUnderlay = {
      ...withoutDensity.defaultUnderlay!,
      imageRef: {
        ...withoutDensity.defaultUnderlay!.imageRef,
        ppiX: undefined,
        ppiY: undefined,
      },
      placement: undefined,
    }
    expect(issueCodes(validateTemplateAuthoring(withoutDensity).warnings)).not.toContain('reference-image-ppi-mismatch')
  })

  it('reports calibration fallback and missing targets only for physical templates', () => {
    const fallback = cloneStandardTemplate()
    fallback.calibration = undefined

    const fallbackResult = validateTemplateAuthoring(fallback)

    expect(fallbackResult.calibrationTargetSource).toBe('grid-bounds')
    expect(issueCodes(fallbackResult.warnings)).toContain('calibration-target-fallback')

    const missing = cloneStandardTemplate()
    missing.calibration = undefined
    missing.regions = [region('memo', rect(0.1, 0.1, 0.8, 0.8))]
    const missingResult = validateTemplateAuthoring(missing)
    expect(missingResult.calibrationTargetSource).toBe('none')
    expect(issueCodes(missingResult.warnings)).toContain('calibration-target-missing')

    missing.page.isPhysical = false
    expect(issueCodes(validateTemplateAuthoring(missing).warnings)).not.toContain('calibration-target-missing')
  })

  it('rejects an explicit calibration target outside the page', () => {
    const template = cloneStandardTemplate()
    template.calibration = { targetRect: rect(0.2, 0.2, 0.9, 0.4) }

    const result = validateTemplateAuthoring(template)

    expect(result.calibrationTargetSource).toBe('explicit')
    expect(issueCodes(result.errors)).toContain('calibration-target-invalid')
    expect(result.canComplete).toBe(false)
  })
})

function cloneStandardTemplate(): SheetTemplate {
  return structuredClone(standardA3SheetTemplate)
}

function region(regionId: string, rectValue: NormalizedRect): SheetTemplate['regions'][number] {
  return {
    regionId,
    type: 'memo-area',
    label: regionId,
    rect: rectValue,
    usage: 'input',
    inputKind: 'text',
  }
}

function rect(x: number, y: number, w: number, h: number): NormalizedRect {
  return { x, y, w, h }
}

function issueCodes(issues: readonly { code: string }[]): string[] {
  return issues.map(issue => issue.code)
}
