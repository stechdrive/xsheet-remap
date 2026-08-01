import Ajv2020, { type ErrorObject } from 'ajv/dist/2020.js'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  registerSheetTemplateJsonSchemaKeywords,
  SHEET_TEMPLATE_CHOICE_DEFAULT_JSON_SCHEMA_KEYWORD,
  validateSheetTemplateChoiceDefaultInChoices,
} from './index'
import { parseSheetTemplate } from './sheet-template-parse'
import { SHEET_TEMPLATE_SCHEMA_VERSION } from './sheet-template-schema'
import { digitalStandardSheetTemplate, standardA3SheetTemplate } from './sheet-template-presets'

const schemaPath = [
  resolve(process.cwd(), 'schemas/sheet-template.schema.json'),
  resolve(process.cwd(), '../../schemas/sheet-template.schema.json'),
].find(existsSync)
if (!schemaPath) throw new Error('schemas/sheet-template.schema.json was not found')
const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as Record<string, unknown>
const ajv = new Ajv2020({ allErrors: true, strict: true })
registerSheetTemplateJsonSchemaKeywords(ajv)
const validate = ajv.compile(schema)

const fieldDefaultContractCases: Array<{
  name: string
  patch: Record<string, unknown>
  valid: boolean
}> = [
  { name: 'omitted default', patch: { valueType: 'text' }, valid: true },
  { name: 'text string', patch: { valueType: 'text', defaultValue: 'TITLE' }, valid: true },
  { name: 'multiline string', patch: { valueType: 'multiline', defaultValue: 'line 1\nline 2' }, valid: true },
  { name: 'date string', patch: { valueType: 'date', defaultValue: '2026-08-01' }, valid: true },
  { name: 'number number', patch: { valueType: 'number', defaultValue: 24 }, valid: true },
  { name: 'duration number', patch: { valueType: 'duration', defaultValue: 144 }, valid: true },
  { name: 'boolean boolean', patch: { valueType: 'boolean', defaultValue: false }, valid: true },
  { name: 'choice member', patch: { valueType: 'choice', choices: ['原画', '動画'], defaultValue: '原画' }, valid: true },
  { name: 'choice without default', patch: { valueType: 'choice', choices: ['原画', '動画'] }, valid: true },
  { name: 'text number mismatch', patch: { valueType: 'text', defaultValue: 1 }, valid: false },
  { name: 'multiline boolean mismatch', patch: { valueType: 'multiline', defaultValue: true }, valid: false },
  { name: 'date number mismatch', patch: { valueType: 'date', defaultValue: 20260801 }, valid: false },
  { name: 'number string mismatch', patch: { valueType: 'number', defaultValue: '24' }, valid: false },
  { name: 'duration string mismatch', patch: { valueType: 'duration', defaultValue: '144' }, valid: false },
  { name: 'boolean number mismatch', patch: { valueType: 'boolean', defaultValue: 1 }, valid: false },
  { name: 'choice type mismatch', patch: { valueType: 'choice', choices: ['原画', '動画'], defaultValue: 1 }, valid: false },
  { name: 'choice default outside choices', patch: { valueType: 'choice', choices: ['原画', '動画'], defaultValue: '仕上げ' }, valid: false },
]

type UnknownKeyContractCase = {
  name: string
  base?: 'standard' | 'digital'
  target: (template: Record<string, unknown>) => Record<string, unknown>
}

const unknownKeyContractCases: UnknownKeyContractCase[] = [
  { name: 'template root', target: template => template },
  { name: 'normalized rect', target: regionPropertyTarget('top_title_field', 'rect') },
  { name: 'normalized point', target: alignmentPropertyTarget('corners', 'tl') },
  { name: 'template length', target: formCellPropertyTarget('top_metadata_form', 'metadata_label_title', 'textStyle', 'fontSize') },
  { name: 'template padding length', target: formCellPropertyTarget('top_metadata_form', 'metadata_label_title', 'textStyle', 'padding') },
  { name: 'line style', target: formPropertyTarget('top_metadata_form', 'borderStyle') },
  { name: 'text style', target: regionPropertyTarget('top_title_field', 'textStyle') },
  { name: 'grid typography', target: gridPropertyTarget('left_action_grid', 'typography') },
  { name: 'grid line span', target: gridPropertyTarget('left_sound_grid', 'lineRules', 1, 'spans', 0) },
  { name: 'grid line rule', target: gridPropertyTarget('left_sound_grid', 'lineRules', 0) },
  { name: 'grid header', target: gridPropertyTarget('left_action_grid', 'header') },
  { name: 'track projection', target: gridPropertyTarget('left_action_grid', 'trackProjection') },
  { name: 'frame projection', base: 'digital', target: gridPropertyTarget('digital_action_grid', 'frameProjection') },
  { name: 'grid column size', base: 'digital', target: gridColumnSizeTarget },
  { name: 'grid column sizing', base: 'digital', target: gridPropertyTarget('digital_action_grid', 'columnSizing') },
  { name: 'grid row sizing', target: gridRowSizingTarget },
  { name: 'grid column', target: gridPropertyTarget('left_action_grid', 'columns', 0) },
  { name: 'grid row line rule', target: gridPropertyTarget('left_action_grid', 'rowLineRules', 0) },
  { name: 'grid row label rule', target: gridRowLabelRuleTarget },
  { name: 'grid', target: regionPropertyTarget('left_action_grid', 'grid') },
  { name: 'memo target', target: formCellPropertyTarget('top_memo_area', 'memo_body', 'memoTarget') },
  { name: 'form cell', target: formCellTarget('top_metadata_form', 'metadata_label_title') },
  { name: 'track count column', target: formPropertyTarget('top_count_table_area', 'projection', 'columns', 0) },
  { name: 'track count projection', target: formPropertyTarget('top_count_table_area', 'projection') },
  { name: 'form', target: regionPropertyTarget('top_metadata_form', 'form') },
  { name: 'cut metadata binding', target: regionPropertyTarget('top_title_field', 'binding') },
  { name: 'cut group binding', target: regionPropertyTarget('top_shared_cut_numbers_field', 'binding') },
  { name: 'timeline section binding', target: timelineSectionBindingTarget },
  { name: 'annotation layer binding', target: regionPropertyTarget('top_shooting_notes_area', 'binding') },
  { name: 'region', target: regionTarget('top_title_field') },
  { name: 'horizontal span', target: horizontalSpanTarget },
  { name: 'text style variants', target: regionPropertyTarget('top_cut_field', 'textStyleVariants') },
  { name: 'field definition', target: pathTarget('fields', 0) },
  { name: 'second band theme', target: pathTarget('theme', 'paper', 'secondBands') },
  { name: 'line color theme', target: pathTarget('theme', 'ink', 'lines') },
  { name: 'timed range cue theme', target: pathTarget('theme', 'timedRangeCues', 'sound') },
  { name: 'theme', target: pathTarget('theme') },
  { name: 'theme paper', target: pathTarget('theme', 'paper') },
  { name: 'theme ink', target: pathTarget('theme', 'ink') },
  { name: 'theme timed range cues', target: pathTarget('theme', 'timedRangeCues') },
  { name: 'background book label style', target: pathTarget('style', 'bgBookLabel') },
  { name: 'visible style', target: pathTarget('style', 'outerFrame') },
  { name: 'grid header style', target: pathTarget('style', 'gridHeader') },
  { name: 'grid header label overrides', target: pathTarget('style', 'gridHeader', 'labelOverrides') },
  { name: 'template style', target: pathTarget('style') },
  { name: 'sheet image reference', target: pathTarget('defaultUnderlay', 'imageRef') },
  { name: 'calibration point pair', target: alignmentPropertyTarget('calibration', 'points', 0) },
  { name: 'sheet image calibration', target: alignmentPropertyTarget('calibration') },
  { name: 'level correction', target: alignmentPropertyTarget('levelCorrection') },
  { name: 'alignment', target: alignmentTarget },
  { name: 'alignment corners', target: alignmentPropertyTarget('corners') },
  { name: 'underlay placement', target: pathTarget('defaultUnderlay', 'placement') },
  { name: 'underlay', target: pathTarget('defaultUnderlay') },
  { name: 'naming', target: namingTarget },
  { name: 'template calibration', target: pathTarget('calibration') },
  { name: 'view layout', target: pathTarget('viewLayout') },
  { name: 'view frame axis', target: pathTarget('viewLayout', 'frameAxis') },
  { name: 'view track axis', target: pathTarget('viewLayout', 'trackAxis') },
  { name: 'view surface', target: pathTarget('viewLayout', 'surface') },
  { name: 'view work range', target: pathTarget('viewLayout', 'workRange') },
  { name: 'page model', target: pageModelTarget },
  { name: 'page', target: pathTarget('page') },
  { name: 'annotation defaults', target: pathTarget('annotationDefaults') },
  { name: 'timeline memo defaults', target: pathTarget('annotationDefaults', 'timelineMemo') },
  { name: 'timeline defaults', target: pathTarget('defaults') },
  { name: 'auxiliary band', target: pathTarget('auxiliaryBands', 0) },
  { name: 'horizontal flow', base: 'digital', target: pathTarget('horizontalFlow') },
]

function validationErrors(errors: ErrorObject[] | null | undefined): string {
  return errors?.map(error => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`).join('\n') ?? ''
}

describe('sheet-template.schema.json', () => {
  it('publishes the non-standard cross-property validator required by the schema', () => {
    expect(SHEET_TEMPLATE_CHOICE_DEFAULT_JSON_SCHEMA_KEYWORD).toBe('x-choiceDefaultInChoices')
    expect(validateSheetTemplateChoiceDefaultInChoices(true, {
      valueType: 'choice',
      choices: ['原画', '動画'],
      defaultValue: '動画',
    })).toBe(true)
    expect(validateSheetTemplateChoiceDefaultInChoices(true, {
      valueType: 'choice',
      choices: ['原画', '動画'],
      defaultValue: '仕上げ',
    })).toBe(false)
  })

  it('documents why a standard validator alone is insufficient', () => {
    const standardOnlyAjv = new Ajv2020({ allErrors: true, strict: false })
    const standardOnlyValidate = standardOnlyAjv.compile(schema)
    const invalidChoiceDefault = templateWithFirstFieldPatch({
      valueType: 'choice',
      choices: ['原画', '動画'],
      defaultValue: '仕上げ',
    })

    expect(standardOnlyValidate(invalidChoiceDefault)).toBe(true)
    expect(validate(invalidChoiceDefault)).toBe(false)
    expect(() => parseSheetTemplate(invalidChoiceDefault)).toThrow('フォーム項目定義が不正')
  })

  it('tracks the runtime template schema version', () => {
    const properties = schema.properties as Record<string, { const?: unknown }>
    expect(properties.schemaVersion?.const).toBe(SHEET_TEMPLATE_SCHEMA_VERSION)
  })

  it.each([
    ['standard A3', standardA3SheetTemplate],
    ['digital standard', digitalStandardSheetTemplate],
  ])('accepts the built-in %s template', (_name, template) => {
    expect(validate(template), validationErrors(validate.errors)).toBe(true)
  })

  it('covers authoring names and printed grid header overrides', () => {
    const template = structuredClone(standardA3SheetTemplate)
    template.regions[0]!.authoringName = 'カット情報の見出し枠'
    const cellGrid = template.regions.find(region => region.regionId === 'left_cell_grid')!
    cellGrid.grid!.header = { ...cellGrid.grid!.header, label: 'セル' }

    expect(validate(template), validationErrors(validate.errors)).toBe(true)
  })

  it('rejects obsolete versions and undeclared template properties', () => {
    const obsolete = { ...structuredClone(standardA3SheetTemplate), schemaVersion: 1 }
    expect(validate(obsolete)).toBe(false)

    const unknown = { ...structuredClone(standardA3SheetTemplate), legacyDescription: 'obsolete' }
    expect(validate(unknown)).toBe(false)
  })

  it('matches the runtime contract for choice fields and unknown top-level properties', () => {
    const missingChoices = structuredClone(standardA3SheetTemplate)
    missingChoices.fields![0] = { ...missingChoices.fields![0], valueType: 'choice', choices: undefined }
    expect(validate(missingChoices)).toBe(false)

    const duplicateChoices = structuredClone(standardA3SheetTemplate)
    duplicateChoices.fields![0] = { ...duplicateChoices.fields![0], valueType: 'choice', choices: ['原画', '原画'] }
    expect(validate(duplicateChoices)).toBe(false)
  })

  it.each(fieldDefaultContractCases)('matches parseSheetTemplate for $name', ({ patch, valid }) => {
    const template = templateWithFirstFieldPatch(patch)
    const schemaAccepted = validate(template)
    const errors = validationErrors(validate.errors)
    let parserAccepted = true
    try {
      parseSheetTemplate(template)
    } catch {
      parserAccepted = false
    }

    expect(schemaAccepted, errors).toBe(valid)
    expect(parserAccepted).toBe(valid)
    expect(schemaAccepted).toBe(parserAccepted)
  })

  it('keeps an unknown-key mutation for every exact object boundary', () => {
    expect(new Set(unknownKeyContractCases.map(testCase => testCase.name)).size).toBe(unknownKeyContractCases.length)
    expect(unknownKeyContractCases).toHaveLength(countExactObjectBoundaries(schema))
  })

  it.each(unknownKeyContractCases)('matches parseSheetTemplate for an unknown key in $name', ({ base = 'standard', target }) => {
    const source = base === 'digital' ? digitalStandardSheetTemplate : standardA3SheetTemplate
    const template = structuredClone(source) as unknown as Record<string, unknown>
    const exactObject = target(template)

    expect(validate(template), validationErrors(validate.errors)).toBe(true)
    expect(() => parseSheetTemplate(template)).not.toThrow()

    exactObject.unsupportedKey = true
    const schemaAccepted = validate(template)
    const errors = validationErrors(validate.errors)
    let parserAccepted = true
    try {
      parseSheetTemplate(template)
    } catch {
      parserAccepted = false
    }

    expect(schemaAccepted, errors).toBe(false)
    expect(parserAccepted).toBe(false)
    expect(schemaAccepted).toBe(parserAccepted)
  })
})

function templateWithFirstFieldPatch(patch: Record<string, unknown>): Record<string, unknown> {
  const template = structuredClone(standardA3SheetTemplate) as unknown as Record<string, unknown>
  const fields = template.fields as Array<Record<string, unknown>>
  fields[0] = { ...fields[0], ...patch }
  return template
}

type PathSegment = string | number

function pathTarget(...path: PathSegment[]): UnknownKeyContractCase['target'] {
  return template => recordAt(template, path)
}

function regionTarget(regionId: string): UnknownKeyContractCase['target'] {
  return template => regionRecord(template, regionId)
}

function regionPropertyTarget(regionId: string, ...path: PathSegment[]): UnknownKeyContractCase['target'] {
  return template => recordAt(regionRecord(template, regionId), path)
}

function gridPropertyTarget(regionId: string, ...path: PathSegment[]): UnknownKeyContractCase['target'] {
  return template => recordAt(recordAt(regionRecord(template, regionId), ['grid']), path)
}

function formPropertyTarget(regionId: string, ...path: PathSegment[]): UnknownKeyContractCase['target'] {
  return template => recordAt(recordAt(regionRecord(template, regionId), ['form']), path)
}

function formCellTarget(regionId: string, cellId: string): UnknownKeyContractCase['target'] {
  return template => formCellRecord(template, regionId, cellId)
}

function formCellPropertyTarget(regionId: string, cellId: string, ...path: PathSegment[]): UnknownKeyContractCase['target'] {
  return template => recordAt(formCellRecord(template, regionId, cellId), path)
}

function namingTarget(template: Record<string, unknown>): Record<string, unknown> {
  template.naming = { cutNumberPrefix: 'C', cutNumberPrefixMode: 'numeric-only' }
  return recordAt(template, ['naming'])
}

function pageModelTarget(template: Record<string, unknown>): Record<string, unknown> {
  template.pageModel = { type: 'paged-repeat', framesPerPage: 144, defaultViewMode: 'continuous' }
  return recordAt(template, ['pageModel'])
}

function horizontalSpanTarget(template: Record<string, unknown>): Record<string, unknown> {
  const region = regionRecord(template, 'top_title_field')
  region.horizontalSpan = { source: 'resolved-page-content' }
  return recordAt(region, ['horizontalSpan'])
}

function timelineSectionBindingTarget(template: Record<string, unknown>): Record<string, unknown> {
  const region = regionRecord(template, 'left_action_grid')
  region.binding = { target: 'timeline-section', role: 'action' }
  return recordAt(region, ['binding'])
}

function gridRowSizingTarget(template: Record<string, unknown>): Record<string, unknown> {
  const grid = recordAt(regionRecord(template, 'left_action_grid'), ['grid'])
  grid.rowSizing = { mode: 'fit-region' }
  return recordAt(grid, ['rowSizing'])
}

function gridRowLabelRuleTarget(template: Record<string, unknown>): Record<string, unknown> {
  const grid = recordAt(regionRecord(template, 'left_action_grid'), ['grid'])
  grid.rowLabelRules = [{ every: 24, format: 'elapsed-seconds' }]
  return recordAt(grid, ['rowLabelRules', 0])
}

function gridColumnSizeTarget(template: Record<string, unknown>): Record<string, unknown> {
  const sizing = recordAt(regionRecord(template, 'digital_action_grid'), ['grid', 'columnSizing'])
  sizing.columns = { action_A: { widthPx: 40 } }
  return recordAt(sizing, ['columns', 'action_A'])
}

function alignmentTarget(template: Record<string, unknown>): Record<string, unknown> {
  const underlay = recordAt(template, ['defaultUnderlay'])
  underlay.alignment = {
    opacity: 1,
    scale: 1,
    corners: {
      tl: { x: 0, y: 0 },
      tr: { x: 1, y: 0 },
      br: { x: 1, y: 1 },
      bl: { x: 0, y: 1 },
    },
    calibration: {
      enabled: true,
      points: [{ pointId: 'origin', label: '原点', source: { x: 0, y: 0 }, target: { x: 0, y: 0 } }],
    },
    levelCorrection: { enabled: true, inputBlack: 0, inputWhite: 1, gamma: 1 },
  }
  return recordAt(underlay, ['alignment'])
}

function alignmentPropertyTarget(...path: PathSegment[]): UnknownKeyContractCase['target'] {
  return template => recordAt(alignmentTarget(template), path)
}

function regionRecord(template: Record<string, unknown>, regionId: string): Record<string, unknown> {
  const regions = template.regions
  if (!Array.isArray(regions)) throw new Error('Template regions are not an array')
  const region = regions.find(candidate => isRecord(candidate) && candidate.regionId === regionId)
  if (!isRecord(region)) throw new Error(`Template region was not found: ${regionId}`)
  return region
}

function formCellRecord(template: Record<string, unknown>, regionId: string, cellId: string): Record<string, unknown> {
  const cells = recordAt(regionRecord(template, regionId), ['form']).cells
  if (!Array.isArray(cells)) throw new Error(`Template form cells are not an array: ${regionId}`)
  const cell = cells.find(candidate => isRecord(candidate) && candidate.cellId === cellId)
  if (!isRecord(cell)) throw new Error(`Template form cell was not found: ${regionId}/${cellId}`)
  return cell
}

function recordAt(root: unknown, path: readonly PathSegment[]): Record<string, unknown> {
  let value = root
  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(value)) throw new Error(`Expected an array before index ${segment}`)
      value = value[segment]
    } else {
      if (!isRecord(value)) throw new Error(`Expected an object before property ${segment}`)
      value = value[segment]
    }
  }
  if (!isRecord(value)) throw new Error(`Expected an object at ${path.join('.') || '<root>'}`)
  return value
}

function countExactObjectBoundaries(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((total, item) => total + countExactObjectBoundaries(item), 0)
  if (!isRecord(value)) return 0
  let total = value.additionalProperties === false ? 1 : 0
  for (const item of Object.values(value)) total += countExactObjectBoundaries(item)
  return total
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
