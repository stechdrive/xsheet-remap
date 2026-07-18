import type { CutProject, SheetFormData, SheetFormFieldValue, SheetFormFieldValues, SheetFormPageFieldValues } from './types'
import type { SheetTemplateFieldDefinition, SheetTemplateFieldScope } from './sheet-template-schema'

export function createEmptySheetFormData(): SheetFormData {
  return { production: {}, cut: {}, revision: {}, pages: {} }
}

export function normalizeSheetFormFieldValues(input: unknown): SheetFormFieldValues {
  if (!isRecord(input)) return {}
  return Object.fromEntries(Object.entries(input).flatMap(([fieldId, value]) => {
    const normalized = normalizeSheetFormFieldValue(value)
    return normalized ? [[fieldId, normalized]] : []
  }))
}

export function normalizeSheetFormData(input: unknown): SheetFormData {
  if (!isRecord(input)) return createEmptySheetFormData()
  return {
    production: normalizeSheetFormFieldValues(input.production),
    cut: normalizeSheetFormFieldValues(input.cut),
    revision: normalizeSheetFormFieldValues(input.revision),
    pages: normalizeSheetFormPageFieldValues(input.pages),
  }
}

export function normalizeSheetFormPageFieldValues(input: unknown): SheetFormPageFieldValues {
  if (!isRecord(input)) return {}
  return Object.fromEntries(Object.entries(input).flatMap(([pageId, values]) => {
    const normalized = normalizeSheetFormFieldValues(values)
    return Object.keys(normalized).length > 0 ? [[pageId, normalized]] : []
  }))
}

export function sheetFormFieldValueText(value: SheetFormFieldValue | undefined): string {
  if (!value) return ''
  if (value.kind === 'boolean') return value.value ? '✓' : ''
  if (value.kind === 'duration') return String(value.frames)
  return value.value === null ? '' : String(value.value)
}

export function sheetFormFieldValueForInput(
  definition: Pick<SheetTemplateFieldDefinition, 'valueType'>,
  input: string | number | boolean,
): SheetFormFieldValue {
  if (definition.valueType === 'boolean') return { kind: 'boolean', value: input === true || input === 'true' || input === '1' }
  if (definition.valueType === 'number') {
    const text = String(input).trim()
    const numeric = Number(text)
    return { kind: 'number', value: text && Number.isFinite(numeric) ? numeric : null }
  }
  if (definition.valueType === 'duration') {
    const numeric = Number(input)
    return { kind: 'duration', frames: Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0 }
  }
  if (definition.valueType === 'choice') return { kind: 'choice', value: String(input) }
  if (definition.valueType === 'date') return { kind: 'date', value: String(input) }
  return { kind: 'text', value: String(input) }
}

export function updateSheetFormField(
  project: CutProject,
  definition: Pick<SheetTemplateFieldDefinition, 'fieldId' | 'scope' | 'valueType'>,
  input: string | number | boolean,
  pageId?: string,
): CutProject {
  const scope = definition.scope
  const value = sheetFormFieldValueForInput(definition, input)
  if (scope === 'page') {
    if (!pageId) throw new Error(`ページ単位フィールド ${definition.fieldId} のページIDがありません。`)
    return {
      ...project,
      sheetFormData: {
        ...project.sheetFormData,
        pages: {
          ...project.sheetFormData.pages,
          [pageId]: {
            ...project.sheetFormData.pages[pageId],
            [definition.fieldId]: value,
          },
        },
      },
    }
  }
  return {
    ...project,
    sheetFormData: {
      ...project.sheetFormData,
      [scope]: {
        ...project.sheetFormData[scope],
        [definition.fieldId]: value,
      },
    },
  }
}

export function sheetFormFieldsForScope(data: SheetFormData, scope: SheetTemplateFieldScope, pageId?: string): SheetFormFieldValues {
  if (scope === 'page') return pageId ? data.pages[pageId] ?? {} : {}
  return data[scope]
}

function normalizeSheetFormFieldValue(input: unknown): SheetFormFieldValue | null {
  if (!isRecord(input) || typeof input.kind !== 'string') return null
  if (input.kind === 'text' && typeof input.value === 'string') return { kind: 'text', value: input.value }
  if (input.kind === 'choice' && typeof input.value === 'string') return { kind: 'choice', value: input.value }
  if (input.kind === 'date' && typeof input.value === 'string') return { kind: 'date', value: input.value }
  if (input.kind === 'boolean' && typeof input.value === 'boolean') return { kind: 'boolean', value: input.value }
  if (input.kind === 'number' && (input.value === null || typeof input.value === 'number' && Number.isFinite(input.value))) {
    return { kind: 'number', value: input.value }
  }
  if (input.kind === 'duration' && typeof input.frames === 'number' && Number.isFinite(input.frames)) {
    return { kind: 'duration', frames: Math.max(0, Math.round(input.frames)) }
  }
  return null
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null
}
