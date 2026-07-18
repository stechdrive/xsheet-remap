import { SHEET_TEMPLATE_SCHEMA_VERSION, type NormalizedRect, type SheetTemplate, type SheetTemplateRegion } from './sheet-template-schema'

/** Validates an external JSON value before it becomes an editable sheet template. */
export function parseSheetTemplate(input: unknown): SheetTemplate {
  if (!isRecord(input)) throw new Error('シートテンプレートJSONではありません。')
  if (input.schemaVersion !== SHEET_TEMPLATE_SCHEMA_VERSION) {
    throw new Error(`対応していないシートテンプレートバージョンです: ${String(input.schemaVersion)}`)
  }
  if (!nonEmptyString(input.templateId) || !nonEmptyString(input.name)) {
    throw new Error('テンプレートIDまたは名前がありません。')
  }
  if (!isRecord(input.page)
    || !positiveNumber(input.page.widthPx)
    || !positiveNumber(input.page.heightPx)
    || input.page.coordinateSpace !== 'normalized') {
    throw new Error('テンプレートのページ寸法または座標系が不正です。')
  }
  if (!isRecord(input.defaults)
    || !positiveNumber(input.defaults.fps)
    || !positiveInteger(input.defaults.durationFrames)
    || !Number.isInteger(input.defaults.frameOrigin)
    || !Array.isArray(input.defaults.paperTracks)
    || !input.defaults.paperTracks.every(nonEmptyString)) {
    throw new Error('テンプレートの既定タイムライン設定が不正です。')
  }
  if (new Set(input.defaults.paperTracks).size !== input.defaults.paperTracks.length) {
    throw new Error('テンプレートのセル列名が重複しています。')
  }
  if (input.fields !== undefined) validateFields(input.fields)
  if (!Array.isArray(input.regions) || input.regions.length === 0) {
    throw new Error('テンプレートに表示領域がありません。')
  }
  const regionIds = new Set<string>()
  for (const [index, region] of input.regions.entries()) {
    validateRegion(region, index)
    if (regionIds.has(region.regionId)) throw new Error(`領域IDが重複しています: ${region.regionId}`)
    regionIds.add(region.regionId)
  }
  return {
    ...(input as unknown as SheetTemplate),
    schemaVersion: SHEET_TEMPLATE_SCHEMA_VERSION,
  }
}

function validateRegion(input: unknown, index: number): asserts input is SheetTemplateRegion {
  if (!isRecord(input) || !nonEmptyString(input.regionId) || !nonEmptyString(input.label)) {
    throw new Error(`領域 ${index + 1} のIDまたはラベルが不正です。`)
  }
  if (!sheetTemplateRegionTypes.has(String(input.type)) || !sheetTemplateRegionUsages.has(String(input.usage))) {
    throw new Error(`領域 ${input.regionId} の種類または用途が不正です。`)
  }
  if (input.type === 'decorative' && input.usage !== 'render-only') {
    throw new Error(`補助罫線領域 ${input.regionId} は描画専用である必要があります。`)
  }
  if (!isNormalizedRect(input.rect)) throw new Error(`領域 ${input.regionId} の矩形が不正です。`)
  if (input.grid !== undefined) {
    if (!isRecord(input.grid)
      || !sheetTemplateGridRoles.has(String(input.grid.role))
      || !positiveInteger(input.grid.rowCount)
      || !Array.isArray(input.grid.columns)
      || !input.grid.columns.every(column => isRecord(column) && nonEmptyString(column.columnId) && typeof column.label === 'string')) {
      throw new Error(`領域 ${input.regionId} の格子定義が不正です。`)
    }
    const columnIds = input.grid.columns.map(column => column.columnId as string)
    if (new Set(columnIds).size !== columnIds.length) {
      throw new Error(`領域 ${input.regionId} の列IDが重複しています。`)
    }
    if (input.grid.lineRules !== undefined
      && (!Array.isArray(input.grid.lineRules) || !input.grid.lineRules.every(validateGridLineRule))) {
      throw new Error(`領域 ${input.regionId} の罫線ルールが不正です。`)
    }
  }
  if (input.form !== undefined) {
    if (!isRecord(input.form)
      || input.form.cells !== undefined && (!Array.isArray(input.form.cells) || !input.form.cells.every(cell =>
        isRecord(cell)
        && (cell.editPresentation === undefined || cell.editPresentation === 'inline' || cell.editPresentation === 'popover')))) {
      throw new Error(`領域 ${input.regionId} のフォーム定義が不正です。`)
    }
  }
}

const sheetTemplateRegionTypes = new Set([
  'metadata-field', 'memo-area', 'exposure-grid', 'frame-guide', 'count-table',
  'process-check-area', 'form-table', 'annotation-area', 'decorative',
])

const sheetTemplateRegionUsages = new Set(['input', 'reference', 'render-only', 'ignored'])
const sheetTemplateGridRoles = new Set(['action', 'sound', 'cell', 'camera', 'frame-guide', 'count-table', 'other'])
const sheetTemplateFieldScopes = new Set(['production', 'cut', 'revision', 'page'])
const sheetTemplateFieldValueTypes = new Set(['text', 'multiline', 'number', 'boolean', 'choice', 'date', 'duration'])

function validateFields(input: unknown): void {
  if (!Array.isArray(input)) throw new Error('テンプレートのフォーム項目定義が不正です。')
  const fieldIds = new Set<string>()
  for (const field of input) {
    if (!isRecord(field)
      || !nonEmptyString(field.fieldId)
      || !nonEmptyString(field.label)
      || !sheetTemplateFieldScopes.has(String(field.scope))
      || !sheetTemplateFieldValueTypes.has(String(field.valueType))
      || field.choices !== undefined && (!Array.isArray(field.choices) || !field.choices.every(nonEmptyString))) {
      throw new Error('テンプレートのフォーム項目定義が不正です。')
    }
    if (fieldIds.has(field.fieldId)) throw new Error(`フォーム項目IDが重複しています: ${field.fieldId}`)
    fieldIds.add(field.fieldId)
  }
}

function validateGridLineRule(input: unknown): boolean {
  if (!isRecord(input)
    || (input.axis !== 'row' && input.axis !== 'column')
    || !['all', 'inner', 'outer', 'indexes'].includes(String(input.target))) return false
  if (input.indexes !== undefined && (!Array.isArray(input.indexes) || !input.indexes.every(nonNegativeInteger))) return false
  if (input.every !== undefined && !positiveInteger(input.every)) return false
  if (input.offset !== undefined && !Number.isInteger(input.offset)) return false
  if (input.spans !== undefined && (!Array.isArray(input.spans) || !input.spans.every(span =>
    isRecord(span) && nonNegativeInteger(span.startBoundary) && nonNegativeInteger(span.endBoundary)))) return false
  if (input.style === undefined) return true
  if (!isRecord(input.style)) return false
  if (input.style.pattern !== undefined && !['solid', 'dotted', 'dashed'].includes(String(input.style.pattern))) return false
  if (input.style.widthPx !== undefined && !positiveNumber(input.style.widthPx)) return false
  if (input.style.color !== undefined && !nonEmptyString(input.style.color)) return false
  return input.style.dashPx === undefined
    || (Array.isArray(input.style.dashPx) && input.style.dashPx.every(nonNegativeNumber))
}

function isNormalizedRect(input: unknown): input is NormalizedRect {
  if (!isRecord(input)) return false
  return finiteNumber(input.x) && finiteNumber(input.y) && positiveNumber(input.w) && positiveNumber(input.h)
    && input.x >= 0 && input.y >= 0 && input.x + input.w <= 1.000001 && input.y + input.h <= 1.000001
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null
}

function nonEmptyString(input: unknown): input is string {
  return typeof input === 'string' && input.trim().length > 0
}

function finiteNumber(input: unknown): input is number {
  return typeof input === 'number' && Number.isFinite(input)
}

function positiveNumber(input: unknown): input is number {
  return finiteNumber(input) && input > 0
}

function positiveInteger(input: unknown): input is number {
  return positiveNumber(input) && Number.isInteger(input)
}

function nonNegativeInteger(input: unknown): input is number {
  return finiteNumber(input) && input >= 0 && Number.isInteger(input)
}

function nonNegativeNumber(input: unknown): input is number {
  return finiteNumber(input) && input >= 0
}
