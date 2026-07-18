import { SHEET_TEMPLATE_SCHEMA_VERSION, type NormalizedRect, type SheetTemplate, type SheetTemplateRegion } from './sheet-template-schema'

/** Validates an external JSON value before it becomes an editable sheet template. */
export function parseSheetTemplate(input: unknown): SheetTemplate {
  if (!isRecord(input)) throw new Error('シートテンプレートJSONではありません。')
  if (input.schemaVersion !== SHEET_TEMPLATE_SCHEMA_VERSION && input.schemaVersion !== 3) {
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
  if (!isNormalizedRect(input.rect)) throw new Error(`領域 ${input.regionId} の矩形が不正です。`)
  if (input.grid !== undefined) {
    if (!isRecord(input.grid)
      || !positiveInteger(input.grid.rowCount)
      || !Array.isArray(input.grid.columns)
      || !input.grid.columns.every(column => isRecord(column) && nonEmptyString(column.columnId) && typeof column.label === 'string')) {
      throw new Error(`領域 ${input.regionId} の格子定義が不正です。`)
    }
    const columnIds = input.grid.columns.map(column => column.columnId as string)
    if (new Set(columnIds).size !== columnIds.length) {
      throw new Error(`領域 ${input.regionId} の列IDが重複しています。`)
    }
  }
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
