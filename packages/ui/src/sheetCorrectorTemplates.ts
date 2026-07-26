import { isSheetTemplateImageCorrectionCapable, type SheetTemplate } from '@xsheet-remap/core'

export const SHEET_CORRECTOR_EXTERNAL_TEMPLATE_VALUE = '__external-template__'
export const SHEET_CORRECTOR_LOAD_TEMPLATE_VALUE = '__load-template-json__'
export const SHEET_CORRECTOR_TEMPLATE_PATH_STORAGE_KEY = 'xsheet-remap.sheet-corrector.templatePath'

export type SheetCorrectorTemplateFile = {
  path?: string
  contents: string
}

export type SheetCorrectorExternalTemplate = {
  path?: string
  template: SheetTemplate
}

export function loadSheetCorrectorTemplateFile(file: SheetCorrectorTemplateFile): SheetCorrectorExternalTemplate {
  const template = parseSheetCorrectorTemplateJson(file.contents)
  return { path: file.path, template }
}

export function parseSheetCorrectorTemplateJson(contents: string): SheetTemplate {
  let parsed: unknown
  try {
    parsed = JSON.parse(contents.replace(/^\uFEFF/, ''))
  } catch (error) {
    throw new Error(`テンプレJSONを読み込めません: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    })
  }
  if (!isSheetTemplateCandidate(parsed)) {
    throw new Error('シートテンプレートJSONではありません。')
  }
  if (!isSheetTemplateImageCorrectionCapable(parsed)) {
    throw new Error('このテンプレートは紙シート補正に必要な参照画像または補正領域を持っていません。')
  }
  return parsed
}

export function sheetCorrectorExternalTemplateLabel(template: SheetTemplate, path?: string): string {
  const name = template.name.trim()
  if (name) return name
  return path ? fileNameFromPath(path) : template.templateId
}

export function loadStoredSheetCorrectorTemplatePath(): string | null {
  if (typeof window === 'undefined') return null
  const value = window.localStorage.getItem(SHEET_CORRECTOR_TEMPLATE_PATH_STORAGE_KEY)?.trim()
  return value || null
}

export function saveStoredSheetCorrectorTemplatePath(path: string | undefined) {
  if (typeof window === 'undefined') return
  const normalizedPath = path?.trim()
  if (normalizedPath) {
    window.localStorage.setItem(SHEET_CORRECTOR_TEMPLATE_PATH_STORAGE_KEY, normalizedPath)
  } else {
    window.localStorage.removeItem(SHEET_CORRECTOR_TEMPLATE_PATH_STORAGE_KEY)
  }
}

function isSheetTemplateCandidate(value: unknown): value is SheetTemplate {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<SheetTemplate>
  return (
    typeof candidate.schemaVersion === 'number' &&
    typeof candidate.templateId === 'string' &&
    typeof candidate.name === 'string' &&
    Boolean(candidate.page) &&
    typeof candidate.page?.widthPx === 'number' &&
    typeof candidate.page?.heightPx === 'number' &&
    candidate.page.coordinateSpace === 'normalized' &&
    Boolean(candidate.defaults) &&
    typeof candidate.defaults?.fps === 'number' &&
    typeof candidate.defaults?.durationFrames === 'number' &&
    typeof candidate.defaults?.frameOrigin === 'number' &&
    Array.isArray(candidate.defaults?.paperTracks) &&
    Array.isArray(candidate.regions)
  )
}

function fileNameFromPath(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? path
}
