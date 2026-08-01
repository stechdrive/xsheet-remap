import { describe, expect, it } from 'vitest'
import { parseSheetTemplate } from './sheet-template-parse'
import { digitalStandardSheetTemplate, standardA3SheetTemplate } from './sheet-template-presets'

describe('parseSheetTemplate', () => {
  it('accepts a complete template value', () => {
    expect(parseSheetTemplate(structuredClone(standardA3SheetTemplate)).templateId).toBe(standardA3SheetTemplate.templateId)
  })

  it('rejects malformed top-level renderer and workspace settings', () => {
    const mutations: Array<(template: Record<string, unknown>) => void> = [
      template => { template.templateKind = 'unknown-paper' },
      template => { (template.page as Record<string, unknown>).orientation = 'square' },
      template => { template.defaultUnderlay = {} },
      template => { (template.defaultUnderlay as Record<string, unknown>).imageRef = {} },
      template => { ((template.defaultUnderlay as Record<string, unknown>).placement as Record<string, unknown>).offsetXPx = '0' },
      template => { template.calibration = { targetRect: { x: 0, y: 0, w: 2, h: 1 } } },
      template => { template.style = { outerFrame: { visible: 'yes' } } },
      template => { template.viewLayout = { type: 'paged', frameAxis: { type: 'paged', framesPerPage: 0 } } },
      template => { template.pageModel = { type: 'book' } },
    ]

    for (const mutate of mutations) {
      const invalid = structuredClone(standardA3SheetTemplate) as unknown as Record<string, unknown>
      mutate(invalid)
      expect(() => parseSheetTemplate(invalid)).toThrow()
    }
  })

  it('rejects malformed nested grid, header, projection, and sizing settings', () => {
    const mutations: Array<(grid: Record<string, unknown>) => void> = [
      grid => { (grid.header as Record<string, unknown>).showLabel = 'yes' },
      grid => { grid.trackProjection = { source: 'logical-paper-tracks', startIndex: -1 } },
      grid => { grid.frameProjection = { source: 'logical-frames', overflow: 'wrap' } },
      grid => { grid.columnSizing = { mode: 'fixed-content', columns: { a: { widthPx: 'wide' } } } },
      grid => { grid.rowSizing = { mode: 'fixed-height', rowHeightPx: 0 } },
      grid => { grid.rowLineRules = [{ every: 0, weight: 'thin' }] },
      grid => { (grid.columns as Array<Record<string, unknown>>)[0]!.xdtsEligible = 'yes' },
    ]

    for (const mutate of mutations) {
      const invalid = structuredClone(standardA3SheetTemplate) as unknown as Record<string, unknown>
      const grid = regionRecord(invalid, 'left_action_grid').grid as Record<string, unknown>
      mutate(grid)
      expect(() => parseSheetTemplate(invalid)).toThrow()
    }
  })

  it('accepts renderer-ignored frame range redundancy on projected grids', () => {
    const template = structuredClone(digitalStandardSheetTemplate)
    const grid = template.regions.find(region => region.regionId === 'digital_action_grid')!.grid!
    grid.frameEnd = 999

    expect(parseSheetTemplate(template).regions.find(region => region.regionId === 'digital_action_grid')?.grid?.frameEnd).toBe(999)
  })

  it('validates responsive form spans and column flex definitions', () => {
    expect(parseSheetTemplate(structuredClone(digitalStandardSheetTemplate)).templateId).toBe('digital-standard-v2')

    const invalid = structuredClone(digitalStandardSheetTemplate)
    invalid.regions.find(region => region.regionId === 'digital_metadata_form')!.form!.columnFlex!.pop()
    expect(() => parseSheetTemplate(invalid)).toThrow('フォーム定義が不正')
  })

  it('accepts authoring-only region names and printed grid header overrides', () => {
    const template = structuredClone(standardA3SheetTemplate)
    const metadata = template.regions.find(region => region.regionId === 'top_metadata_form')!
    metadata.authoringName = 'カット情報の見出し枠'
    const cellGrid = template.regions.find(region => region.regionId === 'left_cell_grid')!
    cellGrid.grid!.header = { ...cellGrid.grid!.header, label: 'セル' }

    const parsed = parseSheetTemplate(template)
    expect(parsed.regions.find(region => region.regionId === metadata.regionId)?.authoringName).toBe('カット情報の見出し枠')
    expect(parsed.regions.find(region => region.regionId === cellGrid.regionId)?.grid?.header?.label).toBe('セル')
  })

  it('rejects empty authoring names and printed grid header overrides', () => {
    const invalidName = structuredClone(standardA3SheetTemplate)
    invalidName.regions[0]!.authoringName = '  '
    expect(() => parseSheetTemplate(invalidName)).toThrow('管理名が不正')

    const invalidHeader = structuredClone(standardA3SheetTemplate)
    const cellGrid = invalidHeader.regions.find(region => region.regionId === 'left_cell_grid')!
    cellGrid.grid!.header = { ...cellGrid.grid!.header, label: '' }
    expect(() => parseSheetTemplate(invalidHeader)).toThrow('格子見出しが不正')
  })

  it('requires positive form row and column sizes', () => {
    for (const mutate of [
      (form: Record<string, unknown>) => { form.columns = [] },
      (form: Record<string, unknown>) => { form.columns = [0] },
      (form: Record<string, unknown>) => { form.rows = [-1] },
    ]) {
      const invalid = structuredClone(standardA3SheetTemplate) as unknown as Record<string, unknown>
      const form = formRecord(invalid, 'top_metadata_form')
      mutate(form)
      expect(() => parseSheetTemplate(invalid)).toThrow('フォーム定義が不正')
    }
  })

  it('rejects malformed and duplicate form cell identities', () => {
    for (const mutate of [
      (cells: Array<Record<string, unknown>>) => { delete cells[0]!.cellId },
      (cells: Array<Record<string, unknown>>) => { cells[0]!.kind = 'button' },
      (cells: Array<Record<string, unknown>>) => { cells[1]!.cellId = cells[0]!.cellId },
    ]) {
      const invalid = structuredClone(standardA3SheetTemplate) as unknown as Record<string, unknown>
      const cells = formCells(invalid, 'top_metadata_form')
      mutate(cells)
      expect(() => parseSheetTemplate(invalid)).toThrow(/フォーム(?:定義|セルID)/)
    }
  })

  it('rejects invalid, out-of-bounds, and overlapping form cell placement', () => {
    for (const mutate of [
      (cells: Array<Record<string, unknown>>) => { cells[0]!.row = -1 },
      (cells: Array<Record<string, unknown>>) => { cells[0]!.column = 0.5 },
      (cells: Array<Record<string, unknown>>) => { cells[0]!.rowSpan = 0 },
      (cells: Array<Record<string, unknown>>) => { cells[0]!.columnSpan = 7 },
      (cells: Array<Record<string, unknown>>) => { cells[1]!.row = cells[0]!.row; cells[1]!.column = cells[0]!.column },
    ]) {
      const invalid = structuredClone(standardA3SheetTemplate) as unknown as Record<string, unknown>
      const cells = formCells(invalid, 'top_metadata_form')
      mutate(cells)
      expect(() => parseSheetTemplate(invalid)).toThrow(/フォーム(?:定義|セル|セル配置)/)
    }
  })

  it('requires label text and valid field references for form cells', () => {
    const missingLabel = structuredClone(standardA3SheetTemplate) as unknown as Record<string, unknown>
    delete formCells(missingLabel, 'top_metadata_form')[0]!.label
    expect(() => parseSheetTemplate(missingLabel)).toThrow('表示文字がありません')

    const missingFieldId = structuredClone(standardA3SheetTemplate) as unknown as Record<string, unknown>
    delete formCells(missingFieldId, 'top_memo_area').find(cell => cell.kind === 'field')!.fieldId
    expect(() => parseSheetTemplate(missingFieldId)).toThrow('フォーム項目IDがありません')

    const unknownFieldId = structuredClone(standardA3SheetTemplate) as unknown as Record<string, unknown>
    formCells(unknownFieldId, 'top_memo_area').find(cell => cell.kind === 'field')!.fieldId = 'missing.field'
    expect(() => parseSheetTemplate(unknownFieldId)).toThrow('存在しないフォーム項目')
  })

  it('requires grid start, row count, and inclusive end to describe the same range', () => {
    const invalid = structuredClone(standardA3SheetTemplate)
    const actionGrid = invalid.regions.find(region => region.regionId === 'left_action_grid')!
    actionGrid.grid!.frameStart = 10
    actionGrid.grid!.rowCount = 12
    actionGrid.grid!.frameEnd = 72

    expect(() => parseSheetTemplate(invalid)).toThrow('開始フレーム、行数、終了フレームが一致していません')
  })

  it('validates every editable region binding shape', () => {
    const custom = structuredClone(standardA3SheetTemplate)
    const metadata = custom.regions.find(region => region.binding?.target === 'cut-metadata')!
    metadata.binding = { target: 'cut-metadata', field: 'custom', customKey: 'studio-code' }
    expect(parseSheetTemplate(custom).regions.find(region => region.regionId === metadata.regionId)?.binding).toEqual(metadata.binding)

    const invalidAnnotation = structuredClone(standardA3SheetTemplate)
    const annotation = invalidAnnotation.regions.find(region => region.binding?.target === 'annotation-layer')!
    annotation.binding = { target: 'annotation-layer', layerId: '', intent: 'memo' }
    expect(() => parseSheetTemplate(invalidAnnotation)).toThrow('データ割当が不正')

    const invalidTimeline = structuredClone(standardA3SheetTemplate) as unknown as Record<string, unknown>
    const timelineRegion = (invalidTimeline.regions as Array<Record<string, unknown>>).find(region => region.regionId === 'left_action_grid')!
    timelineRegion.binding = { target: 'timeline-section', role: 'unknown' }
    expect(() => parseSheetTemplate(invalidTimeline)).toThrow('データ割当が不正')
  })

  it('validates projected table columns and rejects duplicate column identities', () => {
    const invalid = structuredClone(standardA3SheetTemplate) as unknown as Record<string, unknown>
    const projection = formRecord(invalid, 'top_count_table_area').projection as Record<string, unknown>
    const columns = projection.columns as Array<Record<string, unknown>>
    columns[1]!.columnId = columns[0]!.columnId

    expect(() => parseSheetTemplate(invalid)).toThrow('フォーム定義が不正')
  })

  it('rejects obsolete template schema versions during development', () => {
    const template = { ...structuredClone(standardA3SheetTemplate), schemaVersion: 4 }
    expect(() => parseSheetTemplate(template)).toThrow('対応していないシートテンプレートバージョン')
  })

  it('rejects undeclared top-level properties like the published JSON Schema', () => {
    const template = { ...structuredClone(standardA3SheetTemplate), legacyDescription: 'obsolete' }
    expect(() => parseSheetTemplate(template)).toThrow('未対応のトップレベル項目')
  })

  it('rejects undeclared properties at nested authoring boundaries', () => {
    const mutations: Array<(template: Record<string, unknown>) => void> = [
      template => { (template.page as Record<string, unknown>).legacyPaperSize = 'A3' },
      template => {
        const underlay = template.defaultUnderlay as Record<string, unknown>
        const imageRef = underlay.imageRef as Record<string, unknown>
        imageRef.legacyFileId = 'old-image'
      },
      template => {
        const style = template.style as Record<string, unknown>
        const gridHeader = style.gridHeader as Record<string, unknown>
        const labelOverrides = gridHeader.labelOverrides as Record<string, unknown>
        labelOverrides.custom = 'CUSTOM'
      },
      template => {
        const grid = regionRecord(template, 'left_action_grid').grid as Record<string, unknown>
        const header = grid.header as Record<string, unknown>
        header.legacyLabel = 'ACTION'
      },
      template => { formCells(template, 'top_metadata_form')[0]!.legacyCellType = 'title' },
      template => { (template.fields as Array<Record<string, unknown>>)[0]!.legacyScope = 'sheet' },
    ]

    for (const mutate of mutations) {
      const invalid = structuredClone(standardA3SheetTemplate) as unknown as Record<string, unknown>
      mutate(invalid)
      expect(() => parseSheetTemplate(invalid)).toThrow()
    }
  })

  it('requires a complete template-owned paper theme', () => {
    const missing = structuredClone(standardA3SheetTemplate) as unknown as Record<string, unknown>
    delete missing.theme
    expect(() => parseSheetTemplate(missing)).toThrow('用紙テーマが不正')

    const invalid = structuredClone(standardA3SheetTemplate)
    invalid.theme.paper.color = 'white'
    expect(() => parseSheetTemplate(invalid)).toThrow('用紙テーマが不正')
  })

  it('validates timeline memo creation defaults from custom templates', () => {
    const custom = structuredClone(standardA3SheetTemplate)
    custom.annotationDefaults = {
      timelineMemo: { defaultWidthMm: 42, defaultWidthPx: 240, singleFrameHeightFrames: 16 },
    }
    expect(parseSheetTemplate(custom).annotationDefaults?.timelineMemo).toEqual(custom.annotationDefaults.timelineMemo)

    for (const timelineMemo of [
      { defaultWidthMm: 0 },
      { defaultWidthPx: Number.NaN },
      { singleFrameHeightFrames: -1 },
      { defaultWidthMm: '35' },
    ]) {
      const invalid = structuredClone(standardA3SheetTemplate) as unknown as Record<string, unknown>
      invalid.annotationDefaults = { timelineMemo }
      expect(() => parseSheetTemplate(invalid)).toThrow('メモ既定値が不正')
    }
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

  it('validates auxiliary band identifiers and region references', () => {
    const template = structuredClone(standardA3SheetTemplate)
    expect(parseSheetTemplate(template).auxiliaryBands).toHaveLength(2)

    const missingRegion = structuredClone(template)
    missingRegion.auxiliaryBands![0]!.slotRegionIds[0] = 'missing_reserve'
    expect(() => parseSheetTemplate(missingRegion)).toThrow('存在しない領域')

    const duplicateBand = structuredClone(template)
    duplicateBand.auxiliaryBands![1]!.bandId = duplicateBand.auxiliaryBands![0]!.bandId
    expect(() => parseSheetTemplate(duplicateBand)).toThrow('補助列配置IDが重複')
  })

  it('validates horizontal flow dimensions and region references', () => {
    const invalidGap = structuredClone(digitalStandardSheetTemplate)
    invalidGap.horizontalFlow!.gapPx = -1
    expect(() => parseSheetTemplate(invalidGap)).toThrow('横方向フローの定義が不正')

    const missingRegion = structuredClone(digitalStandardSheetTemplate)
    missingRegion.horizontalFlow!.regionIds[0] = 'missing-region'
    expect(() => parseSheetTemplate(missingRegion)).toThrow('存在しない領域')
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

  it('requires non-empty unique choices and value-compatible defaults', () => {
    const emptyChoices = structuredClone(standardA3SheetTemplate) as unknown as Record<string, unknown>
    const emptyChoiceFields = emptyChoices.fields as Array<Record<string, unknown>>
    emptyChoiceFields[0] = {
      fieldId: 'process.choice',
      label: '工程',
      scope: 'revision',
      valueType: 'choice',
      choices: [],
    }
    expect(() => parseSheetTemplate(emptyChoices)).toThrow('フォーム項目定義が不正')

    const duplicateChoices = structuredClone(emptyChoices)
    const duplicateChoiceFields = duplicateChoices.fields as Array<Record<string, unknown>>
    duplicateChoiceFields[0]!.choices = ['A', 'A']
    expect(() => parseSheetTemplate(duplicateChoices)).toThrow('フォーム項目定義が不正')

    for (const fieldPatch of [
      { valueType: 'text', defaultValue: 1 },
      { valueType: 'multiline', defaultValue: false },
      { valueType: 'date', defaultValue: 20260801 },
      { valueType: 'number', defaultValue: '1' },
      { valueType: 'duration', defaultValue: '24' },
      { valueType: 'boolean', defaultValue: 1 },
      { valueType: 'choice', choices: ['A', 'B'], defaultValue: 'C' },
    ]) {
      const invalid = structuredClone(standardA3SheetTemplate) as unknown as Record<string, unknown>
      const fields = invalid.fields as Array<Record<string, unknown>>
      fields[0] = { ...fields[0], ...fieldPatch }
      expect(() => parseSheetTemplate(invalid)).toThrow('フォーム項目定義が不正')
    }

    for (const fieldPatch of [
      { valueType: 'text', defaultValue: '原図' },
      { valueType: 'multiline', defaultValue: '1行目\n2行目' },
      { valueType: 'date', defaultValue: '2026-08-01' },
      { valueType: 'number', defaultValue: 1 },
      { valueType: 'duration', defaultValue: 24 },
      { valueType: 'boolean', defaultValue: true },
      { valueType: 'choice', choices: ['A', 'B'], defaultValue: 'B' },
    ]) {
      const valid = structuredClone(standardA3SheetTemplate) as unknown as Record<string, unknown>
      const fields = valid.fields as Array<Record<string, unknown>>
      fields[0] = { ...fields[0], ...fieldPatch }
      expect(() => parseSheetTemplate(valid)).not.toThrow()
    }
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
    field.memoTarget = {
      scope: 'group',
      targetId: 'rough-check',
      logicalTargetId: 'process:rough-check',
      label: '前半チェック',
    }
    expect(parseSheetTemplate(template).regions.find(region => region.regionId === process.regionId)?.form?.cells)
      .toEqual(expect.arrayContaining([expect.objectContaining({
        memoTarget: {
          scope: 'group',
          targetId: 'rough-check',
          logicalTargetId: 'process:rough-check',
          label: '前半チェック',
        },
      })]))

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

function formRecord(template: Record<string, unknown>, regionId: string): Record<string, unknown> {
  return regionRecord(template, regionId).form as Record<string, unknown>
}

function formCells(template: Record<string, unknown>, regionId: string): Array<Record<string, unknown>> {
  return formRecord(template, regionId).cells as Array<Record<string, unknown>>
}

function regionRecord(template: Record<string, unknown>, regionId: string): Record<string, unknown> {
  const regions = template.regions as Array<Record<string, unknown>>
  return regions.find(region => region.regionId === regionId)!
}
